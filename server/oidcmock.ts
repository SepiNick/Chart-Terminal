// Test-only OIDC provider: a local HTTP server with its own RSA signing key, a JWKS and a token endpoint. It plays both Google
// (client_secret string + PKCE) and Apple (client_secret is an ES256 JWT it verifies). Never imported by the server itself.
import http from 'node:http';
import { createHash, createHmac, generateKeyPairSync, randomBytes, sign, verify, type KeyObject } from 'node:crypto';
import type { AddressInfo } from 'node:net';

const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url');
export interface Grant { sub: string; email?: string; emailVerified?: boolean | string; relay?: boolean }
/** Knobs that corrupt one claim / the signature of the next ID token. */
export interface Tweak { iss?: string; aud?: string | string[]; azp?: string; expIn?: number; iatIn?: number; nonce?: string; alg?: string; kid?: string; signer?: 'other' | 'hs256'; atHash?: 'bad' | 'none'; noAccessToken?: boolean; noNonce?: boolean }
interface Pending extends Grant { nonce: string; challenge?: string; redirect: string; tweak: Tweak; clientId: string }

export async function startMock(o: { port: number; google: { clientId: string; secret: string }; telegram?: { clientId: string; secret: string }; apple?: { serviceId: string; teamId: string; keyId: string; publicKey: KeyObject } }) {
  const good = generateKeyPairSync('rsa', { modulusLength: 2048 }), other = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...good.publicKey.export({ format: 'jwk' }), kid: 'k1', use: 'sig', alg: 'RS256' };
  const pending = new Map<string, Pending>();
  const stats = { jwksFetches: 0, tokenCalls: 0, appleSecretOk: 0, basicOk: 0, tgBodySecret: 0, tgVerifiers: [] as string[] };
  let extraKeys: object[] = [];
  const rsa = (data: string, key: KeyObject) => sign('RSA-SHA256', Buffer.from(data), key);

  function idToken(g: Pending, access: string, iss: string): string {
    const t = g.tweak, now = Math.floor(Date.now() / 1000);
    const header = { alg: t.alg ?? 'RS256', kid: t.kid ?? 'k1', typ: 'JWT' };
    const payload: Record<string, unknown> = { iss: t.iss ?? iss, aud: t.aud ?? g.clientId, sub: g.sub, iat: now + (t.iatIn ?? 0), exp: now + (t.expIn ?? 600), ...(t.noNonce ? {} : { nonce: t.nonce ?? g.nonce }) };
    if (t.azp) payload.azp = t.azp;
    if (g.email) { payload.email = g.email; payload.email_verified = g.emailVerified ?? true; if (g.relay) payload.is_private_email = 'true' }
    if (t.atHash !== 'none' && !iss.includes('telegram')) payload.at_hash = t.atHash === 'bad' ? b64u(randomBytes(16)) : b64u(createHash('sha256').update(access).digest().subarray(0, 16));
    const input = b64u(JSON.stringify(header)) + '.' + b64u(JSON.stringify(payload));
    const sig = t.alg === 'none' ? Buffer.alloc(0) : t.signer === 'hs256' || t.alg === 'HS256' ? createHmac('sha256', good.publicKey.export({ type: 'spki', format: 'pem' }) as string).update(input).digest() : rsa(input, t.signer === 'other' ? other.privateKey : good.privateKey);
    return input + '.' + b64u(sig);
  }
  function appleSecretOk(s: string): boolean {
    const a = o.apple; if (!a) return false;
    const [h, p, sg] = s.split('.');
    try {
      const head = JSON.parse(Buffer.from(h, 'base64url').toString()), pl = JSON.parse(Buffer.from(p, 'base64url').toString());
      return head.alg === 'ES256' && head.kid === a.keyId && pl.iss === a.teamId && pl.sub === a.serviceId && pl.aud === 'https://appleid.apple.com' && pl.exp > Date.now() / 1000 &&
        verify('SHA256', Buffer.from(h + '.' + p), { key: a.publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(sg, 'base64url'));
    } catch { return false }
  }

  const server = http.createServer((req, res) => {
    const json = (status: number, body: unknown, extra: Record<string, string> = {}) => res.writeHead(status, { 'content-type': 'application/json', ...extra }).end(JSON.stringify(body));
    if (req.method === 'GET' && req.url === '/jwks') { stats.jwksFetches++; return json(200, { keys: [jwk, ...extraKeys] }, { 'cache-control': 'public, max-age=3600' }) }
    if (req.method === 'POST' && req.url === '/token') {
      const parts: Buffer[] = []; req.on('data', c => parts.push(c));
      req.on('end', () => {
        stats.tokenCalls++;
        const f = new URLSearchParams(Buffer.concat(parts).toString()), g = pending.get(f.get('code') ?? '');
        pending.delete(f.get('code') ?? '');   // a provider code is single use too
        if (!g || f.get('grant_type') !== 'authorization_code' || f.get('redirect_uri') !== g.redirect || f.get('client_id') !== g.clientId) return json(400, { error: 'invalid_grant' });
        const isApple = o.apple && g.clientId === o.apple.serviceId, isTg = !!o.telegram && g.clientId === o.telegram.clientId, secret = f.get('client_secret') ?? '';
        if (isTg) {   // Telegram: HTTP Basic client auth (never in the body) + PKCE
          if (secret) stats.tgBodySecret++;
          if (req.headers.authorization !== 'Basic ' + Buffer.from(`${o.telegram!.clientId}:${o.telegram!.secret}`).toString('base64')) return json(401, { error: 'invalid_client' });
          stats.basicOk++; stats.tgVerifiers.push(f.get('code_verifier') ?? '');
          if (!g.challenge || b64u(createHash('sha256').update(f.get('code_verifier') ?? '').digest()) !== g.challenge) return json(400, { error: 'invalid_grant' });
        } else if (isApple) { if (!appleSecretOk(secret)) return json(400, { error: 'invalid_client' }); stats.appleSecretOk++ }
        else {
          if (secret !== o.google.secret) return json(400, { error: 'invalid_client' });
          const v = f.get('code_verifier') ?? '';
          if (!g.challenge || b64u(createHash('sha256').update(v).digest()) !== g.challenge) return json(400, { error: 'invalid_grant' });   // PKCE layer 1
        }
        const access = b64u(randomBytes(24));
        json(200, { access_token: g.tweak.noAccessToken ? undefined : access, token_type: 'Bearer', id_token: idToken(g, access, isApple ? 'https://appleid.apple.com' : isTg ? 'https://oauth.telegram.org' : 'https://accounts.google.com') });
      });
      return;
    }
    json(404, { error: 'not found' });
  });
  await new Promise<void>((r, j) => { server.once('error', j); server.listen(o.port, '127.0.0.1', r) });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    base, stats, urls: { authorize: base + '/authorize', token: base + '/token', jwks: base + '/jwks' },
    addKey: (k: object) => { extraKeys = [k] },
    /** The user "approves" the authorization request found in the URL returned by /start; returns the provider's authorization code. */
    authorize(startUrl: string, g: Grant, tweak: Tweak = {}): string {
      const q = new URL(startUrl).searchParams, code = 'pc-' + randomBytes(12).toString('base64url');
      pending.set(code, { ...g, nonce: q.get('nonce')!, challenge: q.get('code_challenge') ?? undefined, redirect: q.get('redirect_uri')!, clientId: q.get('client_id')!, tweak });
      return code;
    },
    close: () => { server.closeAllConnections(); server.close() },
  };
}
