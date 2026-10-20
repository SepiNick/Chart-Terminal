import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthlyReturns, rangeBounds, returnDistribution, sliceReport, streaks } from './analysis.ts';
import { metrics } from './metrics.ts';
import type { Bar, TesterData, Trade } from './types.ts';

const DAY = 86400, T0 = Date.UTC(2024, 0, 1) / 1000;
const bars: Bar[] = Array.from({ length: 100 }, (_, i) => ({ time: T0 + i * DAY, open: 100 + i, high: 101 + i, low: 99 + i, close: 100 + i, volume: 1 }));
const trade = (entryBar: number, exitBar: number, profit: number, profitPct = profit): Trade => ({
  entryId: 'L', exitId: 'X', dir: 'long', qty: 1, entryBar, entryTime: bars[entryBar].time, entryPrice: bars[entryBar].close,
  exitBar, exitTime: bars[exitBar].time, exitPrice: bars[exitBar].close, profit, profitPct, commission: 0, runup: 0, drawdown: 0, comment: '' });

test('rangeBounds: presets count back from the last bar, custom dates are inclusive whole days', () => {
  const end = Date.UTC(2024, 5, 15, 12) / 1000;
  assert.deepEqual(rangeBounds({ preset: 'all' }, end), { from: null, to: null });
  assert.deepEqual(rangeBounds({ preset: '30d' }, end), { from: end - 30 * DAY, to: null });
  assert.equal(rangeBounds({ preset: '1y' }, end).from, end - 365 * DAY);
  assert.equal(rangeBounds({ preset: 'ytd' }, end).from, Date.UTC(2024, 0, 1) / 1000);
  assert.deepEqual(rangeBounds({ preset: 'custom', from: '2024-02-01', to: '2024-02-29' }, end), { from: Date.UTC(2024, 1, 1) / 1000, to: Date.UTC(2024, 2, 1) / 1000 - 1 });
  assert.deepEqual(rangeBounds({ preset: 'custom', from: 'nope' }, end), { from: null, to: null });
});

test('sliceReport keeps trades opened in range, re-indexes them and rebases equity to the range start', () => {
  const trades = [trade(5, 15, 10), trade(20, 30, -4), trade(40, 60, 7)];
  const d: TesterData = { trades, equity: bars.map(() => 0), initialCapital: 1000, openPL: 3, openCount: 1 };
  assert.equal(sliceReport(d, bars, { from: null, to: null }).data, d);
  // Range = bars 18..45: the trade opened at 40 closes at 60, so the slice runs until then.
  const r = sliceReport(d, bars, { from: bars[18].time, to: bars[45].time });
  assert.equal(r.bars[0], bars[18]); assert.equal(r.bars.length, 61 - 18);
  assert.deepEqual(r.data.trades.map(t => [t.entryBar, t.exitBar, t.profit]), [[2, 12, -4], [22, 42, 7]]);
  assert.equal(r.data.equity[0], 1000); assert.equal(r.data.equity.at(-1), 1003);
  assert.equal(r.data.openCount, 0, 'the open position is outside the range');
  const m = metrics(r.data, r.bars);
  assert.equal(m.totalTrades, 2); assert.equal(m.netProfit, 3);
  const tail = sliceReport(d, bars, { from: bars[50].time, to: null });
  assert.equal(tail.data.trades.length, 0); assert.equal(tail.data.openPL, 3);
  assert.deepEqual(sliceReport(d, bars, { from: bars[99].time + DAY, to: null }).bars, []);
});

test('monthlyReturns: % of the previous month-end equity, yearly totals', () => {
  const b: Bar[] = [Date.UTC(2023, 11, 5), Date.UTC(2023, 11, 20), Date.UTC(2024, 0, 10), Date.UTC(2024, 2, 1)].map(t => ({ time: t / 1000, open: 1, high: 1, low: 1, close: 1, volume: 0 }));
  const rows = monthlyReturns({ trades: [], equity: [1000, 1100, 990, 1188], initialCapital: 1000, openPL: 0, openCount: 0 }, b);
  assert.deepEqual(rows.map(r => r.year), [2023, 2024]);
  const near = (a: number, e: number) => assert.ok(Math.abs(a - e) < 1e-9, `${a} vs ${e}`);
  near(rows[0].months[11]!.pct, 10); assert.equal(rows[0].months[11]!.pl, 100);
  near(rows[1].months[0]!.pct, -10); assert.equal(rows[1].months[1], null); near(rows[1].months[2]!.pct, 20);
  near(rows[1].total.pct, 8); assert.equal(rows[1].total.pl, 88);
});

test('returnDistribution: zero-aligned buckets, mean, median, wins and losses', () => {
  const t = [-3, -1, 0.5, 2, 2.5, 4].map((p, i) => trade(i, i + 1, p, p));
  const d = returnDistribution(t, 7);
  assert.equal(d.width, 1);
  assert.deepEqual(d.buckets.map(x => [x.from, x.count]), [[-3, 1], [-2, 0], [-1, 1], [0, 1], [1, 0], [2, 2], [3, 0], [4, 1]]);
  assert.equal(d.mean, 5 / 6); assert.equal(d.median, 1.25); assert.equal(d.wins, 4); assert.equal(d.losses, 2);
  assert.ok(d.buckets.every(b => b.from >= 0 || b.to <= 0), 'no bucket straddles zero');
  assert.deepEqual(returnDistribution([]).buckets, []);
  assert.equal(returnDistribution([trade(0, 1, 5, 5)]).buckets.length, 1);
});

test('streaks: longest, current and the length distribution; even trades break a run', () => {
  const s = streaks([1, 2, -1, 3, 4, 5, 0, -2, -3, 6].map((p, i) => trade(i, i + 1, p)));
  assert.equal(s.maxWin, 3); assert.equal(s.maxLoss, 2);
  assert.deepEqual(s.current, { kind: 'win', len: 1 });
  assert.deepEqual(s.dist, [{ len: 1, wins: 1, losses: 1 }, { len: 2, wins: 1, losses: 1 }, { len: 3, wins: 1, losses: 0 }]);
  assert.deepEqual(streaks([]).current, { kind: null, len: 0 });
  assert.deepEqual(streaks([trade(0, 1, 1), trade(1, 2, 0)]).current, { kind: null, len: 0 });
});
