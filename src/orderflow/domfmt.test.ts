import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connState, cumulative, fmtPrice, fmtSize, fmtValue, groupLabel, groupLevels, pct, stepDecimals } from './domfmt.ts';

test('fmtPrice: thousands separators, fixed decimals', () => {
  assert.equal(fmtPrice(80436, 0), '80,436');
  assert.equal(fmtPrice(1234567.891, 2), '1,234,567.89');
  assert.equal(fmtPrice(0.5, 4), '0.5000');
  assert.equal(fmtPrice(999.999, 2), '1,000.00');
  assert.equal(fmtPrice(-1234.5, 1), '-1,234.5');
  assert.equal(fmtPrice(NaN, 2), '');
});

test('fmtSize: compact K/M, consistent decimals, empty for zero', () => {
  assert.equal(fmtSize(0), '');
  assert.equal(fmtSize(0.00123), '0.0012');
  assert.equal(fmtSize(0.5), '0.500');
  assert.equal(fmtSize(9.044), '9.04');
  assert.equal(fmtSize(123.45), '123.5');
  assert.equal(fmtSize(1500), '1.50K');
  assert.equal(fmtSize(12345), '12.3K');
  assert.equal(fmtSize(2_500_000), '2.50M');
  assert.equal(fmtValue(250), '250.0');
  assert.equal(fmtValue(80436), '80,436');
  assert.equal(fmtValue(3_200_000), '3.20M');
});

test('stepDecimals and groupLabel', () => {
  assert.equal(stepDecimals(1), 0); assert.equal(stepDecimals(0.25), 2); assert.equal(stepDecimals(0.01), 2); assert.equal(stepDecimals(5), 0);
  assert.equal(groupLabel(5, 2, 2), '10.00');
  assert.equal(groupLabel(100, 0.001, 3), '0.100');
});

test('groupLevels aggregates into step bins (floor)', () => {
  const m = groupLevels([[100.2, 1], [100.9, 2], [101.0, 4], [99.99, 8]], 1);
  assert.deepEqual([...m].sort((a, b) => a[0] - b[0]), [[99, 8], [100, 3], [101, 4]]);
  // float noise at a bin edge must not drop a level into the neighbour bin
  assert.equal(groupLevels([[0.3, 1]], 0.1).get(3), 1);
});

test('cumulative sums run from the touch outward and treat gaps as zero', () => {
  const sizes = new Map([[10, 1], [9, 2], [7, 4]]);
  assert.deepEqual(cumulative([10, 9, 8, 7], sizes), [1, 3, 3, 7]);
  assert.deepEqual(cumulative([], sizes), []);
});

test('connState thresholds', () => {
  assert.equal(connState(null), 'loading');
  assert.equal(connState(500), 'live');
  assert.equal(connState(5000), 'stale');
  assert.equal(connState(20000), 'offline');
});

test('pct clamps and survives zero max', () => {
  assert.equal(pct(5, 10), 50); assert.equal(pct(5, 0), 0); assert.equal(pct(20, 10), 100); assert.equal(pct(-1, 10), 0);
});
