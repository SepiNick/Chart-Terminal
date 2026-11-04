// Cross-user isolation on the public server (docs/research/multiuser-design.md §3.3). Every registered route must be
// classified below; a route that is not fails this test, so new routes cannot ship without a decision.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks, createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import WebSocket from 'ws';

const loaded = new Set<string>();
registerHooks({ resolve(spec, ctx, next) { const r = next(spec, ctx); loaded.add(r.url); return r } });
const vapid = createRequire(import.meta.url)('web-push').generateVAPIDKeys();
const { boot, signup, PASS } = await import('./publictest.ts');
const b = await boot({ CT_QUOTA_RPS: '1000', CT_QUOTA_BURST: '1000', CT_VAPID_PUBLIC: vapid.publicKey, CT_VAPID_PRIVATE: vapid.privateKey });
after(() => b.close());
const { routeTable } = await import('./core/http.ts');
const A = await signup(b, 'alice-a'), Bu = await signup(b, 'bob-b');

// U-id: id-addressed, a foreign id must be 404 · U-list: lists/queries of the caller's own data · G: shared market data
// AUTH: login family · ADMIN: admin role + password · PUB: public by design (capability link, health, push key)
const CLASS: Record<string, 'U-id' | 'U-list' | 'G' | 'AUTH' | 'ADMIN' | 'PUB'> = {
  'GET /api/health': 'PUB', 'GET /api/auth/status': 'AUTH', 'POST /api/auth/register': 'AUTH', 'POST /api/auth/login': 'AUTH', 'POST /api/auth/logout': 'AUTH',
  'POST /api/auth/password': 'AUTH', 'POST /api/auth/recover': 'AUTH', 'POST /api/auth/recovery-codes': 'AUTH', 'GET /api/auth/devices': 'U-list', 'DELETE /api/auth/devices/:id': 'U-id', 'GET /api/auth/sessions': 'U-list', 'DELETE /api/auth/sessions/:id': 'U-id',
  'POST /api/admin/invites': 'ADMIN', 'POST /api/admin/users': 'ADMIN',
  'POST /api/media': 'U-list', 'GET /api/media/:id': 'U-id', 'DELETE /api/media/:id': 'U-id',
  'GET /api/state': 'U-list', 'PUT /api/state/:key': 'U-list', 'DELETE /api/state/:key': 'U-list',
  'GET /api/notify/push/key': 'PUB', 'POST /api/notify/push/subscribe': 'U-list', 'POST /api/notify/push/unsubscribe': 'U-list', 'GET /api/notify/settings': 'U-list', 'PUT /api/notify/settings': 'U-list', 'POST /api/notify/test': 'U-list', 'GET /api/notify/log': 'U-list',
  'GET /api/alerts': 'U-list', 'POST /api/alerts': 'U-list', 'GET /api/alerts/log': 'U-list', 'DELETE /api/alerts/log': 'U-list', 'POST /api/alerts/log/import': 'U-list', 'PUT /api/alerts/:id': 'U-id', 'DELETE /api/alerts/:id': 'U-id',
  'POST /api/share/snapshot': 'U-list', 'GET /s/:id': 'PUB', 'POST /api/share/layout': 'U-list', 'GET /api/share/layout/:id': 'U-id', 'GET /api/share': 'U-list', 'DELETE /api/share/:id': 'U-id',
  'GET /api/exchanges': 'G', 'GET /api/markets': 'G', 'GET /api/bars': 'G', 'GET /api/tickers': 'G', 'GET /api/trades': 'G', 'GET /api/calendar': 'G', 'GET /api/dividends': 'G', 'GET /api/derivs/:kind': 'G',
  'GET /api/news': 'G', 'GET /api/dex': 'G', 'GET /api/coins': 'G', 'GET /api/global': 'G', 'GET /api/global/history': 'G', 'GET /api/breadth': 'G', 'GET /api/uptrend': 'G', 'GET /api/treasury': 'G', 'GET /api/us-stocks': 'G',
  'GET /api/sec/facts': 'G', 'GET /api/sec/submissions': 'G', 'GET /api/sec/cik': 'G', 'GET /api/sec/frame': 'G', 'GET /api/sec/file': 'G', 'GET /api/sec/earnings': 'G', 'GET /api/sec/tickers': 'G',
};

test('every registered route is classified (and no classified route is stale)', () => {
  const have = routeTable().map(r => `${r.method} ${r.path}`);
  assert.deepEqual(have.filter(k => !CLASS[k]), [], 'classify new routes in CLASS (isolation.test.ts)');
  assert.deepEqual(Object.keys(CLASS).filter(k => !have.includes(k)), [], 'stale entries in CLASS');
});

test('modules that must not exist on a public server were never loaded', () => {
  const bad = [...loaded].filter(u => /\/(brokers\/|forward\.ts|engine\.ts|engineworker\.ts|recorder\.ts|llm\.ts|mt5\.ts|ml\.ts|lan\.ts|lan\/|core\/secrets\.ts|scripts\.ts|scriptsource\.ts|ptr\.ts)|\/src\/(mql|ninja)\//.test(u));
  assert.deepEqual(bad, []);
});

test('per-user modules never import the central database directly', () => {
  for (const f of ['state.ts', 'media.ts', 'share.ts', 'alerts/index.ts', 'notify/index.ts', 'authroutes.ts']) {
    const src = readFileSync(join(import.meta.dirname, f), 'utf8');
    assert.ok(!/from '(\.\.?\/)+core\/db\.ts'/.test(src), `${f} imports core/db.ts`);
  }
});

const MA = 'A-SECRET-' + Math.random().toString(16).slice(2);
const png = (m: string) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]), Buffer.from(m)]);
const ids: Record<string, string> = {};

test('A plants a marker in every per-user feature', async () => {
  const a = A.c;
  assert.equal((await a.json('PUT', '/api/state/layout', { value: { note: MA } })).status, 200);
  const al = await a.json('POST', '/api/alerts', { sym: 'BTCUSDT', tf: '1h', source: { kind: 'price' }, condition: 'greater', value: 1, frequency: 'once', channels: ['popup'], message: MA, name: MA, active: false });
  assert.equal(al.status, 200, JSON.stringify(al.body)); ids.alert = al.body.id;
  assert.equal((await a.json('POST', '/api/alerts/log/import', { rows: [{ at: 1_790_000_000_000, message: MA }] })).status, 200);
  const sub = { subscription: { endpoint: `https://fcm.googleapis.com/fcm/send/${MA}`, keys: { p256dh: 'BPaaaa', auth: 'bbbb' } }, agent: MA };
  assert.equal((await a.json('POST', '/api/notify/push/subscribe', sub)).status, 200);
  const m = await a.call('POST', '/api/media', png(MA), { 'content-type': 'image/png' }); ids.media = ((await m.json()) as { id: string }).id;
  const s = await a.call('POST', '/api/share/snapshot', png(MA), { 'content-type': 'image/png' }); ids.snap = ((await s.json()) as { id: string }).id;
  const l = await a.json('POST', '/api/share/layout', { name: MA, layout: { panes: [{ symbol: MA }] } }); ids.layout = l.body.id;
  assert.equal((await a.json('POST', '/api/notify/test', { channel: 'popup' })).status, 200);
  ids.session = (await a.json('GET', '/api/auth/sessions')).body[0].id;
  const dv = await a.json('POST', '/api/auth/login', { name: 'alice-a', password: PASS, device: MA });
  assert.equal(dv.status, 200); assert.ok(dv.body.token);
  ids.device = (await a.json('GET', '/api/auth/devices')).body[0].id;
  assert.ok(Object.values(ids).every(Boolean));
});

test('B sees none of it through any route; foreign ids are 404, not 403', async () => {
  const c = Bu.c, own = (await c.json('GET', '/api/auth/sessions')).body[0].id as string;
  const leakCheck = (what: string, text: string) => {
    assert.ok(!text.includes(MA), `${what} leaked the marker`);
    for (const [k, v] of Object.entries(ids)) assert.ok(!text.includes(v) || v === own, `${what} leaked ${k} id`);
  };
  for (const r of routeTable()) {
    const key = `${r.method} ${r.path}`, cls = CLASS[key];
    if (cls === 'G' || cls === 'AUTH' || cls === 'ADMIN' || cls === 'PUB') continue;
    for (const t of r.path.includes(':') ? Object.values(ids) : [null]) {
      const path = t ? r.path.replace(/:\w+/, encodeURIComponent(t)) : r.path;
      const upload = r.path === '/api/media' || r.path === '/api/share/snapshot';
      const body = r.method === 'GET' || r.method === 'DELETE' ? undefined : upload ? new Uint8Array([1]) : {};
      const res = await c.call(r.method, path, body, upload ? { 'content-type': 'image/png' } : {});
      leakCheck(key, await res.text());
      if (cls === 'U-id') assert.equal(res.status, 404, `${key} with a foreign id (${path}) answered ${res.status}`);
    }
  }
  assert.equal((await A.c.call('GET', `/api/media/${ids.media}`)).status, 200, 'A data intact');
  assert.equal((await A.c.json('GET', '/api/alerts')).body.length, 1);
  assert.equal((await A.c.json('GET', '/api/auth/sessions')).body.length, 1);
  assert.equal((await A.c.json('GET', '/api/auth/devices')).body.length, 1, 'A device intact');
  for (const p of ['/api/state', '/api/alerts', '/api/alerts/log', '/api/notify/settings', '/api/notify/log', '/api/share']) leakCheck(p, JSON.stringify((await c.json('GET', p)).body));
  assert.deepEqual((await c.json('GET', '/api/alerts')).body, []);
  assert.deepEqual((await c.json('GET', '/api/notify/settings')).body.push.subscriptions, []);
});

test('the snapshot link is public by design; admin tools are invisible to non-admins', async () => {
  assert.equal((await fetch(`${b.base}/s/${ids.snap}`)).status, 200);
  assert.equal((await Bu.c.json('POST', '/api/admin/invites', { password: PASS })).status, 404);
  assert.equal((await fetch(`${b.base}/s/not-a-link`)).status, 404);
});

test('WebSocket: B receives nothing of A; A does; bad origins are refused', async () => {
  const open = (c: { cookie: string }, origin: string | null = b.base) => new Promise<{ ws: WebSocket; got: string[] }>((res, rej) => {
    const ws = new WebSocket(b.base.replace('http', 'ws') + '/ws', { headers: { cookie: c.cookie, ...(origin ? { origin } : {}) } }), got: string[] = [];
    ws.on('message', d => got.push(String(d))); ws.on('open', () => res({ ws, got })); ws.on('error', rej);
  });
  const wa = await open(A.c), wb = await open(Bu.c);
  await assert.rejects(open(A.c, null), 'no Origin');
  await assert.rejects(open(A.c, 'http://evil.example'), 'foreign Origin');
  await A.c.json('PUT', '/api/state/layout', { value: { note: MA } });
  await A.c.json('POST', '/api/alerts', { sym: 'BTCUSDT', tf: '1h', source: { kind: 'price' }, condition: 'greater', value: 2, frequency: 'once', channels: ['popup'], message: MA, active: false });
  await A.c.json('POST', '/api/notify/test', { channel: 'popup' });
  await new Promise(r => setTimeout(r, 300));
  assert.ok(wa.got.join().includes(MA), 'A gets its own messages');
  assert.deepEqual(wb.got, [], 'B gets no frames');
  wa.ws.close(); wb.ws.close();
});

test('features that do not exist on a public server answer 404; script and webhook alerts are refused', async () => {
  const c = Bu.c;
  for (const [m, p] of [['GET', '/api/broker/accounts'], ['GET', '/api/forward'], ['POST', '/api/forward'], ['POST', '/api/ml/x'], ['GET', '/api/ai/status'], ['POST', '/api/ai/chat'], ['GET', '/api/lan'], ['GET', '/ca.crt'], ['GET', '/ca.mobileconfig'], ['PUT', '/api/recorder'], ['GET', '/api/recorder'], ['GET', '/api/notify/telegram/chats'], ['GET', '/api/ptr/x']]) {
    assert.equal((await c.call(m, p, m === 'GET' ? undefined : {})).status, 404, `${m} ${p}`);
  }
  const base = { sym: 'BTCUSDT', tf: '1h', frequency: 'once', channels: [], message: '', active: false };
  assert.equal((await c.json('POST', '/api/alerts', { ...base, source: { kind: 'script', script: 'indicator("x")\nalertcondition(close>1)', event: 'alertcondition' } })).status, 400);
  assert.equal((await c.json('POST', '/api/alerts', { ...base, source: { kind: 'price' }, condition: 'greater', value: 1, channels: ['telegram'] })).status, 400);
  assert.equal((await c.json('POST', '/api/alerts', { ...base, source: { kind: 'price' }, condition: 'greater', value: 1, webhook: { url: 'https://x.example' } })).status, 400);
  assert.equal((await c.json('PUT', '/api/notify/settings', { telegram: { chatId: '1' } })).status, 400);
  const sub = (endpoint: string) => c.json('POST', '/api/notify/push/subscribe', { subscription: { endpoint, keys: { p256dh: 'BPaaaa', auth: 'bbbb' } } });
  assert.equal((await sub('https://169.254.169.254/x')).status, 400);
  assert.equal((await sub('https://evil.example/x')).status, 400);
});

test('the same push endpoint can belong to two accounts; neither can remove the row of the other', async () => {
  const ep = 'https://fcm.googleapis.com/fcm/send/shared-browser';
  const sub = { subscription: { endpoint: ep, keys: { p256dh: 'BPaaaa', auth: 'bbbb' } } };
  await A.c.json('POST', '/api/notify/push/subscribe', sub);
  await Bu.c.json('POST', '/api/notify/push/subscribe', sub);
  const n = async (c: typeof A.c) => (await c.json('GET', '/api/notify/settings')).body.push.subscriptions.filter((s: { endpoint: string }) => s.endpoint === ep).length;
  assert.equal(await n(A.c), 1, 'B subscribing never removes A'); assert.equal(await n(Bu.c), 1);
  await A.c.json('POST', '/api/notify/push/unsubscribe', { endpoint: ep });   // removes A's own row only
  assert.equal(await n(A.c), 0); assert.equal(await n(Bu.c), 1);
});

test('deleting A removes the file, the session and the share link; B is untouched', async () => {
  const f = join(b.dir, 'users', '1.db');
  assert.ok(existsSync(f));
  await b.U.removeUser('alice-a');
  assert.ok(!existsSync(f));
  assert.equal((await A.c.json('GET', '/api/state')).status, 401);
  assert.equal((await fetch(`${b.base}/s/${ids.snap}`)).status, 404);
  assert.equal((await Bu.c.json('GET', '/api/state')).status, 200);
});
