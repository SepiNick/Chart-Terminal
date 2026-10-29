import { test } from 'node:test';
import assert from 'node:assert/strict';
import { movers, seasonals, squarify, technicalRating } from './analysis.ts';
import type { Bar } from '../data.ts';

const day = 86400, t0 = Date.UTC(2023, 0, 1) / 1000;
const series = (f: (i: number) => number, n = 300): Bar[] => Array.from({ length: n }, (_, i) => { const c = f(i); return { time: t0 + i * day, open: c * 0.995, high: c * 1.01, low: c * 0.99, close: c, volume: 100 } });

test('technical rating: 26 votes; a steady uptrend rates buy on moving averages, a downtrend sell', () => {
  const up = technicalRating(series(i => 100 + i));
  assert.equal(up.votes.length, 26);
  assert.equal(up.votes.filter(v => v.group === 'ma').length, 15);
  assert.equal(up.ma, 1, 'price above every moving average');
  assert.ok(up.all > 0.1, up.label);
  const dn = technicalRating(series(i => 400 - i));
  assert.equal(dn.ma, -1);
  assert.ok(dn.label.includes('ell'));
  assert.ok(technicalRating(series(i => 100 + i, 30)).votes.length < 26, 'short history: fewer votes, no NaN');
});

test('seasonals: monthly returns per year and the average', () => {
  const bars: Bar[] = [];
  for (let m = 0; m < 26; m++) { const d = Date.UTC(2022, m, 15) / 1000; bars.push({ time: d, open: 1, high: 1, low: 1, close: 100 * 1.1 ** m, volume: 1 }) }
  const s = seasonals(bars);
  assert.deepEqual(s.years.map(y => y.year), [2024, 2023, 2022]);
  assert.equal(s.years[2].months[0], null, 'no month before the first');
  assert.ok(Math.abs(s.years[1].months[5]! - 10) < 1e-9);
  assert.ok(Math.abs(s.avg[1]! - 10) < 1e-9);
});

test('movers skip illiquid symbols', () => {
  const m = movers([{ s: 'A', c: 1, ch: 50, qv: 10 }, { s: 'B', c: 1, ch: 5, qv: 2e6 }, { s: 'C', c: 1, ch: -3, qv: 5e6 }], 5);
  assert.deepEqual(m.gainers.map(x => x.s), ['B', 'C']);
  assert.deepEqual(m.losers.map(x => x.s), ['C', 'B']);
  assert.deepEqual(m.active.map(x => x.s), ['C', 'B']);
});

test('squarify fills the area with no overlap, areas proportional', () => {
  const v = [6, 6, 4, 3, 2, 2, 1], r = squarify(v, 600, 400), total = v.reduce((a, b) => a + b, 0);
  r.forEach((x, i) => assert.ok(Math.abs(x.w * x.h - (v[i] / total) * 240000) < 1e-6));
  for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) {
    const a = r[i], b = r[j], ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    assert.ok(ox <= 1e-6 || oy <= 1e-6, `${i} and ${j} overlap`);
  }
  assert.ok(r.every(x => x.x >= -1e-9 && x.y >= -1e-9 && x.x + x.w <= 600 + 1e-6 && x.y + x.h <= 400 + 1e-6));
});
