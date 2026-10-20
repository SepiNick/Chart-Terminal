// matrix.* and map.* builtins. Both are reference objects (PineObject), so method syntax (m.get(…)) routes here.
import { type Builtin, type PineValue, type PineObject, arg, num } from '../types.ts';

export interface PineMatrix extends PineObject { type: 'matrix'; d: PineValue[][]; cols: number }
export interface PineMap extends PineObject { type: 'map'; m: Map<PineValue, PineValue> }
type A = PineValue[]; type Nm = Record<string, PineValue>;

export const isMatrix = (v: unknown): v is PineMatrix => !!v && typeof v === 'object' && (v as PineObject).type === 'matrix';
export const isMap = (v: unknown): v is PineMap => !!v && typeof v === 'object' && (v as PineObject).type === 'map';
const mat = (d: PineValue[][], cols = d[0]?.length ?? 0): PineMatrix => ({ type: 'matrix', d, cols });
function M(a: A, nm: Nm, i = 0, name = 'id'): PineMatrix {
  const v = arg(a, nm, i, name);
  if (!isMatrix(v)) throw new Error('Cannot call matrix methods on an na matrix');
  return v;
}
function at(n: number, size: number, what: string): number {
  if (!(n >= 0 && n < size)) throw new Error(`The ${what} index ${n} is out of bounds (size ${size})`);
  return Math.floor(n);
}
const ix = (a: A, nm: Nm, i: number, name: string, size: number, what: string) => at(num(arg(a, nm, i, name)), size, what);
const nums = (m: PineMatrix) => m.d.flat().map(num).filter(x => !Number.isNaN(x));
const zip = (x: PineMatrix, y: PineMatrix | number, f: (p: number, q: number) => number) => {
  if (typeof y !== 'number' && (x.d.length !== y.d.length || x.cols !== y.cols)) throw new Error('Matrices must have the same dimensions');
  return mat(x.d.map((r, i) => r.map((v, j) => f(num(v), typeof y === 'number' ? y : num(y.d[i][j])))), x.cols);
};
const colOf = (a: A, nm: Nm, rows: number, i: number, name: string, def: PineValue) => {
  const v = arg(a, nm, i, name);
  return Array.isArray(v) ? (v.length === rows ? v : (() => { throw new Error(`Array size ${v.length} does not match the ${rows} rows`) })()) : Array(rows).fill(def);
};

export const MATRIX: Record<string, Builtin> = {
  new: (_, a, nm) => {
    const r = Math.max(0, num(arg(a, nm, 0, 'rows', 0)) || 0), c = Math.max(0, num(arg(a, nm, 1, 'columns', 0)) || 0), v = arg(a, nm, 2, 'initial_value', NaN);
    return mat(Array.from({ length: r }, () => Array(c).fill(v)), c);
  },
  get: (_, a, nm) => { const m = M(a, nm); return m.d[ix(a, nm, 1, 'row', m.d.length, 'row')][ix(a, nm, 2, 'column', m.cols, 'column')] },
  set: (_, a, nm) => { const m = M(a, nm); m.d[ix(a, nm, 1, 'row', m.d.length, 'row')][ix(a, nm, 2, 'column', m.cols, 'column')] = arg(a, nm, 3, 'value'); return NaN },
  rows: (_, a, nm) => M(a, nm).d.length,
  columns: (_, a, nm) => M(a, nm).cols,
  elements_count: (_, a, nm) => { const m = M(a, nm); return m.d.length * m.cols },
  row: (_, a, nm) => { const m = M(a, nm); return [...m.d[ix(a, nm, 1, 'row', m.d.length, 'row')]] },
  col: (_, a, nm) => { const m = M(a, nm), j = ix(a, nm, 1, 'column', m.cols, 'column'); return m.d.map(r => r[j]) },
  add_row: (_, a, nm) => {
    const m = M(a, nm), i = num(arg(a, nm, 1, 'row', m.d.length)), v = arg(a, nm, 2, 'array_id');
    const row = Array.isArray(v) ? [...v] : Array(m.cols).fill(NaN);
    if (m.d.length && row.length !== m.cols) throw new Error(`Array size ${row.length} does not match the ${m.cols} columns`);
    m.d.splice(at(i, m.d.length + 1, 'row'), 0, row); if (!m.cols) m.cols = row.length; return NaN;
  },
  add_col: (_, a, nm) => {
    const m = M(a, nm), j = at(num(arg(a, nm, 1, 'column', m.cols)), m.cols + 1, 'column'), col = colOf(a, nm, m.d.length, 2, 'array_id', NaN);
    m.d.forEach((r, i) => r.splice(j, 0, col[i])); m.cols++; return NaN;
  },
  remove_row: (_, a, nm) => { const m = M(a, nm); return m.d.splice(at(num(arg(a, nm, 1, 'row', m.d.length - 1)), m.d.length, 'row'), 1)[0] },
  remove_col: (_, a, nm) => { const m = M(a, nm), j = at(num(arg(a, nm, 1, 'column', m.cols - 1)), m.cols, 'column'); m.cols--; return m.d.map(r => r.splice(j, 1)[0]) },
  swap_rows: (_, a, nm) => { const m = M(a, nm), i = ix(a, nm, 1, 'row1', m.d.length, 'row'), j = ix(a, nm, 2, 'row2', m.d.length, 'row'); [m.d[i], m.d[j]] = [m.d[j], m.d[i]]; return NaN },
  fill: (_, a, nm) => { const m = M(a, nm), v = arg(a, nm, 1, 'value'); m.d.forEach(r => r.fill(v)); return NaN },
  copy: (_, a, nm) => { const m = M(a, nm); return mat(m.d.map(r => [...r]), m.cols) },
  transpose: (_, a, nm) => { const m = M(a, nm); return mat(Array.from({ length: m.cols }, (_, j) => m.d.map(r => r[j])), m.d.length) },
  sum: (_, a, nm) => { const y = arg(a, nm, 1, 'id2'); return zip(M(a, nm, 0, 'id1'), isMatrix(y) ? y : num(y), (p, q) => p + q) },
  diff: (_, a, nm) => { const y = arg(a, nm, 1, 'id2'); return zip(M(a, nm, 0, 'id1'), isMatrix(y) ? y : num(y), (p, q) => p - q) },
  mult: (_, a, nm) => {
    const x = M(a, nm, 0, 'id1'), y = arg(a, nm, 1, 'id2');
    if (Array.isArray(y)) {   // matrix × vector → array
      if (y.length !== x.cols) throw new Error('Array size must equal the number of matrix columns');
      return x.d.map(r => r.reduce<number>((s, v, k) => s + num(v) * num(y[k]), 0));
    }
    if (!isMatrix(y)) return zip(x, num(y), (p, q) => p * q);
    if (x.cols !== y.d.length) throw new Error('The first matrix columns must equal the second matrix rows');
    return mat(x.d.map(r => Array.from({ length: y.cols }, (_, j) => r.reduce<number>((s, v, k) => s + num(v) * num(y.d[k][j]), 0))), y.cols);
  },
  avg: (_, a, nm) => { const v = nums(M(a, nm)); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN },
  min: (_, a, nm) => { const v = nums(M(a, nm)); return v.length ? Math.min(...v) : NaN },
  max: (_, a, nm) => { const v = nums(M(a, nm)); return v.length ? Math.max(...v) : NaN },
  is_square: (_, a, nm) => { const m = M(a, nm); return m.d.length === m.cols },
};

function P(a: A, nm: Nm): PineMap {
  const v = arg(a, nm, 0, 'id');
  if (!isMap(v)) throw new Error('Cannot call map methods on an na map');
  return v;
}
const orNa = (v: PineValue | undefined): PineValue => (v === undefined ? NaN : v);

export const MAP: Record<string, Builtin> = {
  new: () => ({ type: 'map', m: new Map() }) as PineMap,
  put: (_, a, nm) => { const m = P(a, nm).m, k = arg(a, nm, 1, 'key'), old = m.get(k); m.set(k, arg(a, nm, 2, 'value')); return orNa(old) },
  get: (_, a, nm) => orNa(P(a, nm).m.get(arg(a, nm, 1, 'key'))),
  contains: (_, a, nm) => P(a, nm).m.has(arg(a, nm, 1, 'key')),
  remove: (_, a, nm) => { const m = P(a, nm).m, k = arg(a, nm, 1, 'key'), old = m.get(k); m.delete(k); return orNa(old) },
  size: (_, a, nm) => P(a, nm).m.size,
  keys: (_, a, nm) => [...P(a, nm).m.keys()],
  values: (_, a, nm) => [...P(a, nm).m.values()],
  clear: (_, a, nm) => { P(a, nm).m.clear(); return NaN },
  copy: (_, a, nm) => ({ type: 'map', m: new Map(P(a, nm).m) }) as PineMap,
  put_all: (_, a, nm) => { const m = P(a, nm).m, src = arg(a, nm, 1, 'id2'); if (isMap(src)) for (const [k, v] of src.m) m.set(k, v); return NaN },
};
