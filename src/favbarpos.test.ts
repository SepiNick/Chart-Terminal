import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anchorXY, clampBox, nearestAnchor, orientFor, place, sanitize, snapAnchor, type Rect } from './favbarpos.ts';

const B: Rect = { x: 100, y: 50, w: 800, h: 500 };

test('anchors: corners and edge midpoints stay inside bounds', () => {
  assert.deepEqual(anchorXY('tl', 200, 40, B), { x: 108, y: 58 });
  assert.deepEqual(anchorXY('br', 200, 40, B), { x: 692, y: 502 });
  assert.deepEqual(anchorXY('t', 200, 40, B), { x: 400, y: 58 });
  assert.deepEqual(anchorXY('l', 40, 200, B), { x: 108, y: 200 });
});

test('snap: magnetic within 24px, nothing beyond, nearest wins', () => {
  assert.equal(snapAnchor(120, 70, 200, 40, B), 'tl');       // 12px,12px away
  assert.equal(snapAnchor(140, 90, 200, 40, B), null);       // ~45px away
  assert.equal(snapAnchor(405, 60, 200, 40, B), 't');
  assert.equal(nearestAnchor(140, 90, 200, 40, B), 'tl');
});

test('clamp: stays in bounds, oversize box pins to top-left', () => {
  assert.deepEqual(clampBox(-50, 9999, 100, 100, B), { x: 100, y: 450 });
  assert.deepEqual(clampBox(0, 0, 2000, 2000, B), { x: 100, y: 50 });
});

test('orientation: auto is vertical only on left/right edges', () => {
  assert.equal(orientFor('l', 'auto'), 'v'); assert.equal(orientFor('r', 'auto'), 'v');
  assert.equal(orientFor('t', 'auto'), 'h'); assert.equal(orientFor('br', 'auto'), 'h'); assert.equal(orientFor(null, 'auto'), 'h');
  assert.equal(orientFor('l', 'h'), 'h'); assert.equal(orientFor('t', 'v'), 'h'); assert.equal(orientFor(null, 'v'), 'v');
});

test('place: free position is clamped after the viewport shrinks (phone)', () => {
  const phone: Rect = { x: 0, y: 0, w: 360, h: 640 };
  assert.deepEqual(place({ anchor: null, x: 1500, y: 900, orient: 'auto', collapsed: false }, 120, 40, phone, phone), { x: 240, y: 600 });
});

test('sanitize: garbage from storage becomes the default dock', () => {
  assert.deepEqual(sanitize('x'), { anchor: 't', x: 0, y: 0, orient: 'auto', collapsed: false });
  assert.equal(sanitize({ anchor: 'zz', x: NaN, orient: 'q', collapsed: 1 }).anchor, 't');
  assert.equal(sanitize({ anchor: null, x: 5, y: 6 }).anchor, null);
});
