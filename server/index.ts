// Local market-data server for Chart Terminal. Binds to 127.0.0.1 only; no API keys, public data only.
//   GET /api/health                       → { ok }
//   GET /api/exchanges                    → [{ id, name, ws }]   (CCXT exchanges + FX)
//   GET /api/markets?exchange=ID          → [{ sym, base, quote, type }]
//   GET /api/bars?exchange=ID&symbol=SYM&tf=TF[&until=ms][&limit=n]
//   GET /api/tickers?exchange=ID
//   GET /api/trades?exchange=ID&symbol=SYM → [{ t, px, qty, buy }]   (latest page)
//   GET /api/calendar                     → this week's economic events (ForexFactory's public JSON, cached 30 min)
//   WS  /ws   → {op:'sub'|'unsub', exchange, symbol, tf}  ←  {exchange, symbol, tf, bar}
//             → {op:'sub'|'unsub', kind:'trades'|'book', exchange, symbol}  ←  {kind, exchange, symbol, data}
import http from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { aggregate, tfSeconds, validTf, type Bar } from '../src/data.ts';
import * as cx from './ccxt.ts';
import { fxMarkets, yahooBars, yahooTicker } from './yahoo.ts';

const HOST = '127.0.0.1', PORT = Number(process.env.PORT ?? 8787);
const ALLOWED_ORIGINS = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const SYM_RE = /^[A-Z0-9_.]{1,40}$/, EX_RE = /^[a-z0-9]{2,30}$/;

class HttpError extends Error { status: number; constructor(status: number, msg: string) { super(msg); this.status = status } }
const bad = (msg: string) => new HttpError(400, msg);

function params(u: URL) {
  const exchange = u.searchParams.get('exchange') ?? '', symbol = (u.searchParams.get('symbol') ?? '').toUpperCase(), tf = u.searchParams.get('tf') ?? '';
  if (!EX_RE.test(exchange) || (exchange !== 'fx' && !cx.isExchange(exchange))) throw bad('Unknown exchange');
  return { exchange, symbol, tf };
}
const checkSymTf = (symbol: string, tf: string) => { if (!SYM_RE.test(symbol)) throw bad('Bad symbol'); if (!validTf(tf)) throw bad('Bad timeframe') };

async function bars(exchange: string, symbol: string, tf: string, until?: number, limit = 1000): Promise<{ bars: Bar[]; base: string }> {
  const r = exchange === 'fx' ? await yahooBars(symbol, tf, until, limit) : await cx.ohlcv(exchange, symbol, tf, until, limit);
  if (r.base === tf) return r;
  const agg = aggregate(r.bars, tfSeconds(tf));
  return { bars: agg.length > 1 ? agg.slice(1) : agg, base: r.base };   // first bucket may be partial
}

let calendarCache: { at: number; data: unknown } | null = null;
let exchangesCache: { id: string; name: string; ws: boolean }[] | null = null;
async function route(u: URL): Promise<unknown> {
  switch (u.pathname) {
    case '/api/health': return { ok: true, exchanges: cx.exchangeIds().length };
    case '/api/exchanges':
      return (exchangesCache ??= [{ id: 'fx', name: 'Forex, metals, indices & stocks', ws: false }, ...cx.exchangeIds().map(id => ({ id, name: id, ws: false }))]);
    case '/api/markets': {
      const { exchange } = params(u);
      if (exchange === 'fx') return fxMarkets().map(m => ({ sym: m.sym, base: m.sym, quote: '', type: m.type, name: m.name }));
      return (await cx.markets(exchange)).list.filter(m => m.active).map(({ sym, base, quote, type }) => ({ sym, base, quote, type }));
    }
    case '/api/bars': {
      const { exchange, symbol, tf } = params(u);
      checkSymTf(symbol, tf);
      const until = u.searchParams.has('until') ? Number(u.searchParams.get('until')) : undefined;
      const limit = Math.min(1500, Math.max(1, Number(u.searchParams.get('limit') ?? 1000)));
      if (until !== undefined && !Number.isFinite(until)) throw bad('Bad until');
      return (await bars(exchange, symbol, tf, until, limit)).bars;
    }
    case '/api/trades': {
      const { exchange, symbol } = params(u);
      if (exchange === 'fx') throw bad('No order flow for FX');
      if (!SYM_RE.test(symbol)) throw bad('Bad symbol');
      return cx.trades(exchange, symbol);
    }
    case '/api/calendar': {
      if (calendarCache && Date.now() - calendarCache.at < 30 * 60_000) return calendarCache.data;
      const r = await fetch('https://nfs.faireconomy.media/ff_calendar_thisweek.json', { signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new HttpError(502, `Calendar source returned ${r.status}`);
      calendarCache = { at: Date.now(), data: await r.json() };
      return calendarCache.data;
    }
    case '/api/tickers': {
      const { exchange } = params(u);
      return exchange === 'fx' ? [] : cx.tickers(exchange);
    }
  }
  throw new HttpError(404, 'Not found');
}

const server = http.createServer(async (req, res) => {
  // No CORS headers: the app reaches us through Vite's same-origin proxy, so other websites can't read responses.
  if (req.method !== 'GET') { res.writeHead(405).end(); return }
  try {
    const body = JSON.stringify(await route(new URL(req.url ?? '/', `http://${HOST}`)));
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(body);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 502;
    res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify({ error: (e as Error).message }));
  }
});

// ---------- live candles: one upstream feed per (exchange, symbol, tf), fanned out to subscribers ----------
interface Feed { subs: Set<WebSocket>; stop: () => void }
const feeds = new Map<string, Feed>();
const keyOf = (e: string, s: string, tf: string) => `${e}|${s}|${tf}`;

function startFeed(exchange: string, symbol: string, tf: string, send: (b: Bar) => void): () => void {
  const sec = tfSeconds(tf);
  let cur = -1, parts = new Map<number, Bar>();
  // Aggregate base-timeframe candles into the requested timeframe (weeks anchored to Monday, like data.ts).
  const emitAgg = (b: Bar) => {
    const anchor = sec % 604800 === 0 ? 345600 : 0, t = Math.floor((b.time - anchor) / sec) * sec + anchor;
    if (t !== cur) { cur = t; parts = new Map() }
    parts.set(b.time, b);
    const ps = [...parts.values()].sort((x, y) => x.time - y.time);
    send({ time: t, open: ps[0].open, high: Math.max(...ps.map(p => p.high)), low: Math.min(...ps.map(p => p.low)), close: ps.at(-1)!.close, volume: ps.reduce((a, p) => a + p.volume, 0) });
  };
  if (exchange === 'fx') {
    let alive = true;
    (async () => {
      while (alive) {
        try { const r = await yahooBars(symbol, tf === '1M' ? '1M' : tf, undefined, 3); if (alive) r.base === tf ? r.bars.slice(-2).forEach(send) : r.bars.slice(-Math.ceil(sec / tfSeconds(r.base)) - 1).forEach(emitAgg) } catch {}
        await new Promise(r => setTimeout(r, 15000));
      }
    })();
    return () => { alive = false };
  }
  let stop = () => {};
  cx.ohlcv(exchange, symbol, tf, undefined, 2).then(({ base }) => {
    stop = cx.watch(exchange, symbol, base, base === tf ? send : emitAgg);
  }).catch(() => {});
  return () => stop();
}

const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  const origin = req.headers.origin;
  if (!req.url?.startsWith('/ws') || (origin && !ALLOWED_ORIGINS.test(origin))) { socket.destroy(); return }
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws));
});
wss.on('connection', (ws: WebSocket) => {
  const mine = new Set<string>();
  const drop = (k: string) => {
    const f = feeds.get(k); if (!f) return;
    f.subs.delete(ws); mine.delete(k);
    if (!f.subs.size) { f.stop(); feeds.delete(k) }
  };
  ws.on('message', raw => {
    let m: { op?: string; kind?: string; exchange?: string; symbol?: string; tf?: string };
    try { m = JSON.parse(String(raw)) } catch { return }
    const exchange = String(m.exchange ?? ''), symbol = String(m.symbol ?? '').toUpperCase(), tf = String(m.tf ?? '');
    if (m.kind === 'trades' || m.kind === 'book') {
      // Order flow feeds share the same fan-out map, keyed by kind instead of timeframe.
      if (exchange === 'fx' || !cx.isExchange(exchange) || !SYM_RE.test(symbol)) return;
      const kind = m.kind, k = keyOf(exchange, symbol, '#' + kind);
      if (m.op === 'unsub') return drop(k);
      if (m.op !== 'sub' || mine.has(k)) return;
      let f = feeds.get(k);
      if (!f) {
        const feed: Feed = { subs: new Set(), stop: () => {} };
        const out = (data: unknown) => { const msg = JSON.stringify({ kind, exchange, symbol, data }); feed.subs.forEach(s => s.readyState === 1 && s.send(msg)) };
        feed.stop = kind === 'trades' ? cx.watchPrints(exchange, symbol, out) : cx.watchBook(exchange, symbol, out);
        feeds.set(k, (f = feed));
      }
      f.subs.add(ws); mine.add(k);
      return;
    }
    if (!EX_RE.test(exchange) || (exchange !== 'fx' && !cx.isExchange(exchange)) || !SYM_RE.test(symbol) || !validTf(tf)) return;
    if (exchange === 'fx' && !yahooTicker(symbol)) return;
    const k = keyOf(exchange, symbol, tf);
    if (m.op === 'unsub') return drop(k);
    if (m.op !== 'sub' || mine.has(k)) return;
    let f = feeds.get(k);
    if (!f) {
      const feed: Feed = { subs: new Set(), stop: () => {} };
      feed.stop = startFeed(exchange, symbol, tf, bar => { const msg = JSON.stringify({ exchange, symbol, tf, bar }); feed.subs.forEach(s => s.readyState === 1 && s.send(msg)) });
      feeds.set(k, (f = feed));
    }
    f.subs.add(ws); mine.add(k);
  });
  ws.on('close', () => [...mine].forEach(drop));
});

server.listen(PORT, HOST, () => console.log(`Chart Terminal data server on http://${HOST}:${PORT} (${cx.exchangeIds().length} exchanges + FX)`));
