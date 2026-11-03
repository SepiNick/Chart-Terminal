import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { posture, type In } from './exposure.ts';

const d = JSON.parse(readFileSync(new URL('./fixtures/exposure.json', import.meta.url), 'utf8')) as { s: Record<In, number | null>; regime: string; lead: string | null; want: [number, number, string, string, string, string] }[];
// Golden values: exposure-coach's composite, ceiling, recommendation, bias, participation and confidence on 400 input mixes.
test('exposure posture matches the original', () => {
  for (const [i, c] of d.entries()) {
    const p = posture(c.s, c.regime, c.lead);
    assert.ok(Math.abs(p.composite - c.want[0]) < 1e-6, `composite ${i}`);
    assert.deepEqual([p.ceiling, p.rec, p.bias, p.part, p.conf], c.want.slice(1), `case ${i}`);
  }
});
