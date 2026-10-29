import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RULES, rebalance, riskCheck, sizeBudget } from './portfolio.ts';

const S = (w: Record<string, number>, budget: number, r: Partial<typeof RULES> = {}, prices?: Record<string, number>) => {
  const o = sizeBudget(w, budget, { ...RULES, ...r }, prices);
  return [o.positions.map(p => [p.sym, p.dollars]), o.invested, o.idle, o.dropped.map(d => d.sym)];
};
// Golden values: the original trader-budget size.py run on the same inputs.
test('budget sizer matches trader-budget', () => {
  assert.deepEqual(S({ AAA: 50, BBB: 30, CCC: 15, DDD: 5 }, 1000), [[['AAA', 250], ['BBB', 250], ['CCC', 250], ['DDD', 150]], 900, 0, []]);
  assert.deepEqual(S({ A: 40, B: 35, C: 25 }, 777), [[['A', 194], ['B', 194], ['C', 194]], 582, 117.3, []]);
  assert.deepEqual(S({ A: 40, B: 35, C: 25 }, 777, { maxPositionPct: 100 }), [[['A', 279], ['B', 245], ['C', 175]], 699, 0.3, []]);
  assert.deepEqual(S({ A: 70, B: 20, C: 7, D: 3 }, 2000, { maxPositionPct: 40, minOrder: 60 }), [[['A', 800], ['B', 667], ['C', 233], ['D', 100]], 1800, 0, []]);
  const whole = sizeBudget({ AAA: 50, BBB: 30, CCC: 15, DDD: 5 }, 1000, { ...RULES, fractional: false }, { AAA: 40, BBB: 33, CCC: 7.5, DDD: 12 });
  assert.deepEqual(whole.positions.map(p => [p.sym, p.dollars, p.units]).sort(), [['AAA', 240, 6], ['BBB', 231, 7], ['CCC', 247.5, 33], ['DDD', 180, 15]]);
  assert.equal(whole.invested, 898.5);
});

test('rebalance trades only beyond the band, sells first; risk check blocks what breaks a rule', () => {
  const r = rebalance([{ sym: 'A', qty: 10 }, { sym: 'B', qty: 1 }], 100, { A: 70, B: 100 }, { A: 50, B: 50 }, { ...RULES, maxPositionPct: 100 });
  assert.deepEqual(r.orders.map(o => [o.side, o.sym]), [['sell', 'A'], ['buy', 'B']]);
  assert.equal(rebalance([{ sym: 'A', qty: 4.5 }, { sym: 'B', qty: 4.5 }], 100, { A: 100, B: 100 }, { A: 50, B: 50 }, { ...RULES, maxPositionPct: 100 }).orders.length, 0);
  const acct = { cash: 1000, positions: [{ sym: 'A', qty: 1, px: 100 }] };
  const v = riskCheck([{ sym: 'B', side: 'buy', notional: 900 }, { sym: 'A', side: 'sell', qty: 2 }, { sym: 'C', side: 'buy', notional: 2 }, { sym: 'D', side: 'buy', notional: 50 }, { sym: 'D', side: 'buy', notional: 50 }], acct, { A: 100, B: 10, C: 1, D: 5 }, { ...RULES, maxOrdersPerDay: 10, allowShort: false });
  assert.deepEqual(v.map(x => x.verdict), ['BLOCK', 'BLOCK', 'BLOCK', 'PASS', 'BLOCK']);
  assert.match(v[0].reasons.join(), /buffer|cap/); assert.match(v[1].reasons.join(), /short/); assert.match(v[2].reasons.join(), /minimum/); assert.match(v[4].reasons.join(), /duplicate/);
});
