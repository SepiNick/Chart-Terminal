import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { coverageGrade, dedupeClasses, ownershipMetrics, panelSummaries, type Summary } from './instflow.ts';
import type { Pos } from './copycat.ts';

const d = JSON.parse(readFileSync(new URL('./fixtures/instflow.json', import.meta.url), 'utf8')) as { m: { s: Summary; want: unknown[] | null }[]; dedupe_in: { symbol: string; market_cap: number }[]; dedupe: string[]; grades: [number, number, string][] };
// Golden values: institutional-flow-tracker's calculate_ownership_metrics, coverage_grade and share-class de-duplication.
test('ownership metrics, grade and de-duplication match the original', () => {
  for (const [i, c] of d.m.entries()) { const m = ownershipMetrics(c.s); assert.deepEqual(m && [m.current_total_shares, m.previous_total_shares, m.shares_change, m.percent_change, m.current_institution_count, m.previous_institution_count, m.institution_count_change, m.buyers, m.sellers, m.unchanged, m.new_positions, m.closed_positions, m.reliability_grade], c.want, `summary ${i}`) }
  assert.deepEqual(dedupeClasses(d.dedupe_in).map(x => x.symbol), d.dedupe);
  for (const [a, b, g] of d.grades) assert.equal(coverageGrade(a, b), g);
});
test('panel summaries count holders, buyers, sellers, new and closed positions', () => {
  const p = (cusip: string, shares: number, put_call = ''): Pos => ({ issuer: cusip, title: 'COM', cusip, value: shares, shares, share_type: 'SH', put_call, rows: 1, pct: 0, cusips: [cusip], ticker: cusip });
  const s = panelSummaries([{ name: 'A', now: [p('X', 10), p('Y', 5), p('Z', 1, 'PUT')], prev: [p('X', 8), p('W', 3)] }, { name: 'B', now: [p('X', 4)], prev: [p('X', 6), p('Y', 2)] }]);
  assert.deepEqual(s.get('X')!.s, { investorsHolding: 2, lastInvestorsHolding: 2, numberOf13Fshares: 14, lastNumberOf13Fshares: 14, increasedPositions: 1, reducedPositions: 1, newPositions: 0, closedPositions: 0 });
  assert.deepEqual(s.get('Y')!.s, { investorsHolding: 1, lastInvestorsHolding: 1, numberOf13Fshares: 5, lastNumberOf13Fshares: 2, increasedPositions: 0, reducedPositions: 0, newPositions: 1, closedPositions: 1 });
  assert.equal(s.has('Z'), false); assert.equal(s.get('W')!.s.closedPositions, 1);
});
