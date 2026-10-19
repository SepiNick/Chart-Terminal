// Recursive-descent Pine Script parser (v5/v6 subset) producing the AST in ast.ts.
import { PineSyntaxError, type Expr, type Stmt, type Program, type BinOp, type AssignOp } from './ast.ts';
import { lex, type Tok } from './lexer.ts';

const ASSIGN = new Set([':=', '+=', '-=', '*=', '/=', '%=']);
const QUALS = new Set(['series', 'simple', 'const']);
const LEVELS = [['or'], ['and'], ['==', '!='], ['<', '>', '<=', '>='], ['+', '-'], ['*', '/', '%']];   // low → high
type Param = { name: string; typeName: string | null; def: Expr | null };

const desc = (t: Tok) => t.type === 'nl' ? 'end of line' : t.type === 'indent' ? 'indentation' : t.type === 'dedent'
  ? 'end of block' : t.type === 'eof' ? 'end of script' : t.type === 'str' ? `string "${t.value}"` : `'${t.value}'`;

export function parse(src: string): Program {
  const { tokens: T, version } = lex(src);
  let i = 0, nid = 0;
  const peek = (o = 0) => T[Math.min(i + o, T.length - 1)];
  const next = () => T[i++];
  const is = (v: string, o = 0) => { const t = peek(o); return (t.type === 'op' || t.type === 'kw') && t.value === v };
  const isT = (type: Tok['type'], o = 0) => peek(o).type === type;
  const at = (p: { line: number; col: number }) => ({ id: ++nid, line: p.line, col: p.col });
  const fail = (msg: string, t = peek()): never => { throw new PineSyntaxError(msg, t.line, t.col) };
  const expect = (v: string, what = `'${v}'`) => is(v) ? next() : fail(`Expected ${what} but found ${desc(peek())}`);
  const ident = (what = 'an identifier') => isT('ident') ? next() : fail(`Expected ${what} but found ${desc(peek())}`);
  const list = <R>(item: () => R, close: string): R[] => {   // comma list up to (not consuming) `close`
    const out: R[] = [];
    if (!is(close)) do out.push(item()); while (is(',') && ++i);
    return out;
  };

  // ── statements ──
  function stmts(): Stmt[] {
    const out: Stmt[] = [];
    for (;;) {
      while (isT('nl')) i++;
      if (isT('dedent') || isT('eof')) return out;
      out.push(statement());
      endStmt();
    }
  }
  function endStmt() {
    if (T[i - 1].type !== 'dedent' && !isT('nl') && !isT('dedent') && !isT('eof')) fail(`Unexpected ${desc(peek())}`);
  }
  function block(): Stmt[] {   // nl indent stmt* dedent
    if (!isT('nl') || !isT('indent', 1)) fail(`Expected an indented block but found ${desc(peek())}`);
    i += 2;
    const body = stmts();
    i++;   // dedent (lexer always balances them before eof)
    return body;
  }
  const body = () => isT('nl') ? block() : [statement()];   // after `=>`: block or single statement

  function statement(): Stmt {
    const t = peek();
    if (t.type === 'ident') {
      const v = t.value, n1 = peek(1);
      if (v === 'import') fail("'import' is not supported yet", t);
      if ((v === 'type' || v === 'enum') && n1.type === 'ident') fail(`'${v}' declarations are not supported yet`, t);
      if (v === 'export') {
        if (n1.value === 'type' || n1.value === 'enum') fail(`'export ${n1.value}' is not supported yet`, n1);
        i++;
        const m = isMethod();
        if (m) i++;
        else if (!(isT('ident') && arrowAfter(i + 1))) fail("Expected a function after 'export'");
        return funcDecl(t, m, true);
      }
      if (isMethod()) { i++; return funcDecl(t, true, false) }
      if (is('(', 1) && arrowAfter(i + 1)) return funcDecl(t, false, false);
      if (n1.type === 'op' && ASSIGN.has(n1.value)) {
        i += 2;
        return { ...at(t), kind: 'Assign', target: v, op: n1.value as AssignOp, value: expr() };
      }
      const d = varDecl(t, null);
      if (d) return d;
    }
    if (is('var') || is('varip')) {
      i++;
      return varDecl(t, t.value as 'var' | 'varip') ?? fail(`Expected a variable declaration after '${t.value}'`);
    }
    if (is('[')) { const d = tupleDecl(t); if (d) return d }
    if (is('break')) { i++; return { ...at(t), kind: 'Break' } }
    if (is('continue')) { i++; return { ...at(t), kind: 'Continue' } }
    return { ...at(t), kind: 'ExprStmt', expr: expr() };
  }
  const isMethod = () => peek().value === 'method' && isT('ident') && isT('ident', 1) && is('(', 2);
  function arrowAfter(j: number): boolean {   // T[j] is '(' — is its matching ')' followed by '=>'?
    for (let d = 0; j < T.length; j++) {
      const t = T[j];
      if (t.type !== 'op') continue;
      if (t.value === '(' || t.value === '[') d++;
      else if ((t.value === ')' || t.value === ']') && --d === 0) return T[j + 1]?.type === 'op' && T[j + 1].value === '=>';
    }
    return false;
  }
  // `x = e`, `float x = e`, `series array<float> x = e` (mode set by var/varip); null (position restored) if not a decl
  function varDecl(start: Tok, mode: 'var' | 'varip' | null): Stmt | null {
    const save = i;
    let typeName: string | null = null;
    if (!(isT('ident') && is('=', 1))) {
      if (isT('ident') && QUALS.has(peek().value) && isT('ident', 1)) i++;
      typeName = type();
      if (!typeName || !isT('ident') || !is('=', 1)) { i = save; return null }
    }
    const name = next().value;
    i++;
    return { ...at(start), kind: 'VarDecl', mode, typeName, name, init: expr() };
  }
  function tupleDecl(start: Tok): Stmt | null {
    const save = i++, names: string[] = [];
    while (isT('ident')) { names.push(next().value); if (!is(',')) break; i++ }
    if (names.length && is(']') && is('=', 1)) { i += 2; return { ...at(start), kind: 'TupleDecl', names, init: expr() } }
    i = save;
    return null;
  }
  // type as written: float, chart.point, array<float>, map<string, int>, float[] — null on mismatch (caller restores)
  function type(): string | null {
    if (!isT('ident')) return null;
    let s = next().value;
    while (is('.') && isT('ident', 1)) { i++; s += '.' + next().value }
    if (is('<')) { i++; const a = typeArgs(); if (!a) return null; s += `<${a.join(', ')}>` }
    if (is('[') && is(']', 1)) { i += 2; s += '[]' }
    return s;
  }
  function typeArgs(): string[] | null {   // after '<', consumes through '>'
    const out: string[] = [];
    do { const a = type(); if (!a) return null; out.push(a) } while (is(',') && ++i);
    return is('>') ? (i++, out) : null;
  }
  function funcDecl(start: Tok, method: boolean, exported: boolean): Stmt {
    const name = ident('a function name').value;
    expect('(');
    const params = list(param, ')');
    expect(')', "')' to close the parameter list");
    expect('=>');
    return { ...at(start), kind: 'FuncDecl', name, params, body: body(), method, exported };
  }
  function param(): Param {
    const save = i;
    if (isT('ident') && QUALS.has(peek().value) && isT('ident', 1)) i++;
    let typeName = type();
    if (!typeName || !isT('ident')) { i = save; typeName = null }
    const name = ident('a parameter name').value;
    return { name, typeName, def: is('=') ? (i++, expr()) : null };
  }

  // ── expressions ──
  function expr(): Expr {   // ternary, right-assoc
    const test = binary(0);
    if (!is('?')) return test;
    i++;
    const then = expr();
    expect(':', "':' in ternary");
    return { ...at(test), kind: 'Ternary', test, then, else: expr() };
  }
  function binary(lv: number): Expr {
    if (lv === LEVELS.length) return unary();
    let left = binary(lv + 1);
    while (LEVELS[lv].some(o => is(o))) {
      const op = next().value as BinOp;
      left = { ...at(left), kind: 'Binary', op, left, right: binary(lv + 1) };
    }
    return left;
  }
  function unary(): Expr {
    const t = peek();
    if (is('-') || is('+') || is('not')) { i++; return { ...at(t), kind: 'Unary', op: t.value as '-' | '+' | 'not', arg: unary() } }
    return postfix();
  }
  function postfix(): Expr {
    let e = primary();
    for (;;) {
      if (is('.')) {
        i++;
        const p = peek();
        if (p.type !== 'ident' && p.type !== 'kw') fail(`Expected a member name after '.' but found ${desc(p)}`);
        i++;
        e = { ...at(e), kind: 'Member', object: e, prop: p.value };
      } else if (is('[')) {
        i++;
        const index = expr();
        expect(']');
        e = { ...at(e), kind: 'Index', object: e, index };
      } else if (is('(')) e = call(e, []);
      else if (is('<') && (e.kind === 'Member' || e.kind === 'Ident')) {   // generics: array.new<float>(…)
        const save = i++, ta = typeArgs();
        if (ta && is('(')) e = call(e, ta);
        else { i = save; return e }
      } else return e;
    }
  }
  function call(callee: Expr, typeArgs: string[]): Expr {
    i++;
    const args: Expr[] = [], named: { name: string; value: Expr }[] = [];
    list(() => {
      if (isT('ident') && is('=', 1)) { const name = next().value; i++; named.push({ name, value: expr() }) }
      else if (named.length) fail('Positional argument cannot follow a named argument');
      else args.push(expr());
    }, ')');
    expect(')', "')' to close the call");
    return { ...at(callee), kind: 'Call', callee, typeArgs, args, named };
  }
  function primary(): Expr {
    const t = peek();
    if (t.type === 'num') { i++; return { ...at(t), kind: 'Num', value: +t.value } }
    if (t.type === 'str') { i++; return { ...at(t), kind: 'Str', value: t.value } }
    if (t.type === 'color') { i++; return { ...at(t), kind: 'Color', value: t.value } }
    if (t.type === 'ident' || (t.value === 'na' && is('(', 1))) { i++; return { ...at(t), kind: 'Ident', name: t.value } }
    if (t.type === 'kw') switch (t.value) {
      case 'true': case 'false': i++; return { ...at(t), kind: 'Bool', value: t.value === 'true' };
      case 'na': i++; return { ...at(t), kind: 'Na' };
      case 'if': return ifExpr();
      case 'switch': return switchExpr();
      case 'for': return forExpr();
      case 'while': { i++; const test = expr(); return { ...at(t), kind: 'While', test, body: block() } }
    }
    if (is('(')) { i++; const e = expr(); expect(')'); return e }
    if (is('[')) { i++; const items = list(expr, ']'); expect(']'); return { ...at(t), kind: 'Tuple', items } }
    return fail(`Unexpected ${desc(t)}`);
  }
  function ifExpr(): Expr {
    const t = next(), test = expr(), then = block(), elifs: { test: Expr; body: Stmt[] }[] = [];
    let els: Stmt[] | null = null;
    while (is('else')) {
      i++;
      if (is('if')) { i++; const test = expr(); elifs.push({ test, body: block() }) }
      else { els = block(); break }
    }
    return { ...at(t), kind: 'If', test, then, elifs, else: els };
  }
  function switchExpr(): Expr {
    const t = next(), subject = isT('nl') ? null : expr(), cases: { when: Expr | null; body: Stmt[] }[] = [];
    if (!isT('nl') || !isT('indent', 1)) fail(`Expected indented switch cases but found ${desc(peek())}`);
    for (i += 2; ;) {
      while (isT('nl')) i++;
      if (isT('dedent')) { i++; break }
      const when = is('=>') ? null : expr();
      expect('=>', "'=>' after switch case");
      cases.push({ when, body: body() });
      endStmt();
    }
    return { ...at(t), kind: 'Switch', subject, cases };
  }
  function forExpr(): Expr {
    const t = next();
    if (is('[')) {
      i++;
      const vars = list(() => ident('a loop variable').value, ']');
      expect(']');
      expect('in');
      const iter = expr();
      return { ...at(t), kind: 'ForIn', vars, iter, body: block() };
    }
    const v = ident('a loop variable').value;
    if (is('in')) { i++; const iter = expr(); return { ...at(t), kind: 'ForIn', vars: [v], iter, body: block() } }
    expect('=', "'=' or 'in' after the loop variable");
    const from = expr();
    expect('to', "'to' in for loop");
    const to = expr(), step = is('by') ? (i++, expr()) : null;
    return { ...at(t), kind: 'For', var: v, from, to, step, body: block() };
  }

  const prog: Program = { kind: 'Program', version, body: stmts() };
  if (!isT('eof')) fail(`Unexpected ${desc(peek())}`);
  return prog;
}
