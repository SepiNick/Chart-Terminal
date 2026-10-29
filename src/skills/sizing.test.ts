import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sizePosition } from './sizing.ts';

// Golden values from position-sizer's own tests (scripts/tests/test_position_sizer.py).
test('position sizer matches the original skill', () => {
  const ff = sizePosition({ account: 100_000, entry: 155, stop: 148.5, riskPct: 1 });
  assert.equal(ff.riskBudget, 1000); assert.ok(Math.abs(ff.riskPerUnit! - 6.5) < 1e-9); assert.equal(ff.qty, 153);
  assert.equal(sizePosition({ account: 100_000, entry: 2.5, stop: 2.35, riskPct: 0.25 }).qty, 1666);
  const atr = sizePosition({ account: 100_000, entry: 155, riskPct: 1, atr: 3.2, atrMult: 2 });
  assert.ok(Math.abs(atr.stop! - 148.6) < 1e-9); assert.equal(atr.qty, 156);
  const k = sizePosition({ account: 100_000, entry: 100, winRate: 55, avgWin: 2.5, avgLoss: 1 });
  assert.ok(Math.abs(k.kellyPct! - 37) < 1e-9); assert.ok(Math.abs(k.halfKellyPct! - 18.5) < 1e-9);
  assert.equal(sizePosition({ account: 100_000, entry: 100, winRate: 30, avgWin: 1, avgLoss: 1 }).kellyPct, 0, 'negative expectancy floors at 0');
  assert.equal(sizePosition({ account: 100_000, entry: 155, stop: 148.5, riskPct: 1, maxPositionPct: 10 }).qty, 64);
  const sec = sizePosition({ account: 100_000, entry: 155, stop: 148.5, riskPct: 1, maxSectorPct: 30, sectorExposure: 22 });
  assert.equal(sec.qty, 51); assert.equal(sec.binding, 'Max sector 30%');
  assert.throws(() => sizePosition({ account: 1000, entry: 10, stop: 11 }), /below the entry/);
});

test('futures sizer matches futures-position-sizer', async () => {
  const { sizeFutures } = await import('./sizing.ts');
  const es = sizeFutures({ symbol: 'ES', long: true, entry: 5000, stop: 4980, account: 100_000, riskPct: 1 });
  assert.deepEqual([es.ticks, es.rpc, es.budget, es.contracts, es.totalRisk], [80, 1000, 1000, 1, 1000]);
  const gc = sizeFutures({ symbol: 'GC', long: false, entry: 2400, stop: 2412.5, account: 50_000, riskPct: 0.5 });
  assert.deepEqual([gc.ticks, gc.rpc, gc.budget, gc.contracts], [125, 1250, 250, 0]);
  assert.deepEqual([sizeFutures({ symbol: 'BT', long: true, entry: 60000, stop: 58000, account: 250_000, riskPct: 2 }).contracts], [0]);
  const nq = sizeFutures({ symbol: 'NQ', long: true, entry: 20000, stop: 19990, account: 100_000, riskPct: 1, maxContracts: 3 });
  assert.deepEqual([nq.rpc, nq.contracts, nq.totalRisk, nq.capped], [200, 3, 600, true]);
  assert.throws(() => sizeFutures({ symbol: 'ES', long: true, entry: 5000.1, stop: 4980, account: 1e5, riskPct: 1 }), /tick grid/);
});
