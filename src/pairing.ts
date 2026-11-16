// Pairing helpers (QR / code login of a phone or another computer). Pure: no DOM, no network; tested in pairing.test.ts.
// Payload (made by the server, POST /api/auth/pair/start): chartterminal://pair?c=<code>&n=<server name>&u=<url1>&u=<url2>
import { normalizeBaseUrl } from './servers.ts';

export interface PairInfo { code: string; name: string; urls: string[] }
const SCHEME = /^chartterminal:\/\/pair\?/i;
const CODE = /^[A-Za-z0-9]{10}$/;

/** Manual entry: spaces and dashes are allowed ("ABCDE-FGHJK"); the server's codes are upper case. */
export const cleanCode = (s: string) => s.replace(/[\s-]/g, '').toUpperCase();
export const isPairCode = (s: string) => CODE.test(s);
/** "ABCDEFGHJK" -> "ABCDE FGHJK" for reading aloud / typing. */
export const showCode = (c: string) => (c.length === 10 ? `${c.slice(0, 5)} ${c.slice(5)}` : c);

/** Server addresses of a payload: valid origins only, https first, no duplicates (order otherwise kept). */
export function orderUrls(urls: string[]): string[] {
  const ok: string[] = [];
  for (const u of urls) { try { const n = normalizeBaseUrl(u); if (!ok.includes(n)) ok.push(n) } catch { /* skip */ } }
  return [...ok.filter(u => u.startsWith('https:')), ...ok.filter(u => !u.startsWith('https:'))];
}

export function serializePair(p: PairInfo): string {
  const q = new URLSearchParams(); q.set('c', p.code); if (p.name) q.set('n', p.name);
  for (const u of p.urls) q.append('u', u);
  return `chartterminal://pair?${q}`;
}

/** A scanned QR text or a typed code. Throws a readable Error; a payload without usable addresses is allowed (code only). */
export function parsePair(input: string): PairInfo {
  const s = input.trim();
  if (SCHEME.test(s)) {
    const q = new URLSearchParams(s.slice(s.indexOf('?') + 1));
    const code = cleanCode(q.get('c') ?? '');
    if (!isPairCode(code)) throw Error('This QR code is not a valid pairing code');
    return { code, name: (q.get('n') ?? '').slice(0, 60), urls: orderUrls(q.getAll('u')) };
  }
  const code = cleanCode(s);
  if (isPairCode(code)) return { code, name: '', urls: [] };
  throw Error('That is not a pairing code. It has 10 letters and digits.');
}

export type ScanResult = { kind: 'pair'; pair: PairInfo } | { kind: 'server'; url: string } | { kind: 'ignore' };
/** What to do with a decoded QR text: pairing payload, a bare server address, or keep scanning. Never throws. */
export function scanResult(text: string): ScanResult {
  try { return { kind: 'pair', pair: parsePair(text) } } catch { /* not a payload */ }
  if (/^https?:\/\//i.test(text.trim())) { try { return { kind: 'server', url: normalizeBaseUrl(text) } } catch { /* fall through */ } }
  return { kind: 'ignore' };
}

/**
 * Try the addresses in order. A network failure or "not a Chart Terminal server" (404) moves on to the next address;
 * any other answer (wrong / expired code, rate limit) ends the search because the server did answer.
 */
export async function redeemFirst<T>(urls: string[], redeem: (base: string) => Promise<T>): Promise<{ base: string; result: T }> {
  if (!urls.length) throw Error('This code has no server address. Enter the server address on the Servers page first.');
  let last: unknown;
  for (const base of urls) {
    try { return { base, result: await redeem(base) } }
    catch (e) { const st = (e as { status?: number }).status; if (st && st !== 404) throw e; last = e }
  }
  throw Error(`Could not reach the server${last instanceof Error && last.message ? ` (${last.message})` : ''}. Is this device on the same network, and is the PC's firewall or VPN blocking it?`);
}

/** The server says when a code stops working: epoch seconds, epoch milliseconds, or seconds from now. */
export function expiresAtMs(expires: number, now = Date.now()): number {
  return expires > 1e12 ? expires : expires > 1e9 ? expires * 1000 : now + expires * 1000;
}
export const countdown = (ms: number) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` };

/** `#pair=<code>` in the address: the Android app opens a server this way after a scan; the page redeems it itself (same origin, so the sign-in cookie lands here). */
export function takePairHash(hash: string): string | null {
  const m = /^#pair=([A-Za-z0-9-]{10,14})$/.exec(hash);
  const c = m ? cleanCode(m[1]) : '';
  return isPairCode(c) ? c : null;
}

/** First address (in order) for which `ok` says yes; a probe without an answer counts as no. null when none. */
export async function firstReachable(urls: string[], ok: (u: string) => boolean | Promise<boolean>): Promise<string | null> {
  for (const u of urls) if (await ok(u)) return u;
  return null;
}
