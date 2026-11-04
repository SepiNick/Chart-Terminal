// Bar helpers shared by the Iranian sources.
import type { Bar } from '../../src/data.ts';
import { jalaliMonthStart } from '../../src/jalali.ts';

/** Iran has no daylight saving since 2022: Tehran is always UTC+3:30. */
export const TEHRAN_OFFSET = 12600;
/** Week buckets for Iranian markets start on Saturday (epoch day 0 was a Thursday). */
export const SATURDAY = 172800;

/** Merge consecutive bars that share a bucket key into one bar stamped with the bucket's start. */
function bucketBars(bars: Bar[], start: (t: number) => number): Bar[] {
  const out: Bar[] = [];
  for (const b of bars) {
    const t = start(b.time), last = out.at(-1);
    if (last && last.time === t) { last.high = Math.max(last.high, b.high); last.low = Math.min(last.low, b.low); last.close = b.close; last.volume += b.volume }
    else out.push({ ...b, time: t });
  }
  return out;
}
/** Jalali calendar months, from daily bars. */
export const monthlyJalali = (bars: Bar[]) => bucketBars(bars, jalaliMonthStart);
/** Gregorian calendar months, from daily bars. */
export const monthlyGregorian = (bars: Bar[]) => bucketBars(bars, t => { const d = new Date(t * 1000); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000 });

/** Ascending, one bar per timestamp (later duplicates win), only finite OHLC with high ≥ low. */
export function cleanBars(bars: Bar[]): Bar[] {
  const m = new Map<number, Bar>();
  for (const b of bars) if ([b.time, b.open, b.high, b.low, b.close].every(Number.isFinite) && b.high >= b.low) m.set(b.time, { ...b, volume: Number.isFinite(b.volume) ? b.volume : 0 });
  return [...m.values()].sort((a, b) => a.time - b.time);
}
/** The newest `limit` bars that end at or before `until` (ms). */
export function window(bars: Bar[], until: number | undefined, limit: number): Bar[] {
  const b = until === undefined ? bars : bars.filter(x => x.time * 1000 < until);
  return b.slice(-limit);
}
