// Array functions. Logical indexing (respecting AS_SERIES) via get/set unless noted.
import { MqlArray, type Env, type Rt } from '../contract.ts';
import { isWhole, num, str } from './util.ts';
import { copy } from './structs.ts';

export class SeriesArray extends MqlArray<number> {
  read: (i: number) => number; len: () => number;
  constructor(read: (i: number) => number, len: () => number) { super(0, 0); this.read = read; this.len = len; this.series = true; this.fixed = true }
  get(i: number) { return this.read(i) }
  set(): number { throw new Error('predefined series are read-only') }
  get size() { return this.len() }
}

const vals = (a: MqlArray) => Array.from({ length: a.size }, (_, i) => a.get(i));
const cmp = (x: unknown, y: unknown): number => {
  if (x instanceof MqlArray && y instanceof MqlArray) return cmp(x.get(0), y.get(0));
  return (x as number) < (y as number) ? -1 : (x as number) > (y as number) ? 1 : 0;
};
const range = (env: Env, a: MqlArray, start: unknown, count: unknown) => {
  const s = Math.max(0, num(start) || 0), n = a.size;
  return [s, isWhole(env, count) ? n : Math.min(n, s + num(count))] as const;
};

export function installArray(rt: Rt, env: Env) {
  const m4 = env.dialect === 'mql4';
  const ext = (better: (a: number, b: number) => boolean) => (a: MqlArray<number>, x?: number, y?: number) => {
    const [s, e] = m4 ? range(env, a, y ?? 0, x) : range(env, a, x ?? 0, y);
    let r = -1;
    for (let i = s; i < e; i++) if (r < 0 || better(a.get(i), a.get(r))) r = i;
    return r;
  };
  Object.assign(rt, {
    ArrayResize: (a: MqlArray, n: number, reserve = 0) => {
      void reserve;
      if (a.fixed) return -1;
      n = Math.max(0, num(n));
      if (a.fill && typeof a.fill === 'object') { const old = a.data.length; a.data.length = Math.min(old, n); for (let i = old; i < n; i++) a.data.push(copy(a.fill)); return n }
      return a.resize(n);
    },
    ArraySize: (a: MqlArray) => { const f = a.size ? a.get(0) : a.fill; return f instanceof MqlArray ? a.size * f.size : a.size },
    ArrayRange: (a: MqlArray, d: number) => { let x: unknown = a; for (let i = 0; i < d; i++) x = x instanceof MqlArray ? (x.size ? x.get(0) : x.fill) : undefined; return x instanceof MqlArray ? x.size : 0 },
    ArrayDimension: (a: MqlArray) => { let n = 0, x: unknown = a; while (x instanceof MqlArray) { n++; x = x.size ? x.get(0) : x.fill } return n },
    ArrayFree: (a: MqlArray) => { if (!a.fixed) a.data = [] },
    ArrayInitialize: (a: MqlArray, v: unknown): number => {
      let n = 0;
      for (let i = 0; i < a.data.length; i++) { const x = a.data[i]; if (x instanceof MqlArray) n += (rt.ArrayInitialize as (a: MqlArray, v: unknown) => number)(x, v); else { a.data[i] = v; n++ } }
      return n;
    },
    ArrayFill: (a: MqlArray, start: number, count: number, v: unknown) => {
      if (!a.fixed && a.data.length < start + count) a.resize(start + count);
      for (let i = start; i < Math.min(a.data.length, start + count); i++) a.data[i] = v;   // physical order: AS_SERIES ignored
    },
    ArrayCopy: (dst: MqlArray, src: MqlArray, ds = 0, ss = 0, count?: number) => {
      const n = src.size; ss = Math.max(0, ss);
      let c = isWhole(env, count) ? n - ss : Math.min(num(count), n - ss);
      if (c <= 0) return 0;
      if (dst.size < ds + c) { if (dst.fixed) c = Math.max(0, dst.size - ds); else dst.resize(ds + c) }
      const tmp = Array.from({ length: c }, (_, i) => src.get(ss + i));
      for (let i = 0; i < c; i++) dst.set(ds + i, copy(tmp[i]));
      return c;
    },
    ArraySetAsSeries: (a: MqlArray, f: boolean) => { if (a instanceof SeriesArray) return false; a.series = !!f; return true },
    ArrayGetAsSeries: (a: MqlArray) => a.series,
    ArrayIsSeries: (a: MqlArray) => a instanceof SeriesArray,
    ArrayIsDynamic: (a: MqlArray) => !a.fixed,
    ArrayMaximum: ext((a, b) => a > b), ArrayMinimum: ext((a, b) => a < b),
    ArraySort: (a: MqlArray, x?: number, y?: number, dir = 1) => {
      const [s, e] = m4 ? range(env, a, y ?? 0, x) : [0, a.size];
      const v = vals(a).slice(s, e).sort(cmp);
      if (m4 && dir === 2) v.reverse();
      v.forEach((x, i) => a.set(s + i, x));
      return true;
    },
    ArrayBsearch: (a: MqlArray<number>, v: number) => {
      const n = a.size; if (!n) return -1;
      let lo = 0, hi = n - 1;
      while (lo < hi) { const m = (lo + hi) >> 1; if (a.get(m) < v) lo = m + 1; else hi = m }
      if (lo > 0 && Math.abs(a.get(lo - 1) - v) <= Math.abs(a.get(lo) - v) && a.get(lo) !== v) return lo - 1;
      return lo;
    },
    ArrayCompare: (a: MqlArray, b: MqlArray, as = 0, bs = 0, count?: number) => {
      const whole = isWhole(env, count), na = whole ? a.size - as : Math.min(num(count), a.size - as), nb = whole ? b.size - bs : Math.min(num(count), b.size - bs);
      for (let i = 0; i < Math.min(na, nb); i++) { const c = cmp(a.get(as + i), b.get(bs + i)); if (c) return c }
      return na === nb ? 0 : na < nb ? -1 : 1;
    },
    ArrayReverse: (a: MqlArray, start = 0, count?: number) => {
      const [s, e] = range(env, a, start, count), v = vals(a).slice(s, e).reverse();
      v.forEach((x, i) => a.set(s + i, x)); return true;
    },
    ArrayInsert: (dst: MqlArray, src: MqlArray, ds: number, ss = 0, count?: number) => {
      if (dst.fixed) return false;
      const ins = vals(src).slice(ss, isWhole(env, count) ? undefined : ss + num(count)).map(copy), v = vals(dst);
      v.splice(Math.min(ds, v.length), 0, ...ins);
      dst.resize(v.length); v.forEach((x, i) => dst.set(i, x)); return true;
    },
    ArrayRemove: (a: MqlArray, start: number, count?: number) => {
      if (a.fixed) return false;
      const v = vals(a); v.splice(start, isWhole(env, count) ? v.length : num(count));
      a.resize(v.length); v.forEach((x, i) => a.set(i, x)); return true;
    },
    ArraySwap: (a: MqlArray, b: MqlArray) => { if (a.fixed || b.fixed) return false; [a.data, b.data] = [b.data, a.data]; [a.series, b.series] = [b.series, a.series]; return true },
    ArrayPrint: (a: MqlArray, digits?: number, sep = ' ', start = 0, count?: number) => {
      const [s, e] = range(env, a, start, count), d = digits ?? env.digits;
      const f = (x: unknown) => (typeof x === 'number' && !Number.isInteger(x) ? x.toFixed(d) : str(x));
      const v = vals(a).slice(s, e);
      if (v[0] && typeof v[0] === 'object' && !(v[0] instanceof MqlArray)) v.forEach((o, i) => env.log('print', `[${s + i}] ${Object.values(o as object).map(f).join(sep)}`));
      else env.log('print', v.map(f).join(sep));
    },
  });
}
