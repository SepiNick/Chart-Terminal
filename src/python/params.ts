// Reading the Python tool's contract from the source text (no Python needed): PARAMS = {name: default} and which entry
// functions exist. Pure: no DOM, safe in node tests.
export type PyParamValue = number | boolean | string;
export interface PyParam { name: string; value: PyParamValue; kind: 'int' | 'float' | 'bool' | 'string' }
export type PyEntry = 'indicator' | 'strategy' | 'script';

/** Entry functions the code defines at top level, in the order the UI offers them; 'script' (just run it) is always possible. */
export function detectEntries(src: string): PyEntry[] {
  const has = (n: string) => new RegExp(`^def\\s+${n}\\s*\\(`, 'm').test(src);
  return [...(has('indicator') ? ['indicator' as const] : []), ...(has('strategy') ? ['strategy' as const] : []), 'script'];
}

/** The literal text of the top-level `PARAMS = {...}` dict (comments and strings are skipped when matching braces), or null. */
function paramsBody(src: string): string | null {
  const m = /^PARAMS\s*(?::[^=\n]+)?=\s*\{/m.exec(src);
  if (!m) return null;
  let depth = 1, i = m.index + m[0].length;
  const start = i;
  while (i < src.length) {
    const c = src[i];
    if (c === '#') { while (i < src.length && src[i] !== '\n') i++; continue }
    if (c === '"' || c === "'") { i = skipString(src, i); continue }
    if (c === '{' || c === '[' || c === '(') depth++;
    else if (c === '}' || c === ']' || c === ')') { if (--depth === 0) return src.slice(start, i) }
    i++;
  }
  return null;
}
function skipString(s: string, i: number): number {
  const q = s[i], triple = s.startsWith(q.repeat(3), i);
  i += triple ? 3 : 1;
  while (i < s.length) {
    if (s[i] === '\\') { i += 2; continue }
    if (triple ? s.startsWith(q.repeat(3), i) : s[i] === q) return i + (triple ? 3 : 1);
    if (!triple && s[i] === '\n') return i;
    i++;
  }
  return i;
}
/** Split on commas that are not inside brackets, strings or comments. */
function splitTop(body: string): string[] {
  const out: string[] = []; let depth = 0, from = 0, i = 0;
  while (i < body.length) {
    const c = body[i];
    if (c === '#') { while (i < body.length && body[i] !== '\n') i++; continue }
    if (c === '"' || c === "'") { i = skipString(body, i); continue }
    if (c === '{' || c === '[' || c === '(') depth++;
    else if (c === '}' || c === ']' || c === ')') depth--;
    else if (c === ',' && depth === 0) { out.push(body.slice(from, i)); from = i + 1 }
    i++;
  }
  out.push(body.slice(from));
  return out.map(s => s.replace(/#.*$/gm, '').trim()).filter(Boolean);
}
function literal(v: string): PyParamValue | undefined {
  if (v === 'True') return true;
  if (v === 'False') return false;
  if (/^[+-]?(\d[\d_]*\.?[\d_]*|\.\d[\d_]*)([eE][+-]?\d+)?$/.test(v)) return Number(v.replace(/_/g, ''));
  const s = /^([rRuU]?)("([^"\\\n]*)"|'([^'\\\n]*)')$/.exec(v);
  return s ? (s[3] ?? s[4]) : undefined;
}

/** PARAMS entries whose default is a plain literal (number, True/False, text). Anything computed is left out. */
export function parseParams(src: string): PyParam[] {
  const body = paramsBody(src);
  if (body == null) return [];
  const out: PyParam[] = [];
  for (const e of splitTop(body)) {
    const k = /^("([^"\\\n]*)"|'([^'\\\n]*)')\s*:\s*([\s\S]+)$/.exec(e);
    if (!k) continue;
    const name = k[2] ?? k[3], value = literal(k[4].trim());
    if (value === undefined || out.some(p => p.name === name)) continue;
    out.push({ name, value, kind: typeof value === 'boolean' ? 'bool' : typeof value === 'string' ? 'string' : Number.isInteger(value) && !/[.eE]/.test(k[4]) ? 'int' : 'float' });
  }
  return out;
}

/** Defaults overlaid with what the user typed, typed like the default (a number field that is empty falls back to the default). */
export function paramValues(defs: PyParam[], typed: Record<string, unknown>): Record<string, PyParamValue> {
  const out: Record<string, PyParamValue> = {};
  for (const d of defs) {
    const v = typed[d.name];
    out[d.name] = d.kind === 'bool' ? (typeof v === 'boolean' ? v : d.value) : d.kind === 'string' ? (typeof v === 'string' ? v : d.value)
      : typeof v === 'number' && Number.isFinite(v) ? (d.kind === 'int' ? Math.round(v) : v) : d.value;
  }
  return out;
}
