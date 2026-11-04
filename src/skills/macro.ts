// macro-regime-detector: structural regime transitions (1–2 year horizon) from six monthly cross-asset ratios —
// RSP/SPY concentration, 10Y−2Y curve, HYG/LQD credit, IWM/SPY size, SPY/TLT equity-bond (with the stock-bond
// correlation), XLY/XLP sectors — scored 0–100 for transition strength and voted into Concentration, Broadening,
// Contraction, Inflationary or Transitional, with the original's rules. Series are newest first, like the original.
import { pct, pyRoundN, type Ctx, type Skill } from './types.ts';

export interface D { date: string; close: number }
export interface Rate { date: string; year10: number; year2: number }
type Cross = { type: 'golden_cross' | 'death_cross' | 'converging' | 'none'; bars_ago: number | null; gap_pct: number | null };
const r3 = (x: number) => pyRoundN(x, 3);

/** Last trading day of each month (the first one met in a newest-first series). */
function monthly(d: D[]): D[] {
  const m = new Map<string, D>();
  for (const b of d) if (b.date && b.close !== 0 && !m.has(b.date.slice(0, 7))) m.set(b.date.slice(0, 7), { date: b.date, close: b.close });
  return [...m.values()].sort((a, b) => (a.date < b.date ? 1 : -1));
}
function ratio(a: D[], b: D[]) { const l = new Map(b.map(x => [x.date.slice(0, 7), x.close])); return a.filter(x => l.has(x.date.slice(0, 7)) && l.get(x.date.slice(0, 7)) !== 0).map(x => x.close / l.get(x.date.slice(0, 7))!) }
const sma = (v: number[], n: number) => v.length < n ? null : v.slice(0, n).reduce((s, x) => s + x, 0) / n;
const roc = (v: number[], n: number) => v.length <= n || v[n] === 0 ? null : (v[0] - v[n]) / v[n] * 100;
function crossover(v: number[], s = 6, l = 12): Cross {
  if (v.length < l + 3) return { type: 'none', bars_ago: null, gap_pct: null };
  const pairs: [number, number][] = [];
  for (let o = 0; o < Math.min(v.length, l + 12) - l + 1; o++) { const a = sma(v.slice(o), s), b = sma(v.slice(o), l); if (a != null && b != null) pairs.push([a, b]) }
  if (pairs.length < 2) return { type: 'none', bars_ago: null, gap_pct: null };
  const [cs, cl] = pairs[0], gap = cl !== 0 ? (cs - cl) / cl * 100 : 0;
  for (let i = 1; i < pairs.length; i++) {
    const [ps, pl] = pairs[i], [qs, ql] = pairs[i - 1];
    if (ps <= pl && qs > ql) return { type: 'golden_cross', bars_ago: i - 1, gap_pct: r3(gap) };
    if (ps >= pl && qs < ql) return { type: 'death_cross', bars_ago: i - 1, gap_pct: r3(gap) };
  }
  return { type: Math.abs(gap) < 1 ? 'converging' : 'none', bars_ago: null, gap_pct: r3(gap) };
}
function transition(c: Cross, rs: number | null, rl: number | null, ss: number | null, sl: number | null) {
  let s = 0; const cross = c.type === 'golden_cross' || c.type === 'death_cross';
  if (cross) s += c.bars_ago != null && c.bars_ago <= 2 ? 40 : c.bars_ago != null && c.bars_ago <= 5 ? 30 : 20;
  else if (c.type === 'converging') s += Math.trunc(Math.max(0, 1 - Math.abs(c.gap_pct ?? 0)) * 25);
  if (rs != null && rl != null) { if ((rl < 0 && rs > 0) || (rl > 0 && rs < 0)) s += Math.trunc(Math.min(Math.abs(rs), 5) / 5 * 30); else if (Math.abs(rs) > 3) s += 10 }
  let al = cross ? 1 : 0;
  if ((c.type === 'golden_cross' && rs != null && rs > 0) || (c.type === 'death_cross' && rs != null && rs < 0)) al++;
  if (ss != null && sl != null && sl !== 0 && Math.abs(ss - sl) / sl * 100 > 0.5) al++;
  return Math.min(100, Math.max(0, s + al * 10));
}
/** Crossover direction unless it is 3+ months old and 3-month momentum disagrees ("reversing"). */
function direction(c: Cross, r: number | null, pos: string, neg: string, neutral: string): [string, string] {
  const cd = c.type === 'golden_cross' ? pos : c.type === 'death_cross' ? neg : null, md = r != null && r > 0 ? pos : r != null && r < 0 ? neg : null;
  if (cd) { if (c.bars_ago != null && c.bars_ago >= 3 && md && md !== cd) return [md, 'reversing']; return [cd, md === cd ? 'confirmed' : md ? 'fading' : 'N/A'] }
  return md ? [md, 'N/A'] : [neutral, 'N/A'];
}
export interface Comp { score: number; available: boolean; direction: string; qualifier?: string; value?: number; roc3?: number | null; extra?: string; corr?: string }
const none: Comp = { score: 0, available: false, direction: 'unknown' };
function analyse(v: number[]) { const ss = sma(v, 6), sl = sma(v, 12), c = crossover(v), r3m = roc(v, 3), r12 = roc(v, 12); return { ss, sl, c, r3m, score: transition(c, r3m, r12, ss, sl) } }
function ratioComp(a: D[], b: D[], pos: string, neg: string, neutral: string): Comp & { v?: number[] } {
  if (!a.length || !b.length) return none;
  const ma = monthly(a), mb = monthly(b);
  if (ma.length < 12 || mb.length < 12) return none;
  const v = ratio(ma, mb); if (v.length < 12) return none;
  const x = analyse(v), [dir, q] = direction(x.c, x.r3m, pos, neg, neutral);
  return { score: x.score, available: true, direction: dir, qualifier: q, value: v[0], roc3: x.r3m, v };
}
export function concentration(rsp: D[], spy: D[]): Comp {
  if (!rsp.length || !spy.length) return none;
  const ma = monthly(rsp), mb = monthly(spy); if (ma.length < 12 || mb.length < 12) return none;
  const v = ratio(ma, mb); if (v.length < 12) return none;
  const x = analyse(v);
  let dir = x.c.type === 'golden_cross' ? 'broadening' : x.c.type === 'death_cross' ? 'concentrating' : x.ss != null && x.sl != null ? (x.ss > x.sl ? 'broadening' : 'concentrating') : 'unknown', q = 'N/A';
  if (x.c.type === 'golden_cross' || x.c.type === 'death_cross') {
    const cd = x.c.type === 'golden_cross' ? 'broadening' : 'concentrating', md = x.r3m != null && x.r3m > 0 ? 'broadening' : x.r3m != null && x.r3m < 0 ? 'concentrating' : null;
    if (x.c.bars_ago != null && x.c.bars_ago >= 3 && md && md !== cd) { dir = md; q = 'reversing' } else if (md === cd) q = 'confirmed'; else if (md) q = 'fading';
  }
  return { score: x.score, available: true, direction: dir, qualifier: q, value: v[0], roc3: x.r3m };
}
export function yieldCurve(rates: Rate[] | null, shy: D[], tlt: D[]): Comp {
  if (rates?.length) {
    const m = new Map<string, Rate>();
    for (const r of rates) if (r.date && Number.isFinite(r.year10) && Number.isFinite(r.year2) && !m.has(r.date.slice(0, 7))) m.set(r.date.slice(0, 7), r);
    if (m.size >= 12) {
      const s = [...m.values()].sort((a, b) => (a.date < b.date ? 1 : -1)), v = s.map(x => x.year10 - x.year2), x = analyse(v);
      const dir = x.r3m != null && x.r3m > 0 ? 'steepening' : x.r3m != null && x.r3m < 0 ? 'flattening' : 'stable', r2 = roc(s.map(z => z.year2), 3), r10 = roc(s.map(z => z.year10), 3);
      const sp = v[0], state = sp < -0.5 ? 'deeply inverted' : sp < 0 ? 'inverted' : sp < 0.5 ? (x.r3m != null && x.r3m > 0 ? 'normalizing' : 'flat') : sp < 1.5 ? 'normal' : 'steep';
      const type = dir !== 'steepening' ? '' : r2 != null && r2 < 0 ? ', bull steepener' : r10 != null && r10 > 0 ? ', bear steepener' : ', mixed steepener';
      return { score: x.score, available: true, direction: dir, value: sp, roc3: x.r3m, extra: `${state}${type}` };
    }
  }
  if (shy.length && tlt.length) {
    const ma = monthly(shy), mb = monthly(tlt); if (ma.length < 12 || mb.length < 12) return none;
    const v = ratio(ma, mb); if (v.length < 12) return none;
    const x = analyse(v);
    return { score: x.score, available: true, direction: x.r3m != null && x.r3m < 0 ? 'steepening' : x.r3m != null && x.r3m > 0 ? 'flattening' : 'stable', value: v[0], roc3: x.r3m, extra: 'SHY/TLT proxy' };
  }
  return none;
}
const rets = (c: number[]) => c.slice(0, -1).flatMap((x, i) => c[i + 1] !== 0 ? [(x - c[i + 1]) / c[i + 1]] : []);
function corr(a: number[], b: number[], w: number) {
  if (a.length < w || b.length < w) return null;
  const x = a.slice(0, w), y = b.slice(0, w), mx = x.reduce((s, v) => s + v, 0) / w, my = y.reduce((s, v) => s + v, 0) / w;
  const cov = x.reduce((s, v, i) => s + (v - mx) * (y[i] - my), 0) / w, sx = Math.sqrt(x.reduce((s, v) => s + (v - mx) ** 2, 0) / w), sy = Math.sqrt(y.reduce((s, v) => s + (v - my) ** 2, 0) / w);
  return sx === 0 || sy === 0 ? 0 : cov / (sx * sy);
}
export function equityBond(spy: D[], tlt: D[]): Comp {
  const c = ratioComp(spy, tlt, 'risk_on', 'risk_off', 'neutral'); if (!c.available) return { ...none, corr: 'unknown' };
  const sr = rets(monthly(spy).map(x => x.close)), tr = rets(monthly(tlt).map(x => x.close)), c6 = corr(sr, tr, 6), c12 = corr(sr, tr, 12);
  const regime = c6 == null ? 'unknown' : c6 < -0.3 ? 'negative_strong' : c6 < 0 ? 'negative_mild' : c6 < 0.3 ? 'near_zero' : 'positive';
  const bonus = c6 != null && c12 != null ? ((c6 > 0) !== (c12 > 0) ? 20 : Math.abs(c6 - c12) > 0.3 ? 10 : 0) : 0;
  return { ...c, score: Math.min(100, c.score + bonus), corr: regime, extra: c6 == null ? undefined : `6m stock-bond correlation ${c6.toFixed(2)}` };
}
export const credit = (h: D[], l: D[]) => ratioComp(h, l, 'easing', 'tightening', 'stable');
export const sizeFactor = (i: D[], s: D[]) => ratioComp(i, s, 'small_cap_leading', 'large_cap_leading', 'neutral');
export const sectors = (y: D[], p: D[]) => ratioComp(y, p, 'risk_on', 'risk_off', 'neutral');

const WEIGHTS = { concentration: 0.25, yield_curve: 0.2, credit_conditions: 0.15, size_factor: 0.15, equity_bond: 0.15, sector_rotation: 0.1 };
export type K = keyof typeof WEIGHTS;
const LABELS: Record<K, string> = { concentration: 'Concentration (RSP/SPY)', yield_curve: 'Yield curve (10Y−2Y)', credit_conditions: 'Credit (HYG/LQD)', size_factor: 'Size (IWM/SPY)', equity_bond: 'Equity-bond (SPY/TLT)', sector_rotation: 'Sectors (XLY/XLP)' };
const REGIMES: Record<string, [string, string]> = {
  concentration: ['Concentration', 'Focus on mega-cap tech/growth leaders. Underweight small-caps and value.'],
  broadening: ['Broadening', 'Add small/mid-cap exposure, equal-weight strategies, value and cyclical rotation.'],
  contraction: ['Contraction', 'Raise cash; short-duration Treasuries as base, TIPS if inflation shows, extend duration only once the stock-bond correlation turns negative; Staples and Healthcare.'],
  inflationary: ['Inflationary', 'Real assets, commodities, energy, short-duration bonds and TIPS; reduce long duration.'],
  transitional: ['Transitional', 'Diversify more, reposition gradually, avoid concentrated bets, check weekly.'],
};
const ZONES: [number, string][] = [[20, 'Stable (No Transition)'], [40, 'Early Signal (Monitoring)'], [60, 'Transition Zone (Preparing)'], [80, 'Active Transition (Repositioning)'], [Infinity, 'Confirmed Transition (Completing)']];
export const compositeOf = (c: Record<K, Comp>) => pyRoundN((Object.keys(WEIGHTS) as K[]).reduce((s, k) => s + c[k].score * WEIGHTS[k], 0), 1);
export function classify(c: Record<K, Comp>) {
  const d = (k: K) => (c[k].available ? c[k].direction : 'unknown'), [co, yc, cr, sz, eb, se] = (['concentration', 'yield_curve', 'credit_conditions', 'size_factor', 'equity_bond', 'sector_rotation'] as K[]).map(d);
  const corrR = c.equity_bond.available ? c.equity_bond.corr ?? 'unknown' : 'unknown', calm = cr === 'stable' || cr === 'easing';
  const rs: Record<string, number> = {
    concentration: (co === 'concentrating' ? 2 : 0) + (sz === 'large_cap_leading' ? 2 : 0) + (calm ? 1 : 0),
    broadening: (co === 'broadening' ? 2 : 0) + (sz === 'small_cap_leading' ? 2 : 0) + (calm ? 1 : 0) + (se === 'risk_on' ? 1 : 0) + (yc === 'steepening' ? 1 : 0),
    contraction: Math.max(0, (cr === 'tightening' ? 2 : 0) + (se === 'risk_off' ? 2 : 0) + (eb === 'risk_off' ? 1 : 0) + (yc === 'flattening' ? 1 : 0) - (sz === 'small_cap_leading' ? 1 : 0)),
    inflationary: (corrR === 'positive' ? 3 : corrR === 'near_zero' ? 1 : 0) + (eb === 'risk_off' ? 1 : 0),
    transitional: 0,
  };
  const all = (Object.keys(WEIGHTS) as K[]).map(k => c[k].score), signaling = all.filter(s => s >= 40).length, avail = (Object.keys(WEIGHTS) as K[]).filter(k => c[k].available).length;
  const sorted = Object.entries(rs).filter(([k]) => k !== 'transitional').sort((a, b) => b[1] - a[1]);   // stable sort, like Python
  let best = sorted[0][0], bs = sorted[0][1];
  const tied = sorted.length >= 2 && bs > 0 && bs - sorted[1][1] <= 1, quick = (Object.keys(WEIGHTS) as K[]).reduce((s, k) => s + c[k].score * WEIGHTS[k], 0);
  if (tied && quick < 50) { best = 'transitional'; rs.transitional = bs } else if (signaling >= 3 && bs < 3) { best = 'transitional'; bs = signaling }
  let conf = bs >= 4 ? 'high' : bs >= 3 ? 'moderate' : bs >= 2 ? 'low' : 'very_low';
  if (tied && conf === 'high') conf = 'moderate';
  if (avail <= 3) conf = 'very_low'; else if (avail <= 4 && (conf === 'high' || conf === 'moderate')) conf = 'low';
  const avg = all.reduce((s, x) => s + x, 0) / all.length;
  const prob = signaling >= 4 && avg >= 50 ? ['high', '70-90%'] : signaling >= 3 && avg >= 40 ? ['moderate', '40-60%'] : signaling >= 2 && avg >= 30 ? ['low', '20-40%'] : ['minimal', '<20%'];
  let from: string | null = null, to: string | null = null;
  if (prob[0] === 'high' || prob[0] === 'moderate') { const top = sorted[0][0]; if (best === 'transitional') { to = top; from = sorted[1][1] > 0 ? sorted[1][0] : null } else if (top !== best) { from = best; to = top } }
  return { regime: best, confidence: conf, scores: rs, signaling, prob, from, to, tied: tied ? [sorted[0][0], sorted[1][0]] : null };
}

/** The six components from the app's data (shared with exposure-coach). */
export async function macroComponents(ctx: Ctx): Promise<Record<K, Comp>> {
    const syms = ['SPY', 'RSP', 'HYG', 'LQD', 'IWM', 'TLT', 'XLY', 'XLP', 'SHY'], h: Record<string, D[]> = {};
    await Promise.all(syms.map(async s => { h[s] = await ctx.bars(`FX:${s}`, '1d').then(daily, () => []) }));
    if (!h.SPY.length) throw new Error('SPY history is unavailable');
    const rates = await ctx.json<Rate[]>('/api/treasury').then(r => r.slice(-600).reverse(), () => null);
    const c: Record<K, Comp> = { concentration: concentration(h.RSP, h.SPY), yield_curve: yieldCurve(rates, h.SHY, h.TLT), credit_conditions: credit(h.HYG, h.LQD), size_factor: sizeFactor(h.IWM, h.SPY), equity_bond: equityBond(h.SPY, h.TLT), sector_rotation: sectors(h.XLY, h.XLP) };
    return c;
}
const daily = (b: { time: number; close: number }[]): D[] => b.slice(-600).reverse().map(x => ({ date: new Date(x.time * 1000).toISOString().slice(0, 10), close: x.close }));
export const macroSkill: Skill = {
  id: 'macro-regime-detector', name: 'Macro regime', group: 'Market regime', from: 'macro-regime-detector',
  desc: 'Structural 1–2 year regime from six monthly cross-asset ratios (RSP/SPY, 10Y−2Y, HYG/LQD, IWM/SPY, SPY/TLT, XLY/XLP): transition strength 0–100 and the regime they vote for — Concentration, Broadening, Contraction, Inflationary or Transitional.',
  inputs: [],
  async run(_v, ctx: Ctx) {
    const c = await macroComponents(ctx);
    const score = compositeOf(c), zone = ZONES.find(z => score <= z[0])![1], r = classify(c), [label, posture] = REGIMES[r.regime];
    return {
      verdict: { label: `${label} · ${r.confidence.replace('_', ' ')} confidence`, tone: r.regime === 'contraction' || r.regime === 'inflationary' ? 'dn' : r.regime === 'transitional' ? 'warn' : 'up', detail: posture },
      kpis: [{ label: 'Transition score', value: `${score} · ${zone}` }, { label: 'Components signaling (≥ 40)', value: `${r.signaling}/6` }, { label: 'Transition probability', value: `${r.prob[0]} (${r.prob[1]})` }, ...(r.to ? [{ label: 'Possible shift', value: `${r.from ? REGIMES[r.from][0] : '?'} → ${REGIMES[r.to][0]}` }] : [])],
      tables: [
        { title: 'Components', cols: ['Component', 'Weight', 'Score', 'Direction', 'Latest', '3m ROC', 'Note'], rows: (Object.keys(WEIGHTS) as K[]).map(k => { const x = c[k]; return [LABELS[k], `${WEIGHTS[k] * 100}%`, x.available ? x.score : '–', x.available ? `${x.direction.replace(/_/g, ' ')}${x.qualifier && x.qualifier !== 'N/A' ? ` (${x.qualifier})` : ''}` : 'no data', x.value == null ? '–' : x.value.toFixed(k === 'yield_curve' ? 2 : 4), x.roc3 == null ? '–' : pct(x.roc3), x.extra ?? ''] }) },
        { title: 'Regime votes', cols: ['Regime', 'Points'], rows: Object.entries(r.scores).filter(([k]) => k !== 'transitional' || r.regime === 'transitional').map(([k, v]) => [REGIMES[k][0], v]) },
      ],
      notes: [`${r.tied ? `Tie between ${r.tied.map(t => REGIMES[t][0]).join(' and ')}. ` : ''}Monthly closes are the last session of each month from the app's daily data (Yahoo, split-adjusted closes rather than FMP's dividend-adjusted ones). 10Y and 2Y yields from FRED.`, 'Transition score measures how strongly ratios are changing, not market direction. No order is placed.'],
    };
  },
};
