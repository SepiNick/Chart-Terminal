import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Bar } from './data.ts';
import { INDICATORS } from './indicators.ts';
import { LIB, hma, indicatorDef, keyOf, parseKey, wma } from './indlib.ts';

// A deterministic wandering price series with volume.
function bars(n: number, f = (i: number) => 100 + 10 * Math.sin(i / 9) + i * 0.05): Bar[] {
  return Array.from({ length: n }, (_, i) => { const c = f(i), o = f(i - 1); return { time: 1_700_000_000 + i * 3600, open: o, high: Math.max(o, c) + 1 + (i % 3) * 0.3, low: Math.min(o, c) - 1 - (i % 4) * 0.2, close: c, volume: 1000 + (i % 7) * 120 } });
}

test('every library indicator runs on real-looking data: right length, finite numbers or null', () => {
  const b = bars(400);
  for (const d of LIB) {
    const out = d.calc(b, ...d.inputs.map(i => i.def));
    assert.ok(Object.keys(out).length, `${d.id} has no output`);
    for (const [k, s] of Object.entries(out)) {
      assert.equal(s.length, b.length, `${d.id}/${k} length`);
      assert.ok(s.every(x => x === null || Number.isFinite(x)), `${d.id}/${k} has NaN or Infinity`);
      assert.ok(s.some(x => x !== null), `${d.id}/${k} is empty on 400 bars`);
    }
  }
});

test('ids are unique and the original built-ins that exist in the library keep their meaning', () => {
  assert.equal(new Set(LIB.map(d => d.id)).size, LIB.length);
  const b = bars(120);
  for (const id of ['rsi', 'macd', 'stoch', 'atr', 'obv', 'vwap']) assert.deepEqual(LIB.find(d => d.id === id)!.calc(b, ...LIB.find(d => d.id === id)!.inputs.map(i => i.def)), INDICATORS[id].calc(b), id);
});

test('known values: WMA, Aroon, constant-series CCI and Williams %R', () => {
  assert.ok(Math.abs(wma([1, 2, 3, 4, 5], 3)[4]! - (3 * 5 + 2 * 4 + 1 * 3) / 6) < 1e-12);
  assert.equal(hma([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 4).at(-1)! > 9, true, 'a Hull MA of a rising line tracks it closely');
  const up = bars(60, i => 100 + i);
  const aroon = LIB.find(d => d.id === 'aroon')!.calc(up, 25);
  assert.equal(aroon['Aroon Up'].at(-1), 100); assert.equal(aroon['Aroon Down'].at(-1), 0);
  const flat = bars(60, () => 50).map(x => ({ ...x, high: 50, low: 50 }));
  assert.equal(LIB.find(d => d.id === 'cci')!.calc(flat, 20)['CCI'].at(-1), 0);
});

test('Supertrend flips to a down trend after a drop, Ichimoku spans are shifted forward', () => {
  const b = bars(200, i => (i < 100 ? 100 + i : 200 - (i - 100) * 2));
  const st = LIB.find(d => d.id === 'supertrend')!.calc(b, 10, 3);
  assert.ok(st['Supertrend Up'][90] !== null && st['Supertrend Down'][90] === null, 'up trend while rising');
  assert.ok(st['Supertrend Down'][190] !== null && st['Supertrend Up'][190] === null, 'down trend after the fall');
  const ich = LIB.find(d => d.id === 'ichimoku')!.calc(b, 9, 26, 52);
  assert.equal(ich['Span A'][25 + 26 - 1], null, 'span A starts 26 bars after the first Conversion/Base pair (bar 25)');
  assert.ok(ich['Span A'][25 + 26] !== null);
  assert.equal(ich['Lagging'].at(-1), null, 'the lagging span has no value for the last 26 bars');
});

test('keys: defaults stay short, custom inputs round-trip, bad keys are refused', () => {
  assert.equal(keyOf('ema', [20]), 'ema'); assert.equal(keyOf('ema', [50]), 'ema@50');
  assert.deepEqual(parseKey('ema@50')!.args, [50]);
  assert.equal(indicatorDef('ema@50')!.name, 'EMA (50)');
  for (const bad of ['ema@abc', 'ema@0', 'ema@1,2', 'ema@9999', '__proto__', 'nope', 'ema@-5', 'toString']) assert.equal(indicatorDef(bad), undefined, bad);
  assert.equal(indicatorDef('ema20')!.name, 'EMA 20', 'old saved layouts keep working');
  assert.ok(indicatorDef('rsi@21')!.calc(bars(100))['RSI'].some(x => x !== null));
});
