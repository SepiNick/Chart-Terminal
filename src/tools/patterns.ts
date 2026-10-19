// Harmonic, chart, Elliott wave and cycle patterns.
import type { Renderer, ToolDef, XY } from './types.ts';

const mid = (a: XY, b: XY): XY => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
/** |leg a→b| / |leg c→e| in price. NaN/Infinity while drafting (zero legs) are filtered at draw time. */
const rt = (p: number[], a: number, b: number, c: number, e: number) => Math.abs(p[b] - p[a]) / Math.abs(p[e] - p[c]);
/** Point i is a swing high on screen if it sits above the average of its neighbours. */
function isHigh(P: XY[], i: number) {
  const nb = [P[i - 1], P[i + 1]].filter(Boolean);
  return !nb.length || P[i][1] <= nb.reduce((s, q) => s + q[1], 0) / nb.length;
}
const offset = (P: XY[], i: number, k = 14): XY => [P[i][0], P[i][1] + (isHigh(P, i) ? -k : k)];
const tag = (r: Renderer, s: string, P: XY[], i: number, bg: string) => { if (s && i < P.length) r.label(s, offset(P, i), bg) };

type Link = [number, number, ((p: number[]) => number)?];
/**
 * Point-chain pattern: zigzag through the points, filled polygons (index lists), dashed connectors
 * with an optional price-ratio label, and point letters above highs / below lows.
 */
function chain(id: string, name: string, icon: string, labels: string[], links: Link[], fills: number[][] = []): ToolDef {
  return {
    id, name, icon, group: 'patterns', points: labels.length,
    defaults: { fillAlpha: fills.length ? 0.2 : 0 },
    draw(r, d, P) {
      const n = P.length, p = d.pts.map(q => q.p);
      for (const f of fills) if (f.every(i => i < n)) r.poly(f.map(i => P[i]), true, { stroke: false });
      r.poly(P, false);
      for (const [a, b, f] of links) if (a < n && b < n) {
        r.line(P[a], P[b], { dash: 'dashed', width: 1 });
        const v = f?.(p);
        if (v !== undefined && Number.isFinite(v)) r.text(v.toFixed(3), mid(P[a], P[b]), { size: 11, align: 'center', baseline: 'middle', bg: r.fill(d.style.color, 0.15), pad: 2, color: d.style.textColor, noHit: true });
      }
      labels.forEach((s, i) => tag(r, s, P, i, d.style.color));
    },
  };
}

// ---- Elliott waves: label notation depends on wave degree ----
const DEGREES = ['Grand Supercycle', 'Supercycle', 'Cycle', 'Primary', 'Intermediate', 'Minor', 'Minute', 'Minuette', 'Subminuette'];
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];
/**
 * Degrees come in 3 tiers × 3 wraps: tier 0 = roman/UPPER, tier 1 = arabic/UPPER, tier 2 = roman/lower;
 * wrap 0 = ((x)) for tier 0 or circled otherwise, wrap 1 = (x), wrap 2 = plain. E.g. Primary ①, Minuette (i).
 */
function degreeLabel(s: string, degree: string): [string, boolean] {
  const i = Math.max(0, DEGREES.indexOf(degree)), tier = Math.floor(i / 3), wrap = i % 3;
  let t = /^\d$/.test(s) && tier !== 1 ? ROMAN[+s] : s;
  if (tier === 2) t = t.toLowerCase();
  return wrap === 0 ? (tier === 0 ? [`((${t}))`, false] : [t, true]) : [wrap === 1 ? `(${t})` : t, false];
}
function elliott(id: string, name: string, icon: string, labels: string[]): ToolDef {
  return {
    id, name, icon, group: 'patterns', points: labels.length,
    props: [{ key: 'degree', label: 'Degree', type: 'select', options: DEGREES, default: 'Intermediate' }],
    draw(r, d, P) {
      r.poly(P, false);
      labels.forEach((s, i) => {
        if (!s || i >= P.length) return;
        const [t, circled] = degreeLabel(s, String(d.style.degree)), at = offset(P, i, 16);
        const [, , w] = r.text(t, at, { align: 'center', baseline: 'middle', bold: true, color: d.style.color });
        if (circled) r.ellipse(at, w / 2 + 5, 10, 0, { fill: false, width: 1, noHit: true });
      });
    },
  };
}

/** First repeat index k ≥ 0 such that x0 + k·dx is on screen (or about to be). */
const firstK = (x0: number, dx: number, W: number) => Math.max(0, Math.ceil(dx > 0 ? -x0 / dx : (x0 - W) / -dx) - 1);

export const PATTERN_TOOLS: ToolDef[] = [
  chain('xabcd', 'XABCD pattern', 'Ⓧ', ['X', 'A', 'B', 'C', 'D'], [
    [0, 2, p => rt(p, 1, 2, 0, 1)],  // AB / XA
    [1, 3, p => rt(p, 2, 3, 1, 2)],  // BC / AB
    [2, 4, p => rt(p, 3, 4, 2, 3)],  // CD / BC
    [0, 4, p => rt(p, 1, 4, 0, 1)],  // XD / XA, measured as the AD retracement of XA
  ], [[0, 1, 2], [2, 3, 4]]),
  chain('cypher', 'Cypher pattern', 'Ⓒ', ['X', 'A', 'B', 'C', 'D'], [
    [0, 2, p => rt(p, 1, 2, 0, 1)],  // AB / XA
    [1, 3, p => rt(p, 0, 3, 0, 1)],  // XC / XA (C extends XA)
    [0, 4, p => rt(p, 3, 4, 0, 3)],  // CD / XC (D retraces XC)
  ], [[0, 1, 2], [2, 3, 4]]),
  {
    id: 'headshoulders', name: 'Head and shoulders', icon: '⩀', group: 'patterns', points: 7,
    defaults: { fillAlpha: 0.2 },
    draw(r, d, P) {
      const n = P.length;
      if (n >= 5) { // neckline through the two troughs, spanning the whole pattern
        const [a, b] = [P[2], P[4]], k = Math.abs(b[0] - a[0]) > 1e-6 ? (b[1] - a[1]) / (b[0] - a[0]) : 0;
        const at = (x: number): XY => [x, a[1] + k * (x - a[0])], L = at(P[0][0]), R = at(P[n - 1][0]);
        if (n === 7) r.poly([L, ...P.slice(1, 6), R], true, { stroke: false });
        r.line(L, R, { dash: 'dashed' });
      }
      r.poly(P, false);
      ['', 'Left Shoulder', '', 'Head', '', 'Right Shoulder', ''].forEach((s, i) => tag(r, s, P, i, d.style.color));
    },
  },
  chain('abcd', 'ABCD pattern', 'Ⓐ', ['A', 'B', 'C', 'D'], [[0, 2, p => rt(p, 1, 2, 0, 1)], [1, 3, p => rt(p, 2, 3, 1, 2)]]),
  // Converging zigzag: dashed AC / BD boundaries, area between them filled.
  chain('trianglepattern', 'Triangle pattern', '◁', ['A', 'B', 'C', 'D'], [[0, 2], [1, 3]], [[0, 2, 3, 1]]),
  chain('threedrives', 'Three drives pattern', 'Ⓓ', ['', '1', 'A', '2', 'B', '3', ''], [
    [0, 2, p => rt(p, 1, 2, 0, 1)], [1, 3, p => rt(p, 2, 3, 1, 2)], [2, 4, p => rt(p, 3, 4, 2, 3)], [3, 5, p => rt(p, 4, 5, 3, 4)],
  ]),
  elliott('elliott12345', 'Elliott impulse wave (12345)', '⑤', ['', '1', '2', '3', '4', '5']),
  elliott('elliottabc', 'Elliott correction wave (ABC)', 'ⓒ', ['', 'A', 'B', 'C']),
  elliott('elliottabcde', 'Elliott triangle wave (ABCDE)', 'Ⓔ', ['', 'A', 'B', 'C', 'D', 'E']),
  elliott('elliottwxy', 'Elliott double combo wave (WXY)', 'Ⓦ', ['', 'W', 'X', 'Y']),
  elliott('elliottwxyxz', 'Elliott triple combo wave (WXYXZ)', 'Ⓩ', ['', 'W', 'X', 'Y', 'X', 'Z']),
  {
    id: 'cycliclines', name: 'Cyclic lines', icon: '⦀', group: 'patterns', points: 2,
    draw(r, _d, P, g) {
      const x0 = P[0][0], dx = P[1][0] - x0;
      if (Math.abs(dx) < 2) { r.vline(x0); return }
      for (let k = firstK(x0, dx, g.W), i = 0; i < 2000; k++, i++) {
        const x = x0 + k * dx;
        if (dx > 0 ? x > g.W : x < 0) break;
        r.vline(x);
      }
      r.line(P[0], P[1], { dash: 'dashed', width: 1 });
    },
  },
  {
    // Semicircles of diameter |x1 - x0| repeated along time; they open toward the side of point 2.
    id: 'timecycles', name: 'Time cycles', icon: '⌒', group: 'patterns', points: 2,
    draw(r, _d, P, g) {
      const [x0, y] = P[0], dx = P[1][0] - x0, R = Math.abs(dx) / 2, up = P[1][1] <= y;
      if (R < 1) { r.line(P[0], P[1]); return }
      for (let k = firstK(x0, dx, g.W), i = 0; i < 2000; k++, i++) {
        const cx = x0 + dx / 2 + k * dx;
        if (dx > 0 ? cx - R > g.W : cx + R < 0) break;
        r.arc([cx, y], R, up ? Math.PI : 0, up ? Math.PI * 2 : Math.PI);
      }
    },
  },
  {
    // P1 → P2 is half a period between opposite extremes; the wave covers the whole pane.
    id: 'sineline', name: 'Sine line', icon: '∿', group: 'patterns', points: 2,
    draw(r, _d, P, g) {
      const [[x0, y0], [x1, y1]] = P, dx = x1 - x0;
      if (Math.abs(dx) < 2) { r.line(P[0], P[1]); return }
      const m = (y0 + y1) / 2, A = (y0 - y1) / 2, pts: XY[] = [];
      for (let x = 0; x <= g.W + 2; x += 2) pts.push([x, m + A * Math.cos((Math.PI * (x - x0)) / dx)]);
      r.poly(pts, false);
    },
  },
];
