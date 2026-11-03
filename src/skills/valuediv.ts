// value-dividend-screener: value dividend stocks — yield ≥ 3%, P/E ≤ 20, P/B ≤ 2, dividends growing ≥ 4% a year
// (trailing-twelve-month windows), revenue and EPS in an uptrend, then scored on dividend growth, stability,
// revenue/EPS growth, payout sustainability, balance sheet and quality; oversold names (RSI ≤ 40) first.
// The original's rules; dividends from Yahoo, statements from SEC 10-Ks.
import { pyRoundN, type Ctx, type Skill } from './types.ts';
import { barsMany, type Stock } from './vcp.ts';
import { annuals, keyMetrics, type Annual, type Facts } from './secfacts.ts';
import { isReit, rsi } from './divgrowth.ts';

type Div = { date: string; dividend: number };
const cagr = (a: number, b: number, y: number) => (a <= 0 || b <= 0 || y <= 0 ? null : ((b / a) ** (1 / y) - 1) * 100);
export const positiveTrend = (v: number[]) => v.length >= 3 && v[0] < v.at(-1)! && v.slice(1).filter((x, i) => x < v[i]).length <= 1;
const day = (s: string) => Date.parse(`${s}T00:00:00Z`) / 864e5;
/** CAGR of trailing-twelve-month dividends `back` years ago vs now. */
export function divGrowth(divs: Div[], today: string, back = 3) {
  const t = day(today), p = divs.filter(d => d.date && (d.dividend || 0) > 0 && day(d.date.slice(0, 10)) <= t).map(d => [day(d.date.slice(0, 10)), d.dividend] as const);
  if (!p.length || t - Math.min(...p.map(x => x[0])) < 365 * back) return null;
  const ttm = (e: number) => p.filter(([d]) => e - 365 < d && d <= e).reduce((a, [, x]) => a + x, 0), w = Array.from({ length: back + 1 }, (_, i) => ttm(t - 365 * (back - i)));
  if (w[0] <= 0 || w.at(-1)! <= 0) return null;
  return { cagr: cagr(w[0], w.at(-1)!, back)!, consistent: w.every((x, i) => i === 0 || x >= w[i - 1] * 0.95), latest: w.at(-1)! };
}
export function stability(divs: Div[], year: number) {
  const r = { stable: false, growing: false, vol: null as number | null, years: 0 };
  if (divs.length < 4) return r;
  const by = new Map<string, number>(); for (const d of divs) { const y = (d.date ?? '').slice(0, 4); if (/^\d{4}$/.test(y) && +y < year) by.set(y, (by.get(y) ?? 0) + (d.dividend || 0)) }
  if (by.size < 3) return r;
  const v = [...by.keys()].sort().reverse().map(y => by.get(y)!), avg = v.reduce((a, b) => a + b, 0) / v.length;
  if (avg > 0) { const raw = (Math.max(...v) - Math.min(...v)) / avg * 100; r.vol = pyRoundN(raw, 1); r.stable = raw < 50 }
  const o = [...by.keys()].sort().map(y => by.get(y)!);
  for (let i = 1; i < o.length; i++) r.years = o[i] >= o[i - 1] * 0.95 ? r.years + 1 : 0;
  r.growing = o.length >= 3 && r.years >= 2 && o.at(-1)! > o[0];
  return r;
}
export function stabilityScore(s: ReturnType<typeof stability>) { let x = 0; if (s.stable) x += 40; else if (s.vol != null && s.vol < 100) x += Math.max(0, 40 - s.vol * 0.4); if (s.growing) x += 30; x += Math.min(s.years * 10, 30); return pyRoundN(x, 1) }
export function sustainability(a: Annual | undefined, reit: boolean) {
  const r = { payout: null as number | null, fcfPayout: null as number | null, fcf: null as number | null, coverage: 'MISSING_DATA', sustainable: false };
  if (!a) return r;
  const paid = a.dividendsPaid != null ? Math.abs(a.dividendsPaid) : null;
  if (a.ocf != null && a.capex != null) r.fcf = a.ocf - Math.abs(a.capex);
  if (paid == null) return r;
  if (paid === 0) { r.coverage = 'NO_DIVIDEND'; return r }
  const f = r.fcf;
  if (f != null) { r.coverage = f < 0 ? 'NEGATIVE_FCF' : f === 0 ? 'ZERO_FCF' : f < paid ? 'INSUFFICIENT_FCF' : f === paid ? 'AT_LIMIT' : 'COVERED'; if (f > 0) r.fcfPayout = paid / f * 100 }
  if (reit) { const ffo = a.netIncome != null && a.da != null ? a.netIncome + a.da : null; if (ffo && ffo > 0) { r.payout = paid / ffo * 100; r.sustainable = r.payout < 80 } }
  else { if (a.netIncome != null && a.netIncome > 0) r.payout = paid / a.netIncome * 100; r.sustainable = r.payout != null && r.payout < 80 && r.coverage === 'COVERED' && r.fcfPayout != null && r.fcfPayout < 100 }
  return r;
}
export function healthy(a: Annual | undefined) {
  if (!a) return { de: null as number | null, cr: null as number | null, ok: false };
  const de = (a.equity ?? 0) > 0 ? (a.totalDebt ?? 0) / a.equity! : null, cr = (a.currentLiabilities ?? 0) > 0 ? (a.currentAssets ?? 0) / a.currentLiabilities! : null;
  return { de, cr, ok: de != null && cr != null && de < 2 && cr > 1 };
}
export function quality(roe: number | null, a: Annual | undefined) {
  if (!a) return { margin: null as number | null, score: 0 };
  const margin = (a.revenue ?? 0) > 0 ? (a.netIncome ?? 0) / a.revenue! * 100 : null; let s = 0;
  if (roe) s += Math.min(roe * 100 / 20 * 50, 50);
  if (margin) s += Math.min(margin / 15 * 50, 50);
  return { margin, score: pyRoundN(s, 1) };
}
/** Statements newest first. Returns null when a filter rejects the stock. */
export function analyzeValue(a: Annual[], divs: Div[], price: number, closes: number[], today: string, reit: boolean, roe: number | null) {
  const r = closes.length >= 20 ? rsi(closes, 14, 1) : null; if (r == null || a.length < 4) return null;
  const dg = divGrowth(divs, today); if (!dg || !dg.cagr || dg.cagr < 4 || price <= 0 || !dg.latest) return null;
  const y = dg.latest / price * 100; if (y < 3) return null;
  const rev = a.slice(0, 4).map(x => x.revenue ?? 0).reverse(), eps = a.slice(0, 4).map(x => x.eps ?? 0).reverse();
  if (!positiveTrend(rev) || !positiveTrend(eps)) return null;
  const revC = rev[0] > 0 ? cagr(rev[0], rev[3], 3) : null, epsC = eps[0] > 0 ? cagr(eps[0], eps[3], 3) : null, st = stability(divs, +today.slice(0, 4));
  if (st.vol && st.vol > 100 && (!st.growing || st.years < 3)) return null;
  const su = sustainability(a[0], reit), h = healthy(a[0]), q = quality(roe, a[0]), ss = stabilityScore(st);
  const score = Math.min(dg.cagr / 10 * 15, 15) + ss * 0.2 + Math.min((revC || 0) / 10 * 10, 10) + Math.min((epsC || 0) / 15 * 10, 10) + (su.sustainable ? 10 : 0) + (h.ok ? 10 : 0) + q.score * 0.25;
  return { rsi: r, yield: pyRoundN(y, 2), divCagr: pyRoundN(dg.cagr, 2), revC, epsC, st, ss, su, h, q, score: pyRoundN(score, 1) };
}
/** Oversold (RSI ≤ 40) by score; if none, lowest RSI first. */
export function rank<T extends { rsi: number; score: number }>(r: T[], top = 20) {
  const o = r.filter(x => x.rsi <= 40);
  return o.length ? o.sort((a, b) => b.score - a.score).slice(0, top) : [...r].sort((a, b) => a.rsi - b.rsi || b.score - a.score).slice(0, top);
}

export const valueDivSkill: Skill = {
  id: 'value-dividend-screener', name: 'Value dividend stocks', group: 'Fundamentals', from: 'value-dividend-screener',
  desc: 'Value dividend stocks: yield ≥ 3%, P/E ≤ 20, P/B ≤ 2, dividends growing ≥ 4% a year, revenue and EPS trending up, scored on dividend growth and stability, payout sustainability, balance sheet and quality; oversold names (RSI ≤ 40) first. Dividends from Yahoo, statements from SEC filings.',
  inputs: [{ key: 'universe', label: 'Universe (largest US stocks)', type: 'number', default: 200 }, { key: 'symbols', label: 'Or these symbols', type: 'symbols', optional: true, default: '' }, { key: 'top', label: 'Show top', type: 'number', default: 20 }],
  async run(v, ctx: Ctx) {
    const custom = String(v.symbols ?? '').toUpperCase().split(/[\s,]+/).filter(Boolean), all = await ctx.json<Stock[]>('/api/us-stocks').catch(() => [] as Stock[]), info = new Map(all.map(s => [s.sym, s]));
    const syms = custom.length ? custom : all.filter(s => s.cap >= 2e9).slice(0, Math.min(600, Math.max(10, Number(v.universe) || 200))).map(s => s.sym), today = new Date().toISOString().slice(0, 10);
    const bars = await barsMany(ctx, syms), out: { s: string; rsi: number; score: number; row: (string | number | null)[] }[] = [], list = [...bars]; let i = 0;
    await Promise.all(Array.from({ length: 4 }, async () => { while (i < list.length) { const [s, b] = list[i++]; try {
      const price = b.at(-1)!.close, divs = await ctx.json<Div[]>(`/api/dividends?sym=${encodeURIComponent(s)}`), dg = divGrowth(divs, today);
      if (!dg || dg.latest / price * 100 < 3) continue;   // the original's ≥ 3% yield pre-screen
      const a = annuals(await ctx.json<Facts>(`/api/sec/facts?q=${encodeURIComponent(s)}`)), km = keyMetrics(a[0], price);
      if (!(km.peRatio != null && km.peRatio > 0 && km.peRatio <= 20 && km.pbRatio != null && km.pbRatio > 0 && km.pbRatio <= 2)) continue;
      const r = analyzeValue(a, divs, price, b.slice(-30).map(x => x.close), today, isReit(info.get(s)?.industry ?? ''), km.roe); if (!r) continue;
      out.push({ s, rsi: r.rsi, score: r.score, row: [s, info.get(s)?.name ?? '', r.score, `${r.yield}%`, km.peRatio.toFixed(1), km.pbRatio.toFixed(2), r.rsi, `${r.divCagr}%`, r.st.years, r.revC == null ? '–' : `${r.revC.toFixed(1)}%`, r.epsC == null ? '–' : `${r.epsC.toFixed(1)}%`, r.su.payout == null ? '–' : `${r.su.payout.toFixed(0)}%`, r.su.sustainable ? 'yes' : r.su.coverage, r.h.ok ? 'yes' : 'no'] })
    } catch { /* not covered */ } } }));
    const ranked = rank(out, Math.max(1, Number(v.top) || 20));
    return {
      verdict: { label: `${ranked.filter(x => x.rsi <= 40).length} oversold · ${out.length} qualified`, tone: out.length ? 'up' : 'muted', detail: `${bars.size} stocks checked.` },
      tables: [{ title: 'Value dividend stocks', cols: ['Symbol', 'Name', 'Score', 'Yield', 'P/E', 'P/B', 'RSI', 'Div CAGR 3y', 'Years of growth', 'Revenue CAGR', 'EPS CAGR', 'Payout', 'Sustainable', 'Healthy'], rows: ranked.map(x => x.row) }],
      notes: ['P/E and P/B use the latest 10-K and today\'s price (the original used FMP ratios). Payout sustainable = below 80% of earnings with free cash flow covering the dividend (REITs: below 80% of FFO).', 'Not an order.'],
    };
  },
};
