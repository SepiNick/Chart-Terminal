// earnings-trade-analyzer: grade recent earnings reactions 0–100 on five factors — the earnings gap (25%),
// the 20-day run-up into the report (30%), 20/60-day volume (20%), distance from the 200-day (15%) and 50-day (10%)
// averages — A/B/C/D, with the original's optional entry filter. Earnings dates and BMO/AMC timing come from the
// company's SEC 8-K (item 2.02). Bars newest first, like the original.
import { pyRoundN, type Ctx, type Skill } from './types.ts';
import { barsMany, type Stock } from './vcp.ts';

export interface DB { date: string; open: number; close: number; volume: number }
const idx = (p: DB[], d: string) => p.findIndex(b => b.date === d);
export function gap(p: DB[], date: string, timing: string) {
  const i = idx(p, date); if (i < 0) return { pct: 0, score: 0 };
  const t = (timing || 'unknown').toLowerCase(); let base: number, g: number;
  if (t === 'bmo') { if (i + 1 >= p.length) return { pct: 0, score: 0 }; base = p[i + 1].close; g = p[i].open }
  else { if (i - 1 < 0) return { pct: 0, score: 0 }; base = p[i].close; g = p[i - 1].open }
  if (base === 0) return { pct: 0, score: 0 };
  const pct = (g / base - 1) * 100, a = Math.abs(pct);
  return { pct: pyRoundN(pct, 2), score: a >= 10 ? 100 : a >= 7 ? 85 : a >= 5 ? 70 : a >= 3 ? 55 : a >= 1 ? 35 : 15 };
}
export function trend(p: DB[], date: string) {
  const i = idx(p, date); if (i < 0 || i + 20 >= p.length || p[i + 20].close === 0) return { pct: 0, score: 0 };
  const r = (p[i].close / p[i + 20].close - 1) * 100;
  return { pct: pyRoundN(r, 2), score: r >= 15 ? 100 : r >= 10 ? 85 : r >= 5 ? 70 : r >= 0 ? 50 : r >= -5 ? 30 : 15 };
}
export function volume(p: DB[], date: string) {
  if (idx(p, date) < 0 || Math.min(20, p.length) < 5 || Math.min(60, p.length) < 20) return { ratio: 0, score: 0 };
  const v20 = p.slice(0, 20).map(b => b.volume), v60 = p.slice(0, 60).map(b => b.volume), a = v20.reduce((x, y) => x + y, 0) / v20.length, b = v60.reduce((x, y) => x + y, 0) / v60.length;
  if (b === 0) return { ratio: 0, score: 0 };
  const r = a / b; return { ratio: pyRoundN(r, 2), score: r >= 2 ? 100 : r >= 1.5 ? 80 : r >= 1.2 ? 60 : r >= 1 ? 40 : 20 };
}
export function maPos(p: DB[], n: 50 | 200) {
  if (p.length < n) return { dist: 0, score: 0 };
  const ma = p.slice(0, n).reduce((a, b) => a + b.close, 0) / n; if (ma === 0) return { dist: 0, score: 0 };
  const d = (p[0].close / ma - 1) * 100;
  return { dist: pyRoundN(d, 2), score: n === 200 ? (d >= 20 ? 100 : d >= 10 ? 85 : d >= 5 ? 70 : d >= 0 ? 55 : d >= -5 ? 35 : 15) : d >= 10 ? 100 : d >= 5 ? 80 : d >= 0 ? 60 : d >= -5 ? 35 : 15 };
}
export function analyzeEarnings(p: DB[], date: string, timing: string) {
  const g = gap(p, date, timing), t = trend(p, date), v = volume(p, date), m200 = maPos(p, 200), m50 = maPos(p, 50);
  const score = pyRoundN(g.score * 0.25 + t.score * 0.3 + v.score * 0.2 + m200.score * 0.15 + m50.score * 0.1, 1);
  return { g, t, v, m200, m50, score, grade: score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 55 ? 'C' : 'D' };
}
/** Original's backtest filter: skip price < $30 and the gap ≥ 10% with score ≥ 85 paradox. */
export const entryOk = (price: number, gapPct: number, score: number) => !(price < 30) && !(Math.abs(gapPct) >= 10 && score >= 85);
export const GUIDE: Record<string, string> = { A: 'Consider entry on a pullback to gap support or a breakout continuation.', B: 'Monitor for follow-through buying; wait for a pullback or volume confirmation.', C: 'Mixed signals: wait for clearer price action.', D: 'Weak setup: avoid.' };

/** Latest item-2.02 8-K per symbol within `days` calendar days, `n` at a time. */
export async function recentEarnings(ctx: Ctx, syms: string[], days: number, n = 6) {
  const out = new Map<string, { date: string; timing: string }>(), since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10); let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < syms.length) { const s = syms[i++]; try { const e = (await ctx.json<{ date: string; timing: string }[]>(`/api/sec/earnings?q=${encodeURIComponent(s)}`)).find(x => x.date >= since); if (e) out.set(s, e) } catch { /* not an SEC filer */ } } }));
  return out;
}
export const toDB = (b: { time: number; open: number; close: number; volume: number }[], n = 250): DB[] => b.slice(-n).reverse().map(x => ({ date: new Date(x.time * 1000).toISOString().slice(0, 10), open: x.open, close: x.close, volume: x.volume }));

export const earnTradeSkill: Skill = {
  id: 'earnings-trade-analyzer', name: 'Earnings reactions', group: 'Fundamentals', from: 'earnings-trade-analyzer',
  desc: 'Recent earnings reactions graded A–D: gap size, the 20-day run-up into the report, volume trend and position vs the 50/200-day averages. Reporters and BMO/AMC timing come from SEC 8-K filings (item 2.02) of the largest US stocks.',
  inputs: [
    { key: 'days', label: 'Reported in the last N days', type: 'number', default: 5 },
    { key: 'universe', label: 'Universe (largest US stocks)', type: 'number', default: 300, hint: 'first run reads one SEC filing list per stock' },
    { key: 'symbols', label: 'Or these symbols', type: 'symbols', optional: true, default: '' },
    { key: 'filter', label: 'Apply the entry filter', type: 'bool', default: false },
  ],
  async run(v, ctx: Ctx) {
    const custom = String(v.symbols ?? '').toUpperCase().split(/[\s,]+/).filter(Boolean);
    const all = await ctx.json<Stock[]>('/api/us-stocks').catch(() => [] as Stock[]), names = new Map(all.map(s => [s.sym, s]));
    const syms = custom.length ? custom : all.filter(s => s.cap >= 500e6).slice(0, Math.min(800, Math.max(10, Number(v.universe) || 300))).map(s => s.sym);
    const ev = await recentEarnings(ctx, syms, Math.max(1, Math.min(60, Number(v.days) || 5))), bars = await barsMany(ctx, [...ev.keys()]);
    let res = [...ev].flatMap(([s, e]) => { const b = bars.get(s); if (!b) return []; const p = toDB(b), a = analyzeEarnings(p, e.date, e.timing); return [{ s, e, a, price: p[0]?.close ?? 0 }] });
    if (v.filter === true) res = res.filter(r => entryOk(r.price, r.a.g.pct, r.a.score));
    res.sort((x, y) => y.a.score - x.a.score);
    return {
      verdict: { label: `${res.filter(r => r.a.grade === 'A').length} A · ${res.filter(r => r.a.grade === 'B').length} B · ${res.length} reporters`, tone: res.some(r => r.a.grade === 'A' || r.a.grade === 'B') ? 'up' : 'muted', detail: `${syms.length} stocks checked for an earnings 8-K in the last ${v.days || 5} days.` },
      tables: [{ title: 'Earnings reactions', cols: ['Symbol', 'Name', 'Reported', 'Timing', 'Grade', 'Score', 'Gap', '20d into report', 'Vol 20/60', 'vs 200d', 'vs 50d', 'Price', 'Guidance'], rows: res.map(r => [r.s, names.get(r.s)?.name ?? '', r.e.date, r.e.timing.toUpperCase(), r.a.grade, r.a.score, `${r.a.g.pct}%`, `${r.a.t.pct}%`, r.a.v.ratio, `${r.a.m200.dist}%`, `${r.a.m50.dist}%`, r.price.toFixed(2), GUIDE[r.a.grade]]) }],
      notes: ['Timing is read from the 8-K acceptance time (New York): before 9:30 = BMO, from 16:00 = AMC; anything else is "unknown" and measured as AMC, like the original.', 'Not an order.'],
    };
  },
};
