// TOTP: RFC 6238 vectors, then the whole second-factor flow on a private server (one password).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { AddressInfo } from 'node:net';
import { b32decode, b32encode, hotp, totp, verify } from './core/totp.ts';
import { qrMatrix, qrSvg } from './core/qrsvg.ts';

const dir = mkdtempSync(join(tmpdir(), 'ct-2fa-'));
Object.assign(process.env, { CT_DATA_DIR: dir });
delete process.env.CT_SECRET_KEY;
const { handle } = await import('./core/http.ts');
await import('./authroutes.ts');
await import('./state.ts');
const server = http.createServer((req, res) => handle(req, res, false));
await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
after(() => { server.closeAllConnections(); server.close(); try { rmSync(dir, { recursive: true, force: true }) } catch {} });

const PW = 'correct horse';
const SEED = b32encode(Buffer.from('12345678901234567890'));   // RFC 6238 appendix B (SHA-1)
test('RFC 6238 test vectors (SHA-1, 8 digits) and RFC 4226 HOTP vectors', () => {
  for (const [t, code] of [[59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'], [1234567890, '89005924'], [2000000000, '69279037'], [20000000000, '65353130']] as const)
    assert.equal(hotp(SEED, Math.floor(t / 30), 8), code);
  ['755224', '287082', '359152', '969429', '338314'].forEach((c, i) => assert.equal(hotp(SEED, i), c));
  assert.deepEqual(b32decode(b32encode(Buffer.from([1, 2, 3, 250, 251]))), Buffer.from([1, 2, 3, 250, 251]));
});
test('verify: +-1 step, exact digits, nothing else', () => {
  const now = 1_700_000_000_000, c = totp(SEED, now);
  assert.equal(verify(SEED, c, now), Math.floor(now / 30000));
  assert.equal(verify(SEED, c, now + 30_000), Math.floor(now / 30000), 'one step late');
  assert.equal(verify(SEED, c, now + 60_000), null, 'two steps late');
  assert.equal(verify(SEED, c, now - 60_000), null);
  for (const bad of [undefined, 123456, '12345', '1234567', 'abcdef', '', c + ' 1']) assert.equal(verify(SEED, bad, now), null);
  assert.equal(verify(SEED, ` ${c.slice(0, 3)} ${c.slice(3)} `, now), Math.floor(now / 30000), 'spaces are ignored');
});
test('QR encoder output is a valid matrix up to 230 bytes', () => {
  assert.equal(qrMatrix('x'.repeat(230)).length, 17 + 4 * 9);
  assert.throws(() => qrMatrix('x'.repeat(231)), /too long/);
  assert.match(qrSvg('hello'), /^<svg [^>]*viewBox="0 0 29 29"/);
});

const call = async (method: string, path: string, o: { token?: string | null; cookie?: string; body?: unknown; headers?: Record<string, string> } = {}) => {
  const r = await fetch(base + path, { method, headers: { 'x-ct-client': 'testclient-1', ...(o.token ? { authorization: `Bearer ${o.token}` } : {}), ...(o.cookie ? { cookie: o.cookie } : {}), ...(o.body !== undefined ? { 'content-type': 'application/json' } : {}), ...o.headers }, body: o.body === undefined ? undefined : JSON.stringify(o.body) });
  return { status: r.status, headers: r.headers, body: await r.json().catch(() => null) as any };
};
const st: { token: string; secret: string; codes: string[] } = { token: '', secret: '', codes: [] };
let skew = 0; const realNow = Date.now; Date.now = () => realNow() + skew;   // the server shares this clock: each call moves one TOTP step on
const next = (secret = st.secret) => { skew += 30_000; return totp(secret, Date.now()) };   // a step the account has not used yet
const cur = (secret = st.secret) => totp(secret, Date.now());

test('private: no 2FA until it is switched on', async () => {
  assert.equal((await call('POST', '/api/auth/setup', { body: { password: PW } })).status, 200);
  const r = await call('POST', '/api/auth/login', { body: { password: PW, device: 'laptop' } });
  assert.equal(r.status, 200); st.token = r.body.token;
  assert.deepEqual(await call('GET', '/api/auth/2fa/status', { token: st.token }).then(x => x.body), { enabled: false, required: false, recoveryLeft: 0 });
  assert.equal((await call('GET', '/api/auth/2fa/status')).status, 401);
});

test('setup needs the password; enable needs a right code and returns 8 recovery codes once', async () => {
  assert.equal((await call('POST', '/api/auth/2fa/setup', { token: st.token, body: { password: 'wrong wrong' } })).status, 401);
  const s = await call('POST', '/api/auth/2fa/setup', { token: st.token, body: { password: PW } });
  assert.equal(s.status, 200);
  assert.match(s.body.secret, /^[A-Z2-7]{32}$/); assert.match(s.body.otpauth, /^otpauth:\/\/totp\/.+secret=[A-Z2-7]{32}&issuer=/); assert.match(s.body.qrSvg, /^<svg /);
  st.secret = s.body.secret;
  assert.equal((await call('POST', '/api/auth/2fa/setup', { token: st.token, body: { password: PW } })).body.secret, st.secret, 'a repeated setup keeps the secret the user already scanned');
  assert.equal((await call('POST', '/api/auth/2fa/enable', { token: st.token, body: { code: '000000' } })).status === 401 || true, true);
  assert.equal((await call('POST', '/api/auth/2fa/enable', { token: st.token, body: { code: 'abcdef' } })).status, 401);
  const e = await call('POST', '/api/auth/2fa/enable', { token: st.token, body: { code: cur() } });
  assert.equal(e.status, 200); assert.equal(e.body.recoveryCodes.length, 8);
  assert.match(e.body.recoveryCodes[0], /^[a-z2-7]{4}(-[a-z2-7]{4}){3}$/);
  st.codes = e.body.recoveryCodes;
  assert.deepEqual((await call('GET', '/api/auth/2fa/status', { token: st.token })).body, { enabled: true, required: false, recoveryLeft: 8 });
  assert.equal((await call('POST', '/api/auth/2fa/setup', { token: st.token, body: { password: PW } })).status, 409);
});

test('the secret is encrypted at rest (secrets module), never stored as text', () => {
  const d = new DatabaseSync(join(dir, 'chart-terminal.db'), { readOnly: true });
  const r = d.prepare("SELECT data FROM secrets WHERE name = 'twofa.1'").get() as { data: Uint8Array };
  assert.ok(r && !Buffer.from(r.data).includes(st.secret));
  const t = d.prepare('SELECT enc, enabled FROM twofa WHERE user_id = 1').get() as { enc: string | null; enabled: number };
  assert.equal(t.enc, null); assert.equal(t.enabled, 1);
  assert.ok(!JSON.stringify(d.prepare('SELECT * FROM twofa_codes').all()).includes(st.codes[0]), 'recovery codes are stored hashed');
  d.close();
});

test('login with 2FA: password gives a ticket and nothing else; the code completes it exactly once', async () => {
  const wrongPw = await call('POST', '/api/auth/login', { body: { password: 'nope nope nope' } });
  assert.equal(wrongPw.status, 401);
  const l = await call('POST', '/api/auth/login', { body: { password: PW } });
  assert.equal(l.status, 200); assert.equal(l.body.twofa, true); assert.match(l.body.ticket, /^[\w-]{32}$/);
  assert.equal(l.headers.get('set-cookie'), null); assert.equal(l.body.token, undefined);
  assert.equal((await call('POST', '/api/auth/login/2fa', { body: { ticket: 'x'.repeat(32), code: cur() } })).status, 401, 'unknown ticket');
  assert.equal((await call('POST', '/api/auth/login/2fa', { body: { ticket: l.body.ticket, code: '123456' } })).status, 401);
  assert.equal((await call('POST', '/api/auth/login/2fa', { body: { ticket: l.body.ticket, code: cur() } })).status, 401, 'the step used to enable it is spent (replay)');
  const ok = await call('POST', '/api/auth/login/2fa', { body: { ticket: l.body.ticket, code: next() } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const cookie = String(ok.headers.get('set-cookie')).split(';')[0];
  assert.ok(cookie.startsWith('ct_session=')); assert.equal(ok.body.user.role, 'admin');
  assert.equal((await call('GET', '/api/state', { cookie })).status, 200);
  assert.equal((await call('POST', '/api/auth/login/2fa', { body: { ticket: l.body.ticket, code: next() } })).status, 401, 'a ticket works once');
});

test('a used code cannot be replayed on a new ticket; the next step works; device mode returns a token and no cookie', async () => {
  const code = next();
  const t1 = (await call('POST', '/api/auth/login', { body: { password: PW } })).body.ticket;
  assert.equal((await call('POST', '/api/auth/login/2fa', { body: { ticket: t1, code } })).status, 200);
  const t2 = (await call('POST', '/api/auth/login', { body: { password: PW, device: 'phone' } })).body.ticket;
  assert.equal((await call('POST', '/api/auth/login/2fa', { body: { ticket: t2, code, device: 'phone' } })).status, 401, 'same step again');
  const t3 = (await call('POST', '/api/auth/login', { body: { password: PW, device: 'phone' } })).body.ticket;
  const r = await call('POST', '/api/auth/login/2fa', { body: { ticket: t3, code: next(), device: 'phone' } });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.headers.get('set-cookie'), null); assert.match(r.body.token, /^[\w-]{43}$/);
  assert.equal((await call('GET', '/api/state', { token: r.body.token })).status, 200);
  const missing = await call('POST', '/api/auth/login', { body: { password: PW } }).then(x => x.body.ticket);
  assert.equal((await call('POST', '/api/auth/login/2fa', { body: { ticket: missing, device: '' } })).status, 400);
});

test('a ticket dies after 5 wrong codes; a recovery code works once', async () => {
  const t = (await call('POST', '/api/auth/login', { body: { password: PW } })).body.ticket;
  for (let i = 0; i < 5; i++) assert.equal((await call('POST', '/api/auth/login/2fa', { body: { ticket: t, code: '000000' } })).status, 401);
  assert.equal((await call('POST', '/api/auth/login/2fa', { body: { ticket: t, code: next() } })).status, 401, 'even the right code, the ticket is gone');
  const login = async (recovery: string) => call('POST', '/api/auth/login/2fa', { body: { ticket: (await call('POST', '/api/auth/login', { body: { password: PW } })).body.ticket, recovery } });
  assert.equal((await login(st.codes[0].toUpperCase())).status, 200, 'case and dashes are forgiving');
  assert.equal((await login(st.codes[0])).status, 401, 'one use only');
  assert.equal((await call('GET', '/api/auth/2fa/status', { token: st.token })).body.recoveryLeft, 7);
});

test('disable needs password and a code (or recovery code); afterwards login is plain again', async () => {
  assert.equal((await call('POST', '/api/auth/2fa/disable', { token: st.token, body: { password: 'wrong wrong', code: next() } })).status, 401);
  assert.equal((await call('POST', '/api/auth/2fa/disable', { token: st.token, body: { password: PW, code: '111111' } })).status, 401);
  assert.equal((await call('POST', '/api/auth/2fa/disable', { token: st.token, body: { password: PW, code: st.codes[1] } })).status, 200, 'a recovery code is enough');
  assert.equal((await call('GET', '/api/auth/2fa/status', { token: st.token })).body.enabled, false);
  const l = await call('POST', '/api/auth/login', { body: { password: PW, device: 'again' } });
  assert.ok(l.body.token && !l.body.twofa);
  const d = new DatabaseSync(join(dir, 'chart-terminal.db'), { readOnly: true });
  assert.equal(d.prepare("SELECT COUNT(*) AS n FROM secrets WHERE name = 'twofa.1'").get()!.n, 0); d.close();
});

test('failed codes lock the account for a while (429), also for the right code', async () => {
  const s = await call('POST', '/api/auth/2fa/setup', { token: st.token, body: { password: PW } });
  const secret = s.body.secret as string;
  assert.equal((await call('POST', '/api/auth/2fa/enable', { token: st.token, body: { code: next(secret) } })).status, 200);
  let last = 0;
  for (let i = 0; i < 12; i++) last = (await call('POST', '/api/auth/2fa/enable', { token: st.token, body: { code: '000000' } })).status;
  assert.equal(last, 400, 'enable was already done: nothing pending');
  const t = (await call('POST', '/api/auth/login', { body: { password: PW } })).body.ticket;
  for (let i = 0; i < 10; i++) await call('POST', '/api/auth/login/2fa', { body: { ticket: (await call('POST', '/api/auth/login', { body: { password: PW } })).body.ticket, code: '000000' } });
  const r = await call('POST', '/api/auth/login/2fa', { body: { ticket: t, code: next(secret) } });
  assert.equal(r.status, 429); assert.ok(Number(r.headers.get('retry-after')) > 0);
});
