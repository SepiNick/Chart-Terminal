import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transformBars, typeDefaults, CHART_TYPES, type ChartType } from './charttransforms.ts';
import type { Bar } from './data.ts';

// One bar per close, 60s apart, flat OHLC unless given.
const mk = (closes: number[]): Bar[] => closes.map((c, i) => ({ time: 1000 + i * 60, open: c, high: c, low: c, close: c, volume: 1 }));
const o = typeDefaults({ boxSize: 10 });
const oc = (b: Bar[]) => b.map(x => [x.open, x.close]);
const increasing = (b: Bar[]) => b.every((x, i) => !i || x.time > b[i - 1].time);

test('chart type list', () => {
  assert.equal(CHART_TYPES.length, 20);
  assert.deepEqual(CHART_TYPES.filter(x => x.priceBased).map(x => x.id), ['renko', 'linebreak', 'kagi', 'pnf', 'range']);
});

test('renko: one brick per box, reversal needs 2 boxes, gap makes several bricks with +1s times', () => {
  const r = transformBars('renko', mk([100, 109, 110, 125, 105, 101, 90, 130]), o);
  // 110: up 100-110; 125: 110-120; 105: only 1.5 boxes below top -> nothing; 101: no; 90: reversal 110-100 and 100-90
  // 130: from low 90, up needs 110+... bricks 100-110, 110-120, 120-130
  assert.deepEqual(oc(r), [[100, 110], [110, 120], [110, 100], [100, 90], [100, 110], [110, 120], [120, 130]]);
  assert.deepEqual(r.slice(-3).map(x => x.time), [1420, 1421, 1422]);
  assert.ok(increasing(r));
  assert.deepEqual(transformBars('renko', [], o), []);
});

test('line break: 3-line reversal rule', () => {
  // first line 100->101 (open..close of bar0 with open 100)
  const b = mk([101, 102, 103, 101.5, 99, 104]);
  b[0].open = 100;
  const r = transformBars('linebreak', b, o);
  // 102,103 continue up; 101.5 is below last line low (102) but not below lowest of last 3 lines (100) -> ignored;
  // 99 < 100 -> reversal down from 102 (last line's low) to 99; 104 > max high of last 3 lines (103) -> reversal up from 102
  assert.deepEqual(oc(r), [[100, 101], [101, 102], [102, 103], [102, 99], [102, 104]]);
  assert.ok(increasing(r));
});

test('kagi: extends, reverses on amount, yang/yin on shoulder/waist break', () => {
  const r = transformBars('kagi', mk([100, 120, 130, 125, 115, 140, 105, 95]), o);
  // up 100->130; down 130->115 (reversal >=10); up 115->140 (breaks shoulder 130 -> stays yang); down 140->95 breaks waist 115 -> yin
  assert.deepEqual(oc(r), [[100, 130], [130, 115], [115, 140], [140, 95]]);
  assert.deepEqual(r.map(x => x.yang), [true, true, true, false]);
  assert.equal(r[3].flip, 115);
  assert.equal(r[0].volume, 3);
  const thin = transformBars('kagi', mk([100, 80, 95, 70, 101]), o);
  // down 100->80 (yin), up 80->95, down 95->70, up 70->101 breaks shoulder 95 -> yang with flip at 95
  assert.deepEqual(thin.map(x => [x.yang, x.flip]), [[false, undefined], [false, undefined], [false, undefined], [true, 95]]);
});

test('point & figure: X/O columns with 3-box reversal', () => {
  const r = transformBars('pnf', mk([100, 130, 125, 105, 100, 70, 95, 101]), { ...o, reversal: 3 });
  // X rows 11..13; 125/105 not 3 boxes below 130 except 100 (row 10 <= 13-3) -> O rows 12..10; 70 -> O to 7;
  // 95 -> row 9 < 7+3 no; 101 -> row 10 >= 10 -> X rows 8..10
  assert.deepEqual(r.map(x => [x.pnf, x.low, x.high, x.boxes]), [['X', 110, 130, 3], ['O', 70, 120, 6], ['X', 80, 100, 3]]);
  assert.ok(increasing(r));
  const hl = transformBars('pnf', [{ time: 1, open: 100, high: 131, low: 99, close: 100, volume: 1 }], { ...o, source: 'hl' });
  assert.deepEqual(hl.map(x => [x.pnf, x.high]), [['X', 130]]);
});

test('range bars: each closed bar spans exactly the range, overshoot spawns extra bars', () => {
  const r = transformBars('range', [{ time: 0, open: 100, high: 135, low: 98, close: 135, volume: 5 }], { ...o, range: 10 });
  // path 100 -> 98 -> 135: bar 98..108, then 108..118, 118..128, forming 128..135
  assert.deepEqual(r.map(x => [x.low, x.high, x.close]), [[98, 108, 108], [108, 118, 118], [118, 128, 128], [128, 135, 135]]);
  assert.deepEqual(r.map(x => x.time), [0, 1, 2, 3]);
  assert.ok(r.slice(0, -1).every(x => x.high - x.low === 10));
});

test('heikin ashi and time-based passthrough', () => {
  const b: Bar[] = [{ time: 1, open: 10, high: 14, low: 8, close: 12, volume: 1 }, { time: 2, open: 12, high: 16, low: 11, close: 15, volume: 1 }];
  const h = transformBars('ha', b, o);
  assert.deepEqual([h[0].open, h[0].close], [11, 11]);
  assert.deepEqual([h[1].open, h[1].close, h[1].high, h[1].low], [11, 13.5, 16, 11]);
  assert.equal(transformBars('candles', b, o), b);
});

test('empty input and ATR box are safe for every type', () => {
  for (const { id } of CHART_TYPES) assert.deepEqual(transformBars(id as ChartType, [], typeDefaults()), []);
  const b = mk(Array.from({ length: 50 }, (_, i) => 100 + 10 * Math.sin(i / 3)));
  for (const id of ['renko', 'kagi', 'pnf', 'range', 'linebreak'] as ChartType[]) assert.ok(increasing(transformBars(id, b, typeDefaults())), id);
});
