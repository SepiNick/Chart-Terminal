import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBars, ofTfName, parseOfTf } from './tfbars.ts';
import type { Print } from './model.ts';

const p = (t: number, px: number, qty = 1, buy = true): Print => ({ t, px, qty, buy });
const ohlc = (bs: { open: number; high: number; low: number; close: number }[]) => bs.map(b => [b.open, b.high, b.low, b.close]);

test('parse activity intervals', () => {
  assert.deepEqual(parseOfTf('100t'), { kind: 'T', n: 100 });
  assert.deepEqual(parseOfTf('R2.5'), { kind: 'R', n: 2.5 });
  assert.deepEqual(parseOfTf('rev5'), { kind: 'REV', n: 5 });
  assert.deepEqual(parseOfTf('D500'), { kind: 'D', n: 500 });
  for (const bad of ['5m', '1d', 'T5', 'REV1.5', 'D0', 'R', '1.5T']) assert.equal(parseOfTf(bad), null, bad);
  assert.equal(ofTfName(parseOfTf('rev05')!), 'REV5');
});

test('tick bars: N prints each, strictly increasing times inside one second', () => {
  const bs = buildBars([p(10, 1), p(10, 3), p(10, 2), p(10, 5), p(10.5, 4), p(11, 6), p(30, 7)], { kind: 'T', n: 3 });
  assert.deepEqual(ohlc(bs), [[1, 3, 1, 2], [5, 6, 4, 6], [7, 7, 7, 7]]);
  assert.deepEqual(bs.map(b => b.time), [10, 11, 30]);
  assert.deepEqual(bs.map(b => b.volume), [3, 3, 1]);
});

test('range bars never span more than the range', () => {
  const bs = buildBars([p(1, 100), p(2, 101), p(3, 102), p(4, 102.5), p(5, 101), p(6, 100.4)], { kind: 'R', n: 2 });
  assert.deepEqual(ohlc(bs), [[100, 102, 100, 102], [102.5, 102.5, 101, 101], [100.4, 100.4, 100.4, 100.4]]);
});

test('reversal bars close when price comes back N ticks from the extreme', () => {
  // tick 0.5, REV4 = 2.0 of price
  const bs = buildBars([p(1, 100), p(2, 101), p(3, 103), p(4, 102), p(5, 101), p(6, 99), p(7, 100.5), p(8, 101)], { kind: 'REV', n: 4 }, 0.5);
  assert.deepEqual(ohlc(bs), [[100, 103, 100, 102], [101, 101, 99, 100.5], [101, 101, 101, 101]]);
});

test('delta bars close once |delta| reaches the threshold; time buckets', () => {
  const bs = buildBars([p(1, 10, 2), p(2, 11, 1), p(3, 12, 1, false), p(4, 12, 1, false), p(5, 13), p(6, 9, 5)], { kind: 'D', n: 3 });
  assert.deepEqual(ohlc(bs), [[10, 11, 10, 11], [12, 13, 9, 9]]);   // +3 closes; then -1, -2, -1, +4 ≥ 3 is still the forming bar
  const tb = buildBars([p(0, 1), p(59, 2), p(60, 3), p(200, 4)], { kind: 'time', n: 60 });
  assert.deepEqual(tb.map(b => [b.time, b.close]), [[0, 2], [60, 3], [180, 4]]);
});
