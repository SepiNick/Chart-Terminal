// A private server has one owner: no community routes, and the status says so.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';

const dir = mkdtempSync(join(tmpdir(), 'ct-socp-'));
Object.assign(process.env, { CT_DATA_DIR: dir, CT_NO_AUTOSTART: '1' });
delete process.env.CT_MODE;
const app = await import('./app.ts');
const server = app.createServer();
await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
after(() => { server.closeAllConnections(); server.close(); try { rmSync(dir, { recursive: true, force: true }) } catch {} });

test('private mode: features.social is false and /api/social/* does not exist', async () => {
  const s = await (await fetch(base + '/api/auth/status')).json() as any;
  assert.equal(s.mode, 'private'); assert.equal(s.features.social, false);
  const { routeTable } = await import('./core/http.ts');
  assert.deepEqual(routeTable().filter(r => r.path.startsWith('/api/social')), []);
  assert.equal((await fetch(base + '/api/social/feed')).status, 404);
});
