// Oscillators and volatility/volume indicators.
import { def, ema, max, min, n, put, ser, sum, v, type S } from './util.ts';

const I = (s: S, k = 0) => s.Input.get(k);
const H = (s: S, k = 0) => s.High.get(k), L = (s: S, k = 0) => s.Low.get(k), C = (s: S, k = 0) => s.Close.get(k), O = (s: S, k = 0) => s.Open.get(k);
const VOL = (s: S, k = 0) => s.Volume.get(k);
const P14 = { Period: 14 };
const tr = (s: S) => (s.CurrentBar === 0 ? H(s) - L(s) : Math.max(H(s) - L(s), Math.abs(H(s) - C(s, 1)), Math.abs(L(s) - C(s, 1))));

// ATR: running mean of true range for the first Period bars, then Wilder smoothing ((n-1)·prev + TR)/n.
def('ATR', {
  p: P14, plots: ['ATR'],
  bar: s => { const k = Math.min(s.CurrentBar + 1, s.Period); put(s, s.CurrentBar === 0 ? tr(s) : ((k - 1) * s.Value.get(1) + tr(s)) / k) },
});

/** Wilder-smoothed +DM/-DM/TR sums (accumulated for the first Period bars) → DI+ / DI-. State lives on the instance. */
function di(s: S) {
  const P = s.Period;
  if (s.CurrentBar === 0) { s._tr = H(s) - L(s); s._p = 0; s._m = 0 }
  else {
    const up = H(s) - H(s, 1), dn = L(s, 1) - L(s), dp = up > dn ? Math.max(up, 0) : 0, dm = dn > up ? Math.max(dn, 0) : 0, t = tr(s);
    if (s.CurrentBar < P) { s._tr += t; s._p += dp; s._m += dm }
    else { s._tr += t - s._tr / P; s._p += dp - s._p / P; s._m += dm - s._m / P }
  }
  return { p: s._tr ? (100 * s._p) / s._tr : 0, m: s._tr ? (100 * s._m) / s._tr : 0 };
}
const adxNext = (s: S, d: { p: number; m: number }, prev: () => number) => {
  const tot = d.p + d.m;
  return s.CurrentBar === 0 || tot === 0 ? 50 : ((s.Period - 1) * prev() + (100 * Math.abs(d.p - d.m)) / tot) / s.Period;
};
def('ADX', { p: P14, plots: ['ADX'], lines: [[25, 'Lower'], [75, 'Upper']], bar: s => put(s, adxNext(s, di(s), () => s.Value.get(1))) });
def('ADXR', {
  p: { Interval: 10, Period: 14 }, plots: ['ADXR'],
  bar: s => { const a = s.ADX(s.Period); put(s, (v(a) + v(a, Math.min(s.CurrentBar, s.Interval))) / 2) },
});
def('DM', {
  p: P14, plots: ['ADX', ['DiPlus', '+DI'], ['DiMinus', '-DI']],
  bar: s => { const d = di(s); put(s, adxNext(s, d, () => s.Values[0].get(1)), 0); put(s, d.p, 1); put(s, d.m, 2) },
});
def('DMI', { p: P14, plots: ['DMI'], bar: s => { const d = di(s), t = d.p + d.m; put(s, t ? (100 * (d.p - d.m)) / t : 0) } });
function aroon(s: S) {
  let hb = 0, lb = 0;
  for (let k = 1; k <= Math.min(s.Period, s.CurrentBar); k++) { if (H(s, k) > H(s, hb)) hb = k; if (L(s, k) < L(s, lb)) lb = k }
  return { up: (100 * (s.Period - hb)) / s.Period, down: (100 * (s.Period - lb)) / s.Period };
}
def('Aroon', { p: P14, plots: ['Up', 'Down'], bar: s => { const a = aroon(s); put(s, a.up, 0); put(s, a.down, 1) } });
def('AroonOscillator', { p: P14, plots: ['AroonOscillator'], bar: s => { const a = aroon(s); put(s, a.up - a.down) } });
def('BOP', {
  p: { Smooth: 14 }, plots: ['BOP'], init: s => { s.raw = ser(s) },
  bar: s => { s.raw.set(0, H(s) === L(s) ? 0 : (C(s) - O(s)) / (H(s) - L(s))); put(s, v(s.SMA(s.raw, s.Smooth))) },
});
def('CCI', {
  p: P14, plots: ['CCI'], lines: [[200, 'Level 2'], [100, 'Level 1'], [0, 'Zero line'], [-100, 'Level -1'], [-200, 'Level -2']],
  bar: s => {
    if (s.CurrentBar === 0) return put(s, 0);
    const len = n(s, s.Period), m = v(s.SMA(s.Typical, s.Period));
    let md = 0; for (let k = 0; k < len; k++) md += Math.abs(s.Typical.get(k) - m);
    md /= len;
    put(s, md === 0 ? 0 : (s.Typical.get(0) - m) / (0.015 * md));
  },
});
const mfv = (s: S) => (H(s) === L(s) ? 0 : (VOL(s) * ((C(s) - L(s)) - (H(s) - C(s)))) / (H(s) - L(s)));
def('ChaikinMoneyFlow', {
  p: { Period: 21 }, plots: ['CMF'], init: s => { s.mf = ser(s) },
  bar: s => { s.mf.set(0, mfv(s)); const len = n(s, s.Period), vs = sum(s.Volume, len); put(s, vs ? sum(s.mf, len) / vs : 0) },
});
def('ChaikinOscillator', {
  p: { Fast: 3, Slow: 10 }, plots: ['ChaikinOscillator'], init: s => { s.ad = ser(s) },
  bar: s => { s.ad.set(0, (s.CurrentBar ? s.ad.get(1) : 0) + mfv(s)); put(s, v(s.EMA(s.ad, s.Fast)) - v(s.EMA(s.ad, s.Slow))) },
});
def('CMO', {
  p: P14, plots: ['CMO'], init: s => { s.up = ser(s); s.dn = ser(s) },
  bar: s => {
    const d = s.CurrentBar ? I(s) - I(s, 1) : 0; s.up.set(0, Math.max(d, 0)); s.dn.set(0, Math.max(-d, 0));
    const len = n(s, s.Period), u = sum(s.up, len), w = sum(s.dn, len);
    put(s, u + w === 0 ? 0 : (100 * (u - w)) / (u + w));
  },
});
// MACD: EMAs seeded with the first input; Avg = EMA(Smooth) of MACD seeded with 0 on bar 0; Diff = MACD − Avg.
def('MACD', {
  p: { Fast: 12, Slow: 26, Smooth: 9 }, plots: [['Default', 'Macd'], 'Avg', ['Diff', 'Diff', 'Bar']], init: s => { s.fe = ser(s); s.se = ser(s) },
  bar: s => {
    const x = I(s);
    s.fe.set(0, ema(s, x, s.fe, s.Fast)); s.se.set(0, ema(s, x, s.se, s.Slow));
    const m = s.fe.get(0) - s.se.get(0), a = s.CurrentBar === 0 ? 0 : (2 / (1 + s.Smooth)) * m + (1 - 2 / (1 + s.Smooth)) * s.Values[1].get(1);
    put(s, m, 0); put(s, a, 1); put(s, m - a, 2);
  },
});
def('MFI', {
  p: P14, plots: ['MFI'], lines: [[20, 'Lower'], [80, 'Upper']], init: s => { s.pos = ser(s); s.neg = ser(s) },
  bar: s => {
    if (s.CurrentBar === 0) { s.pos.set(0, 0); s.neg.set(0, 0); return put(s, 50) }
    const t = s.Typical.get(0), t1 = s.Typical.get(1);
    s.pos.set(0, t > t1 ? t * VOL(s) : 0); s.neg.set(0, t < t1 ? t * VOL(s) : 0);
    const len = n(s, s.Period), p = sum(s.pos, len), q = sum(s.neg, len);
    put(s, q === 0 ? (p === 0 ? 50 : 100) : 100 - 100 / (1 + p / q));
  },
});
def('Momentum', { p: P14, plots: ['Momentum'], bar: s => put(s, s.CurrentBar === 0 ? 0 : I(s) - I(s, Math.min(s.CurrentBar, s.Period))) });
def('OBV', {
  plots: ['OBV'],
  bar: s => put(s, s.CurrentBar === 0 ? 0 : s.Value.get(1) + (C(s) > C(s, 1) ? VOL(s) : C(s) < C(s, 1) ? -VOL(s) : 0)),
});
def('PPO', {
  p: { Fast: 12, Slow: 26, Smooth: 9 }, plots: [['Default', 'PPO'], 'Smoothed'],
  bar: s => {
    const f = v(s.EMA(s.Input, s.Fast)), sl = v(s.EMA(s.Input, s.Slow));
    put(s, sl ? (100 * (f - sl)) / sl : 0, 0); put(s, v(s.EMA(s.Values[0], s.Smooth)), 1);
  },
});
def('PriceOscillator', {
  p: { Fast: 12, Slow: 26, Smooth: 9 }, plots: ['PriceOscillator'], init: s => { s.d = ser(s) },
  bar: s => { s.d.set(0, v(s.EMA(s.Input, s.Fast)) - v(s.EMA(s.Input, s.Slow))); put(s, v(s.EMA(s.d, s.Smooth))) },
});
def('ROC', { p: P14, plots: ['ROC'], bar: s => { const b = I(s, Math.min(s.CurrentBar, s.Period)); put(s, b === 0 ? 0 : (100 * (I(s) - b)) / b) } });
// RSI: average gain/loss = simple mean of the first Period changes, then Wilder smoothing; Avg = EMA(Smooth) of RSI.
def('RSI', {
  p: { Period: 14, Smooth: 3 }, plots: [['Default', 'RSI'], 'Avg'], lines: [[30, 'Lower'], [70, 'Upper']], init: s => { s.au = ser(s); s.ad = ser(s) },
  bar: s => {
    const cb = s.CurrentBar, P = s.Period;
    if (cb === 0) { s.au.set(0, 0); s.ad.set(0, 0); put(s, 50, 0); put(s, 50, 1); return }
    const d = I(s) - I(s, 1), u = Math.max(d, 0), w = Math.max(-d, 0);
    const au = cb <= P ? (s.au.get(1) * (cb - 1) + u) / cb : (s.au.get(1) * (P - 1) + u) / P;
    const ad = cb <= P ? (s.ad.get(1) * (cb - 1) + w) / cb : (s.ad.get(1) * (P - 1) + w) / P;
    s.au.set(0, au); s.ad.set(0, ad);
    const r = ad === 0 ? 100 : 100 - 100 / (1 + au / ad);
    put(s, r, 0); put(s, (2 / (1 + s.Smooth)) * r + (1 - 2 / (1 + s.Smooth)) * s.Values[1].get(1), 1);
  },
});
// Raw %K over PeriodK (keeps the previous value when the range is flat; 50 on bar 0).
function fastK(s: S) {
  const len = n(s, s.PeriodK), lo = min(s.Low, len), hi = max(s.High, len);
  return hi - lo === 0 ? (s.CurrentBar === 0 ? 50 : s.fk.get(1)) : Math.min(100, Math.max(0, (100 * (C(s) - lo)) / (hi - lo)));
}
def('Stochastics', {
  p: { PeriodD: 7, PeriodK: 14, Smooth: 3 }, plots: ['D', 'K'], lines: [[20, 'Lower'], [80, 'Upper']], init: s => { s.fk = ser(s) },
  bar: s => { s.fk.set(0, fastK(s)); put(s, v(s.SMA(s.fk, s.Smooth)), 1); put(s, v(s.SMA(s.Values[1], s.PeriodD)), 0) },
});
def('StochasticsFast', {
  p: { PeriodD: 3, PeriodK: 14 }, plots: ['D', 'K'], lines: [[20, 'Lower'], [80, 'Upper']], init: s => { s.fk = ser(s) },
  bar: s => { s.fk.set(0, fastK(s)); put(s, s.fk.get(0), 1); put(s, v(s.SMA(s.Values[1], s.PeriodD)), 0) },
});
def('StochRSI', {
  p: P14, plots: ['StochRSI'], lines: [[0.2, 'Lower'], [0.8, 'Upper']],
  bar: s => {
    const r = s.RSI(s.Input, s.Period, 1), x = v(r), mx = v(s.MAX(r, s.Period)), mn = v(s.MIN(r, s.Period));
    put(s, mx === mn ? 0 : (x - mn) / (mx - mn));
  },
});
def('TRIX', {
  p: { Period: 14, SignalPeriod: 3 }, plots: [['Default', 'TRIX'], 'Signal'],
  bar: s => {
    const e3 = s.EMA(s.EMA(s.EMA(s.Input, s.Period), s.Period), s.Period);
    put(s, s.CurrentBar === 0 || v(e3, 1) === 0 ? 0 : (100 * (v(e3) - v(e3, 1))) / v(e3, 1), 0);
    put(s, v(s.EMA(s.Values[0], s.SignalPeriod)), 1);
  },
});
def('UltimateOscillator', {
  p: { Fast: 7, Intermediate: 14, Slow: 28 }, plots: ['UltimateOscillator'], lines: [[30, 'Lower'], [70, 'Upper']], init: s => { s.bp = ser(s); s.tr = ser(s) },
  bar: s => {
    const pc = s.CurrentBar ? C(s, 1) : L(s), lo = Math.min(L(s), pc);
    s.bp.set(0, C(s) - lo); s.tr.set(0, Math.max(H(s), pc) - lo);
    const avg = (p: number) => { const len = n(s, p), t = sum(s.tr, len); return t ? sum(s.bp, len) / t : 0 };
    put(s, (100 * (4 * avg(s.Fast) + 2 * avg(s.Intermediate) + avg(s.Slow))) / 7);
  },
});
def('VOL', { plots: [['VOL', 'Volume', 'Bar']], bar: s => put(s, VOL(s)) });
def('VolumeOscillator', { p: { Fast: 12, Slow: 26 }, plots: ['VolumeOscillator'], bar: s => put(s, v(s.SMA(s.Volume, s.Fast)) - v(s.SMA(s.Volume, s.Slow))) });
def('WilliamsR', {
  p: P14, plots: ['WilliamsR'], lines: [[-20, 'Upper'], [-80, 'Lower']],
  bar: s => { const len = n(s, s.Period), hh = max(s.High, len), ll = min(s.Low, len); put(s, hh === ll ? (s.CurrentBar ? s.Value.get(1) : -50) : (-100 * (hh - C(s))) / (hh - ll)) },
});
