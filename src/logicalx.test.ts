import { test } from 'node:test';
import assert from 'node:assert/strict';
import { logicalX } from './logicalx.ts';

// A scale that behaves like the library: 6 px per bar, bar 0 at x = -100, and 0 for any fractional index.
const quirky = { logicalToCoordinate: (l: number) => (Number.isInteger(l) ? -100 + l * 6 : 0) };

test('whole bars are passed straight through', () => assert.equal(logicalX(quirky, 10), -40));
test('a fractional index lands between its neighbours instead of at 0', () => {
  assert.equal(logicalX(quirky, 10.5), -37);
  assert.equal(logicalX(quirky, 961.75), -100 + 961.75 * 6);
  assert.equal(logicalX(quirky, -3.25), -100 - 3.25 * 6, 'before the first bar');
});
test('unknown neighbours fall back to the spacing of bars 0 and 1; junk gives null', () => {
  const partial = { logicalToCoordinate: (l: number) => (l === 0 ? 0 : l === 1 ? 5 : null) };
  assert.equal(logicalX(partial, 40.5), 202.5);
  assert.equal(logicalX(quirky, NaN), null);
  assert.equal(logicalX({ logicalToCoordinate: () => null }, 3.5), null);
});
