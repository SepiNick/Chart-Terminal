// institutional-flow-tracker over a smart-money panel: the original reads FMP's per-stock 13F ownership summaries
// (every filer). Without a key, the same summary is built here from the latest two 13F-HRs of a panel of funds (the
// bundled famous filers plus your CIKs), then the original's ownership metrics, coverage grade (with thresholds
// scaled to the panel), share-class de-duplication and ranking apply.
import { pyRoundN, type Ctx, type Skill } from './types.ts';
import { aggregate, isStock, loadQuarter, resolveTickers, TickerIndex, type Pos } from './copycat.ts';
import { FILERS } from './filers13f.ts';

export interface Summary { investorsHolding: number; lastInvestorsHolding: number; numberOf13Fshares: number; lastNumberOf13Fshares: number; increasedPositions: number; reducedPositions: number; newPositions: number; closedPositions: number }
export interface Holder { name: string; shares: number; change: number; is_new: boolean; is_sold_out: boolean }
export const coverageGrade = (inv: number, last: number, reliable = 50, usable = 10) => (last <= 0 || inv < usable ? 'C' : inv >= reliable ? 'A' : 'B');
/** Per-stock (CUSIP) ownership summary across funds: `now` and `prev` are each fund's stock positions. */
export function panelSummaries(funds: { name: string; now: Pos[]; prev: Pos[] }[]) {
  const out = new Map<string, { s: Summary; issuer: string; ticker: string | null; holders: Holder[] }>(), get = (p: Pos) => { if (!out.has(p.cusip)) out.set(p.cusip, { s: { investorsHolding: 0, lastInvestorsHolding: 0, numberOf13Fshares: 0, lastNumberOf13Fshares: 0, increasedPositions: 0, reducedPositions: 0, newPositions: 0, closedPositions: 0 }, issuer: p.issuer, ticker: p.ticker ?? null, holders: [] }); return out.get(p.cusip)! };
  for (const f of funds) {
    const now = new Map(f.now.filter(isStock).map(p => [p.cusip, p])), prev = new Map(f.prev.filter(isStock).map(p => [p.cusip, p]));
    for (const [c, p] of now) { const e = get(p), q = prev.get(c); e.s.investorsHolding++; e.s.numberOf13Fshares += p.shares; if (q) { e.s.lastInvestorsHolding++; e.s.lastNumberOf13Fshares += q.shares; if (p.shares > q.shares) e.s.increasedPositions++; else if (p.shares < q.shares) e.s.reducedPositions++ } else e.s.newPositions++; e.holders.push({ name: f.name, shares: p.shares, change: p.shares - (q?.shares ?? 0), is_new: !q, is_sold_out: false }); if (!e.ticker && p.ticker) e.ticker = p.ticker }
    for (const [c, q] of prev) if (!now.has(c)) { const e = get(q); e.s.lastInvestorsHolding++; e.s.lastNumberOf13Fshares += q.shares; e.s.closedPositions++; e.holders.push({ name: f.name, shares: 0, change: -q.shares, is_new: false, is_sold_out: true }) }
  }
  return out;
}
/** The original's calculate_ownership_metrics on one summary (null when the grade is C). */
export function ownershipMetrics(s: Summary, grade = coverageGrade) {
  const inv = s.investorsHolding || 0, last = s.lastInvestorsHolding || 0, g = grade(inv, last); if (g === 'C') return null;
  const cur = s.numberOf13Fshares || 0, prev = s.lastNumberOf13Fshares || 0, ch = cur - prev, inc = s.increasedPositions || 0, red = s.reducedPositions || 0, nw = s.newPositions || 0;
  return { current_total_shares: cur, previous_total_shares: prev, shares_change: ch, percent_change: pyRoundN(prev > 0 ? ch / prev * 100 : 0, 2), current_institution_count: inv, previous_institution_count: last, institution_count_change: inv - last, buyers: inc, sellers: red, unchanged: Math.max(0, inv - inc - red - nw), new_positions: nw, closed_positions: s.closedPositions || 0, reliability_grade: g };
}
const CLASS_GROUPS: [RegExp, string][] = [[/^BRK[.-]?[AB]$/, 'BRK'], [/^GOOG[L]?$/, 'GOOG'], [/^PBR[.-]?A?$/, 'PBR'], [/^RDS[.-]?[AB]$/, 'RDS'], [/^FCAU?$/, 'FCA'], [/^(LBTYA|LBTYB|LBTYK)$/, 'LBTY'], [/^FOX[A]?$/, 'FOX'], [/^(DISCA|DISCB|DISCK)$/, 'DISC'], [/^NWS[A]?$/, 'NWS'], [/^(VIACA|VIAC)$/, 'VIAC']];
/** Keep one row per multi-class company: the largest market cap. */
export function dedupeClasses<T extends { symbol: string; market_cap: number }>(r: T[]) {
  const g = new Map<string, number[]>(); r.forEach((x, i) => { const k = CLASS_GROUPS.find(([re]) => re.test(x.symbol))?.[1]; if (k) g.set(k, [...(g.get(k) ?? []), i]) });
  const drop = new Set<number>(); for (const ix of g.values()) if (ix.length > 1) { const best = ix.reduce((a, b) => (r[b].market_cap > r[a].market_cap ? b : a)); for (const i of ix) if (i !== best) drop.add(i) }
  return r.filter((_, i) => !drop.has(i));
}

export const instFlowSkill: Skill = {
  id: 'institutional-flow-tracker', name: 'Smart-money flows (13F panel)', group: 'Fundamentals', from: 'institutional-flow-tracker',
  desc: 'Where a panel of well-known funds (Berkshire, Pershing Square, Scion, Bridgewater… plus your CIKs) moved money last quarter, from their two latest 13F-HRs: holders, buyers, sellers, new and closed positions and share change per stock, with the original\'s metrics and ranking. A 45-day-old snapshot of a small panel, not all institutions.',
  inputs: [
    { key: 'extra', label: 'Extra fund CIKs', type: 'symbols', optional: true, default: '' }, { key: 'symbol', label: 'One stock (optional)', type: 'text', optional: true, default: '' },
    { key: 'minHolders', label: 'Minimum panel holders', type: 'number', default: 2 }, { key: 'minChange', label: 'Minimum share change %', type: 'number', default: 10 },
    { key: 'sort', label: 'Sort by', type: 'select', options: ['ownership_change', 'institution_count_change'], default: 'ownership_change' },
  ],
  async run(v, ctx: Ctx) {
    const ciks = [...new Set([...FILERS.filter(f => !f.status).map(f => f.cik), ...String(v.extra ?? '').split(/[\s,]+/).filter(x => /^\d{1,10}$/.test(x)).map(x => x.padStart(10, '0'))])];
    const idx = new TickerIndex(await ctx.json<[string, string, string][]>('/api/sec/tickers')), funds: { name: string; now: Pos[]; prev: Pos[]; period: string }[] = [], failed: string[] = [];
    for (const c of ciks) { try { const now = await loadQuarter(ctx, c), prev = await loadQuarter(ctx, c, now.chosen.period); const b = (rows: typeof now.rows) => { const a = aggregate(rows); resolveTickers(a.positions, idx); return a.positions }; funds.push({ name: now.filer, now: b(now.rows), prev: b(prev.rows), period: now.chosen.period }) } catch { failed.push(FILERS.find(f => f.cik === c)?.name ?? c) } }
    const minH = Math.max(1, Number(v.minHolders) || 2), grade = (inv: number, last: number) => coverageGrade(inv, last, Math.max(minH * 3, 6), minH), caps = new Map((await ctx.json<{ sym: string; cap: number }[]>('/api/us-stocks').catch(() => [])).map(s => [s.sym, s.cap]));
    const sums = panelSummaries(funds), want = String(v.symbol ?? '').trim().toUpperCase();
    if (want) {
      const e = [...sums.values()].find(x => x.ticker === want); if (!e) throw new Error(`${want} is not held by the panel`);
      const m = ownershipMetrics(e.s, (a, b) => coverageGrade(a, b, 1e9, 0));
      return { verdict: { label: `${want}: ${e.s.investorsHolding} panel funds hold it (${e.s.newPositions} new, ${e.s.closedPositions} closed)`, tone: (m?.shares_change ?? 0) >= 0 ? 'up' : 'dn', detail: m ? `Panel shares ${m.percent_change >= 0 ? '+' : ''}${m.percent_change}% vs the previous quarter.` : '' },
        tables: [{ title: 'Panel holders', cols: ['Fund', 'Shares', 'Change', 'Status'], rows: [...e.holders].sort((a, b) => b.shares - a.shares).map(h => [h.name, Math.round(h.shares).toLocaleString(), Math.round(h.change).toLocaleString(), h.is_new ? 'new' : h.is_sold_out ? 'sold out' : h.change > 0 ? 'added' : h.change < 0 ? 'trimmed' : 'unchanged']) }], notes: [`Panel: ${funds.length} funds.`] };
    }
    let res = [...sums.values()].flatMap(e => { const m = ownershipMetrics(e.s, grade); return m && e.ticker && Math.abs(m.percent_change) >= (Number(v.minChange) || 0) && m.current_institution_count >= minH ? [{ symbol: e.ticker, issuer: e.issuer, market_cap: caps.get(e.ticker) ?? 0, ...m }] : [] });
    res = dedupeClasses(res).sort((a, b) => (String(v.sort) === 'institution_count_change' ? Math.abs(b.institution_count_change) - Math.abs(a.institution_count_change) : Math.abs(b.percent_change) - Math.abs(a.percent_change)));
    return {
      verdict: { label: `${res.filter(r => r.shares_change > 0).length} accumulated · ${res.filter(r => r.shares_change < 0).length} distributed`, tone: 'muted', detail: `${funds.length} funds, quarters ending ${[...new Set(funds.map(f => f.period))].join(', ')}.${failed.length ? ` Unavailable: ${failed.join(', ')}.` : ''}` },
      tables: [{ title: 'Panel flows', cols: ['Ticker', 'Issuer', 'Share change', 'Holders', 'Δ holders', 'Buyers', 'Sellers', 'New', 'Closed', 'Grade'], rows: res.slice(0, 60).map(r => [r.symbol, r.issuer, `${r.percent_change >= 0 ? '+' : ''}${r.percent_change}%`, r.current_institution_count, r.institution_count_change, r.buyers, r.sellers, r.new_positions, r.closed_positions, r.reliability_grade]) }],
      notes: [`Coverage grade: C (dropped) below ${minH} panel holders or with no holder last quarter, A from ${Math.max(minH * 3, 6)} — the original uses 10 and 50 over all institutions.`, '13F data is 45 days old and long-only. Not an order.'],
    };
  },
};
