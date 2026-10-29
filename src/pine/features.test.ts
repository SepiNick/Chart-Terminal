// request.security, UDT/enum/import, tables, plotcandle, matrix/map.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from './parser.ts';
import { run, appTf, type RunOpts } from './interp.ts';
import { findLibrary } from './engine.ts';
import { aggregate, type Bar } from '../data.ts';

let seed = 3;
const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
const T0 = 1_699_992_000;   // a multiple of 4h, so 4h buckets hold 4 bars each
const bars: Bar[] = Array.from({ length: 200 }, (_, i) => {
  const o = 100 + Math.sin(i / 9) * 8 + rnd() * 2, c = o + (rnd() - 0.5) * 3;
  return { time: T0 + i * 3600, open: o, high: Math.max(o, c) + rnd(), low: Math.min(o, c) - rnd(), close: c, volume: 100 + rnd() * 50 };
});
const opts: RunOpts = { symbol: 'BTCUSDT', tf: '1h', tfSec: 3600, mintick: 0.01 };
const go = (src: string, o: Partial<RunOpts> = {}) => run(parse('//@version=6\nindicator("t")\n' + src), bars, { ...opts, ...o });
const h4 = aggregate(bars, 4 * 3600);
const bucket = (i: number) => h4.findIndex(b => b.time === Math.floor(bars[i].time / 14400) * 14400);

test('timeframe strings', () => {
  assert.deepEqual(['D', '240', '1W', '30S', '5', 'M', '3M', '4h', ''].map(appTf), ['1d', '4h', '1w', '30s', '5m', '1M', '3M', '4h', null]);
});

test('request.security: higher timeframe without lookahead sees only closed bars', () => {
  const out = go('plot(request.security(syminfo.tickerid, "240", close))\nplot(request.security(syminfo.tickerid, "240", close, lookahead = barmerge.lookahead_on))\nplot(request.security("", "240", close, barmerge.gaps_on))');
  const [off, on, gaps] = out.plots.map(p => p.values);
  for (let i = 0; i < bars.length - 1; i++) {
    const k = bucket(i), closes = (i + 1) % 4 === 0;   // this bar is the last hour of its 4h bucket
    const want = closes ? h4[k].close : k > 0 ? h4[k - 1].close : NaN;
    assert.ok(Object.is(off[i], want) || off[i] === want, `bar ${i}: ${off[i]} vs ${want}`);
    assert.equal(on[i], h4[k].close);   // lookahead_on peeks at the bucket's final close
    if (closes) assert.equal(gaps[i], h4[k].close); else assert.ok(Number.isNaN(gaps[i]), `gap bar ${i}`);
  }
  assert.equal(off.at(-1), h4.at(-1)!.close, 'the last chart bar sees the forming bucket');
  assert.equal(out.warnings.length, 0);
});

test('request.security: the expression runs in the other context (ta state on 4h bars)', () => {
  const out = go('plot(request.security(syminfo.tickerid, "240", ta.sma(close, 3)))');
  const sma = (k: number) => (k < 2 ? NaN : (h4[k].close + h4[k - 1].close + h4[k - 2].close) / 3);
  for (let i = 3; i < bars.length - 1; i += 4) assert.ok(Math.abs(out.plots[0].values[i] - sma(bucket(i))) < 1e-9 || (Number.isNaN(sma(bucket(i)))));
});

test('request.security: other symbol through the host callback; missing data is na plus one warning', () => {
  const eth = bars.map(b => ({ ...b, close: b.close * 2 }));
  const asked: string[] = [];
  const out = go('[c, o] = request.security("BINANCE:ETHUSDT", "60", [close, open])\nplot(c)\nplot(o)', { security: (s, tf) => { asked.push(`${s} ${tf}`); return s === 'ETHUSDT' ? eth : undefined } });
  assert.deepEqual(asked, ['ETHUSDT 1h']);
  bars.forEach((b, i) => { assert.equal(out.plots[0].values[i], b.close * 2); assert.equal(out.plots[1].values[i], b.open) });
  const miss = go('plot(request.security("ETHUSDT", "D", close))\nplot(request.security("ETHUSDT", "D", open))');
  assert.ok(miss.plots[0].values.every(Number.isNaN));
  assert.equal(miss.warnings.length, 1);
  assert.deepEqual(miss.securityMissing, [{ symbol: 'ETHUSDT', tf: '1d' }]);
});

test('user-defined types: defaults, new, fields, :=, methods, copy, var', () => {
  const out = go(`
type Box
    float lo = 0
    float hi
    int n = 1
    array<float> xs
method width(Box b) => b.hi - b.lo
method grow(Box b, float d) =>
    b.hi += d
    b.n += 1
    b
method width(array<float> a) => a.size()
var acc = Box.new(hi = 10, xs = array.new<float>())
acc.grow(1)
acc.xs.push(close)
b2 = Box.copy(acc)
b2.lo := 5
plot(acc.width())
plot(acc.n)
plot(b2.width())
plot(acc.xs.width())
plot(Box.new(1, 3).width())`);
  const last = (k: number) => out.plots[k].values.at(-1);
  assert.equal(last(0), 10 + bars.length);
  assert.equal(last(1), 1 + bars.length);
  assert.equal(last(2), 10 + bars.length - 5);
  assert.equal(last(3), bars.length);   // method overload picked by the receiver's type
  assert.equal(last(4), 2);
});

test('enums: members, switch, input.enum options', () => {
  const out = go(`
enum Mode
    fast = "Fast MA"
    slow
m = input.enum(Mode.slow, "Mode")
len = switch m
    Mode.fast => 5
    Mode.slow => 20
plot(len)`);
  assert.equal(out.plots[0].values[0], 20);
  assert.deepEqual(out.inputs[0].options, ['Fast MA', 'slow']);
  assert.equal(run(parse('indicator("t")\nenum Mode\n    fast = "Fast MA"\n    slow\nm = input.enum(Mode.slow)\nplot(m == Mode.fast ? 1 : 0)'), bars, { ...opts, inputs: { in0: 'Fast MA' } }).plots[0].values[0], 1);
});

const LIB_SRC = `//@version=6
library("Geo")
helper(x) => x * 2
export type Pt
    float x
    float y = 1
export method area(Pt p) => helper(p.x * p.y)
export enum Side
    up
    down
export double(float v) => helper(v)
export mk(float x) => Pt.new(x, 3)`;

test('import resolves an installed library: exported functions, types, methods, enums', () => {
  const src = `import me/Geo/1 as g
p = g.Pt.new(2)
q = g.mk(4)
plot(g.double(close))
plot(p.area())
plot(q.area())
plot(g.Side.down == g.Side.down ? 1 : 0)`;
  const out = go(src, { library: path => findLibrary(path, ['indicator("other")', LIB_SRC]) });
  assert.equal(out.plots[0].values[5], bars[5].close * 2);
  assert.equal(out.plots[1].values[0], 4);
  assert.equal(out.plots[2].values[0], 24);
  assert.equal(out.plots[3].values[0], 1);
  assert.throws(() => go(src), /Library 'me\/Geo\/1' not found/);
});

test('a library can import another library; cycles are an error', () => {
  const outer = `//@version=6
library("Outer")
import me/Geo/1 as geo
export quad(float v) => geo.double(geo.double(v))`;
  const out = go('import me/Outer/1 as o\nplot(o.quad(close))', { library: path => findLibrary(path, [LIB_SRC, outer]) });
  assert.equal(out.plots[0].values[3], bars[3].close * 4);
  const loop = 'library("Loop")\nimport me/Loop/1 as l\nexport f() => 1';
  assert.throws(() => go('import me/Loop/1 as l\nplot(l.f())', { library: () => loop }), /import cycle/);
});

test('request.security_lower_tf: one array per chart bar of the lower bars inside it', () => {
  const m15: Bar[] = bars.slice(0, 20).flatMap(b => [0, 1, 2, 3].map(k => ({ ...b, time: b.time + k * 900, close: b.close + k })));
  const out = go('a = request.security_lower_tf(syminfo.tickerid, "15", close)\nplot(array.size(a))\nplot(array.size(a) > 0 ? array.last(a) : na)\n[c, o] = request.security_lower_tf(syminfo.tickerid, "15", [close, open])\nplot(array.size(o))',
    { security: (s, tf) => (s === 'BTCUSDT' && tf === '15m' ? m15 : undefined) });
  assert.equal(out.plots[0].values[0], 4);
  assert.equal(out.plots[1].values[2], bars[2].close + 3);
  assert.equal(out.plots[0].values[25], 0, 'no lower bars there: empty array');
  assert.equal(out.plots[2].values[1], 4, 'tuple of arrays');
  const miss = go('plot(array.size(request.security_lower_tf(syminfo.tickerid, "5", close)))');
  assert.deepEqual(miss.securityMissing, [{ symbol: 'BTCUSDT', tf: '5m' }]);
});

test('matrix and map', () => {
  const out = go(`
m = matrix.new<float>(2, 3, 1)
m.set(0, 2, 5)
m.add_row(2, array.from(7, 8, 9))
t = m.transpose()
p = m.mult(t)
s = matrix.sum(m, 1)
m.remove_col(0)
plot(m.rows())
plot(m.columns())
plot(t.get(2, 0))
plot(p.get(0, 0))
plot(p.rows() * 10 + p.columns())
plot(s.get(2, 2))
plot(m.get(2, 1))
mp = map.new<string, float>()
mp.put("a", 1)
mp.put("b", 2)
old = mp.put("a", 10)
tot = 0.0
for [k, v] in mp
    tot += v
cp = mp.copy()
cp.remove("b")
plot(old)
plot(tot)
plot(mp.size() * 10 + cp.size())
plot(mp.contains("b") ? 1 : 0)
plot(na(mp.get("zz")) ? 1 : 0)
plot(array.sum(mp.values()))
plot(mp.keys().size())`);
  const v = out.plots.map(p => p.values[0]);
  assert.deepEqual(v, [3, 2, 5, 27, 33, 10, 9, 1, 12, 21, 1, 1, 12, 2]);
});

test('tables: cells, merges, clear, delete, one live table per position', () => {
  const out = go(`
var t = table.new(position.bottom_left, 3, 2, bgcolor = color.white, border_width = 1, border_color = #000000)
if barstate.islast
    t.cell(0, 0, "Close", text_color = color.red, text_size = size.large)
    table.cell(t, 1, 0, str.tostring(close, "#.##"))
    t.cell_set_bgcolor(1, 0, #ffff00)
    t.merge_cells(0, 1, 2, 1)
    t.cell(0, 1, "merged")
    t.cell(2, 0, "gone")
    t.clear(2, 0)
var old = table.new(position.top_right, 1, 1)
var old2 = table.new(position.top_right, 1, 1)
var dead = table.new(position.middle_center, 1, 1)
table.delete(dead)`);
  const live = out.tables!.filter(x => !x.deleted);
  assert.equal(live.length, 2);
  const t = live[0];
  assert.equal(t.position, 'bottom_left');
  assert.equal(t.cells['0,0'].text, 'Close');
  assert.equal(t.cells['0,0'].text_size, 'large');
  assert.equal(t.cells['1,0'].text, bars.at(-1)!.close.toFixed(2).replace(/\.?0+$/, ''));
  assert.equal(t.cells['1,0'].bgcolor, '#ffff00');
  assert.equal(t.cells['2,0'], undefined);
  assert.deepEqual(t.merges, [{ c0: 0, r0: 1, c1: 2, r1: 1 }]);
  assert.equal(live[1].position, 'top_right');
  assert.throws(() => go('t = table.new(position.top_left, 2, 2)\nt.cell(5, 0, "x")'), /outside/);
});

test('plotcandle / plotbar keep OHLC and per-bar colors', () => {
  const out = go('plotcandle(open, high, low, close, "C", close > open ? color.green : color.red, wickcolor = color.gray)\nplotbar(open, high, low, bar_index % 2 == 0 ? na : close)');
  const [c, b] = out.plots;
  assert.equal(c.kind, 'candle'); assert.equal(b.kind, 'bar');
  assert.equal(c.ohlc!.h[7], bars[7].high);
  assert.equal(c.colors[7], bars[7].close > bars[7].open ? '#4caf50' : '#f23645');
  assert.equal(c.wickcolors![7], '#787b86'); assert.equal(c.bordercolors![7], c.colors[7]);
  assert.ok(Number.isNaN(b.ohlc!.c[0])); assert.equal(b.colors[1], null);
});
