import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from './parser.ts';
import { run } from './interp.ts';
import { BUILTIN_SCRIPTS } from './builtins.ts';
import { rsi, ema } from '../indicators.ts';

let seed = 7;
const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
const bars = Array.from({ length: 400 }, (_, i) => {
  const o = 100 + Math.sin(i / 15) * 10 + rnd() * 2, c = o + (rnd() - 0.5) * 3;
  return { time: 1_700_000_000 + i * 3600, open: o, high: Math.max(o, c) + rnd(), low: Math.min(o, c) - rnd(), close: c, volume: 100 + rnd() * 50 };
});
const opts = { symbol: 'BTCUSDT', tf: '1h', tfSec: 3600, mintick: 0.01 };
const go = (src: string, inputs = {}) => run(parse(src), bars, { ...opts, inputs });
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9 || (Number.isNaN(a) && Number.isNaN(b)), `${a} != ${b}`);

test('every built-in library script runs', () => {
  for (const s of BUILTIN_SCRIPTS) {
    const out = go(s.src);
    assert.ok(out.plots.length || out.drawings.length || out.bgcolors.length || out.broker, `${s.name} produced no output`);
    if (s.kind === 'strategy') assert.ok(out.broker && out.broker.trades.length > 0, `${s.name} made no trades`);
  }
});

test('plot values match reference indicators', () => {
  const out = go('//@version=6\nindicator("t")\nplot(ta.rsi(close, 14))\nplot(ta.ema(close, 10))');
  const r = rsi(bars.map(b => b.close), 14), e = ema(bars.map(b => b.close), 10);
  bars.forEach((_, i) => { near(out.plots[0].values[i], r[i] ?? NaN); near(out.plots[1].values[i], e[i] ?? NaN) });
});

test('var persists, history and := work', () => {
  const out = go(`
indicator("t")
var count = 0
count := count + 1
x = close
d = x - x[1]
plot(count)
plot(d)
plot(count[2])`);
  assert.equal(out.plots[0].values[9], 10);
  near(out.plots[1].values[5], bars[5].close - bars[4].close);
  assert.ok(Number.isNaN(out.plots[1].values[0]));
  assert.equal(out.plots[2].values[9], 8);
});

test('user functions keep separate ta state per call site', () => {
  const out = go(`
indicator("t")
f(src, len) => ta.sma(src, len)
plot(f(close, 5))
plot(f(open, 5))`);
  const sma5 = (k: 'close' | 'open', i: number) => bars.slice(i - 4, i + 1).reduce((a, b) => a + b[k], 0) / 5;
  near(out.plots[0].values[20], sma5('close', 20));
  near(out.plots[1].values[20], sma5('open', 20));
});

test('loops, switch, tuples, arrays and ternaries', () => {
  const out = go(`
indicator("t")
sumN(n) =>
    s = 0.0
    for i = 0 to n - 1
        s += close[i]
    s
pair() => [high, low]
[h, l] = pair()
arr = array.new_float(0)
for i = 1 to 3
    array.push(arr, i * 2)
kind = switch
    close > open => "up"
    => "down"
plot(sumN(3))
plot(h - l)
plot(array.sum(arr))
plot(kind == "up" ? 1 : 0)
plot(bar_index % 2 == 0 ? 1 : na)`);
  near(out.plots[0].values[10], bars[10].close + bars[9].close + bars[8].close);
  near(out.plots[1].values[10], bars[10].high - bars[10].low);
  assert.equal(out.plots[2].values[10], 12);
  assert.equal(out.plots[3].values[10], bars[10].close > bars[10].open ? 1 : 0);
  assert.ok(Number.isNaN(out.plots[4].values[11]));
});

test('inputs are reported and overridable', () => {
  const src = 'indicator("t")\nlen = input.int(14, "Length", minval = 1)\nsrc = input.source(close, "Source")\nplot(ta.sma(src, len))';
  const a = go(src);
  assert.equal(a.inputs.length, 2);
  assert.equal(a.inputs[0].title, 'Length');
  assert.equal(a.inputs[1].value, 'close');
  const b = go(src, { in0: 2, in1: 'open' });
  near(b.plots[0].values[10], (bars[10].open + bars[9].open) / 2);
});

test('strategy fills at next bar open', () => {
  const out = go(`
strategy("t")
if bar_index == 10
    strategy.entry("L", strategy.long)
if bar_index == 20
    strategy.close("L")`);
  const t = out.broker!.trades[0];
  assert.equal(t.entryBar, 11); near(t.entryPrice, bars[11].open);
  assert.equal(t.exitBar, 21); near(t.exitPrice, bars[21].open);
});

test('runtime errors carry a location', () => {
  assert.throws(() => go('indicator("t")\nplot(foo)'), (e: { line: number }) => e.line === 2);
});
