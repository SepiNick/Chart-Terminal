// SEC XBRL company facts → quarterly series (trader-analyst's rules): the latest filing of each period wins, fiscal
// labels from its first filing, 80–100 day periods are quarters, and Q4 is the 10-K year minus its three 10-Qs.
// Shared by the fundamental skills.
import { pyRoundN } from './types.ts';
export interface Fact { start?: string; end: string; val: number; fy?: number; fp?: string; form?: string; filed?: string; accn?: string; frame?: string }
export interface Facts { cik?: number | string; entityName?: string; facts?: Record<string, Record<string, { units?: Record<string, Fact[]> }>> }
export interface Q { value: number; start: string; end: string; derived: boolean; fy?: number; fp?: string; form?: string; filed?: string; concept?: string }
export const CONCEPTS: Record<string, string[]> = {
  revenue: ['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'RevenuesNetOfInterestExpense', 'RevenueFromContractWithCustomerIncludingAssessedTax', 'SalesRevenueNet', 'SalesRevenueGoodsNet', 'SalesRevenueServicesNet'],
  cost_of_revenue: ['CostOfGoodsAndServicesSold', 'CostOfRevenue', 'CostOfGoodsSold'],
  gross_profit: ['GrossProfit'],
  operating_income: ['OperatingIncomeLoss'],
  net_income: ['NetIncomeLoss', 'ProfitLoss', 'NetIncomeLossAvailableToCommonStockholdersBasic'],
  eps_diluted: ['EarningsPerShareDiluted', 'EarningsPerShareBasicAndDiluted'],
};
const day = (s: string) => Date.parse(`${s}T00:00:00Z`) / 864e5;
const iso = (d: number) => new Date(d * 864e5).toISOString().slice(0, 10);
export function factsFor(cf: Facts, concept: string, unitHint?: string, taxonomy = 'us-gaap'): Fact[] {
  const u = cf.facts?.[taxonomy]?.[concept]?.units; if (!u) return [];
  const unit = unitHint && unitHint in u ? unitHint : Object.keys(u)[0];
  return unit ? u[unit] ?? [] : [];
}
const stamp = (f: Fact) => [f.filed ?? '', f.accn ?? ''] as const;
const gt = (a: readonly string[], b: readonly string[]) => a[0] > b[0] || (a[0] === b[0] && a[1] > b[1]);
/** One fact per (start, end): the latest filing's value, with the first filing's fiscal year/period. */
export function periods(facts: Fact[], forms = ['10-Q', '10-K', '20-F', '40-F']) {
  const latest = new Map<string, Fact>(), first = new Map<string, Fact>();
  for (const f of facts) {
    if (!f.start || !forms.includes((f.form ?? '').split('/')[0])) continue;
    const k = `${f.start}|${f.end}`, l = latest.get(k), fi = first.get(k);
    if (!l || gt(stamp(f), stamp(l))) latest.set(k, f);
    if (!fi || gt(stamp(fi), stamp(f))) first.set(k, f);
  }
  return new Map([...latest].map(([k, f]) => [k, { ...f, fy: first.get(k)!.fy, fp: first.get(k)!.fp, firstFiled: first.get(k)!.filed }]));
}
export function quarterly(facts: Fact[], deriveQ4 = true) {
  const q = new Map<string, Q>(), years: Fact[] = [];
  for (const f of periods(facts).values()) {
    const d = day(f.end) - day(f.start!);
    if (d >= 80 && d <= 100) q.set(f.end, { value: f.val, start: f.start!, end: f.end, derived: false, fy: f.fy, fp: f.fp, form: f.form, filed: f.filed });
    else if (d >= 350 && d <= 380) years.push(f);
  }
  if (deriveQ4) for (const f of years) {
    if (q.has(f.end)) continue;
    const inside = [...q.values()].filter(v => v.start >= f.start! && v.end < f.end).sort((a, b) => (a.end < b.end ? -1 : 1));
    if (inside.length !== 3) continue;
    q.set(f.end, { value: f.val - inside.reduce((s, v) => s + v.value, 0), start: iso(day(inside[2].end) + 1), end: f.end, derived: true, fy: f.fy, fp: 'Q4', form: f.form, filed: f.filed });
  }
  return q;
}
/** A metric's quarters, first concept that has a quarter wins (later concepts only fill gaps). */
export function series(cf: Facts, key: string, deriveQ4 = true) {
  const unit = key === 'eps_diluted' ? 'USD/shares' : 'USD', merged = new Map<string, Q>(), used: string[] = [];
  for (const c of CONCEPTS[key]) {
    const q = quarterly(factsFor(cf, c, unit), deriveQ4); if (!q.size) continue;
    let added = false; for (const [e, v] of q) if (!merged.has(e)) { merged.set(e, { ...v, concept: c }); added = true }
    if (added) used.push(c);
  }
  return { s: merged, used };
}
export function yoyMatch(s: Map<string, Q>, end: string, days = 365, slack = 10) {
  const t = day(end) - days; let best: [number, string] | null = null;
  for (const e of s.keys()) { const g = Math.abs(day(e) - t); if (g <= slack && (!best || g < best[0])) best = [g, e] }
  return best ? s.get(best[1])! : null;
}
const r1 = (x: number) => pyRoundN(x, 1), r2 = (x: number) => pyRoundN(x, 2);
export const pctChg = (a: number | null | undefined, b: number | null | undefined) => (a == null || b == null || b === 0 ? null : r1(100 * (a - b) / Math.abs(b)));
const margin = (p: number | null | undefined, w: number | null | undefined) => (p == null || !w ? null : r1(100 * p / w));
export interface Row { end: string; start?: string; fiscal: string; derived: boolean; revenue: number | null; gross_profit: number | null; operating_income: number | null; net_income: number | null; eps_diluted: number | null; gross_margin: number | null; operating_margin: number | null; net_margin: number | null; revenue_yoy: number | null; net_income_yoy: number | null; eps_yoy: number | null; filed?: string; form?: string }
export function analyse(cf: Facts, quarters = 6) {
  const s: Record<string, Map<string, Q>> = {}, concepts: Record<string, string[]> = {};
  for (const k of Object.keys(CONCEPTS)) { const r = series(cf, k); s[k] = r.s; concepts[k] = r.used }
  const rev = s.revenue;
  if (!rev.size && !s.net_income.size) throw new Error('No quarterly revenue or net income in the SEC facts');
  const ends = [...new Set([...rev.keys(), ...s.net_income.keys()])].sort().reverse().slice(0, quarters);
  const rows: Row[] = ends.map(end => {
    const r = rev.get(end)?.value ?? null; let gp = s.gross_profit.get(end)?.value ?? null;
    if (gp == null && r != null && s.cost_of_revenue.has(end)) gp = r - s.cost_of_revenue.get(end)!.value;
    const oi = s.operating_income.get(end)?.value ?? null, ni = s.net_income.get(end)?.value ?? null, eps = s.eps_diluted.get(end)?.value ?? null;
    const base = rev.get(end) ?? s.net_income.get(end);
    return { end, start: base?.start, fiscal: `${base?.fp ?? ''} ${base?.fy ?? ''}`, derived: !!(s.revenue.get(end)?.derived || s.net_income.get(end)?.derived), revenue: r, gross_profit: gp, operating_income: oi, net_income: ni,
      eps_diluted: eps != null ? r2(eps) : null, gross_margin: margin(gp, r), operating_margin: margin(oi, r), net_margin: margin(ni, r),
      revenue_yoy: pctChg(r, yoyMatch(rev, end)?.value), net_income_yoy: pctChg(ni, yoyMatch(s.net_income, end)?.value), eps_yoy: pctChg(eps, yoyMatch(s.eps_diluted, end)?.value), filed: base?.filed, form: base?.form };
  });
  const ttm: Record<string, number> = {};
  for (const k of ['revenue', 'net_income', 'eps_diluted']) { const l4 = [...s[k].keys()].sort().slice(-4); if (l4.length === 4 && day(l4[3]) - day(l4[0]) < 300) ttm[k] = l4.reduce((a, e) => a + s[k].get(e)!.value, 0) }
  if ('eps_diluted' in ttm) ttm.eps_diluted = r2(ttm.eps_diluted);
  return { entity: cf.entityName, cik: String(cf.cik ?? '').padStart(10, '0'), rows, ttm, concepts, series: s };
}
export function changes(res: ReturnType<typeof analyse>) {
  const [cur, prev] = res.rows; if (!cur) return [];
  const money = (v: number | null) => (v == null ? 'n/a' : Math.abs(v) >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : `$${(v / 1e6).toFixed(1)}M`), sg = (x: number) => `${x >= 0 ? '+' : ''}${x.toFixed(1)}`;
  let line = `Quarter ending ${cur.end}${cur.derived ? ' (derived from the 10-K)' : ''}: revenue ${money(cur.revenue)}`;
  if (cur.revenue_yoy != null) line += ` (${sg(cur.revenue_yoy)}% vs a year earlier)`;
  line += `, net income ${money(cur.net_income)}`; if (cur.net_income_yoy != null) line += ` (${sg(cur.net_income_yoy)}%)`;
  if (cur.eps_diluted != null) { line += `, diluted EPS $${cur.eps_diluted.toFixed(2)}`; if (cur.eps_yoy != null) line += ` (${sg(cur.eps_yoy)}%)` }
  const out = [`${line}.`];
  for (const [k, n] of [['gross_margin', 'Gross margin'], ['operating_margin', 'Operating margin'], ['net_margin', 'Net margin']] as const) { if (cur[k] == null) continue; out.push(`${n} ${cur[k]!.toFixed(1)}%${prev && prev[k] != null ? ` (${sg(cur[k]! - prev[k]!)} points vs the quarter before)` : ''}.`) }
  if (cur.net_income != null && cur.operating_income != null && cur.net_income > cur.operating_income) out.push('Net income is above operating income: it includes gains outside the business (investments, tax items). Check the 10-Q before reading it as growth.');
  if (prev && cur.revenue != null && prev.revenue) out.push(`Revenue ${sg(pctChg(cur.revenue, prev.revenue)!)}% vs the quarter before (many businesses are seasonal: compare with a year earlier first).`);
  return out;
}
/** Latest 10-Q/10-K and earnings 8-K (item 2.02) from a submissions record. */
export function latestFilings(sub: { filings?: { recent?: Record<string, string[]> } }, cik: string) {
  const r = sub.filings?.recent ?? {}, out: { report: null | { form: string; filed: string; period: string; url: string }; earnings8k: null | { filed: string; url: string; acc: string } } = { report: null, earnings8k: null };
  (r.form ?? []).forEach((form, i) => {
    const acc = r.accessionNumber[i], folder = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${acc.replace(/-/g, '')}/`;
    if (!out.report && ['10-Q', '10-K', '20-F', '40-F'].includes(form)) out.report = { form, filed: r.filingDate[i], period: r.reportDate[i], url: folder + r.primaryDocument[i] };
    if (!out.earnings8k && form === '8-K' && (r.items?.[i] ?? '').includes('2.02')) out.earnings8k = { filed: r.filingDate[i], url: `${folder}${acc}-index.htm`, acc };
  });
  return out;
}
