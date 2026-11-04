// CORS is off by default; with CT_CORS_ORIGINS only the exact listed origins get headers, never credentials.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { boot } from './publictest.ts';

const run = (env: Record<string, string>) => {
  const clean = { ...process.env } as Record<string, string | undefined>;
  for (const k of Object.keys(clean)) if (k.startsWith('CT_')) delete clean[k];
  return spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', "await import('./core/mode.ts')"], { cwd: import.meta.dirname, env: { ...clean, CT_DATA_DIR: mkdtempSync(join(tmpdir(), 'ct-cors-')), ...env }, encoding: 'utf8' });
};
test('"*", "null" and non-origins in CT_CORS_ORIGINS refuse to start', () => {
  for (const v of ['*', 'https://a.example,*', 'null', 'https://*.example.com', 'https://a.example/', 'https://a.example/path', 'a.example', 'file://']) {
    const r = run({ CT_CORS_ORIGINS: v }); assert.notEqual(r.status, 0, v); assert.match(r.stderr, /CT_CORS_ORIGINS/, v);
  }
  assert.equal(run({ CT_CORS_ORIGINS: 'https://a.example, http://localhost:5173' }).status, 0);
  assert.equal(run({}).status, 0);
});

const FOREIGN = 'https://app.example.com';
const b = await boot({ CT_CORS_ORIGINS: `${FOREIGN},http://localhost:5173`, CT_SERVER_NAME: 'Home ' + 'x'.repeat(100) });
after(() => b.close());
const pre = (origin: string | null, path = '/api/state') =>
  fetch(b.base + path, { method: 'OPTIONS', headers: { ...(origin ? { origin } : {}), 'access-control-request-method': 'PUT', 'access-control-request-headers': 'authorization, content-type, x-ct-client' } });

test('preflight from a listed origin: exact echo, fixed header list, never credentials', async () => {
  for (const o of [FOREIGN, 'http://localhost:5173']) {
    const r = await pre(o);
    assert.equal(r.status, 204);
    assert.equal(r.headers.get('access-control-allow-origin'), o);
    assert.equal(r.headers.get('access-control-allow-headers'), 'authorization, content-type, x-ct-client');
    assert.match(r.headers.get('access-control-allow-methods')!, /PUT/);
    assert.ok(Number(r.headers.get('access-control-max-age')) > 0);
    assert.equal(r.headers.get('vary'), 'Origin');
    assert.equal(r.headers.get('access-control-allow-credentials'), null);
  }
});
test('preflight from anything else gets no CORS headers (prefix, suffix, scheme, port, case, null, no Origin)', async () => {
  for (const o of ['https://evil.example', FOREIGN + '.evil.example', 'https://evil.' + FOREIGN.slice(8), 'http://app.example.com', 'https://app.example.com:8443', 'null', 'http://localhost:5174', FOREIGN.toUpperCase(), null]) {
    const r = await pre(o);
    for (const h of ['access-control-allow-origin', 'access-control-allow-headers', 'access-control-allow-methods', 'access-control-allow-credentials']) assert.equal(r.headers.get(h), null, `${o} ${h}`);
    assert.equal(r.headers.get('vary'), 'Origin');
    assert.notEqual(r.status, 204, String(o));
  }
});
test('real responses carry the headers only for listed origins, errors included', async () => {
  assert.equal((await fetch(b.base + '/api/auth/status', { headers: { origin: FOREIGN } })).headers.get('access-control-allow-origin'), FOREIGN);
  assert.equal((await fetch(b.base + '/api/auth/status', { headers: { origin: 'https://evil.example' } })).headers.get('access-control-allow-origin'), null);
  const err = await fetch(b.base + '/api/state', { headers: { origin: FOREIGN } });
  assert.equal(err.status, 401); assert.equal(err.headers.get('access-control-allow-origin'), FOREIGN);
});
test('serverName comes from CT_SERVER_NAME, cut to 60 characters', async () => {
  const s = await (await fetch(b.base + '/api/auth/status')).json() as { serverName: string };
  assert.equal(s.serverName.length, 60); assert.ok(s.serverName.startsWith('Home x'));
});
