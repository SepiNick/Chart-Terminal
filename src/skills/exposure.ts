// exposure-coach: one Market Posture from the other regime skills — breadth, uptrend ratio, macro regime, market top
// risk, follow-through day and sector leadership — with the original's weights, critical-input haircut, exposure
// ceiling, NEW_ENTRY_ALLOWED / REDUCE_ONLY / CASH_PRIORITY rules, bias and participation. Each input is run here
// from the app's data; one that fails is left out and lowers confidence, exactly as a missing file does upstream.
import type { Ctx, Skill } from './types.ts';
import { bearish, breadthScore, crossover as bCross, cycle, divergence, levelTrend, percentile, toRow } from './breadth.ts';
import { breadth as uBreadth, history as uHistory, momentum, participation as uPart, rotation as uRot, toSector, toURow, uptrendScore } from './uptrend.ts';
import { marketState, quality } from './ftd.ts';
import { topRisk } from './top.ts';
import { classify, macroComponents } from './macro.ts';

export const WEIGHTS = { regime: 0.25, top_risk: 0.2, breadth: 0.15, uptrend: 0.15, institutional: 0.1, sector: 0.05, theme: 0.05, ftd: 0.05 };
export type In = keyof typeof WEIGHTS;
const CRITICAL: In[] = ['regime', 'top_risk', 'breadth'];
export const REGIME_SCORE: Record<string, number> = { broadening: 80, concentration: 60, transitional: 50, inflationary: 40, contraction: 20 };

export function compositeOf(s: Partial<Record<In, number | null>>) {
  const provided: In[] = [], missing: In[] = []; let w = 0, tw = 0;
  for (const [k, wt] of Object.entries(WEIGHTS) as [In, number][]) { const v = s[k]; if (v != null) { w += v * wt; tw += wt; provided.push(k) } else missing.push(k) }
  if (tw === 0) return { composite: 50, provided, missing };
  return { composite: Math.max(0, w / tw - missing.filter(k => CRITICAL.includes(k)).length * 10), provided, missing };
}
export const ceiling = (c: number) => c >= 80 ? Math.min(100, Math.trunc(90 + (c - 80))) : c >= 65 ? Math.trunc(70 + (c - 65) * 1.3) : c >= 50 ? Math.trunc(50 + (c - 50) * 1.3) : c >= 35 ? Math.trunc(30 + (c - 35) * 1.3) : c >= 20 ? Math.trunc(10 + (c - 20) * 1.3) : Math.max(0, Math.trunc(c / 2));
export function recommendation(c: number, top: number | null, missCrit: number) {
  if (c < 30 || (top != null && top < 25)) return 'CASH_PRIORITY';
  if (c < 50 || (top != null && top < 40) || missCrit >= 2) return 'REDUCE_ONLY';
  return 'NEW_ENTRY_ALLOWED';
}
export function bias(regime: string, theme: number | null, lead: string | null) {
  const r = regime.toLowerCase();
  if (r === 'inflationary') return 'VALUE';
  if (r === 'contraction') return 'DEFENSIVE';
  if (theme != null && theme > 60 && (r === 'broadening' || r === 'concentration')) return 'GROWTH';
  if (lead) { const l = lead.toLowerCase(); if (['technology', 'consumer discretionary', 'communications'].includes(l)) return 'GROWTH'; if (['financials', 'energy', 'materials', 'industrials'].includes(l)) return 'VALUE'; if (['utilities', 'staples', 'healthcare'].includes(l)) return 'DEFENSIVE' }
  return 'NEUTRAL';
}
export const participation = (up: number | null, br: number | null) => { const u = up != null && up >= 50, b = br != null && br >= 50; return u && b ? 'BROAD' : u || b ? 'MODERATE' : 'NARROW' };
export function confidence(provided: In[], missing: In[]) { const mc = missing.filter(k => CRITICAL.includes(k)).length; return provided.length >= 6 && mc === 0 ? 'HIGH' : provided.length >= 4 || mc <= 1 ? 'MEDIUM' : 'LOW' }
export function posture(s: Partial<Record<In, number | null>>, regime: string, lead: string | null) {
  const { composite, provided, missing } = compositeOf(s), mc = missing.filter(k => CRITICAL.includes(k)).length;
  return { composite, provided, missing, ceiling: ceiling(composite), rec: recommendation(composite, s.top_risk ?? null, mc), bias: bias(regime, s.theme ?? null, lead), part: participation(s.uptrend ?? null, s.breadth ?? null), conf: confidence(provided, missing) };
}
/** Every upstream regime signal, computed here from the app's data; a failed one is null and its error is listed. */
export async function gather(ctx: Ctx, putCall?: unknown) {
    const err: string[] = [], safe = <T>(name: string, p: Promise<T>) => p.catch(e => { err.push(`${name}: ${(e as Error).message}`); return null });
    const [br, up, top, mac, ftd] = await Promise.all([
      safe('breadth', ctx.json<{ rows: Record<string, string>[]; summary: Record<string, string> }>('/api/breadth').then(d => { const rows = d.rows.map(toRow).filter(r => Number.isFinite(r.ma8)); return (breadthScore({ level: levelTrend(rows), crossover: bCross(rows), cycle: cycle(rows), bearish: bearish(rows), percentile: percentile(rows, d.summary), divergence: divergence(rows) }).score) })),
      safe('uptrend', ctx.json<{ all: Record<string, string>[]; sectors: Record<string, string>[] }>('/api/uptrend').then(d => { const rows = d.all.map(toURow), sec = d.sectors.map(toSector), r = uRot(sec), p = uPart(sec); return { score: uptrendScore({ breadth: uBreadth(rows).score, participation: p.score, rotation: r.score, momentum: momentum(rows, sec).score, history: uHistory(rows).score }, { late: r.late, spread: p.spread != null && p.spread > 0.4, divergence: r.divergence }).score, lead: [...sec].filter(x => x.Ratio != null).sort((a, b) => b.Ratio! - a.Ratio!)[0]?.Sector ?? null } })),
      safe('top risk', topRisk({ putCall: putCall, basket: 'dynamic' }, ctx).then(t => t.r)),
      safe('macro regime', macroComponents(ctx).then(c => ({ c, r: classify(c), n: Object.values(c).filter(x => x.available).length }))),
      safe('follow-through day', Promise.all([ctx.bars('FX:US500', '1d'), ctx.bars('FX:QQQ', '1d')]).then(([a, b]) => { const toD = (x: typeof a) => x.slice(-80).map(k => ({ date: new Date(k.time * 1000).toISOString().slice(0, 10), high: k.high, low: k.low, close: k.close, volume: k.volume })); const sp = toD(a), nq = toD(b), m = marketState(sp, nq), q = quality(m, sp, nq); return { score: q.score, state: q.invalidated ? 'FTD_INVALIDATED' : m.combined, dual: m.dual, dist: q.distCount } })),
    ]);
    return { br, up, top, mac, ftd, err };
}
// Our sector names → the vocabulary the bias rule reads.
const LEAD: Record<string, string> = { Technology: 'technology', 'Consumer Cyclical': 'consumer discretionary', 'Communication Services': 'communications', Financial: 'financials', Energy: 'energy', 'Basic Materials': 'materials', Industrials: 'industrials', Utilities: 'utilities', 'Consumer Defensive': 'staples', Healthcare: 'healthcare' };

export const exposureSkill: Skill = {
  id: 'exposure-coach', name: 'Exposure coach', group: 'Market regime', from: 'exposure-coach',
  desc: 'How much capital to commit to equities now: one posture from breadth, the uptrend ratio, the macro regime, market top risk, the follow-through day and sector leadership — an exposure ceiling, NEW ENTRY / REDUCE ONLY / CASH PRIORITY, growth-vs-value bias and participation. Not an order.',
  inputs: [{ key: 'putCall', label: 'CBOE equity put/call (for top risk)', type: 'number', optional: true }],
  async run(v, ctx: Ctx) {
    const { br: brRaw, up, top: topR, mac, ftd: ftdR, err } = await gather(ctx, v.putCall), br = brRaw == null ? null : Math.trunc(brRaw), top = topR?.score ?? null, ftd = ftdR == null ? null : Math.max(0, Math.min(100, Math.trunc(ftdR.score)));
    // A very-low-confidence regime is unusable upstream: no score, no bias.
    const regimeOk = mac != null && mac.r.confidence !== 'very_low' && mac.n > 0, regime = regimeOk ? mac!.r.regime : 'Unknown';
    const scores: Partial<Record<In, number | null>> = { breadth: br, uptrend: up == null ? null : Math.trunc(up.score), regime: regimeOk ? REGIME_SCORE[regime] ?? 50 : null, top_risk: top == null ? null : Math.max(0, Math.min(100, Math.trunc(100 - top))), ftd, theme: null, sector: null, institutional: null };
    const p = posture(scores, regime, up?.lead ? LEAD[up.lead] ?? up.lead : null);
    const status = (x: number) => x >= 70 ? 'Strong' : x >= 50 ? 'Healthy' : x >= 30 ? 'Cautious' : 'Weak';
    const NAMES: Record<In, string> = { regime: `Macro regime${regimeOk ? ` (${regime})` : ''}`, top_risk: 'Top risk (inverted)', breadth: 'Breadth', uptrend: 'Uptrend ratio', institutional: 'Institutional flow', sector: 'Sector', theme: 'Themes', ftd: 'Follow-through day' };
    return {
      verdict: { label: `${p.rec.replace(/_/g, ' ')} · ceiling ${p.ceiling}%`, tone: p.rec === 'NEW_ENTRY_ALLOWED' ? 'up' : p.rec === 'REDUCE_ONLY' ? 'warn' : 'dn', detail: `Bias ${p.bias}, participation ${p.part}, confidence ${p.conf}.` },
      kpis: [{ label: 'Composite', value: Math.round(p.composite * 10) / 10 }, { label: 'Inputs', value: `${p.provided.length}/8` }],
      tables: [{ title: 'Dimensions', cols: ['Dimension', 'Weight', 'Score', 'Status'], rows: (Object.keys(WEIGHTS) as In[]).map(k => [NAMES[k], `${WEIGHTS[k] * 100}%`, scores[k] ?? 'missing', scores[k] != null ? status(scores[k]!) : CRITICAL.includes(k) ? 'critical, −10' : '']) }],
      notes: [`Themes, sector dispersion and institutional flow have no in-app source yet, so they count as missing${err.length ? `; also failed: ${err.join('; ')}` : ''}.${mac && !regimeOk ? ' The macro regime came back with very low confidence and was not used.' : ''}`, 'REDUCE ONLY: no new entries, trim on strength. CASH PRIORITY: raise cash, no new commitments. A posture, not an order.'],
    };
  },
};
