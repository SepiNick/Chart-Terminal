import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newAccount, placeOrder, onPrice, closePosition, equity } from './trading.ts';

const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);

test('market round trip realizes PnL minus fees', () => {
  const a = newAccount(1000);
  placeOrder(a, { sym: 'X', side: 'buy', type: 'market', qty: 2 }, 100, 0);
  closePosition(a, 'X', 110, 1);
  near(a.cash, 1000 + 20 - 0.2 - 0.22);
  assert.deepEqual(a.pos, {});
});

test('limit and stop trigger on the correct side', () => {
  const a = newAccount();
  assert.equal(placeOrder(a, { sym: 'X', side: 'buy', type: 'limit', qty: 1, price: 105 }, 100, 0)?.includes('below'), true);
  placeOrder(a, { sym: 'X', side: 'buy', type: 'limit', qty: 1, price: 95 }, 100, 0);
  placeOrder(a, { sym: 'X', side: 'buy', type: 'stop', qty: 1, price: 110 }, 100, 0);
  assert.equal(onPrice(a, 'X', 99, 1).length, 0);
  const f = onPrice(a, 'X', 94, 2);
  assert.equal(f.length, 1); near(f[0].px, 94); // limit filled at better price on a gap
  assert.equal(onPrice(a, 'X', 112, 3)[0].px, 112); // stop slips to market
  assert.equal(a.pos.X.qty, 2);
});

test('bracket: take-profit fill cancels the stop-loss (OCO)', () => {
  const a = newAccount(1000);
  placeOrder(a, { sym: 'X', side: 'buy', type: 'market', qty: 1, tp: 120, sl: 90 }, 100, 0);
  assert.equal(a.orders.length, 2);
  onPrice(a, 'X', 120, 1);
  assert.equal(a.orders.length, 0);
  assert.deepEqual(a.pos, {});
  near(a.cash, 1000 + 20 - 0.1 - 0.12);
});

test('short flip and equity', () => {
  const a = newAccount(1000);
  placeOrder(a, { sym: 'X', side: 'buy', type: 'market', qty: 1 }, 100, 0);
  placeOrder(a, { sym: 'X', side: 'sell', type: 'market', qty: 3 }, 100, 1);
  assert.equal(a.pos.X.qty, -2); near(a.pos.X.avg, 100);
  near(equity(a, { X: 90 }).unrealized, 20);
});
