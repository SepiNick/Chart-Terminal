import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bearish, breadthScore, crossover, cycle, divergence, levelTrend, percentile, toRow } from './breadth.ts';

const csv = (f: string) => { const [h, ...l] = readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8').trim().split(/\r?\n/), c = h.split(','); return l.map(x => { const v = x.split(','); return Object.fromEntries(c.map((k, i) => [k, v[i]])) }) };
const rows = csv('breadth.csv').map(toRow), summary = Object.fromEntries(csv('breadth_summary.csv').map(r => [r.Metric, r.Value]));
// Golden values: market-breadth-analyzer's calculators and scorer on the same 900 days, cut at six points.
const GOLD: [number, number[], number, string][] = [[900, [62, 45, 45, 25, 30, 50], 45.2, 'Neutral'], [850, [90, 80, 75, 85, 60, 70], 79.2, 'Healthy'], [700, [80, 50, 50, 85, 50, 70], 68.4, 'Healthy'], [520, [35, 15, 95, 10, 10, 30], 36.2, 'Weakening'], [300, [80, 40, 50, 85, 40, 16], 57.9, 'Neutral'], [140, [41, 5, 15, 10, 10, 30], 19.8, 'Critical']];
test('market breadth components and composite match the original', () => {
  for (const [end, scores, total, zone] of GOLD) {
    const R = rows.slice(0, end), c = { level: levelTrend(R), crossover: crossover(R), cycle: cycle(R), bearish: bearish(R), percentile: percentile(R, summary), divergence: divergence(R) };
    assert.deepEqual(Object.values(c).map(x => x.score), scores, `day ${end}`);
    const s = breadthScore(c);
    assert.deepEqual([s.score, s.zone], [total, zone], `day ${end}`);
  }
});
