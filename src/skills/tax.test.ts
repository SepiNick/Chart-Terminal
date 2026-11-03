import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anniversary, disallowed, harvest, lotsFromFills, simulateSale, washCheck, type Lot } from './tax.ts';

const LOTS: Lot[] = [{ id: 'KO-1', sym: 'KO', date: '2024-03-01', shares: 10, cost: 600 }, { id: 'KO-2', sym: 'KO', date: '2025-06-01', shares: 5, cost: 350 }, { id: 'KO-3', sym: 'KO', date: '2026-10-15', shares: 4, cost: 260 }];
// Golden values: the original trader-tax lots.py on the same lots.
test('sales by FIFO / highest cost / specific lots and the wash sale match trader-tax', () => {
  const f = simulateSale(LOTS, 'KO', 12, 62, '2026-10-30');
  assert.deepEqual([f.proceeds, f.basis, f.gain, f.short, f.long], [744, 740, 4, 0, 4]);
  assert.deepEqual(f.used.map(u => [u.id, u.shares, u.term]), [['KO-1', 10, 'long'], ['KO-2', 2, 'long']]);
  const h = simulateSale(LOTS, 'KO', 12, 62, '2026-10-30', 'hifo');
  assert.deepEqual([h.basis, h.gain, h.short, h.long].map(x => Math.round(x * 100) / 100), [790, -46, -12, -34]);
  assert.deepEqual(h.used.map(u => u.id), ['KO-2', 'KO-3', 'KO-1']);
  const s = simulateSale(LOTS, 'KO', 5, 62, '2026-10-30', 'specific', ['KO-2']), w = washCheck(LOTS, 'KO', '2026-10-30', s.used);
  assert.equal(s.gain, -40); assert.deepEqual(w.map(x => [x.lot, x.shares]), [['KO-3', 4]]); assert.equal(disallowed(s.gain, 5, w), 32);
  assert.equal(anniversary('2024-02-29'), '2025-02-28');
  assert.throws(() => simulateSale(LOTS, 'KO', 20, 62, '2026-10-30'), /only 19 held/);
});
test('lots from fills: sells close the oldest lots; harvest finds losing lots', () => {
  const day = (d: string) => Date.parse(d);
  const lots = lotsFromFills([{ sym: 'X', side: 'buy', qty: 2, px: 100, fee: 0, ts: day('2026-01-01') }, { sym: 'X', side: 'buy', qty: 2, px: 50, fee: 0, ts: day('2026-02-01') }, { sym: 'X', side: 'sell', qty: 3, px: 80, fee: 0, ts: day('2026-03-01') }]);
  assert.deepEqual(lots.map(l => [l.id, l.shares, l.cost]), [['X-2', 1, 50]]);
  const hv = harvest(LOTS, { KO: 55 }, '2026-10-30', 10);
  assert.equal(hv.length, 1); assert.equal(hv[0].shares, 19); assert.equal(hv[0].wash.length, 0, 'every lot sold: nothing left to trigger a wash sale');
  assert.equal(harvest(LOTS, { KO: 66 }, '2026-10-30', 1)[0].shares, 5, 'only KO-2 (70/unit) loses at 66');
});
