// Market data (public, no API keys): candles, markets, tickers, trades, economic calendar, and live feeds over the
// shared WebSocket. Every route except /api/health needs a session (see core/auth.ts).
//   GET /api/health                       → { ok }   (public)
//   GET /api/exchanges                    → [{ id, name, ws }]   (CCXT exchanges + FX)
//   GET /api/markets?exchange=ID          → [{ sym, base, quote, type }]
//   GET /api/bars?exchange=ID&symbol=SYM&tf=TF[&until=ms][&limit=n]
//   GET /api/tickers?exchange=ID
//   GET /api/trades?exchange=ID&symbol=SYM → [{ t, px, qty, buy }]   (latest page)
//   GET /api/calendar                     → this week's economic events (ForexFactory's public JSON, cached 30 min)
//   WS  {op:'sub'|'unsub', exchange, symbol, tf}  ←  {exchange, symbol, tf, bar}
//       {op:'sub'|'unsub', kind:'trades'|'book', exchange, symbol}  ←  {kind, exchange, symbol, data}
import { aggregate, tfSeconds, validTf, type Bar } from '../src/data.ts';
import * as cx from './ccxt.ts';
import { fxMarkets, yahooBars, yahooDividends, yahooTicker } from './yahoo.ts';
import { isPublic } from './core/mode.ts';
import { limits } from './core/quota.ts';
import { IRAN } from './iran/index.ts';

// The MetaTrader bridge client is a private-server feature: a public server never loads it, and 'mt5' is just an unknown exchange there.
const MT5 = isPublic ? null : await import('./mt5.ts');
import { HttpError, bad, clients, onWs, onWsClose, route, type WsClient } from './core/http.ts';

// SYM_RE also admits Persian letters and digits: Tehran Stock Exchange tickers.
export const SYM_RE = /^[A-Z0-9_.\u0600-\u06FF]{1,40}$/, EX_RE = /^[a-z0-9]{2,30}$/;
/** Sources served here rather than through CCXT: Yahoo ('fx') and the local MetaTrader 5 bridge ('mt5'). */
const LOCAL = new Set([...(MT5 ? ['fx', 'mt5'] : ['fx']), ...Object.keys(IRAN)]);


function params(u: URL) {
  const exchange = u.searchParams.get('exchange') ?? '', symbol = (u.searchParams.get('symbol') ?? '').toUpperCase(), tf = u.searchParams.get('tf') ?? '';
  if (!EX_RE.test(exchange) || (!LOCAL.has(exchange) && !cx.isExchange(exchange))) throw bad('Unknown exchange');
  return { exchange, symbol, tf };
}
const checkSymTf = (symbol: string, tf: string) => { if (!SYM_RE.test(symbol)) throw bad('Bad symbol'); if (!validTf(tf)) throw bad('Bad timeframe') };

export async function bars(exchange: string, symbol: string, tf: string, until?: number, limit = 1000): Promise<{ bars: Bar[]; base: string }> {
  const ir = IRAN[exchange];
  const r = ir ? await ir.bars(symbol, tf, until, limit) : exchange === 'fx' ? await yahooBars(symbol, tf, until, limit) : exchange === 'mt5' ? await MT5!.mt5Ohlcv(symbol, tf, until, limit) : await cx.ohlcv(exchange, symbol, tf, until, limit);
  if (r.base === tf) return r;
  const agg = aggregate(r.bars, tfSeconds(tf), ir?.weekAnchor);
  return { bars: agg.length > 1 ? agg.slice(1) : agg, base: r.base };   // first bucket may be partial
}

let calendarCache: { at: number; data: unknown } | null = null;
let exchangesCache: { id: string; name: string; ws: boolean }[] | null = null;
async function marketRoute(u: URL): Promise<unknown> {
  switch (u.pathname) {
    case '/api/exchanges':
      return (exchangesCache ??= [{ id: 'fx', name: 'Forex, metals, indices & stocks', ws: false }, ...(MT5 ? [{ id: 'mt5', name: 'MetaTrader 5 (local bridge, demo)', ws: false }] : []), ...Object.values(IRAN).map(x => ({ id: x.id, name: x.name, ws: false })), ...cx.exchangeIds().map(id => ({ id, name: id, ws: false }))]);
    case '/api/markets': {
      const { exchange } = params(u);
      if (exchange === 'fx') return fxMarkets().map(m => ({ sym: m.sym, base: m.sym, quote: '', type: m.type, name: m.name }));
      if (MT5 && exchange === 'mt5') return MT5.mt5Markets();
      if (IRAN[exchange]) return IRAN[exchange].markets();
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
      if (LOCAL.has(exchange)) throw bad('No order flow for FX or MT5');
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
      return IRAN[exchange] ? (IRAN[exchange].tickers?.() ?? []) : LOCAL.has(exchange) ? [] : cx.tickers(exchange);
    }
  }
  throw new HttpError(404, 'Not found');
}

// ---------- live candles: one upstream feed per (exchange, symbol, tf), fanned out to subscribers ----------
interface Feed { subs: Set<WsClient>; stop: () => void; kind: 'candles' | 'trades' | 'book' | 'fx' }
/** Public mode: distinct upstream feeds the whole server may hold (CT_FEED_LIMIT_CANDLES / _TRADES / _BOOK / _FX). */
const FEED_CAP = { candles: 300, trades: 60, book: 40, fx: 100 };
const feedCap = (kind: Feed['kind']) => (isPublic ? Number(process.env['CT_FEED_LIMIT_' + kind.toUpperCase()]) || FEED_CAP[kind] : Infinity);
const feedsOf = (kind: Feed['kind']) => { let n = 0; for (const f of feeds.values()) if (f.kind === kind) n++; return n };
const feeds = new Map<string, Feed>();
const keyOf = (e: string, s: string, tf: string) => `${e}|${s}|${tf}`;

export function startFeed(exchange: string, symbol: string, tf: string, send: (b: Bar) => void, onFail?: () => void): () => void {
  const sec = tfSeconds(tf);
  let cur = -1, parts = new Map<number, Bar>();
  // Aggregate base-timeframe candles into the requested timeframe (weeks anchored to Monday, like data.ts).
  const emitAgg = (b: Bar) => {
    const anchor = sec % 604800 === 0 ? (IRAN[exchange]?.weekAnchor ?? 345600) : 0, t = Math.floor((b.time - anchor) / sec) * sec + anchor;
    if (t !== cur) { cur = t; parts = new Map() }
    parts.set(b.time, b);
    const ps = [...parts.values()].sort((x, y) => x.time - y.time);
    send({ time: t, open: ps[0].open, high: Math.max(...ps.map(p => p.high)), low: Math.min(...ps.map(p => p.low)), close: ps.at(-1)!.close, volume: ps.reduce((a, p) => a + p.volume, 0) });
  };
  if (LOCAL.has(exchange)) {
    // Neither Yahoo nor MT5 pushes prices here: poll (the local MT5 bridge often, Yahoo gently).
    let alive = true, first = true;
    const ir = IRAN[exchange], get = ir ? ir.bars : exchange === 'fx' ? yahooBars : MT5!.mt5Ohlcv, every = ir ? ir.every : exchange === 'fx' ? 15000 : 2000;
    (async () => {
      while (alive) {
        try { const r = await get(symbol, tf === '1M' ? '1M' : tf, undefined, 3); if (alive) r.base === tf ? r.bars.slice(-2).forEach(send) : r.bars.slice(-Math.ceil(sec / tfSeconds(r.base)) - 1).forEach(emitAgg); first = false } catch { if (first && ir) { alive = false; onFail?.(); return } }
        await new Promise(r => setTimeout(r, every));
      }
    })();
    return () => { alive = false };
  }
  let stop = () => {};
  cx.ohlcv(exchange, symbol, tf, undefined, 2).then(({ base }) => {
    stop = cx.watch(exchange, symbol, base, base === tf ? send : emitAgg);
  }).catch(() => onFail?.());
  return () => stop();
}

// Clients send {op:'sub'|'unsub', exchange, symbol, tf} for candles or {op, kind:'trades'|'book', exchange, symbol} for order flow.
const mineOf = (c: WsClient) => { let m = c.data.get('market') as Set<string> | undefined; if (!m) c.data.set('market', (m = new Set())); return m };
function drop(c: WsClient, k: string) {
  const f = feeds.get(k); mineOf(c).delete(k); if (!f) return;
  f.subs.delete(c); if (!f.subs.size) { f.stop(); feeds.delete(k) }
}
/** Market subscriptions of all of a user's sockets (public mode caps: per socket and per user). */
const userSubs = (uid: number) => { let n = 0; for (const x of clients) if (x.userId === uid) n += mineOf(x).size; return n };
function capOk(c: WsClient, mine: Set<string>) {
  const L = limits(c.userId);
  if (mine.size >= L.subsSocket || userSubs(c.userId) >= L.subsUser) { c.send({ type: 'error', code: 'feed_limit', msg: 'Too many chart subscriptions' }); return false }
  return true;
}
/** A feed that could not start is removed, and its subscribers are told, so the slot is free and a later subscribe can retry. */
function failFeed(k: string, f: Feed) {
  if (feeds.get(k) !== f) return;
  feeds.delete(k);
  for (const s of f.subs) { mineOf(s).delete(k); s.send({ type: 'error', code: 'feed_failed', msg: 'This market could not be subscribed' }) }
  f.subs.clear(); f.stop();
}
/** Public mode: only symbols the exchange really lists may start an upstream feed (a made-up symbol would still cost a connection attempt). */
async function listed(exchange: string, symbol: string) { return LOCAL.has(exchange) || (await cx.markets(exchange)).list.some(x => x.sym === symbol) }
function onMarket(c: WsClient, m: Record<string, unknown>, checked = false) {
  if (checked && c.ws.readyState !== 1) return;   // left while the market list was being checked
  const exchange = String(m.exchange ?? ''), symbol = String(m.symbol ?? '').toUpperCase(), tf = String(m.tf ?? ''), mine = mineOf(c);
  if (m.kind === 'trades' || m.kind === 'book') {
    // Order flow feeds share the same fan-out map, keyed by kind instead of timeframe.
    if (LOCAL.has(exchange) || !cx.isExchange(exchange) || !SYM_RE.test(symbol)) return;
    const kind = m.kind, k = keyOf(exchange, symbol, '#' + kind);
    if (m.op === 'unsub') return drop(c, k);
    if (mine.has(k) || !capOk(c, mine)) return;
    let f = feeds.get(k);
    if (!f && isPublic && !checked) return void listed(exchange, symbol).then(ok => ok ? onMarket(c, m, true) : c.send({ type: 'error', code: 'unknown_symbol', msg: 'Unknown market' })).catch(() => c.send({ type: 'error', code: 'unknown_symbol', msg: 'Could not check the market' }));
    if (!f && feedsOf(kind) >= feedCap(kind)) return void c.send({ type: 'error', code: 'feed_limit', msg: 'The server is at its limit of live feeds' });
    if (!f) {
      const feed: Feed = { subs: new Set(), stop: () => {}, kind };
      const out = (data: unknown) => feed.subs.forEach(s => s.send({ kind, exchange, symbol, data }));
      feed.stop = kind === 'trades' ? cx.watchPrints(exchange, symbol, out) : cx.watchBook(exchange, symbol, out);
      feeds.set(k, (f = feed));
    }
    f.subs.add(c); mine.add(k);
    return;
  }
  if (!EX_RE.test(exchange) || (!LOCAL.has(exchange) && !cx.isExchange(exchange)) || !SYM_RE.test(symbol) || !validTf(tf)) return;
  if (exchange === 'fx' && !yahooTicker(symbol)) return;
  const k = keyOf(exchange, symbol, tf);
  if (m.op === 'unsub') return drop(c, k);
  if (mine.has(k) || !capOk(c, mine)) return;
  let f = feeds.get(k);
  if (!f && isPublic && !checked) return void listed(exchange, symbol).then(ok => ok ? onMarket(c, m, true) : c.send({ type: 'error', code: 'unknown_symbol', msg: 'Unknown market' })).catch(() => c.send({ type: 'error', code: 'unknown_symbol', msg: 'Could not check the market' }));
  const kind = exchange === 'fx' ? 'fx' : 'candles';
  if (!f && feedsOf(kind) >= feedCap(kind)) return void c.send({ type: 'error', code: 'feed_limit', msg: 'The server is at its limit of live feeds' });
  if (!f) {
    const feed: Feed = { subs: new Set(), stop: () => {}, kind };
    feed.stop = startFeed(exchange, symbol, tf, bar => feed.subs.forEach(s => s.send({ exchange, symbol, tf, bar })), () => failFeed(k, feed));
    feeds.set(k, (f = feed));
  }
  f.subs.add(c); mine.add(k);
}
onWs('sub', (c, m) => onMarket(c, m));
onWs('unsub', (c, m) => onMarket(c, m));
onWsClose(c => [...mineOf(c)].forEach(k => drop(c, k)));

route('GET', '/api/health', () => ({ ok: true, exchanges: cx.exchangeIds().length }), { public: true });
for (const p of ['/api/exchanges', '/api/markets', '/api/bars', '/api/tickers', '/api/trades', '/api/calendar']) route('GET', p, c => marketRoute(c.url));
route('GET', '/api/dividends', c => { const s = (c.url.searchParams.get('sym') ?? '').toUpperCase(); if (!/^[A-Z0-9.]{1,12}$/.test(s)) throw new HttpError(400, 'sym: a ticker'); return yahooDividends(s) });
