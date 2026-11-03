import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planBreakout } from './breakout.ts';

const base = { pivot: 50, low: 46.2, price: 49, score: 85, breakoutVolume: false, account: 100_000, riskPct: 0.5, maxPositionPct: 10, maxSectorPct: 30, sectorExposure: 0, heatPct: 0, maxHeatPct: 6, targetR: 2, stopBufferPct: 1, maxChasePct: 2, pivotBufferPct: 0.1, maxRiskPct: 12 };
// Golden values: breakout-trade-planner's risk_calculator.py on the same setup.
test('breakout plan matches the original numbers', () => {
  const r = planBreakout(base);
  assert.deepEqual([r.entry, r.worst, r.stop, r.riskSignal, r.riskWorst, r.target], [50.05, 51, 45.74, 8.61, 10.31, 58.67]);
  assert.deepEqual([r.shares, Math.round(r.riskDollars * 100) / 100, r.state], [95, 499.7, 'ACTIONABLE']);
  const t = planBreakout({ ...base, score: 93, sectorExposure: 25 });
  assert.deepEqual([t.shares, Math.round(t.riskDollars * 100) / 100, t.binding], [98, 515.48, 'Max sector 30%']);
  assert.equal(planBreakout({ ...base, maxRiskPct: 8 }).state, 'REJECTED', 'risk at the worst entry 10.31% > 8%');
  assert.equal(planBreakout({ ...base, score: 65 }).state, 'REJECTED');
  assert.equal(planBreakout({ ...base, price: 50.5, breakoutVolume: true }).state, 'REVALIDATE');
  assert.equal(planBreakout({ ...base, price: 50.5 }).state, 'REJECTED', 'no breakout volume');
  assert.equal(planBreakout({ ...base, heatPct: 5.8 }).state, 'CONSTRAINED');
});
