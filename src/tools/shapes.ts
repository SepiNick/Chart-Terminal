// Brushes, arrows and geometric shapes beyond Rectangle.
import type { Drawing, Geo, Pt, Renderer, ToolDef, XY } from './types.ts';

const mid = (a: XY, b: XY): XY => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const centroid = (P: XY[]): XY => [P.reduce((s, q) => s + q[0], 0) / P.length, P.reduce((s, q) => s + q[1], 0) / P.length];
/** Style text centered inside a closed shape. */
const ctext = (r: Renderer, d: Drawing, at: XY) => { if (d.style.text) r.text(d.style.text, at, { align: 'center', baseline: 'middle' }) };
const roundCaps = (r: Renderer, f: () => void) => { const c = r.ctx; c.save(); c.lineCap = 'round'; c.lineJoin = 'round'; f(); c.restore() };
const ARROWS = [{ key: 'arrowStart', label: 'Arrow at start', type: 'bool', default: false }, { key: 'arrowEnd', label: 'Arrow at end', type: 'bool', default: false }] as const;

/** Ramer–Douglas–Peucker: indices of the points kept within `eps` px of the simplified line. */
function rdp(P: XY[], eps: number, a = 0, b = P.length - 1, out: number[] = [0]): number[] {
  const [ax, ay] = P[a], dx = P[b][0] - ax, dy = P[b][1] - ay, L = Math.hypot(dx, dy);
  let far = -1, dm = eps;
  for (let i = a + 1; i < b; i++) {
    const e = L ? Math.abs(dx * (P[i][1] - ay) - dy * (P[i][0] - ax)) / L : Math.hypot(P[i][0] - ax, P[i][1] - ay);
    if (e > dm) { dm = e; far = i }
  }
  if (far < 0) out.push(b); else { rdp(P, eps, a, far, out); rdp(P, eps, far, b, out) }
  return out;
}
/** build(): freehand samples → straight segments (screen-space RDP). Idempotent on already-simplified points. */
const simplify = (eps: number) => (pts: Pt[], g: Geo): Pt[] => (pts.length < 3 ? pts : rdp(pts.map(p => [g.x(p.t), g.y(p.p)] as XY), eps).map(i => pts[i]));

/** Filled block-arrow outline from tail a to tip b. */
function arrowShape(a: XY, b: XY, shaft: number, head: number, headLen: number): XY[] {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, h = Math.min(headLen, L);
  const at = (along: number, side: number): XY => [a[0] + ux * along - uy * side, a[1] + uy * along + ux * side];
  return [at(0, shaft), at(L - h, shaft), at(L - h, head), at(L, 0), at(L - h, -head), at(L - h, -shaft), at(0, -shaft)];
}
/** Solid block arrow plus style text just beyond its tail. */
function blockArrow(r: Renderer, d: Drawing, tail: XY, tip: XY, shaft: number) {
  const L = Math.hypot(tip[0] - tail[0], tip[1] - tail[1]);
  if (!(L >= 2)) return;
  r.poly(arrowShape(tail, tip, shaft, shaft * 2.4, shaft * 3), true, { fill: d.style.color, stroke: false });
  if (!d.style.text) return;
  const ux = (tip[0] - tail[0]) / L, uy = (tip[1] - tail[1]) / L, horiz = Math.abs(ux) > 0.7;
  r.text(d.style.text, [tail[0] - ux * 6, tail[1] - uy * 6], {
    align: horiz ? (ux > 0 ? 'right' : 'left') : 'center', baseline: horiz ? 'middle' : uy > 0 ? 'bottom' : 'top',
  });
}
function mark(id: string, name: string, icon: string, dir: XY, color?: string): ToolDef {
  return {
    id, name, icon, group: 'shapes', points: 1, defaults: color ? { color, textColor: color } : {},
    draw(r, d, P) { blockArrow(r, d, [P[0][0] - dir[0] * 24, P[0][1] - dir[1] * 24], P[0], 4) }, // tip anchored at the point
  };
}

/** Rotated rect corners: P0-P1 is one side, P2's perpendicular distance from it is the width. */
function rrect([a, b, p]: XY[]): XY[] {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L;
  const w = (p[0] - a[0]) * nx + (p[1] - a[1]) * ny;
  return [a, b, [b[0] + nx * w, b[1] + ny * w], [a[0] + nx * w, a[1] + ny * w]];
}
/** Circle through 3 points, or null if (nearly) collinear. */
function circle3(a: XY, b: XY, c: XY): [XY, number] | null {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  if (Math.abs(d) < 1e-6) return null;
  const s = (p: XY) => p[0] ** 2 + p[1] ** 2;
  const u: XY = [(s(a) * (b[1] - c[1]) + s(b) * (c[1] - a[1]) + s(c) * (a[1] - b[1])) / d, (s(a) * (c[0] - b[0]) + s(b) * (a[0] - c[0]) + s(c) * (b[0] - a[0])) / d];
  const R = Math.hypot(a[0] - u[0], a[1] - u[1]);
  return R < 1e5 ? [u, R] : null;
}
/** Quadratic control point so the curve passes through m at t = 0.5. */
const quadCtl = (a: XY, b: XY, m: XY): XY => [2 * m[0] - (a[0] + b[0]) / 2, 2 * m[1] - (a[1] + b[1]) / 2];

export const SHAPE_TOOLS: ToolDef[] = [
  {
    id: 'brush', name: 'Brush', icon: '✐', group: 'shapes', points: 0, defaults: { fillAlpha: 0.2 },
    props: [...ARROWS, { key: 'closed', label: 'Close & fill shape', type: 'bool', default: false }],
    draw(r, d, P) {
      const n = P.length;
      if (n < 2) return;
      roundCaps(r, () => {
        if (d.style.closed) { r.spline(P, { closed: true }); return }
        r.spline(P, { arrowEnd: !!d.style.arrowEnd });
        if (d.style.arrowStart) r.line(P[Math.min(3, n - 1)], P[0], { arrowEnd: true });
      });
    },
    handles: () => [], // freehand path: move as a whole
  },
  {
    id: 'highlighter', name: 'Highlighter', icon: '▰', group: 'shapes', points: 0, defaults: { color: '#ffeb3b', width: 12 },
    draw(r, d, P) { roundCaps(r, () => r.spline(P, { color: r.fill(d.style.color, 0.4) })) },
    handles: () => [],
  },
  {
    id: 'arrowline', name: 'Arrow', icon: '↗', group: 'shapes', points: 2,
    draw(r, d, P) {
      r.line(P[0], P[1], { arrowEnd: true });
      if (d.style.text) r.text(d.style.text, [(P[0][0] + P[1][0]) / 2, (P[0][1] + P[1][1]) / 2 - 4], { align: 'center' });
    },
  },
  {
    id: 'arrowmarker', name: 'Arrow marker', icon: '➜', group: 'shapes', points: 2,
    draw(r, d, P) { blockArrow(r, d, P[0], P[1], Math.max(3, Math.min(12, Math.hypot(P[1][0] - P[0][0], P[1][1] - P[0][1]) * 0.07))) },
  },
  mark('arrowmarkup', 'Arrow mark up', '⬆', [0, -1], '#089981'),
  mark('arrowmarkdown', 'Arrow mark down', '⬇', [0, 1], '#f23645'),
  mark('arrowmarkleft', 'Arrow mark left', '⬅', [-1, 0]),
  mark('arrowmarkright', 'Arrow mark right', '➡', [1, 0]),
  {
    id: 'rotrect', name: 'Rotated rectangle', icon: '◇', group: 'shapes', points: 3, defaults: { fillAlpha: 0.15 },
    draw(r, d, P) {
      if (P.length < 3) { r.line(P[0], P[1]); return }
      const c = rrect(P);
      r.poly(c, true);
      ctext(r, d, mid(c[0], c[2]));
    },
    // Third handle sits on the far side's midpoint; only its perpendicular distance matters.
    handles: (_d, P) => (P.length < 3 ? P : [P[0], P[1], mid(rrect(P)[2], rrect(P)[3])]),
  },
  {
    // Drag a freehand stroke; it is simplified to straight segments, each vertex then editable.
    id: 'path', name: 'Path', icon: '⟿', group: 'shapes', points: 0, build: simplify(6),
    props: [ARROWS[0], { ...ARROWS[1], default: true }],
    draw(r, d, P) { r.poly(P, false, { arrowStart: !!d.style.arrowStart, arrowEnd: !!d.style.arrowEnd }) },
  },
  {
    id: 'circle', name: 'Circle', icon: '◯', group: 'shapes', points: 2, defaults: { fillAlpha: 0.15 },
    draw(r, d, P) { const R = Math.hypot(P[1][0] - P[0][0], P[1][1] - P[0][1]); r.ellipse(P[0], R, R); ctext(r, d, P[0]) },
  },
  {
    id: 'ellipse', name: 'Ellipse', icon: '⬭', group: 'shapes', points: 2, defaults: { fillAlpha: 0.15 },
    draw(r, d, P) { const c = mid(P[0], P[1]); r.ellipse(c, (P[1][0] - P[0][0]) / 2, (P[1][1] - P[0][1]) / 2); ctext(r, d, c) },
  },
  {
    // Like Path but closed and filled.
    id: 'polyline', name: 'Polyline', icon: '⬠', group: 'shapes', points: 0, build: simplify(8), defaults: { fillAlpha: 0.15 },
    draw(r, d, P) { r.poly(P, P.length > 2); if (P.length > 2) ctext(r, d, centroid(P)) },
  },
  {
    id: 'triangle', name: 'Triangle', icon: '△', group: 'shapes', points: 3, defaults: { fillAlpha: 0.15 },
    draw(r, d, P) { r.poly(P, P.length > 2); if (P.length > 2) ctext(r, d, centroid(P)) },
  },
  {
    // Clicks: start, end, then a point the arc passes through.
    id: 'arc', name: 'Arc', icon: '◠', group: 'shapes', points: 3,
    draw(r, _d, P) {
      const c = P.length > 2 && circle3(P[0], P[1], P[2]);
      if (!c) { r.line(P[0], P[1]); return }
      const [u, R] = c, T = Math.PI * 2, ang = (p: XY) => Math.atan2(p[1] - u[1], p[0] - u[0]), a0 = ang(P[0]);
      const norm = (a: number) => (((a - a0) % T) + T) % T, e = norm(ang(P[1])), m = norm(ang(P[2]));
      r.arc(u, R, a0, m < e ? a0 + e : a0 + e - T); // direction chosen so the arc passes through P2
    },
  },
  {
    // Clicks: start, end, then the curve's midpoint (t = 0.5) — the handle stays on the curve.
    id: 'curve', name: 'Curve', icon: '⌣', group: 'shapes', points: 3,
    draw(r, _d, P) { if (P.length < 3) r.line(P[0], P[1]); else r.bezier([P[0], quadCtl(P[0], P[1], P[2]), P[1]]) },
  },
  {
    // Clicks: start, end, then on-curve points at t = 1/3 and t = 2/3 (put them on opposite sides for an S).
    id: 'doublecurve', name: 'Double curve', icon: '∽', group: 'shapes', points: 4,
    draw(r, _d, P) {
      if (P.length < 3) { r.line(P[0], P[1]); return }
      if (P.length < 4) { r.bezier([P[0], quadCtl(P[0], P[1], P[2]), P[1]]); return }
      const [a, e, b1, b2] = P, q1 = [0, 1].map(k => 27 * b1[k] - 8 * a[k] - e[k]), q2 = [0, 1].map(k => 27 * b2[k] - a[k] - 8 * e[k]);
      const c1: XY = [(2 * q1[0] - q2[0]) / 18, (2 * q1[1] - q2[1]) / 18], c2: XY = [(2 * q2[0] - q1[0]) / 18, (2 * q2[1] - q1[1]) / 18];
      r.bezier([a, c1, c2, e]);
    },
  },
];
