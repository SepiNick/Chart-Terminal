// Builtin structs (value types), rt.__copy, and a small native subset of the Standard Library classes
// (CObject, CArray*, CString) implemented from their public documentation.
import { MqlArray, MqlError, type Rt } from '../contract.ts';

class MqlDateTime { year = 1970; mon = 1; day = 1; hour = 0; min = 0; sec = 0; day_of_week = 4; day_of_year = 0 }
export class MqlRates { time = 0; open = 0; high = 0; low = 0; close = 0; tick_volume = 0; spread = 0; real_volume = 0 }
export class MqlTick { time = 0; bid = 0; ask = 0; last = 0; volume = 0; time_msc = 0; flags = 0; volume_real = 0 }
export class MqlParam { type = 0; integer_value = 0; double_value = 0; string_value = '' }
const STRUCTS = new Set<unknown>([MqlDateTime, MqlRates, MqlTick, MqlParam]);

/** Value copy: MqlArrays and structs are deep-copied; class instances (reference types) are shared. */
export function copy<T>(x: T): T {
  if (x instanceof MqlArray) {
    const a = new MqlArray(0, copy(x.fill), x.fixed);
    a.data = x.data.map(copy); a.series = x.series;
    return a as T;
  }
  if (x && typeof x === 'object') {
    const p = Object.getPrototypeOf(x);
    if (p === Object.prototype || STRUCTS.has(p.constructor) || (x as { __struct?: boolean }).__struct || p.constructor?.__struct) {
      const o = Object.create(p);
      for (const k of Object.keys(x)) o[k] = copy((x as Record<string, unknown>)[k]);
      return o;
    }
  }
  return x;
}

class CObject {
  m_prev: CObject | null = null; m_next: CObject | null = null;
  Prev(n?: CObject | null) { if (n === undefined) return this.m_prev; this.m_prev = n; return n }
  Next(n?: CObject | null) { if (n === undefined) return this.m_next; this.m_next = n; return n }
  Compare(_node: CObject, _mode = 0): number { return 0 }
  Type() { return 0 }
  Save(_h: number) { return true } Load(_h: number) { return true }
}

/** Shared implementation for CArrayDouble/Int/Long/String/Char/Short/Float. */
class CArrayBase<T> extends CObject {
  m_data: T[] = []; m_sort_mode = -1; m_step_resize = 16;
  Step(s?: number) { if (s === undefined) return this.m_step_resize; this.m_step_resize = s; return true }
  Total() { return this.m_data.length }
  Available() { return 0 } Max() { return this.m_data.length }
  IsSorted(mode = 0) { return this.m_sort_mode === mode }
  SortMode() { return this.m_sort_mode }
  Clear() { this.m_data = []; this.m_sort_mode = -1 }
  Shutdown() { this.Clear(); return true }
  Reserve(_n: number) { return true }
  Resize(n: number) { if (n < this.m_data.length) this.m_data.length = Math.max(0, n); return true }
  Add(v: T) { this.m_data.push(v); this.m_sort_mode = -1; return true }
  AddArray(src: MqlArray<T> | CArrayBase<T>) { const v = src instanceof MqlArray ? Array.from({ length: src.size }, (_, i) => src.get(i)) : src.m_data; this.m_data.push(...v); this.m_sort_mode = -1; return true }
  AssignArray(src: MqlArray<T> | CArrayBase<T>) { this.m_data = []; return this.AddArray(src) }
  Insert(v: T, pos: number) { if (pos < 0 || pos > this.m_data.length) return false; this.m_data.splice(pos, 0, v); this.m_sort_mode = -1; return true }
  InsertSort(v: T) { const i = this.SearchGreatOrEqual(v); this.m_data.splice(i < 0 ? this.m_data.length : i, 0, v); return true }
  At(i: number): T { return this.m_data[i] ?? this.blank() }
  Update(i: number, v: T) { if (i < 0 || i >= this.m_data.length) return false; this.m_data[i] = v; this.m_sort_mode = -1; return true }
  Shift(i: number, d: number) { const j = i + d; if (i < 0 || j < 0 || i >= this.m_data.length || j >= this.m_data.length) return false; const [v] = this.m_data.splice(i, 1); this.m_data.splice(j, 0, v); return true }
  Delete(i: number) { if (i < 0 || i >= this.m_data.length) return false; this.m_data.splice(i, 1); return true }
  DeleteRange(a: number, b: number) { if (a < 0 || b < a || a >= this.m_data.length) return false; this.m_data.splice(a, b - a + 1); return true }
  CompareArray(o: CArrayBase<T>) { return o.m_data.length === this.m_data.length && o.m_data.every((v, i) => v === this.m_data[i]) }
  Sort(mode = 0) { this.m_data.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)); this.m_sort_mode = mode }
  private lb(v: T) { let lo = 0, hi = this.m_data.length; while (lo < hi) { const m = (lo + hi) >> 1; if (this.m_data[m] < v) lo = m + 1; else hi = m } return lo }
  Search(v: T) { const i = this.lb(v); return this.m_data[i] === v ? i : -1 }
  SearchGreat(v: T) { let i = this.lb(v); while (i < this.m_data.length && this.m_data[i] === v) i++; return i < this.m_data.length ? i : -1 }
  SearchLess(v: T) { const i = this.lb(v) - 1; return i >= 0 ? i : -1 }
  SearchGreatOrEqual(v: T) { const i = this.lb(v); return i < this.m_data.length ? i : -1 }
  SearchLessOrEqual(v: T) { let i = this.lb(v); while (i < this.m_data.length && this.m_data[i] === v) i++; return i - 1 >= 0 ? i - 1 : -1 }
  SearchFirst(v: T) { return this.Search(v) }
  SearchLast(v: T) { const i = this.SearchLessOrEqual(v); return i >= 0 && this.m_data[i] === v ? i : -1 }
  SearchLinear(v: T) { return this.m_data.indexOf(v) }
  Minimum(start = 0, count = -1) { return this.ext(start, count, (a, b) => a < b) }
  Maximum(start = 0, count = -1) { return this.ext(start, count, (a, b) => a > b) }
  private ext(start: number, count: number, better: (a: T, b: T) => boolean) {
    const e = count < 0 ? this.m_data.length : Math.min(this.m_data.length, start + count); let r = -1;
    for (let i = start; i < e; i++) if (r < 0 || better(this.m_data[i], this.m_data[r])) r = i;
    return r;
  }
  protected blank(): T { return 0 as T }
}
class CArrayDouble extends CArrayBase<number> { Type() { return 87 } }
class CArrayInt extends CArrayBase<number> { Type() { return 82 } }
class CArrayLong extends CArrayBase<number> { Type() { return 84 } }
class CArrayString extends CArrayBase<string> { Type() { return 89 } protected blank() { return '' } }

class CArrayObj extends CObject {
  m_data: (CObject | null)[] = []; m_free_mode = true; m_sort_mode = -1;
  Type() { return 0x7778 }
  FreeMode(m?: boolean) { if (m === undefined) return this.m_free_mode; this.m_free_mode = m; return true }
  Total() { return this.m_data.length }
  Clear() { this.m_data = []; this.m_sort_mode = -1 }
  Shutdown() { this.Clear(); return true }
  Reserve(_n: number) { return true }
  Add(o: CObject) { if (!o) return false; this.m_data.push(o); this.m_sort_mode = -1; return true }
  AddArray(s: CArrayObj) { this.m_data.push(...s.m_data); return true }
  AssignArray(s: CArrayObj) { this.m_data = [...s.m_data]; return true }
  Insert(o: CObject, pos: number) { if (!o || pos < 0 || pos > this.m_data.length) return false; this.m_data.splice(pos, 0, o); return true }
  At(i: number) { return this.m_data[i] ?? null }
  Update(i: number, o: CObject) { if (i < 0 || i >= this.m_data.length) return false; this.m_data[i] = o; return true }
  Delete(i: number) { if (i < 0 || i >= this.m_data.length) return false; this.m_data.splice(i, 1); return true }
  DeleteRange(a: number, b: number) { if (a < 0 || b < a) return false; this.m_data.splice(a, b - a + 1); return true }
  Detach(i: number) { if (i < 0 || i >= this.m_data.length) return null; return this.m_data.splice(i, 1)[0] }
  CreateElement(_i: number) { return false }
  Sort(mode = 0) { this.m_data.sort((a, b) => (a && b ? a.Compare(b, mode) : 0)); this.m_sort_mode = mode }
  Search(o: CObject) { for (let i = 0; i < this.m_data.length; i++) if (this.m_data[i]!.Compare(o, this.m_sort_mode) === 0) return i; return -1 }
  SearchLinear(o: CObject) { return this.Search(o) }
  IsSorted(mode = 0) { return this.m_sort_mode === mode }
}

class CString extends CObject {
  m_string = '';
  Str() { return this.m_string } Len() { return this.m_string.length }
  Copy(r: { v: string }) { r.v = this.m_string }
  Fill(c: number) { this.m_string = String.fromCharCode(c).repeat(this.m_string.length); return true }
  Assign(s: string | CString) { this.m_string = s instanceof CString ? s.m_string : String(s) }
  Append(s: string | CString) { this.m_string += s instanceof CString ? s.m_string : String(s) }
  Insert(pos: number, s: string) { this.m_string = this.m_string.slice(0, pos) + s + this.m_string.slice(pos); return this.m_string.length }
  Compare(s: unknown): number { const t = s instanceof CString ? s.m_string : String(s); return this.m_string < t ? -1 : this.m_string > t ? 1 : 0 }
  CompareNoCase(s: string | CString) { const a = this.m_string.toLowerCase(), b = (s instanceof CString ? s.m_string : s).toLowerCase(); return a < b ? -1 : a > b ? 1 : 0 }
  Left(n: number) { return this.m_string.slice(0, n) } Right(n: number) { return this.m_string.slice(-n) } Mid(p: number, n: number) { return this.m_string.substr(p, n) }
  Trim(t = ' \t\r\n') { this.TrimLeft(t); return this.TrimRight(t) }
  TrimLeft(t = ' \t\r\n') { const n = this.m_string.length; while (this.m_string && t.includes(this.m_string[0])) this.m_string = this.m_string.slice(1); return n - this.m_string.length }
  TrimRight(t = ' \t\r\n') { const n = this.m_string.length; while (this.m_string && t.includes(this.m_string.at(-1)!)) this.m_string = this.m_string.slice(0, -1); return n - this.m_string.length }
  Truncate(n: number) { this.m_string = this.m_string.slice(0, n); return true }
  Remove(s: string) { const p = this.m_string.split(s); this.m_string = p.join(''); return p.length - 1 }
  Replace(a: string, b: string) { const p = this.m_string.split(a); this.m_string = p.join(b); return p.length - 1 }
  Find(start: number, s: string) { return this.m_string.indexOf(s, start) }
  FindRev(s: string) { return this.m_string.lastIndexOf(s) }
  ToUpper() { this.m_string = this.m_string.toUpperCase(); return true } ToLower() { this.m_string = this.m_string.toLowerCase(); return true }
  Reverse() { this.m_string = [...this.m_string].reverse().join('') }
}

export const STRUCT_CTORS = { MqlDateTime, MqlRates, MqlTick, MqlParam };
export const CLASS_CTORS = { CObject, CArrayDouble, CArrayInt, CArrayLong, CArrayString, CArrayObj, CString };

export function installStructs(rt: Rt) {
  Object.assign(rt, STRUCT_CTORS, CLASS_CTORS, { __copy: copy });
  rt.CheckPointer = (p: unknown) => (!p || (p as { __dead?: boolean }).__dead ? 0 : 1);   // POINTER_INVALID / POINTER_DYNAMIC
  rt.POINTER_INVALID = 0; rt.POINTER_DYNAMIC = 1; rt.POINTER_AUTOMATIC = 2;
  rt.GetPointer = (p: unknown) => { if (!p) throw new MqlError('invalid pointer', 4012); return p };
}
