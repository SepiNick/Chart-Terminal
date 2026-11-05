// Persian (Jalali) calendar: exact date arithmetic for bucketing monthly bars, plus Intl-based formatting for the
// chart axis. The conversion is the 33-year-cycle algorithm; the tests compare it with the browser's own
// `ca-persian` calendar over several decades, so any drift shows up there.

export const JALALI_MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
/** Index 0 = Sunday (JS getUTCDay order). The Iranian week starts on Saturday. */
export const JALALI_WEEKDAYS = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه'];

const div = (a: number, b: number) => Math.trunc(a / b), mod = (a: number, b: number) => a - Math.trunc(a / b) * b;
const BREAKS = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];

function jalCal(jy: number): { leap: number; gy: number; march: number } {
  const bl = BREAKS.length, gy = jy + 621;
  let leapJ = -14, jp = BREAKS[0], jump = 0, i: number;
  if (jy < jp || jy >= BREAKS[bl - 1]) throw Error(`Jalali year out of range: ${jy}`);
  for (i = 1; i < bl; i++) {
    const jm = BREAKS[i];
    jump = jm - jp;
    if (jy < jm) break;
    leapJ += div(jump, 33) * 8 + div(mod(jump, 33), 4);
    jp = jm;
  }
  let n = jy - jp;
  leapJ += div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
  if (mod(jump, 33) === 4 && jump - n === 4) leapJ++;
  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150, march = 20 + leapJ - leapG;
  if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
  let leap = mod(mod(n + 1, 33) - 1, 4);
  if (leap === -1) leap = 4;
  return { leap, gy, march };
}
const g2d = (gy: number, gm: number, gd: number) => {
  let d = div((gy + div(gm - 8, 6) + 100100) * 1461, 4) + div(153 * mod(gm + 9, 12) + 2, 5) + gd - 34840408;
  d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
  return d;
};
function d2g(jdn: number) {
  let j = 4 * jdn + 139361631;
  j += div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  const i = div(mod(j, 1461), 4) * 5 + 308, gd = div(mod(i, 153), 5) + 1, gm = mod(div(i, 153), 12) + 1, gy = div(j, 1461) - 100100 + div(8 - gm, 6);
  return { gy, gm, gd };
}
const j2d = (jy: number, jm: number, jd: number) => g2d(jalCal(jy).gy, 3, jalCal(jy).march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
function d2j(jdn: number) {
  const gy = d2g(jdn).gy;
  let jy = gy - 621;
  const r = jalCal(jy), jdn1f = g2d(gy, 3, r.march);
  let k = jdn - jdn1f;
  if (k >= 0) {
    if (k <= 185) return { jy, jm: 1 + div(k, 31), jd: mod(k, 31) + 1 };
    k -= 186;
  } else {
    jy -= 1; k += 179;
    if (r.leap === 1) k++;
  }
  return { jy, jm: 7 + div(k, 30), jd: mod(k, 30) + 1 };
}

export interface Ymd { y: number; m: number; d: number }
/** Gregorian calendar date → Jalali. */
export const toJalali = (gy: number, gm: number, gd: number): Ymd => { const r = d2j(g2d(gy, gm, gd)); return { y: r.jy, m: r.jm, d: r.jd } };
/** Jalali calendar date → Gregorian. */
export const toGregorian = (jy: number, jm: number, jd: number): Ymd => { const r = d2g(j2d(jy, jm, jd)); return { y: r.gy, m: r.gm, d: r.gd } };
export const isJalaliLeap = (jy: number) => jalCal(jy).leap === 0;
export const jalaliMonthLength = (jy: number, jm: number) => (jm <= 6 ? 31 : jm <= 11 ? 30 : isJalaliLeap(jy) ? 30 : 29);

/** Jalali date of a UTC instant (seconds). The date is the UTC calendar date: use `jalaliIn` for a time zone. */
export function jalaliUtc(tSec: number): Ymd {
  const d = new Date(tSec * 1000);
  return toJalali(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}
/** UTC midnight (seconds) of a Jalali date. */
export const utcOfJalali = (jy: number, jm: number, jd: number) => { const g = toGregorian(jy, jm, jd); return Date.UTC(g.y, g.m - 1, g.d) / 1000 };
/** UTC midnight of the first day of the Jalali month that contains `tSec`. */
export const jalaliMonthStart = (tSec: number) => { const j = jalaliUtc(tSec); return utcOfJalali(j.y, j.m, 1) };

const fmtCache = new Map<string, Intl.DateTimeFormat>();
/** Jalali date and weekday of an instant as seen in `tz` (browser calendar data; Latin digits). */
export function jalaliIn(tSec: number, tz = 'UTC'): Ymd & { wd: number } {
  let f = fmtCache.get(tz);
  if (!f) {
    try { f = new Intl.DateTimeFormat('en-u-ca-persian-nu-latn', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short' }) }
    catch { f = new Intl.DateTimeFormat('en-u-ca-persian-nu-latn', { year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short' }) }
    fmtCache.set(tz, f);
  }
  const p = Object.fromEntries(f.formatToParts(tSec * 1000).map(x => [x.type, x.value]));
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p['weekday']);
  return { y: +p['year'], m: +p['month'], d: +p['day'], wd: wd < 0 ? 0 : wd };
}
const p2 = (n: number) => String(n).padStart(2, '0');
/** 1405/08/13 */
export const fmtJalali = (j: Ymd) => `${j.y}/${p2(j.m)}/${p2(j.d)}`;
