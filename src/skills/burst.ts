// stockbee-momentum-burst-screener: Pradeep Bonde's 3–5 day Momentum Bursts — 4% breakout on rising volume, $0.90
// dollar breakout, range expansion after a quiet day, scored for volume, the tight base before it, close location,
// risk to the day's low, failure filters and the market gate (0–100 → A / A- / B / Watch / Reject). Bars newest first.
import type { Ctx, Skill } from './types.ts';
import { barsMany, type Stock } from './vcp.ts';

export interface B { date: string; open: number; high: number; low: number; close: number; volume: number }
export const BURST_DEFAULTS = { minPrice: 5, minVolume: 100_000, four: 4, dollar: 0.9, nineM: 9_000_000, maxPrevGain: 2, minBase: 3, maxBase: 20, maxWidth: 15, maxAvgRange: 5, narrowPrev: 3, breakdownLook: 5, breakdown: 4, maxRisk: 10 };
type Opt = typeof BURST_DEFAULTS;
const avg = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);
const chg = (n: number, o: number) => (o <= 0 ? 0 : (n / o - 1) * 100);
const loc = (b: B) => (b.high - b.low <= 0 ? 50 : (b.close - b.low) / (b.high - b.low) * 100);

export function base(bars: B[], o: Opt) {
  if (bars.length < o.minBase + 2) return { days: 0, width: 0, avgRange: 0, dry: false };
  let best: { days: number; width: number; avgRange: number; dry: boolean } | null = null;
  const longest = Math.min(o.maxBase, bars.length - 1);
  for (let w = o.minBase; w <= longest; w++) {
    const p = bars.slice(1, 1 + w), ref = p[0].close; if (ref <= 0) continue;
    const width = (Math.max(...p.map(b => b.high)) - Math.min(...p.map(b => b.low))) / ref * 100, ar = avg(p.filter(b => b.close > 0).map(b => (b.high - b.low) / b.close * 100));
    if (width <= o.maxWidth && ar <= o.maxAvgRange) {
      const bv = avg(p.map(b => b.volume)), older = bars.slice(1 + w, 1 + w * 2), ov = older.length ? avg(older.map(b => b.volume)) : 0;
      const c = { days: w, width, avgRange: ar, dry: !!ov && bv <= ov * 0.85 };
      if (!best || c.days > best.days || (c.days === best.days && c.width < best.width)) best = c;
    }
  }
  if (best) return best;
  const p = bars.slice(1, 1 + Math.min(longest, Math.max(o.minBase, 1))), ref = p.length ? p[0].close : 1;
  return { days: 0, width: p.length ? (Math.max(...p.map(b => b.high)) - Math.min(...p.map(b => b.low))) / ref * 100 : 0, avgRange: avg(p.filter(b => b.close > 0).map(b => (b.high - b.low) / b.close * 100)), dry: false };
}
export function triggers(bars: B[], o: Opt) {
  const l = bars[0], p = bars[1], p2 = bars[2], gain = chg(l.close, p.close), dollar = l.close - l.open, range = l.high - l.low, prevGain = chg(p.close, p2.close);
  const priorMax = Math.max(...bars.slice(1, 4).map(b => b.high - b.low)), v20 = avg(bars.slice(1, 21).map(b => b.volume)), floor = l.volume >= o.minVolume, up = l.volume > p.volume, tags: string[] = [];
  if (gain >= o.four && up && floor) tags.push('4pct_breakout');
  if (dollar >= o.dollar && floor) tags.push('dollar_breakout');
  if (range > priorMax && prevGain <= o.maxPrevGain && up && floor) tags.push('range_expansion');
  if (l.volume >= o.nineM) tags.push('9m_volume');
  return { tags, primary: ['4pct_breakout', 'range_expansion', 'dollar_breakout', '9m_volume'].find(t => tags.includes(t)) ?? 'none', gain, dollar, rangePct: l.close > 0 ? range / l.close * 100 : 0, v1: p.volume > 0 ? l.volume / p.volume : 0, v20: v20 > 0 ? l.volume / v20 : 0, loc: loc(l) };
}
export function burst(bars: B[], gate: 'allowed' | 'neutral' | 'restrictive' = 'neutral', o: Opt = BURST_DEFAULTS) {
  if (bars.length < Math.max(25, o.minBase + 3)) return { state: 'REJECTED', rating: 'Reject', score: 0, raw: 0, reasons: ['insufficient_history'] as string[] } as const;
  const l = bars[0], p = bars[1], reasons: string[] = [];
  if (l.close < o.minPrice) reasons.push('below_min_price');
  if (l.volume < o.minVolume) reasons.push('below_min_volume');
  const t = triggers(bars, o);
  if (!t.tags.some(x => x !== '9m_volume')) reasons.push('no_momentum_burst_trigger');
  const b = base(bars, o);
  let streak = 0; for (let i = 1; i <= Math.min(bars.length - 1, 5); i++) { if (bars[i].close > bars[i + 1].close) streak++; else break }
  let breakdown = false; for (let i = 1; i < Math.min(bars.length - 1, o.breakdownLook + 1); i++) if (chg(bars[i].close, bars[i + 1].close) <= -Math.abs(o.breakdown)) { breakdown = true; break }
  const risk = (l.close - l.low) / l.close * 100;
  if (l.close <= l.low) reasons.push('invalid_stop_reference');
  if (risk > o.maxRisk) reasons.push('risk_too_wide');
  const has = (x: string) => t.tags.includes(x);
  const trig = Math.min(20, (has('4pct_breakout') ? 14 + (t.gain >= 7 ? 3 : 0) : 0) + (has('range_expansion') ? 10 : 0) + (has('dollar_breakout') ? 8 : 0) + (has('9m_volume') ? 2 : 0));
  const br = Math.max(t.v1, t.v20), vol = br >= 3 ? 15 : br >= 2 ? 12 : br >= 1.5 ? 9 : br >= 1 ? 6 : 0;
  const pr = p.close > 0 ? (p.high - p.low) / p.close * 100 : 0;
  const setup = Math.min(25, (b.days >= 10 ? 10 : b.days >= 5 ? 8 : b.days >= 3 ? 6 : b.days > 0 ? 3 : 0) + (b.width && b.width <= 8 ? 7 : b.width <= 12 ? 5 : b.width <= o.maxWidth ? 3 : 0) + (pr <= o.narrowPrev ? 5 : p.close < p.open ? 4 : 0) + (b.dry ? 3 : 0));
  const close = t.loc >= 90 ? 10 : t.loc >= 80 ? 9 : t.loc >= 70 ? 7 : t.loc >= 60 ? 5 : t.loc >= 50 ? 3 : 0;
  const rd = risk <= 0 ? 0 : risk <= 2.5 ? 15 : risk <= 4 ? 12 : risk <= 6 ? 8 : risk <= 8 ? 5 : risk <= 10 ? 2 : 0;
  const soft: string[] = []; let fail = 10;
  if (streak >= 3) { fail -= 4; soft.push('prior_3day_runup') }
  if (breakdown) { fail -= 4; soft.push('recent_4pct_breakdown') }
  if (b.width > o.maxWidth) { fail -= 3; soft.push('wide_prior_base') }
  if (t.loc < 50) { fail -= 2; soft.push('weak_close_location') }
  const comps = { trigger: trig, volume: vol, setup, close_quality: close, risk_distance: rd, failure_filters: Math.max(0, fail), market_gate: gate === 'allowed' ? 5 : gate === 'neutral' ? 3 : 0 };
  const raw = Object.values(comps).reduce((a, x) => a + x, 0), hard = reasons.length > 0, s = hard ? 0 : raw;
  const rating = s >= 90 ? 'A' : s >= 80 ? 'A-' : s >= 70 ? 'B' : s >= 55 ? 'Watch' : 'Reject';
  const state = hard ? 'REJECTED' : gate === 'restrictive' && raw >= 70 ? 'MANUAL_REVIEW_ONLY' : raw >= 80 ? 'ACTIONABLE_DAY1' : raw >= 70 ? 'MANUAL_REVIEW' : raw >= 55 ? 'WATCH_ONLY' : 'REJECTED';
  return { state, rating, score: s, raw, reasons, soft, comps, t, b, risk, streak, breakdown, stop: l.low, entry: l.close, date: l.date };
}
const PRIORITY: Record<string, number> = { ACTIONABLE_DAY1: 0, MANUAL_REVIEW: 1, MANUAL_REVIEW_ONLY: 2, WATCH_ONLY: 3, REJECTED: 4 };
export const sortBursts = <T extends { state: string; score: number }>(r: T[]) => [...r].sort((a, b) => (PRIORITY[a.state] ?? 9) - (PRIORITY[b.state] ?? 9) || b.score - a.score);
/** Newest-first daily bars, the last `n` sessions. */
export const toB = (b: { time: number; open: number; high: number; low: number; close: number; volume: number }[], n = 80): B[] => b.filter(x => Math.min(x.open, x.high, x.low, x.close) > 0 && x.high >= x.low).slice(-n).reverse().map(x => ({ date: new Date(x.time * 1000).toISOString().slice(0, 10), open: x.open, high: x.high, low: x.low, close: x.close, volume: Math.trunc(x.volume) }));
/** The US universe the Stockbee screens use: market cap, price and volume floors, largest first. */
export async function stockUniverse(ctx: Ctx, v: Record<string, unknown>, { minCap = 500e6, minPrice = 5, minVol = 100_000, max = 300 } = {}) {
  const custom = String(v.symbols ?? '').toUpperCase().split(/[\s,]+/).filter(Boolean);
  const all = await ctx.json<Stock[]>('/api/us-stocks').catch(() => [] as Stock[]), names = new Map(all.map(s => [s.sym, s]));
  const syms = custom.length ? custom : all.filter(s => s.cap >= minCap && s.price > minPrice && s.volume > minVol).slice(0, Math.min(1000, Math.max(10, Number(v.universe) || max))).map(s => s.sym);
  return { syms, names, bars: await barsMany(ctx, syms) };
}
export const universeInputs = (def = 300) => [{ key: 'universe', label: 'Universe (largest US stocks)', type: 'number' as const, default: def }, { key: 'symbols', label: 'Or these symbols', type: 'symbols' as const, optional: true, default: '' }];

export const burstSkill: Skill = {
  id: 'stockbee-momentum-burst-screener', name: 'Momentum bursts (Stockbee)', group: 'Screeners', from: 'stockbee-momentum-burst-screener',
  desc: 'Today\'s Stockbee momentum bursts for a 3–5 day swing: 4% breakouts on rising volume, $0.90 dollar breakouts and range expansions out of tight bases, scored for volume, base, close location, risk to the day\'s low and failure filters. Candidates only, not signals.',
  inputs: [...universeInputs(300), { key: 'gate', label: 'Market gate (from exposure coach)', type: 'select', options: ['neutral', 'allowed', 'restrictive'], default: 'neutral' }],
  async run(v, ctx: Ctx) {
    const { names, bars } = await stockUniverse(ctx, v), gate = (String(v.gate) || 'neutral') as 'neutral';
    const res = sortBursts([...bars].map(([s, b]) => ({ s, ...burst(toB(b), gate) })));
    const live = res.filter(r => r.state !== 'REJECTED');
    return {
      verdict: { label: `${res.filter(r => r.state === 'ACTIONABLE_DAY1').length} actionable · ${live.length} candidates`, tone: live.length ? 'up' : 'muted', detail: `${bars.size} stocks scanned for the session of ${new Date(([...bars.values()][0]?.at(-1)?.time ?? 0) * 1000).toISOString().slice(0, 10)}.` },
      tables: [{ title: 'Momentum bursts', cols: ['Symbol', 'Name', 'State', 'Rating', 'Score', 'Trigger', 'Gain', 'Vol ×', 'Base days', 'Close loc', 'Entry', 'Stop', 'Risk', 'Flags'], rows: live.slice(0, 60).map(r => 't' in r ? [r.s, names.get(r.s)?.name ?? '', r.state.replace(/_/g, ' '), r.rating, r.score, r.t.tags.join(', '), `${r.t.gain.toFixed(1)}%`, Math.max(r.t.v1, r.t.v20).toFixed(1), r.b.days, `${r.t.loc.toFixed(0)}%`, r.entry.toFixed(2), r.stop.toFixed(2), `${r.risk.toFixed(1)}%`, r.soft.join(', ')] : []) }],
      notes: ['Exit template: 3 to 5 days, or protect an abnormal profit early. Stop = the burst day\'s low.', 'Daily bars include today\'s unfinished session while the market is open. No order is placed.'],
    };
  },
};
