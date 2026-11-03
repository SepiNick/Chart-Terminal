import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { screen, sizeRecipe, MODES } from './parabolic.ts';
import type { Bar } from './study20.ts';

const d = JSON.parse(readFileSync(new URL('./fixtures/parabolic.json', import.meta.url), 'utf8')) as { bars: Bar[]; mode: keyof typeof MODES; cap: number | null; raw: { rank: string; score: number; components_raw: Record<string, number>; state_caps: string[]; warnings: string[] } | null }[];
// Golden values: parabolic-short-trade-planner's screen_one_candidate on 160 synthetic run-ups in both modes.
test('parabolic filters, components, grade and caps match the original', () => {
  for (const [i, c] of d.entries()) {
    const r = screen(c.bars, c.cap, c.mode);
    if (!c.raw) { assert.equal(r, null, `stock ${i} should be filtered`); continue }
    assert.ok(r, `stock ${i} should pass`);
    for (const [k, v] of Object.entries(c.raw.components_raw)) assert.ok(Math.abs(r.c[k as keyof typeof r.c] - v) < 1e-9, `${i} ${k}`);
    assert.deepEqual([r.score, r.grade, r.caps, r.warnings], [c.raw.score, c.raw.rank, c.raw.state_caps, c.raw.warnings], `stock ${i}`);
  }
  assert.deepEqual(sizeRecipe(100_000), { risk: 500, maxValue: 10_000, ok: true });
  assert.deepEqual(sizeRecipe(100_000, 50, 10, 30, 25_000), { risk: 500, maxValue: 5_000, ok: false });
});
