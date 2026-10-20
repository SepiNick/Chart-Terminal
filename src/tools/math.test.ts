import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liquidationPrice, positionSize, stepDecimals, nearestOHLC } from './math.ts';

const near = (a: number | null, b: number, eps = 1e-9) => assert.ok(a != null && Math.abs(a - b) < eps, `${a} != ${b}`);

test('isolated liquidation price', () => {
  near(liquidationPrice(100, 10, 0, 1), 90);                 // 10x long, no maintenance: −10%
  near(liquidationPrice(100, 10, 0, -1), 110);
  near(liquidationPrice(100, 10, 0.005, 1), 90 / 0.995);     // maintenance margin pulls it closer
  near(liquidationPrice(100, 10, 0.005, -1), 110 / 1.005);
  assert.equal(liquidationPrice(100, 1, 0, 1), null);        // 1x long cannot be liquidated
  near(liquidationPrice(100, 1, 0, -1), 200);
  assert.equal(liquidationPrice(0, 10, 0, 1), null);
});

test('size from percent risk, lot step, margin and R:R', () => {
  const r = positionSize({ entry: 100, stop: 95, target: 110, dir: 1, account: 1000, riskMode: '%', risk: 1, leverage: 5, lotStep: 0.3, mmr: 0 });
  near(r.riskAmt, 10);
  near(r.qty, 1.8);             // 10 / 5 = 2 → floor to 0.3 steps
  near(r.loss, 9); near(r.reward, 18); near(r.rr, 2);
  near(r.notional, 180); near(r.margin, 36);
  near(r.liq, 80); assert.equal(r.liqFirst, false); assert.equal(r.overMargin, false);
});

test('amount risk, short, liquidation before stop, margin over account', () => {
  const r = positionSize({ entry: 100, stop: 130, target: 70, dir: -1, account: 100, riskMode: 'amount', risk: 300, leverage: 5, lotStep: 0, mmr: 0 });
  near(r.qty, 10); near(r.notional, 1000); near(r.margin, 200);
  near(r.liq, 120); assert.equal(r.liqFirst, true); assert.equal(r.overMargin, true);
  assert.equal(positionSize({ entry: 100, stop: 100, target: 110, dir: 1, account: 1000, riskMode: '%', risk: 1, leverage: 1, lotStep: 0, mmr: 0 }).qty, 0);
});

test('lot step decimals and exact multiples', () => {
  assert.equal(stepDecimals(0.001), 3); assert.equal(stepDecimals(1), 0); assert.equal(stepDecimals(0.5), 1); assert.equal(stepDecimals(0), 0);
  near(positionSize({ entry: 10, stop: 9, target: 12, dir: 1, account: 100, riskMode: 'amount', risk: 0.3, leverage: 1, lotStep: 0.1, mmr: 0 }).qty, 0.3);
});

test('nearest OHLC snapping', () => {
  const b = { open: 10, high: 15, low: 5, close: 12 };
  assert.equal(nearestOHLC(b, 14), 15);
  assert.equal(nearestOHLC(b, 11.2), 12);
  assert.equal(nearestOHLC(b, 0), 5);
  assert.equal(nearestOHLC(b, 148, p => 200 - p * 10), 5);   // compared in screen space (y grows downward)
});
