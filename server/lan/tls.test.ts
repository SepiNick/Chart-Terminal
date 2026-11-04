import { test } from 'node:test';
import assert from 'node:assert/strict';
import { X509Certificate } from 'node:crypto';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lanNames, opensslCandidates, findOpenssl, lanIps, sanList, needsNewCert, certIps, ensureCerts, mobileconfig, CA_NAME } from './tls.ts';

const iface = (address: string, internal = false, family = 'IPv4') => ({ address, internal, family, netmask: '', mac: '', cidr: null }) as never;

test('LAN IPs and SAN list from interfaces', () => {
  const ips = lanIps({ lo: [iface('127.0.0.1', true)], wifi: [iface('192.168.1.20'), iface('fe80::1', false, 'IPv6')], eth: [iface('10.0.0.5'), iface('192.168.1.20')], apipa: [iface('169.254.3.4')], vpn: undefined });
  assert.deepEqual(ips, ['10.0.0.5', '192.168.1.20']);
  assert.deepEqual(sanList(ips), ['DNS:localhost', 'IP:127.0.0.1', 'IP:10.0.0.5', 'IP:192.168.1.20']);
  assert.deepEqual(sanList([]), ['DNS:localhost', 'IP:127.0.0.1']);
});

test('openssl discovery order', () => {
  const env = { CT_OPENSSL: 'X:\\custom\\openssl.exe', PATH: 'C:\\a;C:\\b' };
  const c = opensslCandidates(env, 'win32');
  assert.equal(c[0], 'X:\\custom\\openssl.exe');
  assert.equal(c.length, 5);
  assert.match(c[1], /a[\\/]openssl\.exe$/);
  assert.equal(c[3], 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe');
  assert.equal(c[4], 'C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe');
  assert.equal(opensslCandidates({ PATH: '/usr/bin:/bin' }, 'linux').length, 2);
  assert.equal(findOpenssl(env, 'win32', p => p.includes('mingw64')), 'C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe');
  assert.equal(findOpenssl(env, 'win32', p => p.startsWith('X:') || p.includes('mingw64')), 'X:\\custom\\openssl.exe');
  assert.match(findOpenssl({ PATH: 'C:\\a;C:\\b' }, 'win32', p => /b[\\/]openssl/.test(p) || p.includes('Git'))!, /b[\\/]openssl\.exe$/);
  assert.equal(findOpenssl({}, 'linux', () => false), null);
});

test('mobileconfig is a well-formed plist embedding the CA', () => {
  const der = Buffer.from('fake certificate bytes '.repeat(10));
  const p = mobileconfig(der);
  assert.match(p, /^<\?xml version="1.0" encoding="UTF-8"\?>\n<!DOCTYPE plist/);
  assert.match(p, /<string>com\.apple\.security\.root<\/string>/);
  const data = p.match(/<data>([\s\S]*?)<\/data>/)![1].replace(/\s/g, '');
  assert.deepEqual(Buffer.from(data, 'base64'), der);
  const uuids = [...p.matchAll(/<key>PayloadUUID<\/key><string>([^<]+)<\/string>/g)].map(m => m[1]);
  assert.equal(uuids.length, 2); assert.notEqual(uuids[0], uuids[1]);
  for (const u of uuids) assert.match(u, /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/);
  // Tags balance (a cheap well-formedness check; no plist parser in the stdlib).
  const stack: string[] = [];
  for (const [, close, name, self] of p.matchAll(/<(\/?)(\w+)[^>]*?(\/?)>/g)) {
    if (self) continue;
    if (close) assert.equal(stack.pop(), name); else stack.push(name);
  }
  assert.deepEqual(stack, []);
});

const openssl = findOpenssl();
test('certificates: CA + server cert, regenerated when the IP set changes, CA kept', { skip: !openssl && 'openssl not found' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'ct-tls-'));
  try {
    const a = ensureCerts(dir, ['192.168.1.20'], openssl, []);
    const ca = new X509Certificate(a.caPem), cert = new X509Certificate(a.cert);
    assert.ok(ca.ca); assert.match(ca.subject, new RegExp(CA_NAME));
    assert.ok(cert.checkIssued(ca) && cert.verify(ca.publicKey));
    assert.match(cert.subjectAltName!, /DNS:localhost/);
    assert.deepEqual(certIps(cert), ['192.168.1.20']);
    assert.ok((Date.parse(cert.validTo) - Date.parse(cert.validFrom)) / 86400_000 <= 825);
    assert.equal(a.caFingerprint, ca.fingerprint256);
    if (process.platform !== 'win32') assert.equal(statSync(join(dir, 'server.key')).mode & 0o777, 0o600);

    assert.equal(needsNewCert(cert, ['192.168.1.20'], ca), false);
    assert.equal(needsNewCert(cert, ['192.168.1.21'], ca), true);
    assert.equal(needsNewCert(cert, ['192.168.1.20', '10.0.0.5'], ca), true);
    assert.equal(needsNewCert(null, [], ca), true);
    assert.equal(needsNewCert(cert, ['192.168.1.20'], ca, Date.parse(cert.validTo) - 86400_000), true);

    const same = ensureCerts(dir, ['192.168.1.20'], openssl, []);
    assert.equal(same.cert, a.cert);
    const b = ensureCerts(dir, ['10.0.0.5', '192.168.1.20'], openssl, []);
    assert.notEqual(b.cert, a.cert);
    assert.equal(b.caFingerprint, a.caFingerprint);
    assert.deepEqual(certIps(new X509Certificate(b.cert)), ['10.0.0.5', '192.168.1.20']);
  } finally { rmSync(dir, { recursive: true, force: true }) }
});

test('mDNS name in the certificate: only plain host labels, and a missing name forces a new certificate', () => {
  assert.deepEqual(lanNames('Laptop'), ['laptop.local']);
  assert.deepEqual(lanNames('my-pc.lan'), ['my-pc.local']);
  assert.deepEqual(lanNames('bad_name!'), []);
  assert.deepEqual(sanList(['10.0.0.5'], ['laptop.local']), ['DNS:localhost', 'DNS:laptop.local', 'IP:127.0.0.1', 'IP:10.0.0.5']);
  const openssl = findOpenssl();
  if (!openssl) return;
  const dir = mkdtempSync(join(tmpdir(), 'ct-tls-'));
  try {
    const a = ensureCerts(dir, ['10.0.0.5'], openssl, ['laptop.local']);
    const ca = new X509Certificate(a.caPem), cert = new X509Certificate(a.cert);
    assert.match(cert.subjectAltName!, /DNS:laptop\.local/);
    assert.equal(needsNewCert(cert, ['10.0.0.5'], ca, Date.now(), ['laptop.local']), false);
    assert.equal(needsNewCert(cert, ['10.0.0.5'], ca, Date.now(), []), true);
  } finally { rmSync(dir, { recursive: true, force: true }) }
});
