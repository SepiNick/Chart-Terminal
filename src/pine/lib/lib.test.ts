import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Bar } from '../../data.ts';
import type { Builtin, Ctx, PineValue, PineTuple } from '../types.ts';
import * as ind from '../../indicators.ts';
import { LIB, CONSTS, VARS, LIB_NAMES } from './index.ts';

// deterministic random walk
let seed = 42;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const bars: Bar[] = [];
for (let i = 0, p = 100; i < 300; i++) {
  const o = p; p = Math.max(1, p + (rnd() - 0.5) * 4);
  bars.push({ time: 1700000000 + i * 3600, open: o, close: p, high: Math.max(o, p) + rnd(), low: Math.min(o, p) - rnd(), volume: 100 + rnd() * 1000 });
}
const close = bars.map(b => b.close);

const mkCtx = (bs: Bar[]): Ctx => { let st: unknown; return { bar: 0, bars: bs, state: <T>(init: () => T) => (st ??= init()) as T, tfSec: 3600, mintick: 0.01, warn() {} } };
/** Run one call site over all bars. */
function run(name: string, argsAt: (i: number) => PineValue[], named: Record<string, PineValue> = {}, bs = bars): PineValue[] {
  const fn: Builtin = LIB[name], ctx = mkCtx(bs);
  return bs.map((_, i) => { ctx.bar = i; return fn(ctx, argsAt(i), named) });
}
const col = (out: PineValue[], k: number) => out.map(v => (v as PineTuple).tuple[k] as number);
function near(a: PineValue[], b: (number | null)[], tol = 1e-9) {
  assert.equal(a.length, b.length);
  a.forEach((x, i) => {
    const y = b[i];
    if (y == null) assert.ok(Number.isNaN(x), `bar ${i}: expected na, got ${x}`);
    else assert.ok(Math.abs((x as number) - y) < tol, `bar ${i}: ${x} vs ${y}`);
  });
}
const call = (name: string, ...args: PineValue[]) => LIB[name](mkCtx(bars), args, {});

test('ta vs indicators.ts', () => {
  near(run('ta.sma', i => [close[i], 20]), ind.sma(close, 20));
  near(run('ta.ema', i => [close[i], 20]), ind.ema(close, 20));
  near(run('ta.rma', i => [close[i], 14]), ind.rma(close, 14));
  near(run('ta.rsi', i => [close[i], 14]), ind.rsi(close, 14));
  near(run('ta.stdev', i => [close[i], 20]), ind.stdev(close, 20));
  near(run('ta.atr', () => [14]), ind.atr(bars, 14));
  const m = run('ta.macd', i => [close[i], 12, 26, 9]), r = ind.macd(close);
  near(col(m, 0), r.MACD); near(col(m, 1), r.Signal); near(col(m, 2), r.Hist);
  const b = run('ta.bb', i => [close[i], 20, 2]), rb = ind.bb(close);
  near(col(b, 0), rb.Basis); near(col(b, 1), rb.Upper); near(col(b, 2), rb.Lower);
  const k = run('ta.stoch', i => [close[i], bars[i].high, bars[i].low, 14]);
  near(k, ind.stoch(bars)['%K']);
  near(run('ta.sma', i => [k[i], 3]), ind.stoch(bars)['%D']);
  near(run('ta.highest', () => [20]), ind.highest(bars.map(x => x.high), 20));
  near(run('ta.tr', () => [true]), ind.trueRange(bars));
  const vctx = mkCtx(bars);
  near(bars.map((_, i) => { vctx.bar = i; return VARS['ta.vwap'](vctx) }), ind.vwap(bars));
  near(run('ta.obv', () => []), ind.INDICATORS.obv.calc(bars).OBV);
});

test('crossover / crossunder', () => {
  const a = [1, 2, 3, 2, 1], b = [2, 2, 2, 2, 2];
  assert.deepEqual(run('ta.crossover', i => [a[i], b[i]], {}, bars.slice(0, 5)), [false, false, true, false, false]);
  assert.deepEqual(run('ta.crossunder', i => [a[i], b[i]], {}, bars.slice(0, 5)), [false, false, false, false, true]);
});

test('valuewhen / barssince', () => {
  const c = [false, true, false, true, false], s = [10, 11, 12, 13, 14], bs = bars.slice(0, 5);
  assert.deepEqual(run('ta.valuewhen', i => [c[i], s[i], 0], {}, bs), [NaN, 11, 11, 13, 13]);
  assert.deepEqual(run('ta.valuewhen', i => [c[i], s[i], 1], {}, bs), [NaN, NaN, NaN, 11, 11]);
  assert.deepEqual(run('ta.barssince', i => [c[i]], {}, bs), [NaN, 0, 1, 0, 1]);
});

test('pivothigh / highestbars', () => {
  const h = [1, 3, 5, 4, 2, 6, 1], bs = bars.slice(0, 7);
  assert.deepEqual(run('ta.pivothigh', i => [h[i], 2, 2], {}, bs), [NaN, NaN, NaN, NaN, 5, NaN, NaN]);
  assert.deepEqual(run('ta.pivotlow', i => [h[i], 1, 1], {}, bs), [NaN, NaN, NaN, NaN, NaN, 2, NaN]);
  assert.deepEqual(run('ta.highestbars', i => [h[i], 3], {}, bs), [NaN, NaN, 0, -1, -2, 0, -1]);
  assert.deepEqual(run('ta.change', i => [h[i]], {}, bs).slice(0, 3), [NaN, 2, 2]);
});

test('supertrend flips direction', () => {
  const bs: Bar[] = [];
  for (let i = 0; i < 60; i++) { const p = i < 30 ? 100 + i * 2 : 160 - (i - 30) * 2; bs.push({ time: i * 60, open: p, close: p, high: p + 0.5, low: p - 0.5, volume: 1 }) }
  const d = col(run('ta.supertrend', () => [3, 10], {}, bs), 1);
  assert.equal(d[0], 1);
  assert.equal(d[29], -1, 'uptrend while rising');
  assert.equal(d[59], 1, 'downtrend after falling');
  const flips = d.filter((x, i) => i && x !== d[i - 1]).length;
  assert.equal(flips, 2);
});

test('str', () => {
  assert.equal(call('str.format', '{0} + {1,number,#.##} = {2}', 1, 2.345, 'x'), '1 + 2.35 = x');
  assert.equal(call('str.format', "it''s {0,number,integer}", 1234.6), "it's 1,235");
  assert.equal(call('str.tostring', 3.14159, '#.00'), '3.14');
  assert.equal(call('str.tostring', 3, '#.00'), '3.00');
  assert.equal(call('str.tostring', 0.5, '#.##'), '0.5');
  assert.equal(call('str.tostring', 1.005, CONSTS['format.mintick']), '1.01');
  assert.equal(call('str.tostring', 1500, CONSTS['format.volume']), '1.5K');
  assert.equal(call('str.tostring', NaN), 'NaN');
  assert.deepEqual(call('str.split', 'a,b,c', ','), ['a', 'b', 'c']);
  assert.equal(call('str.replace', 'aXbXc', 'X', '-', 1), 'aXb-c');
  assert.ok(Number.isNaN(call('str.tonumber', 'abc') as number));
});

test('color', () => {
  assert.equal(call('color.new', CONSTS['color.red'], 50), '#f2364580');
  assert.equal(call('color.new', '#ff0000', 0), '#ff0000');
  assert.equal(call('color.t', call('color.new', '#ff0000', 70)), 70);
  assert.equal(call('color.rgb', 255, 0, 0, 100), '#ff000000');
  assert.equal(call('color.from_gradient', 50, 0, 100, '#000000', '#ffffff'), '#808080');
  assert.equal(call('color.new', null, 10), null);
});

test('array + math', () => {
  const a = call('array.from', 3, 1, 2) as number[];
  call('array.push', a, 5); call('array.sort', a);
  assert.deepEqual(a, [1, 2, 3, 5]);
  assert.equal(call('array.get', a, -1), 5);
  assert.equal(call('array.sum', a), 11);
  assert.equal(call('array.median', a), 2.5);
  assert.equal(call('array.max', a, 1), 3);
  assert.equal(call('array.join', a, '-'), '1-2-3-5');
  assert.throws(() => call('array.get', a, 9));
  assert.deepEqual(LIB['array.new'](mkCtx(bars), [2], { __type: 'string' }), [null, null]);
  assert.deepEqual(call('array.new_float', 2), [NaN, NaN]);
  assert.equal(call('math.round', 2.345, 2), 2.35);
  assert.equal(call('math.max', 1, 7, 3), 7);
  assert.deepEqual(run('math.sum', i => [i, 3], {}, bars.slice(0, 4)), [NaN, NaN, 3, 6]);
  const r1 = run('math.random', () => [0, 1, 7], {}, bars.slice(0, 3)), r2 = run('math.random', () => [0, 1, 7], {}, bars.slice(0, 3));
  assert.deepEqual(r1, r2);
});

test('every lib function survives na input', () => {
  for (const name of Object.keys(LIB)) {
    if (/^(array|matrix|map)\./.test(name) && !/\.new/.test(name) && name !== 'array.from') continue;   // these throw on an na id, like Pine
    run(name, () => [NaN, NaN, NaN, NaN, NaN], {}, bars.slice(0, 30));
  }
  for (const k of Object.keys(VARS)) VARS[k](mkCtx(bars));
  assert.ok(LIB_NAMES.includes('ta.sma') && LIB_NAMES.includes('color.red') && LIB_NAMES.includes('ta.vwap'));
});
