// vcp-screener: Minervini Volatility Contraction Patterns. Stage-2 trend template, relative strength vs the S&P 500
// (ranked across the candidates), ATR zigzag contractions that tighten (T1 ≥ 10%, each ≤ 0.70× the last), volume
// dry-up, pivot distance and an execution state that caps the rating — the original's rules, histories newest first.
import { pyRound, pyRoundN, type Ctx, type Skill } from './types.ts';

export interface H { date: string; open?: number; high: number; low: number; close: number; volume: number }
export interface Quote { price: number; yearHigh: number; yearLow: number; avgVolume?: number }
const sma = (p: number[], n: number) => (p.length < n ? null : p.slice(0, n).reduce((a, b) => a + b, 0) / n);
const r2 = (x: number) => pyRoundN(x, 2);

// ---- trend template (7 criteria × 14.3) ----
export function trendTemplate(h: H[], q: Quote, rsRank: number | null, ext = 8, maxExt = 50) {
  if (h.length < 50) return { score: 0, raw: 0, passed: false, sma50: null as number | null, sma200: null as number | null, met: 0 };
  const c = h.map(x => x.close), p = q.price, s150 = sma(c, 150), s200 = sma(c, 200), s50 = sma(c, 50);
  const crit = [
    s150 != null && s200 != null ? p > s150 && p > s200 : s150 != null ? p > s150 : false,
    s150 != null && s200 != null ? s150 > s200 : false,
    c.length >= 222 && s200 != null ? (() => { const o = sma(c.slice(22), 200); return o != null && s200 > o })() : false,
    s50 != null ? p > s50 : false,
    q.yearLow > 0 ? (p - q.yearLow) / q.yearLow * 100 >= 25 : false,
    q.yearHigh > 0 ? (q.yearHigh - p) / q.yearHigh * 100 <= 25 : false,
    rsRank != null ? rsRank > 70 : false,
  ];
  const met = crit.filter(Boolean).length, raw = Math.min(100, pyRoundN(met * 14.3, 1));
  let pen = 0;
  if (s50 != null && s50 > 0) { const d = (p - s50) / s50 * 100; if (d >= ext) { const e = d - ext; pen = e >= 17 ? -20 : e >= 10 ? -15 : e >= 4 ? -10 : -5 } }
  void maxExt;
  return { score: Math.max(0, raw + pen), raw, passed: raw >= 85, sma50: s50 != null ? r2(s50) : null, sma200: s200 != null ? r2(s200) : null, met };
}

// ---- relative strength ----
const ret = (c: number[], n: number) => (c.length <= n || c[n] <= 0 ? 0 : (c[0] - c[n]) / c[n] * 100);
export function relativeStrength(h: H[], spx: H[]) {
  if (h.length < 63 || spx.length < 63) return { score: 0, rank: 0, weighted: null as number | null };
  const a = h.map(x => x.close), b = spx.map(x => x.close); let w = 0, tw = 0;
  for (const [n, wt] of [[63, 0.4], [126, 0.2], [189, 0.2], [252, 0.2]]) {
    if (a.length > n && b.length > n) { w += (ret(a, n) - ret(b, n)) * wt; tw += wt }
    else if (a.length > Math.floor(n / 2) && b.length > Math.floor(n / 2)) { const k = Math.min(a.length - 1, b.length - 1); w += (ret(a, k) - ret(b, k)) * wt * 0.5; tw += wt * 0.5 }
  }
  if (tw <= 0) return { score: 0, rank: 0, weighted: null };
  const x = w / tw, [score, rank] = x >= 50 ? [100, 99] : x >= 30 ? [95, 95] : x >= 20 ? [90, 90] : x >= 10 ? [80, 80] : x >= 5 ? [70, 70] : x >= 0 ? [60, 60] : x >= -5 ? [50, 50] : x >= -10 ? [40, 40] : x >= -20 ? [20, 25] : [0, 10];
  return { score, rank, weighted: r2(x) };
}
const pctScore = (p: number) => p >= 95 ? 100 : p >= 85 ? 90 : p >= 75 ? 80 : p >= 60 ? 70 : p >= 45 ? 60 : p >= 30 ? 50 : p >= 15 ? 40 : 20;
/** Percentile of weighted RS across the screened stocks; small populations are capped. */
export function rankRS(w: Record<string, number | null>) {
  const out: Record<string, { pct: number; score: number }> = {}, valid = Object.keys(w).filter(s => w[s] != null).sort((a, b) => w[a]! - w[b]!), n = valid.length;
  for (const s of Object.keys(w)) if (w[s] == null) out[s] = { pct: 0, score: 0 };
  const cap = n >= 20 ? 100 : n >= 10 ? 94 : n >= 5 ? 84 : 74;
  for (let i = 0; i < n;) { let j = i + 1; while (j < n && w[valid[j]] === w[valid[i]]) j++; const p = Math.min(pyRound(j / n * 100), cap); for (let k = i; k < j; k++) out[valid[k]] = { pct: p, score: pctScore(p) }; i = j }
  return out;
}

// ---- contractions ----
export interface Contraction { label: string; hi: number; high: number; highDate: string; li: number; low: number; lowDate: string; depth: number; days: number }
function atr(hi: number[], lo: number[], c: number[], n: number) {
  if (hi.length < n + 1) return 0;
  const tr: number[] = []; for (let i = 1; i < hi.length; i++) tr.push(Math.max(hi[i] - lo[i], Math.abs(hi[i] - c[i - 1]), Math.abs(lo[i] - c[i - 1])));
  return tr.length < n ? 0 : tr.slice(-n).reduce((a, b) => a + b, 0) / n;
}
function zigzag(hi: number[], lo: number[], c: number[], mult: number, n = 14): [[number, number][], [number, number][]] {
  if (hi.length < n + 1) return [[], []];
  const a = atr(hi, lo, c, n); if (a <= 0) return [[], []];
  const th = a * mult, sh: [number, number][] = [], sl: [number, number][] = [];
  let ei = 0, ev = hi[0];
  for (let i = 0; i < Math.min(n, hi.length); i++) if (hi[i] > ev) { ev = hi[i]; ei = i }
  let dir = 1; ev = hi[ei];
  for (let i = ei + 1; i < hi.length; i++) {
    if (dir === 1) { if (hi[i] > ev) { ev = hi[i]; ei = i } else if (ev - lo[i] >= th) { sh.push([ei, ev]); dir = -1; ev = lo[i]; ei = i } }
    else if (lo[i] < ev) { ev = lo[i]; ei = i } else if (hi[i] - ev >= th) { sl.push([ei, ev]); dir = 1; ev = hi[i]; ei = i }
  }
  return [sh, sl];
}
function swings(v: number[], w: number, high: boolean): [number, number][] {
  const o: [number, number][] = [];
  for (let i = w; i < v.length - w; i++) { let ok = true; for (let j = 1; j <= w; j++) if (high ? v[i] <= v[i - j] || v[i] <= v[i + j] : v[i] >= v[i - j] || v[i] >= v[i + j]) { ok = false; break } if (ok) o.push([i, v[i]]) }
  return o;
}
function build(start: [number, number], sh: [number, number][], sl: [number, number][], dates: string[], minDays: number): Contraction[] {
  const [h1i, h1v] = start, out: Contraction[] = []; let ci = h1i, cv = h1v;
  for (let k = 0; k < 4; k++) {
    let nl = sl.find(x => x[0] > ci); if (!nl) break;
    let [li, lv] = nl, dur = li - ci;
    if (dur < minDays) {
      const bound = sh.find(x => x[0] > ci)?.[0]; let found = false;
      for (const [idx, val] of sl) if (idx > ci && idx - ci >= minDays) { if (bound != null && idx > bound) break; nl = [idx, val]; [li, lv] = nl; dur = li - ci; found = true; break }
      if (!found) break;
    }
    const depth = cv > 0 ? (cv - lv) / cv * 100 : 0;
    if (out.length && Math.abs(cv - h1v) / h1v * 100 > 5) break;
    out.push({ label: `T${out.length + 1}`, hi: ci, high: r2(cv), highDate: dates[ci] ?? 'N/A', li, low: r2(lv), lowDate: dates[li] ?? 'N/A', depth: r2(depth), days: dur });
    const nh = sh.find(x => x[0] > li); if (!nh) break;
    [ci, cv] = nh;
  }
  return out;
}
function validate(c: Contraction[], minN: number, t1Min: number, ratio: number) {
  if (c.length < minN) return { valid: false, ratios: [] as number[], t1: 0, issues: [`need ${minN} contractions`] };
  const issues: string[] = []; let valid = true; const t1 = c[0].depth, ratios: number[] = [];
  if (t1 < t1Min) { valid = false; issues.push(`T1 ${t1.toFixed(1)}% < ${t1Min}%`) } else if (t1 > 35) issues.push(`T1 ${t1.toFixed(1)}% deep`);
  for (let i = 1; i < c.length; i++) if (c[i - 1].depth > 0) { const r = c[i].depth / c[i - 1].depth; ratios.push(r); if (r > ratio) { valid = false; issues.push(`${c[i].label} ratio ${r.toFixed(2)} > ${ratio}`) } }
  const d = c.at(-1)!.li - c[0].hi; if (d < 15) { valid = false; issues.push(`pattern ${d} days < 15`) }
  return { valid, ratios: ratios.map(r => pyRoundN(r, 3)), t1, issues };
}
function scoreVcp(c: Contraction[], v: ReturnType<typeof validate>) {
  if (!v.valid) return Math.min(40, c.length * 15);
  const n = c.length; if (n < 2) return 20;
  let s = n >= 4 ? 90 : n >= 3 ? 80 : 60;
  if (c.at(-1)!.depth < 5) s += 10;
  if (v.ratios.length && v.ratios.reduce((a, b) => a + b, 0) / v.ratios.length < 0.4) s += 10;
  if (v.t1 > 30) s -= 10;
  return Math.max(0, Math.min(100, s));
}
export function vcpPattern(h: H[], { lookback = 120, mult = 1.5, minDays = 5, minN = 2, t1Min = 10, ratio = 0.7, loose = 15 } = {}) {
  const empty = { score: 0, valid: false, contractions: [] as Contraction[], pivot: null as number | null, wideLoose: false };
  if (h.length < 30) return empty;
  const p = h.slice(0, lookback).reverse(); if (p.length < 30) return empty;
  const hi = p.map(x => x.high), lo = p.map(x => x.low), c = p.map(x => x.close), dates = p.map(x => x.date);
  let [sh, sl] = zigzag(hi, lo, c, mult);
  if (!(sh.length >= 1 && sl.length >= 1)) { sh = swings(hi, 5, true); sl = swings(lo, 5, false) }
  if (!sh.length || !sl.length) return empty;
  let best: Contraction[] = [], bs = -1, bv = false;
  for (const st of [...sh].sort((a, b) => b[1] - a[1]).slice(0, 3)) {   // stable sort, like Python
    const cand = build(st, sh, sl, dates, minDays);
    let v = false, s = 0;
    if (cand.length >= minN) { const val = validate(cand, minN, t1Min, ratio); v = val.valid; s = scoreVcp(cand, val) }
    const key = [+v, s, cand.length], bk = [+bv, bs, best.length];
    if (key[0] > bk[0] || (key[0] === bk[0] && (key[1] > bk[1] || (key[1] === bk[1] && key[2] > bk[2])))) { best = cand; bs = s; bv = v }
  }
  const pivot = best.length ? best.at(-1)!.high : sh.length ? sh.at(-1)![1] : null;
  if (best.length < minN) return { ...empty, contractions: best, pivot };
  const val = validate(best, minN, t1Min, ratio), f = best.at(-1)!;
  return { score: scoreVcp(best, val), valid: val.valid, contractions: best, pivot: pivot != null ? r2(pivot) : null, wideLoose: f.depth > loose && f.days < 10, issues: val.issues };
}

// ---- volume ----
export function volumePattern(h: H[], pivot: number | null, cs: Contraction[] | null, bo = 1.5) {
  if (h.length < 20) return { score: 0, dryUp: null as number | null, breakout: false };
  const v = h.map(x => x.volume), c = h.map(x => x.close), n = v.length, vp = Math.min(50, n), avg = v.slice(0, vp).reduce((a, b) => a + b, 0) / vp;
  if (avg <= 0) return { score: 0, dryUp: null, breakout: false };
  const iavg = (a: number[]) => (a.length ? Math.trunc(a.reduce((x, y) => x + y, 0) / a.length) : 0), zone = (x: Contraction) => { const a = n - 1 - x.li, b = n - 1 - x.hi; return v.slice(Math.max(0, Math.min(a, b)), Math.min(n, Math.max(a, b) + 1)) };
  let recent: number, declining = false;
  const zb = cs && cs.length ? iavg(v.slice(1, Math.min(11, n))) : 0;
  if (cs && cs.length && zb) recent = zb; else { const l = n > 1 ? v.slice(1, 11) : []; recent = l.length ? l.reduce((a, b) => a + b, 0) / l.length : 0 }
  if (cs && cs.length >= 2) { const avgs = cs.map(zone).filter(z => z.length).map(iavg); declining = avgs.length >= 2 && avgs.every((x, i) => i === avgs.length - 1 || x > avgs[i + 1]) }
  const dry = recent / avg;
  let s = dry < 0.3 ? 90 : dry < 0.5 ? 75 : dry < 0.7 ? 60 : dry <= 1 ? 40 : 20, breakout = false;
  if (pivot && c[0] > pivot && v[0] / avg >= bo) { breakout = true; s += 10 }
  let up = 0, dn = 0;
  for (let i = 0; i < Math.min(20, c.length - 1); i++) if (i + 1 < c.length && v[i] > avg) { if (c[i] > c[i + 1]) up++; else if (c[i] < c[i + 1]) dn++ }
  if (up - dn > 3) s += 10; else if (up - dn < -3) s -= 10;
  if (declining) s += 10;
  return { score: Math.max(0, Math.min(100, s)), dryUp: pyRoundN(dry, 3), breakout };
}

// ---- pivot, execution state, rating ----
export function pivotProximity(price: number, pivot: number | null, lastLow: number | null, breakout: boolean) {
  if (!pivot || pivot <= 0 || price <= 0) return { score: 0, dist: null as number | null, stop: null as number | null, risk: null as number | null, status: 'NO PIVOT' };
  const d = (price - pivot) / pivot * 100;
  let [s, st]: [number, string] = d > 20 ? [20, 'OVEREXTENDED - Do not chase'] : d > 10 ? [35, 'EXTENDED - Very high chase risk'] : d > 5 ? [50, 'EXTENDED - High chase risk'] : d > 3 ? [65, 'EXTENDED - Moderate chase risk'] : d > 0 ? [90, 'ABOVE PIVOT (within 3%)'] : d >= -2 ? [90, 'AT PIVOT (within 2%)'] : d >= -5 ? [75, 'NEAR PIVOT (2-5% below)'] : d >= -8 ? [60, 'APPROACHING (5-8% below)'] : d >= -10 ? [45, 'DEVELOPING (8-10% below)'] : d >= -15 ? [30, 'EARLY (10-15% below)'] : [10, 'FAR FROM PIVOT (>15% below)'];
  if (breakout && d > 0) { if (d <= 3) { s += 10; st = 'BREAKOUT CONFIRMED' } else if (d <= 5) { s += 10; st += ' (vol confirmed)' } }
  let stop: number | null = null, risk: number | null = null;
  if (lastLow && lastLow > 0) { stop = r2(lastLow * 0.99); if (price > stop) risk = r2((price - stop) / price * 100); else { st = 'BELOW STOP LEVEL'; s = 0 } }
  return { score: s, dist: r2(d), stop, risk, status: st };
}
export function executionState(dist: number | null, price: number, s50: number | null, s200: number | null, s200d: number | null, lastLow: number | null, breakout: boolean, maxExt = 50) {
  if (s50 != null && s200 != null && price < s50 && s50 < s200) return 'Invalid';
  if (lastLow != null && lastLow > 0 && price < lastLow) return 'Damaged';
  if (s50 != null && price < s50) return 'Damaged';
  if (s200d != null && s200d > maxExt) return 'Overextended';
  if (dist == null) return 'Pre-breakout';
  return dist > 10 ? 'Overextended' : dist > 5 ? 'Extended' : dist > 3 ? 'Early-post-breakout' : dist >= 0 ? (breakout ? 'Breakout' : 'Early-post-breakout') : 'Pre-breakout';
}
const RATINGS = ['No VCP', 'Weak VCP', 'Developing VCP', 'Good VCP', 'Strong VCP', 'Textbook VCP'];
const CAP: Record<string, string | null> = { Invalid: 'No VCP', Damaged: 'No VCP', Overextended: 'Weak VCP', Extended: 'Developing VCP', 'Early-post-breakout': 'Strong VCP', Breakout: null, 'Pre-breakout': null };
export const W = { trend: 0.25, contraction: 0.25, volume: 0.2, pivot: 0.15, rs: 0.15 };
export function composite(s: Record<keyof typeof W, number>, valid: boolean, state: string | null, wideLoose: boolean) {
  const score = pyRoundN((Object.keys(W) as (keyof typeof W)[]).reduce((a, k) => a + s[k] * W[k], 0), 1);
  let rating = score >= 90 ? 'Textbook VCP' : score >= 80 ? 'Strong VCP' : score >= 70 ? 'Good VCP' : score >= 60 ? 'Developing VCP' : score >= 50 ? 'Weak VCP' : 'No VCP';
  if (!valid && score >= 70) rating = 'Developing VCP';
  const max = state != null ? CAP[state] : null;
  if (max && RATINGS.indexOf(rating) > RATINGS.indexOf(max)) rating = max;
  if (wideLoose && ['Textbook VCP', 'Strong VCP', 'Good VCP'].includes(rating)) rating = 'Developing VCP';
  return { score, rating };
}
export function patternType(valid: boolean, n: number, finalDepth: number | null, state: string, dry: number | null, wideLoose: boolean) {
  if (state === 'Invalid' || state === 'Damaged') return 'Damaged';
  if (state === 'Overextended' || state === 'Extended') return valid ? 'Extended Leader' : 'VCP-adjacent';
  if (state === 'Early-post-breakout' || state === 'Breakout') return valid ? 'Post-breakout' : 'VCP-adjacent';
  if (!valid || wideLoose) return 'VCP-adjacent';
  return n >= 3 && (finalDepth == null || finalDepth <= 10) && dry != null && dry <= 0.7 && state === 'Pre-breakout' ? 'Textbook VCP' : 'VCP-adjacent';
}
export function analyze(h: H[], q: Quote, spx: H[], lookback = 120) {
  const rs = relativeStrength(h, spx), tt = trendTemplate(h, q, rs.rank), v = vcpPattern(h, { lookback }), vol = volumePattern(h.slice(0, lookback), v.pivot, v.contractions, 1.5);
  const last = v.contractions.at(-1)?.low ?? null, pv = pivotProximity(q.price, v.pivot, last, vol.breakout), s200d = tt.sma200 && tt.sma200 > 0 ? (q.price - tt.sma200) / tt.sma200 * 100 : null;
  const state = executionState(pv.dist, q.price, tt.sma50, tt.sma200, s200d, last, vol.breakout), type = patternType(v.valid, v.contractions.length, v.contractions.at(-1)?.depth ?? null, state, vol.dryUp, v.wideLoose);
  return { rs, tt, v, vol, pv, state, type, scores: { trend: tt.score, contraction: v.score, volume: vol.score, pivot: pv.score, rs: rs.score } };
}
export function entryReady(a: ReturnType<typeof analyze>, maxAbove = 3, maxRisk = 15) {
  if (['Invalid', 'Damaged', 'Overextended', 'Extended', 'Early-post-breakout'].includes(a.state) || !a.v.valid || a.pv.dist == null) return false;
  if (!(a.pv.dist >= -8 && a.pv.dist <= maxAbove) || a.vol.dryUp == null || a.vol.dryUp > 1 || a.pv.status === 'BELOW STOP LEVEL') return false;
  return a.pv.risk != null && a.pv.risk > 0 && a.pv.risk <= maxRisk;
}
export function preFilter(q: Quote) {
  const av = q.avgVolume ?? 0;
  if (q.price <= 10 || av < 200000 || q.yearLow <= 0 || q.yearHigh <= 0) return null;
  const up = (q.price - q.yearLow) / q.yearLow, dn = (q.yearHigh - q.price) / q.yearHigh;
  return up < 0.2 || dn > 0.3 ? null : Math.min(up, 1) * 50 + (1 - dn) * 50;
}
export const stale = (h: H[], th = 1) => { if (h.length < 10) return false; const r = h.slice(0, 10).filter(b => b.close > 0).map(b => (b.high - b.low) / b.close * 100); return r.length > 0 && r.reduce((a, b) => a + b, 0) / r.length < th };

export const toH = (b: { time: number; open: number; high: number; low: number; close: number; volume: number }[], n = 260): H[] => b.slice(-n).reverse().map(x => ({ date: new Date(x.time * 1000).toISOString().slice(0, 10), open: x.open, high: x.high, low: x.low, close: x.close, volume: x.volume }));
export const quoteOf = (b: { high: number; low: number; close: number; volume: number }[]): Quote => { const y = b.slice(-252); return { price: b.at(-1)?.close ?? 0, yearHigh: Math.max(0, ...y.map(x => x.high)), yearLow: Math.min(...y.map(x => x.low)), avgVolume: b.slice(-63).reduce((a, x) => a + x.volume, 0) / Math.max(1, Math.min(63, b.length)) } };
/** Fetch daily bars for many US stocks, `n` at a time; failures are skipped. */
export async function barsMany(ctx: Ctx, syms: string[], n = 6) {
  const out = new Map<string, Awaited<ReturnType<Ctx['bars']>>>(); let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < syms.length) { const s = syms[i++]; try { const b = await ctx.bars(`FX:${s}`, '1d'); if (b.length) out.set(s, b) } catch { /* skipped */ } } }));
  return out;
}
export interface Stock { sym: string; name: string; sector: string; industry: string; cap: number; price: number; volume: number; chg: number; country?: string }

export const vcpSkill: Skill = {
  id: 'vcp-screener', name: 'VCP screener', group: 'Screeners', from: 'vcp-screener',
  desc: 'Minervini Volatility Contraction Patterns in the largest US stocks: Stage-2 trend template, relative strength, tightening contractions, volume dry-up and pivot distance, rated Textbook → No VCP and capped by execution state. Entry-ready = valid VCP within −8%…+3% of the pivot with ≤ 15% risk.',
  inputs: [
    { key: 'universe', label: 'Universe (largest US stocks)', type: 'number', default: 300, hint: 'S&P 500 ≈ 500' },
    { key: 'symbols', label: 'Or these symbols', type: 'symbols', optional: true, default: '' },
    { key: 'mode', label: 'Show', type: 'select', options: ['all', 'entry-ready only'], default: 'all' },
  ],
  async run(v, ctx: Ctx) {
    const custom = String(v.symbols ?? '').toUpperCase().split(/[\s,]+/).filter(Boolean);
    const all = custom.length ? null : await ctx.json<Stock[]>('/api/us-stocks');
    const names = new Map((all ?? []).map(s => [s.sym, s]));
    const syms = custom.length ? custom : all!.filter(s => s.price > 10).slice(0, Math.min(800, Math.max(20, Number(v.universe) || 300))).map(s => s.sym);
    const [spxB, bars] = await Promise.all([ctx.bars('FX:SPY', '1d'), barsMany(ctx, syms)]);
    const spx = toH(spxB), pre = [...bars].map(([s, b]) => ({ s, b, q: quoteOf(b) })).map(x => ({ ...x, f: preFilter(x.q) })).filter(x => x.f != null).sort((a, b) => b.f! - a.f!).slice(0, 100);
    const res = pre.map(x => ({ ...x, h: toH(x.b) })).filter(x => x.h.length >= 50 && trendTemplate(x.h, x.q, relativeStrength(x.h, spx).rank).raw >= 85 && !stale(x.h)).map(x => ({ s: x.s, q: x.q, a: analyze(x.h, x.q, spx) }));
    const rk = rankRS(Object.fromEntries(res.map(r => [r.s, r.a.rs.weighted])));
    const rows = res.map(r => { r.a.scores.rs = rk[r.s].score; const c = composite(r.a.scores, r.a.v.valid, r.a.state, r.a.v.wideLoose); return { ...r, c, ready: entryReady(r.a) } }).sort((a, b) => b.c.score - a.c.score);
    const shown = String(v.mode).startsWith('entry') ? rows.filter(r => r.ready) : rows, count = (k: string) => rows.filter(r => r.c.rating === k).length;
    return {
      verdict: { label: `${rows.filter(r => r.ready).length} entry-ready · ${rows.length} in Stage 2`, tone: rows.some(r => r.ready) ? 'up' : 'muted', detail: `${bars.size} stocks read, ${pre.length} passed the price/52-week pre-filter.` },
      kpis: ['Textbook VCP', 'Strong VCP', 'Good VCP', 'Developing VCP'].map(k => ({ label: k, value: count(k) })),
      tables: [{ title: 'Candidates', cols: ['Symbol', 'Name', 'Score', 'Rating', 'State', 'Pattern', 'Contractions', 'Pivot', 'From pivot', 'Stop', 'Risk', 'Dry-up', 'RS pct', 'Entry'], rows: shown.slice(0, 60).map(r => [r.s, names.get(r.s)?.name ?? '', r.c.score, r.c.rating, r.a.state, r.a.type, r.a.v.contractions.map(x => `${x.depth.toFixed(1)}%`).join(' → ') || '–', r.a.v.pivot ?? '–', r.a.pv.dist == null ? '–' : `${r.a.pv.dist}%`, r.a.pv.stop ?? '–', r.a.pv.risk == null ? '–' : `${r.a.pv.risk}%`, r.a.vol.dryUp ?? '–', rk[r.s].pct, r.ready ? 'ready' : '']) }],
      notes: ['Universe: largest US stocks by market cap from Nasdaq\'s public list (or your symbols); 52-week range and average volume (63 days) come from daily bars. Stop = last contraction low − 1%.', 'Screening only: no order is placed.'],
    };
  },
};
