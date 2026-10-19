// Timeseries access relative to env.cur() (shift 0 = forming bar; nothing beyond cur is ever visible).
import type { Bar } from '../../data.ts';
import { MqlArray, type Env, type Rt } from '../contract.ts';
import { num, val, put, isWhole, isTime, idxAt, getter, setErr, type Sources, type Src } from './util.ts';
import { SeriesArray } from './array.ts';
import { MqlRates } from './structs.ts';
import { fillOut } from './indicators.ts';

export function installSeries(rt: Rt, env: Env, srcs: Sources) {
  const bid = () => env.price(), ask = () => env.price() + env.spreadPoints * env.point;
  const at = (s: Src, shift: unknown) => { const n = s.cur(), i = n - num(shift); return i >= 0 && i <= n ? s.bar(i) : undefined };
  const field = (f: (b: Bar) => number) => (sym: unknown, tf: unknown, shift: unknown) => { const b = at(srcs(sym, tf), shift); return b ? f(b) : 0 };
  const pick = (type: number): ((b: Bar) => number) => [(b: Bar) => b.open, (b: Bar) => b.low, (b: Bar) => b.high, (b: Bar) => b.close, (b: Bar) => b.volume, (b: Bar) => (env.dialect === 'mql4' ? b.time : b.volume), () => env.spreadPoints][type] ?? (b => b.close);
  const extreme = (better: (a: number, b: number) => boolean) => (sym: unknown, tf: unknown, type = 2, count?: number, start = 0) => {
    const s = srcs(sym, tf), n = s.cur(), f = pick(num(type)), st = Math.max(0, num(start));
    const end = isWhole(env, count) ? n : Math.min(n, st + num(count) - 1);
    let r = -1;
    for (let sh = st; sh <= end; sh++) if (r < 0 || better(f(s.bar(n - sh)), f(s.bar(n - r)))) r = sh;
    return r;
  };
  /** Resolve Copy* (start_pos,count) | (start_time,count) | (start_time,stop_time) to chronological [lo, hi]. */
  const span = (s: Src, a: unknown, b: unknown): [number, number] => {
    const n = s.cur(), x = num(val(a)), y = num(val(b));
    let lo: number, hi: number;
    if (isTime(x)) {
      if (isTime(y)) { hi = idxAt(s, Math.max(x, y)); lo = idxAt(s, Math.min(x, y) - 1) + 1 }
      else { hi = idxAt(s, x); lo = hi - y + 1 }
    } else { hi = n - x; lo = hi - y + 1 }
    return [Math.max(0, lo), Math.min(n, hi)];
  };
  const copier = <T>(f: (b: Bar) => T) => (sym: unknown, tf: unknown, a: unknown, b: unknown, out: MqlArray<T>) => {
    const s = srcs(sym, tf), [lo, hi] = span(s, a, b);
    if (hi < lo) { setErr(rt, env.dialect === 'mql4' ? 4073 : 4401); return -1 }
    const v: T[] = []; for (let i = lo; i <= hi; i++) v.push(f(s.bar(i)));
    return fillOut(out, v);
  };
  const rates = (b: Bar) => Object.assign(new MqlRates(), { time: b.time, open: b.open, high: b.high, low: b.low, close: b.close, tick_volume: b.volume, spread: env.spreadPoints, real_volume: b.volume });

  Object.assign(rt, {
    iBars: (sym: unknown, tf: unknown) => srcs(sym, tf).cur() + 1,
    iTime: field(b => b.time), iOpen: field(b => b.open), iHigh: field(b => b.high), iLow: field(b => b.low), iClose: field(b => b.close),
    iVolume: field(b => b.volume), iTickVolume: field(b => b.volume), iRealVolume: field(b => b.volume), iSpread: field(() => env.spreadPoints),
    iHighest: extreme((a, b) => a > b), iLowest: extreme((a, b) => a < b),
    iBarShift: (sym: unknown, tf: unknown, t: number, exact = false) => {
      const s = srcs(sym, tf), n = s.cur(), i = idxAt(s, num(t));
      if (i < 0) return exact ? -1 : n;
      if (exact && s.time(i) !== num(t)) return -1;
      return n - i;
    },
    CopyRates: copier(rates), CopyTime: copier(b => b.time), CopyOpen: copier(b => b.open), CopyHigh: copier(b => b.high), CopyLow: copier(b => b.low),
    CopyClose: copier(b => b.close), CopyTickVolume: copier(b => b.volume), CopyRealVolume: copier(b => b.volume), CopySpread: copier(() => env.spreadPoints),
    SeriesInfoInteger: (sym: unknown, tf: unknown, prop: number, out?: unknown) => {
      const s = srcs(sym, tf), n = s.cur();
      const v = [n + 1, s.time(0), n >= 0 ? s.time(n) : 0, s.time(0), s.time(0), 1][num(prop)] ?? 0;
      if (out !== undefined) { put(out, v); return true }
      return v;
    },
    RefreshRates: () => true,
    WindowFirstVisibleBar: () => Math.min(env.cur(), 99), WindowBarsPerChart: () => 100, WindowFind: () => -1, WindowHandle: () => 0, WindowIsVisible: () => true,
    WindowOnDropped: () => 0, WindowPriceMax: () => 0, WindowPriceMin: () => 0, WindowPriceOnDropped: () => 0, WindowRedraw: () => {}, WindowScreenShot: () => false,
    WindowTimeOnDropped: () => 0, WindowXOnDropped: () => 0, WindowYOnDropped: () => 0, WindowsTotal: () => 1, WindowExpertName: () => String(rt.__programName ?? ''),
  });
  // In MQL4 `Bars` is a variable; in MQL5 Bars(symbol, timeframe[, start, stop]) is a function.
  if (env.dialect === 'mql4') getter(rt, 'Bars', () => env.cur() + 1);
  else rt.Bars = (sym: unknown, tf: unknown, a?: unknown, b?: unknown) => { const s = srcs(sym, tf); if (a === undefined) return s.cur() + 1; const [lo, hi] = span(s, a, b); return Math.max(0, hi - lo + 1) };

  getter(rt, 'Bid', bid); getter(rt, 'Ask', ask);
  getter(rt, 'Point', () => env.point); getter(rt, '_Point', () => env.point);
  getter(rt, 'Digits', () => env.digits); getter(rt, '_Digits', () => env.digits);
  if (env.dialect === 'mql4') {
    const ser = (f: (b: Bar) => number) => new SeriesArray(i => {
      const k = env.cur() - i, b = env.bars[k];
      if (!b || i < 0 || k > env.cur()) { setErr(rt, 4002); return 0 }
      return f(b);
    }, () => env.cur() + 1);
    Object.assign(rt, { Open: ser(b => b.open), High: ser(b => b.high), Low: ser(b => b.low), Close: ser(b => b.close), Time: ser(b => b.time), Volume: ser(b => b.volume) });
  }
}
