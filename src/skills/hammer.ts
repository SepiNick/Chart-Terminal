// stockbee-exhaustion-hammer-screener: near-close buys of a hammer after a pullback in a former leader — long lower
// wick, small body, strong close, recovery off the low, ideally undercutting and reclaiming the 5-day low — scored for
// liquidity/quality, prior momentum, pullback exhaustion, hammer geometry, risk to the low and the market gate.
import type { Ctx, Skill } from './types.ts';
import { stockUniverse, toB, universeInputs, type B } from './burst.ts';

export const HAMMER_DEFAULTS = { minPrice: 20, minVolume: 100_000, minDollarVol: 20e6, minCap: 2e9, highLook: 40, minSinceHigh: 3, maxSinceHigh: 30, minPull: 6, maxPull: 35, undercutLook: 5, requireUndercut: false, minWick: 40, maxBody: 35, maxUpper: 35, minLoc: 60, minWickBody: 1.5, minRecovery: 2, maxRisk: 12, stopBuffer: 0.1 };
type Opt = typeof HAMMER_DEFAULTS;
const avg = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);
const chg = (n: number, o: number) => (o <= 0 ? 0 : (n / o - 1) * 100);

export function hammer(bars: B[], gate: 'allowed' | 'neutral' | 'restrictive' = 'neutral', cap = 0, o: Opt = HAMMER_DEFAULTS) {
  if (bars.length < Math.max(30, o.highLook + 2, o.undercutLook + 2)) return { state: 'REJECTED', rating: 'Reject', score: 0, raw: 0, reasons: ['insufficient_history'] };
  const l = bars[0], p = bars[1], reasons: string[] = [];
  if (l.close < o.minPrice) reasons.push('below_min_price');
  if (l.volume < o.minVolume) reasons.push('below_min_volume');
  // hammer geometry
  const range = l.high - l.low > 0 ? l.high - l.low : 1e-6, body = Math.abs(l.close - l.open), lw = Math.max(0, Math.min(l.open, l.close) - l.low), uw = Math.max(0, l.high - Math.max(l.open, l.close));
  const loc = l.high - l.low <= 0 ? 50 : (l.close - l.low) / (l.high - l.low) * 100, wb = body > 0 ? lw / body : 999, rec = chg(l.close, l.low), gain = chg(l.close, p.close);
  const lwP = lw / range * 100, bP = body / range * 100, uP = uw / range * 100, green = l.close >= l.open, tags: string[] = [];
  if (lwP >= o.minWick) tags.push('long_lower_wick'); if (bP <= o.maxBody) tags.push('small_body'); if (loc >= o.minLoc) tags.push('strong_close_location'); if (wb >= o.minWickBody) tags.push('wick_body_asymmetry');
  if (rec >= o.minRecovery) tags.push('recovered_from_low'); if (green) tags.push('green_or_flat_close'); if (uP <= o.maxUpper) tags.push('controlled_upper_wick');
  // pullback
  const win = bars.slice(1, 1 + o.highLook), hb = win.reduce((a, b) => (b.high > a.high ? b : a)), since = bars.indexOf(hb), pull = chg(l.close, hb.high);
  const lowWin = bars.slice(1, 1 + o.undercutLook), lb = lowWin.length ? lowWin.reduce((a, b) => (b.low < a.low ? b : a)) : bars[1], undercut = l.low < lb.low && l.close > lb.low, under = lb.low > 0 ? chg(l.low, lb.low) : 0;
  const down10 = bars.slice(1, 11).filter(b => b.close < b.open).length;
  let lower5 = 0; for (let i = 1; i < Math.min(bars.length - 1, 6); i++) if (bars[i].close < bars[i + 1].close) lower5++;
  let streak = 0; for (let i = 1; i <= Math.min(bars.length - 1, 7); i++) { if (bars[i].close < bars[i + 1].close) streak++; else break }
  const ma50 = avg(bars.slice(0, Math.min(50, bars.length)).map(b => b.close)), above50 = ma50 > 0 ? l.close >= ma50 : false;
  const r20 = bars.length > 21 ? chg(bars[1].close, bars[21].close) : 0, r60 = bars.length > 61 ? chg(bars[1].close, bars[61].close) : 0;
  // quality
  const p20 = bars.slice(1, 21), av20 = avg(p20.map(b => b.volume)), dv20 = avg(p20.map(b => b.close * b.volume)), v20 = av20 > 0 ? l.volume / av20 : 0;
  if (dv20 < o.minDollarVol) reasons.push('below_min_avg_dollar_volume');
  if (cap > 0 && cap < o.minCap) reasons.push('below_min_market_cap');
  if (lwP < o.minWick) reasons.push('lower_wick_too_small'); if (bP > o.maxBody) reasons.push('body_too_large'); if (loc < o.minLoc) reasons.push('weak_close_location');
  if (wb < o.minWickBody) reasons.push('weak_wick_body_asymmetry'); if (rec < o.minRecovery) reasons.push('insufficient_recovery_from_low');
  const depth = Math.abs(pull);
  if (depth < o.minPull) reasons.push('pullback_too_shallow'); if (depth > o.maxPull) reasons.push('pullback_too_deep');
  if (since < o.minSinceHigh) reasons.push('too_close_to_recent_high'); if (since > o.maxSinceHigh) reasons.push('recent_high_too_stale');
  if (o.requireUndercut && !undercut) reasons.push('missing_undercut_reclaim');
  const stop = l.low * (1 - o.stopBuffer / 100), risk = (l.close - stop) / l.close * 100;
  if (l.close <= stop) reasons.push('invalid_stop_reference'); if (risk > o.maxRisk) reasons.push('risk_too_wide');
  const quality = Math.min(20, (l.close >= o.minPrice * 2 ? 4 : l.close >= o.minPrice ? 3 : 0) + (dv20 >= o.minDollarVol * 3 ? 6 : dv20 >= o.minDollarVol ? 5 : l.volume >= o.minVolume ? 2 : 0) + (cap >= o.minCap * 5 ? 5 : cap >= o.minCap ? 4 : cap <= 0 ? 2 : 0) + (av20 >= o.minVolume ? 2 : 0));
  const momentum = Math.min(15, (since >= o.minSinceHigh && since <= o.maxSinceHigh ? 5 : since <= o.highLook ? 2 : 0) + (r60 >= 30 ? 5 : r60 >= 15 ? 4 : r20 >= 10 ? 3 : 0) + (above50 ? 3 : 0) + (hb.high > 0 ? 2 : 0));
  const exhaustion = Math.min(20, (depth >= o.minPull && depth <= Math.min(25, o.maxPull) ? 6 : depth <= o.maxPull ? 4 : 0) + (undercut ? 6 : under < 0 ? 3 : 0) + (down10 >= 5 ? 3 : down10 >= 3 ? 2 : 0) + (lower5 >= 3 || streak >= 2 ? 2 : 0) + (v20 >= 1.5 ? 3 : v20 >= 1 ? 2 : 0));
  const geometry = Math.min(25, (lwP >= 60 ? 8 : lwP >= o.minWick ? 6 : 0) + (bP <= 20 ? 5 : bP <= o.maxBody ? 4 : 0) + (loc >= 75 ? 5 : loc >= o.minLoc ? 4 : 0) + (wb >= 3 ? 3 : wb >= o.minWickBody ? 2 : 0) + (rec >= o.minRecovery * 2 ? 2 : rec >= o.minRecovery ? 1 : 0) + (green ? 1 : 0) + (uP <= o.maxUpper ? 1 : 0));
  const rd = risk <= 0 ? 0 : risk <= 3 ? 15 : risk <= 5 ? 12 : risk <= 7.5 ? 9 : risk <= 10 ? 6 : risk <= 12 ? 3 : 0;
  const comps = { quality, prior_momentum: momentum, pullback_exhaustion: exhaustion, hammer_geometry: geometry, risk_distance: rd, market_gate: gate === 'allowed' ? 5 : gate === 'neutral' ? 3 : 0 };
  const raw = Object.values(comps).reduce((a, x) => a + x, 0), hard = reasons.length > 0, s = hard ? 0 : raw;
  const rating = s >= 90 ? 'A' : s >= 82 ? 'A-' : s >= 70 ? 'B' : s >= 55 ? 'Watch' : 'Reject';
  const state = hard ? 'REJECTED' : gate === 'restrictive' && raw >= 70 ? 'MANUAL_REVIEW_ONLY' : raw >= 82 ? 'ACTIONABLE_CLOSE_BUY' : raw >= 70 ? 'MANUAL_REVIEW' : raw >= 55 ? 'WATCH_TOMORROW' : 'REJECTED';
  const soft = [!undercut && 'no_undercut_reclaim', depth > 25 && 'deep_pullback', since > o.maxSinceHigh && 'stale_high', v20 < 0.8 && 'weak_volume_confirmation', loc < 70 && 'moderate_close_location', gain < -3 && 'still_down_big_on_day', risk >= 8 && 'wide_risk'].filter((x): x is string => !!x);
  return { state, rating, score: s, raw, reasons, soft, comps, entry: l.close, stop, risk, pull, since, undercut, loc, lwP, v20, gain };
}
const PRIORITY: Record<string, number> = { ACTIONABLE_CLOSE_BUY: 0, MANUAL_REVIEW: 1, MANUAL_REVIEW_ONLY: 2, WATCH_TOMORROW: 3, REJECTED: 4 };

export const hammerSkill: Skill = {
  id: 'stockbee-exhaustion-hammer-screener', name: 'Exhaustion hammers (Stockbee)', group: 'Screeners', from: 'stockbee-exhaustion-hammer-screener',
  desc: 'Selling-exhaustion hammers in liquid former leaders: a 6–35% pullback from a 3–30 day old high, then a long lower wick, small body and strong close (best when it undercuts and reclaims the 5-day low). For a near-close buy with a stop just under the low. Candidates only.',
  inputs: [...universeInputs(300), { key: 'gate', label: 'Market gate (from exposure coach)', type: 'select', options: ['neutral', 'allowed', 'restrictive'], default: 'neutral' }, { key: 'undercut', label: 'Require undercut & reclaim', type: 'bool', default: false }],
  async run(v, ctx: Ctx) {
    const { names, bars } = await stockUniverse(ctx, v, { minCap: 2e9, minPrice: 20 }), gate = (String(v.gate) || 'neutral') as 'neutral', o = { ...HAMMER_DEFAULTS, requireUndercut: v.undercut === true };
    const res = [...bars].map(([s, b]) => ({ s, ...hammer(toB(b, 120), gate, names.get(s)?.cap ?? 0, o) })).sort((a, b) => (PRIORITY[a.state] ?? 9) - (PRIORITY[b.state] ?? 9) || b.score - a.score), live = res.filter(r => r.state !== 'REJECTED');
    return {
      verdict: { label: `${res.filter(r => r.state === 'ACTIONABLE_CLOSE_BUY').length} close-buy · ${live.length} candidates`, tone: live.length ? 'up' : 'muted', detail: `${bars.size} stocks scanned.` },
      tables: [{ title: 'Exhaustion hammers', cols: ['Symbol', 'Name', 'State', 'Rating', 'Score', 'Pullback', 'Days since high', 'Undercut', 'Wick', 'Close loc', 'Vol × 20d', 'Entry', 'Stop', 'Risk', 'Flags'], rows: live.slice(0, 60).map(r => 'comps' in r && r.comps ? [r.s, names.get(r.s)?.name ?? '', r.state.replace(/_/g, ' '), r.rating, r.score, `${r.pull!.toFixed(1)}%`, r.since!, r.undercut ? 'yes' : '', `${r.lwP!.toFixed(0)}%`, `${r.loc!.toFixed(0)}%`, r.v20!.toFixed(1), r.entry!.toFixed(2), r.stop!.toFixed(2), `${r.risk!.toFixed(1)}%`, r.soft!.join(', ')] : []) }],
      notes: ['Run near the close: today\'s bar is still forming while the market is open. Stop = the hammer low − 0.1%; review the next 3–5 days for follow-through. Holder counts are not available here, so that quality point is never given.', 'No order is placed.'],
    };
  },
};
