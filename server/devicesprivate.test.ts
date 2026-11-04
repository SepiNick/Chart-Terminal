// Device tokens on a private server (one password): same contract as the public one.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';

const dir = mkdtempSync(join(tmpdir(), 'ct-devp-'));
Object.assign(process.env, { CT_DATA_DIR: dir, CT_CORS_ORIGINS: 'https://app.example.com' });
const { handle } = await import('./core/http.ts');
await import('./authroutes.ts');
await import('./state.ts');
const server = http.createServer((req, res) => handle(req, res, false));
await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
after(() => { server.closeAllConnections(); server.close(); try { rmSync(dir, { recursive: true, force: true }) } catch {} });
const FOREIGN = 'https://app.example.com';
const call = async (method: string, path: string, token: string | null, body?: unknown, h: Record<string, string> = {}) => {
  const r = await fetch(base + path, { method, headers: { origin: FOREIGN, 'x-ct-client': 'remote-client-1', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...h }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, headers: r.headers, body: await r.json().catch(() => null) as any };
};

test('private: setup from this PC, then a remote client logs in with a device label', async () => {
  const s = await fetch(base + '/api/auth/setup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'correct horse' }) });
  assert.equal(s.status, 200);
  assert.equal((await call('POST', '/api/auth/login', null, { password: 'correct horse' })).status, 403, 'cross-origin login without device');
  assert.equal((await call('POST', '/api/auth/login', null, { password: 'wrong wrong', device: 'x' })).status, 401);
  const r = await call('POST', '/api/auth/login', null, { password: 'correct horse', device: 'laptop' });
  assert.equal(r.status, 200); assert.equal(r.headers.get('set-cookie'), null); assert.ok(r.body.token); assert.equal(r.body.user.role, 'admin');
  const t = r.body.token as string;
  assert.equal((await call('GET', '/api/state', null)).status, 401);
  assert.equal((await call('GET', '/api/state', t, undefined, { 'x-ct-client': '' })).status, 403);
  assert.equal((await call('PUT', '/api/state/k', t, { value: 1 })).status, 200);
  const st = (await call('GET', '/api/auth/status', t)).body;
  assert.equal(st.loggedIn, true); assert.equal(st.mode, 'private'); assert.equal(st.features.trading, true);
  const list = (await call('GET', '/api/auth/devices', t)).body;
  assert.equal(list[0].label, 'laptop'); assert.equal(list[0].current, true);
  assert.ok(!JSON.stringify((await call('GET', '/api/auth/sessions', t)).body).includes(list[0].id), 'devices are not listed as sessions');
  for (let i = 0; i < 9; i++) assert.equal((await call('POST', '/api/auth/login', null, { password: 'correct horse', device: 'd' + i })).status, 200);
  assert.equal((await call('POST', '/api/auth/login', null, { password: 'correct horse', device: 'extra' })).status, 409);
  assert.equal((await call('DELETE', `/api/auth/devices/${list[0].id}`, t)).status, 204);
  assert.equal((await call('GET', '/api/state', t)).status, 401, 'revoked');
  assert.equal((await call('DELETE', `/api/auth/devices/${list[0].id}`, t)).status, 401);
});

test('private: a password change ends every device token', async () => {
  const t = (await call('POST', '/api/auth/login', null, { password: 'correct horse', device: 'again' })).body.token as string;
  assert.equal((await call('POST', '/api/auth/password', t, { current: 'correct horse', password: 'another horse!' })).status, 200);
  assert.equal((await call('GET', '/api/state', t)).status, 401);
});
