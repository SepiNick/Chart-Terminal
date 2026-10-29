import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze, levels, patterns, pivots, trendLines, type Pivot } from './analyze.ts';
import type { Bar } from '../data.ts';

/** Bars that walk through the given closes linearly (`steps` bars per leg), with a small range. */
function walk(points: number[], steps = 10): Bar[] {
  const out: Bar[] = [];
  for (let k = 0; k < points.length - 1; k++) for (let s = 0; s < steps; s++) {
    const c = points[k] + ((points[k + 1] - points[k]) * s) / steps;
    out.push({ time: out.length * 3600, open: c, high: c + 0.2, low: c - 0.2, close: c, volume: 1 });
  }
  return out;
}
const P = (i: number, p: number, hi: boolean): Pivot => ({ i, t: i * 3600, p, hi });

test('pivots alternate highs and lows', () => {
  const ps = pivots(walk([100, 110, 102, 112, 104, 114, 106]), 3);
  assert.ok(ps.length >= 4);
  ps.forEach((p, i) => i && assert.notEqual(p.hi, ps[i - 1].hi));
  assert.deepEqual(ps.filter(p => p.hi).map(p => Math.round(p.p)), [110, 112, 114]);
});

test('a rising market gets a rising support line through its higher lows, unbroken', () => {
  const b = walk([100, 110, 102, 112, 104, 114, 106, 116, 108, 112]), ps = pivots(b, 3);
  const sup = trendLines(b, ps, 0.5).find(l => l.kind === 'support')!;
  assert.ok(sup && sup.b.p > sup.a.p);
  assert.ok(sup.touches >= 2);
});

test('levels cluster equal swings; patterns: double top, head and shoulders, ascending triangle', () => {
  const lv = levels([P(1, 100, false), P(2, 110, true), P(3, 100.2, false), P(4, 110.1, true), P(5, 105, false)], 0.5, 106);
  assert.deepEqual(lv.map(l => [Math.round(l.price), l.touches, l.kind]), [[110, 2, 'resistance'], [100, 2, 'support']]);
  assert.ok(patterns([P(1, 100, false), P(2, 110, true), P(3, 100, false), P(4, 110.2, true)], 0.5).some(p => p.name === 'Double top' && p.neckline === 100));
  const hs = patterns([P(1, 100, false), P(2, 110, true), P(3, 104, false), P(4, 116, true), P(5, 104, false), P(6, 110.3, true)], 0.5);
  assert.ok(hs.some(p => p.name === 'Head and shoulders' && p.dir === 'bearish'));
  assert.ok(patterns([P(1, 100, false), P(2, 110, true), P(3, 104, false), P(4, 110.1, true)], 0.5).some(p => p.name === 'Ascending triangle'));
});

test('analyze on real-looking data returns sane output and nothing on tiny input', () => {
  const b = walk([100, 120, 105, 125, 110, 130, 115, 135, 120], 12), a = analyze(b);
  assert.ok(a.pivots.length > 3 && a.levels.every(l => l.touches >= 2));
  assert.deepEqual(analyze(b.slice(0, 5)), { pivots: [], lines: [], levels: [], patterns: [] });
});
