import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { adf, ncdf, screenPairs, type Series } from './pairs.ts';

const d = JSON.parse(readFileSync(new URL('./fixtures/pairs.json', import.meta.url), 'utf8')) as { data: Record<string, Record<string, number>>; pairs: unknown[][]; adf: { x: number[]; want: [number, number, number, number, number[]] }[] };
const near = (a: number, b: number, tol: number, msg: string) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
// Golden values: statsmodels adfuller (maxlag 1, AIC) on 30 AR series, and pair-trade-screener's screen + rank on 18 stocks.
test('ADF statistic, p-value, lag and critical values match statsmodels', () => {
  for (const [i, c] of d.adf.entries()) {
    const r = adf(c.x);
    near(r.stat, c.want[0], 1e-8, `stat ${i}`); near(r.p, c.want[1], 1e-9, `p ${i}`);
    assert.deepEqual([r.lag, r.nobs], [c.want[2], c.want[3]], `lag ${i}`);
    r.crit.forEach((x, k) => near(x, c.want[4][k], 1e-9, `crit ${i}`));
  }
  near(ncdf(-1.96), 0.024997895148220435, 1e-14, 'ncdf'); near(ncdf(4.5), 0.9999966023268753, 1e-14, 'ncdf tail');
});
test('cointegrated pairs and ranking match the original', () => {
  const data = new Map<string, Series>(Object.entries(d.data).map(([s, m]) => [s, new Map(Object.entries(m))]));
  assert.deepEqual(screenPairs(data).map(p => [p.pair, p.corr, p.beta, p.p, p.stat, p.crit5, p.halfLife, p.z, p.signal, p.strength]), d.pairs);
});
