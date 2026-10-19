// Fibonacci and Gann tools beyond Fib retracement.
import type { Drawing, Geo, PropDef, Pt, Renderer, ToolDef, XY } from './types.ts';
import { FIB_LEVELS } from './basic.ts';
import { dist, extSeg, far, lerp, mid, mkLevels, onLevels, pad, priceOn } from './lines.ts';

const LABELS: PropDef = { key: 'showLabels', label: 'Labels', type: 'bool', default: true };
const ARC_LEVELS = mkLevels([0.236, 0.382, 0.5, 0.618, 0.786, 1], [1.618, 2.618]);
const GANN_LEVELS = mkLevels([0, 0.25, 0.382, 0.5, 0.618, 0.75, 1]);
const arcPts = (c: XY, rx: number, ry: number, a0: number, a1: number, n = 64): XY[] =>
  Array.from({ length: n + 1 }, (_, i) => { const a = a0 + ((a1 - a0) * i) / n; return [c[0] + rx * Math.cos(a), c[1] + ry * Math.sin(a)] });
const fmtV = (v: number) => String(+v.toFixed(3));

/** Horizontal level lines between x0..x1 at priceOf(v), with fills between neighbours. */
function hLevels(r: Renderer, d: Drawing, g: Geo, priceOf: (v: number) => number, x0: number, x1: number) {
  const lv = onLevels(d);
  lv.forEach((l, i) => {
    const y = g.y(priceOf(l.v));
    if (i && d.style.fillAlpha > 0) r.rect([x0, g.y(priceOf(lv[i - 1].v))], [x1, y], { fill: r.fill(l.color), stroke: false, noHit: true });
    r.hline(y, x0, x1, { color: l.color, width: 1 });
    if (d.style.showLabels) r.text(`${fmtV(l.v)} (${g.fmt(priceOf(l.v))})`, [x0 + 2, y - 2], { size: 11, color: l.color, noHit: true });
  });
}
/** Vertical level lines at bar index l0 + v·n. */
function vLevels(r: Renderer, d: Drawing, g: Geo, l0: number, n: number) {
  for (const l of onLevels(d)) {
    if (!n && l.v) continue;
    const x = g.x(g.timeAt(l0 + l.v * n));
    r.vline(x, { color: l.color, width: 1 });
    if (d.style.showLabels) r.text(fmtV(l.v), [x + 3, 4], { size: 11, color: l.color, baseline: 'top', noHit: true });
  }
}
/** Concentric (elliptical) arcs from a0 to a1 at radius v·(rx, ry), ring fills between neighbours. */
function arcLevels(r: Renderer, d: Drawing, c: XY, rx: number, ry: number, a0: number, a1: number) {
  const lv = onLevels(d);
  lv.forEach((l, i) => {
    const pts = arcPts(c, rx * l.v, ry * l.v, a0, a1);
    if (i && d.style.fillAlpha > 0) r.poly([...pts, ...arcPts(c, rx * lv[i - 1].v, ry * lv[i - 1].v, a0, a1).reverse()], true, { fill: r.fill(l.color), stroke: false, noHit: true });
    r.poly(pts, false, { color: l.color, width: 1 });
    if (d.style.showLabels) r.text(fmtV(l.v), pts[32], { size: 11, color: l.color, noHit: true });
  });
}
/** Rays from o through each endpoint, fills between neighbouring rays. */
function fan(r: Renderer, d: Drawing, o: XY, ends: { e: XY; color: string; label: string }[]) {
  ends.forEach(({ e, color, label }, i) => {
    const dir: XY = [e[0] - o[0], e[1] - o[1]];
    if (i && d.style.fillAlpha > 0) { const p = ends[i - 1].e; r.poly([o, far(o, dir), far(o, [p[0] - o[0], p[1] - o[1]])], true, { fill: r.fill(color), stroke: false, noHit: true }) }
    r.ray(o, e, false, true, { color, width: 1 });
    if (d.style.showLabels) r.text(label, e, { size: 11, color, noHit: true });
  });
}
/** Grid of level lines inside the box a→b (price rows and time columns). */
function grid(r: Renderer, d: Drawing, a: XY, b: XY, labels: boolean) {
  for (const l of onLevels(d)) {
    const y = a[1] + (b[1] - a[1]) * l.v, x = a[0] + (b[0] - a[0]) * l.v;
    r.line([a[0], y], [b[0], y], { color: l.color, width: 1 });
    r.line([x, a[1]], [x, b[1]], { color: l.color, width: 1 });
    if (labels) { r.text(fmtV(l.v), [Math.min(a[0], b[0]) - 3, y], { size: 10, color: l.color, align: 'right', baseline: 'middle', noHit: true }); r.text(fmtV(l.v), [x, Math.max(a[1], b[1]) + 3], { size: 10, color: l.color, align: 'center', baseline: 'top', noHit: true }) }
  }
}
function parallelOff(d: Drawing, g: Geo) {
  const [a, b, c] = pad(d.pts, 3);
  return { a, b, off: c.p - (priceOn(a, b, g.logical(c.t), g) ?? a.p) };
}
const dashed = (r: Renderer, pts: XY[]) => r.poly(pts, false, { dash: 'dashed', width: 1, color: '#787b86' });

function gannSquare(id: string, name: string, icon: string, fixed: boolean): ToolDef {
  return {
    id, name, icon, group: 'fib', points: 2,
    levels: GANN_LEVELS, defaults: { fillAlpha: 0.05 },
    props: [LABELS, { key: 'showFans', label: 'Fans', type: 'bool', default: true }, { key: 'showArcs', label: 'Arcs', type: 'bool', default: true }],
    // Fixed: lock the box to a pixel square at the current zoom (re-squared on every handle drag).
    build: fixed ? (pts: Pt[], g: Geo) => {
      if (pts.length < 2) return pts;
      const [a, b] = pts, side = Math.abs(g.x(b.t) - g.x(a.t));
      return [a, { t: b.t, p: g.p(g.y(a.p) + (b.p >= a.p ? -side : side)) }];
    } : undefined,
    draw(r, d, P) {
      const [a, b] = pad(P, 2), dx = b[0] - a[0], dy = b[1] - a[1];
      r.rect(a, b, { fill: false });
      grid(r, d, a, b, !!d.style.showLabels);
      if (d.style.showFans) for (const l of onLevels(d)) {
        r.line(a, [b[0], a[1] + dy * l.v], { color: l.color, width: 1, noHit: true });
        r.line(a, [a[0] + dx * l.v, b[1]], { color: l.color, width: 1, noHit: true });
      }
      if (d.style.showArcs) for (const l of onLevels(d)) if (l.v) r.poly(arcPts(a, dx * l.v, dy * l.v, 0, Math.PI / 2), false, { color: l.color, width: 1, noHit: true });
    },
  };
}

export const FIB_GANN_TOOLS: ToolDef[] = [
  {
    id: 'fibext', name: 'Trend-based fib extension', icon: '⇞', group: 'fib', points: 3,
    levels: mkLevels([0, 0.382, 0.618, 1, 1.272, 1.618, 2.618], [0.236, 0.5, 0.786, 2, 3.618, 4.236]), defaults: { fillAlpha: 0.08 },
    props: [LABELS],
    draw(r, d, P, g) {
      const [a, b, c] = pad(d.pts, 3), Q = pad(P, 3);
      dashed(r, Q);
      const x0 = d.style.extendLeft ? 0 : Q[2][0], x1 = d.style.extendRight ? g.W : Q[2][0] + Math.max(40, Math.abs(Q[1][0] - Q[0][0]));
      hLevels(r, d, g, v => c.p + (b.p - a.p) * v, x0, x1);
    },
  },
  {
    id: 'fibchannel', name: 'Fib channel', icon: '≢', group: 'fib', points: 3,
    levels: FIB_LEVELS, defaults: { fillAlpha: 0.08 },
    props: [LABELS],
    draw(r, d, P, g) {
      const { a, b, off } = parallelOff(d, g), [p0, p1] = pad(P, 2), lv = onLevels(d);
      const seg = (v: number) => extSeg([p0[0], g.y(a.p + off * v)], [p1[0], g.y(b.p + off * v)], d.style.extendLeft, d.style.extendRight, g.W);
      lv.forEach((l, i) => {
        const [s, e] = seg(l.v);
        if (i && d.style.fillAlpha > 0) { const [ps, pe] = seg(lv[i - 1].v); r.poly([ps, pe, e, s], true, { fill: r.fill(l.color), stroke: false, noHit: true }) }
        r.line(s, e, { color: l.color, width: 1 });
        if (d.style.showLabels) r.text(fmtV(l.v), [p0[0] - 3, g.y(a.p + off * l.v)], { size: 11, color: l.color, align: 'right', baseline: 'middle', noHit: true });
      });
    },
    priceAt(d, t, g) { const { a, b, off } = parallelOff(d, g), p = priceOn(a, b, g.logical(t), g); return p == null ? null : p + Math.max(0, off) },
  },
  {
    id: 'fibtimezone', name: 'Fib time zone', icon: '⦀', group: 'fib', points: 2,
    levels: mkLevels([0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89]),
    props: [LABELS],
    draw(r, d, P, g) {
      const [a, b] = pad(d.pts, 2), la = g.logical(a.t);
      dashed(r, pad(P, 2));
      vLevels(r, d, g, la, Math.round(g.logical(b.t) - la));
    },
  },
  {
    id: 'fibspeedfan', name: 'Fib speed resistance fan', icon: '◿', group: 'fib', points: 2,
    levels: GANN_LEVELS, defaults: { fillAlpha: 0.06 },
    props: [LABELS, { key: 'showGrid', label: 'Grid', type: 'bool', default: true }],
    draw(r, d, P) {
      const [a, b] = pad(P, 2), lv = onLevels(d);
      r.rect(a, b, { fill: false, width: 1 });
      if (d.style.showGrid) grid(r, d, a, b, false);
      // Price rays end on P2's vertical edge, time rays on P2's horizontal edge; v = 0 is the a→b diagonal.
      fan(r, d, a, lv.map(l => ({ e: [b[0], b[1] + (a[1] - b[1]) * l.v] as XY, color: l.color, label: fmtV(l.v) })));
      fan(r, { ...d, style: { ...d.style, fillAlpha: 0 } }, a, lv.filter(l => l.v).map(l => ({ e: [b[0] + (a[0] - b[0]) * l.v, b[1]] as XY, color: l.color, label: fmtV(l.v) })));
    },
  },
  {
    id: 'trendfibtime', name: 'Trend-based fib time', icon: '⫼', group: 'fib', points: 3,
    levels: mkLevels([0, 0.382, 0.5, 0.618, 1, 1.382, 1.618, 2, 2.618], [3, 3.618, 4.236]),
    props: [LABELS],
    draw(r, d, P, g) {
      const [a, b, c] = pad(d.pts, 3);
      dashed(r, pad(P, 3));
      vLevels(r, d, g, g.logical(c.t), g.logical(b.t) - g.logical(a.t));
    },
  },
  {
    // P1–P2 is the diameter of the level-1 circle (center = midpoint).
    id: 'fibcircles', name: 'Fib circles', icon: '◎', group: 'fib', points: 2,
    levels: ARC_LEVELS, defaults: { fillAlpha: 0.06 },
    props: [LABELS],
    draw(r, d, P) {
      const [a, b] = pad(P, 2), R = dist(a, b) / 2;
      dashed(r, [a, b]);
      arcLevels(r, d, mid(a, b), R, R, -Math.PI, Math.PI);
    },
  },
  {
    // Golden (logarithmic) spiral centred on P1, passing through P2; radius grows by φ every quarter turn.
    id: 'fibspiral', name: 'Fib spiral', icon: '@', group: 'fib', points: 2,
    props: [{ key: 'ccw', label: 'Counter-clockwise', type: 'bool', default: false }],
    draw(r, d, P) {
      const [a, b] = pad(P, 2), R = dist(a, b), t0 = Math.atan2(b[1] - a[1], b[0] - a[0]), s = d.style.ccw ? -1 : 1, phi = (1 + Math.sqrt(5)) / 2;
      dashed(r, [a, b]);
      if (!R) return;
      const pts: XY[] = [];
      for (let k = -8 * Math.PI; k <= 4 * Math.PI; k += Math.PI / 32) {
        const rad = R * phi ** ((k * 2) / Math.PI);
        if (rad > 1e4) break;
        pts.push([a[0] + rad * Math.cos(t0 + s * k), a[1] + rad * Math.sin(t0 + s * k)]);
      }
      r.poly(pts, false);
    },
  },
  {
    // Half-circles centred on P2, opening toward P1, at fractions of |P1P2|.
    id: 'fibarcs', name: 'Fib speed resistance arcs', icon: '◠', group: 'fib', points: 2,
    levels: ARC_LEVELS, defaults: { fillAlpha: 0.06 },
    props: [LABELS, { key: 'fullCircles', label: 'Full circles', type: 'bool', default: false }],
    draw(r, d, P) {
      const [a, b] = pad(P, 2), R = dist(a, b), t = Math.atan2(a[1] - b[1], a[0] - b[0]);
      dashed(r, [a, b]);
      arcLevels(r, d, b, R, R, d.style.fullCircles ? t - Math.PI : t - Math.PI / 2, d.style.fullCircles ? t + Math.PI : t + Math.PI / 2);
    },
  },
  {
    id: 'fibwedge', name: 'Fib wedge', icon: '◺', group: 'fib', points: 3,
    levels: ARC_LEVELS, defaults: { fillAlpha: 0.06 },
    props: [LABELS],
    draw(r, d, P) {
      const [o, b, c] = pad(P, 3), R = dist(o, b), a0 = Math.atan2(b[1] - o[1], b[0] - o[0]), a1 = Math.atan2(c[1] - o[1], c[0] - o[0]);
      const sweep = Math.atan2(Math.sin(a1 - a0), Math.cos(a1 - a0)), Rmax = R * Math.max(1, ...onLevels(d).map(l => l.v));
      for (const a of [a0, a0 + sweep]) r.line(o, [o[0] + Rmax * Math.cos(a), o[1] + Rmax * Math.sin(a)]);
      arcLevels(r, d, o, R, R, a0, a0 + sweep);
    },
  },
  {
    id: 'pitchfan', name: 'Pitchfan', icon: '⋀', group: 'fib', points: 3,
    levels: mkLevels([0, 0.382, 0.5, 0.618, 1], [0.236, 0.786]), defaults: { fillAlpha: 0.06 },
    props: [LABELS],
    draw(r, d, P) {
      const [o, b, c] = pad(P, 3);
      r.line(b, c, { width: 1 });
      fan(r, d, o, onLevels(d).map(l => ({ e: lerp(b, c, l.v), color: l.color, label: fmtV(l.v) })));
    },
  },
  {
    id: 'gannbox', name: 'Gann box', icon: '⊞', group: 'fib', points: 2,
    levels: GANN_LEVELS, defaults: { fillAlpha: 0.05 },
    props: [LABELS, { key: 'showAngles', label: 'Angles', type: 'bool', default: false }],
    draw(r, d, P) {
      const [a, b] = pad(P, 2), lv = onLevels(d);
      r.rect(a, b, { fill: false });
      if (d.style.fillAlpha > 0) lv.forEach((l, i) => {
        if (!i) return;
        const k0 = lv[i - 1].v, k1 = l.v, ya = a[1] + (b[1] - a[1]) * k0, yb = a[1] + (b[1] - a[1]) * k1;
        r.rect([a[0], ya], [b[0], yb], { fill: r.fill(l.color), stroke: false, noHit: true });
        r.rect([a[0] + (b[0] - a[0]) * k0, a[1]], [a[0] + (b[0] - a[0]) * k1, b[1]], { fill: r.fill(l.color), stroke: false, noHit: true });
      });
      grid(r, d, a, b, !!d.style.showLabels);
      if (d.style.showAngles) { r.line(a, b, { dash: 'dashed', width: 1 }); r.line([a[0], b[1]], [b[0], a[1]], { dash: 'dashed', width: 1 }) }
    },
  },
  gannSquare('gannsquarefixed', 'Gann square fixed', '⊡', true),
  gannSquare('gannsquare', 'Gann square', '▦', false),
  {
    // Ratios are price units per time unit relative to the 1x1 line P1→P2 (2x1 is steeper, 1x2 shallower).
    id: 'gannfan', name: 'Gann fan', icon: '⋇', group: 'fib', points: 2,
    levels: mkLevels([0.125, 0.25, 0.333, 0.5, 1, 2, 3, 4, 8]), defaults: { fillAlpha: 0.06 },
    props: [LABELS],
    draw(r, d, P) {
      const [a, b] = pad(P, 2), dx = b[0] - a[0], dy = b[1] - a[1];
      fan(r, d, a, onLevels(d).map(l => ({ e: [a[0] + dx, a[1] + dy * l.v] as XY, color: l.color, label: l.v >= 1 ? `${fmtV(l.v)}x1` : `1x${Math.round(1 / l.v)}` })));
    },
  },
];
