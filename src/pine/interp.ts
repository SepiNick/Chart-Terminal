// Tree-walking Pine interpreter. Runs the whole script once per bar (bar 0 → last), keeping:
//  - variable history per declaration site + call path (so x[1] works for globals, locals and function locals),
//  - per-call-site state for builtins (ta.* buffers, plot objects) keyed by call path,
//  - outputs (plots, shapes, fills, colors, drawings, alerts, strategy) for the chart to render.
// Realtime updates simply re-run the script (cheap for chart-sized data) — no rollback machinery needed.
import { aggregate, tfSeconds, type Bar } from '../data.ts';
import type { AssignOp, Expr, Program, Stmt } from './ast.ts';
import { parse } from './parser.ts';
import { isMap, isMatrix } from './lib/collections.ts';
import { NA, isNa, num, bool, type Ctx, type PineValue, type PineTuple, type PineObject, type Builtin } from './types.ts';
import { LIB, CONSTS, VARS } from './lib/index.ts';
import { Broker, defaultProps, type Dir, type StrategyProps } from './strategy.ts';

export class PineRuntimeError extends Error {
  line: number; col: number;
  constructor(msg: string, line: number, col: number) { super(msg); this.line = line; this.col = col }
}

export interface ScriptInput {
  id: string; title: string; type: 'int' | 'float' | 'bool' | 'string' | 'color' | 'source' | 'timeframe' | 'symbol' | 'session' | 'price' | 'text_area';
  def: PineValue; value: PineValue; options?: PineValue[]; min?: number; max?: number; step?: number; group?: string; tooltip?: string; inline?: string;
}
export interface Plot {
  id: string; title: string; kind: 'line' | 'shape' | 'char' | 'arrow' | 'candle' | 'bar';
  values: number[]; colors: (string | null)[];
  style: string; linewidth: number; offset: number; histbase: number; display: boolean; trackprice: boolean;
  shape?: string; location?: string; char?: string; size?: string; texts?: (string | null)[]; textcolor?: string;
  ohlc?: { o: number[]; h: number[]; l: number[]; c: number[] }; colordown?: string; wickcolors?: (string | null)[]; bordercolors?: (string | null)[];
}
interface HLine { id: string; title: string; price: number; color: string; linestyle: string; linewidth: number; display: boolean }
interface Fill { a: string; b: string; colors: (string | null)[]; title: string }
interface TableCell { text: string; width: number; height: number; text_color: string; text_halign: string; text_valign: string; text_size: string; bgcolor: string | null; tooltip: string; font: string }
export interface PineTable {
  type: 'table'; id: number; deleted?: boolean; position: string; columns: number; rows: number;
  bgcolor: string | null; frame_color: string | null; frame_width: number; border_color: string | null; border_width: number;
  cells: Record<string, TableCell>;   // key "column,row"
  merges: { c0: number; r0: number; c1: number; r1: number }[];
}
export interface Drawing2 { type: 'label' | 'line' | 'box'; id: number; deleted?: boolean; [k: string]: unknown }
export interface Outputs {
  meta: { kind: 'indicator' | 'strategy' | 'library'; title: string; shorttitle: string; overlay: boolean; precision?: number; format?: string; strategy?: StrategyProps };
  inputs: ScriptInput[];
  plots: Plot[]; hlines: HLine[]; fills: Fill[];
  bgcolors: (string | null)[]; barcolors: (string | null)[];
  alertconditions: { title: string; message: string; fired: boolean[] }[];
  alerts: { bar: number; message: string; freq: string }[];
  drawings: Drawing2[];
  logs: { bar: number; level: 'info' | 'warning' | 'error'; msg: string }[];
  warnings: string[];
  broker?: Broker;
  tables?: PineTable[];
  /** request.security contexts whose bars `security` did not have; the host fetches them and runs the script again. */
  securityMissing?: { symbol: string; tf: string }[];
}
export interface RunOpts {
  inputs?: Record<string, PineValue>; symbol: string; tf: string; tfSec: number; mintick: number; maxLoop?: number;
  /** Bars for request.security on another symbol/timeframe (tf in app form: '1h', '1d'). undefined → na plus one warning. */
  security?: (symbol: string, tf: string) => Bar[] | undefined;
  /** Source of an imported library by its path 'user/Name/version'; undefined → runtime error. */
  library?: (path: string) => string | undefined;
}
type TypeDecl = Extract<Stmt, { kind: 'TypeDecl' }>;
type EnumDecl = Extract<Stmt, { kind: 'EnumDecl' }>;
/** User-defined type instance; `type` is the qualified type name (alias.Name for library types). */
interface Udt extends PineObject { type: string; udt: true; f: Record<string, PineValue> }
const isUdt = (v: unknown): v is Udt => !!v && typeof v === 'object' && (v as Udt).udt === true;
const libCache = new Map<string, Program>();
/** Pine timeframe string ('D', '240', '1W', '30S'; app forms like '4h' also work) → app tf ('1d', '4h'), or null. */
export function appTf(s: string): string | null {
  const m = /^(\d*)([SDWMHsmhdw]?)$/.exec(s.trim());
  if (!m || (!m[1] && !m[2]) || +(m[1] || 1) <= 0) return null;
  const n = +(m[1] || 1), u = m[2];
  if (!u) return n % 60 === 0 ? `${n / 60}h` : `${n}m`;
  return `${n}${({ S: 's', D: 'd', W: 'w', H: 'h' } as Record<string, string>)[u] ?? u}`;
}
const normSym = (s: string) => s.replace(/^BINANCE:/, '');

interface Binding { hist: PineValue[]; cur: PineValue; isVar: boolean; inited: boolean }
interface Frame { names: Map<string, Binding>; parent: Frame | null }
interface FuncDef { decl: Extract<Stmt, { kind: 'FuncDecl' }>; lib: string }   // lib: import alias ('' = this script)
class BreakSig { }
class ContinueSig { }
const BREAK = new BreakSig(), CONTINUE = new ContinueSig();

const SOURCES = ['open', 'high', 'low', 'close', 'hl2', 'hlc3', 'ohlc4', 'hlcc4', 'volume'];
const UTC = (t: number) => new Date(t * 1000);

/** Constants that are plain strings in Pine (style names etc.). */
const ENUM_PREFIXES = ['shape', 'location', 'size', 'plot', 'hline', 'extend', 'xloc', 'yloc', 'label', 'line', 'text', 'font', 'display', 'position', 'order', 'alert', 'barmerge', 'currency', 'dayofweek', 'adjustment', 'session', 'scale'];
const DAYS: Record<string, number> = { sunday: 1, monday: 2, tuesday: 3, wednesday: 4, thursday: 5, friday: 6, saturday: 7 };

/** `record` is internal: set when running in another request.security context, it collects each call site's per-bar value. */
export function run(prog: Program, bars: Bar[], opts: RunOpts, record?: Map<string, PineValue[]>): Outputs {
  const out: Outputs = {
    meta: { kind: 'indicator', title: 'Script', shorttitle: '', overlay: false },
    inputs: [], plots: [], hlines: [], fills: [], bgcolors: [], barcolors: [], alertconditions: [], alerts: [], drawings: [], logs: [], warnings: [], tables: [],
  };
  const bindings = new Map<string, Binding>();     // key: callPath|declId
  const states = new Map<string, unknown>();        // key: callPath|nodeId
  const funcs = new Map<string, FuncDef>();          // key: name or alias.name
  const methods = new Map<string, FuncDef[]>();      // method name → overloads (picked by the first parameter's type)
  const types = new Map<string, { decl: TypeDecl; lib: string }>();
  const enums = new Map<string, EnumDecl>();
  let curLib = '';   // library whose code is running: its own names resolve first
  const varBindings: Binding[] = [];
  const maxLoop = opts.maxLoop ?? 100_000;
  let bar = 0, callPath = '', curNode = 0, drawingId = 0, inputIdx = 0;
  let broker = null as Broker | null;
  const warned = new Set<string>();
  const warn = (msg: string) => { if (!warned.has(msg)) { warned.add(msg); out.warnings.push(msg) } };

  const ctx: Ctx = {
    get bar() { return bar }, bars, tfSec: opts.tfSec, mintick: opts.mintick, warn,
    state<T>(init: () => T): T {
      const k = `${callPath}|${curNode}`;
      if (!states.has(k)) states.set(k, init());
      return states.get(k) as T;
    },
  };
  const err = (n: { line: number; col: number }, msg: string): never => { throw new PineRuntimeError(msg, n.line, n.col) };

  // ---------- declarations pass (functions, types, enums, imported libraries) ----------
  // A library's own imports live under its alias ('a.b.f'): its code resolves its names first (see `scoped`).
  const declareAll = (body: Stmt[], lib: string, chain: string[] = []) => {
    for (const s of body) {
      if (s.kind === 'Import') importLib(s, lib, chain);
      if (s.kind !== 'FuncDecl' && s.kind !== 'TypeDecl' && s.kind !== 'EnumDecl') continue;
      const q = lib ? `${lib}.${s.name}` : s.name;
      if (s.kind === 'TypeDecl') types.set(q, { decl: s, lib });
      else if (s.kind === 'EnumDecl') enums.set(q, s);
      else {
        const fd = { decl: s, lib };
        if (s.method) { const l = methods.get(s.name) ?? []; l.push(fd); methods.set(s.name, l) }
        funcs.set(q, fd);
      }
    }
  };
  function importLib(s: Extract<Stmt, { kind: 'Import' }>, lib: string, chain: string[]) {
    if (chain.includes(s.path) || chain.length >= 8) return err(s, `Library import cycle: ${[...chain, s.path].join(' → ')}`);
    const src = opts.library?.(s.path);
    if (src == null) return err(s, `Library '${s.path}' not found: add a script that declares library("${s.path.split('/')[1]}") in the Pine Editor`);
    let p = libCache.get(src);
    if (!p) {
      try { p = parse(src) } catch (x) { return err(s, `Library '${s.path}': ${(x as Error).message}`) }
      if (libCache.size > 20) libCache.delete(libCache.keys().next().value!);
      libCache.set(src, p);
    }
    declareAll(p.body, lib ? `${lib}.${s.alias}` : s.alias, [...chain, s.path]);
  }
  const scoped = <T>(m: Map<string, T>, name: string): T | undefined => (curLib ? m.get(`${curLib}.${name}`) : undefined) ?? m.get(name);
  declareAll(prog.body, '');

  // ---------- builtin variables ----------
  const b = () => bars[bar];
  const series = (k: string, i: number): number => {
    const x = bars[i]; if (!x) return NA;
    switch (k) {
      case 'open': return x.open; case 'high': return x.high; case 'low': return x.low; case 'close': return x.close; case 'volume': return x.volume;
      case 'hl2': return (x.high + x.low) / 2; case 'hlc3': return (x.high + x.low + x.close) / 3;
      case 'ohlc4': return (x.open + x.high + x.low + x.close) / 4; case 'hlcc4': return (x.high + x.low + 2 * x.close) / 4;
      case 'time': return x.time * 1000; case 'time_close': return (x.time + opts.tfSec) * 1000; case 'bar_index': return i;
    }
    return NA;
  };
  const tfStr = () => { const n = opts.tf.slice(0, -1), u = opts.tf.at(-1); return u === 'm' ? n : u === 'h' ? String(+n * 60) : u === 'd' ? `${n === '1' ? '' : n}D` : u === 'w' ? `${n === '1' ? '' : n}W` : u === 'M' ? `${n === '1' ? '' : n}M` : `${n}S` };
  const builtinVar = (name: string): PineValue | undefined => {
    if (SOURCES.includes(name) || name === 'time' || name === 'time_close' || name === 'bar_index') return series(name, bar);
    const d = UTC(b().time);
    switch (name) {
      case 'na': return NA;
      case 'last_bar_index': return bars.length - 1;
      case 'last_bar_time': return bars.at(-1)!.time * 1000;
      case 'timenow': return Date.now();
      case 'year': return d.getUTCFullYear(); case 'month': return d.getUTCMonth() + 1; case 'dayofmonth': return d.getUTCDate();
      case 'dayofweek': return d.getUTCDay() + 1; case 'hour': return d.getUTCHours(); case 'minute': return d.getUTCMinutes(); case 'second': return d.getUTCSeconds();
      case 'weekofyear': { const j = new Date(Date.UTC(d.getUTCFullYear(), 0, 1)); return Math.ceil(((+d - +j) / 86400000 + j.getUTCDay() + 1) / 7) }
      case 'syminfo.ticker': return opts.symbol; case 'syminfo.tickerid': return `BINANCE:${opts.symbol}`; case 'syminfo.prefix': return 'BINANCE';
      case 'syminfo.mintick': return opts.mintick; case 'syminfo.pointvalue': return 1; case 'syminfo.currency': return opts.symbol.endsWith('USDT') ? 'USDT' : '';
      case 'syminfo.basecurrency': return opts.symbol.replace(/(USDT|USDC|BTC|ETH|FDUSD)$/, ''); case 'syminfo.type': return 'crypto'; case 'syminfo.timezone': return 'Etc/UTC';
      case 'syminfo.description': return opts.symbol; case 'syminfo.root': return opts.symbol; case 'syminfo.session': return '24x7';
      case 'timeframe.period': return tfStr(); case 'timeframe.multiplier': return +opts.tf.slice(0, -1);
      case 'timeframe.isintraday': return opts.tfSec < 86400; case 'timeframe.isdaily': return opts.tf.endsWith('d'); case 'timeframe.isweekly': return opts.tf.endsWith('w');
      case 'timeframe.ismonthly': return opts.tf.endsWith('M'); case 'timeframe.isminutes': return opts.tf.endsWith('m') || opts.tf.endsWith('h'); case 'timeframe.isseconds': return opts.tf.endsWith('s');
      case 'timeframe.isdwm': return opts.tfSec >= 86400; case 'timeframe.in_seconds': return opts.tfSec;
      case 'barstate.isfirst': return bar === 0; case 'barstate.islast': return bar === bars.length - 1;
      case 'barstate.ishistory': return bar < bars.length - 1; case 'barstate.isrealtime': return bar === bars.length - 1;
      case 'barstate.isconfirmed': return bar < bars.length - 1; case 'barstate.isnew': return true; case 'barstate.islastconfirmedhistory': return bar === bars.length - 2;
    }
    if (name.startsWith('strategy.')) {
      const k = name.slice(9), px = b().close;
      if (k === 'long') return 'long'; if (k === 'short') return 'short';
      if (['fixed', 'cash', 'percent_of_equity'].includes(k)) return k;
      if (k.startsWith('commission.')) return k.slice(11);
      if (k.startsWith('direction.')) return k.slice(10);
      if (!broker) return NA;
      switch (k) {
        case 'position_size': return broker.positionSize; case 'position_avg_price': return broker.positionAvgPrice;
        case 'equity': return broker.equityAt(px); case 'netprofit': return broker.netProfit(); case 'openprofit': return broker.openProfit(px);
        case 'initial_capital': return broker.props.initialCapital; case 'closedtrades': return broker.trades.length; case 'opentrades': return broker.open.length;
        case 'wintrades': return broker.trades.filter(t => t.profit > 0).length; case 'losstrades': return broker.trades.filter(t => t.profit < 0).length;
        case 'eventrades': return broker.trades.filter(t => t.profit === 0).length;
        case 'grossprofit': return broker.trades.filter(t => t.profit > 0).reduce((a, t) => a + t.profit, 0);
        case 'grossloss': return -broker.trades.filter(t => t.profit < 0).reduce((a, t) => a + t.profit, 0);
        case 'position_entry_name': return broker.open[0]?.id ?? '';
        case 'max_drawdown': { let peak = -Infinity, dd = 0; for (const e of broker.equity) if (e != null) { peak = Math.max(peak, e); dd = Math.max(dd, peak - e) } return dd }
      }
    }
    if (name in CONSTS) return CONSTS[name];
    if (name in VARS) return VARS[name](ctx);
    const dot = name.indexOf('.');
    if (dot > 0) {
      const ns = name.slice(0, dot), rest = name.slice(dot + 1);
      if (ns === 'dayofweek' && rest in DAYS) return DAYS[rest];
      if (ENUM_PREFIXES.includes(ns)) return rest;
    }
    return undefined;
  };

  // ---------- scopes ----------
  const lookup = (f: Frame | null, name: string): Binding | undefined => { for (let x = f; x; x = x.parent) { const v = x.names.get(name); if (v) return v } return undefined };
  const declare = (f: Frame, name: string, declId: number, isVar: boolean): Binding => {
    const k = `${callPath}|${declId}|${name}`;
    let bnd = bindings.get(k);
    if (!bnd) { bnd = { hist: [], cur: NA, isVar, inited: false }; bindings.set(k, bnd); if (isVar) varBindings.push(bnd) }
    f.names.set(name, bnd);
    return bnd;
  };
  const setBinding = (bnd: Binding, v: PineValue) => { bnd.cur = v; bnd.hist[bar] = v };

  // ---------- evaluation ----------
  const qname = (e: Expr): string | null => e.kind === 'Ident' ? e.name : e.kind === 'Member' ? (qname(e.object) ? `${qname(e.object)}.${e.prop}` : null) : null;
  const typeNs = (v: PineValue): string | null => Array.isArray(v) ? 'array' : v && typeof v === 'object' && 'type' in v ? (v as PineObject).type : typeof v === 'string' && /^#|rgba?\(/.test(v) ? 'color' : typeof v === 'string' ? 'str' : null;

  function evalBlock(stmts: Stmt[], f: Frame): PineValue {
    let last: PineValue = NA;
    for (const s of stmts) last = exec(s, f);
    return last;
  }
  function exec(s: Stmt, f: Frame): PineValue {
    curNode = s.id;
    switch (s.kind) {
      case 'VarDecl': {
        const bnd = declare(f, s.name, s.id, s.mode != null);
        if (bnd.isVar && bnd.inited) { bnd.hist[bar] = bnd.cur; return bnd.cur }
        const v = coerce(evalExpr(s.init, f), s.typeName);
        bnd.inited = true; setBinding(bnd, v);
        return v;
      }
      case 'TupleDecl': {
        const v = evalExpr(s.init, f), items = v && typeof v === 'object' && 'tuple' in v ? (v as PineTuple).tuple : Array.isArray(v) ? v : err(s, 'Right side is not a tuple');
        s.names.forEach((n, i) => { if (n !== '_') setBinding(declare(f, n, s.id * 1000 + i, false), items[i] ?? NA) });
        return NA;
      }
      case 'Assign': {
        const bnd = lookup(f, s.target) ?? err(s, `Undeclared identifier '${s.target}' (declare it with = before using :=)`);
        const nv = applyOp(s.op, bnd.cur, evalExpr(s.value, f));
        setBinding(bnd, nv);
        return nv;
      }
      case 'FieldAssign': {
        const o = evalExpr(s.object, f);
        if (!isUdt(o)) return err(s, `Cannot set field '${s.field}' on ${isNa(o) ? 'an na object' : 'this value'}`);
        if (!(s.field in o.f)) return err(s, `Type '${o.type}' has no field '${s.field}'`);
        return (o.f[s.field] = applyOp(s.op, o.f[s.field], evalExpr(s.value, f)));
      }
      case 'ExprStmt': return evalExpr(s.expr, f);
      case 'FuncDecl': case 'TypeDecl': case 'EnumDecl': case 'Import': return NA;   // handled by the declarations pass
      case 'Break': throw BREAK;
      case 'Continue': throw CONTINUE;
    }
  }
  const div = (a: number, c: number) => (c === 0 ? NA : a / c);
  const applyOp = (op: AssignOp, cur: PineValue, v: PineValue): PineValue => op === ':=' ? v : op === '+=' ? (typeof cur === 'string' ? cur + String(v) : num(cur) + num(v))
    : op === '-=' ? num(cur) - num(v) : op === '*=' ? num(cur) * num(v) : op === '/=' ? div(num(cur), num(v)) : num(cur) % num(v);
  function coerce(v: PineValue, typeName: string | null): PineValue {
    if (typeName === 'int' && typeof v === 'number' && !Number.isNaN(v)) return Math.trunc(v);
    if (typeName === 'bool' && typeof v === 'number') return bool(v);
    return v;
  }

  function evalExpr(e: Expr, f: Frame): PineValue {
    switch (e.kind) {
      case 'Num': return e.value;
      case 'Str': return e.value;
      case 'Bool': return e.value;
      case 'Na': return NA;
      case 'Color': return e.value;
      case 'Ident': {
        const bnd = lookup(f, e.name);
        if (bnd) return bnd.cur;
        const v = builtinVar(e.name);
        if (v !== undefined) return v;
        if (funcs.has(e.name) || LIB[e.name]) return e.name;   // function reference (rare)
        return err(e, `Undeclared identifier '${e.name}'`);
      }
      case 'Member': {
        const q = qname(e);
        if (q) {
          const v = builtinVar(q); if (v !== undefined) return v;
          const en = e.object.kind !== 'Ident' || !lookup(f, e.object.name) ? scoped(enums, q.slice(0, q.lastIndexOf('.'))) : undefined;
          if (en) return en.members.find(m => m.name === e.prop)?.title ?? err(e, `Enum '${en.name}' has no member '${e.prop}'`);
        }
        const obj = evalExpr(e.object, f);
        if (isUdt(obj)) return e.prop in obj.f ? obj.f[e.prop] : err(e, `Type '${obj.type}' has no field '${e.prop}'`);
        if (isNa(obj)) return NA;   // field of an na object
        if (obj && typeof obj === 'object' && !Array.isArray(obj) && e.prop in obj) return (obj as Record<string, PineValue>)[e.prop];
        return err(e, `Unknown member '${q ?? e.prop}'`);
      }
      case 'Index': return history(e, f);
      case 'Unary': {
        const v = evalExpr(e.arg, f);
        return e.op === 'not' ? !bool(v) : e.op === '-' ? -num(v) : num(v);
      }
      case 'Binary': {
        if (e.op === 'and') return bool(evalExpr(e.left, f)) && bool(evalExpr(e.right, f));
        if (e.op === 'or') return bool(evalExpr(e.left, f)) || bool(evalExpr(e.right, f));
        const a = evalExpr(e.left, f), c = evalExpr(e.right, f);
        switch (e.op) {
          case '+': return typeof a === 'string' || typeof c === 'string' ? (isNa(a) || isNa(c) ? null : String(a) + String(c)) : num(a) + num(c);
          case '-': return num(a) - num(c);
          case '*': return num(a) * num(c);
          case '/': return div(num(a), num(c));
          case '%': return num(c) === 0 ? NA : num(a) % num(c);
          case '==': return !isNa(a) && !isNa(c) && a === c;
          case '!=': return !isNa(a) && !isNa(c) && a !== c;
          case '<': return num(a) < num(c); case '>': return num(a) > num(c);
          case '<=': return num(a) <= num(c); case '>=': return num(a) >= num(c);
        }
        return NA;
      }
      case 'Ternary': return bool(evalExpr(e.test, f)) ? evalExpr(e.then, f) : evalExpr(e.else, f);
      case 'Tuple': return { tuple: e.items.map(x => evalExpr(x, f)) };
      case 'If': {
        if (bool(evalExpr(e.test, f))) return evalBlock(e.then, child(f));
        for (const el of e.elifs) if (bool(evalExpr(el.test, f))) return evalBlock(el.body, child(f));
        return e.else ? evalBlock(e.else, child(f)) : NA;
      }
      case 'Switch': {
        const subj = e.subject ? evalExpr(e.subject, f) : undefined;
        for (const c of e.cases) {
          if (c.when === null) return evalBlock(c.body, child(f));
          const w = evalExpr(c.when, f);
          if (e.subject ? !isNa(subj) && w === subj : bool(w)) return evalBlock(c.body, child(f));
        }
        return NA;
      }
      case 'For': {
        const from = num(evalExpr(e.from, f)), to = num(evalExpr(e.to, f));
        if (Number.isNaN(from) || Number.isNaN(to)) return NA;
        const step = e.step ? Math.abs(num(evalExpr(e.step, f))) || 1 : 1, dir = to >= from ? 1 : -1;
        let last: PineValue = NA, n = 0;
        const fr = child(f), iv = declare(fr, e.var, e.id, false);
        for (let i = from; dir > 0 ? i <= to : i >= to; i += dir * step) {
          if (++n > maxLoop) err(e, `Loop exceeded ${maxLoop} iterations`);
          setBinding(iv, i);
          try { last = evalBlock(e.body, fr) } catch (x) { if (x === BREAK) break; if (x !== CONTINUE) throw x }
        }
        return last;
      }
      case 'ForIn': {
        const src = evalExpr(e.iter, f);
        // [key/index, value] pairs: arrays, map entries, matrix rows
        const it: [PineValue, PineValue][] = isMap(src) ? [...src.m] : Array.isArray(src) ? src.map((v, i) => [i, v]) : isMatrix(src) ? src.d.map((r, i) => [i, r]) : err(e, 'for…in needs an array, a map or a matrix');
        let last: PineValue = NA;
        const fr = child(f);
        for (let i = 0; i < it.length; i++) {
          if (e.vars.length === 2) { setBinding(declare(fr, e.vars[0], e.id, false), it[i][0]); setBinding(declare(fr, e.vars[1], e.id + 0.5, false), it[i][1]) }
          else setBinding(declare(fr, e.vars[0], e.id, false), it[i][1]);
          try { last = evalBlock(e.body, fr) } catch (x) { if (x === BREAK) break; if (x !== CONTINUE) throw x }
        }
        return last;
      }
      case 'While': {
        let last: PineValue = NA, n = 0;
        const fr = child(f);
        while (bool(evalExpr(e.test, f))) {
          if (++n > maxLoop) err(e, `Loop exceeded ${maxLoop} iterations`);
          try { last = evalBlock(e.body, fr) } catch (x) { if (x === BREAK) break; if (x !== CONTINUE) throw x }
        }
        return last;
      }
      case 'Call': return call(e, f);
    }
  }
  const child = (f: Frame): Frame => ({ names: new Map(), parent: f });

  /** x[n]: variables read their per-bar history; other expressions are buffered per call site. */
  function history(e: Extract<Expr, { kind: 'Index' }>, f: Frame): PineValue {
    const k = Math.max(0, Math.round(num(evalExpr(e.index, f))));
    if (Number.isNaN(k)) return NA;
    const o = e.object;
    if (o.kind === 'Ident') {
      const bnd = lookup(f, o.name);
      if (bnd) return k === 0 ? bnd.cur : bar - k >= 0 ? (bnd.hist[bar - k] ?? NA) : NA;
      if (SOURCES.includes(o.name) || ['time', 'time_close', 'bar_index'].includes(o.name)) return series(o.name, bar - k);
    }
    const saved = curNode; curNode = e.id;
    const buf = ctx.state<PineValue[]>(() => []);
    curNode = saved;
    const v = evalExpr(o, f);
    buf[bar] = v;
    if (Array.isArray(v) && !buf.length) return v;
    return bar - k >= 0 ? (buf[bar - k] ?? NA) : NA;
  }

  // ---------- calls ----------
  function call(e: Extract<Expr, { kind: 'Call' }>, f: Frame): PineValue {
    let name = qname(e.callee);
    let args: PineValue[];
    const userFn = name ? scoped(funcs, name) : undefined;
    if (name && !userFn && /\.(new|copy)$/.test(name)) {   // Type.new(...) / Type.copy(obj)
      const T = scoped(types, name.slice(0, name.lastIndexOf('.')));
      if (T) return udtNew(e, T, e.args.map(x => evalExpr(x, f)), namedArgs(e, f), name.endsWith('.copy'));
    }
    // Method syntax: arr.push(x), lbl.set_text(s), myVar.method(...)
    if (e.callee.kind === 'Member' && !userFn && (!name || (!LIB[name] && !INTERNAL.has(name) && !isNamespace(name)))) {
      const self = evalExpr(e.callee.object, f), prop = e.callee.prop;
      const user = pickMethod(prop, self);
      if (user) return callUser(e, user, [self, ...e.args.map(a => evalExpr(a, f))], namedArgs(e, f), f);
      const ns = typeNs(self);
      if (!ns) return err(e, `Cannot call method '${prop}' on this value`);
      name = `${ns}.${prop}`;
      args = [self, ...e.args.map(a => evalExpr(a, f))];
    } else {
      if (!name) return err(e, 'Unsupported call target');
      if (name === 'input.source' || (name === 'input' && e.args[0]?.kind === 'Ident' && SOURCES.includes((e.args[0] as { name: string }).name))) return inputSource(e, f);
      if (userFn) return callUser(e, userFn, e.args.map(a => evalExpr(a, f)), namedArgs(e, f), f);
      args = e.args.map(a => evalExpr(a, f));
    }
    const named = namedArgs(e, f);
    const saved = curNode; curNode = e.id;
    try {
      const internal = internals[name];
      if (internal) return internal(args, named, e);
      const fn: Builtin | undefined = LIB[name] ?? (name.startsWith('array.new') && LIB['array.new'] ? ((c, a, n) => LIB['array.new'](c, a, { ...n, __type: e.typeArgs[0] ?? name.slice(10) })) : undefined);
      if (!fn) return err(e, `Unknown function '${name}'`);
      return fn(ctx, args, named);
    } catch (x) {
      if (x instanceof PineRuntimeError) throw x;
      if (x === BREAK || x === CONTINUE) throw x;
      return err(e, `${name}: ${(x as Error).message}`);
    } finally { curNode = saved }
  }
  const namedArgs = (e: Extract<Expr, { kind: 'Call' }>, f: Frame) => Object.fromEntries(e.named.map(n => [n.name, evalExpr(n.value, f)]));
  const NAMESPACES = new Set(['ta', 'math', 'str', 'color', 'array', 'input', 'strategy', 'request', 'label', 'line', 'box', 'table', 'log', 'runtime', 'matrix', 'map', 'ticker', 'timeframe', 'syminfo', 'chart', 'polyline', 'linefill', 'strategy.closedtrades', 'strategy.opentrades', 'strategy.risk']);
  const isNamespace = (q: string) => NAMESPACES.has(q.slice(0, q.lastIndexOf('.')));

  let depth = 0;
  function callUser(e: Extract<Expr, { kind: 'Call' }>, fn: FuncDef, args: PineValue[], named: Record<string, PineValue>, f: Frame): PineValue {
    if (++depth > 200) err(e, 'Recursion is not allowed in Pine');
    const d = fn.decl, prevPath = callPath, prevLib = curLib;
    const root: Frame = { names: new Map(), parent: globalFrame };
    callPath = `${prevPath}/${e.id}`;
    try {
      d.params.forEach((p, i) => {
        const v = p.name in named ? named[p.name] : i < args.length ? args[i] : p.def ? evalExpr(p.def, f) : NA;
        setBinding(declare(root, p.name, d.id * 100 + i, false), v);
      });
      curLib = fn.lib;
      return evalBlock(d.body, root);
    } finally { callPath = prevPath; curLib = prevLib; depth-- }
  }
  // ---------- user-defined types ----------
  const qualType = (t: string, lib: string) => (lib && types.has(`${lib}.${t}`) ? `${lib}.${t}` : t);
  /** Coarse runtime type of a value, comparable with typeKey() of a declared parameter type. */
  const valueKey = (v: PineValue): string | null => isUdt(v) ? v.type : Array.isArray(v) ? 'array' : isMatrix(v) ? 'matrix' : isMap(v) ? 'map'
    : typeof v === 'number' ? 'number' : typeof v === 'boolean' ? 'bool' : typeof v === 'string' ? 'string' : v && typeof v === 'object' && 'type' in v ? String(v.type) : null;
  const typeKey = (t: string, lib: string) => {
    const base = t.endsWith('[]') ? 'array' : t.replace(/<.*$/, '');
    return base === 'float' || base === 'int' ? 'number' : base === 'color' ? 'string' : qualType(base, lib);
  };
  function pickMethod(name: string, self: PineValue): FuncDef | undefined {
    const c = methods.get(name);
    if (!c) return undefined;
    const k = valueKey(self);
    return c.find(m => { const t = m.decl.params[0]?.typeName; return t != null && typeKey(t, m.lib) === k }) ?? c.find(m => !m.decl.params[0]?.typeName) ?? (c.length === 1 ? c[0] : undefined);
  }
  function udtNew(e: Extract<Expr, { kind: 'Call' }>, T: { decl: TypeDecl; lib: string }, args: PineValue[], named: Record<string, PineValue>, copy: boolean): PineValue {
    const type = T.lib ? `${T.lib}.${T.decl.name}` : T.decl.name;
    if (copy) { const o = named.object ?? args[0]; return isUdt(o) ? { ...o, f: { ...o.f } } : isNa(o) ? NA : err(e, `${type}.copy() needs a ${type} object`) }
    const prevLib = curLib, o: Udt = { type, udt: true, f: {} };
    curLib = T.lib;
    try {
      T.decl.fields.forEach((fd, i) => {
        o.f[fd.name] = fd.name in named ? named[fd.name] : i < args.length ? args[i] : fd.def ? evalExpr(fd.def, globalFrame) : fd.typeName === 'bool' ? false : NA;
      });
    } finally { curLib = prevLib }
    return o;
  }

  // ---------- inputs ----------
  function inputOf(type: ScriptInput['type'], def: PineValue, named: Record<string, PineValue>, args: PineValue[], titleIdx = 1): PineValue {
    const id = `in${inputIdx++}`;
    let inp = out.inputs.find(x => x.id === id);
    if (!inp) {
      const title = String(named.title ?? args[titleIdx] ?? `Input ${inputIdx}`);
      const override = opts.inputs?.[id];
      inp = { id, title, type, def, value: override !== undefined ? override : def, group: named.group as string, tooltip: named.tooltip as string, inline: named.inline as string };
      if (named.options) { const o = named.options as PineValue[] | PineTuple; inp.options = Array.isArray(o) ? o : o.tuple }
      for (const k of ['minval', 'maxval', 'step'] as const) if (named[k] != null) inp[k === 'minval' ? 'min' : k === 'maxval' ? 'max' : 'step'] = num(named[k]);
      out.inputs.push(inp);
    }
    return inp.value;
  }
  function inputSource(e: Extract<Expr, { kind: 'Call' }>, f: Frame): PineValue {
    const named = namedArgs(e, f);
    const defNode = e.named.find(n => n.name === 'defval')?.value ?? e.args[0];
    const defName = defNode?.kind === 'Ident' ? defNode.name : 'close';
    const sel = String(inputOf('source', defName, named, e.args.slice(1).map(a => evalExpr(a, f)), 0));
    if (SOURCES.includes(sel)) return series(sel, bar);
    const bnd = lookup(f, sel);   // a plot/variable name chosen as source
    return bnd ? bnd.cur : series('close', bar);
  }

  // ---------- internal builtins (outputs, strategy, drawings, inputs, misc) ----------
  type Internal = (args: PineValue[], named: Record<string, PineValue>, e: Extract<Expr, { kind: 'Call' }>) => PineValue;
  const a = (args: PineValue[], named: Record<string, PineValue>, i: number, n: string, d?: PineValue): PineValue => (n in named ? named[n] : i < args.length ? args[i] : d) as PineValue;
  const str = (v: PineValue, d = '') => (isNa(v) ? d : String(v));
  const once = <T>(init: () => T) => ctx.state(init);
  const plotFor = (kind: Plot['kind'], args: PineValue[], named: Record<string, PineValue>, titleIdx: number): Plot => once(() => {
    const p: Plot = {
      id: `p${out.plots.length}`, title: str(a(args, named, titleIdx, 'title'), `Plot ${out.plots.length + 1}`), kind, values: [], colors: [],
      style: str(named.style, kind === 'line' ? 'style_line' : ''), linewidth: num(named.linewidth ?? 1) || 1, offset: num(named.offset ?? 0) || 0,
      histbase: num(named.histbase ?? 0) || 0, display: named.display !== 'none' && named.display !== 'display.none', trackprice: !!named.trackprice,
    };
    out.plots.push(p);
    return p;
  });
  const drawings = (type: Drawing2['type']) => out.drawings.filter(d => d.type === type && !d.deleted);
  const newDrawing = (type: Drawing2['type'], props: Record<string, unknown>): PineObject => {
    const d: Drawing2 = { type, id: ++drawingId, ...props };
    out.drawings.push(d);
    const limit = type === 'label' ? labelLimit : type === 'line' ? lineLimit : boxLimit;
    const live = drawings(type);
    if (live.length > limit) live[0].deleted = true;   // Pine garbage-collects the oldest beyond max_*_count
    return d as unknown as PineObject;
  };
  let labelLimit = 50, lineLimit = 50, boxLimit = 50;
  const setter = (field: string, idx = 1): Internal => args => { const o = args[0] as Record<string, unknown>; if (o) o[field] = args[idx]; return NA };
  const getter = (field: string): Internal => args => ((args[0] as Record<string, unknown>)?.[field] ?? NA) as PineValue;
  const dir = (v: PineValue): Dir => (v === 'short' || v === 'strategy.short' ? 'short' : 'long');
  const optNum = (v: PineValue) => (v == null || isNa(v) ? undefined : num(v));
  const colorOrNull = (v: PineValue): string | null => (isNa(v) || typeof v !== 'string' ? null : v);

  const internals: Record<string, Internal> = {
    indicator: (args, n) => { Object.assign(out.meta, { kind: 'indicator', title: str(a(args, n, 0, 'title'), 'Script'), shorttitle: str(n.shorttitle), overlay: !!n.overlay, precision: optNum(n.precision ?? NA), format: n.format as string }); setLimits(n); return NA },
    study: (args, n) => internals.indicator(args, n, null as never),
    library: (args, n) => { Object.assign(out.meta, { kind: 'library', title: str(a(args, n, 0, 'title'), 'Library'), overlay: !!n.overlay }); return NA },
    strategy: (args, n) => {
      if (bar === 0 && !broker) {
        Object.assign(out.meta, { kind: 'strategy', title: str(a(args, n, 0, 'title'), 'Strategy'), shorttitle: str(n.shorttitle), overlay: !!n.overlay });
        const props = defaultProps({
          initialCapital: num(n.initial_capital ?? 1e6), qtyType: str(n.default_qty_type, 'fixed').replace('strategy.', '') as StrategyProps['qtyType'],
          qtyValue: num(n.default_qty_value ?? 1), pyramiding: num(n.pyramiding ?? 0), commissionType: str(n.commission_type, 'percent').replace('strategy.commission.', '') as StrategyProps['commissionType'],
          commissionValue: num(n.commission_value ?? 0), slippageTicks: num(n.slippage ?? 0), mintick: opts.mintick, processOnClose: !!n.process_orders_on_close,
        });
        out.meta.strategy = props;
        broker = new Broker(bars, props); out.broker = broker;
        setLimits(n);
      }
      return NA;
    },
    plot: (args, n) => {
      const p = plotFor('line', args, n, 1);
      p.values[bar] = num(a(args, n, 0, 'series')); p.colors[bar] = (a(args, n, 2, 'color', null) as string) ?? null;
      return { type: 'plot', id: p.id } as PineObject;
    },
    plotshape: (args, n) => {
      const p = plotFor('shape', args, n, 1);
      const v = a(args, n, 0, 'series');
      p.shape = str(n.style ?? args[2], 'xcross'); p.location = str(n.location, 'abovebar'); p.size = str(n.size, 'auto');
      p.values[bar] = typeof v === 'boolean' ? (v ? 1 : NA) : num(v); p.colors[bar] = (n.color as string) ?? null;
      (p.texts ??= [])[bar] = n.text != null ? str(n.text) : null; p.textcolor = n.textcolor as string;
      return { type: 'plot', id: p.id } as PineObject;
    },
    plotchar: (args, n) => {
      const p = plotFor('char', args, n, 1);
      const v = a(args, n, 0, 'series');
      p.char = str(n.char ?? args[2], '★'); p.location = str(n.location, 'abovebar'); p.size = str(n.size, 'auto');
      p.values[bar] = typeof v === 'boolean' ? (v ? 1 : NA) : num(v); p.colors[bar] = (n.color as string) ?? null;
      (p.texts ??= [])[bar] = n.text != null ? str(n.text) : null;
      return { type: 'plot', id: p.id } as PineObject;
    },
    plotarrow: (args, n) => {
      const p = plotFor('arrow', args, n, 1);
      const v = num(a(args, n, 0, 'series'));
      p.values[bar] = v === 0 ? NA : v; p.colors[bar] = (v > 0 ? n.colorup : n.colordown) as string ?? null;
      return { type: 'plot', id: p.id } as PineObject;
    },
    plotcandle: (args, n) => ohlcPlot('candle', args, n),
    plotbar: (args, n) => ohlcPlot('bar', args, n),
    hline: (args, n) => once(() => {
      const h: HLine = { id: `h${out.hlines.length}`, title: str(a(args, n, 1, 'title'), 'Level'), price: num(a(args, n, 0, 'price')), color: str(a(args, n, 2, 'color'), '#787b86'), linestyle: str(n.linestyle, 'style_dashed'), linewidth: num(n.linewidth ?? 1) || 1, display: n.display !== 'none' };
      out.hlines.push(h);
      return { type: 'hline', id: h.id } as PineObject;
    }),
    fill: (args, n) => {
      const h1 = args[0] as PineObject, h2 = args[1] as PineObject;
      const fl = once(() => { const x: Fill = { a: String(h1?.id), b: String(h2?.id), colors: [], title: str(n.title) }; out.fills.push(x); return x });
      fl.colors[bar] = (a(args, n, 2, 'color', null) as string) ?? null;
      return NA;
    },
    bgcolor: (args, n) => { out.bgcolors[bar] = (a(args, n, 0, 'color', null) as string) ?? null; return NA },
    barcolor: (args, n) => { out.barcolors[bar] = (a(args, n, 0, 'color', null) as string) ?? null; return NA },
    alertcondition: (args, n) => {
      const ac = once(() => { const x = { title: str(a(args, n, 1, 'title'), 'Alert'), message: str(a(args, n, 2, 'message')), fired: [] as boolean[] }; out.alertconditions.push(x); return x });
      ac.fired[bar] = bool(a(args, n, 0, 'condition'));
      return NA;
    },
    alert: (args, n) => { out.alerts.push({ bar, message: str(a(args, n, 0, 'message')), freq: str(a(args, n, 1, 'freq'), 'freq_once_per_bar') }); return NA },
    na: args => isNa(args[0]),
    nz: args => (isNa(args[0]) ? (args.length > 1 ? args[1] : 0) : args[0]),
    fixnan: (args) => { const st = once(() => ({ last: NA as PineValue })); if (!isNa(args[0])) st.last = args[0]; return st.last },
    int: args => (isNa(args[0]) ? NA : Math.trunc(num(args[0]))),
    float: args => num(args[0]),
    bool: args => bool(args[0]),
    string: args => str(args[0]),
    color: args => args[0],
    max_bars_back: () => NA,
    timestamp: args => {
      const ns = args.filter(x => typeof x === 'number') as number[];
      if (typeof args[0] === 'string' && ns.length === 0) return Date.parse(args[0]);
      const [y, m, d = 1, h = 0, mi = 0, s = 0] = ns;
      return Date.UTC(y, m - 1, d, h, mi, s);
    },
    'time': () => series('time', bar),
    'log.info': args => { out.logs.push({ bar, level: 'info', msg: str(args[0]) }); return NA },
    'log.warning': args => { out.logs.push({ bar, level: 'warning', msg: str(args[0]) }); return NA },
    'log.error': args => { out.logs.push({ bar, level: 'error', msg: str(args[0]) }); return NA },
    'runtime.error': (args, _n, e) => err(e, str(args[0], 'Runtime error')),
    'request.security': (args, n, e) => security(args, n, e),
    'request.security_lower_tf': (args, n, e) => lowerTf(args, n, e),
    // inputs
    input: (args, n) => inputOf(typeof (n.defval ?? args[0]) === 'boolean' ? 'bool' : typeof (n.defval ?? args[0]) === 'string' ? 'string' : 'float', n.defval ?? args[0], n, args),
    'input.int': (args, n) => inputOf('int', n.defval ?? args[0], n, args),
    'input.float': (args, n) => inputOf('float', n.defval ?? args[0], n, args),
    'input.bool': (args, n) => inputOf('bool', n.defval ?? args[0], n, args),
    'input.string': (args, n) => inputOf('string', n.defval ?? args[0], n, args),
    'input.text_area': (args, n) => inputOf('text_area', n.defval ?? args[0], n, args),
    'input.color': (args, n) => inputOf('color', n.defval ?? args[0], n, args),
    'input.timeframe': (args, n) => inputOf('timeframe', n.defval ?? args[0], n, args),
    'input.symbol': (args, n) => inputOf('symbol', n.defval ?? args[0], n, args),
    'input.session': (args, n) => inputOf('session', n.defval ?? args[0], n, args),
    'input.price': (args, n) => inputOf('price', n.defval ?? args[0], n, args),
    'input.time': (args, n) => inputOf('int', n.defval ?? args[0], n, args),
    'input.enum': (args, n) => {
      const def = n.defval ?? args[0], en = [...enums.values()].find(x => x.members.some(m => m.title === def));
      return inputOf('string', def, { ...n, options: n.options ?? en?.members.map(m => m.title) ?? null }, args);
    },
    // strategy
    'strategy.entry': (args, n) => { if (broker) broker.entry(bar, str(a(args, n, 0, 'id')), dir(a(args, n, 1, 'direction')), { qty: optNum(a(args, n, 2, 'qty', NA)), limit: optNum(a(args, n, 3, 'limit', NA)), stop: optNum(a(args, n, 4, 'stop', NA)), comment: str(n.comment) }); return NA },
    'strategy.order': (args, n) => { if (broker) broker.order(bar, str(a(args, n, 0, 'id')), dir(a(args, n, 1, 'direction')), { qty: optNum(a(args, n, 2, 'qty', NA)), limit: optNum(a(args, n, 3, 'limit', NA)), stop: optNum(a(args, n, 4, 'stop', NA)), comment: str(n.comment) }); return NA },
    'strategy.close': (args, n) => { if (broker) broker.close(bar, str(a(args, n, 0, 'id')), { qty: optNum(n.qty ?? NA), qtyPercent: optNum(n.qty_percent ?? NA), comment: str(n.comment) }); return NA },
    'strategy.close_all': (_args, n) => { if (broker) broker.close(bar, null, { comment: str(n.comment) }); return NA },
    'strategy.exit': (args, n) => {
      if (broker) broker.exit(bar, str(a(args, n, 0, 'id')), {
        fromEntry: n.from_entry != null ? str(n.from_entry) : args[1] != null ? str(args[1]) : undefined, qty: optNum(n.qty ?? NA), qtyPercent: optNum(n.qty_percent ?? NA),
        limit: optNum(n.limit ?? NA), stop: optNum(n.stop ?? NA), profit: optNum(n.profit ?? NA), loss: optNum(n.loss ?? NA),
        trailPoints: optNum(n.trail_points ?? NA), trailOffset: optNum(n.trail_offset ?? NA), trailPrice: optNum(n.trail_price ?? NA), comment: str(n.comment),
      });
      return NA;
    },
    'strategy.cancel': args => { broker?.cancel(str(args[0])); return NA },
    'strategy.cancel_all': () => { broker?.cancel(null); return NA },
    'strategy.closedtrades.profit': args => broker?.trades[num(args[0])]?.profit ?? NA,
    'strategy.closedtrades.entry_price': args => broker?.trades[num(args[0])]?.entryPrice ?? NA,
    'strategy.closedtrades.exit_price': args => broker?.trades[num(args[0])]?.exitPrice ?? NA,
    'strategy.closedtrades.entry_bar_index': args => broker?.trades[num(args[0])]?.entryBar ?? NA,
    'strategy.closedtrades.exit_bar_index': args => broker?.trades[num(args[0])]?.exitBar ?? NA,
    'strategy.closedtrades.size': args => { const t = broker?.trades[num(args[0])]; return t ? (t.dir === 'long' ? t.qty : -t.qty) : NA },
    'strategy.opentrades.entry_price': args => broker?.open[num(args[0])]?.price ?? NA,
    'strategy.opentrades.size': args => { const t = broker?.open[num(args[0])]; return t ? (t.dir === 'long' ? t.qty : -t.qty) : NA },
    'strategy.opentrades.profit': args => { const t = broker?.open[num(args[0])]; return t ? (b().close - t.price) * t.qty * (t.dir === 'long' ? 1 : -1) : NA },
    // drawings (x is a bar index unless xloc=bar_time)
    'label.new': (args, n) => newDrawing('label', { x: a(args, n, 0, 'x'), y: a(args, n, 1, 'y'), text: str(a(args, n, 2, 'text')), xloc: str(n.xloc, 'bar_index'), yloc: str(n.yloc, 'price'), color: n.color ?? '#2962ff', style: str(n.style, 'style_label_down'), textcolor: n.textcolor ?? '#ffffff', size: str(n.size, 'normal'), tooltip: n.tooltip }),
    'label.delete': args => { if (args[0]) (args[0] as unknown as Drawing2).deleted = true; return NA },
    'label.set_text': setter('text'), 'label.set_x': setter('x'), 'label.set_y': setter('y'), 'label.set_color': setter('color'), 'label.set_textcolor': setter('textcolor'),
    'label.set_style': setter('style'), 'label.set_size': setter('size'), 'label.set_tooltip': setter('tooltip'), 'label.set_yloc': setter('yloc'), 'label.set_xloc': args => { const o = args[0] as Record<string, unknown>; if (o) { o.x = args[1]; o.xloc = args[2] } return NA },
    'label.set_xy': args => { const o = args[0] as Record<string, unknown>; if (o) { o.x = args[1]; o.y = args[2] } return NA },
    'label.get_x': getter('x'), 'label.get_y': getter('y'), 'label.get_text': getter('text'),
    'line.new': (args, n) => newDrawing('line', { x1: a(args, n, 0, 'x1'), y1: a(args, n, 1, 'y1'), x2: a(args, n, 2, 'x2'), y2: a(args, n, 3, 'y2'), xloc: str(n.xloc, 'bar_index'), extend: str(n.extend, 'none'), color: n.color ?? '#2962ff', style: str(n.style, 'style_solid'), width: num(n.width ?? 1) || 1 }),
    'line.delete': args => { if (args[0]) (args[0] as unknown as Drawing2).deleted = true; return NA },
    'line.set_xy1': args => { const o = args[0] as Record<string, unknown>; if (o) { o.x1 = args[1]; o.y1 = args[2] } return NA },
    'line.set_xy2': args => { const o = args[0] as Record<string, unknown>; if (o) { o.x2 = args[1]; o.y2 = args[2] } return NA },
    'line.set_x1': setter('x1'), 'line.set_y1': setter('y1'), 'line.set_x2': setter('x2'), 'line.set_y2': setter('y2'), 'line.set_color': setter('color'), 'line.set_width': setter('width'), 'line.set_style': setter('style'), 'line.set_extend': setter('extend'),
    'line.get_x1': getter('x1'), 'line.get_y1': getter('y1'), 'line.get_x2': getter('x2'), 'line.get_y2': getter('y2'),
    'line.get_price': args => { const o = args[0] as Record<string, number>; if (!o) return NA; const x = num(args[1]); return o.x2 === o.x1 ? o.y1 : o.y1 + ((o.y2 - o.y1) * (x - o.x1)) / (o.x2 - o.x1) },
    'box.new': (args, n) => newDrawing('box', { left: a(args, n, 0, 'left'), top: a(args, n, 1, 'top'), right: a(args, n, 2, 'right'), bottom: a(args, n, 3, 'bottom'), xloc: str(n.xloc, 'bar_index'), border_color: n.border_color ?? '#2962ff', border_width: num(n.border_width ?? 1) || 1, bgcolor: n.bgcolor ?? '#2962ff33', text: str(n.text), text_color: n.text_color ?? '#ffffff', extend: str(n.extend, 'none') }),
    'box.delete': args => { if (args[0]) (args[0] as unknown as Drawing2).deleted = true; return NA },
    'box.set_left': setter('left'), 'box.set_right': setter('right'), 'box.set_top': setter('top'), 'box.set_bottom': setter('bottom'), 'box.set_bgcolor': setter('bgcolor'), 'box.set_border_color': setter('border_color'), 'box.set_text': setter('text'), 'box.set_extend': setter('extend'),
    'box.set_lefttop': args => { const o = args[0] as Record<string, unknown>; if (o) { o.left = args[1]; o.top = args[2] } return NA },
    'box.set_rightbottom': args => { const o = args[0] as Record<string, unknown>; if (o) { o.right = args[1]; o.bottom = args[2] } return NA },
    'box.get_left': getter('left'), 'box.get_right': getter('right'), 'box.get_top': getter('top'), 'box.get_bottom': getter('bottom'),
    // tables: the final state is drawn as an HTML overlay on the pane
    'table.new': (args, n) => {
      const position = str(a(args, n, 0, 'position'), 'top_right');
      for (const t of out.tables!) if (t.position === position) t.deleted = true;   // one live table per position
      const t: PineTable = {
        type: 'table', id: ++drawingId, position, columns: num(a(args, n, 1, 'columns', 1)) || 1, rows: num(a(args, n, 2, 'rows', 1)) || 1,
        bgcolor: colorOrNull(a(args, n, 3, 'bgcolor', null)), frame_color: colorOrNull(a(args, n, 4, 'frame_color', null)), frame_width: num(a(args, n, 5, 'frame_width', 0)) || 0,
        border_color: colorOrNull(a(args, n, 6, 'border_color', null)), border_width: num(a(args, n, 7, 'border_width', 0)) || 0, cells: {}, merges: [],
      };
      out.tables!.push(t);
      return t as unknown as PineObject;
    },
    'table.cell': (args, n) => {
      const t = tbl(args), c = num(a(args, n, 1, 'column')), r = num(a(args, n, 2, 'row'));
      if (!(c >= 0 && c < t.columns && r >= 0 && r < t.rows)) throw new Error(`Cell (${c}, ${r}) is outside the ${t.columns}x${t.rows} table`);
      t.cells[`${c},${r}`] = {
        text: str(a(args, n, 3, 'text')), width: num(a(args, n, 4, 'width', 0)) || 0, height: num(a(args, n, 5, 'height', 0)) || 0,
        text_color: str(a(args, n, 6, 'text_color'), '#000000'), text_halign: str(a(args, n, 7, 'text_halign'), 'center'), text_valign: str(a(args, n, 8, 'text_valign'), 'center'),
        text_size: str(a(args, n, 9, 'text_size'), 'normal'), bgcolor: colorOrNull(a(args, n, 10, 'bgcolor', null)), tooltip: str(a(args, n, 11, 'tooltip')), font: str(a(args, n, 12, 'text_font_family'), 'default'),
      };
      return NA;
    },
    'table.delete': args => { tbl(args).deleted = true; return NA },
    'table.clear': (args, n) => {
      const t = tbl(args), c0 = num(a(args, n, 1, 'start_column', 0)), r0 = num(a(args, n, 2, 'start_row', 0)), c1 = num(a(args, n, 3, 'end_column', c0)), r1 = num(a(args, n, 4, 'end_row', r0));
      for (let c = c0; c <= c1; c++) for (let r = r0; r <= r1; r++) delete t.cells[`${c},${r}`];
      t.merges = t.merges.filter(m => m.c1 < c0 || m.c0 > c1 || m.r1 < r0 || m.r0 > r1);
      return NA;
    },
    'table.merge_cells': (args, n) => {
      const t = tbl(args), m = { c0: num(a(args, n, 1, 'start_column')), r0: num(a(args, n, 2, 'start_row')), c1: num(a(args, n, 3, 'end_column')), r1: num(a(args, n, 4, 'end_row')) };
      if (m.c1 < m.c0 || m.r1 < m.r0) throw new Error('The end cell must be after the start cell');
      t.merges = t.merges.filter(x => x.c1 < m.c0 || x.c0 > m.c1 || x.r1 < m.r0 || x.r0 > m.r1);
      t.merges.push(m);
      return NA;
    },
  };
  const INTERNAL = new Set(Object.keys(internals));
  function ohlcPlot(kind: 'candle' | 'bar', args: PineValue[], n: Record<string, PineValue>): PineValue {
    const p = plotFor(kind, args, n, 4);
    p.ohlc ??= { o: [], h: [], l: [], c: [] };
    p.ohlc.o[bar] = num(a(args, n, 0, 'open')); p.ohlc.h[bar] = num(a(args, n, 1, 'high')); p.ohlc.l[bar] = num(a(args, n, 2, 'low')); p.ohlc.c[bar] = num(a(args, n, 3, 'close'));
    const col = colorOrNull(a(args, n, 5, 'color', null));
    p.values[bar] = p.ohlc.c[bar]; p.colors[bar] = col;
    (p.wickcolors ??= [])[bar] = n.wickcolor !== undefined ? colorOrNull(n.wickcolor) : col;
    (p.bordercolors ??= [])[bar] = n.bordercolor !== undefined ? colorOrNull(n.bordercolor) : col;
    return { type: 'plot', id: p.id } as PineObject;
  }
  // ---------- request.security ----------
  // The script runs once more over the other context's bars (record mode), collecting each call site's value per bar;
  // values are then mapped to chart bars by time: without lookahead a bar sees only other-context bars that have closed
  // by its own close (the newest still-forming one only on the chart's last bar).
  interface SecCtx { rec: Map<string, PineValue[]>; off: Int32Array; on: Int32Array }
  const secCtx = new Map<string, SecCtx | null>();
  const naLike = (v: PineValue): PineValue => (v && typeof v === 'object' && 'tuple' in v ? { tuple: (v as PineTuple).tuple.map(() => NA) } : NA);
  function security(args: PineValue[], n: Record<string, PineValue>, e: Extract<Expr, { kind: 'Call' }>): PineValue {
    const expr = a(args, n, 2, 'expression'), sym = normSym(str(a(args, n, 0, 'symbol'))) || normSym(opts.symbol);
    const tfIn = str(a(args, n, 1, 'timeframe')), tf = tfIn ? appTf(tfIn) : opts.tf;
    if (!tf) { warn(`request.security: unknown timeframe '${tfIn}' (line ${e.line})`); return naLike(expr) }
    const sameSym = sym === normSym(opts.symbol);
    if (sameSym && tfSeconds(tf) === opts.tfSec) {   // this context: the expression itself
      if (record) { const k = `${callPath}|${e.id}`; let r = record.get(k); if (!r) record.set(k, r = []); r[bar] = expr }
      return expr;
    }
    if (record) { warn('request.security inside another request.security context is not supported; using the outer context'); return expr }
    const key = `${sym}|${tf}`;
    let sc = secCtx.get(key);
    if (sc === undefined) secCtx.set(key, sc = buildSec(sym, tf, sameSym, e));
    const vals = sc?.rec.get(`${callPath}|${e.id}`);
    if (!sc || !vals) return naLike(expr);
    const map = a(args, n, 4, 'lookahead') === 'lookahead_on' ? sc.on : sc.off, j = map[bar];
    if (j < 0 || (a(args, n, 3, 'gaps') === 'gaps_on' && bar > 0 && map[bar - 1] === j)) return naLike(expr);
    return vals[j] ?? naLike(expr);
  }
  function buildSec(sym: string, tf: string, sameSym: boolean, e: { line: number }): SecCtx | null {
    const sec = tfSeconds(tf), month = tf.endsWith('M');
    // same symbol, higher multiple timeframe: built from the chart's own bars (also stays live)
    const sb = sameSym && !month && sec > opts.tfSec && sec % opts.tfSec === 0 ? aggregate(bars, sec) : opts.security?.(sym, tf);
    if (!sb) {
      (out.securityMissing ??= []).push({ symbol: sym, tf });
      warn(`request.security: no data for ${sym} ${tf} (line ${e.line}); returning na`);
      return null;
    }
    const rec = new Map<string, PineValue[]>();
    try { run(prog, sb, { ...opts, symbol: sym, tf, tfSec: sec }, rec).warnings.forEach(warn) }
    catch (x) { warn(`request.security(${sym}, ${tf}): ${(x as Error).message}`); return null }
    const end = (j: number) => (month ? sb[j + 1]?.time ?? Infinity : sb[j].time + sec);
    const off = new Int32Array(bars.length), on = new Int32Array(bars.length);
    for (let i = 0, j = -1, k = -1; i < bars.length; i++) {
      const t = bars[i].time;
      while (j + 1 < sb.length && end(j + 1) <= t + opts.tfSec) j++;
      while (k + 1 < sb.length && sb[k + 1].time <= t) k++;
      off[i] = i === bars.length - 1 ? Math.max(j, k) : j; on[i] = k;
    }
    return { rec, off, on };
  }
  // request.security_lower_tf: the script runs over the lower timeframe's bars (record mode, like above) and each chart
  // bar gets an array of the values of the lower bars that opened inside it (a tuple of arrays for a tuple expression).
  const lowCtx = new Map<string, { rec: Map<string, PineValue[]>; lo: Int32Array; hi: Int32Array } | null>();
  function lowerTf(args: PineValue[], n: Record<string, PineValue>, e: Extract<Expr, { kind: 'Call' }>): PineValue {
    const expr = a(args, n, 2, 'expression'), sym = normSym(str(a(args, n, 0, 'symbol'))) || normSym(opts.symbol);
    const tfIn = str(a(args, n, 1, 'timeframe')), tf = tfIn ? appTf(tfIn) : opts.tf;
    const isTup = !!expr && typeof expr === 'object' && 'tuple' in expr;
    const arr = (vs: PineValue[]): PineValue => (isTup ? { tuple: (expr as PineTuple).tuple.map((_, t) => vs.map(v => (v as PineTuple | undefined)?.tuple?.[t] ?? NA)) } : vs) as PineValue;
    if (!tf) { warn(`request.security_lower_tf: unknown timeframe '${tfIn}' (line ${e.line})`); return arr([]) }
    const sec = tfSeconds(tf);
    if (sym === normSym(opts.symbol) && sec === opts.tfSec) {   // this context: one value per bar
      if (record) { const k = `${callPath}|${e.id}`; let r = record.get(k); if (!r) record.set(k, r = []); r[bar] = expr }
      return arr([expr]);
    }
    if (record) { warn('request.security_lower_tf inside another request.security context is not supported'); return arr([]) }
    if (sec > opts.tfSec) { warn(`request.security_lower_tf: '${tfIn}' is not lower than the chart's timeframe (line ${e.line})`); return arr([]) }
    const key = `${sym}|${tf}`;
    let lc = lowCtx.get(key);
    if (lc === undefined) {
      lc = null;
      const sb = opts.security?.(sym, tf);
      if (!sb) { (out.securityMissing ??= []).push({ symbol: sym, tf }); warn(`request.security_lower_tf: no data for ${sym} ${tf} (line ${e.line}); returning empty arrays`) }
      else {
        const rec = new Map<string, PineValue[]>();
        try {
          run(prog, sb, { ...opts, symbol: sym, tf, tfSec: sec }, rec).warnings.forEach(warn);
          const lo = new Int32Array(bars.length), hi = new Int32Array(bars.length);
          for (let i = 0, j = 0; i < bars.length; i++) {
            while (j < sb.length && sb[j].time < bars[i].time) j++;
            let k = j;
            while (k < sb.length && sb[k].time < bars[i].time + opts.tfSec) k++;
            lo[i] = j; hi[i] = k;
          }
          lc = { rec, lo, hi };
        } catch (x) { warn(`request.security_lower_tf(${sym}, ${tf}): ${(x as Error).message}`) }
      }
      lowCtx.set(key, lc);
    }
    const vals = lc?.rec.get(`${callPath}|${e.id}`);
    return arr(lc && vals ? vals.slice(lc.lo[bar], lc.hi[bar]).map(v => v ?? NA) : []);
  }
  function setLimits(n: Record<string, PineValue>) {
    if (n.max_labels_count != null) labelLimit = num(n.max_labels_count);
    if (n.max_lines_count != null) lineLimit = num(n.max_lines_count);
    if (n.max_boxes_count != null) boxLimit = num(n.max_boxes_count);
  }
  function tbl(args: PineValue[]): PineTable {
    const t = args[0] as unknown as PineTable;
    if (!t || t.type !== 'table') throw new Error('Cannot use an na table');
    return t;
  }
  // table.set_* and table.cell_set_* (cell_set_text_font_family writes the cell's `font`)
  for (const k of ['position', 'bgcolor', 'frame_color', 'frame_width', 'border_color', 'border_width']) internals[`table.set_${k}`] = args => { (tbl(args) as unknown as Record<string, PineValue>)[k] = args[1]; return NA };
  for (const k of ['text', 'width', 'height', 'text_color', 'text_halign', 'text_valign', 'text_size', 'bgcolor', 'tooltip', 'text_font_family']) internals[`table.cell_set_${k}`] = args => {
    const t = tbl(args), key = `${num(args[1])},${num(args[2])}`;
    const cell = t.cells[key] ??= { text: '', width: 0, height: 0, text_color: '#000000', text_halign: 'center', text_valign: 'center', text_size: 'normal', bgcolor: null, tooltip: '', font: 'default' };
    (cell as unknown as Record<string, PineValue>)[k === 'text_font_family' ? 'font' : k] = args[3];
    return NA;
  };
  for (const k of Object.keys(internals)) INTERNAL.add(k);

  // ---------- run ----------
  const globalFrame: Frame = { names: new Map(), parent: null };
  for (bar = 0; bar < bars.length; bar++) {
    inputIdx = 0; callPath = '';
    for (const v of varBindings) v.hist[bar] = v.cur;
    broker?.step(bar);
    globalFrame.names.clear();
    try { evalBlock(prog.body, globalFrame) }
    catch (x) { if (x === BREAK || x === CONTINUE) throw new PineRuntimeError('break/continue outside a loop', 0, 0); throw x }
  }
  broker?.finalize();
  return out;
}
