// ftd-detector: O'Neil's Follow-Through Day on the S&P 500 and the Nasdaq (QQQ): swing low after a ≥3% correction,
// rally attempt (Day 1 → day count), an FTD on Day 4–10 with ≥1.25% gain on higher volume, invalidation, post-FTD
// distribution, power trend and a 0–100 quality score with an exposure band. Daily bars from the app (Yahoo).
import { pct, type Ctx, type Skill } from './types.ts';

export interface D { date: string; high: number; low: number; close: number; volume: number }
type State = 'NO_SIGNAL' | 'CORRECTION' | 'RALLY_ATTEMPT' | 'FTD_WINDOW' | 'FTD_CONFIRMED' | 'RALLY_FAILED' | 'FTD_INVALIDATED';

function swingLow(h: D[], i: number) {
  const low = h[i].close;
  if (!(low > 0)) return null;
  let hi = 0, hiIdx = Math.max(0, i - 40);
  for (let j = Math.max(0, i - 40); j < i; j++) if (h[j].close > hi) { hi = h[j].close; hiIdx = j }
  if (!(hi > 0) || ((low - hi) / hi) * 100 > -3) return null;
  let down = 0;
  for (let j = hiIdx + 1; j <= i; j++) if (h[j - 1].close > 0 && h[j].close < h[j - 1].close) down++;
  if (down < 3) return null;
  if (i > 0 && h[i - 1].close > 0 && h[i - 1].close < low) return null;
  if (i + 1 < h.length && h[i + 1].close > 0 && h[i + 1].close < low) return null;
  return { idx: i, price: low, date: h[i].date, decline: ((low - hi) / hi) * 100 };
}
const swingLows = (h: D[], max = 6) => { const out: NonNullable<ReturnType<typeof swingLow>>[] = []; for (let i = h.length - 1; i > 3 && out.length < max; i--) { const s = swingLow(h, i); if (s) out.push(s) } return out };

export function trackRally(h: D[], sl: number) {
  const r = { day1: null as number | null, days: 0, rally: [] as { day: number; idx: number; change: number; volume: number }[], invalidated: false, why: '' };
  const slPrice = h[sl].close;
  if (sl >= h.length - 1) return r;
  let d1: number | null = null;
  for (let i = sl + 1; i < h.length; i++) {
    const c = h[i].close, p = h[i - 1].close;
    if (c < slPrice) { r.invalidated = true; r.why = `close below the swing low on ${h[i].date}`; return r }
    const range = h[i].high - h[i].low;
    if ((p > 0 && c > p) || (range > 0 && (c - h[i].low) / range >= 0.5)) { d1 = i; break }
  }
  if (d1 == null) return r;
  r.day1 = d1; const d1Low = h[d1].low;
  let n = 1;
  r.rally.push({ day: 1, idx: d1, change: 0, volume: h[d1].volume });
  for (let i = d1 + 1; i < h.length; i++) {
    const c = h[i].close, p = h[i - 1].close;
    if (c < slPrice) { r.invalidated = true; r.why = `close below the swing low on ${h[i].date}`; break }
    n++;
    if (n <= 3 && c < d1Low) { r.invalidated = true; r.why = `day ${n} closed below the Day 1 low on ${h[i].date}`; break }
    r.rally.push({ day: n, idx: i, change: p > 0 ? Math.round(((c - p) / p) * 10000) / 100 : 0, volume: h[i].volume });
  }
  r.days = n;
  return r;
}
export function detectFtd(h: D[], r: ReturnType<typeof trackRally>) {
  if (r.invalidated) return null;
  for (const d of r.rally) {
    if (d.day < 4 || d.day > 10 || d.change < 1.25) continue;
    const prev = d.idx > 0 ? h[d.idx - 1].volume : 0;
    if (prev <= 0 || d.volume <= prev) continue;
    const vs = h.slice(Math.max(0, d.idx - 50), d.idx).map(x => x.volume).filter(v => v > 0), avg = vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : 0;
    return { day: d.day, idx: d.idx, date: h[d.idx].date, gain: d.change, low: h[d.idx].low, volumeAboveAvg: avg > 0 ? d.volume > avg : null, tier: d.change >= 2 ? 'strong' : d.change >= 1.5 ? 'recommended' : 'minimum' };
  }
  return null;
}
export function analyzeIndex(history: D[]) {
  const out = { state: 'NO_SIGNAL' as State, ftd: null as ReturnType<typeof detectFtd>, rally: null as ReturnType<typeof trackRally> | null, swing: null as ReturnType<typeof swingLow>, depth: 0 };
  if (history.length < 10) return out;
  const w = history.slice(-60), hi = Math.max(...w.map(x => x.close));
  out.depth = ((w.at(-1)!.close - hi) / hi) * 100;
  const lows = swingLows(w);
  if (!lows.length) return out;
  out.swing = lows[0]; out.state = 'CORRECTION';
  const r = trackRally(w, lows[0].idx); out.rally = r;
  const broken = (f: NonNullable<ReturnType<typeof detectFtd>>) => w.slice(f.idx + 1).some(x => x.close < w[f.idx].low);
  if (r.invalidated) out.state = 'RALLY_FAILED';
  else if (r.day1 != null) {
    if (r.days < 4) out.state = 'RALLY_ATTEMPT';
    else {
      out.state = 'FTD_WINDOW';
      const f = detectFtd(w, r); out.ftd = f;
      if (f) out.state = broken(f) ? 'FTD_INVALIDATED' : 'FTD_CONFIRMED';
      else if (r.days > 10) out.state = 'RALLY_FAILED';
    }
  }
  if (out.state === 'FTD_CONFIRMED' || out.state === 'FTD_INVALIDATED') return out;
  const cur = out.state;
  for (const sl of lows.slice(1)) {   // an older swing low may still carry a live FTD
    const r2 = trackRally(w, sl.idx);
    if (r2.invalidated || r2.day1 == null || r2.days < 4) continue;
    const f = detectFtd(w, r2);
    if (!f) continue;
    if (!broken(f)) return { ...out, swing: sl, rally: r2, ftd: f, state: 'FTD_CONFIRMED' as State };
    return cur === 'RALLY_ATTEMPT' || cur === 'FTD_WINDOW' ? out : { ...out, swing: sl, rally: r2, ftd: f, state: 'FTD_INVALIDATED' as State };
  }
  return out;
}
const PRIORITY: State[] = ['FTD_WINDOW', 'RALLY_ATTEMPT', 'FTD_INVALIDATED', 'CORRECTION', 'RALLY_FAILED', 'NO_SIGNAL'];
export function marketState(sp: D[], nq: D[]) {
  const a = analyzeIndex(sp), b = analyzeIndex(nq), aOk = a.state === 'FTD_CONFIRMED', bOk = b.state === 'FTD_CONFIRMED';
  const combined: State = aOk || bOk ? 'FTD_CONFIRMED' : PRIORITY.find(s => a.state === s || b.state === s) ?? 'NO_SIGNAL';
  return { combined, dual: aOk && bOk, sp500: a, nasdaq: b };
}
const ema = (p: number[], n: number) => { if (p.length < n) return p.length ? p.reduce((a, b) => a + b, 0) / p.length : 0; let e = p.slice(0, n).reduce((a, b) => a + b, 0) / n; const k = 2 / (n + 1); for (const x of p.slice(n)) e = x * k + e * (1 - k); return e };
export function powerTrend(h: D[]) {
  if (h.length < 50) return null;
  const c = h.map(x => x.close), e21 = ema(c, 21), s50 = c.slice(-50).reduce((a, b) => a + b, 0) / 50, rising = c.length >= 55 ? s50 > c.slice(-55, -5).reduce((a, b) => a + b, 0) / 50 : null;
  return { on: e21 > s50 && rising === true && c.at(-1)! > e21, met: [e21 > s50, rising === true, c.at(-1)! > e21].filter(Boolean).length };
}
/** Post-FTD health and the 0–100 quality score (the original's points), on the full chronological history. */
export function quality(m: ReturnType<typeof marketState>, sp: D[], nq: D[]) {
  const src = m.sp500.ftd ? { f: m.sp500.ftd, h: sp } : m.nasdaq.ftd ? { f: m.nasdaq.ftd, h: nq } : null;
  if (!src) return { score: 0, exposure: '0–25%', lines: ['No follow-through day'], invalidated: false };
  const f = src.f, idx = src.h.findIndex(x => x.date === f.date), lines: string[] = [];
  let s = f.day <= 7 ? 60 : f.day <= 10 ? 50 : 40; lines.push(`Day ${f.day} FTD: +${s}`);
  const g = f.gain >= 2 ? 15 : f.gain >= 1.5 ? 10 : f.gain >= 1.25 ? 5 : 0; s += g; lines.push(`${f.gain.toFixed(2)}% gain: +${g}`);
  if (f.volumeAboveAvg) { s += 10; lines.push('Volume above the 50-day average: +10') }
  if (m.dual) { s += 15; lines.push('Both indexes confirmed: +15') }
  let invalidated = false;
  if (idx >= 0) {
    const dist: number[] = [];
    for (let i = idx + 1; i < Math.min(idx + 6, src.h.length); i++) { const c = src.h[i], p = src.h[i - 1]; if (p.close > 0 && p.volume > 0 && ((c.close - p.close) / p.close) * 100 <= -0.2 && c.volume > p.volume) dist.push(i - idx) }
    const monitored = Math.max(0, Math.min(idx + 6, src.h.length) - idx - 1);
    let adj = monitored === 0 ? 0 : !dist.length ? 10 : dist[0] <= 2 ? -30 : dist[0] === 3 ? -15 : -5;
    if (dist.length >= 2) adj -= 20;
    s += adj; lines.push(`Post-FTD (${monitored} days, ${dist.length} distribution): ${adj >= 0 ? '+' : ''}${adj}`);
    invalidated = src.h.slice(idx + 1).some(x => x.close < src.h[idx].low);
  }
  s = Math.max(0, Math.min(100, s));
  return { score: s, exposure: s >= 80 ? '75–100%' : s >= 60 ? '50–75%' : s >= 40 ? '25–50%' : '0–25%', lines, invalidated };
}

const toD = (b: { time: number; high: number; low: number; close: number; volume: number }[]): D[] => b.map(x => ({ date: new Date(x.time * 1000).toISOString().slice(0, 10), high: x.high, low: x.low, close: x.close, volume: x.volume }));
export const ftdSkill: Skill = {
  id: 'ftd-detector', name: 'Follow-through day (market bottom)', group: 'Market regime', from: 'ftd-detector',
  desc: 'O\'Neil\'s follow-through day on the S&P 500 and the Nasdaq: correction → rally attempt → FTD on Day 4–10 (≥1.25% on higher volume), invalidation and post-FTD distribution, with a 0–100 quality score and an exposure band.',
  inputs: [{ key: 'sp', label: 'S&P 500 symbol', type: 'symbol', default: 'FX:US500' }, { key: 'nq', label: 'Nasdaq symbol', type: 'symbol', default: 'FX:QQQ' }],
  async run(v, ctx: Ctx) {
    const [sp, nq] = await Promise.all([ctx.bars(String(v.sp || 'FX:US500'), '1d'), ctx.bars(String(v.nq || 'FX:QQQ'), '1d')]).then(x => x.map(b => toD(b.slice(-80))));
    const m = marketState(sp, nq), q = quality(m, sp, nq), state = q.invalidated ? 'FTD_INVALIDATED' : m.combined, pt = powerTrend(sp);
    const row = (n: string, a: ReturnType<typeof analyzeIndex>) => [n, a.state.replace(/_/g, ' '), pct(a.depth, 1), a.swing ? `${a.swing.date} (${a.swing.decline.toFixed(1)}%)` : '–', a.rally?.day1 != null ? a.rally.days : '–', a.ftd ? `${a.ftd.date} day ${a.ftd.day} +${a.ftd.gain}%` : '–'];
    return {
      verdict: { label: state.replace(/_/g, ' '), tone: state === 'FTD_CONFIRMED' ? 'up' : state === 'RALLY_ATTEMPT' || state === 'FTD_WINDOW' ? 'warn' : 'dn', detail: `quality ${q.score}/100, exposure ${q.exposure}${m.dual ? ' · both indexes' : ''}` },
      kpis: [{ label: 'Power trend', value: pt ? (pt.on ? 'on' : `${pt.met}/3`) : '–' }],
      tables: [{ title: 'Indexes', cols: ['Index', 'State', 'Off the 60-day high', 'Swing low', 'Rally day', 'FTD'], rows: [row('S&P 500', m.sp500), row('Nasdaq', m.nasdaq)] }, { title: 'Quality score', cols: ['Points'], rows: q.lines.map(x => [x]) }],
    };
  },
};
