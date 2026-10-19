// Moving averages and statistics. Windows shorter than Period are used while CurrentBar+1 < Period (NT behaviour).
import { NtSeries } from '../series.ts';
import { def, ema, max, min, n, put, ser, sum, v, type S } from './util.ts';

const I = (s: S, k = 0) => s.Input.get(k);
const P14 = { Period: 14 };

def('SMA', { p: P14, overlay: true, plots: ['SMA'], bar: s => { const len = n(s, s.Period); put(s, sum(s.Input, len) / len) } });
def('EMA', { p: P14, overlay: true, plots: ['EMA'], bar: s => put(s, ema(s, I(s), s.Value, s.Period)) });
function wma(x: NtSeries, len: number) { let a = 0, w = 0; for (let k = 0; k < len; k++) { a += (len - k) * x.get(k); w += len - k } return a / w }
def('WMA', { p: P14, overlay: true, plots: ['WMA'], bar: s => put(s, wma(s.Input, n(s, s.Period))) });
def('HMA', {
  p: { Period: 21 }, overlay: true, plots: ['HMA'], init: s => { s.d = ser(s) },
  bar: s => {
    s.d.set(0, 2 * v(s.WMA(s.Input, Math.max(1, Math.floor(s.Period / 2)))) - v(s.WMA(s.Input, s.Period)));
    put(s, v(s.WMA(s.d, Math.max(1, Math.floor(Math.sqrt(s.Period))))));
  },
});
def('TMA', {
  p: P14, overlay: true, plots: ['TMA'],
  bar: s => { const odd = s.Period % 2 === 1, p1 = odd ? (s.Period + 1) / 2 : s.Period / 2, p2 = odd ? p1 : p1 + 1; put(s, v(s.SMA(s.SMA(s.Input, p1), p2))) },
});
def('DEMA', { p: P14, overlay: true, plots: ['DEMA'], bar: s => { const e1 = s.EMA(s.Input, s.Period); put(s, 2 * v(e1) - v(s.EMA(e1, s.Period))) } });
def('TEMA', {
  p: P14, overlay: true, plots: ['TEMA'],
  bar: s => { const e1 = s.EMA(s.Input, s.Period), e2 = s.EMA(e1, s.Period), e3 = s.EMA(e2, s.Period); put(s, 3 * v(e1) - 3 * v(e2) + v(e3)) },
});
def('ZLEMA', {
  p: P14, overlay: true, plots: ['ZLEMA'],
  bar: s => {
    const lag = Math.floor((s.Period - 1) / 2), k = 2 / (s.Period + 1);
    put(s, s.CurrentBar === 0 || s.CurrentBar < lag ? I(s) : k * (2 * I(s) - I(s, lag)) + (1 - k) * s.Value.get(1));
  },
});
def('KAMA', {
  p: { Fast: 2, Period: 10, Slow: 30 }, overlay: true, plots: ['KAMA'],
  bar: s => {
    if (s.CurrentBar < s.Period) return put(s, I(s));
    let noise = 0; for (let k = 0; k < s.Period; k++) noise += Math.abs(I(s, k) - I(s, k + 1));
    const er = noise === 0 ? 0 : Math.abs(I(s) - I(s, s.Period)) / noise, f = 2 / (s.Fast + 1), sl = 2 / (s.Slow + 1);
    const sc = (er * (f - sl) + sl) ** 2, prev = s.Value.get(1);
    put(s, prev + sc * (I(s) - prev));
  },
});
def('VWMA', {
  p: P14, overlay: true, plots: ['VWMA'],
  bar: s => { const len = n(s, s.Period); let a = 0, w = 0; for (let k = 0; k < len; k++) { a += I(s, k) * s.Volume.get(k); w += s.Volume.get(k) } put(s, w ? a / w : I(s)) },
});
/** Least-squares line over the window; x = 0 is the oldest bar. */
function linreg(s: S) {
  const len = n(s, s.Period);
  if (len < 2) return { slope: 0, icpt: I(s), len, val: I(s) };
  let sy = 0, sxy = 0;
  for (let k = 0; k < len; k++) { const x = len - 1 - k, y = I(s, k); sy += y; sxy += x * y }
  const sx = (len * (len - 1)) / 2, sx2 = ((len - 1) * len * (2 * len - 1)) / 6;
  const slope = (len * sxy - sx * sy) / (len * sx2 - sx * sx), icpt = (sy - slope * sx) / len;
  return { slope, icpt, len, val: icpt + slope * (len - 1) };
}
def('LinReg', { p: P14, overlay: true, plots: ['LinReg'], bar: s => put(s, linreg(s).val) });
def('LinRegSlope', { p: P14, plots: ['LinRegSlope'], bar: s => put(s, linreg(s).slope) });
def('LinRegIntercept', { p: P14, overlay: true, plots: ['LinRegIntercept'], bar: s => put(s, linreg(s).icpt) });
def('StdDev', {
  p: P14, plots: ['StdDev'],
  bar: s => { const len = n(s, s.Period), m = sum(s.Input, len) / len; let a = 0; for (let k = 0; k < len; k++) a += (I(s, k) - m) ** 2; put(s, Math.sqrt(a / len)) },
});
def('StdError', {
  p: P14, overlay: true, plots: ['Upper', 'Middle', 'Lower'],
  bar: s => {
    const r = linreg(s); let a = 0;
    for (let k = 0; k < r.len; k++) a += (I(s, k) - (r.icpt + r.slope * (r.len - 1 - k))) ** 2;
    const e = Math.sqrt(a / r.len);
    put(s, r.val + e, 0); put(s, r.val, 1); put(s, r.val - e, 2);
  },
});
def('MAX', { p: P14, overlay: true, plots: ['MAX'], bar: s => put(s, max(s.Input, n(s, s.Period))) });
def('MIN', { p: P14, overlay: true, plots: ['MIN'], bar: s => put(s, min(s.Input, n(s, s.Period))) });
def('SUM', { p: P14, plots: ['SUM'], bar: s => put(s, sum(s.Input, n(s, s.Period))) });
def('Range', { plots: ['Range'], bar: s => put(s, s.High.get(0) - s.Low.get(0)) });
