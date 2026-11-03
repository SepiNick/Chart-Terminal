// trader-analyst: a company's own reported numbers from SEC EDGAR (XBRL company facts from its 10-Qs and 10-Ks):
// revenue, margins, net income and diluted EPS quarter by quarter against a year earlier, the trailing twelve
// months, what changed, and links to the latest 10-Q/10-K and earnings 8-K.
import type { Ctx, Skill } from './types.ts';
import { analyse, changes, latestFilings, type Facts } from './secfacts.ts';

const m = (v: number | null) => (v == null ? '–' : (v / 1e6).toLocaleString(undefined, { maximumFractionDigits: 0 }));
const p = (v: number | null) => (v == null ? '–' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`);
export const analystSkill: Skill = {
  id: 'trader-analyst', name: 'Earnings analyst (SEC filings)', group: 'Fundamentals', from: 'trader-analyst',
  desc: 'What the company actually filed with the SEC: revenue, gross/operating/net margins, net income and diluted EPS for the last quarters, each against the same quarter a year earlier, the trailing twelve months, what changed, and the latest 10-Q/10-K and earnings 8-K.',
  inputs: [{ key: 'symbol', label: 'Ticker', type: 'text', default: 'AAPL' }, { key: 'quarters', label: 'Quarters', type: 'number', default: 6 }],
  async run(v, ctx: Ctx) {
    const t = String(v.symbol ?? '').trim().toUpperCase(); if (!t) throw new Error('Give a ticker');
    const [cf, sub, cik] = await Promise.all([ctx.json<Facts>(`/api/sec/facts?q=${encodeURIComponent(t)}`), ctx.json<{ filings?: { recent?: Record<string, string[]> } }>(`/api/sec/submissions?q=${encodeURIComponent(t)}`).catch(() => null), ctx.json<{ cik: string }>(`/api/sec/cik?q=${encodeURIComponent(t)}`)]);
    const r = analyse(cf, Math.max(1, Math.min(12, Number(v.quarters) || 6))), f = sub ? latestFilings(sub, cik.cik) : null, cur = r.rows[0];
    const stale = f?.report && cur && f.report.period > cur.end && (Date.parse(f.report.period) - Date.parse(cur.end)) / 864e5 > 20;
    return {
      verdict: { label: `${r.entity} · quarter ending ${cur?.end ?? '–'}`, tone: (cur?.revenue_yoy ?? 0) >= 0 ? 'up' : 'dn', detail: `TTM revenue $${m(r.ttm.revenue ?? null)}M, net income $${m(r.ttm.net_income ?? null)}M, diluted EPS ${r.ttm.eps_diluted != null ? `$${r.ttm.eps_diluted.toFixed(2)}` : '–'}.` },
      kpis: cur ? [{ label: 'Revenue YoY', value: p(cur.revenue_yoy), tone: (cur.revenue_yoy ?? 0) >= 0 ? 'up' : 'dn' }, { label: 'EPS YoY', value: p(cur.eps_yoy), tone: (cur.eps_yoy ?? 0) >= 0 ? 'up' : 'dn' }, { label: 'Gross margin', value: cur.gross_margin == null ? '–' : `${cur.gross_margin}%` }, { label: 'Operating margin', value: cur.operating_margin == null ? '–' : `${cur.operating_margin}%` }, { label: 'Net margin', value: cur.net_margin == null ? '–' : `${cur.net_margin}%` }] : [],
      tables: [{ title: 'Quarters (US$ millions except EPS)', cols: ['Quarter end', 'Fiscal', 'Revenue', 'Rev YoY', 'Gross', 'Oper', 'Net', 'Net income', 'EPS dil', 'EPS YoY', ''], rows: r.rows.map(x => [x.end, x.fiscal.trim(), m(x.revenue), p(x.revenue_yoy), x.gross_margin == null ? '–' : `${x.gross_margin}%`, x.operating_margin == null ? '–' : `${x.operating_margin}%`, x.net_margin == null ? '–' : `${x.net_margin}%`, m(x.net_income), x.eps_diluted ?? '–', p(x.eps_yoy), x.derived ? 'derived' : '']) }],
      notes: [...changes(r), ...(stale ? [`SEC's XBRL facts stop at ${cur!.end}, but a ${f!.report!.form} for the period ending ${f!.report!.period} was filed ${f!.report!.filed}: read it directly.`] : []), ...(r.rows.some(x => x.derived) ? ['Derived quarters are the 10-K year minus the three 10-Qs; derived EPS is approximate.'] : [])],
      links: [...(f?.report ? [{ label: `Latest ${f.report.form} (period ${f.report.period}, filed ${f.report.filed})`, url: f.report.url }] : []), ...(f?.earnings8k ? [{ label: `Latest earnings 8-K, filed ${f.earnings8k.filed}`, url: f.earnings8k.url }] : [])],
    };
  },
};
