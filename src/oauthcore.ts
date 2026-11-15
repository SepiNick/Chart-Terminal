// Pure pieces of the OAuth return path (no imports, so it can run first at start-up and be tested in node).
// The one-time code comes back in the URL fragment; it is removed from the address bar and history before anything else runs.
export const CODE_RE = /^[A-Za-z0-9_-]{20,64}$/;
export interface Returned { found: boolean; code?: string; error?: string }
/** `#oauth=<code>` (web), `#code=<code>` (app page) or `#error=<kind>`; anything else is not ours. */
export function parseOAuthFragment(hash: string): Returned {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  const raw = p.get('oauth') ?? p.get('code'), err = p.get('error');
  if (raw === null && err === null) return { found: false };
  if (raw !== null && CODE_RE.test(raw)) return { found: true, code: raw };
  const e = err ?? 'failed';
  return { found: true, error: ['denied', 'expired', 'failed', 'unreachable'].includes(e) ? e : 'failed' };
}
export const ERROR_TEXT: Record<string, string> = { denied: 'Sign-in was cancelled.', expired: 'Sign-in took too long. Try again.', failed: 'Sign-in failed. Try again or use your password.', unreachable: 'The server could not reach Telegram (oauth.telegram.org). Telegram is blocked in some countries: turn on your VPN (on the server too) and try again, or sign in with your password.' };
/** Parse and, when it is ours, replace the URL by path + query without the fragment (no history entry keeps the code). */
export function takeFragment(loc: { hash: string; pathname: string; search: string }, hist: { replaceState(s: unknown, t: string, u: string): void }): Returned | null {
  const r = parseOAuthFragment(loc.hash);
  if (!r.found) return null;
  hist.replaceState(null, '', loc.pathname + loc.search);
  return r;
}
export const returned: Returned | null = typeof location !== 'undefined' && typeof history !== 'undefined' ? takeFragment(location, history) : null;

const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export async function makePkce(c: Pick<Crypto, 'getRandomValues' | 'subtle'> = globalThis.crypto): Promise<{ verifier: string; challenge: string }> {
  const verifier = b64url(c.getRandomValues(new Uint8Array(32)));
  return { verifier, challenge: b64url(new Uint8Array(await c.subtle.digest('SHA-256', new TextEncoder().encode(verifier)))) };
}
// Verifier kept across the provider round trip. localStorage (tabs get evicted), key `ctoauth` (not `ct.*`, never synced), 10 minutes.
export const OAUTH_KEY = 'ctoauth', OAUTH_TTL = 10 * 60_000;
type Kv = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export interface Pending { verifier: string; server: string; intent: string; exp: number }
export function savePending(kv: Kv, p: Omit<Pending, 'exp'>, now = Date.now()) { kv.setItem(OAUTH_KEY, JSON.stringify({ ...p, exp: now + OAUTH_TTL })) }
/** Single use: always removed. null when missing, expired or for another server. */
export function takePending(kv: Kv, server: string, now = Date.now()): Pending | null {
  let p: Pending | null = null;
  try { p = JSON.parse(kv.getItem(OAUTH_KEY) ?? 'null') } catch {}
  try { kv.removeItem(OAUTH_KEY) } catch {}
  return p && typeof p.verifier === 'string' && p.exp > now && p.server === server ? p : null;
}
/** The URL the server gives us must be https (or plain http to this machine for local tests). */
export function safeProviderUrl(u: unknown): string | null {
  try { const x = new URL(String(u)); return x.protocol === 'https:' || (x.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(x.hostname)) ? x.href : null } catch { return null }
}
