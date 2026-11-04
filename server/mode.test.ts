// Phase 0: mode switch and proxy trust.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const run = (env: Record<string, string>, code = "await import('./core/db.ts')") => {
  const clean = { ...process.env } as Record<string, string | undefined>;
  for (const k of Object.keys(clean)) if (k.startsWith('CT_')) delete clean[k];
  return spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', code], { cwd: import.meta.dirname, env: { ...clean, ...env }, encoding: 'utf8' });
};
const pub = (dir: string, extra: Record<string, string> = {}) => ({ CT_MODE: 'public', CT_DATA_DIR: dir, CT_PUBLIC_URL: 'https://charts.example.com', CT_ALLOWED_HOSTS: 'charts.example.com', CT_TRUST_PROXY: '1', ...extra });
const tmp = () => mkdtempSync(join(tmpdir(), 'ct-mode-'));

test('private is the default; an unknown CT_MODE is refused', () => {
  assert.equal(run({ CT_DATA_DIR: tmp() }).status, 0);
  const r = run({ CT_MODE: 'pubic', CT_DATA_DIR: tmp() });
  assert.notEqual(r.status, 0); assert.match(r.stderr, /CT_MODE must be/);
});

test('public refuses to start unless it is safe', () => {
  assert.equal(run(pub(tmp())).status, 0);
  const fails = (env: Record<string, string>, re: RegExp) => { const r = run(env); assert.notEqual(r.status, 0); assert.match(r.stderr, re) };
  fails(pub(tmp(), { CT_SECRET_KEY: 'AAAA' }), /CT_SECRET_KEY/);
  const d = tmp(); writeFileSync(join(d, 'secret.key'), 'x'); fails(pub(d), /secret\.key/);
  fails({ ...pub(tmp()), CT_PUBLIC_URL: '' }, /CT_PUBLIC_URL/);
  fails(pub(tmp(), { CT_PUBLIC_URL: 'http://charts.example.com' }), /https/);
  fails(pub(tmp(), { CT_ALLOWED_HOSTS: '' }), /CT_ALLOWED_HOSTS/);
  fails(pub(tmp(), { CT_TRUST_PROXY: '' }), /CT_TRUST_PROXY/);
  assert.equal(run(pub(tmp(), { CT_TRUST_PROXY: '', CT_NO_PROXY: '1' })).status, 0, 'explicit opt-out');
  const legacy = tmp(), old = new DatabaseSync(join(legacy, 'chart-terminal.db'));
  old.exec("CREATE TABLE broker_accounts (id TEXT); INSERT INTO broker_accounts VALUES ('a')"); old.close();
  fails(pub(legacy), /secrets or broker accounts/);
  assert.equal(run(pub(tmp(), { CT_PUBLIC_URL: 'http://localhost:8080', CT_ALLOWED_HOSTS: 'localhost' })).status, 0, 'plain http is fine for localhost');
});

test('forwarded headers are believed only from a trusted proxy, right-most untrusted hop', () => {
  const probe = (trust: string, peer: string, xff: string, proto = '') => {
    const code = `const m = await import('./core/mode.ts'); const req = { socket: { remoteAddress: ${JSON.stringify(peer)} }, headers: { 'x-forwarded-for': ${JSON.stringify(xff)}, 'x-forwarded-proto': ${JSON.stringify(proto)} } }; console.log(JSON.stringify([m.clientIp(req), m.isHttps(req, false)]))`;
    return JSON.parse(run({ CT_TRUST_PROXY: trust, CT_DATA_DIR: tmp() }, code).stdout);
  };
  assert.deepEqual(probe('0', '127.0.0.1', '9.9.9.9', 'https'), ['127.0.0.1', false], 'off: ignored');
  assert.deepEqual(probe('1', '203.0.113.5', '9.9.9.9', 'https'), ['203.0.113.5', false], 'peer is not the proxy: spoofed header ignored');
  assert.deepEqual(probe('1', '127.0.0.1', '9.9.9.9', 'https'), ['9.9.9.9', true]);
  assert.deepEqual(probe('1', '::ffff:127.0.0.1', '6.6.6.6, 5.5.5.5, 127.0.0.1', 'http, https'), ['5.5.5.5', true], 'client-supplied hops to the left are not believed');
  assert.deepEqual(probe('1', '127.0.0.1', '', ''), ['127.0.0.1', false]);
});
