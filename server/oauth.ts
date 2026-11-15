// Sign in with Google / Apple, server-side OIDC (docs/research/oauth-sync-design.md). Public servers only; imported from authroutes.ts.
//   POST /api/auth/oauth/start       { provider, intent: login|link|reauth, challenge, ret: web|app|loopback, port?, device?, password? } -> { url }
//   GET  /api/auth/oauth/callback/google · POST /api/auth/oauth/callback/apple (form_post)   -> 303 to the `ret` target carrying a one-time code
//   POST /api/auth/oauth/exchange    { code, verifier, device? } -> { ok, user, token? } | { signup: true, ticket, hint } | { ok, linked } | { ok, reauth }
//   POST /api/auth/oauth/signup      { ticket, verifier, name, invite?, device? } -> { ok, user, recoveryCodes, token? }
//   GET /api/auth/identities · DELETE /api/auth/identities/:provider · POST /api/auth/password/set
// Every route answers 404 for a provider that is not configured. No provider token is stored or logged; failures log fixed codes only.
import { createHash, createPrivateKey, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { HttpError, RAW, bad, closeClients, route, type Ctx } from './core/http.ts';
import { OAUTH, clientIp, publicUrl } from './core/mode.ts';
import { Jwks, OidcError, appleClientSecret, b64u, fetchJson, verifyIdToken, type Jwk } from './core/oidc.ts';
import * as U from './core/users.ts';

type Name = 'google' | 'apple' | 'telegram';
interface Urls { authorize: string; token: string; jwks: string }
const URLS: Record<Name, Urls> = {
  google: { authorize: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token', jwks: 'https://www.googleapis.com/oauth2/v3/certs' },
  apple: { authorize: 'https://appleid.apple.com/auth/authorize', token: 'https://appleid.apple.com/auth/token', jwks: 'https://appleid.apple.com/auth/keys' },
  telegram: { authorize: 'https://oauth.telegram.org/auth', token: 'https://oauth.telegram.org/token', jwks: 'https://oauth.telegram.org/.well-known/jwks.json' },
};
const ISSUERS: Record<Name, string[]> = { google: ['https://accounts.google.com', 'accounts.google.com'], apple: ['https://appleid.apple.com'], telegram: ['https://oauth.telegram.org'] };
let urls = URLS, insecure = false;
const jwksOf: Partial<Record<Name, Jwks>> = {};
/** Test hook: point the providers at a local mock. Refused unless CT_NO_AUTOSTART=1, so production cannot be redirected by an env var. */
export function _setProvidersForTest(o: Partial<Record<Name, Urls>>) {
  if (process.env.CT_NO_AUTOSTART !== '1') throw Error('test only');
  urls = { ...URLS, ...o }; insecure = true;
  delete jwksOf.google; delete jwksOf.apple; delete jwksOf.telegram;
}
const jwks = (n: Name) => jwksOf[n] ??= new Jwks(urls[n].jwks, async url => {
  const r = await fetchJson(url, { allowInsecure: insecure });
  if (r.status !== 200 || !Array.isArray(r.json.keys)) throw new OidcError('jwks');
  return { keys: (r.json.keys as unknown[]).filter((k): k is Jwk => !!k && typeof k === 'object'), maxAge: r.maxAge };
});

// Apple: the .p8 is read once. A key that does not parse disables Apple with a warning instead of crashing at the first user.
let applePem = '';
if (OAUTH.apple) {
  try { const pem = readFileSync(OAUTH.apple.keyFile, 'utf8'); if (createPrivateKey(pem).asymmetricKeyType !== 'ec') throw Error('not an EC key'); applePem = pem }
  catch { console.warn('[oauth] Sign in with Apple is disabled: CT_APPLE_PRIVATE_KEY_FILE is missing or is not a valid .p8 key') }
}
const enabled = (n: string): n is Name => (n === 'google' && !!OAUTH.google) || (n === 'apple' && !!OAUTH.apple && !!applePem) || (n === 'telegram' && !!OAUTH.telegram);
export const oauthStatus = () => ({ google: enabled('google'), apple: enabled('apple'), telegram: enabled('telegram') });
const clientId = (n: Name) => (n === 'google' ? OAUTH.google!.clientId : n === 'telegram' ? OAUTH.telegram!.clientId : OAUTH.apple!.serviceId);
const clientSecret = (n: Name) => (n === 'google' ? OAUTH.google!.secret : n === 'telegram' ? OAUTH.telegram!.secret : appleClientSecret({ teamId: OAUTH.apple!.teamId, keyId: OAUTH.apple!.keyId, serviceId: OAUTH.apple!.serviceId, pem: applePem }));
const redirectUri = (n: Name) => new URL(`/api/auth/oauth/callback/${n}`, publicUrl()!).toString();   // never client-supplied

const GENERIC = 'Sign-in failed. Please try again';
const eq = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y) };
const pkceOk = (verifier: unknown, challenge: string) => typeof verifier === 'string' && /^[A-Za-z0-9._~-]{43,128}$/.test(verifier) && eq(b64u(createHash('sha256').update(verifier).digest()), challenge);
const str = (v: unknown, max: number) => (typeof v === 'string' && v.length <= max ? v : '');

/** Where the browser goes afterwards. `ret` is a key, never a URL; the code travels in the fragment (web, app) so it never reaches a log or a Referer. */
function target(st: { ret: string; port: number | null } | null, kv: { code?: string; error?: string }): string {
  const origin = publicUrl()!.origin, e = kv.error;
  if (st?.ret === 'loopback' && st.port) return `http://127.0.0.1:${st.port}/ct-oauth?${e ? 'error=' + e : 'code=' + kv.code}`;
  if (st?.ret === 'app') return `${origin}/oauth-return.html#${e ? 'error=' + e : 'code=' + kv.code}`;
  return `${origin}/#${e ? 'error=' + e : 'oauth=' + kv.code}`;
}
function redirect(c: Ctx, url: string) {
  c.res.writeHead(303, { location: url, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' }).end();
  return RAW;
}

let tokenCalls = 0;
const START_MAX = Number(process.env.CT_OAUTH_START_MAX) || 20, CB_MAX = Number(process.env.CT_OAUTH_CB_MAX) || 30;   // per address per 10 minutes
async function callback(c: Ctx, name: string, p: URLSearchParams) {
  if (!enabled(name)) throw new HttpError(404, 'Not found');
  const ip = U.ipKey(clientIp(c.req));
  if (!U.allow('oauth-cb:' + ip, CB_MAX, 600_000)) throw new HttpError(429, 'Too many requests');
  const stateParam = str(p.get('state'), 128), st = stateParam ? U.oauthStateTake(stateParam) : null;   // single use
  if (!st || st.provider !== name) { U.audit(null, ip, 'oauth fail:state'); return redirect(c, target(st, { error: 'expired' })) }
  const failed = (why: string, error = 'failed') => { U.audit(st.user_id, ip, `oauth fail:${why}`); return redirect(c, target(st, { error })) };
  if (p.get('error')) return failed('denied', 'denied');   // never echo provider text
  const code = str(p.get('code'), 2048);
  if (!code || tokenCalls >= 8) return failed(code ? 'busy' : 'nocode');
  tokenCalls++;
  try {
    const tg = name === 'telegram';   // Telegram: client auth is HTTP Basic (the secret never goes in the body); slower from behind a VPN, so 8 s
    const form: Record<string, string> = { grant_type: 'authorization_code', code, redirect_uri: redirectUri(name), client_id: clientId(name), ...(tg ? {} : { client_secret: clientSecret(name) }) };
    if (name !== 'apple') form.code_verifier = st.p_verifier;   // Apple: protection is state + nonce + the client binding; PKCE is not relied upon there
    const t = await fetchJson(urls[name].token, { method: 'POST', form, allowInsecure: insecure, ...(tg ? { timeoutMs: 8000, headers: { authorization: 'Basic ' + Buffer.from(`${clientId(name)}:${clientSecret(name)}`).toString('base64') } } : {}) });
    if (t.status !== 200 || typeof t.json.id_token !== 'string') throw new OidcError('token');
    // access_token / refresh_token are used for at_hash at most and never stored.
    const claims = await verifyIdToken(t.json.id_token, jwks(name), { iss: ISSUERS[name], aud: clientId(name), nonce: st.nonce, nonceOptional: tg, accessToken: typeof t.json.access_token === 'string' ? t.json.access_token : undefined });
    // Apple's one-time `user` (name) form field is ignored on purpose: unauthenticated form data must not influence identity.
    const oc = U.oauthCodeNew({ kind: st.intent, userId: st.user_id, id: { provider: name, subject: claims.sub, email: claims.email, relay: claims.relay }, challenge: st.c_challenge, device: st.device });
    return redirect(c, target(st, { code: oc }));
  } catch (e) { const code = e instanceof OidcError ? e.code : 'error'; return failed(code, code === 'network' && name === 'telegram' ? 'unreachable' : 'failed') }   // telegram.org is blocked in some countries: say so
  finally { tokenCalls-- }
}

export interface Deps {
  device: (c: Ctx) => string | null; body: (c: Ctx) => Record<string, unknown>;
  issue: (c: Ctx, label: string | null, user: { id: number; name: string; role: 'admin' | 'user' }) => { token?: string };
  start: (c: Ctx, userId: number) => void;
}
export function mountOAuth({ device, body, issue, start }: Deps) {
  /** Password if the account has one, otherwise a provider login or re-auth in the last 10 minutes. */
  const stepUp = async (c: Ctx, b: Record<string, unknown>) => {
    const uid = c.user.id;
    if (U.accountHasPassword(uid)) { if (!await U.confirmPassword(uid, b.password, c.req)) throw new HttpError(401, 'Wrong password') }
    else if (!U.stepupFresh(uid)) throw new HttpError(403, 'Confirm with your sign-in provider first', { code: 'stepup_required' });
  };

  route('POST', '/api/auth/oauth/start', async c => {
    const label = device(c), b = body(c), name = str(b.provider, 16);
    if (!enabled(name)) throw new HttpError(404, 'Not found');
    const ip = U.ipKey(clientIp(c.req));
    if (!U.allow('oauth-start:' + ip, START_MAX, 600_000)) throw new HttpError(429, 'Too many requests');
    const intent = b.intent, challenge = str(b.challenge, 64), ret = b.ret;
    if (intent !== 'login' && intent !== 'link' && intent !== 'reauth') throw bad('intent must be login, link or reauth');
    if (!/^[A-Za-z0-9_-]{43}$/.test(challenge)) throw bad('challenge must be a base64url SHA-256');
    if (ret !== 'web' && ret !== 'app' && ret !== 'loopback') throw bad('ret must be web, app or loopback');
    const port = ret === 'loopback' ? b.port : null;
    if (ret === 'loopback' && !(Number.isInteger(port) && (port as number) >= 1024 && (port as number) <= 65535)) throw bad('port must be 1024-65535');
    let userId: number | null = null;
    if (intent !== 'login') {   // linking and re-auth need a logged-in caller (re-checked at /exchange)
      if (!c.session) throw new HttpError(401, 'Login required');
      userId = c.user.id;
      if (intent === 'link') { if (U.identityOf(userId, name)) throw new HttpError(409, 'A sign-in of that kind is already linked', { code: 'provider_linked' }); await stepUp(c, b) }
      else if (!U.identityOf(userId, name)) throw new HttpError(409, 'That sign-in is not linked to your account', { code: 'not_linked' });
    }
    const nonce = randomBytes(32).toString('base64url'), pVerifier = randomBytes(32).toString('base64url');
    const state = U.oauthStateNew({ provider: name, nonce, pVerifier, challenge, intent, userId, ret, port: port as number | null, device: label });
    const q = new URLSearchParams({ response_type: 'code', client_id: clientId(name), redirect_uri: redirectUri(name), state, nonce });
    if (name === 'google') { q.set('scope', 'openid email'); q.set('code_challenge', b64u(createHash('sha256').update(pVerifier).digest())); q.set('code_challenge_method', 'S256'); q.set('prompt', 'select_account') }
    else if (name === 'telegram') { q.set('scope', 'openid'); q.set('code_challenge', b64u(createHash('sha256').update(pVerifier).digest())); q.set('code_challenge_method', 'S256') }   // no profile / phone / bot_access: only the stable id is needed
    else { q.set('scope', 'email'); q.set('response_mode', 'form_post') }
    U.audit(userId, ip, `oauth start ${name} ${intent}`);
    return { url: `${urls[name].authorize}?${q}` };
  }, { public: true, limit: 4096 });

  route('GET', '/api/auth/oauth/callback/google', c => callback(c, 'google', c.url.searchParams), { public: true });
  route('GET', '/api/auth/oauth/callback/telegram', c => callback(c, 'telegram', c.url.searchParams), { public: true });
  route('POST', '/api/auth/oauth/callback/apple', c => {
    const ok = /^application\/x-www-form-urlencoded\b/i.test(String(c.req.headers['content-type'] ?? ''));
    return callback(c, 'apple', ok ? new URLSearchParams((c.body as Buffer).toString('utf8')) : new URLSearchParams());
  }, { public: true, raw: true, limit: 8192 });

  route('POST', '/api/auth/oauth/exchange', async c => {
    const label = device(c), b = body(c), ip = U.ipKey(clientIp(c.req));
    if (U.blocked('oauth-xfail:' + ip, 10, 600_000)) throw new HttpError(429, 'Too many attempts. Try again later');
    const fail = () => { U.allow('oauth-xfail:' + ip, 10, 600_000); return new HttpError(400, GENERIC) };
    const code = str(b.code, 128), row = code ? U.oauthCodeTake(code) : null;   // spent even when the verifier is wrong: a hijacker can only burn it
    if (!row || !pkceOk(b.verifier, row.c_challenge) || (row.device ?? null) !== label) throw fail();
    const id = { provider: row.provider, subject: row.subject, email: row.email ?? undefined, relay: !!row.relay };
    if (row.kind === 'login') {
      const iu = U.identityUser(row.provider, row.subject);
      if (!iu) return { signup: true, ticket: U.oauthTicketNew(id, row.c_challenge, label), hint: { provider: row.provider, email: id.email ?? null, relay: id.relay } };   // never an account lookup by e-mail
      if (!iu.ok) { U.audit(iu.user.id, ip, 'oauth disabled'); throw fail() }
      U.identitySeen(row.provider, row.subject, id.email, id.relay); U.stepupMark(iu.user.id); U.audit(iu.user.id, ip, `oauth login ${row.provider}`);
      return { ok: true, ...issue(c, label, iu.user), user: { name: iu.user.name, role: iu.user.role, mustChange: !!iu.user.mustChange } };
    }
    // link / reauth: only for the session that started it
    if (!c.session || c.user.id !== row.user_id) throw fail();
    if (row.kind === 'reauth') {
      if (U.identityOf(c.user.id, row.provider)?.subject !== row.subject) throw fail();
      U.stepupMark(c.user.id); U.audit(c.user.id, ip, `oauth reauth ${row.provider}`);
      return { ok: true, reauth: true };
    }
    const r = U.identityLink(c.user.id, id);
    if (r === 'taken') throw new HttpError(409, 'This account is already linked to another user here', { code: 'identity_taken' });
    if (r === 'have') throw new HttpError(409, 'A sign-in of that kind is already linked', { code: 'provider_linked' });
    U.stepupMark(c.user.id); U.audit(c.user.id, ip, `oauth link ${row.provider}`);
    return { ok: true, linked: row.provider };
  }, { public: true, limit: 4096 });

  route('POST', '/api/auth/oauth/signup', c => {
    const label = device(c), b = body(c), ip = U.ipKey(clientIp(c.req));
    if (U.blocked('oauth-xfail:' + ip, 10, 600_000)) throw new HttpError(429, 'Too many attempts. Try again later');
    const ticket = str(b.ticket, 128), t = ticket ? U.oauthTicketPeek(ticket) : null;
    if (!t || !pkceOk(b.verifier, t.c_challenge) || (t.device ?? null) !== label) {
      if (t) U.oauthTicketBurn(ticket);
      U.allow('oauth-xfail:' + ip, 10, 600_000);
      throw new HttpError(400, GENERIC);
    }
    const r = U.createOAuthUser(ticket, b, c.req);
    return { ok: true, ...issue(c, label, r.user), user: { name: r.user.name, role: r.user.role }, recoveryCodes: r.recoveryCodes };
  }, { public: true, limit: 4096 });

  route('GET', '/api/auth/identities', c => ({ identities: U.identitiesOf(c.user.id), hasPassword: U.accountHasPassword(c.user.id) }));
  route('DELETE', '/api/auth/identities/:provider', async c => {
    const p = c.params.provider;
    if ((p !== 'google' && p !== 'apple' && p !== 'telegram') || !U.identityOf(c.user.id, p)) throw new HttpError(404, 'Not found');   // only ever the caller's own rows
    await stepUp(c, body(c));
    const r = U.identityUnlink(c.user.id, p);
    if (r === 'last') throw new HttpError(409, 'This is your only way to sign in. Set a password first', { code: 'last_method' });
    if (r === 'none') throw new HttpError(404, 'Not found');
    U.audit(c.user.id, clientIp(c.req), `oauth unlink ${p}`);
  }, { limit: 4096 });
  route('POST', '/api/auth/password/set', async c => {
    if (U.accountHasPassword(c.user.id)) throw new HttpError(409, 'This account already has a password. Use change password');
    if (!U.stepupFresh(c.user.id)) throw new HttpError(403, 'Confirm with your sign-in provider first', { code: 'stepup_required' });
    await U.setPassword(c.user.id, U.checkNewPassword(body(c).password, c.user.name));   // every session and device token ends, including this one
    closeClients(cl => cl.userId === c.user.id);
    start(c, c.user.id);
    U.audit(c.user.id, clientIp(c.req), 'password set');
    return { ok: true };
  }, { limit: 4096 });
}
