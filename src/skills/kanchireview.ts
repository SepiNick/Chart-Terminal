// kanchi-dividend-review-monitor and kanchi-dividend-us-tax-accounting. The monitor runs the original's forced-review
// triggers T1–T6 (dividend cut, payout coverage, credit stress, filing red flags, structural decline, policy change)
// and gives OK / WARN / REVIEW — never a sale. The tax sheet classifies dividends as qualified-likely or
// ordinary-likely by instrument and holding period and hints at account location. Inputs are built from the app's
// data (Yahoo dividends, SEC 10-K facts and 8-K items); anything missing simply does not trigger.
import type { Ctx, Skill } from './types.ts';
import { factsFor, periods, type Facts, annuals } from './secfacts.ts';
import { basis, type Pay } from './kanchi.ts';

type R = Record<string, unknown>;
export interface Finding { trigger: string; status: 'WARN' | 'REVIEW'; reason: string }
const num = (v: unknown) => { if (v == null || typeof v === 'boolean') return v === true ? 1 : v === false ? 0 : null; const n = Number(v); return Number.isFinite(n) ? n : null };
const hist = (v: unknown) => (Array.isArray(v) ? v.map(num).filter((x): x is number => x != null) : []);
const o = (v: unknown) => (v && typeof v === 'object' ? v as R : {});
export function t1(h: R): Finding | null {
  const d = o(h.dividend), latest = num(d.latest_regular), prior = num(d.prior_regular);
  if (d.is_missing) return { trigger: 'T1', status: 'REVIEW', reason: 'Dividend data missing; suspension or data integrity issue possible.' };
  if (latest != null && latest <= 0) return { trigger: 'T1', status: 'REVIEW', reason: 'Latest regular dividend is zero.' };
  if (latest != null && prior != null && prior > 0 && latest < prior * 0.99) return { trigger: 'T1', status: 'REVIEW', reason: 'Latest regular dividend is lower than prior regular dividend by more than 1%.' };
  return null;
}
export function t2(h: R): Finding | null {
  const cf = o(h.cashflow), key = ({ stock: 'fcf', etf: 'fcf', reit: 'ffo', bdc: 'nii' } as R)[String(h.instrument_type ?? 'stock').toLowerCase()] as string ?? 'fcf';
  const den = num(cf[key]), paid = num(cf.dividends_paid), rh = hist(cf.coverage_ratio_history);
  if (den != null && paid != null && den <= 0 && paid > 0) return { trigger: 'T2', status: 'REVIEW', reason: 'Distribution is positive while denominator is non-positive.' };
  const cur = den != null && paid != null && den > 0 ? paid / den : null;
  if (rh.length >= 2 && rh.at(-1)! > 1 && rh.at(-2)! > 1) return { trigger: 'T2', status: 'REVIEW', reason: 'Coverage ratio above 1.0 for two consecutive periods.' };
  if (cur != null && cur > 1) return rh.length && rh.at(-1)! > 1 ? { trigger: 'T2', status: 'REVIEW', reason: 'Coverage ratio above 1.0 for two consecutive periods.' } : { trigger: 'T2', status: 'WARN', reason: 'Current period payout coverage ratio exceeds 1.0.' };
  if (rh.length >= 2 && rh.at(-1)! > 0.8 && rh.at(-1)! > rh.at(-2)!) return { trigger: 'T2', status: 'WARN', reason: 'Coverage ratio is above 0.8 and still rising.' };
  return null;
}
export function t3(h: R): Finding | null {
  const bs = o(h.balance_sheet), cap = o(h.capital_returns), cf = o(h.cashflow), nd = hist(bs.net_debt_history), ic = hist(bs.interest_coverage_history);
  const bb = num(cap.buybacks) || 0, paid = num(cap.dividends_paid) || num(cf.dividends_paid) || 0, fcf = num(cap.fcf) ?? num(cf.fcf);
  const up = nd.length >= 3 && nd.slice(-3).every((x, i, w) => i === 0 || w[i - 1] < x), down = ic.length >= 2 && ic.at(-1)! < ic.at(-2)!, weak = ic.length >= 1 && ic.at(-1)! < 2.5, stretch = fcf != null && fcf > 0 && bb + paid > fcf * 1.1;
  if (up && (down || weak || stretch)) return { trigger: 'T3', status: 'REVIEW', reason: 'Debt trend worsens with weakening coverage or aggressive capital returns.' };
  if (up || (down && weak)) return { trigger: 'T3', status: 'WARN', reason: 'Early proxy credit stress detected.' };
  return null;
}
export function t4(h: R): Finding | null {
  const f = o(h.filings), text = ['recent_text', 'latest_8k_text', 'headlines'].flatMap(k => (typeof f[k] === 'string' ? [f[k] as string] : Array.isArray(f[k]) ? (f[k] as unknown[]).map(String) : [])).join(' ').toLowerCase();
  if (!text) return null;
  return ['item 4.02', 'non-reliance', 'restatement', 'material weakness', 'sec investigation'].some(k => text.includes(k)) ? { trigger: 'T4', status: 'REVIEW', reason: 'Potential governance/accounting red-flag keywords found in filings text.' } : null;
}
export function t5(h: R): Finding | null {
  const op = o(h.operations), c = num(op.revenue_cagr_5y);
  const s = (c != null && c < 0 ? 1 : 0) + (String(op.margin_trend ?? '').toLowerCase() === 'down' ? 1 : 0) + (String(op.guidance_trend ?? '').toLowerCase() === 'down' ? 1 : 0) + (op.dividend_growth_stalled ? 1 : 0);
  return s >= 3 ? { trigger: 'T5', status: 'REVIEW', reason: 'Multiple structural decline factors are active.' } : s >= 2 ? { trigger: 'T5', status: 'WARN', reason: 'Structural decline score indicates rising business-model risk.' } : null;
}
export function t6(h: R): Finding | null {
  const d = o(h.dividend), f = d.flags && typeof d.flags === 'object' ? d.flags as R : d;
  if (f.cut_flag) return { trigger: 'T6', status: 'REVIEW', reason: 'Regular dividend rate declined year-over-year (cut).' };
  if (f.variable_policy_flag) return { trigger: 'T6', status: 'REVIEW', reason: 'Payout is a variable % of profit; not a reliable income base.' };
  if (f.freeze_flag) return { trigger: 'T6', status: 'WARN', reason: 'Dividend held flat: pause optional adds and re-underwrite the growth thesis.' };
  if (f.special_dividend_flag) return { trigger: 'T6', status: 'WARN', reason: 'Headline/TTM yield inflated by a special; check the regular-only yield before any add.' };
  return null;
}
export function evaluate(h: R) {
  const findings = [t1, t2, t3, t4, t5, t6].map(f => f(h)).filter((x): x is Finding => !!x), rank = { OK: 0, WARN: 1, REVIEW: 2 };
  const status = findings.reduce<'OK' | 'WARN' | 'REVIEW'>((s, f) => (rank[f.status] > rank[s] ? f.status : s), 'OK');
  return { ticker: String(h.ticker ?? '').toUpperCase().trim(), status, actions: status === 'REVIEW' ? ['pause_buy_adds', 'create_review_ticket', 'human_read_full_disclosure'] : status === 'WARN' ? ['pause_buy_adds_optional', 'append_next_earnings_checklist'] : [], findings };
}
/** One holding's monitor input from the app's data. */
export function holdingInput(ticker: string, divs: Pay[], cf: Facts | null, sub: { filings?: { recent?: Record<string, string[]> } } | null, today: string): R {
  const b = basis(divs, null, { asOf: today }), regular = divs.length ? b : null, ann = cf ? annuals(cf, 6).reverse() : [];
  const flow = (c: string) => { const m = new Map<string, number>(); if (cf) for (const f of periods(factsFor(cf, c, 'USD'), ['10-K']).values()) { const d = (Date.parse(f.end) - Date.parse(f.start!)) / 864e5; if (d >= 350 && d <= 380 && !m.has(f.end)) m.set(f.end, f.val) } return m };
  const opInc = flow('OperatingIncomeLoss'), intExp = flow('InterestExpense'), buyback = flow('PaymentsForRepurchaseOfCommonStock');
  const cash = new Map<string, number>(); if (cf) for (const f of factsFor(cf, 'CashAndCashEquivalentsAtCarryingValue', 'USD')) if (!f.start && (f.form ?? '').startsWith('10-K')) cash.set(f.end, f.val);
  const last = ann.at(-1), rows = divs.filter(d => d.dividend > 0).sort((a, c) => (a.date < c.date ? -1 : 1)), ppy = b.ppy ?? 4;
  const margins = ann.filter(a => a.revenue && opInc.has(a.end)).map(a => opInc.get(a.end)! / a.revenue!), revs = ann.map(a => a.revenue).filter((x): x is number => x != null && x > 0);
  const items = sub?.filings?.recent, since = new Date(Date.parse(today) - 365 * 864e5).toISOString().slice(0, 10), heads: string[] = [];
  (items?.form ?? []).forEach((f, i) => { if (f === '8-K' && items!.filingDate[i] >= since && (items!.items?.[i] ?? '').split(',').includes('4.02')) heads.push(`8-K item 4.02 non-reliance (${items!.filingDate[i]})`) });
  return {
    ticker, instrument_type: 'stock',
    dividend: { latest_regular: rows.at(-1)?.dividend ?? null, prior_regular: rows.length > ppy ? rows.at(-1 - ppy)!.dividend : null, is_missing: !rows.length, flags: regular ? { cut_flag: regular.cut, variable_policy_flag: regular.variable, freeze_flag: regular.freeze, special_dividend_flag: regular.special } : {} },
    cashflow: { fcf: last?.fcf ?? null, dividends_paid: last?.dividendsPaid != null ? Math.abs(last.dividendsPaid) : null, coverage_ratio_history: ann.filter(a => a.fcf != null && a.fcf > 0 && a.dividendsPaid != null).map(a => Math.abs(a.dividendsPaid!) / a.fcf!) },
    balance_sheet: { net_debt_history: ann.filter(a => a.totalDebt != null).map(a => a.totalDebt! - (cash.get(a.end) ?? 0)), interest_coverage_history: ann.filter(a => opInc.has(a.end) && (intExp.get(a.end) ?? 0) > 0).map(a => opInc.get(a.end)! / intExp.get(a.end)!) },
    capital_returns: { buybacks: last ? buyback.get(last.end) ?? null : null, fcf: last?.fcf ?? null },
    filings: { headlines: heads },
    operations: { revenue_cagr_5y: revs.length >= 6 ? ((revs.at(-1)! / revs[0]) ** (1 / 5) - 1) * 100 : null, margin_trend: margins.length >= 3 ? (margins.at(-1)! < margins.at(-3)! ? 'down' : 'up') : '', guidance_trend: '', dividend_growth_stalled: regular?.freeze ?? false },
  };
}
export const reviewSkill: Skill = {
  id: 'kanchi-dividend-review-monitor', name: 'Dividend review monitor (Kanchi)', group: 'Portfolio', from: 'kanchi-dividend-review-monitor',
  desc: 'Forced-review triggers for dividend holdings: T1 cut/suspension, T2 payout coverage, T3 credit stress, T4 8-K accounting red flags, T5 structural decline, T6 dividend policy change → OK / WARN / REVIEW with next actions. Never sells.',
  inputs: [{ key: 'symbols', label: 'Holdings (empty = paper account positions)', type: 'symbols', optional: true, default: '' }],
  async run(v, ctx: Ctx) {
    const syms = [...new Set((String(v.symbols ?? '').trim() ? String(v.symbols).toUpperCase().split(/[\s,]+/) : ctx.account().positions.map(p => p.sym.replace(/^FX:/, ''))).filter(s => /^[A-Z][A-Z0-9.]{0,9}$/.test(s)))];
    if (!syms.length) throw new Error('Give tickers, or hold US stocks in the paper account');
    const today = new Date().toISOString().slice(0, 10), res = [];
    for (const s of syms) {
      const [divs, cf, sub] = await Promise.all([ctx.json<Pay[]>(`/api/dividends?sym=${encodeURIComponent(s)}`).catch(() => [] as Pay[]), ctx.json<Facts>(`/api/sec/facts?q=${encodeURIComponent(s)}`).catch(() => null), ctx.json<{ filings?: { recent?: Record<string, string[]> } }>(`/api/sec/submissions?q=${encodeURIComponent(s)}`).catch(() => null)]);
      res.push(evaluate(holdingInput(s, divs, cf, sub, today)));
    }
    const n = (x: string) => res.filter(r => r.status === x).length;
    return {
      verdict: { label: `${n('REVIEW')} REVIEW · ${n('WARN')} WARN · ${n('OK')} OK`, tone: n('REVIEW') ? 'dn' : n('WARN') ? 'warn' : 'up', detail: 'REVIEW = pause adds, open a review ticket and read the full disclosure; WARN = optional pause, add to the next earnings checklist.' },
      tables: [{ title: 'Review queue', cols: ['Ticker', 'Status', 'Triggers', 'Actions'], rows: res.map(r => [r.ticker, r.status, r.findings.map(f => `${f.trigger} ${f.status}: ${f.reason}`).join(' | ') || '–', r.actions.join(', ') || '–']) }],
      notes: ['Guidance trend is not available here, so T5 counts only revenue CAGR, operating margin and a frozen dividend. T4 reads 8-K item 4.02 (non-reliance) filings of the last year.', 'Never an automatic sale.'],
    };
  },
};

export function taxRow(h: { ticker: string; instrument?: string; account?: string; security?: string; holdDays?: number | null }) {
  const t = h.ticker.trim().toUpperCase() || 'UNKNOWN', i = (h.instrument ?? 'stock').trim().toLowerCase(), a = (h.account ?? 'unknown').trim().toLowerCase(), d = h.holdDays ?? null;
  if (i === 'reit' || i === 'bdc') return { t, i, a, d, cls: 'ordinary_likely', loc: 'tax_advantaged_preferred', note: 'distribution may include ordinary-income style components' };
  if (i === 'mlp') return { t, i, a, d, cls: 'out_of_scope_mlp', loc: 'case_by_case', note: 'check K-1 and UBTI implications before placement' };
  if (d == null) return { t, i, a, d, cls: 'assumption_required', loc: 'taxable_preferred', note: 'hold_days_in_window missing; cannot verify qualified treatment' };
  const th = (h.security ?? 'common').trim().toLowerCase() === 'preferred' ? 91 : 61;
  return { t, i, a, d, cls: d >= th ? 'qualified_likely' : 'ordinary_likely', loc: 'taxable_preferred', note: `hold_days_in_window ${d >= th ? '>=' : '<'} ${th}` };
}
export const divTaxSkill: Skill = {
  id: 'kanchi-dividend-us-tax-accounting', name: 'US dividend tax sheet', group: 'Portfolio', from: 'kanchi-dividend-us-tax-accounting',
  desc: 'US dividend tax planning: qualified-likely vs ordinary-likely by instrument (REIT/BDC/MLP) and holding period (61 days in the 121-day window, 91 for preferred), with an account-location hint. Holding days come from the paper account\'s buys. Planning aid, not tax advice.',
  inputs: [{ key: 'holdings', label: 'Holdings JSON (optional)', type: 'json', optional: true, default: '', hint: '[{"ticker":"O","instrument":"reit","account":"taxable","holdDays":80}]' }],
  run(v, ctx: Ctx) {
    let hs: { ticker: string; instrument?: string; account?: string; security?: string; holdDays?: number | null }[] = [];
    if (String(v.holdings ?? '').trim()) { try { hs = typeof v.holdings === 'string' ? JSON.parse(v.holdings) : v.holdings as typeof hs } catch { throw new Error('Holdings: give a JSON list') } }
    else { const a = ctx.account(), now = Date.now(); hs = a.positions.map(p => { const buys = a.fills.filter(f => f.sym === p.sym && f.side === 'buy').map(f => f.ts); return { ticker: p.sym.replace(/^FX:/, ''), account: 'paper', holdDays: buys.length ? Math.min(121, Math.floor((now - Math.min(...buys)) / 864e5)) : null } }) }
    if (!hs.length) throw new Error('No holdings: give a JSON list or hold stocks in the paper account');
    const rows = hs.map(taxRow);
    return {
      verdict: { label: `${rows.filter(r => r.cls === 'qualified_likely').length} qualified-likely · ${rows.filter(r => r.cls === 'ordinary_likely').length} ordinary-likely`, tone: 'muted' },
      tables: [{ title: 'Tax planning sheet', cols: ['Ticker', 'Instrument', 'Account', 'Hold days', 'Classification', 'Location hint', 'Note'], rows: rows.map(r => [r.t, r.i, r.a, r.d ?? '', r.cls, r.loc, r.note]) }],
      notes: ['Holding days from the paper account are the days since the first buy (capped at 121), an approximation of the ex-dividend window. Confirm against the broker\'s 1099-DIV and current IRS guidance; escalate open items to a tax advisor.'],
    };
  },
};
