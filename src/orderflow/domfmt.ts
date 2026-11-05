// Pure helpers for the DOM / Level 2 panel (no DOM access): number formatting, price grouping, cumulative depth, connection state.
// Numbers are always formatted with ASCII digits so they stay LTR and fixed-width inside a Persian UI.

/** 12345.6 → "12,345.6" with exactly `prec` decimals. */
export function fmtPrice(px: number, prec: number): string {
  if (!Number.isFinite(px)) return '';
  const s = Math.abs(px).toFixed(Math.max(0, Math.min(8, prec))), [i, f] = s.split('.');
  return (px < 0 && +s ? '-' : '') + i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (f ? '.' + f : '');
}

/** Resting / traded size: 1.23M, 12.3K, 123.4, 0.123, 0.0012; zero → ''. Compact once ≥ 1000. */
export function fmtSize(v: number): string {
  if (!(v > 0)) return '';
  if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (v >= 1e4) return (v / 1e3).toFixed(1) + 'K';
  if (v >= 1e3) return (v / 1e3).toFixed(2) + 'K';
  if (v >= 100) return v.toFixed(1);
  if (v >= 1) return v.toFixed(2);
  if (v >= 0.01) return v.toFixed(3);
  return v.toPrecision(2);
}

/** Quote-currency value (trade value): thousands separators below 1M, then compact. */
export const fmtValue = (v: number) => (v >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : v >= 1e3 ? fmtPrice(v, 0) : v >= 1 ? v.toFixed(1) : v.toFixed(2));

/** Decimals needed to show a price step exactly (0.25 → 2, 5 → 0). */
export function stepDecimals(step: number) { let d = 0; while (d < 8 && Math.abs(step * 10 ** d - Math.round(step * 10 ** d)) > 1e-9 * Math.max(1, step * 10 ** d)) d++; return d }

/** Group raw [price, size] levels into bins of `step`: bin index → summed size. */
export function groupLevels(levels: readonly (readonly [number, number])[], step: number): Map<number, number> {
  const m = new Map<number, number>();
  for (const [p, q] of levels) { const k = Math.floor(p / step + 1e-9); m.set(k, (m.get(k) ?? 0) + q) }
  return m;
}

/** Cumulative depth along `ks` (ordered from the touch outward): running total of `sizes` per bin. */
export function cumulative(ks: readonly number[], sizes: ReadonlyMap<number, number>): number[] {
  let s = 0;
  return ks.map(k => (s += sizes.get(k) ?? 0));
}

/** Selectable grouping multipliers, labelled with the real price step they give (e.g. ×5 → 10). */
export const GROUP_MULTS = [1, 2, 5, 10, 25, 100];
export const groupLabel = (mult: number, base: number, prec: number) => `${fmtPrice(base * mult, Math.max(prec, stepDecimals(base * mult)))}`;

export type ConnState = 'loading' | 'live' | 'stale' | 'offline';
/** Order-book health from the age of the last update (ms); null = nothing received yet. */
export function connState(ageMs: number | null, liveMs = 3000, offlineMs = 12000): ConnState {
  return ageMs == null ? 'loading' : ageMs <= liveMs ? 'live' : ageMs <= offlineMs ? 'stale' : 'offline';
}

/** Bar width in percent, 0–100, never NaN. */
export const pct = (v: number, max: number) => (max > 0 && v > 0 ? Math.min(100, (v / max) * 100) : 0);
