// Engine + NinjaScriptBase/Indicator: lifecycle, price data, plots/lines, child indicators, utility methods.
import type { NtRunOptions } from '../contract.ts';
import { BarsCtx, NtSeries } from './series.ts';
import { NtDateTime, NtError, fmt } from './helpers.ts';
import { Brushes, SolidColorBrush, Stroke } from './brushes.ts';

const PERIOD_SEC: Record<string, number> = { Second: 1, Minute: 60, Day: 86400, Week: 604800, Month: 2592000, Year: 31536000 };

export class Engine {
  opts: NtRunOptions; classes: Record<string, any>; builtins: Record<string, any>; ctxs: BarsCtx[];
  cache = new Map<string, any>(); scripts: any[] = []; logs: { bar: number; msg: string }[] = []; alerts: { bar: number; msg: string }[] = [];
  draws = new Map<string, any>(); root: any = null; pending: BarsCtx | null = null; warned = new Set<string>();
  /** IsFirstTickOfBar for the OnBarUpdate calls being made (tick-by-tick Calculate modes). */
  firstTick = true;
  constructor(opts: NtRunOptions, classes: Record<string, any>, builtins: Record<string, any>) {
    this.opts = opts; this.classes = classes; this.builtins = builtins;
    // own copies: tick-by-tick runs reveal the forming bar in place
    this.ctxs = [new BarsCtx(opts.bars.map(b => ({ ...b })), opts.symbol, opts.tfSec, opts.tickSize, opts.pointValue)];
  }
  log(msg: string) { this.logs.push({ bar: this.ctxs[0].cur, msg }) }
  warn(msg: string) { if (!this.warned.has(msg)) { this.warned.add(msg); this.log('Warning: ' + msg) } }
  /** Instantiate a script and take it through SetDefaults → (init) → Configure → DataLoaded → Historical. */
  create(cls: any, input: NtSeries | null, init?: (s: any) => void, root = false) {
    this.pending = input?.ctx ?? this.ctxs[0];
    let s: any;
    try { s = new cls() } finally { this.pending = null }
    if (!(s instanceof NinjaScriptBase)) throw new NtError(`'${cls?.name}' is not an Indicator or Strategy`);
    if (input) s.__input = input;
    if (root) this.root = s;
    this.scripts.push(s);
    s.__state('SetDefaults');
    init?.(s);
    for (const st of ['Configure', 'DataLoaded', 'Historical']) s.__state(st);
    return s;
  }
}

let ENG: Engine | null = null;
export const curEngine = () => { if (!ENG) throw new NtError('NinjaScript objects can only be used while a script runs'); return ENG };
export const setEngine = (e: Engine | null) => { const p = ENG; ENG = e; return p };

export const isSer = (x: unknown) => x instanceof NtSeries || x instanceof NinjaScriptBase;
export const toSeries = (x: any): NtSeries => (x instanceof NinjaScriptBase ? x.Values[0] ?? x.Input : x);
/** Value of a series (barsAgo) or a constant. */
const val = (x: any, k: number): number => (typeof x === 'number' ? x : toSeries(x).get(k));
const argKey = (x: any): string => x instanceof NtSeries ? 's' + x.id : x instanceof NinjaScriptBase ? 's' + toSeries(x).id
  : x instanceof NtDateTime ? 'd' + x.ms : typeof x === 'object' && x ? JSON.stringify(x) ?? String(x) : String(x);

class Plot {
  Name: string; Brush: SolidColorBrush; Width: number; PlotStyle: string; DashStyleHelper: string; Stroke: Stroke; Min = -Infinity; Max = Infinity;
  constructor(st: Stroke, style: string, name: string) {
    this.Stroke = st; this.Brush = st.Brush; this.Width = st.Width; this.PlotStyle = style; this.DashStyleHelper = st.DashStyleHelper; this.Name = name;
  }
}

export class NinjaScriptBase {
  [k: string]: any;
  constructor() {
    const e = curEngine();
    this.__eng = e; this.__ctx = e.pending ?? e.ctxs[0]; this.__ctxs = [this.__ctx];
    this.__last = -1; this.__running = false; this.__input = null; this.__chartInds = [];
    this.State = 'SetDefaults'; this.BarsInProgress = 0; this.IsFirstTickOfBar = true;
    this.Name = (this.constructor as any).__name ?? this.constructor.name; this.Description = '';
    this.Calculate = 'OnBarClose'; this.IsOverlay = false; this.DisplayInDataBox = true; this.DrawOnPricePanel = true;
    this.PaintPriceMarkers = true; this.ScaleJustification = 'Right'; this.IsSuspendedWhileInactive = false; this.IsAutoScale = true;
    this.BarsRequiredToPlot = 20; this.MaximumBarsLookBack = 'TwoHundredFiftySix'; this.ArePlotsConfigurable = true; this.AreLinesConfigurable = true;
    this.DrawHorizontalGridLines = true; this.DrawVerticalGridLines = true; this.ShowTransparentPlotsInDataBox = false; this.IsVisible = true;
    this.Values = []; this.Plots = []; this.Lines = []; this.PlotBrushes = [];
    this.BackBrushes = NtSeries.of(this, null); this.BackBrushesAll = this.BackBrushes;
    this.BarBrushes = NtSeries.of(this, null); this.CandleOutlineBrushes = NtSeries.of(this, null);
    // user indicators from the same compilation are callable by name: this.MyInd(args)
    for (const [k, c] of Object.entries(e.classes)) if (c?.prototype instanceof Indicator && !(k in this)) this[k] = (...a: any[]) => this.__child(k, a);
  }
  OnStateChange() { }
  OnBarUpdate() { }
  __state(s: string) { this.State = s; this.OnStateChange() }
  /** Process bars up to `t` (absolute index) on this script's primary context. */
  __runTo(t: number) {
    if (this.__running) return;
    const c: BarsCtx = this.__ctx, saved = c.cur;
    this.__running = true;
    try { while (this.__last < t) { c.cur = ++this.__last; this.__bar() } } finally { c.cur = saved; this.__running = false }
  }
  __bar() { this.BarsInProgress = 0; this.IsFirstTickOfBar = this.__eng.firstTick; this.OnBarUpdate() }
  /** Custom rendering: called once after the run with snapshot helpers (see render.ts). */
  OnRender(_chartControl?: unknown, _chartScale?: unknown) { }
  /** indicator[barsAgo] reads (and writes) its first plot */
  __item(barsAgo: number) { return toSeries(this).get(barsAgo) }
  __setItem(barsAgo: number, v: unknown) { toSeries(this).set(barsAgo, v) }
  __child(name: string, args: any[]) {
    const e: Engine = this.__eng, user = e.classes[name];
    const cls = user?.prototype instanceof Indicator ? user : e.builtins[name];
    if (!cls) throw new NtError(`'${name}' is not a known indicator`);
    const a = [...args];
    const input = toSeries(a.length && isSer(a[0]) ? a.shift() : this.Input);
    const key = name + '|' + input.id + '|' + a.map(argKey).join(',');
    let ind = e.cache.get(key);
    if (!ind) {
      const names: string[] = cls.__params ?? (cls.__inputs ?? []).map((i: any) => i.name);
      ind = e.create(cls, input, s => names.forEach((n, i) => { if (i < a.length) s[n] = a[i] }));
      e.cache.set(key, ind);
    }
    ind.__runTo(ind.__ctx.cur);
    return ind;
  }

  // ---------- data ----------
  get __b(): BarsCtx { return this.__ctxs[this.BarsInProgress] ?? this.__ctx }
  get CurrentBar() { return this.__b.cur }
  get CurrentBars() { return this.__ctxs.map((c: BarsCtx) => c.cur) }
  get Count() { return this.__b.bars.length }
  get Open() { return this.__b.Open }
  get High() { return this.__b.High }
  get Low() { return this.__b.Low }
  get Close() { return this.__b.Close }
  get Volume() { return this.__b.Volume }
  get Time() { return this.__b.Time }
  get Median() { return this.__b.Median }
  get Typical() { return this.__b.Typical }
  get Weighted() { return this.__b.Weighted }
  get Opens() { return this.__ctxs.map((c: BarsCtx) => c.Open) }
  get Highs() { return this.__ctxs.map((c: BarsCtx) => c.High) }
  get Lows() { return this.__ctxs.map((c: BarsCtx) => c.Low) }
  get Closes() { return this.__ctxs.map((c: BarsCtx) => c.Close) }
  get Volumes() { return this.__ctxs.map((c: BarsCtx) => c.Volume) }
  get Times() { return this.__ctxs.map((c: BarsCtx) => c.Time) }
  get Medians() { return this.__ctxs.map((c: BarsCtx) => c.Median) }
  get Typicals() { return this.__ctxs.map((c: BarsCtx) => c.Typical) }
  get Weighteds() { return this.__ctxs.map((c: BarsCtx) => c.Weighted) }
  get BarsArray() { return this.__ctxs.map((c: BarsCtx) => c.barsObj) }
  get Bars() { return this.__b.barsObj }
  get Input(): any { return this.__input ?? this.__ctx.Close }
  get Inputs() { return this.__ctxs.map((c: BarsCtx, i: number) => (i ? c.Close : this.Input)) }
  get Value() { return this.Values[0] }
  get TickSize() { return this.__ctx.tick }
  get Instrument() { return this.__b.instrument }
  get BarsPeriod() { return this.__b.period }
  get BackBrush() { return this.BackBrushes.get(0) }
  set BackBrush(v) { this.BackBrushes.set(0, v) }
  get BackBrushAll() { return this.BackBrushes.get(0) }
  set BackBrushAll(v) { this.BackBrushes.set(0, v) }
  get BarBrush() { return this.BarBrushes.get(0) }
  set BarBrush(v) { this.BarBrushes.set(0, v) }
  get CandleOutlineBrush() { return this.CandleOutlineBrushes.get(0) }
  set CandleOutlineBrush(v) { this.CandleOutlineBrushes.set(0, v) }
  get PlotBrush() { return this.PlotBrushes[0]?.get(0) }

  // ---------- configuration ----------
  /** AddPlot(brush|stroke, name) or AddPlot(brush|stroke, PlotStyle, name). */
  AddPlot(b: any, a?: any, c?: any) {
    const style = c !== undefined ? a : 'Line', name = c !== undefined ? c : a ?? `Plot${this.Plots.length}`;
    const st = b instanceof Stroke ? b : new Stroke(b instanceof SolidColorBrush ? b : Brushes.DodgerBlue, 1);
    this.Plots.push(new Plot(st, style, String(name)));
    this.Values.push(new NtSeries(this));
    this.PlotBrushes.push(NtSeries.of(this, null));
  }
  /** AddLine(brush|stroke, value, name). */
  AddLine(b: any, value: number, name?: string) {
    const st = b instanceof Stroke ? b : new Stroke(b instanceof SolidColorBrush ? b : Brushes.DarkGray, 1);
    this.Lines.push({ Name: name ?? `Line${this.Lines.length}`, Value: value, Brush: st.Brush, Width: st.Width, DashStyleHelper: st.DashStyleHelper, Stroke: st });
  }
  /** AddDataSeries([instrument,] BarsPeriodType, value) | (instrument) | (BarsPeriod{...}). Bars come from opts.barsFor. */
  AddDataSeries(...a: any[]) {
    const e: Engine = this.__eng, p = this.__ctx;
    let sym = p.symbol, type: string | null = null, value = 1;
    for (let i = 0; i < a.length; i++) {
      const x = a[i];
      if (typeof x === 'string' && x in PERIOD_SEC || ['Tick', 'Volume', 'Range', 'Renko', 'HeikenAshi', 'Kagi', 'LineBreak', 'PointAndFigure'].includes(x)) { type = x; if (typeof a[i + 1] === 'number') value = a[++i] }
      else if (typeof x === 'string' && type == null && i === 0) sym = x;
      else if (x && typeof x === 'object' && x.BarsPeriodType) { type = x.BarsPeriodType; value = x.Value ?? 1 }
    }
    const tf = type == null ? p.tfSec : PERIOD_SEC[type] ? PERIOD_SEC[type] * value : 0;
    const bars = tf ? e.opts.barsFor?.(sym, tf) ?? [] : [];
    if (!bars.length) e.warn(`AddDataSeries(${sym}, ${type ?? 'same period'} ${value}): no data available, series ${this.__ctxs.length} stays empty`);
    const c = new BarsCtx(bars, sym, tf || p.tfSec, p.tick, p.pv);
    c.setSession(p.session);
    this.__ctxs.push(c);
  }
  AddChartIndicator(ind: any) { this.__chartInds.push(ind) }
  Update() { this.__runTo(this.__ctx.cur) }
  ForceRefresh() { }

  // ---------- output / misc ----------
  Print(v: unknown) { this.__eng.log(fmt(v)) }
  Log(msg: unknown) { this.__eng.log(fmt(msg)) }
  ClearOutputWindow() { this.__eng.logs.length = 0 }
  Alert(_id: string, _priority: string, message: string) { this.__eng.log('Alert: ' + fmt(message)); this.__eng.alerts.push({ bar: this.__eng.ctxs[0].cur, msg: fmt(message) }) }
  PlaySound() { }
  RearmAlert() { }
  RemoveDrawObject(tag: string) { this.__eng.draws.delete(String(tag)) }
  RemoveDrawObjects() { this.__eng.draws.clear() }
  TriggerCustomEvent(f: (s: unknown) => void, ...a: any[]) { f(a[a.length - 1]) }
  GetCurrentBid() { return this.__b.bars[this.CurrentBar]?.close ?? NaN }
  GetCurrentAsk() { return this.__b.bars[this.CurrentBar]?.close ?? NaN }
  IsValidDataPoint(barsAgo: number) { return this.Values[0]?.IsValidDataPoint(barsAgo) ?? false }

  // ---------- analytical helpers ----------
  /** True when `a` crossed above `b` on any of the last lookBack bars (a[i] > b[i] and a[i+1] <= b[i+1]). */
  CrossAbove(a: any, b: any, lookBack = 1) {
    for (let i = 0; i < lookBack && i + 1 <= this.CurrentBar; i++) if (val(a, i) > val(b, i) && val(a, i + 1) <= val(b, i + 1)) return true;
    return false;
  }
  CrossBelow(a: any, b: any, lookBack = 1) {
    for (let i = 0; i < lookBack && i + 1 <= this.CurrentBar; i++) if (val(a, i) < val(b, i) && val(a, i + 1) >= val(b, i + 1)) return true;
    return false;
  }
  Rising(s: any) { return this.CurrentBar > 0 && val(s, 0) > val(s, 1) }
  Falling(s: any) { return this.CurrentBar > 0 && val(s, 0) < val(s, 1) }
  /** Evaluate cond() as if on the bar `k` bars ago (every series read shifts by k). */
  private __at<T>(k: number, f: () => T): T { const c: BarsCtx = this.__b, s = c.cur; c.cur = s - k; try { return f() } finally { c.cur = s } }
  /** Most recent occurrence: barsAgo of the instance-th bar within lookBack where cond() was true, else -1. */
  MRO(cond: () => boolean, instance: number, lookBack: number) {
    let n = 0;
    for (let k = 0; k < lookBack && k <= this.CurrentBar; k++) if (this.__at(k, cond) && ++n === instance) return k;
    return -1;
  }
  /** Least recent occurrence: like MRO but counted from the oldest bar of the lookBack window. */
  LRO(cond: () => boolean, instance: number, lookBack: number) {
    let n = 0;
    for (let k = Math.min(lookBack - 1, this.CurrentBar); k >= 0; k--) if (this.__at(k, cond) && ++n === instance) return k;
    return -1;
  }
  HighestBar(s: any, period: number) {
    let best = -Infinity, at = 0;
    for (let k = 0; k < period && k <= this.CurrentBar; k++) { const v = val(s, k); if (v > best) { best = v; at = k } }
    return at;
  }
  LowestBar(s: any, period: number) {
    let best = Infinity, at = 0;
    for (let k = 0; k < period && k <= this.CurrentBar; k++) { const v = val(s, k); if (v < best) { best = v; at = k } }
    return at;
  }
  Slope(s: any, startBarsAgo: number, endBarsAgo: number) { return (val(s, endBarsAgo) - val(s, startBarsAgo)) / (startBarsAgo - endBarsAgo) }
  ToTime(a: any, m?: number, s?: number) { return a instanceof NtDateTime ? a.Hour * 10000 + a.Minute * 100 + a.Second : a * 10000 + (m ?? 0) * 100 + (s ?? 0) }
  ToDay(d: NtDateTime) { return d.Year * 10000 + d.Month * 100 + d.Day }
}

export class Indicator extends NinjaScriptBase { }
