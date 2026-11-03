import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyzeIndex, combine, distributionDays, type Row } from './distribution.ts';

const d = JSON.parse(readFileSync(new URL('./fixtures/dd.json', import.meta.url), 'utf8')) as { h: Row[]; d: number[]; below: boolean; risk: string; dd: [string, string][] }[];
// Golden values: ibd-distribution-day-monitor's tracker, MA filter and classifier on six synthetic histories.
test('distribution days, clusters and risk match the original', () => {
  for (const [i, c] of d.entries()) {
    const a = analyzeIndex(c.h);
    assert.deepEqual([[a.d5, a.d15, a.d25], a.belowMa, a.risk], [c.d, c.below, c.risk], `history ${i}`);
    assert.deepEqual(distributionDays(c.h).map(x => [x.date, x.status]), c.dd, `history ${i}`);
  }
  assert.equal(combine('CAUTION', 'HIGH'), 'HIGH'); assert.equal(combine('NORMAL', 'CAUTION'), 'CAUTION'); assert.equal(combine('NORMAL', 'HIGH'), 'HIGH');
});
