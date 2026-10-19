import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BookHistory, Footprint, aggregatePrints, autoRow, barStats, bigPrints, imbalances, type Print } from './model.ts';

const p = (t: number, px: number, qty: number, buy: boolean): Print => ({ t, px, qty, buy });

test('footprint: prints land in the right bar and row; delta, CVD and POC', () => {
  const fp = new Footprint(60, 1);
  fp.add([p(0.1, 100.2, 2, true), p(1, 100.7, 1, false), p(5, 101.5, 3, true), p(61, 99.4, 4, false), p(62, 99.9, 1, true)]);
  assert.equal(fp.bars.size, 2);
  const a = fp.bars.get(0)!, b = fp.bars.get(60)!;
  assert.deepEqual(a.cells.get(100), { bid: 1, ask: 2, n: 2 });
  assert.deepEqual(a.cells.get(101), { bid: 0, ask: 3, n: 1 });
  assert.equal(a.buy - a.sell, 4);
  assert.equal(a.cvdClose, 4); assert.equal(b.cvdOpen, 4); assert.equal(b.cvdClose, 1); assert.equal(b.cvdLow, 0);
  assert.equal(barStats(a).poc, 100);   // 3 at row 100 vs 3 at row 101 → first max wins
  // changing the row size rebuilds from raw prints
  fp.rebuild(2);
  assert.deepEqual(fp.bars.get(0)!.cells.get(50), { bid: 1, ask: 5, n: 3 });
  // backfill keeps CVD continuous
  fp.prepend([p(-0.5, 100, 10, false)]);
  assert.equal(fp.bars.get(60)!.cvdClose, -9);
});

test('imbalances: diagonal comparison and stacking', () => {
  const fp = new Footprint(60, 1);
  // rows 10..13: heavy buying at 11,12,13 against little selling one row below
  fp.add([p(0, 10, 1, false), p(0, 11, 1, false), p(0, 12, 1, false), p(0, 11, 5, true), p(0, 12, 6, true), p(0, 13, 9, true), p(0, 10, 1, true)]);
  const im = imbalances(fp.bars.get(0)!, 3, 3);
  const buys = im.filter(x => x.side === 'buy').map(x => x.bin).sort();
  assert.deepEqual(buys, [11, 12, 13]);
  assert.ok(im.filter(x => x.side === 'buy').every(x => x.stacked));
});

test('autoRow picks a nice step; aggregatePrints merges one taker order; big prints', () => {
  assert.equal(autoRow([240, 260, 250], 25), 10);
  assert.equal(autoRow([0.012, 0.013], 24), 0.0005);
  const merged = aggregatePrints([p(1.0001, 100, 1, true), p(1.0002, 101, 3, true), p(1.0002, 101, 1, false), p(2, 100, 1, false)]);
  assert.equal(merged.length, 3);
  assert.equal(merged[0].qty, 4); assert.equal(merged[0].px, 100.75);
  const many = [...Array.from({ length: 999 }, (_, i) => p(i, 100, 1, i % 2 === 0)), p(1000, 100, 50, true)];
  assert.deepEqual(bigPrints(many).map(x => x.qty), [50]);
  assert.equal(bigPrints(many, 200).length, 1);
});

test('book history keeps one snapshot per interval and a robust scale', () => {
  const h = new BookHistory(1, 10);
  for (let i = 0; i < 30; i++) h.push({ t: i * 0.5, bids: [[99, i]], asks: [[101, 1]] });
  assert.ok(h.snaps.length >= 10 && h.snaps.length <= 12, String(h.snaps.length));   // 10 s kept, one per second
  assert.ok(h.snaps[0].t >= 4.5);
  assert.ok(h.scale() > 0);
});
