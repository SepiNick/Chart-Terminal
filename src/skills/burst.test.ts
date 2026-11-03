import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { burst, type B } from './burst.ts';

const d = JSON.parse(readFileSync(new URL('./fixtures/burst.json', import.meta.url), 'utf8')) as { bars: B[]; gate: 'allowed' | 'neutral' | 'restrictive'; want: unknown[] }[];
// Golden values: stockbee-momentum-burst-screener's analyze_symbol on 120 synthetic stocks and all three market gates.
test('momentum burst states, ratings and components match the original', () => {
  for (const [i, c] of d.entries()) {
    const r = burst(c.bars, c.gate);
    assert.deepEqual('t' in r ? [r.state, r.rating, r.score, r.raw, r.t.tags, r.b.days, r.comps, r.reasons, r.soft] : [r.state, r.rating, r.score, 0, [], 0, undefined, r.reasons, []], c.want, `stock ${i}`);
  }
});
