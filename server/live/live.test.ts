import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickGranularity } from './oanda.ts';
import { pickTimeframe } from './alpaca.ts';
import { pickSpan } from './polygon.ts';
import { pickInterval } from './twelvedata.ts';

test('OANDA picks the largest native granularity that divides the timeframe', () => {
  assert.deepEqual(pickGranularity('1h'), { base: '1h', gran: 'H1' });
  assert.deepEqual(pickGranularity('90m'), { base: '30m', gran: 'M30' });
  assert.deepEqual(pickGranularity('1w'), { base: '1w', gran: 'W' });
  assert.deepEqual(pickGranularity('1M'), { base: '1M', gran: 'M' });
  assert.equal(pickGranularity('3M'), null);
});
test('Alpaca picks the largest native timeframe that divides the timeframe', () => {
  assert.deepEqual(pickTimeframe('1h'), { base: '1h', tf: '1Hour' });
  assert.deepEqual(pickTimeframe('45m'), { base: '15m', tf: '15Min' });
  assert.deepEqual(pickTimeframe('1d'), { base: '1d', tf: '1Day' });
  assert.equal(pickTimeframe('1M'), null);
});
test('Polygon and Twelve Data pick their native bar sizes', () => {
  assert.deepEqual(pickSpan('1h'), { base: '1h', mult: 1, span: 'hour' });
  assert.deepEqual(pickSpan('45m'), { base: '15m', mult: 15, span: 'minute' });
  assert.equal(pickSpan('1M'), null);
  assert.deepEqual(pickInterval('4h'), { base: '4h', interval: '4h' });
  assert.deepEqual(pickInterval('1d'), { base: '1d', interval: '1day' });
  assert.equal(pickInterval('3M'), null);
});
