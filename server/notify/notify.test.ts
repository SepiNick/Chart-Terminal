import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.CT_DATA_DIR = mkdtempSync(join(tmpdir(), 'ct-notify-'));
const N = await import('./index.ts');
const { db } = await import('../core/db.ts');
const { secretGet } = await import('../core/secrets.ts');

test('render replaces known placeholders and keeps unknown ones', () => {
  assert.equal(N.render('{{ticker}} crossed {{close}} ({{plot_0}}) {{nope}} {{ plot("RSI") }}', { ticker: 'BTCUSDT', close: 65000.5, plot_0: 0, 'plot("RSI")': 71 }),
    'BTCUSDT crossed 65000.5 (0) {{nope}} 71');
  assert.equal(N.render('{{toString}} {{x}}', { x: null }), '{{toString}} {{x}}');
});

test('settings never return secrets; string sets, null deletes, absent keeps', () => {
  const token = '123456:ABCdefGHIjklMNOpqrSTUvwxYZ_-12345', pass = 'hunter2-app-password';
  N.settingsPut({ telegram: { token, chatId: 42 }, email: { host: 'smtp.gmail.com', port: 465, secure: true, user: 'me@x.com', to: 'me@x.com', password: pass }, webhook: { url: 'https://example.com/h' } });
  const out = JSON.stringify(N.settingsGet());
  assert.ok(!out.includes(token) && !out.includes(pass));
  const s = N.settingsGet();
  assert.equal(s.telegram.hasToken, true); assert.equal(s.telegram.chatId, '42');
  assert.equal(s.email.hasPassword, true); assert.equal(s.email.port, 465);
  assert.ok(!('password' in s.email) && !('token' in s.telegram));
  N.settingsPut({ email: { host: 'smtp.example.org' } });          // absent password = keep
  assert.equal(secretGet('email.password'), pass);
  N.settingsPut({ email: { password: null } });
  assert.equal(N.settingsGet().email.hasPassword, false);
  assert.throws(() => N.settingsPut({ telegram: { token: 'bad token' }, webhook: { url: 'https://other.example' } }));
  assert.equal(N.settingsGet().webhook.url, 'https://example.com/h');   // nothing written when validation fails
  assert.throws(() => N.settingsPut({ webhook: { url: 'file:///etc/passwd' } }));
});

test('webhook content type follows the body', async () => {
  assert.equal(N.webhookContentType('{"a":1}'), 'application/json');
  assert.match(N.webhookContentType('BTC above 100k'), /^text\/plain/);
  const seen: { url: string; init: RequestInit }[] = [];
  N.senders.fetch = async (url, init) => { seen.push({ url, init }); return new Response('ok') };
  const d = await N.notify({ title: 't', body: 'b', channels: ['webhook'], webhook: { url: 'http://127.0.0.1:9/x', body: '{"side":"buy"}' } });
  assert.deepEqual(d, [{ channel: 'webhook', ok: true }]);
  assert.equal((seen[0].init.headers as Record<string, string>)['content-type'], 'application/json');
  assert.equal(seen[0].init.body, '{"side":"buy"}');
  N.senders.fetch = async () => new Response('no', { status: 500 });
  const [bad] = await N.notify({ title: 't', body: 'plain', channels: ['webhook'], webhook: { url: 'https://secret.example/TOKEN123' } });
  assert.equal(bad.ok, false); assert.ok(!bad.error!.includes('TOKEN123'));
  const [ftp] = await N.notify({ title: 't', body: 'b', channels: ['webhook'], webhook: { url: 'ftp://x/y' } });
  assert.equal(ftp.ok, false);
});

test('push removes subscriptions the push service reports gone (410/404)', async () => {
  const add = (endpoint: string) => db.prepare('INSERT INTO notify_push_subs (endpoint, p256dh, auth, agent, created) VALUES (?, ?, ?, ?, ?)').run(endpoint, 'BKey', 'auth', 'test', Date.now());
  assert.match(N.vapid().publicKey, /^[\w-]{80,}$/);   // generated once, before any subscription exists
  N.senders.push = async () => ({});
  await N.notify({ title: 'x', body: 'y', channels: ['push'] }).then(d => assert.equal(d[0].ok, false));   // no subscriptions
  add('https://push.example/gone'); add('https://push.example/alive'); add('https://push.example/404');
  const payloads: string[] = [];
  N.senders.push = async (sub, payload) => {
    payloads.push(payload);
    if (sub.endpoint.endsWith('gone')) throw Object.assign(Error('Gone'), { statusCode: 410 });
    if (sub.endpoint.endsWith('404')) throw Object.assign(Error('Not found'), { statusCode: 404 });
    return {};
  };
  const [d] = await N.notify({ title: 'BTC alert', body: 'crossed', channels: ['push'], data: { alertId: 'a1', url: '/?symbol=BTCUSDT' } });
  assert.equal(d.ok, true);
  const left = (db.prepare('SELECT endpoint, last_ok FROM notify_push_subs').all() as { endpoint: string; last_ok: number | null }[]);
  assert.deepEqual(left.map(r => r.endpoint), ['https://push.example/alive']);
  assert.ok(left[0].last_ok);
  const p = JSON.parse(payloads[0]);
  assert.equal(p.title, 'BTC alert'); assert.equal(p.tag, 'alert-a1'); assert.equal(p.data.url, '/?symbol=BTCUSDT');
});

test('rate limiter serialises per key with a minimum gap, other keys run freely', async () => {
  const starts: number[] = [], t0 = Date.now();
  await Promise.all([1, 2, 3].map(() => N.limited('k', 100, async () => { starts.push(Date.now() - t0) })));
  assert.ok(starts[1] - starts[0] >= 95 && starts[2] - starts[1] >= 95, String(starts));
  const t1 = Date.now();
  await N.limited('other', 100, async () => {});
  assert.ok(Date.now() - t1 < 50);
  const failing = N.limited('k', 0, async () => { throw Error('boom') });
  await assert.rejects(failing);
  await N.limited('k', 0, async () => {});   // a failure doesn't jam the lane
  const many = Array.from({ length: 40 }, () => N.limited('burst', 5, async () => {}).then(() => 'ok', e => (e as Error).message));
  const first = await Promise.race(many.slice(30));
  assert.match(first, /rate limited/);
});

test('notify never throws, popup is not held up by slow channels, results are logged', async () => {
  const { clients } = await import('../core/http.ts');
  const popups: string[] = [];
  clients.add({ ws: { readyState: 1, send: (s: string) => popups.push(s) } } as never);
  const pending: (() => void)[] = [];
  N.senders.fetch = () => new Promise<Response>(r => pending.push(() => r(new Response('{"ok":true}'))));
  const p = N.notify({ title: 'T', body: 'B', channels: ['popup', 'webhook', 'popup', 'telegram', 'bogus' as never], webhook: { url: 'https://slow.example' } });
  assert.equal(popups.length, 1);   // sent before any slow channel answered
  assert.equal(JSON.parse(popups[0]).type, 'notify');
  await new Promise(r => setTimeout(r, 20));
  pending.forEach(f => f());
  const d = await p;
  assert.deepEqual(d.map(x => x.channel), ['popup', 'webhook', 'telegram', 'bogus']);
  assert.deepEqual(d.map(x => x.ok), [true, true, true, false]);
  clients.clear();
  assert.deepEqual(await N.notify(null as never), []);
  const log = db.prepare('SELECT deliveries FROM notify_log ORDER BY id DESC LIMIT 1').get() as { deliveries: string };
  assert.equal(JSON.parse(log.deliveries).length, 4);
});
