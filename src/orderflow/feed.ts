// Live trades and order book. Binance symbols talk to Binance's public mirror directly (CORS-enabled);
// EXCH:SYMBOL symbols go through the local data server (CCXT). FX symbols have no order flow.
import { isRemote, serverJson, splitSym } from '../data.ts';
import { serverSocket as openSocket } from '../servers.ts';
import type { BookSnap, Print } from './model.ts';
import { api, serverMode } from '../sync.ts';

const API = 'https://data-api.binance.vision/api/v3', WS = 'wss://data-stream.binance.vision';
const bin = (s: string) => s.replace(/^BINANCE:/, '');
export const hasOrderFlow = (sym: string) => !/^FX:/.test(sym) && !/[/*+\-()]/.test(sym);
type Agg = { p: string; q: string; T: number; m: boolean; a: number };
const fromAgg = (x: Agg): Print => ({ t: x.T / 1000, px: +x.p, qty: +x.q, buy: !x.m });   // m = buyer is maker → seller was aggressive

/**
 * Recent history, newest last. Binance pages backwards by trade id up to `pages` × 1000 prints; other exchanges give one page.
 * In server mode the first load starts from the server's trade recording (when it records this symbol) and only the gap
 * after the recording's last print comes from the exchange.
 */
export async function fetchPrints(sym: string, pages = 20, onProgress?: (n: number) => void, beforeId?: number): Promise<{ prints: Print[]; firstId?: number }> {
  if (serverMode && beforeId == null) {
    const rec = await api<(Print & { id?: number })[]>(`/api/recorder/trades?${new URLSearchParams({ sym })}`).catch(() => []);
    if (rec.length) {
      onProgress?.(rec.length);
      const last = rec.at(-1)!.t, gap = await exchangePrints(sym, pages, n => onProgress?.(rec.length + n), undefined, last);
      // A gap the exchange can't cover (recorder was down too long) would leave a hole: use the exchange alone then.
      if (!gap.reached) return gap;
      return { prints: [...rec.map(({ t, px, qty, buy }) => ({ t, px, qty, buy })), ...gap.prints.filter(p => p.t > last)], firstId: rec[0].id ?? gap.firstId };
    }
  }
  return exchangePrints(sym, pages, onProgress, beforeId);
}
/** `after` (seconds): stop paging once a print at or before it is reached; `reached` says whether it was. */
async function exchangePrints(sym: string, pages: number, onProgress?: (n: number) => void, beforeId?: number, after?: number): Promise<{ prints: Print[]; firstId?: number; reached: boolean }> {
  if (isRemote(sym)) {
    const { exchange, symbol } = splitSym(sym);
    const prints = await serverJson<Print[]>(`/api/trades?${new URLSearchParams({ exchange, symbol })}`);
    return { prints, reached: after == null || (prints[0]?.t ?? Infinity) <= after };
  }
  const out: Agg[][] = [];
  let fromId = beforeId, reached = false;
  for (let i = 0; i < pages && !reached; i++) {
    const q = new URLSearchParams({ symbol: bin(sym), limit: '1000' });
    if (fromId != null) q.set('fromId', String(Math.max(0, fromId - 1000)));
    const r = await fetch(`${API}/aggTrades?${q}`);
    if (!r.ok) throw Error(`aggTrades ${r.status}`);
    let rows = (await r.json()) as Agg[];
    if (fromId != null) rows = rows.filter(x => x.a < fromId!);
    if (!rows.length) break;
    out.unshift(rows); fromId = rows[0].a;
    if (after != null && rows[0].T / 1000 <= after) reached = true;
    onProgress?.(out.reduce((a, x) => a + x.length, 0));
    if (fromId <= 0) break;
  }
  return { prints: out.flat().map(fromAgg), firstId: fromId, reached: reached || after == null };
}

// ---------- shared subscriptions (one socket per symbol and kind, many listeners) ----------
type Kind = 'trades' | 'book';
interface Sub { listeners: Set<(x: never) => void>; stop: () => void }
const subs = new Map<string, Sub>();
function shared<T>(kind: Kind, sym: string, fn: (x: T) => void, start: (emit: (x: T) => void) => () => void): () => void {
  const k = `${kind}|${sym}`;
  let s = subs.get(k);
  if (!s) {
    const listeners = new Set<(x: never) => void>();
    s = { listeners, stop: start(x => listeners.forEach(l => (l as (x: T) => void)(x))) };
    subs.set(k, s);
  }
  s.listeners.add(fn as (x: never) => void);
  return () => { s!.listeners.delete(fn as (x: never) => void); if (!s!.listeners.size) { s!.stop(); subs.delete(k) } };
}
function socket(url: string, onMsg: (d: unknown) => void, onOpen?: () => void): () => void {
  let ws: WebSocket | null = null, alive = true;
  const connect = () => {
    ws = new WebSocket(url);
    ws.onopen = () => onOpen?.();
    ws.onmessage = e => onMsg(JSON.parse(e.data));
    ws.onclose = () => { if (alive) setTimeout(() => alive && connect(), 3000) };
  };
  connect();
  return () => { alive = false; ws?.close() };
}

/** Live prints, batched (one callback per socket message). */
export function streamPrints(sym: string, onPrints: (ps: Print[]) => void): () => void {
  return shared<Print[]>('trades', sym, onPrints, emit => {
    if (isRemote(sym)) return remote('trades', sym, d => emit(d as Print[]));
    return socket(`${WS}/ws/${bin(sym).toLowerCase()}@aggTrade`, d => emit([fromAgg(d as Agg)]));
  });
}

/** Full local order book, emitted at most every `ms`. */
export function streamBook(sym: string, onBook: (b: BookSnap) => void, ms = 250): () => void {
  return shared<BookSnap>('book', sym, onBook, emit => {
    if (isRemote(sym)) return remote('book', sym, d => emit(d as BookSnap));
    return binanceBook(bin(sym), emit, ms);
  });
}

/**
 * Binance's documented local-book algorithm: buffer the diff stream, take a REST snapshot, drop diffs it already contains,
 * then apply the rest in order; any gap in update ids → resync.
 */
function binanceBook(symbol: string, emit: (b: BookSnap) => void, ms: number): () => void {
  type Diff = { U: number; u: number; b: [string, string][]; a: [string, string][] };
  const bids = new Map<number, number>(), asks = new Map<number, number>();
  let last = 0, ready = false, buffer: Diff[] = [], lastEmit = 0, syncing = false;
  const apply = (side: Map<number, number>, rows: [string, string][]) => { for (const [p, q] of rows) { if (+q === 0) side.delete(+p); else side.set(+p, +q) } };
  const sync = async () => {
    if (syncing) return;
    syncing = true; ready = false;
    try {
      const r = await fetch(`${API}/depth?symbol=${symbol}&limit=5000`);
      const s = await r.json() as { lastUpdateId: number; bids: [string, string][]; asks: [string, string][] };
      bids.clear(); asks.clear(); apply(bids, s.bids); apply(asks, s.asks); last = s.lastUpdateId;
      const pending = buffer.filter(d => d.u > last); buffer = [];
      ready = true;
      for (const d of pending) onDiff(d);
    } catch { setTimeout(sync, 3000) } finally { syncing = false }
  };
  const onDiff = (d: Diff) => {
    if (!ready) { buffer.push(d); if (buffer.length > 2000) buffer.shift(); return }
    if (d.u <= last) return;
    if (d.U > last + 1) { buffer = [d]; sync(); return }   // missed an update
    apply(bids, d.b); apply(asks, d.a); last = d.u;
    const now = performance.now();
    if (now - lastEmit >= ms) {
      lastEmit = now;
      const b = [...bids].sort((x, y) => y[0] - x[0]), a = [...asks].sort((x, y) => x[0] - y[0]);
      // Drop crossed levels a lagging diff can leave behind.
      emit({ t: Date.now() / 1000, bids: a.length ? b.filter(x => x[0] < a[0][0]) : b, asks: b.length ? a.filter(x => x[0] > b[0][0]) : a });
    }
  };
  const stop = socket(`${WS}/ws/${symbol.toLowerCase()}@depth@100ms`, d => onDiff(d as Diff), () => { buffer = []; sync() });
  return stop;
}

// ---------- remote (local data server) ----------
const remoteSubs = new Map<string, (d: unknown) => void>();
let ws: WebSocket | null = null;
function serverSocket() {
  if (ws && ws.readyState <= 1) return ws;
  const s = openSocket('/ws');
  ws = s;
  s.onopen = () => remoteSubs.forEach((_, k) => { const [kind, exchange, symbol] = k.split('|'); s.send(JSON.stringify({ op: 'sub', kind, exchange, symbol })) });
  s.onmessage = e => { const m = JSON.parse(e.data); if (m.kind) remoteSubs.get(`${m.kind}|${m.exchange}|${m.symbol}`)?.(m.data) };
  s.onclose = () => { if (ws === s) { ws = null; if (remoteSubs.size) setTimeout(serverSocket, 3000) } };
  return s;
}
function remote(kind: Kind, sym: string, on: (d: unknown) => void): () => void {
  const { exchange, symbol } = splitSym(sym), k = `${kind}|${exchange}|${symbol}`;
  remoteSubs.set(k, on);
  const s = serverSocket();
  if (s.readyState === 1) s.send(JSON.stringify({ op: 'sub', kind, exchange, symbol }));
  return () => { remoteSubs.delete(k); if (ws?.readyState === 1) ws.send(JSON.stringify({ op: 'unsub', kind, exchange, symbol })) };
}
