// kanchi-dividend-sop: Kanchi's dividend method as the original's deterministic checks — the regular dividend basis
// (cadence, special/variable dividends, cut / freeze / suspension), Step 1 yield floor, sector-aware payout safety
// (consumer / bank / utility / insurer), the event-scan cap, the final verdict, and the buy-target price at the
// 5-year average yield + α. Dividends from Yahoo, EPS and FCF from SEC 10-Ks. Never an order.
import { pyRoundN, type Ctx, type Skill } from './types.ts';
import { barsMany, type Stock } from './vcp.ts';
import { annuals, type Facts } from './secfacts.ts';

export const FLOORS: Record<string, number> = { 'income-now': 4, balanced: 3, 'growth-first': 1.5 };
export const VERDICTS = ['CLEAN-PASS', 'PASS-CAUTION', 'CONDITIONAL-PASS', 'HOLD-REVIEW', 'STEP1-RECHECK', 'FAIL'];
const EPS_EQ = 0.005, FREEZE_GRACE = 45, MIN_PAYS = 4;
const day = (s: string) => Date.parse(`${s}T00:00:00Z`) / 864e5;
const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b), n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2 };
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
const pstdev = (v: number[]) => { const m = mean(v); return Math.sqrt(v.reduce((a, x) => a + (x - m) ** 2, 0) / v.length) };
const r4 = (x: number | null) => (x == null ? null : pyRoundN(x, 4));
const pyf = (x: number) => (Number.isInteger(x) ? x.toFixed(1) : String(x));   // Python's float repr, for the reason text
export interface Pay { date: string; dividend: number; label?: string; declarationDate?: string }

function cadence(dates: number[]): [string, number | null] {
  if (dates.length < 2) return ['irregular', null];
  const gaps = dates.slice(1).map((d, i) => d - dates[i]).filter(g => g > 0); if (!gaps.length) return ['irregular', null];
  const m = median(gaps);
  for (const [max, name, ppy] of [[45, 'monthly', 12], [135, 'quarterly', 4], [240, 'semiannual', 2], [450, 'annual', 1]] as const) if (m <= max) return gaps.length >= 3 && pstdev(gaps) > m * 0.6 ? ['irregular', ppy] : [name, ppy];
  return ['irregular', 1];
}
export function basis(history: Pay[], price: number | null, { language = null as string | null, floor = null as number | null, asOf = null as string | null } = {}) {
  const rows = history.filter(h => /^\d{4}[-/]\d{2}[-/]\d{2}$/.test(String(h.date ?? '')) && Number(h.dividend) > 0).map(h => ({ d: day(String(h.date).replace(/\//g, '-')), date: String(h.date).replace(/\//g, '-'), amt: Number(h.dividend), label: h.label, declared: !!(h.declarationDate && String(h.declarationDate).trim()) })).sort((a, b) => a.d - b.d);
  const out = { status: 'OK', reasons: [] as string[], cadence: 'irregular', ppy: null as number | null, latest: null as number | null, annualized: null as number | null, regularTtm: null as number | null, ttmIncl: null as number | null, special: false, variable: false, cut: false, freeze: false, suspension: false, confirmed: false, lastIncrease: null as string | null, fwdYield: null as number | null, ttmYield: null as number | null, borderline: false };
  if (!rows.length) return { ...out, status: 'NO-DIVIDEND', reasons: ['no_dividend_history'] };
  [out.cadence, out.ppy] = cadence(rows.map(r => r.d));
  const explicit = new Set(rows.flatMap((r, i) => (typeof r.label === 'string' && /special|supplemental|one-time|one time|extra/i.test(r.label) ? [i] : []))), outlier = new Set<number>(), T = Math.max(out.ppy || 4, 8);
  rows.forEach((r, i) => {
    if (explicit.has(i)) return;
    const prior = []; for (let j = Math.max(0, i - T); j < i; j++) if (!explicit.has(j) && !outlier.has(j)) prior.push(rows[j].amt);
    if (prior.length < MIN_PAYS) return;
    const lm = median(prior); if (lm <= 0) return;
    if (r.amt > 3 * lm) outlier.add(i);
    else if (r.amt > 1.5 * lm) { for (let k = i + 1; k < Math.min(rows.length, i + 3); k++) if (!explicit.has(k) && rows[k].amt <= 1.2 * lm) { outlier.add(i); break } }
  });
  const sp = new Set([...explicit, ...outlier]); out.special = sp.size > 0;
  const regular = rows.filter((_, i) => !sp.has(i));
  if (out.special) out.reasons.push(`special_dividends_excluded=${sp.size}`);
  if (regular.length < MIN_PAYS) return { ...out, status: 'ASSUMPTION-REQUIRED', reasons: [...out.reasons, `insufficient_regular_pays=${regular.length}`] };
  const last = regular.at(-1)!, ppy = out.ppy, asof = rows.at(-1)!.d, sum = (ps: typeof rows) => ps.filter(p => asof - p.d >= 0 && asof - p.d < 366).reduce((a, p) => a + p.amt, 0);
  const annualized = ppy ? last.amt * ppy : null, regTtm = sum(regular), incl = sum(rows), win = regular.slice(-Math.max(ppy || 4, 8)).map(p => p.amt);
  if (win.length >= MIN_PAYS) { const m = mean(win); if (m > 0) out.variable = pstdev(win) / m > 0.35 }
  if (language) { const l = language.toLowerCase(); if (['variable dividend policy', 'variable dividend', 'one-third of net income', '1/3 of net income', 'distribution based on earnings', 'dividend equal to'].some(k => l.includes(k))) out.variable = true; else if (!out.variable && ['target payout ratio', 'capital return framework', 'dividend payout ratio', '% of net income', 'percent of net income'].some(k => l.includes(k))) out.reasons.push('weak_payout_language_only_review_policy') }
  let inc: (typeof rows)[number] | null = null; for (let i = 1; i < regular.length; i++) if (regular[i].amt > regular[i - 1].amt + EPS_EQ) inc = regular[i];
  const pi = ppy ? regular.length - 1 - ppy : -1, prior = pi >= 0 ? regular[pi].amt : null, maint = !!language && ['maintain', 'unchanged', 'same annualized', 'no change', 'flat'].some(k => language.toLowerCase().includes(k));
  const cd = ({ monthly: 30, quarterly: 91, semiannual: 182 } as Record<string, number>)[out.cadence] ?? 365;
  if (prior != null) { if (last.amt < prior - EPS_EQ) out.cut = true; else if (Math.abs(last.amt - prior) <= EPS_EQ) { if ((inc ? last.d - inc.d : 10_000) > cd + FREEZE_GRACE || maint) out.freeze = true; else out.reasons.push('flat_window_pending_next_raise') } }
  else { out.reasons.push('no_prior_year_rate'); if (maint) out.freeze = true }
  const cd2 = ({ monthly: 30, quarterly: 91, semiannual: 182, annual: 365 } as Record<string, number>)[out.cadence] ?? 365;
  if (asOf) { const since = day(asOf) - last.d; if (since > cd2 + FREEZE_GRACE) { out.suspension = true; out.reasons.push(`declaration_overdue_${since}d`) } }
  out.fwdYield = annualized != null && price && price > 0 ? pyRoundN(annualized / price * 100, 2) : null;
  out.ttmYield = price && price > 0 && incl ? pyRoundN(incl / price * 100, 2) : null;
  if (floor != null && out.fwdYield != null && Math.abs(out.fwdYield - floor) <= 0.2) { out.borderline = true; out.reasons.push('floor_borderline_within_0.2pp') }
  return { ...out, latest: r4(last.amt), annualized: annualized ? r4(annualized) : null, regularTtm: regTtm ? r4(regTtm) : null, ttmIncl: incl ? r4(incl) : null, confirmed: last.declared, lastIncrease: inc ? inc.date : null };
}
export type Basis = ReturnType<typeof basis>;
export function step1(b: Basis, floor: number, confirmed = false): [string, string] {
  if (b.status === 'NO-DIVIDEND') return ['FAIL', 'no_dividend'];
  if (b.status === 'ASSUMPTION-REQUIRED') return ['STEP1-RECHECK', b.reasons.join(';') || 'assumption_required'];
  if (b.suspension) return ['FAIL', 'dividend_suspension_suspected'];
  if (b.variable) return ['FAIL', 'variable_dividend_policy'];
  if (b.cut) return ['FAIL', 'dividend_cut'];
  const f = b.fwdYield; if (f == null) return ['STEP1-RECHECK', 'regular_yield_unavailable'];
  if (f < floor) return b.borderline && !confirmed ? ['STEP1-RECHECK', 'floor_borderline_unconfirmed_dividend'] : ['FAIL', `regular_yield_${pyf(f)}_below_floor_${pyf(floor)}`];
  if (b.borderline && !confirmed) return ['STEP1-RECHECK', 'floor_borderline_confirm_latest_declared'];
  if (b.freeze) return ['HOLD-REVIEW', 'dividend_freeze'];
  return ['STEP1-PASS', 'regular_yield_above_floor'];
}
export const sectorKind = (s: string | null) => { const x = (s ?? '').trim().toLowerCase(); return ['bank', 'banks', 'financial', 'financials', 'financial services'].includes(x) ? 'bank' : ['utility', 'utilities'].includes(x) ? 'utility' : ['insurance', 'insurer', 'insurers'].includes(x) ? 'insurer' : 'consumer' };
type M = Record<string, unknown>;
export function safety(o: { sector: string | null; dividend: number | null; gaapEps?: number | null; adjEps?: number | null; adjSource?: string; fcfPs?: number | null; merger?: boolean; bank?: M; utility?: M; insurer?: M }) {
  const kind = sectorKind(o.sector), reasons: string[] = [], blockers: string[] = [], ratio = (a: number | null | undefined, b: number | null | undefined) => (a == null || b == null || b === 0 ? null : a / b);
  const g = ratio(o.dividend, o.gaapEps), adj = ratio(o.dividend, o.adjEps), fcf = ratio(o.dividend, o.fcfPs), src = o.adjSource ?? 'UNAVAILABLE';
  let oneOff = false, div: number | null = null;
  if (o.gaapEps != null && o.adjEps != null && o.adjEps !== 0) { div = Math.abs(o.gaapEps - o.adjEps) / Math.abs(o.adjEps); if (div > 0.25) { oneOff = true; reasons.push(`gaap_adj_divergence_${Math.round(div * 100)}pct`); blockers.push('gaap_adjusted_divergence_gt_25pct') } }
  if (o.merger) { reasons.push('completed_merger_within_4q_gaap_distorted'); if (o.adjEps == null) { blockers.push('adjusted_eps_unavailable'); return { kind, verdict: 'HOLD-REVIEW', gaap: r4(g), adj: null, fcf: r4(fcf), oneOff: true, reasons: [...reasons, 'use_adjusted_eps_after_merger'], blockers } } oneOff = true }
  const s = (k: string, m?: M) => String(m?.[k] ?? '').toLowerCase();
  let v: string;
  if (kind === 'bank') {
    const m = o.bank ?? {}; v = 'PASS';
    if (m.cet1 == null) { blockers.push('bank_capital_unavailable'); v = 'CAUTION' }
    if (m.cre_concentration == null) { blockers.push('bank_cre_concentration_unavailable'); v = 'CAUTION' }
    if (s('npl_trend', m) === 'deteriorating' || s('nco_trend', m) === 'deteriorating') { reasons.push('bank_npl_nco_deteriorating'); blockers.push('bank_npl_nco_deteriorating'); v = 'CAUTION' }
    const db = m.deposit_beta; if ((typeof db === 'number' && db > 0.5) || ['high', 'rising'].includes(String(db).toLowerCase())) { reasons.push('bank_deposit_beta_elevated'); if (v === 'PASS') v = 'CAUTION' }
    if (g != null && g > 0.85) { reasons.push('bank_eps_payout_high'); v = 'FAIL' }
  } else if (kind === 'utility') {
    const m = o.utility ?? {}, fd = m.ffo_to_debt as number | undefined; v = 'PASS';
    if (fd == null) { blockers.push('utility_ffo_debt_unavailable'); v = 'CAUTION' } else if (fd < 0.13) { reasons.push('utility_ffo_debt_below_0.13'); blockers.push('utility_ffo_debt_weak'); v = 'CAUTION' }
    if (['falling', 'adverse'].includes(s('allowed_roe_trend', m))) { reasons.push('utility_allowed_roe_falling'); if (v === 'PASS') v = 'CAUTION' }
    if (['adverse', 'pending_adverse'].includes(s('rate_case_status', m))) { reasons.push('utility_rate_case_adverse'); blockers.push('utility_rate_case_adverse'); v = 'HOLD-REVIEW' }
    if (['high', 'dilutive'].includes(s('equity_issuance_risk', m))) { reasons.push('utility_equity_issuance_risk'); if (v === 'PASS') v = 'CAUTION' }
    if (g != null && g > 1) { reasons.push('utility_eps_payout_above_100pct'); v = 'FAIL' }
  } else if (kind === 'insurer') {
    const m = o.insurer ?? {}, op = adj ?? g, cr = m.combined_ratio as number | undefined; v = 'PASS';
    if (op != null && op > 0.85) { reasons.push('insurer_operating_eps_payout_high'); v = 'FAIL' }
    if (cr == null) { blockers.push('insurer_combined_ratio_unavailable'); if (v === 'PASS') v = 'CAUTION' }
    if (s('reserve_development', m) === 'adverse') { reasons.push('insurer_reserve_development_adverse'); blockers.push('insurer_reserve_development_adverse'); if (v !== 'FAIL') v = 'HOLD-REVIEW' }
    if (cr != null && cr > 1) { reasons.push('insurer_combined_ratio_above_100'); if (v === 'PASS') v = 'CAUTION' }
    if (s('statutory_capital', m) === 'weak') { reasons.push('insurer_statutory_capital_weak'); if (v !== 'FAIL') v = 'HOLD-REVIEW' }
  } else {
    const missing = o.adjEps == null || src === 'UNAVAILABLE';
    if (missing) { blockers.push('adjusted_eps_unavailable'); reasons.push('adjusted_eps_unavailable_failsafe_hold') }
    let caution = false;
    if (fcf != null && fcf > 1) { reasons.push('fcf_payout_above_100pct'); v = 'FAIL' }
    else if (adj != null && adj > 0.85) { reasons.push('adj_eps_payout_above_85pct'); v = 'FAIL' }
    else { if (adj != null && adj > 0.7) { reasons.push('adj_eps_payout_caution_band'); caution = true } if (fcf != null && fcf > 0.8) { reasons.push('fcf_payout_above_80pct'); caution = true } v = o.adjEps == null ? 'HOLD-REVIEW' : caution ? 'CAUTION' : 'PASS' }
    if (blockers.includes('adjusted_eps_unavailable') && (v === 'PASS' || v === 'CAUTION')) v = 'HOLD-REVIEW';
  }
  return { kind, verdict: v, gaap: r4(g), adj: r4(adj), fcf: r4(fcf), oneOff, reasons, blockers: [...new Set(blockers)].sort() };
}
export interface Scan { result: string; reasons?: string[]; completed_mna_within_4q?: boolean }
export function eventCap(scan: Scan, triggered: boolean) {
  const r = ['CLEAN_CONFIRMED', 'NO_EVENT_FOUND', 'MAJOR_EVENT', 'MINOR_EVENT_CAUTION', 'FAILED-DEGRADED', 'SKIPPED'].includes(String(scan.result).trim()) ? String(scan.result).trim() : 'FAILED-DEGRADED';
  if (r === 'MAJOR_EVENT') return { cap: 'HOLD-REVIEW', t1: true, blockers: ['major_structural_event'], reasons: scan.reasons?.length ? scan.reasons : ['major_structural_event'] };
  if (r === 'MINOR_EVENT_CAUTION') return { cap: null, t1: false, blockers: [] as string[], reasons: ['minor_bolt_on_event_caution_note'] };
  if (r === 'CLEAN_CONFIRMED') return { cap: null, t1: false, blockers: [] as string[], reasons: [] as string[] };
  const blockers = [r === 'NO_EVENT_FOUND' ? 'event_scan_primary_source_unconfirmed' : 'event_scan_failed_or_skipped'], reasons = [r === 'NO_EVENT_FOUND' ? 'no_event_found_primary_source_unchecked' : `event_scan_${r}`];
  return triggered ? { cap: 'HOLD-REVIEW', t1: true, blockers, reasons: [...reasons, 'pessimistic_cap_triggered_name'] } : { cap: null, t1: true, blockers, reasons };
}
export function finalVerdict(o: { step1: string | null; safety: string | null; cap: string | null; t1: boolean; blockers: string[]; requireSafety?: boolean }): [string, boolean, string[]] {
  const b = o.blockers;
  if (o.step1 === 'FAIL') return ['FAIL', true, ['step1_fail']];
  if (o.safety === 'FAIL') return ['FAIL', true, ['payout_safety_fail']];
  if (!['STEP1-PASS', 'HOLD-REVIEW', 'STEP1-RECHECK', 'ASSUMPTION-REQUIRED'].includes(o.step1 ?? '')) return ['STEP1-RECHECK', true, ['step1_not_run_or_unknown']];
  if (o.step1 === 'STEP1-RECHECK' || o.step1 === 'ASSUMPTION-REQUIRED') return ['STEP1-RECHECK', true, ['step1_recheck']];
  if (o.cap === 'HOLD-REVIEW') return ['HOLD-REVIEW', true, ['event_cap_hold_review']];
  if (o.safety === 'HOLD-REVIEW') return ['HOLD-REVIEW', true, ['payout_safety_hold_review']];
  if (o.safety == null && (o.requireSafety ?? true)) return ['HOLD-REVIEW', true, ['payout_safety_not_evaluated']];
  if (o.step1 === 'HOLD-REVIEW') return o.safety === 'PASS' && !b.length ? ['CONDITIONAL-PASS', o.t1, ['dividend_freeze_income_cash_cow']] : ['HOLD-REVIEW', true, ['dividend_freeze_unconfirmed_safety']];
  if (o.safety === 'CAUTION' || b.length) return ['PASS-CAUTION', o.t1, [...(b.length ? ['open_pre_order_blockers'] : []), ...(o.safety === 'CAUTION' ? ['payout_safety_caution'] : [])]];
  if (o.safety === 'PASS') return ['CLEAN-PASS', o.t1, ['step1_pass_safety_pass']];
  return o.safety == null ? ['CLEAN-PASS', o.t1, ['step1_pass_safety_skipped']] : ['PASS-CAUTION', o.t1, ['residual_caution']];
}
/** The original's build_entry_row: buy target = annual dividend / (5-year average yield + α). */
export function entryRow(o: { price: number | null; history: Pay[] | null; yields5y: number[]; floor: number | null; asOf: string; alpha?: number; lastDiv?: number | null; fin?: Parameters<typeof safety>[0] | null; scan?: Scan; language?: string | null }) {
  const alpha = o.alpha ?? 0.5, b = o.history?.length ? basis(o.history, o.price, { language: o.language ?? null, floor: o.floor, asOf: o.asOf }) : null;
  let dividend = o.lastDiv ?? null; if (b && b.annualized != null) dividend = b.annualized;
  const y = o.yields5y.slice(0, 5), avg = y.length ? pyRoundN(mean(y), 2) : null, target = avg != null ? pyRoundN(avg + alpha, 2) : null;
  const buy = dividend != null && target != null && target > 0 ? pyRoundN(dividend / (target / 100), 2) : null, cur = dividend != null && o.price && o.price > 0 ? pyRoundN(dividend / o.price * 100, 2) : null;
  const drop = o.price && buy != null ? pyRoundN(Math.max(0, (o.price - buy) / o.price * 100), 2) : null, signal = o.price != null && buy != null ? (o.price <= buy ? 'TRIGGERED' : 'WAIT') : 'ASSUMPTION-REQUIRED';
  const [s1, s1r] = b && o.floor != null ? step1(b, o.floor, b.confirmed) : [null, null];
  const pre: string[] = []; if (b) { for (const f of ['variable', 'cut', 'suspension'] as const) if (b[f]) pre.push(`${f === 'variable' ? 'variable_policy' : f}_flag`); if (b.borderline) pre.push('dividend_source_stale') }
  const cap = eventCap(o.scan ?? { result: 'SKIPPED' }, signal === 'TRIGGERED'), sf = o.fin ? safety({ ...o.fin, dividend, merger: !!(o.fin.merger || o.scan?.completed_mna_within_4q) }) : null;
  if (sf) pre.push(...sf.blockers);
  const [verdict, t1, why] = finalVerdict({ step1: s1, safety: sf?.verdict ?? null, cap: cap.cap, t1: cap.t1, blockers: [...new Set(pre)].sort() });
  return { signal, dividend, cur, avg, target, buy, drop, b, step1: s1, step1Reason: s1r, safety: sf, cap, verdict, t1, why, blockers: [...new Set([...pre, ...cap.blockers])].sort() };
}
/** Calendar-year dividend yields (sum of the year's dividends / last close of the year), newest first. */
export function yearlyYields(divs: Pay[], closes: { date: string; close: number }[], year: number, n = 5) {
  const last = new Map<string, number>(); for (const c of closes) last.set(c.date.slice(0, 4), c.close);
  const out: number[] = []; for (let y = year - 1; y >= year - n; y--) { const k = String(y), d = divs.filter(x => x.date.startsWith(k)).reduce((a, x) => a + x.dividend, 0), p = last.get(k); if (d > 0 && p) out.push(d / p * 100) }
  return out;
}
const kindOf = (s: Stock | undefined) => { const i = (s?.industry ?? '').toLowerCase(); return /bank/.test(i) ? 'bank' : /insur/.test(i) ? 'insurance' : s?.sector === 'Utilities' ? 'utilities' : (s?.sector ?? '').toLowerCase() };

export const kanchiSkill: Skill = {
  id: 'kanchi-dividend-sop', name: 'Kanchi dividend SOP', group: 'Fundamentals', from: 'kanchi-dividend-sop',
  desc: 'Kanchi\'s dividend method: regular dividend basis (cuts, freezes, specials, variable policies), the yield floor of your profile, sector-aware payout safety, an event check, the final verdict and the buy-target price at the 5-year average yield + 0.5 pp — TRIGGERED when the price is at or below it. Never an order.',
  inputs: [
    { key: 'symbols', label: 'Tickers', type: 'symbols', default: 'KO, PEP, JNJ, PG, XOM, VZ, O, MO' },
    { key: 'profile', label: 'Profile (yield floor)', type: 'select', options: ['balanced', 'income-now', 'growth-first'], default: 'balanced' },
    { key: 'alpha', label: 'α above the 5-year average yield (pp)', type: 'number', default: 0.5 },
    { key: 'adjEps', label: 'Adjusted EPS (JSON {"KO": 2.9})', type: 'json', optional: true, default: '', hint: 'without it, consumer names stay HOLD-REVIEW as in the original' },
    { key: 'events', label: 'Event scan (JSON {"KO": "CLEAN_CONFIRMED"})', type: 'json', optional: true, default: '' },
  ],
  async run(v, ctx: Ctx) {
    const syms = String(v.symbols ?? '').toUpperCase().split(/[\s,]+/).filter(Boolean); if (!syms.length) throw new Error('Give tickers');
    const parse = (x: unknown) => { try { return x ? (typeof x === 'string' ? JSON.parse(x) : x) as Record<string, unknown> : {} } catch { throw new Error('Adjusted EPS / events: give JSON like {"KO": 2.9}') } };
    const adj = parse(v.adjEps), ev = parse(v.events), floor = FLOORS[String(v.profile)] ?? 3, today = new Date().toISOString().slice(0, 10), yr = +today.slice(0, 4);
    const all = await ctx.json<Stock[]>('/api/us-stocks').catch(() => [] as Stock[]), info = new Map(all.map(s => [s.sym, s])), bars = await barsMany(ctx, syms), rows: (string | number | null)[][] = [];
    for (const s of syms) {
      const b = bars.get(s); if (!b) { rows.push([s, 'no price data', '', '', '', '', '', '', '', '', '']); continue }
      const price = b.at(-1)!.close, divs = await ctx.json<Pay[]>(`/api/dividends?sym=${encodeURIComponent(s)}`).catch(() => [] as Pay[]);
      const a = await ctx.json<Facts>(`/api/sec/facts?q=${encodeURIComponent(s)}`).then(f => annuals(f, 1)[0], () => undefined);
      const fcfPs = a?.fcf != null && a.shares ? a.fcf / a.shares : null, ae = Number(adj[s]);
      const r = entryRow({ price, history: divs, yields5y: yearlyYields(divs, b.map(x => ({ date: new Date(x.time * 1000).toISOString().slice(0, 10), close: x.close })), yr), floor, asOf: today, alpha: Number(v.alpha) || 0.5,
        fin: { sector: kindOf(info.get(s)), dividend: null, gaapEps: a?.eps ?? null, adjEps: Number.isFinite(ae) ? ae : null, adjSource: Number.isFinite(ae) ? 'MANUAL' : 'UNAVAILABLE', fcfPs }, scan: ev[s] ? { result: String(ev[s]) } : { result: 'SKIPPED' } });
      rows.push([s, info.get(s)?.name ?? '', r.verdict, r.signal, price.toFixed(2), r.cur == null ? '–' : `${r.cur}%`, r.avg == null ? '–' : `${r.avg}%`, r.buy ?? '–', r.drop == null ? '–' : `${r.drop}%`, `${r.step1 ?? '–'} · ${r.safety?.verdict ?? '–'}`, [...r.why, ...r.blockers].join(', ')]);
    }
    return {
      verdict: { label: `${rows.filter(x => x[3] === 'TRIGGERED').length} at the buy target · ${rows.filter(x => String(x[2]).includes('PASS')).length} passing`, tone: 'muted', detail: `Profile ${v.profile}: yield floor ${floor}%.` },
      tables: [{ title: 'Kanchi checks', cols: ['Ticker', 'Name', 'Verdict', 'Signal', 'Price', 'Yield', '5y avg yield', 'Buy target', 'Drop needed', 'Step 1 · safety', 'Reasons and blockers'], rows }],
      notes: ['Like the original, the result is fail-safe: without adjusted EPS (consumer names), bank capital, utility FFO/debt or insurer combined ratio, and without a primary-source event check, verdicts stay at HOLD-REVIEW or PASS-CAUTION. The 5-year yield uses calendar-year dividends over year-end prices.', 'Never an order.'],
    };
  },
};
