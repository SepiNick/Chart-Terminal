'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseBeacon, expire, lanUrl } = require('./discovery.cjs');

const b = o => Buffer.from(JSON.stringify(o));
const ok = { ct: 1, id: 'abc123', name: 'Home PC', urls: ['https://192.168.1.5:8443', 'http://10.0.0.2:8787'], v: '1.2.3', mode: 'private', twofa: false };

test('parses a valid beacon', () => {
  const r = parseBeacon(b(ok), '192.168.1.5');
  assert.deepStrictEqual(r.urls, ['https://192.168.1.5:8443']);   // only the sender's own address
  assert.strictEqual(parseBeacon(b(ok), '192.168.1.99'), null, 'a rogue announcing another host is dropped');
  assert.strictEqual(r.mode, 'private');
});
test('rejects bad beacons', () => {
  assert.strictEqual(parseBeacon(Buffer.from('nope')), null);
  assert.strictEqual(parseBeacon(b({ ...ok, ct: 2 })), null);
  assert.strictEqual(parseBeacon(b({ ...ok, id: 'x y' })), null);
  assert.strictEqual(parseBeacon(b({ ...ok, name: 'x'.repeat(81) })), null);
  assert.strictEqual(parseBeacon(b({ ...ok, urls: ['http://8.8.8.8:80', 'http://127.0.0.1:8787', 'ftp://192.168.1.1', 'http://evil.com'] })), null);
  assert.strictEqual(parseBeacon(Buffer.alloc(2049, 32)), null);
});
test('lanUrl ranges', () => {
  assert.ok(lanUrl('http://172.16.0.1:1'));
  assert.ok(lanUrl('http://172.31.255.1:1'));
  assert.strictEqual(lanUrl('http://172.32.0.1:1'), null);
  assert.strictEqual(lanUrl('http://192.168.1.999'), null);
  assert.strictEqual(lanUrl('http://u:p@192.168.1.1'), null);
});
test('expire drops stale entries', () => {
  const m = new Map([['a', { info: { id: 'a' }, seen: 1000 }], ['b', { info: { id: 'b' }, seen: 20000 }]]);
  const r = expire(m, 25000);
  assert.deepStrictEqual(r.map(x => x.id), ['b']);
  assert.strictEqual(m.size, 1);
});
