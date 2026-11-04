// Crypto data for every CCXT exchange. Symbols use EXCH:BASE_QUOTE (spot) and EXCH:BASE_QUOTE.P (perpetual)
// so they stay free of characters the chart's spread-expression parser treats as operators.
import { ccxtLib, EXCHANGE_IDS } from './ccxtlib.ts';
import { tfSeconds } from '../src/data.ts';
import type { Bar } from '../src/data.ts';

// The package's default export shape differs between its CJS and ESM builds.
type Exchange = InstanceType<ReturnType<typeof ccxtLib>['Exchange']>;
export interface Market { sym: string; ccxt: string; base: string; quote: string; type: string; active: boolean }

const rest = new Map<string, Exchange>(), pro = new Map<string, Exchange>();
const marketCache = new Map<string, { at: number; list: Market[]; map: Map<string, Market> }>();

export const exchangeIds = (): string[] => [...EXCHANGE_IDS];
export const isExchange = (id: string) => EXCHANGE_IDS.includes(id);

function restOf(id: string): Exchange {
  let x = rest.get(id);
  if (!x) { x = new (ccxtLib() as unknown as Record<string, new (o: object) => Exchange>)[id]({ enableRateLimit: true, timeout: 15000 }); rest.set(id, x) }
  return x;
}
function proOf(id: string): Exchange | null {
  const P = (ccxtLib().pro as unknown as Record<string, (new (o: object) => Exchange) | undefined>)[id];
  if (!P) return null;
  let x = pro.get(id);
  if (!x) { x = new P({ enableRateLimit: true }); pro.set(id, x) }
  return x;
}

/** Our symbol for a CCXT market (null for options and other kinds we don't chart). */
export function symOf(m: { base: string; quote: string; type?: string; settle?: string; expiry?: number }): string | null {
  const clean = (s: string) => s.replace(/[^A-Z0-9]/gi, '').toUpperCase();
  const pair = `${clean(m.base)}_${clean(m.quote)}`;
  if (m.type === 'spot') return pair;
  if (m.type === 'swap') return `${pair}.P${m.settle && clean(m.settle) !== clean(m.quote) ? clean(m.settle) : ''}`;
  if (m.type === 'future' && m.expiry) return `${pair}.F${new Date(m.expiry).toISOString().slice(2, 10).replace(/-/g, '')}`;
  return null;
}

export async function markets(id: string): Promise<{ list: Market[]; map: Map<string, Market> }> {
  const c = marketCache.get(id);
  if (c && Date.now() - c.at < 3600_000) return c;
  const x = restOf(id);
  const ms = await x.loadMarkets();
  const list: Market[] = [], map = new Map<string, Market>();
  for (const m of Object.values(ms)) {
    if (!m) continue;
    const sym = symOf(m as never);
    if (!sym || map.has(sym)) continue;
    const mk = { sym, ccxt: m.symbol, base: m.base, quote: m.quote, type: m.type ?? 'spot', active: m.active !== false };
    list.push(mk); map.set(sym, mk);
  }
  const entry = { at: Date.now(), list, map };
  marketCache.set(id, entry);
  if (marketCache.size > 12) marketCache.delete(marketCache.keys().next().value!);   // one big market list per exchange
  return entry;
}
async function resolve(id: string, sym: string): Promise<{ x: Exchange; m: Market }> {
  const { map } = await markets(id);
  const m = map.get(sym);
  if (!m) throw Error(`Unknown market ${id}:${sym}`);
  return { x: restOf(id), m };
}

/** The exchange's largest native timeframe that evenly divides `tf` (months excluded from division). */
export function nativeBase(supported: string[], tf: string): { base: string; n: number } | null {
  if (supported.includes(tf)) return { base: tf, n: 1 };
  const sec = tfSeconds(tf);
  const ok = supported.filter(s => /^\d+[smhdwM]$/.test(s) && !s.endsWith('M') && sec % tfSeconds(s) === 0).sort((a, b) => tfSeconds(b) - tfSeconds(a));
  return ok.length ? { base: ok[0], n: sec / tfSeconds(ok[0]) } : null;
}
const row2bar = (r: (number | undefined)[]): Bar => ({ time: (r[0] as number) / 1000, open: r[1] as number, high: r[2] as number, low: r[3] as number, close: r[4] as number, volume: (r[5] as number) ?? 0 });

export async function ohlcv(id: string, sym: string, tf: string, until?: number, limit = 1000): Promise<{ bars: Bar[]; base: string }> {
  const { x, m } = await resolve(id, sym);
  if (!x.has.fetchOHLCV) throw Error(`${id} does not provide candles`);
  const nb = nativeBase(Object.keys(x.timeframes ?? {}), tf);
  if (!nb) throw Error(`${id} has no timeframe compatible with ${tf}`);
  const want = Math.min(1500, limit * nb.n);
  const span = want * tfSeconds(nb.base) * 1000;
  const since = until ? until - span : undefined;
  if (!until) return { bars: (await x.fetchOHLCV(m.ccxt, nb.base, undefined, Math.min(want, 1000))).map(r => row2bar(r as never)), base: nb.base };
  // Exchanges cap candles per request (OKX: 300) and page forward from `since`, so walk pages until `until`.
  const step = tfSeconds(nb.base) * 1000, bars: Bar[] = [];
  let from = since!;
  for (let page = 0; page < 8 && from < until; page++) {
    const rows = await x.fetchOHLCV(m.ccxt, nb.base, from, Math.min(want, 1000));
    if (!rows.length) break;
    for (const r of rows) { const b = row2bar(r as never); if (b.time * 1000 <= until && (!bars.length || b.time > bars.at(-1)!.time)) bars.push(b) }
    const next = (rows.at(-1)![0] as number) + step;
    if (next <= from) break;
    from = next;
  }
  return { bars, base: nb.base };
}

/** Live candles: WebSocket watchOHLCV where the exchange supports it, REST polling otherwise. */
export function watch(id: string, sym: string, base: string, onBar: (b: Bar) => void): () => void {
  let alive = true;
  (async () => {
    const { m } = await resolve(id, sym);
    const p = proOf(id);
    if (p?.has.watchOHLCV) {
      while (alive) {
        try { const rows = await p.watchOHLCV(m.ccxt, base); if (alive) for (const r of rows.slice(-2)) onBar(row2bar(r as never)) }
        catch { await new Promise(r => setTimeout(r, 3000)) }
      }
      return;
    }
    const x = restOf(id);
    while (alive) {
      try { const rows = await x.fetchOHLCV(m.ccxt, base, undefined, 2); if (alive) for (const r of rows) onBar(row2bar(r as never)) } catch {}
      await new Promise(r => setTimeout(r, 3000));
    }
  })().catch(() => {});
  return () => { alive = false };
}

export async function tickers(id: string): Promise<{ sym: string; last: number; change: number; quoteVolume: number }[]> {
  const x = restOf(id);
  if (!x.has.fetchTickers) return [];
  const { list } = await markets(id);
  const byCcxt = new Map(list.map(m => [m.ccxt, m.sym]));
  const t = await x.fetchTickers();
  return Object.values(t).flatMap(k => { const sym = k.symbol ? byCcxt.get(k.symbol) : undefined; return sym && k.last ? [{ sym, last: k.last, change: k.percentage ?? 0, quoteVolume: k.quoteVolume ?? 0 }] : [] });
}

// ---------- order flow: prints and order book ----------
export interface Print { t: number; px: number; qty: number; buy: boolean }
type CcxtTrade = { timestamp?: number; price?: number; amount?: number; side?: string };
const toPrint = (x: CcxtTrade): Print | null => (x.timestamp && x.price && x.amount ? { t: x.timestamp / 1000, px: x.price, qty: x.amount, buy: x.side === 'buy' } : null);

/** Latest public trades (one page; most exchanges cannot page further back without keys). */
export async function trades(id: string, sym: string): Promise<Print[]> {
  const { x, m } = await resolve(id, sym);
  if (!x.has.fetchTrades) throw Error(`${id} does not provide trades`);
  return (await x.fetchTrades(m.ccxt, undefined, 1000)).map(r => toPrint(r as CcxtTrade)).filter((p): p is Print => !!p).sort((a, b) => a.t - b.t);
}

type CcxtTradeId = CcxtTrade & { id?: string };
/**
 * Keeps prints new and in order across overlapping fetches: CCXT trades have no sequence number, so a print counts
 * as seen when it is older than the newest timestamp, or has that timestamp and an id (or price/size) already passed on.
 */
export function printFilter(seen: number) {
  let edge = new Set<string>();
  return (rows: CcxtTradeId[]): Print[] => {
    const out: Print[] = [];
    for (const r of [...rows].sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0))) {
      const p = toPrint(r); if (!p) continue;
      const ms = r.timestamp!, key = r.id ?? `${p.px}|${p.qty}|${p.buy}`;
      if (ms < seen || (ms === seen && edge.has(key))) continue;
      if (ms > seen) { seen = ms; edge = new Set() }
      edge.add(key); out.push(p);
    }
    return out;
  };
}

/**
 * Live prints: watchTrades over WebSocket, else poll fetchTrades. With `since` (ms), and after every WebSocket error,
 * first pages fetchTrades from the last print seen so a restart or disconnect leaves no hole (where the exchange allows it).
 */
export function watchPrints(id: string, sym: string, on: (ps: Print[]) => void, since?: number): () => void {
  let alive = true;
  (async () => {
    const { x, m } = await resolve(id, sym);
    const p = proOf(id);
    // +1 ms: the last recorded print itself must not come back (one at that same ms could be missed instead — rarer).
    let last = since != null ? since + 1 : Date.now();
    const filter = printFilter(last);
    const pass = (rows: unknown[]) => { const ps = filter(rows as CcxtTradeId[]); if (ps.length && alive) { last = Math.round(ps.at(-1)!.t * 1000); on(ps) } return ps.length };
    const backfill = async () => {
      if (!x.has.fetchTrades) return;
      // ponytail: capped at 50 pages; exchanges that ignore `since` only return their latest trades, so a long outage may still leave a hole.
      for (let i = 0; i < 50 && alive; i++) {
        try { if (!pass(await x.fetchTrades(m.ccxt, last, 1000))) break } catch { break }
      }
    };
    if (since != null) await backfill();
    if (p?.has.watchTrades) {
      while (alive) {
        try { pass(await p.watchTrades(m.ccxt)) }
        catch { await new Promise(r => setTimeout(r, 3000)); await backfill() }
      }
      return;
    }
    while (alive) {
      try { pass(await x.fetchTrades(m.ccxt, last, 500)) } catch {}
      await new Promise(r => setTimeout(r, 2000));
    }
  })().catch(() => {});
  return () => { alive = false };
}

/** Order book top `depth` levels per side, at most every `ms`. */
export function watchBook(id: string, sym: string, on: (b: { t: number; bids: [number, number][]; asks: [number, number][] }) => void, depth = 500, ms = 250): () => void {
  let alive = true;
  (async () => {
    const { x, m } = await resolve(id, sym);
    const p = proOf(id);
    const send = (ob: { bids: unknown[][]; asks: unknown[][] }) => on({ t: Date.now() / 1000, bids: ob.bids.slice(0, depth).map(l => [l[0] as number, l[1] as number]), asks: ob.asks.slice(0, depth).map(l => [l[0] as number, l[1] as number]) });
    if (p?.has.watchOrderBook) {
      let last = 0;
      while (alive) {
        try { const ob = await p.watchOrderBook(m.ccxt); if (alive && Date.now() - last >= ms) { last = Date.now(); send(ob as never) } }
        catch { await new Promise(r => setTimeout(r, 3000)) }
      }
      return;
    }
    while (alive) {
      try { send(await x.fetchOrderBook(m.ccxt, depth) as never) } catch {}
      await new Promise(r => setTimeout(r, 2000));
    }
  })().catch(() => {});
  return () => { alive = false };
}
