// Sign in with Telegram (OpenID Connect at oauth.telegram.org) against the local mock. No real network, no real bot:
// the real claims (sub, nonce) are taken from Telegram's documentation and are covered only by this mock.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { createHash, randomBytes } from 'node:crypto';

const freePort = async () => {
  for (;;) {
    const p = 20000 + Math.floor(Math.random() * 1000);
    if (await new Promise<boolean>(r => { const s = net.createServer(); s.once('error', () => r(false)); s.listen(p, '127.0.0.1', () => s.close(() => r(true))) })) return p;
  }
};
const logs: string[] = [];
for (const m of ['log', 'warn', 'error', 'info'] as const) { const o = console[m]; console[m] = (...a: unknown[]) => { logs.push(a.map(String).join(' ')); o(...a) } }

const TG = { clientId: '123456789', secret: 'tg-secret-' + randomBytes(6).toString('hex') };
const GOOGLE = { clientId: 'gid.apps.example', secret: 'gsecret' };
const { startMock } = await import('./oidcmock.ts');
const { boot, client } = await import('./publictest.ts');
const port = await freePort(), mock = await startMock({ port: await freePort(), google: GOOGLE, telegram: TG });
const b = await boot({
  CT_PUBLIC_URL: `http://localhost:${port}`, CT_REG_PER_HOUR: '1000', CT_AUTH_RPS: '1000', CT_ANON_RPS: '1000', CT_ANON_BURST: '100000', CT_AUTH_BURST: '100000', CT_OAUTH_START_MAX: '100000', CT_OAUTH_CB_MAX: '100000', CT_QUOTA_RPS: '1000', CT_QUOTA_BURST: '1000',
  CT_GOOGLE_CLIENT_ID: GOOGLE.clientId, CT_GOOGLE_CLIENT_SECRET: GOOGLE.secret, CT_TELEGRAM_CLIENT_ID: TG.clientId, CT_TELEGRAM_CLIENT_SECRET: TG.secret, CT_TELEGRAM_BOT_USERNAME: 'chartbot',
}, port);
after(() => { b.close(); mock.close() });
const O = await import('./oauth.ts');
O._setProvidersForTest({ google: mock.urls, telegram: mock.urls });
const { db } = await import('./core/db.ts');

beforeEach(() => { db.prepare("DELETE FROM login_attempts WHERE key LIKE 'oauth-xfail:%'").run() });
const sha = (v: string) => createHash('sha256').update(v).digest('base64url');
const pair = () => { const verifier = randomBytes(32).toString('base64url'); return { verifier, challenge: sha(verifier) } };
type C = ReturnType<typeof client>;
let n = 0;
const sub = () => `${700000000 + ++n}`;   // numeric, like a Telegram id

async function flow(c: C, o: { provider?: 'google' | 'telegram'; intent?: string; sub: string; tweak?: object; password?: string }) {
  const p = pair(), provider = o.provider ?? 'telegram';
  const s = await c.json('POST', '/api/auth/oauth/start', { provider, intent: o.intent ?? 'login', challenge: p.challenge, ret: 'web', password: o.password });
  if (s.status !== 200) return { start: s, ...p, location: '', state: '' };
  const state = new URL(s.body.url).searchParams.get('state')!;
  const pc = mock.authorize(s.body.url, { sub: o.sub }, o.tweak);
  const res = await callback(provider, state, pc);
  return { start: s, ...p, state, pc, location: res.headers.get('location') ?? '' };
}
const callback = (provider: string, state: string, code: string) => fetch(`${b.base}/api/auth/oauth/callback/${provider}?code=${code}&state=${state}`, { redirect: 'manual' });
const codeOf = (loc: string) => /[#?](?:oauth|code)=([\w-]+)/.exec(loc)?.[1] ?? '';
const exchange = (c: C, code: string, verifier: string) => c.json('POST', '/api/auth/oauth/exchange', { code, verifier });
async function newAccount(name: string, provider: 'google' | 'telegram' = 'telegram', s = sub()) {
  const c = client(b.base), f = await flow(c, { provider, sub: s }), ex = await exchange(c, codeOf(f.location), f.verifier);
  assert.equal(ex.body.signup, true, JSON.stringify(ex.body));
  const r = await c.json('POST', '/api/auth/oauth/signup', { ticket: ex.body.ticket, verifier: f.verifier, name, invite: b.U.createInvite(null) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return { c, sub: s };
}

test('config: all-or-none env; status advertises telegram; start URL has S256 + fixed redirect and never the secret', async () => {
  const { oauthConfig } = await import('./core/mode.ts');
  assert.throws(() => oauthConfig({ CT_TELEGRAM_CLIENT_ID: '1' }), /CT_TELEGRAM_CLIENT_SECRET/);
  assert.throws(() => oauthConfig({ CT_TELEGRAM_CLIENT_SECRET: 'x' }), /CT_TELEGRAM_CLIENT_ID/);
  assert.deepEqual(oauthConfig({}), {});
  assert.equal(oauthConfig({ CT_TELEGRAM_CLIENT_ID: '1', CT_TELEGRAM_CLIENT_SECRET: 's', CT_TELEGRAM_BOT_USERNAME: 'bad name!' }).telegram?.botUsername, undefined);
  const c = client(b.base), st = await c.json('GET', '/api/auth/status');
  assert.deepEqual(st.body.oauth, { google: true, apple: false, telegram: true });
  assert.ok(!JSON.stringify(st.body).includes(TG.secret));
  const p = pair(), s = await c.json('POST', '/api/auth/oauth/start', { provider: 'telegram', intent: 'login', challenge: p.challenge, ret: 'web' });
  const u = new URL(s.body.url);
  assert.equal(u.origin + u.pathname, mock.urls.authorize);
  assert.equal(u.searchParams.get('client_id'), TG.clientId);
  assert.equal(u.searchParams.get('redirect_uri'), `http://localhost:${port}/api/auth/oauth/callback/telegram`);
  assert.equal(u.searchParams.get('scope'), 'openid'); assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(u.searchParams.get('state')!.length >= 40);
  assert.ok(!s.body.url.includes(TG.secret));
});

test('sign-up ticket, then the same Telegram id signs in; token call used Basic auth, no secret in the body, PKCE verifier sent', async () => {
  const before = mock.stats.basicOk, s = sub(), c = client(b.base);
  const f = await flow(c, { sub: s }), ex = await exchange(c, codeOf(f.location), f.verifier);
  assert.equal(ex.body.signup, true); assert.equal(ex.body.hint.provider, 'telegram'); assert.equal(ex.body.hint.email, null);
  const r = await c.json('POST', '/api/auth/oauth/signup', { ticket: ex.body.ticket, verifier: f.verifier, name: 'tguser', invite: b.U.createInvite(null) });
  assert.equal(r.status, 200); assert.equal(r.body.recoveryCodes.length, 8);
  const c2 = client(b.base), f2 = await flow(c2, { sub: s }), ex2 = await exchange(c2, codeOf(f2.location), f2.verifier);
  assert.equal(ex2.status, 200); assert.equal(ex2.body.user.name, 'tguser'); assert.match(ex2.headers.get('set-cookie')!, /^ct_session=/);
  assert.equal(mock.stats.basicOk, before + 2); assert.equal(mock.stats.tgBodySecret, 0);
  assert.ok(mock.stats.tgVerifiers.every(v => v.length >= 43));
});

test('forged id tokens are refused with no session: nonce, aud (another client), iss, exp, stale/future iat, alg none, HS256, foreign key, unknown kid', async () => {
  const cases: [string, object][] = [
    ['nonce', { nonce: 'not-the-nonce' }], ['aud', { aud: 'someone-else' }], ['aud google', { aud: GOOGLE.clientId }], ['iss', { iss: 'https://evil.example' }], ['iss google', { iss: 'https://accounts.google.com' }],
    ['expired', { expIn: -3600 }], ['iat stale', { iatIn: -3600 }], ['iat future', { iatIn: 3600 }], ['alg none', { alg: 'none' }], ['HS256', { alg: 'HS256' }],
    ['foreign key', { signer: 'other' }], ['unknown kid', { kid: 'nope' }],
  ];
  for (const [name, tweak] of cases) {
    const c = client(b.base), f = await flow(c, { sub: sub(), tweak });
    assert.match(f.location, /#error=failed$/, name); assert.ok(!codeOf(f.location), name);
  }
  const f = await flow(client(b.base), { sub: '', tweak: {} });   // empty sub
  assert.match(f.location, /#error=failed$/, 'missing sub');
  const long = await flow(client(b.base), { sub: '1'.repeat(300) });
  assert.match(long.location, /#error=failed$/, 'oversized sub');
  const reasons = (db.prepare("SELECT event FROM audit WHERE event LIKE 'oauth fail:%'").all() as { event: string }[]).map(r => r.event);
  for (const r of ['nonce', 'aud', 'iss', 'exp', 'iat', 'alg', 'kid', 'signature', 'sub']) assert.ok(reasons.includes('oauth fail:' + r), r);
});

test('Telegram documents no nonce: a token without one is accepted, a token with a wrong one is not; Google still requires it', async () => {
  assert.ok(codeOf((await flow(client(b.base), { sub: sub(), tweak: { noNonce: true } })).location));
  assert.match((await flow(client(b.base), { sub: sub(), tweak: { nonce: 'x' } })).location, /#error=failed$/);
  assert.match((await flow(client(b.base), { provider: 'google', sub: sub(), tweak: { noNonce: true } })).location, /#error=failed$/);
});

test('replay: state, provider code, one-time code, wrong verifier, and a captured id token cannot be pushed through the callback', async () => {
  const c = client(b.base), f = await flow(c, { sub: sub() });
  assert.ok(codeOf(f.location));
  const pc2 = mock.authorize(f.start.body.url, { sub: sub() });
  assert.match((await callback('telegram', f.state, pc2)).headers.get('location')!, /#error=expired$/, 'replayed state');
  const s = await c.json('POST', '/api/auth/oauth/start', { provider: 'telegram', intent: 'login', challenge: pair().challenge, ret: 'web' });
  const st = new URL(s.body.url).searchParams.get('state')!, pc = mock.authorize(s.body.url, { sub: sub() });
  assert.match((await callback('telegram', st, pc)).headers.get('location')!, /#code=|#oauth=/);
  assert.match((await callback('telegram', st, pc)).headers.get('location')!, /#error=expired$/, 'state is single use');
  const s2 = await c.json('POST', '/api/auth/oauth/start', { provider: 'telegram', intent: 'login', challenge: pair().challenge, ret: 'web' });
  assert.match((await callback('telegram', new URL(s2.body.url).searchParams.get('state')!, 'pc-unknown')).headers.get('location')!, /#error=failed$/, 'provider rejects a code it never issued');
  assert.match((await callback('google', new URL(s2.body.url).searchParams.get('state')!, 'x')).headers.get('location')!, /#error=expired$/, 'a state is bound to its provider');
  const g = await flow(c, { sub: sub() }), code = codeOf(g.location);
  assert.equal((await exchange(c, code, pair().verifier)).status, 400);
  assert.equal((await exchange(c, code, g.verifier)).status, 400, 'burned by the wrong verifier');
  const h = await flow(c, { sub: sub() }), hc = codeOf(h.location);
  assert.equal((await exchange(c, hc, h.verifier)).status, 200);
  assert.equal((await exchange(c, hc, h.verifier)).status, 400, 'replayed one-time code');
  // an attacker holding only a valid id_token has no way in: the server never accepts a token from the client, only from its own code exchange
  assert.equal((await c.json('POST', '/api/auth/oauth/exchange', { code: 'eyJhbGciOiJSUzI1NiJ9.e30.x', verifier: g.verifier })).status, 400);
  const expired = await flow(c, { sub: sub() });
  db.prepare('UPDATE oauth_code SET expires = 1').run();
  assert.equal((await exchange(c, codeOf(expired.location), expired.verifier)).status, 400);
});

test('denied at Telegram, unknown provider path and a disabled provider', async () => {
  const c = client(b.base), s = await c.json('POST', '/api/auth/oauth/start', { provider: 'telegram', intent: 'login', challenge: pair().challenge, ret: 'web' });
  const d = await fetch(`${b.base}/api/auth/oauth/callback/telegram?error=access_denied%3Cscript%3E&state=${new URL(s.body.url).searchParams.get('state')}`, { redirect: 'manual' });
  assert.match(d.headers.get('location')!, /#error=denied$/);
  assert.equal((await c.json('POST', '/api/auth/oauth/start', { provider: 'github', intent: 'login', challenge: pair().challenge, ret: 'web' })).status, 404);
});

test('accounts: no silent merge with Google, link / unlink, last-method refusal, identity_taken, a Telegram-only account has no password', async () => {
  const same = sub();
  const g = await newAccount('gmatch', 'google', same);   // a Google subject equal to a Telegram id string
  const t = await flow(client(b.base), { sub: same }), tx = await exchange(client(b.base), codeOf(t.location), t.verifier);
  assert.equal(tx.body.signup, true, 'a Telegram identity never matches a Google one');
  const tg = await newAccount('tgonly', 'telegram');
  assert.equal((await tg.c.json('POST', '/api/auth/login', { name: 'tgonly', password: 'whatever-long-password' })).status === 200, false);
  const ids = await tg.c.json('GET', '/api/auth/identities');
  assert.equal(ids.body.hasPassword, false); assert.deepEqual(ids.body.identities.map((i: { provider: string }) => i.provider), ['telegram']);
  assert.equal((await tg.c.json('DELETE', '/api/auth/identities/telegram', {})).status, 409, 'last method');
  // link needs a session
  const anon = await client(b.base).json('POST', '/api/auth/oauth/start', { provider: 'telegram', intent: 'link', challenge: pair().challenge, ret: 'web' });
  assert.equal(anon.status, 401);
  // the Google-only account links a fresh Telegram id (step-up: fresh Google login marked at sign-up/login)
  const gl = client(b.base), gf = await flow(gl, { provider: 'google', sub: same }), gx = await exchange(gl, codeOf(gf.location), gf.verifier);
  assert.equal(gx.status, 200);
  const link = await flow(gl, { intent: 'link', sub: sub() }), lx = await exchange(gl, codeOf(link.location), link.verifier);
  assert.equal(lx.status, 200, JSON.stringify(lx.body)); assert.equal(lx.body.linked, 'telegram');
  assert.equal((await flow(gl, { intent: 'link', sub: sub() })).start.status, 409, 'provider_linked');
  // another account cannot link a Telegram id that already belongs to tgonly
  const o2 = await newAccount('linker', 'google'), take = await flow(o2.c, { intent: 'link', sub: tg.sub }), tk = await exchange(o2.c, codeOf(take.location), take.verifier);
  assert.equal(tk.status, 409); assert.equal(tk.body.code, 'identity_taken');
  // unlink works now that two methods exist
  assert.ok((await gl.json('DELETE', '/api/auth/identities/telegram', {})).status < 300);
  assert.ok(!(await gl.json('GET', '/api/auth/identities')).body.identities.some((i: { provider: string }) => i.provider === 'telegram'));
});

test('telegram.org unreachable from the server: the browser lands on #error=unreachable (Google keeps "failed")', async () => {
  O._setProvidersForTest({ google: { ...mock.urls, token: 'http://127.0.0.1:1/token' }, telegram: { ...mock.urls, token: 'http://127.0.0.1:1/token' } });
  try {
    assert.match((await flow(client(b.base), { sub: sub() })).location, /#error=unreachable$/);
    assert.match((await flow(client(b.base), { provider: 'google', sub: sub() })).location, /#error=failed$/);
    assert.ok((db.prepare("SELECT event FROM audit WHERE event = 'oauth fail:network'").all()).length >= 2);
  } finally { O._setProvidersForTest({ google: mock.urls, telegram: mock.urls }) }
});

test('the client secret, Basic header, id_token and codes never reach logs, audit rows or any response', async () => {
  const basic = Buffer.from(`${TG.clientId}:${TG.secret}`).toString('base64');
  const audit = JSON.stringify(db.prepare('SELECT * FROM audit').all());
  for (const hay of [logs.join('\n'), audit]) { assert.ok(!hay.includes(TG.secret)); assert.ok(!hay.includes(basic)); assert.ok(!/eyJ[\w-]+\.[\w-]+\.[\w-]+/.test(hay), 'no JWT') }
  const c = client(b.base), f = await flow(c, { sub: sub() });
  assert.ok(!JSON.stringify(f.start.body).includes(TG.secret));
});
