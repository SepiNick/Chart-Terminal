import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HAMMER_DEFAULTS, hammer } from './hammer.ts';
import type { B } from './burst.ts';

const d = JSON.parse(readFileSync(new URL('./fixtures/hammer.json', import.meta.url), 'utf8')) as { bars: B[]; gate: 'allowed' | 'neutral' | 'restrictive'; cap: number; undercut: boolean; want: unknown[] }[];
// Golden values: stockbee-exhaustion-hammer-screener's analyze_symbol on 150 synthetic pullbacks, all gates and caps.
test('exhaustion hammer states, ratings and components match the original', () => {
  for (const [i, c] of d.entries()) {
    const r = hammer(c.bars, c.gate, c.cap, { ...HAMMER_DEFAULTS, requireUndercut: c.undercut });
    assert.deepEqual([r.state, r.rating, r.score, r.raw, 'comps' in r ? r.comps : undefined, r.reasons, 'soft' in r ? r.soft : []], c.want, `stock ${i}`);
  }
});
