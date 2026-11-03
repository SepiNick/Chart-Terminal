// market-top-detector: a 0–100 heuristic top-risk score for the next 2–8 weeks from six components (O'Neil
// distribution days, Minervini leadership health, Monty defensive rotation, breadth divergence, index technicals,
// sentiment), with the original's thresholds, weights and correlation discount. Histories are newest first, like the
// original. Breadth (200 and 50-day) comes from TraderMonty's CSV; put/call and margin debt are optional inputs.
import { pct, pyRound, pyRoundN, type Ctx, type Skill } from './types.ts';

export interface H { date: string; open: number; high: number; close: number; volume: number }
const avg = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
/** calc_ema: newest-first prices, seeded with the SMA of the oldest `n`. */
export const ema = (p: number[], n: number) => { if (p.length < n) return avg(p); const r = [...p].reverse(); let e = avg(r.slice(0, n)); const k = 2 / (n + 1); for (const x of r.slice(n)) e = x * k + e * (1 - k); return e };
const lowerHighs = (hi: number[], lb = 20) => { if (hi.length < lb) return false; const r = hi.slice(0, lb), s: number[] = []; for (let i = 1; i < r.length - 1; i++) if (r[i] > r[i - 1] && r[i] > r[i + 1]) s.push(r[i]); return s.length >= 2 && s[0] < s[1] };

// 1. Distribution days (25%)
function countDD(h: H[]) {
  let dd = 0, st = 0; const det: { date: string; type: string; i: number }[] = [];
  if (h.length < 2) return { dd, st, det };
  for (let i = 0; i < Math.min(25, h.length - 1); i++) {
    const t = h[i], y = h[i + 1];
    if (y.close === 0 || y.volume === 0) continue;
    const ch = (t.close - y.close) / y.close * 100, up = t.volume > y.volume;
    if (ch <= -0.2 && up) { dd++; det.push({ date: t.date, type: 'distribution', i }) }
    else if (up && ch >= 0 && ch < 0.1) { st++; det.push({ date: t.date, type: 'stalling', i }) }
  }
  return { dd, st, det };
}
const ddScore = (e: number) => e >= 6 ? 100 : e >= 5 ? 90 : e >= 4 ? 75 : e >= 3 ? 55 : e >= 2 ? 30 : e >= 1 ? 15 : 0;
export function distribution(sp: H[], nq: H[]) {
  const a = countDD(sp), b = countDD(nq), ea = a.dd + 0.5 * a.st, eb = b.dd + 0.5 * b.st, p = ea >= eb ? a : b, eff = Math.max(ea, eb), raw = ddScore(eff);
  const factor = p.det.length ? pyRoundN(p.det.filter(d => d.i < 5).length / p.det.length, 2) : 0;
  return { score: eff >= 2 && factor > 0.5 ? Math.min(100, pyRound(raw * 1.15)) : raw, eff, sp: a, nq: b, primary: ea >= eb ? 'S&P 500' : 'NASDAQ' };
}

// 2. Leading stock health (20%)
export const DEFAULT_LEADERS = ['ARKK', 'WCLD', 'IGV', 'XBI', 'SOXX', 'SMH', 'KWEB', 'TAN'];
export const POOL = ['SMH', 'SOXX', 'PSI', 'SOXQ', 'IGV', 'WCLD', 'CLOU', 'BUG', 'XBI', 'ARKG', 'ARKK', 'ARKW', 'KOMP', 'TAN', 'ICLN', 'KWEB', 'FDN', 'FINX', 'IPAY', 'BOTZ'];
export interface Q { price: number; yearHigh: number }
export function dynamicBasket(q: Record<string, Q>, n = 10) {
  const s = POOL.filter(x => q[x] && q[x].price > 0 && q[x].yearHigh > 0).map(x => [x, q[x].price / q[x].yearHigh] as const);
  return s.length < 5 ? [...DEFAULT_LEADERS] : [...s].sort((a, b) => b[1] - a[1]).slice(0, n).map(x => x[0]);   // stable, like Python's sort
}
export function etfDeterioration(q: Q, h: H[]) {
  let s = 0; const flags: string[] = [];
  const dist = q.yearHigh > 0 ? (q.price - q.yearHigh) / q.yearHigh * 100 : 0;
  if (q.yearHigh > 0) { const p = dist <= -25 ? 40 : dist <= -15 ? 30 : dist <= -10 ? 20 : dist <= -5 ? 10 : 0; if (p) { s += p; flags.push(`${Math.abs(dist).toFixed(0)}% below 52w high`) } }
  const c = h.map(x => x.close);
  if (h.length >= 50) {
    const s50 = avg(c.slice(0, 50));
    if (q.price < s50) { s += 20; flags.push('below 50DMA') }
    if (c.length >= 200) { if (q.price < avg(c.slice(0, 200))) { s += 20; flags.push('below 200DMA') } }
    else if (q.price < s50 * 0.95) { s += 10; flags.push('likely below 200DMA') }
  } else if (h.length >= 20 && q.price < avg(c.slice(0, 20))) { s += 15; flags.push('below 20DMA') }
  if (h.length >= 20 && lowerHighs(h.map(x => x.high))) { s += 20; flags.push('lower highs') }
  return { score: Math.min(100, s), dist, flags };
}
export function leaders(q: Record<string, Q>, hist: Record<string, H[]>, list: string[]) {
  const det: Record<string, ReturnType<typeof etfDeterioration>> = {}; let ok = 0;
  for (const x of list) { if (!q[x]) continue; if ((hist[x] ?? []).length >= 50) ok++; det[x] = etfDeterioration(q[x], hist[x] ?? []) }
  const sc = Object.values(det).map(d => d.score);
  if (!sc.length) return { score: 50, available: false, det, deteriorating: 0 };
  const a = avg(sc), bad = sc.filter(x => x >= 50).length;
  return { score: pyRound(Math.min(100, Math.max(0, bad / sc.length >= 0.6 ? Math.min(100, a * 1.3) : a))), available: ok / list.length >= 0.75, det, deteriorating: bad };
}

// 3. Defensive rotation (15%)
export const DEFENSIVE = ['XLU', 'XLP', 'XLV', 'VNQ'], OFFENSIVE = ['XLK', 'XLC', 'XLY', 'QQQ'];
const ret = (h: H[] | undefined, d: number) => !h || h.length < d + 1 || h[d].close === 0 ? null : (h[0].close - h[d].close) / h[d].close * 100;
export const rotationScore = (r: number) => r >= 5 ? 100 : r >= 3 ? pyRound(80 + (r - 3) / 2 * 20) : r >= 1.5 ? pyRound(60 + (r - 1.5) / 1.5 * 20) : r >= 0.5 ? pyRound(40 + (r - 0.5) * 20) : r >= 0 ? pyRound(20 + r / 0.5 * 20) : r >= -2 ? pyRound(Math.max(0, 20 + r / 2 * 20)) : 0;
const r2 = (x: number) => pyRoundN(x, 2);
function period(h: Record<string, H[]>, d: number) {
  const dr = DEFENSIVE.map(s => ret(h[s], d)).filter((x): x is number => x != null), or = OFFENSIVE.map(s => ret(h[s], d)).filter((x): x is number => x != null);
  if (!dr.length || !or.length) return null;
  const rel = avg(dr) - avg(or);
  return { rel: r2(rel), score: rotationScore(rel), lead: rel > 0 };
}
export function rotation(h: Record<string, H[]>) {
  const d = DEFENSIVE.map(s => ret(h[s], 20)), o = OFFENSIVE.map(s => ret(h[s], 20)), ok = [...d, ...o].filter(x => x != null).length;
  const dv = d.filter((x): x is number => x != null).map(r2), ov = o.filter((x): x is number => x != null).map(r2);
  if (!dv.length || !ov.length) return { score: 50, available: false, rel: 0, confirmation: 'none' };
  let w = 0, tw = 0, all = true, n = 0; let p20: ReturnType<typeof period> = null;
  for (const [p, wt] of [[10, 0.2], [20, 0.5], [40, 0.3]] as const) { const r = period(h, p); if (r) { w += r.score * wt; tw += wt; n++; if (!r.lead) all = false; if (p === 20) p20 = r } else all = false }
  const raw = tw > 0 ? w / tw : rotationScore(avg(dv) - avg(ov));
  const score = Math.max(0, n >= 2 && all ? pyRound(Math.min(100, raw)) : n >= 2 ? pyRound(Math.min(80, raw)) : pyRound(Math.min(100, raw)));
  return { score, available: ok / 8 >= 0.75, rel: p20 ? p20.rel : avg(dv) - avg(ov), confirmation: n >= 2 && all ? 'confirmed' : n >= 2 ? 'unconfirmed' : 'single period' };
}

// 4. Breadth divergence (15%)
const b200 = (b: number) => b < 40 ? 100 : b < 50 ? pyRound(100 - (b - 40) / 10 * 45) : b < 60 ? pyRound(55 - (b - 50) / 10 * 25) : b < 70 ? pyRound(30 - (b - 60) / 10 * 25) : 5;
export function breadth(p200: number | null, p50: number | null, dist: number) {
  if (p200 == null) return { score: 50, available: false, near: false };
  const near = dist >= -5;
  let raw = b200(p200); if (!near) raw *= 0.5;
  if (p50 != null) { if (p50 < 30 && near) raw = Math.min(100, raw + 10); else if (p50 > 70) raw = Math.max(0, raw - 5) }
  return { score: pyRound(Math.min(100, Math.max(0, raw))), available: true, near, divergence: near && p200 < 60 };
}

// 5. Index technicals (15%)
function failedRally(c: number[], lb = 15) {
  if (c.length < lb) return false;
  const r = c.slice(0, lb), i = r.indexOf(Math.max(...r));
  return i >= 3 && i <= 10 && (r[0] - r[i]) / r[i] * 100 < -2;
}
function gapDown(h: H[], lb = 5) {
  if (h.length < lb + 1) return false;
  for (let i = 0; i < lb; i++) { const t = h[i], y = h[i + 1]; if (y.close === 0 || y.volume === 0) continue; if ((t.open - y.close) / y.close * 100 <= -0.5 && t.volume > y.volume * 1.1) return true }
  return false;
}
export function indexTech(h: H[], price?: number) {
  if (h.length < 21) return { raw: 0, available: false, flags: ['insufficient data'] };
  const c = h.map(x => x.close), p = price ?? c[0], e21 = ema(c, 21), e50 = c.length >= 50 ? ema(c, 50) : null, s200 = c.length >= 200 ? avg(c.slice(0, 200)) : null;
  let s = 0; const flags: string[] = [];
  if (p < e21) { s += 8; flags.push('below 21 EMA') }
  if (e50 && p < e50) { s += 12; flags.push('below 50 EMA') }
  if (e50 && e21 < e50) { s += 10; flags.push('21 EMA < 50 EMA') }
  if (s200 && p < s200) { s += 15; flags.push('below 200 SMA') }
  if (failedRally(c)) { s += 10; flags.push('failed rally') }
  if (lowerHighs(h.map(x => x.high))) { s += 10; flags.push('lower highs') }
  if (gapDown(h)) { s += 10; flags.push('gap down on volume') }
  return { raw: Math.min(100, s), available: true, flags };
}
export function technical(sp: H[], nq: H[], spPx?: number, nqPx?: number) {
  const a = indexTech(sp, spPx), b = indexTech(nq, nqPx), s = [a, b].filter(x => x.available).map(x => x.raw);
  return { score: s.length ? pyRound(Math.min(100, Math.max(0, avg(s)))) : 50, available: s.length > 0, sp: a, nq: b };
}

// 6. Sentiment (10%)
export type Term = 'steep_contango' | 'contango' | 'flat' | 'backwardation';
export const termOf = (vix: number, vix3m: number): Term | null => !(vix3m > 0) ? null : vix / vix3m < 0.85 ? 'steep_contango' : vix / vix3m < 0.95 ? 'contango' : vix / vix3m <= 1.05 ? 'flat' : 'backwardation';
export function sentiment(vix: number | null, pc: number | null, term: Term | null, margin: number | null) {
  if (vix == null && pc == null && term == null) return { score: 50, available: false };
  let t = 0;
  if (pc != null) t += pc < 0.6 ? 35 : pc < 0.7 ? 25 : pc < 0.8 ? 12 : 0;
  if (vix != null) t += vix < 12 ? 25 : vix < 14 ? 17 : vix < 16 ? 8 : vix <= 25 ? 0 : -8;
  if (term) t += { steep_contango: 25, contango: 12, flat: 0, backwardation: -8 }[term];
  if (margin != null) t += margin > 30 ? 15 : margin > 20 ? 10 : margin > 10 ? 5 : 0;
  return { score: Math.max(0, Math.min(100, t)), available: true };
}

// Composite
export const WEIGHTS = { distribution_days: 0.25, leading_stocks: 0.2, defensive_rotation: 0.15, breadth_divergence: 0.15, index_technical: 0.15, sentiment: 0.1 };
export type Comp = keyof typeof WEIGHTS;
export const LABELS: Record<Comp, string> = { distribution_days: 'Distribution days', leading_stocks: 'Leading stock health', defensive_rotation: 'Defensive rotation', breadth_divergence: 'Breadth divergence', index_technical: 'Index technicals', sentiment: 'Sentiment & speculation' };
export const ZONES: [number, string, string, string][] = [
  [20, 'Green (Normal)', '100%', 'Normal position sizing and stops; new entries allowed.'],
  [40, 'Yellow (Early Warning)', '80-90%', 'Tighten stops 10-20%, cut new position sizes 25-50%, review the weakest positions.'],
  [60, 'Orange (Elevated Risk)', '60-75%', 'Take profits on the weakest 25-30%, no new momentum entries, raise cash.'],
  [80, 'Red (High Risk)', '40-55%', 'Aggressive profit-taking, hold only the strongest leaders, consider hedges.'],
  [Infinity, 'Critical (Very High Risk)', '20-35%', 'Keep only 20-35% invested, hedge, preserve capital; watch for a follow-through day.'],
];
export function composite(s: Record<Comp, number>, avail: Partial<Record<Comp, boolean>> = {}) {
  const adj = { ...s };
  if (s.distribution_days >= 80 && s.defensive_rotation >= 80) adj.defensive_rotation = s.defensive_rotation * 0.8;
  const keys = (Object.keys(WEIGHTS) as Comp[]).filter(k => avail[k] ?? true), tw = keys.reduce((a, k) => a + WEIGHTS[k], 0);
  const score = pyRoundN(keys.reduce((a, k) => a + adj[k] * (tw > 0 ? WEIGHTS[k] / tw : WEIGHTS[k]), 0), 1);
  const z = ZONES.find(x => score <= x[0])!;
  return { score, zone: z[1], budget: z[2], guidance: z[3], adj, available: keys.length };
}

const hist = (b: { time: number; open: number; high: number; close: number; volume: number }[], n: number): H[] => b.slice(-n).reverse().map(x => ({ date: new Date(x.time * 1000).toISOString().slice(0, 10), open: x.open, high: x.high, close: x.close, volume: x.volume }));
const quoteOf = (b: { high: number; close: number }[]): Q => ({ price: b.at(-1)?.close ?? 0, yearHigh: Math.max(0, ...b.slice(-252).map(x => x.high)) });
/** All six components and the composite, from the app's data (shared with exposure-coach). */
export async function topRisk(v: Record<string, unknown>, ctx: Ctx) {
    const get = (s: string, n = 260) => ctx.bars(`FX:${s}`, '1d').then(b => b.slice(-n), () => []);
    const [sp, nq, vix, vix3m, br] = await Promise.all([get('US500'), get('QQQ'), get('VIX', 5), get('VIX3M', 5), ctx.json<{ rows: Record<string, string>[] }>('/api/breadth').catch(() => ({ rows: [] }))]);
    if (!sp.length) throw new Error('S&P 500 history is unavailable');
    const pool = String(v.basket) === 'static' ? DEFAULT_LEADERS : POOL, raw: Record<string, Awaited<ReturnType<typeof get>>> = {};
    let i = 0; const syms = [...new Set([...pool, ...DEFENSIVE, ...OFFENSIVE.filter(s => s !== 'QQQ')])];
    await Promise.all(Array.from({ length: 6 }, async () => { while (i < syms.length) { const s = syms[i++]; raw[s] = await get(s) } }));
    const quotes: Record<string, Q> = Object.fromEntries(pool.filter(s => raw[s]?.length).map(s => [s, quoteOf(raw[s])]));
    const basket = String(v.basket) === 'static' ? [...DEFAULT_LEADERS] : dynamicBasket(quotes);
    const spH = hist(sp, 260), nqH = hist(nq, 260), spQ = quoteOf(sp);
    const sec: Record<string, H[]> = Object.fromEntries([...DEFENSIVE, ...OFFENSIVE].map(s => [s, s === 'QQQ' ? nqH.slice(0, 50) : hist(raw[s] ?? [], 50)]));
    const last = br.rows.at(-1), p200 = last ? pyRoundN(+last.Breadth_Index_Raw * 100, 2) : null, p50 = last && last.Breadth_50_Index_Raw ? pyRoundN(+last.Breadth_50_Index_Raw * 100, 2) : null;
    const vixPx = vix.at(-1)?.close ?? null, term = vixPx != null && vix3m.length ? termOf(vixPx, vix3m.at(-1)!.close) : null;
    const c1 = distribution(spH, nqH), c2 = leaders(quotes, Object.fromEntries(basket.map(s => [s, hist(raw[s] ?? [], 60)])), basket);
    const c3 = rotation(sec), dist = spQ.yearHigh > 0 ? (spQ.price - spQ.yearHigh) / spQ.yearHigh * 100 : 0, c4 = breadth(p200, p50, dist), c5 = technical(spH, nqH), c6 = sentiment(vixPx, optNum(v.putCall), term, optNum(v.margin));
    const scores = { distribution_days: c1.score, leading_stocks: c2.score, defensive_rotation: c3.score, breadth_divergence: c4.score, index_technical: c5.score, sentiment: c6.score };
    const avail = { distribution_days: true, leading_stocks: c2.available, defensive_rotation: c3.available, breadth_divergence: c4.available, index_technical: c5.available, sentiment: c6.available };
    return { r: composite(scores, avail), scores, avail, c1, c2, c3, c5, p200, dist, vixPx, term, basket };
}
const optNum = (v: unknown) => v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v);
export const marketTopSkill: Skill = {
  id: 'market-top-detector', name: 'Market top risk', group: 'Market regime', from: 'market-top-detector',
  desc: 'Heuristic 0–100 risk of a 10–20% correction in the next 2–8 weeks: distribution days, leading-ETF health, defensive rotation, breadth divergence, index technicals and sentiment, with a risk budget per zone. A risk score, not a probability.',
  inputs: [
    { key: 'putCall', label: 'CBOE equity put/call', type: 'number', optional: true, hint: '0.30–1.50, from the last 3 sessions' },
    { key: 'margin', label: 'Margin debt YoY %', type: 'number', optional: true },
    { key: 'basket', label: 'Leading basket', type: 'select', options: ['dynamic', 'static'], default: 'dynamic' },
  ],
  async run(v, ctx: Ctx) {
    const { r, scores, avail, c1, c2, c3, c5, p200, dist, vixPx, term, basket } = await topRisk(v, ctx), tone = r.score <= 20 ? 'up' : r.score <= 40 ? 'warn' : 'dn';
    return {
      verdict: { label: `${r.score} · ${r.zone}`, tone, detail: `Risk budget ${r.budget}. ${r.guidance}` },
      kpis: [{ label: 'Effective distribution days', value: c1.eff }, { label: 'Leaders deteriorating', value: `${c2.deteriorating}/${Object.keys(c2.det).length}` }, { label: 'Defensive − growth (20d)', value: pct(c3.rel) }, { label: '% above 200DMA', value: p200 == null ? '–' : `${p200}%` }, { label: 'S&P from 52w high', value: pct(dist) }, { label: 'VIX', value: vixPx == null ? '–' : `${vixPx.toFixed(2)}${term ? ` (${term})` : ''}` }],
      tables: [
        { title: 'Components', cols: ['Component', 'Weight', 'Score', 'Data'], rows: (Object.keys(WEIGHTS) as Comp[]).map(k => [LABELS[k], `${WEIGHTS[k] * 100}%`, r.adj[k] !== scores[k] ? `${scores[k]} → ${r.adj[k]}` : scores[k], avail[k] ? 'yes' : 'neutral 50, weight moved']) },
        { title: 'Leading ETFs', cols: ['ETF', 'Deterioration', 'From 52w high', 'Flags'], rows: Object.entries(c2.det).map(([s, d]) => [s, d.score, pct(d.dist, 1), d.flags.join(', ')]) },
        { title: 'Index technicals', cols: ['Index', 'Points', 'Flags'], rows: [['S&P 500', c5.sp.raw, c5.sp.flags.join(', ')], ['NASDAQ (QQQ)', c5.nq.raw, c5.nq.flags.join(', ')]] },
      ],
      notes: [`Leading basket: ${basket.join(', ')} (${String(v.basket) === 'static' ? 'static' : 'closest to 52-week highs'}). Defensive rotation: ${c3.confirmation}.`, 'Breadth from TraderMonty\'s public CSV; put/call is your input (leave empty to skip it). The follow-through-day check lives in its own skill.', 'A heuristic risk score, not a probability; risk budgets are policy, not measured outcomes. No order is placed.'],
    };
  },
};
