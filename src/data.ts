// Market data: Binance public mirror (no key, CORS-enabled). Exchange accounts come later via the local server.
import { STANDALONE_WHY, isStandalone, serverFetch, serverSocket } from './servers.ts';
import { ofTfLabel, ofTfName, parseOfTf } from './orderflow/tfbars.ts';
export interface Bar { time: number; open: number; high: number; low: number; close: number; volume: number }

/**
 * Other bar sources (order flow: activity intervals and Market Replay) register here; each returns null for requests that
 * aren't theirs. They live in modules that import this one, hence a registry instead of an import.
 */
export const barHooks: { fetch: (sym: string, tf: string, endTime?: number) => Promise<Bar[]> | null; stream: (sym: string, tf: string, onBar: (b: Bar) => void) => (() => void) | null }[] = [];

const API = 'https://data-api.binance.vision/api/v3';
const WS = 'wss://data-stream.binance.vision';

/** Default interval buttons. Any `<n><s|m|h|d|w|M>` works; non-Binance intervals are aggregated client-side. */
export const TFS = ['1s', '1m', '3m', '5m', '15m', '30m', '45m', '1h', '2h', '3h', '4h', '6h', '12h', '1d', '3d', '1w', '1M'];
const NATIVE = ['1s', '1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w', '1M'];
const UNIT: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400, w: 604800, M: 2592000 };
export const validTf = (tf: string) => /^\d+[smhdwM]$/.test(tf) && +tf.slice(0, -1) > 0;
// orderflow: activity intervals (100T, R10, REV5, D500) are built from trades in src/orderflow; they count as 1 s for spacing.
/** Clock intervals plus the order-flow activity intervals (client only; the server's validTf stays clock-only). */
export const anyTf = (tf: string) => validTf(tf) || !!parseOfTf(tf);
export const tfSeconds = (tf: string) => (parseOfTf(tf) ? 1 : +tf.slice(0, -1) * UNIT[tf.at(-1)!]);
export const tfLabel = (tf: string) => { const of = parseOfTf(tf); if (of) return ofTfLabel(of); const n = tf.slice(0, -1), u = tf.at(-1)!; return u === 'M' ? `${n} month${+n > 1 ? 's' : ''}` : `${n}${{ s: ' second', m: ' minute', h: ' hour', d: ' day', w: ' week' }[u]}${+n > 1 ? 's' : ''}` };
/** Parse what a user types ("15", "4h", "1D", "2W", "100T", "R10") into an interval. Bare numbers are minutes. */
export function parseTf(s: string): string | null {
  const of = parseOfTf(s); if (of) return ofTfName(of);
  const m = s.trim().match(/^(\d+)\s*([smhdwM]?)$/i); if (!m) return null;
  const u = m[2] === 'M' ? 'M' : (m[2] || 'm').toLowerCase();
  const tf = `${+m[1]}${u}`;
  return validTf(tf) ? tf : null;
}
/** Native interval to build `tf` from, and how many of them make one bar. */
function baseOf(tf: string): { base: string; n: number } {
  if (NATIVE.includes(tf)) return { base: tf, n: 1 };
  const sec = tfSeconds(tf);
  const base = [...NATIVE].reverse().find(b => b.at(-1) !== 'M' && sec % tfSeconds(b) === 0) ?? '1m';
  return { base, n: sec / tfSeconds(base) };
}
// Weeks are anchored to Monday (epoch day 0 was a Thursday), like exchange weekly candles.
const bucket = (t: number, sec: number) => { const a = sec % 604800 === 0 ? 345600 : 0; return Math.floor((t - a) / sec) * sec + a };
export function aggregate(bars: Bar[], sec: number): Bar[] {
  const out: Bar[] = [];
  for (const b of bars) {
    const t = bucket(b.time, sec), last = out.at(-1);
    if (last && last.time === t) { last.high = Math.max(last.high, b.high); last.low = Math.min(last.low, b.low); last.close = b.close; last.volume += b.volume }
    else out.push({ ...b, time: t });
  }
  return out;
}

const k2bar = (k: (string | number)[]): Bar => ({ time: +k[0] / 1000, open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] });

// ---------- remote symbols via the local data server (EXCH:SYMBOL, e.g. BYBIT:BTC_USDT.P, FX:EURUSD) ----------
export const isRemote = (s: string) => /^[A-Z0-9]+:/.test(s) && !s.startsWith('BINANCE:');
export const splitSym = (s: string) => { const i = s.indexOf(':'); return { exchange: s.slice(0, i).toLowerCase(), symbol: s.slice(i + 1) } };
export async function serverJson<T>(path: string): Promise<T> {
  let r: Response;
  if (isStandalone()) throw Error(STANDALONE_WHY);
  try { r = await serverFetch(path) } catch { throw Error('Data server is not running — start it with: npm run server') }
  const j = await r.json().catch(() => ({ error: `Data server error ${r.status} — is it running? (npm run server)` }));
  if (!r.ok) throw Error((j as { error?: string }).error ?? String(r.status));
  return j as T;
}
async function fetchRemote(sym: string, tf: string, endTime?: number): Promise<Bar[]> {
  const { exchange, symbol } = splitSym(sym);
  const q = new URLSearchParams({ exchange, symbol, tf, limit: '1000' });
  if (endTime) q.set('until', String(endTime));
  return serverJson<Bar[]>(`/api/bars?${q}`);
}
/** One shared socket to the data server; subscriptions are re-sent after reconnects. */
const remoteSubs = new Map<string, Set<(b: Bar) => void>>();
let remoteWs: WebSocket | null = null, remoteWait = 3000;
function remoteSocket(): WebSocket {
  if (remoteWs && remoteWs.readyState <= 1) return remoteWs;
  const ws = serverSocket('/ws');
  remoteWs = ws;
  ws.onopen = () => { remoteWait = 3000; remoteSubs.forEach((_, k) => { const [exchange, symbol, tf] = k.split('|'); ws.send(JSON.stringify({ op: 'sub', exchange, symbol, tf })) }) };
  ws.onmessage = e => { const m = JSON.parse(e.data); remoteSubs.get(`${m.exchange}|${m.symbol}|${m.tf}`)?.forEach(f => f(m.bar)) };
  ws.onclose = () => { if (remoteWs === ws) { remoteWs = null; if (remoteSubs.size) { setTimeout(() => { try { remoteSocket() } catch {} }, remoteWait); remoteWait = Math.min(remoteWait * 2, 60_000) } } };
  return ws;
}
function streamRemote(sym: string, tf: string, onBar: (b: Bar) => void): () => void {
  const { exchange, symbol } = splitSym(sym), k = `${exchange}|${symbol}|${tf}`;
  const set = remoteSubs.get(k) ?? new Set();
  remoteSubs.set(k, set); set.add(onBar);
  let ws: WebSocket;
  try { ws = remoteSocket() } catch { remoteSubs.delete(k); return () => {} }   // standalone / no server: nothing to stream
  if (set.size === 1 && ws.readyState === 1) ws.send(JSON.stringify({ op: 'sub', exchange, symbol, tf }));
  return () => {
    set.delete(onBar);
    if (!set.size) { remoteSubs.delete(k); if (remoteWs?.readyState === 1) remoteWs.send(JSON.stringify({ op: 'unsub', exchange, symbol, tf })) }
  };
}

async function fetchNative(symbol: string, tf: string, endTime?: number): Promise<Bar[]> {
  const q = new URLSearchParams({ symbol, interval: tf, limit: '1000' });
  if (endTime) q.set('endTime', String(endTime));
  const r = await fetch(`${API}/klines?${q}`);
  const j = await r.json();
  if (!r.ok) throw Error(j.msg || String(r.status));
  return j.map(k2bar);
}
export async function fetchBars(symbol: string, tf: string, endTime?: number): Promise<Bar[]> {
  for (const h of barHooks) { const r = h.fetch(symbol, tf, endTime); if (r) return r }
  if (isRemote(symbol)) return fetchRemote(symbol, tf, endTime);
  if (symbol.startsWith('BINANCE:')) symbol = symbol.slice(8);
  const { base, n } = baseOf(tf);
  if (n === 1) return fetchNative(symbol, tf, endTime);
  const raw = await fetchNative(symbol, base, endTime);
  const out = aggregate(raw, tfSeconds(tf));
  return out.length > 1 && raw[0].time !== out[0].time ? out.slice(1) : out; // drop a partial first bucket
}

/** Live kline stream with auto-reconnect. Returns an unsubscribe function. */
export function streamBars(symbol: string, tf: string, onBar: (b: Bar) => void): () => void {
  for (const h of barHooks) { const r = h.stream(symbol, tf, onBar); if (r) return r }
  if (isRemote(symbol)) return streamRemote(symbol, tf, onBar);
  if (symbol.startsWith('BINANCE:')) symbol = symbol.slice(8);
  const { base, n } = baseOf(tf), sec = tfSeconds(tf);
  let parts = new Map<number, Bar>(), cur = -1;
  const emit = n === 1 ? onBar : (b: Bar) => {
    const t = bucket(b.time, sec);
    if (t !== cur) { cur = t; parts = new Map() }
    parts.set(b.time, b);
    const ps = [...parts.values()].sort((x, y) => x.time - y.time);
    onBar({ time: t, open: ps[0].open, high: Math.max(...ps.map(p => p.high)), low: Math.min(...ps.map(p => p.low)), close: ps.at(-1)!.close, volume: ps.reduce((a, p) => a + p.volume, 0) });
  };
  let sock: WebSocket | null = null, alive = true;
  const connect = () => {
    sock = new WebSocket(`${WS}/ws/${symbol.toLowerCase()}@kline_${base}`);
    sock.onmessage = e => {
      const k = JSON.parse(e.data).k;
      emit({ time: k.t / 1000, open: +k.o, high: +k.h, low: +k.l, close: +k.c, volume: +k.v });
    };
    sock.onclose = () => { if (alive) setTimeout(() => alive && connect(), 3000) };
  };
  connect();
  return () => { alive = false; sock?.close() };
}

export interface Ticker { c: number; o: number }
/** 24h mini-ticker for many symbols on one socket. Call again with a new list to resubscribe. */
export function streamTickers(symbols: string[], onTick: (sym: string, t: Ticker) => void): () => void {
  let sock: WebSocket | null = null, alive = true;
  const connect = () => {
    if (!symbols.length) return;
    sock = new WebSocket(`${WS}/stream?streams=` + symbols.map(s => s.toLowerCase() + '@miniTicker').join('/'));
    sock.onmessage = e => { const d = JSON.parse(e.data).data; if (d) onTick(d.s, { c: +d.c, o: +d.o }) };
    sock.onclose = () => { if (alive) setTimeout(() => alive && connect(), 3000) };
  };
  connect();
  return () => { alive = false; sock?.close() };
}

export interface Ticker24 { s: string; c: number; ch: number; qv: number }
export async function fetch24h(): Promise<Ticker24[]> {
  const all = await (await fetch(`${API}/ticker/24hr`)).json();
  return all
    .filter((t: { symbol: string; quoteVolume: string }) => t.symbol.endsWith('USDT') && +t.quoteVolume > 0)
    .map((t: { symbol: string; lastPrice: string; priceChangePercent: string; quoteVolume: string }) =>
      ({ s: t.symbol, c: +t.lastPrice, ch: +t.priceChangePercent, qv: +t.quoteVolume }));
}

export interface RemoteMarket { sym: string; base: string; quote: string; type: string; name?: string }
export const fetchExchanges = () => serverJson<{ id: string; name: string }[]>('/api/exchanges');
export const fetchMarkets = (exchange: string) => serverJson<RemoteMarket[]>(`/api/markets?exchange=${encodeURIComponent(exchange)}`);

export async function fetchSymbols(): Promise<string[]> {
  const all = await (await fetch(`${API}/ticker/price`)).json();
  return all.map((t: { symbol: string }) => t.symbol).filter((s: string) => s.endsWith('USDT'));
}
