// Recursive-descent C# parser for the NinjaScript subset (see ast.ts). Errors resync at member and statement level.
import type { Diagnostic } from '../contract.ts';
import {
  CsSyntaxError, type Expr, type Stmt, type Decl, type TypeRef, type Pos, type Attr, type Arg, type Pattern, type Param, type Accessor,
  type Member, type ClassDecl, type EnumDecl, type MethodDecl, type CtorDecl, type Mods, type InitItem, type LParam, type Section, type Catch, type VarItem,
} from './ast.ts';
import { type Tok } from './lexer.ts';

export const PREDEF = new Set(['bool', 'byte', 'sbyte', 'short', 'ushort', 'int', 'uint', 'long', 'ulong', 'char', 'float', 'double', 'decimal', 'string', 'object', 'void']);
const KW = new Set([...PREDEF, 'abstract', 'as', 'base', 'break', 'case', 'catch', 'checked', 'class', 'const', 'continue', 'default', 'delegate', 'do',
  'else', 'enum', 'event', 'explicit', 'extern', 'false', 'finally', 'fixed', 'for', 'foreach', 'goto', 'if', 'implicit', 'in', 'interface', 'internal',
  'is', 'lock', 'namespace', 'new', 'null', 'operator', 'out', 'override', 'params', 'private', 'protected', 'public', 'readonly', 'ref', 'return',
  'sealed', 'sizeof', 'stackalloc', 'static', 'struct', 'switch', 'this', 'throw', 'true', 'try', 'typeof', 'unchecked', 'unsafe', 'using', 'virtual',
  'volatile', 'while']);
const MODS = new Set(['public', 'private', 'protected', 'internal', 'static', 'readonly', 'const', 'virtual', 'override', 'abstract', 'sealed', 'new',
  'extern', 'partial', 'unsafe', 'async', 'volatile', 'required', 'file']);
const ASSIGN = new Set(['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '??=']);
const PREC: Record<string, number> = { '??': 1, '||': 2, '&&': 3, '|': 4, '^': 5, '&': 6, '==': 7, '!=': 7, '<': 8, '>': 8, '<=': 8, '>=': 8, '<<': 9, '>>': 9, '+': 10, '-': 10, '*': 11, '/': 11, '%': 11 };
const REL = 8;
const GENERIC_FOLLOW = new Set(['(', ')', ']', '}', ':', ';', ',', '.', '?', '==', '!=', '|', '^', '&&', '||', '&', '[', '?.', '=>']);
/** NinjaTrader's auto-generated cache classes (ignored). */
const NT_GENERATED = new Set(['Indicator', 'Strategy', 'MarketAnalyzerColumn']);
export const MAX_ERRORS = 20;

class Abort extends Error {}
const desc = (t: Tok) => t.t === 'eof' ? 'end of file' : t.t === 'str' ? `string "${t.v}"` : t.t === 'interp' ? 'interpolated string' : `'${t.v}'`;

export interface ParseResult { decls: Decl[]; usings: string[] }

export function parse(toks: Tok[], errors: Diagnostic[]): ParseResult {
  let T = toks, i = 0;
  const ns: string[] = [], usings: string[] = [];
  const peek = (o = 0) => T[Math.min(i + o, T.length - 1)];
  const next = () => T[i < T.length - 1 ? i++ : i];
  const is = (v: string, o = 0) => { const t = peek(o); return (t.t === 'op' || (t.t === 'id' && !t.verb)) && t.v === v };
  const pos = (t: Tok): Pos => ({ file: t.file, line: t.line, col: t.col });
  const fail = (msg: string, t = peek()): never => { throw new CsSyntaxError(msg, pos(t)) };
  const expect = (v: string, what = `'${v}'`) => is(v) ? next() : fail(`Expected ${what} but found ${desc(peek())}`);
  const isName = (o = 0) => { const t = peek(o); return t.t === 'id' && (t.verb || !KW.has(t.v)) };
  const ident = (what = 'an identifier') => isName() ? next() : fail(`Expected ${what} but found ${desc(peek())}`);
  const adjacent = (o: number, v: string) => is(v, o) && !peek(o).sp && peek(o).line === peek(o - 1).line;

  // ── error recovery ──
  function recover(e: unknown, start: number) {
    if (!(e instanceof CsSyntaxError)) throw e;
    errors.push({ ...e.pos, msg: e.message });
    if (errors.length >= MAX_ERRORS) throw new Abort();
    let j = start, depth = 0;
    for (; T[j].t !== 'eof'; j++) {
      const t = T[j];
      if (t.t !== 'op') continue;
      if (t.v === '{') depth++;
      else if (t.v === '}') { if (depth === 0) break; if (--depth === 0) { j++; if (T[j].v === ';' && T[j].t === 'op') j++; break } }
      else if (t.v === ';' && depth === 0) { j++; break }
    }
    i = Math.max(j, start + 1);
  }

  // ── types ──
  function typeArgs(): TypeRef[] {
    expect('<');
    const out: TypeRef[] = [];
    if (!is('>')) do out.push(type()); while (is(',') && ++i);
    expect('>');
    return out;
  }
  function type(ranks = true): TypeRef {
    const t0 = peek();
    if (is('(')) fail('Tuple types are not supported');
    let name: string, args: TypeRef[] = [];
    const qual: string[] = [];
    if (t0.t === 'id' && !t0.verb && PREDEF.has(t0.v)) { i++; name = t0.v; qual.push(name) }
    else {
      name = ident('a type').v;
      if (is('::')) { i++; name = ident('a type').v }
      qual.push(name);
      if (is('<')) args = typeArgs();
      while (is('.') && isName(1)) { i++; name = next().v; qual.push(name); if (is('<')) args = typeArgs() }
    }
    let nullable = false;
    if (is('?') && !is('?', 1) && (isName(1) || [')', ',', '>', '[', ']', ';', '='].some(v => is(v, 1)) || peek(1).t === 'eof')) { i++; nullable = true }
    const rank: number[] = [];
    while (ranks && is('[') && (is(']', 1) || is(',', 1))) {
      i++;
      let r = 1;
      while (is(',')) { i++; r++ }
      expect(']');
      rank.push(r);
      if (is('?') && (isName(1) || is(')', 1))) i++;
    }
    if (is('*') && (isName(1) || is('*', 1))) fail('Pointer types (unsafe code) are not supported');
    return { name, qual, args, rank, nullable, pos: pos(t0) };
  }
  function tryType(): TypeRef | null {
    const s = i, n = errors.length;
    try { return type() } catch (e) { if (!(e instanceof CsSyntaxError)) throw e; i = s; errors.length = n; return null }
  }

  // ── attributes & modifiers ──
  function attributes(): Attr[] {
    const out: Attr[] = [];
    while (is('[')) {
      i++;
      if (isName() && is(':', 1)) i += 2;
      else if ((is('return') || is('assembly')) && is(':', 1)) i += 2;
      do {
        const p = pos(peek());
        let name = ident('an attribute name').v;
        while (is('.')) { i++; name = ident('an attribute name').v }
        name = name.replace(/Attribute$/, '');
        const a: Attr = { name, args: [], named: {}, pos: p };
        if (is('(')) {
          i++;
          if (!is(')')) do {
            if (isName() && (is('=', 1) || is(':', 1))) { const n = next().v; i++; a.named[n] = cond() }
            else a.args.push(cond());
          } while (is(',') && ++i);
          expect(')');
        }
        out.push(a);
      } while (is(',') && ++i && !is(']'));
      expect(']');
    }
    return out;
  }
  function modifiers(): Mods {
    const m: Mods = new Set();
    for (;;) {
      const t = peek();
      if (t.t !== 'id' || t.verb || !MODS.has(t.v)) break;
      if ((t.v === 'partial' || t.v === 'async' || t.v === 'required' || t.v === 'file') && !(isName(1) || peek(1).t === 'id')) break;
      if (t.v === 'unsafe') fail('Unsafe code is not supported');
      m.add(t.v); i++;
    }
    return m;
  }

  // ── declarations ──
  function nsBody(out: Decl[], braced: boolean) {
    while (peek().t !== 'eof' && !(braced && is('}'))) {
      const s = i;
      try { nsMember(out) } catch (e) { recover(e, s) }
    }
  }
  function qualName(): string {
    let n = ident('a name').v;
    while (is('.')) { i++; n += '.' + ident('a name').v }
    return n;
  }
  function nsMember(out: Decl[]) {
    if (is(';')) { i++; return }
    if (is('global') && is('using', 1)) i++;
    if (is('extern') && is('alias', 1)) { while (!is(';')) i++; i++; return }
    if (is('using')) {
      i++;
      if (is('(')) fail('Top-level statements are not supported');
      if (is('static')) i++;
      if (isName() && is('=', 1)) i += 2;
      usings.push(qualName().split('.')[0]);
      if (is('<')) typeArgs();
      expect(';');
      return;
    }
    if (is('namespace')) {
      i++;
      const n = qualName();
      if (is(';')) { i++; ns.push(n); return }   // file-scoped: rest of the file
      expect('{');
      ns.push(n);
      try { nsBody(out, true) } finally { ns.pop() }
      expect('}');
      return;
    }
    const attrs = attributes(), mods = modifiers();
    const d = typeDecl(attrs, mods);
    if (d) out.push(d);
    else if (d === undefined) fail(`Expected a class, struct, interface or enum declaration but found ${desc(peek())}`);
  }
  // null = skipped (NinjaTrader generated code); undefined = not a type declaration
  function typeDecl(attrs: Attr[], mods: Mods): Decl | null | undefined {
    if (is('class') || is('struct') || is('interface')) return classDecl(attrs, mods);
    if (is('enum')) return enumDecl();
    if (is('record')) fail('Records are not supported');
    if (is('delegate')) fail('Delegate type declarations are not supported; use Func<>/Action<>');
    return undefined;
  }
  function skipBraces() {
    expect('{');
    for (let d = 1; d > 0; i++) {
      const t = peek();
      if (t.t === 'eof') fail("Expected '}' but found end of file");
      if (t.t === 'op' && t.v === '{') d++;
      else if (t.t === 'op' && t.v === '}') d--;
    }
  }
  function tparamList(): string[] {
    const out: string[] = [];
    expect('<');
    do { attributes(); if (is('in') || is('out')) i++; out.push(ident('a type parameter').v) } while (is(',') && ++i);
    expect('>');
    return out;
  }
  function skipConstraints() { while (is('where')) { i++; while (!is('{') && !is(';') && !is('=>') && peek().t !== 'eof') i++ } }
  function classDecl(attrs: Attr[], mods: Mods): ClassDecl | null {
    const kw = next(), kind = kw.v as ClassDecl['kind'];
    const name = ident(`a ${kind} name`).v;
    const tparams = is('<') ? tparamList() : [];
    const bases: TypeRef[] = [];
    if (is(':')) { i++; do bases.push(type()); while (is(',') && ++i) }
    skipConstraints();
    const space = ns.join('.');
    if (mods.has('partial') && NT_GENERATED.has(name) && /^NinjaTrader\.NinjaScript\b/.test(space)) { skipBraces(); if (is(';')) i++; return null }
    const c: ClassDecl = { k: 'class', kind, name, mods, attrs, bases, tparams, members: [], ns: space, pos: pos(kw) };
    expect('{');
    while (!is('}')) {
      if (peek().t === 'eof') fail(`Unterminated ${kind} '${name}'`, kw);
      const s = i;
      try { const m = member(c); if (m) c.members.push(m) } catch (e) { recover(e, s) }
    }
    i++;
    if (is(';')) i++;
    return c;
  }
  function enumDecl(): EnumDecl {
    const t0 = expect('enum'), name = ident('an enum name').v;
    if (is(':')) { i++; type() }
    expect('{');
    const items: EnumDecl['items'] = [];
    while (!is('}')) {
      attributes();
      const n = ident('an enum member name');
      items.push({ name: n.v, value: is('=') ? (i++, cond()) : null, pos: pos(n) });
      if (!is(',')) break;
      i++;
    }
    expect('}');
    if (is(';')) i++;
    return { k: 'enum', name, items, ns: ns.join('.'), pos: pos(t0) };
  }
  function paramList(close = ')'): Param[] {
    expect(close === ')' ? '(' : '[');
    const out: Param[] = [];
    if (!is(close)) do {
      attributes();
      const p0 = peek();
      let mod: Param['mod'] = '';
      if (is('ref') || is('out') || is('in') || is('params') || is('this')) mod = next().v as Param['mod'];
      if (is('readonly')) i++;
      const t = type(), name = ident('a parameter name').v;
      out.push({ name, t, mod, def: is('=') ? (i++, cond()) : null, pos: pos(p0) });
    } while (is(',') && ++i);
    expect(close, `'${close}' to close the parameter list`);
    return out;
  }
  function fnBody(): { body: Stmt[] | null; expr: Expr | null } {
    if (is('{')) return { body: blockBody(), expr: null };
    if (is('=>')) { i++; const e = assign(); expect(';'); return { body: null, expr: e } }
    expect(';', "'{' or ';'");
    return { body: null, expr: null };
  }
  function accessors(): { get: Accessor | null; set: Accessor | null } {
    expect('{');
    let get: Accessor | null = null, set: Accessor | null = null;
    while (!is('}')) {
      attributes(); modifiers();
      const t = peek();
      if (!is('get') && !is('set') && !is('init')) fail(`Expected 'get' or 'set' accessor but found ${desc(t)}`);
      i++;
      const b = fnBody(), a: Accessor = { ...b, pos: pos(t) };
      if (t.v === 'get') get = a; else set = a;
    }
    i++;
    return { get, set };
  }
  function member(c: ClassDecl): Member | null {
    const attrs = attributes(), mods = modifiers();
    const m0 = peek(), p = pos(m0);
    const td = typeDecl(attrs, mods);
    if (td !== undefined) return td;
    if (is('event')) fail('Events are not supported');
    if (is('implicit') || is('explicit')) fail('Conversion operators are not supported');
    if (is('~')) { i++; ident(); paramList(); fnBody(); return null }   // finalizer: ignored
    if (isName() && m0.v === c.name && is('(', 1)) {
      i++;
      const params = paramList();
      let init: CtorDecl['init'] = null;
      if (is(':')) {
        i++;
        const k = peek();
        if (!is('base') && !is('this')) fail(`Expected 'base' or 'this' but found ${desc(k)}`);
        i++; expect('(');
        init = { kind: k.v as 'base' | 'this', args: args(')'), pos: pos(k) };
        expect(')');
      }
      return { k: 'ctor', params, init, ...fnBody(), mods, pos: p };
    }
    const t = type();
    if (is('operator')) fail('Operator overloading is not supported');
    if (is('this') && is('[', 1)) {
      i++;
      const params = paramList(']');
      if (is('=>')) { i++; const e = assign(); expect(';'); return { k: 'indexer', t, params, get: { body: null, expr: e, pos: p }, set: null, mods, pos: p } }
      return { k: 'indexer', t, params, ...accessors(), mods, pos: p };
    }
    const nt = ident('a member name');
    let name = nt.v;
    while (is('.') && isName(1)) { i++; name = next().v }   // explicit interface implementation
    if (is('(') || is('<')) {
      const tparams = is('<') ? tparamList() : [];
      const params = paramList();
      skipConstraints();
      return { k: 'method', ret: t, name, params, ...fnBody(), mods, attrs, tparams, pos: pos(nt) };
    }
    if (is('=>')) { i++; const e = assign(); expect(';'); return { k: 'prop', t, name, get: { body: null, expr: e, pos: p }, set: null, init: null, mods, attrs, pos: pos(nt) } }
    if (is('{')) {
      const acc = accessors();
      let init: Expr | null = null;
      if (is('=')) { i++; init = varInit(); expect(';') }
      return { k: 'prop', t, name, ...acc, init, mods, attrs, pos: pos(nt) };
    }
    // fields: each declarator becomes its own member
    c.members.push({ k: 'field', t, name, init: is('=') ? (i++, varInit()) : null, mods, attrs, pos: pos(nt) });
    while (is(',')) {
      i++;
      const n = ident('a field name');
      c.members.push({ k: 'field', t, name: n.v, init: is('=') ? (i++, varInit()) : null, mods, attrs, pos: pos(n) });
    }
    expect(';', "';' after the field declaration");
    return null;
  }

  // ── statements ──
  function blockBody(): Stmt[] {
    expect('{');
    const out: Stmt[] = [];
    while (!is('}')) {
      if (peek().t === 'eof') fail("Expected '}' but found end of file");
      const s = i;
      try { out.push(statement()) } catch (e) { recover(e, s) }
    }
    i++;
    return out;
  }
  function embedded(): Stmt {
    const s = statement();
    if (s.k === 'vars' || s.k === 'localfn') throw new CsSyntaxError('A declaration is not allowed here; use a block', s.pos);
    return s;
  }
  function varInit(): Expr { return is('{') ? arrInit() : assign() }
  function declarators(t: TypeRef, isConst: boolean, p: Pos): Stmt {
    const list: VarItem[] = [];
    do {
      const n = ident('a variable name');
      if (is('[')) fail("Array size cannot be specified in a declaration; use 'new T[n]'");
      list.push({ name: n.v, init: is('=') ? (i++, varInit()) : null, pos: pos(n) });
    } while (is(',') && ++i);
    return { k: 'vars', t, list, isConst, pos: p };
  }
  /** local declaration or local function at statement start, else null (nothing consumed) */
  function declStmt(): Stmt | null {
    const s = i, p = pos(peek());
    let isConst = false;
    if (is('const')) { i++; isConst = true }
    while (is('static') || is('async') || is('unsafe') || is('readonly') || is('ref')) { if (is('unsafe')) fail('Unsafe code is not supported'); i++ }
    if (is('var') && is('(', 1)) fail('Deconstruction is not supported');
    const t = tryType();
    if (t && isName()) {
      if (is('(', 1) || is('<', 1)) {
        const n = next();
        const tparams = is('<') ? tparamList() : [];
        const params = paramList();
        skipConstraints();
        const fn: MethodDecl = { k: 'method', ret: t, name: n.v, params, ...fnBody(), mods: new Set(), attrs: [], tparams, pos: pos(n) };
        if (!fn.body && !fn.expr) fail('Local function must have a body', n);
        return { k: 'localfn', fn, pos: p };
      }
      if (is('=', 1) || is(';', 1) || is(',', 1)) { const d = declarators(t, isConst, p); expect(';', "';' after the declaration"); return d }
    }
    if (isConst) fail(`Expected a constant declaration but found ${desc(peek())}`);
    i = s;
    return null;
  }
  function parenExpr(): Expr { expect('('); const e = expr(); expect(')'); return e }
  function statement(): Stmt {
    const t = peek(), p = pos(t);
    if (is('{')) return { k: 'block', body: blockBody(), pos: p };
    if (is(';')) { i++; return { k: 'empty', pos: p } }
    if (t.t === 'id' && !t.verb) switch (t.v) {
      case 'if': { i++; const c = parenExpr(), a = embedded(); return { k: 'if', c, a, b: is('else') ? (i++, embedded()) : null, pos: p } }
      case 'while': { i++; const c = parenExpr(); return { k: 'while', c, body: embedded(), pos: p } }
      case 'do': { i++; const body = embedded(); expect('while'); const c = parenExpr(); expect(';'); return { k: 'do', body, c, pos: p } }
      case 'for': {
        i++; expect('(');
        const init: Stmt[] = [];
        if (!is(';')) {
          const d = forDecl();
          if (d) init.push(d);
          else do init.push({ k: 'expr', e: assign(), pos: pos(peek()) }); while (is(',') && ++i);
        }
        expect(';');
        const c = is(';') ? null : expr();
        expect(';');
        const step: Expr[] = [];
        if (!is(')')) do step.push(assign()); while (is(',') && ++i);
        expect(')');
        return { k: 'for', init, c, step, body: embedded(), pos: p };
      }
      case 'foreach': {
        i++; expect('(');
        if (is('var') && is('(', 1)) fail('Deconstruction is not supported');
        const ty = type(), name = ident('a loop variable name').v;
        expect('in');
        const e = expr();
        expect(')');
        return { k: 'foreach', t: ty, name, e, body: embedded(), pos: p };
      }
      case 'switch': {
        i++;
        const e = parenExpr();
        expect('{');
        const sections: Section[] = [];
        while (!is('}')) {
          const labels: Section['labels'] = [];
          while (is('case') || (is('default') && is(':', 1))) {
            const l = next();
            if (l.v === 'default') { i++; labels.push({ p: null, when: null, pos: pos(l) }); continue }
            const pt = pattern();
            const when = is('when') ? (i++, expr()) : null;
            expect(':');
            labels.push({ p: pt, when, pos: pos(l) });
          }
          if (!labels.length) fail(`Expected 'case' or 'default' but found ${desc(peek())}`);
          const body: Stmt[] = [];
          while (!is('case') && !(is('default') && is(':', 1)) && !is('}')) {
            if (peek().t === 'eof') fail("Expected '}' but found end of file");
            const s = i;
            try { body.push(statement()) } catch (er) { recover(er, s) }
          }
          sections.push({ labels, body });
        }
        i++;
        return { k: 'switch', e, sections, pos: p };
      }
      case 'break': i++; expect(';'); return { k: 'break', pos: p };
      case 'continue': i++; expect(';'); return { k: 'continue', pos: p };
      case 'return': { i++; const e = is(';') ? null : expr(); expect(';'); return { k: 'return', e, pos: p } }
      case 'throw': { i++; const e = is(';') ? null : expr(); expect(';'); return { k: 'throw', e, pos: p } }
      case 'try': {
        i++;
        const body = blockBody(), catches: Catch[] = [];
        while (is('catch')) {
          const c0 = next();
          let ct: TypeRef | null = null, name: string | null = null;
          if (is('(')) { i++; ct = type(); if (isName()) name = next().v; expect(')') }
          const when = is('when') ? (i++, parenExpr()) : null;
          catches.push({ t: ct, name, when, body: blockBody(), pos: pos(c0) });
        }
        const fin = is('finally') ? (i++, blockBody()) : null;
        if (!catches.length && !fin) fail("Expected 'catch' or 'finally'");
        return { k: 'try', body, catches, fin, pos: p };
      }
      case 'goto': fail("'goto' is not supported");
      case 'yield': if (is('return', 1) || is('break', 1)) fail("Iterators ('yield') are not supported"); break;
      case 'fixed': case 'unsafe': fail('Unsafe code is not supported');
      case 'checked': case 'unchecked': if (is('{', 1)) { i++; return { k: 'block', body: blockBody(), pos: p } } break;
      case 'lock': { i++; const e = parenExpr(); return { k: 'using', decl: { k: 'expr', e, pos: e.pos }, body: embedded(), pos: p } }
      case 'using': {
        if (is('(', 1)) {
          i += 2;
          const d = declStmtNoSemi() ?? { k: 'expr', e: expr(), pos: pos(peek()) } as Stmt;
          expect(')');
          return { k: 'using', decl: d, body: embedded(), pos: p };
        }
        i++;
        const d = declStmt();
        if (!d || d.k !== 'vars') fail('Expected a declaration after using');
        return d!;
      }
      case 'else': fail("'else' without a matching 'if'");
      case 'case': case 'default': if (!is('(', 1)) fail(`'${t.v}' outside of a switch`); break;
      case 'await': fail("'await' is not supported");
    }
    if (isName() && is(':', 1)) { i += 2; return statement() }   // label (unused without goto)
    const d = declStmt();
    if (d) return d;
    const e = expr();
    expect(';', "';' after the expression");
    return { k: 'expr', e, pos: p };
  }
  function forDecl(): Stmt | null {   // `int i = 0, j = 1` in a for header
    const s = i, p = pos(peek());
    const t = tryType();
    if (t && isName() && (is('=', 1) || is(',', 1) || is(';', 1))) return declarators(t, false, p);
    i = s;
    return null;
  }
  function declStmtNoSemi(): Stmt | null {
    const s = i, p = pos(peek());
    const t = tryType();
    if (t && isName() && is('=', 1)) return declarators(t, false, p);
    i = s;
    return null;
  }

  // ── patterns ──
  const ctxKw = (v: string) => { const t = peek(); return t.t === 'id' && !t.verb && t.v === v };
  function pattern(): Pattern {
    let a = andPat();
    while (ctxKw('or')) { const p = pos(next()); a = { k: 'or', a, b: andPat(), pos: p } }
    return a;
  }
  function andPat(): Pattern {
    let a = notPat();
    while (ctxKw('and')) { const p = pos(next()); a = { k: 'and', a, b: notPat(), pos: p } }
    return a;
  }
  function notPat(): Pattern {
    if (ctxKw('not')) { const p = pos(next()); return { k: 'not', p: notPat(), pos: p } }
    return primPat();
  }
  function primPat(): Pattern {
    const t = peek(), p = pos(t);
    if (t.t === 'op' && ['<', '>', '<=', '>='].includes(t.v)) { i++; return { k: 'rel', op: t.v, e: bin(REL), pos: p } }
    if (is('(')) {
      const s = i, n = errors.length;
      try { i++; const r = pattern(); expect(')'); return r } catch (e) { if (!(e instanceof CsSyntaxError)) throw e; i = s; errors.length = n }
    }
    if (ctxKw('var') && isName(1)) { i++; return { k: 'var', name: next().v, pos: p } }
    if (ctxKw('_') && !is('.', 1) && !is('(', 1)) { i++; return { k: 'discard', pos: p } }
    const s = i, ty = tryType();
    if (ty) {
      const d = peek();
      if (isName() && !(d.t === 'id' && !d.verb && ['when', 'and', 'or'].includes(d.v))) { i++; return { k: 'type', t: ty, name: d.v === '_' ? null : d.v, pos: p } }
      if ((PREDEF.has(ty.name) && ty.qual.length === 1) || ty.rank.length || ty.args.length || ty.nullable) return { k: 'type', t: ty, name: null, pos: p };
    }
    i = s;
    return { k: 'const', e: bin(REL), pos: p };
  }

  // ── expressions ──
  function args(close: string): Arg[] {   // up to (not consuming) close
    const out: Arg[] = [];
    if (!is(close)) do {
      let name: string | null = null, mod: Arg['mod'] = '';
      if (isName() && is(':', 1)) { name = next().v; i++ }
      if (is('ref') || is('out') || is('in')) mod = next().v as Arg['mod'];
      if (mod === 'out') {
        const s = i, t = tryType();
        if (t && isName() && (is(',', 1) || is(close, 1))) { const n = next(); out.push({ e: { k: 'id', name: n.v, targs: null, pos: pos(n) }, name, mod, decl: t }); continue }
        i = s;
      }
      out.push({ e: assign(), name, mod, decl: null });
    } while (is(',') && ++i);
    return out;
  }
  function arrInit(): Expr {
    const t0 = expect('{'), list: Expr[] = [];
    while (!is('}')) { list.push(varInit()); if (!is(',')) break; i++ }
    expect('}', "'}' to close the initializer");
    return { k: 'arrinit', list, pos: pos(t0) };
  }
  function objInit(): InitItem[] {
    expect('{');
    const out: InitItem[] = [];
    while (!is('}')) {
      const t = peek(), p = pos(t);
      if (isName() && is('=', 1)) {
        const name = next().v; i++;
        if (is('{')) fail('Nested object/collection initializers are not supported');
        out.push({ k: 'set', name, e: assign(), pos: p });
      } else if (is('[')) {
        i++;
        const a = args(']').map(x => x.e);
        expect(']'); expect('=');
        out.push({ k: 'idx', args: a, e: assign(), pos: p });
      } else if (is('{')) {
        i++;
        const a = args('}').map(x => x.e);
        expect('}');
        out.push({ k: 'add', args: a, pos: p });
      } else out.push({ k: 'add', args: [assign()], pos: p });
      if (!is(',')) break;
      i++;
    }
    expect('}', "'}' to close the initializer");
    return out;
  }
  function expr(): Expr { return assign() }
  function lambdaAhead(): boolean {
    let o = 0;
    if (ctxKw('async') && (isName(1) || is('(', 1))) o = 1;
    if (isName(o) && is('=>', o + 1)) return true;
    if (!is('(', o)) return false;
    let d = 0, j = i + o;
    for (; j < T.length; j++) {
      const x = T[j];
      if (x.t === 'eof') return false;
      if (x.t !== 'op') continue;
      if (x.v === '(') d++;
      else if (x.v === ')' && --d === 0) break;
    }
    return T[j + 1]?.t === 'op' && T[j + 1].v === '=>';
  }
  function lambda(): Expr {
    const p = pos(peek());
    if (ctxKw('async')) i++;
    const params: LParam[] = [];
    if (isName()) { const n = next(); params.push({ name: n.v, t: null, mod: '', pos: pos(n) }) }
    else {
      expect('(');
      if (!is(')')) do {
        const p0 = peek();
        const mod = is('ref') || is('out') || is('in') ? next().v : '';
        if (isName() && (is(',', 1) || is(')', 1))) params.push({ name: next().v, t: null, mod, pos: pos(p0) });
        else { const t = type(); params.push({ name: ident('a parameter name').v, t, mod, pos: pos(p0) }) }
      } while (is(',') && ++i);
      expect(')');
    }
    expect('=>');
    return { k: 'lambda', params, body: is('{') ? blockBody() : assign(), pos: p };
  }
  function assign(): Expr {
    if (lambdaAhead()) return lambda();
    const a = cond(), t = peek();
    if (t.t === 'op' && ASSIGN.has(t.v)) { i++; return { k: 'assign', op: t.v, a, b: assign(), pos: pos(t) } }
    if (is('>') && adjacent(1, '>=')) { i += 2; return { k: 'assign', op: '>>=', a, b: assign(), pos: pos(t) } }
    return a;
  }
  function cond(): Expr {
    const c = bin(0);
    if (!is('?')) return c;
    i++;
    const a = assign();
    expect(':', "':' in the conditional expression");
    return { k: 'cond', c, a, b: assign(), pos: c.pos };
  }
  function bin(min: number): Expr {
    let a = unary();
    for (;;) {
      const t = peek();
      if (t.t === 'id' && !t.verb && (t.v === 'is' || t.v === 'as')) {
        if (REL <= min) return a;
        i++;
        a = t.v === 'is' ? { k: 'is', e: a, p: pattern(), pos: pos(t) } : { k: 'as', e: a, t: type(), pos: pos(t) };
        continue;
      }
      if (t.t !== 'op') return a;
      let op = t.v, n = 1;
      if (op === '>' && adjacent(1, '>=')) return a;
      if (op === '>' && adjacent(1, '>')) { op = '>>'; n = 2 }
      const pr = PREC[op];
      if (pr == null || pr <= min) return a;
      i += n;
      a = { k: 'bin', op, a, b: op === '??' ? bin(pr - 1) : bin(pr), pos: pos(t) };
    }
  }
  function castAhead(): boolean {   // peek() is '('
    const s = i, n = errors.length;
    i++;
    let ok = false;
    try {
      const t = tryType();
      if (t && is(')')) {
        const nx = peek(1);
        if (PREDEF.has(t.name) && t.qual.length === 1) ok = !(nx.t === 'op' && [')', ';', ',', ']', '}', '.', '='].includes(nx.v));
        else ok = (nx.t === 'id' && (nx.verb || !['is', 'as', 'and', 'or', 'when', 'switch', 'with', 'in'].includes(nx.v))) || nx.t === 'num' || nx.t === 'str'
          || nx.t === 'char' || nx.t === 'interp' || (nx.t === 'op' && (nx.v === '(' || nx.v === '!' || nx.v === '~'));
      }
    } finally { i = s; errors.length = n }
    return ok;
  }
  function unary(): Expr {
    const t = peek(), p = pos(t);
    if (t.t === 'op') {
      if (['!', '-', '+', '~', '++', '--'].includes(t.v)) { i++; return { k: 'unary', op: t.v, e: unary(), pos: p } }
      if (t.v === '&' || t.v === '*') fail('Pointers (unsafe code) are not supported');
      if (t.v === '^') fail("Index-from-end '^' is not supported");
      if (t.v === '(' && castAhead()) { i++; const ty = type(); expect(')'); return { k: 'cast', t: ty, e: unary(), pos: p } }
    }
    if (ctxKw('await')) fail("'await' is not supported");
    if (is('throw')) { i++; return { k: 'throw', e: assign(), pos: p } }
    return postfix(primary());
  }
  function memberTargs(): TypeRef[] | null {   // speculative generic arguments after a name
    if (!is('<')) return null;
    const s = i, n = errors.length;
    try {
      const a = typeArgs();
      const nx = peek();
      if ((nx.t === 'op' && GENERIC_FOLLOW.has(nx.v)) || nx.t === 'eof') return a;
    } catch (e) { if (!(e instanceof CsSyntaxError)) throw e }
    i = s; errors.length = n;
    return null;
  }
  function postfix(e: Expr): Expr {
    for (;;) {
      const t = peek(), p = pos(t);
      if (is('(')) { i++; const a = args(')'); expect(')', "')' to close the argument list"); e = { k: 'call', fn: e, args: a, pos: e.pos } }
      else if (is('[')) { i++; const a = args(']'); expect(']'); e = { k: 'index', e, args: a.map(x => x.e), cond: false, pos: p } }
      else if (is('?') && adjacent(1, '[')) { i += 2; const a = args(']'); expect(']'); e = { k: 'index', e, args: a.map(x => x.e), cond: true, pos: p } }
      else if (is('.') || is('?.')) {
        i++;
        const n = peek();
        if (n.t !== 'id') fail(`Expected a member name but found ${desc(n)}`);
        i++;
        e = { k: 'member', e, name: n.v, cond: t.v === '?.', targs: memberTargs(), pos: pos(n) };
      } else if (is('++') || is('--')) { i++; e = { k: 'post', op: t.v, e, pos: p } }
      else if (is('!') && !t.sp && (is('.', 1) || is('[', 1) || is(')', 1) || is(';', 1) || is(',', 1))) i++;   // null-forgiving
      else if (ctxKw('switch') && is('{', 1)) {
        i += 2;
        const arms: { p: Pattern; when: Expr | null; e: Expr; pos: Pos }[] = [];
        while (!is('}')) {
          const a0 = pos(peek()), pt = pattern();
          const when = is('when') ? (i++, expr()) : null;
          expect('=>');
          arms.push({ p: pt, when, e: assign(), pos: a0 });
          if (!is(',')) break;
          i++;
        }
        expect('}');
        e = { k: 'switch', e, arms, pos: p };
      } else if (is('->')) fail('Pointers (unsafe code) are not supported');
      else return e;
    }
  }
  function primary(): Expr {
    const t = peek(), p = pos(t);
    switch (t.t) {
      case 'num': i++; return { k: 'num', v: t.n, suf: t.suf, pos: p };
      case 'str': i++; return { k: 'str', v: t.v, pos: p };
      case 'char': i++; return { k: 'char', v: t.v, pos: p };
      case 'interp': {
        i++;
        const parts = t.parts!.map(x => typeof x === 'string' ? x : { e: sub(x.toks), align: x.align ? sub(x.align) : null, fmt: x.fmt });
        return { k: 'interp', parts, pos: p };
      }
      case 'eof': fail('Unexpected end of file');
    }
    if (is('(')) { i++; const e = expr(); if (is(',')) fail('Tuples are not supported'); expect(')'); return e }
    if (t.t !== 'id') fail(`Expected an expression but found ${desc(t)}`);
    if (!t.verb) switch (t.v) {
      case 'true': case 'false': i++; return { k: 'lit', v: t.v === 'true', pos: p };
      case 'null': i++; return { k: 'lit', v: null, pos: p };
      case 'this': i++; return { k: 'this', pos: p };
      case 'base': i++; return { k: 'base', pos: p };
      case 'typeof': { i++; expect('('); const ty = type(); expect(')'); return { k: 'typeof', t: ty, pos: p } }
      case 'nameof': {
        if (!is('(', 1)) break;
        i += 2;
        const e = expr();
        expect(')');
        const name = e.k === 'id' ? e.name : e.k === 'member' ? e.name : fail('Invalid nameof argument', t);
        return { k: 'nameof', name, pos: p };
      }
      case 'default':
        i++;
        if (is('(')) { i++; const ty = type(); expect(')'); return { k: 'default', t: ty, pos: p } }
        return { k: 'default', t: null, pos: p };
      case 'checked': case 'unchecked': i++; return parenExpr();
      case 'new': return newExpr();
      case 'sizeof': case 'stackalloc': fail('Unsafe code is not supported');
      case 'delegate': fail('Anonymous methods are not supported; use a lambda');
      case 'from':
        if (isName(1) && (is('in', 2) || (isName(2) && is('in', 3)))) fail('LINQ query syntax is not supported');
        break;
    }
    if (!t.verb && KW.has(t.v) && !PREDEF.has(t.v)) fail(`Unexpected ${desc(t)} in expression`);
    i++;
    return { k: 'id', name: t.v, targs: PREDEF.has(t.v) ? null : memberTargs(), pos: p };
  }
  function newExpr(): Expr {
    const p = pos(next());
    if (is('[')) {
      i++;
      let r = 1;
      while (is(',')) { i++; r++ }
      expect(']');
      if (!is('{')) fail("Expected an array initializer after 'new[]'");
      return { k: 'newarr', t: null, sizes: [], rank: [r], init: arrInit(), pos: p };
    }
    if (is('(')) { i++; const a = args(')'); expect(')'); return { k: 'new', t: null, args: a, init: is('{') ? objInit() : null, pos: p } }
    if (is('{')) fail('Anonymous types are not supported');
    const t = type(false);
    if (is('[')) {
      i++;
      const sizes: Expr[] = [];
      let r = 1;
      if (is(']') || is(',')) while (is(',')) { i++; r++ }
      else { do sizes.push(expr()); while (is(',') && ++i); r = sizes.length }
      expect(']');
      const rank = [r];
      while (is('[') && (is(']', 1) || is(',', 1))) { i++; let q = 1; while (is(',')) { i++; q++ } expect(']'); rank.push(q) }
      const init = is('{') ? arrInit() : null;
      if (!sizes.length && !init) fail('Array creation must have an array size or an initializer');
      return { k: 'newarr', t, sizes, rank, init, pos: p };
    }
    let a: Arg[] = [];
    if (is('(')) { i++; a = args(')'); expect(')') }
    else if (!is('{')) fail(`Expected '(' or '{' after 'new ${t.name}' but found ${desc(peek())}`);
    return { k: 'new', t, args: a, init: is('{') ? objInit() : null, pos: p };
  }
  function sub(toks: Tok[]): Expr {   // parse an interpolation hole's tokens
    const sT = T, si = i;
    T = toks; i = 0;
    try {
      const e = expr();
      if (peek().t !== 'eof') fail(`Unexpected ${desc(peek())} in interpolation`);
      return e;
    } finally { T = sT; i = si }
  }

  const out: Decl[] = [];
  try { nsBody(out, false) } catch (e) { if (!(e instanceof Abort)) throw e }
  return { decls: out, usings };
}

