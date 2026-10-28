import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sizeQty, quoteBalance } from './sizing.ts';

const base = { price: 100, available: 5000, equity: 10000 };

test('sizing modes', () => {
  assert.deepEqual(sizeQty({ ...base, mode: 'units', value: 0.5 }), { qty: 0.5 });
  assert.deepEqual(sizeQty({ ...base, mode: 'quote', value: 250 }), { qty: 2.5 });
  assert.deepEqual(sizeQty({ ...base, mode: 'pct', value: 10 }), { qty: 5 });              // 500 of 5000 at 100
  assert.deepEqual(sizeQty({ ...base, mode: 'risk', value: 1, sl: 95 }), { qty: 20 });     // risk 100 over a 5 stop
  assert.deepEqual(sizeQty({ ...base, mode: 'risk', value: 1, sl: 105 }), { qty: 20 });    // shorts too
  assert.deepEqual(sizeQty({ ...base, mode: 'quote', value: 100, price: 3, step: 0.01 }), { qty: 33.33 });
});

test('sizing errors', () => {
  assert.match(sizeQty({ ...base, mode: 'risk', value: 1 }).error!, /stop-loss/);
  assert.match(sizeQty({ ...base, mode: 'risk', value: 1, sl: 100 }).error!, /entry/);
  assert.match(sizeQty({ ...base, mode: 'units', value: 0 }).error!, /positive/);
  assert.match(sizeQty({ ...base, mode: 'quote', value: 10, price: 0 }).error!, /price/);
  assert.match(sizeQty({ ...base, mode: 'units', value: 0.004, step: 0.01 }).error!, /0/);
});

test('quote balance', () => {
  const b = [{ asset: 'BTC', free: 1, locked: 0 }, { asset: 'USDT', free: 50, locked: 0 }];
  assert.equal(quoteBalance('BTCUSDT', b)?.asset, 'USDT');
  assert.equal(quoteBalance('BYBIT:ETH_USDT.P', b)?.asset, 'USDT');
  assert.equal(quoteBalance('ETHBTC', b)?.asset, 'BTC');
  assert.equal(quoteBalance('XYZ', [])?.asset, undefined);
});
