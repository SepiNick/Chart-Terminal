import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { breadth, history, momentum, participation, rotation, toSector, toURow, uptrendScore } from './uptrend.ts';

const csv = (f: string) => { const [h, ...l] = readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8').trim().split(/\r?\n/), c = h.split(','); return l.map(x => { const v = x.split(','); return Object.fromEntries(c.map((k, i) => [k, v[i]])) }) };
const rows = csv('uptrend.csv').map(toURow), sec = csv('sectors.csv').map(toSector);
// Golden values: uptrend-analyzer's calculators and scorer on the same data, cut at four points.
const GOLD: [number, number[], number, string][] = [[831, [41, 79, 57, 78, 49], 58.1, 'Neutral'], [791, [16, 79, 57, 33, 22], 38.9, 'Cautious'], [631, [66, 79, 57, 47, 84], 62.9, 'Bull'], [300, [73, 79, 57, 62, 86], 68.2, 'Bull']];
test('uptrend components and composite match the original', () => {
  for (const [end, scores, total, zone] of GOLD) {
    const R = rows.slice(0, end), p = participation(sec), r = rotation(sec);
    const got = [breadth(R).score, p.score, r.score, momentum(R, sec).score, history(R).score];
    assert.deepEqual(got, scores, `day ${end}`);
    const s = uptrendScore({ breadth: got[0], participation: got[1], rotation: got[2], momentum: got[3], history: got[4] }, { late: r.late, spread: p.spread != null && p.spread > 0.4, divergence: r.divergence });
    assert.deepEqual([s.score, s.zone], [total, zone], `day ${end}`);
  }
});

test('sector-analyst cycle phase and regime match the original', async () => {
  const { cyclePhase } = await import('./uptrend.ts');
  const c = cyclePhase(sec);
  assert.deepEqual([c.phase, c.confidence, c.scores], ['early', 'low', { early: 57.1, mid: 50, late: 33.3, recession: 47 }]);
  assert.equal(rotation(sec).score, 57);
});
