// MQL AST → JS function body (see contract.ts "Generated code conventions"). Types are tracked just enough for MQL
// semantics: integer truncation/division, value-type struct copies, overload resolution, Ref params and struct members.
import type { Diagnostic, Dialect, OutParams } from '../contract.ts';
import type { Expr, Stmt, Decl, TypeRef, VarDecl, FuncDecl, ClassDecl, EnumDecl, Pos, Param } from './ast.ts';
import type { PropVal } from './preprocess.ts';
import { PRIMS } from './parser.ts';

type Kind = 'int' | 'float' | 'bool' | 'string' | 'void' | 'any' | 'obj' | 'arr' | 'fn' | 'null';
interface Ty { k: Kind; n: string; ptr?: boolean; el?: Ty; dims?: number; sig?: Sig; cls?: ClassInfo }
interface PInfo { name: string; ty: Ty; ref: boolean; def: Expr | null }
interface Sig { params: PInfo[]; ret: Ty }
interface FnDef { d: FuncDecl; js: string; sig: Sig; min: number; cls: ClassInfo | null; key: string }
interface Field { ty: Ty; isStatic: boolean; d: VarDecl; owner: ClassInfo }
interface ClassInfo { name: string; js: string; d: ClassDecl; base: ClassInfo | null; baseRt: string; fields: Map<string, Field>; methods: Map<string, FnDef[]>; ctors: FnDef[]; dtor: FnDef | null }
interface Sym { js: string; ty: Ty; ref: boolean }
interface R { c: string; ty: Ty }
interface LV { get: string; set: (v: string) => string; ty: Ty; pre: string[]; refVar?: string; plain: boolean }
interface Ctx { fn: FnDef | null; cls: ClassInfo | null; isStatic: boolean; ctor: boolean; temps: string[]; name: string; used: Set<string>; scopes: Map<string, Sym>[]; tnames: Set<string> }

export interface GenOptions { dialect: Dialect; outParams: OutParams; builtinStructs: string[]; builtinClasses: string[]; props: Record<string, PropVal> }

const INTS = new Set(['char', 'uchar', 'short', 'ushort', 'int', 'uint', 'long', 'ulong', 'datetime', 'color']);
const RESERVED = new Set(('arguments await break case catch class const continue debugger default delete do else enum eval export extends false finally for ' +
  'function if implements import in instanceof interface let new null package private protected public return static super switch this throw true try ' +
  'typeof var void while with yield undefined NaN Infinity rt MqlArray ref MqlError Math Object Number String Array Date JSON Symbol Map Set Error ' +
  'Boolean Function constructor prototype globalThis').split(' '));
const HANDLERS = ['OnInit', 'OnDeinit', 'OnTick', 'OnCalculate', 'OnStart', 'OnTimer', 'OnTrade', 'OnTradeTransaction', 'OnChartEvent', 'OnTester', 'OnBookEvent', 'init', 'deinit', 'start'];
// Result types of common runtime names (only integer/datetime/string-ness matters to codegen).
const RT_TY: Record<string, string> = {};
for (const n of ('Bars Digits _Digits _Period Period _LastError GetLastError OrdersTotal OrdersHistoryTotal PositionsTotal HistoryDealsTotal HistoryOrdersTotal ' +
  'ArraySize ArrayRange ArrayResize ArrayMaximum ArrayMinimum ArrayBsearch ArrayCopy StringLen StringFind StringReplace StringSplit iBars iBarShift iHighest iLowest ' +
  'OrderTicket OrderType OrderMagicNumber OrderSend Hour Minute Seconds Day DayOfWeek DayOfYear Month Year TimeHour TimeMinute TimeDay TimeDayOfWeek ' +
  'TimeDayOfYear TimeMonth TimeYear TimeSeconds MathRand CopyBuffer CopyRates CopyClose CopyOpen CopyHigh CopyLow CopyTime CopyTickVolume IndicatorCounted ' +
  'StringGetCharacter StringGetChar SymbolsTotal ObjectsTotal AccountNumber UninitializeReason INVALID_HANDLE').split(' ')) RT_TY[n] = 'int';
for (const n of 'StringToInteger StrToInteger ChartID AccountInfoInteger SymbolInfoInteger PositionGetInteger OrderGetInteger HistoryDealGetInteger HistoryOrderGetInteger PositionGetTicket OrderGetTicket HistoryDealGetTicket HistoryOrderGetTicket GetTickCount GetMicrosecondCount'.split(' ')) RT_TY[n] = 'long';
for (const n of 'TimeCurrent TimeLocal TimeGMT TimeTradeServer iTime StringToTime StrToTime OrderOpenTime OrderCloseTime OrderExpiration'.split(' ')) RT_TY[n] = 'datetime';
for (const n of 'Symbol _Symbol OrderSymbol OrderComment AccountCurrency AccountName AccountServer AccountCompany TerminalName DoubleToString DoubleToStr IntegerToString TimeToString TimeToStr StringSubstr StringFormat StringConcatenate CharToString CharToStr ShortToString StringTrimLeft StringTrimRight EnumToString ErrorDescription'.split(' ')) RT_TY[n] = 'string';
const SERIES: Record<string, string> = { Open: 'double', High: 'double', Low: 'double', Close: 'double', Time: 'datetime', Volume: 'long' };
const SIZES: Record<string, number> = { bool: 1, char: 1, uchar: 1, short: 2, ushort: 2, int: 4, uint: 4, color: 4, float: 4, long: 8, ulong: 8, datetime: 8, double: 8, string: 12 };

const PRELUDE = `'use strict';
// Loop budget: a runaway loop (while(true), a bad step) ends the run with an error instead of freezing the tab. Counted over the whole run.
let __n = 0;
const __t = () => { if (++__n > 3e8) throw new Error('Script stopped: loop budget exceeded (an endless loop?)'); return true };
const __i64 = x => Math.trunc(x) || 0;
const __s = x => x == null ? '' : String(x);
const __div = (a, b) => { if (b == 0) throw new MqlError('zero divide', 4013); return Math.trunc(a / b) };
const __mod = (a, b) => { if (b == 0) throw new MqlError('zero divide', 4013); return a % b };
const __cp = (d, s) => Object.assign(d, rt.__copy ? rt.__copy(s) : s);
const __cl = x => x == null || typeof x !== 'object' ? x : x.__clone ? x.__clone() : rt.__copy ? rt.__copy(x) : Object.assign(Object.create(Object.getPrototypeOf(x)), x);
const __del = o => { if (o != null && !o.__dead) { if (o.__dtor) o.__dtor(); o.__dead = true } };
const __dyn = (o, C) => o instanceof C ? o : null;
const __ai = (a, v) => { for (let i = 0; i < v.length; i++) Array.isArray(v[i]) ? __ai(a.get(i), v[i]) : a.set(i, v[i]); return a };
const __p2 = x => (x < 10 ? '0' : '') + x;
const __dts = t => { const d = new Date(t * 1000); return d.getUTCFullYear() + '.' + __p2(d.getUTCMonth() + 1) + '.' + __p2(d.getUTCDate()) + ' ' + __p2(d.getUTCHours()) + ':' + __p2(d.getUTCMinutes()) + ':' + __p2(d.getUTCSeconds()) };
class __NA extends MqlArray {
  constructor(n, mk, fixed) { super(0, null, fixed); this.mk = mk; while (this.data.length < n) this.data.push(mk()) }
  resize(n) { if (this.fixed) return -1; if (n < this.data.length) this.data.length = Math.max(0, n); else while (this.data.length < n) this.data.push(this.mk()); return this.data.length }
}
let __ready = false;
const __h = (f, n) => { const w = (...a) => { if (!__ready) { __ready = true; __init() } return f(...a) }; Object.defineProperty(w, 'length', { value: n }); return w };
`;

const T = (k: Kind, n = k as string, extra: Partial<Ty> = {}): Ty => ({ k, n, ...extra });
const ANY = T('any'), INT = T('int'), FLOAT = T('float', 'double'), BOOL = T('bool'), STR = T('string'), VOID = T('void'), NULLT = T('null');
const safe = (n: string) => RESERVED.has(n) || n.startsWith('__') ? '$' + n : n;
const num = (t: Ty) => t.k === 'int' || t.k === 'float' || t.k === 'bool';
/** JS method name for an MQL method: operator+ → __op_43 (char codes), others unchanged. */
const mname = (n: string) => n.startsWith('operator') ? '__op_' + [...n.slice(8)].map(c => c.charCodeAt(0)).join('_') : n;
const tyName = (t: Ty): string => t.k === 'arr' ? tyName(t.el!) + '[]'.repeat(t.dims!) : t.n;

export function generate(decls: Decl[], o: GenOptions, errors: Diagnostic[], warnings: Diagnostic[]): string {
  const bStructs = new Set(o.builtinStructs), bClasses = new Set(o.builtinClasses);
  const classes = new Map<string, ClassInfo>(), enums = new Map<string, EnumDecl>(), typedefs = new Map<string, Ty>();
  const funcs = new Map<string, FnDef[]>(), globals = new Map<string, Sym>();
  const warned = new Set<string>();
  const err = (p: Pos, msg: string) => errors.push({ file: p.file, line: p.line, col: p.col, msg });
  const warn = (p: Pos, msg: string) => { const k = `${p.file}:${p.line}:${msg}`; if (!warned.has(k)) { warned.add(k); warnings.push({ file: p.file, line: p.line, col: p.col, msg }) } };
  const mod: Ctx = { fn: null, cls: null, isStatic: false, ctor: false, temps: [], name: '', used: new Set(), scopes: [], tnames: new Set() };
  let ctx = mod;
  const tmp = () => { const t = `__t${ctx.temps.length + 1}`; ctx.temps.push(t); return t };
  const staticLets: string[] = [], staticInits: string[] = [];
  let nStatic = 0;

  // ── types ──
  function resolve(t: TypeRef, dims = 0): Ty {
    let b: Ty;
    const n = t.name;
    if (ctx.tnames.has(n)) b = ANY;
    else if (PRIMS.has(n)) b = n === 'bool' ? BOOL : n === 'string' ? STR : n === 'void' ? VOID : n === 'float' || n === 'double' ? T('float', n) : T('int', n);
    else if (enums.has(n) || n.startsWith('ENUM_')) b = T('int', n);
    else if (typedefs.has(n)) b = typedefs.get(n)!;
    else if (classes.has(n)) b = T('obj', n, { cls: classes.get(n), ptr: t.ptr });
    else if (bStructs.has(n) || bClasses.has(n)) b = T('obj', n, { ptr: t.ptr });
    else { warn(t.pos, `Unknown type '${n}' (assumed to be a runtime class)`); b = T('obj', n, { ptr: t.ptr }) }
    if (t.ptr && b.k !== 'obj' && b.k !== 'any') err(t.pos, `Pointers are only supported to classes and structs, not '${n}'`);
    return dims ? T('arr', 'array', { el: b, dims }) : b;
  }
  const valueObj = (t: Ty) => t.k === 'obj' && !t.ptr && (!!t.cls || bStructs.has(t.n));
  const derives = (a: ClassInfo | undefined, b: ClassInfo | undefined) => { for (let c = a ?? null; c; c = c.base) if (c === b) return true; return false };
  const intWrap = (c: string, n: string) => n === 'uint' ? `(${c} >>> 0)` : n === 'char' ? `(${c} << 24 >> 24)` : n === 'uchar' ? `(${c} & 255)`
    : n === 'short' ? `(${c} << 16 >> 16)` : n === 'ushort' ? `(${c} & 65535)` : n === 'long' || n === 'ulong' || n === 'datetime' || n === 'color' ? `__i64(${c})` : `(${c} | 0)`;
  const foldInt = (v: number, n: string) => n === 'uint' ? v >>> 0 : n === 'char' ? v << 24 >> 24 : n === 'uchar' ? v & 255 : n === 'short' ? v << 16 >> 16 : n === 'ushort' ? v & 65535 : v | 0;
  const isIntLit = (c: string) => /^-?\d+$/.test(c);
  function conv(r: R, to: Ty): string {
    const f = r.ty, c = r.c;
    switch (to.k) {
      case 'int':
        if (f.k === 'null') return '0';
        const wide = !INTS.has(to.n) || to.n === 'int' || to.n === 'long' || to.n === 'datetime' || to.n === 'color';
        if (isIntLit(c)) return ['long', 'ulong', 'datetime', 'color'].includes(to.n) ? c : String(foldInt(+c, to.n));   // constant-fold narrow integer literals
        if (f.k === 'int' && (wide || f.n === to.n)) return c;
        if (f.k === 'bool') return `(+${c})`;
        return intWrap(c, INTS.has(to.n) ? to.n : 'int');
      case 'float': return f.k === 'bool' ? `(+${c})` : f.k === 'string' ? `Number(${c})` : f.k === 'null' ? '0' : c;
      case 'bool': return f.k === 'bool' ? c : `!!(${c})`;
      case 'string': return f.k === 'string' ? c : f.k === 'null' ? '""' : f.n === 'datetime' ? `__dts(${c})` : num(f) ? `String(${c})` : `__s(${c})`;
      default: return c;
    }
  }
  function defaultVal(t: Ty, p: Pos): string {
    switch (t.k) {
      case 'int': case 'float': case 'any': return '0';
      case 'bool': return 'false';
      case 'string': return '""';
      case 'obj': return t.ptr ? 'null' : construct(t, [], p);
      case 'arr': return mkArr(t.el!, Array(t.dims).fill(null), p);
      default: return 'null';
    }
  }
  function mkArr(el: Ty, sizes: (string | null)[], p: Pos): string {
    const [s, ...rest] = sizes, fixed = s != null;
    if (rest.length) return `new __NA(${s ?? 0}, () => ${mkArr(el, rest, p)}, ${fixed})`;
    if (el.k === 'obj' && !el.ptr) return `new __NA(${s ?? 0}, () => ${defaultVal(el, p)}, ${fixed})`;
    return `new MqlArray(${s ?? 0}, ${el.k === 'obj' || el.k === 'fn' ? 'null' : defaultVal(el, p)}, ${fixed})`;
  }
  function sizeOf(t: Ty): number {
    if (t.k === 'arr') return 0;
    if (t.k === 'obj') return t.ptr ? 8 : t.cls ? [...allFields(t.cls)].reduce((s, f) => s + sizeOf(f.ty), 0) : 0;
    return SIZES[t.n] ?? (t.k === 'int' ? 4 : 8);
  }
  function* allFields(c: ClassInfo): Generator<Field> {
    if (c.base) yield* allFields(c.base);
    for (const f of c.fields.values()) if (!f.isStatic) yield f;
  }
  const findField = (c: ClassInfo, n: string): Field | undefined => { for (let k: ClassInfo | null = c; k; k = k.base) { const f = k.fields.get(n); if (f) return f } };
  function findMethods(c: ClassInfo, n: string): FnDef[] {
    const out: FnDef[] = [], keys = new Set<string>();
    for (let k: ClassInfo | null = c; k; k = k.base) for (const m of k.methods.get(n) ?? []) if (!keys.has(m.key)) { keys.add(m.key); out.push(m) }
    return out;
  }
  const paramKey = (ps: Param[]) => ps.map(p => (p.t.name + (p.dims ? 'A'.repeat(p.dims) : '') + (p.t.ptr ? 'P' : '')).replace(/\W/g, '_')).join('_');

  // ── collect ──
  for (const d of decls) {
    if (d.k === 'class') {
      const ex = classes.get(d.name);
      if (ex && !ex.d.fwd && !d.fwd) err(d.pos, `'${d.name}' is already defined`);
      if (!ex) classes.set(d.name, { name: d.name, js: safe(d.name), d, base: null, baseRt: '', fields: new Map(), methods: new Map(), ctors: [], dtor: null });
      else if (!d.fwd) ex.d = d;
    } else if (d.k === 'enum') { if (d.name) enums.set(d.name, d) }
  }
  for (const d of decls) if (d.k === 'typedef') {
    if (d.fn) {
      const fn = d.fn;
      typedefs.set(d.name, T('fn', d.name, { sig: { params: fn.params.map(p => ({ name: p.name, ty: resolve(p.t, p.dims), ref: false, def: p.def })), ret: resolve(fn.ret) } }));
    } else typedefs.set(d.name, resolve(d.t!));
  }
  const outOfClass: FuncDecl[] = [], freeFns: FuncDecl[] = [];
  for (const d of decls) if (d.k === 'func') (d.cls ? outOfClass : freeFns).push(d);
  // method signatures with out-of-class bodies merged into their prototypes
  const mergeProto = (list: FuncDecl[], def: FuncDecl): boolean => {
    const k = paramKey(def.params), j = list.findIndex(m => m.name === def.name && paramKey(m.params) === k);
    if (j < 0) return false;
    const p = list[j];
    if (p.body && def.body) { err(def.pos, `'${def.name}' is already defined`); return true }
    if (!def.body) return true;
    list[j] = { ...def, isStatic: p.isStatic, isVirtual: p.isVirtual, tparams: p.tparams.length ? p.tparams : def.tparams, params: def.params.map((q, n) => ({ ...q, def: q.def ?? p.params[n]?.def ?? null })) };
    return true;
  };
  for (const def of outOfClass) {
    const c = classes.get(def.cls);
    if (!c || c.d.fwd) { err(def.pos, `'${def.cls}' is not a class or struct`); continue }
    if (!mergeProto(c.d.methods, def)) err(def.pos, `'${def.name}' is not declared in '${def.cls}'`);
  }
  const fnList: FuncDecl[] = [];
  for (const d of freeFns) if (!mergeProto(fnList, d)) fnList.push(d);
  // mangling: names with several distinct signatures get a signature suffix
  const sigCount = (list: FuncDecl[]) => { const m = new Map<string, Set<string>>(); for (const f of list) { if (!m.has(f.name)) m.set(f.name, new Set()); m.get(f.name)!.add(paramKey(f.params)) } return m };
  const freeSigs = sigCount(fnList), methSigs = sigCount([...classes.values()].flatMap(c => c.d.methods.filter(m => m.kind === 'fn')));
  const mkSig = (d: FuncDecl, cls: ClassInfo | null): Sig => {
    const save = ctx.tnames;
    ctx.tnames = new Set([...(cls?.d.tparams ?? []), ...d.tparams]);
    const params = d.params.map(p => {
      const ty = resolve(p.t, p.dims);
      return { name: p.name, ty, def: p.def, ref: p.t.ref && !p.t.isConst && !p.dims && (num(ty) || ty.k === 'string' || ty.k === 'any') };
    });
    const ret = d.kind === 'fn' ? resolve(d.ret) : VOID;
    ctx.tnames = save;
    return { params, ret };
  };
  const mkDef = (d: FuncDecl, cls: ClassInfo | null, js: string): FnDef => {
    const sig = mkSig(d, cls), k = d.params.findIndex(p => p.def);
    return { d, js, sig, min: k < 0 ? d.params.length : k, cls, key: paramKey(d.params) };
  };
  for (const d of fnList) {
    const js = (freeSigs.get(d.name)!.size > 1 ? `${d.name}__${paramKey(d.params) || 'v'}` : safe(d.name));
    if (!funcs.has(d.name)) funcs.set(d.name, []);
    funcs.get(d.name)!.push(mkDef(d, null, js));
  }
  for (const c of classes.values()) {
    if (c.d.fwd) { err(c.d.pos, `'${c.name}' is declared but never defined`); continue }
    if (c.d.base) {
      const b = classes.get(c.d.base);
      if (b) { c.base = b; if (derives(b, c)) { err(c.d.pos, `Circular inheritance for '${c.name}'`); c.base = null } }
      else { c.baseRt = c.d.base; if (!bClasses.has(c.d.base) && !bStructs.has(c.d.base)) warn(c.d.pos, `Unknown base class '${c.d.base}' (assumed to be a runtime class)`) }
    }
    ctx.tnames = new Set(c.d.tparams);
    for (const f of c.d.fields) {
      if (c.fields.has(f.name)) err(f.pos, `Member '${f.name}' is already declared in '${c.name}'`);
      c.fields.set(f.name, { ty: resolve(f.t, f.dims.length), isStatic: f.storage === 'static', d: f, owner: c });
    }
    ctx.tnames = new Set();
    for (const m of c.d.methods) {
      if (m.kind === 'ctor') c.ctors.push(mkDef(m, c, m.params.length ? `__c_${paramKey(m.params)}` : '__c'));
      else if (m.kind === 'dtor') c.dtor = mkDef(m, c, '__dtor');
      else {
        const js = methSigs.get(m.name)!.size > 1 ? `${mname(m.name)}__${paramKey(m.params) || 'v'}` : mname(m.name);
        if (!c.methods.has(m.name)) c.methods.set(m.name, []);
        c.methods.get(m.name)!.push(mkDef(m, c, js));
      }
    }
  }
  for (const d of decls) {
    if (d.k === 'enum') for (const it of d.items) {
      if (globals.has(it.name)) err(it.pos, `'${it.name}' is already defined`);
      globals.set(it.name, { js: safe(it.name), ty: T('int', d.name || 'int'), ref: false });
    }
    if (d.k === 'vars') for (const v of d.list) {
      if (v.cls) continue;
      if (globals.has(v.name)) err(v.pos, `Global '${v.name}' is already defined`);
      globals.set(v.name, { js: safe(v.name), ty: resolve(v.t, v.dims.length), ref: false });
    }
  }

  // ── lookup ──
  function lookupLocal(n: string): Sym | undefined {
    for (let k = ctx.scopes.length - 1; k >= 0; k--) { const s = ctx.scopes[k].get(n); if (s) return s }
  }
  function declareLocal(n: string, ty: Ty, p: Pos, ref = false, js?: string): Sym {
    const top = ctx.scopes[ctx.scopes.length - 1];
    if (top.has(n)) err(p, `'${n}' is already declared in this scope`);
    let name = js;
    if (!name) { name = safe(n); for (let k = 1; ctx.used.has(name); k++) name = `${safe(n)}_${k}` }
    ctx.used.add(name);
    const s = { js: name, ty, ref };
    top.set(n, s);
    return s;
  }

  // ── overloads & calls ──
  function score(a: Ty, p: Ty): number {
    if (p.k === 'any' || a.k === 'any') return 1;
    if (a.k === 'null') return p.k === 'obj' || p.k === 'string' || p.k === 'fn' || p.k === 'arr' ? 2 : 1;
    if (num(a) && num(p)) return a.k === p.k ? (a.n === p.n ? 4 : 3) : a.k === 'int' && p.k === 'float' ? 2 : 1;
    if (a.k === p.k) {
      if (a.k === 'obj') return a.n === p.n ? 4 : derives(a.cls, p.cls) ? 3 : -50;
      if (a.k === 'arr') return a.dims === p.dims ? 2 + score(a.el!, p.el!) / 4 : -50;
      return 4;
    }
    if ((a.k === 'string' && num(p)) || (num(a) && p.k === 'string')) return 0;
    return -100;
  }
  function pick(defs: FnDef[], args: Expr[], name: string, p: Pos): FnDef {
    const cands = defs.filter(d => args.length >= d.min && args.length <= d.sig.params.length);
    if (!cands.length) {
      if (defs.length === 1) {
        const d = defs[0], n = d.sig.params.length;
        err(p, `'${name}' expects ${d.min === n ? n : `${d.min} to ${n}`} argument(s) but got ${args.length}`);
      } else err(p, `No overload of '${name}' takes ${args.length} argument(s)`);
      return defs[0];
    }
    if (cands.length === 1) return cands[0];
    const tys = args.map(a => peekTy(a));
    let best = cands[0], bs = -Infinity;
    for (const d of cands) {
      const s = tys.reduce((acc, t, k) => acc + score(t, d.sig.params[k].ty), 0) - (d.sig.params.length - args.length) * 0.1;
      if (s > bs) { bs = s; best = d }
    }
    return best;
  }
  function peekTy(e: Expr): Ty {   // type of an expression without keeping its code (diagnostics are de-duplicated later)
    const n = errors.length, t = ctx.temps.length;
    const ty = ex(e).ty;
    errors.length = n; ctx.temps.length = t;
    return ty;
  }
  // arguments for a parameter list: conversions, Ref boxing with write-back
  function callWith(params: PInfo[], args: Expr[], mk: (list: string[]) => string, ret: Ty): R {
    const pre: string[] = [], post: string[] = [], list: string[] = [];
    args.forEach((a, k) => {
      const p = params[k];
      if (!p) { list.push(ex(a).c); return }
      if (p.ref) {
        const lv = lval(a, true);
        if (lv?.refVar) list.push(lv.refVar);
        else if (lv) {
          const t = tmp();
          pre.push(...lv.pre, `${t} = ref(${lv.get})`);
          list.push(t);
          post.push(lv.set(conv({ c: `${t}.v`, ty: p.ty }, lv.ty)));
        } else list.push(`ref(${ex(a).c})`);
      } else if (p.ty.k === 'fn') list.push(fnValue(a, p.ty));
      else list.push(conv(ex(a, p.ty), p.ty));
    });
    const call = mk(list);
    if (!pre.length) return { c: call, ty: ret };
    const r = tmp();
    return { c: `(${[...pre, `${r} = ${call}`, ...post, r].join(', ')})`, ty: ret };
  }
  function callRt(name: string, target: string, args: Expr[]): R {
    const outs = o.outParams[`${name}/${args.length}`] ?? [];
    const pre: string[] = [], post: string[] = [], list: string[] = [];
    const fmt = name === 'Print' || name === 'Alert' || name === 'Comment' || name === 'StringConcatenate';
    args.forEach((a, k) => {
      if (outs.includes(k)) {
        const lv = lval(a, true);
        if (lv && lv.ty.k !== 'arr' && lv.ty.k !== 'obj') {
          if (lv.refVar) { list.push(lv.refVar); return }
          const t = tmp();
          pre.push(...lv.pre, `${t} = ref(${lv.get})`);
          list.push(t);
          post.push(lv.set(conv({ c: `${t}.v`, ty: ANY }, lv.ty)));
          return;
        }
      }
      const r = ex(a);
      list.push(fmt && r.ty.n === 'datetime' ? `__dts(${r.c})` : r.c);
    });
    const ty = RT_TY[name] ? (RT_TY[name] === 'string' ? STR : T('int', RT_TY[name])) : ANY;
    const call = `${target}(${list.join(', ')})`;
    if (!pre.length) return { c: call, ty };
    const r = tmp();
    return { c: `(${[...pre, `${r} = ${call}`, ...post, r].join(', ')})`, ty };
  }
  function fnValue(e: Expr, want: Ty): string {
    if (e.k === 'unary' && e.op === '&') return fnValue(e.e, want);
    if (e.k === 'id' && !lookupLocal(e.name) && !globals.has(e.name) && funcs.has(e.name)) {
      const defs = funcs.get(e.name)!, n = want.sig?.params.length ?? 0;
      const d = defs.find(x => x.sig.params.length === n) ?? defs[0];
      if (d.sig.params.length !== n) err(e.pos, `'${e.name}' does not match function type '${want.n}'`);
      return d.js;
    }
    return ex(e).c;
  }
  function construct(t: Ty, args: Expr[], p: Pos): string {
    const c = t.cls;
    if (!c) return `new rt.${t.n}(${args.map(a => ex(a).c).join(', ')})`;
    if (c.d.kind === 'interface') { err(p, `Cannot create an instance of interface '${c.name}'`); return 'null' }
    if (!c.ctors.length || (!args.length && !c.ctors.some(k => k.min === 0))) {
      if (args.length) err(p, `'${c.name}' has no constructor taking ${args.length} argument(s)`);
      return `new ${c.js}().__c()`;
    }
    const d = pick(c.ctors, args, c.name, p);
    return callWith(d.sig.params, args, l => `new ${c.js}().${d.js}(${l.join(', ')})`, t).c;
  }
  const defaultCtor = (c: ClassInfo) => c.ctors.find(k => k.min === 0)?.js ?? '__c';
  function callUser(defs: FnDef[], args: Expr[], name: string, p: Pos, self: string | null): R {
    const d = pick(defs, args, name, p);
    const target = d.d.isStatic || !d.cls ? (d.cls ? `${d.cls.js}.${d.js}` : d.js) : `${self ?? 'this'}.${d.js}`;
    return callWith(d.sig.params, args, l => `${target}(${l.join(', ')})`, d.sig.ret);
  }
  function call(e: Expr & { k: 'call' }): R {
    const f = e.fn, args = e.args;
    if (f.k === 'id') {
      const n = f.name;
      const local = lookupLocal(n) ?? (ctx.cls ? undefined : globals.get(n));
      if (local) {
        if (local.ty.k === 'fn' && local.ty.sig) return callWith(local.ty.sig.params, args, l => `${local.js}(${l.join(', ')})`, local.ty.sig.ret);
        return { c: `${local.js}(${args.map(a => ex(a).c).join(', ')})`, ty: ANY };
      }
      if (ctx.cls) {
        const ms = findMethods(ctx.cls, n);
        if (ms.length) {
          const d = pick(ms, args, n, e.pos);
          if (!d.d.isStatic && ctx.isStatic) err(e.pos, `Cannot call non-static method '${n}' from a static method`);
          return callUser([d], args, n, e.pos, null);
        }
        const fld = findField(ctx.cls, n);
        if (fld?.ty.k === 'fn' && fld.ty.sig) { const s = fld.ty.sig; return callWith(s.params, args, l => `${fld.isStatic ? fld.owner.js : 'this'}.${n}(${l.join(', ')})`, s.ret) }
        const g = globals.get(n);
        if (g?.ty.k === 'fn' && g.ty.sig) { const s = g.ty.sig; return callWith(s.params, args, l => `${g.js}(${l.join(', ')})`, s.ret) }
      }
      if (funcs.has(n)) return callUser(funcs.get(n)!, args, n, e.pos, null);
      if (n === 'GetPointer' && args.length === 1) return ex(args[0]);
      if (n === 'typename' && args.length === 1) return { c: JSON.stringify(tyName(peekTy(args[0]))), ty: STR };
      if (n === 'EnumToString' && args.length === 1) {
        const a = ex(args[0]);
        if (enums.has(a.ty.n)) return { c: `(__en_${a.ty.n}.get(${a.c}) ?? String(${a.c}))`, ty: STR };
      }
      return callRt(n, `rt.${n}`, args);
    }
    if (f.k === 'member') {
      const ob = ex(f.e);
      if (ob.ty.k === 'obj' && ob.ty.cls) {
        const ms = findMethods(ob.ty.cls, f.name);
        if (ms.length) return callUser(ms, args, f.name, f.pos, ob.c);
        const fld = findField(ob.ty.cls, f.name);
        if (fld?.ty.k === 'fn' && fld.ty.sig) { const s = fld.ty.sig; return callWith(s.params, args, l => `${ob.c}.${f.name}(${l.join(', ')})`, s.ret) }
        if (!ob.ty.cls.baseRt) { err(f.pos, `'${f.name}' is not a method of '${ob.ty.cls.name}'`); return { c: 'undefined', ty: ANY } }
      }
      return callRt(`${ob.ty.n}::${f.name}`, `${ob.c}.${f.name}`, args);
    }
    if (f.k === 'scope') {
      if (!f.cls) {
        if (funcs.has(f.name)) return callUser(funcs.get(f.name)!, args, f.name, f.pos, null);
        return callRt(f.name, `rt.${f.name}`, args);
      }
      const c = classes.get(f.cls);
      if (c) {
        const ms = findMethods(c, f.name);
        if (!ms.length) { err(f.pos, `'${f.name}' is not a method of '${c.name}'`); return { c: 'undefined', ty: ANY } }
        const d = pick(ms, args, f.name, f.pos);
        if (d.d.isStatic) return callUser([d], args, f.name, f.pos, null);
        if (!ctx.cls || ctx.isStatic) err(f.pos, `Cannot call non-static method '${c.name}::${f.name}' without an object`);
        return callWith(d.sig.params, args, l => `${d.cls!.js}.prototype.${d.js}.call(${['this', ...l].join(', ')})`, d.sig.ret);
      }
      return callRt(`${f.cls}::${f.name}`, `rt.${f.cls}.${f.name}`, args);
    }
    const fr = ex(f);
    if (fr.ty.k === 'fn' && fr.ty.sig) { const s = fr.ty.sig; return callWith(s.params, args, l => `${fr.c}(${l.join(', ')})`, s.ret) }
    return { c: `${fr.c}(${args.map(a => ex(a).c).join(', ')})`, ty: ANY };
  }

  // ── operator overloading: a method 'operator<op>' of the left operand's class taking args.length parameters ──
  function opMethods(t: Ty, op: string, n: number): FnDef[] {
    if (t.k !== 'obj' || !t.cls) return [];
    return findMethods(t.cls, 'operator' + op).filter(m => n >= m.min && n <= m.sig.params.length);
  }
  function opCall(self: R, op: string, args: Expr[], p: Pos): R | null {
    const ms = opMethods(self.ty, op, args.length);
    return ms.length ? callUser(ms, args, 'operator' + op, p, self.c) : null;
  }

  // ── lvalues ──
  function lval(e: Expr, reuse: boolean): LV | null {
    switch (e.k) {
      case 'id': {
        const s = lookupLocal(e.name);
        if (s) return s.ref ? { get: `${s.js}.v`, set: v => `${s.js}.v = ${v}`, ty: s.ty, pre: [], refVar: s.js, plain: true }
          : { get: s.js, set: v => `${s.js} = ${v}`, ty: s.ty, pre: [], plain: true };
        if (ctx.cls) {
          const f = findField(ctx.cls, e.name);
          if (f) {
            if (!f.isStatic && ctx.isStatic) err(e.pos, `Cannot access non-static member '${e.name}' from a static method`);
            const g = f.isStatic ? `${f.owner.js}.${e.name}` : `this.${e.name}`;
            return { get: g, set: v => `${g} = ${v}`, ty: f.ty, pre: [], plain: true };
          }
        }
        const g = globals.get(e.name);
        if (g) return { get: g.js, set: v => `${g.js} = ${v}`, ty: g.ty, pre: [], plain: true };
        if (funcs.has(e.name)) return null;
        const r = `rt.${e.name}`;
        return { get: r, set: v => `${r} = ${v}`, ty: rtTy(e.name), pre: [], plain: true };
      }
      case 'member': {
        const r = ex(e);
        if (r.c === 'undefined') return null;
        return { get: r.c, set: v => `${r.c} = ${v}`, ty: r.ty, pre: [], plain: true };
      }
      case 'scope': {
        const r = ex(e);
        return { get: r.c, set: v => `${r.c} = ${v}`, ty: r.ty, pre: [], plain: true };
      }
      case 'index': {
        const b = ex(e.e), ix = index(e.i);
        const ty = elemTy(b.ty);
        if (!reuse || /^[\w$.]+$/.test(ix)) return { get: `${b.c}.get(${ix})`, set: v => `${b.c}.set(${ix}, ${v})`, ty, pre: [], plain: false };
        const t = tmp();
        return { get: `${b.c}.get(${t})`, set: v => `${b.c}.set(${t}, ${v})`, ty, pre: [`${t} = ${ix}`], plain: false };
      }
      case 'unary': return e.op === '*' ? lval(e.e, reuse) : null;
      default: return null;
    }
  }
  const elemTy = (t: Ty): Ty => t.k === 'arr' ? (t.dims! > 1 ? { ...t, dims: t.dims! - 1 } : t.el!) : ANY;
  const rtTy = (n: string): Ty => SERIES[n] ? T('arr', 'array', { el: SERIES[n] === 'double' ? FLOAT : T('int', SERIES[n]), dims: 1 })
    : RT_TY[n] ? (RT_TY[n] === 'string' ? STR : T('int', RT_TY[n])) : ANY;
  function index(e: Expr): string {
    const r = ex(e);
    return r.ty.k === 'float' ? `(${r.c} | 0)` : r.c;
  }
  const seq = (pre: string[], c: string) => pre.length ? `(${[...pre, c].join(', ')})` : c;

  function assignTo(lv: LV, b: Expr, p: Pos): string {
    if (lv.ty.k === 'arr') { err(p, 'Arrays cannot be assigned; use ArrayCopy'); return 'undefined' }
    if (valueObj(lv.ty)) {
      const v = b.k === 'init' ? initValue(lv.ty, b) : ex(b, lv.ty).c;
      return lv.ty.cls ? `${lv.get}.__set(${v})` : `__cp(${lv.get}, ${v})`;
    }
    if (lv.ty.k === 'fn') return lv.set(fnValue(b, lv.ty));
    return lv.set(conv(ex(b, lv.ty), lv.ty));
  }
  function initValue(t: Ty, e: Expr): string {   // value for an initializer list / expression of type t
    if (e.k !== 'init') {
      if (valueObj(t)) { const r = ex(e, t); return t.cls ? `${r.c}.__clone()` : `__cl(${r.c})` }
      if (t.k === 'fn') return fnValue(e, t);
      return conv(ex(e, t), t);
    }
    if (t.k === 'obj' && t.cls) {
      const fs = [...allFields(t.cls)];
      if (e.list.length > fs.length) err(e.pos, `Too many initializers for '${t.n}'`);
      const v = tmp(), parts = [`${v} = ${defaultVal(t, e.pos)}`];
      e.list.forEach((x, k) => { if (fs[k]) parts.push(fs[k].ty.k === 'arr' ? `__ai(${v}.${fs[k].d.name}, ${arrValues(fs[k].ty, x)})` : `${v}.${fs[k].d.name} = ${initValue(fs[k].ty, x)}`) });
      return `(${[...parts, v].join(', ')})`;
    }
    if (t.k === 'obj') {
      if (e.list.some(x => !(x.k === 'num' && x.v === 0))) warn(e.pos, `Initializer values for runtime struct '${t.n}' are ignored`);
      return defaultVal(t, e.pos);
    }
    if (e.list.length !== 1) err(e.pos, `Initializer list is not valid for '${tyName(t)}'`);
    return e.list[0] ? initValue(t, e.list[0]) : defaultVal(t, e.pos);
  }
  function arrValues(t: Ty, e: Expr, depth = t.dims!): string {
    if (depth === 0) return initValue(t.el!, e);
    if (e.k !== 'init') { err(e.pos, 'Expected an initializer list'); return '[]' }
    return `[${e.list.map(x => arrValues(t, x, depth - 1)).join(', ')}]`;
  }

  // ── expressions ──
  function arith(a: Ty, b: Ty, op: string): Ty {
    if (a.k === 'float' || b.k === 'float') return FLOAT;
    if (a.k === 'any' || b.k === 'any' || a.k === 'null' || b.k === 'null' || !num(a) || !num(b)) return ANY;
    const dt = (a.n === 'datetime') !== (b.n === 'datetime') && (op === '+' || op === '-');
    return dt ? T('int', 'datetime') : /long|datetime/.test(a.n + b.n) ? T('int', 'long') : INT;
  }
  const truthy = (r: R) => r.ty.k === 'bool' ? r.c : `!!(${r.c})`;
  function binop(op: string, A: R, B: R): R {
    switch (op) {
      case '+':
        if (A.ty.k === 'string' || B.ty.k === 'string') {
          const s = (r: R) => r.ty.n === 'datetime' ? `__dts(${r.c})` : r.ty.k === 'null' ? '""' : r.c;
          return { c: `(${s(A)} + ${s(B)})`, ty: STR };
        }
        return { c: `(${A.c} + ${B.c})`, ty: arith(A.ty, B.ty, op) };
      case '-': case '*': return { c: `(${A.c} ${op} ${B.c})`, ty: arith(A.ty, B.ty, op) };
      case '/': case '%': {
        const ty = arith(A.ty, B.ty, op);
        if (ty.k === 'int') return { c: `${op === '/' ? '__div' : '__mod'}(${A.c}, ${B.c})`, ty };
        return { c: `(${A.c} ${op} ${B.c})`, ty };
      }
      case '==': case '!=':
        if (A.ty.k === 'null' || B.ty.k === 'null') return { c: `(${A.ty.k === 'null' ? B.c : A.c} ${op} null)`, ty: BOOL };
        return { c: `(${A.c} ${op} ${B.c})`, ty: BOOL };
      case '<': case '>': case '<=': case '>=': return { c: `(${A.c} ${op} ${B.c})`, ty: BOOL };
      case '&&': case '||': return { c: `(${truthy(A)} ${op} ${truthy(B)})`, ty: BOOL };
      default: return { c: `(${A.c} ${op} ${B.c})`, ty: /long/.test(A.ty.n + B.ty.n) ? T('int', 'long') : INT };
    }
  }
  function ex(e: Expr, want?: Ty): R {
    switch (e.k) {
      case 'num': return { c: String(e.v), ty: e.float ? FLOAT : e.v > 2147483647 ? T('int', 'long') : INT };
      case 'str': return { c: JSON.stringify(e.v), ty: STR };
      case 'this':
        if (!ctx.cls || ctx.isStatic) { err(e.pos, "'this' is only available inside non-static methods"); return { c: 'undefined', ty: ANY } }
        return { c: 'this', ty: T('obj', ctx.cls.name, { cls: ctx.cls, ptr: true }) };
      case 'id': {
        const n = e.name;
        if (n === 'true' || n === 'false') return { c: n, ty: BOOL };
        if (n === 'NULL') return { c: 'null', ty: NULLT };
        if (n === '__FUNCTION__' || n === '__FUNCSIG__') return { c: JSON.stringify(ctx.name), ty: STR };
        if (want?.k === 'fn' && !lookupLocal(n) && funcs.has(n)) return { c: fnValue(e, want), ty: want };
        const lv = lval(e, false);
        if (lv) return { c: lv.get, ty: lv.ty };
        if (funcs.has(n)) { const d = funcs.get(n)![0]; return { c: d.js, ty: T('fn', n, { sig: d.sig }) } }
        return { c: `rt.${n}`, ty: ANY };
      }
      case 'scope': {
        if (!e.cls) { const g = globals.get(e.name); return g ? { c: g.js, ty: g.ty } : funcs.has(e.name) ? { c: funcs.get(e.name)![0].js, ty: ANY } : { c: `rt.${e.name}`, ty: rtTy(e.name) } }
        const c = classes.get(e.cls);
        if (c) {
          const f = findField(c, e.name);
          if (f?.isStatic) return { c: `${f.owner.js}.${e.name}`, ty: f.ty };
          if (f) { if (!ctx.cls || ctx.isStatic) err(e.pos, `'${e.name}' is not a static member of '${c.name}'`); return { c: `this.${e.name}`, ty: f.ty } }
        }
        const g = globals.get(e.name);
        if (g) return { c: g.js, ty: g.ty };
        if (c) { err(e.pos, `'${e.name}' is not a member of '${c.name}'`); return { c: 'undefined', ty: ANY } }
        return { c: `rt.${e.cls}.${e.name}`, ty: ANY };
      }
      case 'unary': {
        if (e.op === '&' || e.op === '*') return ex(e.e, want);
        if (e.op === '++' || e.op === '--') { const o = opCall(ex(e.e), e.op, [], e.pos); return o ?? incdec(e.e, e.op, true, e.pos) }
        const r = ex(e.e);
        const ov = opCall(r, e.op, [], e.pos);
        if (ov) return ov;
        if (e.op === '!') return { c: `(!${r.c})`, ty: BOOL };
        if (e.op === '~') return { c: `(~${r.c})`, ty: r.ty.k === 'int' ? r.ty : INT };
        return { c: `(${e.op}${r.c})`, ty: r.ty.k === 'bool' ? INT : r.ty };
      }
      case 'post': return incdec(e.e, e.op, false, e.pos);
      case 'bin': {
        const A = ex(e.a);
        if (A.ty.k === 'obj' && A.ty.cls && e.op !== '&&' && e.op !== '||') {
          const ov = opCall(A, e.op, [e.b], e.pos);
          if (ov) return ov;
          const eq = e.op === '!=' ? opCall(A, '==', [e.b], e.pos) : null;
          if (eq) return { c: `(!${eq.c})`, ty: BOOL };
        }
        return binop(e.op, A, ex(e.b));
      }
      case 'assign': {
        const lv = lval(e.a, e.op !== '=');
        if (!lv) { err(e.pos, 'The left side of an assignment must be a variable, array element or field'); return { c: 'undefined', ty: ANY } }
        if (lv.ty.k === 'obj' && lv.ty.cls) {
          const self = { c: lv.get, ty: lv.ty }, own = opCall(self, e.op, [e.b], e.pos);
          if (own) return own;
          const bin = e.op !== '=' ? opCall(self, e.op.slice(0, -1), [e.b], e.pos) : null;
          if (bin) return { c: valueObj(lv.ty) ? `${lv.get}.__set(${bin.c})` : lv.set(bin.c), ty: lv.ty };
        }
        if (e.op === '=') return { c: assignTo(lv, e.b, e.pos), ty: lv.ty };
        const v = binop(e.op.slice(0, -1), { c: lv.get, ty: lv.ty }, ex(e.b));
        return { c: seq(lv.pre, lv.set(conv(v, lv.ty))), ty: lv.ty };
      }
      case 'cond': {
        const c = ex(e.c), a = ex(e.a, want), b = ex(e.b, want);
        const ty = num(a.ty) && num(b.ty) ? (a.ty.k === b.ty.k ? a.ty : arith(a.ty, b.ty, '?')) : a.ty.k === 'null' ? b.ty : a.ty;
        return { c: `(${truthy(c)} ? ${a.c} : ${b.c})`, ty };
      }
      case 'comma': { const rs = e.list.map(x => ex(x)); return { c: `(${rs.map(r => r.c).join(', ')})`, ty: rs[rs.length - 1].ty } }
      case 'call': return call(e);
      case 'index': {
        const b = ex(e.e);
        const ov = opCall(b, '[]', [e.i], e.pos);
        if (ov) return ov;
        if (b.ty.k !== 'arr' && b.ty.k !== 'any') err(e.pos, `'${tyName(b.ty)}' value cannot be indexed`);
        return { c: `${b.c}.get(${index(e.i)})`, ty: elemTy(b.ty) };
      }
      case 'member': {
        const b = ex(e.e);
        if (b.ty.k === 'obj' && b.ty.cls) {
          const f = findField(b.ty.cls, e.name);
          if (!f) {
            err(e.pos, findMethods(b.ty.cls, e.name).length ? `Method '${e.name}' must be called` : `'${e.name}' is not a member of '${b.ty.cls.name}'`);
            return { c: 'undefined', ty: ANY };
          }
          return { c: f.isStatic ? `${f.owner.js}.${e.name}` : `${b.c}.${e.name}`, ty: f.ty };
        }
        if (num(b.ty) || b.ty.k === 'string' || b.ty.k === 'arr') err(e.pos, `'${tyName(b.ty)}' value has no member '${e.name}'`);
        return { c: `${b.c}.${e.name}`, ty: ANY };
      }
      case 'cast': {
        const t = resolve(e.t), r = ex(e.e);
        if (t.k === 'obj') {
          if (e.dyn && t.cls) return { c: `__dyn(${r.c}, ${t.cls.js})`, ty: { ...t, ptr: true } };
          return { c: r.c, ty: t };
        }
        if (t.k === 'int' && r.ty.k !== 'int') return { c: r.ty.k === 'string' ? intWrap(`Number(${r.c})`, INTS.has(t.n) ? t.n : 'int') : intWrap(r.c, INTS.has(t.n) ? t.n : 'int'), ty: t };
        if (t.k === 'int' && INTS.has(t.n) && t.n !== r.ty.n && !['int', 'long', 'datetime', 'color'].includes(t.n)) return { c: intWrap(r.c, t.n), ty: t };
        if (t.k === 'int' && t.n === 'datetime' && r.ty.k === 'string') return { c: `rt.StringToTime(${r.c})`, ty: t };
        if (t.k === 'float' && r.ty.k !== 'float') return { c: `Number(${r.c})`, ty: t };
        return { c: conv(r, t), ty: t };
      }
      case 'new': {
        const t = resolve(e.t);
        if (t.k !== 'obj') { err(e.pos, `'new' requires a class type, not '${e.t.name}'`); return { c: 'null', ty: NULLT } }
        return { c: construct(t, e.args, e.pos), ty: { ...t, ptr: true } };
      }
      case 'sizeof': return { c: String(e.t ? sizeOf(resolve(e.t)) : sizeOf(peekTy(e.e!))), ty: INT };
      case 'init':
        if (want) return { c: want.k === 'arr' ? `__ai(${defaultVal(want, e.pos)}, ${arrValues(want, e)})` : initValue(want, e), ty: want };
        err(e.pos, 'An initializer list is not allowed here');
        return { c: 'undefined', ty: ANY };
    }
  }
  function incdec(target: Expr, op: string, prefix: boolean, p: Pos): R {
    const lv = lval(target, true);
    if (!lv) { err(p, `Operand of '${op}' must be a variable, array element or field`); return { c: 'undefined', ty: ANY } }
    if (lv.plain && lv.ty.k !== 'bool') return { c: prefix ? `(${op}${lv.get})` : `(${lv.get}${op})`, ty: lv.ty };
    const d = op === '++' ? '+' : '-';
    if (prefix) return { c: seq(lv.pre, lv.set(conv({ c: `${lv.get} ${d} 1`, ty: lv.ty }, lv.ty))), ty: lv.ty };
    const t = tmp();
    return { c: seq([...lv.pre, `${t} = ${lv.get}`, lv.set(conv({ c: `${t} ${d} 1`, ty: lv.ty }, lv.ty))], t), ty: lv.ty };
  }

  // ── statements ──
  const pad = (n: number) => '  '.repeat(n);
  function varInit(d: VarDecl, ty: Ty): string {
    if (ty.k === 'arr') {
      const sizes = d.dims.map((x, k) => x ? ex(x).c : k === 0 && d.init?.k === 'init' ? String(d.init.list.length) : null);
      sizes.forEach((s, k) => { if (k > 0 && s == null) err(d.pos, `Only the first dimension of '${d.name}' can be dynamic`) });
      if (d.init && d.init.k !== 'init') err(d.init.pos, 'Arrays can only be initialized with an initializer list');
      return d.init?.k === 'init' ? `__ai(${mkArr(ty.el!, sizes, d.pos)}, ${arrValues(ty, d.init)})` : mkArr(ty.el!, sizes, d.pos);
    }
    if (d.ctor) {
      if (ty.k !== 'obj' || ty.ptr) { if (d.ctor.length !== 1) err(d.pos, `'${d.name}' cannot be constructed with arguments`); return d.ctor[0] ? conv(ex(d.ctor[0], ty), ty) : defaultVal(ty, d.pos) }
      return construct(ty, d.ctor, d.pos);
    }
    if (!d.init) return defaultVal(ty, d.pos);
    if (ty.k === 'obj' && !ty.ptr && !valueObj(ty) && d.init.k !== 'init') return ex(d.init, ty).c;
    return initValue(ty, d.init);
  }
  function localVar(d: VarDecl, ind: number): string {
    const ty = resolve(d.t, d.dims.length);
    if (ty.k === 'void') { err(d.pos, `Variable '${d.name}' cannot be void`); return '' }
    if (d.storage === 'static') {
      const js = `__st${++nStatic}_${safe(d.name)}`;
      declareLocal(d.name, ty, d.pos, false, js);
      const save = ctx; ctx = mod;
      const init = varInit(d, ty);
      ctx = save;
      staticLets.push(`let ${js};`);
      staticInits.push(`${js} = ${init};`);
      return '';
    }
    const init = varInit(d, ty);
    const s = declareLocal(d.name, ty, d.pos);
    return `${pad(ind)}let ${s.js} = ${init};\n`;
  }
  function body(s: Stmt, ind: number): string {   // statement as a block body
    if (s.k === 'block') return block(s.body, ind);
    ctx.scopes.push(new Map());
    const r = `{\n${stmt(s, ind + 1)}${pad(ind)}}`;
    ctx.scopes.pop();
    return r;
  }
  function block(list: Stmt[], ind: number, head = ''): string {
    ctx.scopes.push(new Map());
    const r = `{\n${head}${list.map(s => stmt(s, ind + 1)).join('')}${pad(ind)}}`;
    ctx.scopes.pop();
    return r;
  }
  const paren = (e: Expr) => { const c = ex(e).c; return `(${c})` };
  function stmt(s: Stmt, ind: number): string {
    const p = pad(ind);
    switch (s.k) {
      case 'vars': return s.list.map(d => localVar(d, ind)).join('');
      case 'expr': return `${p}${ex(s.e).c};\n`;
      case 'block': return `${p}${block(s.body, ind)}\n`;
      case 'empty': return '';
      case 'if': return `${p}if ${paren(s.c)} ${body(s.a, ind)}${s.b ? ` else ${body(s.b, ind)}` : ''}\n`;
      case 'while': return `${p}while (__t() && ${paren(s.c)}) ${body(s.body, ind)}\n`;
      case 'do': return `${p}do ${body(s.body, ind)} while (__t() && ${paren(s.c)});\n`;
      case 'for': {
        ctx.scopes.push(new Map());
        let init = '';
        if (s.init?.k === 'vars') init = 'let ' + s.init.list.map(d => {
          const ty = resolve(d.t, d.dims.length), v = varInit(d, ty);
          return `${declareLocal(d.name, ty, d.pos).js} = ${v}`;
        }).join(', ');
        else if (s.init?.k === 'expr') init = ex(s.init.e).c;
        const r = `${p}for (${init}; __t() && (${s.c ? ex(s.c).c : 'true'}); ${s.step ? ex(s.step).c : ''}) ${body(s.body, ind)}\n`;
        ctx.scopes.pop();
        return r;
      }
      case 'switch': {
        const v = ex(s.e).c;
        ctx.scopes.push(new Map());
        let r = `${p}switch (${v}) {\n`;
        let seenDefault = false;
        for (const c of s.cases) {
          if (!c.test) { if (seenDefault) err(c.pos, "Duplicate 'default' label"); seenDefault = true }
          r += `${pad(ind + 1)}${c.test ? `case ${ex(c.test).c}:` : 'default:'}\n${c.body.map(x => stmt(x, ind + 2)).join('')}`;
        }
        ctx.scopes.pop();
        return r + `${p}}\n`;
      }
      case 'break': return `${p}break;\n`;
      case 'continue': return `${p}continue;\n`;
      case 'return': {
        if (ctx.ctor) { if (s.e) err(s.pos, 'Constructors cannot return a value'); return `${p}return this;\n` }
        const ret = ctx.fn?.sig.ret ?? VOID;
        if (!s.e) { if (ret.k !== 'void' && ctx.fn) err(s.pos, `'${ctx.name}' must return a value`); return `${p}return;\n` }
        if (ret.k === 'void') { err(s.pos, `void function '${ctx.name}' cannot return a value`); return `${p}return;\n` }
        return `${p}return ${ret.k === 'any' ? ex(s.e).c : ret.k === 'fn' ? fnValue(s.e, ret) : conv(ex(s.e, ret), ret)};\n`;
      }
      case 'delete': return `${p}__del(${ex(s.e).c});\n`;
    }
  }

  // ── functions & classes ──
  function fnCtx(d: FnDef): Ctx {
    return { fn: d, cls: d.cls, isStatic: d.d.isStatic, ctor: d.d.kind === 'ctor', temps: [], name: d.cls ? `${d.cls.name}::${d.d.name}` : d.d.name, used: new Set(), scopes: [new Map()], tnames: new Set([...(d.cls?.d.tparams ?? []), ...d.d.tparams]) };
  }
  function params(d: FnDef): string {
    return d.sig.params.map((p, k) => {
      const s = declareLocal(p.name || `__a${k}`, p.ty, d.d.params[k].pos, p.ref);
      if (!p.def) return s.js;
      return `${s.js} = ${p.ref ? `ref(${ex(p.def).c})` : p.ty.k === 'fn' ? fnValue(p.def, p.ty) : conv(ex(p.def, p.ty), p.ty)}`;
    }).join(', ');
  }
  function fnBody(d: FnDef, ind: number, head: (string | (() => string))[] = [], tail = ''): string {
    const ps = params(d);
    const h = head.map(x => typeof x === 'string' ? x : x()).filter(Boolean).map(x => `${pad(ind + 1)}${x}\n`).join('');
    const b = block(d.d.body ?? [], ind, h);
    const t = ctx.temps.length ? `${pad(ind + 1)}let ${ctx.temps.join(', ')};\n` : '';
    return `(${ps}) ${b.replace('{\n', `{\n${t}`).replace(/\}$/, `${tail ? `${pad(ind + 1)}${tail}\n` : ''}${pad(ind)}}`)}`;
  }
  function emitFunc(d: FnDef): string {
    ctx = fnCtx(d);
    const r = `function ${d.js}${fnBody(d, 0)}\n`;
    ctx = mod;
    return r;
  }
  function emitClass(c: ClassInfo): string {
    const ext = c.base ? ` extends ${c.base.js}` : c.baseRt ? ` extends (rt.${c.baseRt} ?? Object)` : '';
    const L: string[] = [`class ${c.js}${ext} {`];
    // field defaults
    const cctx: Ctx = { ...mod, cls: c, temps: [], scopes: [], tnames: new Set(c.d.tparams), name: c.name };
    ctx = cctx;
    const inits: string[] = [], sets: string[] = [];
    for (const f of c.fields.values()) {
      const v = f.ty.k === 'arr' ? varInit({ ...f.d, init: null, ctor: null }, f.ty) : defaultVal(f.ty, f.d.pos);
      if (f.isStatic) { L.push(`  static ${f.d.name} = ${v};`); continue }
      inits.push(`this.${f.d.name} = ${v};`);
      sets.push(f.ty.k === 'arr' ? `this.${f.d.name}.resize(o.${f.d.name}.size); __ai(this.${f.d.name}, o.${f.d.name}.data.map(__cl));` : valueObj(f.ty) ? (f.ty.cls ? `this.${f.d.name}.__set(o.${f.d.name});` : `__cp(this.${f.d.name}, o.${f.d.name});`) : `this.${f.d.name} = o.${f.d.name};`);
    }
    const ft = cctx.temps.length ? `let ${cctx.temps.join(', ')}; ` : '';
    L.push(`  constructor() { ${ext ? 'super(); ' : ''}${ft}${inits.join(' ')} }`);
    ctx = mod;
    const baseDefault = () => c.base ? `super.${defaultCtor(c.base)}();` : c.baseRt ? 'if (super.__c) super.__c();' : '';
    if (!c.ctors.some(k => k.js === '__c')) L.push(`  __c() { ${baseDefault()} return this }`);
    for (const k of c.ctors) {
      if (!k.d.body) { err(k.d.pos, `Constructor '${c.name}' has no body`); continue }
      ctx = fnCtx(k);
      const head: (string | (() => string))[] = [];
      const bi = k.d.inits.find(x => x.name === c.d.base);
      head.push(() => {
        if (!bi) return baseDefault();
        if (!c.base) return `if (super.__c) super.__c();`;
        const b = c.base, bc = b.ctors.length ? pick(b.ctors, bi.args, b.name, bi.pos) : null;
        if (!bc) { if (bi.args.length) err(bi.pos, `'${b.name}' has no constructor taking ${bi.args.length} argument(s)`); return `super.__c();` }
        return callWith(bc.sig.params, bi.args, l => `super.${bc.js}(${l.join(', ')})`, VOID).c + ';';
      });
      for (const mi of k.d.inits) {
        if (mi === bi) continue;
        head.push(() => {
          const f = c.fields.get(mi.name);
          if (!f || f.isStatic) { err(mi.pos, `'${mi.name}' is not a member or base class of '${c.name}'`); return '' }
          if (f.ty.k === 'obj' && !f.ty.ptr) return `this.${mi.name} = ${construct(f.ty, mi.args, mi.pos)};`;
          if (mi.args.length !== 1) { err(mi.pos, `Member '${mi.name}' needs exactly one initializer`); return '' }
          return `this.${mi.name} = ${initValue(f.ty, mi.args[0])};`;
        });
      }
      L.push(`  ${k.js}${fnBody(k, 1, head, 'return this;')}`);
      ctx = mod;
    }
    if (c.dtor?.d.body) {
      ctx = fnCtx(c.dtor);
      L.push(`  __dtor${fnBody(c.dtor, 1, [], c.base || c.baseRt ? 'if (super.__dtor) super.__dtor();' : '')}`);
      ctx = mod;
    }
    for (const ms of c.methods.values()) for (const m of ms) {
      if (!m.d.body) { if (!m.d.pure && !m.d.isVirtual && c.d.kind !== 'interface') warn(m.d.pos, `Method '${c.name}::${m.d.name}' is declared but has no body`); continue }
      ctx = fnCtx(m);
      L.push(`  ${m.d.isStatic ? 'static ' : ''}${m.js}${fnBody(m, 1)}`);
      ctx = mod;
    }
    L.push(`  __set(o) { ${c.base || c.baseRt ? 'if (super.__set) super.__set(o); ' : ''}${sets.join(' ')} return this }`);
    L.push(`  __clone() { return new ${c.js}().__set(this) }`);
    L.push('}');
    return L.join('\n') + '\n';
  }

  // ── program ──
  const out: string[] = [PRELUDE];
  const enumOut: string[] = [], classOut: string[] = [], fnOut: string[] = [], globalLets: string[] = [], initBody: string[] = [];
  const inputDefs: string[] = [], setters: string[] = [];
  for (const d of decls) if (d.k === 'enum') {
    let prev = '';
    for (const it of d.items) {
      const v = it.value ? ex(it.value).c : prev ? `${prev} + 1` : '0';
      const js = safe(it.name);
      enumOut.push(`const ${js} = ${v};`);
      prev = js;
    }
    if (d.name) enumOut.push(`const __en_${d.name} = new Map([${d.items.map(it => `[${safe(it.name)}, ${JSON.stringify(it.name)}]`).join(', ')}]);`);
  }
  const seenCls = new Set<ClassInfo>();
  for (const d of decls) if (d.k === 'class' && !d.fwd) {
    const c = classes.get(d.name)!;
    if (seenCls.has(c) || c.d !== d) continue;
    seenCls.add(c);
    classOut.push(emitClass(c));
  }
  for (const defs of funcs.values()) for (const d of defs) {
    if (!d.d.body) { err(d.d.pos, `Function '${d.d.name}' is declared but has no body`); continue }
    fnOut.push(emitFunc(d));
  }
  ctx = mod;
  mod.scopes = [];
  for (const d of decls) if (d.k === 'vars') for (const v of d.list) {
    if (v.cls) {
      const c = classes.get(v.cls), f = c?.fields.get(v.name);
      if (!c || !f || !f.isStatic) { err(v.pos, `'${v.name}' is not a static member of '${v.cls}'`); continue }
      initBody.push(`${c.js}.${v.name} = ${varInit(v, f.ty)};`);
      continue;
    }
    const g = globals.get(v.name)!, ty = g.ty;
    if (ty.k === 'void') { err(v.pos, `Variable '${v.name}' cannot be void`); continue }
    const isInput = v.storage === 'input' || v.storage === 'sinput' || v.storage === 'extern';
    if (isInput) {
      if (ty.k === 'arr' || ty.k === 'obj') { err(v.pos, `Input '${v.name}' must be a number, bool, string or enum`); continue }
      globalLets.push(`let ${g.js} = ${varInit(v, ty)};`);
      const en = enums.get(ty.n);
      const opts = en ? `, options: [${en.items.map(it => `{ name: ${JSON.stringify(it.name)}, value: ${safe(it.name)} }`).join(', ')}]` : '';
      inputDefs.push(`{ name: ${JSON.stringify(v.name)}, type: ${JSON.stringify(v.t.name)}, def: ${g.js}${v.comment ? `, comment: ${JSON.stringify(v.comment)}` : ''}${v.group ? `, group: ${JSON.stringify(v.group)}` : ''}${opts} }`);
      setters.push(`case ${JSON.stringify(v.name)}: ${g.js} = ${conv({ c: 'v', ty: ANY }, ty)}; break;`);
    } else {
      globalLets.push(`let ${g.js} = ${ty.k === 'obj' || ty.k === 'arr' ? 'null' : defaultVal(ty, v.pos)};`);
      if (v.init || v.ctor || ty.k === 'obj' || ty.k === 'arr') initBody.push(`${g.js} = ${varInit(v, ty)};`);
    }
  }
  const handlers = HANDLERS.filter(h => funcs.get(h)?.some(d => d.d.body)).map(h => {
    const d = funcs.get(h)!.find(x => x.d.body)!;
    return `${h}: __h(${d.js}, ${d.d.params.length})`;
  });
  const propsOut = Object.entries(o.props).map(([k, v]) => `${JSON.stringify(k)}: ${typeof v === 'object' ? (globals.get(v.id)?.js ?? `rt.${v.id}`) : JSON.stringify(v)}`);
  if (mod.temps.length) out.push(`let ${mod.temps.join(', ')};`);
  out.push(...enumOut, ...classOut, ...fnOut, ...globalLets, ...staticLets);
  out.push(`function __init() {\n${[...staticInits, ...initBody].map(x => '  ' + x).join('\n')}\n}`);
  out.push(`return {\n  handlers: { ${handlers.join(', ')} },\n  inputs: [${inputDefs.join(',\n    ')}],\n  props: { ${propsOut.join(', ')} },\n  setInput(n, v) { switch (n) { ${setters.join(' ')} } }\n};`);
  return out.join('\n');
}
