// NinjaScript (C#) → JS compiler: lex → parse → codegen. See ../contract.ts for the generated-code conventions.
import type { Diagnostic, NtCompileOptions, NtCompileResult, Rt } from '../contract.ts';
import { lex, type Tok } from './lexer.ts';
import { parse } from './parser.ts';
import { generate } from './codegen.ts';
import type { Decl } from './ast.ts';

const UNSAFE = /^(constructor|__proto__|prototype|caller|callee|__define[GS]etter__|__lookup[GS]etter__)$/;   // names that reach Function / Object internals from generated JS (`constructor.constructor("…")()` runs anything)
/** Scans every identifier, including the ones inside $"{…}" interpolation holes (their tokens and alignment tokens are nested). */
function forbidden(toks: Tok[], errors: Diagnostic[]) {
  for (const t of toks) {
    if (t.t === 'id' && UNSAFE.test(t.v)) errors.push({ file: t.file, line: t.line, col: t.col, msg: `'${t.v}' is not allowed in scripts` });
    for (const p of t.parts ?? []) if (typeof p !== 'string') { forbidden(p.toks, errors); if (p.align) forbidden(p.align, errors) }
  }
}
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
    const toks = lex(src, path, errors);
    forbidden(toks, errors);
    const r = parse(toks, errors);
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

/** Browser globals a script must never reach: its code runs with these names bound to undefined (defence in depth next to the compiler's name checks). */
const HIDDEN_GLOBALS = ['window', 'self', 'globalThis', 'document', 'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'Worker', 'SharedWorker', 'localStorage', 'sessionStorage', 'indexedDB', 'navigator', 'location', 'history', 'importScripts', 'postMessage', 'open', 'parent', 'top', 'frames', 'opener', 'Notification', 'BroadcastChannel'];
/** Runs the compiled body: returns every compiled class by simple name. */
export function instantiate(js: string, rt: Rt): Record<string, Function> {
  return new Function('rt', 'ref', ...HIDDEN_GLOBALS, js)(rt, makeRef) as Record<string, Function>;
}
