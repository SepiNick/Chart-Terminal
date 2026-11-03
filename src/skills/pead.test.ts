import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyzePead, gapPct, iso, type PB } from './pead.ts';

const d = JSON.parse(readFileSync(new URL('./fixtures/pead.json', import.meta.url), 'utf8')) as { p: PB[]; date: string; timing: string; want: unknown[] }[];
// Golden values: pead-screener's gap, weekly candles, red-candle pattern, components and rating on 150 synthetic reports.
test('PEAD stages, levels and scores match the original', () => {
  assert.deepEqual([iso('2026-01-01'), iso('2024-12-30'), iso('2027-01-03')], [[2026, 1, 4], [2025, 1, 1], [2026, 53, 7]]);
  for (const [i, c] of d.entries()) {
    const g = gapPct(c.p, c.date, c.timing), a = analyzePead(c.p, c.date, g, c.p[0].close)!;
    assert.deepEqual([g, a.stage, a.weeks, a.red?.high ?? null, a.bo.pct, a.rr.stop, a.rr.target, Math.round(a.adv), a.score, a.rating, { setup_quality: a.setup, breakout_strength: a.bo.score, liquidity: a.liq, risk_reward: a.rr.score }], c.want, `case ${i}`);
  }
});
