import { test } from 'node:test';
import assert from 'node:assert/strict';
import { volumeProfile, anchoredVwap } from './volume.ts';

const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
const bar = (open: number, high: number, low: number, close: number, volume: number) => ({ time: 0, open, high, low, close, volume });

test('volume is spread uniformly over high-low and split up/down', () => {
  // range 0..10, 10 rows of 1. Up bar 0..10 vol 100 -> 10/row. Down bar 2..4 vol 40 -> 20 in rows 2,3.
  const p = volumeProfile([bar(1, 10, 0, 9, 100), bar(4, 4, 2, 2, 40)], 10)!;
  assert.equal(p.rows, 10); near(p.step, 1); near(p.lo, 0);
  p.up.forEach(v => near(v, 10));
  assert.deepEqual(p.down, [0, 0, 20, 20, 0, 0, 0, 0, 0, 0]);
  near(p.sum, 140);
  assert.equal(p.poc, 2); // rows 2 and 3 tie at 30; first wins
});

test('value area expands from POC toward heavier neighbours until vaPct', () => {
  // rows (step 1): totals 1,2,3,10,4,1 (built from flat bars at row midpoints) + bounds
  const vols = [1, 2, 3, 10, 4, 1];
  const bars = vols.map((v, i) => bar(i + 0.5, i + 0.5, i + 0.5, i + 0.5, v));
  bars.push(bar(0, 0, 0, 0, 0), bar(6, 6, 6, 6, 0)); // pin range to 0..6
  const p = volumeProfile(bars, 6, 0.7)!;
  assert.deepEqual(p.total, vols);
  assert.equal(p.poc, 3);
  // 21 total, need 14.7: 10 -> +4 (above, 14) -> +3 (below, 17)
  assert.equal(p.vaHi, 4); assert.equal(p.vaLo, 2);
});

test('degenerate inputs: empty, flat range, zero volume', () => {
  assert.equal(volumeProfile([]), null);
  const p = volumeProfile([bar(5, 5, 5, 5, 7), bar(5, 5, 5, 5, 3)], 24)!;
  assert.equal(p.rows, 1); assert.deepEqual(p.up, [10]); assert.equal(p.poc, 0);
  const z = volumeProfile([bar(1, 2, 0, 1, 0)], 4)!;
  assert.equal(z.sum, 0); assert.equal(z.vaLo, 0); assert.equal(z.vaHi, 0);
});

test('anchored VWAP and std dev', () => {
  const r = anchoredVwap([bar(0, 12, 9, 9, 1), bar(0, 21, 21, 21, 3), bar(0, 1, 1, 1, 0)]);
  near(r[0].v, 10); near(r[0].sd, 0);
  near(r[1].v, (10 + 63) / 4); near(r[1].sd, Math.sqrt((100 + 3 * 441) / 4 - (73 / 4) ** 2));
  near(r[2].v, r[1].v);
  assert.deepEqual(anchoredVwap([bar(0, 3, 0, 3, 0)]), [{ v: 2, sd: 0 }]);
});
