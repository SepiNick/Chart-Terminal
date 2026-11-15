// C# AST → JS function body (see contract.ts "Generated code conventions"). Types are tracked just enough for C#
// semantics: integer truncation/division, char arithmetic, struct copies, overload resolution, Ref params, string conversion.
// User enums are JS strings (the member name); `(int)e` / `(E)i` convert through E.__v / E.__n.
import type { Diagnostic, NtInput, NtClassInfo } from '../contract.ts';
import type {
  Expr, Stmt, Decl, TypeRef, Pos, Arg, Pattern, ClassDecl, EnumDecl, DelegateDecl, MethodDecl, CtorDecl, IndexerDecl, FieldDecl, PropDecl, Accessor, InitItem, Hole,
} from './ast.ts';
import { PREDEF, MAX_ERRORS } from './parser.ts';

type Kind = 'int' | 'float' | 'bool' | 'string' | 'char' | 'void' | 'any' | 'obj' | 'arr' | 'fn' | 'null' | 'enum' | 'type' | 'ns';
interface Ty { k: Kind; n: string; el?: Ty; rank?: number; args?: Ty[]; cls?: ClassInfo; en?: EnumInfo; sig?: Sig; nul?: boolean; rt?: boolean }
interface PInfo { name: string; ty: Ty; mod: string; def: Expr | null; pos: Pos }
interface Sig { params: PInfo[]; ret: Ty | null }
interface FnDef { name: string; js: string; sig: Sig; min: number; isStatic: boolean; cls: ClassInfo; key: string; d: MethodDecl | CtorDecl }
interface FieldInfo { name: string; ty: Ty; isStatic: boolean; isConst: boolean; kind: 'field' | 'auto' | 'prop'; d: FieldDecl | PropDecl; owner: ClassInfo }
interface ClassInfo {
  name: string; js: string; decls: ClassDecl[]; kind: ClassDecl['kind']; isStatic: boolean; isAbstract: boolean; base: ClassInfo | null; baseRt: string;
  outer: ClassInfo | null; fields: Map<string, FieldInfo>; methods: Map<string, FnDef[]>; ctors: FnDef[]; sctors: CtorDecl[];
  indexer: { d: IndexerDecl; ty: Ty; params: PInfo[] } | null; tparams: Set<string>; pos: Pos;
}
interface EnumInfo { name: string; js: string; d: EnumDecl; vals: Map<string, number> }
interface Sym { js: string; ty: Ty; ref: boolean }
interface Group { defs: FnDef[]; self: string; sep: string; name: string }
interface R { c: string; ty: Ty; grp?: Group; lv?: boolean }
interface LV { get: string; set: (v: string) => string; ty: Ty; pre: string[]; refVar?: string; plain: boolean }
interface Ctx {
  cls: ClassInfo | null; isStatic: boolean; ret: Ty | null; ctor: boolean; temps: string[]; used: Set<string>;
  scopes: Map<string, Sym>[]; brk: (string | null)[]; catchVar: string | null; tnames: Set<string>;
}
export interface GenOptions { globals: string[]; usings: string[] }
export interface GenResult { js: string; classes: NtClassInfo[] }

const RESERVED = new Set(('arguments await break case catch class const continue debugger default delete do else enum eval export extends false finally for ' +
  'function if implements import in instanceof interface let new null package private protected public return static super switch this throw true try ' +
  'typeof var void while with yield undefined NaN Infinity rt ref Math Object Number String Array Date JSON Symbol Map Set Error Boolean Function ' +
  'Promise RegExp Reflect Proxy globalThis constructor prototype').split(' '));
const INT_NAMES: Record<string, string> = { int: 'int', Int32: 'int', uint: 'uint', UInt32: 'uint', long: 'long', Int64: 'long', ulong: 'ulong', UInt64: 'ulong',
  short: 'short', Int16: 'short', ushort: 'ushort', UInt16: 'ushort', byte: 'byte', Byte: 'byte', sbyte: 'sbyte', SByte: 'sbyte' };
const FLOAT_NAMES: Record<string, string> = { double: 'double', Double: 'double', float: 'float', Single: 'float', decimal: 'decimal', Decimal: 'decimal' };
const OTHER_PREDEF: Record<string, string> = { bool: 'bool', Boolean: 'bool', string: 'string', String: 'string', char: 'char', Char: 'char', object: 'object', Object: 'object', void: 'void', Convert: 'Convert' };
const IN_INT = new Set(['int', 'short', 'ushort', 'byte', 'sbyte']);
const NS_ROOTS = new Set(['System', 'NinjaTrader', 'Windows', 'Microsoft', 'global', 'SharpDX']);
// LINQ methods on arrays / List / Series / any sequence: dispatched at runtime by rt.__lq (Count() vs the Count property).
const LINQ = new Set(['Where', 'Select', 'Any', 'All', 'Count', 'Sum', 'Average', 'Min', 'Max', 'First', 'FirstOrDefault', 'Last', 'LastOrDefault',
  'OrderBy', 'OrderByDescending', 'Take', 'Skip', 'ToList', 'ToArray', 'Distinct', 'ElementAt', 'Contains']);
const DICTS = new Set(['Dictionary', 'IDictionary', 'SortedDictionary', 'SortedList', 'ConcurrentDictionary', 'IReadOnlyDictionary']);
const SEQS = new Set(['List', 'IList', 'IEnumerable', 'ICollection', 'IReadOnlyList', 'IReadOnlyCollection', 'Series', 'ISeries', 'HashSet', 'Queue', 'Stack', 'LinkedList', 'SortedSet', 'Collection', 'ObservableCollection']);
const MATH_INT = new Set(['Max', 'Min', 'Abs']);

const T = (k: Kind, n: string = k, x: Partial<Ty> = {}): Ty => ({ k, n, ...x });
const ANY = T('any'), INT = T('int'), LONG = T('int', 'long'), FLOAT = T('float', 'double'), BOOL = T('bool'), STR = T('string'), CHAR = T('char'), VOID = T('void'), NULLT = T('null');
const arrOf = (el: Ty, rank = 1): Ty => T('arr', 'array', { el, rank });
const SER = (el: Ty) => T('obj', 'Series', { args: [el] });
const NT_MEMBERS: Record<string, Ty> = {
  CurrentBar: INT, BarsInProgress: INT, Count: INT, BarsRequiredToPlot: INT, BarsRequiredToTrade: INT, Displacement: INT, TickSize: FLOAT,
  Name: STR, Description: STR, IsFirstTickOfBar: BOOL, IsOverlay: BOOL, Time: SER(ANY), Values: arrOf(SER(FLOAT)), CurrentBars: arrOf(INT), Times: arrOf(SER(ANY)),
};
for (const n of ['Open', 'High', 'Low', 'Close', 'Median', 'Typical', 'Weighted', 'Volume', 'Input', 'Value']) NT_MEMBERS[n] = SER(FLOAT);
for (const n of ['Opens', 'Highs', 'Lows', 'Closes', 'Volumes']) NT_MEMBERS[n] = arrOf(SER(FLOAT));
const NT_FNS: Record<string, Ty> = { CrossAbove: BOOL, CrossBelow: BOOL, IsRising: BOOL, IsFalling: BOOL, ToTime: INT, ToDay: INT, HighestBar: INT, LowestBar: INT, MRO: INT, LRO: INT };
const PD_CONST: Record<string, Record<string, unknown>> = {
  int: { MaxValue: 2147483647, MinValue: -2147483648 }, uint: { MaxValue: 4294967295, MinValue: 0 },
  long: { MaxValue: 9223372036854775807, MinValue: -9223372036854775808 }, ulong: { MaxValue: 18446744073709551615, MinValue: 0 },
  short: { MaxValue: 32767, MinValue: -32768 }, ushort: { MaxValue: 65535, MinValue: 0 }, byte: { MaxValue: 255, MinValue: 0 }, sbyte: { MaxValue: 127, MinValue: -128 },
  double: { MaxValue: Number.MAX_VALUE, MinValue: -Number.MAX_VALUE, NaN: NaN, Epsilon: Number.MIN_VALUE, PositiveInfinity: Infinity, NegativeInfinity: -Infinity },
  float: { MaxValue: 3.4028234663852886e38, MinValue: -3.4028234663852886e38, NaN: NaN, Epsilon: 1.401298464324817e-45, PositiveInfinity: Infinity, NegativeInfinity: -Infinity },
  decimal: { MaxValue: 79228162514264337593543950335, MinValue: -79228162514264337593543950335, Zero: 0, One: 1, MinusOne: -1 },
  string: { Empty: '' }, char: { MaxValue: '￿', MinValue: '\0' }, bool: { TrueString: 'True', FalseString: 'False' },
};

const PRELUDE = `'use strict';
// Loop budget: a runaway loop (while(true), a bad step) ends the run with an error instead of freezing the tab. Counted over the whole run.
let __n = 0;
const __t = () => { if (++__n > 3e8) throw new Error('Script stopped: loop budget exceeded (an endless loop?)'); return true };
const __nc = Symbol('noctor');
const __exc = (n, m) => { const e = new Error(m == null ? '' : String(m)); e.name = n; return e };
const __throw = e => { throw e };
const __i64 = x => Math.trunc(x) || 0;
const __ni = x => x == null ? null : x | 0;
const __div = (a, b) => { if (b == 0) throw __exc('DivideByZeroException', 'Attempted to divide by zero.'); return Math.trunc(a / b) };
const __mod = (a, b) => { if (b == 0) throw __exc('DivideByZeroException', 'Attempted to divide by zero.'); return a % b };
const __s = x => x == null ? '' : x;
const __str = x => x == null ? '' : typeof x === 'string' ? x : typeof x === 'boolean' ? (x ? 'True' : 'False') : typeof x === 'object' && typeof x.ToString === 'function' ? x.ToString() : rt.__fmt(x);
const __cl = x => x == null ? x : x.__clone();
const __arr = (d, v, k = 0) => Array.from({ length: d[k] }, k < d.length - 1 ? () => __arr(d, v, k + 1) : typeof v === 'function' ? v : () => v);
const __len = x => x.Length !== undefined ? x.Length : x.length;
const __glen = (a, d) => { for (; d > 0; d--) a = a[0]; return a ? a.length : 0 };
const __isrt = (x, n) => typeof rt[n] === 'function' && x instanceof rt[n];
const __isex = (e, n) => n === 'Exception' || n === 'SystemException' || (e != null && e.name === n) || (n === 'NullReferenceException' && e instanceof TypeError);
const __rcast = (x, n) => typeof rt.__cast === 'function' ? rt.__cast(x, n) : x;
const __cmp = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const __eq = (a, b) => a === b || (a != null && typeof a.Equals === 'function' && a.Equals(b));
const __join = (s, a) => Array.from(a, __str).join(s);
const __fe = () => __exc('FormatException', 'Input string was not in a correct format.');
const __pi = s => { const t = String(s).trim(), v = Number(t); if (t === '' || !Number.isInteger(v)) throw __fe(); return v };
const __pf = s => { const t = String(s).trim(), v = Number(t); if (t === '' || (Number.isNaN(v) && !/^nan$/i.test(t))) throw __fe(); return v };
const __pb = s => { const t = String(s).trim().toLowerCase(); if (t === 'true') return true; if (t === 'false') return false; throw __fe() };
const __try = (p, s, r, d) => { try { r.v = p(s); return true } catch { r.v = d; return false } };
const __rne = x => { const r = Math.round(x); return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r };
const __toi = x => typeof x === 'string' ? __pi(x) : typeof x === 'boolean' ? +x : __rne(x);
const __tof = x => typeof x === 'string' ? __pf(x) : +x;
const __ise = s => s == null || s === '';
const __isws = s => s == null || s.trim() === '';
const __split = (s, a) => typeof a === 'string' ? s.split(a) : s.split(new RegExp('[' + a.map(c => c.replace(/[\\\\\\]^-]/g, '\\\\$&')).join('') + ']'));
const __ch = { IsDigit: c => /^[0-9]$/.test(c), IsLetter: c => /^\\p{L}$/u.test(c), IsLetterOrDigit: c => /^[\\p{L}0-9]$/u.test(c), IsWhiteSpace: c => /^\\s$/.test(c),
  IsUpper: c => c !== c.toLowerCase(), IsLower: c => c !== c.toUpperCase(), IsPunctuation: c => /^\\p{P}$/u.test(c), ToUpper: c => c.toUpperCase(), ToLower: c => c.toLowerCase() };
const __nomatch = v => { throw __exc('SwitchExpressionException', 'Non-exhaustive switch expression (' + __str(v) + ')') };
const __gc = (o, i) => o == null ? null : rt.__get(o, i);
`;

const num = (t: Ty) => t.k === 'int' || t.k === 'float';
const tyName = (t: Ty): string => t.k === 'arr' ? tyName(t.el!) + `[${','.repeat((t.rank ?? 1) - 1)}]` : t.n;
const jsNum = (v: number) => Object.is(v, -0) ? '0' : v < 0 ? `(${v})` : String(v);
const jsVal = (v: unknown) => typeof v === 'number' ? jsNum(v) : JSON.stringify(v);
const isLvalExpr = (e: Expr) => e.k === 'id' || e.k === 'member' || e.k === 'index' || e.k === 'this';
const simple = (c: string) => /^[\w$.]+$/.test(c);
const pad = (n: number) => '  '.repeat(n);
const attr = <A extends { name: string }>(attrs: A[], n: string) => attrs.find(a => a.name === n);

export function generate(decls: Decl[], o: GenOptions, errors: Diagnostic[], warnings: Diagnostic[]): GenResult {
  const G = new Set(o.globals), roots = new Set([...NS_ROOTS, ...o.usings]);
  const classes = new Map<string, ClassInfo>(), enums = new Map<string, EnumInfo>(), delegates = new Map<string, DelegateDecl>();
  const warned = new Set<string>();
  const err = (p: Pos, msg: string) => { if (errors.length < MAX_ERRORS * 2) errors.push({ file: p.file, line: p.line, col: p.col, msg }) };
  const warn = (p: Pos, msg: string) => { const k = `${p.file}:${p.line}:${msg}`; if (!warned.has(k)) { warned.add(k); warnings.push({ file: p.file, line: p.line, col: p.col, msg }) } };
  const safe = (n: string) => RESERVED.has(n) || n.startsWith('__') ? '$' + n : n;
  let tempN = 0, labelN = 0;
  const newCtx = (cls: ClassInfo | null, isStatic: boolean, ret: Ty | null = null, ctor = false): Ctx =>
    ({ cls, isStatic, ret, ctor, temps: [], used: new Set(), scopes: [new Map()], brk: [], catchVar: null, tnames: new Set(cls?.tparams ?? []) });
  let ctx = newCtx(null, true);
  const tmp = () => { const t = `__t${++tempN}`; ctx.temps.push(t); return t };

  // ── collect types ──
  const allClasses: ClassInfo[] = [];
  const addDecl = (d: Decl, outer: ClassInfo | null) => {
    if (d.k === 'delegate') { delegates.set(d.name, d); return }
    if (d.k === 'enum') {
      if (classes.has(d.name) || enums.has(d.name)) { err(d.pos, `The type '${d.name}' is already defined`); return }
      enums.set(d.name, { name: d.name, js: safe(d.name), d, vals: new Map() });
      return;
    }
    let c = classes.get(d.name);
    if (c) {
      if (!d.mods.has('partial') || !c.decls[0].mods.has('partial')) { err(d.pos, `The type '${d.name}' is already defined`); return }
      c.decls.push(d);
    } else {
      if (enums.has(d.name)) { err(d.pos, `The type '${d.name}' is already defined`); return }
      c = { name: d.name, js: safe(d.name), decls: [d], kind: d.kind, isStatic: d.mods.has('static'), isAbstract: d.mods.has('abstract'), base: null, baseRt: '', outer,
        fields: new Map(), methods: new Map(), ctors: [], sctors: [], indexer: null, tparams: new Set(d.tparams), pos: d.pos };
      classes.set(d.name, c);
      allClasses.push(c);
    }
    for (const m of d.members) if (m.k === 'class' || m.k === 'enum' || m.k === 'delegate') addDecl(m, c);
  };
  for (const d of decls) addDecl(d, null);

  // ── types ──
  function resolve(t: TypeRef): Ty {
    const n = t.name;
    let b: Ty;
    if (ctx.tnames.has(n)) b = ANY;
    else if (classes.has(n)) { const c = classes.get(n)!; b = c.kind === 'interface' ? T('obj', n) : T('obj', n, { cls: c }) }
    else if (enums.has(n)) b = T('enum', n, { en: enums.get(n) });
    else if (!G.has(n) && INT_NAMES[n]) b = T('int', INT_NAMES[n]);
    else if (!G.has(n) && FLOAT_NAMES[n]) b = T('float', FLOAT_NAMES[n]);
    else if (n === 'bool' || (n === 'Boolean' && !G.has(n))) b = BOOL;
    else if (n === 'string' || (n === 'String' && !G.has(n))) b = STR;
    else if (n === 'char' || (n === 'Char' && !G.has(n))) b = CHAR;
    else if (n === 'void') b = VOID;
    else if (n === 'object' || n === 'var' || n === 'dynamic' || (n === 'Object' && !G.has(n))) b = ANY;
    else if ((n === 'Func' || n === 'Action' || n === 'Predicate') && !G.has(n)) {
      const a = t.args.map(resolve);
      const ps = (n === 'Func' ? a.slice(0, -1) : a).map((ty, k): PInfo => ({ name: `a${k}`, ty, mod: '', def: null, pos: t.pos }));
      b = T('fn', n, { sig: { params: ps, ret: n === 'Func' ? a[a.length - 1] ?? ANY : n === 'Predicate' ? BOOL : VOID } });
    } else if (delegates.has(n) && !classes.has(n)) {
      const d = delegates.get(n)!;
      b = T('fn', n, { sig: { params: pinfo(d.params, ctx.tnames), ret: resolve(d.ret) } });
    } else if (n === 'EventHandler' && !G.has(n)) {
      const ps = ['sender', 'e'].map((name): PInfo => ({ name, ty: ANY, mod: '', def: null, pos: t.pos }));
      b = T('fn', n, { sig: { params: ps, ret: VOID } });
    } else if (n === 'Nullable' && t.args.length === 1) b = { ...resolve(t.args[0]), nul: true };
    else b = T('obj', n, { args: t.args.map(resolve) });
    if (t.nullable && b.k !== 'any') b = { ...b, nul: true };
    for (let k = t.rank.length - 1; k >= 0; k--) b = arrOf(b, t.rank[k]);
    return b;
  }
  const isStruct = (t: Ty) => t.k === 'obj' && t.cls?.kind === 'struct' && !t.nul;
  const derives = (a: ClassInfo | undefined, b: ClassInfo | undefined) => { for (let c = a ?? null; c; c = c.base) if (c === b) return true; return false };
  const rootRt = (c: ClassInfo): string => { let k = c; while (k.base) k = k.base; return k.baseRt };
  const hasRt = (c: ClassInfo | null) => !!c && rootRt(c) !== '';
  const inherited = () => !!ctx.cls && hasRt(ctx.cls) && !ctx.isStatic;
  const enumDefault = (en: EnumInfo) => { for (const [k, v] of en.vals) if (v === 0) return JSON.stringify(k); return '0' };
  function defVal(t: Ty, p: Pos): string {
    if (t.nul) return 'null';
    switch (t.k) {
      case 'int': case 'float': return '0';
      case 'bool': return 'false';
      case 'char': return '"\\0"';
      case 'enum': return enumDefault(t.en!);
      case 'obj': return isStruct(t) ? construct(t.cls!, [], p) : 'null';
      default: return 'null';
    }
  }
  const intWrap = (c: string, n: string) => n === 'uint' ? `(${c} >>> 0)` : n === 'byte' ? `(${c} & 255)` : n === 'sbyte' ? `(${c} << 24 >> 24)`
    : n === 'short' ? `(${c} << 16 >> 16)` : n === 'ushort' ? `(${c} & 65535)` : n === 'long' || n === 'ulong' ? `__i64(${c})` : `(${c} | 0)`;
  const foldInt = (v: number, n: string) => n === 'long' || n === 'ulong' ? Math.trunc(v) : n === 'uint' ? v >>> 0 : n === 'byte' ? v & 255 : n === 'sbyte' ? v << 24 >> 24
    : n === 'short' ? v << 16 >> 16 : n === 'ushort' ? v & 65535 : v | 0;
  function conv(r: R, to: Ty): string {
    const f = r.ty, c = r.c;
    if (f.k === 'null') return to.k === 'int' || to.k === 'float' ? (to.nul ? 'null' : '0') : 'null';
    switch (to.k) {
      case 'int': {
        const lit = /^\(?(-?\d+(\.\d+)?)\)?$/.exec(c);
        if (lit) return jsNum(foldInt(+lit[1], to.n));
        if (f.k === 'char') return to.n === 'int' || to.n === 'long' ? `${c}.charCodeAt(0)` : intWrap(`${c}.charCodeAt(0)`, to.n);
        if (f.k === 'int' && (f.n === to.n || (to.n === 'long' && f.n !== 'ulong') || (to.n === 'int' && IN_INT.has(f.n)))) return c;
        if (f.k === 'bool') return `(+${c})`;
        if (to.nul || f.nul) return to.n === 'int' ? `__ni(${c})` : c;
        return intWrap(c, to.n);
      }
      case 'float': return f.k === 'char' ? `${c}.charCodeAt(0)` : f.k === 'bool' ? `(+${c})` : c;
      case 'char': return f.k === 'int' ? `String.fromCharCode(${c})` : c;
      default: return c;
    }
  }
  function strOf(r: R): string {
    const c = r.c;
    switch (r.ty.k) {
      case 'string': return /^"/.test(c) || r.ty.n === 'nn' ? c : `__s(${c})`;
      case 'int': return `String(${c})`;
      case 'char': case 'enum': return c;
      case 'bool': return `(${c} ? "True" : "False")`;
      case 'null': return '""';
      default: return `__str(${c})`;
    }
  }
  const NNSTR = T('string', 'nn');   // non-null string (concatenation result)

  // ── members ──
  const findField = (c: ClassInfo, n: string): FieldInfo | undefined => { for (let k: ClassInfo | null = c; k; k = k.base) { const f = k.fields.get(n); if (f) return f } };
  function findMethods(c: ClassInfo, n: string): FnDef[] {
    const out: FnDef[] = [], keys = new Set<string>();
    for (let k: ClassInfo | null = c; k; k = k.base) for (const m of k.methods.get(n) ?? []) if (!keys.has(m.key)) { keys.add(m.key); out.push(m) }
    return out;
  }
  const typeKey = (t: TypeRef): string => (t.name + (t.args.length ? '_' + t.args.map(typeKey).join('_') : '') + 'A'.repeat(t.rank.length) + (t.nullable ? 'N' : '')).replace(/\W/g, '_');
  const paramKey = (ps: { t: TypeRef; mod: string }[]) => ps.map(p => (p.mod === 'ref' || p.mod === 'out' ? 'R' : '') + typeKey(p.t)).join('_');
  const pinfo = (ps: MethodDecl['params'], tn: Set<string>): PInfo[] => {
    const save = ctx.tnames;
    ctx.tnames = tn;
    const out = ps.map(p => ({ name: p.name, ty: resolve(p.t), mod: p.mod, def: p.def, pos: p.pos }));
    ctx.tnames = save;
    return out;
  };
  const minArgs = (ps: PInfo[]) => { const k = ps.findIndex(p => p.def || p.mod === 'params'); return k < 0 ? ps.length : k };

  const sigCount = new Map<string, Set<string>>();
  for (const c of allClasses) for (const d of c.decls) for (const m of d.members) if (m.k === 'method') {
    if (!sigCount.has(m.name)) sigCount.set(m.name, new Set());
    sigCount.get(m.name)!.add(paramKey(m.params));
  }
  for (const c of allClasses) {
    const d0 = c.decls[0];
    const bt = c.decls.flatMap(d => d.bases)[0];
    if (bt) {
      const b = classes.get(bt.name);
      if (b && b.kind !== 'interface') {
        if (c.kind !== 'class') err(bt.pos, `'${c.name}': only classes can inherit from a class`);
        else if (derives(b, c) || b === c) err(d0.pos, `Circular base class dependency for '${c.name}'`);
        else c.base = b;
      } else if (!b && !(/^I[A-Z]/.test(bt.name) && !/^Indicator/.test(bt.name)) && c.kind === 'class') c.baseRt = bt.name;
    }
  }
  for (const c of allClasses) {
    ctx = newCtx(c, false);
    for (const d of c.decls) for (const m of d.members) {
      if (m.k === 'field' || m.k === 'prop') {
        if (c.fields.has(m.name) || c.methods.has(m.name)) err(m.pos, `'${c.name}' already contains a definition for '${m.name}'`);
        const auto = m.k === 'field' || (!m.get?.body && !m.get?.expr && !m.set?.body && !m.set?.expr && !!m.get);
        const isConst = m.k === 'field' && m.mods.has('const');
        c.fields.set(m.name, { name: m.name, ty: resolve(m.t), isStatic: m.mods.has('static') || isConst || c.isStatic, isConst, kind: m.k === 'field' ? 'field' : auto ? 'auto' : 'prop', d: m, owner: c });
      } else if (m.k === 'method') {
        const tn = new Set([...c.tparams, ...m.tparams]), params = pinfo(m.params, tn);
        const save = ctx.tnames; ctx.tnames = tn;
        const ret = resolve(m.ret);
        ctx.tnames = save;
        const key = paramKey(m.params);
        let mangle = sigCount.get(m.name)!.size > 1;
        if (mangle && m.mods.has('override')) { let up = false; for (let b = c.base; b; b = b.base) if (b.decls.some(x => x.members.some(y => y.k === 'method' && y.name === m.name))) up = true; mangle = up }
        const list = c.methods.get(m.name) ?? [];
        if (list.some(x => x.key === key)) err(m.pos, `'${c.name}' already defines a member called '${m.name}' with the same parameter types`);
        if (c.fields.has(m.name)) err(m.pos, `'${c.name}' already contains a definition for '${m.name}'`);
        list.push({ name: m.name, js: mangle ? `${m.name}__${key || 'v'}` : m.name, sig: { params, ret }, min: minArgs(params), isStatic: m.mods.has('static') || c.isStatic, cls: c, key, d: m });
        c.methods.set(m.name, list);
      } else if (m.k === 'ctor') {
        if (m.mods.has('static')) { c.sctors.push(m); continue }
        const params = pinfo(m.params, c.tparams);
        c.ctors.push({ name: c.name, js: '', sig: { params, ret: null }, min: minArgs(params), isStatic: false, cls: c, key: paramKey(m.params), d: m });
      } else if (m.k === 'indexer') c.indexer = { d: m, ty: resolve(m.t), params: pinfo(m.params, c.tparams) };
    }
    c.ctors.forEach(k => { k.js = c.ctors.length === 1 ? '__c' : `__c_${k.key || 'v'}` });
  }
  ctx = newCtx(null, true);

  // ── constants ──
  function constVal(e: Expr, c: ClassInfo | null, depth = 0): unknown {
    if (depth > 30) return undefined;
    const cv = (x: Expr) => constVal(x, c, depth + 1);
    switch (e.k) {
      case 'num': return e.v;
      case 'str': case 'char': return e.v;
      case 'lit': return e.v;
      case 'interp': return undefined;
      case 'unary': {
        const v = cv(e.e);
        if (typeof v === 'number') return e.op === '-' ? -v : e.op === '+' ? v : e.op === '~' ? ~v : undefined;
        return typeof v === 'boolean' && e.op === '!' ? !v : undefined;
      }
      case 'bin': {
        const a = cv(e.a), b = cv(e.b);
        if (typeof a === 'string' && e.op === '+' && b !== undefined) return a + String(b);
        if (typeof a !== 'number' || typeof b !== 'number') return undefined;
        switch (e.op) {
          case '+': return a + b; case '-': return a - b; case '*': return a * b;
          case '/': return Number.isInteger(a) && Number.isInteger(b) && e.a.k === 'num' && e.b.k === 'num' && e.a.suf === 'int' && e.b.suf === 'int' ? (b ? Math.trunc(a / b) : undefined) : a / b;
          case '%': return a % b; case '|': return a | b; case '&': return a & b; case '^': return a ^ b; case '<<': return a << b; case '>>': return a >> b;
        }
        return undefined;
      }
      case 'cast': { const v = cv(e.e), t = e.t.name; return typeof v === 'number' && INT_NAMES[t] ? foldInt(v, INT_NAMES[t]) : v }
      case 'member': {
        if (e.e.k !== 'id') return undefined;
        const tn = e.e.name, en = enums.get(tn);
        if (en) return en.vals.has(e.name) ? e.name : undefined;
        const uc = classes.get(tn);
        if (uc) { const f = findField(uc, e.name); return f?.isConst && f.d.k === 'field' && f.d.init ? constVal(f.d.init, uc, depth + 1) : undefined }
        const pd = INT_NAMES[tn] ?? FLOAT_NAMES[tn] ?? OTHER_PREDEF[tn];
        return pd ? PD_CONST[pd]?.[e.name] : undefined;
      }
      case 'id': {
        for (let k = c; k; k = k.outer) { const f = findField(k, e.name); if (f) return f.isConst && f.d.k === 'field' && f.d.init ? constVal(f.d.init, f.owner, depth + 1) : undefined }
        return undefined;
      }
    }
    return undefined;
  }
  for (const en of enums.values()) {
    let next = 0;
    for (const it of en.d.items) {
      let v = next;
      if (it.value) {
        const x = constVal(it.value, null);
        if (typeof x === 'number') v = x;
        else if (typeof x === 'string' && en.vals.has(x)) v = en.vals.get(x)!;
        else err(it.pos, `Enum value of '${it.name}' must be a constant integer`);
      }
      if (en.vals.has(it.name)) err(it.pos, `Duplicate enum member '${it.name}'`);
      en.vals.set(it.name, v);
      next = v + 1;
    }
  }

  // ── scopes ──
  function lookupLocal(n: string): Sym | undefined {
    for (let k = ctx.scopes.length - 1; k >= 0; k--) { const s = ctx.scopes[k].get(n); if (s) return s }
  }
  function declareLocal(n: string, ty: Ty, p: Pos, ref = false, hoist = false): Sym {
    if (lookupLocal(n)) err(p, `A local variable named '${n}' is already defined in this scope`);
    let js = safe(n);
    for (let k = 1; ctx.used.has(js); k++) js = `${safe(n)}_${k}`;
    ctx.used.add(js);
    const s = { js, ty, ref };
    ctx.scopes[ctx.scopes.length - 1].set(n, s);
    if (hoist) ctx.temps.push(js);
    return s;
  }
  function peekTy(e: Expr): Ty {   // type of an expression without keeping its code
    const n = errors.length, t = ctx.temps.length, sc = ctx.scopes.map(m => new Map(m)), tn = tempN;
    const ty = ex(e).ty;
    errors.length = n; ctx.temps.length = t; ctx.scopes = sc; tempN = tn;
    return ty;
  }

  // ── names ──
  const typeR = (c: string, ty: Ty): R => ({ c, ty });
  const userType = (n: string): R | null => {
    const c = classes.get(n);
    if (c) return typeR(c.js, T('type', n, { cls: c }));
    const en = enums.get(n);
    if (en) return typeR(en.js, T('type', n, { en }));
    return null;
  };
  const predefName = (n: string): string | null => PREDEF.has(n) ? (INT_NAMES[n] ?? FLOAT_NAMES[n] ?? OTHER_PREDEF[n]) : G.has(n) ? null : (INT_NAMES[n] ?? FLOAT_NAMES[n] ?? OTHER_PREDEF[n] ?? null);
  function idExpr(e: { name: string; pos: Pos }, use: 'val' | 'call' | 'mem'): R {
    const n = e.name;
    const s = lookupLocal(n);
    if (s) return s.ref ? { c: `${s.js}.v`, ty: s.ty, lv: true } : { c: s.js, ty: s.ty, lv: true };
    for (let c = ctx.cls, hop = false; c; c = c.outer, hop = true) {
      const f = findField(c, n);
      if (f && (!hop || f.isStatic)) {
        if (!f.isStatic && ctx.isStatic) err(e.pos, `An object reference is required for the non-static member '${c.name}.${n}'`);
        return { c: f.isStatic ? `${f.owner.js}.${n}` : `this.${n}`, ty: f.ty, lv: true };
      }
      const ms = findMethods(c, n).filter(m => !hop || m.isStatic);
      if (ms.length) return { c: '', ty: ANY, grp: { defs: ms, self: 'this', sep: '.', name: n } };
    }
    const ut = userType(n);
    if (ut) return ut;
    const pd = predefName(n);
    if (pd) return typeR('', T('type', pd));
    if (G.has(n)) {
      if (use === 'val' && inherited()) return { c: `this.${n}`, ty: NT_MEMBERS[n] ?? ANY, lv: true };
      return { c: `rt.${n}`, ty: use === 'mem' ? T('type', n, { rt: true }) : ANY, lv: use === 'val' };
    }
    if (use === 'mem' && roots.has(n)) return { c: '', ty: T('ns', n) };
    if (inherited()) return { c: `this.${n}`, ty: use === 'call' ? NT_FNS[n] ?? ANY : NT_MEMBERS[n] ?? ANY, lv: true };
    err(e.pos, `The name '${n}' does not exist in the current context`);
    return { c: 'undefined', ty: ANY };
  }
  function nsMember(b: R, name: string, use: 'val' | 'call' | 'mem', p: Pos): R {
    const ut = userType(name);
    if (ut) return ut;
    if (G.has(name)) return { c: `rt.${name}`, ty: use === 'mem' ? T('type', name, { rt: true }) : ANY };
    const pd = predefName(name);
    if (pd && /^[A-Z]/.test(name)) return typeR('', T('type', pd));
    if (use === 'mem') return { c: '', ty: T('ns', `${b.ty.n}.${name}`) };
    if (inherited()) return { c: `this.${name}`, ty: ANY };
    err(p, `The type or namespace name '${name}' does not exist in '${b.ty.n}'`);
    return { c: 'undefined', ty: ANY };
  }
  // base of a member access / call
  const target = (e: Expr): R => e.k === 'id' ? idExpr(e, 'mem') : e.k === 'member' ? memberExpr(e, 'mem') : ex(e);
  function elemTy(t: Ty, n: number): Ty {
    if (t.k === 'arr') return (t.rank ?? 1) === n ? t.el! : ANY;
    if (t.k === 'string') return CHAR;
    if (t.k === 'obj' && t.args?.length) return DICTS.has(t.n) ? t.args[1] ?? ANY : SEQS.has(t.n) || t.n === 'Array' ? t.args[0] : ANY;
    if (t.k === 'obj' && t.cls?.indexer) return t.cls.indexer.ty;
    return ANY;
  }
  function iterTy(t: Ty): Ty {
    if (t.k === 'arr') return t.el!;
    if (t.k === 'string') return CHAR;
    if (t.k === 'obj' && t.args?.length) return DICTS.has(t.n) ? T('obj', 'KeyValuePair', { args: t.args }) : t.args[0];
    return ANY;
  }
  function memberExpr(e: Expr & { k: 'member' }, use: 'val' | 'call' | 'mem', pre?: R): R {
    const name = e.name, q = e.cond ? '?.' : '.';
    if (e.e.k === 'base') {
      const bc = ctx.cls?.base;
      if (!ctx.cls || ctx.isStatic) { err(e.pos, "'base' is only available in instance members"); return { c: 'undefined', ty: ANY } }
      if (bc) {
        const ms = findMethods(bc, name);
        if (ms.length) return { c: '', ty: ANY, grp: { defs: ms, self: 'super', sep: '.', name } };
        const f = findField(bc, name);
        if (f) return { c: f.kind === 'prop' ? `super.${name}` : `this.${name}`, ty: f.ty, lv: true };
      }
      if (!hasRt(ctx.cls)) { err(e.pos, `'${name}' is not a member of the base class`); return { c: 'undefined', ty: ANY } }
      return { c: use === 'call' ? `super.${name}` : `this.${name}`, ty: NT_MEMBERS[name] ?? ANY, lv: true };
    }
    const b = pre ?? target(e.e), t = b.ty;
    if (b.grp) { err(e.pos, `Method '${b.grp.name}' must be invoked`); return { c: 'undefined', ty: ANY } }
    if (t.k === 'ns') return nsMember(b, name, use, e.pos);
    if (t.k === 'type') return staticMember(b, name, use, e.pos);
    if (t.nul && name === 'HasValue') return { c: `(${b.c} != null)`, ty: BOOL };
    if (t.nul && name === 'Value') return { c: b.c, ty: { ...t, nul: false } };
    if (t.k === 'obj' && t.cls) {
      const c = t.cls;
      const f = findField(c, name);
      if (f) {
        if (f.isStatic) { err(e.pos, `Member '${c.name}.${name}' cannot be accessed with an instance reference; qualify it with the type name`); return { c: `${f.owner.js}.${name}`, ty: f.ty } }
        return { c: `${b.c}${q}${name}`, ty: f.ty, lv: true };
      }
      const ms = findMethods(c, name);
      if (ms.length) return { c: '', ty: ANY, grp: { defs: ms, self: b.c, sep: q, name } };
      if (!hasRt(c)) { err(e.pos, `'${c.name}' does not contain a definition for '${name}'`); return { c: 'undefined', ty: ANY } }
      return { c: `${b.c}${q}${name}`, ty: use === 'call' ? NT_FNS[name] ?? ANY : NT_MEMBERS[name] ?? ANY, lv: true };
    }
    if ((t.k === 'string' || t.k === 'arr') && name === 'Length') return { c: `${b.c}${q}length`, ty: INT };
    if (t.k === 'arr' && name === 'Rank') return { c: String(t.rank ?? 1), ty: INT };
    if (num(t) || t.k === 'bool' || t.k === 'char' || t.k === 'string' || t.k === 'enum') {
      if (use !== 'call') err(e.pos, `'${tyName(t)}' does not contain a definition for '${name}'`);
      return { c: `${b.c}${q}${name}`, ty: ANY };
    }
    if (t.k === 'obj') {
      if (/Exception$/.test(t.n) && (name === 'Message' || name === 'StackTrace')) return { c: `${b.c}${q}${name === 'Message' ? 'message' : 'stack'}`, ty: STR };
      if (t.n === 'KeyValuePair' && t.args && (name === 'Key' || name === 'Value')) return { c: `${b.c}${q}${name}`, ty: t.args[name === 'Key' ? 0 : 1] ?? ANY };
      if (name === 'Count' && (DICTS.has(t.n) || SEQS.has(t.n))) return { c: `${b.c}${q}Count`, ty: INT };
    }
    if (t.k === 'any' && name === 'Length' && use !== 'call') return { c: `__len(${b.c})`, ty: INT };
    return { c: `${b.c}${q}${name}`, ty: ANY, lv: true };
  }
  function staticMember(b: R, name: string, use: 'val' | 'call' | 'mem', p: Pos): R {
    const t = b.ty;
    if (t.cls) {
      const c = t.cls, f = findField(c, name);
      if (f) {
        if (!f.isStatic) err(p, `An object reference is required for the non-static member '${c.name}.${name}'`);
        return { c: `${f.owner.js}.${name}`, ty: f.ty, lv: true };
      }
      const ms = findMethods(c, name).filter(m => m.isStatic);
      if (ms.length) return { c: '', ty: ANY, grp: { defs: ms, self: '', sep: '.', name } };
      for (const [tn, k] of classes) if (k.outer === c && tn === name) return userType(name)!;
      if (findMethods(c, name).length) err(p, `An object reference is required for the non-static method '${c.name}.${name}'`);
      else err(p, `'${c.name}' does not contain a definition for '${name}'`);
      return { c: 'undefined', ty: ANY };
    }
    if (t.en) {
      if (!t.en.vals.has(name)) { err(p, `'${t.n}' does not contain a definition for '${name}'`); return { c: 'undefined', ty: ANY } }
      return { c: JSON.stringify(name), ty: T('enum', t.n, { en: t.en }) };
    }
    if (t.rt) return { c: `${b.c}.${name}`, ty: ANY, lv: true };
    const pc = PD_CONST[t.n];
    if (pc && name in pc) {
      const v = pc[name];
      return { c: jsVal(v), ty: typeof v === 'string' ? (t.n === 'char' ? CHAR : STR) : INT_NAMES[t.n] ? T('int', t.n) : FLOAT };
    }
    if (use !== 'call') err(p, `'${t.n}' does not contain a definition for '${name}'`);
    return { c: 'undefined', ty: ANY };
  }

  // ── calls ──
  function score(a: Ty, p: Ty): number {
    if (p.k === 'any' || a.k === 'any') return 1;
    if (a.k === 'null') return p.k === 'obj' || p.k === 'string' || p.k === 'arr' || p.k === 'fn' || p.nul ? 2 : -50;
    if (num(a) && num(p)) return a.k === p.k ? (a.n === p.n ? 4 : 3) : a.k === 'int' ? 2 : -20;
    if (a.k === 'char' && num(p)) return 1.5;
    if (a.k !== p.k) return -100;
    if (a.k === 'obj') return a.n === p.n ? 4 : derives(a.cls, p.cls) ? 3 : a.cls || p.cls ? -50 : -5;
    if (a.k === 'enum' || a.k === 'arr') return a.n === p.n ? 4 : 1;
    if (a.k === 'fn') return (a.sig?.params.length ?? -1) === (p.sig?.params.length ?? -2) ? 3 : 1;
    return 4;
  }
  function applicable(d: { sig: Sig; min: number }, args: Arg[]): boolean {
    const ps = d.sig.params, pa = ps.length && ps[ps.length - 1].mod === 'params';
    const pos = args.filter(a => !a.name).length;
    if (!pa && pos > ps.length) return false;
    const filled = new Set<number>();
    for (let k = 0; k < Math.min(pos, ps.length); k++) filled.add(k);
    for (const a of args) if (a.name) { const j = ps.findIndex(p => p.name === a.name); if (j < 0) return false; filled.add(j) }
    for (let k = 0; k < d.min; k++) if (!filled.has(k)) return false;
    return true;
  }
  function pick<D extends { sig: Sig; min: number }>(defs: D[], args: Arg[], name: string, p: Pos): D {
    const cands = defs.filter(d => applicable(d, args));
    if (!cands.length) {
      if (defs.length === 1) {
        const d = defs[0], n = d.sig.params.length, named = args.find(a => a.name && !d.sig.params.some(q => q.name === a.name));
        if (named) err(p, `'${name}' does not have a parameter named '${named.name}'`);
        else err(p, `'${name}' expects ${d.min === n ? n : `${d.min} to ${n}`} argument(s) but got ${args.length}`);
      } else err(p, `No overload for method '${name}' takes ${args.length} argument(s)`);
      return defs[0];
    }
    if (cands.length === 1) return cands[0];
    const tys = args.map(a => a.mod === 'ref' || a.mod === 'out' ? ANY : peekTy(a.e));
    let best = cands[0], bs = -Infinity;
    for (const d of cands) {
      const ps = d.sig.params;
      const s = tys.reduce((acc, t, k) => {
        const a = args[k], j = a.name ? ps.findIndex(q => q.name === a.name) : Math.min(k, ps.length - 1);
        const pt = ps[j]?.mod === 'params' && t.k !== 'arr' ? ps[j].ty.el ?? ANY : ps[j]?.ty ?? ANY;
        return acc + score(t, pt);
      }, 0) - (ps.length - args.length) * 0.1;
      if (s > bs) { bs = s; best = d }
    }
    return best;
  }
  interface ArgOut { list: string[]; pre: string[]; post: string[] }
  function argList(ps: PInfo[] | null, args: Arg[], p: Pos): ArgOut {
    const out: ArgOut = { list: [], pre: [], post: [] };
    if (!ps) {
      if (args.some(a => a.name)) warn(p, 'Named arguments to runtime methods are passed positionally');
      for (const a of args) out.list.push(argCode(a, null, out));
      return out;
    }
    const slots: (Arg | null)[] = ps.map(() => null), rest: Arg[] = [];
    const pa = ps.length && ps[ps.length - 1].mod === 'params' ? ps.length - 1 : -1;
    let k = 0;
    for (const a of args) {
      if (a.name) { const j = ps.findIndex(q => q.name === a.name); if (j >= 0) slots[j] = a; continue }
      if (pa >= 0 && k >= pa) rest.push(a);
      else if (k < ps.length) slots[k] = a;
      k++;
    }
    ps.forEach((q, j) => {
      if (j === pa) {
        if (slots[j]) { out.list.push(argCode(slots[j]!, q, out)); return }
        if (rest.length === 1 && peekTy(rest[0].e).k === 'arr') { out.list.push(argCode(rest[0], q, out)); return }
        const el = q.ty.el ?? ANY;
        out.list.push(`[${rest.map(a => valueFor(a.e, el)).join(', ')}]`);
        return;
      }
      const a = slots[j];
      out.list.push(a ? argCode(a, q, out) : 'undefined');
    });
    while (out.list.length && out.list[out.list.length - 1] === 'undefined' && !slots[out.list.length - 1]) out.list.pop();
    return out;
  }
  function argCode(a: Arg, q: PInfo | null, out: ArgOut): string {
    const byRef = a.mod === 'ref' || a.mod === 'out';
    if (q && (q.mod === 'ref' || q.mod === 'out') && !byRef) err(a.e.pos, `Argument must be passed with the '${q.mod}' keyword`);
    if (!byRef) return valueFor(a.e, q?.ty ?? null);
    if (q && q.mod !== 'ref' && q.mod !== 'out') err(a.e.pos, `Argument should not be passed with the '${a.mod}' keyword`);
    if (a.decl) {
      const name = (a.e as { name: string }).name;
      if (name === '_') return 'ref(undefined)';
      const ty = a.decl.name === 'var' ? q?.ty ?? ANY : resolve(a.decl);
      const s = declareLocal(name, ty, a.e.pos, true, true);
      out.pre.push(`${s.js} = ref(${defVal(ty, a.e.pos)})`);
      return s.js;
    }
    if (a.e.k === 'id' && a.e.name === '_' && !lookupLocal('_')) return 'ref(undefined)';
    const lv = lval(a.e, true);
    if (!lv) { err(a.e.pos, `A ${a.mod} argument must be an assignable variable`); return 'undefined' }
    if (lv.refVar) return lv.refVar;
    const t = tmp();
    out.pre.push(...lv.pre, `${t} = ref(${lv.get})`);
    out.post.push(lv.set(q ? conv({ c: `${t}.v`, ty: q.ty }, lv.ty) : `${t}.v`));
    return t;
  }
  function valueFor(e: Expr, ty: Ty | null): string {
    if (!ty) { const r = ex(e); if (r.grp) return groupValue(r.grp, null); return isStruct(r.ty) && isLvalExpr(e) ? `__cl(${r.c})` : r.c }
    if (ty.k === 'fn') return fnValue(e, ty);
    if (e.k === 'arrinit') return arrValues(ty, e, e.pos);
    const r = ex(e, ty);
    if (r.grp) return groupValue(r.grp, ty);
    if (isStruct(ty) && isLvalExpr(e)) return `__cl(${r.c})`;
    return conv(r, ty);
  }
  function wrapCall(call: string, out: ArgOut, ty: Ty): R {
    if (!out.pre.length && !out.post.length) return { c: call, ty };
    if (!out.post.length) return { c: `(${[...out.pre, call].join(', ')})`, ty };
    const r = tmp();
    return { c: `(${[...out.pre, `${r} = ${call}`, ...out.post, r].join(', ')})`, ty };
  }
  const groupTarget = (g: Group, d: FnDef) => d.isStatic ? `${d.cls.js}.${d.js}` : g.self === 'super' ? `super.${d.js}` : `${g.self || 'this'}${g.sep}${d.js}`;
  function callGroup(g: Group, args: Arg[], p: Pos): R {
    const d = pick(g.defs, args, g.name, p);
    if (!d.isStatic && ctx.isStatic && (g.self === 'this' || g.self === 'super')) err(p, `An object reference is required for the non-static method '${d.cls.name}.${d.name}'`);
    const out = argList(d.sig.params, args, p);
    return wrapCall(`${groupTarget(g, d)}(${out.list.join(', ')})`, out, d.sig.ret ?? ANY);
  }
  function groupValue(g: Group, want: Ty | null): string {
    const n = want?.sig?.params.length;
    const d = g.defs.find(x => x.sig.params.length === n) ?? g.defs[0];
    if (d.isStatic) return `${d.cls.js}.${d.js}`;
    // instance method groups are cached per (object, method) so `ev -= Handler` finds the delegate `ev += Handler` added
    return g.self === 'super' || g.sep !== '.' ? `((...a) => ${groupTarget(g, d)}(...a))` : `rt.__mg(${g.self || 'this'}, ${JSON.stringify(d.js)})`;
  }
  function fnValue(e: Expr, want: Ty): string {
    if (e.k === 'lambda') return lambda(e, want).c;
    const r = ex(e, want);
    return r.grp ? groupValue(r.grp, want) : r.c;
  }
  function plainCall(code: string, args: Arg[], p: Pos, ty: Ty = ANY): R {
    const out = argList(null, args, p);
    return wrapCall(`${code}(${out.list.join(', ')})`, out, ty);
  }
  function callOn(r: R, name: string, args: Arg[], p: Pos): R {
    if (r.grp) return callGroup(r.grp, args, p);
    if (r.ty.k === 'fn' && r.ty.sig) { const out = argList(r.ty.sig.params, args, p); return wrapCall(`${r.c}(${out.list.join(', ')})`, out, r.ty.sig.ret ?? ANY) }
    if (r.ty.k === 'type') {
      if (r.ty.cls && inherited()) return { ...plainCall(`this.${name}`, args, p), ty: T('obj', r.ty.cls.name, { cls: r.ty.cls }) };   // user indicator call
      err(p, `'${name}' is a type but is used like a method`);
      return { c: 'undefined', ty: ANY };
    }
    return plainCall(r.c, args, p);
  }
  const argsCode = (args: Arg[]) => args.map(a => ex(a.e).c);
  function call(e: Expr & { k: 'call' }): R {
    const f = e.fn, args = e.args;
    if (f.k === 'id') {
      const r = idExpr(f, 'call');
      if (r.c.startsWith('this.') && !r.grp && r.ty.k !== 'fn') return plainCall(r.c, args, e.pos, NT_FNS[f.name] ?? ANY);
      return callOn(r, f.name, args, e.pos);
    }
    if (f.k !== 'member') {
      const fr = ex(f);
      if (fr.ty.k === 'fn' && fr.ty.sig) return callOn(fr, '', args, e.pos);
      return plainCall(fr.c, args, e.pos);
    }
    const name = f.name, q = f.cond ? '?.' : '.';
    if (f.e.k === 'base') {
      const r = memberExpr(f, 'call');
      return r.grp ? callGroup(r.grp, args, e.pos) : plainCall(r.c, args, e.pos);
    }
    const b = target(f.e), t = b.ty;
    if (b.grp) { err(f.pos, `Method '${b.grp.name}' must be invoked`); return { c: 'undefined', ty: ANY } }
    if (t.k === 'ns') return callOn(nsMember(b, name, 'call', f.pos), name, args, e.pos);
    if (t.k === 'type') {
      if (t.cls || t.en) { const m = staticMember(b, name, 'call', f.pos); return m.grp ? callGroup(m.grp, args, e.pos) : callOn(m, name, args, e.pos) }
      if (t.rt) {
        let ty: Ty = ANY;
        if (t.n === 'Math') ty = MATH_INT.has(name) ? (args.every(a => peekTy(a.e).k === 'int') ? INT : FLOAT) : name === 'Sign' ? INT : FLOAT;
        return plainCall(`${b.c}.${name}`, args, e.pos, ty);
      }
      return predefCall(t.n, name, args, e.pos);
    }
    if (name === 'ToString' && !(t.k === 'obj' && t.cls && findMethods(t.cls, 'ToString').length)) {
      if (args.length && t.k !== 'string') return { c: `rt.__fmt(${b.c}, ${argsCode(args).join(', ')})`, ty: NNSTR };
      return { c: strOf(b), ty: NNSTR };
    }
    if (t.k === 'string') return strCall(b, name, args, e.pos);
    if (t.nul && name === 'GetValueOrDefault') return { c: `(${b.c} ?? ${args.length ? ex(args[0].e).c : defVal({ ...t, nul: false }, e.pos)})`, ty: { ...t, nul: false } };
    if (t.k === 'fn' && name === 'Invoke') { const r = callOn(b, '', args, e.pos); return f.cond ? { ...r, c: `(${b.c} == null ? undefined : ${r.c})` } : r }
    if (LINQ.has(name) && (t.k === 'arr' || t.k === 'any' || (t.k === 'obj' && !t.cls && (SEQS.has(t.n) || DICTS.has(t.n) || t.n === 'Series')))) {
      const out = argList(null, args, e.pos), ty = name === 'Count' ? INT : name === 'Any' || name === 'All' || name === 'Contains' ? BOOL : name === 'Average' ? FLOAT : ANY;
      return wrapCall(`rt.__lq(${b.c}, ${JSON.stringify(name)}${out.list.map(x => ', ' + x).join('')})`, out, ty);
    }
    if (num(t) || t.k === 'char' || t.k === 'bool' || t.k === 'enum') {
      const a = argsCode(args);
      if (name === 'CompareTo' && a.length === 1) return { c: `__cmp(${b.c}, ${a[0]})`, ty: INT };
      if (name === 'Equals' && a.length === 1) return { c: `(${b.c} === ${a[0]})`, ty: BOOL };
      err(f.pos, `'${tyName(t)}' does not contain a definition for '${name}'`);
      return { c: 'undefined', ty: ANY };
    }
    if (t.k === 'arr') {
      if (name === 'GetLength' && args.length === 1) return { c: `__glen(${b.c}, ${ex(args[0].e).c})`, ty: INT };
      if (name === 'Clone' && !args.length) return { c: `${b.c}.slice()`, ty: t };
      if (name === 'CopyTo' && args.length === 2) { const [d, i] = argsCode(args); return { c: `${b.c}.forEach((v, k) => { ${d}[${i} + k] = v })`, ty: VOID } }
    }
    if (t.k === 'obj' && t.cls) {
      const r = memberExpr(f, 'call', b);
      if (r.grp) return callGroup(r.grp, args, e.pos);
      return callOn(r, name, args, e.pos);
    }
    if (name === 'Equals' && args.length === 1 && !(t.k === 'obj' && t.rt)) return { c: `__eq(${b.c}, ${ex(args[0].e).c})`, ty: BOOL };
    if (t.k === 'obj' && (DICTS.has(t.n) || SEQS.has(t.n))) {
      const rt: Ty = name === 'ContainsKey' || name === 'Contains' || name === 'Remove' || name === 'TryGetValue' ? BOOL : name === 'IndexOf' ? INT : ANY;
      const ps: PInfo[] | null = name === 'TryGetValue' && DICTS.has(t.n) && t.args?.length === 2
        ? [{ name: 'key', ty: t.args[0], mod: '', def: null, pos: e.pos }, { name: 'value', ty: t.args[1], mod: 'out', def: null, pos: e.pos }] : null;
      const out = argList(ps, args, e.pos);
      return wrapCall(`${b.c}${q}${name}(${out.list.join(', ')})`, out, rt);
    }
    return plainCall(`${b.c}${q}${name}`, args, e.pos);
  }
  function predefCall(tn: string, name: string, args: Arg[], p: Pos): R {
    const a = () => argsCode(args);
    const isInt = !!INT_NAMES[tn], isF = !!FLOAT_NAMES[tn];
    const tryParse = (parser: string, ty: Ty) => {
      const ps: PInfo[] = [{ name: 's', ty: STR, mod: '', def: null, pos: p }, { name: 'result', ty, mod: 'out', def: null, pos: p }];
      const out = argList(ps, args.slice(0, 1).concat(args.slice(-1)), p);
      return wrapCall(`__try(${parser}, ${out.list.join(', ')}, ${defVal(ty, p)})`, out, BOOL);
    };
    if (isInt || isF) {
      const ty = isInt ? T('int', tn) : FLOAT, parser = isInt ? (tn === 'int' ? 's => __pi(s) | 0' : '__pi') : '__pf';
      switch (name) {
        case 'Parse': return { c: `(${parser})(${a()[0]})`, ty };
        case 'TryParse': return tryParse(parser, ty);
        case 'IsNaN': return { c: `Number.isNaN(${a()[0]})`, ty: BOOL };
        case 'IsInfinity': { const t = tmp(); return { c: `((${t} = ${a()[0]}) === Infinity || ${t} === -Infinity)`, ty: BOOL } }
        case 'IsPositiveInfinity': return { c: `(${a()[0]} === Infinity)`, ty: BOOL };
        case 'IsNegativeInfinity': return { c: `(${a()[0]} === -Infinity)`, ty: BOOL };
        case 'IsFinite': return { c: `Number.isFinite(${a()[0]})`, ty: BOOL };
      }
    }
    if (tn === 'bool' && name === 'Parse') return { c: `__pb(${a()[0]})`, ty: BOOL };
    if (tn === 'bool' && name === 'TryParse') return tryParse('__pb', BOOL);
    if (tn === 'string') {
      switch (name) {
        case 'IsNullOrEmpty': return { c: `__ise(${a()[0]})`, ty: BOOL };
        case 'IsNullOrWhiteSpace': return { c: `__isws(${a()[0]})`, ty: BOOL };
        case 'Format': {
          const xs = a();
          if (!xs.length) { err(p, "No overload for method 'Format' takes 0 arguments"); return { c: '""', ty: STR } }
          const rest = xs.slice(1);
          return { c: `rt.__format(${xs[0]}, ${rest.length === 1 && peekTy(args[1].e).k === 'arr' ? rest[0] : `[${rest.join(', ')}]`})`, ty: NNSTR };
        }
        case 'Join': {
          const xs = a();
          if (xs.length === 2 && ['arr', 'obj', 'any'].includes(peekTy(args[1].e).k)) return { c: `__join(${xs[0]}, ${xs[1]})`, ty: NNSTR };
          return { c: `__join(${xs[0]}, [${xs.slice(1).join(', ')}])`, ty: NNSTR };
        }
        case 'Concat': return { c: `[${a().join(', ')}].map(__str).join('')`, ty: NNSTR };
        case 'Compare': case 'CompareOrdinal': { const xs = a(); return { c: `__cmp(${xs[0]}, ${xs[1]})`, ty: INT } }
        case 'Equals': { const xs = a(); return { c: `(${xs[0]} === ${xs[1]})`, ty: BOOL } }
      }
    }
    if (tn === 'char' && name in { IsDigit: 1, IsLetter: 1, IsLetterOrDigit: 1, IsWhiteSpace: 1, IsUpper: 1, IsLower: 1, IsPunctuation: 1, ToUpper: 1, ToLower: 1 })
      return { c: `__ch.${name}(${a()[0]})`, ty: name.startsWith('To') ? CHAR : BOOL };
    if (tn === 'object' && (name === 'ReferenceEquals' || name === 'Equals')) { const xs = a(); return { c: name === 'Equals' ? `__eq(${xs[0]}, ${xs[1]})` : `(${xs[0]} === ${xs[1]})`, ty: BOOL } }
    if (tn === 'Convert') {
      const x = a()[0];
      if (/^To(Int(16|32|64)|Byte|SByte|UInt(16|32|64))$/.test(name)) return { c: name === 'ToInt32' ? `(__toi(${x}) | 0)` : `__toi(${x})`, ty: name === 'ToInt64' ? LONG : INT };
      if (name === 'ToDouble' || name === 'ToSingle' || name === 'ToDecimal') return { c: `__tof(${x})`, ty: FLOAT };
      if (name === 'ToString') return { c: args.length > 1 ? `rt.__fmt(${a().join(', ')})` : `__str(${x})`, ty: NNSTR };
      if (name === 'ToBoolean') return { c: `(typeof ${x} === 'string' ? __pb(${x}) : !!${x})`, ty: BOOL };
    }
    err(p, `'${tn}' does not contain a definition for '${name}'`);
    return { c: 'undefined', ty: ANY };
  }
  function strCall(b: R, name: string, args: Arg[], p: Pos): R {
    const s = b.c, a = argsCode(args);
    switch (name) {
      case 'Substring': return { c: a.length > 1 ? `${s}.substr(${a[0]}, ${a[1]})` : `${s}.substring(${a[0]})`, ty: NNSTR };
      case 'IndexOf': case 'LastIndexOf': return { c: `${s}.${name === 'IndexOf' ? 'indexOf' : 'lastIndexOf'}(${a.slice(0, 2).join(', ')})`, ty: INT };
      case 'Contains': return { c: `${s}.includes(${a[0]})`, ty: BOOL };
      case 'StartsWith': case 'EndsWith': return { c: `${s}.${name === 'StartsWith' ? 'startsWith' : 'endsWith'}(${a[0]})`, ty: BOOL };
      case 'ToUpper': case 'ToUpperInvariant': return { c: `${s}.toUpperCase()`, ty: NNSTR };
      case 'ToLower': case 'ToLowerInvariant': return { c: `${s}.toLowerCase()`, ty: NNSTR };
      case 'Trim': case 'TrimStart': case 'TrimEnd':
        if (!a.length) return { c: `${s}.${name === 'Trim' ? 'trim' : name === 'TrimStart' ? 'trimStart' : 'trimEnd'}()`, ty: NNSTR };
        break;
      case 'Replace': return { c: `${s}.replaceAll(${a[0]}, ${a[1]})`, ty: NNSTR };
      case 'Split': return { c: a.length === 1 ? `__split(${s}, ${a[0]})` : `__split(${s}, [${a.join(', ')}])`, ty: arrOf(STR) };
      case 'PadLeft': case 'PadRight': return { c: `${s}.${name === 'PadLeft' ? 'padStart' : 'padEnd'}(${a[0]}, ${a[1] ?? '" "'})`, ty: NNSTR };
      case 'Equals': return { c: `(${s} === ${a[0]})`, ty: BOOL };
      case 'CompareTo': return { c: `__cmp(${s}, ${a[0]})`, ty: INT };
      case 'ToCharArray': return { c: `[...${s}]`, ty: arrOf(CHAR) };
      case 'Insert': { const t = tmp(); return { c: `((${t} = ${s}).slice(0, ${a[0]}) + ${a[1]} + ${t}.slice(${a[0]}))`, ty: NNSTR } }
      case 'Remove': { const t = tmp(); return { c: a.length > 1 ? `((${t} = ${s}).slice(0, ${a[0]}) + ${t}.slice(${a[0]} + ${a[1]}))` : `${s}.slice(0, ${a[0]})`, ty: NNSTR } }
    }
    err(p, `'string.${name}' is not supported`);
    return { c: 'undefined', ty: ANY };
  }

  // ── construction ──
  function construct(c: ClassInfo, args: Arg[], p: Pos): string {
    if (c.kind === 'interface') { err(p, `Cannot create an instance of the interface '${c.name}'`); return 'null' }
    if (c.isAbstract || c.isStatic) { err(p, `Cannot create an instance of the ${c.isStatic ? 'static' : 'abstract'} class '${c.name}'`); return 'null' }
    if (!c.ctors.length) {
      if (args.length) err(p, `'${c.name}' does not contain a constructor that takes ${args.length} arguments`);
      return `new ${c.js}()`;
    }
    const d = pick(c.ctors, args, c.name, p);
    if (!args.length && d.min === 0 && d.sig.params.length === 0) return `new ${c.js}()`;
    const out = argList(d.sig.params, args, p);
    return wrapCall(`new ${c.js}(__nc).${d.js}(${out.list.join(', ')})`, out, ANY).c;
  }
  function newExpr(e: Expr & { k: 'new' }, want?: Ty): R {
    let ty: Ty;
    if (!e.t) {
      if (!want || want.k === 'any') { err(e.pos, "Target-typed 'new()' needs a known target type"); return { c: 'null', ty: ANY } }
      ty = want;
    } else ty = resolve(e.t);
    let c: string;
    if (ty.k === 'obj' && ty.cls) c = construct(ty.cls, e.args, e.pos);
    else if (ty.k === 'obj') {
      if (/Exception$/.test(ty.n) && !G.has(ty.n)) c = `__exc(${JSON.stringify(ty.n)}${e.args.length ? `, ${ex(e.args[0].e).c}` : ''})`;
      else c = plainCall(`new rt.${ty.n}`, e.args, e.pos).c;
    } else if (ty.k === 'fn' && e.args.length === 1) return { c: fnValue(e.args[0].e, ty), ty };
    else if (num(ty) || ty.k === 'bool' || ty.k === 'char' || ty.k === 'enum') c = defVal(ty, e.pos);
    else if (ty.k === 'any' && e.t?.name !== 'var') c = '({})';
    else { err(e.pos, `Cannot create an instance of '${tyName(ty)}'`); return { c: 'null', ty: ANY } }
    if (!e.init) return { c, ty };
    const t = tmp(), parts = [`${t} = ${c}`];
    for (const it of e.init) parts.push(initItem(t, ty, it));
    return { c: `(${[...parts, t].join(', ')})`, ty };
  }
  function initItem(t: string, ty: Ty, it: InitItem): string {
    if (it.k === 'set') {
      const f = ty.cls ? findField(ty.cls, it.name) : undefined;
      if (ty.cls && !f && !hasRt(ty.cls)) err(it.pos, `'${ty.cls.name}' does not contain a definition for '${it.name}'`);
      return `${t}.${it.name} = ${f ? valueFor(it.e, f.ty) : ex(it.e).c}`;
    }
    if (it.k === 'idx') return `rt.__set(${t}, ${it.args.map(x => ex(x).c).join(', ')}, ${valueFor(it.e, elemTy(ty, 1))})`;
    const el = elemTy(ty, 1);
    return `${t}.Add(${it.args.map((x, k) => valueFor(x, DICTS.has(ty.n) ? ty.args?.[k] ?? null : el.k === 'any' ? null : el)).join(', ')})`;
  }
  function arrValues(t: Ty, e: Expr, p: Pos): string {
    if (e.k !== 'arrinit') return valueFor(e, t);
    if (t.k !== 'arr') { err(p, `Cannot initialize type '${tyName(t)}' with a collection initializer`); return '[]' }
    const r = t.rank ?? 1;
    const lvl = (x: Expr, d: number): string => {
      if (d === 0) return x.k === 'arrinit' ? arrValues(t.el!, x, x.pos) : valueFor(x, t.el!);
      if (x.k !== 'arrinit') { err(x.pos, 'A nested array initializer is expected'); return '[]' }
      return `[${x.list.map(y => lvl(y, d - 1)).join(', ')}]`;
    };
    return lvl(e, r);
  }
  function newArr(e: Expr & { k: 'newarr' }): R {
    let el: Ty;
    if (e.t) el = resolve(e.t);
    else {
      const first = e.init?.k === 'arrinit' ? e.init.list[0] : undefined;
      el = first ? peekTy(first) : ANY;
      if (el.k === 'null') el = ANY;
      if (el.n === 'nn') el = STR;
    }
    for (let k = e.rank.length - 1; k >= 1; k--) el = arrOf(el, e.rank[k]);
    const ty = arrOf(el, e.rank[0]);
    if (e.init) return { c: arrValues(ty, e.init, e.pos), ty };
    const sizes = e.sizes.map(s => conv(ex(s), INT));
    const d = defVal(el, e.pos);
    const v = isStruct(el) ? `() => ${d}` : d;
    return { c: sizes.length === 1 && !isStruct(el) ? `new Array(${sizes[0]}).fill(${d})` : `__arr([${sizes.join(', ')}], ${v})`, ty };
  }

  // ── lvalues ──
  function lval(e: Expr, reuse: boolean): LV | null {
    switch (e.k) {
      case 'id': {
        const s = lookupLocal(e.name);
        if (s) return s.ref ? { get: `${s.js}.v`, set: v => `${s.js}.v = ${v}`, ty: s.ty, pre: [], refVar: s.js, plain: true } : { get: s.js, set: v => `${s.js} = ${v}`, ty: s.ty, pre: [], plain: true };
        const r = idExpr(e, 'val');
        if (r.grp || r.ty.k === 'type' || r.ty.k === 'ns') return null;
        if (r.c === 'undefined') return null;
        checkWritable(e.name, ctx.cls, e.pos);
        return { get: r.c, set: v => `${r.c} = ${v}`, ty: r.ty, pre: [], plain: true };
      }
      case 'member': {
        if (e.e.k !== 'base' && e.e.k !== 'this') {
          const b = target(e.e);
          if (b.ty.k === 'obj' && b.ty.cls && !b.grp) checkWritable(e.name, b.ty.cls, e.pos);
          const tb = reuse && b.c && !simple(b.c) && (b.ty.k === 'obj' || b.ty.k === 'any') ? tmp() : '';
          const m = memberExpr(e, 'val', tb ? { ...b, c: tb } : b);
          if (m.grp || m.c === 'undefined' || !m.lv) { if (!m.grp && m.c !== 'undefined') err(e.pos, `'${e.name}' cannot be assigned to`); return null }
          return { get: m.c, set: v => `${m.c} = ${v}`, ty: m.ty, pre: tb ? [`${tb} = ${b.c}`] : [], plain: true };
        }
        if (e.e.k === 'this' && ctx.cls) checkWritable(e.name, ctx.cls, e.pos);
        const r = memberExpr(e, 'val');
        if (r.grp || r.c === 'undefined' || !r.lv) { if (!r.grp && r.c !== 'undefined') err(e.pos, `'${e.name}' cannot be assigned to`); return null }
        return { get: r.c, set: v => `${r.c} = ${v}`, ty: r.ty, pre: [], plain: true };
      }
      case 'index': {
        const b = ex(e.e);
        const ixs = e.args.map(index);
        if (b.ty.k === 'obj' && b.ty.cls?.indexer) {
          const ix = ixs.join(', ');
          return { get: `${b.c}.__get_item(${ix})`, set: v => `${b.c}.__set_item(${ix}, ${v})`, ty: b.ty.cls.indexer.ty, pre: [], plain: false };
        }
        const ty = elemTy(b.ty, ixs.length), pre: string[] = [];
        let obj = b.c;
        for (let k = 0; k < ixs.length - 1; k++) obj = `rt.__get(${obj}, ${ixs[k]})`;
        let last = ixs[ixs.length - 1];
        if (reuse) {
          if (!simple(obj)) { const t = tmp(); pre.push(`${t} = ${obj}`); obj = t }
          if (!simple(last)) { const t = tmp(); pre.push(`${t} = ${last}`); last = t }
        }
        return { get: `rt.__get(${obj}, ${last})`, set: v => `rt.__set(${obj}, ${last}, ${v})`, ty, pre, plain: false };
      }
    }
    return null;
  }
  function checkWritable(name: string, c: ClassInfo | null, p: Pos) {
    if (!c) return;
    const f = findField(c, name);
    if (!f) return;
    if (f.isConst) err(p, `The left-hand side of an assignment cannot be a constant ('${name}')`);
    else if (f.kind === 'prop' && f.d.k === 'prop' && !f.d.set) err(p, `Property '${name}' cannot be assigned to -- it is read only`);
  }
  function index(e: Expr): string { const r = ex(e); return r.ty.k === 'float' ? `(${r.c} | 0)` : r.ty.k === 'char' ? `${r.c}.charCodeAt(0)` : r.c }
  const seq = (pre: string[], c: string) => pre.length ? `(${[...pre, c].join(', ')})` : c;

  function assignTo(lv: LV, b: Expr): string {
    const v = lv.ty.k === 'fn' ? fnValue(b, lv.ty) : valueFor(b, lv.ty);
    return seq(lv.pre, lv.set(v));
  }

  // ── expressions ──
  function arith(a: Ty, b: Ty): Ty {
    if (a.k === 'float' || b.k === 'float') return FLOAT;
    const ia = a.k === 'int' || a.k === 'char', ib = b.k === 'int' || b.k === 'char';
    if (!ia || !ib) return ANY;
    return a.n === 'long' || b.n === 'long' || a.n === 'ulong' || b.n === 'ulong' || (a.n === 'uint') !== (b.n === 'uint') && (a.n === 'uint' || b.n === 'uint') ? LONG : a.n === 'uint' && b.n === 'uint' ? T('int', 'uint') : INT;
  }
  const truthy = (r: R) => r.c;
  const numC = (r: R) => r.ty.k === 'char' ? `${r.c}.charCodeAt(0)` : r.ty.k === 'enum' ? `${r.ty.en!.js}.__v[${r.c}]` : r.c;
  function binop(op: string, A: R, B: R): R {
    switch (op) {
      case '+':
        if (A.ty.k === 'string' || B.ty.k === 'string') return { c: `(${strOf(A)} + ${strOf(B)})`, ty: NNSTR };
        return { c: `(${numC(A)} + ${numC(B)})`, ty: arith(A.ty, B.ty) };
      case '-': case '*': return { c: `(${numC(A)} ${op} ${numC(B)})`, ty: arith(A.ty, B.ty) };
      case '/': case '%': {
        const ty = arith(A.ty, B.ty);
        if (ty.k === 'int') return { c: `${op === '/' ? '__div' : '__mod'}(${numC(A)}, ${numC(B)})`, ty };
        return { c: `(${numC(A)} ${op} ${numC(B)})`, ty };
      }
      case '==': case '!=': {
        if (A.ty.k === 'null' || B.ty.k === 'null') return { c: `(${A.ty.k === 'null' ? B.c : A.c} ${op} null)`, ty: BOOL };
        const mix = (A.ty.k === 'char') !== (B.ty.k === 'char') && (num(A.ty) || num(B.ty));
        const js = op === '==' ? '===' : '!==';
        return { c: `(${mix ? numC(A) : A.c} ${js} ${mix ? numC(B) : B.c})`, ty: BOOL };
      }
      case '<': case '>': case '<=': case '>=': return { c: `(${numC(A)} ${op} ${numC(B)})`, ty: BOOL };
      case '&&': case '||': return { c: `(${truthy(A)} ${op} ${truthy(B)})`, ty: BOOL };
      case '??': return { c: `(${A.c} ?? ${B.c})`, ty: A.ty.k === 'null' ? B.ty : { ...A.ty, nul: B.ty.nul } };
      case '&': case '|': case '^':
        if (A.ty.k === 'bool' && B.ty.k === 'bool') return { c: op === '^' ? `(${A.c} !== ${B.c})` : `!!(${A.c} ${op} ${B.c})`, ty: BOOL };
        return { c: `(${numC(A)} ${op} ${numC(B)})`, ty: arith(A.ty, B.ty).k === 'int' ? arith(A.ty, B.ty) : INT };
      case '<<': return { c: `(${numC(A)} << ${numC(B)})`, ty: A.ty.k === 'int' ? A.ty : INT };
      case '>>': return { c: `(${numC(A)} ${A.ty.n === 'uint' ? '>>>' : '>>'} ${numC(B)})`, ty: A.ty.k === 'int' ? A.ty : INT };
    }
    return { c: `(${A.c} ${op} ${B.c})`, ty: ANY };
  }
  function interp(e: Expr & { k: 'interp' }): R {
    const parts = e.parts.map(x => {
      if (typeof x === 'string') return JSON.stringify(x);
      const h = x as Hole, r = ex(h.e);
      if (h.fmt != null || h.align) return `rt.__fmt(${r.c}, ${JSON.stringify(h.fmt ?? '')}${h.align ? `, ${ex(h.align).c}` : ''})`;
      return strOf(r);
    }).filter(s => s !== '""');
    if (!parts.length) return { c: '""', ty: NNSTR };
    return { c: parts.length === 1 && /^"/.test(parts[0]) ? parts[0] : `(${/^"/.test(parts[0]) ? '' : '"" + '}${parts.join(' + ')})`, ty: NNSTR };
  }
  function typeTest(ty: Ty, c: string): string {
    switch (ty.k) {
      case 'int': return `Number.isInteger(${c})`;
      case 'float': return `(typeof ${c} === "number")`;
      case 'bool': return `(typeof ${c} === "boolean")`;
      case 'string': return `(typeof ${c} === "string")`;
      case 'char': return `(typeof ${c} === "string" && ${c}.length === 1)`;
      case 'enum': return `(typeof ${c} === "string" && Object.hasOwn(${ty.en!.js}.__v, ${c}))`;
      case 'arr': return `Array.isArray(${c})`;
      case 'fn': return `(typeof ${c} === "function")`;
      case 'obj':
        if (ty.cls) return `(${c} instanceof ${ty.cls.js})`;
        if (/Exception$/.test(ty.n) && !G.has(ty.n)) return `(${c} instanceof Error && __isex(${c}, ${JSON.stringify(ty.n)}))`;
        return `__isrt(${c}, ${JSON.stringify(ty.n)})`;
      default: return `(${c} != null)`;
    }
  }
  function typeOfConst(e: Expr): Ty | null {   // constant pattern that actually names a type
    if (e.k !== 'id' || lookupLocal(e.name)) return null;
    const c = classes.get(e.name);
    if (c) return T('obj', c.name, { cls: c });
    const pd = predefName(e.name);
    if (pd && pd !== 'Convert') return resolve({ name: e.name, qual: [e.name], args: [], rank: [], nullable: false, pos: e.pos });
    return null;
  }
  function pat(p: Pattern, s: R): string {
    switch (p.k) {
      case 'discard': return 'true';
      case 'var': { const v = declareLocal(p.name, s.ty, p.pos, false, true); return `((${v.js} = ${s.c}), true)` }
      case 'type': {
        const ty = resolve(p.t), test = typeTest(ty, s.c);
        if (!p.name) return test;
        const v = declareLocal(p.name, { ...ty, nul: false }, p.pos, false, true);
        return `(${test} && ((${v.js} = ${s.c}), true))`;
      }
      case 'const': {
        const tt = typeOfConst(p.e);
        if (tt) return typeTest(tt, s.c);
        const r = ex(p.e, s.ty);
        if (r.ty.k === 'null') return `(${s.c} == null)`;
        const mix = (s.ty.k === 'char') !== (r.ty.k === 'char') && (num(s.ty) || num(r.ty));
        return `(${mix ? numC(s) : s.c} === ${mix ? numC(r) : r.c})`;
      }
      case 'rel': { const r = ex(p.e); return `(${numC(s)} ${p.op} ${numC(r)})` }
      case 'and': return `(${pat(p.a, s)} && ${pat(p.b, s)})`;
      case 'or': return `(${pat(p.a, s)} || ${pat(p.b, s)})`;
      case 'not': return `!${pat(p.p, s)}`;
    }
  }
  function subject(r: R): { pre: string; s: R } {
    if (simple(r.c)) return { pre: '', s: r };
    const t = tmp();
    return { pre: `${t} = ${r.c}`, s: { c: t, ty: r.ty } };
  }
  function cast(e: Expr & { k: 'cast' }): R {
    const to = resolve(e.t), r = ex(e.e, to), f = r.ty, c = r.c;
    switch (to.k) {
      case 'int': {
        if (f.k === 'enum') return { c: `${f.en!.js}.__v[${c}]`, ty: to };
        if (f.k === 'char') return { c: conv(r, to), ty: to };
        if (f.k === 'int' && (f.n === to.n || (to.n === 'long' && f.n !== 'ulong'))) return { c, ty: to };
        if (to.nul) return { c: `__ni(${c})`, ty: to };
        return { c: /^\(?-?\d+(\.\d+)?\)?$/.test(c) ? conv({ c, ty: FLOAT }, to) : intWrap(c, to.n), ty: to };
      }
      case 'float': return { c: f.k === 'char' ? `${c}.charCodeAt(0)` : f.k === 'enum' ? `${f.en!.js}.__v[${c}]` : c, ty: to };
      case 'char': return { c: f.k === 'char' ? c : `String.fromCharCode(${c})`, ty: to };
      case 'enum': return { c: f.k === 'enum' ? c : `(${to.en!.js}.__n[${c}] ?? ${c})`, ty: to };
      case 'obj':
        if (to.cls || f.k === 'obj' && f.n === to.n) return { c, ty: to };
        return { c: `__rcast(${c}, ${JSON.stringify(to.n)})`, ty: to };
      case 'fn': return { c: r.grp ? groupValue(r.grp, to) : c, ty: to };
    }
    return { c, ty: to };
  }
  function lambda(e: Expr & { k: 'lambda' }, want?: Ty): R {
    const sig = want?.k === 'fn' ? want.sig : undefined;
    const save = { temps: ctx.temps, ret: ctx.ret, ctor: ctx.ctor, brk: ctx.brk, catchVar: ctx.catchVar };
    ctx.temps = []; ctx.ctor = false; ctx.brk = []; ctx.catchVar = null;
    ctx.ret = sig ? sig.ret : null;
    ctx.scopes.push(new Map());
    const ps = e.params.map((p, k) => {
      const ty = p.t ? resolve(p.t) : sig?.params[k]?.ty ?? ANY;
      return { info: { name: p.name, ty, mod: p.mod, def: null, pos: p.pos } as PInfo, sym: declareLocal(p.name, ty, p.pos, p.mod === 'ref' || p.mod === 'out') };
    });
    let body: string, ret: Ty | null = ctx.ret;
    if (Array.isArray(e.body)) {
      if (!ret) ret = ANY;
      ctx.ret = ret;
      const b = block(e.body, 0);
      body = ctx.temps.length ? b.replace('{\n', `{\n  let ${ctx.temps.join(', ')};\n`) : b;
    } else {
      const r = ex(e.body, ret ?? undefined);
      const c = r.grp ? groupValue(r.grp, ret) : ret && ret.k !== 'void' ? conv(r, ret) : r.c;
      if (!ret) ret = r.ty;
      body = ctx.temps.length ? `{ let ${ctx.temps.join(', ')}; ${ret.k === 'void' ? '' : 'return '}${c}; }` : `(${c})`;
    }
    ctx.scopes.pop();
    Object.assign(ctx, save);
    return { c: `((${ps.map(p => p.sym.js).join(', ')}) => ${body})`, ty: T('fn', 'lambda', { sig: { params: ps.map(p => p.info), ret } }) };
  }
  function switchExpr(e: Expr & { k: 'switch' }, want?: Ty): R {
    const v = tmp(), subj = ex(e.e), s: R = { c: v, ty: subj.ty };
    let ty: Ty | null = null;
    const arms = e.arms.map(a => {
      ctx.scopes.push(new Map());
      let c = pat(a.p, s);
      if (a.when) c = c === 'true' ? ex(a.when).c : `(${c} && ${ex(a.when).c})`;
      const r = ex(a.e, want);
      ctx.scopes.pop();
      if (!ty || ty.k === 'null') ty = r.ty;
      else if (num(ty) && num(r.ty) && ty.k !== r.ty.k) ty = FLOAT;
      return { c, r };
    });
    const res = ty ?? ANY;
    let out = `__nomatch(${v})`;
    for (let k = arms.length - 1; k >= 0; k--) {
      const val = want ? arms[k].r.c : num(res) ? conv(arms[k].r, res) : arms[k].r.c;
      out = arms[k].c === 'true' ? val : `${arms[k].c} ? ${val} : ${out}`;
    }
    return { c: `(${v} = ${subj.c}, ${out})`, ty: res };
  }
  function ex(e: Expr, want?: Ty): R {
    switch (e.k) {
      case 'num': {
        const ty = e.suf === 'int' ? INT : e.suf === 'long' || e.suf === 'ulong' || e.suf === 'uint' ? T('int', e.suf) : T('float', e.suf);
        return { c: jsNum(e.v), ty };
      }
      case 'str': return { c: JSON.stringify(e.v), ty: NNSTR };
      case 'char': return { c: JSON.stringify(e.v), ty: CHAR };
      case 'interp': return interp(e);
      case 'lit': return e.v === null ? { c: 'null', ty: NULLT } : { c: String(e.v), ty: BOOL };
      case 'this':
        if (!ctx.cls || ctx.isStatic) { err(e.pos, "Keyword 'this' is not valid in a static member"); return { c: 'undefined', ty: ANY } }
        return { c: 'this', ty: T('obj', ctx.cls.name, { cls: ctx.cls }) };
      case 'base': err(e.pos, "Use of keyword 'base' is not valid in this context"); return { c: 'undefined', ty: ANY };
      case 'id': return idExpr(e, 'val');
      case 'member': return memberExpr(e, 'val');
      case 'call': return call(e);
      case 'index': {
        const b = ex(e.e);
        if (b.ty.k === 'obj' && b.ty.cls?.indexer) return { c: `${b.c}.__get_item(${e.args.map(index).join(', ')})`, ty: b.ty.cls.indexer.ty };
        if (b.ty.k === 'obj' && b.ty.cls && !hasRt(b.ty.cls)) err(e.pos, `Cannot apply indexing with [] to an expression of type '${b.ty.n}'`);
        if (num(b.ty) || b.ty.k === 'bool') err(e.pos, `Cannot apply indexing with [] to an expression of type '${b.ty.n}'`);
        const ixs = e.args.map(index);
        let c = b.c;
        ixs.forEach((ix, k) => { c = e.cond && k === 0 ? `__gc(${c}, ${ix})` : `rt.__get(${c}, ${ix})` });
        return { c, ty: elemTy(b.ty, ixs.length), lv: true };
      }
      case 'unary': {
        if (e.op === '++' || e.op === '--') return incdec(e.e, e.op, true, e.pos);
        const r = ex(e.e);
        if (e.op === '!') return { c: `!${r.c}`, ty: BOOL };
        if (e.op === '~') return { c: `(~${numC(r)})`, ty: r.ty.k === 'int' ? r.ty : INT };
        if (e.op === '-' && /^\d/.test(r.c)) return { c: `(-${r.c})`, ty: r.ty };
        return { c: `(${e.op}${numC(r)})`, ty: r.ty.k === 'char' ? INT : r.ty };
      }
      case 'post': return incdec(e.e, e.op, false, e.pos);
      case 'bin': return binop(e.op, ex(e.a), ex(e.b, e.op === '??' ? want : undefined));
      case 'assign': {
        const lv = lval(e.a, e.op !== '=');
        if (!lv) { err(e.pos, 'The left-hand side of an assignment must be a variable, property or indexer'); return { c: 'undefined', ty: ANY } }
        // delegates / events: += combines, -= removes (multicast, invoked in order)
        if ((e.op === '+=' || e.op === '-=') && (lv.ty.k === 'fn' || e.b.k === 'lambda' || (e.b.k === 'id' && peekGroup(e.b)))) {
          const f = fnValue(e.b, lv.ty.k === 'fn' ? lv.ty : T('fn', 'Delegate'));
          return { c: seq(lv.pre, lv.set(`rt.${e.op === '+=' ? '__dadd' : '__drem'}(${lv.get}, ${f})`)), ty: lv.ty };
        }
        if (e.op === '=') return { c: assignTo(lv, e.b), ty: lv.ty };
        if (e.op === '??=') return { c: seq(lv.pre, `(${lv.get} ?? (${lv.set(valueFor(e.b, lv.ty))}))`), ty: lv.ty };
        const v = binop(e.op === '>>=' ? '>>' : e.op.slice(0, -1), { c: lv.get, ty: lv.ty }, ex(e.b));
        return { c: seq(lv.pre, lv.set(conv(v, lv.ty))), ty: lv.ty };
      }
      case 'cond': {
        const c = ex(e.c), a = ex(e.a, want), b = ex(e.b, want);
        const ty = num(a.ty) && num(b.ty) && a.ty.k !== b.ty.k ? FLOAT : a.ty.k === 'null' ? { ...b.ty, nul: true } : a.ty.k === 'string' && b.ty.k === 'string' ? (a.ty.n === 'nn' && b.ty.n === 'nn' ? NNSTR : STR) : a.ty;
        const cv = (r: R) => r.grp ? groupValue(r.grp, want ?? null) : num(ty) ? conv(r, ty) : r.c;
        return { c: `(${truthy(c)} ? ${cv(a)} : ${cv(b)})`, ty };
      }
      case 'cast': return cast(e);
      case 'as': {
        const ty = resolve(e.t), { pre, s } = subject(ex(e.e));
        return { c: `(${pre ? pre + ', ' : ''}${typeTest(ty, s.c)} ? ${s.c} : null)`, ty: { ...ty, nul: ty.k !== 'obj' } };
      }
      case 'is': {
        const { pre, s } = subject(ex(e.e));
        const c = pat(e.p, s);
        return { c: pre ? `(${pre}, ${c})` : c, ty: BOOL };
      }
      case 'new': return newExpr(e, want);
      case 'newarr': return newArr(e);
      case 'arrinit':
        if (want?.k === 'arr') return { c: arrValues(want, e, e.pos), ty: want };
        err(e.pos, 'An array initializer can only be used in a variable or field initializer; use new T[] { ... }');
        return { c: '[]', ty: ANY };
      case 'lambda': return lambda(e, want);
      case 'typeof': return { c: JSON.stringify(e.t.name), ty: STR };
      case 'nameof': return { c: JSON.stringify(e.name), ty: NNSTR };
      case 'default': {
        const t = e.t ? resolve(e.t) : want;
        return { c: t ? defVal(t, e.pos) : 'null', ty: t ?? NULLT };
      }
      case 'switch': return switchExpr(e, want);
      case 'throw': return { c: `__throw(${ex(e.e).c})`, ty: want ?? T('null', 'throw') };
    }
  }
  function peekGroup(e: Expr): boolean {
    const n = errors.length;
    const r = e.k === 'id' ? idExpr(e, 'val') : null;
    errors.length = n;
    return !!r?.grp;
  }
  function incdec(target: Expr, op: string, prefix: boolean, p: Pos): R {
    const lv = lval(target, true);
    if (!lv) { err(p, `The operand of '${op}' must be a variable, property or indexer`); return { c: 'undefined', ty: ANY } }
    if (lv.plain && (lv.ty.k === 'any' || lv.ty.k === 'float' || (lv.ty.k === 'int' && (lv.ty.n === 'int' || lv.ty.n === 'long')))) return { c: seq(lv.pre, prefix ? `${op}${lv.get}` : `${lv.get}${op}`), ty: lv.ty };
    const d = op === '++' ? '+' : '-';
    const nv = (x: string) => conv({ c: `(${numC({ c: x, ty: lv.ty })} ${d} 1)`, ty: lv.ty.k === 'char' ? INT : lv.ty }, lv.ty);
    const t = tmp();
    if (prefix) return { c: `(${[...lv.pre, `${t} = ${nv(lv.get)}`, lv.set(t), t].join(', ')})`, ty: lv.ty };
    return { c: `(${[...lv.pre, `${t} = ${lv.get}`, lv.set(nv(t)), t].join(', ')})`, ty: lv.ty };
  }

  // ── statements ──
  const localFns = new Map<MethodDecl, Sym>();
  function block(list: Stmt[], ind: number, head = ''): string {
    ctx.scopes.push(new Map());
    for (const s of list) if (s.k === 'localfn') {
      const f = s.fn, tn = new Set([...ctx.tnames, ...f.tparams]);
      const save = ctx.tnames; ctx.tnames = tn;
      const sig: Sig = { params: pinfo(f.params, tn), ret: resolve(f.ret) };
      ctx.tnames = save;
      localFns.set(f, declareLocal(f.name, T('fn', f.name, { sig }), f.pos));
    }
    const hoisted: string[] = [];
    const body = list.map(s => s.k === 'localfn' ? (hoisted.push(localFn(s.fn, ind + 1)), '') : stmt(s, ind + 1)).join('');
    ctx.scopes.pop();
    return `{\n${head}${hoisted.join('')}${body}${pad(ind)}}`;
  }
  function localFn(f: MethodDecl, ind: number): string {
    const sym = localFns.get(f)!, sig = sym.ty.sig!;
    const save = { temps: ctx.temps, ret: ctx.ret, ctor: ctx.ctor, brk: ctx.brk, catchVar: ctx.catchVar, tnames: ctx.tnames };
    ctx.temps = []; ctx.ret = sig.ret; ctx.ctor = false; ctx.brk = []; ctx.catchVar = null; ctx.tnames = new Set([...ctx.tnames, ...f.tparams]);
    const [ps, b] = fnCode(sig.params, f.body, f.expr, ind);
    Object.assign(ctx, save);
    return `${pad(ind)}const ${sym.js} = ${ps} => ${b};\n`;
  }
  function body(s: Stmt, ind: number): string { return s.k === 'block' ? block(s.body, ind) : block([s], ind) }
  function varDecl(s: Stmt & { k: 'vars' }, ind: number): string {
    return declItems(s).map(([js, init]) => `${pad(ind)}${s.isConst ? 'const' : 'let'} ${js} = ${init};\n`).join('');
  }
  function declItems(s: Stmt & { k: 'vars' }): [string, string][] {
    const isVar = s.t.name === 'var' && s.t.qual.length === 1 && !s.t.rank.length;
    return s.list.map(d => {
      let ty = isVar ? null : resolve(s.t), init: string;
      if (isVar) {
        if (!d.init) { err(d.pos, "Implicitly-typed variables must be initialized"); ty = ANY }
        if (d.init?.k === 'arrinit') err(d.pos, 'Cannot initialize an implicitly-typed variable with an array initializer');
      }
      if (!d.init) init = defVal(ty!, d.pos);
      else if (ty) init = d.init.k === 'arrinit' ? arrValues(ty, d.init, d.pos) : ty.k === 'fn' ? fnValue(d.init, ty) : valueFor(d.init, ty);
      else {
        const r = ex(d.init);
        ty = r.ty.k === 'null' ? ANY : r.ty.n === 'nn' ? STR : r.ty.k === 'type' ? ANY : r.ty;
        init = r.grp ? groupValue(r.grp, null) : isStruct(r.ty) && isLvalExpr(d.init) ? `__cl(${r.c})` : r.c;
      }
      if (s.isConst && d.init && constVal(d.init, ctx.cls) === undefined) err(d.pos, `The expression being assigned to '${d.name}' must be constant`);
      return [declareLocal(d.name, ty!, d.pos).js, init] as [string, string];
    });
  }
  const cond = (e: Expr) => `(${ex(e).c})`;
  function stmt(s: Stmt, ind: number): string {
    const p = pad(ind);
    switch (s.k) {
      case 'vars': return varDecl(s, ind);
      case 'expr': {
        const e = s.e;
        if (!['assign', 'call', 'post', 'new', 'throw'].includes(e.k) && !(e.k === 'unary' && (e.op === '++' || e.op === '--')))
          err(s.pos, 'Only assignment, call, increment, decrement and new object expressions can be used as a statement');
        return `${p}${ex(e).c};\n`;
      }
      case 'block': return `${p}${block(s.body, ind)}\n`;
      case 'empty': return '';
      case 'if': return `${p}if ${cond(s.c)} ${body(s.a, ind)}${s.b ? ` else ${s.b.k === 'if' ? stmt(s.b, ind).trimStart().replace(/\n$/, '') : body(s.b, ind)}` : ''}\n`;
      case 'while': { ctx.brk.push(null); const r = `${p}while (__t() && ${cond(s.c)}) ${body(s.body, ind)}\n`; ctx.brk.pop(); return r }
      case 'do': { ctx.brk.push(null); const b = body(s.body, ind); ctx.brk.pop(); return `${p}do ${b} while (__t() && ${cond(s.c)});\n` }
      case 'for': {
        ctx.scopes.push(new Map());
        const i0 = s.init[0];
        const init = i0?.k === 'vars' ? 'let ' + declItems(i0).map(([js, v]) => `${js} = ${v}`).join(', ') : s.init.map(x => x.k === 'expr' ? ex(x.e).c : '').join(', ');
        const c = s.c ? ex(s.c).c : 'true', step = s.step.map(x => ex(x).c).join(', ');
        ctx.brk.push(null);
        const r = `${p}for (${init}; __t() && (${c}); ${step}) ${body(s.body, ind)}\n`;
        ctx.brk.pop();
        ctx.scopes.pop();
        return r;
      }
      case 'foreach': {
        const coll = ex(s.e);
        if (num(coll.ty) || coll.ty.k === 'bool') err(s.e.pos, `foreach statement cannot operate on variables of type '${coll.ty.n}'`);
        ctx.scopes.push(new Map());
        const isVar = s.t.name === 'var' && s.t.qual.length === 1;
        const ty = isVar ? iterTy(coll.ty) : resolve(s.t);
        const v = declareLocal(s.name, ty, s.pos);
        ctx.brk.push(null);
        const r = `${p}for (const ${v.js} of ${coll.c}) ${body(s.body, ind)}\n`;
        ctx.brk.pop();
        ctx.scopes.pop();
        return r;
      }
      case 'switch': {
        const lbl = `__sw${++labelN}`, v = `__v${labelN}`;
        const subj = ex(s.e), sv: R = { c: v, ty: subj.ty };
        ctx.scopes.push(new Map());
        ctx.brk.push(lbl);
        let r = `${p}${lbl}: {\n${pad(ind + 1)}const ${v} = ${subj.c};\n`, first = true, dflt: string | null = null;
        const seen = new Set<string>();
        for (const sec of s.sections) {
          const conds: string[] = [];
          for (const l of sec.labels) {
            if (!l.p) { if (seen.has('default')) err(l.pos, "The switch statement contains multiple 'default' labels"); seen.add('default'); continue }
            const c = pat(l.p, sv);
            if (l.p.k === 'const' && !l.when) { if (seen.has(c)) err(l.pos, 'The switch statement contains multiple cases with the same label value'); seen.add(c) }
            conds.push(l.when ? `(${c} && ${ex(l.when).c})` : c);
          }
          const last = sec.body[sec.body.length - 1];
          if (last && !['break', 'return', 'throw', 'continue'].includes(last.k) && !(last.k === 'block' && last.body.length) && sec !== s.sections[s.sections.length - 1])
            warn(last.pos, 'Control cannot fall through from one case label to another');
          const b = block(sec.body, ind + 1);
          if (sec.labels.some(l => !l.p)) { dflt = b; if (!conds.length) continue }
          r += `${pad(ind + 1)}${first ? '' : 'else '}if (${conds.join(' || ')}) ${b}\n`;
          first = false;
        }
        if (dflt) r += `${pad(ind + 1)}${first ? '' : 'else '}${dflt}\n`;
        ctx.brk.pop();
        ctx.scopes.pop();
        return r + `${p}}\n`;
      }
      case 'break': {
        if (!ctx.brk.length) { err(s.pos, 'No enclosing loop out of which to break'); return '' }
        const t = ctx.brk[ctx.brk.length - 1];
        return `${p}break${t ? ' ' + t : ''};\n`;
      }
      case 'continue':
        if (!ctx.brk.some(b => b === null)) err(s.pos, 'No enclosing loop out of which to continue');
        return `${p}continue;\n`;
      case 'return': {
        if (ctx.ctor) { if (s.e) err(s.pos, 'Constructors cannot return a value'); return `${p}return this;\n` }
        const ret = ctx.ret;
        if (!s.e) { if (ret && ret.k !== 'void' && ret.k !== 'any') err(s.pos, 'An object of a type convertible to the return type is required'); return `${p}return;\n` }
        if (ret?.k === 'void') { err(s.pos, 'Since the method returns void, a return keyword must not be followed by an object expression'); return `${p}return;\n` }
        return `${p}return ${ret ? valueFor(s.e, ret) : ex(s.e).c};\n`;
      }
      case 'throw': {
        if (!s.e) { if (!ctx.catchVar) err(s.pos, 'A throw statement with no arguments is not allowed outside of a catch clause'); return `${p}throw ${ctx.catchVar ?? 'undefined'};\n` }
        return `${p}throw ${ex(s.e).c};\n`;
      }
      case 'try': {
        let r = `${p}try ${block(s.body, ind)}`;
        if (s.catches.length) {
          const ev = `__e${++labelN}`, save = ctx.catchVar;
          ctx.catchVar = ev;
          const parts: string[] = [];
          let all = false;
          for (const c of s.catches) {
            ctx.scopes.push(new Map());
            const ty = c.t ? resolve(c.t) : T('obj', 'Exception');
            if (c.name) ctx.scopes[ctx.scopes.length - 1].set(c.name, { js: ev, ty, ref: false });
            let test = !c.t || c.t.name === 'Exception' || c.t.name === 'SystemException' ? 'true' : typeTest(ty, ev).replace(/^\(\w+ instanceof Error && (.*)\)$/, '$1');
            if (c.when) test = test === 'true' ? ex(c.when).c : `(${test} && ${ex(c.when).c})`;
            const b = block(c.body, ind + 1);
            ctx.scopes.pop();
            if (all) { warn(c.pos, 'Unreachable catch clause'); continue }
            parts.push(test === 'true' ? b : `if (${test}) ${b}`);
            if (test === 'true') all = true;
          }
          ctx.catchVar = save;
          const chain = parts.map((x, k) => (k ? ' else ' : '') + x).join('') + (all ? '' : ` else throw ${ev};`);
          r += ` catch (${ev}) {\n${pad(ind + 1)}${chain}\n${p}}`;
        }
        if (s.fin) r += ` finally ${block(s.fin, ind)}`;
        return r + '\n';
      }
      case 'using': {
        ctx.scopes.push(new Map());
        const head = s.decl ? (s.decl.k === 'vars' ? varDecl(s.decl, ind + 1) : `${pad(ind + 1)}${ex((s.decl as { e: Expr }).e).c};\n`) : '';
        const b = s.body.k === 'block' ? s.body.body : [s.body];
        const r = `${p}${block(b, ind, head)}\n`;
        ctx.scopes.pop();
        return r;
      }
      case 'localfn': return '';
    }
  }

  // ── functions & classes ──
  function fnCode(ps: PInfo[], bodyS: Stmt[] | null, expr: Expr | null, ind: number, head: () => string[] = () => [], tail = ''): [string, string] {
    ctx.scopes.push(new Map());
    const plist = ps.map(q => {
      const s = declareLocal(q.name, q.ty, q.pos, q.mod === 'ref' || q.mod === 'out');
      if (q.mod === 'params') return `${s.js} = []`;
      if (q.def && !s.ref) {
        if (constVal(q.def, ctx.cls) === undefined && q.def.k !== 'default' && !(q.def.k === 'lit' && q.def.v === null) && q.def.k !== 'new')
          err(q.def.pos, `Default parameter value for '${q.name}' must be a compile-time constant`);
        return `${s.js} = ${valueFor(q.def, q.ty)}`;
      }
      return s.js;
    });
    const h = head().filter(Boolean).map(x => `${pad(ind + 1)}${x}\n`).join('');
    let b: string;
    if (bodyS) b = block(bodyS, ind, h);
    else if (expr) {
      const ret = ctx.ret;
      const line = ctx.ctor || !ret || ret.k === 'void' ? `${ex(expr).c};` : `return ${valueFor(expr, ret)};`;
      b = `{\n${h}${pad(ind + 1)}${line}\n${pad(ind)}}`;
    } else b = `{\n${h}${pad(ind)}}`;
    ctx.scopes.pop();
    const t = ctx.temps.length ? `${pad(ind + 1)}let ${ctx.temps.join(', ')};\n` : '';
    if (t) b = b.replace('{\n', `{\n${t}`);
    if (tail) b = b.replace(/\}$/, `${pad(ind + 1)}${tail}\n${pad(ind)}}`);
    return [`(${plist.join(', ')})`, b];
  }
  function accessorCode(a: Accessor, ty: Ty, setter: boolean, extra: PInfo[], ind: number): string {
    const ps = [...extra, ...(setter ? [{ name: 'value', ty, mod: '', def: null, pos: a.pos }] : [])];
    return fnCode(ps, a.body, a.expr, ind).join(' ');
  }
  function inputsOf(c: ClassInfo): NtInput[] {
    const own: { inp: NtInput; idx: number }[] = [];
    let idx = 0;
    const save = ctx;
    ctx = newCtx(c, false);
    for (const d of c.decls) for (const m of d.members) {
      if (m.k !== 'prop' || !attr(m.attrs, 'NinjaScriptProperty')) continue;
      const ty = resolve(m.t), disp = attr(m.attrs, 'Display'), range = attr(m.attrs, 'Range');
      const sv = (e: Expr | undefined) => { if (!e) return undefined; const v = constVal(e, c); return typeof v === 'string' ? v : undefined };
      const order = disp?.named.Order ? constVal(disp.named.Order, c) : undefined;
      let group = sv(disp?.named.GroupName) ?? 'Parameters';
      if (group === 'NinjaScriptParameters') group = 'Parameters';
      const inp: NtInput = { name: m.name, type: tyName(ty), displayName: sv(disp?.named.Name) ?? m.name, group, order: typeof order === 'number' ? order : 1e6 + idx };
      if (m.init) { const v = constVal(m.init, c); if (v !== undefined && v !== null) inp.def = v }
      if (range && range.args.length >= 2) {
        const lo = constVal(range.args[0], c), hi = constVal(range.args[1], c);
        if (typeof lo === 'number') inp.min = lo;
        if (typeof hi === 'number') inp.max = hi;
      }
      if (ty.k === 'enum') inp.options = [...ty.en!.vals.keys()];
      own.push({ inp, idx: idx++ });
    }
    ctx = save;
    const base = c.base ? inputsOf(c.base) : [];
    const all = [...base.map((inp, k) => ({ inp, idx: -base.length + k })), ...own];
    return all.sort((a, b) => a.inp.order - b.inp.order || a.idx - b.idx).map(x => x.inp);
  }
  function emitClass(c: ClassInfo, info: NtClassInfo): string {
    const excBase = !!c.baseRt && /Exception$/.test(c.baseRt) && !G.has(c.baseRt);
    const ext = c.base ? ` extends ${c.base.js}` : c.baseRt ? (excBase ? ' extends Error' : ` extends rt.${c.baseRt}`) : '';
    const L: string[] = [`class ${c.js}${ext} {`];
    L.push(`  static __name = ${JSON.stringify(c.name)};`, `  static __inputs = ${JSON.stringify(info.inputs)};`);
    const inits: string[] = [];
    const fieldList = [...c.fields.values()];
    for (const f of fieldList) {
      if (f.kind === 'prop') continue;
      const init = f.d.init;
      ctx = newCtx(c, f.isStatic);
      let v: string;
      if (!init) v = defVal(f.ty, f.d.pos);
      else v = init.k === 'arrinit' ? arrValues(f.ty, init, init.pos) : f.ty.k === 'fn' ? fnValue(init, f.ty) : valueFor(init, f.ty);
      if (f.isConst && init && constVal(init, c) === undefined) err(init.pos, `The expression being assigned to '${c.name}.${f.name}' must be constant`);
      if (ctx.temps.length) v = `(() => { let ${ctx.temps.join(', ')}; return ${v} })()`;
      if (f.isStatic) L.push(`  static ${f.name} = ${v};`);
      else inits.push(`this.${f.name} = ${v};`);
    }
    const dflt = c.ctors.find(k => k.min === 0)?.js ?? (c.ctors.length ? null : '__c');
    const baseDflt = (p: Pos) => {
      if (!c.base) return '';
      const b = c.base.ctors.find(k => k.min === 0)?.js ?? (c.base.ctors.length ? null : '__c');
      if (!b) { err(p, `'${c.base.name}' does not contain a constructor that takes 0 arguments`); return '' }
      return `super.${b}();`;
    };
    if (c.kind !== 'interface') {
      L.push(`  constructor(...a) { ${c.base ? 'super(__nc); ' : ext ? 'super(); ' : ''}${inits.join(' ')}${dflt ? ` if (a[0] !== __nc) this.${dflt}(...a);` : ''} }`);
      if (!c.ctors.length) L.push(`  __c() { ${baseDflt(c.pos)}${c.base ? ' ' : ''}return this }`);
    }
    for (const k of c.ctors) {
      const d = k.d as CtorDecl;
      ctx = newCtx(c, false, null, true);
      const head = () => {
        const init = d.init;
        if (!init) return [baseDflt(d.pos)];
        if (init.kind === 'this') {
          const t = pick(c.ctors, init.args, c.name, init.pos);
          if (t === k) err(init.pos, 'Constructor cannot call itself');
          const out = argList(t.sig.params, init.args, init.pos);
          return [wrapCall(`this.${t.js}(${out.list.join(', ')})`, out, VOID).c + ';'];
        }
        if (c.base) {
          const b = c.base;
          if (!b.ctors.length) { if (init.args.length) err(init.pos, `'${b.name}' does not contain a constructor that takes ${init.args.length} arguments`); return ['super.__c();'] }
          const t = pick(b.ctors, init.args, b.name, init.pos);
          const out = argList(t.sig.params, init.args, init.pos);
          return [wrapCall(`super.${t.js}(${out.list.join(', ')})`, out, VOID).c + ';'];
        }
        if (excBase && init.args.length) return [`this.message = ${strOf(ex(init.args[0].e))};`];
        if (init.args.length) warn(init.pos, `Arguments to the runtime base constructor '${c.baseRt}' are ignored`);
        return [];
      };
      L.push(`  ${k.js}${fnCode(k.sig.params, d.body, d.expr, 1, head, 'return this;').join(' ')}`);
    }
    for (const sc of c.sctors) { ctx = newCtx(c, true, VOID); L.push(`  static ${fnCode([], sc.body, sc.expr, 1)[1]}`) }
    for (const f of fieldList) {
      if (f.kind !== 'prop' || f.d.k !== 'prop') continue;
      const pd = f.d as PropDecl, st = f.isStatic ? 'static ' : '';
      if (pd.get) { ctx = newCtx(c, f.isStatic, f.ty); L.push(`  ${st}get ${f.name}${accessorCode(pd.get, f.ty, false, [], 1)}`) }
      if (pd.set) { ctx = newCtx(c, f.isStatic, VOID); L.push(`  ${st}set ${f.name}${accessorCode(pd.set, f.ty, true, [], 1)}`) }
      if ([pd.get, pd.set].some(a => a && !a.body && !a.expr)) err(pd.pos, `'${f.name}': property accessors must all be auto-implemented or all have bodies`);
    }
    if (c.indexer) {
      const ix = c.indexer;
      if (ix.d.get) { ctx = newCtx(c, false, ix.ty); L.push(`  __get_item${accessorCode(ix.d.get, ix.ty, false, ix.params, 1)}`) }
      if (ix.d.set) { ctx = newCtx(c, false, VOID); L.push(`  __set_item${accessorCode(ix.d.set, ix.ty, true, ix.params, 1)}`) }
    }
    for (const ms of c.methods.values()) for (const m of ms) {
      const d = m.d as MethodDecl;
      if (!d.body && !d.expr) {
        if (!d.mods.has('abstract') && !d.mods.has('extern') && !d.mods.has('partial') && c.kind !== 'interface') err(d.pos, `'${c.name}.${d.name}' must declare a body because it is not marked abstract`);
        continue;
      }
      ctx = newCtx(c, m.isStatic, m.sig.ret);
      ctx.tnames = new Set([...c.tparams, ...d.tparams]);
      L.push(`  ${m.isStatic ? 'static ' : ''}${m.js}${fnCode(m.sig.params, d.body, d.expr, 1).join(' ')}`);
    }
    if (c.kind === 'struct') {
      const cp = fieldList.filter(f => !f.isStatic && f.kind !== 'prop').map(f => `o.${f.name} = ${isStruct(f.ty) ? `__cl(this.${f.name})` : `this.${f.name}`};`);
      L.push(`  __clone() { const o = new ${c.js}(__nc); ${cp.join(' ')} return o }`);
    }
    L.push('}');
    ctx = newCtx(null, true);
    return L.join('\n') + '\n';
  }

  // ── program ──
  const out: string[] = [PRELUDE];
  for (const en of enums.values()) {
    const v = Object.fromEntries(en.vals), n: Record<number, string> = {};
    for (const [k, x] of en.vals) if (!(x in n)) n[x] = k;
    out.push(`const ${en.js} = Object.freeze({ __v: ${JSON.stringify(v)}, __n: ${JSON.stringify(n)} });`);
  }
  const infos: NtClassInfo[] = [];
  const order: ClassInfo[] = [], seen = new Set<ClassInfo>();
  const visit = (c: ClassInfo) => { if (seen.has(c)) return; seen.add(c); if (c.base) visit(c.base); order.push(c) };
  allClasses.forEach(visit);
  const emitted: ClassInfo[] = [];
  for (const c of order) {
    if (c.kind === 'interface') continue;
    const root = rootRt(c);
    const info: NtClassInfo = { name: c.name, base: c.base?.name ?? c.baseRt, kind: root === 'Indicator' ? 'indicator' : root === 'Strategy' ? 'strategy' : 'other', inputs: inputsOf(c) };
    if (c.kind === 'class') infos.push(info);
    out.push(emitClass(c, info));
    emitted.push(c);
  }
  out.push(`return { ${emitted.map(c => c.js === c.name ? c.name : `${JSON.stringify(c.name)}: ${c.js}`).join(', ')} };`);
  return { js: out.join('\n'), classes: infos };
}
