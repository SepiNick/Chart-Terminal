// Derivatives data, pure parts shared by the server (normalising CCXT / exchange payloads) and the client
// (symbol mapping, aligning to chart bars, CVD spot vs perp, the estimated liquidation heatmap).
import { tfSeconds, type Bar } from '../data.ts';
import type { Print } from '../orderflow/model.ts';

export interface Pt { t: number; v: number }                        // t in seconds
export interface OIPt { t: number; oi: number; oiv: number | null }  // contracts (base units) and quote value
export interface Funding { rate: number; next: number | null; interval: string | null }   // next: ms
export interface Liq { t: number; long: boolean; qty: number; px: number; value: number } // long = a long position was liquidated
export interface DSym { ex: string; base: string; quote: string; spot: string; perp: string; ccxt: string }

const QUOTES = ['USDT', 'USDC', 'FDUSD', 'BUSD', 'USD'];
/**
 * Derivatives market for a chart symbol: the base asset's USDT/USDC-margined perpetual. Binance spot symbols map to
 * Binance USDⓈ-M futures; `EXCH:BASE_QUOTE[.P]` use that exchange. `spot`/`perp` are chart symbols for the trade feed.
 */
export function derivSym(sym: string, ex?: string): DSym | null {
  if (/[/*+\-()\s]/.test(sym)) return null;
  const i = sym.indexOf(':'), chartEx = i > 0 ? sym.slice(0, i).toLowerCase() : 'binance', pair = i > 0 ? sym.slice(i + 1) : sym;
  if (chartEx === 'fx') return null;
  let base: string, quote: string;
  const m = pair.match(/^([A-Z0-9]+)_([A-Z0-9]+)/);
  if (m) [base, quote] = [m[1], m[2]];
  else {
    const q = QUOTES.find(q => pair.endsWith(q) && pair.length > q.length); if (!q) return null;
    [base, quote] = [pair.slice(0, -q.length), q];
  }
  if (quote !== 'USDC') quote = 'USDT';
  const x = ex || (chartEx === 'binance' || chartEx === 'binanceusdm' ? 'binanceusdm' : chartEx);
  return {
    ex: x, base, quote, ccxt: `${base}/${quote}:${quote}`,
    spot: x === 'binanceusdm' ? `BINANCE:${base}${quote}` : `${x.toUpperCase()}:${base}_${quote}`,
    perp: `${x.toUpperCase()}:${base}_${quote}.P`,
  };
}

/** History periods both Binance and Bybit serve; the largest one that fits in a chart bar. */
const PERIODS = ['5m', '15m', '30m', '1h', '4h', '1d'];
export const periodFor = (tfSec: number) => [...PERIODS].reverse().find(p => tfSeconds(p) <= tfSec) ?? '5m';

// ---------- payload normalisation (CCXT unified structures; `info` is the exchange's raw row) ----------
const num = (x: unknown) => (x == null || x === '' ? NaN : +x);
const byT = <T extends { t: number }>(a: T[]) => a.filter(x => Number.isFinite(x.t)).sort((x, y) => x.t - y.t);

type CcxtOI = { timestamp?: number; openInterestAmount?: number; openInterestValue?: number; baseVolume?: number; quoteVolume?: number };
export const normOI = (rows: CcxtOI[]): OIPt[] => byT(rows.flatMap(r => {
  const oi = num(r.openInterestAmount ?? r.baseVolume), oiv = num(r.openInterestValue ?? r.quoteVolume);
  return Number.isFinite(oi) ? [{ t: num(r.timestamp) / 1000, oi, oiv: Number.isFinite(oiv) ? oiv : null }] : [];
}));

/** CCXT long/short history and Binance's raw top-trader rows share `timestamp` + `longShortRatio` (numbers or strings). */
export const normRatio = (rows: { timestamp?: number | string; longShortRatio?: number | string }[]): Pt[] =>
  byT(rows.flatMap(r => { const v = num(r.longShortRatio); return Number.isFinite(v) ? [{ t: num(r.timestamp) / 1000, v }] : [] }));

export const normFundingHist = (rows: { timestamp?: number; fundingRate?: number }[]): Pt[] =>
  byT(rows.flatMap(r => { const v = num(r.fundingRate); return Number.isFinite(v) ? [{ t: num(r.timestamp) / 1000, v }] : [] }));

export function normFunding(r: { fundingRate?: number; nextFundingTimestamp?: number; fundingTimestamp?: number; interval?: string }): Funding {
  const next = num(r.nextFundingTimestamp ?? r.fundingTimestamp);
  return { rate: num(r.fundingRate), next: Number.isFinite(next) && next > 0 ? next : null, interval: r.interval ?? null };
}

type CcxtLiq = { timestamp?: number; price?: number; contracts?: number; contractSize?: number; side?: string; baseValue?: number; quoteValue?: number };
/**
 * Exchanges report the side differently: Binance/OKX give the liquidation *order* side (a SELL closes a long),
 * Bybit's allLiquidation gives the *position* side (Buy = a long was liquidated).
 */
export function normLiq(ex: string, r: CcxtLiq): Liq | null {
  const px = num(r.price), side = String(r.side ?? '').toLowerCase();
  const qty = Number.isFinite(num(r.baseValue)) ? num(r.baseValue) : num(r.contracts) * (Number.isFinite(num(r.contractSize)) ? num(r.contractSize) : 1);
  if (!(px > 0) || !(qty > 0) || (side !== 'buy' && side !== 'sell')) return null;
  const value = num(r.quoteValue) > 0 ? num(r.quoteValue) : qty * px;
  return { t: num(r.timestamp) / 1000, long: ex === 'bybit' ? side === 'buy' : side === 'sell', qty, px, value };
}

// ---------- aligning to chart bars ----------
/** Index of the bar containing time t (last bar time ≤ t), -1 before the first bar. */
export function barIndex(times: number[], t: number): number {
  let lo = 0, hi = times.length - 1, r = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (times[m] <= t) { r = m; lo = m + 1 } else hi = m - 1 }
  return r;
}
/** Last point in each bar, keyed by bar time. */
export function align<T extends { t: number }>(pts: T[], times: number[]): Map<number, T> {
  const out = new Map<number, T>();
  for (const p of pts) { const i = barIndex(times, p.t); if (i >= 0) out.set(times[i], p) }
  return out;
}

// ---------- CVD spot vs perp ----------
/** Adds each print's signed size (buy − sell) to its bar. */
export function addDeltas(into: Map<number, number>, prints: Print[], times: number[]) {
  for (const p of prints) { const i = barIndex(times, p.t); if (i >= 0) into.set(times[i], (into.get(times[i]) ?? 0) + (p.buy ? p.qty : -p.qty)) }
}
/** Cumulative delta per bar from bar time `from` on (both lines start at 0 at the same bar so they compare). */
export function cvdLine(deltas: Map<number, number>, times: number[], from: number): { time: number; value: number }[] {
  let c = 0;
  const out: { time: number; value: number }[] = [];
  for (const t of times) if (t >= from) { c += deltas.get(t) ?? 0; out.push({ time: t, value: c }) }
  return out;
}

// ---------- estimated liquidation heatmap ----------
export interface Level { t0: number; t1: number | null; px: number; long: boolean; size: number }   // size: quote notional
export const TIERS: [number, number][] = [[5, 0.25], [10, 0.3], [25, 0.25], [50, 0.12], [100, 0.08]];
/**
 * ESTIMATE, not exchange data. Model:
 *  - When open interest rises between two bars, the new contracts ΔOI were opened around that bar's typical price
 *    p = (H+L+C)/3, half by longs and half by shorts, spread over typical leverage tiers L with weights w (TIERS).
 *  - Isolated-margin liquidation price with maintenance margin rate m: long ≈ p·(1 − 1/L + m), short ≈ p·(1 + 1/L − m).
 *    Each tier adds ΔOI·p·w/2 of notional to the level at that price (snapped to `bin`).
 *  - When open interest falls, every open level shrinks by the same fraction (positions closed, side unknown).
 *  - A level is consumed (its segment ends) once a later bar trades through it: low ≤ long level, high ≥ short level.
 * Ignores cross margin, partial liquidations, funding and the real leverage mix; good for "where might stops cluster".
 */
export function liqLevels(bars: Bar[], oi: Map<number, OIPt>, bin: number, m = 0.005, tiers = TIERS): Level[] {
  const open = new Map<string, Level>(), done: Level[] = [];
  let prev: number | null = null;
  for (const b of bars) {
    for (const [k, l] of open) if (l.long ? b.low <= l.px : b.high >= l.px) { l.t1 = b.time; done.push(l); open.delete(k) }
    const cur = oi.get(b.time)?.oi;
    if (cur == null) continue;
    if (prev != null && prev > 0) {
      const d = cur - prev, p = (b.high + b.low + b.close) / 3;
      if (d < 0) for (const l of open.values()) l.size *= Math.max(0, 1 + d / prev);
      else if (d > 0) for (const [L, w] of tiers) for (const long of [true, false]) {
        const px = Math.round(p * (long ? 1 - 1 / L + m : 1 + 1 / L - m) / bin) * bin, k = `${long ? 'L' : 'S'}${px}`;
        const l = open.get(k) ?? { t0: b.time, t1: null, px, long, size: 0 };
        l.size += (d * p * w) / 2; open.set(k, l);
      }
    }
    prev = cur;
  }
  return [...done, ...open.values()];
}
/** A round price step near 0.1 % of the price. */
export function niceBin(price: number): number {
  const raw = price * 0.001, p = 10 ** Math.floor(Math.log10(raw)), n = raw / p;
  return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * p;
}
