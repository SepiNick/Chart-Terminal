// Script sources from a request body (forward tests, `code` of MQL / NinjaScript alerts): sources only, never compiled JS.
import { bad } from './core/http.ts';
import type { ScriptSource } from '../src/alerttypes.ts';

/** Only source code is accepted: anything that looks like compiled JS (`job`, `js`, `cr` anywhere) is refused. */
function hasJsKey(v: unknown, depth = 0): boolean {
  if (!v || typeof v !== 'object' || depth > 20) return false;
  return Object.entries(v).some(([k, x]) => k === 'js' || k === 'cr' || k === 'job' || hasJsKey(x, depth + 1));
}
const LANGS = ['pine', 'mql4', 'mql5', 'ninja'];
/** Sources from a request body (forward tests, and `code` of MQL / NinjaScript alerts). */
export function validSource(b: Record<string, unknown>): ScriptSource {
  if (hasJsKey(b)) throw bad('Send script sources, not compiled code');
  const { lang, files, main, cls, prec = 2 } = b as Partial<ScriptSource>;
  if (typeof lang !== 'string' || !LANGS.includes(lang)) throw bad('Bad lang');
  if (!files || typeof files !== 'object' || Array.isArray(files)) throw bad('files required');
  const names = Object.keys(files);
  if (!names.length || names.length > 50) throw bad('1 to 50 files');
  let size = 0;
  for (const n of names) {
    if (!/^[^\u0000-\u001f]{1,120}$/.test(n) || typeof files[n] !== 'string') throw bad(`Bad file ${n.slice(0, 40)}`);
    size += n.length + files[n].length;
  }
  if (size > 1024 * 1024) throw bad('Sources larger than 1 MB');
  if (typeof main !== 'string' || !Object.hasOwn(files, main)) throw bad('main must name one of the files');
  if (cls != null && (typeof cls !== 'string' || !/^\w{1,100}$/.test(cls))) throw bad('Bad class name');
  if (!Number.isInteger(prec) || prec < 0 || prec > 12) throw bad('Bad precision');
  // Pine runs one file; keep only what the language uses.
  const own = lang === 'pine' ? [main] : names;
  return { lang: lang as ScriptSource['lang'], files: Object.fromEntries(own.map(n => [n, files[n]])), main, cls: cls ?? undefined, prec };
}
