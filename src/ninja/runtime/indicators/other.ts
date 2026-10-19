// Channels, trend-following and price-structure indicators. Sessions are UTC calendar days (no exchange session templates).
import { def, max, min, n, put, ser, v, type S } from './util.ts';

const I = (s: S, k = 0) => s.Input.get(k);
const H = (s: S, k = 0) => s.High.get(k), L = (s: S, k = 0) => s.Low.get(k), C = (s: S, k = 0) => s.Close.get(k), O = (s: S, k = 0) => s.Open.get(k);
const barTime = (s: S) => s.__b.bars[s.CurrentBar].time as number;

def('Bollinger', {
  p: { NumStdDev: 2, Period: 14 }, overlay: true, plots: ['Upper', 'Middle', 'Lower'],
  bar: s => { const m = v(s.SMA(s.Input, s.Period)), d = s.NumStdDev * v(s.StdDev(s.Input, s.Period)); put(s, m + d, 0); put(s, m, 1); put(s, m - d, 2) },
});
def('DonchianChannel', {
  p: { Period: 14 }, overlay: true, plots: ['Mean', 'Upper', 'Lower'],
  bar: s => { const len = n(s, s.Period), u = max(s.High, len), l = min(s.Low, len); put(s, (u + l) / 2, 0); put(s, u, 1); put(s, l, 2) },
});
def('KeltnerChannel', {
  p: { OffsetMultiplier: 1.5, Period: 10 }, overlay: true, plots: ['Midline', 'Upper', 'Lower'],
  bar: s => { const m = v(s.SMA(s.Typical, s.Period)), o = v(s.SMA(s.Range(), s.Period)) * s.OffsetMultiplier; put(s, m, 0); put(s, m + o, 1); put(s, m - o, 2) },
});
// Wilder's Parabolic SAR; the trend on bar 1 follows the first close-to-close move.
def('ParabolicSAR', {
  p: { Acceleration: 0.02, AccelerationMax: 0.2, AccelerationStep: 0.02 }, overlay: true, plots: [['ParabolicSAR', 'ParabolicSAR', 'Dot']],
  bar: s => {
    const cb = s.CurrentBar;
    if (cb === 0) { s.sar = L(s); return put(s, s.sar) }
    if (cb === 1) {
      s.long = C(s) >= C(s, 1); s.af = s.Acceleration;
      s.ep = s.long ? Math.max(H(s), H(s, 1)) : Math.min(L(s), L(s, 1)); s.sar = s.long ? Math.min(L(s), L(s, 1)) : Math.max(H(s), H(s, 1));
      return put(s, s.sar);
    }
    let sar = s.sar + s.af * (s.ep - s.sar);
    if (s.long) {
      sar = Math.min(sar, L(s, 1), L(s, 2));
      if (L(s) < sar) { s.long = false; sar = s.ep; s.ep = L(s); s.af = s.Acceleration }
      else if (H(s) > s.ep) { s.ep = H(s); s.af = Math.min(s.af + s.AccelerationStep, s.AccelerationMax) }
    } else {
      sar = Math.max(sar, H(s, 1), H(s, 2));
      if (H(s) > sar) { s.long = true; sar = s.ep; s.ep = H(s); s.af = s.Acceleration }
      else if (L(s) < s.ep) { s.ep = L(s); s.af = Math.min(s.af + s.AccelerationStep, s.AccelerationMax) }
    }
    s.sar = sar; put(s, sar);
  },
});
/** barsAgo of the instance-th most recent pivot in `list` at or before `barsAgo`, within lookBack bars; -1 if none. */
function pivotBar(s: S, list: { bar: number }[], barsAgo: number, instance: number, lookBack: number) {
  const cur = s.CurrentBar, end = cur - barsAgo, start = end - lookBack;
  const hits = list.filter(p => p.bar <= end && p.bar >= start).sort((a, b) => b.bar - a.bar);
  const p = hits[Math.max(1, instance) - 1];
  return p ? cur - p.bar : -1;
}
// Swing: a bar whose high (low) is strictly above (below) the Strength bars on each side; plots hold the latest swing level.
def('Swing', {
  p: { Strength: 5 }, overlay: true, plots: [['SwingHigh', 'Swing high', 'Dot'], ['SwingLow', 'Swing low', 'Dot']], init: s => { s.highs = []; s.lows = [] },
  bar: s => {
    const st = s.Strength, cb = s.CurrentBar;
    if (cb >= 2 * st) {
      const ph = H(s, st), pl = L(s, st);
      let hi = true, lo = true;
      for (let j = 1; j <= st; j++) {
        if (!(ph > H(s, st + j) && ph > H(s, st - j))) hi = false;
        if (!(pl < L(s, st + j) && pl < L(s, st - j))) lo = false;
      }
      if (hi) { s.highs.push({ bar: cb - st, price: ph }); for (let k = 0; k <= st; k++) s.Values[0].set(k, ph) }
      if (lo) { s.lows.push({ bar: cb - st, price: pl }); for (let k = 0; k <= st; k++) s.Values[1].set(k, pl) }
    }
    if (!s.Values[0].IsValidDataPoint(0) && s.highs.length) put(s, s.highs.at(-1).price, 0);
    if (!s.Values[1].IsValidDataPoint(0) && s.lows.length) put(s, s.lows.at(-1).price, 1);
  },
  m: {
    SwingHighBar(barsAgo: number, instance: number, lookBack: number) { return pivotBar(this, this.highs, barsAgo, instance, lookBack) },
    SwingLowBar(barsAgo: number, instance: number, lookBack: number) { return pivotBar(this, this.lows, barsAgo, instance, lookBack) },
  },
});
// ZigZag: reversal once price retraces DeviationValue points/percent from the running extreme. Plot values only on pivots
// (the last, unconfirmed leg end is plotted tentatively and moved as it extends).
def('ZigZag', {
  p: { DeviationType: 'Points', DeviationValue: 0.5, UseHighLow: false }, overlay: true, plots: ['ZigZag'],
  init: s => { s.dir = 0; s.piv = []; s.tb = -1; s.ZigZagHigh = ser(s); s.ZigZagLow = ser(s) },
  bar: s => {
    const cb = s.CurrentBar, h = s.UseHighLow ? H(s) : I(s), l = s.UseHighLow ? L(s) : I(s);
    const dev = (p: number) => (s.DeviationType === 'Percent' ? (Math.abs(p) * s.DeviationValue) / 100 : s.DeviationValue);
    const tent = (bar: number, price: number) => { if (s.tb >= 0 && s.tb !== bar) s.Values[0].Reset(cb - s.tb); s.tb = bar; s.Values[0].set(cb - bar, price) };
    const mark = (bar: number, price: number, hi: boolean) => {
      s.piv.push({ bar, price, hi }); s.Values[0].set(cb - bar, price); (hi ? s.ZigZagHigh : s.ZigZagLow).set(cb - bar, price); s.tb = -1;
    };
    if (s.dir === 0) {
      if (cb === 0 || h > s.hp) { s.hp = h; s.hb = cb }
      if (cb === 0 || l < s.lp) { s.lp = l; s.lb = cb }
      if (s.lb < cb && h - s.lp >= dev(s.lp)) { mark(s.lb, s.lp, false); s.dir = 1; s.ep = h; s.eb = cb; tent(cb, h) }
      else if (s.hb < cb && s.hp - l >= dev(s.hp)) { mark(s.hb, s.hp, true); s.dir = -1; s.ep = l; s.eb = cb; tent(cb, l) }
    } else if (s.dir === 1) {
      if (h > s.ep) { s.ep = h; s.eb = cb; tent(cb, h) }
      else if (s.ep - l >= dev(s.ep)) { mark(s.eb, s.ep, true); s.dir = -1; s.ep = l; s.eb = cb; tent(cb, l) }
    } else {
      if (l < s.ep) { s.ep = l; s.eb = cb; tent(cb, l) }
      else if (h - s.ep >= dev(s.ep)) { mark(s.eb, s.ep, false); s.dir = 1; s.ep = h; s.eb = cb; tent(cb, h) }
    }
  },
  m: {
    HighBar(barsAgo: number, instance: number, lookBack: number) { return pivotBar(this, this.piv.filter((p: any) => p.hi), barsAgo, instance, lookBack) },
    LowBar(barsAgo: number, instance: number, lookBack: number) { return pivotBar(this, this.piv.filter((p: any) => !p.hi), barsAgo, instance, lookBack) },
  },
});
const periodKey = (range: string, t: number) => {
  if (range === 'Weekly') return Math.floor((t - 345600) / 604800);
  if (range === 'Monthly') { const d = new Date(t * 1000); return d.getUTCFullYear() * 12 + d.getUTCMonth() }
  return Math.floor(t / 86400);
};
// Classic floor pivots from the prior period's high/low/close (or user-defined values).
def('Pivots', {
  p: { PivotRange: 'Daily', HLCCalculationMode: 'CalcFromIntradayData', UserDefinedClose: 0, UserDefinedHigh: 0, UserDefinedLow: 0, Width: 20 },
  overlay: true, plots: ['Pp', 'R1', 'R2', 'R3', 'S1', 'S2', 'S3'],
  bar: s => {
    const key = periodKey(s.PivotRange, barTime(s));
    if (s.key !== key) { if (s.key != null) s.prev = { h: s.h, l: s.l, c: s.c }; s.key = key; s.h = H(s); s.l = L(s) }
    else { s.h = Math.max(s.h, H(s)); s.l = Math.min(s.l, L(s)) }
    s.c = C(s);
    const p = s.HLCCalculationMode === 'UserDefinedValues' ? { h: s.UserDefinedHigh, l: s.UserDefinedLow, c: s.UserDefinedClose } : s.prev;
    if (!p) return;
    const pp = (p.h + p.l + p.c) / 3, r = p.h - p.l;
    [pp, 2 * pp - p.l, pp + r, p.h + 2 * (pp - p.l), 2 * pp - p.h, pp - r, p.l - 2 * (p.h - pp)].forEach((x, i) => put(s, x, i));
  },
});
def('CurrentDayOHL', {
  overlay: true, plots: ['CurrentOpen', 'CurrentHigh', 'CurrentLow'],
  bar: s => {
    const key = periodKey('Daily', barTime(s));
    if (s.key !== key) { s.key = key; s.o = O(s); s.h = H(s); s.l = L(s) } else { s.h = Math.max(s.h, H(s)); s.l = Math.min(s.l, L(s)) }
    put(s, s.o, 0); put(s, s.h, 1); put(s, s.l, 2);
  },
});
def('PriorDayOHLC', {
  overlay: true, plots: ['PriorOpen', 'PriorHigh', 'PriorLow', 'PriorClose'],
  bar: s => {
    const key = periodKey('Daily', barTime(s));
    if (s.key !== key) { if (s.key != null) s.prev = [s.o, s.h, s.l, s.c]; s.key = key; s.o = O(s); s.h = H(s); s.l = L(s) }
    else { s.h = Math.max(s.h, H(s)); s.l = Math.min(s.l, L(s)) }
    s.c = C(s);
    if (s.prev) s.prev.forEach((x: number, i: number) => put(s, x, i));
  },
});
