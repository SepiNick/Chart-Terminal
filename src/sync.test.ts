import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hydrate, isSynced, localKeys, localSnapshot, memo, revs } from './sync.ts';
import { mediaIdsOf, rewriteMediaIds } from './journal/media.ts';

function fakeStorage(init: Record<string, string>, full: string[] = []) {
  const m = new Map(Object.entries(init));
  return {
    m,
    get length() { return m.size },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { if (full.includes(k)) throw Error('QuotaExceededError'); m.set(k, v) },
    removeItem: (k: string) => { m.delete(k) },
  };
}

test('device-local and malformed keys never sync', () => {
  assert.equal(isSynced('layout'), true);
  assert.equal(isSynced('journal'), true);
  for (const k of ['bottomH', 'side', 'jwFormTab', 'tsTab', 'domCfg', 'pineEditing', 'pyEditing', 'lastTool', 'searchEx', 'searchEx2', 'uiMode', 'winArr', 'po.abcd1234.layout', 'bad key', '']) assert.equal(isSynced(k), false, k);
});

test('local snapshot lists only synced ct.* keys', () => {
  const ls = fakeStorage({ 'ct.layout': '{"a":1}', 'ct.side': '"watch"', 'ct.broken': '{', other: '1', 'ct.watch': '["BTCUSDT"]' });
  assert.deepEqual(localKeys(ls).sort(), ['broken', 'layout', 'watch']);
  assert.deepEqual(localSnapshot(ls), { layout: { a: 1 }, watch: ['BTCUSDT'] });
});

test('hydrate mirrors the server, keeps device-local keys, falls back to memory on quota', () => {
  const ls = fakeStorage({ 'ct.layout': '1', 'ct.old': '2', 'ct.side': '"dom"', unrelated: 'x' }, ['ct.journal']);
  hydrate({ layout: { value: { n: 5 }, rev: 3, updated: 0 }, journal: { value: { trades: [] }, rev: 7, updated: 0 } }, ls);
  assert.deepEqual(Object.fromEntries(ls.m), { 'ct.layout': '{"n":5}', 'ct.side': '"dom"', unrelated: 'x' });
  assert.equal(memo.get('journal'), '{"trades":[]}');
  assert.equal(revs.get('layout'), 3);
  assert.equal(revs.get('journal'), 7);
});

test('journal media ids are found and rewritten in place', () => {
  const j = { trades: [{ media: [{ id: 'mold1', kind: 'image' }, { id: 'keep', kind: 'audio' }] }, {}, { media: [{ id: 'mold2' }] }] };
  assert.deepEqual(mediaIdsOf(j), ['mold1', 'keep', 'mold2']);
  assert.equal(rewriteMediaIds(j, new Map([['mold1', 'mNEW1'], ['mold2', 'mNEW2']])), true);
  assert.deepEqual(mediaIdsOf(j), ['mNEW1', 'keep', 'mNEW2']);
  assert.equal(rewriteMediaIds(j, new Map()), false);
  assert.deepEqual(mediaIdsOf(null), []);
});
