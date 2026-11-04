// Market data computed from prices, no DOM (ROADMAP phase 9): Technical Ratings (26 indicators vote, TradingView's
// published rules, simplified where noted), Seasonals (monthly returns per year), Market Movers, and a squarified
// treemap layout for the heatmap.
import type { Bar } from '../data.ts';
import { ema, highest, lowest, macd, rma, rsi, sma, stoch, type Series } from '../indicators.ts';

type Vote = 1 | 0 | -1;
export interface Rating { all: number; ma: number; osc: number; label: string; votes: { name: string; group: 'ma' | 'osc'; value: number | null; vote: Vote }[] }

const last = (s: Series, k = 0) => s[s.length - 1 - k] ?? null;
const wma = (v: Series, n: number): Series => v.map((_, i) => {
  if (i < n - 1) return null;
  let s = 0, w = 0;
  for (let j = 0; j < n; j++) { const x = v[i - j]; if (x == null) return null; s += x * (n - j); w += n - j }
  return s / w;
});
const hma = (v: Series, n: number) => { const a = wma(v, Math.round(n / 2)), b = wma(v, n); return wma(v.map((_, i) => (a[i] == null || b[i] == null ? null : 2 * a[i]! - b[i]!)), Math.round(Math.sqrt(n))) };
const vwma = (b: Bar[], n: number) => { const pv = sma(b.map(x => x.close * x.volume), n), vv = sma(b.map(x => x.volume), n); return pv.map((x, i) => (x == null || !vv[i] ? null : x / vv[i]!)) };
const mid = (b: Bar[], n: number) => { const h = highest(b.map(x => x.high), n), l = lowest(b.map(x => x.low), n); return h.map((x, i) => (x == null || l[i] == null ? null : (x + l[i]!) / 2)) };

const ratingLabel = (v: number) => (v > 0.5 ? 'Strong buy' : v > 0.1 ? 'Buy' : v < -0.5 ? 'Strong sell' : v < -0.1 ? 'Sell' : 'Neutral');

/** Needs ~200 bars for every vote; missing indicators (too little history) don't vote. */
export function technicalRating(b: Bar[]): Rating {
  const c = b.map(x => x.close), px = c.at(-1) ?? NaN, votes: Rating['votes'] = [];
  const add = (name: string, group: 'ma' | 'osc', value: number | null, vote: Vote | null) => { if (value != null && vote != null && Number.isFinite(value)) votes.push({ name, group, value, vote }) };
  const maVote = (v: number | null): Vote | null => (v == null ? null : px > v ? 1 : px < v ? -1 : 0);
  for (const n of [10, 20, 30, 50, 100, 200]) { const s = last(sma(c, n)), e = last(ema(c, n)); add(`SMA ${n}`, 'ma', s, maVote(s)); add(`EMA ${n}`, 'ma', e, maVote(e)) }
  const kijun = last(mid(b, 26)); add('Ichimoku base line (26)', 'ma', kijun, maVote(kijun));
  const vw = last(vwma(b, 20)); add('VWMA 20', 'ma', vw, maVote(vw));
  const hm = last(hma(c, 9)); add('Hull MA 9', 'ma', hm, maVote(hm));

  const rising = (s: Series) => { const a = last(s), z = last(s, 1); return a == null || z == null ? null : a > z ? 1 : a < z ? -1 : 0 };
  const r = rsi(c, 14), rv = last(r), rr = rising(r);
  add('RSI (14)', 'osc', rv, rv == null || rr == null ? null : rv < 30 && rr > 0 ? 1 : rv > 70 && rr < 0 ? -1 : 0);
  const st = stoch(b, 14, 3), k = sma(st['%K'], 3), d = sma(k, 3), kv = last(k), dv = last(d);
  add('Stochastic %K (14, 3, 3)', 'osc', kv, kv == null || dv == null ? null : kv < 20 && dv < 20 && kv > dv ? 1 : kv > 80 && dv > 80 && kv < dv ? -1 : 0);
  const tp = b.map(x => (x.high + x.low + x.close) / 3), tpm = sma(tp, 20);
  const cci = tp.map((x, i) => { const m = tpm[i]; if (m == null) return null; let md = 0; for (let j = i - 19; j <= i; j++) md += Math.abs(tp[j] - m); return md ? (x - m) / (0.015 * (md / 20)) : 0 });
  const cv = last(cci), cr = rising(cci);
  add('CCI (20)', 'osc', cv, cv == null || cr == null ? null : cv < -100 && cr > 0 ? 1 : cv > 100 && cr < 0 ? -1 : 0);
  // ADX with +DI/−DI (Wilder)
  const up = b.map((x, i) => (i ? Math.max(0, x.high - b[i - 1].high) : 0)), dn = b.map((x, i) => (i ? Math.max(0, b[i - 1].low - x.low) : 0));
  const pdm = up.map((u, i) => (u > dn[i] ? u : 0)), mdm = dn.map((v, i) => (v > up[i] ? v : 0));
  const tr = b.map((x, i) => (i ? Math.max(x.high - x.low, Math.abs(x.high - b[i - 1].close), Math.abs(x.low - b[i - 1].close)) : x.high - x.low));
  const atr = rma(tr, 14), pdi = rma(pdm, 14).map((x, i) => (x == null || !atr[i] ? null : (100 * x) / atr[i]!)), mdi = rma(mdm, 14).map((x, i) => (x == null || !atr[i] ? null : (100 * x) / atr[i]!));
  const adx = rma(pdi.map((p, i) => (p == null || mdi[i] == null || p + mdi[i]! === 0 ? null : (100 * Math.abs(p - mdi[i]!)) / (p + mdi[i]!))), 14);
  const av = last(adx), ar = rising(adx), pv = last(pdi), mv = last(mdi);
  add('ADX (14)', 'osc', av, av == null || ar == null || pv == null || mv == null ? null : av > 20 && ar > 0 ? (pv > mv ? 1 : pv < mv ? -1 : 0) : 0);
  const hl2 = b.map(x => (x.high + x.low) / 2), s5 = sma(hl2, 5), s34 = sma(hl2, 34), ao = s5.map((x, i) => (x == null || s34[i] == null ? null : x - s34[i]!));
  const aov = last(ao), aor = rising(ao);
  add('Awesome Oscillator', 'osc', aov, aov == null || aor == null ? null : aov > 0 && aor > 0 ? 1 : aov < 0 && aor < 0 ? -1 : 0);
  const mom = c.map((x, i) => (i >= 10 ? x - c[i - 10] : null)), mr = rising(mom);
  add('Momentum (10)', 'osc', last(mom), mr == null ? null : (mr as Vote));
  const m = macd(c), mm = last(m.MACD), ms = last(m.Signal);
  add('MACD (12, 26)', 'osc', mm, mm == null || ms == null ? null : mm > ms ? 1 : mm < ms ? -1 : 0);
  // Stochastic RSI (3, 3, 14, 14)
  const rh = highest(r, 14), rl = lowest(r, 14), srsi = r.map((x, i) => (x == null || rh[i] == null || rl[i] == null ? null : rh[i] === rl[i] ? 50 : (100 * (x - rl[i]!)) / (rh[i]! - rl[i]!)));
  const sk = sma(srsi, 3), sd = sma(sk, 3), skv = last(sk), sdv = last(sd);
  add('Stochastic RSI Fast (3, 3, 14, 14)', 'osc', skv, skv == null || sdv == null ? null : skv < 20 && skv > sdv ? 1 : skv > 80 && skv < sdv ? -1 : 0);
  const hh = highest(b.map(x => x.high), 14), ll = lowest(b.map(x => x.low), 14), wr = c.map((x, i) => (hh[i] == null || ll[i] == null || hh[i] === ll[i] ? null : (-100 * (hh[i]! - x)) / (hh[i]! - ll[i]!)));
  const wv = last(wr), wrr = rising(wr);
  add('Williams %R (14)', 'osc', wv, wv == null || wrr == null ? null : wv < -80 && wrr > 0 ? 1 : wv > -20 && wrr < 0 ? -1 : 0);
  // Bull Bear Power (13): simplified to "above 0 and rising" / "below 0 and falling"
  const e13 = ema(c, 13), bbp = b.map((x, i) => (e13[i] == null ? null : x.high - e13[i]! + (x.low - e13[i]!))), bv = last(bbp), br = rising(bbp);
  add('Bull Bear Power', 'osc', bv, bv == null || br == null ? null : bv > 0 && br > 0 ? 1 : bv < 0 && br < 0 ? -1 : 0);
  // Ultimate Oscillator (7, 14, 28)
  const bp = b.map((x, i) => x.close - Math.min(x.low, i ? b[i - 1].close : x.low)), avg = (n: number) => { const a = sma(bp, n), t = sma(tr, n); return a.map((x, i) => (x == null || !t[i] ? null : x / t[i]!)) };
  const a7 = avg(7), a14 = avg(14), a28 = avg(28), uo = last(a7) == null || last(a14) == null || last(a28) == null ? null : (100 * (4 * last(a7)! + 2 * last(a14)! + last(a28)!)) / 7;
  add('Ultimate Oscillator (7, 14, 28)', 'osc', uo, uo == null ? null : uo > 70 ? 1 : uo < 30 ? -1 : 0);

  const score = (g: 'ma' | 'osc') => { const vs = votes.filter(v => v.group === g); return vs.length ? vs.reduce((s, v) => s + v.vote, 0) / vs.length : 0 };
  const ma = score('ma'), osc = score('osc'), all = (ma + osc) / 2;
  return { all, ma, osc, label: ratingLabel(all), votes };
}

/** Monthly returns (%) per UTC year from daily (or finer) bars: close of the month vs close of the month before. */
export function seasonals(b: Bar[]): { years: { year: number; months: (number | null)[] }[]; avg: (number | null)[] } {
  const closes = new Map<string, number>();   // 'YYYY-MM' → last close of that month
  for (const x of b) { const d = new Date(x.time * 1000); closes.set(`${d.getUTCFullYear()}-${String(d.getUTCMonth()).padStart(2, '0')}`, x.close) }
  const keys = [...closes.keys()].sort(), years = new Map<number, (number | null)[]>();
  for (let i = 1; i < keys.length; i++) {
    const [y, mo] = keys[i].split('-').map(Number), prev = closes.get(keys[i - 1])!, cur = closes.get(keys[i])!;
    const [py, pm] = keys[i - 1].split('-').map(Number);
    if ((y - py) * 12 + mo - pm !== 1) continue;   // a gap in the data: no return for that month
    const row = years.get(y) ?? Array(12).fill(null);
    row[mo] = ((cur - prev) / prev) * 100; years.set(y, row);
  }
  const out = [...years].sort((a, z) => z[0] - a[0]).map(([year, months]) => ({ year, months }));
  const avg = Array.from({ length: 12 }, (_, m) => { const v = out.map(r => r.months[m]).filter((x): x is number => x != null); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null });
  return { years: out, avg };
}

export interface Tick { s: string; c: number; ch: number; qv: number }
/** Top gainers, losers and most traded (quote volume), ignoring illiquid symbols below `minQv`. */
export function movers(t: Tick[], n = 10, minQv = 1e6) {
  const liquid = t.filter(x => x.qv >= minQv && Number.isFinite(x.ch));
  return {
    gainers: [...liquid].sort((a, b) => b.ch - a.ch).slice(0, n),
    losers: [...liquid].sort((a, b) => a.ch - b.ch).slice(0, n),
    active: [...liquid].sort((a, b) => b.qv - a.qv).slice(0, n),
  };
}

export interface Rect { x: number; y: number; w: number; h: number }
/** Squarified treemap (Bruls et al.): rectangles for `values` (any order) inside w × h, in input order. */
export function squarify(values: number[], w: number, h: number): Rect[] {
  const total = values.reduce((s, v) => s + Math.max(0, v), 0), out: Rect[] = Array(values.length);
  if (!total || w <= 0 || h <= 0) return values.map(() => ({ x: 0, y: 0, w: 0, h: 0 }));
  const order = values.map((v, i) => ({ v: (Math.max(0, v) / total) * w * h, i })).sort((a, b) => b.v - a.v);
  let x = 0, y = 0, W = w, H = h, row: typeof order = [];
  const worst = (r: typeof order, side: number) => { const s = r.reduce((a, b) => a + b.v, 0), mx = Math.max(...r.map(e => e.v)), mn = Math.min(...r.map(e => e.v)); return Math.max((side * side * mx) / (s * s), (s * s) / (side * side * mn)) };
  const lay = (r: typeof order) => {
    const s = r.reduce((a, b) => a + b.v, 0);
    if (W >= H) { const cw = s / H; let cy = y; for (const e of r) { const ch = e.v / cw; out[e.i] = { x, y: cy, w: cw, h: ch }; cy += ch } x += cw; W -= cw }
    else { const rh = s / W; let cx = x; for (const e of r) { const cw = e.v / rh; out[e.i] = { x: cx, y, w: cw, h: rh }; cx += cw } y += rh; H -= rh }
  };
  for (const e of order) {
    if (!e.v) { out[e.i] = { x, y, w: 0, h: 0 }; continue }
    const side = Math.min(W, H);
    if (!row.length || worst([...row, e], side) <= worst(row, side)) row.push(e);
    else { lay(row); row = [e] }
  }
  if (row.length) lay(row);
  return out;
}
