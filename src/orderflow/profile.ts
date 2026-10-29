// Session profiles, no DOM: TPO / market profile (letters per period) and session volume profile (from prints, or from
// candle volume spread over each candle's range where prints are missing).
import type { Bar } from '../data.ts';
import { binOf, valueArea, type FBar } from './model.ts';

/**
 * Session start for time `t`; sessions of a whole number of weeks start on Monday, others every day, at `off` seconds
 * after 00:00 UTC (e.g. 13.5 h for the New York cash open, 20.5 h for midnight in Tehran).
 */
export const sessionStart = (t: number, len: number, off = 0) => { const a = (len % 604800 === 0 ? 345600 : 0) + off; return Math.floor((t - a) / len) * len + a };
/** Split time-sorted bars into sessions of `len` seconds. */
export function sessions<T extends { time: number }>(bars: T[], len: number, off = 0): { start: number; bars: T[] }[] {
  const out: { start: number; bars: T[] }[] = [];
  for (const b of bars) {
    const s = sessionStart(b.time, len, off), last = out.at(-1);
    if (last?.start === s) last.bars.push(b); else out.push({ start: s, bars: [b] });
  }
  return out;
}

export const TPO_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
export interface Tpo {
  rows: Map<number, number[]>;   // bin → periods (0 = A) that traded there, ascending
  poc: number; vah: number; val: number;
  ibHi: number; ibLo: number;     // initial balance (first `ib` periods) as bins
  singles: number[];              // single prints: runs of ≥ 2 adjacent rows touched by one period only
  periods: number;
}
/**
 * TPO profile of one session: every bar marks the rows of its low–high range with its period's letter (`period` seconds
 * from `start`). Bars longer than a period mark only their first period.
 */
export function tpo(bars: Bar[], start: number, period: number, row: number, ib = 2): Tpo {
  const rows = new Map<number, number[]>();
  let ibHi = -Infinity, ibLo = Infinity, periods = 0;
  for (const b of bars) {
    const p = Math.max(0, Math.floor((b.time - start) / period)), lo = binOf(b.low, row), hi = binOf(b.high, row);
    periods = Math.max(periods, p + 1);
    if (p < ib) { ibHi = Math.max(ibHi, hi); ibLo = Math.min(ibLo, lo) }
    for (let k = lo; k <= hi; k++) { const r = rows.get(k) ?? []; if (r.at(-1) !== p) r.push(p); rows.set(k, r) }
  }
  const sorted = [...rows].sort((a, b) => a[0] - b[0]);
  const singles: number[] = [];
  for (let i = 0; i < sorted.length;) {
    let j = i;
    while (j < sorted.length && sorted[j][1].length === 1 && sorted[j][0] === sorted[i][0] + (j - i)) j++;
    if (j - i >= 2) for (let x = i; x < j; x++) singles.push(sorted[x][0]);
    i = Math.max(j, i + 1);
  }
  return { rows, ...valueArea(sorted.map(([k, r]) => [k, r.length])), ibHi, ibLo, singles, periods };
}

export interface VProfile { rows: Map<number, number>; poc: number; vah: number; val: number; total: number }
/**
 * Volume profile of a set of bars. A bar with complete footprint data (`fp.from` ≤ its start) contributes its traded
 * volume per price; any other bar spreads its candle volume evenly over the rows of its range.
 */
export function volumeProfile(bars: Bar[], row: number, fp?: { bars: Map<number, FBar>; row: number; from: number }): VProfile {
  const rows = new Map<number, number>(), add = (k: number, v: number) => rows.set(k, (rows.get(k) ?? 0) + v);
  for (const b of bars) {
    const f = fp && fp.from <= b.time ? fp.bars.get(b.time) : undefined;
    if (f) { for (const [k, c] of f.cells) add(binOf((k + 0.5) * fp!.row, row), c.bid + c.ask); continue }
    const lo = binOf(b.low, row), hi = binOf(b.high, row), v = b.volume / (hi - lo + 1);
    for (let k = lo; k <= hi; k++) add(k, v);
  }
  const sorted = [...rows].sort((a, b) => a[0] - b[0]);
  return { rows, total: sorted.reduce((a, r) => a + r[1], 0), ...valueArea(sorted) };
}
