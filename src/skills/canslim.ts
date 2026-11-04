// canslim-screener: William O'Neil's CANSLIM with the original's seven calculators and phase-3 weights —
// C quarterly EPS/revenue growth, A 3-year EPS CAGR, N distance from the 52-week high, S up/down volume, L multi-period
// relative strength vs the S&P 500, I institutional sponsorship, M market direction (S&P vs 50-EMA, VIX).
// Earnings come from SEC filings (XBRL), prices from the app. Newest-first lists, like the original.
import { pyRoundN, type Ctx, type Skill } from './types.ts';
import { barsMany, type Stock } from './vcp.ts';
import { factsFor, periods, series, type Facts } from './secfacts.ts';

export interface Stmt { date: string; eps: number | null; revenue: number | null }
export function cScore(q: Stmt[]) {
  if (q.length < 5) return { score: 0, eps: null as number | null, rev: null as number | null };
  const l = { ...q[0], eps: q[0].eps || null }, y = { ...q[4], eps: q[4].eps || null };   // Python `or`: a 0 EPS reads as missing
  if (l.eps == null || y.eps == null || l.revenue == null || y.revenue == null || y.revenue === 0) return { score: 0, eps: null, rev: null };
  const eps = (l.eps - y.eps) / Math.abs(y.eps) * 100, rev = (l.revenue - y.revenue) / y.revenue * 100;
  return { score: eps >= 50 && rev >= 25 ? 100 : eps >= 30 && rev >= 15 ? 80 : eps >= 18 && rev >= 10 ? 60 : eps >= 10 ? 40 : 0, eps: pyRoundN(eps, 1), rev: pyRoundN(rev, 1) };
}
export function aScore(a: Stmt[]) {
  if (a.length < 4) return { score: 50, cagr: null as number | null, stable: null as boolean | null };
  const e: number[] = [], r: number[] = [];
  for (const s of a.slice(0, 4)) { if (s.eps == null || s.eps === 0) return { score: 0, cagr: null, stable: null }; if (s.eps <= 0) return { score: 0, cagr: null, stable: null }; e.push(s.eps); r.push(s.revenue || 0) }
  const ec = [...e].reverse(), rc = [...r].reverse(), cagr = ((ec[3] / ec[0]) ** (1 / 3) - 1) * 100, rcagr = rc[0] > 0 ? ((rc[3] / rc[0]) ** (1 / 3) - 1) * 100 : 0, stable = ec.every((x, i) => i === 0 || x >= ec[i - 1]);
  let b = cagr >= 40 ? 90 : cagr >= 30 ? 70 : cagr >= 25 ? 50 : cagr >= 15 ? 30 : 0;
  if (rcagr < cagr * 0.5) b = Math.trunc(b * 0.8);
  if (stable) b += 10;
  return { score: Math.min(b, 100), cagr: pyRoundN(cagr, 1), stable };
}
export function nScore(q: { price: number; yearHigh: number; volume: number; avgVolume: number }) {
  if (!q.price || !q.yearHigh) return { score: 0, dist: null as number | null, breakout: false };
  const d = (q.price / q.yearHigh - 1) * 100, bo = !!(q.volume && q.avgVolume) && q.price >= q.yearHigh * 0.995 && q.volume > q.avgVolume * 1.4;
  return { score: d >= -5 && bo ? 100 : d >= -10 && bo ? 80 : d >= -15 || bo ? 60 : d >= -25 ? 40 : 20, dist: pyRoundN(d, 1), breakout: bo };
}
/** `h` newest first. */
export function sScore(h: { close: number; volume: number }[]) {
  if (h.length < 60) return { score: 0, ratio: null as number | null };
  const up: number[] = [], dn: number[] = []; let prev: number | null = null;
  for (const d of h.slice(0, 60).reverse()) { if (prev != null) { if (d.close > prev) up.push(d.volume); else if (d.close < prev) dn.push(d.volume) } prev = d.close }
  if (up.length < 10 || dn.length < 10) return { score: 0, ratio: null };
  const au = up.reduce((a, b) => a + b, 0) / up.length, ad = dn.reduce((a, b) => a + b, 0) / dn.length, r = ad === 0 ? 5 : au / ad;
  return { score: r >= 2 ? 100 : r >= 1.5 ? 80 : r >= 1 ? 60 : r >= 0.7 ? 40 : r >= 0.5 ? 20 : 0, ratio: r };
}
const ret = (asc: number[], d: number) => (asc.length < d || asc[asc.length - d] <= 0 ? null : (asc.at(-1)! - asc[asc.length - d]) / asc[asc.length - d] * 100);
export function lScore(stockAsc: number[], benchAsc: number[] | null) {
  if (stockAsc.length < 50 || stockAsc[0] <= 0) return { score: 0, rank: null as number | null, rel: null as number | null };
  const legacy = (stockAsc.at(-1)! - stockAsc[0]) / stockAsc[0] * 100, P = [['3m', 63, 0.4], ['6m', 126, 0.3], ['12m', 252, 0.3]] as const;
  const sr = P.map(([, d]) => ret(stockAsc, d)), br = P.map(([, d]) => (benchAsc ? ret(benchAsc, d) : null)), rel = sr.map((s, i) => (s != null && br[i] != null ? s - br[i]! : null));
  const r2 = (x: number | null) => (x == null ? null : pyRoundN(x, 2));
  const wavg = (v: (number | null)[], keys: number[]) => { if (!keys.length) return null; const ws = keys.reduce((a, k) => a + P[k][2], 0); let t = 0; for (const k of keys) t += v[k]! * (P[k][2] / ws); return t };
  const avail = sr.map((x, i) => (x != null ? i : -1)).filter(i => i >= 0), wRel = r2(wavg(rel, avail.filter(i => rel[i] != null))), wStock = r2(wavg(sr, avail));
  let legacyRel: number | null = null;
  if (benchAsc && benchAsc.length >= 50 && benchAsc[0] > 0) legacyRel = legacy - (benchAsc.at(-1)! - benchAsc[0]) / benchAsc[0] * 100;
  const [x, bench] = wRel != null ? [wRel, true] : wStock != null ? [wStock, false] : legacyRel != null ? [legacyRel, true] : [legacy, false];
  let [s, rk] = x >= 50 ? [100, 99] : x >= 30 ? [95, 95] : x >= 20 ? [90, 90] : x >= 10 ? [80, 80] : x >= 5 ? [70, 70] : x >= 0 ? [60, 60] : x >= -5 ? [50, 50] : x >= -10 ? [40, 40] : x >= -20 ? [20, 25] : [0, 10];
  if (!bench) { s = Math.trunc(s * 0.8); rk = Math.trunc(rk * 0.9) }
  return { score: s, rank: rk, rel: wRel };
}
/** Holder count unknown here (0), so only the ownership % bands apply — as the original with FinViz-only data. */
export function iScore(ownPct: number | null, holders = 0, superinvestor = false) {
  if (ownPct == null) return holders === 0 ? 0 : Math.min((holders >= 50 && holders <= 100 ? 50 : holders >= 30 && holders < 50 ? 40 : holders > 100 && holders <= 150 ? 35 : holders > 150 ? 20 : 10) + (superinvestor ? 15 : 0), 70);
  const n = holders, o = ownPct;
  let b = n >= 50 && n <= 100 && o >= 30 && o <= 60 ? 100 : superinvestor && n >= 30 && n <= 150 ? 90 : (n >= 30 && n < 50 && o >= 20 && o <= 40) || (n > 100 && n <= 150 && o >= 40 && o <= 70) ? 80 : (n >= 20 && n < 30 && o >= 20 && o <= 50) || (n >= 50 && n <= 150 && o >= 20 && o <= 70) ? 60 : o < 10 || o > 90 ? 20 : o < 20 || o > 80 ? 40 : 50;
  if (superinvestor && b < 100) b = Math.min(b + 10, 100);
  return b;
}
/** S&P newest-first closes; EMA seeded with the SMA of the oldest 50. */
export function mScore(price: number, spNewest: number[], vix: number | null) {
  if (spNewest.length < 50) return { score: 50, trend: 'unknown', dist: null as number | null };
  const r = [...spNewest].reverse(); let e = r.slice(0, 50).reduce((a, b) => a + b, 0) / 50; const k = 2 / 51; for (const p of r.slice(50)) e = p * k + e * (1 - k);
  const d = (price / e - 1) * 100, trend = d >= 2 ? 'strong_uptrend' : d >= 0 ? 'uptrend' : d >= -2 ? 'choppy' : d >= -5 ? 'downtrend' : 'bear_market';
  let s = ({ strong_uptrend: 90, uptrend: 70, choppy: 40, downtrend: 20, bear_market: 0 } as Record<string, number>)[trend];
  if (vix) { if (vix < 15) s += 10; else if (vix > 30) s = 0 }
  return { score: Math.min(Math.max(s, 0), 100), trend, dist: pyRoundN(d, 2) };
}
const W = { C: 0.15, A: 0.2, N: 0.15, S: 0.15, L: 0.2, I: 0.1, M: 0.05 };
export type K = keyof typeof W;
export function composite(s: Record<K, number>) {
  const score = pyRoundN((Object.keys(W) as K[]).reduce((a, k) => a + s[k] * W[k], 0), 1), rating = score >= 90 ? 'Exceptional+' : score >= 80 ? 'Exceptional' : score >= 70 ? 'Strong' : score >= 60 ? 'Above Average' : score >= 50 ? 'Average' : score >= 40 ? 'Below Average' : 'Weak';
  const th: Record<K, number> = { C: 60, A: 50, N: 40, S: 40, L: 50, I: 40, M: 40 }, failed = (Object.keys(th) as K[]).filter(k => s[k] < th[k]);
  const rec = s.M === 0 ? 'avoid' : s.L < 40 ? 'avoid' : !failed.length ? 'buy' : failed.length === 1 ? 'watchlist' : 'avoid';
  return { score, rating, failed: s.M === 0 ? ['M'] : failed, rec };
}
/** Quarterly and annual EPS/revenue (newest first) from SEC facts. */
function statements(cf: Facts) {
  const eps = series(cf, 'eps_diluted').s, rev = series(cf, 'revenue').s;
  const q = [...eps.keys()].sort().reverse().slice(0, 8).map(d => ({ date: d, eps: eps.get(d)!.value, revenue: rev.get(d)?.value ?? null }));
  const ann = (keys: string[], unit: string) => { const m = new Map<string, number>(); for (const c of keys) for (const f of periods(factsFor(cf, c, unit)).values()) { const d = (Date.parse(f.end) - Date.parse(f.start!)) / 864e5; if (d >= 350 && d <= 380 && (f.form ?? '').startsWith('10-K') && !m.has(f.end)) m.set(f.end, f.val) } return m };
  const ae = ann(['EarningsPerShareDiluted', 'EarningsPerShareBasicAndDiluted'], 'USD/shares'), ar = ann(['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'SalesRevenueNet'], 'USD');
  const a = [...ae.keys()].sort().reverse().slice(0, 5).map(d => ({ date: d, eps: ae.get(d)!, revenue: ar.get(d) ?? null }));
  return { q, a };
}

export const canslimSkill: Skill = {
  id: 'canslim-screener', name: 'CANSLIM screener', group: 'Fundamentals', from: 'canslim-screener',
  desc: 'O\'Neil\'s CANSLIM on the largest US stocks: quarterly and 3-year earnings growth from SEC filings, nearness to the 52-week high, accumulation volume, relative strength, institutional sponsorship and the market direction, weighted 15/20/15/15/20/10/5 with the original\'s buy / watchlist / avoid thresholds.',
  inputs: [
    { key: 'universe', label: 'Universe (largest US stocks)', type: 'number', default: 40, hint: 'one SEC request per stock' },
    { key: 'symbols', label: 'Or these symbols', type: 'symbols', optional: true, default: '' },
    { key: 'instOwn', label: 'Institutional ownership % (JSON {"AAPL": 62})', type: 'json', optional: true, default: '' },
  ],
  async run(v, ctx: Ctx) {
    const custom = String(v.symbols ?? '').toUpperCase().split(/[\s,]+/).filter(Boolean);
    const all = custom.length ? [] : await ctx.json<Stock[]>('/api/us-stocks'), names = new Map(all.map(s => [s.sym, s.name]));
    const syms = custom.length ? custom : all.filter(s => s.country === 'United States' || !s.country).slice(0, Math.min(150, Math.max(5, Number(v.universe) || 40))).map(s => s.sym);
    let own: Record<string, number> = {}; try { own = v.instOwn ? (typeof v.instOwn === 'string' ? JSON.parse(v.instOwn) : v.instOwn as Record<string, number>) : {} } catch { throw new Error('Institutional ownership: give JSON like {"AAPL": 62}') }
    const [sp, vix, bars] = await Promise.all([ctx.bars('FX:US500', '1d'), ctx.bars('FX:VIX', '1d').catch(() => []), barsMany(ctx, syms)]);
    const spN = sp.slice(-365).reverse().map(b => b.close), m = mScore(sp.at(-1)!.close, spN, vix.at(-1)?.close ?? null), spAsc = sp.slice(-365).map(b => b.close);
    const rows: (string | number | null)[][] = []; const errs: string[] = [];
    for (const s of syms) {
      const b = bars.get(s); if (!b || b.length < 60) continue;
      let st: ReturnType<typeof statements>; try { st = statements(await ctx.json<Facts>(`/api/sec/facts?q=${encodeURIComponent(s)}`)) } catch (e) { errs.push(s); continue }
      const y = b.slice(-252), quote = { price: b.at(-1)!.close, yearHigh: Math.max(...y.map(x => x.high)), volume: b.at(-1)!.volume, avgVolume: b.slice(-63).reduce((a, x) => a + x.volume, 0) / Math.min(63, b.length) };
      const c = cScore(st.q), a = aScore(st.a), n = nScore(quote), sd = sScore(b.slice(-90).reverse()), l = lScore(b.slice(-365).map(x => x.close), spAsc), i = iScore(Number.isFinite(own[s]) ? own[s] : null);
      const sc = { C: c.score, A: a.score, N: n.score, S: sd.score, L: l.score, I: i, M: m.score }, k = composite(sc);
      rows.push([s, names.get(s) ?? '', k.score, k.rating, k.rec, c.score, a.score, n.score, sd.score, l.score, i, c.eps == null ? '–' : `${c.eps}%`, a.cagr == null ? '–' : `${a.cagr}%`, n.dist == null ? '–' : `${n.dist}%`, k.failed.join(' ')]);
    }
    rows.sort((x, y) => (y[2] as number) - (x[2] as number));
    return {
      verdict: { label: `${rows.filter(r => r[4] === 'buy').length} buy · ${rows.filter(r => r[4] === 'watchlist').length} watchlist`, tone: m.score === 0 ? 'dn' : 'up', detail: `Market: ${m.trend.replace('_', ' ')} (S&P ${m.dist}% from its 50-EMA), M = ${m.score}.${m.score === 0 ? ' Bear market: do not buy regardless of the other scores.' : ''}` },
      tables: [{ title: 'CANSLIM', cols: ['Symbol', 'Name', 'Score', 'Rating', 'Action', 'C', 'A', 'N', 'S', 'L', 'I', 'Qtr EPS', '3y EPS CAGR', 'From high', 'Below threshold'], rows }],
      notes: [`Institutional sponsorship needs holder data the app does not have: I = 0 unless you enter ownership %, as the original scores missing data (with an ownership % alone, I tops out at 50).${errs.length ? ` No SEC facts for: ${errs.join(', ')}.` : ''}`, 'EPS and revenue are diluted EPS and revenue from 10-Q/10-K filings (Q4 derived from the 10-K). No order is placed.'],
    };
  },
};
