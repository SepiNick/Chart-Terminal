import { test } from 'node:test';
import assert from 'node:assert/strict';
import { banner, isPrivateAddr, lanAuthClosed, lanPort, lanRequested } from './startup.ts';

test('CT_LAN / --lan switch', () => {
  assert.equal(lanRequested({}, ['node', 'index.ts']), false);
  assert.equal(lanRequested({ CT_LAN: '1' }, []), true);
  assert.equal(lanRequested({ CT_LAN: ' TRUE ' }, []), true);
  assert.equal(lanRequested({ CT_LAN: '0' }, []), false);
  assert.equal(lanRequested({ CT_LAN: '' }, ['node', 'index.ts', '--lan']), true);
});

test('CT_LAN_PORT only accepts valid unprivileged ports', () => {
  assert.equal(lanPort(8443, {}), 8443);
  assert.equal(lanPort(8443, { CT_LAN_PORT: '9443' }), 9443);
  for (const bad of ['80', '70000', 'abc', '8443.5', '-1']) assert.equal(lanPort(8443, { CT_LAN_PORT: bad }), 8443);
});

test('only private source addresses are allowed', () => {
  for (const ok of ['192.168.1.5', '10.1.2.3', '172.16.0.1', '172.31.255.1', '127.0.0.1', '169.254.1.1', '::ffff:192.168.0.9', '::1', 'fd12:3456::1', 'fe80::1']) assert.equal(isPrivateAddr(ok), true, ok);
  for (const no of ['8.8.8.8', '172.32.0.1', '172.15.0.1', '192.169.1.1', '100.64.0.1', '2001:db8::1', '::ffff:1.2.3.4', '', undefined]) assert.equal(isPrivateAddr(no), false, String(no));
});

test('login and setup stay closed on the LAN until a password exists', () => {
  assert.equal(lanAuthClosed('/api/auth/login', false), true);
  assert.equal(lanAuthClosed('/api/auth/setup', false), true);
  assert.equal(lanAuthClosed('/api/auth/login', true), false);
  assert.equal(lanAuthClosed('/ca.crt', false), false);
});

test('banner prints URLs, CA link, QR and the password hint', () => {
  const b = banner({ urls: ['https://192.168.1.20:8443'], port: 8443, httpPort: 8787, hasPassword: false });
  assert.match(b, /App:\s+https:\/\/192\.168\.1\.20:8443\n/);
  assert.match(b, /https:\/\/192\.168\.1\.20:8443\/ca\.crt/);
  assert.match(b, /[▀▄█]/);
  assert.match(b, /127\.0\.0\.1:8787\/api\/auth\/setup/);
  assert.doesNotMatch(banner({ urls: [], port: 8443, httpPort: 8787, hasPassword: true }), /api\/auth\/setup|ca\.crt/);
});
