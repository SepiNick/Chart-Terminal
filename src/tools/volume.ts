// Pure volume math for volume-profile and VWAP tools (no DOM, unit-tested in volume.test.ts).
import type { Bar } from '../data.ts';

export interface Profile {
  lo: number; step: number; rows: number;          // row i spans [lo + i*step, lo + (i+1)*step]
  up: number[]; down: number[]; total: number[];
  poc: number; vaLo: number; vaHi: number;         // row indices; value area = rows vaLo..vaHi inclusive
  sum: number;
}

/**
 * Volume profile: each bar's volume is spread uniformly over its low..high range across `rows`
 * equal price rows; a bar counts as up when close >= open. Value area grows from the POC row,
 * adding the heavier neighbour (above wins ties) until it holds `vaPct` of the total.
 */
export function volumeProfile(bars: Bar[], rows = 24, vaPct = 0.7): Profile | null {
  if (!bars.length) return null;
  let lo = Infinity, hi = -Infinity;
  for (const b of bars) { lo = Math.min(lo, b.low); hi = Math.max(hi, b.high) }
  rows = hi > lo ? Math.max(1, Math.round(rows)) : 1;
  const step = (hi - lo) / rows, rowOf = (p: number) => (step ? Math.min(rows - 1, Math.max(0, Math.floor((p - lo) / step))) : 0);
  const up = new Array<number>(rows).fill(0), down = up.slice();
  for (const b of bars) {
    const into = b.close >= b.open ? up : down, span = b.high - b.low;
    if (!(span > 0)) { into[rowOf(b.close)] += b.volume; continue }
    for (let i = rowOf(b.low); i <= rowOf(b.high); i++) {
      const ov = Math.min(b.high, lo + (i + 1) * step) - Math.max(b.low, lo + i * step);
      if (ov > 0) into[i] += (b.volume * ov) / span;
    }
  }
  const total = up.map((u, i) => u + down[i]), sum = total.reduce((a, v) => a + v, 0);
  const poc = total.indexOf(Math.max(...total));
  let vaLo = poc, vaHi = poc, acc = total[poc];
  while (acc < sum * vaPct && (vaLo > 0 || vaHi < rows - 1)) {
    const a = vaHi < rows - 1 ? total[vaHi + 1] : -1, b = vaLo > 0 ? total[vaLo - 1] : -1;
    if (a >= b) acc += total[++vaHi]; else acc += total[--vaLo];
  }
  return { lo, step, rows, up, down, total, poc, vaLo, vaHi, sum };
}

/** Anchored VWAP of typical price (h+l+c)/3 from bars[0] on, with volume-weighted std deviation. */
export function anchoredVwap(bars: Bar[]): { v: number; sd: number }[] {
  let pv = 0, pv2 = 0, vol = 0;
  return bars.map(b => {
    const tp = (b.high + b.low + b.close) / 3;
    pv += tp * b.volume; pv2 += tp * tp * b.volume; vol += b.volume;
    if (!vol) return { v: tp, sd: 0 };
    const v = pv / vol;
    return { v, sd: Math.sqrt(Math.max(0, pv2 / vol - v * v)) };
  });
}
