import type { Dash, FillOpts, Renderer, StrokeOpts, Style, TextOpts, XY } from './types.ts';

export interface HitShape { path: Path2D; filled: boolean }

export function rgba(hex: string, a: number): string {
  if (!hex.startsWith('#') || (hex.length !== 7 && hex.length !== 4)) return hex;
  const h = hex.length === 4 ? hex.slice(1).split('').map(c => c + c).join('') : hex.slice(1);
  const n = parseInt(h, 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}
const DASH: Record<Dash, number[]> = { solid: [], dashed: [6, 4], dotted: [1.5, 3] };
const FAR = 1e5;

/** Canvas renderer that records a hit path for every primitive it paints. */
export class RecordingRenderer implements Renderer {
  shapes: HitShape[] = [];
  constructor(public ctx: CanvasRenderingContext2D, public style: Style, public selected: boolean, private W: number, private H: number) {}

  fill(hex = this.style.fillColor, alpha = this.style.fillAlpha) { return rgba(hex, alpha) }
  hit(path: Path2D, filled: boolean) { this.shapes.push({ path, filled }) }

  private stroke(path: Path2D, o: StrokeOpts = {}) {
    const c = this.ctx;
    c.strokeStyle = o.color ?? this.style.color;
    c.lineWidth = (o.width ?? this.style.width) + (this.selected ? 0.5 : 0);
    c.setLineDash(DASH[o.dash ?? this.style.dash]);
    c.stroke(path);
    c.setLineDash([]);
    if (!o.noHit) this.hit(path, false);
  }
  private arrowHead(from: XY, to: XY, o: StrokeOpts) {
    const a = Math.atan2(to[1] - from[1], to[0] - from[0]), s = 6 + (o.width ?? this.style.width) * 2;
    const p = new Path2D();
    p.moveTo(to[0] - s * Math.cos(a - 0.45), to[1] - s * Math.sin(a - 0.45));
    p.lineTo(to[0], to[1]);
    p.lineTo(to[0] - s * Math.cos(a + 0.45), to[1] - s * Math.sin(a + 0.45));
    this.stroke(p, { ...o, dash: 'solid', noHit: true });
  }
  line(a: XY, b: XY, o: StrokeOpts = {}) {
    const p = new Path2D(); p.moveTo(a[0], a[1]); p.lineTo(b[0], b[1]);
    this.stroke(p, o);
    if (o.arrowEnd) this.arrowHead(a, b, o);
    if (o.arrowStart) this.arrowHead(b, a, o);
  }
  ray(a: XY, b: XY, extendStart: boolean, extendEnd: boolean, o: StrokeOpts = {}) {
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1, k = FAR / len;
    const s: XY = extendStart ? [a[0] - dx * k, a[1] - dy * k] : a;
    const e: XY = extendEnd ? [b[0] + dx * k, b[1] + dy * k] : b;
    this.line(s, e, { ...o, arrowEnd: o.arrowEnd && !extendEnd, arrowStart: o.arrowStart && !extendStart });
  }
  hline(y: number, x0 = 0, x1 = this.W, o: StrokeOpts = {}) { this.line([x0, y], [x1, y], o) }
  vline(x: number, o: StrokeOpts = {}) { this.line([x, 0], [x, this.H], o) }
  private shape(p: Path2D, o: FillOpts & StrokeOpts) {
    const fill = o.fill === undefined ? (this.style.fillAlpha > 0 ? this.fill() : false) : o.fill;
    if (fill) { this.ctx.fillStyle = fill; this.ctx.fill(p); if (!o.noHit) this.hit(p, true) }
    if (o.stroke !== false) this.stroke(p, { ...o, color: typeof o.stroke === 'string' ? o.stroke : o.color });
  }
  poly(pts: XY[], closed: boolean, o: FillOpts & StrokeOpts = {}) {
    if (pts.length < 2) return;
    const p = new Path2D(); p.moveTo(pts[0][0], pts[0][1]);
    for (const q of pts.slice(1)) p.lineTo(q[0], q[1]);
    if (closed) { p.closePath(); this.shape(p, o) }
    else {
      this.stroke(p, o);
      if (o.arrowEnd) this.arrowHead(pts[pts.length - 2], pts[pts.length - 1], o);
      if (o.arrowStart) this.arrowHead(pts[1], pts[0], o);
    }
  }
  rect(a: XY, b: XY, o: FillOpts = {}) {
    const p = new Path2D(); p.rect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
    this.shape(p, o);
  }
  ellipse(c: XY, rx: number, ry: number, rotation = 0, o: FillOpts = {}) {
    const p = new Path2D(); p.ellipse(c[0], c[1], Math.abs(rx), Math.abs(ry), rotation, 0, Math.PI * 2);
    this.shape(p, o);
  }
  arc(c: XY, r: number, a0: number, a1: number, o: StrokeOpts = {}) {
    const p = new Path2D(); p.arc(c[0], c[1], Math.abs(r), a0, a1, a1 < a0);
    this.stroke(p, o);
  }
  bezier(pts: XY[], o: StrokeOpts = {}) {
    const p = new Path2D(); p.moveTo(pts[0][0], pts[0][1]);
    if (pts.length === 3) p.quadraticCurveTo(pts[1][0], pts[1][1], pts[2][0], pts[2][1]);
    else p.bezierCurveTo(pts[1][0], pts[1][1], pts[2][0], pts[2][1], pts[3][0], pts[3][1]);
    this.stroke(p, o);
  }
  spline(pts: XY[], o: StrokeOpts & { closed?: boolean; fill?: string | false } = {}) {
    if (pts.length < 2) return;
    const p = new Path2D(), n = pts.length, at = (i: number) => pts[o.closed ? (i + n) % n : Math.max(0, Math.min(n - 1, i))];
    p.moveTo(pts[0][0], pts[0][1]);
    for (let i = 0; i < (o.closed ? n : n - 1); i++) {
      const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
      p.bezierCurveTo(p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6, p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6, p2[0], p2[1]);
    }
    if (o.closed) { p.closePath(); this.shape(p, { ...o, fill: o.fill }) } else this.stroke(p, o);
    if (o.arrowEnd && !o.closed) this.arrowHead(pts[n - 2], pts[n - 1], o);
  }
  text(s: string, at: XY, o: TextOpts = {}): [number, number, number, number] {
    const c = this.ctx, size = o.size ?? this.style.fontSize, pad = o.pad ?? (o.bg ? 4 : 0);
    c.font = `${o.italic ?? this.style.italic ? 'italic ' : ''}${o.bold ?? this.style.bold ? 'bold ' : ''}${size}px system-ui, sans-serif`;
    const lines = s.split('\n'), lh = size * 1.25;
    const w = Math.max(...lines.map(l => c.measureText(l).width)) + pad * 2, h = lines.length * lh + pad * 2;
    const align = o.align ?? 'left', base = o.baseline ?? 'bottom';
    const x0 = align === 'center' ? at[0] - w / 2 : align === 'right' || align === 'end' ? at[0] - w : at[0];
    const y0 = base === 'middle' ? at[1] - h / 2 : base === 'top' || base === 'hanging' ? at[1] : at[1] - h;
    if (o.bg) { c.fillStyle = o.bg; c.fillRect(x0, y0, w, h) }
    if (o.border) { c.strokeStyle = o.border; c.lineWidth = 1; c.strokeRect(x0, y0, w, h) }
    c.fillStyle = o.color ?? this.style.textColor; c.textAlign = 'left'; c.textBaseline = 'top';
    lines.forEach((l, i) => c.fillText(l, x0 + pad, y0 + pad + i * lh + (lh - size) / 2));
    if (!o.noHit) { const p = new Path2D(); p.rect(x0, y0, w, h); this.hit(p, true) }
    return [x0, y0, w, h];
  }
  label(s: string, at: XY, bg: string, o: TextOpts = {}) {
    this.text(s, at, { color: '#fff', size: 11, align: 'center', baseline: 'middle', bg, pad: 4, ...o });
  }
}

/** Hit-tests recorded shapes. Strokes get a tolerance band of `tol` px. */
const hitCtx = (() => { try { return new OffscreenCanvas(1, 1).getContext('2d') } catch { return document.createElement('canvas').getContext('2d') } })() as CanvasRenderingContext2D;
export function hitShapes(shapes: HitShape[], x: number, y: number, tol = 8): boolean {
  hitCtx.lineWidth = tol;
  return shapes.some(s => (s.filled ? hitCtx.isPointInPath(s.path, x, y) : hitCtx.isPointInStroke(s.path, x, y)));
}
