import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeStrategy, bs, histVol } from './options.ts';

const near = (a: number, b: number, tol = 1e-5) => assert.ok(Math.abs(a - b) < tol, `${a} vs ${b}`);
test('Black-Scholes prices and Greeks (reference: exact erf in Python)', () => {
  const p = { S: 100, K: 105, T: 0.25, r: 0.05, sigma: 0.3, q: 0.01 }, c = bs(p, 'call'), u = bs(p, 'put');
  near(c.price, 4.310674); near(u.price, 8.25603); near(c.delta, 0.426097); near(c.gamma, 0.026086); near(c.vega, 0.195648); near(c.theta, -0.03624);
  near(c.price - u.price, 100 * Math.exp(-0.01 * 0.25) - 105 * Math.exp(-0.05 * 0.25), 1e-6);   // put-call parity
});
test('strategies: max profit/loss and breakevens', () => {
  const s = analyzeStrategy('Bull call spread', [100, 110], { S: 100, T: 0.25, r: 0.05, sigma: 0.3 });
  near(s.maxProfit, 1000 - s.cost, 1e-6); near(s.maxLoss, -s.cost, 1e-6); near(s.breakevens[0], 100 + s.cost / 100, 1e-6);
  assert.equal(analyzeStrategy('Long call', [100], { S: 100, T: 0.25, r: 0.05, sigma: 0.3 }).maxProfit, Infinity);
  const ic = analyzeStrategy('Iron condor', [80, 90, 110, 120], { S: 100, T: 0.25, r: 0.05, sigma: 0.3 });
  assert.ok(ic.cost < 0, 'credit'); assert.equal(ic.breakevens.length, 2); near(ic.maxLoss, -(1000 + ic.cost), 1e-6);
  assert.throws(() => analyzeStrategy('Iron condor', [80, 90], { S: 100, T: 0.25, r: 0.05, sigma: 0.3 }), /needs 4 strikes/);
  near(histVol([100, 101, 100, 101, 100], 30, 252), Math.sqrt(252) * 0.0115, 0.001);
});
