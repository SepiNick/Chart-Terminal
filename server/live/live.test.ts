import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickGranularity } from './oanda.ts';
import { pickTimeframe } from './alpaca.ts';

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
