// Compile (with cache) and run a Pine script; errors come back as data, never thrown.
import type { Bar } from '../data.ts';
import { parse } from './parser.ts';
import { PineSyntaxError, type Program } from './ast.ts';
import { run, PineRuntimeError, type Outputs, type RunOpts } from './interp.ts';

export interface ScriptError { line: number; col: number; msg: string; kind: 'syntax' | 'runtime' }
const cache = new Map<string, Program | ScriptError>();

export function compile(src: string): Program | ScriptError {
  let r = cache.get(src);
  if (!r) {
    try { r = parse(src) }
    catch (e) { r = e instanceof PineSyntaxError ? { line: e.line, col: e.col, msg: e.message, kind: 'syntax' } : { line: 1, col: 1, msg: String(e), kind: 'syntax' } }
    if (cache.size > 50) cache.delete(cache.keys().next().value!);
    cache.set(src, r);
  }
  return r;
}
export const isError = (x: unknown): x is ScriptError => !!x && typeof x === 'object' && 'msg' in x && 'kind' in x;

// `import user/Name/1` resolves against installed Pine scripts that declare library("Name"); the editor registers them.
// shortcut: one user and no versions, so the path's user and version parts are ignored.
let installed: () => string[] = () => [];
export function setInstalledScripts(f: () => string[]) { installed = f }
export const libraryTitle = (src: string) => /^\s*library\s*\(\s*(?:title\s*=\s*)?["']([^"']+)["']/m.exec(src)?.[1];
export const findLibrary = (path: string, srcs = installed()) => srcs.find(s => libraryTitle(s) === path.split('/')[1]);
/** Installed library sources, as plain data for the tester worker (it has no editor to ask). */
export const installedLibraries = () => installed().filter(s => libraryTitle(s));

export function runScript(src: string, bars: Bar[], opts: RunOpts): { out?: Outputs; error?: ScriptError; ms: number } {
  const t0 = performance.now();
  const prog = compile(src);
  if (isError(prog)) return { error: prog, ms: 0 };
  try { return { out: run(prog, bars, { library: p => findLibrary(p), ...opts }), ms: performance.now() - t0 } }
  catch (e) {
    const err: ScriptError = e instanceof PineRuntimeError ? { line: e.line, col: e.col, msg: e.message, kind: 'runtime' } : { line: 1, col: 1, msg: (e as Error).message ?? String(e), kind: 'runtime' };
    return { error: err, ms: performance.now() - t0 };
  }
}
