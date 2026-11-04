// Without CT_CORS_ORIGINS nothing is sent cross-origin, and a cross-origin device login is refused.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, PASS, signup } from './publictest.ts';

const b = await boot({});
after(() => b.close());
test('CORS is off by default', async () => {
  const o = 'https://app.example.com';
  const p = await fetch(b.base + '/api/state', { method: 'OPTIONS', headers: { origin: o, 'access-control-request-method': 'GET' } });
  assert.equal(p.headers.get('access-control-allow-origin'), null); assert.notEqual(p.status, 204);
  assert.equal((await fetch(b.base + '/api/auth/status', { headers: { origin: o } })).headers.get('access-control-allow-origin'), null);
  await signup(b, 'alice-a');
  const r = await fetch(b.base + '/api/auth/login', { method: 'POST', headers: { origin: o, 'x-ct-client': 'remote-client-1', 'content-type': 'application/json' }, body: JSON.stringify({ name: 'alice-a', password: PASS, device: 'x' }) });
  assert.equal(r.status, 403, 'an origin that was never listed cannot get a token');
});
