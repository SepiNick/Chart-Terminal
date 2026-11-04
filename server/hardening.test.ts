// Regression tests for the findings of the adversarial review of the multi-user server (public mode).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { existsSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import WebSocket from 'ws';

const { boot, client, signup, PASS } = await import('./publictest.ts');
const b = await boot({ CT_REG_PER_HOUR: '200', CT_QUOTA_RPS: '1000', CT_QUOTA_BURST: '1000', CT_FEED_LIMIT_LIQ: '2', CT_BODY_BUDGET_MB: '20' });
after(() => b.close());
const U = b.U, { db } = await import('./core/db.ts'), { userDb } = await import('./core/userdb.ts');
const fakeReq = (ip: string) => ({ socket: { remoteAddress: ip }, headers: {} }) as never;
const idOf = (name: string) => (db.prepare('SELECT id FROM users WHERE name = ?').get(name) as { id: number }).id;

test('HIGH-1: a deleted account\'s id and file are never handed to the next registrant', async () => {
  const bob = await signup(b, 'bob-del');
  await bob.c.json('PUT', '/api/state/secret', { value: 'BOB-SECRET' });
  const bobId = idOf('bob-del'), bobFile = join(b.dir, 'users', `${bobId}.db`);
  // what the CLI does in another process: mark the account, the server must let go of the file by itself
  db.prepare("UPDATE users SET status = 'deleting' WHERE id = ?").run(bobId);
  await new Promise(r => setTimeout(r, 2600));
  assert.throws(() => userDb(bobId), /no such user/, 'the running server dropped the handle');
  assert.equal((await bob.c.json('GET', '/api/state')).status, 401);
  db.prepare("UPDATE users SET status = 'active' WHERE id = ?").run(bobId);
  await U.removeUser('bob-del');
  assert.ok(!existsSync(bobFile));
  const carol = await signup(b, 'carol-new');
  assert.ok(idOf('carol-new') > bobId, 'ids only go up');
  assert.deepEqual((await carol.c.json('GET', '/api/state')).body, {});
});

test('HIGH-1: a leftover file under the next id is wiped when the account is created', async () => {
  const dan = await signup(b, 'dan-1');
  await dan.c.json('PUT', '/api/state/secret', { value: 'DAN-SECRET' });
  const next = (db.prepare("SELECT value FROM config WHERE key = 'users.next_id'").get() as { value: string }).value;
  userDb(idOf('dan-1')).exec('PRAGMA wal_checkpoint(TRUNCATE)');
  copyFileSync(join(b.dir, 'users', `${idOf('dan-1')}.db`), join(b.dir, 'users', `${Number(next) + 1}.db`));
  const eve = await signup(b, 'eve-new');
  assert.equal(idOf('eve-new'), Number(next) + 1);
  assert.deepEqual((await eve.c.json('GET', '/api/state')).body, {}, 'the stale file did not leak');
});

test('a user database handle has a busy timeout', () => {
  assert.equal((userDb(idOf('dan-1')).prepare('PRAGMA busy_timeout').get() as { timeout: number }).timeout, 5000);
});

test('password re-confirmation shares the login throttle (and cannot be burst in parallel)', async () => {
  db.exec('DELETE FROM login_attempts');
  const u = await signup(b, 'frank-pw');
  const codes = await Promise.all(Array.from({ length: 12 }, () => u.c.json('POST', '/api/auth/recovery-codes', { password: 'wrong password!!' })));
  const s = codes.map(r => r.status);
  assert.ok(s.filter(x => x === 401).length <= 5, `at most 5 guesses were verified, got ${s.filter(x => x === 401).length}`);
  assert.ok(s.includes(429));
  assert.equal((await u.c.json('POST', '/api/auth/recovery-codes', { password: PASS })).status, 429, 'locked even for the right password');
  db.exec('DELETE FROM login_attempts');
});

test('70 parallel wrong logins from one address run only a handful of scrypts', async () => {
  db.exec('DELETE FROM login_attempts');
  await signup(b, 'victim-v');
  const before = U.stats.hashes;
  const r = await Promise.allSettled(Array.from({ length: 70 }, () => U.login({ name: 'victim-v', password: 'not the password' }, fakeReq('198.51.100.7'))));
  const verifies = U.stats.hashes - before;
  assert.ok(verifies <= 5, `verifies: ${verifies}`);
  assert.ok(r.filter(x => x.status === 'rejected' && (x.reason as { status: number }).status === 429).length >= 65);
  db.exec('DELETE FROM login_attempts');
});

test('IPv6 limits count a whole /64; an account guessed from many addresses is slowed', async () => {
  assert.equal(U.ipKey('2001:db8:1:2:aaaa::1'), U.ipKey('2001:db8:1:2:bbbb:cccc:dddd:2'));
  assert.notEqual(U.ipKey('2001:db8:1:2::1'), U.ipKey('2001:db8:1:3::1'));
  assert.equal(U.ipKey('::ffff:203.0.113.5'), '203.0.113.5');
  db.exec('DELETE FROM login_attempts');
  const before = U.stats.hashes;
  const r = await Promise.allSettled(Array.from({ length: 70 }, (_, i) => U.login({ name: 'victim-v', password: 'nope nope nope' }, fakeReq(`2001:db8:9:9:${i.toString(16)}::1`))));
  assert.ok(U.stats.hashes - before <= 10, 'one /64 is one address');
  void r;
  db.exec('DELETE FROM login_attempts');
  for (let i = 0; i < 24; i++) db.prepare("INSERT INTO login_attempts (key, n, until, at) VALUES ('acct:slowme', 24, 0, ?) ON CONFLICT(key) DO NOTHING").run(Date.now());
  assert.equal(U.accountDelayMs('slowme'), 4000, 'beyond 20 failures the account answers more slowly, whoever asks');
  db.exec('DELETE FROM login_attempts');
});

test('reserved names cannot be imitated', async () => {
  for (const name of ['adm1n', 'admin_2', 'supp0rt', 'r00t', 'Administrator1', 'sys.tem', 'ro0t']) {
    const r = await client(b.base).json('POST', '/api/auth/register', { name, password: PASS, invite: U.createInvite(null) });
    assert.equal(r.status, 409, name);
  }
  assert.equal((await client(b.base).json('POST', '/api/auth/register', { name: 'adamant', password: PASS, invite: U.createInvite(null) })).status, 200);
});

const send = (cookie: string, path: string, len: number, write = 'x') => new Promise<number>(res => {
  const u = new URL(b.base);
  const r = http.request({ host: u.hostname, port: u.port, path, method: path.startsWith('/api/state') ? 'PUT' : 'POST', headers: { host: u.host, cookie, origin: b.base, 'x-ct-client': 'testclient-1', 'content-type': path.startsWith('/api/media') ? 'image/png' : 'application/json', 'content-length': String(len) } }, x => { x.resume(); res(x.statusCode!); r.destroy() });
  r.on('error', () => {}); r.write(write);
});
test('bodies are refused by their declared size before being read, and share a global budget', async () => {
  const u = await signup(b, 'gina-b');
  assert.equal(await send(u.c.cookie, '/api/state/x', 3_000_000), 413, 'state key: about 2 MB');
  assert.equal(await send(u.c.cookie, '/api/alerts/log/import', 2_000_000), 413, 'alerts import: 1 MB');
  assert.equal(await send(u.c.cookie, '/api/alerts', 300_000), 413, 'default: 256 KB');
  // the journal may be 8 MB and media 15 MB; two 12 MB uploads in flight do not fit a 20 MB budget
  const first = send(u.c.cookie, '/api/media', 12_000_000);   // stays open: only a few bytes sent
  await new Promise(r => setTimeout(r, 200));
  assert.equal(await send(u.c.cookie, '/api/media', 12_000_000), 503);
  void first;
});

test('malformed escapes are a 400, not a 500', async () => {
  const u = await signup(b, 'hank-u');
  assert.equal((await u.c.call('GET', '/api/media/%E0%A4%A')).status, 400);
  assert.equal((await fetch(b.base + '/%E0%A4%A')).status, 400);
});

test('the media cache lifetime is a day, not a year', async () => {
  const u = await signup(b, 'ivy-m'), png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1]);
  const id = ((await (await u.c.call('POST', '/api/media', png, { 'content-type': 'image/png' })).json()) as { id: string }).id;
  assert.equal((await u.c.call('GET', `/api/media/${id}`)).headers.get('cache-control'), 'private, max-age=86400');
});

test('quota bytes are bytes, not characters', async () => {
  const u = await signup(b, 'joe-q'), { stateSet } = await import('./state.ts');
  assert.throws(() => stateSet('k', 'é'.repeat(1_050_000), undefined, idOf('joe-q')), /larger than/, '2.1 MB of UTF-8 in 1.05 M characters');
  void u;
});

test('state writes can be compare-and-set; a stale writer gets 409 with the current revision', async () => {
  const u = (await signup(b, 'kim-s')).c;
  assert.deepEqual((await u.json('PUT', '/api/state/doc', { value: 1, baseRev: 0 })).body, { rev: 1 });
  const stale = await u.json('PUT', '/api/state/doc', { value: 2, baseRev: 0 });
  assert.equal(stale.status, 409); assert.equal(stale.body.rev, 1); assert.equal(stale.body.value, 1);
  assert.equal((await u.json('PUT', '/api/state/doc', { value: 3 }, { 'if-match': '"1"' })).status, 200);
  assert.equal((await u.json('PUT', '/api/state/doc', { value: 4 }, { 'if-match': '1' })).status, 409);
  assert.equal((await u.json('PUT', '/api/state/doc', { value: 5 })).status, 200, 'no precondition: last write wins as before');
  assert.equal((await u.json('PUT', '/api/state/doc', { value: 5, baseRev: -1 })).status, 400);
});

test('sync.hello: one id per socket, the old tab key does not stay behind', async () => {
  const u = await signup(b, 'lee-w');
  const ws = await new Promise<{ ws: WebSocket; got: string[] }>((res, rej) => { const w = new WebSocket(b.base.replace('http', 'ws') + '/ws', { headers: { cookie: u.c.cookie, origin: b.base } }), got: string[] = []; w.on('message', d => got.push(String(d))); w.on('open', () => res({ ws: w, got })); w.on('error', rej) });
  ws.ws.send(JSON.stringify({ op: 'sync.hello', client: 'tab-one-aaaa' }));
  ws.ws.send(JSON.stringify({ op: 'sync.hello', client: 'tab-two-bbbb' }));
  await new Promise(r => setTimeout(r, 150));
  await u.c.json('PUT', '/api/state/t1', { value: 1 }, { 'x-ct-client': 'tab-one-aaaa' });   // not this socket's id any more: delivered
  await u.c.json('PUT', '/api/state/t2', { value: 2 }, { 'x-ct-client': 'tab-two-bbbb' });   // its id: skipped
  await new Promise(r => setTimeout(r, 200));
  const keys = ws.got.map(m => JSON.parse(m)).filter(m => m.type === 'state').map(m => m.key);
  assert.deepEqual(keys, ['t1']);
  ws.ws.close();
});

test('global caps: liquidation feeds and the SEC queue', async () => {
  const D = await import('./derivs.ts');
  D.deps.pro = (() => null) as never; D.deps.rest = (() => ({ has: {} })) as never;
  const q = (sym: string) => new URLSearchParams({ ex: 'binanceusdm', sym, period: '1h' });
  await D.derivs('liqs', q('BTC/USDT:USDT')); await D.derivs('liqs', q('ETH/USDT:USDT'));
  await assert.rejects(D.derivs('liqs', q('SOL/USDT:USDT')), (e: { status?: number }) => e.status === 503);

  const S = await import('./sec.ts');
  S.deps.gap = 0; S.deps.fetch = () => new Promise(() => {});
  const calls = Array.from({ length: 48 }, (_, i) => S.frame('us-gaap', 'Cap' + i, 'USD', 'CY2024').catch((e: { status?: number }) => e.status));
  const settled = await Promise.race([Promise.all(calls.slice(41)), new Promise(r => setTimeout(() => r('timeout'), 1000))]);
  assert.ok(Array.isArray(settled) && settled.every(s => s === 503), 'calls beyond the queue limit are refused at once');
});
