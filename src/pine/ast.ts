// Pine Script AST (subset of v5/v6). Produced by parser.ts, executed by interp.ts.
// Every node has a unique numeric `id` (stable per parse) — the interpreter uses Call ids as call-site identity
// for per-call-site state (ta.* history, plot objects, user-function locals).

interface Pos { id: number; line: number; col: number }   // line/col are 1-based

export type Expr =
  | (Pos & { kind: 'Num'; value: number })
  | (Pos & { kind: 'Str'; value: string })
  | (Pos & { kind: 'Bool'; value: boolean })
  | (Pos & { kind: 'Na' })
  | (Pos & { kind: 'Color'; value: string })                         // '#rrggbb' or '#rrggbbaa' as written
  | (Pos & { kind: 'Ident'; name: string })
  | (Pos & { kind: 'Member'; object: Expr; prop: string })            // color.red, ta.sma, syminfo.ticker
  | (Pos & { kind: 'Call'; callee: Expr; typeArgs: string[]; args: Expr[]; named: { name: string; value: Expr }[] })
  | (Pos & { kind: 'Index'; object: Expr; index: Expr })              // history reference x[1]
  | (Pos & { kind: 'Unary'; op: '-' | '+' | 'not'; arg: Expr })
  | (Pos & { kind: 'Binary'; op: BinOp; left: Expr; right: Expr })
  | (Pos & { kind: 'Ternary'; test: Expr; then: Expr; else: Expr })
  | (Pos & { kind: 'Tuple'; items: Expr[] })                          // [a, b] (tuple return or array literal)
  | (Pos & { kind: 'If'; test: Expr; then: Stmt[]; elifs: { test: Expr; body: Stmt[] }[]; else: Stmt[] | null })
  | (Pos & { kind: 'Switch'; subject: Expr | null; cases: { when: Expr | null; body: Stmt[] }[] })   // when null = default (=>)
  | (Pos & { kind: 'For'; var: string; from: Expr; to: Expr; step: Expr | null; body: Stmt[] })
  | (Pos & { kind: 'ForIn'; vars: string[]; iter: Expr; body: Stmt[] })   // for x in arr | for [i, x] in arr
  | (Pos & { kind: 'While'; test: Expr; body: Stmt[] });

export type BinOp = '+' | '-' | '*' | '/' | '%' | '==' | '!=' | '<' | '>' | '<=' | '>=' | 'and' | 'or';
export type AssignOp = ':=' | '+=' | '-=' | '*=' | '/=' | '%=';

export type Stmt =
  | (Pos & { kind: 'VarDecl'; mode: 'var' | 'varip' | null; typeName: string | null; name: string; init: Expr })
  | (Pos & { kind: 'TupleDecl'; names: string[]; init: Expr })         // [a, b] = f()  ('_' allowed as placeholder)
  | (Pos & { kind: 'Assign'; target: string; op: AssignOp; value: Expr })
  | (Pos & { kind: 'FieldAssign'; object: Expr; field: string; op: AssignOp; value: Expr })   // obj.field := v
  | (Pos & { kind: 'ExprStmt'; expr: Expr })
  | (Pos & { kind: 'FuncDecl'; name: string; params: { name: string; typeName: string | null; def: Expr | null }[]; body: Stmt[]; method: boolean; exported: boolean })
  | (Pos & { kind: 'TypeDecl'; name: string; fields: { name: string; typeName: string; def: Expr | null }[]; exported: boolean })
  | (Pos & { kind: 'EnumDecl'; name: string; members: { name: string; title: string }[]; exported: boolean })
  | (Pos & { kind: 'Import'; path: string; alias: string })                // import user/lib/1 as alias
  | (Pos & { kind: 'Break' })
  | (Pos & { kind: 'Continue' });

export interface Program {
  kind: 'Program';
  version: number | null;            // from //@version=N
  body: Stmt[];
}

export class PineSyntaxError extends Error {
  line: number; col: number;
  constructor(message: string, line: number, col: number) { super(message); this.line = line; this.col = col }
}
