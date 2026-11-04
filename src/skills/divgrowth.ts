// dividend-growth-pullback-screener: fast dividend growers (≥ 12% 3-year dividend CAGR, ≥ 1.5% yield) in a pullback
// (14-day RSI ≤ 40), with positive revenue/EPS growth and a healthy balance sheet, scored on dividend growth,
// quality, RSI timing and valuation; payout sustainability checked against earnings and free cash flow (FFO for
// REITs). The original's rules; dividends from Yahoo, statements from SEC 10-Ks.
import { pyRoundN, type Ctx, type Skill } from './types.ts';
import { barsMany, type Stock } from './vcp.ts';
import { annuals, keyMetrics, type Annual, type Facts } from './secfacts.ts';

/** Wilder RSI on oldest-first closes, rounded to `dp` decimals (2 here, 1 in the value screener). */
export function rsi(p: number[], n = 14, dp = 2) {
  if (p.length < n + 1) return null;
  const ch = p.slice(1).map((x, i) => x - p[i]), g = ch.map(c => (c > 0 ? c : 0)), l = ch.map(c => (c < 0 ? -c : 0));
  let ag = g.slice(0, n).reduce((a, b) => a + b, 0) / n, al = l.slice(0, n).reduce((a, b) => a + b, 0) / n;
  for (let i = n; i < g.length; i++) { ag = (ag * (n - 1) + g[i]) / n; al = (al * (n - 1) + l[i]) / n }
  return al === 0 ? 100 : pyRoundN(100 - 100 / (1 + ag / al), dp);
}
const cagr = (a: number, b: number, y: number) => (a <= 0 || b <= 0 || y <= 0 ? null : pyRoundN(((b / a) ** (1 / y) - 1) * 100, 2));
/** Calendar-year dividend sums (the current year left out): CAGR over the last 4 full years, consistency, streak. */
export function dividendGrowth(divs: { date: string; dividend: number }[], year = new Date().getUTCFullYear()) {
  if (divs.length < 4) return null;
  const by = new Map<string, number>(); for (const d of [...divs].sort((a, b) => (a.date < b.date ? -1 : 1))) by.set(d.date.slice(0, 4), (by.get(d.date.slice(0, 4)) ?? 0) + (d.dividend || 0));
  by.delete(String(year)); if (by.size < 4) return null;
  const ys = [...by.keys()].sort(), all = ys.map(y => by.get(y)!), v = all.slice(-4);
  let streak = 0; for (let i = all.length - 1; i > 0; i--) { if (all[i] >= all[i - 1] * 0.95) streak++; else break }
  return { cagr: cagr(v[0], v[3], 3), consistent: v.every((x, i) => i === 0 || x >= v[i - 1] * 0.95), latest: v[3], streak };
}
export const isReit = (industry: string) => /\breits?\b|\breal estate investment trusts?\b/i.test(industry) && !/\bnon[- ]reits?\b/i.test(industry);
export function payout(a: Annual[], reit: boolean) {
  const r = { payout: null as number | null, fcfPayout: null as number | null, fcfCoverage: 'MISSING_DATA', sustainable: false, basis: reit ? 'FFO' : 'EARNINGS_AND_FCF' }, cf = a[0];
  if (!cf) return r;
  const paid = cf.dividendsPaid != null ? Math.abs(cf.dividendsPaid) : null, fcf = cf.fcf;
  if (paid == null) return r;
  if (paid === 0) { r.fcfCoverage = 'NO_DIVIDEND'; return r }
  if (fcf != null) { r.fcfCoverage = fcf < 0 ? 'NEGATIVE_FCF' : fcf === 0 ? 'ZERO_FCF' : fcf < paid ? 'INSUFFICIENT_FCF' : fcf === paid ? 'AT_LIMIT' : 'COVERED'; if (fcf > 0) r.fcfPayout = paid / fcf * 100 }
  if (reit) { const ffo = cf.netIncome != null && cf.da != null ? cf.netIncome + cf.da : null; if (ffo && ffo > 0) { r.payout = paid / ffo * 100; r.sustainable = r.payout < 80 } }
  else { if (cf.netIncome != null && cf.netIncome > 0) r.payout = paid / cf.netIncome * 100; r.sustainable = r.payout != null && r.payout < 80 && r.fcfCoverage === 'COVERED' && r.fcfPayout != null && r.fcfPayout < 100 }
  return r;
}
export function health(a: Annual | undefined) {
  if (!a) return { de: null as number | null, cr: null as number | null, healthy: false };
  const de = a.equity && a.equity > 0 ? pyRoundN((a.totalDebt ?? 0) / a.equity, 2) : null, cr = a.currentLiabilities && a.currentLiabilities > 0 ? pyRoundN((a.currentAssets ?? 0) / a.currentLiabilities, 2) : null;
  return { de, cr, healthy: (de == null || de < 2) && (cr == null || cr > 1) };
}
export function growth(a: Annual[]) { if (a.length < 4) return { rev: null as number | null, eps: null as number | null }; return { rev: cagr(a[3].revenue ?? 0, a[0].revenue ?? 0, 3), eps: cagr(a[3].eps ?? 0, a[0].eps ?? 0, 3) } }
export interface DS { dividend_cagr_3y: number; dividend_consistent: boolean; roe: number; profit_margin: number; debt_to_equity: number | null; rsi: number; pe_ratio: number | null; pb_ratio: number | null }
export function score(s: DS) {
  let x = s.dividend_cagr_3y >= 20 ? 40 : s.dividend_cagr_3y >= 15 ? 35 : s.dividend_cagr_3y >= 12 ? 30 : 20;
  if (s.dividend_consistent) x += 5;
  x += s.roe >= 20 ? 12 : s.roe >= 15 ? 10 : s.roe >= 10 ? 7 : 3;
  x += s.profit_margin >= 20 ? 10 : s.profit_margin >= 15 ? 8 : s.profit_margin >= 10 ? 6 : 3;
  const de = s.debt_to_equity ?? 999; x += de < 0.5 ? 8 : de < 1 ? 6 : de < 2 ? 3 : 0;   // original: a missing D/E counts as 999
  x += s.rsi <= 25 ? 20 : s.rsi <= 30 ? 18 : s.rsi <= 35 ? 15 : s.rsi <= 40 ? 12 : 5;
  const pe = s.pe_ratio ?? 999, pb = s.pb_ratio ?? 999;
  x += pe < 15 ? 5 : pe < 25 ? 3 : 0; x += pb < 3 ? 5 : pb < 5 ? 3 : 0;
  return pyRoundN(Math.min(x, 100), 1);
}

export const divGrowthSkill: Skill = {
  id: 'dividend-growth-pullback-screener', name: 'Dividend growers on a pullback', group: 'Fundamentals', from: 'dividend-growth-pullback-screener',
  desc: 'Dividend growth stocks (≥ 12% 3-year dividend CAGR, ≥ 1.5% yield) that are oversold (RSI ≤ 40), with growing revenue and EPS, a healthy balance sheet and the payout checked against earnings and free cash flow. Dividends from Yahoo, statements from SEC filings.',
  inputs: [
    { key: 'minYield', label: 'Minimum yield %', type: 'number', default: 1.5 }, { key: 'minGrowth', label: 'Minimum dividend CAGR %', type: 'number', default: 12 }, { key: 'rsiMax', label: 'Maximum RSI', type: 'number', default: 40 },
    { key: 'universe', label: 'Universe (largest US stocks)', type: 'number', default: 150 }, { key: 'symbols', label: 'Or these symbols', type: 'symbols', optional: true, default: '' },
  ],
  async run(v, ctx: Ctx) {
    const custom = String(v.symbols ?? '').toUpperCase().split(/[\s,]+/).filter(Boolean), all = await ctx.json<Stock[]>('/api/us-stocks').catch(() => [] as Stock[]), info = new Map(all.map(s => [s.sym, s]));
    const syms = custom.length ? custom : all.filter(s => s.cap >= 2e9).slice(0, Math.min(500, Math.max(10, Number(v.universe) || 150))).map(s => s.sym);
    const minY = Number(v.minYield) || 1.5, minG = Number(v.minGrowth) || 12, rMax = Number(v.rsiMax) || 40, bars = await barsMany(ctx, syms), rows: (string | number | null)[][] = [];
    let i = 0; const list = [...bars];
    await Promise.all(Array.from({ length: 4 }, async () => { while (i < list.length) { const [s, b] = list[i++]; try {
      const price = b.at(-1)!.close; if (price <= 0) continue;
      const g = dividendGrowth(await ctx.json(`/api/dividends?sym=${encodeURIComponent(s)}`)); if (!g || !g.cagr || g.cagr < minG || !g.latest) continue;
      const y = g.latest / price * 100; if (y < minY) continue;
      const r = rsi(b.slice(-30).map(x => x.close)); if (r == null || r > rMax) continue;
      const a = annuals(await ctx.json<Facts>(`/api/sec/facts?q=${encodeURIComponent(s)}`)), gr = growth(a);
      if ((gr.rev != null && gr.rev < 0) || (gr.eps != null && gr.eps < 0)) continue;
      const h = health(a[0]); if (!h.healthy) continue;
      const km = keyMetrics(a[0], price), reit = isReit(info.get(s)?.industry ?? ''), po = payout(a, reit);
      const sc = score({ dividend_cagr_3y: g.cagr, dividend_consistent: g.consistent, roe: (km.roe || 0) * 100, profit_margin: (km.netProfitMargin || 0) * 100, debt_to_equity: h.de, rsi: r, pe_ratio: km.peRatio ?? 0, pb_ratio: km.pbRatio ?? 0 });
      rows.push([s, info.get(s)?.name ?? '', sc, `${pyRoundN(y, 2)}%`, `${g.cagr}%`, g.streak, r, km.peRatio == null ? '–' : km.peRatio.toFixed(1), po.payout == null ? '–' : `${po.payout.toFixed(0)}%`, po.fcfPayout == null ? '–' : `${po.fcfPayout.toFixed(0)}%`, po.sustainable ? 'yes' : po.fcfCoverage, h.de ?? '–'])
    } catch { /* not covered */ } } }));
    rows.sort((x, y) => (y[2] as number) - (x[2] as number));
    return {
      verdict: { label: `${rows.length} dividend growers on a pullback`, tone: rows.length ? 'up' : 'muted', detail: `${bars.size} stocks checked.` },
      tables: [{ title: 'Candidates', cols: ['Symbol', 'Name', 'Score', 'Yield', 'Div CAGR 3y', 'Years of growth', 'RSI', 'P/E', 'Payout', 'FCF payout', 'Sustainable', 'D/E'], rows }],
      notes: ['P/E, P/B, ROE and margin come from the latest 10-K and today\'s price (the original used FMP key metrics; a missing P/E or P/B counts as 0 there too). Payout is sustainable below 80% of earnings with free cash flow covering the dividend (REITs: below 80% of FFO).', 'Not an order.'],
    };
  },
};
