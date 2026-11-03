// earnings-calendar: who reports in the coming days among US companies above $2B, grouped by date and BMO / AMC /
// time not announced. The original reads FMP's calendar; without a key the date is ESTIMATED from each company's own
// earnings 8-Ks on SEC (item 2.02): last report + the median gap between its recent reports, same timing as last time.
import type { Ctx, Skill } from './types.ts';
import type { Stock } from './vcp.ts';

const day = (s: string) => Date.parse(`${s}T00:00:00Z`) / 864e5, iso = (d: number) => new Date(d * 864e5).toISOString().slice(0, 10);
/** Estimated next report from past item-2.02 dates (newest first): last + median of the last four gaps. */
export function nextReport(dates: { date: string; timing: string }[]) {
  const ds = [...new Set(dates.map(d => d.date))].sort().reverse(); if (ds.length < 2) return null;
  const gaps = ds.slice(0, 5).map((d, i, a) => (i ? day(a[i - 1]) - day(d) : 0)).slice(1).filter(g => g >= 50 && g <= 200); if (!gaps.length) return null;
  const s = [...gaps].sort((a, b) => a - b), m = s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  return { date: iso(day(ds[0]) + Math.round(m)), timing: dates.find(d => d.date === ds[0])?.timing ?? 'unknown', last: ds[0], gap: Math.round(m) };
}
export const fmtCap = (c: number) => (c >= 1e12 ? `$${(c / 1e12).toFixed(1)}T` : c >= 1e9 ? `$${(c / 1e9).toFixed(1)}B` : c >= 1e6 ? `$${(c / 1e6).toFixed(0)}M` : `$${Math.round(c).toLocaleString()}`);
export const earnCalSkill: Skill = {
  id: 'earnings-calendar', name: 'Earnings calendar (estimated)', group: 'Fundamentals', from: 'earnings-calendar',
  desc: 'Who is likely to report in the coming days among the largest US companies (≥ $2B), by date and before-open / after-close. Dates are estimated from each company\'s past earnings 8-Ks on SEC (last report + its usual gap), so confirm them with the company.',
  inputs: [{ key: 'days', label: 'Next N days', type: 'number', default: 7 }, { key: 'universe', label: 'Universe (largest US stocks)', type: 'number', default: 300 }],
  async run(v, ctx: Ctx) {
    const all = (await ctx.json<Stock[]>('/api/us-stocks')).filter(s => s.cap >= 2e9).slice(0, Math.min(1000, Math.max(10, Number(v.universe) || 300))), n = Math.max(1, Math.min(60, Number(v.days) || 7));
    const today = new Date().toISOString().slice(0, 10), end = iso(day(today) + n), out: { s: Stock; d: string; t: string; last: string; gap: number }[] = []; let i = 0;
    await Promise.all(Array.from({ length: 6 }, async () => { while (i < all.length) { const s = all[i++]; try { const e = nextReport(await ctx.json(`/api/sec/earnings?q=${encodeURIComponent(s.sym)}`)); if (e && e.date >= today && e.date <= end) out.push({ s, d: e.date, t: e.timing, last: e.last, gap: e.gap }) } catch { /* not an SEC filer */ } } }));
    out.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0) || ['bmo', 'amc', 'unknown'].indexOf(a.t) - ['bmo', 'amc', 'unknown'].indexOf(b.t) || b.s.cap - a.s.cap);
    const label: Record<string, string> = { bmo: 'Before market open', amc: 'After market close', unknown: 'Time not announced' };
    return {
      verdict: { label: `${out.length} companies likely to report by ${end}`, tone: 'muted', detail: `${all.length} companies above $2B checked.` },
      tables: [{ title: 'Estimated earnings dates', cols: ['Date (est.)', 'Timing', 'Symbol', 'Company', 'Market cap', 'Sector', 'Last report', 'Usual gap'], rows: out.map(x => [x.d, label[x.t] ?? x.t, x.s.sym, x.s.name, fmtCap(x.s.cap), x.s.sector, x.last, `${x.gap} d`]) }],
      notes: ['ESTIMATED dates: companies move their reports, and some never file an item-2.02 8-K. EPS and revenue estimates are not available without a paid data source.'],
    };
  },
};
