import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextId, expandGroups, rectSelect, hitRadius, applyStyle, freshCopies, offsetCopies, movable, moveGroup, lockAxis, AUTO_GROUP, HTF_GROUP } from './select.ts';
import type { Drawing } from './types.ts';

const mk = (id: number, group?: string): Drawing => ({ id, type: 'trend', pts: [], style: { color: '#fff', width: 1 } as Drawing['style'], ...(group ? { group } : {}) });

test('nextId is an integer above all ids, including legacy floats', () => {
  assert.equal(nextId([], 1000), 1000);
  assert.equal(nextId([{ id: 5000.73 }, { id: 10 }], 1000), 5001);
  const ids = [{ id: 2000 }]; const a = nextId(ids, 1000); ids.push({ id: a });
  assert.equal(nextId(ids, 1000), 2002);
});

test('expandGroups pulls in group mates only', () => {
  const a = mk(1, 'g'), b = mk(2, 'g'), c = mk(3), d = mk(4, 'h');
  assert.deepEqual(expandGroups([a], [a, b, c, d]).map(x => x.id), [1, 2]);
  assert.deepEqual(expandGroups([c], [a, b, c, d]).map(x => x.id), [3]);
});

test('rectSelect picks drawings with an anchor inside, any drag direction', () => {
  const items = [{ d: 'in', pts: [[10, 10], [500, 500]] as [number, number][] }, { d: 'out', pts: [[300, 300]] as [number, number][] }];
  assert.deepEqual(rectSelect(items, [20, 20], [0, 0]), ['in']);
  assert.deepEqual(rectSelect(items, [0, 0], [10, 10]), ['in']);
});

test('hitRadius is bigger on coarse pointers', () => {
  assert.ok(hitRadius(true).handle > hitRadius(false).handle && hitRadius(true).stroke > hitRadius(false).stroke);
});

test('applyStyle patches every drawing', () => {
  const ds = [mk(1), mk(2)]; applyStyle(ds, { width: 4 });
  assert.deepEqual(ds.map(d => d.style.width), [4, 4]);
});

test('expandGroups never expands the auto-analysis groups', () => {
  const a = mk(1, AUTO_GROUP), b = mk(2, AUTO_GROUP), c = mk(3, HTF_GROUP), d = mk(4, HTF_GROUP);
  assert.deepEqual(expandGroups([a], [a, b, c, d]).map(x => x.id), [1]);
  assert.deepEqual(expandGroups([c], [a, b, c, d]).map(x => x.id), [3]);
});

test('freshCopies: unique integer ids, unlocked, no shared group; sources untouched', () => {
  const a = { ...mk(5000.5, 'G'), locked: true }, b = mk(7, 'G');
  const out = freshCopies([a, b], [a, b]);
  const ids = out.map(c => c.id);
  assert.ok(ids.every(Number.isInteger) && new Set([...ids, a.id, b.id]).size === 4 && ids.every(i => i > 5000.5));
  assert.ok(out.every(c => !c.locked && c.group === undefined));
  assert.equal(a.locked, true); assert.equal(a.group, 'G');
});

test('offsetCopies shifts by bars but leaves screen-anchored drawings', () => {
  const g = { timeAt: (l: number) => l * 60, logical: (t: number) => t / 60 };
  const x = { ...mk(1), pts: [{ t: 600, p: 5 }] }, y = { ...mk(2), type: 'note', pts: [{ t: 600, p: 5 }] };
  offsetCopies([x, y], 3, g, t => t === 'note');
  assert.deepEqual(x.pts, [{ t: 780, p: 5 }]);
  assert.deepEqual(y.pts, [{ t: 600, p: 5 }]);
});

test('group move: locked stay put, other-pane members get dy=0, Shift locks the axis', () => {
  const a = mk(1), b = mk(2), lk = { ...mk(3), locked: true };
  [a, b, lk].forEach(d => (d.pts = [{ t: 10, p: 100 }]));
  const origs = movable([a, b, lk]);
  assert.deepEqual([...origs.keys()], [a, b]);
  const shift = (_d: Drawing, p: { t: number; p: number }, dx: number, dy: number) => ({ t: p.t + dx, p: p.p + dy });
  const [dx, dy] = lockAxis(5, 2, false);
  const m = moveGroup(origs, dx, dy, shift, d => d === a);
  assert.deepEqual(m.get(a), [{ t: 15, p: 102 }]);
  assert.deepEqual(m.get(b), [{ t: 15, p: 100 }]);
  assert.equal(m.has(lk), false);
  assert.deepEqual(lockAxis(5, 2, true), [5, 0]);
  assert.deepEqual(lockAxis(1, -4, true), [0, -4]);
  assert.equal(a.pts[0].t, 10);   // originals not mutated
});
