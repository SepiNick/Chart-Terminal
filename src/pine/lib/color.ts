// color.* builtins. Colors are CSS strings: '#rrggbb' when opaque, '#rrggbbaa' otherwise. na color = null.
import { type Builtin, type PineValue, arg, num } from '../types.ts';

export const COLOR_CONSTS: Record<string, PineValue> = {
  aqua: '#00bcd4', black: '#363a45', blue: '#2196f3', fuchsia: '#e040fb', gray: '#787b86', green: '#4caf50', lime: '#00e676',
  maroon: '#880e4f', navy: '#311b92', olive: '#808000', orange: '#ff9800', purple: '#9c27b0', red: '#f23645', silver: '#b2b5be',
  teal: '#089981', white: '#ffffff', yellow: '#fdd835',
};

type RGBA = [number, number, number, number];   // r,g,b 0-255, a 0-1
export function parse(c: PineValue | undefined): RGBA | null {
  if (typeof c !== 'string') return null;
  let m = c.match(/^#([0-9a-f]{3,8})$/i);
  if (m) {
    let h = m[1];
    if (h.length <= 4) h = [...h].map(x => x + x).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
    return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
  }
  m = c.match(/^rgba?\(([^)]+)\)$/i);
  if (!m) return null;
  const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
  return p.length >= 3 && p.every(x => !Number.isNaN(x)) ? [p[0], p[1], p[2], p[3] ?? 1] : null;
}
const hx = (n: number) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0');
export const make = ([r, g, b, a]: RGBA) => {
  const al = Math.round(Math.min(1, Math.max(0, a)) * 255);
  return '#' + hx(r) + hx(g) + hx(b) + (al === 255 ? '' : hx(al));
};
const alpha = (transp: number) => 1 - (Number.isNaN(transp) ? 0 : transp) / 100;
const part = (i: number): Builtin => (_, a, nm) => { const c = parse(arg(a, nm, 0, 'color')); return c ? c[i] : NaN };

export const COLOR: Record<string, Builtin> = {
  new: (_, a, nm) => { const c = parse(arg(a, nm, 0, 'color')); return c ? make([c[0], c[1], c[2], alpha(num(arg(a, nm, 1, 'transp', 0)))]) : null },
  rgb: (_, a, nm) => {
    const [r, g, b] = ['red', 'green', 'blue'].map((k, i) => num(arg(a, nm, i, k)));
    return [r, g, b].some(Number.isNaN) ? null : make([r, g, b, alpha(num(arg(a, nm, 3, 'transp', 0)))]);
  },
  r: part(0), g: part(1), b: part(2),
  // integer transparency: exactly recovers integer transp values despite 8-bit alpha
  t: (_, a, nm) => { const c = parse(arg(a, nm, 0, 'color')); return c ? Math.round((1 - c[3]) * 100) : NaN },
  from_gradient: (_, a, nm) => {
    const [v, lo, hi] = ['value', 'bottom_value', 'top_value'].map((k, i) => num(arg(a, nm, i, k)));
    const c0 = parse(arg(a, nm, 3, 'bottom_color')), c1 = parse(arg(a, nm, 4, 'top_color'));
    if (!c0 || !c1 || [v, lo, hi].some(Number.isNaN)) return null;
    const t = Math.min(1, Math.max(0, (v - lo) / (hi - lo) || 0));
    return make(c0.map((x, i) => x + (c1[i] - x) * t) as RGBA);
  },
};
