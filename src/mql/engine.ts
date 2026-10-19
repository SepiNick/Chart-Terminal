// Runs compiled MQL programs on chart data: experts (bar-by-bar ticks through the MT-style broker), indicators
// (OnCalculate / start + IndicatorCounted) and scripts (OnStart). Results are converted to the Pine Outputs shape so the
// chart renders them with the same code path.
import type { Bar } from '../data.ts';
import { MqlArray, MqlError, type CompiledProgram, type Env, type BrokerView, type ChartObject, type PlotProps, type Dialect, type CompileResult, type Rt } from './contract.ts';
import { compile, instantiate } from './compiler/index.ts';
import { installStd, STD_OUT_PARAMS, STD_STRUCTS, STD_CLASSES, NATIVE_INCLUDES } from './lib/index.ts';
import { installTrade, TRADE_OUT_PARAMS, TRADE_STRUCTS, TRADE_CLASSES, TRADE_INCLUDES } from './trade/index.ts';
import type { Outputs, Plot, Drawing2, ScriptInput } from '../pine/interp.ts';
import type { Trade } from '../pine/strategy.ts';

export function compileMql(mainPath: string, files: Record<string, string>): CompileResult {
  return compile(mainPath, files, {
    outParams: { ...STD_OUT_PARAMS, ...TRADE_OUT_PARAMS },
    builtinStructs: [...STD_STRUCTS, ...TRADE_STRUCTS], builtinClasses: [...STD_CLASSES, ...TRADE_CLASSES],
    nativeIncludes: [...NATIVE_INCLUDES, ...TRADE_INCLUDES],
  });
}

export type MqlKind = 'expert' | 'indicator' | 'script';
export type TickModel = 'open' | 'ohlc' | 'close';
export interface MqlRunOpts {
  dialect: Dialect; symbol: string; tfSec: number; digits: number; spreadPoints: number;
  inputs?: Record<string, unknown>; model?: TickModel; account?: Partial<Env['account']>;
  barsFor?: (symbol: string, tfSec: number) => Bar[];
}
export interface MqlRun {
  kind: MqlKind; out: Outputs; logs: { level: string; msg: string; bar: number }[];
  broker?: BrokerView; equity: number[]; initialBalance: number; error?: string; ms: number;
}

const EMPTY = 1.7976931348623157e308, EMPTY4 = 2147483647;   // EMPTY_VALUE: DBL_MAX in MQL5, INT_MAX in MQL4
const bgr = (c: number | undefined): string | null => {
  if (c == null || c < 0 || c === 0xffffffff || !Number.isFinite(c)) return null;
  const r = c & 255, g = (c >> 8) & 255, b = (c >> 16) & 255;
  return `#${[r, g, b].map(x => x.toString(16).padStart(2, '0')).join('')}`;
};
// DRAW_* values from the public enumeration (MQL5 ENUM_DRAW_TYPE; MQL4 uses 0 line, 1 section, 2 histogram, 3 arrow, 12 none).
const DRAW5 = { NONE: 0, LINE: 1, SECTION: 2, HISTOGRAM: 3, HISTOGRAM2: 4, ARROW: 5, ZIGZAG: 6, FILLING: 7, BARS: 8, CANDLES: 9, COLOR_LINE: 10, COLOR_SECTION: 11, COLOR_HISTOGRAM: 12, COLOR_HISTOGRAM2: 13, COLOR_ARROW: 14, COLOR_ZIGZAG: 15, COLOR_BARS: 16, COLOR_CANDLES: 17 };
const DRAW4 = { LINE: 0, SECTION: 1, HISTOGRAM: 2, ARROW: 3, ZIGZAG: 4, NONE: 12 };
/** Data buffers consumed by an MQL5 plot type, and whether a color-index buffer follows. */
function buffersFor(type: number): [number, boolean] {
  switch (type) {
    case DRAW5.HISTOGRAM2: case DRAW5.ZIGZAG: case DRAW5.FILLING: return [2, false];
    case DRAW5.BARS: case DRAW5.CANDLES: return [4, false];
    case DRAW5.COLOR_HISTOGRAM2: case DRAW5.COLOR_ZIGZAG: return [2, true];
    case DRAW5.COLOR_BARS: case DRAW5.COLOR_CANDLES: return [4, true];
    case DRAW5.COLOR_LINE: case DRAW5.COLOR_SECTION: case DRAW5.COLOR_HISTOGRAM: case DRAW5.COLOR_ARROW: return [1, true];
    default: return [1, false];
  }
}

export function detectKind(p: CompiledProgram, dialect: Dialect): MqlKind {
  const h = p.handlers, props = p.props;
  if (h.OnCalculate || props.indicator_chart_window || props.indicator_separate_window || props.indicator_buffers != null) return 'indicator';
  if (h.OnTick) return 'expert';
  if (h.OnStart) return 'script';
  if (dialect === 'mql4' && h.start) return props.show_inputs || props.script_show_inputs ? 'script' : 'expert';
  return 'script';
}

export function runMql(js: string, bars: Bar[], o: MqlRunOpts): MqlRun {
  const t0 = performance.now();
  const point = 10 ** -o.digits, n = bars.length;
  const logs: MqlRun['logs'] = [];
  let cur = n - 1, price = bars[n - 1]?.close ?? 0, stopped = false;
  // The current bar is exposed as it looks at the current tick: no lookahead into its final high/low/close.
  const view: Bar[] = bars.map(b => ({ ...b }));
  const reveal = (i: number, p: number, first: boolean) => {
    const b = bars[i], v = view[i];
    if (first) { v.open = b.open; v.high = p; v.low = p; v.close = p; v.volume = 0 }
    v.high = Math.max(v.high, p); v.low = Math.min(v.low, p); v.close = p; v.volume = b.volume;
  };
  const account = { balance: 10000, leverage: 100, hedging: o.dialect === 'mql4', currency: 'USD', contractSize: 1, commissionPerLot: 0, minLot: 0.001, lotStep: 0.001, maxLot: 1000, stopLevelPoints: 0, ...o.account };
  const env: Env = {
    dialect: o.dialect, bars: view, cur: () => cur, price: () => price, symbol: o.symbol, tfSec: o.tfSec, digits: o.digits, point, spreadPoints: o.spreadPoints,
    now: () => view[cur]?.time ?? 0, barsFor: (s, tf) => (o.barsFor?.(s, tf) ?? []),
    log: (level, msg) => { if (logs.length < 2000) logs.push({ level, msg, bar: cur }) },
    objects: new Map<string, ChartObject>(), buffers: new Map(), plots: new Map<number, PlotProps>(),
    indicator: { levels: [] }, stop: () => { stopped = true }, account,
  };
  const rt: Rt = {};
  installStd(rt, env);
  installTrade(rt, env);
  const prog = instantiate(js, rt);
  for (const [k, v] of Object.entries(o.inputs ?? {})) {
    const def = prog.inputs.find(i => i.name === k);
    const opt = typeof v === 'string' ? def?.options?.find(x => x.name === v) : undefined;   // enum inputs come back from the dialog as names
    prog.setInput(k, opt ? opt.value : v);
  }
  const kind = detectKind(prog, o.dialect), h = prog.handlers;
  const broker = rt.__broker as BrokerView;
  const equity: number[] = [];
  let error: string | undefined;
  const call = (name: keyof CompiledProgram['handlers'], ...args: unknown[]) => { const f = h[name]; return f ? f(...args) : undefined };
  try {
    const init = call('OnInit') ?? call('init');
    if (typeof init === 'number' && init !== 0) throw new MqlError(`OnInit failed with code ${init}`);
    if (kind === 'indicator') runIndicator();
    else if (kind === 'script') { cur = n - 1; call('OnStart') ?? call('start') }
    else runExpert();
    call('OnDeinit', 0) ?? call('deinit');
  } catch (e) { error = e instanceof MqlError ? `${e.message}` : (e as Error).message ?? String(e) }

  function runIndicator() {
    for (const { arr } of env.buffers.values()) { arr.resize(n); arr.data.fill(EMPTY as never); if (o.dialect === 'mql4' && !arr.series) arr.series = true }
    cur = n - 1;
    const series = (f: (b: Bar) => number) => { const a = new MqlArray<number>(n); a.data = bars.map(f); a.series = o.dialect === 'mql4'; return a };
    if (h.OnCalculate) {
      const oc = h.OnCalculate as (...a: unknown[]) => unknown;
      if (oc.length <= 4) oc(n, 0, 0, series(b => b.close));
      else oc(n, 0, series(b => b.time), series(b => b.open), series(b => b.high), series(b => b.low), series(b => b.close), series(b => b.volume), series(b => b.volume), series(() => o.spreadPoints));
    } else { rt.__counted = 0; call('start') }
  }
  function runExpert() {
    const model = o.model ?? 'ohlc', spread = o.spreadPoints * point;
    for (let i = 0; i < n && !stopped; i++) {
      const b = bars[i];
      const ticks = model === 'open' ? [b.open] : model === 'close' ? [b.close] : b.close >= b.open ? [b.open, b.low, b.high, b.close] : [b.open, b.high, b.low, b.close];
      cur = i;
      ticks.forEach((p, k) => {
        if (stopped) return;
        price = p; reveal(i, p, k === 0);
        broker.onTick(p, p + spread, b.time);
        call('OnTick') ?? call('start');
      });
      equity[i] = broker.equity();
    }
  }

  const out = toOutputs(env, prog, kind, o.dialect, bars, broker);
  out.inputs = prog.inputs.map((i): ScriptInput => {
    const t = i.type.toLowerCase(), raw = o.inputs?.[i.name] ?? (i.options ? i.options.find(x => x.value === i.def)?.name ?? i.def : i.def);
    return { id: i.name, title: i.comment?.trim() || i.name, group: i.group, def: i.def as never, value: raw as never, options: i.options?.map(x => x.name),
      type: i.options ? 'string' : t === 'bool' ? 'bool' : t === 'string' ? 'string' : t === 'color' ? 'color' : /int|long|short|char|datetime/.test(t) ? 'int' : 'float' };
  });
  return { kind, out, logs, broker: kind === 'expert' ? broker : undefined, equity, initialBalance: account.balance, error, ms: performance.now() - t0 };
}

/** Convert indicator buffers, levels and chart objects into Pine Outputs for rendering. */
function toOutputs(env: Env, prog: CompiledProgram, kind: MqlKind, dialect: Dialect, bars: Bar[], broker: BrokerView): Outputs {
  const n = bars.length, props = prog.props;
  const out: Outputs = {
    meta: { kind: 'indicator', title: env.indicator.shortName ?? String(props.description ?? 'MQL program'), shorttitle: env.indicator.shortName ?? '', overlay: kind !== 'indicator' || !props.indicator_separate_window, precision: env.indicator.digits },
    inputs: [], plots: [], hlines: [], fills: [], bgcolors: [], barcolors: [], alertconditions: [], alerts: [], drawings: [], logs: [], warnings: [],
  };
  // Chronological values of buffer k (indicator buffers may be series-indexed).
  const chrono = (k: number): number[] => {
    const b = env.buffers.get(k); if (!b) return [];
    const d = b.arr.data as number[];
    const vals = d.slice();   // MqlArray keeps data chronological; `series` only flips indexing
    return Array.from({ length: n }, (_, i) => { const v = vals[i]; return v == null || v === EMPTY || v === EMPTY4 || !Number.isFinite(v) ? NaN : v });
  };
  if (kind === 'indicator') {
    const dataIdx = [...env.buffers.entries()].filter(([, b]) => b.kind !== 'calc').map(([k]) => k).sort((a, b) => a - b);
    const nPlots = Number(props.indicator_plots ?? (dialect === 'mql4' ? props.indicator_buffers ?? dataIdx.length : dataIdx.length));
    let bi = 0;
    for (let p = 0; p < nPlots; p++) {
      const pp = env.plots.get(p) ?? {};
      const type = pp.type ?? Number(props[`indicator_type${p + 1}`] ?? (dialect === 'mql4' ? DRAW4.LINE : DRAW5.LINE));
      const color = bgr(pp.color?.[0] ?? (props[`indicator_color${p + 1}`] as number)) ?? ['#2962ff', '#ff9800', '#e91e63', '#00bcd4'][p % 4];
      const label = pp.label ?? String(props[`indicator_label${p + 1}`] ?? `Plot ${p + 1}`);
      const width = pp.width ?? Number(props[`indicator_width${p + 1}`] ?? 1);
      const [nb, hasColor] = dialect === 'mql5' ? buffersFor(type) : [1, false];
      const vals = chrono(dataIdx[bi] ?? bi), colIdx = hasColor ? chrono(dataIdx[bi + nb] ?? bi + nb) : null;
      bi += nb + (hasColor ? 1 : 0);
      if ((dialect === 'mql5' && type === DRAW5.NONE) || (dialect === 'mql4' && type === DRAW4.NONE) || pp.show === false) continue;
      const begin = pp.begin ?? 0;
      const palette = pp.color?.length ? pp.color.map(c => bgr(c)) : [color];
      const colors = vals.map((_, i) => colIdx && Number.isFinite(colIdx[i]) ? palette[colIdx[i]] ?? color : color);
      const values = vals.map((v, i) => (i < begin ? NaN : v));
      const isArrow = dialect === 'mql5' ? type === DRAW5.ARROW || type === DRAW5.COLOR_ARROW : type === DRAW4.ARROW;
      const isHist = dialect === 'mql5' ? [DRAW5.HISTOGRAM, DRAW5.COLOR_HISTOGRAM, DRAW5.HISTOGRAM2, DRAW5.COLOR_HISTOGRAM2].includes(type) : type === DRAW4.HISTOGRAM;
      const plot: Plot = {
        id: `m${p}`, title: label, kind: isArrow ? 'char' : 'line', values, colors, linewidth: width, offset: pp.shift ?? 0, histbase: 0, display: true, trackprice: false,
        style: isHist ? 'style_histogram' : (dialect === 'mql5' ? [DRAW5.SECTION, DRAW5.COLOR_SECTION, DRAW5.ZIGZAG].includes(type) : type === DRAW4.SECTION || type === DRAW4.ZIGZAG) ? 'style_linebr' : 'style_line',
        ...(isArrow ? { char: arrowChar(pp.arrow), location: 'absolute' } : {}),
      };
      out.plots.push(plot);
    }
    env.indicator.levels.forEach((l, i) => out.hlines.push({ id: `l${i}`, title: '', price: l.value, color: bgr(l.color) ?? '#787b86', linestyle: 'style_dotted', linewidth: 1, display: true }));
    for (let i = 1; i <= 32; i++) if (props[`indicator_level${i}`] != null) out.hlines.push({ id: `pl${i}`, title: '', price: Number(props[`indicator_level${i}`]), color: '#787b86', linestyle: 'style_dotted', linewidth: 1, display: true });
  }
  // Chart objects → Pine-style drawings (bar_time x positions).
  let id = 0;
  for (const ob of env.objects.values()) {
    const col = bgr(ob.props.color as number ?? ob.props[0] as number) ?? '#2962ff', t = (k: number) => (ob.time[k] ?? 0) * 1000;
    const name = String(ob.type);
    const d: Drawing2 | null =
      [1, 2, 3].includes(ob.type) || name === 'OBJ_TREND' ? (ob.type === 1 ? { type: 'line', id: ++id, x1: bars[0]?.time * 1000, y1: ob.price[0], x2: bars.at(-1)!.time * 1000, y2: ob.price[0], xloc: 'bar_time', extend: 'both', color: col, width: 1, style: 'style_solid' } // OBJ_HLINE
        : ob.type === 0 ? null
        : { type: 'line', id: ++id, x1: t(0), y1: ob.price[0], x2: t(1), y2: ob.price[1] ?? ob.price[0], xloc: 'bar_time', extend: ob.props.ray || ob.props.ray_right ? 'right' : 'none', color: col, width: Number(ob.props.width ?? 1), style: 'style_solid' })
      : ob.type === 16 ? { type: 'box', id: ++id, left: t(0), top: ob.price[0], right: t(1), bottom: ob.price[1], xloc: 'bar_time', border_color: col, border_width: 1, bgcolor: col + '33', text: '', text_color: col, extend: 'none' }
      : ob.type === 21 || ob.type === 22 ? { type: 'label', id: ++id, x: t(0), y: ob.price[0], xloc: 'bar_time', yloc: 'price', text: String(ob.props.text ?? ob.name), color: col, style: 'style_none', textcolor: col, size: 'normal' }
      : null;
    if (d) out.drawings.push(d);
  }
  // Experts: show executions as strategy-style markers via a minimal broker shim.
  if (kind === 'expert') {
    out.meta.overlay = true;
    (out as Outputs & { mqlDeals?: BrokerView['deals'] }).mqlDeals = broker.deals;
  }
  return out;
}
const arrowChar = (code?: number) => ({ 233: '▲', 234: '▼', 241: '↑', 242: '↓', 159: '●', 108: '●', 115: '◆', 117: '◆', 251: '✖', 252: '✔' } as Record<number, string>)[code ?? 159] ?? '●';

/** Pair MT-style deals into closed trades for the shared Strategy Tester report. */
export function tradesFromDeals(deals: BrokerView['deals'], times: number[]): Trade[] {
  const barOf = (t: number) => { let lo = 0, hi = times.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (times[m] <= t) lo = m; else hi = m - 1 } return lo };
  const opens = new Map<number, BrokerView['deals'][number]>(), out: Trade[] = [];
  for (const d of deals) {
    if (d.entry === 'in') { opens.set(d.position, d); continue }
    const o = opens.get(d.position); if (!o) continue;
    const dir = o.type === 'buy' ? 'long' : 'short';
    out.push({ entryId: o.comment || `#${o.order}`, exitId: d.comment || `#${d.order}`, dir, qty: d.volume, entryBar: barOf(o.time), entryTime: o.time, entryPrice: o.price,
      exitBar: barOf(d.time), exitTime: d.time, exitPrice: d.price, profit: d.profit + d.commission + d.swap, profitPct: ((d.price - o.price) / o.price) * 100 * (dir === 'long' ? 1 : -1),
      commission: -(d.commission + o.commission), runup: 0, drawdown: 0, comment: d.comment });
    if (d.entry === 'inout') opens.set(d.position, { ...d, entry: 'in' });
  }
  return out;
}
