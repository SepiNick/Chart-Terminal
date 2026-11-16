// Discovery beacon: pure builders, then a real UDP send to a local socket.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BEACON_PORT, broadcastTargets, buildBeacon, discoveryEnabled, isPrivateV4, lanUrls, serverId, startBeacon } from './discovery.ts';

const ifc = (address: string, netmask = '255.255.255.0', internal = false) => ({ address, netmask, family: 'IPv4' as const, internal, mac: '', cidr: null });

test('beacon JSON has exactly the documented fields and no secrets', () => {
  const j = JSON.parse(buildBeacon({ id: 'ab'.repeat(8), name: 'Desk', urls: ['https://192.168.1.20:8443', 'http://192.168.1.20:8787'], v: '1.2.3', mode: 'private', twofa: true }).toString());
  assert.deepEqual(j, { ct: 1, id: 'ab'.repeat(8), name: 'Desk', urls: ['https://192.168.1.20:8443', 'http://192.168.1.20:8787'], v: '1.2.3', mode: 'private', twofa: true });
  assert.equal(BEACON_PORT, 41771);
});
test('broadcast targets: private non-loopback IPv4 only, directed broadcast address', () => {
  const t = broadcastTargets({ eth: [ifc('192.168.1.20'), ifc('127.0.0.1', '255.0.0.0', true), ifc('8.8.8.8'), ifc('10.1.2.3', '255.255.0.0')], v6: [{ ...ifc('fe80::1'), family: 'IPv6' as const }] } as never);
  assert.deepEqual(t, [{ ip: '192.168.1.20', bcast: '192.168.1.255' }, { ip: '10.1.2.3', bcast: '10.1.255.255' }]);
  assert.ok(isPrivateV4('172.16.0.1') && !isPrivateV4('172.32.0.1') && !isPrivateV4('100.64.0.1'));
});
test('lanUrls: https first; http only when the listener is not loopback-only', () => {
  assert.deepEqual(lanUrls({ ips: ['192.168.1.20'], httpsPort: 8443, host: '127.0.0.1', httpPort: 8787 }), ['https://192.168.1.20:8443']);
  assert.deepEqual(lanUrls({ ips: ['192.168.1.20'], httpsPort: 8443, host: '0.0.0.0', httpPort: 8787 }), ['https://192.168.1.20:8443', 'http://192.168.1.20:8787']);
  assert.deepEqual(lanUrls({ ips: ['192.168.1.20'], httpsPort: null, host: '127.0.0.1', httpPort: 8787 }), []);
});
test('server id is stable across restarts; CT_DISCOVERY=0 switches the beacon off', () => {
  const d = mkdtempSync(join(tmpdir(), 'ct-disc-'));
  try { const a = serverId(d); assert.match(a, /^[0-9a-f]{16}$/); assert.equal(serverId(d), a); assert.equal(readFileSync(join(d, 'server-id'), 'utf8'), a) } finally { rmSync(d, { recursive: true, force: true }) }
  assert.equal(discoveryEnabled({}, true), true); assert.equal(discoveryEnabled({ CT_DISCOVERY: '0' }), false); assert.equal(discoveryEnabled({}, false), false);
});
test('startBeacon sends the datagram to the broadcast target and nothing without a private interface', async t => {
  const own = broadcastTargets()[0];
  if (!own) return t.skip('no private IPv4 interface on this machine');
  const rx = dgram.createSocket('udp4'); await new Promise<void>(r => rx.bind(0, '0.0.0.0', r));
  const port = (rx.address() as { port: number }).port, got: Buffer[] = [];
  rx.on('message', m => got.push(m));
  const info = { id: 'cd'.repeat(8), name: 'T', urls: ['http://127.0.0.1:1'], v: '0', mode: 'private' as const, twofa: false };
  const none = startBeacon(() => info, { every: 20, port, ifaces: () => ({ lo: [ifc('127.0.0.1', '255.0.0.0', true)] }) });
  await new Promise(r => setTimeout(r, 120)); none.stop();
  assert.equal(got.length, 0, 'loopback only: never');
  // the send is redirected to the local receiver: a real broadcast cannot be asserted on a CI box
  const b = startBeacon(() => info, { every: 20, port, ifaces: () => ({ x: [ifc(own.ip)] }), send: (s, d, p) => s.send(d, p, own.ip) });
  await new Promise(r => setTimeout(r, 300)); b.stop(); rx.close();
  assert.ok(got.length >= 1); assert.equal(JSON.parse(got[0].toString()).id, info.id);
});
