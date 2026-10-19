import { test } from 'node:test';
import assert from 'node:assert/strict';
import { METRIC_DEFS, metrics } from './metrics.ts';
import { monteCarlo, optimize, values, walkForward, wfaSegments } from './optimize.ts';
import { makeEvaluate, paramSpecs } from './runner.ts';
import { BUILTIN_SCRIPTS } from '../pine/builtins.ts';
import { runScript } from '../pine/engine.ts';
import type { Bar, TesterData, Trade } from './types.ts';

const DAY = 86400;
const flat = (n: number, px = 100): Bar[] => Array.from({ length: n }, (_, i) => ({ time: i * DAY, open: px, high: px, low: px, close: px, volume: 1 }));
const trade = (dir: Trade['dir'], entryBar: number, exitBar: number, entryPrice: number, exitPrice: number, qty = 1): Trade => {
  const profit = (exitPrice - entryPrice) * qty * (dir === 'long' ? 1 : -1);
  return { entryId: dir, exitId: 'x', dir, qty, entryBar, entryTime: entryBar * DAY, entryPrice, exitBar, exitTime: exitBar * DAY, exitPrice, profit, profitPct: 0, commission: 0, runup: 0, drawdown: 0, comment: '' };
};
// Sine-wave market so MA cross strategies trade a lot.
const wave = (n: number): Bar[] => Array.from({ length: n }, (_, i) => {
  const c = 100 + 10 * Math.sin(i / 8) + 3 * Math.sin(i / 2.7) + i * 0.02;
  return { time: i * 3600, open: c - 0.3, high: c + 1, low: c - 1, close: c, volume: 1 };
});

test('metric definitions: 53 unique keys, all computed', () => {
  assert.equal(METRIC_DEFS.length, 53);
  assert.equal(new Set(METRIC_DEFS.map(d => d.key)).size, 53);
  const m = metrics({ trades: [], equity: [], initialCapital: 1000, openPL: 0, openCount: 0 }, flat(5));
  for (const d of METRIC_DEFS) assert.ok(d.key in m, d.key);
});

test('metrics: P&L, win rate, drawdown and long/short split', () => {
  const bars = flat(10);
  const trades = [trade('long', 1, 3, 100, 110), trade('short', 4, 6, 100, 120), trade('long', 7, 9, 100, 130)];
  const equity = [1000, 1000, 1000, 1010, 1010, 1010, 990, 990, 990, 1020];
  const d: TesterData = { trades, equity, initialCapital: 1000, openPL: 0, openCount: 0 };
  const m = metrics(d, bars);
  assert.equal(m.netProfit, 20);
  assert.equal(m.grossProfit, 40);
  assert.equal(m.grossLoss, 20);
  assert.equal(m.profitFactor, 2);
  assert.equal(+m.winRate.toFixed(4), 66.6667);
  assert.equal(m.maxDrawdown, 20);
  assert.equal(m.largestLoss, -20);
  assert.equal(m.returnOfMaxDrawdown, 1);
  const L = metrics(d, bars, { side: 'long' }), S = metrics(d, bars, { side: 'short' });
  assert.equal(L.netProfit + S.netProfit, m.netProfit);
  assert.equal(L.totalTrades, 2);
  assert.equal(S.maxDrawdown, 20);
  assert.equal(m.maxContracts, 1);
});

test('values(): inclusive numeric range snapped to step', () => {
  assert.deepEqual(values({ name: 'a', type: 'int', min: 5, max: 15, step: 5 }), [5, 10, 15]);
  assert.deepEqual(values({ name: 'b', type: 'bool' }), [false, true]);
  assert.deepEqual(values({ name: 'c', type: 'float', min: 0.1, max: 0.3, step: 0.1 }), [0.1, 0.2, 0.3]);
});

const maCross = BUILTIN_SCRIPTS.find(s => s.name === 'Moving Average Cross')!.src;
const job = { kind: 'pine' as const, src: maCross, opts: { symbol: 'TEST', tf: '60', tfSec: 3600, mintick: 0.01 } };

test('optimize: grid covers every combination, best first; genetic is deterministic and no worse than a random pick', () => {
  const bars = wave(400), ev = makeEvaluate(job, bars);
  const params = [{ name: 'in0', type: 'int' as const, min: 5, max: 15, step: 5 }, { name: 'in1', type: 'int' as const, min: 20, max: 40, step: 10 }];
  const grid = optimize(ev, bars, params, {}, { method: 'grid', objective: 'netProfit', maximize: true, maxRuns: 100, range: { from: 0, to: bars.length } });
  assert.equal(grid.length, 9);
  for (let i = 1; i < grid.length; i++) assert.ok(grid[i - 1].score >= grid[i].score);
  const opt = { method: 'genetic' as const, objective: 'netProfit', maximize: true, maxRuns: 30, seed: 7, population: 6, generations: 5, range: { from: 0, to: bars.length } };
  const g1 = optimize(ev, bars, params, {}, opt), g2 = optimize(ev, bars, params, {}, opt);
  assert.deepEqual(g1[0].inputs, g2[0].inputs);
  assert.ok(g1[0].score >= grid[grid.length - 1].score);
});

test('paramSpecs: ranges from script inputs, enum options kept', () => {
  const r = runScript(maCross, wave(50), job.opts);
  const ps = paramSpecs(r.out!.inputs);
  assert.deepEqual(ps.map(p => p.name), ['in0', 'in1', 'in2']);
  assert.equal(ps[0].min, 4); assert.equal(ps[0].max, 18);
  assert.deepEqual(ps[2].values, ['EMA', 'SMA', 'WMA']);
});

test('walk-forward: OOS pieces tile the end of the range; stitched equity spans them', () => {
  const segs = wfaSegments({ from: 0, to: 1000 }, 4, 0.75, false);
  assert.equal(segs[3].oos.to, 1000);
  for (let i = 1; i < 4; i++) assert.equal(segs[i].oos.from, segs[i - 1].oos.to);
  for (const s of segs) assert.equal(s.is.to, s.oos.from);
  assert.ok(wfaSegments({ from: 0, to: 1000 }, 4, 0.75, true).every(s => s.is.from === 0));

  const bars = wave(600), ev = makeEvaluate(job, bars);
  const r = walkForward(ev, bars, [{ name: 'in0', type: 'int', min: 5, max: 15, step: 5 }], {}, {
    windows: 3, isPct: 0.7, anchored: false, range: { from: 0, to: bars.length },
    optimize: { method: 'grid', objective: 'netProfit', maximize: true, maxRuns: 10 },
  });
  assert.equal(r.segments.length, 3);
  assert.equal(r.oosEquity.at(-1)!.bar, bars.length - 1);
  assert.ok(Number.isFinite(r.efficiency));
});

test('monte carlo: shuffling never changes final equity; bootstrap does', () => {
  const trades = [10, -5, 20, -15, 8, -2, 12].map((p, i) => trade('long', i, i + 1, 100, 100 + p));
  const sh = monteCarlo(trades, 1000, { runs: 200, method: 'shuffle', ruinPct: 50, seed: 1 });
  assert.equal(sh.finalEquity.p5, 1028); assert.equal(sh.finalEquity.p95, 1028);
  assert.equal(sh.original.finalEquity, 1028);
  assert.ok(sh.maxDrawdownPct.p95 >= sh.maxDrawdownPct.p5);
  assert.equal(sh.riskOfRuin, 0);
  const bs = monteCarlo(trades, 1000, { runs: 200, method: 'bootstrap', ruinPct: 50, seed: 1 });
  assert.ok(bs.finalEquity.p95 > bs.finalEquity.p5);
  assert.equal(bs.paths.length, 50);
});

test('portfolio: equal split, legs merged on one timeline, net profit is the scaled sum', async () => {
  const { combine } = await import('./portfolio.ts');
  const a = flat(4, 100), b = flat(3, 50).map(x => ({ ...x, time: x.time + DAY }));   // b starts a day later
  const legA = { symbol: 'A', bars: a, data: { trades: [trade('long', 0, 2, 100, 110)], equity: [1000, 1005, 1010, 1010], initialCapital: 1000, openPL: 0, openCount: 0 } };
  const legB = { symbol: 'B', bars: b, data: { trades: [trade('short', 0, 1, 50, 40, 2)], equity: [1000, 1020, 1020], initialCapital: 1000, openPL: 0, openCount: 0 } };
  const p = combine([legA, legB], 10000);
  assert.equal(p.bars.length, 4);
  assert.deepEqual(p.data.equity, [10000, 10025, 10150, 10150]);    // B holds cash (5000) until it starts
  assert.equal(p.metrics.netProfit, 150);                            // (10 + 20) × 5000/1000
  assert.equal(p.data.trades.find(t => t.entryId.startsWith('B'))!.entryBar, 1);
  assert.equal(Math.round(p.legs[0].share + p.legs[1].share), 100);
});

test('no-code builder: generated Pine compiles, trades, and exposes lengths as inputs', async () => {
  const { toPine, defaultSpec, mirror } = await import('./nocode.ts');
  const spec = defaultSpec();
  spec.stopPct = 2; spec.takePct = 4; spec.trailPct = 1;
  spec.longExit = { join: 'or', conds: [{ a: { kind: 'rsi', len: 14 }, op: 'gt', b: { kind: 'value', value: 75 } }, { a: { kind: 'macd' }, op: 'crossBelow', b: { kind: 'macdSignal' } }] };
  spec.shortExit = mirror(spec.longExit);
  assert.equal(spec.shortExit.conds[0].b.value, 25);
  const src = toPine(spec), r = runScript(src, wave(400), job.opts);
  assert.ok(!r.error, r.error?.msg + '\n' + src);
  assert.ok(r.out!.broker!.trades.length > 5);
  assert.deepEqual(r.out!.inputs.map(i => i.title).slice(0, 2), ['EMA length', 'EMA length 2']);
  assert.ok(r.out!.inputs.some(i => i.title === 'Stop loss %'));
  const longOnly = runScript(toPine({ ...spec, direction: 'long' }), wave(400), job.opts);
  assert.ok(longOnly.out!.broker!.trades.every(t => t.dir === 'long'));
});
