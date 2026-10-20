import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sessions, tpo, volumeProfile, TPO_LETTERS } from './profile.ts';
import { Footprint } from './model.ts';
import type { Bar } from '../data.ts';

const bar = (time: number, low: number, high: number, volume = 0): Bar => ({ time, open: low, high, low, close: high, volume });
const DAY = 86400;

test('sessions split on UTC days; weekly sessions start on Monday', () => {
  const s = sessions([bar(DAY - 60, 1, 2), bar(DAY, 1, 2), bar(DAY + 60, 1, 2)], DAY);
  assert.deepEqual(s.map(x => [x.start, x.bars.length]), [[0, 1], [DAY, 2]]);
  assert.equal(sessions([bar(4 * DAY + 5, 1, 2)], 7 * DAY)[0].start, 4 * DAY);   // 1970-01-05 was a Monday
});

test('TPO: letters per period, POC, value area, initial balance, single prints', () => {
  const H = 1800, D = 0;
  const t = tpo([
    bar(D, 100, 103),             // A: 100–103
    bar(D + 900, 101, 102),        // still A
    bar(D + H, 102, 104),          // B
    bar(D + 2 * H, 102, 103),      // C
    bar(D + 3 * H, 106, 108),      // D: rallies away → 106–108 traded by D only
  ], D, H, 1);
  assert.equal(t.periods, 4);
  assert.deepEqual(t.rows.get(102), [0, 1, 2]);
  assert.deepEqual(t.rows.get(100), [0]);
  assert.equal(TPO_LETTERS[t.rows.get(104)![0]], 'B');
  assert.equal(t.poc, 102);
  assert.deepEqual([t.ibLo, t.ibHi], [100, 104]);
  assert.deepEqual(t.singles, [100, 101, 106, 107, 108]);   // A's tail and D's rally (105 was never traded)
  assert.ok(t.val <= 102 && t.vah >= 103);
});

test('volume profile: footprint where it covers a bar, candle volume spread elsewhere', () => {
  const fp = new Footprint(60, 1);
  fp.add([{ t: 60, px: 100.5, qty: 4, buy: true }, { t: 61, px: 101.5, qty: 1, buy: false }]);
  const vp = volumeProfile([bar(0, 100, 101, 10), bar(60, 100, 102, 999)], 1, fp);
  assert.equal(vp.rows.get(100), 5 + 4);   // half the candle's 10 + footprint 4
  assert.equal(vp.rows.get(101), 5 + 1);
  assert.equal(vp.rows.get(102), undefined);   // the candle range of the covered bar is ignored
  assert.equal(vp.total, 15); assert.equal(vp.poc, 100);
});
