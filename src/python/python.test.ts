import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectEntries, parseParams, paramValues } from './params.ts';
import { barAt, brokerFromSignals, brokerFromTrades, buildOutputs, normalize, partsFor, type PyRun } from './result.ts';
import { fromBroker } from '../pine/report.ts';
import { Broker, defaultProps } from '../pine/strategy.ts';
import type { Bar } from '../data.ts';

const T0 = 1_700_000_000, H = 3600;
const bars = (n = 20, f = (i: number) => 100 + i): Bar[] => Array.from({ length: n }, (_, i) => ({ time: T0 + i * H, open: f(i), high: f(i) + 1, low: f(i) - 1, close: f(i) + 0.5, volume: 1 }));
const times = (b: Bar[]) => b.map(x => x.time);

test('PARAMS: literals, comments, nested text, types; computed values are left out', () => {
  const src = `import numpy as np
PARAMS = {
    "fast": 12,            # fast EMA, with a } in the comment
    'slow': 26.5,
    "use_rsi": True,
    "label": "a, b {c}",
    "mode": 'x',
    "neg": -3,
    "sci": 1e-3,
    "big": 1_000,
    "computed": 2 * 5,
    "none": None,
}
def indicator(df, params): pass
`;
  const p = parseParams(src);
  assert.deepEqual(p.map(x => [x.name, x.value, x.kind]), [['fast', 12, 'int'], ['slow', 26.5, 'float'], ['use_rsi', true, 'bool'], ['label', 'a, b {c}', 'string'], ['mode', 'x', 'string'], ['neg', -3, 'int'], ['sci', 0.001, 'float'], ['big', 1000, 'int']]);
  assert.deepEqual(parseParams('x = 1'), []);
  assert.deepEqual(parseParams('PARAMS = {}'), []);
  assert.deepEqual(parseParams('PARAMS = {"a": 1.0}').map(x => x.kind), ['float']);
  assert.deepEqual(parseParams('PARAMS: dict = {"a": 1}').map(x => x.name), ['a']);
  assert.deepEqual(parseParams('  PARAMS = {"a": 1}'), [], 'only a top-level assignment counts');
  assert.deepEqual(parseParams('PARAMS = {"a": 1'), [], 'unterminated');
});
test('entries are detected from top-level defs; a script is always possible', () => {
  assert.deepEqual(detectEntries('def indicator(df, params):\n  pass\ndef strategy(df, params):\n  pass'), ['indicator', 'strategy', 'script']);
  assert.deepEqual(detectEntries('print(1)'), ['script']);
  assert.deepEqual(detectEntries('class A:\n    def strategy(self): pass'), ['script']);
});
test('typed parameter values follow the default\'s type', () => {
  const defs = parseParams('PARAMS = {"n": 5, "x": 1.5, "on": True, "s": "a"}');
  assert.deepEqual(paramValues(defs, { n: 7.6, x: 'bad', on: false, s: 3 }), { n: 8, x: 1.5, on: false, s: 'a' });
  assert.deepEqual(paramValues(defs, {}), { n: 5, x: 1.5, on: true, s: 'a' });
});

test('normalize: NaN/null, lengths, colours, panes, bad entries become warnings', () => {
  const b = bars(5);
  const { data, warnings } = normalize({
    plots: [{ name: 'a', values: [null, 1, 2, null, 4], color: '#ff0000', pane: 'separate', style: 'histogram' }, { name: 'short', values: [1] }, { values: [1, 2, 3, 4, 5], color: 'url(javascript:1)' }],
    markers: [{ time: T0, position: 'below', text: 'buy' }, { text: 'no time' }],
    hlines: [{ price: 30 }, { price: 'x' }], long_entry: [true, false, 0, 1, null],
  }, times(b));
  assert.equal(data.plots.length, 2);
  assert.deepEqual(data.plots[0].values, [null, 1, 2, null, 4]); assert.equal(data.plots[0].pane, 'separate'); assert.equal(data.plots[0].style, 'plot.style_histogram');
  assert.equal(data.plots[1].name, 'Plot 3'); assert.equal(data.plots[1].color, undefined, 'a non-colour string is dropped');
  assert.equal(data.markers.length, 1); assert.equal(data.markers[0].shape, 'arrowup'); assert.equal(data.hlines.length, 1);
  assert.deepEqual(data.signals?.longEntry, [1, 0, 0, 1, null]);
  assert.ok(warnings.some(w => w.includes('plots[1]')) && warnings.some(w => w.includes('markers[1]')) && warnings.some(w => w.includes('hlines[1]')));
  assert.equal(normalize(null, []).data.plots.length, 0);
  assert.ok(normalize({ position: [1, 2] }, times(b)).warnings[0].includes('"position" ignored'));
});

test('barAt finds the bar a time falls in', () => {
  const b = bars(5);
  assert.equal(barAt(b, T0 - 1), -1); assert.equal(barAt(b, T0), 0); assert.equal(barAt(b, T0 + H + 5), 1); assert.equal(barAt(b, T0 + 99 * H), 4);
});

test('buildOutputs: overlay and lower-pane lines are split; markers snap to bars; hlines follow the lone lower pane', () => {
  const b = bars(10), v = b.map((_, i) => i);
  const { data } = normalize({ plots: [{ name: 'ema', values: v }, { name: 'rsi', values: v, pane: 'separate' }], hlines: [{ price: 30 }], markers: [{ time: T0 + 3 * H + 60, position: 'above', text: 'x' }, { time: T0 - 5 * H }, { time: T0 + 3 * H, position: 'above', text: 'y' }] }, times(b));
  const { parts, warnings } = buildOutputs(data, b, 'My algo');
  assert.equal(parts.length, 2);
  assert.equal(parts[0].meta.overlay, true); assert.equal(parts[1].meta.overlay, false);
  assert.deepEqual(parts[0].plots.map(p => p.title), ['ema', 'Markers']);
  assert.equal(parts[0].hlines.length, 1, 'there is an overlay line too, so the level stays on the price pane unless pane says otherwise');
  const m = parts[0].plots[1];
  assert.equal(m.values[3], 1); assert.equal(m.texts![3], 'y', 'the later marker of the same kind wins the bar'); assert.equal(m.location, 'abovebar');
  assert.ok(warnings.some(w => w.includes('1 marker')));
  const only = buildOutputs(normalize({ plots: [{ values: v, pane: 'separate' }], hlines: [{ price: 30 }] }, times(b)).data, b, 'r');
  assert.equal(only.parts.length, 1); assert.equal(only.parts[0].hlines.length, 1); assert.equal(only.parts[0].meta.overlay, false);
});

test('results are aligned by time, so older history loaded later does not shift them', () => {
  const sent = bars(10), v = sent.map((_, i) => i * 10);
  const { data } = normalize({ plots: [{ name: 'a', values: v }] }, times(sent));
  const more = [...bars(5).map((x, i) => ({ ...x, time: T0 - (5 - i) * H })), ...sent];   // 5 older bars prepended
  const out = buildOutputs(data, more, 'x').parts[0].plots[0].values;
  assert.equal(out.length, 15);
  assert.ok(out.slice(0, 5).every(Number.isNaN));
  assert.deepEqual(out.slice(5), v);
  const fewer = buildOutputs(data, sent.slice(0, 4), 'x').parts[0].plots[0].values;   // replay: fewer bars
  assert.deepEqual(fewer, [0, 10, 20, 30]);
});

test('signals use the Strategy Tester Broker: orders on a bar close fill at the next open', () => {
  const b = bars(10);
  const long = (...i: number[]) => b.map((_, k) => (i.includes(k) ? 1 : 0));
  const { data } = normalize({ long_entry: long(2), long_exit: long(5) }, times(b));
  const br = brokerFromSignals(data, b);
  assert.equal(br.trades.length, 1);
  const t = br.trades[0];
  assert.equal(t.entryBar, 3); assert.equal(t.entryPrice, b[3].open); assert.equal(t.exitBar, 6); assert.equal(t.exitPrice, b[6].open);
  assert.equal(t.profit, b[6].open - b[3].open);
  assert.equal(br.equity.length, 10);
  // the same signals through Broker directly give the same trade
  const ref = new Broker(b, defaultProps());
  for (let i = 0; i < b.length; i++) { ref.step(i); if (i === 2) ref.entry(i, 'Long', 'long', {}); if (i === 5) ref.close(i, 'Long') }
  assert.deepEqual(ref.trades.map(x => [x.entryBar, x.exitBar, x.profit]), br.trades.map(x => [x.entryBar, x.exitBar, x.profit]));
  const td = fromBroker(br, b);
  assert.equal(td.trades.length, 1); assert.equal(td.initialCapital, 10000);
});
test('a position series: reversal closes and opens at the next open; the last signal never fills', () => {
  const b = bars(10);
  const { data } = normalize({ position: [0, 1, 1, 1, -1, -1, 0, 0, 0, 1], qty: 2, initial_capital: 5000 }, times(b));
  const br = brokerFromSignals(data, b);
  assert.deepEqual(br.trades.map(t => [t.dir, t.entryBar, t.exitBar, t.qty]), [['long', 2, 5, 2], ['short', 5, 7, 2]]);
  assert.equal(br.open.length, 0, 'the signal on the last bar has no next bar to fill on');
  assert.equal(fromBroker(br, b).initialCapital, 5000);
});

test('explicit trades: profit, short side, open trade, equity, and trades outside the bars are skipped', () => {
  const b = bars(10, i => 100 + i * 2);   // close = open + 0.5
  const { data } = normalize({ trades: [
    { entryTime: T0 + 1 * H, entryPrice: 102, exitTime: T0 + 4 * H, exitPrice: 108, side: 'long', qty: 2 },
    { entryTime: T0 + 5 * H, entryPrice: 110, exitTime: T0 + 7 * H, exitPrice: 118, side: 'short' },
    { entryTime: T0 + 8 * H, entryPrice: 116, exitTime: null, exitPrice: null, side: 'buy' },
    { entryTime: T0 - 9 * H, entryPrice: 1, exitTime: T0 - 8 * H, exitPrice: 2, side: 'long' },
  ] }, times(b));
  const { broker: br, skipped } = brokerFromTrades(data, b);
  assert.equal(skipped, 1);
  assert.deepEqual(br.trades.map(t => [t.dir, t.entryBar, t.exitBar, t.profit]), [['long', 1, 4, 12], ['short', 5, 7, -8]]);
  assert.equal(br.open.length, 1);
  const td = fromBroker(br, b);
  assert.equal(td.openCount, 1); assert.equal(td.openPL, b[9].close - 116);
  assert.equal(br.equity[0], 10000);
  assert.equal(br.equity[2], 10000 + 2 * (b[2].close - 102), 'open profit counted per bar');
  assert.equal(br.equity[4], 10000 + 12, 'realised at the exit bar');
  assert.equal(br.equity[9], 10000 + 12 - 8 + (b[9].close - 116));
  assert.equal(br.fills.length, 5);
});

test('buildOutputs for a strategy attaches the broker to the price-pane part and marks it a strategy; partsFor caches', () => {
  const b = bars(10);
  const { data } = normalize({ long_entry: b.map((_, i) => i === 1), long_exit: b.map((_, i) => i === 4), plots: [{ values: b.map(x => x.close), pane: 'separate' }] }, times(b));
  const { parts } = buildOutputs(data, b, 'S');
  assert.equal(parts.length, 2); assert.equal(parts[0].meta.kind, 'strategy'); assert.ok(parts[0].broker); assert.equal(parts[1].broker, undefined);
  const run: PyRun = { id: 'py:1', name: 'S', ms: 1, data };
  assert.equal(partsFor(run, b), partsFor(run, b), 'same bars: the same outputs');
  assert.notEqual(partsFor(run, b.slice(0, 5)), partsFor(run, b));
  assert.deepEqual(buildOutputs(data, [], 'S').parts, []);
});
