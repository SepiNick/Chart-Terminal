// POST /api/state/batch and the restore points (docs/research/oauth-sync-design.md 4.4, 4.5).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';

const { boot, signup } = await import('./publictest.ts');
const b = await boot({ CT_REG_PER_HOUR: '100', CT_QUOTA_RPS: '1000', CT_QUOTA_BURST: '1000', CT_QUOTA_STATE_KEYS: '5', CT_QUOTA_RESTORE_MB: '1', CT_AUTH_BURST: '1000', CT_ANON_BURST: '1000' });
after(() => b.close());
const { db } = await import('./core/db.ts');
const A = (await signup(b, 'batch-a')).c, B = (await signup(b, 'batch-b')).c;
const batch = (c: typeof A, writes: unknown[]) => c.json('POST', '/api/state/batch', { writes });
const all = async (c: typeof A) => (await c.json('GET', '/api/state')).body as Record<string, { value: unknown; rev: number }>;

test('writes many keys at once; deletes with null; revs are per key', async () => {
  const r = await batch(A, [{ key: 'watch', value: ['BTC'], baseRev: 0 }, { key: 'layouts', value: { a: 1 }, baseRev: 0 }, { key: 'syncmeta', value: { items: {} } }]);
  assert.equal(r.status, 200); assert.deepEqual(r.body, { ok: true, revs: { watch: 1, layouts: 1, syncmeta: 1 } });
  const r2 = await batch(A, [{ key: 'watch', value: ['BTC', 'ETH'], baseRev: 1 }, { key: 'layouts', value: null, baseRev: 1 }]);
  assert.deepEqual(r2.body.revs, { watch: 2, layouts: 0 });
  const s = await all(A); assert.deepEqual(Object.keys(s).sort(), ['syncmeta', 'watch']); assert.deepEqual(s.watch.value, ['BTC', 'ETH']);
});

test('one stale baseRev aborts everything and lists the current state of every conflicting key', async () => {
  await batch(A, [{ key: 'x1', value: 1 }, { key: 'x2', value: 2 }]);
  const r = await batch(A, [{ key: 'watch', value: ['SOL'], baseRev: 2 }, { key: 'x1', value: 'new', baseRev: 99 }, { key: 'x2', value: 'new', baseRev: 0 }, { key: 'x3', value: 3, baseRev: 0 }]);
  assert.equal(r.status, 409);
  assert.deepEqual(r.body.conflicts.map((c: { key: string; rev: number; value: unknown }) => [c.key, c.rev, c.value]).sort(), [['x1', 1, 1], ['x2', 1, 2]]);
  const s = await all(A); assert.deepEqual(s.watch.value, ['BTC', 'ETH'], 'nothing was written'); assert.ok(!s.x3);
  assert.equal((await A.json('PUT', '/api/state/x1', { value: 5, baseRev: 1 })).status, 200, 'rev unchanged by the failed batch');
});

test('validation: shape, duplicates, bad keys, limits', async () => {
  for (const body of [{}, { writes: [] }, { writes: 'x' }, { writes: [{ key: 'a' }] }, { writes: [{ key: 'bad key', value: 1 }] }, { writes: [{ key: 'a', value: 1 }, { key: 'a', value: 2 }] }, { writes: [{ key: 'a', value: 1, baseRev: -1 }] }, { writes: [{ key: 'a', value: 1, baseRev: 'x' }] }, { writes: [null] }])
    assert.equal((await A.json('POST', '/api/state/batch', body)).status, 400, JSON.stringify(body));
  assert.equal((await batch(A, Array.from({ length: 201 }, (_, i) => ({ key: 'k' + i, value: 1 })))).status, 400);
});

test('quota is checked on the final totals; nothing is written when it fails', async () => {
  const C = (await signup(b, 'batch-c')).c;   // 5 keys allowed
  assert.equal((await batch(C, [1, 2, 3, 4, 5].map(i => ({ key: 'k' + i, value: i })))).status, 200);
  const r = await batch(C, [{ key: 'k1', value: null }, { key: 'k6', value: 6 }, { key: 'k7', value: 7 }]);   // 5 - 1 + 2 = 6 > 5
  assert.equal(r.status, 429);
  assert.deepEqual(Object.keys(await all(C)).sort(), ['k1', 'k2', 'k3', 'k4', 'k5']);
  assert.equal((await batch(C, [{ key: 'k1', value: null }, { key: 'k6', value: 6 }])).status, 200, 'a delete frees its slot in the same batch');
  assert.equal((await batch(C, [{ key: 'k2', value: 'x'.repeat(2.5 * 1024 * 1024) }])).status, 413, 'per-key size');
});

test('owner only: B never sees or changes the keys of A through the batch', async () => {
  const r = await batch(B, [{ key: 'watch', value: ['MINE'], baseRev: 0 }]);
  assert.equal(r.status, 200, 'B has its own "watch" at rev 0');
  assert.deepEqual((await all(A)).watch.value, ['BTC', 'ETH']);
  assert.equal((await fetch(b.base + '/api/state/batch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"writes":[]}' })).status, 401);
});

test('one WebSocket broadcast per key, after the commit, to the same user only', async () => {
  const D = await signup(b, 'batch-d');
  const ws = new WebSocket(b.base.replace('http', 'ws') + '/ws', { headers: { cookie: D.c.cookie, origin: b.base } }), got: { key: string; rev: number }[] = [];
  await new Promise(r => ws.on('open', r)); ws.on('message', d => { const m = JSON.parse(String(d)); if (m.type === 'state') got.push(m) });
  await batch(D.c, [{ key: 'p', value: 1 }, { key: 'q', value: 2 }]);
  await new Promise(r => setTimeout(r, 200)); ws.close();
  assert.deepEqual(got.map(g => g.key).sort(), ['p', 'q']);
});

test('restore points: snapshot, list, fetch, apply (replaces and deletes), undo is a restore point, cap and purge', async () => {
  const R = (await signup(b, 'restore-a')).c, O = (await signup(b, 'restore-b')).c;
  await batch(R, [{ key: 'watch', value: ['A'] }, { key: 'journal', value: { trades: [1] } }]);
  const p1 = await R.json('POST', '/api/restore', { label: 'account-before' });   // the server snapshots the account
  await R.json('POST', '/api/restore', { label: 'device-before', keys: { watch: ['DEVICE'], layouts: { n: 1 } } });
  assert.equal(p1.status, 200);
  const list = (await R.json('GET', '/api/restore')).body;
  assert.deepEqual(list.map((r: { label: string; keys: number }) => [r.label, r.keys]), [['device-before', 2], ['account-before', 2]]);
  assert.ok(!JSON.stringify(list).includes('DEVICE'), 'list has no bodies');
  assert.deepEqual((await R.json('GET', `/api/restore/${p1.body.id}`)).body.keys, { watch: ['A'], journal: { trades: [1] } });
  await batch(R, [{ key: 'watch', value: ['CHANGED'] }, { key: 'extra', value: 1 }]);
  const ap = await R.json('POST', `/api/restore/${p1.body.id}/apply`, {});
  assert.equal(ap.status, 200); assert.ok(ap.body.undo);
  const s = await all(R); assert.deepEqual(Object.keys(s).sort(), ['journal', 'watch']); assert.deepEqual(s.watch.value, ['A']);
  assert.deepEqual((await R.json('GET', `/api/restore/${ap.body.undo}`)).body.keys.watch, ['CHANGED'], 'what was replaced can be restored');
  await R.json('POST', `/api/restore/${ap.body.undo}/apply`, {});
  assert.deepEqual((await all(R)).watch.value, ['CHANGED']);
  for (let i = 0; i < 7; i++) await R.json('POST', '/api/restore', { label: 'n' + i, keys: { a: i } });
  assert.ok((await R.json('GET', '/api/restore')).body.length <= 5, 'at most 5 rows');
  assert.equal((await R.json('POST', '/api/restore', { label: 'big', keys: { j: 'x'.repeat(1.2 * 1024 * 1024) } })).status, 413, 'restoreMb');
  for (const bad of ['abc', '0', '999999', '-1', '1e3']) assert.equal((await R.json('GET', `/api/restore/${bad}`)).status, 404, bad);
  assert.equal((await R.json('POST', '/api/restore', { keys: { 'bad key': 1 } })).status, 400);
  // 30-day purge
  const id = (await R.json('POST', '/api/restore', { label: 'old', keys: { a: 1 } })).body.id;
  const { userDb } = await import('./core/userdb.ts');
  const uid = (db.prepare("SELECT id FROM users WHERE name = 'restore-a'").get() as { id: number }).id;
  userDb(uid).prepare('UPDATE restore SET at = ? WHERE id = ?').run(Date.now() - 31 * 86400_000, id);
  assert.equal((await R.json('GET', `/api/restore/${id}`)).status, 404);
  assert.equal((await R.json('DELETE', `/api/restore/${(await R.json('GET', '/api/restore')).body[0].id}`)).status, 204);
  assert.deepEqual((await O.json('GET', '/api/restore')).body, []);
});
