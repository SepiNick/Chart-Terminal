import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyMeta, isEmptyDevice, mergeAll, mergeMeta, newerAcct, planMatch, pruneMeta, readOwner, stampChange, summarize, writeOwner, DAY, type Meta } from './syncmerge.ts';

const tr = (id: string, o: object = {}) => ({ id, sym: 'S' + id, dir: 'long', openTime: 1, avgEntry: 10, qty: 1, fills: [], ...o });
const M = (a: object, d: object, o = {}) => mergeAll(a as never, d as never, o);
const kv = () => { const m = new Map<string, string>(); return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) } };

test('journal trades: union by id, fills unioned, later close wins, same fill imported on two devices deduped', () => {
  const a = { journal: { trades: [tr('a'), tr('x', { closeTime: 5, fills: [{ t: 1, side: 'buy', qty: 1, px: 1 }] })], notes: {}, setups: ['A'] } };
  const d = { journal: { trades: [tr('b'), tr('x', { closeTime: 9, net: 3, fills: [{ t: 2, side: 'sell', qty: 1, px: 2 }] }), tr('other-id', { sym: 'Sa' })], notes: {}, setups: ['A', 'B'] } };
  const j = M(a, d).values.journal as { trades: { id: string; net?: number; fills: unknown[] }[]; setups: string[] };
  assert.deepEqual(j.trades.map(t => t.id).sort(), ['a', 'b', 'x']);   // 'other-id' has the content of 'a' (same sym, dir, open, entry, qty)
  const x = j.trades.find(t => t.id === 'x')!;
  assert.equal(x.net, 3); assert.equal(x.fills.length, 2);
  assert.deepEqual(j.setups, ['A', 'B']);
});
test('journal notes keep both; scalars: account wins, gaps filled from the device', () => {
  const r = M({ journal: { trades: [], notes: { d1: 'acc' }, seen: 1 } }, { journal: { trades: [], notes: { d1: 'dev', d2: 'x' }, seen: 9, account: 'p' } }).values.journal as Record<string, any>;
  assert.equal(r.notes.d1, 'acc\n---\ndev'); assert.equal(r.notes.d2, 'x');
  assert.equal(r.seen, 1); assert.equal(r.account, 'p');
});
test('scalar last-writer-wins uses field stamps', () => {
  const am = { ...emptyMeta(), fields: { settings: { theme: 5 } } }, dm = { ...emptyMeta(), fields: { settings: { theme: 9 } } };
  assert.equal((M({ settings: { theme: 'a', z: 1 } }, { settings: { theme: 'd' } }, { accMeta: am, devMeta: dm }).values.settings as any).theme, 'd');
  assert.equal((M({ settings: { theme: 'a' } }, { settings: { theme: 'd' } }).values.settings as any).theme, 'a');
});
test('layouts keep both on a name clash; script conflict keeps both sources', () => {
  const r = M({ layouts: { L: { v: 1 } }, scripts: { s: { id: 's', name: 'S', src: 'A', updated: 5 } } }, { layouts: { L: { v: 2 }, M: { v: 3 } }, scripts: { s: { id: 's', name: 'S', src: 'B', updated: 9 } } }).values as any;
  assert.deepEqual(r.layouts, { L: { v: 1 }, M: { v: 3 }, 'L (this device)': { v: 2 } });
  assert.equal(r.scripts.s.src, 'B');
  assert.equal(Object.values(r.scripts).filter((s: any) => s.src === 'A').length, 1);
});
test('drawings: union per symbol, id clash with other content re-ids, nothing lost', () => {
  const r = M({ drawings: { BTC: [{ id: 1, k: 'a' }] } }, { drawings: { BTC: [{ id: 1, k: 'b' }, { id: 2, k: 'c' }], ETH: [{ id: 3 }] } }).values.drawings as any;
  assert.equal(r.BTC.length, 3); assert.equal(new Set(r.BTC.map((x: any) => x.id)).size, 3); assert.equal(r.ETH.length, 1);
});
test('alerts: same content under another id is one alert, different content gets a new id', () => {
  const r = M({ alerts: [{ id: 1, sym: 'A', price: 1, dir: 'up', on: true }] }, { alerts: [{ id: 1, sym: 'A', price: 2, dir: 'up', on: true }, { id: 7, sym: 'A', price: 1, dir: 'up', on: true }] }).values.alerts as any[];
  assert.equal(r.length, 2); assert.equal(new Set(r.map(a => a.id)).size, 2);
});
test('watch and recentSymbols: ordered union, recents capped at 12', () => {
  const r = M({ watch: ['A', 'B'], recentSymbols: Array.from({ length: 10 }, (_, i) => 's' + i) }, { watch: ['B', 'C'], recentSymbols: ['x1', 'x2', 'x3', 'x4'] }).values as any;
  assert.deepEqual(r.watch, ['A', 'B', 'C']); assert.equal(r.recentSymbols.length, 12);
});
test('the paper account is never merged: the chosen side wins whole', () => {
  const a = { cash: 1, fills: [] }, d = { cash: 2, fills: [{ ts: 5 }] };
  assert.deepEqual(M({ acct: a }, { acct: d }).values.acct, a);
  assert.deepEqual(M({ acct: a }, { acct: d }, { acct: 'device' }).values.acct, d);
  assert.equal(newerAcct(a, d), 'device'); assert.equal(newerAcct(d, a), 'account');
});
test('secrets, tokens and device-only keys never come out of a merge', () => {
  const r = M({ ctsrv: [{ token: 'x' }], aiUrl: 'http://k' }, { ctoauth: { verifier: 'v' }, brokerActive: 'b', ctown: 1, watch: ['A'] }).values;
  assert.deepEqual(Object.keys(r), ['watch']);
});
test('tombstones: a delete stays unless the item was edited later; unknown history never deletes', () => {
  const dev = { watch: ['A', 'B'], layouts: { L: 1, K: 2 } }, acc = { watch: ['A'], layouts: { K: 2 } };
  const am: Meta = { items: { watch: { B: { d: 100 } }, layouts: { L: { d: 100 } } }, fields: {} };
  const r = M(acc, dev, { accMeta: am }).values as any;
  assert.deepEqual(r.watch, ['A']); assert.deepEqual(r.layouts, { K: 2 });
  const dm: Meta = { items: { watch: { B: { u: 200 } } }, fields: {} };
  assert.deepEqual((M(acc, dev, { accMeta: am, devMeta: dm }).values as any).watch, ['A', 'B']);
  assert.deepEqual((M(acc, dev).values as any).watch, ['A', 'B']);
});
test('journal trade tombstone', () => {
  const am: Meta = { items: { 'journal/trades': { gone: { d: 10 } } }, fields: {} };
  const r = M({ journal: { trades: [] } }, { journal: { trades: [tr('gone'), tr('keep')] } }, { accMeta: am }).values.journal as any;
  assert.deepEqual(r.trades.map((t: any) => t.id), ['keep']);
});
test('stampChange records adds, edits and deletes; prune forgets old tombstones', () => {
  const m = emptyMeta();
  stampChange(m, 'watch', ['A', 'B'], ['A', 'C'], 50);
  assert.deepEqual(m.items.watch, { C: { u: 50 }, B: { d: 50 } });
  stampChange(m, 'journal', { trades: [tr('a'), tr('b')] }, { trades: [tr('a', { net: 1 })] }, 60);
  assert.deepEqual(m.items['journal/trades'], { a: { u: 60 }, b: { d: 60 } });
  stampChange(m, 'settings', { t: 1, z: 1 }, { t: 2, z: 1 }, 70);
  assert.deepEqual(m.fields.settings, { t: 70 });
  stampChange(m, 'layout', { a: 1 }, { a: 2 }, 80); assert.equal(m.fields.layout['*'], 80);
  stampChange(m, 'syncmeta', {}, { x: 1 }, 90); assert.equal(m.items.syncmeta, undefined);
  pruneMeta(m, 50 + 91 * DAY); assert.equal(m.items.watch?.B, undefined); assert.equal(m.items.watch?.C?.u, 50);
});
test('metadata merge takes the max of every stamp', () => {
  assert.deepEqual(mergeMeta({ items: { w: { A: { u: 1, d: 5 } } }, fields: { s: { f: 3 } } }, { items: { w: { A: { u: 9 } } }, fields: { s: { f: 2 } } }), { items: { w: { A: { u: 9, d: 5 } } }, fields: { s: { f: 3 } } });
});
const A = { journal: { trades: [tr('a'), tr('x', { closeTime: 5 })], notes: { d: 'one' }, setups: ['S'], seen: 1 }, layouts: { L: { v: 1 } }, watch: ['A', 'B'], scripts: { s: { id: 's', name: 'n', src: '1', updated: 1 } }, drawings: { B: [{ id: 1 }] }, alerts: [{ id: 1, sym: 'A', price: 1, dir: 'up', on: true }], settings: { t: 1 } };
const D = { journal: { trades: [tr('b'), tr('x', { closeTime: 9 })], notes: { d: 'two' }, setups: ['T'], seen: 2 }, layouts: { L: { v: 2 } }, watch: ['B', 'C'], scripts: { s: { id: 's', name: 'n', src: '2', updated: 2 } }, drawings: { B: [{ id: 1, z: 1 }] }, alerts: [{ id: 1, sym: 'A', price: 5, dir: 'up', on: true }], settings: { t: 2, u: 3 } };
test('idempotent: merging the result with either side again changes nothing', () => {
  const r = M(A, D).values;
  assert.deepEqual(M(r, D).values, r); assert.deepEqual(M(r, A).values, r); assert.deepEqual(M(r, r).values, r);
});
test('convergent: both directions end with the same items', () => {
  const ids = (v: any) => ({ trades: v.journal.trades.map((t: any) => t.id).sort(), watch: [...v.watch].sort(), layouts: Object.keys(v.layouts).sort(), scripts: Object.keys(v.scripts).length, alerts: v.alerts.length, drawings: v.drawings.B.length });
  assert.deepEqual(ids(M(A, D).values), ids(M(D, A).values));
});
test('big inputs merge fast and keep everything', () => {
  const big = (p: string, off: number) => ({ journal: { trades: Array.from({ length: 20000 }, (_, i) => tr(p + i, { openTime: i + off, sym: 'X' })), notes: {} }, watch: Array.from({ length: 5000 }, (_, i) => p + i) });
  const t = Date.now(), r = M(big('a', 0), big('b', 0.5)).values as any;
  assert.equal(r.journal.trades.length, 40000); assert.equal(r.watch.length, 10000); assert.ok(Date.now() - t < 5000);
});
test('summary and empty-device detection', () => {
  assert.equal(isEmptyDevice({ settings: { theme: 'dark' }, layout: {} }), true);
  assert.equal(isEmptyDevice({ watch: ['A'] }), false);
  assert.equal(isEmptyDevice({ acct: { cash: 5, fills: [{}] } }), false);
  assert.equal(summarize(A).trades, 2); assert.equal(summarize(A).drawings, 1);
});
test('owner marker and plan: foreign data is never silently uploaded or replaced', () => {
  const ls = kv(); assert.equal(readOwner(ls), null);
  writeOwner(ls, 's1', 'u1', 5); assert.deepEqual(readOwner(ls), { server: 's1', userId: 'u1', at: 5 });
  const base = { deviceEmpty: false, accountEmpty: false, server: 's1', userId: 'u1' }, own = readOwner(ls);
  assert.equal(planMatch({ ...base, own }), 'hydrate');
  assert.equal(planMatch({ ...base, own: null }), 'match');
  assert.equal(planMatch({ ...base, own: null, accountEmpty: true }), 'upload');
  assert.equal(planMatch({ ...base, own, userId: 'u2' }), 'foreign');
  assert.equal(planMatch({ ...base, own, userId: 'u2', accountEmpty: true }), 'foreign');
  assert.equal(planMatch({ ...base, own, server: 's2' }), 'foreign');
  assert.equal(planMatch({ ...base, own: null, deviceEmpty: true }), 'hydrate');
  ls.setItem('ctown', '{bad'); assert.equal(readOwner(ls), null);
});
