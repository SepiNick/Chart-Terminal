import test from 'node:test';
import assert from 'node:assert/strict';
import { clampRect, centered, displayFor, restoreRect, reflow, placeOn, snapshot, type Display } from './winplace.ts';

const A: Display = { id: 1, primary: true, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 } };
const B: Display = { id: 2, bounds: { x: 1920, y: 0, width: 2560, height: 1440 } };
const C: Display = { id: 3, bounds: { x: -1280, y: 100, width: 1280, height: 1024 } };

test('clampRect keeps a window inside the box and shrinks it when too big', () => {
  assert.deepEqual(clampRect({ x: 1800, y: 1000, width: 400, height: 300 }, A.workArea!), { x: 1520, y: 740, width: 400, height: 300 });
  assert.deepEqual(clampRect({ x: -50, y: -50, width: 5000, height: 5000 }, A.workArea!), { x: 0, y: 0, width: 1920, height: 1040 });
  assert.equal(clampRect({ x: 0, y: 0, width: 10, height: 10 }, A.bounds).width, 320);   // minimum size
});
test('centered and placeOn stay on the display', () => {
  assert.deepEqual(centered({ width: 1000, height: 600 }, B.bounds), { x: 1920 + 780, y: 420, width: 1000, height: 600 });
  const r = placeOn(B, { width: 1000, height: 700 }, 3);
  assert.ok(r.x >= B.bounds.x && r.x + r.width <= B.bounds.x + B.bounds.width);
});
test('displayFor picks the largest overlap, else the nearest', () => {
  assert.equal(displayFor({ x: 1800, y: 0, width: 400, height: 300 }, [A, B])?.id, 2);   // 120 px on A, 280 px on B
  assert.equal(displayFor({ x: 5000, y: 0, width: 400, height: 300 }, [A, B])?.id, 2);   // off every screen: nearest
  assert.equal(displayFor({ x: -3000, y: 0, width: 400, height: 300 }, [A, B, C])?.id, 3);
  assert.equal(displayFor({ x: 0, y: 0, width: 10, height: 10 }, []), undefined);
});
test('restoreRect: saved display present keeps position (clamped to its work area)', () => {
  const r = restoreRect({ displayId: 2, rect: { x: 2000, y: 100, width: 800, height: 600 } }, [A, B]);
  assert.deepEqual(r, { rect: { x: 2000, y: 100, width: 800, height: 600 }, displayId: 2, moved: false });
  const small: Display = { ...B, bounds: { x: 1920, y: 0, width: 1280, height: 720 } };   // the display got smaller: the window is pulled back in
  const r2 = restoreRect({ displayId: 2, rect: { x: 3000, y: 500, width: 800, height: 600 } }, [A, small]);
  assert.ok(r2.rect.x + r2.rect.width <= 3200 && r2.rect.y + r2.rect.height <= 720 && !r2.moved);
});
test('restoreRect: display unplugged moves the window to the primary display', () => {
  const r = restoreRect({ displayId: 2, rect: { x: 2000, y: 100, width: 800, height: 600 } }, [A]);
  assert.equal(r.displayId, 1); assert.equal(r.moved, true);
  assert.deepEqual(r.rect, { x: 560, y: 220, width: 800, height: 600 });
});
test('restoreRect: no saved state, no saved display id, no displays', () => {
  assert.equal(restoreRect(undefined, [A, B]).displayId, 1);
  const k = restoreRect({ displayId: null, rect: { x: 2100, y: 50, width: 700, height: 500 } }, [A, B]);
  assert.equal(k.displayId, 2); assert.equal(k.moved, false);
  const off = restoreRect({ displayId: null, rect: { x: 9000, y: 9000, width: 700, height: 500 } }, [A, B]);
  assert.ok(off.rect.x + 700 <= 4480 || off.moved);
  assert.deepEqual(restoreRect({ displayId: 1, rect: { x: 1, y: 2, width: 300, height: 300 } }, []).rect, { x: 1, y: 2, width: 300, height: 300 });
});
test('restoreRect ignores garbage numbers', () => {
  const r = restoreRect({ displayId: 1, rect: { x: NaN, y: 'a' as unknown as number, width: Infinity, height: 400 } }, [A]);
  assert.ok(Number.isFinite(r.rect.x) && Number.isFinite(r.rect.width));
});
test('snapshot records the display; reflow handles a whole set', () => {
  const s = snapshot({ x: 2000, y: 10, width: 600, height: 400 }, [A, B]);
  assert.equal(s.displayId, 2);
  const out = reflow({ a: s, b: { displayId: 1, rect: { x: 10, y: 10, width: 500, height: 400 } } }, [A]);
  assert.equal(out.a.moved, true); assert.equal(out.b.moved, false);
});
