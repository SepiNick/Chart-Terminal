// C# (NinjaScript subset) AST. Types stay syntactic (TypeRef); codegen resolves them.
export interface Pos { file: string; line: number; col: number }
/** name = last segment of the qualified name; rank = array rank specifiers outermost first ([1] = T[], [2] = T[,], [1,1] = T[][]). */
export interface TypeRef { name: string; qual: string[]; args: TypeRef[]; rank: number[]; nullable: boolean; pos: Pos }
export interface Attr { name: string; args: Expr[]; named: Record<string, Expr>; pos: Pos }
export interface Arg { e: Expr; name: string | null; mod: '' | 'ref' | 'out' | 'in'; decl: TypeRef | null }   // decl: `out var x` / `out T x`
export interface LParam { name: string; t: TypeRef | null; mod: string; pos: Pos }
export type InitItem = { pos: Pos } & ({ k: 'set'; name: string; e: Expr } | { k: 'idx'; args: Expr[]; e: Expr } | { k: 'add'; args: Expr[] });

export type Pattern = { pos: Pos } & (
  | { k: 'const'; e: Expr }                         // constant (or a type name, decided by codegen)
  | { k: 'type'; t: TypeRef; name: string | null }
  | { k: 'var'; name: string }
  | { k: 'discard' }
  | { k: 'rel'; op: string; e: Expr }
  | { k: 'and' | 'or'; a: Pattern; b: Pattern }
  | { k: 'not'; p: Pattern }
);

export type Hole = { e: Expr; align: Expr | null; fmt: string | null };
export type Expr = { pos: Pos } & (
  | { k: 'num'; v: number; suf: string }            // suf: int long uint ulong double float decimal
  | { k: 'str'; v: string }
  | { k: 'char'; v: string }
  | { k: 'interp'; parts: (string | Hole)[] }
  | { k: 'lit'; v: boolean | null }
  | { k: 'id'; name: string; targs: TypeRef[] | null }
  | { k: 'member'; e: Expr; name: string; cond: boolean; targs: TypeRef[] | null }
  | { k: 'call'; fn: Expr; args: Arg[] }
  | { k: 'index'; e: Expr; args: Expr[]; cond: boolean }
  | { k: 'unary'; op: string; e: Expr }
  | { k: 'post'; op: string; e: Expr }
  | { k: 'bin'; op: string; a: Expr; b: Expr }
  | { k: 'assign'; op: string; a: Expr; b: Expr }
  | { k: 'cond'; c: Expr; a: Expr; b: Expr }
  | { k: 'cast'; t: TypeRef; e: Expr }
  | { k: 'as'; e: Expr; t: TypeRef }
  | { k: 'is'; e: Expr; p: Pattern }
  | { k: 'new'; t: TypeRef | null; args: Arg[]; init: InitItem[] | null }
  | { k: 'newarr'; t: TypeRef | null; sizes: Expr[]; rank: number[]; init: Expr | null }   // t = element type
  | { k: 'arrinit'; list: Expr[] }
  | { k: 'lambda'; params: LParam[]; body: Expr | Stmt[] }
  | { k: 'typeof'; t: TypeRef }
  | { k: 'nameof'; name: string }
  | { k: 'default'; t: TypeRef | null }
  | { k: 'this' } | { k: 'base' }
  | { k: 'switch'; e: Expr; arms: { p: Pattern; when: Expr | null; e: Expr; pos: Pos }[] }
  | { k: 'throw'; e: Expr }
);

export interface VarItem { name: string; init: Expr | null; pos: Pos }
export interface Section { labels: { p: Pattern | null; when: Expr | null; pos: Pos }[]; body: Stmt[] }
export interface Catch { t: TypeRef | null; name: string | null; when: Expr | null; body: Stmt[]; pos: Pos }
export type Stmt = { pos: Pos } & (
  | { k: 'vars'; t: TypeRef; list: VarItem[]; isConst: boolean }
  | { k: 'expr'; e: Expr }
  | { k: 'block'; body: Stmt[] }
  | { k: 'if'; c: Expr; a: Stmt; b: Stmt | null }
  | { k: 'while'; c: Expr; body: Stmt }
  | { k: 'do'; body: Stmt; c: Expr }
  | { k: 'for'; init: Stmt[]; c: Expr | null; step: Expr[]; body: Stmt }
  | { k: 'foreach'; t: TypeRef; name: string; e: Expr; body: Stmt }
  | { k: 'switch'; e: Expr; sections: Section[] }
  | { k: 'break' } | { k: 'continue' } | { k: 'empty' }
  | { k: 'return'; e: Expr | null }
  | { k: 'throw'; e: Expr | null }
  | { k: 'try'; body: Stmt[]; catches: Catch[]; fin: Stmt[] | null }
  | { k: 'localfn'; fn: MethodDecl }
  | { k: 'using'; decl: Stmt | null; body: Stmt }      // using (...) / lock (...): body only
);

export type Mods = Set<string>;
export interface Param { name: string; t: TypeRef; mod: '' | 'ref' | 'out' | 'in' | 'params' | 'this'; def: Expr | null; pos: Pos }
export interface Accessor { body: Stmt[] | null; expr: Expr | null; pos: Pos }   // both null → auto accessor
export interface FieldDecl { k: 'field'; t: TypeRef; name: string; init: Expr | null; mods: Mods; attrs: Attr[]; pos: Pos }
export interface PropDecl { k: 'prop'; t: TypeRef; name: string; get: Accessor | null; set: Accessor | null; init: Expr | null; mods: Mods; attrs: Attr[]; pos: Pos }
export interface MethodDecl { k: 'method'; ret: TypeRef; name: string; params: Param[]; body: Stmt[] | null; expr: Expr | null; mods: Mods; attrs: Attr[]; tparams: string[]; pos: Pos }
export interface CtorDecl { k: 'ctor'; params: Param[]; init: { kind: 'base' | 'this'; args: Arg[]; pos: Pos } | null; body: Stmt[] | null; expr: Expr | null; mods: Mods; pos: Pos }
export interface IndexerDecl { k: 'indexer'; t: TypeRef; params: Param[]; get: Accessor | null; set: Accessor | null; mods: Mods; pos: Pos }
export interface ClassDecl { k: 'class'; kind: 'class' | 'struct' | 'interface'; name: string; mods: Mods; attrs: Attr[]; bases: TypeRef[]; tparams: string[]; members: Member[]; ns: string; pos: Pos }
export interface EnumDecl { k: 'enum'; name: string; items: { name: string; value: Expr | null; pos: Pos }[]; ns: string; pos: Pos }
export type Member = FieldDecl | PropDecl | MethodDecl | CtorDecl | IndexerDecl | ClassDecl | EnumDecl;
export type Decl = ClassDecl | EnumDecl;

export class CsSyntaxError extends Error {
  pos: Pos;
  constructor(msg: string, pos: Pos) { super(msg); this.pos = pos }
}
