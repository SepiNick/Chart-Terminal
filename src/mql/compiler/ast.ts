// MQL AST. Types stay syntactic (TypeRef); codegen resolves them.
export interface Pos { file: string; line: number; col: number }
export interface TypeRef { name: string; args: TypeRef[]; isConst: boolean; ptr: boolean; ref: boolean; pos: Pos }

export type Expr = { pos: Pos } & (
  | { k: 'num'; v: number; float: boolean }
  | { k: 'str'; v: string }
  | { k: 'id'; name: string }
  | { k: 'scope'; cls: string; name: string }   // Cls::name, or ::name (cls '')
  | { k: 'this' }
  | { k: 'unary'; op: string; e: Expr }          // - + ! ~ ++ -- prefix; * & are pointer no-ops
  | { k: 'post'; op: string; e: Expr }
  | { k: 'bin'; op: string; a: Expr; b: Expr }
  | { k: 'assign'; op: string; a: Expr; b: Expr }
  | { k: 'cond'; c: Expr; a: Expr; b: Expr }
  | { k: 'comma'; list: Expr[] }
  | { k: 'call'; fn: Expr; args: Expr[] }
  | { k: 'index'; e: Expr; i: Expr }
  | { k: 'member'; e: Expr; name: string }
  | { k: 'cast'; t: TypeRef; e: Expr; dyn: boolean }
  | { k: 'new'; t: TypeRef; args: Expr[] }
  | { k: 'sizeof'; t: TypeRef | null; e: Expr | null }
  | { k: 'init'; list: Expr[] }
);

export type Storage = '' | 'static' | 'input' | 'sinput' | 'extern';
export interface VarDecl { pos: Pos; t: TypeRef; name: string; cls?: string; dims: (Expr | null)[]; init: Expr | null; ctor: Expr[] | null; storage: Storage; comment?: string; group?: string }

export interface Case { pos: Pos; test: Expr | null; body: Stmt[] }
export type Stmt = { pos: Pos } & (
  | { k: 'vars'; list: VarDecl[] }
  | { k: 'expr'; e: Expr }
  | { k: 'block'; body: Stmt[] }
  | { k: 'if'; c: Expr; a: Stmt; b: Stmt | null }
  | { k: 'while'; c: Expr; body: Stmt }
  | { k: 'do'; body: Stmt; c: Expr }
  | { k: 'for'; init: Stmt | null; c: Expr | null; step: Expr | null; body: Stmt }
  | { k: 'switch'; e: Expr; cases: Case[] }
  | { k: 'break' } | { k: 'continue' } | { k: 'empty' }
  | { k: 'return'; e: Expr | null }
  | { k: 'delete'; e: Expr }
);

export interface Param { pos: Pos; t: TypeRef; name: string; dims: number; def: Expr | null }
export interface CtorInit { pos: Pos; name: string; args: Expr[] }
export interface FuncDecl {
  k: 'func'; pos: Pos; ret: TypeRef; name: string; cls: string; kind: 'fn' | 'ctor' | 'dtor';
  params: Param[]; body: Stmt[] | null; tparams: string[]; isStatic: boolean; isVirtual: boolean; pure: boolean; inits: CtorInit[];
}
export interface ClassDecl {
  k: 'class'; pos: Pos; kind: 'struct' | 'class' | 'interface'; name: string; base: string; tparams: string[];
  fields: VarDecl[]; methods: FuncDecl[]; fwd: boolean;
}
export interface EnumDecl { k: 'enum'; pos: Pos; name: string; items: { pos: Pos; name: string; value: Expr | null }[] }
export interface TypedefDecl { k: 'typedef'; pos: Pos; name: string; t: TypeRef | null; fn: { ret: TypeRef; params: Param[] } | null }
interface GlobalVars { k: 'vars'; pos: Pos; list: VarDecl[] }
export type Decl = FuncDecl | ClassDecl | EnumDecl | TypedefDecl | GlobalVars;

export class MqlSyntaxError extends Error {
  pos: Pos;
  constructor(msg: string, pos: Pos) { super(msg); this.pos = pos }
}
