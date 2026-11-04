// Repaint / lookahead check for Pine scripts (the problem TradingView users complain about: an indicator that shows
// a different history than it showed live, so its backtest is better than anything that could have been traded).
// For a few bars near the end of the data the script runs twice: on all bars, and on the bars up to one bar past the
// checked one (so bar k is already closed, and no later data exists). A value drawn at bar k that differs between the
// two used information from after k. Plots, bar and background colours and alert conditions are compared.
// This finds lookahead (future data). It does not find the live behaviour of the newest bar (request.security
// shows the still-forming higher-timeframe bar there, as TradingView does): that needs a live feed to observe.
import type { Bar } from '../data.ts';
import { tfSeconds } from '../data.ts';
import { runScript } from './engine.ts';
import type { RunOpts, Outputs } from './interp.ts';

export interface Mismatch { bar: number; time: number; what: string; cut: string; full: string }
export interface RepaintReport {
  verdict: 'stable' | 'repaints' | 'error' | 'too-short';
  checked: number; mismatches: Mismatch[]; error?: string; ms: number;
}
const same = (a: unknown, b: unknown) => (typeof a === 'number' && typeof b === 'number' ? (Number.isNaN(a) && Number.isNaN(b)) || Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b)) : a === b);
const show = (x: unknown) => (x == null ? 'na' : typeof x === 'number' ? (Number.isNaN(x) ? 'na' : String(+x.toPrecision(8))) : String(x));

/** Values of everything a script draws at bar `i`, keyed by what drew it. */
function at(out: Outputs, i: number): Map<string, unknown> {
  const m = new Map<string, unknown>();
  out.plots.forEach((p, k) => {
    m.set(`plot ${k} "${p.title}"`, p.values[i]);
    if (p.ohlc) for (const f of ['o', 'h', 'l', 'c'] as const) m.set(`plot ${k} "${p.title}" ${f}`, p.ohlc[f][i]);
  });
  m.set('bar colour', out.barcolors[i]); m.set('background colour', out.bgcolors[i]);
  out.alertconditions.forEach(a => m.set(`alertcondition "${a.title}"`, a.fired[i] ?? false));
  return m;
}

export function checkRepaint(src: string, bars: Bar[], opts: RunOpts, o: { points?: number; tail?: number; budgetMs?: number } = {}): RepaintReport {
  const t0 = performance.now(), points = o.points ?? 10, tail = Math.min(o.tail ?? 300, bars.length - 30), budget = o.budgetMs ?? 8000;
  if (bars.length < 60 || tail < 5) return { verdict: 'too-short', checked: 0, mismatches: [], ms: 0 };
  const full = runScript(src, bars, opts);
  if (!full.out) return { verdict: 'error', checked: 0, mismatches: [], error: full.error?.msg ?? 'The script did not run', ms: performance.now() - t0 };
  if (full.out.meta.kind === 'library') return { verdict: 'stable', checked: 0, mismatches: [], ms: performance.now() - t0 };
  const sec = tfSeconds(opts.tf), idx = Array.from({ length: Math.min(points, tail) }, (_, j) => bars.length - 2 - Math.round((j * (tail - 1)) / Math.max(1, Math.min(points, tail) - 1)) - 1).filter((k, j, a) => k >= 30 && a.indexOf(k) === j).sort((a, b) => a - b);
  const mismatches: Mismatch[] = [];
  let checked = 0;
  for (const k of idx) {
    if (performance.now() - t0 > budget) break;
    // Other-symbol data a script asks for must also stop at bar k: only higher-timeframe bars that had closed by then.
    const cutoff = bars[k + 1].time + sec, security = opts.security ? (s: string, tf: string) => opts.security!(s, tf)?.filter(b => b.time + tfSeconds(tf) <= cutoff) : undefined;
    const cut = runScript(src, bars.slice(0, k + 2), { ...opts, ...(security ? { security } : {}) });
    if (!cut.out) return { verdict: 'error', checked, mismatches, error: cut.error?.msg ?? 'The script failed on shortened data', ms: performance.now() - t0 };
    checked++;
    const a = at(cut.out, k), b = at(full.out, k);
    for (const [what, v] of a) if (!same(v, b.get(what))) mismatches.push({ bar: k, time: bars[k].time, what, cut: show(v), full: show(b.get(what)) });
  }
  return { verdict: mismatches.length ? 'repaints' : 'stable', checked, mismatches, ms: performance.now() - t0 };
}

/** One paragraph for the editor's console. */
export function repaintSummary(r: RepaintReport): string {
  if (r.verdict === 'too-short') return 'Repaint check: needs at least 60 bars.';
  if (r.verdict === 'error') return `Repaint check could not run: ${r.error}`;
  if (r.verdict === 'stable') return `Repaint check passed: ${r.checked} bars compared with and without the data after them, no differences (intrabar real-time repainting is not covered).`;
  const bars = new Set(r.mismatches.map(m => m.bar)).size, what = [...new Set(r.mismatches.map(m => m.what))].slice(0, 4).join(', ');
  const m = r.mismatches[0];
  return `This script repaints: on ${bars} of ${r.checked} bars checked, ${what} shows a different value once later bars exist (e.g. ${m.what}: ${m.cut} without later data, ${m.full} with it). Its history uses information that was not available at the time, so a backtest of it is too good. Usual causes: request.security with lookahead_on, or a value read from the bar being confirmed.`;
}
