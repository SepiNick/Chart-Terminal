// NinjaScript (C#) → JS compiler: lex → parse → codegen. See ../contract.ts for the generated-code conventions.
import type { Diagnostic, NtCompileOptions, NtCompileResult, Rt } from '../contract.ts';
import { lex } from './lexer.ts';
import { parse } from './parser.ts';
import { generate } from './codegen.ts';
import type { Decl } from './ast.ts';

const makeRef = <T>(v: T) => ({ v });
const dedupe = (list: Diagnostic[]) => {
  const seen = new Set<string>();
  return list.filter(d => { const k = `${d.file}:${d.line}:${d.col}:${d.msg}`; return !seen.has(k) && !!seen.add(k) })
    .sort((a, b) => a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line || a.col - b.col);
};

/** Compiles all files together so scripts can call each other's indicators. */
export function compile(files: Record<string, string>, opts: NtCompileOptions): NtCompileResult {
  const errors: Diagnostic[] = [], warnings: Diagnostic[] = [], decls: Decl[] = [], usings = new Set<string>();
  for (const [path, src] of Object.entries(files)) {
    const r = parse(lex(src, path, errors), errors);
    decls.push(...r.decls);
    r.usings.forEach(u => usings.add(u));
  }
  let js: string | undefined, classes: NtCompileResult['classes'] = [];
  if (!errors.length) {
    const g = generate(decls, { globals: opts.globals, usings: [...usings] }, errors, warnings);
    classes = g.classes;
    if (!errors.length) {
      js = g.js;
      try { new Function('rt', 'ref', js) }
      catch (e) { errors.push({ file: Object.keys(files)[0] ?? '', line: 1, col: 1, msg: `Internal compiler error: generated code is invalid (${(e as Error).message})` }) }
    }
  }
  const errs = dedupe(errors).slice(0, 20);
  return { ok: !errs.length, js: errs.length ? undefined : js, classes, errors: errs, warnings: dedupe(warnings) };
}

/** Runs the compiled body: returns every compiled class by simple name. */
export function instantiate(js: string, rt: Rt): Record<string, Function> {
  return new Function('rt', 'ref', js)(rt, makeRef) as Record<string, Function>;
}
