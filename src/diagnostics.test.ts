import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReport, clearErrors, installErrorLog, recentErrors, redact } from './diagnostics.ts';

test('redact: tokens, parameters, e-mails, addresses and long secrets disappear; ordinary text stays', () => {
  const dirty = 'GET /x?apikey=abcd1234efgh&symbol=BTC Authorization: Bearer abcdefghijklmnop12345 user bob.smith@example.com at 192.168.1.20 hash ' + 'a'.repeat(40) + ' pw="hunter22" ok';
  const r = redact(dirty);
  for (const secret of ['abcd1234efgh', 'abcdefghijklmnop12345', 'bob.smith', '192.168.1.20', 'a'.repeat(40), 'hunter22']) assert.ok(!r.includes(secret), `${secret} left in: ${r}`);
  assert.match(r, /symbol=BTC/);
  assert.match(r, /\[email\]/);
  assert.equal(redact('Failed to fetch BTCUSDT 1h'), 'Failed to fetch BTCUSDT 1h');
});

test('the error log keeps the newest 40 messages, redacted and clipped', () => {
  const listeners: Record<string, (e: unknown) => void> = {};
  const logged: unknown[][] = [];
  const fakeConsole = { error: (...a: unknown[]) => { logged.push(a) } } as unknown as Console;
  clearErrors();
  installErrorLog({ addEventListener: (t: string, f: (e: unknown) => void) => { listeners[t] = f }, console: fakeConsole });
  for (let i = 0; i < 45; i++) listeners['error']({ message: `boom ${i} token=SECRETSECRET` });
  listeners['unhandledrejection']({ reason: new Error('rejected for bob@example.com') });
  fakeConsole.error('feed down', new Error('socket closed'));
  const e = recentErrors();
  assert.equal(e.length, 40);
  assert.ok(e.every(x => !/SECRETSECRET|bob@/.test(x.msg)));
  assert.deepEqual(e.slice(-2).map(x => x.kind), ['promise', 'console']);
  assert.match(e.at(-1)!.msg, /feed down socket closed/);
  assert.equal(logged.length, 1, 'the original console.error still runs');
  clearErrors();
});

test('report: sections, failures visible, no secrets from any field', () => {
  const t = buildReport({
    now: Date.UTC(2026, 10, 4, 12), browser: { ua: 'Mozilla/5.0 (X11) Chrome/130', language: 'fa-IR', tz: 'Asia/Tehran', online: true, cores: 8 },
    app: { origin: 'http://192.168.1.5:8787', lang: 'fa', theme: 'dark', charts: 2, storageKeys: 30, storageKb: 120 },
    server: { mode: 'private', version: '0.1.0', features: 'trading, ai' },
    sources: [{ source: 'nobitex', ok: true, ms: 240, detail: '3 bars, last 2026-11-04' }, { source: 'tse', ok: false, ms: 10000, detail: 'no answer in 10 s' }],
    errors: [{ at: Date.UTC(2026, 10, 4, 11, 59), kind: 'error', msg: 'x is not a function' }],
  });
  assert.match(t, /2026-11-04T12:00:00/);
  assert.match(t, /ok\s+nobitex\s+240 ms/);
  assert.match(t, /FAIL tse\s+10000 ms\s+no answer/);
  assert.match(t, /Recent errors \(1\)/);
  assert.ok(!t.includes('192.168.1.5'), 'a home-network address is redacted');
  assert.match(buildReport({ now: 0, browser: { ua: '', language: '', tz: '', online: false }, app: { origin: '', lang: 'en', theme: 'light', charts: 1 }, server: { error: 'Failed to fetch' }, sources: { error: 'x' }, errors: [] }), /OFFLINE[\s\S]*not reachable: Failed to fetch[\s\S]*could not ask/);
});

test('crash gate: three a session, a minute apart, the same bug once a day; noise is ignored', async () => {
  const { crashGate, crashSignature, isNoise } = await import('./diagnostics.ts');
  const seen: Record<string, number> = {}, gate = crashGate(seen);
  const a = crashSignature('error', 'x is not a function at line 12'), a2 = crashSignature('error', 'x is not a function at line 99');
  assert.equal(a, a2, 'numbers do not make a new bug');
  assert.equal(gate(a, 1_000), true);
  assert.equal(gate('b', 1_500), false, 'too soon after the last one');
  assert.equal(gate(a, 100_000), false, 'same bug again');
  assert.equal(gate('b', 100_000), true);
  assert.equal(gate('c', 200_000), true);
  assert.equal(gate('d', 300_000), false, 'three per session');
  assert.ok(isNoise('ResizeObserver loop completed with undelivered notifications.') && isNoise('Script error.') && !isNoise('boom'));
  assert.ok(isNoise('Uncaught Error: Object is disposed', 'at h.get (assets/data-X.js:1:3115) | at h.resizeCanvasElement (assets/data-X.js:1:3609)'), 'the library resize race is noise');
  assert.ok(!isNoise('Uncaught Error: Object is disposed', 'at Foo.draw (assets/main-X.js:1:2)'), 'the same message from our own code still reports');
  assert.ok(!crashSignature('error', 'failed token=abcdef123456').includes('abcdef123456'));
});

test('stack frames: no host names or user paths, at most 5, keeps function and file:line', async () => {
  const { frames } = await import('./diagnostics.ts');
  const s = 'TypeError: x is undefined\n    at Pe.draw (http://192.168.1.5:8129/assets/main-AbC123.js:12:345)\n    at f (file:///C:/Users/bob/AppData/app/dist/assets/main-AbC123.js:1:2)\n    at a\n    at b\n    at c\n    at d';
  const f = frames(s)!;
  assert.ok(!/192\.168|bob|http:|file:/.test(f), f);
  assert.match(f, /Pe\.draw \(assets\/main-AbC123\.js:12:345\)/);
  assert.equal(f.split(' | ').length, 5);
  assert.equal(frames(undefined), undefined);
});
