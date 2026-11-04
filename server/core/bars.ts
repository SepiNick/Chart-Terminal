// Candles for server-side work (alerts, forward tests): the same symbol scheme as the app.
// Plain symbols (BTCUSDT, BINANCE:BTCUSDT) use Binance's public mirror via src/data.ts (fetch + global WebSocket);
// EXCH:SYMBOL uses CCXT / Yahoo through market.ts. Symbol expressions (BTCUSDT/ETHUSDT) are not supported server-side.
import { fetchBars as fetchBinance, isRemote, splitSym, streamBars as streamBinance, type Bar } from '../../src/data.ts';
import { bars as remoteBars, startFeed } from '../market.ts';

export type { Bar };
export const isExprSym = (s: string) => /[/*+\-()]/.test(s.replace(/^[A-Z0-9]+:/, ''));

/** Up to ~1000 most recent bars. */
export async function fetchBars(sym: string, tf: string): Promise<Bar[]> {
  if (isExprSym(sym)) throw Error('Symbol expressions are not supported on the server');
  if (!isRemote(sym)) return fetchBinance(sym, tf);
  const { exchange, symbol } = splitSym(sym);
  return (await remoteBars(exchange, symbol, tf)).bars;
}
/** Live updates of the current (and each new) bar. Returns an unsubscribe function. */
export function streamBars(sym: string, tf: string, onBar: (b: Bar) => void): () => void {
  if (!isRemote(sym)) return streamBinance(sym, tf, onBar);
  const { exchange, symbol } = splitSym(sym);
  return startFeed(exchange, symbol, tf, onBar);
}

/**
 * Keeps a rolling bar series per (symbol, tf) shared by every server consumer: history once, then live updates.
 * `onUpdate(bars, closed)` gets the whole array; `closed` is true when the previous bar just closed (a new bar began).
 */
const series = new Map<string, { bars: Bar[]; subs: Set<(b: Bar[], closed: boolean) => void>; stop: () => void; ready: Promise<void>; dead: boolean }>();
/** Swappable for tests (no network). */
export const deps = { fetchBars, streamBars };
export function watchSeries(sym: string, tf: string, onUpdate: (bars: Bar[], closed: boolean) => void): () => void {
  const k = `${sym}|${tf}`;
  let s = series.get(k);
  if (!s) {
    const entry = { bars: [] as Bar[], subs: new Set<(b: Bar[], closed: boolean) => void>(), stop: () => {}, ready: Promise.resolve(), dead: false };
    // Exchanges answer blocks with whole HTML pages: keep the log to one short line.
    entry.ready = deps.fetchBars(sym, tf).then(b => { entry.bars = b.slice(-1500) }).catch(e => console.error(`[bars] ${k}: ${(e as Error).message.replace(/\s+/g, ' ').slice(0, 200)}`)).then(() => {
      if (entry.dead) return;   // everyone left before the history arrived: no feed or socket may start now
      entry.stop = deps.streamBars(sym, tf, b => {
        const last = entry.bars.at(-1);
        if (last && b.time < last.time) return;
        const closed = !!last && b.time > last.time;
        if (last && b.time === last.time) entry.bars[entry.bars.length - 1] = b; else { entry.bars.push(b); if (entry.bars.length > 2000) entry.bars.splice(0, 500) }
        entry.subs.forEach(f => f(entry.bars, closed));
      });
    });
    series.set(k, (s = entry));
  }
  s.subs.add(onUpdate);
  s.ready.then(() => { if (s!.subs.has(onUpdate) && s!.bars.length) onUpdate(s!.bars, false) });
  return () => { s!.subs.delete(onUpdate); if (!s!.subs.size) { s!.dead = true; s!.stop(); if (series.get(k) === s) series.delete(k) } };
}
