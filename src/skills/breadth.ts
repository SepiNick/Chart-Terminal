// market-breadth-analyzer: a 0–100 US equity breadth health score from TraderMonty's public breadth CSV (S&P 500
// members above their 200-day MA), six components with the original's weights and rules.
import { pct, pyRound, pyRound1, type Ctx, type Skill } from './types.ts';

export interface BRow { date: string; sp: number; raw: number; ma200: number; ma8: number; trend: number; bearish: boolean; peak: boolean; trough: boolean; troughBelow04: boolean }
export const toRow = (r: Record<string, string>): BRow => ({ date: r.Date, sp: +r['S&P500_Price'], raw: +r.Breadth_Index_Raw, ma200: +r.Breadth_Index_200MA, ma8: +r.Breadth_Index_8MA, trend: +r.Breadth_200MA_Trend, bearish: r.Bearish_Signal === 'True', peak: r.Is_Peak === 'True', trough: r.Is_Trough === 'True', troughBelow04: r.Is_Trough_8MA_Below_04 === 'True' });
export interface BComp { score: number; available: boolean; signal: string }
const clamp = (x: number) => Math.max(0, Math.min(100, x));

export function levelTrend(rows: BRow[]): BComp {
  if (!rows.length) return { score: 50, available: false, signal: 'no data' };
  const l = rows.at(-1)!, ma8 = l.ma8, level = ma8 >= 0.7 ? 95 : ma8 >= 0.6 ? 80 : ma8 >= 0.5 ? 65 : ma8 >= 0.4 ? 50 : ma8 >= 0.3 ? 35 : ma8 >= 0.2 ? 20 : 5, trend = l.trend === 1 ? 80 : 20;
  let mod = 0;
  if (rows.length >= 6) { const p = rows.at(-6)!.ma8; if (ma8 < p && ma8 > 0.6) mod = -10; else if (ma8 < p && ma8 < 0.4) mod = 5; else if (ma8 > p && ma8 < 0.6) mod = 5 }
  return { score: clamp(pyRound(0.7 * level + 0.3 * trend) + mod), available: true, signal: `8MA ${ma8.toFixed(3)} in a ${l.trend === 1 ? 'up' : 'down'}trend` };
}
export function crossover(rows: BRow[]): BComp {
  if (rows.length < 6) return { score: 50, available: false, signal: 'too little data' };
  const l = rows.at(-1)!, gap = l.ma8 - l.ma200, rising = l.ma8 > rows.at(-6)!.ma8;
  const g = gap >= 0.15 ? 95 : gap >= 0.1 ? 80 : gap >= 0.05 ? 65 : gap >= 0 ? 50 : gap >= -0.05 ? 35 : gap >= -0.1 ? 20 : 5, mod = gap < 0 && rising ? 10 : gap > 0 && !rising ? -10 : 0;
  return { score: clamp(pyRound(g + mod)), available: true, signal: `8MA − 200MA gap ${gap >= 0 ? '+' : ''}${gap.toFixed(3)}, 8MA ${rising ? 'rising' : 'falling'}` };
}
export function cycle(rows: BRow[]): BComp {
  if (rows.length < 10) return { score: 50, available: false, signal: 'too little data' };
  const recent = rows.slice(-Math.min(120, rows.length)), l = rows.at(-1)!, rising = l.ma8 > rows.at(-6)!.ma8;
  let type: 'PEAK' | 'TROUGH' | null = null, idx = -1;
  for (let i = recent.length - 1; i >= 0; i--) { if (recent[i].peak) { type = 'PEAK'; idx = i; break } if (recent[i].trough || recent[i].troughBelow04) { type = 'TROUGH'; idx = i; break } }
  if (!type) return { score: 50, available: false, signal: 'no peak or trough in the last 120 days' };
  const days = recent.length - 1 - idx;
  let s = type === 'TROUGH' ? (days <= 20 ? (rising ? 85 : 30) : days <= 60 ? (rising ? 75 : 35) : rising ? 65 : 40) : days <= 20 ? (rising ? 60 : 20) : days <= 60 ? (rising ? 45 : 15) : rising ? 50 : 10;
  if (type === 'TROUGH' && recent[idx].troughBelow04) s += 10;
  return { score: clamp(s), available: true, signal: `${type} ${days}d ago, 8MA ${rising ? 'rising' : 'falling'}` };
}
export function bearish(rows: BRow[]): BComp {
  if (!rows.length) return { score: 50, available: false, signal: 'no data' };
  const l = rows.at(-1)!, pink = l.trend === -1 && l.ma8 < l.ma200;
  const base = !l.bearish && l.trend === 1 ? 85 : !l.bearish ? 50 : l.trend === 1 ? 30 : 10;
  const ctx = l.bearish ? (l.ma8 > 0.5 ? 15 : l.ma8 < 0.25 ? -5 : 0) : 0, pinkAdj = pink && !l.bearish ? -10 : 0;
  return { score: clamp(pyRound(base + ctx + pinkAdj)), available: true, signal: `bearish signal ${l.bearish ? 'ACTIVE' : 'off'}${pink ? ' (pink zone)' : ''}` };
}
export function percentile(rows: BRow[], summary: Record<string, string>): BComp {
  if (!rows.length) return { score: 50, available: false, signal: 'no data' };
  const cur = rows.at(-1)!.ma8, p = (100 * rows.filter(r => r.ma8 < cur).length) / rows.length;
  const base = p >= 80 ? 90 : p >= 60 ? 70 : p >= 40 ? 50 : p >= 20 ? 30 : 10, peak = parseFloat(summary['Average Peaks (200MA)']), trough = parseFloat(summary['Average Troughs (8MA < 0.4)']);
  const adj = Number.isFinite(peak) && cur >= peak * 0.95 ? -10 : Number.isFinite(trough) && cur <= trough * 1.05 ? 10 : 0;
  return { score: clamp(pyRound(base + adj)), available: true, signal: `8MA at the ${p.toFixed(0)}th percentile of ${rows.length} days` };
}
function window(rows: BRow[], n: number) {
  const k = Math.min(n, rows.length), l = rows.at(-1)!, p = rows[rows.length - k];
  if (p.sp <= 0) return { score: 50, type: 'invalid' };
  const sp = ((l.sp - p.sp) / p.sp) * 100, b = l.ma8 - p.ma8;
  if (sp > 3 && b < -0.05) return { score: 10, type: 'dangerous bearish divergence' };
  if (sp > 1 && b < -0.03) return { score: 25, type: 'moderate bearish divergence' };
  if (sp < -3 && b > 0.05) return { score: 80, type: 'strong bullish divergence' };
  if (sp < -1 && b > 0.03) return { score: 65, type: 'moderate bullish divergence' };
  if (Math.abs(sp) < 0.5 && Math.abs(b) < 0.01) return { score: 50, type: 'near flat' };
  return sp > 0 && b > 0 ? { score: 70, type: 'healthy alignment' } : !(sp > 0) && !(b > 0) ? { score: 30, type: 'consistent decline' } : { score: 50, type: 'mixed' };
}
export function divergence(rows: BRow[]): BComp {
  if (rows.length < 20) return { score: 50, available: false, signal: 'too little data' };
  const w60 = window(rows, 60), w20 = window(rows, 20);
  return { score: clamp(pyRound1(w60.score * 0.6 + w20.score * 0.4)), available: true, signal: `60d: ${w60.type}; 20d: ${w20.type}${w20.score <= 25 && w60.score >= 50 ? ' (early warning)' : ''}` };
}
export const BWEIGHTS = { level: 0.25, crossover: 0.2, cycle: 0.2, bearish: 0.15, percentile: 0.1, divergence: 0.1 };
export function breadthScore(c: Record<keyof typeof BWEIGHTS, BComp>) {
  const ks = Object.keys(BWEIGHTS) as (keyof typeof BWEIGHTS)[], tot = ks.filter(k => c[k].available).reduce((s, k) => s + BWEIGHTS[k], 0);
  const score = tot ? pyRound1(ks.filter(k => c[k].available).reduce((s, k) => s + c[k].score * (BWEIGHTS[k] / tot), 0)) : 50;
  const [zone, exposure] = score >= 80 ? ['Strong', '90–100%'] : score >= 60 ? ['Healthy', '75–90%'] : score >= 40 ? ['Neutral', '60–75%'] : score >= 20 ? ['Weakening', '40–60%'] : ['Critical', '25–40%'];
  return { score, zone, exposure };
}
const LABEL = { level: 'Breadth level & trend', crossover: '8MA vs 200MA', cycle: 'Peak/trough cycle', bearish: 'Bearish signal', percentile: 'Historical percentile', divergence: 'S&P 500 divergence' };
export const breadthSkill: Skill = {
  id: 'market-breadth-analyzer', name: 'US market breadth (0–100)', group: 'Market regime', from: 'market-breadth-analyzer',
  desc: 'How many S&P 500 stocks take part in the trend: six weighted components on the daily breadth index (share of members above their 200-day MA), with an equity-exposure band. Data: TraderMonty public CSV.',
  inputs: [],
  async run(_v, ctx: Ctx) {
    const d = await ctx.json<{ rows: Record<string, string>[]; summary: Record<string, string> }>('/api/breadth'), rows = d.rows.map(toRow).filter(r => Number.isFinite(r.ma8));
    const c = { level: levelTrend(rows), crossover: crossover(rows), cycle: cycle(rows), bearish: bearish(rows), percentile: percentile(rows, d.summary), divergence: divergence(rows) }, s = breadthScore(c);
    return {
      verdict: { label: `${s.zone} · ${s.score}`, tone: s.score >= 60 ? 'up' : s.score >= 40 ? 'warn' : 'dn', detail: `equity exposure ${s.exposure}; data to ${rows.at(-1)?.date}` },
      kpis: [{ label: 'Breadth 8MA', value: pct((rows.at(-1)?.ma8 ?? NaN) * 100, 1) }, { label: 'Breadth 200MA', value: pct((rows.at(-1)?.ma200 ?? NaN) * 100, 1) }],
      tables: [{ title: 'Components', cols: ['Component', 'Weight', 'Score', 'Reading'], rows: (Object.keys(c) as (keyof typeof c)[]).map(k => [LABEL[k], `${BWEIGHTS[k] * 100}%`, c[k].available ? c[k].score : 'n/a', c[k].signal]) }],
    };
  },
};
