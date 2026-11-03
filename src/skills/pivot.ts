// stockbee-episodic-pivot-analyzer: Episodic Pivots — a fresh catalyst (guidance raise, FDA, earnings, M&A…) that
// re-rates a neglected stock on a gap and a volume shock. Scores catalyst quality, price action, volume, neglect,
// liquidity and risk to the EP-day low (0–100) and gives ACTIONABLE_DAY1 / DAY1_WATCH / DELAYED_EP_WATCH /
// CATALYST_WATCH / REJECT, with the original's rules. Bars here are oldest first.
import { pyRoundN, type Ctx, type Skill } from './types.ts';
import { stockUniverse, universeInputs } from './burst.ts';
import type { Bar } from './study20.ts';

const ALIASES: Record<string, string> = { earnings: 'earnings', earnings_beat: 'earnings', earnings_acceleration: 'earnings', beat_and_raise: 'guidance_raise', guidance: 'guidance_raise', guidance_raise: 'guidance_raise', raise_guidance: 'guidance_raise', 'm&a': 'm_and_a', ma: 'm_and_a', m_and_a: 'm_and_a', merger: 'm_and_a', acquisition: 'm_and_a', buyout: 'm_and_a', fda: 'fda_approval', fda_approval: 'fda_approval', approval: 'regulatory_approval', regulatory: 'regulatory_approval', regulatory_approval: 'regulatory_approval', contract: 'major_contract', major_contract: 'major_contract', partnership: 'major_partnership', major_partnership: 'major_partnership', analyst: 'analyst_upgrade', analyst_upgrade: 'analyst_upgrade', upgrade: 'analyst_upgrade', product: 'product_launch', product_launch: 'product_launch', story: 'story_theme', theme: 'story_theme', story_theme: 'story_theme', short_squeeze: 'short_squeeze' };
const KEYWORDS: [string, RegExp][] = [
  ['guidance_raise', /\b(raise[sd]?|boost[sed]?|lift[sed]?|increase[sd]?)\b.*\bguidance\b/], ['guidance_raise', /\bguidance\b.*\b(raise[sd]?|boost[sed]?|lift[sed]?|increase[sd]?)\b/],
  ['earnings', /\b(beat|beats|surprise|eps|earnings|revenue)\b/], ['m_and_a', /\b(acquire[sd]?|acquisition|merger|buyout|takeover|tender offer)\b/],
  ['fda_approval', /\b(fda|pdufa|phase 3|phase iii|drug approval|approved)\b/], ['regulatory_approval', /\b(regulatory approval|approved by|clearance|authorization)\b/],
  ['major_contract', /\b(contract|order|backlog|award|customer win|deal)\b/], ['major_partnership', /\b(partnership|collaboration|strategic alliance)\b/],
  ['analyst_upgrade', /\b(upgrade[sd]?|price target|initiates coverage|overweight|buy rating)\b/], ['product_launch', /\b(launch|unveil|new product|commercialization)\b/],
  ['short_squeeze', /\b(short squeeze|squeeze|short interest)\b/], ['story_theme', /\b(ai|artificial intelligence|crypto|bitcoin|nuclear|uranium|space|robotics|ev|defense)\b/],
];
export const BASE: Record<string, number> = { guidance_raise: 95, fda_approval: 94, earnings: 88, m_and_a: 84, regulatory_approval: 82, major_contract: 76, major_partnership: 72, product_launch: 66, short_squeeze: 58, analyst_upgrade: 54, story_theme: 50, unknown: 35 };
const EP_TYPE: Record<string, string> = { earnings: 'EARNINGS_EP', guidance_raise: 'GUIDANCE_EP', m_and_a: 'M_AND_A_EP', fda_approval: 'FDA_EP', regulatory_approval: 'REGULATORY_EP', major_contract: 'CONTRACT_EP', major_partnership: 'PARTNERSHIP_EP', analyst_upgrade: 'ANALYST_EP', product_launch: 'PRODUCT_EP', short_squeeze: 'SQUEEZE_EP', story_theme: 'STORY_EP', unknown: 'UNCLASSIFIED_EP' };
const GRADE: Record<string, number> = { A: 8, B: 4, C: 0, D: -4 };
export const normCat = (raw: unknown) => { const t = String(raw ?? '').trim().toLowerCase().replace(/-/g, '_').replace(/ /g, '_'); return !t ? 'unknown' : ALIASES[t] ?? (t in BASE ? t : 'unknown') };
export function classify(type: string | undefined, text: string) {
  const e = normCat(type); if (e !== 'unknown') return e;
  const t = text.toLowerCase(); for (const [k, re] of KEYWORDS) if (re.test(t)) return k;
  return 'unknown';
}
export interface EpEvent { symbol: string; date?: string; catalyst?: string; headline?: string; grade?: string; cap?: number }
type Rec = Record<string, number | null | undefined>;
const avgPos = (v: number[]) => { const c = v.filter(x => x > 0); return c.length ? c.reduce((a, b) => a + b, 0) / c.length : null };
export function stats(bars: Bar[], date?: string): Rec {
  if (!bars.length) return {};
  let idx = date ? bars.findIndex(b => b.date === date) : -1;
  if (date && idx < 0) idx = bars.findIndex(b => b.date >= date);
  if (idx < 0) idx = bars.length - 1;
  if (idx <= 0) return {};
  const b = bars[idx], pc = bars[idx - 1].close, prior = bars.slice(Math.max(0, idx - 50), idx), a20 = avgPos(prior.slice(-20).map(x => x.volume)), a50 = avgPos(prior.map(x => x.volume));
  const r: Rec = { open: b.open, high: b.high, low: b.low, close: b.close, prev_close: pc, volume: b.volume, avg_volume_20: a20, avg_volume_50: a50 };
  if (pc && pc > 0) { if (b.open) r.gap_pct = (b.open / pc - 1) * 100; if (b.close) r.day_gain_pct = (b.close / pc - 1) * 100; if (b.high && b.low) r.range_pct = (b.high - b.low) / pc * 100 }
  if (b.high && b.low && b.close && b.high > b.low) r.close_location_pct = (b.close - b.low) / (b.high - b.low) * 100;
  if (b.close && b.low && b.close > 0) r.risk_pct_to_low = (b.close - b.low) / b.close * 100;
  if (b.close && b.volume) r.dollar_volume = b.close * b.volume;
  r.volume_ratio_20 = b.volume && a20 ? b.volume / a20 : null; r.volume_ratio_50 = b.volume && a50 ? b.volume / a50 : null;
  if (idx >= 5 && pc && bars[idx - 5].close) r.prior_5d_return_pct = (pc / bars[idx - 5].close - 1) * 100;
  if (idx >= 20 && pc && bars[idx - 20].close) r.prior_20d_return_pct = (pc / bars[idx - 20].close - 1) * 100;
  r.event_date_idx = idx;
  return r;
}
const val = (x: number | null | undefined) => (x == null ? null : x);
function catalystScore(cat: string, grade: string, text: string) {
  let b = BASE[cat] ?? 35; const g = grade.toUpperCase(); if (g in GRADE) b += GRADE[g];
  const t = text.toLowerCase();
  if (/\b(first|record|accelerat|inflect|turnaround|transform|breakthrough)\b/.test(t)) b += 6;
  if (/\b(secondary offering|dilution|investigation|downgrade|lawsuit|resignation)\b/.test(t)) b -= 12;
  return Math.max(0, Math.min(100, b)) * 0.35;
}
function priceScore(r: Rec) {
  const gap = val(r.gap_pct), dg = val(r.day_gain_pct), cl = val(r.close_location_pct), rg = val(r.range_pct), mv = dg ?? gap;
  let s = mv == null ? 0 : mv >= 12 ? 12 : mv >= 8 ? 10 : mv >= 4 ? 8 : mv >= 2 ? 4 : 0;
  if (gap != null && gap >= 4) s += 4; else if (gap != null && gap >= 2) s += 2;
  if (cl != null) { if (cl >= 80) s += 4; else if (cl >= 60) s += 2; else if (cl < 40) s -= 4 }
  if (rg != null && rg >= 6) s += 2;
  return Math.max(0, Math.min(20, s));
}
const ratioOf = (r: Rec) => val(r.volume_ratio_50 || r.volume_ratio_20 || r.volume_ratio_1d);   // Python `or`: 0 falls through
function volumeScore(r: Rec) {
  const ratio = ratioOf(r), v = val(r.volume); let s: number;
  if (ratio != null) s = ratio >= 10 ? 20 : ratio >= 5 ? 17 : ratio >= 3 ? 14 : ratio >= 1.5 ? 8 : 2;
  else if (v != null) s = v >= 9e6 ? 14 : v >= 1e6 ? 8 : v >= 3e5 ? 4 : 0;
  else s = 3;
  if (v != null && v >= 9e6 && s < 20) s += 3;
  return Math.min(20, s);
}
function revaluation(r: Rec, cap: number | null) {
  const p = val(r.prior_20d_return_pct); let s = 5;
  if (p != null) s = p <= 5 ? 8 : p <= 15 ? 6 : p <= 30 ? 3 : 1;
  if (cap != null) { if (cap < 10e9) s += 2; else if (cap > 100e9) s -= 1 }
  return Math.max(0, Math.min(10, s));
}
function liquidity(r: Rec) {
  const p = val(r.close), v = val(r.volume); let dv = val(r.dollar_volume); if (dv == null && p && v) dv = p * v;
  let s = dv != null ? (dv >= 50e6 ? 10 : dv >= 10e6 ? 8 : dv >= 2e6 ? 4 : 1) : v != null ? (v >= 1e6 ? 7 : v >= 3e5 ? 5 : 1) : 3;
  if (p != null && p < 5) s = Math.min(s, 3);
  return s;
}
const riskScore = (r: Rec) => { const k = val(r.risk_pct_to_low); return k == null ? 2 : k <= 4 ? 5 : k <= 7 ? 3.5 : k <= 10 ? 1.5 : 0 };
export const rating = (s: number) => s >= 90 ? 'A' : s >= 80 ? 'A-' : s >= 70 ? 'B' : s >= 55 ? 'C' : 'D';
export function state(r: Rec, s: number, cat: string, maxRisk = 10) {
  const dg = val(r.day_gain_pct), gap = val(r.gap_pct), vr = ratioOf(r), cl = val(r.close_location_pct), risk = val(r.risk_pct_to_low), reasons: string[] = [];
  const move = (dg != null && dg >= 4) || (gap != null && gap >= 4), vol = vr == null || vr >= 1.5 || (r.volume ?? 0) >= 3e5, weak = cl != null && cl < 40, wide = risk != null && risk > maxRisk;
  if (weak) reasons.push('weak_close_location'); if (wide) reasons.push('risk_too_wide_for_day1'); if (!move) reasons.push('price_move_not_confirmed'); if (!vol) reasons.push('volume_not_confirmed');
  const ok = move && vol && !weak && !wide;
  return { state: s >= 85 && ok ? 'ACTIONABLE_DAY1' : s >= 75 && ok ? 'DAY1_WATCH' : s >= 70 && (wide || weak) ? 'DELAYED_EP_WATCH' : cat !== 'unknown' && !move && s >= 55 ? 'CATALYST_WATCH' : 'REJECT', reasons };
}
export function analyzeEp(e: EpEvent, bars: Bar[], maxRisk = 10) {
  const r = stats(bars, e.date), text = e.headline ?? '', cat = classify(e.catalyst, text), r2 = (x: number) => pyRoundN(x, 2);
  const comps = { catalyst_quality: r2(catalystScore(cat, e.grade ?? '', text)), price_action: r2(priceScore(r)), volume_shock: r2(volumeScore(r)), neglect_revaluation: r2(revaluation(r, e.cap ?? null)), liquidity: r2(liquidity(r)), risk_distance: r2(riskScore(r)) };
  let score = r2(Object.values(comps).reduce((a, b) => a + b, 0)), st = state(r, score, cat, maxRisk);
  const reasons = [...st.reasons], cl = val(r.close_location_pct);
  if (cl != null && cl < 30 && score >= 55) { score = r2(Math.max(0, score - 8)); reasons.push('fade_deduction_applied'); st = state(r, score, cat, maxRisk); for (const x of st.reasons) if (!reasons.includes(x)) reasons.push(x) }
  const date = r.event_date_idx != null ? bars[r.event_date_idx].date : e.date;
  return { symbol: e.symbol, date, catalyst: cat, type: EP_TYPE[cat] ?? 'UNCLASSIFIED_EP', state: st.state, reasons: [...new Set(reasons)].sort(), rating: rating(score), score, comps, r,
    pead: (cat === 'earnings' || cat === 'guidance_raise') && ['ACTIONABLE_DAY1', 'DAY1_WATCH', 'DELAYED_EP_WATCH'].includes(st.state), momentum: (r.day_gain_pct ?? 0) >= 4 && st.state !== 'REJECT' };
}
/** "NVDA 2026-08-27 guidance_raise Raises Q3 guidance" — date and catalyst are optional; the rest is the headline. */
export function parseEvents(text: string): EpEvent[] {
  return text.split(/\n/).map(l => l.trim()).filter(Boolean).map(l => { const p = l.split(/\s+/), symbol = p.shift()!.toUpperCase(); const date = /^\d{4}-\d{2}-\d{2}$/.test(p[0] ?? '') ? p.shift() : undefined; const catalyst = p[0] && normCat(p[0]) !== 'unknown' ? p.shift() : undefined; return { symbol, date, catalyst, headline: p.join(' ') } });
}
const STATE_ORDER: Record<string, number> = { ACTIONABLE_DAY1: 0, DAY1_WATCH: 1, DELAYED_EP_WATCH: 2, CATALYST_WATCH: 3, REJECT: 4 };
const toBar = (b: { time: number; open: number; high: number; low: number; close: number; volume: number }[]): Bar[] => b.map(x => ({ date: new Date(x.time * 1000).toISOString().slice(0, 10), open: x.open, high: x.high, low: x.low, close: x.close, volume: x.volume }));

export const pivotSkill: Skill = {
  id: 'stockbee-episodic-pivot-analyzer', name: 'Episodic pivots (Stockbee)', group: 'Screeners', from: 'stockbee-episodic-pivot-analyzer',
  desc: 'Episodic Pivots: a fresh catalyst re-rating a neglected stock on a gap and a volume shock. Give your catalyst events (symbol, date, type or headline), or scan today\'s ≥ 4% gappers; each gets catalyst, price, volume, neglect, liquidity and risk scores and a Day-1 state. Candidates only.',
  inputs: [{ key: 'events', label: 'Catalyst events (one per line)', type: 'json', default: '', hint: 'SYMBOL [YYYY-MM-DD] [earnings|guidance|fda|m&a|contract|…] [headline]', optional: true }, ...universeInputs(300)],
  async run(v, ctx: Ctx) {
    let evs = parseEvents(String(v.events ?? '')), scanned = 0;
    const map = new Map<string, Bar[]>(), all = await ctx.json<{ sym: string; name: string; cap: number }[]>('/api/us-stocks').catch(() => []), caps = new Map(all.map(s => [s.sym, s]));
    if (evs.length) { for (const e of evs) { if (!map.has(e.symbol)) map.set(e.symbol, await ctx.bars(`FX:${e.symbol}`, '1d').then(toBar, () => [])) } }
    else {
      const { bars } = await stockUniverse(ctx, v); scanned = bars.size;
      for (const [s, b] of bars) { const x = toBar(b); map.set(s, x); const g = stats(x); if ((g.gap_pct ?? 0) >= 4 || (g.day_gain_pct ?? 0) >= 4) evs.push({ symbol: s }) }
    }
    evs = evs.map(e => ({ ...e, cap: e.cap ?? caps.get(e.symbol)?.cap }));
    const res = evs.map(e => analyzeEp(e, map.get(e.symbol) ?? [])).sort((a, b) => (STATE_ORDER[a.state] ?? 9) - (STATE_ORDER[b.state] ?? 9) || b.score - a.score);
    const f = (x: number | null | undefined, s = '%') => (x == null ? '–' : `${x.toFixed(1)}${s}`);
    return {
      verdict: { label: `${res.filter(r => r.state === 'ACTIONABLE_DAY1').length} actionable · ${res.filter(r => r.state !== 'REJECT').length} candidates`, tone: res.some(r => r.state !== 'REJECT') ? 'up' : 'muted', detail: scanned ? `${scanned} stocks scanned for ≥ 4% movers; catalysts unknown — add them as events for a fair catalyst score.` : `${evs.length} events analysed.` },
      tables: [{ title: 'Episodic pivots', cols: ['Symbol', 'Date', 'Catalyst', 'State', 'Rating', 'Score', 'Gap', 'Day', 'Vol × 50d', 'Close loc', 'Prior 20d', 'Stop (EP low)', 'Risk', 'Notes'], rows: res.slice(0, 80).map(r => [r.symbol, r.date ?? '–', r.catalyst, r.state.replace(/_/g, ' '), r.rating, r.score, f(r.r.gap_pct), f(r.r.day_gain_pct), f(r.r.volume_ratio_50, '×'), f(r.r.close_location_pct), f(r.r.prior_20d_return_pct), r.r.low?.toFixed(2) ?? '–', f(r.r.risk_pct_to_low), [...r.reasons, r.pead ? 'PEAD follow-up' : ''].filter(Boolean).join(', ')]) }],
      notes: ['Stop = the EP day\'s low. DELAYED EP WATCH = strong event, but risk or close is wrong for Day 1; wait for a tighter re-entry.', 'Validate the catalyst and chart yourself; no order is placed.'],
    };
  },
};
