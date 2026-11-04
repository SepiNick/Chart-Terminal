import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmtJalali, isJalaliLeap, jalaliIn, jalaliMonthLength, jalaliMonthStart, jalaliUtc, toGregorian, toJalali, utcOfJalali } from './jalali.ts';

test('known dates: Nowruz and year ends', () => {
  assert.deepEqual(toJalali(2025, 3, 21), { y: 1404, m: 1, d: 1 });
  assert.deepEqual(toJalali(2026, 3, 21), { y: 1405, m: 1, d: 1 });
  assert.deepEqual(toJalali(2026, 11, 4), { y: 1405, m: 8, d: 13 });
  assert.deepEqual(toGregorian(1403, 12, 30), { y: 2025, m: 3, d: 20 });   // 1403 is a leap year: Esfand has 30 days
  assert.deepEqual(toGregorian(1404, 1, 1), { y: 2025, m: 3, d: 21 });
  assert.ok(isJalaliLeap(1403) && !isJalaliLeap(1404));
  assert.deepEqual([jalaliMonthLength(1404, 1), jalaliMonthLength(1404, 7), jalaliMonthLength(1404, 12), jalaliMonthLength(1403, 12)], [31, 30, 29, 30]);
});

test('every day from 1990 to 2060 matches the browser calendar and round-trips', () => {
  const f = new Intl.DateTimeFormat('en-u-ca-persian-nu-latn', { timeZone: 'UTC', year: 'numeric', month: 'numeric', day: 'numeric' });
  for (let t = Date.UTC(1990, 0, 1); t < Date.UTC(2060, 0, 1); t += 86400_000) {
    const p = Object.fromEntries(f.formatToParts(t).map(x => [x.type, +x.value]));
    const d = new Date(t), j = toJalali(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    assert.deepEqual([j.y, j.m, j.d], [p['year'], p['month'], p['day']], d.toISOString());
    const g = toGregorian(j.y, j.m, j.d);
    assert.deepEqual([g.y, g.m, g.d], [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()]);
  }
});

test('month start buckets and time-zone aware formatting', () => {
  const t = Date.UTC(2026, 10, 4) / 1000;   // 13 Aban 1405
  assert.equal(jalaliMonthStart(t), Date.UTC(2026, 9, 23) / 1000);   // 1 Aban 1405 = 23 Oct 2026
  assert.equal(utcOfJalali(1405, 8, 1), Date.UTC(2026, 9, 23) / 1000);
  assert.equal(fmtJalali(jalaliUtc(t)), '1405/08/13');
  // 21:00 UTC on 20 March is already 21 March (00:30) in Tehran: Nowruz 1405 there, the last day of 1404 in UTC.
  const late = Date.UTC(2026, 2, 20, 21, 0) / 1000;
  assert.equal(fmtJalali(jalaliIn(late, 'UTC')), '1404/12/29');
  assert.equal(fmtJalali(jalaliIn(late, 'Asia/Tehran')), '1405/01/01');
  assert.equal(jalaliIn(late, 'Asia/Tehran').wd, 6, '21 March 2026 is a Saturday');
});
