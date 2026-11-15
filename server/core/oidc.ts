// OpenID Connect helpers (docs/research/oauth-sync-design.md §1): ID-token verification (RS256 only), a JWKS cache with
// refetch limits, a hardened fetch and the Apple ES256 client secret. node:crypto and global fetch only; imports nothing from the app.
import { createHash, createPublicKey, createSign, verify, timingSafeEqual, type JsonWebKey } from 'node:crypto';

/** A fixed, short reason code. Never carries token text, so it is safe to log and audit. */
export class OidcError extends Error { code: string; constructor(code: string) { super(code); this.code = code } }
function fail(code: string): never { throw new OidcError(code) }

export const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url');
const eq = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y) };
const json = (part: string): Record<string, unknown> => {
  try { const v = JSON.parse(Buffer.from(part, 'base64url').toString('utf8')); if (v && typeof v === 'object' && !Array.isArray(v)) return v } catch {}
  return fail('malformed');
};

// ---------- hardened fetch ----------
export interface FetchOpts { method?: 'GET' | 'POST'; form?: Record<string, string>; headers?: Record<string, string>; allowInsecure?: boolean; timeoutMs?: number }
/** HTTPS only (http only when the test hook allows it), no redirects, 5 s, body <= 64 KB, JSON only. */
export async function fetchJson(url: string, o: FetchOpts = {}): Promise<{ status: number; json: Record<string, unknown>; maxAge: number | null }> {
  const u = new URL(url);
  if (u.protocol !== 'https:' && !(o.allowInsecure && u.protocol === 'http:')) fail('insecure_url');
  let r: Response;
  try {
    r = await fetch(u, { method: o.method ?? 'GET', redirect: 'error', signal: AbortSignal.timeout(o.timeoutMs ?? 5000), headers: { accept: 'application/json', ...o.headers, ...(o.form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) }, body: o.form ? new URLSearchParams(o.form).toString() : undefined });
  } catch { return fail('network') }
  if (!/^application\/json\b/i.test(r.headers.get('content-type') ?? '')) { await r.body?.cancel().catch(() => {}); fail('bad_content_type') }
  const chunks: Buffer[] = []; let n = 0;
  for await (const c of r.body as unknown as AsyncIterable<Uint8Array>) { n += c.length; if (n > 65536) { fail('too_large') } chunks.push(Buffer.from(c)) }
  let j: unknown; try { j = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { return fail('bad_json') }
  if (!j || typeof j !== 'object' || Array.isArray(j)) fail('bad_json');
  const m = /max-age=(\d+)/i.exec(r.headers.get('cache-control') ?? '');
  return { status: r.status, json: j as Record<string, unknown>, maxAge: m ? Number(m[1]) : null };
}

// ---------- JWKS cache ----------
export interface Jwk { kty?: string; kid?: string; use?: string; alg?: string; n?: string; e?: string }
/**
 * Keys of one provider from one fixed URL. Cached for the Cache-Control max-age (clamped to 5 min..24 h). An unknown `kid`
 * triggers a refetch at most once per 60 s, so random `kid`s cannot make us hammer the provider. When the provider cannot
 * be reached the stale cache is used for up to 24 h, then we fail closed.
 */
export class Jwks {
  keys: Jwk[] = []; fetchedAt = 0; ttl = 0; tried = 0; fetches = 0;
  url: string; private load: (url: string) => Promise<{ keys: Jwk[]; maxAge: number | null }>; private now: () => number;
  constructor(url: string, load: (url: string) => Promise<{ keys: Jwk[]; maxAge: number | null }>, now: () => number = Date.now) { this.url = url; this.load = load; this.now = now }
  private async refresh() {
    this.tried = this.now();
    try {
      const r = await this.load(this.url);
      this.fetches++;
      this.keys = r.keys.slice(0, 20); this.fetchedAt = this.now();
      this.ttl = Math.min(86400, Math.max(300, r.maxAge ?? 3600)) * 1000;
    } catch { /* keep the stale cache; see get() */ }
  }
  async get(kid: string): Promise<Jwk | null> {
    const t = this.now(), find = () => this.keys.find(k => k.kid === kid) ?? null;
    if (this.fetchedAt && t - this.fetchedAt > 86400_000) { this.keys = []; this.fetchedAt = 0 }   // too stale to trust
    const expired = !this.fetchedAt || t - this.fetchedAt > this.ttl;
    if (find() && !expired) return find();
    if (t - this.tried >= 60_000 || !this.tried) await this.refresh();
    return find();
  }
}

// ---------- ID token ----------
export interface Expect { iss: string[]; aud: string; nonce: string; nonceOptional?: boolean; accessToken?: string; now?: number }
export interface Claims { sub: string; email?: string; relay: boolean; iss: string }
/** Verify an RS256 ID token. Throws OidcError(<fixed code>) on any problem; returns only the claims we use. */
export async function verifyIdToken(token: string, jwks: { get(kid: string): Promise<Jwk | null> }, x: Expect): Promise<Claims> {
  if (typeof token !== 'string' || token.length > 8192) fail('malformed');
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some(p => !/^[\w-]*$/.test(p))) fail('malformed');
  const header = json(parts[0]);
  if (header.alg !== 'RS256') fail('alg');   // kills none / HS* / ES* (alg confusion)
  if (typeof header.kid !== 'string' || !header.kid || (header.typ !== undefined && typeof header.typ !== 'string')) fail('header');
  const jwk = await jwks.get(header.kid);
  if (!jwk) fail('kid');
  if (jwk!.kty !== 'RSA' || (jwk!.use !== undefined && jwk!.use !== 'sig') || (jwk!.alg !== undefined && jwk!.alg !== 'RS256')) fail('key');
  let ok = false;
  try { ok = verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), createPublicKey({ key: jwk as JsonWebKey, format: 'jwk' }), Buffer.from(parts[2], 'base64url')) } catch {}
  if (!ok) fail('signature');
  const p = json(parts[1]), now = Math.floor((x.now ?? Date.now()) / 1000);
  if (typeof p.iss !== 'string' || !x.iss.includes(p.iss)) fail('iss');
  const aud = p.aud;
  if (!(aud === x.aud || (Array.isArray(aud) && aud.includes(x.aud) && p.azp === x.aud))) fail('aud');
  if (typeof p.exp !== 'number' || p.exp + 60 <= now) fail('exp');
  if (typeof p.iat !== 'number' || p.iat > now + 60 || p.iat < now - 600) fail('iat');
  // nonceOptional (Telegram documents no nonce for its code flow): a missing claim is tolerated, a present one must still match.
  if (!(x.nonceOptional && p.nonce === undefined) && (typeof p.nonce !== 'string' || !eq(p.nonce, x.nonce))) fail('nonce');
  if (typeof p.sub !== 'string' || !p.sub || p.sub.length > 255) fail('sub');
  if (p.at_hash !== undefined) {
    if (typeof p.at_hash !== 'string' || !x.accessToken) fail('at_hash');
    if (!eq(p.at_hash as string, b64u(createHash('sha256').update(x.accessToken!).digest().subarray(0, 16)))) fail('at_hash');
  }
  const verified = p.email_verified === true || p.email_verified === 'true';
  const email = verified && typeof p.email === 'string' && p.email.length <= 254 ? p.email : undefined;
  return { sub: p.sub, iss: p.iss, ...(email ? { email } : {}), relay: !!email && (p.is_private_email === true || p.is_private_email === 'true' || /@privaterelay\.appleid\.com$/i.test(email)) };
}

// ---------- Apple client secret ----------
/** ES256 JWT used as Apple's client_secret. JOSE wants raw r||s (ieee-p1363), not DER. */
export function appleClientSecret(o: { teamId: string; keyId: string; serviceId: string; pem: string; now?: number }): string {
  const t = Math.floor((o.now ?? Date.now()) / 1000);
  const input = b64u(JSON.stringify({ alg: 'ES256', kid: o.keyId })) + '.' + b64u(JSON.stringify({ iss: o.teamId, iat: t, exp: t + 3600, aud: 'https://appleid.apple.com', sub: o.serviceId }));
  return input + '.' + b64u(createSign('SHA256').update(input).sign({ key: o.pem, dsaEncoding: 'ieee-p1363' }));
}
