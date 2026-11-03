import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fit, residualEdge } from './residual.ts';

const d = JSON.parse(readFileSync(new URL('./fixtures/residual.json', import.meta.url), 'utf8')) as { x: number[]; z: number[]; y: number[] };
const near = (a: number, b: number, rel = 1e-6) => assert.ok(Math.abs(a - b) <= rel * Math.max(1, Math.abs(b)), `${a} vs ${b}`);
// Golden values: residual-edge-analyzer's fit_regression on the same 150 observations.
test('OLS with Newey–West errors matches the original', () => {
  const f = fit(d.y, [d.x, d.z]);
  near(f.alpha, 0.0013662256); near(f.betas[0], 0.5859867167); near(f.betas[1], 0.1566443675);
  near(f.t[0]!, 4.0515209); near(f.t[1]!, 43.96979939); near(f.t[2]!, 6.04816248);
  near(f.r2, 0.8810504501); assert.equal(f.lags, 4); near(f.residVol, 0.004061548172);
});
test('statuses: real alpha, pure beta, too few observations', () => {
  assert.equal(residualEdge(d.y, [d.x, d.z], 252, 63).status, 'RESIDUAL_EDGE');
  const noise = d.y.map((y, i) => y - 0.0008 - 0.6 * d.x[i] - 0.2 * d.z[i]), m = noise.reduce((a, b) => a + b, 0) / noise.length;
  const beta = d.x.map((x, i) => 0.9 * x + 0.3 * d.z[i] + noise[i] - m);   // no alpha at all
  assert.equal(residualEdge(beta, [d.x, d.z], 252, 63).status, 'BASELINE_EXPLAINED');
  assert.equal(residualEdge(d.y.slice(0, 40), [d.x.slice(0, 40)]).status, 'INSUFFICIENT_EVIDENCE');
});
