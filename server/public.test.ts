// Public mode: accounts, sessions, CSRF, throttling and quotas (phases 1 and 4 of docs/research/multiuser-design.md).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import http from 'node:http';
import WebSocket from 'ws';

const vapid = createRequire(import.meta.url)('web-push').generateVAPIDKeys();
const { boot, client, signup, PASS } = await import('./publictest.ts');
const b = await boot({
  CT_REG_PER_HOUR: '100', CT_QUOTA_RPS: '1000', CT_QUOTA_BURST: '1000', CT_QUOTA_ALERTS: '3', CT_QUOTA_STATE_KEYS: '3', CT_QUOTA_MEDIA_ITEMS: '2', CT_QUOTA_SHARES: '2',
  CT_QUOTA_PUSH_SUBS: '1', CT_QUOTA_DB_MB: '1', CT_QUOTA_SOCKETS: '2', CT_VAPID_PUBLIC: vapid.publicKey, CT_VAPID_PRIVATE: vapid.privateKey,
});
after(() => b.close());
const U = b.U, auth = await import('./core/auth.ts');
const alice = await signup(b, 'alice');

test('passwords are stored as self-describing scrypt; an unknown user costs the same scrypt work', async () => {
  const h = await U.hashPassword('some long password');
  assert.match(h, /^scrypt\$32768\$8\$1\$[\w+/=]+\$[\w+/=]+$/);
  assert.ok(await U.verifyPassword(h, 'some long password') && !await U.verifyPassword(h, 'other'));
  const before = U.stats.hashes;
  const r = await client(b.base).json('POST', '/api/auth/login', { name: 'nobody-here', password: 'x'.repeat(12) });
  assert.equal(r.status, 401);
  assert.equal(U.stats.hashes - before, 1, 'one dummy scrypt for an unknown name');
  const known = await client(b.base).json('POST', '/api/auth/login', { name: 'alice', password: 'wrong password!' });
  assert.deepEqual(known.body, r.body, 'same error for known and unknown users');
  assert.equal(r.body.error, 'Wrong username or password');
});

test('registration: policy, invite single use, races', async () => {
  const c = client(b.base), reg = (body: object) => c.json('POST', '/api/auth/register', body);
  assert.equal((await reg({ name: 'x', password: PASS, invite: 'a' })).status, 400, 'short name');
  assert.equal((await reg({ name: 'carol', password: 'short', invite: 'a' })).status, 400);
  assert.equal((await reg({ name: 'carol', password: 'password123', invite: 'a' })).status, 400, 'common password');
  assert.equal((await reg({ name: 'carol', password: PASS })).status, 403, 'invite needed');
  assert.equal((await reg({ name: 'carol', password: PASS, invite: 'made-up' })).status, 403);
  const inv = U.createInvite(null);   // one use, two simultaneous sign-ups
  const [r1, r2] = await Promise.all([reg({ name: 'dave-1', password: PASS, invite: inv }), client(b.base).json('POST', '/api/auth/register', { name: 'dave-2', password: PASS, invite: inv })]);
  assert.deepEqual([r1.status, r2.status].sort(), [200, 403], 'an invite is spent exactly once');
  const multi = U.createInvite(null, { uses: 2 });
  const [n1, n2] = await Promise.all([client(b.base).json('POST', '/api/auth/register', { name: 'same-name', password: PASS, invite: multi }), client(b.base).json('POST', '/api/auth/register', { name: 'Same-Name', password: PASS, invite: multi })]);
  assert.deepEqual([n1.status, n2.status].sort(), [200, 409], 'one account per name (case-insensitive)');
  assert.equal(n1.body?.recoveryCodes?.length ?? n2.body?.recoveryCodes?.length, 8);
});

test('session cookie: HttpOnly, Strict, fresh token on login (no fixation), __Host- name when HTTPS', async () => {
  const c = client(b.base);
  const r = await c.call('POST', '/api/auth/login', { name: 'alice', password: PASS });
  const sc = r.headers.get('set-cookie')!;
  assert.match(sc, /^ct_session=[\w-]+; Path=\/; HttpOnly; SameSite=Strict; Max-Age=2592000$/);
  const old = c.cookie;
  const r2 = await c.call('POST', '/api/auth/login', { name: 'alice', password: PASS });   // presenting an existing session
  assert.notEqual(r2.headers.get('set-cookie')!.split(';')[0], old);
  const stale = client(b.base); stale.cookie = old;
  assert.equal((await stale.json('GET', '/api/state')).status, 401, 'the presented session was replaced');
  assert.equal(auth.cookieName(true), '__Host-ct_session');
  assert.match(auth.sessionCookie('t', true), /^__Host-ct_session=t; Path=\/; HttpOnly; SameSite=Strict; Max-Age=\d+; Secure$/);
});

test('CSRF and Host checks', async () => {
  const c = alice.c, put = (h: Record<string, string>) => fetch(b.base + '/api/state/k', { method: 'PUT', headers: { cookie: c.cookie, 'content-type': 'application/json', ...h }, body: '{"value":1}' });
  assert.equal((await put({})).status, 403, 'no Origin, no Sec-Fetch-Site');
  assert.equal((await put({ origin: 'http://evil.example', 'x-ct-client': 'testclient-1' })).status, 403);
  assert.equal((await put({ origin: b.base })).status, 403, 'custom header missing');
  assert.equal((await put({ 'sec-fetch-site': 'same-origin', 'x-ct-client': 'testclient-1' })).status, 200);
  assert.equal((await put({ origin: 'null', 'x-ct-client': 'testclient-1' })).status, 403);
  const status = (host: string) => new Promise<number>(res => { const r = http.request(b.base + '/api/alerts', { headers: { host, cookie: c.cookie } }, x => { x.resume(); res(x.statusCode!) }); r.end() });
  assert.equal(await status('evil.example'), 421, 'Host not in CT_ALLOWED_HOSTS');
  assert.equal(await status('127.0.0.1'), 421, 'loopback is only allowed for the health check');
});

test('recovery codes work once and end every session; sessions are per user', async () => {
  const u = await signup(b, 'erin'), c = u.c;
  const other = client(b.base); await other.json('POST', '/api/auth/login', { name: 'erin', password: PASS });
  const r = await client(b.base).json('POST', '/api/auth/recover', { name: 'erin', code: u.codes[0], newPassword: 'a brand new passphrase' });
  assert.equal(r.status, 200); assert.equal(r.body.recoveryCodes.length, 8);
  assert.equal((await c.json('GET', '/api/state')).status, 401, 'old sessions ended');
  assert.equal((await client(b.base).json('POST', '/api/auth/recover', { name: 'erin', code: u.codes[0], newPassword: 'another new passphrase' })).status, 401, 'single use');
  assert.equal((await client(b.base).json('POST', '/api/auth/recover', { name: 'nobody-x', code: u.codes[1], newPassword: 'another new passphrase' })).status, 401);
  const aliceSessions = (await alice.c.json('GET', '/api/auth/sessions')).body as { id: string }[];
  const e = client(b.base); await e.json('POST', '/api/auth/login', { name: 'erin', password: 'a brand new passphrase' });
  assert.equal((await e.json('DELETE', `/api/auth/sessions/${aliceSessions[0].id}`)).status, 404, "cannot end someone else's session");
});

test('disabled accounts lose their sessions; admin tools need role + password in the body, never the URL', async () => {
  const f = await signup(b, 'frank');
  U.setStatus('frank', 'disabled');
  assert.equal((await f.c.json('GET', '/api/state')).status, 401);
  assert.equal((await client(b.base).json('POST', '/api/auth/login', { name: 'frank', password: PASS })).status, 403);

  const temp = await U.createAdmin('boss');
  const a = client(b.base);
  assert.equal((await a.json('POST', '/api/auth/login', { name: 'boss', password: temp })).body.user.mustChange, true);
  const blocked = await a.json('GET', '/api/state');
  assert.equal(blocked.status, 403); assert.equal(blocked.body.code, 'must_change');
  assert.equal((await a.json('POST', '/api/auth/password', { current: temp, password: PASS })).status, 200);
  assert.equal((await a.json('GET', '/api/state')).status, 200);

  assert.equal((await a.json('POST', `/api/admin/invites?password=${encodeURIComponent(PASS)}`, {})).status, 401, 'a password in the query string is ignored');
  assert.equal((await a.json('POST', '/api/admin/invites', { password: 12345 })).status, 401, 'must be a string');
  assert.equal((await a.json('POST', '/api/admin/invites', { password: 'wrong' })).status, 401);
  const ok = await a.json('POST', '/api/admin/invites', { password: PASS });
  assert.equal(ok.status, 200); assert.ok(ok.body.code.length >= 22);
  assert.equal((await alice.c.json('POST', '/api/admin/users', { password: PASS })).status, 404, 'non-admins get a 404');
  assert.equal((await a.json('POST', '/api/admin/users', { password: PASS })).body.length >= 5, true);
});

test('quotas answer 4xx with a message', async () => {
  const q = (await signup(b, 'quentin')).c, base = { sym: 'BTCUSDT', tf: '1h', source: { kind: 'price' }, condition: 'greater', value: 1, frequency: 'once', channels: [], message: '', active: false };
  for (let i = 0; i < 3; i++) assert.equal((await q.json('POST', '/api/alerts', base)).status, 200);
  const a4 = await q.json('POST', '/api/alerts', base);
  assert.equal(a4.status, 429); assert.match(a4.body.error, /at most 3 alerts/);
  for (const k of ['a', 'b', 'c']) assert.equal((await q.json('PUT', `/api/state/${k}`, { value: 1 })).status, 200);
  assert.equal((await q.json('PUT', '/api/state/d', { value: 1 })).status, 429);
  assert.equal((await q.json('PUT', '/api/state/a', { value: 'x'.repeat(2.5 * 1024 * 1024) })).status, 413, 'over 2 MB for one key');
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1]);
  for (let i = 0; i < 2; i++) assert.equal((await q.call('POST', '/api/media', png, { 'content-type': 'image/png' })).status, 200);
  assert.equal((await q.call('POST', '/api/media', png, { 'content-type': 'image/png' })).status, 429);
  assert.equal((await q.call('POST', '/api/media', Buffer.from('<svg/>'), { 'content-type': 'image/png' })).status, 400, 'magic bytes must match');
  for (let i = 0; i < 2; i++) assert.equal((await q.call('POST', '/api/share/snapshot', png, { 'content-type': 'image/png' })).status, 200);
  assert.equal((await q.call('POST', '/api/share/snapshot', png, { 'content-type': 'image/png' })).status, 429);
  const sub = (n: number) => q.json('POST', '/api/notify/push/subscribe', { subscription: { endpoint: `https://fcm.googleapis.com/fcm/send/${n}`, keys: { p256dh: 'BPaaaa', auth: 'bbbb' } } });
  assert.equal((await sub(1)).status, 200); assert.equal((await sub(2)).status, 429);
  assert.equal((await q.json('POST', '/api/alerts/log/import', { rows: Array.from({ length: 1001 }, (_, i) => ({ at: i + 1, message: 'm' })) })).status, 400);
  const big = await q.call('POST', '/api/alerts', undefined, { 'content-length': '400000', 'content-type': 'application/json' }).catch(() => null);
  void big;
  const huge = await fetch(b.base + '/api/alerts', { method: 'POST', headers: { cookie: q.cookie, origin: b.base, 'x-ct-client': 'testclient-1', 'content-type': 'application/json' }, body: JSON.stringify({ x: 'y'.repeat(300_000) }) });
  assert.equal(huge.status, 413, 'default body limit is 256 KB');
});

test('the database file has a hard size ceiling', async () => {
  const w = (await signup(b, 'wendy')).c;
  const put = (k: string) => w.json('PUT', `/api/state/${k}`, { value: 'z'.repeat(900_000) });
  const r1 = await put('k1'), r2 = await put('k2');
  assert.ok([r1.status, r2.status].includes(413), `one of the writes hit the ceiling (${r1.status}, ${r2.status})`);
});

test('WebSocket caps: sockets per user and message flood', async () => {
  const u = (await signup(b, 'sock')).c;   // CT_QUOTA_SOCKETS=2
  const open = () => new Promise<WebSocket>((res, rej) => { const ws = new WebSocket(b.base.replace('http', 'ws') + '/ws', { headers: { cookie: u.cookie, origin: b.base } }); ws.on('open', () => res(ws)); ws.on('error', rej) });
  const s1 = await open(), s2 = await open();
  await assert.rejects(open(), 'third socket refused');
  const closed = new Promise<number>(r => s1.on('close', c => r(c)));
  for (let i = 0; i < 200; i++) s1.send('{"op":"nothing"}');
  assert.equal(await closed, 1008);
  s2.close();
});

test('failed logins lock the (account, address) pair; the right password is refused while locked', async () => {
  const bob = await signup(b, 'bob');
  void bob;
  const c = client(b.base);
  for (let i = 0; i < 5; i++) assert.equal((await c.json('POST', '/api/auth/login', { name: 'bob', password: 'wrong password ' + i })).status, 401);
  const locked = await c.json('POST', '/api/auth/login', { name: 'bob', password: PASS });
  assert.equal(locked.status, 429); assert.ok(locked.headers.get('retry-after'));
  assert.ok(!JSON.stringify(locked.body).includes(PASS));
});
