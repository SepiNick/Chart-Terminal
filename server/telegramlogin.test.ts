// Sign in with Telegram on a private server, with Telegram itself replaced by a stub.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';

const dir = mkdtempSync(join(tmpdir(), 'ct-tg-'));
Object.assign(process.env, { CT_DATA_DIR: dir });
const { handle } = await import('./core/http.ts');
await import('./authroutes.ts');
await import('./state.ts');
const N = await import('./notify/index.ts');
await import('./telegramlogin.ts');
const server = http.createServer((req, res) => handle(req, res, false));
await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
after(() => { server.closeAllConnections(); server.close(); try { rmSync(dir, { recursive: true, force: true }) } catch {} });

// The bot: getMe answers its name; getUpdates returns whatever messages the test queued.
const inbox: ({ message: { text: string; chat: { type: string }; from: { id: number } } } | { callback_query: { id: string; data: string; from: { id: number } } })[] = [], sent: unknown[] = [];
N.senders.fetch = async (url, init) => {
  const method = String(url).split('/').pop();
  const params = JSON.parse(String(init?.body ?? '{}'));
  if (method === 'getMe') return Response.json({ ok: true, result: { username: 'ct_test_bot' } });
  if (method === 'getUpdates') return Response.json({ ok: true, result: inbox });
  sent.push(params); return Response.json({ ok: true, result: {} });
};
const post = async (path: string, body: unknown) => {
  const r = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, cookie: r.headers.get('set-cookie'), body: await r.json().catch(() => null) as any };
};
const status = async () => (await (await fetch(base + '/api/auth/telegram/status')).json() as { enabled: boolean }).enabled;
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

test('disabled until a bot token and a personal chat are saved', async () => {
  assert.equal(await status(), false);
  assert.equal((await post('/api/auth/telegram/start', { device: 'pc' })).status, 404);
  N.settingsPut({ telegram: { token: '123456:ABCdefGHIjklMNOpqrSTUvwxYZ_-12345', chatId: -100123 } });
  assert.equal(await status(), false, 'a group chat id is not a person');
  N.settingsPut({ telegram: { chatId: 777 } });
  assert.equal(await status(), true);
});

test('the owner signs in only after approving in Telegram; the link works one time only', async () => {
  const s = await post('/api/auth/telegram/start', { device: 'pc' });
  assert.equal(s.status, 200);
  const code = new URL(s.body.url).searchParams.get('start')!;
  assert.match(s.body.url, /^https:\/\/t\.me\/ct_test_bot\?start=/);
  assert.match(s.body.short, /^\d{4}$/);
  assert.notEqual(code, s.body.id, 'the link carries a different value than the poll id');
  assert.deepEqual((await post('/api/auth/telegram/poll', { id: s.body.id, device: 'pc' })).body, { pending: true });
  inbox.push({ message: { text: `/start ${code}`, chat: { type: 'private' }, from: { id: 777 } } });
  await wait(1600);
  const asked = await post('/api/auth/telegram/poll', { id: s.body.id, device: 'pc' });
  assert.deepEqual(asked.body, { pending: true, asked: true }, 'tapping Start alone does not sign in');
  const ask = sent.at(-1) as { text: string; reply_markup: unknown };
  assert.ok(ask.text.includes(s.body.short) && ask.text.includes('127.0.0.1'), 'the bot shows the code and the IP');
  await wait(1600);
  assert.equal((await post('/api/auth/telegram/poll', { id: s.body.id, device: 'pc' })).body.pending, true);
  inbox.push({ callback_query: { id: 'q1', data: `ok:${code}`, from: { id: 777 } } });
  await wait(1600);
  const r = await post('/api/auth/telegram/poll', { id: s.body.id, device: 'pc' });
  assert.equal(r.status, 200); assert.ok(r.body.token); assert.equal(r.cookie, null);
  assert.equal((await post('/api/auth/telegram/poll', { id: s.body.id, device: 'pc' })).status, 410, 'one use');
});

test('Deny in Telegram refuses the sign-in', async () => {
  const s = await post('/api/auth/telegram/start', { device: 'pc' });
  const code = new URL(s.body.url).searchParams.get('start')!;
  inbox.length = 0; inbox.push({ message: { text: `/start ${code}`, chat: { type: 'private' }, from: { id: 777 } } });
  await wait(1600); await post('/api/auth/telegram/poll', { id: s.body.id, device: 'pc' });
  inbox.push({ callback_query: { id: 'q2', data: `no:${code}`, from: { id: 777 } } });
  await wait(1600);
  assert.equal((await post('/api/auth/telegram/poll', { id: s.body.id, device: 'pc' })).status, 403);
});

test('another Telegram account, or a start code someone guessed, does not sign in', async () => {
  const s = await post('/api/auth/telegram/start', { device: 'pc' });
  const code = new URL(s.body.url).searchParams.get('start')!;
  inbox.length = 0; inbox.push({ message: { text: `/start ${code}`, chat: { type: 'private' }, from: { id: 999 } } });
  await wait(1600);
  assert.equal((await post('/api/auth/telegram/poll', { id: s.body.id, device: 'pc' })).status, 403);
  const t = await post('/api/auth/telegram/start', { device: 'pc' });
  assert.equal((await post('/api/auth/telegram/poll', { id: code, device: 'pc' })).status, 410, 'the code is not the poll id');
  assert.deepEqual((await post('/api/auth/telegram/poll', { id: t.body.id, device: 'pc' })).body, { pending: true });
});
