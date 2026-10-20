import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import WebSocket from 'ws';

const dir = mkdtempSync(join(tmpdir(), 'ct-state-'));
process.env.CT_DATA_DIR = dir;
const { handle, upgrade } = await import('./core/http.ts');
await import('./authroutes.ts');
const { stateGet } = await import('./state.ts');

let server: http.Server, base = '', cookie = '';
const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
  const raw = body instanceof Uint8Array;
  const r = await fetch(base + path, { method, headers: { cookie, ...(body !== undefined && !raw ? { 'content-type': 'application/json' } : {}), ...headers }, body: body === undefined ? undefined : raw ? body : JSON.stringify(body) });
  return r;
};
before(async () => {
  server = http.createServer((req, res) => handle(req, res, false));
  server.on('upgrade', upgrade);
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const r = await fetch(base + '/api/auth/setup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'correct horse' }) });
  assert.equal(r.status, 200);
  cookie = r.headers.get('set-cookie')!.split(';')[0];
});
after(() => { server.closeAllConnections(); server.close(); try { rmSync(dir, { recursive: true, force: true }) } catch {} });

test('state routes need a login', async () => {
  assert.equal((await fetch(base + '/api/state')).status, 401);
});

test('PUT / GET / DELETE with revisions, last write wins', async () => {
  assert.deepEqual(await (await call('GET', '/api/state')).json(), {});
  assert.deepEqual(await (await call('PUT', '/api/state/watch', { value: ['BTCUSDT'] })).json(), { rev: 1 });
  assert.deepEqual(await (await call('PUT', '/api/state/watch', { value: ['ETHUSDT'] })).json(), { rev: 2 });
  const all = await (await call('GET', '/api/state')).json() as Record<string, { value: unknown; rev: number; updated: number }>;
  assert.deepEqual(all.watch.value, ['ETHUSDT']);
  assert.equal(all.watch.rev, 2);
  assert.equal(stateGet<string[]>('watch')!.value[0], 'ETHUSDT');
  assert.equal((await call('DELETE', '/api/state/watch')).status, 204);
  assert.equal(stateGet('watch'), null);
});

test('PUT validates key and body', async () => {
  assert.equal((await call('PUT', '/api/state/bad%20key', { value: 1 })).status, 400);
  assert.equal((await call('PUT', '/api/state/ok', { nope: 1 })).status, 400);
  assert.equal((await call('PUT', '/api/state/ok', { value: 1 }, { origin: 'http://evil.example' })).status, 403);
});

test('broadcast skips the tab that wrote (x-ct-client + sync.hello)', async () => {
  const url = base.replace('http', 'ws') + '/ws';
  const open = (id: string) => new Promise<{ ws: WebSocket; got: Record<string, unknown>[] }>((res, rej) => {
    const ws = new WebSocket(url, { headers: { cookie } }), got: Record<string, unknown>[] = [];
    ws.on('message', d => got.push(JSON.parse(String(d))));
    ws.on('open', () => { ws.send(JSON.stringify({ op: 'sync.hello', client: id })); res({ ws, got }) });
    ws.on('error', rej);
  });
  const a = await open('tab-aaaaaaaa'), b = await open('tab-bbbbbbbb');
  await new Promise(r => setTimeout(r, 50));   // let the hello messages land
  await call('PUT', '/api/state/layout', { value: { n: 1 } }, { 'x-ct-client': 'tab-aaaaaaaa' });
  await new Promise(r => setTimeout(r, 100));
  assert.equal(a.got.filter(m => m.type === 'state').length, 0);
  assert.deepEqual(b.got.filter(m => m.type === 'state').map(m => [m.key, m.rev, m.value]), [['layout', 1, { n: 1 }]]);
  a.ws.close(); b.ws.close();
});

test('media upload, serve, delete', async () => {
  const png = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
  const r = await call('POST', '/api/media', png, { 'content-type': 'image/png' });
  assert.equal(r.status, 200);
  const { id } = await r.json() as { id: string };
  const g = await call('GET', '/api/media/' + id);
  assert.equal(g.headers.get('content-type'), 'image/png');
  assert.match(g.headers.get('cache-control')!, /immutable/);
  assert.deepEqual(new Uint8Array(await g.arrayBuffer()), png);
  assert.equal((await call('POST', '/api/media', png, { 'content-type': 'image/svg+xml' })).status, 400);
  assert.equal((await call('POST', '/api/media', new Uint8Array([1]), { 'content-type': 'audio/webm;codecs=opus' })).status, 200);
  assert.equal((await call('DELETE', '/api/media/' + id)).status, 204);
  assert.equal((await call('GET', '/api/media/' + id)).status, 404);
  assert.equal((await fetch(base + '/api/media/' + id)).status, 401);
});

// Last: core/http.ts answers 413 without draining the body, which leaves that keep-alive connection unusable.
test('PUT over 8 MB is refused', async () => {
  assert.equal((await call('PUT', '/api/state/ok', { value: 'x'.repeat(9 * 1024 * 1024) })).status, 413);
});
