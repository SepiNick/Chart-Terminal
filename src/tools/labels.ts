// The text label a user can put on a line or channel (the "T" button in the drawing toolbar): where it goes, as pure geometry.
// A drawing offers a "frame": its upper and lower edge as screen segments (one and the same segment for a plain line).
// The label sits at the left / centre / right of that frame, above (top), on (middle) or below (bottom) it.
import type { XY } from './types.ts';

export type LabelH = 'left' | 'center' | 'right';
export type LabelV = 'top' | 'middle' | 'bottom';
export interface Frame { top: [XY, XY]; bottom: [XY, XY] }
export interface LabelAt { x: number; y: number; align: 'left' | 'center' | 'right'; baseline: 'top' | 'middle' | 'bottom' }

const meanY = (s: [XY, XY]) => (s[0][1] + s[1][1]) / 2;
/** Two edges, in either order, as a frame whose `top` is the one higher on the screen. */
export const frameOf = (a: [XY, XY], b: [XY, XY]): Frame => (meanY(a) <= meanY(b) ? { top: a, bottom: b } : { top: b, bottom: a });

/** The part of a segment inside 0..W horizontally (so "left" and "right" mean the visible ends), or null when it is entirely outside. */
export function clipX(s: [XY, XY], W: number): [XY, XY] | null {
  const [a, b] = s, dx = b[0] - a[0];
  if (dx === 0) return a[0] >= 0 && a[0] <= W ? s : null;
  const at = (x: number): XY => [x, a[1] + ((x - a[0]) / dx) * (b[1] - a[1])];
  const lo = Math.min(a[0], b[0]), hi = Math.max(a[0], b[0]);
  if (hi < 0 || lo > W) return null;
  const p = at(Math.max(lo, 0)), q = at(Math.min(hi, W));
  return [p, q];
}

export function labelAt(f: Frame, h: LabelH, v: LabelV, W: number, gap = 6): LabelAt | null {
  const top = clipX(f.top, W), bottom = clipX(f.bottom, W);
  if (!top || !bottom) return null;
  const at = (s: [XY, XY]): XY => { const [l, r] = s[0][0] <= s[1][0] ? [s[0], s[1]] : [s[1], s[0]], u = h === 'left' ? 0 : h === 'right' ? 1 : 0.5; return [l[0] + (r[0] - l[0]) * u, l[1] + (r[1] - l[1]) * u] };
  const inset = h === 'left' ? gap : h === 'right' ? -gap : 0, align = h;
  if (v === 'top') { const p = at(top); return { x: p[0] + inset, y: p[1] - gap, align, baseline: 'bottom' } }
  if (v === 'bottom') { const p = at(bottom); return { x: p[0] + inset, y: p[1] + gap, align, baseline: 'top' } }
  const a = at(top), b = at(bottom);
  return { x: (a[0] + b[0]) / 2 + inset, y: (a[1] + b[1]) / 2, align, baseline: 'middle' };
}
