import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bondYield, cashflows, irBondSkill, parseDate } from './irbond.ts';

const D = (s: string) => Date.parse(s);
test('dates: Gregorian, Jalali, Persian digits, bad input', () => {
  assert.equal(parseDate('2027-03-20'), D('2027-03-20'));
  assert.equal(parseDate('1405/12/29'), D('2027-03-20'));
  assert.equal(parseDate('۱۴۰۵/۱۲/۲۹'), D('2027-03-20'));
  assert.equal(parseDate('1404-01-01'), D('2025-03-21'));
  assert.throws(() => parseDate('2027-02-30'), /not a date/);
  assert.throws(() => parseDate('soon'), /use 2027-03-20/);
});

test('zero-coupon paper: yield from price, simple yield, duration equals time to maturity', () => {
  const r = bondYield({ price: 800_000, face: 1_000_000, couponPct: 0, perYear: 4, settle: D('2026-01-01'), maturity: D('2027-01-01') });
  assert.equal(r.days, 365);
  assert.ok(Math.abs(r.ytm - 25) < 1e-6, String(r.ytm));
  assert.ok(Math.abs(r.simple! - 25) < 1e-9);
  assert.ok(Math.abs(r.macaulay - 1) < 1e-9 && Math.abs(r.modified - 0.8) < 1e-6);
  assert.deepEqual([r.totalCash, r.profit], [1_000_000, 200_000]);
});

test('coupon paper: par price gives the coupon rate; discount raises it; fee lowers it', () => {
  const base = { face: 1_000_000, couponPct: 18, perYear: 1, settle: D('2026-01-01'), maturity: D('2027-01-01') };
  assert.ok(Math.abs(bondYield({ ...base, price: 1_000_000 }).ytm - 18) < 1e-6);
  assert.ok(bondYield({ ...base, price: 950_000 }).ytm > 18);
  assert.ok(bondYield({ ...base, price: 1_000_000, feePct: 1 }).ytm < 18);
  assert.ok(Math.abs(bondYield({ ...base, price: 1_000_000 }).currentYield - 0.18) < 1e-12);
});

test('quarterly coupons are counted back from maturity, the face value comes with the last one', () => {
  const f = cashflows({ face: 1_000_000, couponPct: 20, perYear: 4, settle: D('2026-02-15'), maturity: D('2027-01-31') });
  assert.deepEqual(f.map(x => new Date(x.date).toISOString().slice(0, 10)), ['2026-04-30', '2026-07-31', '2026-10-31', '2027-01-31']);
  assert.deepEqual(f.map(x => x.amount), [50_000, 50_000, 50_000, 1_050_000]);
  assert.equal(cashflows({ face: 100, couponPct: 0, perYear: 4, settle: D('2026-01-01'), maturity: D('2026-06-01') }).length, 1);
});

test('refusals: dates, absurd prices and yields; a price above the cash paid is a negative yield', () => {
  const b = { price: 800_000, face: 1_000_000, couponPct: 0, perYear: 4, settle: D('2026-01-01'), maturity: D('2027-01-01') };
  assert.throws(() => bondYield({ ...b, maturity: b.settle }), /after the settlement/);
  assert.ok(bondYield({ ...b, price: 1_200_000 }).ytm < 0, 'paying more than you get back');
  assert.throws(() => bondYield({ ...b, price: 1e10 }), /absurdly above/);
  assert.throws(() => bondYield({ ...b, price: 1, face: 1_000_000 }), /Yield above 2000%/);
  assert.throws(() => bondYield({ ...b, perYear: 5 }), /Payments per year/);
});

test('the skill runs from form values (Jalali maturity) and formats a verdict', () => {
  const out = irBondSkill.run({ price: 800000, face: 1000000, coupon: 0, perYear: '4', maturity: '1405/12/29', settle: '1404/12/29', fee: 0 }, {} as never) as { verdict: { label: string }; kpis: { label: string }[] };
  assert.match(out.verdict.label, /per year/);
  assert.ok(out.kpis.some(k => k.label === 'Simple annual yield'));
});
