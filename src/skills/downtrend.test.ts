import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { downtrends, groups, stats, type Down } from './downtrend.ts';

const d = JSON.parse(readFileSync(new URL('./fixtures/downtrend.json', import.meta.url), 'utf8')) as { cases: { dates: string[]; c: number[]; w: number; md: number; d: [string, string, number, number][] }[]; stats: number[]; sector: Record<string, { count: number; median_days: number; mean_days: number }>; tier: Record<string, { count: number; median_days: number; mean_days: number }> };
// Golden values: downtrend-duration-analyzer's peak/trough detection, downtrend rules and statistics on ten paths.
test('downtrends and duration statistics match the original', () => {
  const all: Down[] = [];
  for (const [k, c] of d.cases.entries()) {
    const got = downtrends(c.dates, c.c, c.w, c.md);
    assert.deepEqual(got.map(x => [x.peak, x.trough, x.days, x.depth]), c.d, `path ${k}`);
    all.push(...got.map(x => ({ ...x, sym: 'X', sector: ['Tech', 'Energy', 'Finance'][k % 3], tier: ['Mega', 'Large', 'Mid', 'Small'][k % 4] })));
  }
  const s = stats(all);
  assert.deepEqual([s.n, s.median, s.mean, s.p25, s.p75, s.p90], d.stats);
  for (const [key, want] of [['sector', d.sector], ['tier', d.tier]] as const) assert.deepEqual(Object.fromEntries(groups(all, key).map(g => [g.k, { count: g.n, median_days: g.median, mean_days: g.mean }])), want);
});
