// stanley-druckenmiller-investment: a 0–100 conviction score from the other regime skills (breadth, uptrend, market
// top, follow-through day, macro regime) plus their agreement, a Druckenmiller pattern (policy pivot, unsustainable
// distortion, contrarian bottom, wait and observe) and a target equity / bonds / alternatives / cash mix, with the
// original's weights and rules. Theme and setup scores have no in-app source yet: their weight moves to the rest.
import { pyRound1, type Ctx, type Skill } from './types.ts';
import { gather } from './exposure.ts';
import { compositeOf as macroComposite } from './macro.ts';

export interface Sig {
  breadth?: number; uptrend?: number; top?: number;
  macro?: { regime: string; composite: number; confidence: string; transition: string };
  ftd?: { state: string; quality: number; dual: boolean; dist: number };
  theme?: { derived: number; exhaustion?: number }; vcp?: { derived: number; textbook?: number }; canslim?: { derived: number; exceptional?: number };
}
const WEIGHTS = { market_structure: 0.18, distribution_risk: 0.18, bottom_confirmation: 0.12, macro_alignment: 0.18, theme_quality: 0.12, setup_availability: 0.1, signal_convergence: 0.12 };
export type K = keyof typeof WEIGHTS;
const LABELS: Record<K, string> = { market_structure: 'Market structure (breadth + uptrend)', distribution_risk: 'Distribution risk (top, inverted)', bottom_confirmation: 'Bottom confirmation (FTD)', macro_alignment: 'Macro alignment (regime)', theme_quality: 'Theme quality', setup_availability: 'Setup availability (VCP + CANSLIM)', signal_convergence: 'Signal convergence' };
const clamp = (x: number) => Math.max(0, Math.min(x, 100));
function components(s: Sig): Record<K, number> {
  const b = s.breadth ?? 50, u = s.uptrend ?? 50, div = Math.abs(b - u);
  const ms = clamp(pyRound1(b * 0.5 + u * 0.5 - (div > 30 ? (div - 30) * 0.3 : 0)));
  const st = s.ftd?.state ?? 'NO_SIGNAL', q = s.ftd?.quality ?? 0;
  let bc = ({ FTD_CONFIRMED: 80, FTD_WINDOW: 60, RALLY_ATTEMPT: 55, NO_SIGNAL: 40, CORRECTION: 35, FTD_INVALIDATED: 15, RALLY_FAILED: 10 } as Record<string, number>)[st] ?? 40;
  if (st === 'FTD_CONFIRMED') bc += (q - 50) * 0.2 + (s.ftd?.dual ? 5 : 0) - (s.ftd?.dist ?? 0) * 5;
  const m = s.macro, ma = (({ broadening: 85, concentration: 65, transitional: 50, inflationary: 35, contraction: 20 } as Record<string, number>)[m?.regime ?? 'unknown'] ?? 50) + ((m?.composite ?? 50) - 50) * 0.2;
  const mult = ({ high: 1.1, medium: 1, low: 0.9 } as Record<string, number>)[m?.confidence ?? 'unknown'] ?? 1;
  const set: number[] = []; let bonus = 0;
  if (s.vcp) { set.push(s.vcp.derived); if ((s.vcp.textbook ?? 0) >= 2) bonus += 10 }
  if (s.canslim) { set.push(s.canslim.derived); if ((s.canslim.exceptional ?? 0) >= 3) bonus += 10 }
  const req = [s.breadth, s.uptrend, s.top == null ? undefined : 100 - s.top, m?.composite, s.ftd ? s.ftd.quality : undefined].filter((x): x is number => x != null);
  let conv = 50;
  if (req.length >= 3) {
    const mean = req.reduce((a, x) => a + x, 0) / req.length, sd = Math.sqrt(req.reduce((a, x) => a + (x - mean) ** 2, 0) / req.length);
    conv = Math.max(0, 100 - sd * 3.33);
    if (req.every(x => x > 55)) conv = Math.min(conv + 15, 100); else if (req.every(x => x < 45)) conv = Math.max(conv - 15, 0);
    conv = pyRound1(conv);
  }
  return {
    market_structure: ms, distribution_risk: pyRound1(clamp(100 - (s.top ?? 0))), bottom_confirmation: pyRound1(clamp(bc)), macro_alignment: pyRound1(clamp(ma * mult)),
    theme_quality: pyRound1(clamp(s.theme?.derived ?? 50)), setup_availability: set.length ? pyRound1(clamp(set.reduce((a, x) => a + x, 0) / set.length + bonus)) : 50, signal_convergence: conv,
  };
}
const ZONES: [number, string, string, string][] = [
  [80, 'Maximum Conviction', '90-100%', 'All signals aligned: the fat pitch. Concentrate in the strongest setups.'],
  [60, 'High Conviction', '70-90%', 'Multiple signals confirm. Standard sizing on quality setups, normal stops.'],
  [40, 'Moderate Conviction', '50-70%', 'Mixed signals. Half-size positions, A-grade setups only, tighter stops.'],
  [20, 'Low Conviction', '20-50%', 'Unclear outlook. No new entries except rare ones, high cash.'],
  [-Infinity, 'Capital Preservation', '0-20%', '"When you don\'t see it, don\'t swing." Mostly cash, Treasuries, gold.'],
];
export function conviction(s: Sig) {
  const c = components(s), avail = (Object.keys(WEIGHTS) as K[]).filter(k => (k !== 'theme_quality' || s.theme) && (k !== 'setup_availability' || s.vcp || s.canslim)), tw = avail.reduce((a, k) => a + WEIGHTS[k], 0);
  const score = pyRound1(avail.reduce((a, k) => a + c[k] * WEIGHTS[k] / tw, 0)), z = ZONES.find(x => score >= x[0])!;
  return { c, avail, score, zone: z[1], exposure: z[2], guidance: z[3] };
}
const PATTERNS: Record<string, [string, string]> = {
  policy_pivot_anticipation: ['Policy Pivot Anticipation', 'Central bank policy at an inflection the market has not priced.'],
  unsustainable_distortion: ['Unsustainable Distortion', 'Fragile structure: distribution plus macro contraction.'],
  extreme_sentiment_contrarian: ['Extreme Sentiment Contrarian', 'Bottom confirmed after extreme bearishness.'],
  wait_and_observe: ['Wait & Observe', 'Mixed signals, unclear direction: preserve capital and wait.'],
};
export function pattern(s: Sig, c: Record<K, number>, score: number) {
  const regime = s.macro?.regime ?? 'unknown', tl = s.macro?.transition ?? 'unknown', top = s.top ?? 0, st = s.ftd?.state ?? 'NO_SIGNAL', q = s.ftd?.quality ?? 0, b = s.breadth ?? 50;
  const p: Record<string, number> = {
    policy_pivot_anticipation: Math.min(100, (regime === 'transitional' ? 40 : 0) + (tl === 'high' || tl === 'moderate' ? 25 : 0) + (top < 40 ? 15 : 0) + ((s.macro?.composite ?? 0) >= 50 ? 20 : 0)),
    unsustainable_distortion: Math.min(100, (top >= 60 ? 35 : 0) + (regime === 'contraction' || regime === 'inflationary' ? 30 : 0) + ((s.theme?.exhaustion ?? 0) >= 2 ? 20 : 0) + (b < 40 ? 15 : 0)),
    extreme_sentiment_contrarian: Math.min(100, (st === 'FTD_CONFIRMED' ? 40 + (q >= 70 ? 15 : 0) : 0) + (top >= 70 ? 20 : 0) + (b < 35 ? 15 : 0) + (c.signal_convergence < 30 ? 10 : 0)),
    wait_and_observe: 0,
  };
  const v = Object.values(c);
  p.wait_and_observe = Math.min(100, (score < 40 ? 40 : 0) + (Math.max(...v) - Math.min(...v) > 40 ? 30 : 0) + (regime === 'transitional' && top >= 40 && top <= 60 ? 20 : 0));
  let best = Object.entries(p).reduce((a, x) => (x[1] > a[1] ? x : a))[0], strength = p[best];
  if (strength < 40) { best = 'wait_and_observe'; strength = Math.max(strength, 50) }
  return { best, strength, p };
}
type Mix = { equity: number; bonds: number; alternatives: number; cash: number };
const BASE: Record<string, Mix> = { 'Maximum Conviction': { equity: 90, bonds: 0, alternatives: 5, cash: 5 }, 'High Conviction': { equity: 75, bonds: 5, alternatives: 5, cash: 15 }, 'Moderate Conviction': { equity: 55, bonds: 10, alternatives: 10, cash: 25 }, 'Low Conviction': { equity: 30, bonds: 15, alternatives: 15, cash: 40 }, 'Capital Preservation': { equity: 10, bonds: 20, alternatives: 20, cash: 50 } };
const REG: Record<string, Mix> = { broadening: { equity: 5, bonds: 0, alternatives: 0, cash: -5 }, concentration: { equity: 3, bonds: 0, alternatives: 0, cash: -3 }, transitional: { equity: 0, bonds: 0, alternatives: 0, cash: 0 }, inflationary: { equity: -5, bonds: -5, alternatives: 10, cash: 0 }, contraction: { equity: -10, bonds: 5, alternatives: 0, cash: 5 } };
const PAT: Record<string, Mix> = { policy_pivot_anticipation: { equity: 5, bonds: 3, alternatives: -3, cash: -5 }, unsustainable_distortion: { equity: -10, bonds: 0, alternatives: 5, cash: 5 }, extreme_sentiment_contrarian: { equity: 10, bonds: -5, alternatives: 0, cash: -5 }, wait_and_observe: { equity: -5, bonds: 0, alternatives: 0, cash: 5 } };
const SIZING: Record<string, [number, number, number]> = { 'Maximum Conviction': [25, 0.4, 8], 'High Conviction': [15, 0.3, 12], 'Moderate Conviction': [10, 0.25, 15], 'Low Conviction': [5, 0.15, 20], 'Capital Preservation': [3, 0.1, 25] };
export function allocation(zone: string, pat: string, regime: string): Mix {
  const m = { ...(BASE[zone] ?? BASE['Moderate Conviction']) }, r = REG[regime] ?? REG.transitional, p = PAT[pat] ?? PAT.wait_and_observe, k = Object.keys(m) as (keyof Mix)[];
  for (const a of k) m[a] = Math.max(0, m[a] + r[a] + p[a]);
  const t = k.reduce((s, a) => s + m[a], 0);
  if (t <= 0) return { equity: 0, bonds: 0, alternatives: 0, cash: 100 };
  for (const a of k) m[a] = pyRound1(m[a] / t * 100);
  const diff = 100 - k.reduce((s, a) => s + m[a], 0);
  if (Math.abs(diff) > 0) { const l = k.reduce((a, b) => (m[b] > m[a] ? b : a)); m[l] = pyRound1(m[l] + diff) }
  return m;
}

export const druckenmillerSkill: Skill = {
  id: 'stanley-druckenmiller-investment', name: 'Druckenmiller conviction', group: 'Market regime', from: 'stanley-druckenmiller-investment',
  desc: 'Druckenmiller-style synthesis: one 0–100 conviction from market structure, distribution risk, bottom confirmation, the macro regime and how well they agree, the pattern it matches, a target equity / bonds / alternatives / cash mix and position-size limits. Not an order.',
  inputs: [{ key: 'putCall', label: 'CBOE equity put/call (for top risk)', type: 'number', optional: true }],
  async run(v, ctx: Ctx) {
    const g = await gather(ctx, v.putCall), mac = g.mac;
    const s: Sig = {
      breadth: g.br ?? undefined, uptrend: g.up?.score, top: g.top?.score,
      macro: mac ? { regime: mac.r.regime, composite: macroComposite(mac.c), confidence: mac.r.confidence, transition: mac.r.prob[0] } : undefined,
      ftd: g.ftd ? { state: g.ftd.state, quality: g.ftd.score, dual: g.ftd.dual, dist: g.ftd.dist } : undefined,
    };
    const k = conviction(s), pt = pattern(s, k.c, k.score), regime = s.macro?.regime ?? 'transitional', mix = allocation(k.zone, pt.best, regime), [maxPos, vol, maxN] = SIZING[k.zone];
    return {
      verdict: { label: `${k.score} · ${k.zone}`, tone: k.score >= 60 ? 'up' : k.score >= 40 ? 'warn' : 'dn', detail: `${PATTERNS[pt.best][0]} (${pt.strength}%): ${PATTERNS[pt.best][1]} ${k.guidance}` },
      kpis: [{ label: 'Equity', value: `${mix.equity}%` }, { label: 'Bonds', value: `${mix.bonds}%` }, { label: 'Alternatives', value: `${mix.alternatives}%` }, { label: 'Cash', value: `${mix.cash}%` }, { label: 'Max single position', value: `${maxPos}%` }, { label: 'Max positions', value: maxN }, { label: 'Daily vol target', value: `${vol}%` }],
      tables: [
        { title: 'Components', cols: ['Component', 'Weight', 'Score'], rows: (Object.keys(WEIGHTS) as K[]).map(x => [LABELS[x], k.avail.includes(x) ? `${(WEIGHTS[x] * 100).toFixed(0)}%` : 'no data', k.avail.includes(x) ? k.c[x] : '–']) },
        { title: 'Patterns', cols: ['Pattern', 'Match'], rows: Object.entries(pt.p).map(([x, y]) => [PATTERNS[x][0], y]) },
      ],
      notes: [`Regime: ${regime}. ${g.err.length ? `Failed inputs (neutral 50 used): ${g.err.join('; ')}. ` : ''}Theme and setup (VCP/CANSLIM) inputs are not wired in, so their weight goes to the other components.`, 'Target mix and sizing are policy heuristics, not orders.'],
    };
  },
};
