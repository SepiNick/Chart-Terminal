// Bearer device tokens for clients served from another origin (docs/multi-server.md). Public mode; CORS enabled for one origin.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { boot, signup, PASS } from './publictest.ts';

const FOREIGN = 'https://app.example.com';
const b = await boot({ CT_QUOTA_RPS: '1000', CT_QUOTA_BURST: '1000', CT_CORS_ORIGINS: FOREIGN });
after(() => b.close());
const A = await signup(b, 'alice-a'), Bu = await signup(b, 'bob-b');

/** What a remote client sends: a foreign Origin, the x-ct-client header, no cookie. */
const tok = async (method: string, path: string, token: string | null, body?: unknown, extra: Record<string, string> = {}) => {
  const r = await fetch(b.base + path, { method, headers: { origin: FOREIGN, 'x-ct-client': 'remote-client-1', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, headers: r.headers, body: await r.json().catch(() => null) as any };
};
const settle = () => new Promise(r => setTimeout(r, 3000));   // refill the per-address bucket for anonymous calls
const login = async (name: string, label = 'phone', password = PASS) => {
  const r = await tok('POST', '/api/auth/login', null, { name, password, device: label });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r;
};

test('device login: token in the body, no cookie; the token is accepted on routes and never listed', async () => {
  const r = await login('alice-a', 'Pixel 8');
  assert.equal(r.headers.get('set-cookie'), null);
  assert.match(r.body.token, /^[\w-]{43}$/);   // 256 bits, base64url
  assert.deepEqual(r.body.user, { name: 'alice-a', role: 'user', mustChange: false });
  assert.equal(r.headers.get('access-control-allow-origin'), FOREIGN);
  assert.equal(r.headers.get('access-control-allow-credentials'), null);
  const t = r.body.token as string;
  assert.equal((await tok('PUT', '/api/state/layout', t, { value: { x: 1 } })).status, 200);
  assert.equal((await tok('GET', '/api/state', t)).body.layout.value.x, 1);
  const list = await tok('GET', '/api/auth/devices', t);
  assert.equal(list.body.length, 1);
  assert.equal(list.body[0].label, 'Pixel 8'); assert.equal(list.body[0].current, true);
  assert.ok(!JSON.stringify(list.body).includes(t), 'the token is never listed');
  assert.deepEqual(Object.keys(list.body[0]).sort(), ['created', 'current', 'id', 'ip', 'label', 'lastUsed']);
  assert.equal((await tok('GET', '/api/auth/status', t)).body.loggedIn, true);
  assert.equal((await A.c.json('GET', '/api/auth/sessions')).body.length, 1, 'device tokens are not browser sessions');
});

test('x-ct-client is required; no token in the URL; cookie sessions and device tokens are not interchangeable', async () => {
  const t = (await login('alice-a', 'second')).body.token as string;
  assert.equal((await tok('GET', '/api/state', t, undefined, { 'x-ct-client': '' })).status, 403);
  assert.equal((await tok('PUT', '/api/state/k', t, { value: 1 }, { 'x-ct-client': 'x' })).status, 403);
  assert.equal((await fetch(`${b.base}/api/state?token=${t}&access_token=${t}`, { headers: { origin: FOREIGN, 'x-ct-client': 'remote-client-1' } })).status, 401);
  const cookieTok = decodeURIComponent(A.c.cookie.split('=').slice(1).join('='));
  assert.equal((await tok('GET', '/api/state', cookieTok)).status, 401, 'cookie session as a Bearer token');
  const asCookie = await fetch(`${b.base}/api/state`, { headers: { cookie: `__Host-ct_session=${t}; ct_session=${t}`, 'x-ct-client': 'remote-client-1' } });
  assert.equal(asCookie.status, 401, 'device token as a cookie');
  assert.equal((await tok('GET', '/api/state', 'x'.repeat(43))).status, 401, 'unknown token');
  const bad = await fetch(`${b.base}/api/state`, { headers: { cookie: A.c.cookie, authorization: 'Bearer ' + 'y'.repeat(43), 'x-ct-client': 'remote-client-1' } });
  assert.equal(bad.status, 401, 'a bad Bearer is not rescued by a valid cookie');
});

test('cross-origin without a token is 401; login/register/recover cross-origin without device are refused and set no cookie', async () => {
  assert.equal((await tok('GET', '/api/state', null)).status, 401);
  assert.equal((await tok('POST', '/api/alerts', null, {})).status, 401);
  const r = await tok('POST', '/api/auth/login', null, { name: 'alice-a', password: PASS });
  assert.equal(r.status, 403); assert.equal(r.headers.get('set-cookie'), null);
  assert.equal((await tok('POST', '/api/auth/recover', null, { name: 'alice-a', code: 'x', newPassword: 'x'.repeat(12) })).status, 403);
  assert.equal((await tok('POST', '/api/auth/register', null, { name: 'zed-zed', password: PASS })).status, 403);
  // an origin that is not listed cannot use even the device door
  const evil = await tok('POST', '/api/auth/login', null, { name: 'alice-a', password: PASS, device: 'x' }, { origin: 'https://evil.example' });
  assert.equal(evil.status, 403); assert.equal(evil.headers.get('access-control-allow-origin'), null);
  // a cookie session is not enough for a cross-site state change
  const cs = await fetch(`${b.base}/api/state/k`, { method: 'PUT', headers: { cookie: A.c.cookie, origin: FOREIGN, 'x-ct-client': 'remote-client-1', 'content-type': 'application/json' }, body: '{"value":1}' });
  assert.equal(cs.status, 403);
  const wrong = await tok('POST', '/api/auth/login', null, { name: 'alice-a', password: 'nope-nope-nope', device: 'x' });
  assert.equal(wrong.status, 401); assert.equal(wrong.body.token, undefined);
  assert.equal((await tok('POST', '/api/auth/login', null, { name: 'alice-a', password: PASS, device: 5 })).status, 400);
});

test('register and recover can hand out device tokens; labels are cut to 60 characters', async () => {
  const inv = b.U.createInvite(null);
  const r = await tok('POST', '/api/auth/register', null, { name: 'carol-c', password: PASS, invite: inv, device: 'L'.repeat(100) });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.ok(r.body.token); assert.equal(r.headers.get('set-cookie'), null);
  assert.equal((await tok('GET', '/api/auth/devices', r.body.token)).body[0].label.length, 60);
  const rec = await tok('POST', '/api/auth/recover', null, { name: 'carol-c', code: r.body.recoveryCodes[0], newPassword: 'another long pass', device: 'tablet' });
  assert.equal(rec.status, 200, JSON.stringify(rec.body)); assert.ok(rec.body.token); assert.equal(rec.headers.get('set-cookie'), null);
  assert.equal((await tok('GET', '/api/state', r.body.token)).status, 401, 'recovery revoked the old token');
  assert.equal((await tok('GET', '/api/state', rec.body.token)).status, 200);
});

test('at most 10 device tokens per user; cookie sessions never evict them', async () => {
  await settle();
  const d = await signup(b, 'dave-d');
  for (let i = 0; i < 10; i++) await login('dave-d', 'd' + i);
  const r = await tok('POST', '/api/auth/login', null, { name: 'dave-d', password: PASS, device: 'eleventh' });
  assert.equal(r.status, 409); assert.equal(r.body.code, 'device_limit'); assert.equal(r.body.token, undefined);
  assert.equal((await d.c.json('GET', '/api/auth/devices')).body.length, 10);
  assert.equal((await login('alice-a', 'still fine')).status, 200, 'the quota is per user');
  const id = b.U.userByName('dave-d')!.id, fake = { headers: {}, socket: { remoteAddress: '203.0.113.9' } } as never;
  for (let i = 0; i < 25; i++) b.U.createSession(id, fake);
  assert.equal(b.U.countDevices(id), 10);
});

test('isolation: a token reaches only its own user; foreign device ids are 404; revocation is immediate', async () => {
  await settle();
  const ta = (await login('alice-a', 'A-phone')).body.token as string, tb = (await login('bob-b', 'B-phone')).body.token as string;
  await tok('PUT', '/api/state/secret', tb, { value: 'B-ONLY' });
  assert.ok(!JSON.stringify((await tok('GET', '/api/state', ta)).body).includes('B-ONLY'));
  const bId = (await tok('GET', '/api/auth/devices', tb)).body.find((d: any) => d.label === 'B-phone').id;
  assert.equal((await tok('DELETE', `/api/auth/devices/${bId}`, ta)).status, 404);
  assert.equal((await tok('DELETE', `/api/auth/devices/${bId}`, tb)).status, 204);
  assert.equal((await tok('GET', '/api/state', tb)).status, 401, 'revoked token');
  assert.equal((await tok('DELETE', `/api/auth/devices/${bId}`, ta)).status, 404, 'revoked id');
  assert.equal((await tok('DELETE', '/api/auth/devices/not-an-id', ta)).status, 404);
  assert.ok(!(await tok('GET', '/api/auth/devices', ta)).body.some((d: any) => d.id === bId));
  assert.equal((await tok('GET', '/api/state', ta)).status, 200, 'A unaffected');
  const sid = (await A.c.json('GET', '/api/auth/sessions')).body[0].id;
  assert.equal((await tok('DELETE', `/api/auth/devices/${sid}`, ta)).status, 404, 'a session id is not a device id');
  const aId = (await tok('GET', '/api/auth/devices', ta)).body.find((d: any) => d.label === 'A-phone').id;
  assert.equal((await tok('DELETE', `/api/auth/sessions/${aId}`, ta)).status, 404, 'a device id is not a session id');
  assert.equal((await Bu.c.json('GET', '/api/auth/devices')).body.some((d: any) => d.id === aId), false);
  assert.equal((await tok('POST', '/api/auth/logout', ta)).status, 204);
  assert.equal((await tok('GET', '/api/state', ta)).status, 401, 'logout revokes the token');
});

test('password change and account disable revoke every device token', async () => {
  await settle();
  const e = await signup(b, 'erin-e'), f = await signup(b, 'fred-f');
  const te = (await login('erin-e', 'e')).body.token as string, tf = (await login('fred-f', 'f')).body.token as string;
  const pc = await tok('POST', '/api/auth/password', te, { current: PASS, password: 'a brand new password' });
  assert.equal(pc.status, 200, JSON.stringify(pc.body)); assert.equal(pc.headers.get('set-cookie'), null);
  assert.equal((await tok('GET', '/api/state', te)).status, 401);
  assert.equal((await e.c.json('GET', '/api/state')).status, 401);
  b.U.setStatus('fred-f', 'disabled');
  assert.equal((await tok('GET', '/api/state', tf)).status, 401);
  b.U.setStatus('fred-f', 'active');
  assert.equal((await tok('GET', '/api/state', tf)).status, 401, 're-enabling does not resurrect tokens');
  assert.equal((await f.c.json('GET', '/api/state')).status, 401);
});

test('status tells a remote client what the server offers', async () => {
  const s = (await tok('GET', '/api/auth/status', null)).body;
  assert.equal(s.registration, 'invite'); assert.equal(s.mode, 'public'); assert.equal(typeof s.version, 'string'); assert.equal(s.serverName, '');
  for (const k of ['trading', 'ai', 'ml', 'forward', 'scripts']) assert.equal(s.features[k], false, k);
});

test('WebSocket: token via subprotocol works from a foreign origin and is echoed; no/bad/revoked token do not', async () => {
  await settle();
  const t = (await login('alice-a', 'ws-device')).body.token as string, url = b.base.replace('http', 'ws') + '/ws';
  const open = (protocols: string[] | undefined, headers: Record<string, string> = { origin: FOREIGN }) => new Promise<WebSocket>((res, rej) => {
    const ws = new WebSocket(url, protocols, { headers }); ws.on('open', () => res(ws)); ws.on('error', rej); ws.on('unexpected-response', () => rej(Error('refused')));
  });
  const ws = await open([`ct.${t}`]);
  assert.equal(ws.protocol, `ct.${t}`);
  await assert.rejects(open(undefined), 'foreign origin, no token');
  await assert.rejects(open([`ct.${'z'.repeat(43)}`]), 'unknown token');
  await assert.rejects(open(undefined, { origin: FOREIGN, cookie: A.c.cookie }), 'cookie from a foreign origin');
  const closed = new Promise<number>(r => ws.on('close', c => r(c)));
  const id = (await tok('GET', '/api/auth/devices', t)).body.find((d: any) => d.label === 'ws-device').id;
  await tok('DELETE', `/api/auth/devices/${id}`, t);
  assert.equal(await closed, 4001, 'revoking closes the socket');
  await assert.rejects(open([`ct.${t}`]), 'revoked token');
});
