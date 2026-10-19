import type { Bar } from './data.ts';

export type Series = (number | null)[];
const cl = (b: Bar[]) => b.map(x => x.close);

export function sma(v: Series, n: number): Series {
  return v.map((_, i) => {
    if (i < n - 1) return null;
    let s = 0;
    for (let j = i - n + 1; j <= i; j++) { const x = v[j]; if (x == null) return null; s += x }
    return s / n;
  });
}
export function ema(v: Series, n: number): Series {
  const k = 2 / (n + 1);
  let e: number | null = null, c = 0;
  return v.map(x => { if (x == null) return null; e = e == null ? x : x * k + e * (1 - k); return ++c >= n ? e : null });
}
/** Wilder's moving average (RMA), as used by RSI/ATR. */
export function rma(v: Series, n: number): Series {
  let a: number | null = null, c = 0, sum = 0;
  return v.map(x => {
    if (x == null) return null;
    c++;
    if (c <= n) { sum += x; if (c === n) a = sum / n; return a }
    a = (a! * (n - 1) + x) / n;
    return a;
  });
}
export function rsi(v: Series, n = 14): Series {
  const up: Series = v.map((x, i) => (i && x != null && v[i - 1] != null ? Math.max(x - v[i - 1]!, 0) : null));
  const dn: Series = v.map((x, i) => (i && x != null && v[i - 1] != null ? Math.max(v[i - 1]! - x, 0) : null));
  const g = rma(up, n), l = rma(dn, n);
  return v.map((_, i) => (g[i] == null || l[i] == null ? null : l[i] === 0 ? 100 : 100 - 100 / (1 + g[i]! / l[i]!)));
}
export function stdev(v: Series, n: number): Series {
  const m = sma(v, n);
  return v.map((_, i) => {
    if (m[i] == null) return null;
    let s = 0;
    for (let j = i - n + 1; j <= i; j++) s += (v[j]! - m[i]!) ** 2;
    return Math.sqrt(s / n);
  });
}
export function macd(v: Series, f = 12, s = 26, sg = 9) {
  const a = ema(v, f), b = ema(v, s);
  const m = v.map((_, i) => (a[i] != null && b[i] != null ? a[i]! - b[i]! : null));
  const sig = ema(m, sg);
  return { MACD: m, Signal: sig, Hist: m.map((x, i) => (x != null && sig[i] != null ? x - sig[i]! : null)) };
}
export function bb(v: Series, n = 20, k = 2) {
  const m = sma(v, n), sd = stdev(v, n);
  return { Upper: m.map((x, i) => (x == null ? null : x + k * sd[i]!)), Basis: m, Lower: m.map((x, i) => (x == null ? null : x - k * sd[i]!)) };
}
export function trueRange(b: Bar[]): Series {
  return b.map((x, i) => (i ? Math.max(x.high - x.low, Math.abs(x.high - b[i - 1].close), Math.abs(x.low - b[i - 1].close)) : x.high - x.low));
}
export const atr = (b: Bar[], n = 14) => rma(trueRange(b), n);
export function vwap(b: Bar[]): Series {
  let pv = 0, vv = 0, day = -1;
  return b.map(x => {
    const d = Math.floor(x.time / 86400);
    if (d !== day) { day = d; pv = 0; vv = 0 }
    pv += ((x.high + x.low + x.close) / 3) * x.volume; vv += x.volume;
    return vv ? pv / vv : null;
  });
}
export function highest(v: Series, n: number): Series {
  return v.map((_, i) => { if (i < n - 1) return null; let h = -Infinity; for (let j = i - n + 1; j <= i; j++) h = Math.max(h, v[j] ?? -Infinity); return h });
}
export function lowest(v: Series, n: number): Series {
  return v.map((_, i) => { if (i < n - 1) return null; let h = Infinity; for (let j = i - n + 1; j <= i; j++) h = Math.min(h, v[j] ?? Infinity); return h });
}
export function stoch(b: Bar[], n = 14, d = 3) {
  const hi = highest(b.map(x => x.high), n), lo = highest(b.map(x => -x.low), n).map(x => (x == null ? null : -x));
  const k = b.map((x, i) => (hi[i] == null ? null : hi[i] === lo[i] ? 50 : (100 * (x.close - lo[i]!)) / (hi[i]! - lo[i]!)));
  return { '%K': k, '%D': sma(k, d) };
}
export function heikin(b: Bar[]): Bar[] {
  const o: Bar[] = [];
  b.forEach((x, i) => {
    const c = (x.open + x.high + x.low + x.close) / 4;
    const op = i ? (o[i - 1].open + o[i - 1].close) / 2 : (x.open + x.close) / 2;
    o.push({ time: x.time, open: op, close: c, high: Math.max(x.high, op, c), low: Math.min(x.low, op, c), volume: x.volume });
  });
  return o;
}

export interface IndicatorDef {
  name: string;
  pane?: boolean;
  levels?: number[];
  calc: (b: Bar[]) => Record<string, Series>;
}
export const INDICATORS: Record<string, IndicatorDef> = {
  sma20: { name: 'SMA 20', calc: b => ({ 'SMA 20': sma(cl(b), 20) }) },
  ema20: { name: 'EMA 20', calc: b => ({ 'EMA 20': ema(cl(b), 20) }) },
  ema50: { name: 'EMA 50', calc: b => ({ 'EMA 50': ema(cl(b), 50) }) },
  ema200: { name: 'EMA 200', calc: b => ({ 'EMA 200': ema(cl(b), 200) }) },
  bb: { name: 'Bollinger Bands 20 2', calc: b => bb(cl(b)) },
  vwap: { name: 'VWAP', calc: b => ({ VWAP: vwap(b) }) },
  donchian: { name: 'Donchian Channels 20', calc: b => { const u = highest(b.map(x => x.high), 20), l = lowest(b.map(x => x.low), 20); return { Upper: u, Basis: u.map((x, i) => (x == null ? null : (x + l[i]!) / 2)), Lower: l } } },
  rsi: { name: 'RSI 14', pane: true, levels: [70, 30], calc: b => ({ RSI: rsi(cl(b)) }) },
  macd: { name: 'MACD 12 26 9', pane: true, calc: b => macd(cl(b)) },
  stoch: { name: 'Stochastic 14 3', pane: true, levels: [80, 20], calc: b => stoch(b) },
  atr: { name: 'ATR 14', pane: true, calc: b => ({ ATR: atr(b) }) },
  obv: { name: 'On Balance Volume', pane: true, calc: b => { let o = 0; return { OBV: b.map((x, i) => (o += i ? Math.sign(x.close - b[i - 1].close) * x.volume : 0)) } } },
};
