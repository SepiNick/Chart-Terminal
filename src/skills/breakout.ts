// breakout-trade-planner: a VCP setup (pivot, last contraction low, rating) → buy-stop trigger, worst-case entry, stop,
// R-multiple target, size by rating band and risk caps, and the plan's state (actionable / revalidate / rejected /
// constrained by portfolio heat). Proposals only.
import { money, num, pct, type Skill } from './types.ts';

const roundPrice = (p: number) => (p >= 1 ? Math.round(p * 100) / 100 : Math.round(p * 10000) / 10000);
const ratingBand = (score: number) => (score >= 90 ? 'textbook' : score >= 80 ? 'strong' : score >= 70 ? 'good' : score >= 60 ? 'developing' : 'weak');
const MULT: Record<string, number> = { textbook: 1.75, strong: 1, good: 0.75, developing: 0, weak: 0 };

export interface BreakoutIn { pivot: number; low: number; price: number; score: number; breakoutVolume: boolean; account: number; riskPct: number; maxPositionPct: number; maxSectorPct: number; sectorExposure: number; heatPct: number; maxHeatPct: number; targetR: number; stopBufferPct: number; maxChasePct: number; pivotBufferPct: number; maxRiskPct: number; fractional?: boolean }
export function planBreakout(p: BreakoutIn) {
  if (!(p.pivot > 0) || !(p.low > 0)) throw new Error('Pivot and contraction low must be positive');
  if (p.pivotBufferPct > p.maxChasePct) throw new Error('Pivot buffer must be at most the max chase');
  const entry = roundPrice(p.pivot * (1 + p.pivotBufferPct / 100)), worst = roundPrice(p.pivot * (1 + p.maxChasePct / 100)), stop = roundPrice(p.low * (1 - p.stopBufferPct / 100));
  if (stop >= entry) throw new Error('The stop must be below the entry: check the contraction low');
  const riskSignal = Math.round(((entry - stop) / entry) * 10000) / 100, riskWorst = Math.round(((worst - stop) / worst) * 10000) / 100;
  const target = roundPrice(entry + p.targetR * (entry - stop)), band = ratingBand(p.score), eff = p.riskPct * MULT[band];
  const fl = (x: number) => (p.fractional ? Math.floor(x * 10000 + 1e-9) / 10000 : Math.floor(x + 1e-9));
  const rps = worst - stop, byRisk = eff > 0 ? fl((p.account * eff) / 100 / rps) : 0;
  const caps = [{ name: `Max position ${p.maxPositionPct}%`, max: fl((p.account * p.maxPositionPct) / 100 / worst) }, { name: `Max sector ${p.maxSectorPct}%`, max: Math.max(0, fl((Math.max(0, p.maxSectorPct - p.sectorExposure) / 100) * p.account / worst)) }];
  const shares = Math.max(0, Math.min(byRisk, ...caps.map(c => c.max))), binding = eff <= 0 ? 'rating too low to size' : caps.find(c => c.max === shares && shares < byRisk)?.name ?? null;
  const riskDollars = shares * rps, newHeat = (100 * riskDollars) / p.account;
  // State: the original's gate (good+ rating, ≤ max risk at the worst entry; a breakout also needs volume and no chase).
  const reasons: string[] = [];
  if (MULT[band] === 0) reasons.push(`rating ${band} (${p.score}): only good / strong / textbook setups trade`);
  if (riskWorst > p.maxRiskPct) reasons.push(`risk at the worst entry ${pct(riskWorst)} is over ${p.maxRiskPct}%`);
  const broken = p.price > p.pivot;
  if (broken) {
    if (!p.breakoutVolume) reasons.push('broke out without breakout volume');
    if (((p.price - p.pivot) / p.pivot) * 100 > p.maxChasePct) reasons.push(`price is ${pct(((p.price - p.pivot) / p.pivot) * 100)} above the pivot: more than the ${p.maxChasePct}% chase limit`);
    if (p.price > worst) reasons.push('price is above the worst acceptable entry');
  }
  let state: 'ACTIONABLE' | 'REVALIDATE' | 'REJECTED' | 'CONSTRAINED' = reasons.length ? 'REJECTED' : broken ? 'REVALIDATE' : 'ACTIONABLE';
  if (state !== 'REJECTED' && (shares <= 0 || p.heatPct + newHeat > p.maxHeatPct + 1e-9)) { state = 'CONSTRAINED'; reasons.push(shares <= 0 ? `size is 0 (${binding})` : `portfolio heat would be ${pct(p.heatPct + newHeat)}, over ${p.maxHeatPct}%`) }
  return { entry, worst, stop, target, riskSignal, riskWorst, band, effRiskPct: eff, shares, binding, riskDollars, value: shares * worst, newHeat, state, reasons };
}

export const breakoutSkill: Skill = {
  id: 'breakout-trade-planner', name: 'Breakout trade planner', group: 'Risk & sizing', from: 'breakout-trade-planner',
  desc: 'Plan a VCP breakout: buy-stop just above the pivot, a worst acceptable entry, stop under the last contraction, R target, size by setup rating and caps, and whether the plan is actionable, needs revalidation, is rejected or blocked by portfolio heat.',
  inputs: [
    { key: 'symbol', label: 'Symbol (current price)', type: 'symbol', optional: true },
    { key: 'pivot', label: 'Pivot (last contraction high)', type: 'number' }, { key: 'low', label: 'Last contraction low', type: 'number' },
    { key: 'price', label: 'Current price (empty = last close)', type: 'number', optional: true },
    { key: 'score', label: 'Setup score 0–100', type: 'number', default: 80 }, { key: 'breakoutVolume', label: 'Breakout on volume', type: 'bool', default: false },
    { key: 'account', label: 'Account', type: 'number', optional: true, hint: 'empty = paper equity' }, { key: 'riskPct', label: 'Base risk %', type: 'number', default: 0.5 },
    { key: 'maxPositionPct', label: 'Max position %', type: 'number', default: 10 }, { key: 'maxSectorPct', label: 'Max sector %', type: 'number', default: 30 }, { key: 'sectorExposure', label: 'Sector already %', type: 'number', default: 0 },
    { key: 'heatPct', label: 'Open risk now (% of account)', type: 'number', default: 0 }, { key: 'maxHeatPct', label: 'Max portfolio heat %', type: 'number', default: 6 },
    { key: 'targetR', label: 'Target (R)', type: 'number', default: 2 }, { key: 'stopBufferPct', label: 'Stop buffer %', type: 'number', default: 1 },
    { key: 'maxChasePct', label: 'Max chase %', type: 'number', default: 2 }, { key: 'pivotBufferPct', label: 'Pivot buffer %', type: 'number', default: 0.1 }, { key: 'maxRiskPct', label: 'Max risk at worst entry %', type: 'number', default: 8 },
    { key: 'fractional', label: 'Fractional units', type: 'bool', default: true },
  ],
  async run(v, ctx) {
    const sym = String(v.symbol || '').trim().toUpperCase(), acct = num(v.account, 'Account', { optional: true });
    let price = num(v.price, 'Price', { optional: true });
    if (!Number.isFinite(price)) { if (!sym) throw new Error('Give the current price or a symbol'); price = (await ctx.bars(sym, '1d')).at(-1)?.close ?? NaN }
    const n = (k: string, name: string) => num(v[k], name);
    const r = planBreakout({ pivot: n('pivot', 'Pivot'), low: n('low', 'Contraction low'), price, score: n('score', 'Score'), breakoutVolume: !!v.breakoutVolume, account: Number.isFinite(acct) && acct > 0 ? acct : ctx.account().equity, riskPct: n('riskPct', 'Risk %'),
      maxPositionPct: n('maxPositionPct', 'Max position'), maxSectorPct: n('maxSectorPct', 'Max sector'), sectorExposure: n('sectorExposure', 'Sector'), heatPct: n('heatPct', 'Heat'), maxHeatPct: n('maxHeatPct', 'Max heat'), targetR: n('targetR', 'Target'),
      stopBufferPct: n('stopBufferPct', 'Stop buffer'), maxChasePct: n('maxChasePct', 'Max chase'), pivotBufferPct: n('pivotBufferPct', 'Pivot buffer'), maxRiskPct: n('maxRiskPct', 'Max risk'), fractional: !!v.fractional });
    return {
      verdict: { label: r.state, tone: r.state === 'ACTIONABLE' ? 'up' : r.state === 'REVALIDATE' ? 'warn' : 'dn', detail: r.state === 'ACTIONABLE' ? `buy stop ${money(r.entry)}, limit ${money(r.worst)}` : r.state === 'REVALIDATE' ? 'broke out: confirm live, buy only up to the worst entry' : r.reasons.join('; ') },
      kpis: [{ label: 'Trigger', value: money(r.entry) }, { label: 'Worst entry', value: money(r.worst) }, { label: 'Stop', value: money(r.stop), tone: 'dn' }, { label: 'Target', value: money(r.target), tone: 'up' },
        { label: 'Risk (signal / worst)', value: `${pct(r.riskSignal)} / ${pct(r.riskWorst)}` }, { label: 'Rating', value: `${r.band} · ×${(r.effRiskPct / (Number(v.riskPct) || 1)).toFixed(2)}` },
        { label: 'Units', value: r.shares }, { label: 'Risk', value: `${money(r.riskDollars)} (${pct(r.newHeat)})` }],
      notes: [...(r.binding ? [`Size limited by: ${r.binding}`] : []), ...(r.state !== 'REJECTED' ? r.reasons : [])],
    };
  },
};
