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

// Every file counts (#include / other classes). Installing an unrelated file of the same language changes it too;
// the server then simply keeps running the test itself.
export const scriptSig = (s: Pick<ScriptSource, 'lang' | 'files' | 'main' | 'prec'>, inputs: Record<string, unknown> | undefined) =>
  hash([s.lang, s.main, stable(s.files), s.prec, stable(inputs ?? {})].join('\0'));
