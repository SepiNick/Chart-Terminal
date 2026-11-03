import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { marketState, quality, type D } from './ftd.ts';

const d = JSON.parse(readFileSync(new URL('./fixtures/ftd.json', import.meta.url), 'utf8')) as { cases: Record<string, D[]>; res: Record<string, [string, string, string, number]> };
// Golden values: ftd-detector's get_market_state + assess_post_ftd_health on the same synthetic indexes.
test('FTD states and quality scores match the original for every pair of index paths', () => {
  for (const [k, want] of Object.entries(d.res)) {
    const [a, b] = k.split('|'), sp = d.cases[a], nq = d.cases[b], m = marketState(sp, nq), q = quality(m, sp, nq);
    assert.deepEqual([m.combined, m.sp500.state, m.nasdaq.state, q.score], want, k);
  }
});
