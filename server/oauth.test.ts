// Sign in with Google / Apple against a local mock provider (docs/research/oauth-sync-design.md section 7). No real network.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const freePort = async () => {
  for (;;) {
    const p = 19000 + Math.floor(Math.random() * 1000);
    if (await new Promise<boolean>(r => { const s = net.createServer(); s.once('error', () => r(false)); s.listen(p, '127.0.0.1', () => s.close(() => r(true))) })) return p;
  }
};
const logs: string[] = [];
for (const m of ['log', 'warn', 'error', 'info'] as const) { const o = console[m]; console[m] = (...a: unknown[]) => { logs.push(a.map(String).join(' ')); o(...a) } }

const keyDir = mkdtempSync(join(tmpdir(), 'ct-p8-'));
const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const keyFile = join(keyDir, 'AuthKey_KEYID12345.p8');
writeFileSync(keyFile, ec.privateKey.export({ type: 'pkcs8', format: 'pem' }));
const APPLE = { serviceId: 'com.example.ct.web', teamId: 'TEAMID1234', keyId: 'KEYID12345' };
const GOOGLE = { clientId: 'gid.apps.example', secret: 'gsecret' };

const { startMock } = await import('./oidcmock.ts');
const { boot, client, signup, PASS } = await import('./publictest.ts');
const port = await freePort(), mock = await startMock({ port: await freePort(), google: GOOGLE, apple: { ...APPLE, publicKey: ec.publicKey } });
const b = await boot({
  CT_PUBLIC_URL: `http://localhost:${port}`, CT_REG_PER_HOUR: '1000', CT_AUTH_RPS: '1000', CT_ANON_RPS: '1000', CT_ANON_BURST: '100000', CT_AUTH_BURST: '100000', CT_OAUTH_START_MAX: '100000', CT_OAUTH_CB_MAX: '100000', CT_QUOTA_RPS: '1000', CT_QUOTA_BURST: '1000',
  CT_GOOGLE_CLIENT_ID: GOOGLE.clientId, CT_GOOGLE_CLIENT_SECRET: GOOGLE.secret,
  CT_APPLE_SERVICE_ID: APPLE.serviceId, CT_APPLE_TEAM_ID: APPLE.teamId, CT_APPLE_KEY_ID: APPLE.keyId, CT_APPLE_PRIVATE_KEY_FILE: keyFile,
}, port);
after(() => { b.close(); mock.close(); rmSync(keyDir, { recursive: true, force: true }) });
const O = await import('./oauth.ts');
O._setProvidersForTest({ google: mock.urls, apple: mock.urls });
const { db } = await import('./core/db.ts');
const { stats } = await import('./core/users.ts');

beforeEach(() => { db.prepare("DELETE FROM login_attempts WHERE key LIKE 'oauth-xfail:%'").run() });   // tests fail on purpose; each starts with a clean budget
const sha = (v: string) => createHash('sha256').update(v).digest('base64url');
const pair = () => { const verifier = randomBytes(32).toString('base64url'); return { verifier, challenge: sha(verifier) } };
type C = ReturnType<typeof client>;
let n = 0;
const sub = () => `sub-${++n}-${randomBytes(4).toString('hex')}`;

/** start -> provider approves -> callback. Returns where the browser lands and the client's verifier. */
async function flow(c: C, o: { provider?: 'google' | 'apple'; intent?: string; user: { sub: string; email?: string; emailVerified?: boolean | string; relay?: boolean }; tweak?: object; ret?: string; port?: number; device?: string; password?: string; replayState?: boolean }) {
  const p = pair(), provider = o.provider ?? 'google';
  const s = await c.json('POST', '/api/auth/oauth/start', { provider, intent: o.intent ?? 'login', challenge: p.challenge, ret: o.ret ?? 'web', port: o.port, device: o.device, password: o.password });
  if (s.status !== 200) { return { start: s, ...p, location: '' } }
  const url = new URL(s.body.url), state = url.searchParams.get('state')!;
  const pc = mock.authorize(s.body.url, o.user, o.tweak);
  const res = await callback(provider, state, pc);
  return { start: s, ...p, state, pc, url, location: res.headers.get('location') ?? '', res };
}
const callback = (provider: string, state: string, code: string, extra = '') => provider === 'google'
  ? fetch(`${b.base}/api/auth/oauth/callback/google?code=${code}&state=${state}`, { redirect: 'manual' })
  : fetch(`${b.base}/api/auth/oauth/callback/apple`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://appleid.apple.com' }, body: `code=${code}&state=${state}${extra}` });
const codeOf = (loc: string) => /[#?](?:oauth|code)=([\w-]+)/.exec(loc)?.[1] ?? '';
const exchange = (c: C, code: string, verifier: string, device?: string) => c.json('POST', '/api/auth/oauth/exchange', { code, verifier, device });
/** Whole login for a new person: returns the signed-in client (an account was created). */
async function newAccount(name: string, user = { sub: sub(), email: `${name}@example.com` }, provider: 'google' | 'apple' = 'google') {
  const c = client(b.base), f = await flow(c, { user, provider }), ex = await exchange(c, codeOf(f.location), f.verifier);
  assert.equal(ex.body.signup, true, JSON.stringify(ex.body));
  const r = await c.json('POST', '/api/auth/oauth/signup', { ticket: ex.body.ticket, verifier: f.verifier, name, invite: b.U.createInvite(null) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return { c, user, codes: r.body.recoveryCodes as string[] };
}

test('status advertises the providers; start builds a provider URL from constants and CT_PUBLIC_URL only', async () => {
  const c = client(b.base);
  assert.deepEqual((await c.json('GET', '/api/auth/status')).body.oauth, { google: true, apple: true, telegram: false });
  const p = pair(), s = await c.json('POST', '/api/auth/oauth/start', { provider: 'google', intent: 'login', challenge: p.challenge, ret: 'web' });
  const u = new URL(s.body.url);
  assert.equal(u.origin + u.pathname, mock.urls.authorize);
  assert.equal(u.searchParams.get('redirect_uri'), `http://localhost:${port}/api/auth/oauth/callback/google`);
  assert.equal(u.searchParams.get('scope'), 'openid email'); assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(u.searchParams.get('state')!.length >= 40 && u.searchParams.get('nonce')!.length >= 40);
  const bad = (body: object) => c.json('POST', '/api/auth/oauth/start', { provider: 'google', intent: 'login', challenge: p.challenge, ret: 'web', ...body });
  for (const body of [{ ret: 'https://evil.example/x' }, { ret: '//evil.example' }, { ret: 'loopback' }, { ret: 'loopback', port: 80 }, { ret: 'loopback', port: 70000 }, { ret: 'loopback', port: '8080' }, { challenge: 'short' }, { intent: 'x' }, { redirect_uri: 1, challenge: '' }])
    assert.equal((await bad(body)).status, 400, JSON.stringify(body));
  assert.equal((await bad({ provider: 'github' })).status, 404);
});

test('first sign-in: no account is created by the callback; invite mode needs an invite; then the same Google login signs in', async () => {
  const c = client(b.base), user = { sub: sub(), email: 'newbie@example.com' };
  const before = (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
  const f = await flow(c, { user });
  assert.match(f.location, new RegExp(`^http://localhost:${port}/#oauth=[\\w-]{40,}$`));
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n, before, 'the callback created nothing');
  const ex = await exchange(c, codeOf(f.location), f.verifier);
  assert.equal(ex.status, 200); assert.equal(ex.body.signup, true); assert.equal(ex.body.hint.email, 'newbie@example.com'); assert.ok(!ex.headers.get('set-cookie'));
  const sg = (body: object) => c.json('POST', '/api/auth/oauth/signup', { ticket: ex.body.ticket, verifier: f.verifier, ...body });
  assert.equal((await sg({ name: 'newbie' })).status, 403, 'invite mode: no invite');
  assert.equal((await sg({ name: 'newbie', invite: 'made-up' })).status, 403);
  assert.equal((await sg({ name: 'x' })).status, 400, 'bad name does not spend the ticket');
  assert.equal((await sg({ name: 'admin', invite: b.U.createInvite(null) })).status, 409, 'reserved name');
  const ok = await sg({ name: 'newbie', invite: b.U.createInvite(null) });
  assert.equal(ok.status, 200, JSON.stringify(ok.body)); assert.equal(ok.body.recoveryCodes.length, 8); assert.equal(ok.body.user.name, 'newbie');
  assert.match(ok.headers.get('set-cookie')!, /^ct_session=/);
  assert.equal((await c.json('GET', '/api/auth/status')).body.user.name, 'newbie');
  assert.equal((await sg({ name: 'newbie2', invite: b.U.createInvite(null) })).status, 400, 'a ticket works once');
  // later: the same Google account signs in
  const c2 = client(b.base), f2 = await flow(c2, { user }), ex2 = await exchange(c2, codeOf(f2.location), f2.verifier);
  assert.equal(ex2.status, 200, JSON.stringify(ex2.body)); assert.equal(ex2.body.user.name, 'newbie'); assert.match(ex2.headers.get('set-cookie')!, /^ct_session=/);
  assert.equal((await c2.json('GET', '/api/state')).status, 200);
});

test('ID token checks: nonce, aud, iss, exp, iat, alg none, HS256 with the public key, foreign signature, unknown kid, at_hash, azp', async () => {
  const cases: [string, object][] = [
    ['nonce', { nonce: 'not-the-nonce' }], ['aud', { aud: 'someone-else' }], ['aud array without azp', { aud: [GOOGLE.clientId, 'other'] }], ['aud array wrong azp', { aud: [GOOGLE.clientId, 'other'], azp: 'other' }],
    ['iss', { iss: 'https://evil.example' }], ['expired', { expIn: -3600 }], ['iat future', { iatIn: 3600 }], ['alg none', { alg: 'none' }], ['HS256', { alg: 'HS256' }],
    ['foreign key', { signer: 'other' }], ['unknown kid', { kid: 'nope' }], ['at_hash', { atHash: 'bad' }],
  ];
  for (const [name, tweak] of cases) {
    const c = client(b.base), f = await flow(c, { user: { sub: sub() }, tweak });
    assert.match(f.location, /#error=failed$/, name); assert.ok(!codeOf(f.location), name);
  }
  const ok = [{ aud: [GOOGLE.clientId, 'other'], azp: GOOGLE.clientId }, { iss: 'accounts.google.com' }, { atHash: 'none' }];
  for (const tweak of ok) { const f = await flow(client(b.base), { user: { sub: sub() }, tweak }); assert.ok(codeOf(f.location), JSON.stringify(tweak)) }
  const reasons = (db.prepare("SELECT event FROM audit WHERE event LIKE 'oauth fail:%'").all() as { event: string }[]).map(r => r.event);
  for (const r of ['nonce', 'aud', 'iss', 'exp', 'iat', 'alg', 'kid', 'at_hash', 'signature']) assert.ok(reasons.includes('oauth fail:' + r), r);
});

test('email: unverified is dropped, the string "true" (Apple style) is kept; a different e-mail changes nothing', async () => {
  const hint = async (user: object) => { const c = client(b.base), f = await flow(c, { user: user as never }); return (await exchange(c, codeOf(f.location), f.verifier)).body.hint.email };
  assert.equal(await hint({ sub: sub(), email: 'a@example.com', emailVerified: false }), null);
  assert.equal(await hint({ sub: sub(), email: 'b@example.com', emailVerified: 'true' }), 'b@example.com');
});

test('state: replay, expiry, unknown, and another provider\'s path all land on #error=expired', async () => {
  const c = client(b.base), f = await flow(c, { user: { sub: sub() } });
  assert.ok(codeOf(f.location));
  const pc2 = mock.authorize(f.start.body.url, { sub: sub() });
  assert.match((await callback('google', f.state!, pc2)).headers.get('location')!, /#error=expired$/, 'replayed state');
  const g = await flow(c, { user: { sub: sub() } });   // fresh, then expire it
  const p = pair(), s = await c.json('POST', '/api/auth/oauth/start', { provider: 'google', intent: 'login', challenge: p.challenge, ret: 'web' });
  const st = new URL(s.body.url).searchParams.get('state')!, pc = mock.authorize(s.body.url, { sub: sub() });
  db.prepare('UPDATE oauth_state SET expires = 1').run();
  assert.match((await callback('google', st, pc)).headers.get('location')!, /#error=expired$/);
  assert.ok(g.location);
  assert.match((await callback('google', 'garbage', 'x')).headers.get('location')!, /#error=expired$/);
  // a state minted for Google cannot be used on the Apple callback
  const s2 = await c.json('POST', '/api/auth/oauth/start', { provider: 'google', intent: 'login', challenge: p.challenge, ret: 'web' });
  assert.match((await callback('apple', new URL(s2.body.url).searchParams.get('state')!, 'x')).headers.get('location')!, /#error=expired$/);
  // the user declined at the provider
  const s3 = await c.json('POST', '/api/auth/oauth/start', { provider: 'google', intent: 'login', challenge: p.challenge, ret: 'web' });
  const d = await fetch(`${b.base}/api/auth/oauth/callback/google?error=access_denied%3Cscript%3E&state=${new URL(s3.body.url).searchParams.get('state')}`, { redirect: 'manual' });
  assert.match(d.headers.get('location')!, /#error=denied$/);
});

test('client PKCE binding: a wrong verifier burns the code, a replayed code fails, a code is useless for someone else\'s start', async () => {
  const c = client(b.base), f = await flow(c, { user: { sub: sub() } }), code = codeOf(f.location);
  assert.equal((await exchange(c, code, pair().verifier)).status, 400);
  assert.equal((await exchange(c, code, f.verifier)).status, 400, 'burned by the failed attempt');
  const g = await flow(c, { user: { sub: sub() } }), gc = codeOf(g.location);
  assert.equal((await exchange(c, gc, f.verifier)).status, 400, 'a verifier from another start');
  const h = await flow(c, { user: { sub: sub() } }), hc = codeOf(h.location);
  assert.equal((await exchange(c, hc, h.verifier)).status, 200);
  assert.equal((await exchange(c, hc, h.verifier)).status, 400, 'replay');
  assert.deepEqual((await exchange(c, 'nope', 'x'.repeat(43))).body, { error: 'Sign-in failed. Please try again' }, 'one uniform error');
  const v = await flow(c, { user: { sub: sub() } });   // an expired code
  db.prepare('UPDATE oauth_code SET expires = 1').run();
  assert.equal((await exchange(c, codeOf(v.location), v.verifier)).status, 400);
});

test('ret targets: web fragment, app page fragment, loopback query on 127.0.0.1 only; errors use the same shape', async () => {
  const u = { sub: sub() };
  assert.match((await flow(client(b.base), { user: u, ret: 'app' })).location, new RegExp(`^http://localhost:${port}/oauth-return\\.html#code=[\\w-]{40,}$`));
  assert.match((await flow(client(b.base), { user: u, ret: 'loopback', port: 51234 })).location, /^http:\/\/127\.0\.0\.1:51234\/ct-oauth\?code=[\w-]{40,}$/);
  assert.equal((await flow(client(b.base), { user: u, ret: 'loopback', port: 51234, tweak: { aud: 'x' } })).location, 'http://127.0.0.1:51234/ct-oauth?error=failed');
  assert.equal((await flow(client(b.base), { user: u, ret: 'app', tweak: { aud: 'x' } })).location, `http://localhost:${port}/oauth-return.html#error=failed`);
});

test('device token mode: label bound at start, token returned, no cookie; a different label cannot redeem the code', async () => {
  const acc = await newAccount('dev-user'), c = client(b.base);
  const f = await flow(c, { user: acc.user, device: 'My phone' }), code = codeOf(f.location);
  assert.equal((await exchange(c, code, f.verifier, 'Other phone')).status, 400, 'device label mismatch');
  const g = await flow(c, { user: acc.user, device: 'My phone' }), ex = await exchange(c, codeOf(g.location), g.verifier, 'My phone');
  assert.equal(ex.status, 200); assert.ok(ex.body.token); assert.ok(!ex.headers.get('set-cookie'));
  const r = await fetch(b.base + '/api/state', { headers: { authorization: 'Bearer ' + ex.body.token, 'x-ct-client': 'testclient-1' } });
  assert.equal(r.status, 200);
  // cross-site call without a device label is refused (cookies never cross origins)
  const x = await fetch(b.base + '/api/auth/oauth/exchange', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://evil.example', 'x-ct-client': 'testclient-1' }, body: '{}' });
  assert.equal(x.status, 403);
});

test('Sign in with Apple: form_post callback (CSRF-exempt for that path only), ES256 client secret verified by the mock, `user` field ignored', async () => {
  const user = { sub: sub(), email: 'abc@privaterelay.appleid.com', relay: true };
  const c = client(b.base), p = pair();
  const s = await c.json('POST', '/api/auth/oauth/start', { provider: 'apple', intent: 'login', challenge: p.challenge, ret: 'web' });
  const q = new URL(s.body.url).searchParams;
  assert.equal(q.get('response_mode'), 'form_post'); assert.equal(q.get('scope'), 'email'); assert.equal(q.get('client_id'), APPLE.serviceId);
  const secrets = mock.stats.appleSecretOk;
  const pc = mock.authorize(s.body.url, user);
  const res = await callback('apple', q.get('state')!, pc, '&user=' + encodeURIComponent(JSON.stringify({ name: { firstName: 'Evil', lastName: 'Name' }, email: 'victim@example.com' })));
  assert.equal(res.status, 303); assert.equal(mock.stats.appleSecretOk, secrets + 1, 'client_secret was a valid ES256 JWT');
  const ex = await exchange(c, codeOf(res.headers.get('location')!), p.verifier);
  assert.equal(ex.body.signup, true); assert.equal(ex.body.hint.relay, true); assert.equal(ex.body.hint.email, 'abc@privaterelay.appleid.com');
  assert.ok(!JSON.stringify(ex.body).includes('Evil') && !JSON.stringify(ex.body).includes('victim@'));
  const r = await c.json('POST', '/api/auth/oauth/signup', { ticket: ex.body.ticket, verifier: p.verifier, name: 'apple-user', invite: b.U.createInvite(null) });
  assert.equal(r.status, 200);
  assert.deepEqual((await c.json('GET', '/api/auth/identities')).body.identities.map((i: { provider: string; relay: boolean }) => [i.provider, i.relay]), [['apple', true]]);
  // the exemption covers exactly one path
  const form = (path: string) => fetch(b.base + path, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://appleid.apple.com' }, body: 'a=1' });
  for (const path of ['/api/auth/oauth/exchange', '/api/auth/login', '/api/auth/oauth/start']) assert.equal((await form(path)).status, 403, path);
  assert.equal((await fetch(b.base + '/api/auth/oauth/callback/apple', { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 303, 'wrong content type is just a failed callback');
});

test('account takeover attempts: same e-mail but another subject never reaches the existing account; e-mail is never a lookup key', async () => {
  const victim = await newAccount('victim-1', { sub: sub(), email: 'victim@example.com' });
  const c = client(b.base), f = await flow(c, { user: { sub: sub(), email: 'victim@example.com' } }), ex = await exchange(c, codeOf(f.location), f.verifier);
  assert.equal(ex.body.signup, true, 'a new subject with the victim\'s e-mail is a new signup, not a login');
  assert.ok(!ex.headers.get('set-cookie') && !ex.body.token);
  // ... and the victim's account has exactly one identity
  assert.equal((await victim.c.json('GET', '/api/auth/identities')).body.identities.length, 1);
  // google subject of one provider cannot be presented as the same subject of another
  const f2 = await flow(client(b.base), { provider: 'apple', user: { sub: victim.user.sub, email: 'victim@example.com' } });
  const ex2 = await exchange(client(b.base), codeOf(f2.location), f2.verifier);
  assert.notEqual(ex2.body.ok, true);
});

test('link / unlink rules', async () => {
  const alice = await signup(b, 'alice-l'), bob = await signup(b, 'bob-l');
  const gsub = sub(), user = { sub: gsub, email: 'alice@example.com' };
  // anonymous cannot link
  assert.equal((await client(b.base).json('POST', '/api/auth/oauth/start', { provider: 'google', intent: 'link', challenge: pair().challenge, ret: 'web' })).status, 401);
  // step-up: the password is required
  assert.equal((await flow(alice.c, { intent: 'link', user })).start.status, 401);
  assert.equal((await flow(alice.c, { intent: 'link', user, password: 'wrong password!' })).start.status, 401);
  const f = await flow(alice.c, { intent: 'link', user, password: PASS }), code = codeOf(f.location);
  assert.ok(code);
  assert.equal((await exchange(bob.c, code, f.verifier)).status, 400, 'another user\'s session cannot redeem alice\'s link code');
  const f1 = await flow(alice.c, { intent: 'link', user, password: PASS });
  assert.deepEqual((await exchange(alice.c, codeOf(f1.location), f1.verifier)).body, { ok: true, linked: 'google' });
  assert.equal((await alice.c.json('GET', '/api/auth/identities')).body.hasPassword, true);
  assert.equal((await flow(alice.c, { intent: 'link', user: { sub: sub() }, password: PASS })).start.status, 409, 'one Google per account');
  // bob cannot take alice's Google account, and learns nothing about her other than that it is taken
  const fb = await flow(bob.c, { intent: 'link', user, password: PASS }), eb = await exchange(bob.c, codeOf(fb.location), fb.verifier);
  assert.equal(eb.status, 409); assert.equal(eb.body.code, 'identity_taken');
  assert.equal((await bob.c.json('GET', '/api/auth/identities')).body.identities.length, 0);
  // Google login now signs in alice
  const c = client(b.base), fl = await flow(c, { user }), el = await exchange(c, codeOf(fl.location), fl.verifier);
  assert.equal(el.body.user.name, 'alice-l');
  // unlink: password step-up; bob has nothing to unlink (404, same as an unknown provider)
  assert.equal((await bob.c.json('DELETE', '/api/auth/identities/google', { password: PASS })).status, 404);
  assert.equal((await alice.c.json('DELETE', '/api/auth/identities/apple', { password: PASS })).status, 404);
  assert.equal((await alice.c.json('DELETE', '/api/auth/identities/google', { password: 'nope nope nope' })).status, 401);
  assert.equal((await alice.c.json('DELETE', '/api/auth/identities/google', { password: PASS })).status, 204);
  assert.equal((await alice.c.json('GET', '/api/auth/identities')).body.identities.length, 0);
});

test('OAuth-only account: no password login (no timing oracle), cannot unlink the last method, password set needs a fresh re-auth, then unlink works', async () => {
  const acc = await newAccount('oauth-only');
  const nobody = await client(b.base).json('POST', '/api/auth/login', { name: 'nobody-here-1', password: 'x'.repeat(12) });
  const h = stats.hashes, r = await client(b.base).json('POST', '/api/auth/login', { name: 'oauth-only', password: 'x'.repeat(12) });
  assert.equal(stats.hashes - h, 1, 'one scrypt, like an unknown name'); assert.deepEqual(r.body, nobody.body); assert.equal(r.status, 401);
  assert.equal((await client(b.base).json('POST', '/api/auth/login', { name: 'oauth-only', password: 'oauth$' })).status, 401);
  const idr = (await acc.c.json('GET', '/api/auth/identities')).body; assert.equal(idr.hasPassword, false); assert.equal(idr.identities[0].provider, 'google');
  const del = await acc.c.json('DELETE', '/api/auth/identities/google', {});
  assert.equal(del.status, 409); assert.equal(del.body.code, 'last_method');
  // password set: needs a fresh provider login/re-auth
  db.prepare('DELETE FROM oauth_stepup').run();
  const ps = await acc.c.json('POST', '/api/auth/password/set', { password: 'a brand new password' });
  assert.equal(ps.status, 403); assert.equal(ps.body.code, 'stepup_required');
  // re-auth round trip proves control of the linked identity; another subject cannot
  const bad = await flow(acc.c, { intent: 'reauth', user: { sub: sub() } });
  assert.equal((await exchange(acc.c, codeOf(bad.location), bad.verifier)).status, 400);
  assert.equal((await acc.c.json('POST', '/api/auth/password/set', { password: 'a brand new password' })).status, 403);
  const ra = await flow(acc.c, { intent: 'reauth', user: acc.user });
  assert.deepEqual((await exchange(acc.c, codeOf(ra.location), ra.verifier)).body, { ok: true, reauth: true });
  assert.equal((await acc.c.json('POST', '/api/auth/password/set', { password: 'short' })).status, 400);
  assert.equal((await acc.c.json('POST', '/api/auth/password/set', { password: 'a brand new password' })).status, 200);
  assert.equal((await acc.c.json('POST', '/api/auth/password/set', { password: 'another new password' })).status, 409, 'already has one');
  assert.equal((await client(b.base).json('POST', '/api/auth/login', { name: 'oauth-only', password: 'a brand new password' })).status, 200);
  assert.equal((await acc.c.json('GET', '/api/auth/identities')).body.hasPassword, true);
  assert.equal((await acc.c.json('DELETE', '/api/auth/identities/google', { password: 'a brand new password' })).status, 204);
  // recovery codes were issued at signup and work as the way back for a lost provider account
  const lost = await newAccount('lost-google');
  const rc = await client(b.base).json('POST', '/api/auth/recover', { name: 'lost-google', code: lost.codes[0], newPassword: 'recovered password 1' });
  assert.equal(rc.status, 200);
});

test('race on first sign-up: one ticket works once; two tickets for one identity make one account', async () => {
  const user = { sub: sub() }, c = client(b.base);
  const f = await flow(c, { user }), ex = await exchange(c, codeOf(f.location), f.verifier);
  const f2 = await flow(client(b.base), { user }), ex2 = await exchange(client(b.base), codeOf(f2.location), f2.verifier);
  const go = (ticket: string, verifier: string, name: string) => client(b.base).json('POST', '/api/auth/oauth/signup', { ticket, verifier, name, invite: b.U.createInvite(null) });
  const rs = await Promise.all([go(ex.body.ticket, f.verifier, 'race-one'), go(ex.body.ticket, f.verifier, 'race-two')]);
  assert.deepEqual(rs.map(r => r.status).sort(), [200, 400], 'same ticket twice');
  const r3 = await go(ex2.body.ticket, f2.verifier, 'race-three');
  assert.equal(r3.status, 409, 'the identity already has an account'); assert.match(r3.body.error, /already linked/);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM users WHERE name LIKE 'race-%'").get() as { n: number }).n, 1);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM identities WHERE subject = ?').get(user.sub) as { n: number }).n, 1);
  // the invite used by the failed attempt was not spent (same transaction)
  const inv = b.U.createInvite(null), f4 = await flow(client(b.base), { user: { sub: sub() } }), ex4 = await exchange(client(b.base), codeOf(f4.location), f4.verifier);
  assert.equal((await go(ex4.body.ticket, f4.verifier, 'race-one')).status, 409, 'taken name');
  assert.equal(b.U.createInvite && (db.prepare('SELECT uses_left FROM invites ORDER BY rowid DESC LIMIT 1').get() as { uses_left: number }).uses_left, 1);
  assert.ok(inv);
});

test('disabled account: the Google login fails exactly like any other failure', async () => {
  const acc = await newAccount('to-disable');
  b.U.setStatus('to-disable', 'disabled');
  const c = client(b.base), f = await flow(c, { user: acc.user }), ex = await exchange(c, codeOf(f.location), f.verifier);
  assert.equal(ex.status, 400); assert.deepEqual(ex.body, { error: 'Sign-in failed. Please try again' });
  const ids = b.U.listUsers().find(u => u.name === 'to-disable')!;
  assert.equal(ids.has_pw, 0); assert.match(ids.identities[0].email!, /^t\*\*\*@example\.com$/);
});

test('failed exchanges are budgeted per address', async () => {
  const c = client(b.base);
  let last = 0;
  for (let i = 0; i < 14; i++) last = (await exchange(c, 'bad-code-' + i, 'x'.repeat(43))).status;
  assert.equal(last, 429);
});

test('cross-user isolation of the new routes', async () => {
  const a = await newAccount('iso-a'), o = await signup(b, 'iso-b');
  const ids = (await o.c.json('GET', '/api/auth/identities')).body;
  assert.deepEqual(ids, { identities: [], hasPassword: true });
  assert.ok(!JSON.stringify(ids).includes(a.user.email!));
  assert.equal((await o.c.json('DELETE', '/api/auth/identities/google', { password: PASS })).status, 404);
  assert.equal((await a.c.json('GET', '/api/auth/identities')).body.identities.length, 1, 'untouched');
  const rp = await a.c.json('POST', '/api/restore', { label: 'mine', keys: { watch: ['A'] } });
  assert.equal((await o.c.json('GET', `/api/restore/${rp.body.id}`)).status, 404);
  assert.equal((await o.c.json('POST', `/api/restore/${rp.body.id}/apply`, {})).status, 404);
  assert.equal((await o.c.json('DELETE', `/api/restore/${rp.body.id}`)).status, 404);
  assert.deepEqual((await o.c.json('GET', '/api/restore')).body, []);
  assert.equal((await a.c.json('GET', `/api/restore/${rp.body.id}`)).status, 200);
});

test('nothing sensitive reached the logs', () => {
  const all = logs.join('\n');
  assert.ok(!/id_token|access_token|code_verifier|client_secret|gsecret|state=/.test(all));
});
