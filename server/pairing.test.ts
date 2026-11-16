// Pairing by QR (private server): payload shape, single use, expiry, the 5-pending cap, device revoke and the per-address failure limit.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';

const dir = mkdtempSync(join(tmpdir(), 'ct-pair-'));
Object.assign(process.env, { CT_DATA_DIR: dir });
delete process.env.CT_SECRET_KEY;
let skew = 0; const realNow = Date.now; Date.now = () => realNow() + skew;   // the server shares this clock
const { handle } = await import('./core/http.ts');
await import('./authroutes.ts');
await import('./pairing.ts');
await import('./state.ts');
const server = http.createServer((req, res) => handle(req, res, false));
await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
after(() => { server.closeAllConnections(); server.close(); try { rmSync(dir, { recursive: true, force: true }) } catch {} });

const PW = 'correct horse';
const call = async (method: string, path: string, o: { token?: string; body?: unknown } = {}) => {
  const r = await fetch(base + path, { method, headers: { 'x-ct-client': 'testclient-1', ...(o.token ? { authorization: `Bearer ${o.token}` } : {}), ...(o.body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: o.body === undefined ? undefined : JSON.stringify(o.body) });
  return { status: r.status, headers: r.headers, body: await r.json().catch(() => null) as any };
};
await call('POST', '/api/auth/setup', { body: { password: PW } });
const token = (await call('POST', '/api/auth/login', { body: { password: PW, device: 'desktop' } })).body.token as string;
const start = async () => (await call('POST', '/api/auth/pair/start', { token })).body;
const redeem = (code: string, device = 'phone') => call('POST', '/api/auth/pair/redeem', { body: { code, device } });

test('start needs a signed-in caller and returns code, expiry, urls, a QR and the chartterminal:// payload', async () => {
  assert.equal((await call('POST', '/api/auth/pair/start')).status, 401);
  const p = await start();
  assert.match(p.code, /^[A-HJ-NP-Z2-9]{10}$/);
  assert.ok(p.expires > Date.now() && p.expires <= Date.now() + 5 * 60_000);
  assert.ok(Array.isArray(p.urls) && p.urls.length >= 1 && p.url === p.urls[0]);
  assert.match(p.qrSvg, /^<svg /);
  const u = new URL(p.payload);
  assert.equal(u.protocol, 'chartterminal:'); assert.equal(u.hostname, 'pair');
  assert.equal(u.searchParams.get('c'), p.code); assert.deepEqual(u.searchParams.getAll('u'), p.urls.slice(0, u.searchParams.getAll('u').length));
});

test('redeem gives a device token once; the device is listed and revoking it signs the phone out', async () => {
  const p = await start();
  assert.equal((await call('POST', '/api/auth/pair/redeem', { body: { code: p.code } })).status, 400, 'a device label is required');
  const r = await redeem(p.code.toLowerCase().replace(/^(.{5})/, '$1-'), 'my phone');
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.ok, true); assert.match(r.body.token, /^[\w-]{43}$/); assert.equal(r.headers.get('set-cookie'), null);
  assert.equal((await call('GET', '/api/state', { token: r.body.token })).status, 200);
  assert.equal((await redeem(p.code)).status, 401, 'single use');
  const list = (await call('GET', '/api/auth/devices', { token })).body as { id: string; label: string }[];
  const mine = list.find(d => d.label === 'my phone'); assert.ok(mine);
  assert.equal((await call('DELETE', `/api/auth/devices/${mine!.id}`, { token })).status, 204);
  assert.equal((await call('GET', '/api/state', { token: r.body.token })).status, 401);
});

test('a code expires after 5 minutes; at most 5 are pending per user (the oldest is dropped)', async () => {
  const old = await start();
  skew += 5 * 60_000 + 1000;
  assert.equal((await redeem(old.code)).status, 401, 'expired');
  const codes: string[] = []; for (let i = 0; i < 6; i++) codes.push((await start()).code);
  assert.equal((await redeem(codes[0])).status, 401, 'the 6th start dropped the 1st');
  assert.equal((await redeem(codes[5])).status, 200);
  assert.equal((await redeem(codes[1])).status, 200);
});

test('wrong codes are limited per address: after a few failures even a valid code is refused (429)', async () => {
  const good = await start();
  let last = 0;
  for (let i = 0; i < 12 && last !== 429; i++) last = (await redeem('ZZZZZZZZZZ')).status;
  assert.equal(last, 429);
  const r = await redeem(good.code);
  assert.equal(r.status, 429); assert.ok(Number(r.headers.get('retry-after')) > 0);
});
