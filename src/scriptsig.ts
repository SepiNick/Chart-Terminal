// Fingerprint of what a server forward test runs (sources, language, precision, inputs). The browser compares it
// with its own chart script to know it may run the strategy itself and hand the server the fills (docs/phase5-contracts.md §6).
import type { ScriptSource } from './alerttypes.ts';

const stable = (v: unknown): string => !v || typeof v !== 'object' ? JSON.stringify(v) ?? 'null'
  : Array.isArray(v) ? `[${v.map(stable).join(',')}]`
  : `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(',')}}`;

/** cyrb53: a fast 53-bit string hash, the same in the browser and on the server. Not a security boundary. */
function hash(s: string) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677) }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

// Every file the script uses counts (#include, iCustom, other classes: usedFiles below); an unrelated file does not.
export const scriptSig = (s: Pick<ScriptSource, 'lang' | 'files' | 'main' | 'prec'>, inputs: Record<string, unknown> | undefined) =>
  hash([s.lang, s.main, stable(s.files), s.prec, stable(inputs ?? {})].join('\0'));

/**
 * The files a script really uses: #include, iCustom by a literal name, and (.cs) files declaring a class it names — so
 * installing an unrelated file leaves a forward test's fingerprint alone. An iCustom with a computed name keeps them all.
 */
export function usedFiles<T extends { name: string; src: string }>(main: T, pool: T[], cs: boolean): T[] {
  const base = (n: string) => n.split(/[\\/]/).pop()!.toLowerCase().replace(/\.(mq4|mq5|mqh|cs)$/, '');
  const out = new Set([main]), todo = [main];
  while (todo.length) {
    const src = todo.pop()!.src;
    const lit = [...src.matchAll(/\biCustom\s*\([^,()]*,[^,()]*,\s*"([^"]+)"/g)].map(m => m[1]);
    if ((src.match(/\biCustom\s*\(/g)?.length ?? 0) > lit.length) return pool;
    const refs = new Set([...[...src.matchAll(/#include\s*[<"]([^>"]+)[>"]/g)].map(m => m[1]), ...lit].map(base));
    for (const x of pool) {
      if (out.has(x)) continue;
      const uses = refs.has(base(x.name)) || (cs && [...x.src.matchAll(/\bclass\s+(\w+)/g)].some(m => new RegExp(`\\b${m[1]}\\b`).test(src)));
      if (uses) { out.add(x); todo.push(x) }
    }
  }
  return [...out];
}
