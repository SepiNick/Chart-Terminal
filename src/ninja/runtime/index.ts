// NinjaScript runtime entry: globals for compiled code (createRt), the bar loop (runNinja) and result assembly.
import type { NtResult, NtRunOptions, Rt } from '../contract.ts';
import { Engine, Indicator, NinjaScriptBase, curEngine, setEngine, isSer, toSeries } from './base.ts';
import { DX, renderSnapshot } from './render.ts';
import { SessionIterator, parseSession } from './session.ts';
import { BUILTINS } from './indicators/index.ts';
import { Brushes, Colors, DashStyleHelper, NtColor, SimpleFont, SolidColorBrush, Stroke, css } from './brushes.ts';
import { DrawProxy } from './draw.ts';
import * as E from './enums.ts';
import {
  Bool, Convert, DayOfWeek, Double, Int, Long, MidpointRounding, NtDateTime, NtDictionary, NtError, NtList, NtMath, NtString, NtTimeSpan,
  cast, fmt, format, get, set,
} from './helpers.ts';
import { NtSeries } from './series.ts';
import { Strategy } from './strategy.ts';

// Built-in indicators callable as this.SMA(...), this.Bollinger(Close, 2, 20) … (user classes with the same name win).
for (const k of Object.keys(BUILTINS))
  if (!(k in NinjaScriptBase.prototype)) (NinjaScriptBase.prototype as any)[k] = function (this: NinjaScriptBase, ...a: unknown[]) { return this.__child(k, a) };

class Exception extends Error {
  InnerException: unknown;
  constructor(msg = 'Exception of type \'System.Exception\' was thrown.', inner?: unknown) { super(msg); this.InnerException = inner }
  get Message() { return this.message }
  ToString() { return this.message }
}
class KeyValuePair { Key: unknown; Value: unknown; constructor(k: unknown, v: unknown) { this.Key = k; this.Value = v } }
class EventArgs { static Empty = new EventArgs() }

/** LINQ on any sequence: arrays, List, Series (newest first: element 0 = barsAgo 0), dictionaries/iterables; otherwise the object's own method. */
function linq(x: any, name: string, ...a: any[]) {
  const l: NtList | null = x instanceof NtList ? x : Array.isArray(x) ? new NtList(x)
    : isSer(x) ? (s => new NtList(Array.from({ length: s.ctx.cur + 1 }, (_, k) => s.get(k))))(toSeries(x))
    : x != null && typeof x === 'object' && typeof x[Symbol.iterator] === 'function' && typeof x[name] !== 'function' ? new NtList(x) : null;
  if (!l) { if (typeof x?.[name] !== 'function') throw new NtError(`'${name}' is not available on this value`); return x[name](...a) }
  if (name === 'Count') return a[0] ? l.filter(a[0]).length : l.length;
  return (l as any)[name](...a);
}
// Multicast delegates (events): a combined function with the ordered handler list in __list.
const parts = (f: any): any[] => (f == null ? [] : f.__list ?? [f]);
const combine = (list: any[]) => {
  if (list.length <= 1) return list[0] ?? null;
  const f: any = (...x: any[]) => { let r; for (const g of list) r = g(...x); return r };
  f.__list = list;
  return f;
};
const dadd = (a: any, b: any) => combine([...parts(a), ...parts(b)]);
const drem = (a: any, b: any) => {
  const l = parts(a), r = parts(b);
  for (let i = l.length - r.length; i >= 0; i--) if (r.every((g, k) => l[i + k] === g)) return combine([...l.slice(0, i), ...l.slice(i + r.length)]);
  return a ?? null;
};
const groups = new WeakMap<object, Map<string, Function>>();
/** Instance method group as a stable delegate (same function for the same object and method). */
const mg = (o: any, k: string) => {
  let m = groups.get(o);
  if (!m) groups.set(o, (m = new Map()));
  let f = m.get(k);
  if (!f) m.set(k, (f = (...a: any[]) => o[k](...a)));
  return f;
};
const Enumerable = {
  Range: (start: number, n: number) => new NtList(Array.from({ length: n }, (_, i) => start + i)),
  Repeat: (v: unknown, n: number) => new NtList(Array.from({ length: n }, () => v)),
  Empty: () => new NtList(),
};

export function createRt(): Rt {
  const g: Record<string, unknown> = {
    NinjaScriptBase, Indicator, Strategy, Series: NtSeries, ISeries: NtSeries, PriceSeries: NtSeries,
    Draw: DrawProxy, Brushes, Colors, Color: NtColor, ...DX, SessionIterator, EventArgs, Enumerable, SolidColorBrush, Brush: SolidColorBrush, Stroke, SimpleFont, DashStyleHelper,
    ...E, DayOfWeek, MidpointRounding,
    Math: NtMath, DateTime: NtDateTime, TimeSpan: NtTimeSpan, List: NtList, Dictionary: NtDictionary, KeyValuePair,
    String: NtString, Convert, Double, Int32: Int, Int64: Long, Boolean: Bool,
    Environment: { NewLine: '\r\n', get TickCount() { return Math.floor(performance.now()) } },
    Console: { WriteLine: (v: unknown = '') => curEngine().log(fmt(v)), Write: (v: unknown) => curEngine().log(fmt(v)) },
    Print: (v: unknown) => curEngine().log(fmt(v)),
    Log: (msg: unknown) => curEngine().log(fmt(msg)),
    ClearOutputWindow: () => { curEngine().logs.length = 0 },
    Exception, ArgumentException: Exception, ArgumentOutOfRangeException: Exception, InvalidOperationException: Exception,
    IndexOutOfRangeException: Exception, NotImplementedException: Exception, NotSupportedException: Exception, NullReferenceException: Exception,
  };
  // Fully qualified names (NinjaTrader.Gui.Tools.SimpleFont, System.Windows.Media.Brushes …): any namespace path resolves to the globals.
  const ns: any = new Proxy({}, { get: (_, k) => (typeof k === 'symbol' ? undefined : k in g ? g[k] : ns) });
  return {
    ...g, NinjaTrader: ns, System: ns,
    __get: get, __set: set, __lq: linq, __dadd: dadd, __drem: drem, __mg: mg, __fmt: fmt, __format: format, __cast: cast, __double: Double, __int: Int, __long: Long, __bool: Bool,
  };
}
/** Run-input id of the synthetic "Trading hours" setting every NinjaScript gets (see engine.ts). */
export const SESSION_INPUT = '__tradingHours';
export const NT_GLOBALS: string[] = Object.keys(createRt()).filter(k => !k.startsWith('__'));

const STYLE: Record<string, NtResult['plots'][number]['style']> = {
  Line: 'line', HLine: 'line', PriceBox: 'line', Bar: 'bar', Dot: 'dot', Hash: 'hash', Square: 'square', TriangleUp: 'triangleUp', TriangleDown: 'triangleDown',
  TriangleLeft: 'triangleDown', TriangleRight: 'triangleUp', Cross: 'cross', Block: 'block',
};
const opaque = (b: unknown) => { const c = css(b); return c && /,0\)$/.test(c) ? null : c };

function applyInputs(s: any, cls: any, inputs?: Record<string, unknown>) {
  const names: string[] | undefined = cls.__inputs?.map((i: { name: string }) => i.name);
  for (const [k, v] of Object.entries(inputs ?? {})) {
    if (names && !names.includes(k) && !(k in s)) continue;
    const cur = s[k];
    s[k] = typeof cur === 'number' && typeof v === 'string' ? Number(v) : typeof cur === 'boolean' && typeof v === 'string' ? v === 'true' : v;
  }
}

/** Run `className` over opts.bars: lifecycle SetDefaults → Configure → DataLoaded → Historical → bars → Transition → Realtime → Terminated. */
export function runNinja(classes: Record<string, Function>, className: string, _rt: Rt, opts: NtRunOptions): NtResult {
  const e = new Engine(opts, classes, BUILTINS), prev = setEngine(e), c0 = e.ctxs[0], N = opts.bars.length;
  const res: NtResult = { kind: 'indicator', name: className, overlay: false, plots: [], lines: [], draws: [], backColors: [], barColors: [], logs: e.logs, alerts: e.alerts };
  let root: any = null, phase = 'OnStateChange';
  try {
    c0.setSession(parseSession(opts.inputs?.[SESSION_INPUT] ?? opts.session));
    const cls: any = classes[className];
    if (!cls) throw new NtError(`class '${className}' was not found`);
    root = e.create(cls, null, s => applyInputs(s, cls, opts.inputs), true);
    const br = root instanceof Strategy ? root.__br : null, extra: any[] = root.__ctxs.slice(1);
    const primary = (i: number) => { c0.cur = i; br?.step(i); root.__runTo(i); br?.endBar(i) };
    // Calculate.OnEachTick / OnPriceChange: each bar is replayed as OHLC ticks (O, L, H, C when it closes up, else O, H, L, C);
    // OnBarUpdate (and every indicator it reads) re-runs on the forming bar, which only shows the ticks so far.
    const mode = String(root.Calculate), tickMode = mode === 'OnEachTick' || mode === 'OnPriceChange';
    const ticked = (i: number) => {
      const b = opts.bars[i], v = c0.bars[i], path = b.close >= b.open ? [b.open, b.low, b.high, b.close] : [b.open, b.high, b.low, b.close];
      let last = NaN;
      path.forEach((p, k) => {
        if (k && mode === 'OnPriceChange' && p === last) return;
        if (!k) Object.assign(v, { open: b.open, high: p, low: p, close: p });
        else Object.assign(v, { high: Math.max(v.high, p), low: Math.min(v.low, p), close: p });
        c0.cur = i;
        br?.step(i, k ? [last, p] : [p, p], p);
        e.firstTick = !k;
        for (const s of e.scripts) if (s.__last >= i) s.__last = i - 1;
        root.__runTo(i);
        last = p;
      });
      Object.assign(v, b);
      e.firstTick = true;
      br?.endBar(i);
    };
    phase = 'OnBarUpdate';
    if (!extra.some(c => c.bars.length)) for (let i = 0; i < N; i++) (tickMode ? ticked : primary)(i);
    else {
      // multi-series: bar-close events of all series in time order (primary first on ties)
      const ev: [number, number, number][] = [];
      root.__ctxs.forEach((c: any, s: number) => c.bars.forEach((b: any, j: number) => ev.push([b.time + c.tfSec, s, j])));
      ev.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
      for (const [, s, j] of ev) {
        if (s === 0) { primary(j); continue }
        root.__ctxs[s].cur = j; root.__running = true; root.BarsInProgress = s;
        try { root.OnBarUpdate() } finally { root.BarsInProgress = 0; root.__running = false }
      }
    }
    phase = 'OnStateChange';
    root.__state('Transition'); root.__state('Realtime');
    if (root.OnRender !== NinjaScriptBase.prototype.OnRender) { phase = 'OnRender'; renderSnapshot(root, e) }
  } catch (err) {
    res.error = `Error on calling '${phase}' method on bar ${c0.cur}: ${err instanceof Error ? err.message : String(err)}`;
  } finally {
    for (const s of [...e.scripts].reverse()) try { s.__state('Terminated') } catch { /* ignore */ }
    setEngine(prev);
  }
  if (!root) return res;
  const brp = Math.max(0, +root.BarsRequiredToPlot || 0), range = (f: (k: number) => any) => Array.from({ length: N }, (_, k) => f(k));
  Object.assign(res, {
    kind: root instanceof Strategy ? 'strategy' : 'indicator', name: String(root.Name ?? className), overlay: !!root.IsOverlay,
    plots: root.Plots.map((p: any, i: number) => ({
      name: p.Name, color: css(p.Brush) ?? '#1e90ff', width: +p.Width || 1, style: STYLE[p.PlotStyle] ?? 'line',
      values: range(k => { const v = root.Values[i].arr[k]; return k < brp || typeof v !== 'number' ? NaN : v }),
      colors: range(k => css(root.PlotBrushes[i].arr[k])),
    })),
    lines: root.Lines.map((l: any) => ({ name: l.Name, value: l.Value, color: css(l.Brush) ?? '#808080' })),
    draws: [...e.draws.values()].map(d => Object.fromEntries(Object.entries({ type: d.type, tag: d.tag, t1: d.t1, p1: d.p1, t2: d.t2, p2: d.p2, color: d.color, text: d.text }).filter(([, v]) => v !== undefined))),
    backColors: range(k => opaque(root.BackBrushes.arr[k])),
    barColors: range(k => opaque(root.BarBrushes.arr[k])),
  });
  if (root instanceof Strategy) {
    const br = root.__br, last = opts.bars[N - 1];
    let eq = opts.initialCapital;
    Object.assign(res, {
      trades: br.trades, executions: br.execs, initialCapital: opts.initialCapital,
      equity: range(k => (eq = br.equity[k] ?? eq)), openPL: last ? br.openPL(last.close) : 0, openCount: br.ents.length,
    });
  }
  return res;
}
