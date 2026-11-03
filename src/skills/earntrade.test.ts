import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyzeEarnings, entryOk, type DB } from './earntrade.ts';

const d = JSON.parse(readFileSync(new URL('./fixtures/earntrade.json', import.meta.url), 'utf8')) as { p: DB[]; date: string; timing: string; want: unknown[] }[];
// Golden values: earnings-trade-analyzer's analyze_stock, composite and entry filter on 150 synthetic reports.
test('earnings reaction factors, grade and entry filter match the original', () => {
  for (const [i, c] of d.entries()) {
    const a = analyzeEarnings(c.p, c.date, c.timing);
    assert.deepEqual([a.g.pct, a.t.pct, a.v.ratio, a.m200.dist, a.m50.dist, [a.g.score, a.t.score, a.v.score, a.m200.score, a.m50.score], a.score, a.grade, entryOk(c.p[0].close, a.g.pct, a.score)], c.want, `case ${i}`);
  }
});
