import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { allocation, conviction, pattern, type Sig } from './druckenmiller.ts';

const d = JSON.parse(readFileSync(new URL('./fixtures/druckenmiller.json', import.meta.url), 'utf8')) as { s: Sig; want: [number, string, Record<string, number>, string, number, Record<string, number>] }[];
// Golden values: the Druckenmiller synthesizer's components, conviction, pattern and allocation on 400 signal mixes.
test('Druckenmiller conviction, pattern and allocation match the original', () => {
  for (const [i, c] of d.entries()) {
    const k = conviction(c.s), p = pattern(c.s, k.c, k.score);
    assert.deepEqual([k.score, k.zone, k.c, p.best, p.strength, allocation(k.zone, p.best, c.s.macro?.regime ?? 'transitional')], c.want, `case ${i}`);
  }
});
