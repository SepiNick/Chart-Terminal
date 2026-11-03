import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { altBreadth, btcTrend, composite, dominance, drawdownVol, funding, momentum } from './regime.ts';

const d = JSON.parse(readFileSync(new URL('./fixtures/regime.json', import.meta.url), 'utf8')) as { btc: number[]; bear: number[]; alts: number[][]; dom: number[]; scores: number[] };
// Golden values: crypto-regime-analyzer's six calculators on the same synthetic series.
test('crypto regime components match the original', () => {
  const got = [btcTrend(d.btc).score, btcTrend(d.bear).score, altBreadth(d.alts).score, dominance(d.dom, true).score, dominance(d.dom, false).score, funding([0.0002, 0.00035]).score, drawdownVol(d.btc).score, drawdownVol(d.bear).score, momentum([...d.alts, d.btc]).score];
  assert.deepEqual(got, d.scores);
});
test('composite reweights missing components and fails closed', () => {
  const C = (score: number, available = true) => ({ score, available, signal: '' });
  const all = { btc_trend: C(90), alt_breadth: C(80), dominance: C(50, false), funding: C(75), drawdown_vol: C(90), momentum_thrust: C(90) };
  assert.deepEqual([composite(all).score, composite(all).zone], [Math.round(((90 * 0.25 + 80 * 0.2 + 75 * 0.15 + 90 * 0.15 + 90 * 0.1) / 0.85) * 10) / 10, 'RISK_ON']);
  assert.equal(composite({ ...all, funding: C(0, false), drawdown_vol: C(0, false) }).zone, 'UNKNOWN');
});
