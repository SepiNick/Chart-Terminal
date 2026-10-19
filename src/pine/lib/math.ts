// math.* builtins. na (NaN) propagates through JS Math naturally.
import { type Builtin, type PineValue, arg, num } from '../types.ts';
import { sumK } from './ta.ts';

export const MATH_CONSTS: Record<string, PineValue> = { pi: Math.PI, e: Math.E, phi: 1.618033988749895, rphi: 0.618033988749895 };

const f1 = (fn: (x: number) => number, name = 'number'): Builtin => (_, a, nm) => fn(num(arg(a, nm, 0, name)));
const all = (a: PineValue[]) => a.map(num);
const mulberry = (s: number) => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return [s, ((t ^ (t >>> 14)) >>> 0) / 4294967296] };

export const MATH: Record<string, Builtin> = {
  abs: f1(Math.abs), floor: f1(Math.floor), ceil: f1(Math.ceil), sqrt: f1(Math.sqrt), exp: f1(Math.exp),
  log: f1(Math.log), log10: f1(Math.log10), sign: f1(Math.sign),
  sin: f1(Math.sin, 'angle'), cos: f1(Math.cos, 'angle'), tan: f1(Math.tan, 'angle'),
  asin: f1(Math.asin, 'angle'), acos: f1(Math.acos, 'angle'), atan: f1(Math.atan, 'angle'),
  todegrees: f1(x => (x * 180) / Math.PI, 'radians'), toradians: f1(x => (x * Math.PI) / 180, 'degrees'),
  pow: (_, a, nm) => num(arg(a, nm, 0, 'base')) ** num(arg(a, nm, 1, 'exponent')),
  max: (_, a) => Math.max(...all(a)),
  min: (_, a) => Math.min(...all(a)),
  avg: (_, a) => all(a).reduce((s, x) => s + x, 0) / a.length,
  sum: (c, a, nm) => sumK(c.state(() => ({})), num(arg(a, nm, 0, 'source')), num(arg(a, nm, 1, 'length'))),
  // ties round toward +inf (JS Math.round), per the reference's "ties rounding up"
  round: (_, a, nm) => {
    const x = num(arg(a, nm, 0, 'number')), p = num(arg(a, nm, 1, 'precision', 0)), k = 10 ** (Number.isNaN(p) ? 0 : p);
    return Math.round(x * k) / k;
  },
  round_to_mintick: (c, a, nm) => Math.round(+(num(arg(a, nm, 0, 'number')) / c.mintick).toFixed(9)) * c.mintick,
  random: (c, a, nm) => {
    const lo = num(arg(a, nm, 0, 'min', 0)), hi = num(arg(a, nm, 1, 'max', 1)), seed = arg(a, nm, 2, 'seed');
    let r = Math.random();
    if (seed !== undefined && !Number.isNaN(num(seed))) { const o = c.state(() => ({ s: num(seed) })); [o.s, r] = mulberry(o.s) }
    return lo + r * (hi - lo);
  },
};
