import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle, powOk, zeroBits, captchaOk, Limiter } from '../src/index.js';

// A Durable Object namespace as the platform behaves: one Limiter, one request at a time, storage that survives between requests.
const kv = () => {
  const store = new Map(), storage = { get: async k => store.get(k), put: async (k, v) => { store.set(k, v) }, delete: async k => { store.delete(k) }, list: async () => new Map(store) };
  const lim = new Limiter({ storage }); let chain = Promise.resolve();
  return { store, idFromName: n => n, get: () => ({ fetch: (url, init) => { const run = chain.then(() => lim.fetch(new Request(url, init))); chain = run.catch(() => {}); return run } }) };
};
const env = (extra = {}) => ({ CHALLENGE_SECRET: 's3cret', TELEGRAM_BOT_TOKEN: '123:abc', TELEGRAM_CHAT_ID: '42', DIFFICULTY: '8', LIMITS: kv(), ...extra });
const png = 'data:image/png;base64,' + Buffer.from('x'.repeat(30)).toString('base64');

async function solve(c) { for (let n = 0; ; n++) if (await powOk(c.salt, n, c.difficulty)) return { ...c, n } }
async function getCaptcha(e) { const r = await handle(new Request('https://w.example/challenge'), e); return solve(await r.json()) }
const post = (body, headers = {}) => { const s = JSON.stringify(body); return new Request('https://w.example/report', { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(s)), 'cf-connecting-ip': '1.2.3.4', ...headers }, body: s }) };

let calls;
const realFetch = globalThis.fetch;
const mock = (impl) => { calls = []; globalThis.fetch = async (url, init) => { calls.push({ url: String(url), init }); return impl(String(url), init) } };
const ok = () => new Response(JSON.stringify({ ok: true, html_url: 'https://github.com/o/r/issues/7' }), { status: 200 });
test.afterEach(() => { globalThis.fetch = realFetch });

test('zeroBits counts leading zero bits', () => {
  assert.equal(zeroBits(new Uint8Array([0, 0, 0x10])), 19);
  assert.equal(zeroBits(new Uint8Array([0x80])), 0);
  assert.equal(zeroBits(new Uint8Array([0x01])), 7);
});

test('a solved puzzle sends the report to Telegram: message, diagnostics, screenshot', async () => {
  mock(ok); const e = env();
  const res = await handle(post({ description: 'The chart is empty after switching', contact: 'me', info: 'v0.1.3', images: [png], captcha: await getCaptcha(e) }), e);
  assert.equal(res.status, 200); assert.equal((await res.json()).ok, true);
  assert.deepEqual(calls.map(c => c.url.split('/').pop()), ['sendMessage', 'sendDocument', 'sendPhoto']);
  assert.ok(calls.every(c => c.url.startsWith('https://api.telegram.org/bot123:abc/')));
});

test('captcha: wrong n, tampered difficulty, forged signature, expiry and replay are refused', async () => {
  mock(ok); const e = env(), c = await getCaptcha(e), body = { description: 'something broke here' };
  if (!(await powOk(c.salt, c.n + 1, c.difficulty))) assert.equal((await handle(post({ ...body, captcha: { ...c, n: c.n + 1 } }), e)).status, 403);   // a wrong n (n+1 solves it too about 1 time in 2^difficulty)
  assert.equal((await handle(post({ ...body, captcha: { ...c, difficulty: 1 } }), e)).status, 403);   // easier than the server's setting
  assert.equal((await handle(post({ ...body, captcha: { ...c, sig: '0'.repeat(64) } }), e)).status, 403);
  assert.equal((await handle(post({ ...body, captcha: undefined }), e)).status, 403);
  assert.equal(await captchaOk(c, e, c.exp + 1), false);
  assert.equal((await handle(post({ ...body, captcha: c }), e)).status, 200);
  assert.equal((await handle(post({ ...body, captcha: c }), e)).status, 403);   // the same puzzle twice
});

test('validation: short text, bad image type, too many images, oversized body', async () => {
  mock(ok); const e = env();
  assert.equal((await handle(post({ description: 'no', captcha: await getCaptcha(e) }), e)).status, 400);
  assert.equal((await handle(post({ description: 'a real description', images: ['data:image/svg+xml;base64,AAAA'], captcha: await getCaptcha(e) }), e)).status, 400);
  assert.equal((await handle(post({ description: 'a real description', images: [png, png, png, png], captcha: await getCaptcha(e) }), e)).status, 400);
  assert.equal((await handle(post({ description: 'x' }, { 'content-length': String(10 * 1024 * 1024) }), e)).status, 413);
  // no content-length header (HTTP/2 may omit it): the cap is enforced while the body streams in
  assert.equal((await handle(new Request('https://w.example/report', { method: 'POST', body: JSON.stringify({ description: 'x'.repeat(10 * 1024 * 1024) }) }), e)).status, 413);
  assert.equal((await handle(new Request('https://w.example/report', { method: 'POST', body: '{ not json' }), e)).status, 400);
  assert.equal(calls.length, 0);
});

test('limits: per IP per hour and per day', async () => {
  mock(ok); const e = env({ IP_PER_HOUR: '2', PER_DAY: '3' });
  const send = async ip => (await handle(post({ description: 'another problem report', captcha: await getCaptcha(e) }, { 'cf-connecting-ip': ip }), e)).status;
  assert.deepEqual([await send('9.9.9.9'), await send('9.9.9.9'), await send('9.9.9.9')], [200, 200, 429]);
  assert.equal(await send('8.8.8.8'), 200);       // a third report today, from another address
  assert.equal(await send('7.7.7.7'), 429);       // the daily cap (3) is reached
});

test('a Telegram failure is a 502 (the app then offers to save the report as a file)', async () => {
  mock(() => new Response(JSON.stringify({ ok: false, description: 'chat not found 123:abc' }), { status: 400 })); const e = env();
  const res = await handle(post({ description: 'a real description here', captcha: await getCaptcha(e) }), e);
  assert.equal(res.status, 502);
  assert.ok(!JSON.stringify(await res.json()).includes('123:abc'));
});

test('GitHub issue: text only, no contact, @ neutralised; its link goes to Telegram', async () => {
  mock(u => ok()); const e = env({ GITHUB_TOKEN: 'ghp_x', GITHUB_REPO: 'o/r' });
  const res = await handle(post({ description: 'Crash when I ping @someone', contact: 'secret@mail.org', info: 'diag', images: [png], captcha: await getCaptcha(e) }), e);
  assert.equal(res.status, 200);
  const gh = calls.find(c => c.url === 'https://api.github.com/repos/o/r/issues'), issueBody = JSON.parse(gh.init.body);
  assert.ok(!issueBody.body.includes('secret@mail.org') && !/@someone/.test(issueBody.body) && /@​someone/.test(issueBody.body));
  const msg = calls.find(c => c.url.endsWith('/sendMessage')).init.body.get('text');
  assert.ok(msg.includes('https://github.com/o/r/issues/7') && msg.includes('Contact: secret@mail.org'));
});

test('no limiter binding, or a broken one: the report is refused, never accepted without limits', async () => {
  mock(ok); const e = env(), c = await getCaptcha(e), body = { description: 'a real description here' };
  assert.equal((await handle(post({ ...body, captcha: c }), { ...e, LIMITS: undefined })).status, 500);
  const broken = { idFromName: () => 'x', get: () => ({ fetch: async () => { throw new Error('down') } }) };
  assert.equal((await handle(post({ ...body, captcha: c }), { ...e, LIMITS: broken })).status, 503);
  assert.equal(calls.length, 0);
});

test('parallel requests with the same puzzle: exactly one report gets through', async () => {
  mock(ok); const e = env(), c = await getCaptcha(e);
  const codes = await Promise.all(Array.from({ length: 12 }, () => handle(post({ description: 'the same puzzle, twelve times', captcha: c }), e).then(r => r.status)));
  assert.equal(codes.filter(x => x === 200).length, 1);
  assert.equal(calls.filter(x => x.url.endsWith('/sendMessage')).length, 1);
});

test('routing and CORS', async () => {
  const e = env();
  assert.equal((await handle(new Request('https://w.example/nope'), e)).status, 404);
  const pre = await handle(new Request('https://w.example/report', { method: 'OPTIONS' }), e);
  assert.equal(pre.status, 204); assert.equal(pre.headers.get('access-control-allow-origin'), '*');
  assert.equal((await handle(new Request('https://w.example/challenge'), { ...e, CHALLENGE_SECRET: '' })).status, 500);
});
