// The searchable indicator library: moving averages, trend, momentum, volatility and volume studies with editable inputs.
// A chart stores an indicator as "id" (default inputs) or "id@a,b,c" (custom inputs); indicatorDef() turns either into something the chart can draw.
import type { Bar } from './data.ts';
import { INDICATORS, atr, bb, ema, highest, lowest, macd, rma, rsi, sma, stdev, stoch, trueRange, vwap, type IndicatorDef, type Series } from './indicators.ts';

export type Group = 'Moving averages' | 'Trend' | 'Momentum' | 'Volatility' | 'Volume';
export interface Input { name: string; def: number; min?: number; step?: number }
export interface LibDef { id: string; name: string; group: Group; pane?: boolean; levels?: number[]; inputs: Input[]; calc: (b: Bar[], ...p: number[]) => Record<string, Series> }

type S = Series;
const C = (b: Bar[]): S => b.map(x => x.close), H = (b: Bar[]): S => b.map(x => x.high), L = (b: Bar[]): S => b.map(x => x.low), V = (b: Bar[]): S => b.map(x => x.volume);
const hl2 = (b: Bar[]): S => b.map(x => (x.high + x.low) / 2), tp = (b: Bar[]): S => b.map(x => (x.high + x.low + x.close) / 3);
const op = (a: S, c: S, f: (x: number, y: number) => number): S => a.map((x, i) => (x == null || c[i] == null ? null : f(x, c[i]!)));
const mapS = (a: S, f: (x: number) => number): S => a.map(x => (x == null ? null : f(x)));
const sub = (a: S, c: S) => op(a, c, (x, y) => x - y), add = (a: S, c: S) => op(a, c, (x, y) => x + y);
const div = (a: S, c: S) => op(a, c, (x, y) => (y === 0 ? NaN : x / y)).map(x => (x != null && !Number.isFinite(x) ? null : x));
/** Value `k` bars back (null before the start). */
const lag = (a: S, k: number): S => a.map((_, i) => (i - k >= 0 ? a[i - k] : null));
/** The series moved `k` bars later (k > 0) or earlier (k < 0). */
const shift = (a: S, k: number): S => a.map((_, i) => (i - k >= 0 && i - k < a.length ? a[i - k] : null));
const sumN = (a: S, n: number): S => a.map((_, i) => { if (i < n - 1) return null; let s = 0; for (let j = i - n + 1; j <= i; j++) { if (a[j] == null) return null; s += a[j]! } return s });
/** Rolling window max / min that stay null until the window holds only values. */
const hh = (a: S, n: number): S => highest(a.map(x => x ?? NaN), n).map(x => (x == null || !Number.isFinite(x) ? null : x));
const ll = (a: S, n: number): S => lowest(a.map(x => x ?? NaN), n).map(x => (x == null || !Number.isFinite(x) ? null : x));
const cum = (a: S): S => { let s = 0; return a.map(x => (x == null ? null : (s += x))) };

export function wma(v: S, n: number): S {
  const w = (n * (n + 1)) / 2;
  return v.map((_, i) => { if (i < n - 1) return null; let s = 0; for (let j = 0; j < n; j++) { const x = v[i - n + 1 + j]; if (x == null) return null; s += x * (j + 1) } return s / w });
}
export const hma = (v: S, n: number): S => wma(sub(mapS(wma(v, Math.max(1, Math.floor(n / 2))), x => 2 * x), wma(v, n)), Math.max(1, Math.round(Math.sqrt(n))));
const vwma = (b: Bar[], n: number): S => div(sumN(b.map(x => x.close * x.volume), n), sumN(V(b), n));
const dema = (v: S, n: number): S => sub(mapS(ema(v, n), x => 2 * x), ema(ema(v, n), n));
const tema = (v: S, n: number): S => { const e1 = ema(v, n), e2 = ema(e1, n), e3 = ema(e2, n); return e1.map((x, i) => (x == null || e2[i] == null || e3[i] == null ? null : 3 * x - 3 * e2[i]! + e3[i]!)) };
const zlema = (v: S, n: number): S => { const k = Math.round((n - 1) / 2); return ema(v.map((x, i) => (x == null || i < k || v[i - k] == null ? null : 2 * x - v[i - k]!)), n) };
function linreg(v: S, n: number): { value: S; slope: S } {
  const value: S = [], slope: S = [], sx = (n * (n - 1)) / 2, sxx = ((n - 1) * n * (2 * n - 1)) / 6;
  v.forEach((_, i) => {
    if (i < n - 1) { value.push(null); slope.push(null); return }
    let sy = 0, sxy = 0, ok = true;
    for (let j = 0; j < n; j++) { const y = v[i - n + 1 + j]; if (y == null) { ok = false; break } sy += y; sxy += j * y }
    if (!ok) { value.push(null); slope.push(null); return }
    const m = (n * sxy - sx * sy) / (n * sxx - sx * sx), c0 = (sy - m * sx) / n;
    value.push(c0 + m * (n - 1)); slope.push(m);
  });
  return { value, slope };
}
function alma(v: S, n: number, offset: number, sigma: number): S {
  const m = offset * (n - 1), s = n / sigma, w = Array.from({ length: n }, (_, j) => Math.exp(-((j - m) ** 2) / (2 * s * s))), tot = w.reduce((a, x) => a + x, 0);
  return v.map((_, i) => { if (i < n - 1) return null; let r = 0; for (let j = 0; j < n; j++) { const x = v[i - n + 1 + j]; if (x == null) return null; r += w[j] * x } return r / tot });
}
function kama(v: S, n: number): S {
  let prev: number | null = null;
  return v.map((x, i) => {
    if (x == null || i < n) return null;
    let vol = 0; for (let j = i - n + 1; j <= i; j++) vol += Math.abs(v[j]! - v[j - 1]!);
    const er = vol === 0 ? 0 : Math.abs(x - v[i - n]!) / vol, sc = (er * (2 / 3 - 2 / 31) + 2 / 31) ** 2;
    prev = prev == null ? v[i - n]! : prev + sc * (x - prev);
    return prev;
  });
}
function mcginley(v: S, n: number): S {
  let md: number | null = null;
  return v.map(x => { if (x == null) return null; md = md == null ? x : md + (x - md) / (0.6 * n * (x / md) ** 4); return md });
}
function supertrend(b: Bar[], n: number, m: number) {
  const a = atr(b, n), mid = hl2(b), up: S = [], dn: S = [];
  let fu = 0, fl = 0, dir = 1;
  b.forEach((x, i) => {
    if (a[i] == null) { up.push(null); dn.push(null); return }
    const u = mid[i]! + m * a[i]!, l = mid[i]! - m * a[i]!, pc = i ? b[i - 1].close : x.close;
    if (!i || a[i - 1] == null) { fu = u; fl = l } else { fu = u < fu || pc > fu ? u : fu; fl = l > fl || pc < fl ? l : fl; if (dir === 1 && x.close < fl) dir = -1; else if (dir === -1 && x.close > fu) dir = 1 }
    up.push(dir === 1 ? fl : null); dn.push(dir === -1 ? fu : null);
  });
  return { 'Supertrend Up': up, 'Supertrend Down': dn };
}
function psar(b: Bar[], start: number, inc: number, max: number): S {
  if (b.length < 2) return b.map(() => null);
  const out: S = [null];
  let bull = b[1].close >= b[0].close, af = start, ep = bull ? b[0].high : b[0].low, sar = bull ? b[0].low : b[0].high;
  for (let i = 1; i < b.length; i++) {
    sar = sar + af * (ep - sar);
    if (bull) { sar = Math.min(sar, b[i - 1].low, i > 1 ? b[i - 2].low : b[i - 1].low) } else { sar = Math.max(sar, b[i - 1].high, i > 1 ? b[i - 2].high : b[i - 1].high) }
    if (bull ? b[i].low < sar : b[i].high > sar) { bull = !bull; sar = ep; ep = bull ? b[i].high : b[i].low; af = start }
    else if (bull ? b[i].high > ep : b[i].low < ep) { ep = bull ? b[i].high : b[i].low; af = Math.min(af + inc, max) }
    out.push(sar);
  }
  return out;
}
function adx(b: Bar[], n: number) {
  const pdm: S = b.map((x, i) => { if (!i) return 0; const u = x.high - b[i - 1].high, d = b[i - 1].low - x.low; return u > d && u > 0 ? u : 0 });
  const mdm: S = b.map((x, i) => { if (!i) return 0; const u = x.high - b[i - 1].high, d = b[i - 1].low - x.low; return d > u && d > 0 ? d : 0 });
  const t = rma(trueRange(b), n), pdi = mapS(div(rma(pdm, n), t), x => 100 * x), mdi = mapS(div(rma(mdm, n), t), x => 100 * x);
  const dx = op(pdi, mdi, (p, m) => (p + m === 0 ? 0 : (100 * Math.abs(p - m)) / (p + m)));
  return { ADX: rma(dx, n), '+DI': pdi, '-DI': mdi };
}
function aroon(b: Bar[], n: number) {
  const up: S = [], dn: S = [];
  b.forEach((_, i) => {
    if (i < n) { up.push(null); dn.push(null); return }
    let hi = i - n, lo = i - n;
    for (let j = i - n; j <= i; j++) { if (b[j].high >= b[hi].high) hi = j; if (b[j].low <= b[lo].low) lo = j }
    up.push((100 * (n - (i - hi))) / n); dn.push((100 * (n - (i - lo))) / n);
  });
  return { 'Aroon Up': up, 'Aroon Down': dn };
}
const roc = (v: S, n: number): S => mapS(div(sub(v, lag(v, n)), lag(v, n)), x => 100 * x);
const adl = (b: Bar[]): S => cum(b.map(x => (x.high === x.low ? 0 : (((x.close - x.low) - (x.high - x.close)) / (x.high - x.low)) * x.volume)));

const I = (name: string, def: number, min = 1, step = 1): Input => ({ name, def, min, step });
const N = (def: number): Input[] => [I('Length', def)];
const ma = (id: string, name: string, def: number, f: (b: Bar[], n: number) => S): LibDef => ({ id, name, group: 'Moving averages', inputs: N(def), calc: (b, n) => ({ [`${name} ${n}`]: f(b, n) }) });
const osc = (id: string, name: string, def: number, f: (b: Bar[], n: number) => Record<string, S>, extra: Partial<LibDef> = {}): LibDef => ({ id, name, group: 'Momentum', pane: true, inputs: N(def), calc: f, ...extra });

export const LIB: LibDef[] = [
  // ----- moving averages (drawn on the price chart) -----
  ma('sma', 'SMA', 20, (b, n) => sma(C(b), n)), ma('ema', 'EMA', 20, (b, n) => ema(C(b), n)), ma('wma', 'WMA', 20, (b, n) => wma(C(b), n)),
  ma('hma', 'Hull MA', 21, (b, n) => hma(C(b), n)), ma('vwma', 'VWMA', 20, vwma), ma('dema', 'DEMA', 20, (b, n) => dema(C(b), n)), ma('tema', 'TEMA', 20, (b, n) => tema(C(b), n)),
  ma('smma', 'SMMA (RMA)', 14, (b, n) => rma(C(b), n)), ma('lsma', 'Least Squares MA', 25, (b, n) => linreg(C(b), n).value), ma('zlema', 'Zero-Lag EMA', 20, (b, n) => zlema(C(b), n)),
  ma('kama', 'Kaufman Adaptive MA', 10, (b, n) => kama(C(b), n)), ma('mcginley', 'McGinley Dynamic', 14, (b, n) => mcginley(C(b), n)),
  { id: 'alma', name: 'Arnaud Legoux MA', group: 'Moving averages', inputs: [I('Length', 9), I('Offset', 0.85, 0, 0.05), I('Sigma', 6)], calc: (b, n, o, s) => ({ ALMA: alma(C(b), n, o, s) }) },
  { id: 'alligator', name: 'Williams Alligator', group: 'Trend', inputs: [], calc: b => { const m = hl2(b); return { Jaw: shift(rma(m, 13), 8), Teeth: shift(rma(m, 8), 5), Lips: shift(rma(m, 5), 3) } } },
  // ----- trend -----
  { id: 'supertrend', name: 'Supertrend', group: 'Trend', inputs: [I('ATR length', 10), I('Factor', 3, 0.1, 0.1)], calc: (b, n, m) => supertrend(b, n, m) },
  { id: 'psar', name: 'Parabolic SAR', group: 'Trend', inputs: [I('Start', 0.02, 0.001, 0.01), I('Increment', 0.02, 0.001, 0.01), I('Maximum', 0.2, 0.01, 0.05)], calc: (b, s, i, m) => ({ SAR: psar(b, s, i, m) }) },
  { id: 'ichimoku', name: 'Ichimoku Cloud', group: 'Trend', inputs: [I('Conversion', 9), I('Base', 26), I('Span B', 52)], calc: (b, t, k, sb) => {
    const mid = (n: number) => op(hh(H(b), n), ll(L(b), n), (x, y) => (x + y) / 2), ten = mid(t), kij = mid(k);
    return { Conversion: ten, Base: kij, 'Span A': shift(op(ten, kij, (x, y) => (x + y) / 2), k), 'Span B': shift(mid(sb), k), Lagging: shift(C(b), -k) };
  } },
  { id: 'adx', name: 'ADX and DI', group: 'Trend', pane: true, inputs: N(14), calc: (b, n) => adx(b, n) },
  { id: 'aroon', name: 'Aroon', group: 'Trend', pane: true, inputs: N(25), calc: (b, n) => aroon(b, n) },
  { id: 'vortex', name: 'Vortex Indicator', group: 'Trend', pane: true, inputs: N(14), calc: (b, n) => {
    const t = sumN(trueRange(b), n), vp = sumN(b.map((x, i) => (i ? Math.abs(x.high - b[i - 1].low) : null)), n), vm = sumN(b.map((x, i) => (i ? Math.abs(x.low - b[i - 1].high) : null)), n);
    return { 'VI+': div(vp, t), 'VI-': div(vm, t) };
  } },
  { id: 'chop', name: 'Choppiness Index', group: 'Trend', pane: true, levels: [61.8, 38.2], inputs: N(14), calc: (b, n) => ({ CHOP: op(sumN(trueRange(b), n), op(hh(H(b), n), ll(L(b), n), (x, y) => x - y), (s, r) => (r > 0 ? (100 * Math.log10(s / r)) / Math.log10(n) : NaN)).map(x => (x != null && !Number.isFinite(x) ? null : x)) }) },
  { id: 'elder', name: 'Elder Ray', group: 'Trend', pane: true, inputs: N(13), calc: (b, n) => { const e = ema(C(b), n); return { 'Bull power': sub(H(b), e), 'Bear power': sub(L(b), e) } } },
  { id: 'dpo', name: 'Detrended Price Oscillator', group: 'Trend', pane: true, inputs: N(21), calc: (b, n) => ({ DPO: sub(shift(C(b), -(Math.floor(n / 2) + 1)), sma(C(b), n)) }) },
  { id: 'linregslope', name: 'Linear Regression Slope', group: 'Trend', pane: true, inputs: N(20), calc: (b, n) => ({ Slope: linreg(C(b), n).slope }) },
  // ----- momentum / oscillators -----
  osc('rsi', 'RSI', 14, (b, n) => ({ RSI: rsi(C(b), n) }), { levels: [70, 30] }),
  { id: 'stochrsi', name: 'Stochastic RSI', group: 'Momentum', pane: true, levels: [80, 20], inputs: [I('RSI length', 14), I('Stochastic length', 14), I('%K smoothing', 3), I('%D smoothing', 3)], calc: (b, n, m, k, d) => {
    const r = rsi(C(b), n), lo = ll(r, m), hi = hh(r, m), raw = mapS(op(sub(r, lo), sub(hi, lo), (x, y) => (y === 0 ? 0 : (100 * x) / y)), x => x), K = sma(raw, k);
    return { '%K': K, '%D': sma(K, d) };
  } },
  { id: 'stoch', name: 'Stochastic', group: 'Momentum', pane: true, levels: [80, 20], inputs: [I('%K length', 14), I('%D smoothing', 3)], calc: (b, n, d) => stoch(b, n, d) },
  { id: 'macd', name: 'MACD', group: 'Momentum', pane: true, inputs: [I('Fast', 12), I('Slow', 26), I('Signal', 9)], calc: (b, f, s, g) => macd(C(b), f, s, g) },
  { id: 'ppo', name: 'Percentage Price Oscillator', group: 'Momentum', pane: true, inputs: [I('Fast', 12), I('Slow', 26), I('Signal', 9)], calc: (b, f, s, g) => {
    const line = mapS(div(sub(ema(C(b), f), ema(C(b), s)), ema(C(b), s)), x => 100 * x), sig = ema(line, g);
    return { PPO: line, Signal: sig, Hist: sub(line, sig) };
  } },
  osc('cci', 'CCI', 20, (b, n) => {
    const t = tp(b), m = sma(t, n);
    const dev: S = t.map((_, i) => { if (m[i] == null) return null; let s = 0; for (let j = i - n + 1; j <= i; j++) s += Math.abs(t[j]! - m[i]!); return s / n });
    return { CCI: op(sub(t, m), dev, (x, d) => (d === 0 ? 0 : x / (0.015 * d))) };
  }, { levels: [100, -100] }),
  osc('willr', 'Williams %R', 14, (b, n) => ({ '%R': op(op(hh(H(b), n), C(b), (h, c) => h - c), op(hh(H(b), n), ll(L(b), n), (h, l) => h - l), (a, r) => (r === 0 ? 0 : (-100 * a) / r)) }), { levels: [-20, -80] }),
  osc('roc', 'Rate of Change', 9, (b, n) => ({ ROC: roc(C(b), n) }), { levels: [0] }),
  osc('mom', 'Momentum', 10, (b, n) => ({ MOM: sub(C(b), lag(C(b), n)) }), { levels: [0] }),
  osc('trix', 'TRIX', 15, (b, n) => { const t = ema(ema(ema(C(b), n), n), n); return { TRIX: mapS(div(sub(t, lag(t, 1)), lag(t, 1)), x => 100 * x) } }, { levels: [0] }),
  { id: 'ao', name: 'Awesome Oscillator', group: 'Momentum', pane: true, inputs: [I('Fast', 5), I('Slow', 34)], calc: (b, f, s) => ({ Hist: sub(sma(hl2(b), f), sma(hl2(b), s)) }) },
  { id: 'ac', name: 'Accelerator Oscillator', group: 'Momentum', pane: true, inputs: [], calc: b => { const ao = sub(sma(hl2(b), 5), sma(hl2(b), 34)); return { Hist: sub(ao, sma(ao, 5)) } } },
  osc('cmo', 'Chande Momentum Oscillator', 9, (b, n) => {
    const d = sub(C(b), lag(C(b), 1)), up = sumN(mapS(d, x => Math.max(x, 0)), n), dn = sumN(mapS(d, x => Math.max(-x, 0)), n);
    return { CMO: op(up, dn, (u, w) => (u + w === 0 ? 0 : (100 * (u - w)) / (u + w))) };
  }, { levels: [50, -50] }),
  { id: 'coppock', name: 'Coppock Curve', group: 'Momentum', pane: true, inputs: [I('WMA length', 10), I('Long ROC', 14), I('Short ROC', 11)], calc: (b, w, l, s) => ({ Coppock: wma(add(roc(C(b), l), roc(C(b), s)), w) }) },
  { id: 'uo', name: 'Ultimate Oscillator', group: 'Momentum', pane: true, levels: [70, 30], inputs: [I('Fast', 7), I('Middle', 14), I('Slow', 28)], calc: (b, f, m, s) => {
    const pc = b.map((x, i) => (i ? b[i - 1].close : x.close)), bp = b.map((x, i) => x.close - Math.min(x.low, pc[i])), tr = b.map((x, i) => Math.max(x.high, pc[i]) - Math.min(x.low, pc[i]));
    const avg = (n: number) => div(sumN(bp, n), sumN(tr, n)), a = avg(f), c2 = avg(m), d = avg(s);
    return { UO: a.map((x, i) => (x == null || c2[i] == null || d[i] == null ? null : (100 * (4 * x + 2 * c2[i]! + d[i]!)) / 7)) };
  } },
  { id: 'tsi', name: 'True Strength Index', group: 'Momentum', pane: true, inputs: [I('Long', 25), I('Short', 13), I('Signal', 13)], calc: (b, l, s, g) => {
    const m = sub(C(b), lag(C(b), 1)), num = ema(ema(m, l), s), den = ema(ema(mapS(m, Math.abs), l), s), t = mapS(div(num, den), x => 100 * x);
    return { TSI: t, Signal: ema(t, g) };
  } },
  { id: 'kst', name: 'Know Sure Thing', group: 'Momentum', pane: true, inputs: [], calc: b => {
    const k = add(add(sma(roc(C(b), 10), 10), mapS(sma(roc(C(b), 15), 10), x => 2 * x)), add(mapS(sma(roc(C(b), 20), 10), x => 3 * x), mapS(sma(roc(C(b), 30), 15), x => 4 * x)));
    return { KST: k, Signal: sma(k, 9) };
  } },
  { id: 'fisher', name: 'Fisher Transform', group: 'Momentum', pane: true, inputs: N(9), calc: (b, n) => {
    const m = hl2(b), hi = hh(m, n), lo = ll(m, n), fish: S = [], trig: S = [];
    let v = 0, f = 0;
    m.forEach((x, i) => {
      if (hi[i] == null || lo[i] == null) { fish.push(null); trig.push(null); return }
      const pf = f; v = 0.66 * ((hi[i] === lo[i] ? 0.5 : (x! - lo[i]!) / (hi[i]! - lo[i]!)) - 0.5) + 0.67 * v; v = Math.max(-0.999, Math.min(0.999, v));
      f = 0.5 * Math.log((1 + v) / (1 - v)) + 0.5 * f; fish.push(f); trig.push(pf);
    });
    return { Fisher: fish, Trigger: trig };
  } },
  osc('bop', 'Balance of Power', 14, (b, n) => ({ BOP: sma(b.map(x => (x.high === x.low ? 0 : (x.close - x.open) / (x.high - x.low))), n) }), { levels: [0] }),
  osc('mass', 'Mass Index', 25, (b, n) => { const e1 = ema(b.map(x => x.high - x.low), 9), e2 = ema(e1, 9); return { Mass: sumN(div(e1, e2), n) } }, { levels: [27, 26.5] }),
  // ----- volatility -----
  { id: 'bb', name: 'Bollinger Bands', group: 'Volatility', inputs: [I('Length', 20), I('Multiplier', 2, 0.1, 0.1)], calc: (b, n, k) => bb(C(b), n, k) },
  { id: 'keltner', name: 'Keltner Channels', group: 'Volatility', inputs: [I('Length', 20), I('Multiplier', 2, 0.1, 0.1), I('ATR length', 10)], calc: (b, n, m, a) => { const mid = ema(C(b), n), r = atr(b, a); return { Upper: add(mid, mapS(r, x => m * x)), Basis: mid, Lower: sub(mid, mapS(r, x => m * x)) } } },
  { id: 'donchian', name: 'Donchian Channels', group: 'Volatility', inputs: N(20), calc: (b, n) => { const u = hh(H(b), n), l = ll(L(b), n); return { Upper: u, Basis: op(u, l, (x, y) => (x + y) / 2), Lower: l } } },
  { id: 'envelope', name: 'Moving Average Envelope', group: 'Volatility', inputs: [I('Length', 20), I('Percent', 10, 0.1, 0.1)], calc: (b, n, p) => { const m = sma(C(b), n); return { Upper: mapS(m, x => x * (1 + p / 100)), Basis: m, Lower: mapS(m, x => x * (1 - p / 100)) } } },
  { id: 'chandelier', name: 'Chandelier Exit', group: 'Volatility', inputs: [I('Length', 22), I('Multiplier', 3, 0.1, 0.1)], calc: (b, n, m) => { const r = mapS(atr(b, n), x => m * x); return { 'Long exit': sub(hh(H(b), n), r), 'Short exit': add(ll(L(b), n), r) } } },
  { id: 'atr', name: 'Average True Range', group: 'Volatility', pane: true, inputs: N(14), calc: (b, n) => ({ ATR: atr(b, n) }) },
  osc('natr', 'Normalized ATR', 14, (b, n) => ({ NATR: mapS(div(atr(b, n), C(b)), x => 100 * x) }), { group: 'Volatility' }),
  { id: 'tr', name: 'True Range', group: 'Volatility', pane: true, inputs: [], calc: b => ({ TR: trueRange(b) }) },
  { id: 'stdev', name: 'Standard Deviation', group: 'Volatility', pane: true, inputs: N(20), calc: (b, n) => ({ StdDev: stdev(C(b), n) }) },
  { id: 'hv', name: 'Historical Volatility', group: 'Volatility', pane: true, inputs: N(10), calc: (b, n) => { const r = mapS(div(C(b), lag(C(b), 1)), Math.log); return { HV: mapS(stdev(r, n), x => 100 * x * Math.sqrt(252)) } } },
  { id: 'bbpb', name: 'Bollinger %B', group: 'Volatility', pane: true, levels: [1, 0], inputs: [I('Length', 20), I('Multiplier', 2, 0.1, 0.1)], calc: (b, n, k) => { const x = bb(C(b), n, k); return { '%B': div(sub(C(b), x.Lower), sub(x.Upper, x.Lower)) } } },
  { id: 'bbw', name: 'Bollinger Bandwidth', group: 'Volatility', pane: true, inputs: [I('Length', 20), I('Multiplier', 2, 0.1, 0.1)], calc: (b, n, k) => { const x = bb(C(b), n, k); return { Bandwidth: div(sub(x.Upper, x.Lower), x.Basis) } } },
  // ----- popular community-style studies, written from their published formulas -----
  { id: 'squeeze', name: 'Squeeze Momentum', group: 'Momentum', pane: true, inputs: [I('Length', 20), I('BB multiplier', 2, 0.1, 0.1), I('KC multiplier', 1.5, 0.1, 0.1)], calc: (b, n, bm, km) => {
    const c = C(b), basis = sma(c, n), dev = mapS(stdev(c, n), x => bm * x), range = sma(trueRange(b), n);
    const on = b.map((_, i) => (basis[i] == null || dev[i] == null || range[i] == null ? null : basis[i]! + dev[i]! < basis[i]! + km * range[i]! && basis[i]! - dev[i]! > basis[i]! - km * range[i]!));
    const mid = op(op(hh(H(b), n), ll(L(b), n), (x, y) => (x + y) / 2), basis, (x, y) => (x + y) / 2);
    return { Hist: linreg(sub(c, mid), n).value, 'Squeeze on': on.map(x => (x ? 0 : null)) };
  } },
  { id: 'wavetrend', name: 'WaveTrend Oscillator', group: 'Momentum', pane: true, levels: [60, -60, 0], inputs: [I('Channel', 10), I('Average', 21), I('Signal', 4)], calc: (b, n, a, g) => {
    const ap = tp(b), esa = ema(ap, n), d = ema(mapS(sub(ap, esa), Math.abs), n), ci = op(sub(ap, esa), d, (x, y) => (y === 0 ? 0 : x / (0.015 * y))), wt1 = ema(ci, a);
    return { WT1: wt1, WT2: sma(wt1, g) };
  } },
  { id: 'stc', name: 'Schaff Trend Cycle', group: 'Momentum', pane: true, levels: [75, 25], inputs: [I('Cycle', 10), I('Fast', 23), I('Slow', 50)], calc: (b, n, f, sl) => {
    const m = sub(ema(C(b), f), ema(C(b), sl));
    const smooth = (v: S): S => { let prev: number | null = null; return v.map(x => { if (x == null) return null; prev = prev == null ? x : prev + 0.5 * (x - prev); return prev }) };
    const st = (v: S): S => { const lo = ll(v, n), hi = hh(v, n); return v.map((x, i) => (x == null || lo[i] == null || hi[i] == null ? null : hi[i] === lo[i] ? 50 : (100 * (x - lo[i]!)) / (hi[i]! - lo[i]!))) };
    return { STC: smooth(st(smooth(st(m)))).map(x => (x == null ? null : Math.max(0, Math.min(100, x)))) };
  } },
  { id: 'rvi', name: 'Relative Vigor Index', group: 'Momentum', pane: true, inputs: N(10), calc: (b, n) => {
    const sw = (v: S): S => v.map((x, i) => (i < 3 || x == null || v[i - 1] == null || v[i - 2] == null || v[i - 3] == null ? null : (x + 2 * v[i - 1]! + 2 * v[i - 2]! + v[i - 3]!) / 6));
    const r = div(sma(sw(b.map(x => x.close - x.open)), n), sma(sw(b.map(x => x.high - x.low)), n));
    return { RVI: r, Signal: sw(r) };
  } },
  { id: 'smi', name: 'Stochastic Momentum Index', group: 'Momentum', pane: true, levels: [40, -40], inputs: [I('Length', 10), I('Smoothing', 3)], calc: (b, n, k) => {
    const hi = hh(H(b), n), lo = ll(L(b), n), mid = op(hi, lo, (x, y) => (x + y) / 2), d = sub(C(b), mid), r = op(hi, lo, (x, y) => x - y);
    const smi = mapS(div(ema(ema(d, k), k), mapS(ema(ema(r, k), k), x => x / 2)), x => 100 * x);
    return { SMI: smi, Signal: ema(smi, k) };
  } },
  ma('t3', 'Tillson T3', 5, (b, n) => { const v = 0.7, e1 = ema(C(b), n), e2 = ema(e1, n), e3 = ema(e2, n), e4 = ema(e3, n), e5 = ema(e4, n), e6 = ema(e5, n);
    return e6.map((x, i) => (x == null || e5[i] == null || e4[i] == null || e3[i] == null ? null : -(v ** 3) * x + (3 * v ** 2 + 3 * v ** 3) * e5[i]! + (-6 * v ** 2 - 3 * v - 3 * v ** 3) * e4[i]! + (1 + 3 * v + v ** 3 + 3 * v ** 2) * e3[i]!)) }),
  ma('vidya', 'VIDYA', 14, (b, n) => {
    const c = C(b), d = sub(c, lag(c, 1)), up = sumN(mapS(d, x => Math.max(x, 0)), 9), dn = sumN(mapS(d, x => Math.max(-x, 0)), 9), al = 2 / (n + 1);
    let prev: number | null = null;
    return c.map((x, i) => { const u = up[i], w = dn[i]; if (x == null || u == null || w == null) return null; const k = u + w === 0 ? 0 : Math.abs((u - w) / (u + w)); prev = prev == null ? x : al * k * x + (1 - al * k) * prev; return prev });
  }),
  { id: 'chandekroll', name: 'Chande Kroll Stop', group: 'Volatility', inputs: [I('ATR length', 10), I('Multiplier', 1, 0.1, 0.1), I('Stop length', 9)], calc: (b, p, x, q) => {
    const a = mapS(atr(b, p), v => x * v), hs = sub(hh(H(b), p), a), ls = add(ll(L(b), p), a);
    return { 'Stop short': hh(hs, q), 'Stop long': ll(ls, q) };
  } },
  { id: 'lrchannel', name: 'Linear Regression Channel', group: 'Volatility', inputs: [I('Length', 100), I('Deviations', 2, 0.1, 0.1)], calc: (b, n, k) => { const m = linreg(C(b), n).value, sd = mapS(stdev(C(b), n), x => k * x); return { Upper: add(m, sd), Basis: m, Lower: sub(m, sd) } } },
  // ----- volume -----
  { id: 'vwap', name: 'VWAP', group: 'Volume', inputs: [], calc: b => ({ VWAP: vwap(b) }) },
  { id: 'obv', name: 'On Balance Volume', group: 'Volume', pane: true, inputs: [], calc: b => { let o = 0; return { OBV: b.map((x, i) => (o += i ? Math.sign(x.close - b[i - 1].close) * x.volume : 0)) } } },
  { id: 'adl', name: 'Accumulation / Distribution', group: 'Volume', pane: true, inputs: [], calc: b => ({ ADL: adl(b) }) },
  { id: 'pvt', name: 'Price Volume Trend', group: 'Volume', pane: true, inputs: [], calc: b => ({ PVT: cum(b.map((x, i) => (i && b[i - 1].close ? ((x.close - b[i - 1].close) / b[i - 1].close) * x.volume : 0))) }) },
  osc('mfi', 'Money Flow Index', 14, (b, n) => {
    const t = tp(b), mf = b.map((x, i) => t[i]! * x.volume), pos = sumN(b.map((_, i) => (i && t[i]! > t[i - 1]! ? mf[i] : 0)), n), neg = sumN(b.map((_, i) => (i && t[i]! < t[i - 1]! ? mf[i] : 0)), n);
    return { MFI: op(pos, neg, (p, q) => (q === 0 ? 100 : 100 - 100 / (1 + p / q))) };
  }, { group: 'Volume', levels: [80, 20] }),
  osc('cmf', 'Chaikin Money Flow', 20, (b, n) => ({ CMF: div(sumN(b.map(x => (x.high === x.low ? 0 : (((x.close - x.low) - (x.high - x.close)) / (x.high - x.low)) * x.volume)), n), sumN(V(b), n)) }), { group: 'Volume', levels: [0] }),
  { id: 'chaikinosc', name: 'Chaikin Oscillator', group: 'Volume', pane: true, inputs: [I('Fast', 3), I('Slow', 10)], calc: (b, f, s) => ({ Chaikin: sub(ema(adl(b), f), ema(adl(b), s)) }) },
  osc('force', 'Force Index', 13, (b, n) => ({ Force: ema(b.map((x, i) => (i ? (x.close - b[i - 1].close) * x.volume : null)), n) }), { group: 'Volume', levels: [0] }),
  { id: 'volosc', name: 'Volume Oscillator', group: 'Volume', pane: true, inputs: [I('Fast', 5), I('Slow', 10)], calc: (b, f, s) => ({ VO: mapS(div(sub(ema(V(b), f), ema(V(b), s)), ema(V(b), s)), x => 100 * x) }) },
  { id: 'volsma', name: 'Volume SMA', group: 'Volume', pane: true, inputs: N(20), calc: (b, n) => ({ 'Volume SMA': sma(V(b), n) }) },
];

const BY_ID = new Map(LIB.map(d => [d.id, d]));
export const GROUPS: Group[] = ['Moving averages', 'Trend', 'Momentum', 'Volatility', 'Volume'];
const defaults = (d: LibDef) => d.inputs.map(i => i.def);

/** "ema@50" → { id: 'ema', args: [50] }; null when the key is malformed, unknown or the inputs are out of range. */
export function parseKey(key: string): { d: LibDef; args: number[] } | null {
  const [id, rest] = key.split('@');
  const d = BY_ID.get(id);
  if (!d) return null;
  if (rest === undefined) return { d, args: defaults(d) };
  const args = rest.split(',').map(Number);
  if (args.length !== d.inputs.length || args.some((x, i) => !Number.isFinite(x) || x < (d.inputs[i].min ?? 1) || x > 5000)) return null;
  return { d, args };
}
export const keyOf = (id: string, args: number[]) => { const d = BY_ID.get(id); return !d || args.every((x, i) => x === d.inputs[i]?.def) ? id : `${id}@${args.join(',')}` };

/** What the chart draws for a stored key: the original built-ins first (their names stay as they were), then library entries with their inputs. */
export function indicatorDef(key: string): IndicatorDef | undefined {
  if (Object.hasOwn(INDICATORS, key)) return INDICATORS[key];
  const p = parseKey(key);
  if (!p) return undefined;
  const { d, args } = p, custom = key.includes('@');
  return { name: custom || d.inputs.length ? `${d.name}${d.inputs.length ? ` (${args.join(', ')})` : ''}` : d.name, pane: d.pane, levels: d.levels, calc: b => d.calc(b, ...args) };
}
