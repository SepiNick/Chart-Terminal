// Community: posts, likes, comments, follows, blocks, reports, chat (REST + WebSocket), limits, cleanup. Public mode.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { boot, client, signup, PASS } from './publictest.ts';

const b = await boot({ CT_QUOTA_RPS: '1000', CT_QUOTA_BURST: '1000', CT_REG_PER_HOUR: '100' });
after(() => b.close());
const { clean } = await import('./social.ts');
const A = (await signup(b, 'alice-a')).c, B = (await signup(b, 'bob-b')).c, C = (await signup(b, 'carol-c')).c;
// An admin: the CLI path creates it with a temporary password that must be changed first.
const temp = await b.U.createAdmin('boss');
const ADM = client(b.base);
await ADM.json('POST', '/api/auth/login', { name: 'boss', password: temp });
await ADM.json('POST', '/api/auth/password', { current: temp, password: PASS });

const post = (c: typeof A, o: Record<string, unknown> = {}) => c.json('POST', '/api/social/posts', { symbol: 'BINANCE:BTCUSDT', tf: '1h', dir: 'long', body: 'Text ' + Math.random(), ...o });
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]), Buffer.from('x')]);

test('text hygiene', () => {
  assert.equal(clean('  a\u0000b\u0007c\r\n\n\n\n\n\nd \u202E ', 'x', 100), 'abc\n\n\nd');
  assert.throws(() => clean('   ', 'x', 10));
  assert.throws(() => clean('x'.repeat(11), 'x', 10));
  assert.equal(clean(undefined, 'x', 10, true), '');
});

test('everything needs a signed-in user', async () => {
  const anon = client(b.base);
  for (const [m, p] of [['GET', '/api/social/feed'], ['POST', '/api/social/posts'], ['GET', '/api/social/chat/general'], ['GET', '/api/social/profile/alice-a']]) assert.equal((await anon.json(m, p, m === 'GET' ? undefined : {})).status, 401);
  assert.equal((await A.json('GET', '/api/auth/status')).body.features.social, true);
});

test('post: validation, hygiene, shape, delete rights', async () => {
  for (const o of [{ symbol: 'btc' }, { symbol: undefined }, { tf: '0m' }, { tf: 'x' }, { dir: 'up' }, { body: '' }, { body: '  \u0000 ' }, { body: 'x'.repeat(5001) }, { title: 'x'.repeat(121) }, { snap: 'short' }, { snap: 5 }])
    assert.equal((await post(A, o)).status, 400, JSON.stringify(o).slice(0, 60));
  const r = await post(A, { title: 'Breakout\nline', body: '<img src=x onerror=alert(1)>\u0000 hi', dir: 'short', tf: '45m' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual({ ...r.body, id: 0, ts: 0 }, { id: 0, user: { name: 'alice-a' }, ts: 0, symbol: 'BINANCE:BTCUSDT', tf: '45m', dir: 'short', title: 'Breakout line', body: '<img src=x onerror=alert(1)> hi', snap: null, likes: 0, liked: false, comments: 0, mine: true });
  assert.equal((await B.json('DELETE', `/api/social/posts/${r.body.id}`)).status, 403);
  assert.equal((await A.json('DELETE', `/api/social/posts/${r.body.id}`)).status, 204);
  assert.equal((await A.json('DELETE', `/api/social/posts/${r.body.id}`)).status, 404);
  const mine = await post(B), gone = await ADM.json('DELETE', `/api/social/posts/${mine.body.id}`);
  assert.equal(gone.status, 204, 'admin may delete');
});

test('identical consecutive text is rejected', async () => {
  const u = (await signup(b, 'dave-d')).c;
  assert.equal((await post(u, { body: 'same' })).status, 200);
  assert.equal((await post(u, { body: 'same' })).status, 409);
  assert.equal((await post(u, { body: 'other' })).status, 200);
  assert.equal((await post(u, { body: 'same' })).status, 200, 'only consecutive');
});

test('snapshot: must be an id of the poster\'s own share', async () => {
  const mk = async (c: typeof A) => (await c.json('POST', '/api/share/snapshot', png, { 'content-type': 'image/png' })).body.id as string;
  const mine = await mk(A), theirs = await mk(B);
  assert.match(mine, /^[\w-]{22}$/);
  assert.equal((await post(A, { snap: theirs })).status, 400);
  assert.equal((await post(A, { snap: 'A'.repeat(22) })).status, 400);
  const ok = await post(A, { snap: mine });
  assert.equal(ok.status, 200); assert.equal(ok.body.snap, mine);
  assert.equal((await post(A, { snap: null })).status, 200);
});

test('feed: paging newest first, filters, likes idempotent', async () => {
  const u = (await signup(b, 'erin-e')).c, ids: number[] = [];
  for (let i = 0; i < 5; i++) ids.push((await post(u, { body: 'p' + i, symbol: i % 2 ? 'ETHUSDT' : 'BTCUSDT' })).body.id);
  const p1 = (await u.json('GET', '/api/social/feed?user=ERIN-E&limit=2')).body.posts;
  assert.deepEqual(p1.map((p: any) => p.id), [ids[4], ids[3]]);
  const p2 = (await u.json('GET', `/api/social/feed?user=erin-e&limit=2&before=${p1[1].id}`)).body.posts;
  assert.deepEqual(p2.map((p: any) => p.id), [ids[2], ids[1]]);
  assert.equal((await u.json('GET', '/api/social/feed?user=erin-e&limit=500')).body.posts.length, 5, 'limit is clamped, not rejected');
  assert.equal((await u.json('GET', '/api/social/feed?limit=0')).status, 400);
  assert.equal((await u.json('GET', '/api/social/feed?before=abc')).status, 400);
  assert.deepEqual((await u.json('GET', '/api/social/feed?user=erin-e&symbol=ETHUSDT')).body.posts.map((p: any) => p.id), [ids[3], ids[1]]);
  const id = ids[0];
  for (let i = 0; i < 3; i++) assert.equal((await B.json('POST', `/api/social/posts/${id}/like`)).body.likes, 1, 'liking twice counts once');
  assert.equal((await u.json('GET', `/api/social/feed?user=erin-e&limit=5`)).body.posts.at(-1).liked, false);
  assert.equal((await B.json('GET', `/api/social/feed?user=erin-e&limit=5`)).body.posts.at(-1).liked, true);
  assert.equal((await B.json('DELETE', `/api/social/posts/${id}/like`)).body.likes, 0);
  assert.equal((await B.json('DELETE', `/api/social/posts/${id}/like`)).status, 200, 'unliking twice is fine');
  assert.equal((await B.json('POST', '/api/social/posts/999999/like')).status, 404);
});

test('comments: add, page, delete rights, count', async () => {
  const p = (await post(A)).body.id as number, base = `/api/social/posts/${p}/comments`;
  assert.equal((await B.json('POST', base, { body: '' })).status, 400);
  assert.equal((await B.json('POST', base, { body: 'x'.repeat(1001) })).status, 400);
  const c1 = (await B.json('POST', base, { body: 'one' })).body, c2 = (await B.json('POST', base, { body: 'two' })).body;
  assert.equal(c1.mine, true);
  assert.equal((await B.json('POST', base, { body: 'two' })).status, 409);
  const l = (await C.json('GET', base + '?limit=1')).body.comments;
  assert.deepEqual(l.map((x: any) => [x.id, x.user.name, x.mine]), [[c2.id, 'bob-b', false]]);
  assert.deepEqual((await C.json('GET', `${base}?before=${c2.id}`)).body.comments.map((x: any) => x.id), [c1.id]);
  assert.equal((await A.json('GET', '/api/social/feed?user=alice-a&limit=1')).body.posts[0].comments, 2);
  assert.equal((await C.json('DELETE', `/api/social/comments/${c1.id}`)).status, 403, 'a stranger cannot');
  assert.equal((await A.json('DELETE', `/api/social/comments/${c1.id}`)).status, 204, 'the post author can');
  assert.equal((await B.json('DELETE', `/api/social/comments/${c2.id}`)).status, 204, 'the comment author can');
  assert.equal((await B.json('DELETE', `/api/social/comments/${c2.id}`)).status, 404);
  assert.equal((await B.json('GET', '/api/social/posts/999999/comments')).status, 404);
});

test('follow, block, profile, "following" feed', async () => {
  const x = (await signup(b, 'fred-f')).c, y = (await signup(b, 'gina-g')).c;
  const py = (await post(y, { body: 'from gina' })).body.id;
  assert.equal((await x.json('GET', '/api/social/feed?following=1')).body.posts.length, 0);
  assert.equal((await x.json('POST', '/api/social/follow/fred-f')).status, 400, 'not yourself');
  assert.equal((await x.json('POST', '/api/social/follow/nobody')).status, 404);
  for (let i = 0; i < 2; i++) assert.equal((await x.json('POST', '/api/social/follow/GINA-G')).body.followed, true);
  let prof = (await x.json('GET', '/api/social/profile/gina-g')).body;
  assert.deepEqual({ ...prof, joined: 0 }, { name: 'gina-g', joined: 0, posts: 1, followers: 1, following: 0, followed: true, blocked: false });
  assert.ok(prof.joined > 1e12);
  assert.deepEqual((await x.json('GET', '/api/social/feed?following=1')).body.posts.map((p: any) => p.id), [py]);
  // blocking: hides her posts, comments and chat from him, and ends the follow
  assert.equal((await x.json('POST', '/api/social/block/gina-g')).status, 200);
  assert.equal((await x.json('POST', '/api/social/block/fred-f')).status, 400);
  assert.equal((await x.json('GET', '/api/social/feed?user=gina-g')).body.posts.length, 0);
  assert.equal((await y.json('GET', '/api/social/feed?user=gina-g')).body.posts.length, 1, 'she still sees her own');
  assert.equal((await x.json('POST', '/api/social/follow/gina-g')).status, 400, 'blocked users cannot be followed');
  prof = (await x.json('GET', '/api/social/profile/gina-g')).body;
  assert.equal(prof.blocked, true); assert.equal(prof.followed, false); assert.equal(prof.followers, 0);
  assert.deepEqual((await x.json('GET', '/api/social/blocks')).body.blocked, [{ name: 'gina-g' }]);
  await y.json('POST', '/api/social/chat/general', { body: 'gina says hi' });
  assert.ok(!(await x.json('GET', '/api/social/chat/general')).body.messages.some((m: any) => m.user.name === 'gina-g'));
  assert.ok((await C.json('GET', '/api/social/chat/general')).body.messages.some((m: any) => m.user.name === 'gina-g'));
  assert.equal((await x.json('DELETE', '/api/social/block/gina-g')).status, 200);
  assert.equal((await x.json('GET', '/api/social/feed?user=gina-g')).body.posts.length, 1);
});

test('reports: one per target, admin queue, hide hides', async () => {
  const p = (await post(B, { body: 'spam spam' })).body.id as number;
  assert.equal((await A.json('POST', '/api/social/report', { kind: 'nope', id: p })).status, 400);
  assert.equal((await A.json('POST', '/api/social/report', { kind: 'post', id: 999999 })).status, 404);
  assert.equal((await A.json('POST', '/api/social/report', { kind: 'post', id: p, reason: 'x'.repeat(301) })).status, 400);
  assert.equal((await A.json('POST', '/api/social/report', { kind: 'post', id: p, reason: 'spam' })).status, 200);
  assert.equal((await A.json('POST', '/api/social/report', { kind: 'post', id: p, reason: 'again' })).status, 409);
  assert.equal((await C.json('POST', '/api/social/report', { kind: 'post', id: p })).status, 200);
  assert.equal((await A.json('GET', '/api/social/reports')).status, 404, 'not an admin');
  assert.equal((await A.json('POST', '/api/social/reports/1/resolve', { hide: true })).status, 404);
  const q = (await ADM.json('GET', '/api/social/reports?resolved=0')).body.reports as any[];
  const mine = q.filter(r => r.kind === 'post' && r.targetId === p);
  assert.equal(mine.length, 2);
  assert.deepEqual(mine.map(r => r.reporter.name).sort(), ['alice-a', 'carol-c']);
  assert.equal(mine[0].target.user.name, 'bob-b'); assert.equal(mine[0].target.hidden, false);
  assert.equal((await ADM.json('POST', `/api/social/reports/${mine[0].id}/resolve`, { hide: true })).status, 200);
  assert.equal((await C.json('GET', '/api/social/feed?user=bob-b&limit=50')).body.posts.some((x: any) => x.id === p), false, 'hidden');
  assert.equal((await C.json('POST', `/api/social/posts/${p}/like`)).status, 404, 'a hidden post is gone');
  assert.equal((await ADM.json('GET', '/api/social/reports?resolved=0')).body.reports.some((r: any) => r.targetId === p && r.kind === 'post'), false, 'both reports settled');
  assert.equal((await ADM.json('GET', '/api/social/reports?resolved=1')).body.reports.some((r: any) => r.targetId === p), true);
  // dismiss: resolve without hiding
  const q2 = (await post(B, { body: 'fine post' })).body.id;
  await A.json('POST', '/api/social/report', { kind: 'post', id: q2 });
  const rid = (await ADM.json('GET', '/api/social/reports')).body.reports.find((r: any) => r.targetId === q2).id;
  await ADM.json('POST', `/api/social/reports/${rid}/resolve`, { hide: false });
  assert.equal((await C.json('GET', '/api/social/feed?user=bob-b&limit=50')).body.posts.some((x: any) => x.id === q2), true);
});

test('chat REST: rooms, paging, hygiene, delete rights, hidden by report', async () => {
  assert.equal((await A.json('GET', '/api/social/chat/random')).status, 400);
  assert.equal((await A.json('GET', '/api/social/chat/sym:bad')).status, 400);
  assert.equal((await A.json('POST', '/api/social/chat/sym:BINANCE:BTCUSDT', { body: '' })).status, 400);
  const room = encodeURIComponent('sym:BINANCE:ETHUSDT'), m1 = (await A.json('POST', `/api/social/chat/${room}`, { body: 'first\u0000' })).body, m2 = (await A.json('POST', `/api/social/chat/${room}`, { body: 'second' })).body;
  assert.equal(m1.body, 'first');
  assert.equal((await A.json('POST', `/api/social/chat/${room}`, { body: 'second' })).status, 409);
  const got = (await B.json('GET', `/api/social/chat/${room}`)).body.messages;
  assert.deepEqual(got.map((m: any) => [m.id, m.mine]), [[m2.id, false], [m1.id, false]], 'newest first');
  assert.deepEqual((await B.json('GET', `/api/social/chat/${room}?before=${m2.id}&limit=1`)).body.messages.map((m: any) => m.id), [m1.id]);
  assert.equal((await B.json('GET', '/api/social/chat/general')).body.messages.some((m: any) => m.id === m1.id), false, 'rooms are separate');
  assert.equal((await B.json('DELETE', `/api/social/chat/messages/${m1.id}`)).status, 403);
  assert.equal((await A.json('DELETE', `/api/social/chat/messages/${m1.id}`)).status, 204);
  assert.equal((await ADM.json('DELETE', `/api/social/chat/messages/${m2.id}`)).status, 204);
  assert.equal((await ADM.json('DELETE', `/api/social/chat/messages/${m2.id}`)).status, 404);
  const m3 = (await C.json('POST', '/api/social/chat/general', { body: 'rude words' })).body;
  await A.json('POST', '/api/social/report', { kind: 'chat', id: m3.id, reason: 'rude' });
  const rid = (await ADM.json('GET', '/api/social/reports')).body.reports.find((r: any) => r.kind === 'chat' && r.targetId === m3.id).id;
  await ADM.json('POST', `/api/social/reports/${rid}/resolve`, { hide: true });
  assert.equal((await B.json('GET', '/api/social/chat/general')).body.messages.some((m: any) => m.id === m3.id), false);
});

/** A socket for a signed-in test client. */
const open = (c: { cookie: string }) => new Promise<{ ws: WebSocket; got: any[]; send: (m: unknown) => void; wait: (f: (m: any) => boolean, ms?: number) => Promise<any> }>((res, rej) => {
  const ws = new WebSocket(b.base.replace('http', 'ws') + '/ws', { headers: { cookie: c.cookie, origin: b.base } }), got: any[] = [];
  ws.on('message', d => got.push(JSON.parse(String(d))));
  ws.on('open', () => res({ ws, got, send: m => ws.send(JSON.stringify(m)), wait: async (f, ms = 2000) => { for (const t = Date.now(); Date.now() - t < ms;) { const m = got.find(f); if (m) return m; await new Promise(r => setTimeout(r, 20)) } throw Error('timeout') } }));
  ws.on('error', rej);
});
const quiet = () => new Promise(r => setTimeout(r, 250));

test('chat over WebSocket: joined clients get it, others and blockers do not, 3 rooms at most', async () => {
  const u1 = (await signup(b, 'hank-h')).c, u2 = (await signup(b, 'iris-i')).c, u3 = (await signup(b, 'jack-j')).c, u4 = (await signup(b, 'kate-k')).c;
  const w1 = await open(u1), w2 = await open(u2), w3 = await open(u3), w4 = await open(u4);
  try {
    w1.send({ op: 'social.join', room: 'general' }); w2.send({ op: 'social.join', room: 'general' }); w3.send({ op: 'social.join', room: 'sym:BTCUSDT' });
    await Promise.all([w1, w2, w3].map(w => w.wait(m => m.op === 'social.joined')));
    w4.send({ op: 'social.join', room: 'general' }); await w4.wait(m => m.op === 'social.joined');
    assert.equal((await u4.json('POST', '/api/social/block/hank-h')).status, 200);   // kate blocked hank
    const sent = await u1.json('POST', '/api/social/chat/general', { body: 'hello room' });
    const m = await w2.wait(x => x.op === 'social.msg');
    assert.deepEqual({ ...m, message: { ...m.message, ts: 0 } }, { type: 'social.msg', op: 'social.msg', room: 'general', message: { id: sent.body.id, user: { name: 'hank-h' }, ts: 0, body: 'hello room', mine: false } });
    assert.equal((await w1.wait(x => x.op === 'social.msg')).message.mine, true, 'the sender hears its own message too');
    await quiet();
    assert.equal(w3.got.some(x => x.op === 'social.msg'), false, 'other room');
    assert.equal(w4.got.some(x => x.op === 'social.msg'), false, 'blocker');
    // leave: nothing more
    w2.send({ op: 'social.leave', room: 'general' }); await w2.wait(x => x.op === 'social.left');
    w2.got.length = 0;
    await u1.json('POST', '/api/social/chat/general', { body: 'second one' });
    await quiet();
    assert.equal(w2.got.some(x => x.op === 'social.msg'), false, 'left');
    // bad room, and a 4th room
    w1.send({ op: 'social.join', room: 'nope' }); await w1.wait(x => x.type === 'error');
    w1.got.length = 0;
    w1.send({ op: 'social.join', room: 'sym:AAA' }); w1.send({ op: 'social.join', room: 'sym:BBB' }); w1.send({ op: 'social.join', room: 'sym:CCC' });
    await w1.wait(x => x.type === 'error');
    assert.equal(w1.got.filter(x => x.op === 'social.joined').length, 2, 'general + two more = 3 rooms');
  } finally { for (const w of [w1, w2, w3, w4]) w.ws.close() }
});

test('limits per user', async () => {
  const u = (await signup(b, 'lim-l')).c;
  for (let i = 0; i < 10; i++) assert.equal((await post(u)).status, 200, 'post ' + i);
  const over = await post(u);
  assert.equal(over.status, 429); assert.ok(over.headers.get('retry-after'));
  assert.equal((await post(A)).status, 200, 'other users are unaffected');
  const pid = (await post(A)).body.id;
  for (let i = 0; i < 20; i++) assert.equal((await u.json('POST', '/api/social/chat/general', { body: 'c' + i })).status, 200);
  assert.equal((await u.json('POST', '/api/social/chat/general', { body: 'one more' })).status, 429);
  for (let i = 0; i < 40; i++) assert.equal((await u.json('POST', `/api/social/posts/${pid}/comments`, { body: 'k' + i })).status, 200);
  assert.equal((await u.json('POST', `/api/social/posts/${pid}/comments`, { body: 'one more' })).status, 429);
  // reports: 5 an hour
  const t = (await post(B)).body.id; void t;
  const ids: number[] = [];
  for (let i = 0; i < 6; i++) ids.push((await post(B, { body: 'r' + i })).body.id);
  for (let i = 0; i < 5; i++) assert.equal((await u.json('POST', '/api/social/report', { kind: 'post', id: ids[i] })).status, 200);
  assert.equal((await u.json('POST', '/api/social/report', { kind: 'post', id: ids[5] })).status, 429);
});

test('removing an account removes its community rows', async () => {
  const z = (await signup(b, 'zed-z')).c;
  const zp = (await post(z, { body: 'zed post' })).body.id as number, ap = (await post(A, { body: 'alice for zed' })).body.id as number;
  await B.json('POST', `/api/social/posts/${zp}/like`); await B.json('POST', `/api/social/posts/${zp}/comments`, { body: 'on zed' });
  await z.json('POST', `/api/social/posts/${ap}/like`); await z.json('POST', `/api/social/posts/${ap}/comments`, { body: 'zed comments' });
  await z.json('POST', '/api/social/follow/alice-a'); await B.json('POST', '/api/social/follow/zed-z'); await z.json('POST', '/api/social/block/carol-c');
  await z.json('POST', '/api/social/chat/general', { body: 'zed chat' });
  await z.json('POST', '/api/social/report', { kind: 'post', id: ap });
  await b.U.removeUser('zed-z');
  const feed = (await A.json('GET', `/api/social/feed?limit=50`)).body.posts as any[];
  assert.ok(!feed.some(p => p.id === zp), 'post gone');
  assert.equal(feed.find(p => p.id === ap).likes, 0); assert.equal(feed.find(p => p.id === ap).comments, 0);
  assert.equal((await A.json('GET', '/api/social/profile/alice-a')).body.followers, 0);
  assert.ok(!(await A.json('GET', '/api/social/chat/general')).body.messages.some((m: any) => m.body === 'zed chat'));
  assert.equal((await A.json('GET', '/api/social/profile/zed-z')).status, 404);
  assert.equal((await ADM.json('GET', '/api/social/reports')).body.reports.some((r: any) => r.targetId === ap && r.reporter.name === ''), false, 'its reports are gone');
});
