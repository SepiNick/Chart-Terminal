import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cohorts, replay } from './fluency.ts';
import type { B } from './burst.ts';

const d = JSON.parse(readFileSync(new URL('./fixtures/fluency.json', import.meta.url), 'utf8')) as { data: Record<string, B[]>; recs: unknown[][]; groups: Record<string, unknown[][]>; rules: string[][] };
// Golden values: the burst screen replayed over 61 sessions of 30 stocks, then stockbee-setup-fluency-trainer's
// make_record, 3/5-day outcomes and model-book cohorts.
test('model book records, outcomes and cohorts match the original', () => {
  const recs = Object.entries(d.data).flatMap(([s, asc]) => replay(s, [...asc].reverse(), 60));
  assert.deepEqual(recs.map(r => [r.id, r.tags, r.rating, r.score, r.entry, r.stop, r.overall, Object.fromEntries(Object.entries(r.outcomes).map(([h, o]) => [h, [o.fwd ?? null, o.stopHit ?? null, o.tag ?? null]]))]), d.recs);
  const row = (c: ReturnType<typeof cohorts>[number]) => [c.group, c.n, c.win, c.fail, c.strong, c.stop, c.avg3, c.avg5, c.med5, c.mfe5, c.mae5];
  const by = { rating: 'rating', primary_trigger: 'trigger', setup_tags: 'tags' } as const, rules: string[][] = [];
  for (const [k, f] of Object.entries(by)) { const co = cohorts(recs, f); assert.deepEqual(co.map(row), d.groups[k], k); for (const c of co) if (c.action) rules.push([c.action, k, c.group]) }
  assert.deepEqual(rules.sort(), [...d.rules].sort());
});
