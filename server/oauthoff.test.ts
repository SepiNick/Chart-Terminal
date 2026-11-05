// Providers that are not configured, config validation, the JWKS cache rules and the proxy start-up check.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { boot, client } = await import('./publictest.ts');
const b = await boot({ CT_GOOGLE_CLIENT_ID: 'gid', CT_GOOGLE_CLIENT_SECRET: 'gsecret', CT_AUTH_BURST: '1000', CT_ANON_BURST: '1000' });   // Google only
after(() => b.close());
const { oauthConfig } = await import('./core/mode.ts');
const { Jwks } = await import('./core/oidc.ts');

test('a provider that is off answers 404 everywhere and status says so; the other one is on', async () => {
  const c = client(b.base);
  assert.deepEqual((await c.json('GET', '/api/auth/status')).body.oauth, { google: true, apple: false });
  const ch = 'A'.repeat(43);
  assert.equal((await c.json('POST', '/api/auth/oauth/start', { provider: 'apple', intent: 'login', challenge: ch, ret: 'web' })).status, 404);
  assert.equal((await c.json('POST', '/api/auth/oauth/start', { provider: 'google', intent: 'login', challenge: ch, ret: 'web' })).status, 200);
  assert.equal((await fetch(b.base + '/api/auth/oauth/callback/apple', { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'code=x&state=y' })).status, 404);
  assert.equal((await fetch(b.base + '/api/auth/oauth/callback/google?code=x&state=y', { redirect: 'manual' })).status, 303, 'a configured provider with an unknown state redirects');
});

test('the test hook for pointing providers elsewhere is refused outside tests', async () => {
  const O = await import('./oauth.ts');
  const save = process.env.CT_NO_AUTOSTART; delete process.env.CT_NO_AUTOSTART;
  try { assert.throws(() => O._setProvidersForTest({}), /test only/) } finally { process.env.CT_NO_AUTOSTART = save }
});

test('config: all variables or none; a partly set provider names what is missing', () => {
  assert.deepEqual(oauthConfig({}), {});
  assert.throws(() => oauthConfig({ CT_GOOGLE_CLIENT_ID: 'x' }), /CT_GOOGLE_CLIENT_SECRET/);
  assert.throws(() => oauthConfig({ CT_APPLE_SERVICE_ID: 'x', CT_APPLE_TEAM_ID: 'y' }), /CT_APPLE_KEY_ID, CT_APPLE_PRIVATE_KEY_FILE/);
  assert.equal(oauthConfig({ CT_GOOGLE_CLIENT_ID: 'a', CT_GOOGLE_CLIENT_SECRET: 'b' }).google?.secret, 'b');
});

test('JWKS cache: cached by max-age, an unknown kid refetches at most once a minute, stale keys serve a dead provider, then fail closed', async () => {
  let t = 1_000_000, fetches = 0, down = false;
  const j = new Jwks('https://x', async () => { fetches++; if (down) throw Error('net'); return { keys: [{ kid: 'a', kty: 'RSA' }], maxAge: 600 } }, () => t);
  assert.ok(await j.get('a')); assert.equal(fetches, 1);
  assert.ok(await j.get('a')); assert.equal(fetches, 1, 'cached');
  assert.equal(await j.get('zzz'), null); assert.equal(fetches, 1, 'unknown kid right after a fetch does not refetch');
  t += 61_000; assert.equal(await j.get('zzz'), null); assert.equal(fetches, 2, 'one refetch after 60 s');
  assert.equal(await j.get('yyy'), null); assert.equal(fetches, 2, 'random kids cannot hammer the provider');
  t += 700_000; down = true;   // expired and the provider is unreachable: the stale key still works
  assert.ok(await j.get('a')); assert.equal(fetches, 3);
  t += 86_400_000 + 1000; assert.equal(await j.get('a'), null, 'older than 24 h: fail closed');
});

test('public start-up refuses a trusted proxy that cannot be recognised (CT_TRUST_PROXY=1, non-loopback CT_HOST, no CT_PROXY_IPS)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ct-proxy-'));
  const run = (env: Record<string, string>) => {
    try { execFileSync(process.execPath, ['--experimental-strip-types', '-e', "await import('./core/db.ts')"], { cwd: import.meta.dirname, env: { PATH: process.env.PATH ?? '', CT_MODE: 'public', CT_DATA_DIR: dir, CT_PUBLIC_URL: 'https://x.example', CT_ALLOWED_HOSTS: 'x.example', CT_TRUST_PROXY: '1', ...env }, stdio: 'pipe' }); return '' }
    catch (e) { return String((e as { stderr: Buffer }).stderr) }
  };
  try {
    assert.match(run({ CT_HOST: '0.0.0.0' }), /CT_PROXY_IPS/);
    assert.match(run({ CT_HOST: '0.0.0.0', CT_PROXY_IPS: '127.0.0.1,::1' }), /CT_PROXY_IPS/, 'loopback entries do not count');
    assert.equal(run({ CT_HOST: '0.0.0.0', CT_PROXY_IPS: '172.17.0.1' }), '');
    assert.equal(run({}), '', 'bound to loopback: fine');
  } finally { rmSync(dir, { recursive: true, force: true }) }
});
