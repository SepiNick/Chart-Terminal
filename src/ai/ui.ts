// Chart glue for the automatic analysis (src/ai/analyze.ts): its lines, levels and patterns become ordinary drawings in
// one group per kind, so they can be moved, styled or deleted like hand-drawn ones; running it again replaces them.
import type { ChartPane } from '../chart.ts';
import { fetchBars, tfSeconds } from '../data.ts';
import { styleFor } from '../drawings.ts';
import { TOOL_MAP } from '../tools/index.ts';
import type { Drawing, Pt, Style } from '../tools/types.ts';
import { toast } from '../store.ts';
import { analyze } from './analyze.ts';

export const AUTO_GROUP = 'Auto analysis', HTF_GROUP = 'Higher-timeframe levels';
const UP = '#089981', DOWN = '#f23645', NEUTRAL = '#2962ff';
let seq = 0;

function drawing(type: string, pts: Pt[], style: Partial<Style>, group: string, name: string): Drawing | null {
  const def = TOOL_MAP.get(type);
  return def ? { id: Date.now() * 100 + (seq++ % 100), type, pts, style: { ...styleFor(def, style.color ?? NEUTRAL), ...style }, group, name } : null;
}
function replaceGroup(p: ChartPane, group: string, ds: (Drawing | null)[]) {
  const l = p.layer, keep = l.drawings.filter(d => d.group !== group);
  l.drawings.splice(0, l.drawings.length, ...keep, ...ds.filter((d): d is Drawing => !!d));   // in place: the array is the symbol's saved list
  l.onChange(); l.update();
}
export const clearAuto = (p: ChartPane) => { replaceGroup(p, AUTO_GROUP, []); replaceGroup(p, HTF_GROUP, []) };

/** Trend lines, support/resistance and patterns of the bars on the chart. */
export function autoAnalyze(p: ChartPane) {
  const b = p.vb(), a = analyze(b);
  if (!a.pivots.length) return toast('Not enough bars for an analysis');
  const ds: (Drawing | null)[] = [];
  for (const l of a.lines) {
    const c = l.kind === 'support' ? UP : DOWN;
    ds.push(drawing('ray', [{ t: l.a.t, p: l.a.p }, { t: l.b.t, p: l.b.p }], { color: c, width: 2, text: `${l.kind === 'support' ? 'Support' : 'Resistance'} trend (${l.touches})` }, AUTO_GROUP, `Auto ${l.kind} trend line`));
  }
  for (const v of a.levels) {
    const c = v.kind === 'support' ? UP : DOWN;
    ds.push(drawing('hray', [{ t: v.first, p: v.price }], { color: c, dash: 'dashed', text: `${v.kind === 'support' ? 'S' : 'R'} ×${v.touches}` }, AUTO_GROUP, `Auto ${v.kind} ${v.price.toFixed(p.prec)}`));
  }
  for (const pt of a.patterns) {
    const c = pt.dir === 'bullish' ? UP : pt.dir === 'bearish' ? DOWN : NEUTRAL;
    ds.push(drawing('polyline', pt.pts, { color: c, width: 2, fillAlpha: 0 }, AUTO_GROUP, pt.name));
    const top = pt.pts.reduce((m, x) => (x.p > m.p ? x : m));
    ds.push(drawing('text', [{ t: top.t, p: top.p }], { text: pt.name, textColor: c, color: c }, AUTO_GROUP, `${pt.name} label`));
    if (pt.neckline != null) ds.push(drawing('trend', [{ t: pt.pts[0].t, p: pt.neckline }, { t: pt.pts.at(-1)!.t, p: pt.neckline }], { color: c, dash: 'dotted', extendRight: true, text: 'Neckline' }, AUTO_GROUP, `${pt.name} neckline`));
  }
  replaceGroup(p, AUTO_GROUP, ds);
  toast(`Auto analysis: ${a.lines.length} trend lines, ${a.levels.length} levels, ${a.patterns.length} patterns${a.patterns.length ? ` (${a.patterns.map(x => x.name).join(', ')})` : ''}`, 6000);
}

/** The next timeframe up a trader usually checks. */
export function higherTf(tf: string): string {
  const s = tfSeconds(tf);
  return s < 900 ? '1h' : s < 3600 ? '4h' : s < 4 * 3600 ? '1d' : s < 86400 ? '1w' : '1M';
}
/** Support/resistance of the higher timeframe drawn on this chart (multi-timeframe overlay). */
export async function htfLevels(p: ChartPane) {
  const tf = higherTf(p.cfg.tf);
  let b;
  try { b = await fetchBars(p.cfg.symbol, tf) } catch (e) { return toast(`${tf} bars: ${(e as Error).message}`) }
  const a = analyze(b, 3);
  replaceGroup(p, HTF_GROUP, a.levels.map(v => drawing('hline', [{ t: v.first, p: v.price }], { color: v.kind === 'support' ? UP : DOWN, width: 2, dash: 'dashed', text: `${tf} ${v.kind === 'support' ? 'S' : 'R'} ×${v.touches}` }, HTF_GROUP, `${tf} ${v.kind} ${v.price.toFixed(p.prec)}`)));
  toast(`${a.levels.length} ${tf} levels added`);
}
