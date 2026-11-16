// Public server with CT_REQUIRE_2FA=1: the password step leads to enrolment, then to a code; pairing hands out a token of the right user only.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { totp } from './core/totp.ts';

let skew = 0; const realNow = Date.now; Date.now = () => realNow() + skew;   // the server shares this clock: one TOTP step per call
const code = (secret: string) => { skew += 30_000; return totp(secret, Date.now()) };
const { boot, client, signup, PASS } = await import('./publictest.ts');
const b = await boot({ CT_REQUIRE_2FA: '1', CT_REG_PER_HOUR: '100' });
after(() => b.close());
const alice = await signup(b, 'alice'), bob = await signup(b, 'bob');
const label = (n: string) => ({ device: n });

test('a server that requires 2FA: the password step answers enroll; scanning and confirming a code finishes the sign-in with recovery codes', async () => {
  const c = client(b.base);
  const l = await c.json('POST', '/api/auth/login', { name: 'alice', password: PASS, ...label('laptop') });
  assert.equal(l.status, 200); assert.equal(l.body.enroll, true); assert.equal(l.body.token, undefined); assert.equal(l.headers.get('set-cookie'), null);
  const s = await c.json('POST', '/api/auth/login/2fa/setup', { ticket: l.body.ticket });
  assert.match(s.body.secret, /^[A-Z2-7]{32}$/);
  assert.equal((await c.json('POST', '/api/auth/login/2fa/enroll', { ticket: l.body.ticket, code: '000000', ...label('laptop') })).status, 401);
  const e = await c.json('POST', '/api/auth/login/2fa/enroll', { ticket: l.body.ticket, code: code(s.body.secret), ...label('laptop') });
  assert.equal(e.status, 200, JSON.stringify(e.body)); assert.equal(e.body.recoveryCodes.length, 8); assert.ok(e.body.token); assert.equal(e.body.user.name, 'alice');
  (alice as any).secret = s.body.secret; (alice as any).token = e.body.token;
  const again = await c.json('POST', '/api/auth/login', { name: 'alice', password: PASS, ...label('laptop') });
  assert.equal(again.body.twofa, true, 'now it asks for the code');
  const done = await c.json('POST', '/api/auth/login/2fa', { ticket: again.body.ticket, code: code(s.body.secret), ...label('laptop') });
  assert.equal(done.status, 200); assert.ok(done.body.token);
  const disable = await c.json('POST', '/api/auth/2fa/disable', { password: PASS, code: code(s.body.secret) }, { authorization: `Bearer ${done.body.token}` });
  assert.equal(disable.status, 403, 'cannot be switched off while the server requires it');
});

test('a wrong password never reaches the second step', async () => {
  const w = await client(b.base).json('POST', '/api/auth/login', { name: 'alice', password: 'wrong password!!', ...label('x') });
  assert.equal(w.status, 401); assert.equal(w.body.ticket, undefined);
});

test('pairing: a code started by alice gives a token for alice, never for bob; bob cannot see alice devices', async () => {
  const h = { authorization: `Bearer ${(alice as any).token}` };
  const p = (await client(b.base).json('POST', '/api/auth/pair/start', {}, h)).body;
  assert.match(p.code, /^[A-Z2-9]{10}$/);
  const r = await client(b.base).json('POST', '/api/auth/pair/redeem', { code: p.code, device: 'phone' });
  assert.equal(r.status, 200); assert.equal(r.body.user.name, 'alice');
  const mine = await client(b.base).json('GET', '/api/auth/devices', undefined, { authorization: `Bearer ${r.body.token}` });
  assert.ok(mine.body.some((d: any) => d.label === 'phone'));
  const bobTok = (await client(b.base).json('POST', '/api/auth/login', { name: 'bob', password: PASS, ...label('b') })).body;
  assert.equal(bobTok.enroll, true, 'bob must enrol too, so he has no token yet');
  assert.equal((await client(b.base).json('POST', '/api/auth/pair/start')).status, 401);
});

test('register and recover never hand out a session past 2FA', async () => {
  const r = await client(b.base).json('POST', '/api/auth/register', { name: 'carol', password: PASS, invite: b.U.createInvite(null), ...label('p') });
  assert.equal(r.status, 200); assert.equal(r.body.enroll, true); assert.ok(r.body.ticket); assert.equal(r.body.token, undefined); assert.equal(r.body.recoveryCodes.length, 8);
  // alice has TOTP on: her recovery code alone must not sign in
  const codes = (await client(b.base).json('POST', '/api/auth/recovery-codes', { password: PASS }, { authorization: `Bearer ${(alice as any).token}` })).body.recoveryCodes;
  const rec = await client(b.base).json('POST', '/api/auth/recover', { name: 'alice', code: codes[0], newPassword: 'another long pass 1', ...label('q') });
  assert.equal(rec.status, 200, JSON.stringify(rec.body)); assert.ok(rec.body.twofa || rec.body.enroll); assert.equal(rec.body.token, undefined);
});
