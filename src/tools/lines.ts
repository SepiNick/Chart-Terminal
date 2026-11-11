// Trend-line tools beyond the basics (channels, pitchforks, info/angle/cross lines).
import type { Drawing, Geo, Level, Pt, Renderer, ToolDef, XY } from './types.ts';
import { moveStats } from './basic.ts';
import { frameOf } from './labels.ts';

/** Repeat the last element so drafts with fewer clicks still have n points. */
export const pad = <T>(a: T[], n: number): T[] => Array.from({ length: n }, (_, i) => a[Math.min(i, a.length - 1)]);
export const mid = (a: XY, b: XY): XY => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
export const lerp = (a: XY, b: XY, k: number): XY => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
export const dist = (a: XY, b: XY) => Math.hypot(b[0] - a[0], b[1] - a[1]);
/** Point far along a→dir (for fills under rays). */
export const far = (a: XY, dir: XY): XY => { const k = 1e4 / (Math.hypot(dir[0], dir[1]) || 1); return [a[0] + dir[0] * k, a[1] + dir[1] * k] };
export const onLevels = (d: Drawing) => (d.style.levels ?? []).filter(l => l.on).sort((p, q) => p.v - q.v);
const PAL = ['#787b86', '#f23645', '#ff9800', '#4caf50', '#089981', '#00bcd4', '#2962ff', '#9c27b0', '#e91e63'];
export const mkLevels = (on: number[], off: number[] = []): Level[] =>
  [...on.map(v => [v, true] as const), ...off.map(v => [v, false] as const)].sort((a, b) => a[0] - b[0]).map(([v, o], i) => ({ v, on: o, color: PAL[i % PAL.length] }));

/** Segment a→b extended to well past the pane in x (start past a, end past b). */
export function extSeg(a: XY, b: XY, l: boolean, rt: boolean, W: number): [XY, XY] {
  const dx = b[0] - a[0];
  if (!dx) return [a, b];
  const y = (x: number) => a[1] + ((b[1] - a[1]) * (x - a[0])) / dx;
  const x0 = l ? (dx > 0 ? -W : 2 * W) : a[0], x1 = rt ? (dx > 0 ? 2 * W : -W) : b[0];
  return [[x0, y(x0)], [x1, y(x1)]];
}
/** Price on the line a→b at bar index l (null when vertical). */
export function priceOn(a: Pt, b: Pt, l: number, g: Geo): number | null {
  const la = g.logical(a.t), lb = g.logical(b.t);
  return la === lb ? null : a.p + ((b.p - a.p) * (l - la)) / (lb - la);
}
const maxN = (...v: (number | null)[]) => { const f = v.filter((x): x is number => x != null); return f.length ? Math.max(...f) : null };
const deg = (a: XY, b: XY) => (Math.atan2(a[1] - b[1], b[0] - a[0]) * 180) / Math.PI;

/** Two lines with a fill between them; `mid` adds a dashed midline. */
function channel(r: Renderer, d: Drawing, g: Geo, a: [XY, XY], b: [XY, XY], midline: boolean) {
  const [l, rt] = [d.style.extendLeft, d.style.extendRight];
  const A = extSeg(a[0], a[1], l, rt, g.W), B = extSeg(b[0], b[1], l, rt, g.W);
  if (d.style.fillAlpha > 0) r.poly([A[0], A[1], B[1], B[0]], true, { fill: r.fill(), stroke: false });
  r.line(A[0], A[1]); r.line(B[0], B[1]);
  if (midline) { const M = extSeg(mid(a[0], b[0]), mid(a[1], b[1]), l, rt, g.W); r.line(M[0], M[1], { dash: 'dashed', width: 1 }) }
}

/** Parallel channel geometry: base pts a,b and price offset of c from the base line. */
function parOffset(d: Drawing, g: Geo) {
  const [a, b, c] = pad(d.pts, 3);
  return { a, b, off: c.p - (priceOn(a, b, g.logical(c.t), g) ?? a.p) };
}

/** Least-squares fit of closes over the bar range between the two anchors. */
function regress(d: Drawing, g: Geo) {
  const ls = d.pts.slice(0, 2).map(p => Math.round(g.logical(p.t)));
  const i0 = Math.max(0, Math.min(...ls)), i1 = Math.min(g.bars.length - 1, Math.max(...ls)), n = i1 - i0 + 1;
  if (n < 2) return null;
  let sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0;
  for (let i = i0; i <= i1; i++) { const y = g.bars[i].close; sx += i; sy += y; sxx += i * i; sxy += i * y; syy += y * y }
  const vx = n * sxx - sx * sx, vy = n * syy - sy * sy, m = (n * sxy - sx * sy) / vx, c = (sy - m * sx) / n;
  let ss = 0;
  for (let i = i0; i <= i1; i++) ss += (g.bars[i].close - (c + m * i)) ** 2;
  return { i0, i1, m, c, sd: Math.sqrt(ss / n), R: vy > 0 ? (n * sxy - sx * sy) / Math.sqrt(vx * vy) : 0 };
}

/**
 * Pitchfork family. Start S = P1 + (P2 - P1) * (ft, fp) in (time, price); median S → mid(P2,P3);
 * tines are parallels to the median through mid(P2,P3) ± v·(P3 - mid) for each level v (v = 1 → through P2/P3).
 */
function pitchfork(id: string, name: string, icon: string, ft: number, fp: number): ToolDef {
  return {
    id, name, icon, group: 'lines', points: 3,
    defaults: { fillAlpha: 0.08 },
    levels: mkLevels([1], [0.25, 0.382, 0.5, 0.618, 0.75, 1.5, 1.75, 2]),
    draw(r, d, P0) {
      const [p1, p2, p3] = pad(P0, 3), S: XY = [p1[0] + (p2[0] - p1[0]) * ft, p1[1] + (p2[1] - p1[1]) * fp], M = mid(p2, p3);
      const dir: XY = [M[0] - S[0], M[1] - S[1]], half: XY = [p3[0] - M[0], p3[1] - M[1]];
      r.line(p2, p3, { width: 1 });
      if (ft || fp) r.line(p1, S, { dash: 'dashed', width: 1 });
      const lv = onLevels(d), at = (v: number): XY => [M[0] + half[0] * v, M[1] + half[1] * v];
      const sides = [...lv.map(l => ({ v: -l.v, color: l.color })).reverse(), { v: 0, color: d.style.color }, ...lv.map(l => ({ v: l.v, color: l.color }))];
      sides.forEach((s, i) => {
        const a = at(s.v);
        if (i && d.style.fillAlpha > 0) { const b = at(sides[i - 1].v); r.poly([b, a, far(a, dir), far(b, dir)], true, { fill: r.fill(Math.abs(s.v) > Math.abs(sides[i - 1].v) ? s.color : sides[i - 1].color), stroke: false, noHit: true }) }
        if (s.v) r.ray(a, [a[0] + dir[0], a[1] + dir[1]], d.style.extendLeft, true, { color: s.color });
      });
      r.ray(S, M, d.style.extendLeft, true);
    },
    priceAt(d, t, g) {
      const [a, b, c] = pad(d.pts, 3), [la, lb, lc] = [a, b, c].map(p => g.logical(p.t));
      const sl = la + (lb - la) * ft, sp = a.p + (b.p - a.p) * fp, ml = (lb + lc) / 2, mp = (b.p + c.p) / 2, l = g.logical(t);
      if (ml === sl || l < sl) return null;
      const k = (mp - sp) / (ml - sl);
      return Math.max(b.p + k * (l - lb), c.p + k * (l - lc));
    },
  };
}

export const LINE_TOOLS: ToolDef[] = [
  {
    id: 'infoline', name: 'Info line', icon: 'ℹ', group: 'lines', points: 2,
    draw(r, d, P, g) {
      const [a, b] = pad(P, 2), [pa, pb] = pad(d.pts, 2);
      r.ray(a, b, d.style.extendLeft, d.style.extendRight);
      r.text(`${moveStats(pa, pb, g)}\n∠ ${deg(a, b).toFixed(1)}°`, [b[0] + 8, b[1]], { size: 11, bg: r.fill(d.style.color, 0.15), border: d.style.color, pad: 5, baseline: 'middle' });
    },
    priceAt: (d, t, g) => priceOn(d.pts[0], d.pts[1], g.logical(t), g),
  },
  {
    id: 'trendangle', name: 'Trend angle', icon: '∠', group: 'lines', points: 2,
    draw(r, d, P) {
      const [a, b] = pad(P, 2), len = Math.max(30, Math.min(80, dist(a, b))), ang = deg(a, b);
      r.ray(a, b, d.style.extendLeft, d.style.extendRight);
      r.hline(a[1], a[0], a[0] + len, { dash: 'dotted', width: 1 });
      r.arc(a, len * 0.6, 0, (-ang * Math.PI) / 180, { width: 1, noHit: true });
      r.text(`${ang.toFixed(1)}°`, [a[0] + len + 4, a[1]], { size: 11, color: d.style.color, baseline: 'middle' });
    },
    priceAt: (d, t, g) => priceOn(d.pts[0], d.pts[1], g.logical(t), g),
  },
  {
    id: 'crossline', name: 'Cross line', icon: '✛', key: 'Alt+C', group: 'lines', points: 1,
    draw(r, _d, P) { r.hline(P[0][1]); r.vline(P[0][0]) },
    priceAt: d => d.pts[0].p,
  },
  {
    id: 'parallel', name: 'Parallel channel', icon: '⫽', group: 'lines', points: 3,
    defaults: { fillAlpha: 0.08 },
    props: [{ key: 'midline', label: 'Middle line', type: 'bool', default: true }],
    draw(r, d, P, g) {
      const { a, b, off } = parOffset(d, g), [p0, p1] = pad(P, 2);
      channel(r, d, g, [p0, p1], [[p0[0], g.y(a.p + off)], [p1[0], g.y(b.p + off)]], !!d.style.midline);
    },
    frame(d, P, g) { const { a, b, off } = parOffset(d, g), [p0, p1] = pad(P, 2); return frameOf([p0, p1], [[p0[0], g.y(a.p + off)], [p1[0], g.y(b.p + off)]]) },
    priceAt(d, t, g) { const { a, b, off } = parOffset(d, g), p = priceOn(a, b, g.logical(t), g); return p == null ? null : p + Math.max(0, off) },
  },
  {
    id: 'regression', name: 'Regression trend', icon: '≈', group: 'lines', points: 2,
    defaults: { fillAlpha: 0.08 },
    props: [{ key: 'deviation', label: 'Deviation', type: 'number', default: 2, min: 0, step: 0.1 }, { key: 'showR', label: "Pearson's R", type: 'bool', default: true }],
    draw(r, d, P, g) {
      const f = regress(d, g);
      if (!f) { const [a, b] = pad(P, 2); r.line(a, b, { dash: 'dashed' }); return }
      const k = Number(d.style.deviation) * f.sd, x0 = g.x(g.bars[f.i0].time), x1 = g.x(g.bars[f.i1].time);
      const at = (o: number): [XY, XY] => [[x0, g.y(f.c + f.m * f.i0 + o)], [x1, g.y(f.c + f.m * f.i1 + o)]];
      channel(r, d, g, at(k), at(-k), false);
      const M = extSeg(...at(0), d.style.extendLeft, d.style.extendRight, g.W);
      r.line(M[0], M[1], { dash: 'dashed' });
      if (d.style.showR) r.text(f.R.toFixed(4), [x0, Math.max(at(k)[0][1], at(-k)[0][1]) + 4], { size: 11, color: d.style.color, baseline: 'top' });
    },
    frame(d, _P, g) {
      const f = regress(d, g); if (!f) return null;
      const k = Number(d.style.deviation) * f.sd, x0 = g.x(g.bars[f.i0].time), x1 = g.x(g.bars[f.i1].time);
      const at = (o: number): [XY, XY] => [[x0, g.y(f.c + f.m * f.i0 + o)], [x1, g.y(f.c + f.m * f.i1 + o)]];
      return frameOf(at(k), at(-k));
    },
    priceAt(d, t, g) { const f = regress(d, g); return f && f.c + f.m * g.logical(t) + Number(d.style.deviation) * f.sd },
  },
  {
    id: 'flattop', name: 'Flat top/bottom', icon: '⊐', group: 'lines', points: 3,
    defaults: { fillAlpha: 0.08 },
    draw(r, d, P, g) { const [a, b, c] = pad(P, 3); channel(r, d, g, [a, b], [[a[0], c[1]], [b[0], c[1]]], false) },
    frame: (_d, P) => { const [a, b, c] = pad(P, 3); return frameOf([a, b], [[a[0], c[1]], [b[0], c[1]]]) },
    priceAt(d, t, g) { const [a, b, c] = pad(d.pts, 3); return maxN(priceOn(a, b, g.logical(t), g), c.p) },
  },
  {
    id: 'disjoint', name: 'Disjoint channel', icon: '⫻', group: 'lines', points: 4,
    defaults: { fillAlpha: 0.08 },
    draw(r, d, P, g) { const [a, b, c, e] = pad(P, 4); channel(r, d, g, [a, b], [c, e], false) },
    frame: (_d, P) => { const [a, b, c, e] = pad(P, 4); return frameOf([a, b], [c, e]) },
    priceAt(d, t, g) { const [a, b, c, e] = pad(d.pts, 4), l = g.logical(t); return maxN(priceOn(a, b, l, g), priceOn(c, e, l, g)) },
  },
  pitchfork('pitchfork', 'Pitchfork', 'ψ', 0, 0),
  pitchfork('schiff', 'Schiff pitchfork', 'Ψ', 0, 0.5),
  pitchfork('modschiff', 'Modified Schiff pitchfork', '⋔', 0.5, 0.5),
  // Inside pitchfork, as specified: median from mid(P1,P2) toward mid(P2,P3), tines through P2/P3.
  // shortcut: geometrically identical to Modified Schiff under this definition; diverge if a sharper spec appears.
  pitchfork('insidepitchfork', 'Inside pitchfork', '⑂', 0.5, 0.5),
];
