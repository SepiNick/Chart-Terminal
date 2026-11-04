// Draw.* static methods → NtResult.draws. A tag replaces the previous object with the same tag. Anchors are
// barsAgo (relative to the owner's current bar) or DateTime; output times are bar open times in unix seconds.
import { curEngine } from './base.ts';
import { css, isBrush } from './brushes.ts';
import { NtDateTime } from './helpers.ts';
import type { BarsCtx } from './series.ts';

type Kind = 'line' | 'ray' | 'hline' | 'vline' | 'rect' | 'text' | 'arrowUp' | 'arrowDown' | 'dot' | 'triangleUp' | 'triangleDown' | 'diamond' | 'square';
const DEFAULT = '#1e90ff', TEXT = '#d1d4dc';

function timeOf(owner: any, x: unknown): number {
  const c: BarsCtx = owner.__b, b = c.bars;
  if (!b.length) return 0;
  const i = x instanceof NtDateTime ? c.indexAt(x) : c.cur - Math.trunc(Number(x));
  return i < 0 ? b[0].time + i * c.tfSec : i >= b.length ? b[b.length - 1].time + (i - b.length + 1) * c.tfSec : b[i].time;
}
function store(owner: any, r: any) {
  const e = curEngine();
  if (owner === e.root) { e.draws.delete(r.Tag); e.draws.set(r.Tag, r) }
  return r;
}
/** pts: number of (barsAgo|time, y) anchors; text: a text argument precedes the anchors. */
function tool(type: Kind, pts: number, text = false) {
  return (owner: any, tag: string, ...a: any[]) => {
    let i = typeof a[0] === 'boolean' ? 1 : 0;
    const r: any = { type, tag: String(tag), Tag: String(tag), t1: 0, p1: 0, color: '', IsLocked: false };
    if (text) r.text = String(a[i++] ?? '');
    if (type === 'hline') { r.p1 = +a[i++]; r.t1 = timeOf(owner, 0) }
    else if (type === 'vline') { r.t1 = timeOf(owner, a[i++]); r.p1 = 0 }
    for (let k = 1; k <= pts; k++) { r['t' + k] = timeOf(owner, a[i++]); r['p' + k] = +a[i++] }
    r.color = css(a.slice(i).find(isBrush)) ?? (text ? TEXT : DEFAULT);
    return store(owner, r);
  };
}
function textFixed(owner: any, tag: string, text: string, position?: string, ...a: any[]) {
  const c: BarsCtx = owner.__b, last = c.bars[c.bars.length - 1];
  return store(owner, { type: 'text', tag: String(tag), Tag: String(tag), t1: last?.time ?? 0, p1: last?.close ?? 0, text: String(text), position, color: css(a.find(isBrush)) ?? TEXT });
}

const Draw = {
  Line: tool('line', 2), Ray: tool('ray', 2), ExtendedLine: tool('ray', 2), ArrowLine: tool('line', 2),
  Rectangle: tool('rect', 2), Ellipse: tool('rect', 2),
  HorizontalLine: tool('hline', 0), VerticalLine: tool('vline', 0),
  Text: tool('text', 1, true), TextFixed: textFixed,
  ArrowUp: tool('arrowUp', 1), ArrowDown: tool('arrowDown', 1), Dot: tool('dot', 1), Diamond: tool('diamond', 1),
  Square: tool('square', 1), TriangleUp: tool('triangleUp', 1), TriangleDown: tool('triangleDown', 1),
};
/** Unknown Draw.X methods log a warning once and return a dummy object instead of failing the script. */
export const DrawProxy = new Proxy(Draw as Record<string, unknown>, {
  get: (t, k: string) => t[k] ?? ((..._: unknown[]) => { curEngine().warn(`Draw.${k} is not supported; ignored`); return { Tag: '' } }),
});
