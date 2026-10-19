// Math functions (MQL4/MQL5 names and the MQL4 C-style aliases).
import type { Rt } from '../contract.ts';
import { num } from './util.ts';

const round = (x: number) => Math.sign(x) * Math.round(Math.abs(x));   // half away from zero, like C round()

export function installMath(rt: Rt) {
  let seed = 1;
  const rand = () => { seed = (Math.imul(seed, 214013) + 2531011) >>> 0; return (seed >>> 16) & 0x7fff };
  const srand = (s: number) => { seed = num(s) >>> 0 };
  const f: Record<string, (...a: number[]) => number | boolean> = {
    Abs: Math.abs, Arccos: Math.acos, Arcsin: Math.asin, Arctan: Math.atan, Arctan2: Math.atan2, Ceil: Math.ceil, Cos: Math.cos, Exp: Math.exp,
    Floor: Math.floor, Log: Math.log, Log10: Math.log10, Log2: Math.log2, Log1p: Math.log1p, Expm1: Math.expm1, Max: Math.max, Min: Math.min,
    Mod: (a, b) => a % b, Pow: Math.pow, Rand: rand, Round: round, Sin: Math.sin, Sqrt: Math.sqrt, Tan: Math.tan,
    Sinh: Math.sinh, Cosh: Math.cosh, Tanh: Math.tanh, Arcsinh: Math.asinh, Arccosh: Math.acosh, Arctanh: Math.atanh,
    IsValidNumber: x => Number.isFinite(x), Srand: srand as never,
  };
  for (const k in f) rt['Math' + k] = f[k];
  Object.assign(rt, {
    fabs: Math.abs, fmax: Math.max, fmin: Math.min, fmod: (a: number, b: number) => a % b, pow: Math.pow, sqrt: Math.sqrt, log: Math.log, log10: Math.log10,
    exp: Math.exp, round, floor: Math.floor, ceil: Math.ceil, rand, srand, sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos,
    atan: Math.atan, atan2: Math.atan2, abs: Math.abs, sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
  });
}
