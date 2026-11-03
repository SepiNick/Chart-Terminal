import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STUDY_DEFAULTS, backfill, cohorts, detect, type Bar, type Event } from './study20.ts';

const d = JSON.parse(readFileSync(new URL('./fixtures/study20.json', import.meta.url), 'utf8')) as { prices: Record<string, Bar[]>; n: number; events: unknown[][]; today: unknown[][]; cohorts: unknown[][]; rules: [string[], string][] };
const view = (e: Event) => [e.id, e.episode, e.dayIndex, e.pattern, e.closeQuality, e.extension, e.baseLen, e.flags, { continuation_quality_score: e.scores.continuation, reversal_risk_score: e.scores.reversal, study_priority_score: e.scores.priority, data_quality_score: e.scores.dataQuality }, e.labels,
  { stockbee_episodic_pivot: e.handoffs.stockbee_episodic_pivot, pead_screener: e.handoffs.pead_screener, theme_detector: e.handoffs.theme_detector, edge_candidate_agent: e.handoffs.edge_candidate_agent, parabolic_short_watch: e.handoffs.parabolic_short_watch },
  Object.fromEntries(Object.entries(e.outcomes).map(([k, o]) => [k, o?.status === 'MATURED' ? o.tag : o?.status ?? null]))];
// Golden values: stockbee-20pct-study's scan, 120-session backfill (episodes, upsert), forward outcomes and cohorts.
test('20% study events, outcomes and cohorts match the original', () => {
  const o = { ...STUDY_DEFAULTS, down: true }, past = backfill(d.prices, d.n, o);
  assert.deepEqual(past.map(view), d.events);
  assert.deepEqual(detect(d.prices, null, o).map(view), d.today);
  const co = cohorts(past, 3);
  assert.deepEqual(co.map(c => [c.group, c.n, c.win, c.med, c.mae, Object.fromEntries(Object.entries(c.tags).sort())]), d.cohorts);
  assert.deepEqual(co.filter(c => c.rule).map(c => [c.group, c.rule]), d.rules);
});
