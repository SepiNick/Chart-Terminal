// Glue between the C# compiler, the NinjaScript runtime and the chart: compile installed .cs files together,
// run the chosen indicator/strategy on chart bars, convert results to Pine Outputs + Strategy Tester data.
import type { Bar } from '../data.ts';
import type { NtCompileResult, NtResult, NtRunOptions } from './contract.ts';
import { compile, instantiate } from './compiler/index.ts';
import { NT_GLOBALS, SESSION_INPUT, createRt, runNinja } from './runtime/index.ts';
import { DEFAULT_SESSION, TEMPLATES } from './runtime/session.ts';
import type { Outputs, Plot, Drawing2, ScriptInput } from '../pine/interp.ts';
import type { TesterData } from '../pine/report.ts';

export const compileNinja = (files: Record<string, string>): NtCompileResult => compile(files, { globals: NT_GLOBALS });

export interface NtRun { result: NtResult; out: Outputs; tester?: TesterData; ms: number }

/** Run class `className` from a successful compilation. `fileClasses` restricts the choice to classes of one file. */
export function runNinjaScript(cr: NtCompileResult, className: string, bars: Bar[], o: Omit<NtRunOptions, 'bars'>): NtRun {
  const t0 = performance.now();
  const rt = createRt();
  const classes = instantiate(cr.js!, rt);
  const result = runNinja(classes, className, rt, { ...o, bars });
  const info = cr.classes.find(c => c.name === className);
  const out = toOutputs(result, bars);
  out.inputs = (info?.inputs ?? []).map((i): ScriptInput => ({
    id: i.name, title: i.displayName || i.name, group: i.group || undefined, def: i.def as never, value: (o.inputs?.[i.name] ?? i.def) as never,
    options: i.options, min: i.min, max: i.max,
    type: i.options ? 'string' : /bool/i.test(i.type) ? 'bool' : /string/i.test(i.type) ? 'string' : /^(int|long|short|byte)$/i.test(i.type) ? 'int' : 'float',
  }));
  // NinjaTrader picks trading hours on the data series, not in code: offered here as one more setting of every script.
  const th = String(o.inputs?.[SESSION_INPUT] ?? o.session ?? DEFAULT_SESSION);
  out.inputs.push({ id: SESSION_INPUT, title: 'Trading hours', group: 'Session', type: 'string', def: DEFAULT_SESSION as never, value: th as never,
    options: Object.keys(TEMPLATES).includes(th) ? Object.keys(TEMPLATES) : [...Object.keys(TEMPLATES), th] });
  const tester = result.kind === 'strategy' && result.trades ? {
    trades: result.trades, equity: result.equity ?? [], initialCapital: result.initialCapital ?? o.initialCapital,
    openPL: result.openPL ?? 0, openCount: result.openCount ?? 0,
  } : undefined;
  return { result, out, tester, ms: performance.now() - t0 };
}

const STYLE: Record<string, string> = { line: 'style_line', bar: 'style_histogram', block: 'style_columns', dot: 'style_circles', cross: 'style_cross', hash: 'style_line', square: 'style_circles' };

function toOutputs(r: NtResult, bars: Bar[]): Outputs {
  const out: Outputs = {
    meta: { kind: 'indicator', title: r.name, shorttitle: r.name, overlay: r.overlay },
    inputs: [], plots: [], hlines: [], fills: [], bgcolors: r.backColors, barcolors: r.barColors, alertconditions: [], alerts: (r.alerts ?? []).map(a => ({ bar: a.bar, message: a.msg, freq: 'all' })), drawings: [],
    logs: r.logs.map(l => ({ bar: l.bar, level: 'info' as const, msg: l.msg })), warnings: r.error ? [r.error] : [],
  };
  r.plots.forEach((p, i) => {
    const shape = p.style === 'triangleUp' || p.style === 'triangleDown';
    const plot: Plot = {
      id: `n${i}`, title: p.name, kind: shape ? 'shape' : 'line', values: p.values, colors: p.colors.map(c => c ?? p.color),
      style: STYLE[p.style] ?? 'style_line', linewidth: p.width, offset: 0, histbase: 0, display: true, trackprice: false,
      ...(shape ? { shape: p.style === 'triangleUp' ? 'triangleup' : 'triangledown', location: 'absolute' } : {}),
    };
    out.plots.push(plot);
  });
  r.lines.forEach((l, i) => out.hlines.push({ id: `nl${i}`, title: l.name, price: l.value, color: l.color, linestyle: 'style_dashed', linewidth: 1, display: true }));
  let id = 0;
  const ms = (t: number) => t * 1000;
  for (const d of r.draws) {
    const x: Drawing2 | null =
      d.type === 'line' || d.type === 'ray' ? { type: 'line', id: ++id, x1: ms(d.t1), y1: d.p1, x2: ms(d.t2 ?? d.t1), y2: d.p2 ?? d.p1, xloc: 'bar_time', extend: d.type === 'ray' ? 'right' : 'none', color: d.color, width: 1, style: 'style_solid' }
      : d.type === 'hline' ? { type: 'line', id: ++id, x1: ms(bars[0]?.time ?? 0), y1: d.p1, x2: ms(bars.at(-1)?.time ?? 0), y2: d.p1, xloc: 'bar_time', extend: 'both', color: d.color, width: 1, style: 'style_dashed' }
      : d.type === 'rect' ? { type: 'box', id: ++id, left: ms(d.t1), top: d.p1, right: ms(d.t2 ?? d.t1), bottom: d.p2 ?? d.p1, xloc: 'bar_time', border_color: d.color, border_width: 1, bgcolor: d.color + '33', text: '', text_color: d.color, extend: 'none' }
      : d.type === 'vline' ? { type: 'line', id: ++id, x1: ms(d.t1), y1: Math.min(...bars.map(b => b.low)), x2: ms(d.t1), y2: Math.max(...bars.map(b => b.high)), xloc: 'bar_time', extend: 'none', color: d.color, width: 1, style: 'style_dotted' }
      : { type: 'label', id: ++id, x: ms(d.t1), y: d.p1, xloc: 'bar_time', yloc: 'price', text: d.text ?? ({ arrowUp: '▲', arrowDown: '▼', dot: '●', diamond: '◆', square: '■', triangleUp: '▲', triangleDown: '▼' } as Record<string, string>)[d.type] ?? '', color: d.color, style: 'style_none', textcolor: d.color, size: 'normal' };
    if (x) out.drawings.push(x);
  }
  if (r.executions) (out as Outputs & { mqlDeals?: unknown[] }).mqlDeals = r.executions.map(e => ({ time: e.time, type: e.side, volume: e.qty, entry: 'in', comment: e.name }));
  return out;
}
