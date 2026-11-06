// Crypto market series (CRYPTOCAP:BTC.D, CRYPTOCAP:TOTAL, ...) as one more local source next to fx / mt5 / the Iranian
// ones. Fixed hosts only (CoinGecko, Binance's public mirror); a symbol must be in the built-in table. Safe in public
// mode: one shared cache and request budget per process, and no recorder there (record.ts is imported by app.ts in
// private mode only). Imports no database, so check.ts can use it.
import { fetchBars } from '../../src/data.ts';
import { APPROX_NOTE, DOM_EX, DOM_SYMS } from '../../src/market/dominance.ts';
import { createDominance, type DomStore } from '../../src/market/domsource.ts';
import { deps as http } from '../iran/http.ts';
import type { IranSource, MarketRow } from '../iran/index.ts';

export const io = {
  fetch: (url: string, init?: RequestInit) => http.fetch(url, init),
  now: () => http.now(),
  sleep: (ms: number) => http.sleep(ms),
  candles: (pair: string, tf: string, until?: number) => fetchBars(pair, tf, until),
};
export const dom = createDominance({ fetch: (u, i) => io.fetch(u, i), now: () => io.now(), sleep: ms => io.sleep(ms), candles: (p, tf, u) => io.candles(p, tf, u) });

/** Set by record.ts when the recorder runs (private mode). */
let store: DomStore | null = null;
export const setStore = (s: DomStore | null) => { store = s };

export interface DomRow extends MarketRow { approxUntil: number | null; stale: boolean; note: string }
function markets(): DomRow[] {
  const first = store?.first() ?? null, stale = dom.status().stale;
  return DOM_SYMS.map(s => ({
    sym: s.sym, base: s.sym, quote: '', type: s.kind, name: s.name, stale,
    // Bars before this time (seconds) are approximations; null = the whole history is.
    approxUntil: first ? first.t : null,
    note: first ? `${APPROX_NOTE} before ${new Date(first.t * 1000).toISOString().slice(0, 10)}, recorded after` : APPROX_NOTE,
  }));
}

const source: IranSource = {
  id: DOM_EX, name: 'Crypto market', every: 60_000, weekAnchor: 345600,
  bars: async (sym, tf, until, limit) => { const r = await dom.bars(sym, tf, until, limit, store); return { bars: r.bars, base: r.base } },
  markets,
};
export const DOMINANCE: Record<string, IranSource> = { [DOM_EX]: source };
