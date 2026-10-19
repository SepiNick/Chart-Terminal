// Custom indicator API (buffers, plots, levels) and the MovingAverages.mqh functions (implemented from their docs).
import { MqlArray, type Env, type PlotProps, type Rt } from '../contract.ts';
import { num, put, str } from './util.ts';

type N = MqlArray<number>;
export function installCustom(rt: Rt, env: Env) {
  const m4 = env.dialect === 'mql4';
  const plot = (i: number): PlotProps => { let p = env.plots.get(i); if (!p) env.plots.set(i, (p = {})); return p };
  const level = (i: number) => { const L = env.indicator.levels; while (L.length <= i) L.push({ value: 0 }); return L[i] };
  const C = (k: string) => rt[k] as number;
  const ex = (a: unknown[]) => (a.length >= 3 ? [num(a[1]), a[2]] as const : [0, a[1]] as const);   // (prop, [modifier,] value)

  Object.assign(rt, {
    SetIndexBuffer: (i: number, arr: N, kind = 0) => {
      const k = num(kind);
      if (m4) arr.series = true;
      env.buffers.set(num(i), { arr, kind: k === 1 ? 'color' : k === 2 ? 'calc' : 'data' });
      return true;
    },
    IndicatorBuffers: () => true,
    SetIndexStyle: (i: number, type: number, style = -1, width = -1, clr = -1) => {
      const p = plot(num(i)); p.type = num(type);
      if (style >= 0) p.style = style; if (width >= 0) p.width = width; if (clr !== -1 && clr !== 0xffffffff) p.color = [clr];
    },
    SetIndexLabel: (i: number, s: unknown) => { plot(num(i)).label = str(s) },
    SetIndexArrow: (i: number, c: number) => { plot(num(i)).arrow = num(c) },
    SetIndexDrawBegin: (i: number, b: number) => { plot(num(i)).begin = num(b) },
    SetIndexShift: (i: number, s: number) => { plot(num(i)).shift = num(s) },
    SetIndexEmptyValue: (i: number, v: number) => { plot(num(i)).empty = num(v) },
    SetLevelValue: (i: number, v: number) => { level(num(i)).value = num(v) },
    SetLevelStyle: (style: number, _width: number, clr = -1) => { for (const l of env.indicator.levels) { l.style = style; if (clr !== -1) l.color = clr } rt.__levelStyle = { style, clr } },
    IndicatorShortName: (s: unknown) => { env.indicator.shortName = str(s) },
    IndicatorDigits: (d: number) => { env.indicator.digits = num(d) },
    IndicatorCounted: () => num(rt.__counted ?? 0),
    PlotIndexSetInteger: (...a: unknown[]) => {
      const p = plot(num(a[0])), prop = num(a[1]), [mod, v] = ex(a.slice(1)), x = num(v);
      if (prop === C('PLOT_DRAW_TYPE')) p.type = x;
      else if (prop === C('PLOT_LINE_COLOR')) { (p.color ??= [])[mod] = x }
      else if (prop === C('PLOT_LINE_WIDTH')) p.width = x;
      else if (prop === C('PLOT_LINE_STYLE')) p.style = x;
      else if (prop === C('PLOT_DRAW_BEGIN')) p.begin = x;
      else if (prop === C('PLOT_SHIFT')) p.shift = x;
      else if (prop === C('PLOT_ARROW')) p.arrow = x;
      else if (prop === C('PLOT_SHOW_DATA')) p.show = !!v;
      else if (prop === C('PLOT_COLOR_INDEXES')) { p.color ??= []; p.color.length = x }
      else (p as Record<string, unknown>)['p' + prop] = x;
      return true;
    },
    PlotIndexSetDouble: (i: number, prop: number, v: number) => { if (num(prop) === C('PLOT_EMPTY_VALUE')) plot(num(i)).empty = num(v); return true },
    PlotIndexSetString: (i: number, prop: number, v: unknown) => { if (num(prop) === C('PLOT_LABEL')) plot(num(i)).label = str(v); return true },
    PlotIndexGetInteger: (i: number, prop: number, mod = 0) => {
      const p = plot(num(i)), q = num(prop);
      return q === C('PLOT_DRAW_TYPE') ? p.type ?? 0 : q === C('PLOT_LINE_COLOR') ? p.color?.[mod] ?? 0 : q === C('PLOT_LINE_WIDTH') ? p.width ?? 1 : q === C('PLOT_LINE_STYLE') ? p.style ?? 0
        : q === C('PLOT_DRAW_BEGIN') ? p.begin ?? 0 : q === C('PLOT_SHIFT') ? p.shift ?? 0 : q === C('PLOT_ARROW') ? p.arrow ?? 159 : q === C('PLOT_SHOW_DATA') ? +(p.show ?? true) : 0;
    },
    IndicatorSetInteger: (...a: unknown[]) => {
      const prop = num(a[0]), [mod, v] = ex(a), x = num(v), I = env.indicator;
      if (prop === C('INDICATOR_DIGITS')) I.digits = x;
      else if (prop === C('INDICATOR_LEVELS')) { I.levels.length = Math.min(I.levels.length, x); level(x - 1) }
      else if (prop === C('INDICATOR_LEVELCOLOR')) level(mod).color = x;
      else if (prop === C('INDICATOR_LEVELSTYLE')) level(mod).style = x;
      return true;
    },
    IndicatorSetDouble: (...a: unknown[]) => {
      const prop = num(a[0]), [mod, v] = ex(a), x = num(v), I = env.indicator;
      if (prop === C('INDICATOR_MINIMUM')) I.min = x; else if (prop === C('INDICATOR_MAXIMUM')) I.max = x; else if (prop === C('INDICATOR_LEVELVALUE')) level(mod).value = x;
      return true;
    },
    IndicatorSetString: (...a: unknown[]) => { if (num(a[0]) === C('INDICATOR_SHORTNAME')) env.indicator.shortName = str(a.length >= 3 ? a[2] : a[1]); return true },
  });

  // MovingAverages.mqh — arrays indexed as given (normally non-series), position = element index.
  const SimpleMA = (pos: number, n: number, p: N) => { if (n < 1 || pos < n - 1) return 0; let s = 0; for (let i = 0; i < n; i++) s += p.get(pos - i); return s / n };
  const ExponentialMA = (pos: number, n: number, prev: number, p: N) => (pos === 0 ? p.get(0) : n > 0 ? p.get(pos) * (2 / (n + 1)) + prev * (1 - 2 / (n + 1)) : 0);
  const SmoothedMA = (pos: number, n: number, prev: number, p: N) => { if (n < 1) return 0; if (pos === n - 1) return SimpleMA(pos, n, p); if (pos >= n) return (prev * (n - 1) + p.get(pos)) / n; return 0 };
  const LinearWeightedMA = (pos: number, n: number, p: N) => { if (n < 1 || pos < n - 1) return 0; let s = 0, w = 0; for (let i = 0; i < n; i++) { s += p.get(pos - i) * (n - i); w += n - i } return s / w };
  /** Shared OnBuffer loop: zero-fills the lead-in, seeds at `first`, then steps. */
  const onBuffer = (total: number, prev: number, begin: number, n: number, p: N, b: N, first: number, step: (i: number) => number) => {
    if (n <= 1 || total - begin < n) return 0;
    if (!b.fixed && b.size < total) b.resize(total);
    let start: number;
    if (prev === 0) { for (let i = 0; i < first; i++) b.set(i, 0); start = first } else start = prev - 1;
    for (let i = start; i < total; i++) b.set(i, step(i));
    return total;
  };
  Object.assign(rt, {
    SimpleMA, ExponentialMA, SmoothedMA, LinearWeightedMA,
    SimpleMAOnBuffer: (t: number, pc: number, bg: number, n: number, p: N, b: N) => onBuffer(t, pc, bg, n, p, b, bg + n - 1, i => SimpleMA(i, n, p)),
    ExponentialMAOnBuffer: (t: number, pc: number, bg: number, n: number, p: N, b: N) => onBuffer(t, pc, bg, n, p, b, bg, i => (i === bg ? p.get(bg) : ExponentialMA(i, n, b.get(i - 1), p))),
    SmoothedMAOnBuffer: (t: number, pc: number, bg: number, n: number, p: N, b: N) => onBuffer(t, pc, bg, n, p, b, bg + n - 1, i => (i === bg + n - 1 ? SimpleMA(i, n, p) : (b.get(i - 1) * (n - 1) + p.get(i)) / n)),
    LinearWeightedMAOnBuffer: (t: number, pc: number, bg: number, n: number, p: N, b: N, ws?: unknown) => { put(ws, (n * (n + 1)) / 2); return onBuffer(t, pc, bg, n, p, b, bg + n - 1, i => LinearWeightedMA(i, n, p)) },
  });
}
