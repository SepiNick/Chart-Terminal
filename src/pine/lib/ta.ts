// ta.* builtins. Each call receives the current bar's argument values; history lives in per-call-site state.
// Warm-up/seeding (matches src/indicators.ts):
//  - window functions (sma, wma, stdev, highest...) return na until `length` values were seen; an na inside the
//    window makes sma/wma/stdev na, while highest/lowest/median/percentiles skip na values.
//  - ema seeds with the first non-na value (Pine reference implementation) and is masked to na until `length`
//    non-na values were seen; rma seeds with the sma of the first `length` non-na values. Both skip na inputs.
//  - rsi = rma of gains/losses; atr = rma of tr(true); first-bar change is na.
import type { Bar } from '../../data.ts';
import { type Builtin, type Ctx, type PineValue, Window, arg, num, bool, tuple, isNa } from '../types.ts';
import { mean, variance, median, pctLinear, pctNearest, mode } from './array.ts';

type O = Record<string, any>;
type A = PineValue[]; type Nm = Record<string, PineValue>;
const S = (ctx: Ctx) => ctx.state<O>(() => ({}));
const sub = (o: O, k: string): O => (o[k] ??= {});
const N = (a: A, nm: Nm, i: number, name: string, d?: number) => num(arg(a, nm, i, name, d));
const len = (n: number) => (n >= 1 ? Math.floor(n) : 0);
const bar = (ctx: Ctx, back = 0): Bar | undefined => ctx.bars[ctx.bar - back];
const nz = (x: number | undefined, d = 0) => (x === undefined || Number.isNaN(x) ? d : x);

// ---- stateful kernels (o = sub-state object) ----
/** Push x; return the last n values (oldest first) or null while warming up. */
function win(o: O, x: number, n: number, k = 'w'): number[] | null {
  n = len(n);
  const w: Window = (o[k] ??= new Window());
  w.push(x, (o[k + '#'] = Math.max(o[k + '#'] ?? 1, n)));
  return n && w.length >= n ? w.last(n) : null;
}
const prev = <T>(o: O, x: T, k: string): T | undefined => { const p = o[k]; o[k] = x; return p };
export const sumK = (o: O, x: number, n: number) => { const v = win(o, x, n); return v ? v.reduce((a, b) => a + b, 0) : NaN };
const sma = (o: O, x: number, n: number) => { const v = win(o, x, n); return v ? mean(v) : NaN };
function ema(o: O, x: number, n: number) {
  n = len(n); if (!n || Number.isNaN(x)) return NaN;
  const k = 2 / (n + 1);
  o.e = o.e === undefined ? x : x * k + o.e * (1 - k);
  return (o.c = (o.c ?? 0) + 1) >= n ? o.e : NaN;
}
function rma(o: O, x: number, n: number) {
  n = len(n); if (!n || Number.isNaN(x)) return NaN;
  o.c = (o.c ?? 0) + 1;
  if (o.c <= n) { o.s = (o.s ?? 0) + x; return o.c === n ? (o.a = o.s / n) : NaN }
  return (o.a = (o.a * (n - 1) + x) / n);
}
function wma(o: O, x: number, n: number) {
  const v = win(o, x, n); if (!v) return NaN;
  let s = 0; v.forEach((y, i) => (s += y * (i + 1)));
  return s / ((v.length * (v.length + 1)) / 2);
}
const stdev = (o: O, x: number, n: number, biased = true) => { const v = win(o, x, n); return v ? Math.sqrt(variance(v, biased)) : NaN };
const clean = (v: number[] | null) => v && v.filter(x => !Number.isNaN(x));
function extreme(o: O, x: number, n: number, hi: boolean) {
  const v = clean(win(o, x, n)); return v?.length ? (hi ? Math.max(...v) : Math.min(...v)) : NaN;
}
function extremeBars(o: O, x: number, n: number, hi: boolean) {
  const v = win(o, x, n); if (!v) return NaN;
  let b = -1;   // scan newest -> oldest, strict compare: ties resolve to the most recent bar
  for (let i = v.length - 1; i >= 0; i--) if (!Number.isNaN(v[i]) && (b < 0 || (hi ? v[i] > v[b] : v[i] < v[b]))) b = i;
  return b < 0 ? NaN : b - (v.length - 1);
}
const change = (o: O, x: number, n = 1) => { const v = win(o, x, len(n) + 1); return v ? v[v.length - 1] - v[0] : NaN };
function trv(ctx: Ctx, handleNa: boolean) {
  const b = bar(ctx)!, p = bar(ctx, 1);
  return p ? Math.max(b.high - b.low, Math.abs(b.high - p.close), Math.abs(b.low - p.close)) : handleNa ? b.high - b.low : NaN;
}
const cum = (o: O, x: number) => (o.cum = nz(o.cum) + nz(x));
const fix = (o: O, k: string, x: number) => (Number.isNaN(x) ? (o[k] ?? NaN) : (o[k] = x));

/** (source, length) or (length) overload with implicit default source. */
const srcLen = (ctx: Ctx, a: A, nm: Nm, dflt: keyof Bar): [number, number] =>
  a.length >= 2 || 'source' in nm ? [N(a, nm, 0, 'source'), N(a, nm, 1, 'length')] : [bar(ctx)![dflt], N(a, nm, 0, 'length')];

function bbK(o: O, x: number, n: number, k: number) {
  const v = win(o, x, n); if (!v) return [NaN, NaN, NaN];
  const m = mean(v), d = k * Math.sqrt(variance(v));
  return [m, m + d, m - d];
}
function kcK(ctx: Ctx, o: O, a: A, nm: Nm) {
  const x = N(a, nm, 0, 'series'), n = N(a, nm, 1, 'length'), k = N(a, nm, 2, 'mult'), b = bar(ctx)!;
  const basis = ema(sub(o, 'b'), x, n), r = ema(sub(o, 'r'), bool(arg(a, nm, 3, 'useTrueRange', true)) ? trv(ctx, false) : b.high - b.low, n);
  return [basis, basis + r * k, basis - r * k];
}
function pivot(ctx: Ctx, a: A, nm: Nm, hi: boolean) {
  const three = a.length >= 3 || 'source' in nm, o = S(ctx);
  const x = three ? N(a, nm, 0, 'source') : bar(ctx)![hi ? 'high' : 'low'];
  const L = len(N(a, nm, three ? 1 : 0, 'leftbars')), R = len(N(a, nm, three ? 2 : 1, 'rightbars'));
  const v = win(o, x, L + R + 1); if (!v) return NaN;
  const p = v[L]; if (Number.isNaN(p)) return NaN;
  // choice: pivot must beat the right side strictly and the left side non-strictly (flat tops pivot once, on the later bar)
  for (let i = 0; i < v.length; i++) if (i !== L && !(hi ? (i < L ? v[i] <= p : v[i] < p) : (i < L ? v[i] >= p : v[i] > p))) return NaN;
  return p;
}
const bySign = (o: O, x: number, n: number) => {   // [sum of up moves, sum of down moves] over n bars
  const m = change(sub(o, 'c'), x);
  return [sumK(sub(o, 'u'), Number.isNaN(m) ? NaN : m >= 0 ? m : 0, n), sumK(sub(o, 'd'), Number.isNaN(m) ? NaN : m >= 0 ? 0 : -m, n)];
};
const cross = (ctx: Ctx, a: A, nm: Nm) => {
  const o = S(ctx), x = N(a, nm, 0, 'source1'), y = N(a, nm, 1, 'source2');
  return [x, y, nz(prev(o, x, 'x'), NaN), nz(prev(o, y, 'y'), NaN)];
};
function vwapK(ctx: Ctx, o: O, src: number, anchor: PineValue | undefined) {
  const b = bar(ctx)!, day = Math.floor(b.time / 86400);
  const reset = o.pv === undefined || (anchor === undefined ? day !== o.day : bool(anchor));
  o.day = day;
  if (reset) o.pv = o.vv = o.p2 = 0;
  if (!Number.isNaN(src) && !Number.isNaN(b.volume)) { o.pv += src * b.volume; o.vv += b.volume; o.p2 += src * src * b.volume }
  const vw = o.vv ? o.pv / o.vv : NaN;
  return [vw, Math.sqrt(Math.max(0, o.p2 / o.vv - vw * vw))];
}
const volIdx = (ctx: Ctx, pos: boolean) => {   // nvi / pvi
  const o = S(ctx), b = bar(ctx)!, p = bar(ctx, 1), pv = !o.v ? 1 : o.v;
  return (o.v = !b.close || !p?.close ? pv : (pos ? b.volume > nz(p.volume) : b.volume < nz(p.volume)) ? pv + ((b.close - p.close) / p.close) * pv : pv);
};

export const TA: Record<string, Builtin> = {
  sma: (c, a, nm) => sma(S(c), N(a, nm, 0, 'source'), N(a, nm, 1, 'length')),
  ema: (c, a, nm) => ema(S(c), N(a, nm, 0, 'source'), N(a, nm, 1, 'length')),
  rma: (c, a, nm) => rma(S(c), N(a, nm, 0, 'source'), N(a, nm, 1, 'length')),
  wma: (c, a, nm) => wma(S(c), N(a, nm, 0, 'source'), N(a, nm, 1, 'length')),
  vwma: (c, a, nm) => { const o = S(c), x = N(a, nm, 0, 'source'), n = N(a, nm, 1, 'length'), v = bar(c)!.volume; return sma(sub(o, 'a'), x * v, n) / sma(sub(o, 'b'), v, n) },
  hma: (c, a, nm) => {
    const o = S(c), x = N(a, nm, 0, 'source'), n = len(N(a, nm, 1, 'length'));
    return wma(sub(o, 'c'), 2 * wma(sub(o, 'a'), x, Math.floor(n / 2)) - wma(sub(o, 'b'), x, n), Math.floor(Math.sqrt(n)));
  },
  alma: (c, a, nm) => {
    const n = len(N(a, nm, 1, 'length')), off = N(a, nm, 2, 'offset', 0.85), sig = N(a, nm, 3, 'sigma', 6), fl = bool(arg(a, nm, 4, 'floor', false));
    const v = win(S(c), N(a, nm, 0, 'series'), n); if (!v) return NaN;
    const m = fl ? Math.floor(off * (n - 1)) : off * (n - 1), s = n / sig;
    let norm = 0, sum = 0;
    v.forEach((y, i) => { const w = Math.exp(-((i - m) ** 2) / (2 * s * s)); norm += w; sum += y * w });
    return sum / norm;
  },
  swma: (c, a, nm) => { const v = win(S(c), N(a, nm, 0, 'source'), 4); return v ? (v[0] + 2 * v[1] + 2 * v[2] + v[3]) / 6 : NaN },
  linreg: (c, a, nm) => {
    const v = win(S(c), N(a, nm, 0, 'source'), N(a, nm, 1, 'length')), off = N(a, nm, 2, 'offset', 0); if (!v) return NaN;
    const n = v.length, mx = (n - 1) / 2, my = mean(v);
    let sxy = 0, sxx = 0; v.forEach((y, i) => { sxy += (i - mx) * (y - my); sxx += (i - mx) ** 2 });
    const slope = sxx ? sxy / sxx : 0;
    return my - slope * mx + slope * (n - 1 - off);
  },
  rsi: (c, a, nm) => {
    const o = S(c), x = N(a, nm, 0, 'source'), n = N(a, nm, 1, 'length'), ch = change(sub(o, 'c'), x);
    const up = rma(sub(o, 'u'), Number.isNaN(ch) ? NaN : Math.max(ch, 0), n), dn = rma(sub(o, 'd'), Number.isNaN(ch) ? NaN : Math.max(-ch, 0), n);
    return Number.isNaN(up) || Number.isNaN(dn) ? NaN : dn === 0 ? 100 : up === 0 ? 0 : 100 - 100 / (1 + up / dn);
  },
  macd: (c, a, nm) => {
    const o = S(c), x = N(a, nm, 0, 'source');
    const m = ema(sub(o, 'f'), x, N(a, nm, 1, 'fastlen', 12)) - ema(sub(o, 's'), x, N(a, nm, 2, 'slowlen', 26)), sg = ema(sub(o, 'g'), m, N(a, nm, 3, 'siglen', 9));
    return tuple(m, sg, m - sg);
  },
  stoch: (c, a, nm) => {
    const o = S(c), n = N(a, nm, 3, 'length'), hh = extreme(sub(o, 'h'), N(a, nm, 1, 'high'), n, true), ll = extreme(sub(o, 'l'), N(a, nm, 2, 'low'), n, false);
    return hh - ll ? (100 * (N(a, nm, 0, 'source') - ll)) / (hh - ll) : NaN;
  },
  tr: (c, a, nm) => trv(c, bool(arg(a, nm, 0, 'handle_na', false))),
  atr: (c, a, nm) => rma(S(c), trv(c, true), N(a, nm, 0, 'length')),
  bb: (c, a, nm) => tuple(...bbK(S(c), N(a, nm, 0, 'series'), N(a, nm, 1, 'length'), N(a, nm, 2, 'mult'))),
  bbw: (c, a, nm) => { const [m, u, l] = bbK(S(c), N(a, nm, 0, 'series'), N(a, nm, 1, 'length'), N(a, nm, 2, 'mult')); return ((u - l) / m) * 100 },
  kc: (c, a, nm) => tuple(...kcK(c, S(c), a, nm)),
  kcw: (c, a, nm) => { const [m, u, l] = kcK(c, S(c), a, nm); return (u - l) / m },
  cci: (c, a, nm) => {
    const x = N(a, nm, 0, 'source'), v = win(S(c), x, N(a, nm, 1, 'length')); if (!v) return NaN;
    const m = mean(v), d = mean(v.map(y => Math.abs(y - m)));
    return (x - m) / (0.015 * d);
  },
  mfi: (c, a, nm) => {
    const o = S(c), x = N(a, nm, 0, 'series'), n = N(a, nm, 1, 'length'), v = bar(c)!.volume, ch = change(sub(o, 'c'), x);
    const up = sumK(sub(o, 'u'), Number.isNaN(ch) ? NaN : ch <= 0 ? 0 : x * v, n), dn = sumK(sub(o, 'd'), Number.isNaN(ch) ? NaN : ch >= 0 ? 0 : x * v, n);
    return 100 - 100 / (1 + up / dn);
  },
  cmo: (c, a, nm) => { const [u, d] = bySign(S(c), N(a, nm, 0, 'series'), N(a, nm, 1, 'length')); return (100 * (u - d)) / (u + d) },
  tsi: (c, a, nm) => {
    const o = S(c), s = N(a, nm, 1, 'short_length'), l = N(a, nm, 2, 'long_length'), pc = change(sub(o, 'c'), N(a, nm, 0, 'source'));
    return ema(sub(o, 'a2'), ema(sub(o, 'a1'), pc, l), s) / ema(sub(o, 'b2'), ema(sub(o, 'b1'), Math.abs(pc), l), s);
  },
  wpr: (c, a, nm) => {
    const o = S(c), n = N(a, nm, 0, 'length'), b = bar(c)!, hh = extreme(sub(o, 'h'), b.high, n, true), ll = extreme(sub(o, 'l'), b.low, n, false);
    return hh - ll ? (100 * (b.close - hh)) / (hh - ll) : NaN;
  },
  roc: (c, a, nm) => { const v = win(S(c), N(a, nm, 0, 'source'), len(N(a, nm, 1, 'length')) + 1); return v ? (100 * (v[v.length - 1] - v[0])) / v[0] : NaN },
  mom: (c, a, nm) => change(S(c), N(a, nm, 0, 'source'), N(a, nm, 1, 'length')),
  change: (c, a, nm) => {
    const s = arg(a, nm, 0, 'source'), n = N(a, nm, 1, 'length', 1);
    if (typeof s !== 'boolean') return change(S(c), num(s), n);
    const v = win(S(c), +s, len(n) + 1); return !!v && v[v.length - 1] !== v[0];
  },
  cum: (c, a, nm) => cum(S(c), N(a, nm, 0, 'source')),
  highest: (c, a, nm) => extreme(S(c), ...srcLen(c, a, nm, 'high'), true),
  lowest: (c, a, nm) => extreme(S(c), ...srcLen(c, a, nm, 'low'), false),
  highestbars: (c, a, nm) => extremeBars(S(c), ...srcLen(c, a, nm, 'high'), true),
  lowestbars: (c, a, nm) => extremeBars(S(c), ...srcLen(c, a, nm, 'low'), false),
  range: (c, a, nm) => { const v = clean(win(S(c), N(a, nm, 0, 'source'), N(a, nm, 1, 'length'))); return v?.length ? Math.max(...v) - Math.min(...v) : NaN },
  max: (c, a, nm) => { const o = S(c), x = N(a, nm, 0, 'source'); return Number.isNaN(x) || x <= o.m ? (o.m ?? NaN) : (o.m = x) },
  min: (c, a, nm) => { const o = S(c), x = N(a, nm, 0, 'source'); return Number.isNaN(x) || x >= o.m ? (o.m ?? NaN) : (o.m = x) },
  stdev: (c, a, nm) => stdev(S(c), N(a, nm, 0, 'source'), N(a, nm, 1, 'length'), bool(arg(a, nm, 2, 'biased', true))),
  variance: (c, a, nm) => { const v = win(S(c), N(a, nm, 0, 'source'), N(a, nm, 1, 'length')); return v ? variance(v, bool(arg(a, nm, 2, 'biased', true))) : NaN },
  dev: (c, a, nm) => { const v = win(S(c), N(a, nm, 0, 'source'), N(a, nm, 1, 'length')); if (!v) return NaN; const m = mean(v); return mean(v.map(y => Math.abs(y - m))) },
  median: (c, a, nm) => { const v = clean(win(S(c), N(a, nm, 0, 'source'), N(a, nm, 1, 'length'))); return v ? median(v) : NaN },
  mode: (c, a, nm) => { const v = clean(win(S(c), N(a, nm, 0, 'source'), N(a, nm, 1, 'length'))); return v ? mode(v) : NaN },
  percentrank: (c, a, nm) => {
    const n = len(N(a, nm, 1, 'length')), v = win(S(c), N(a, nm, 0, 'source'), n + 1); if (!v || !n) return NaN;
    const x = v[n]; return Number.isNaN(x) ? NaN : (100 * v.slice(0, n).filter(y => y <= x).length) / n;
  },
  percentile_linear_interpolation: (c, a, nm) => { const v = clean(win(S(c), N(a, nm, 0, 'source'), N(a, nm, 1, 'length'))); return v ? pctLinear(v, N(a, nm, 2, 'percentage')) : NaN },
  percentile_nearest_rank: (c, a, nm) => { const v = clean(win(S(c), N(a, nm, 0, 'source'), N(a, nm, 1, 'length'))); return v ? pctNearest(v, N(a, nm, 2, 'percentage')) : NaN },
  correlation: (c, a, nm) => {
    const o = S(c), n = N(a, nm, 2, 'length'), x = win(o, N(a, nm, 0, 'source1'), n, 'x'), y = win(o, N(a, nm, 1, 'source2'), n, 'y');
    if (!x || !y) return NaN;
    const mx = mean(x), my = mean(y); let sxy = 0, sxx = 0, syy = 0;
    x.forEach((xi, i) => { sxy += (xi - mx) * (y[i] - my); sxx += (xi - mx) ** 2; syy += (y[i] - my) ** 2 });
    return sxy / Math.sqrt(sxx * syy);
  },
  crossover: (c, a, nm) => { const [x, y, px, py] = cross(c, a, nm); return x > y && px <= py },
  crossunder: (c, a, nm) => { const [x, y, px, py] = cross(c, a, nm); return x < y && px >= py },
  cross: (c, a, nm) => { const [x, y, px, py] = cross(c, a, nm); return (x > y && px <= py) || (x < y && px >= py) },
  rising: (c, a, nm) => { const n = len(N(a, nm, 1, 'length')), v = win(S(c), N(a, nm, 0, 'source'), n + 1); return !!v && v.slice(0, n).every(y => v[n] > y) },
  falling: (c, a, nm) => { const n = len(N(a, nm, 1, 'length')), v = win(S(c), N(a, nm, 0, 'source'), n + 1); return !!v && v.slice(0, n).every(y => v[n] < y) },
  valuewhen: (c, a, nm) => {
    const o = S(c), src = arg(a, nm, 1, 'source'), occ = len(N(a, nm, 2, 'occurrence', 0) + 1) - 1;
    const h: PineValue[] = (o.h ??= []);
    o.k = Math.max(o.k ?? 1, occ + 1);
    if (bool(arg(a, nm, 0, 'condition'))) { h.push(src); if (h.length > o.k) h.shift() }
    const v = occ < 0 ? undefined : h[h.length - 1 - occ];
    return v === undefined ? (typeof src === 'number' ? NaN : null) : v;
  },
  barssince: (c, a, nm) => { const o = S(c); if (bool(arg(a, nm, 0, 'condition'))) o.last = c.bar; return o.last === undefined ? NaN : c.bar - o.last },
  pivothigh: (c, a, nm) => pivot(c, a, nm, true),
  pivotlow: (c, a, nm) => pivot(c, a, nm, false),
  sar: (c, a, nm) => {   // follows the Pine reference implementation of ta.sar
    const o = S(c), st = N(a, nm, 0, 'start'), inc = N(a, nm, 1, 'inc'), mx = N(a, nm, 2, 'max'), b = bar(c)!, p1 = bar(c, 1), p2 = bar(c, 2);
    if (!p1) return NaN;
    let first = false;
    if (o.r === undefined) { o.below = b.close > p1.close; o.mm = o.below ? b.high : b.low; o.r = o.below ? p1.low : p1.high; o.acc = st; first = true }
    o.r += o.acc * (o.mm - o.r);
    if (o.below) { if (o.r > b.low) { first = true; o.below = false; o.r = Math.max(b.high, o.mm); o.mm = b.low; o.acc = st } }
    else if (o.r < b.high) { first = true; o.below = true; o.r = Math.min(b.low, o.mm); o.mm = b.high; o.acc = st }
    if (!first) {
      if (o.below ? b.high > o.mm : b.low < o.mm) { o.mm = o.below ? b.high : b.low; o.acc = Math.min(o.acc + inc, mx) }
    }
    if (o.below) { o.r = Math.min(o.r, p1.low); if (p2) o.r = Math.min(o.r, p2.low) }
    else { o.r = Math.max(o.r, p1.high); if (p2) o.r = Math.max(o.r, p2.high) }
    return o.r;
  },
  supertrend: (c, a, nm) => {   // direction: -1 = uptrend (line below price), 1 = downtrend
    const o = S(c), f = N(a, nm, 0, 'factor'), b = bar(c)!, pc = bar(c, 1)?.close ?? NaN;
    const atr = rma(sub(o, 'atr'), trv(c, true), N(a, nm, 1, 'atrPeriod')), src = (b.high + b.low) / 2;
    const pl = nz(o.lo), pu = nz(o.up);
    let lo = src - f * atr, up = src + f * atr;
    lo = lo > pl || pc < pl ? lo : pl;
    up = up < pu || pc > pu ? up : pu;
    const dir = Number.isNaN(o.pa ?? NaN) ? 1 : o.st === pu ? (b.close > up ? -1 : 1) : b.close < lo ? 1 : -1;
    const st = dir === -1 ? lo : up;
    Object.assign(o, { lo, up, st, pa: atr });
    return tuple(st, dir);
  },
  dmi: (c, a, nm) => {
    const o = S(c), n = N(a, nm, 0, 'diLength'), m = N(a, nm, 1, 'adxSmoothing'), b = bar(c)!, p = bar(c, 1);
    const up = p ? b.high - p.high : NaN, dn = p ? p.low - b.low : NaN;
    const tr = rma(sub(o, 'rt'), trv(c, false), n);
    const plus = fix(o, 'pl', (100 * rma(sub(o, 'rp'), Number.isNaN(up) ? NaN : up > dn && up > 0 ? up : 0, n)) / tr);
    const minus = fix(o, 'mi', (100 * rma(sub(o, 'rm'), Number.isNaN(dn) ? NaN : dn > up && dn > 0 ? dn : 0, n)) / tr);
    const s = plus + minus;
    return tuple(plus, minus, 100 * rma(sub(o, 'ra'), Math.abs(plus - minus) / (s === 0 ? 1 : s), m));
  },
  vwap: (c, a, nm) => {   // ta.vwap(source, anchor?, stdev_mult?): resets on `anchor` true, else daily (UTC)
    const b = bar(c)!, s = arg(a, nm, 0, 'source'), k = arg(a, nm, 2, 'stdev_mult');
    const [vw, sd] = vwapK(c, S(c), s === undefined ? (b.high + b.low + b.close) / 3 : num(s), arg(a, nm, 1, 'anchor'));
    return k === undefined || isNa(k) ? vw : tuple(vw, vw + num(k) * sd, vw - num(k) * sd);
  },
  obv: c => { const b = bar(c)!, p = bar(c, 1); return cum(S(c), p ? Math.sign(b.close - p.close) * b.volume : NaN) },
  accdist: c => { const b = bar(c)!, r = b.high - b.low; return cum(S(c), r ? ((b.close - b.low - (b.high - b.close)) / r) * b.volume : 0) },
  wad: c => {
    const b = bar(c)!, p = bar(c, 1); if (!p) return cum(S(c), 0);
    const m = b.close - p.close;
    return cum(S(c), m > 0 ? b.close - Math.min(b.low, p.close) : m < 0 ? b.close - Math.max(b.high, p.close) : 0);
  },
  iii: c => { const b = bar(c)!; return (2 * b.close - b.high - b.low) / ((b.high - b.low) * b.volume) },
  nvi: c => volIdx(c, false),
  pvi: c => volIdx(c, true),
  pvt: c => { const b = bar(c)!, p = bar(c, 1); return cum(S(c), p ? ((b.close - p.close) / p.close) * b.volume : NaN) },
  wvad: c => { const b = bar(c)!; return ((b.close - b.open) / (b.high - b.low)) * b.volume },
  cog: (c, a, nm) => {
    const v = win(S(c), N(a, nm, 0, 'source'), N(a, nm, 1, 'length')); if (!v) return NaN;
    let s = 0, w = 0; v.forEach((y, i) => { s += y; w += y * (v.length - i) });
    return -w / s;
  },
};

/** Builtin variables: ta.tr is tr(false); ta.vwap is vwap(hlc3) with daily anchor. */
export const TA_VARS: Record<string, (ctx: Ctx) => PineValue> = Object.fromEntries(
  ['tr', 'vwap', 'obv', 'accdist', 'iii', 'nvi', 'pvi', 'pvt', 'wad', 'wvad'].map(k => [k, (ctx: Ctx) => TA[k](ctx, [], {})]),
);
