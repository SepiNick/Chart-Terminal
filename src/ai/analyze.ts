// Automatic chart analysis without a language model (ROADMAP phase 12): swing points, trend lines, support/resistance
// levels and classic patterns (double top/bottom, head & shoulders and inverse, triangles). Pure, no DOM: src/ai/ui.ts
// turns the result into ordinary drawings. Tolerances scale with ATR, so the same rules work on any symbol and timeframe.
import type { Bar } from '../data.ts';
import { atr } from '../indicators.ts';

export interface Pivot { i: number; t: number; p: number; hi: boolean }
export interface Line { a: Pivot; b: Pivot; kind: 'support' | 'resistance'; touches: number }
export interface Level { price: number; touches: number; first: number; kind: 'support' | 'resistance' }
export interface Pattern { name: string; dir: 'bullish' | 'bearish' | 'neutral'; pts: { t: number; p: number }[]; neckline?: number }
export interface Analysis { pivots: Pivot[]; lines: Line[]; levels: Level[]; patterns: Pattern[] }

/** Swing highs/lows: the extreme of `k` bars on each side; then alternated (two highs in a row keep the higher). */
export function pivots(b: Bar[], k = 5): Pivot[] {
  const raw: Pivot[] = [];
  for (let i = k; i < b.length - k; i++) {
    let hi = true, lo = true;
    for (let j = i - k; j <= i + k && (hi || lo); j++) {
      if (j === i) continue;
      if (b[j].high > b[i].high || (b[j].high === b[i].high && j < i)) hi = false;
      if (b[j].low < b[i].low || (b[j].low === b[i].low && j < i)) lo = false;
    }
    if (hi) raw.push({ i, t: b[i].time, p: b[i].high, hi: true });
    if (lo) raw.push({ i, t: b[i].time, p: b[i].low, hi: false });
  }
  const out: Pivot[] = [];
  for (const v of raw) {
    const last = out.at(-1);
    if (last && last.hi === v.hi) { if (v.hi ? v.p > last.p : v.p < last.p) out[out.length - 1] = v }
    else out.push(v);
  }
  return out;
}

const lineAt = (a: Pivot, b: Pivot, i: number) => a.p + ((b.p - a.p) * (i - a.i)) / (b.i - a.i);

/**
 * The most recent unbroken trend lines: a rising support through two swing lows (no close below it since the first),
 * a falling resistance through two swing highs. `touches` counts swings within tolerance of the line.
 */
export function trendLines(b: Bar[], ps: Pivot[], tol: number): Line[] {
  const out: Line[] = [];
  for (const kind of ['support', 'resistance'] as const) {
    const sw = ps.filter(p => p.hi === (kind === 'resistance'));
    found: for (let j = sw.length - 1; j > 0; j--) {
      for (let i = j - 1; i >= Math.max(0, j - 6); i--) {
        const a = sw[i], c = sw[j];
        if (kind === 'support' ? c.p <= a.p : c.p >= a.p) continue;   // support rises, resistance falls
        let ok = true;
        for (let x = a.i; x < b.length && ok; x++) { const y = lineAt(a, c, x); ok = kind === 'support' ? b[x].close >= y - tol : b[x].close <= y + tol }
        if (!ok) continue;
        out.push({ a, b: c, kind, touches: sw.filter(s => s.i >= a.i && Math.abs(s.p - lineAt(a, c, s.i)) <= tol).length });
        break found;
      }
    }
  }
  return out;
}

/** Price zones where swings cluster (within `tol`), at least two touches, strongest first. */
export function levels(ps: Pivot[], tol: number, last: number, max = 6): Level[] {
  const sorted = [...ps].sort((a, b) => a.p - b.p), groups: Pivot[][] = [];
  for (const p of sorted) { const g = groups.at(-1); if (g && p.p - g[0].p <= 2 * tol) g.push(p); else groups.push([p]) }
  return groups.filter(g => g.length >= 2).map(g => {
    const price = g.reduce((s, p) => s + p.p, 0) / g.length;
    return { price, touches: g.length, first: Math.min(...g.map(p => p.t)), kind: price >= last ? 'resistance' as const : 'support' as const };
  }).sort((a, b) => b.touches - a.touches || Math.abs(a.price - last) - Math.abs(b.price - last)).slice(0, max);
}

/** Patterns among the last swings (most recent first, one of each kind). */
export function patterns(ps: Pivot[], tol: number): Pattern[] {
  const out: Pattern[] = [], near = (x: number, y: number) => Math.abs(x - y) <= tol, pt = (p: Pivot) => ({ t: p.t, p: p.p });
  const recent = ps.slice(-12);
  const seen = new Set<string>(), add = (x: Pattern) => { if (!seen.has(x.name)) { seen.add(x.name); out.push(x) } };
  for (let e = recent.length - 1; e >= 2; e--) {
    const [a, m, c] = [recent[e - 2], recent[e - 1], recent[e]];
    // double top / bottom: two equal extremes with a clear swing between
    if (a.hi && c.hi && near(a.p, c.p) && a.p - m.p > 3 * tol) add({ name: 'Double top', dir: 'bearish', pts: [pt(a), pt(m), pt(c)], neckline: m.p });
    if (!a.hi && !c.hi && near(a.p, c.p) && m.p - a.p > 3 * tol) add({ name: 'Double bottom', dir: 'bullish', pts: [pt(a), pt(m), pt(c)], neckline: m.p });
    if (e < 4) continue;
    const [s1, n1, h, n2, s2] = recent.slice(e - 4, e + 1);
    // head & shoulders: three highs, the middle one clearly higher, the shoulders about equal
    if (s1.hi && h.hi && s2.hi && h.p - Math.max(s1.p, s2.p) > 2 * tol && near(s1.p, s2.p) && Math.min(s1.p, s2.p) - Math.max(n1.p, n2.p) > tol)
      add({ name: 'Head and shoulders', dir: 'bearish', pts: [s1, n1, h, n2, s2].map(pt), neckline: (n1.p + n2.p) / 2 });
    if (!s1.hi && !h.hi && !s2.hi && Math.min(s1.p, s2.p) - h.p > 2 * tol && near(s1.p, s2.p) && Math.min(n1.p, n2.p) - Math.max(s1.p, s2.p) > tol)
      add({ name: 'Inverse head and shoulders', dir: 'bullish', pts: [s1, n1, h, n2, s2].map(pt), neckline: (n1.p + n2.p) / 2 });
  }
  // triangles from the last two highs and the last two lows
  const hs = ps.filter(p => p.hi).slice(-2), ls = ps.filter(p => !p.hi).slice(-2);
  if (hs.length === 2 && ls.length === 2) {
    const dh = hs[1].p - hs[0].p, dl = ls[1].p - ls[0].p, flat = (d: number) => Math.abs(d) <= tol;
    const name = flat(dh) && dl > tol ? 'Ascending triangle' : flat(dl) && dh < -tol ? 'Descending triangle' : dh < -tol && dl > tol ? 'Symmetrical triangle' : '';
    if (name) out.push({ name, dir: name.startsWith('Asc') ? 'bullish' : name.startsWith('Desc') ? 'bearish' : 'neutral', pts: [...hs, ...ls].sort((a, b) => a.t - b.t).map(pt) });
  }
  return out;
}

export function analyze(b: Bar[], k = 5): Analysis {
  if (b.length < 4 * k) return { pivots: [], lines: [], levels: [], patterns: [] };
  const a = atr(b, 14), tol = (a.at(-1) ?? 0) * 0.5 || (b.at(-1)!.close * 0.002), ps = pivots(b, k);
  return { pivots: ps, lines: trendLines(b, ps, tol), levels: levels(ps, tol, b.at(-1)!.close), patterns: patterns(ps, tol) };
}
