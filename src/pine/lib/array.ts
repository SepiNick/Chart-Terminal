// array.* builtins. Arrays are plain JS arrays (reference semantics). Also hosts shared numeric stats helpers.
import { type Builtin, type PineValue, arg, num, bool } from '../types.ts';
import { tostring } from './str.ts';

// ---- stats on number lists (callers filter na as needed) ----
export const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN);
export function variance(v: number[], biased = true) {
  const n = v.length, m = mean(v);
  return n < (biased ? 1 : 2) ? NaN : v.reduce((s, x) => s + (x - m) ** 2, 0) / (biased ? n : n - 1);
}
const asc = (v: number[]) => [...v].sort((a, b) => a - b);
export function median(v: number[]) { const s = asc(v), h = s.length >> 1; return !s.length ? NaN : s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2 }
export function pctLinear(v: number[], p: number) {
  const s = asc(v), n = s.length; if (!n || Number.isNaN(p)) return NaN;
  const r = Math.min(Math.max(p / 100, 0), 1) * (n - 1), lo = Math.floor(r);
  return s[lo] + (s[Math.min(lo + 1, n - 1)] - s[lo]) * (r - lo);
}
export function pctNearest(v: number[], p: number) {
  const s = asc(v), n = s.length; if (!n || Number.isNaN(p)) return NaN;
  return s[Math.min(n - 1, Math.max(0, Math.ceil((p / 100) * n) - 1))];
}
/** Most frequent value; ties -> smallest. */
export function mode(v: number[]) {
  const c = new Map<number, number>(); let best = NaN, bc = 0;
  for (const x of v) c.set(x, (c.get(x) ?? 0) + 1);
  for (const [x, k] of c) if (k > bc || (k === bc && x < best)) { best = x; bc = k }
  return best;
}
const nums = (a: PineValue[]) => a.map(num).filter(x => !Number.isNaN(x));

// ---- helpers ----
type A = PineValue[]; type Nm = Record<string, PineValue>;
function id(a: A, nm: Nm, i = 0, name = 'id'): PineValue[] {
  const v = arg(a, nm, i, name);
  if (!Array.isArray(v)) throw new Error('Cannot call array methods on an na array');
  return v;
}
function ix(arr: PineValue[], i: number, size = arr.length): number {
  const k = i < 0 ? size + i : i;
  if (!(k >= 0 && k < size)) throw new Error(`Index ${i} is out of bounds. Array size is ${arr.length}`);
  return Math.floor(k);
}
const naFor = (t: unknown): PineValue => (t === 'bool' ? false : t === 'float' || t === 'int' || t === undefined || t === '' ? NaN : null);
const mk = (t?: string): Builtin => (_, a, nm) => {
  const n = num(arg(a, nm, 0, 'size', 0)), v = arg(a, nm, 1, 'initial_value', naFor(t ?? nm.__type));
  return Array(Number.isNaN(n) ? 0 : Math.max(0, Math.floor(n))).fill(v);
};
const cmp = (a: PineValue, b: PineValue) => {
  if (typeof a === 'number' && typeof b === 'number') return Number.isNaN(a) ? 1 : Number.isNaN(b) ? -1 : a - b;
  const x = String(a), y = String(b); return x < y ? -1 : x > y ? 1 : 0;
};
const desc = (a: A, nm: Nm, i: number) => arg(a, nm, i, 'order', 'ascending') === 'descending';
const nth = (a: A, nm: Nm, big: boolean) => {
  const s = asc(nums(id(a, nm))), k = num(arg(a, nm, 1, 'nth', 0));
  return big ? s[s.length - 1 - k] ?? NaN : s[k] ?? NaN;
};

export const ARRAY: Record<string, Builtin> = {
  new: mk(), new_float: mk('float'), new_int: mk('int'), new_bool: mk('bool'), new_string: mk('string'), new_color: mk('color'),
  new_line: mk('line'), new_label: mk('label'), new_box: mk('box'), new_table: mk('table'), new_linefill: mk('linefill'),
  from: (_, a) => [...a],
  size: (_, a, nm) => id(a, nm).length,
  get: (_, a, nm) => { const v = id(a, nm); return v[ix(v, num(arg(a, nm, 1, 'index')))] },
  set: (_, a, nm) => { const v = id(a, nm); v[ix(v, num(arg(a, nm, 1, 'index')))] = arg(a, nm, 2, 'value'); return NaN },
  push: (_, a, nm) => { id(a, nm).push(arg(a, nm, 1, 'value')); return NaN },
  unshift: (_, a, nm) => { id(a, nm).unshift(arg(a, nm, 1, 'value')); return NaN },
  pop: (_, a, nm) => { const v = id(a, nm); if (!v.length) throw new Error('Cannot pop from an empty array'); return v.pop()! },
  shift: (_, a, nm) => { const v = id(a, nm); if (!v.length) throw new Error('Cannot shift from an empty array'); return v.shift()! },
  insert: (_, a, nm) => { const v = id(a, nm); v.splice(ix(v, num(arg(a, nm, 1, 'index')), v.length + 1), 0, arg(a, nm, 2, 'value')); return NaN },
  remove: (_, a, nm) => { const v = id(a, nm); return v.splice(ix(v, num(arg(a, nm, 1, 'index'))), 1)[0] },
  clear: (_, a, nm) => { id(a, nm).length = 0; return NaN },
  concat: (_, a, nm) => { const v = id(a, nm, 0, 'id1'); v.push(...id(a, nm, 1, 'id2')); return v },
  copy: (_, a, nm) => [...id(a, nm)],
  // ponytail: slice returns a copy, not a live view of the source like Pine; add a view type if scripts rely on it.
  slice: (_, a, nm) => { const v = id(a, nm), e = num(arg(a, nm, 2, 'index_to', v.length)); return v.slice(num(arg(a, nm, 1, 'index_from', 0)), Number.isNaN(e) ? v.length : e) },
  includes: (_, a, nm) => { const x = arg(a, nm, 1, 'value'); return id(a, nm).some(y => y === x || (Number.isNaN(x) && Number.isNaN(y))) },
  indexof: (_, a, nm) => id(a, nm).indexOf(arg(a, nm, 1, 'value')),
  lastindexof: (_, a, nm) => id(a, nm).lastIndexOf(arg(a, nm, 1, 'value')),
  reverse: (_, a, nm) => { id(a, nm).reverse(); return NaN },
  sort: (_, a, nm) => { const d = desc(a, nm, 1); id(a, nm).sort((x, y) => (d ? -cmp(x, y) : cmp(x, y))); return NaN },
  sort_indices: (_, a, nm) => { const v = id(a, nm), d = desc(a, nm, 1); return v.map((_, i) => i).sort((x, y) => (d ? -cmp(v[x], v[y]) : cmp(v[x], v[y]))) },
  binary_search: (_, a, nm) => { const v = id(a, nm), x = num(arg(a, nm, 1, 'val')); let lo = 0, hi = v.length - 1; while (lo <= hi) { const m = (lo + hi) >> 1, y = num(v[m]); if (y === x) return m; if (y < x) lo = m + 1; else hi = m - 1 } return -1 },
  first: (_, a, nm) => { const v = id(a, nm); return v[ix(v, 0)] },
  last: (_, a, nm) => { const v = id(a, nm); return v[ix(v, -1)] },
  fill: (_, a, nm) => {
    const v = id(a, nm), e = num(arg(a, nm, 3, 'index_to', v.length));
    v.fill(arg(a, nm, 1, 'value'), num(arg(a, nm, 2, 'index_from', 0)), Number.isNaN(e) ? v.length : e); return NaN;
  },
  join: (c, a, nm) => id(a, nm).map(x => tostring(x, undefined, c.mintick)).join(String(arg(a, nm, 1, 'separator', '') ?? '')),
  every: (_, a, nm) => id(a, nm).every(x => bool(x)),
  some: (_, a, nm) => id(a, nm).some(x => bool(x)),
  abs: (_, a, nm) => id(a, nm).map(x => Math.abs(num(x))),
  sum: (_, a, nm) => { const v = nums(id(a, nm)); return v.length ? v.reduce((s, x) => s + x, 0) : NaN },
  avg: (_, a, nm) => mean(nums(id(a, nm))),
  min: (_, a, nm) => nth(a, nm, false),
  max: (_, a, nm) => nth(a, nm, true),
  range: (_, a, nm) => { const v = nums(id(a, nm)); return v.length ? Math.max(...v) - Math.min(...v) : NaN },
  median: (_, a, nm) => median(nums(id(a, nm))),
  mode: (_, a, nm) => mode(nums(id(a, nm))),
  variance: (_, a, nm) => variance(nums(id(a, nm)), bool(arg(a, nm, 1, 'biased', true))),
  stdev: (_, a, nm) => Math.sqrt(variance(nums(id(a, nm)), bool(arg(a, nm, 1, 'biased', true)))),
  covariance: (_, a, nm) => {
    const x = id(a, nm, 0, 'id1').map(num), y = id(a, nm, 1, 'id2').map(num), n = Math.min(x.length, y.length), b = bool(arg(a, nm, 2, 'biased', true));
    const mx = mean(x.slice(0, n)), my = mean(y.slice(0, n));
    let s = 0; for (let i = 0; i < n; i++) s += (x[i] - mx) * (y[i] - my);
    return n < (b ? 1 : 2) ? NaN : s / (b ? n : n - 1);
  },
  standardize: (_, a, nm) => { const v = id(a, nm).map(num), m = mean(nums(v)), sd = Math.sqrt(variance(nums(v))); return v.map(x => (x - m) / sd) },
  percentile_linear_interpolation: (_, a, nm) => pctLinear(nums(id(a, nm)), num(arg(a, nm, 1, 'percentage'))),
  percentile_nearest_rank: (_, a, nm) => pctNearest(nums(id(a, nm)), num(arg(a, nm, 1, 'percentage'))),
  percentrank: (_, a, nm) => {
    const v = id(a, nm).map(num), x = v[ix(v, num(arg(a, nm, 1, 'index')))], o = v.filter(y => !Number.isNaN(y));
    return o.length < 2 ? NaN : (100 * (o.filter(y => y <= x).length - 1)) / (o.length - 1);
  },
};
