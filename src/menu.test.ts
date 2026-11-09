import { test } from 'node:test';
import assert from 'node:assert/strict';
import { place } from './menuplace.ts';

const inside = (p: { left: number; top: number; maxH: number }, w: number, h: number, vw: number, vh: number) => {
  assert.ok(p.left >= 4 && p.top >= 4, 'not off the top/left');
  assert.ok(p.left + w <= vw - 4 || w > vw - 8, 'not off the right');
  assert.ok(p.top + Math.min(h, p.maxH) <= vh - 4, 'not off the bottom');
};
test('menus and submenus stay inside the window and never cover their parent row when avoidable', () => {
  for (const vw of [392, 700, 1400]) for (const vh of [300, 800]) for (const w of [180, 240]) for (const h of [120, 650]) for (const x of [0, 150, vw - 20]) {
    inside(place(x, 10, w, h, vw, vh), w, h, vw, vh);
    const a = { left: Math.max(0, x - 240), bottom: 40 }, p = place(x, 20, w, h, vw, vh, a);
    inside(p, w, h, vw, vh);
    if (x + w <= vw - 4) assert.equal(p.left, Math.max(4, x), 'room on the right: beside the parent');
    else if (a.left - w >= 4) assert.equal(p.left + w, a.left, 'room on the left: beside the parent, not over it');
    else assert.ok(p.top >= a.bottom || p.top === Math.max(4, vh - Math.min(h, vh - 8) - 4), 'no room either side: under the parent row');
  }
});
