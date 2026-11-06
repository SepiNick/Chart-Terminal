import test from 'node:test';
import assert from 'node:assert/strict';
import * as W from './watchlists.ts';
import { mergeAll, stampChange, emptyMeta, summarize, isEmptyDevice, type Meta } from './syncmerge.ts';

const mk = () => W.migrate(undefined, ['AAA', '###Sec', 'BBB'], { AAA: '#f23645', ZZZ: '#f23645' });

test('migration: old single list becomes Default with sections and flags, nothing dropped', () => {
  const L = mk();
  assert.deepEqual(Object.keys(L), ['default']);
  assert.equal(L.default.name, 'Default');
  assert.deepEqual(L.default.syms, ['AAA', '###Sec', 'BBB']);
  assert.deepEqual(L.default.flags, { AAA: '#f23645' });   // flag of a symbol that is not in the list is not carried
  assert.deepEqual(W.migrate(undefined, undefined, undefined).default.syms, W.DEFAULT_SYMS);
  assert.equal(W.migrate(undefined, [], {}).default.syms.length, 0);   // an emptied old list stays empty
});
test('migration: legacy list above the per-list limit is kept whole; stored lists win and are idempotent', () => {
  const big = Array.from({ length: 700 }, (_, i) => 'S' + i);
  assert.equal(W.migrate(undefined, big).default.syms.length, 700);
  const L = mk(), again = W.migrate(JSON.parse(JSON.stringify(L)), ['OTHER']);
  assert.deepEqual(again, L);
});
test('sanitize drops malformed lists, colours and symbols', () => {
  const L = W.sanitize({ ok: { name: ' A  b ', color: 'red', syms: ['X', 'X', 3, ''], flags: { X: 'nope', Y: '#00ff00' }, ord: 'z' }, 'bad id!': { name: 'q' }, n: null });
  assert.deepEqual(Object.keys(L), ['ok']);
  assert.equal(L.ok.name, 'A b'); assert.deepEqual(L.ok.syms, ['X']); assert.deepEqual(L.ok.flags, { Y: '#00ff00' });
  assert.match(L.ok.color, /^#/);
  assert.deepEqual(W.sanitize([1, 2]), {});
});
test('limits: lists, symbols per list, names, last list', () => {
  const L: W.WLists = {};
  for (let i = 0; i < W.MAX_LISTS; i++) assert.ok(W.createList(L, 'L' + i).ok);
  const r = W.createList(L, 'extra');
  assert.ok(!r.ok && r.msg === W.MSG.lists);
  assert.ok(!W.createList({}, '   ').ok);
  const one = W.migrate(undefined, []);
  for (let i = 0; i < W.MAX_SYMS; i++) assert.ok(W.addSymbol(one, 'default', 'S' + i).ok);
  const s = W.addSymbol(one, 'default', 'OVER');
  assert.ok(!s.ok && s.msg === W.MSG.syms);
  assert.ok(W.addSymbol(one, 'default', '###Section').ok);   // sections are not symbols
  assert.ok(!W.addSymbol(one, 'default', 'S1').ok);           // duplicate
  assert.ok(!W.deleteList(one, 'default').ok);                // keep at least one
  assert.equal(W.createList({}, 'x'.repeat(100)).ok, true);
});
test('limits: serialized size cap stays under the server key quota', () => {
  assert.ok(W.MAX_BYTES < 2 * 1024 * 1024);
  const L = W.migrate(undefined, []);
  const long = 'X'.repeat(80);
  let hit = false;
  for (let i = 0; i < W.MAX_LISTS && !hit; i++) {
    const id = i ? W.createList(L, 'L' + i).id! : 'default';
    for (let j = 0; j < W.MAX_SYMS; j++) { const r = W.addSymbol(L, id, long + j + '_' + i); if (!r.ok) { assert.equal(r.msg, W.MSG.big); hit = true; break } }
  }
  assert.ok(hit); assert.ok(W.sizeOf(L) <= W.MAX_BYTES);
});
test('rename, colour, icon, duplicate', () => {
  const L = mk();
  assert.ok(W.renameList(L, 'default', 'Main').ok && L.default.name === 'Main');
  assert.ok(!W.renameList(L, 'default', ' ').ok);
  assert.ok(W.setColor(L, 'default', '#112233').ok && !W.setColor(L, 'default', 'blue').ok);
  W.setIcon(L, 'default', '🔥x'); assert.equal(L.default.icon, '🔥x');
  W.setIcon(L, 'default', ''); assert.equal(L.default.icon, undefined);
  const d = W.duplicateList(L, 'default', '(copy)', 'dup');
  assert.ok(d.ok); assert.equal(L.dup.name, 'Main (copy)'); assert.deepEqual(L.dup.syms, L.default.syms);
  L.dup.syms.push('NEW'); assert.ok(!L.default.syms.includes('NEW'));   // deep copy
});
test('delete with undo restores the list; reorder and moveBefore', () => {
  const L = mk(), b = W.createList(L, 'B', undefined, undefined, 'b').id!, c = W.createList(L, 'C', undefined, undefined, 'c').id!;
  assert.deepEqual(W.sortedIds(L), ['default', b, c]);
  const del = W.deleteList(L, b); assert.ok(del.ok && !L.b);
  assert.ok(W.restoreList(L, 'b', del.removed!).ok); assert.deepEqual(W.sortedIds(L), ['default', 'b', 'c']);
  W.moveBefore(L, 'c', 'default'); assert.deepEqual(W.sortedIds(L), ['c', 'default', 'b']);
  W.moveBefore(L, 'c'); assert.deepEqual(W.sortedIds(L), ['default', 'b', 'c']);
  W.reorder(L, ['b']); assert.deepEqual(W.sortedIds(L), ['b', 'default', 'c']);
  assert.equal(W.resolveActive(L, 'gone'), 'b'); assert.equal(W.resolveActive(L, 'c'), 'c');
});
test('move and copy symbol between lists carry the flag; refuse duplicates and over-limit', () => {
  const L = mk(); W.createList(L, 'B', undefined, undefined, 'b');
  assert.ok(W.moveSymbol(L, 'default', 'b', 'AAA').ok);
  assert.deepEqual(L.b.syms, ['AAA']); assert.equal(L.b.flags.AAA, '#f23645');
  assert.ok(!L.default.syms.includes('AAA') && !('AAA' in L.default.flags));
  assert.ok(W.moveSymbol(L, 'b', 'default', 'AAA', true).ok);   // copy back
  assert.ok(L.b.syms.includes('AAA') && L.default.syms.includes('AAA'));
  assert.ok(!W.moveSymbol(L, 'b', 'default', 'AAA', true).ok);   // already there
  assert.ok(!W.moveSymbol(L, 'b', 'b', 'AAA').ok);
  for (let i = 0; i < W.MAX_SYMS; i++) W.addSymbol(L, 'b', 'F' + i);
  const full = W.moveSymbol(L, 'default', 'b', 'BBB');
  assert.ok(!full.ok && L.default.syms.includes('BBB'));   // failed move loses nothing
});
test('export / import round trip, TradingView format, limits', () => {
  const L = mk(); L.default.syms.push('BINANCEUSDM:BTC_USDT.P', 'BYBIT:ETH_USDT');
  const text = W.exportText(L.default);
  assert.equal(text.split('\n').length, 6 + 0);   // 5 entries + trailing newline
  assert.deepEqual(W.parseImport(text), L.default.syms);   // own symbols survive unchanged
  assert.deepEqual(W.parseImport('###Tech,NASDAQ:AAPL,BINANCE:BTCUSDT,BYBIT:ETHUSDT.P,BINANCE:BTCUSDT'), ['###Tech', 'FX:AAPL', 'BTCUSDT', 'BYBIT:ETH_USDT.P']);
  assert.deepEqual(W.parseImport('﻿btcusdt\r\n ethusdt \n\n'), ['BTCUSDT', 'ETHUSDT']);
  const r = W.importEntries(L, 'default', ['AAA', 'NEW1', 'EXPR*2'], s => s.includes('*'));
  assert.deepEqual([r.added, r.skipped], [1, 0]);
  const M = W.migrate(undefined, []);
  const many = Array.from({ length: W.MAX_SYMS + 5 }, (_, i) => 'S' + i);
  const o = W.importEntries(M, 'default', many);
  assert.deepEqual([o.added, o.skipped, o.msg], [W.MAX_SYMS, 5, W.MSG.syms]);
  const nl = W.importAsList(M, 'File', ['A', 'B']); assert.ok(nl.ok && M[nl.id!].syms.length === 2);
});
test('combined view: list order, symbol order, duplicates merged, sections left out', () => {
  const L: W.WLists = {};
  const a = W.createList(L, 'A', '#111111', undefined, 'a').id!, b = W.createList(L, 'B', '#222222', undefined, 'b').id!;
  for (const s of ['X', '###S', 'Y']) W.addSymbol(L, a, s);
  for (const s of ['Y', 'Z']) W.addSymbol(L, b, s);
  assert.deepEqual(W.combinedRows(L, [a, b]), [{ sym: 'X', lists: ['a'] }, { sym: 'Y', lists: ['a', 'b'] }, { sym: 'Z', lists: ['b'] }]);
  W.moveBefore(L, b, a);   // order follows list order, not the order of the ids argument
  assert.deepEqual(W.combinedRows(L, [a, b]).map(r => r.sym), ['Y', 'Z', 'X']);
  assert.deepEqual(W.combinedRows(L, [b]).map(r => r.sym), ['Y', 'Z']);
  assert.deepEqual(W.combinedRows(L, []), []);
});

// ---------- merge rules (syncmerge.ts) ----------
const merge = (a: any, d: any, am?: Meta, dm?: Meta) => mergeAll(a, d, { accMeta: am, devMeta: dm }).values as any;
const stamped = (key: string, before: any, after: any, m = emptyMeta(), t = 1000) => { stampChange(m, key, before, after, t); return m };

test('merge: two devices that each created a list keep both; same symbols union', () => {
  const base = mk();
  const acc = structuredClone(base), dev = structuredClone(base);
  W.createList(acc, 'Swing', '#111111', undefined, 'lacc'); W.addSymbol(acc, 'lacc', 'S1');
  W.createList(dev, 'Crypto', '#222222', undefined, 'ldev'); W.addSymbol(dev, 'ldev', 'C1'); W.addSymbol(dev, 'default', 'DEVONLY');
  const out = merge({ watchLists: acc }, { watchLists: dev }).watchLists;
  assert.deepEqual(Object.keys(out).sort(), ['default', 'ldev', 'lacc'].sort());
  assert.ok(out.default.syms.includes('DEVONLY') && out.default.syms.includes('AAA'));
  assert.deepEqual(out.lacc.syms, ['S1']); assert.deepEqual(out.ldev.syms, ['C1']);
  assert.deepEqual(merge({ watchLists: dev }, { watchLists: acc }).watchLists.default.syms.slice().sort(), out.default.syms.slice().sort());   // symmetric on content
  assert.deepEqual(merge({ watchLists: out }, { watchLists: out }).watchLists, out);   // idempotent
});
test('merge: a symbol removed on one device stays removed (tombstone), a deleted list stays deleted', () => {
  const before = mk(); W.createList(before, 'Tmp', undefined, undefined, 'tmp'); W.addSymbol(before, 'tmp', 'T1');
  const after = structuredClone(before); W.removeSymbol(after, 'default', 'BBB'); W.deleteList(after, 'tmp');
  const devMeta = stamped('watchLists', before, after);
  const out = merge({ watchLists: before }, { watchLists: after }, emptyMeta(), devMeta).watchLists;
  assert.ok(!out.default.syms.includes('BBB')); assert.ok(!out.tmp);
  // without stamps nothing is deleted
  assert.ok(merge({ watchLists: before }, { watchLists: after }).watchLists.tmp);
  // an edit newer than the delete wins
  const later = structuredClone(before); W.addSymbol(later, 'tmp', 'T2');
  const accMeta = stamped('watchLists', before, later, emptyMeta(), 5000);
  assert.ok(merge({ watchLists: later }, { watchLists: after }, accMeta, devMeta).watchLists.tmp.syms.includes('T2'));
});
test('merge: rename/recolour per field (last writer), flags per symbol', () => {
  const base = mk(), acc = structuredClone(base), dev = structuredClone(base);
  dev.default.name = 'Renamed'; dev.default.flags.BBB = '#4caf50';
  const dm = stamped('watchLists', base, dev, emptyMeta(), 2000);
  const out = merge({ watchLists: acc }, { watchLists: dev }, emptyMeta(), dm).watchLists;
  assert.equal(out.default.name, 'Renamed'); assert.equal(out.default.flags.BBB, '#4caf50'); assert.equal(out.default.flags.AAA, '#f23645');
});
test('merge: a device with only the old watchlist is upgraded and merged into an account that has lists', () => {
  const acc = mk(); W.createList(acc, 'Work', undefined, undefined, 'w');
  const out = merge({ watchLists: acc, watch: ['AAA'] }, { watch: ['AAA', 'OLDDEV'], watchFlags: { OLDDEV: '#f23645' } }).watchLists;
  assert.ok(out.w); assert.ok(out.default.syms.includes('OLDDEV') && out.default.syms.includes('BBB'));
  assert.equal(out.default.flags.OLDDEV, '#f23645');
  // neither side migrated: the legacy key keeps its own rule
  assert.deepEqual(merge({ watch: ['A'] }, { watch: ['B'] }).watch, ['A', 'B']);
  assert.equal(merge({ watch: ['A'] }, { watch: ['B'] }).watchLists, undefined);
});
test('summary and empty-device test count the new key', () => {
  const L = mk();
  assert.equal(summarize({ watchLists: L }).watch, 2);
  assert.equal(isEmptyDevice({ watchLists: L }), false);
  assert.equal(summarize({ watch: ['A', 'B'] }).watch, 2);
});
