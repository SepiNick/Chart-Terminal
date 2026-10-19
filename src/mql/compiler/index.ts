// MQL4/MQL5 → JS compiler: preprocess → parse → codegen. See contract.ts for the generated-code conventions.
import { MqlArray, MqlError, makeRef, type CompileResult, type CompiledProgram, type Diagnostic, type Dialect, type OutParams, type Rt } from '../contract.ts';
import { preprocess } from './preprocess.ts';
import { parse } from './parser.ts';
import { generate } from './codegen.ts';

export interface CompileOptions {
  dialect?: Dialect;
  outParams: OutParams;
  builtinStructs: string[];
  builtinClasses: string[];
  /** Include paths satisfied by the runtime (e.g. 'Trade\\Trade.mqh'); they are skipped. */
  nativeIncludes: string[];
}

const dedupe = (list: Diagnostic[]) => {
  const seen = new Set<string>();
  return list.filter(d => { const k = `${d.file}:${d.line}:${d.col}:${d.msg}`; return !seen.has(k) && !!seen.add(k) })
    .sort((a, b) => a.file === b.file ? a.line - b.line || a.col - b.col : 0);
};

export function compile(mainPath: string, files: Record<string, string>, opts: CompileOptions): CompileResult {
  const dialect: Dialect = opts.dialect ?? (/\.mq4$/i.test(mainPath) ? 'mql4' : 'mql5');
  const pp = preprocess(mainPath, files, dialect, opts.nativeIncludes);
  const errors = pp.errors, warnings = pp.warnings;
  let js: string | undefined;
  if (!errors.length) {
    const decls = parse(pp.toks, [...opts.builtinStructs, ...opts.builtinClasses], errors);
    if (!errors.length) {
      js = generate(decls, { dialect, outParams: opts.outParams, builtinStructs: opts.builtinStructs, builtinClasses: opts.builtinClasses, props: pp.props }, errors, warnings);
      if (!errors.length) {
        try { new Function('rt', 'MqlArray', 'ref', 'MqlError', js) }
        catch (e) { errors.push({ file: mainPath, line: 1, col: 1, msg: `Internal compiler error: generated code is invalid (${(e as Error).message})` }) }
      }
    }
  }
  const errs = dedupe(errors);
  return { ok: errs.length === 0, js: errs.length ? undefined : js, errors: errs, warnings: dedupe(warnings), dialect };
}

export function instantiate(js: string, rt: Rt): CompiledProgram {
  return new Function('rt', 'MqlArray', 'ref', 'MqlError', js)(rt, MqlArray, makeRef, MqlError) as CompiledProgram;
}
