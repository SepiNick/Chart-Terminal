import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyzeEp, parseEvents, type EpEvent } from './pivot.ts';
import type { Bar } from './study20.ts';

const d = JSON.parse(readFileSync(new URL('./fixtures/pivot.json', import.meta.url), 'utf8')) as { bars: Bar[]; ev: EpEvent & { grade: string | null; cap: number | null }; want: unknown[] }[];
// Golden values: stockbee-episodic-pivot-analyzer's analyze_candidate on 150 synthetic events (catalyst types, headlines, grades, caps).
test('episodic pivot scores and states match the original', () => {
  for (const [i, c] of d.entries()) {
    const e = { ...c.ev, date: c.ev.date ?? undefined, catalyst: c.ev.catalyst ?? undefined, grade: c.ev.grade ?? undefined, cap: c.ev.cap ?? undefined }, a = analyzeEp(e, c.bars);
    assert.deepEqual([a.catalyst, a.type, a.state, a.reasons, a.rating, a.score, a.comps, a.pead, a.momentum, a.date], c.want, `event ${i}`);
  }
  assert.deepEqual(parseEvents('nvda 2026-08-27 guidance Raises guidance\nAAPL record revenue'), [{ symbol: 'NVDA', date: '2026-08-27', catalyst: 'guidance', headline: 'Raises guidance' }, { symbol: 'AAPL', date: undefined, catalyst: undefined, headline: 'record revenue' }]);
});
