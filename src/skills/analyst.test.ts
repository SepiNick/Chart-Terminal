import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyse, changes, type Facts } from './secfacts.ts';

const d = JSON.parse(readFileSync(new URL('./fixtures/analyst.json', import.meta.url), 'utf8')) as { cf: Facts; rows: unknown[]; ttm: unknown; concepts: unknown; changes: string[] }[];
// Golden values: trader-analyst's facts.analyse and changes() on five real SEC company-facts files (trimmed to its concepts).
test('quarterly SEC metrics, TTM and change notes match the original', () => {
  for (const c of d) {
    const r = analyse(c.cf, 8);
    assert.deepEqual(r.rows.map(x => ({ ...x, start: x.start ?? null, filed: x.filed ?? null, form: x.form ?? null })), (c.rows as Record<string, unknown>[]).map(x => ({ ...x, start: x.start ?? null, filed: x.filed ?? null, form: x.form ?? null })), String(c.cf.entityName));
    assert.deepEqual([r.ttm, r.concepts], [c.ttm, c.concepts], String(c.cf.entityName));
    assert.deepEqual(changes(r), c.changes, String(c.cf.entityName));
  }
});
