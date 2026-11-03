// downtrend-duration-analyzer: how long peak-to-trough corrections usually last, by sector and market-cap tier.
// Peaks and troughs are closes that are the max/min of a ±20-day window; a downtrend runs from a peak to the lowest
// trough before the next peak, kept if it is at least 5% deep and 3 days long — the original's rules and statistics.
import type { Ctx, Skill } from './types.ts';

export interface Down { sym: string; sector: string; tier: string; peak: string; trough: string; days: number; depth: number }
export const tier = (cap: number | null) => cap == null ? 'Unknown' : cap >= 200e9 ? 'Mega' : cap >= 10e9 ? 'Large' : cap >= 2e9 ? 'Mid' : 'Small';
export function peaksTroughs(c: number[], w = 20) {
  const p: number[] = [], t: number[] = [];
  for (let i = w; i < c.length - w; i++) { const win = c.slice(i - w, i + w + 1); if (c[i] === Math.max(...win)) p.push(i); if (c[i] === Math.min(...win)) t.push(i) }
  return { p, t };
}
export function downtrends(dates: string[], c: number[], w = 20, minDepth = 5, minDays = 3) {
  if (c.length < w * 2 + 1) return [];
  const { p, t } = peaksTroughs(c, w), out: { peak: string; trough: string; days: number; depth: number }[] = [];
  if (!p.length || !t.length) return out;
  for (const pi of p) {
    const end = p.find(x => x > pi) ?? c.length, valid = t.filter(x => x > pi && x < end);
    if (!valid.length) continue;
    const ti = valid.reduce((a, b) => (c[b] < c[a] ? b : a)), depth = (c[ti] - c[pi]) / c[pi] * 100;
    if (Math.abs(depth) < minDepth || ti - pi < minDays) continue;
    out.push({ peak: dates[pi], trough: dates[ti], days: ti - pi, depth: Math.round(depth * 100) / 100 });
  }
  return out;
}
/** numpy.percentile (linear interpolation). */
export function percentile(v: number[], q: number) { const s = [...v].sort((a, b) => a - b), k = (s.length - 1) * q / 100, f = Math.floor(k); return f + 1 < s.length ? s[f] + (s[f + 1] - s[f]) * (k - f) : s[f] }
const mean1 = (v: number[]) => Math.round(v.reduce((a, b) => a + b, 0) / v.length * 10) / 10;
export function stats(d: { days: number }[]) {
  if (!d.length) return { n: 0, median: 0, mean: 0, p25: 0, p75: 0, p90: 0 };
  const v = d.map(x => x.days);
  return { n: v.length, median: Math.trunc(percentile(v, 50)), mean: mean1(v), p25: Math.trunc(percentile(v, 25)), p75: Math.trunc(percentile(v, 75)), p90: Math.trunc(percentile(v, 90)) };
}
export function groups(d: Down[], key: 'sector' | 'tier') {
  const g = new Map<string, number[]>();
  for (const x of d) g.set(x[key], [...(g.get(x[key]) ?? []), x.days]);
  return [...g].map(([k, v]) => ({ k, n: v.length, median: Math.trunc(percentile(v, 50)), mean: mean1(v) }));
}

export const downtrendSkill: Skill = {
  id: 'downtrend-duration-analyzer', name: 'Downtrend durations', group: 'Market regime', from: 'downtrend-duration-analyzer',
  desc: 'How long corrections usually last: peak-to-trough downtrends (≥ 5% deep) in the largest US stocks of a sector, with median and percentile durations by sector and market-cap tier, for holding-period and timeout planning.',
  inputs: [
    { key: 'sector', label: 'Sector', type: 'select', options: ['All', 'Technology', 'Health Care', 'Finance', 'Consumer Discretionary', 'Consumer Staples', 'Industrials', 'Energy', 'Basic Materials', 'Utilities', 'Real Estate', 'Telecommunications'], default: 'All' },
    { key: 'max', label: 'Stocks (largest first)', type: 'number', default: 40, hint: 'up to 150' },
    { key: 'window', label: 'Peak/trough window (days)', type: 'number', default: 20 },
    { key: 'depth', label: 'Minimum depth %', type: 'number', default: 5 },
  ],
  async run(v, ctx: Ctx) {
    const sector = String(v.sector || 'All'), max = Math.min(150, Math.max(1, Number(v.max) || 40)), w = Math.max(2, Number(v.window) || 20), md = Number(v.depth) || 5;
    const all = await ctx.json<{ sym: string; sector: string; cap: number }[]>('/api/us-stocks'), list = all.filter(s => sector === 'All' || s.sector === sector).slice(0, max);
    if (!list.length) throw new Error(`No stocks in ${sector}`);
    const found: Down[] = []; let i = 0, used = 0, span = '';
    await Promise.all(Array.from({ length: 6 }, async () => { while (i < list.length) { const s = list[i++]; try { const b = await ctx.bars(`FX:${s.sym}`, '1d'); if (b.length) { used++; if (!span) span = `${new Date(b[0].time * 1000).toISOString().slice(0, 10)} → ${new Date(b.at(-1)!.time * 1000).toISOString().slice(0, 10)}` } for (const d of downtrends(b.map(x => new Date(x.time * 1000).toISOString().slice(0, 10)), b.map(x => x.close), w, md)) found.push({ ...d, sym: s.sym, sector: s.sector, tier: tier(s.cap) }) } catch { /* left out */ } } }));
    const st = stats(found), ORDER = ['Mega', 'Large', 'Mid', 'Small', 'Unknown'];
    const hist = [[0, 10], [10, 20], [20, 30], [30, 40], [40, 60], [60, 90], [90, 130], [130, Infinity]].map(([a, b]) => [b === Infinity ? `${a}+` : `${a}–${b - 1}`, found.filter(x => x.days >= a && x.days < b).length, found.length ? `${(found.filter(x => x.days >= a && x.days < b).length / found.length * 100).toFixed(0)}%` : '–']);
    return {
      verdict: { label: `Median ${st.median} trading days`, tone: 'muted', detail: `${st.n} downtrends in ${used} stocks (${sector}); plan for P75 ${st.p75} / P90 ${st.p90} days.` },
      kpis: [{ label: 'Downtrends', value: st.n }, { label: 'Mean', value: `${st.mean} d` }, { label: 'P25', value: `${st.p25} d` }, { label: 'Median', value: `${st.median} d` }, { label: 'P75', value: `${st.p75} d` }, { label: 'P90', value: `${st.p90} d` }],
      tables: [
        { title: 'Duration histogram (trading days)', cols: ['Days', 'Count', 'Share'], rows: hist },
        { title: 'By market cap', cols: ['Tier', 'Count', 'Median', 'Mean'], rows: groups(found, 'tier').sort((a, b) => ORDER.indexOf(a.k) - ORDER.indexOf(b.k)).map(g => [g.k, g.n, g.median, g.mean]) },
        { title: 'By sector', cols: ['Sector', 'Count', 'Median', 'Mean'], rows: groups(found, 'sector').sort((a, b) => a.median - b.median).map(g => [g.k, g.n, g.median, g.mean]) },
        { title: 'Deepest recent downtrends', cols: ['Symbol', 'Peak', 'Trough', 'Days', 'Depth'], rows: [...found].sort((a, b) => (a.trough < b.trough ? 1 : -1)).slice(0, 25).map(d => [d.sym, d.peak, d.trough, d.days, `${d.depth}%`]) },
      ],
      notes: [`Daily history ${span || 'n/a'} from the app's data (about 4 years). Universe: Nasdaq's public screener, largest market caps first; its sector names differ slightly from FMP's.`, 'Short (5–15 days) = pullbacks inside uptrends; 15–40 = rotations; 40+ = trend changes.'],
    };
  },
};
