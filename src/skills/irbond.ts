// Iran bond yield (اوراق مشارکت، اجاره، صکوک، اسناد خزانه): the yield to maturity of a fixed-income paper from its
// market price. The price is taken as the full price paid (Iranian papers trade without separate accrued interest),
// coupon dates are counted back from maturity in whole months (actual dates differ by a few days), and years are
// actual days / 365. Taxes are not modelled; a brokerage fee on the purchase can be entered.
import { toGregorian } from '../jalali.ts';
import { money, num, pct, type Skill } from './types.ts';

/** "2027-03-20" or "1405/12/29" (a year below 1700 is read as Jalali) → UTC midnight in ms. */
export function parseDate(s: unknown, name = 'Date'): number {
  const m = /^\s*(\d{4})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{1,2})\s*$/.exec(String(s ?? '').replace(/[۰-۹]/g, c => String(c.charCodeAt(0) - 0x06f0)));
  if (!m) throw new Error(`${name}: use 2027-03-20 or 1405/12/29`);
  const y = +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) throw new Error(`${name}: not a date`);
  if (y < 1700) { const g = toGregorian(y, mo, d); return Date.UTC(g.y, g.m - 1, g.d) }
  const t = Date.UTC(y, mo - 1, d);
  if (new Date(t).getUTCDate() !== d) throw new Error(`${name}: not a date`);
  return t;
}
const addMonths = (t: number, n: number) => { const d = new Date(t), day = d.getUTCDate(); const r = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1)); r.setUTCDate(Math.min(day, new Date(Date.UTC(r.getUTCFullYear(), r.getUTCMonth() + 1, 0)).getUTCDate())); return r.getTime() };
const DAY = 86400_000;

export interface BondIn { price: number; face: number; couponPct: number; perYear: number; settle: number; maturity: number; feePct?: number }
export interface Flow { date: number; days: number; amount: number }
export interface BondOut { ytm: number; simple?: number; currentYield: number; days: number; flows: Flow[]; macaulay: number; modified: number; totalCash: number; profit: number; paid: number }

/** Cash flows after `settle`: coupons counted back from maturity, the face value with the last one. */
export function cashflows(b: Pick<BondIn, 'face' | 'couponPct' | 'perYear' | 'settle' | 'maturity'>): Flow[] {
  const flows: Flow[] = [], c = (b.face * b.couponPct) / 100 / b.perYear;
  if (c > 0) for (let i = 0; ; i++) {
    const t = addMonths(b.maturity, -(12 / b.perYear) * i);
    if (t <= b.settle) break;
    flows.unshift({ date: t, days: Math.round((t - b.settle) / DAY), amount: c });
  }
  const last = flows.at(-1);
  if (last && last.date === b.maturity) last.amount += b.face;
  else flows.push({ date: b.maturity, days: Math.round((b.maturity - b.settle) / DAY), amount: b.face });
  return flows;
}
export function bondYield(b: BondIn): BondOut {
  if (!(b.price > 0) || !(b.face > 0)) throw new Error('Price and face value must be positive');
  if (!(b.maturity > b.settle)) throw new Error('Maturity must be after the settlement date');
  if (![1, 2, 3, 4, 6, 12].includes(b.perYear)) throw new Error('Payments per year: 1, 2, 3, 4, 6 or 12');
  const flows = cashflows(b), paid = b.price * (1 + (b.feePct ?? 0) / 100);
  const pv = (y: number) => flows.reduce((s, f) => s + f.amount / (1 + y) ** (f.days / 365), 0);
  let lo = -0.95, hi = 20;
  if (pv(lo) < paid) throw new Error('The price is absurdly above what the paper pays: check the price');
  if (pv(hi) > paid) throw new Error('Yield above 2000%: check the price and the dates');
  for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2; if (pv(mid) > paid) lo = mid; else hi = mid }
  const y = (lo + hi) / 2, w = flows.map(f => f.amount / (1 + y) ** (f.days / 365)), total = w.reduce((a, x) => a + x, 0);
  const macaulay = w.reduce((s, x, i) => s + (x * flows[i].days) / 365, 0) / total, days = flows.at(-1)!.days, totalCash = flows.reduce((s, f) => s + f.amount, 0);
  return {
    ytm: y * 100, ...(b.couponPct === 0 ? { simple: ((b.face / paid - 1) * 365 * 100) / days } : {}),
    currentYield: (b.face * b.couponPct) / 100 / paid, days, flows, macaulay, modified: macaulay / (1 + y), totalCash, profit: totalCash - paid, paid,
  };
}

export const irBondSkill: Skill = {
  id: 'iran-bond-yield', name: 'Iran bond yield (اوراق)', group: 'Iran market', from: 'built in',
  desc: 'Yield to maturity of an Iranian bond, sukuk or treasury paper from its price: effective annual yield, simple yield for zero-coupon papers (اسناد خزانه), duration and the cash-flow schedule. Dates may be Gregorian (2027-03-20) or Jalali (1405/12/29).',
  inputs: [
    { key: 'price', label: 'Market price (per paper)', type: 'number', default: 850000 },
    { key: 'face', label: 'Face value (per paper)', type: 'number', default: 1000000, hint: 'usually 1,000,000 Rial' },
    { key: 'coupon', label: 'Annual coupon %', type: 'number', default: 0, hint: '0 for treasury papers (اخزا)' },
    { key: 'perYear', label: 'Coupons per year', type: 'select', options: ['1', '2', '3', '4', '6', '12'], default: '4', hint: '4 = every 3 months, 12 = monthly' },
    { key: 'maturity', label: 'Maturity date', type: 'text', default: '1406/06/31' },
    { key: 'settle', label: 'Buy date', type: 'text', optional: true, hint: 'empty = today' },
    { key: 'fee', label: 'Buying fee %', type: 'number', default: 0, optional: true },
  ],
  run(v) {
    const now = new Date(), today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    const r = bondYield({
      price: num(v['price'], 'Price', { min: 0 }), face: num(v['face'], 'Face value', { min: 0 }), couponPct: num(v['coupon'], 'Coupon %', { min: 0, max: 100 }), perYear: Number(v['perYear'] ?? 4),
      maturity: parseDate(v['maturity'], 'Maturity'), settle: String(v['settle'] ?? '').trim() ? parseDate(v['settle'], 'Buy date') : today,
      feePct: num(v['fee'], 'Fee %', { optional: true, min: 0, max: 20 }) || 0,
    });
    return {
      verdict: { label: `${pct(r.ytm)} per year`, tone: r.ytm > 0 ? 'up' : 'dn', detail: `${r.days} days to maturity` },
      kpis: [
        { label: 'Effective annual yield', value: pct(r.ytm) }, ...(r.simple != null ? [{ label: 'Simple annual yield', value: pct(r.simple) }] : []),
        { label: 'Current yield', value: pct(r.currentYield * 100) }, { label: 'Duration (years)', value: r.macaulay.toFixed(2) }, { label: 'Modified duration', value: r.modified.toFixed(2) },
        { label: 'Paid', value: money(r.paid) }, { label: 'Cash received', value: money(r.totalCash) }, { label: 'Profit per paper', value: money(r.profit), tone: r.profit > 0 ? 'up' : 'dn' },
      ],
      tables: [{ title: 'Cash flows', cols: ['Date', 'Days', 'Amount'], rows: r.flows.map(f => [new Date(f.date).toISOString().slice(0, 10), f.days, money(f.amount)]) }],
      notes: ['The market price is treated as the full price paid. Coupon dates are counted back from maturity in whole months; real payment dates can differ by a few days. Taxes are not included.'],
    };
  },
};
