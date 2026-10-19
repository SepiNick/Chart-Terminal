// Recursive-descent MQL4/MQL5 parser over preprocessed tokens, producing the AST in ast.ts.
import type { Diagnostic } from '../contract.ts';
import { MqlSyntaxError, type Expr, type Stmt, type Decl, type TypeRef, type VarDecl, type Param, type FuncDecl, type ClassDecl, type EnumDecl, type TypedefDecl, type Pos, type Storage, type Case, type CtorInit } from './ast.ts';
import type { Tok } from './lexer.ts';

export const PRIMS = new Set(['void', 'bool', 'char', 'uchar', 'short', 'ushort', 'int', 'uint', 'long', 'ulong', 'float', 'double', 'string', 'datetime', 'color']);
const KW = new Set([...PRIMS, 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default', 'break', 'continue', 'return', 'struct', 'class',
  'interface', 'enum', 'typedef', 'template', 'typename', 'new', 'delete', 'this', 'const', 'static', 'input', 'sinput', 'extern', 'virtual',
  'public', 'private', 'protected', 'operator', 'sizeof']);
const SPEC = new Set(['const', 'static', 'input', 'sinput', 'extern', 'virtual']);
const ASSIGN = new Set(['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>=']);
const PREC: Record<string, number> = { '||': 1, '&&': 2, '|': 3, '^': 4, '&': 5, '==': 6, '!=': 6, '<': 7, '>': 7, '<=': 7, '>=': 7, '<<': 8, '>>': 8, '+': 9, '-': 9, '*': 10, '/': 10, '%': 10 };

const desc = (t: Tok) => t.t === 'eof' ? 'end of file' : t.t === 'str' ? `string "${t.v}"` : `'${t.v}'`;

export function parse(input: Tok[], builtinTypes: Iterable<string>, errors: Diagnostic[]): Decl[] {
  const T = input.slice();
  let i = 0, group: string | undefined;
  const types = new Set(builtinTypes), tmplClasses = new Set<string>(), tmplFns = new Set<string>(), tscope: string[][] = [];
  const peek = (o = 0) => T[Math.min(i + o, T.length - 1)];
  const next = () => T[i < T.length - 1 ? i++ : i];
  const is = (v: string, o = 0) => { const t = peek(o); return (t.t === 'op' || t.t === 'id') && t.v === v };
  const pos = (t: Tok): Pos => ({ file: t.file, line: t.line, col: t.col });
  const fail = (msg: string, t = peek()): never => { throw new MqlSyntaxError(msg, pos(t)) };
  const expect = (v: string, what = `'${v}'`) => is(v) ? next() : fail(`Expected ${what} but found ${desc(peek())}`);
  const isName = (o = 0) => { const t = peek(o); return t.t === 'id' && !KW.has(t.v) };
  const ident = (what = 'an identifier') => isName() ? next() : fail(`Expected ${what} but found ${desc(peek())}`);
  const isType = (n: string) => PRIMS.has(n) || types.has(n) || n.startsWith('ENUM_') || tscope.some(s => s.includes(n));

  // ── types ──
  function closeAngle() {   // consume '>' (splitting '>>')
    if (is('>>')) { T[i] = { ...T[i], v: '>' }; T.splice(i + 1, 0, { ...T[i], col: T[i].col + 1, sp: false }); }
    expect('>');
  }
  function typeArgs(): TypeRef[] {
    expect('<');
    const out: TypeRef[] = [];
    if (!is('>')) do {
      if (peek().t === 'num') { next(); continue }
      out.push(type());
    } while (is(',') && ++i);
    closeAngle();
    return out;
  }
  function type(): TypeRef {
    const t0 = peek();
    let isConst = false;
    while (is('const')) { i++; isConst = true }
    const nt = peek();
    if (nt.t !== 'id' || (KW.has(nt.v) && !PRIMS.has(nt.v))) fail(`Expected a type but found ${desc(nt)}`);
    i++;
    if (nt.v === 'unsigned' || nt.v === 'signed') fail(`'${nt.v}' is not an MQL type`, nt);
    const args = is('<') && tmplClasses.has(nt.v) ? typeArgs() : [];
    while (is('const')) { i++; isConst = true }
    let ptr = false, ref = false;
    if (is('*')) { i++; ptr = true }
    if (is('&')) { i++; ref = true }
    return { name: nt.v, args, isConst, ptr, ref, pos: pos(t0) };
  }
  // does a declaration start here?  (statement level)
  function declAhead(): boolean {
    const t = peek();
    if (t.t !== 'id') return false;
    if (SPEC.has(t.v)) return true;
    if (KW.has(t.v) && !PRIMS.has(t.v)) return false;
    if (isType(t.v)) return !is('(', 1) && !is('::', 1) && !is('.', 1);
    if (isName(1)) return true;
    return (is('*', 1) || is('&', 1)) && isName(2) && [';', '=', ',', '[', ')', '('].some(v => is(v, 3));
  }
  function paramsAhead(): boolean {   // peek() is '(' — parameter list (function) or constructor arguments (object)?
    const t = peek(1);
    if (is(')', 1)) return true;
    if (t.t !== 'id') return false;
    if (t.v === 'const' || isType(t.v)) return true;
    return isName(2) || ((is('&', 2) || is('*', 2)) && (isName(3) || is('&', 3)));
  }

  // ── declarations ──
  function declarators(t: TypeRef, storage: Storage, cls?: string): VarDecl[] {
    const list: VarDecl[] = [];
    do {
      const d0 = peek();
      let ptr = t.ptr, ref = t.ref;
      if (is('*')) { i++; ptr = true }
      if (is('&')) { i++; ref = true }
      const n = ident('a variable name');
      const dims: (Expr | null)[] = [];
      while (is('[')) { i++; dims.push(is(']') ? null : expr()); expect(']') }
      let init: Expr | null = null, ctor: Expr[] | null = null;
      if (is('=')) { i++; init = initExpr() }
      else if (is('(')) { i++; ctor = args(); expect(')') }
      list.push({ pos: pos(list.length ? n : d0), t: { ...t, ptr, ref }, name: n.v, cls, dims, init, ctor, storage, group: storage && storage !== 'static' ? group : undefined });
    } while (is(',') && ++i);
    return list;
  }
  function endDecl(list: VarDecl[]) {
    expect(';');
    const c = T[i - 1].trail;
    if (c) for (const d of list) d.comment = c;
  }
  function tparams(): string[] {
    expect('template');
    expect('<');
    const out: string[] = [];
    do {
      if (!is('typename') && !is('class')) fail(`Expected 'typename' but found ${desc(peek())}`);
      i++;
      out.push(ident('a template parameter name').v);
    } while (is(',') && ++i);
    closeAngle();
    return out;
  }
  function paramList(): Param[] {
    expect('(');
    const out: Param[] = [];
    if (is('void') && is(')', 1)) i++;
    if (!is(')')) do {
      const p0 = peek(), t = type();
      if (is('&')) { i++; t.ref = true }
      const name = isName() ? next().v : '';
      let dims = 0;
      while (is('[')) { i++; if (!is(']')) expr(); expect(']'); dims++ }
      out.push({ pos: pos(p0), t, name, dims, def: is('=') ? (i++, assign()) : null });
    } while (is(',') && ++i);
    expect(')', "')' to close the parameter list");
    return out;
  }
  function funcRest(start: Tok, ret: TypeRef, name: string, cls: string, kind: FuncDecl['kind'], tp: string[], isStatic = false, isVirtual = false): FuncDecl {
    tscope.push(tp);
    try {
      const params = paramList();
      while (is('const') || is('override') || is('final')) i++;
      let pure = false, body: Stmt[] | null = null;
      const inits: CtorInit[] = [];
      if (is('=') && peek(1).t === 'num' && peek(1).n === 0) { i += 2; pure = true }
      if (is(':')) {
        if (kind !== 'ctor') fail('Only constructors can have an initializer list');
        i++;
        do { const n = ident('a member or base class name'); if (is('<')) typeArgs(); expect('('); inits.push({ pos: pos(n), name: n.v, args: args() }); expect(')') } while (is(',') && ++i);
      }
      if (is('{')) body = blockBody();
      else expect(';', "'{' or ';' after the function header");
      return { k: 'func', pos: pos(start), ret, name, cls, kind, params, body, tparams: tp, isStatic, isVirtual, pure, inits };
    } finally { tscope.pop() }
  }
  function enumDecl(): EnumDecl {
    const t0 = expect('enum');
    const name = isName() ? next().v : '';
    if (name) types.add(name);
    expect('{');
    const items: EnumDecl['items'] = [];
    while (!is('}')) {
      const n = ident('an enum member name');
      items.push({ pos: pos(n), name: n.v, value: is('=') ? (i++, cond()) : null });
      if (!is(',')) break;
      i++;
    }
    expect('}');
    if (is(';')) i++;
    return { k: 'enum', pos: pos(t0), name, items };
  }
  function typedefDecl(): TypedefDecl {
    const t0 = expect('typedef'), ret = type();
    if (is('(')) {
      i++; expect('*');
      const n = ident('a typedef name'); expect(')');
      types.add(n.v);
      const params = paramList();
      expect(';');
      return { k: 'typedef', pos: pos(t0), name: n.v, t: null, fn: { ret, params } };
    }
    const n = ident('a typedef name');
    types.add(n.v);
    expect(';');
    return { k: 'typedef', pos: pos(t0), name: n.v, t: ret, fn: null };
  }
  function classDecl(tp: string[]): Decl[] {
    const kw = next(), kind = kw.v as ClassDecl['kind'];
    const n = ident(`a ${kind} name`), name = n.v;
    types.add(name);
    if (tp.length) tmplClasses.add(name);
    const cls: ClassDecl = { k: 'class', pos: pos(kw), kind, name, base: '', tparams: tp, fields: [], methods: [], fwd: false };
    if (is(';')) { i++; cls.fwd = true; return [cls] }
    if (is(':')) {
      i++;
      if (is('public') || is('protected') || is('private')) i++;
      cls.base = type().name;
    }
    expect('{');
    tscope.push(tp);
    const extra: Decl[] = [];
    try {
      while (!is('}')) {
        const m0 = peek();
        if (m0.t === 'eof') fail(`Unterminated ${kind} '${name}'`, kw);
        if ((is('public') || is('private') || is('protected')) && is(':', 1)) { i += 2; continue }
        if (is(';')) { i++; continue }
        if (is('enum')) { extra.push(enumDecl()); continue }
        if (is('struct') || is('class') || is('interface')) { extra.push(...classDecl([])); continue }
        if (is('typedef')) { extra.push(typedefDecl()); continue }
        const mt = is('template') ? tparams() : [];
        let isStatic = false, isVirtual = false;
        for (;;) { if (is('virtual')) { i++; isVirtual = true } else if (is('static')) { i++; isStatic = true } else break }
        const VOID: TypeRef = { name: 'void', args: [], isConst: false, ptr: false, ref: false, pos: pos(m0) };
        if (is('~')) {
          i++;
          const d = ident('the destructor name');
          if (d.v !== name) fail(`Destructor name '~${d.v}' does not match ${kind} '${name}'`, d);
          cls.methods.push(funcRest(m0, VOID, '~' + name, name, 'dtor', mt));
          continue;
        }
        if (peek().v === name && is('(', 1)) { i++; cls.methods.push(funcRest(m0, VOID, name, name, 'ctor', mt)); continue }
        const t = type();
        if (is('operator')) fail('Operator overloading is not supported');
        if (isName() && is('(', 1)) {
          const fn = next().v;
          cls.methods.push(funcRest(m0, t, fn, name, 'fn', mt, isStatic, isVirtual || kind === 'interface'));
          continue;
        }
        const list = declarators(t, isStatic ? 'static' : '');
        endDecl(list);
        cls.fields.push(...list);
      }
    } finally { tscope.pop() }
    expect('}');
    if (is(';')) i++;
    return [...extra, cls];
  }
  function topLevel(): Decl[] {
    const t0 = peek();
    if (is(';')) { i++; return [] }
    if (is('enum')) return [enumDecl()];
    if (is('struct') || is('class') || is('interface')) return classDecl([]);
    if (is('typedef')) return [typedefDecl()];
    const tp = is('template') ? tparams() : [];
    if (tp.length && (is('struct') || is('class'))) return classDecl(tp);
    if (is('input') && is('group', 1) && peek(2).t === 'str') { i += 2; group = next().v; if (is(';')) i++; return [] }
    if (is('operator')) fail('Operator overloading is not supported');
    // out-of-class constructor / destructor: C::C(...) / C::~C()
    if (isName() && is('::', 1) && ((peek(2).v === t0.v && is('(', 3)) || is('~', 2))) {
      i += 2;
      const VOID: TypeRef = { name: 'void', args: [], isConst: false, ptr: false, ref: false, pos: pos(t0) };
      if (is('~')) { i++; ident(); return [funcRest(t0, VOID, '~' + t0.v, t0.v, 'dtor', tp)] }
      i++;
      return [funcRest(t0, VOID, t0.v, t0.v, 'ctor', tp)];
    }
    let storage: Storage = '';
    for (;;) {
      const v = peek().v;
      if (peek().t !== 'id') break;
      if (v === 'static' || v === 'input' || v === 'sinput' || v === 'extern') { storage = v; i++ }
      else if (v === 'virtual') i++;
      else break;
    }
    tscope.push(tp);
    let t: TypeRef;
    try { t = type() } finally { tscope.pop() }
    if (is('operator')) fail('Operator overloading is not supported');
    // Type C::name(...) / Type C::static_member = ...
    if (isName() && (is('::', 1) || (is('<', 1) && tmplClasses.has(peek().v)))) {
      const c = next().v;
      if (is('<')) typeArgs();
      expect('::');
      if (is('operator')) fail('Operator overloading is not supported');
      const n = ident('a member name');
      if (is('(')) return [funcRest(t0, t, n.v, c, 'fn', tp)];
      i--;
      const list = declarators(t, '', c);
      endDecl(list);
      return [{ k: 'vars', pos: pos(t0), list }];
    }
    if (isName() && is('(', 1)) {
      i++;
      const pa = paramsAhead();
      i--;
      if (pa || tp.length) {
        const n = next().v;
        if (tp.length) tmplFns.add(n);
        return [funcRest(t0, t, n, '', 'fn', tp)];
      }
    }
    const list = declarators(t, storage);
    endDecl(list);
    return [{ k: 'vars', pos: pos(t0), list }];
  }

  // ── statements ──
  function blockBody(): Stmt[] {
    expect('{');
    const out: Stmt[] = [];
    while (!is('}')) {
      if (peek().t === 'eof') fail("Expected '}' but found end of file");
      out.push(statement());
    }
    i++;
    return out;
  }
  function varStmt(): Stmt {
    const t0 = peek();
    let storage: Storage = '';
    while (is('static') || is('input') || is('extern') || is('sinput')) { storage = next().v as Storage }
    if (storage && storage !== 'static') fail(`'${storage}' variables must be declared at global scope`, t0);
    return { k: 'vars', pos: pos(t0), list: declarators(type(), storage) };
  }
  function statement(): Stmt {
    const t = peek(), p = pos(t);
    if (is('{')) return { k: 'block', pos: p, body: blockBody() };
    if (is(';')) { i++; return { k: 'empty', pos: p } }
    if (t.t === 'id') switch (t.v) {
      case 'if': {
        i++; expect('('); const c = expr(); expect(')');
        const a = statement();
        return { k: 'if', pos: p, c, a, b: is('else') ? (i++, statement()) : null };
      }
      case 'while': { i++; expect('('); const c = expr(); expect(')'); return { k: 'while', pos: p, c, body: statement() } }
      case 'do': {
        i++; const body = statement();
        expect('while'); expect('('); const c = expr(); expect(')'); expect(';');
        return { k: 'do', pos: p, body, c };
      }
      case 'for': {
        i++; expect('(');
        let init: Stmt | null = null;
        if (!is(';')) init = declAhead() ? varStmt() : { k: 'expr', pos: pos(peek()), e: expr() };
        expect(';');
        const c = is(';') ? null : expr();
        expect(';');
        const step = is(')') ? null : expr();
        expect(')');
        return { k: 'for', pos: p, init, c, step, body: statement() };
      }
      case 'switch': {
        i++; expect('('); const e = expr(); expect(')'); expect('{');
        const cases: Case[] = [];
        while (!is('}')) {
          const c0 = peek();
          let test: Expr | null = null;
          if (is('case')) { i++; test = cond() }
          else if (is('default')) i++;
          else if (!cases.length) fail(`Expected 'case' or 'default' but found ${desc(c0)}`);
          else { cases[cases.length - 1].body.push(statement()); continue }
          expect(':');
          cases.push({ pos: pos(c0), test, body: [] });
        }
        i++;
        return { k: 'switch', pos: p, e, cases };
      }
      case 'break': i++; expect(';'); return { k: 'break', pos: p };
      case 'continue': i++; expect(';'); return { k: 'continue', pos: p };
      case 'return': { i++; const e = is(';') ? null : expr(); expect(';'); return { k: 'return', pos: p, e } }
      case 'delete': { i++; if (is('[')) { i++; expect(']') } const e = expr(); expect(';'); return { k: 'delete', pos: p, e } }
      case 'else': fail("'else' without a matching 'if'");
      case 'case': case 'default': fail(`'${t.v}' outside of a switch`);
      case 'struct': case 'class': case 'enum': case 'typedef': fail(`'${t.v}' declarations are only supported at global scope`);
    }
    if (declAhead()) { const s = varStmt(); if (s.k === 'vars') endDecl(s.list); return s }
    const e = expr();
    expect(';', "';' after the expression");
    return { k: 'expr', pos: p, e };
  }

  // ── expressions ──
  function args(): Expr[] {   // up to (not consuming) ')'
    const out: Expr[] = [];
    if (!is(')')) do out.push(assign()); while (is(',') && ++i);
    return out;
  }
  function initExpr(): Expr {
    if (!is('{')) return assign();
    const t0 = next(), list: Expr[] = [];
    while (!is('}')) { list.push(initExpr()); if (!is(',')) break; i++ }
    expect('}', "'}' to close the initializer list");
    return { k: 'init', pos: pos(t0), list };
  }
  function expr(): Expr {
    const e = assign();
    if (!is(',')) return e;
    const list = [e];
    while (is(',')) { i++; list.push(assign()) }
    return { k: 'comma', pos: e.pos, list };
  }
  function assign(): Expr {
    const a = cond(), t = peek();
    if (t.t === 'op' && ASSIGN.has(t.v)) { i++; return { k: 'assign', pos: pos(t), op: t.v, a, b: is('{') ? initExpr() : assign() } }
    return a;
  }
  function cond(): Expr {
    const c = bin(0);
    if (!is('?')) return c;
    i++;
    const a = assign();
    expect(':', "':' in the conditional expression");
    return { k: 'cond', pos: c.pos, c, a, b: assign() };
  }
  function bin(min: number): Expr {
    let a = unary();
    for (;;) {
      const t = peek(), p = t.t === 'op' ? PREC[t.v] : undefined;
      if (p == null || p <= min) return a;
      i++;
      a = { k: 'bin', pos: pos(t), op: t.v, a, b: bin(p) };
    }
  }
  function castAhead(): boolean {   // peek() is '('
    const t = peek(1);
    if (t.t !== 'id') return false;
    if (t.v === 'const') return true;
    if (!isType(t.v) || is('(', 2)) return false;
    let o = 2;
    if (is('<', o) && tmplClasses.has(t.v)) return true;
    while (is('*', o) || is('&', o)) o++;
    return is(')', o);
  }
  function unary(): Expr {
    const t = peek(), p = pos(t);
    if (t.t === 'op') {
      if (t.v === '!' || t.v === '-' || t.v === '+' || t.v === '~' || t.v === '++' || t.v === '--' || t.v === '*' || t.v === '&') { i++; return { k: 'unary', pos: p, op: t.v, e: unary() } }
      if (t.v === '(' && castAhead()) { i++; const ty = type(); expect(')'); return { k: 'cast', pos: p, t: ty, e: unary(), dyn: false } }
    }
    if (is('new')) {
      i++;
      const ty = type();
      let a: Expr[] = [];
      if (is('(')) { i++; a = args(); expect(')') }
      if (is('[')) fail("'new' arrays are not supported in MQL; use a dynamic array and ArrayResize");
      return { k: 'new', pos: p, t: ty, args: a };
    }
    if (is('sizeof')) {
      i++; expect('(');
      const tn = peek();
      const isT = tn.t === 'id' && isType(tn.v) && (is(')', 1) || is('*', 1) || is('<', 1));
      const r: Expr = isT ? { k: 'sizeof', pos: p, t: type(), e: null } : { k: 'sizeof', pos: p, t: null, e: expr() };
      expect(')');
      return r;
    }
    return postfix(primary());
  }
  function postfix(e: Expr): Expr {
    for (;;) {
      const t = peek(), p = pos(t);
      if (is('(')) { i++; const a = args(); expect(')', "')' to close the argument list"); e = { k: 'call', pos: e.pos, fn: e, args: a } }
      else if (is('[')) { i++; const ix = expr(); expect(']'); e = { k: 'index', pos: p, e, i: ix } }
      else if (is('.') || is('->')) {
        i++;
        const n = peek();
        if (n.t !== 'id') fail(`Expected a member name but found ${desc(n)}`);
        i++;
        e = { k: 'member', pos: pos(n), e, name: n.v };
      } else if (is('++') || is('--')) { i++; e = { k: 'post', pos: p, op: t.v, e } }
      else return e;
    }
  }
  function primary(): Expr {
    const t = peek(), p = pos(t);
    if (t.t === 'num') { i++; return { k: 'num', pos: p, v: t.n, float: t.float } }
    if (t.t === 'str') { let s = next().v; while (peek().t === 'str') s += next().v; return { k: 'str', pos: p, v: s } }
    if (is('(')) { i++; const e = expr(); expect(')'); return e }
    if (is('{')) return initExpr();
    if (is('::')) { i++; return { k: 'scope', pos: p, cls: '', name: ident().v } }
    if (t.t === 'id') {
      if (t.v === 'this') { i++; return { k: 'this', pos: p } }
      if (t.v === 'dynamic_cast' && is('<', 1)) {
        i += 2; const ty = type(); closeAngle(); expect('('); const e = expr(); expect(')');
        return { k: 'cast', pos: p, t: ty, e, dyn: true };
      }
      if (PRIMS.has(t.v) && is('(', 1)) {
        const ty = type(); i++;
        const e = expr(); expect(')');
        return { k: 'cast', pos: p, t: ty, e, dyn: false };
      }
      if (KW.has(t.v) && !(t.v === 'typename' && is('(', 1))) fail(`Unexpected ${desc(t)} in expression`);
      i++;
      if (is('<') && (tmplFns.has(t.v) || tmplClasses.has(t.v))) typeArgs();
      if (is('::')) {
        i++;
        if (is('~')) fail('Explicit destructor calls are not supported');
        return { k: 'scope', pos: p, cls: t.v, name: ident('a member name').v };
      }
      return { k: 'id', pos: p, name: t.v };
    }
    return fail(t.t === 'eof' ? 'Unexpected end of file' : `Expected an expression but found ${desc(t)}`);
  }

  const out: Decl[] = [];
  while (peek().t !== 'eof') {
    const start = i;
    try { out.push(...topLevel()) }
    catch (e) {
      if (!(e instanceof MqlSyntaxError)) throw e;
      errors.push({ ...e.pos, msg: e.message });
      if (errors.length >= 20) break;
      if (i === start) i++;
      while (peek().t !== 'eof' && !(peek().bol && peek().col === 1)) i++;   // resync at the next line starting in column 1
      while (is('}') || is(';')) i++;
    }
  }
  return out;
}
