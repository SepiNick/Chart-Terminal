// Bars contexts and Series<T>: values stored by absolute bar index, read by barsAgo relative to the context's
// current bar. Reading a series owned by an indicator first brings that indicator up to date (lazy, NT-like Update()).
import type { Bar } from '../../data.ts';
import { NtDateTime, NtError } from './helpers.ts';

let ids = 0;
const periodOf = (tf: number) =>
  tf % 2592000 === 0 ? { BarsPeriodType: 'Month', Value: tf / 2592000 } : tf % 604800 === 0 ? { BarsPeriodType: 'Week', Value: tf / 604800 }
    : tf % 86400 === 0 ? { BarsPeriodType: 'Day', Value: tf / 86400 } : tf % 60 === 0 ? { BarsPeriodType: 'Minute', Value: tf / 60 } : { BarsPeriodType: 'Second', Value: tf };
const day = (t: number) => Math.floor(t / 86400);

export class BarsCtx {
  bars: Bar[]; cur = -1; tfSec: number; symbol: string; tick: number; pv: number;
  Open: NtSeries; High: NtSeries; Low: NtSeries; Close: NtSeries; Volume: NtSeries; Time: NtSeries; Median: NtSeries; Typical: NtSeries; Weighted: NtSeries;
  instrument: any; period: any; barsObj: any;
  constructor(bars: Bar[], symbol: string, tfSec: number, tick: number, pv: number) {
    this.bars = bars; this.symbol = symbol; this.tfSec = tfSec; this.tick = tick; this.pv = pv;
    const s = (f: (b: Bar) => unknown) => NtSeries.fn(this, i => f(bars[i]));
    this.Open = s(b => b.open); this.High = s(b => b.high); this.Low = s(b => b.low); this.Close = s(b => b.close); this.Volume = s(b => b.volume);
    this.Time = s(b => NtDateTime.of((b.time + tfSec) * 1000));   // NT bar timestamps are bar close times
    this.Median = s(b => (b.high + b.low) / 2); this.Typical = s(b => (b.high + b.low + b.close) / 3); this.Weighted = s(b => (b.high + b.low + 2 * b.close) / 4);
    const dec = Math.max(0, -Math.floor(Math.log10(tick) + 1e-9));
    const master = {
      Name: symbol.split(' ')[0], TickSize: tick, PointValue: pv, InstrumentType: 'Future', Description: symbol,
      Round2TickSize: (p: number) => +(Math.round(p / tick) * tick).toFixed(dec + 2),
      FormatPrice: (p: number) => p.toFixed(dec),
    };
    this.instrument = { FullName: symbol, MasterInstrument: master, Exchange: 'Default' };
    this.period = { ...periodOf(tfSec), MarketDataType: 'Last', ToString() { return `${this.Value} ${this.BarsPeriodType}` } };
    const ctx = this, at = (i: number) => { if (!(i >= 0 && i < bars.length)) throw new NtError(`Bar index ${i} is out of range`); return bars[i] };
    this.barsObj = {
      get Count() { return bars.length }, get CurrentBar() { return ctx.cur }, Instrument: this.instrument, BarsPeriod: this.period, IsTickReplay: false,
      GetTime: (i: number) => NtDateTime.of((at(i).time + tfSec) * 1000), GetOpen: (i: number) => at(i).open, GetHigh: (i: number) => at(i).high,
      GetLow: (i: number) => at(i).low, GetClose: (i: number) => at(i).close, GetVolume: (i: number) => at(i).volume,
      GetBar: (t: NtDateTime) => ctx.indexAt(t),
      get IsFirstBarOfSession() { return ctx.cur <= 0 || day(bars[ctx.cur].time) !== day(bars[ctx.cur - 1].time) },
      get IsLastBarOfSession() { return ctx.cur === bars.length - 1 || day(bars[ctx.cur].time) !== day(bars[ctx.cur + 1].time) },
      get BarsSinceNewTradingDay() { let k = 0; while (ctx.cur - k > 0 && day(bars[ctx.cur - k].time) === day(bars[ctx.cur - k - 1].time)) k++; return k },
      PercentComplete: 1,
    };
  }
  /** Index of the bar whose close time is the last one <= t (first bar when t is earlier). */
  indexAt(t: NtDateTime) {
    const s = t.ms / 1000 - this.tfSec, b = this.bars;
    let lo = 0, hi = b.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (b[m].time <= s) lo = m; else hi = m - 1 }
    return lo;
  }
}

export class NtSeries {
  ctx!: BarsCtx; owner: any = null; arr: any[] = []; def: any = 0; f: ((i: number) => any) | null = null; id = ++ids;
  MaximumBarsLookBack = 'Infinite';
  /** new Series<T>(owner[, MaximumBarsLookBack]) — owner: a NinjaScript object or another series to sync with.
   *  A leading type-name string (e.g. 'bool') is accepted and picks the default for unset slots. */
  constructor(...a: any[]) {
    let type = 'double';
    if (typeof a[0] === 'string') type = a.shift().toLowerCase();
    const o = a[0];
    if (o instanceof BarsCtx) this.ctx = o;
    else if (o instanceof NtSeries) { this.ctx = o.ctx; this.owner = o.owner }
    else if (o && o.__ctx) { this.ctx = o.__ctx; this.owner = o }
    else throw new NtError('Series<T> must be created with a NinjaScript owner (e.g. new Series<double>(this))');
    if (typeof a[1] === 'string') this.MaximumBarsLookBack = a[1];
    this.def = /bool/.test(type) ? false : /^(double|float|int|long|decimal|short|byte|system\.(double|int32))$/.test(type) ? 0 : null;
  }
  static fn(ctx: BarsCtx, f: (i: number) => any) { const s = new NtSeries(ctx); s.f = f; return s }
  static of(owner: any, def: any = 0) { const s = new NtSeries(owner); s.def = def; return s }
  private idx(barsAgo: number) {
    const c = this.ctx, k = Math.trunc(barsAgo), i = c.cur - k;
    if (!(k >= 0) || i < 0 || i >= c.bars.length)
      throw new NtError(`You are accessing an index with a value that is invalid since it is out-of-range. I.E. accessing a series [barsAgo] with a value of ${barsAgo} when there are only ${c.cur + 1} bars on the chart.`);
    return i;
  }
  private sync() { const o = this.owner; if (o && !o.__running && o.__last < this.ctx.cur) o.__runTo(this.ctx.cur) }
  get(barsAgo: number) { this.sync(); const i = this.idx(barsAgo), v = this.f ? this.f(i) : this.arr[i]; return v === undefined ? this.def : v }
  set(barsAgo: number, v: any) {
    if (this.f) throw new NtError('Property or indexer cannot be assigned to -- it is read only');
    this.arr[this.idx(barsAgo)] = v; return v;
  }
  __item(i: number) { return this.get(i) }
  __setItem(i: number, v: any) { this.set(i, v) }
  get Count() { return this.ctx.bars.length }
  IsValidDataPoint(barsAgo: number) { this.sync(); const i = this.ctx.cur - barsAgo; return i >= 0 && i <= this.ctx.cur && (this.f != null || this.arr[i] !== undefined) }
  IsValidDataPointAt(i: number) { return i >= 0 && i < this.ctx.bars.length && (this.f != null || this.arr[i] !== undefined) }
  GetValueAt(i: number) { this.sync(); if (!(i >= 0 && i < this.ctx.bars.length)) throw new NtError(`Bar index ${i} is out of range`); const v = this.f ? this.f(i) : this.arr[i]; return v === undefined ? this.def : v }
  Reset(barsAgo = 0) { this.arr[this.idx(barsAgo)] = undefined }
  /** NT7-style Set(value) / Set(barsAgo, value). */
  Set(a: any, b?: any) { return b === undefined ? this.set(0, a) : this.set(a, b) }
}
