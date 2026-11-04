import { CrosshairMode, type IChartApi, type ISeriesApi, type ISeriesPrimitive, type IPrimitivePaneRenderer, type IPrimitivePaneView, type Logical, type SeriesType, type Time } from 'lightweight-charts';
import type { Bar } from './data.ts';
import type { Drawing, Geo, Pt, Style, ToolDef, XY } from './tools/types.ts';
import { RecordingRenderer, hitShapes, rgba, type HitShape } from './tools/render.ts';
import { TOOL_MAP, type CursorMode } from './tools/index.ts';
import { nearestOHLC } from './tools/math.ts';

export type { Drawing, Pt } from './tools/types.ts';
export type Magnet = 'off' | 'weak' | 'strong';
type Target = Parameters<IPrimitivePaneRenderer['draw']>[0];
interface Host { chart: IChartApi; series: ISeriesApi<SeriesType>; bars: () => Bar[]; tfSec: () => number; fmt: (p: number) => string }
interface Hit { d: Drawing; handle: number }

const BASE_STYLE: Style = {
  color: '#2962ff', width: 2, dash: 'solid', fillColor: '#2962ff', fillAlpha: 0,
  text: '', textColor: '#2962ff', fontSize: 13, bold: false, italic: false, extendLeft: false, extendRight: false,
};
/** Fresh style for a tool: base ← tool defaults ← tool props defaults ← user template ← chosen color. */
export function styleFor(def: ToolDef, color: string, template?: Partial<Style>): Style {
  const s: Style = { ...BASE_STYLE, color, fillColor: color, textColor: color, ...def.defaults };
  for (const p of def.props ?? []) s[p.key] = p.default;
  if (def.levels) s.levels = def.levels.map(l => ({ ...l }));
  return { ...s, ...structuredClone(template ?? {}) };
}
const isVisible = (d: Drawing, tfSec: number) => !d.hidden && (!d.vis || (tfSec >= d.vis.min && tfSec <= d.vis.max));

/**
 * All drawings of one chart, rendered as a single series primitive. Tools are pure ToolDefs;
 * this class owns creation, selection, dragging, hit-testing (via recorded paths) and cursor modes.
 */
export class DrawingLayer implements ISeriesPrimitive<Time> {
  drawings: Drawing[] = [];
  tool = 'cursor';                 // 'cursor' | 'zoom' | 'measure' | ToolDef id
  cursor: CursorMode = 'cross';
  keepDrawing = false;
  magnet: Magnet = 'off';
  hideAll = false;
  color = '#2962ff';
  templates: (type: string) => Partial<Style> | undefined = () => undefined;
  selected = new Set<Drawing>();

  onChange: () => void = () => {};                    // drawings mutated (persist + undo snapshot)
  onToolDone: () => void = () => {};                  // tool reverted to cursor
  onSelect: () => void = () => {};                    // selection changed
  onEdit: (d: Drawing, tab?: string) => void = () => {};
  onContext: (d: Drawing, e: MouseEvent) => void = () => {};

  private draft: { d: Drawing; raw: Pt[]; placed: number; def: ToolDef } | null = null;
  private freehand = false;
  private drag: { hit: Hit; k: number; x: number; y: number; orig: Pt[]; moved: boolean } | null = null;
  private measure: { a: Pt; b: Pt; done: boolean } | null = null;
  private zoomBox: { x0: number; y0: number; x1: number; y1: number } | null = null;
  private mouse: XY | null = null;
  private hits = new Map<Drawing, HitShape[]>();
  private requestUpdate = () => {};
  private view: IPrimitivePaneView;
  private subs = new Map<HTMLElement, () => void>();   // indicator panes we draw into: pane element -> requestUpdate
  private baseMode: CrosshairMode;

  constructor(private host: Host, private el: HTMLElement) {
    const renderer: IPrimitivePaneRenderer = { draw: t => this.render(t, 0) };
    this.view = { renderer: () => renderer, zOrder: () => 'top' };
    this.baseMode = host.chart.options().crosshair.mode;
    for (const ev of ['mousedown', 'mousemove', 'mouseup', 'dblclick', 'contextmenu', 'mouseleave'] as const)
      el.addEventListener(ev, e => this.onMouse(e), true);
    addEventListener('drawings-repaint', () => this.update()); // e.g. an image finished loading
  }
  attached({ requestUpdate }: { requestUpdate: () => void }) { this.requestUpdate = requestUpdate }
  paneViews() { return [this.view] }
  update() { this.attachPanes(); this.requestUpdate(); this.subs.forEach(u => u()) }
  /** Draw into every indicator pane too. Panes come and go (scripts re-render), so this runs on every update. */
  attachPanes() {
    const panes = this.host.chart.panes(), live = new Set<HTMLElement>();
    panes.forEach((pane, k) => {
      const el = pane.getHTMLElement(); if (!k || !el) return;
      live.add(el);
      if (this.subs.has(el)) return;
      const renderer: IPrimitivePaneRenderer = { draw: t => this.render(t, pane.paneIndex()) }, view: IPrimitivePaneView = { renderer: () => renderer, zOrder: () => 'top' };
      this.subs.set(el, () => {});
      pane.attachPrimitive({ paneViews: () => [view], attached: ({ requestUpdate }) => this.subs.set(el, requestUpdate) });
    });
    for (const el of this.subs.keys()) if (!live.has(el)) this.subs.delete(el);
  }
  /** Pane a drawing renders in: its own if that pane exists on this chart, else the main pane. */
  paneOf(d: Drawing): number { const k = d.pane ?? 0, p = this.host.chart.panes()[k]; return k && p?.getSeries().length ? k : 0 }

  get primary(): Drawing | null { return [...this.selected].at(-1) ?? null }
  select(ds: Drawing[], add = false) { if (!add) this.selected.clear(); ds.forEach(d => this.selected.add(d)); this.onSelect(); this.update() }
  setTool(t: string) { this.tool = t; this.draft = null; this.freehand = false; this.zoomBox = null; this.applyCursor(); this.update() }
  setCursor(c: CursorMode) { this.cursor = c; this.setTool('cursor') }
  add(d: Drawing) { this.drawings.push(d); this.select([d]); this.onChange() }
  remove(...ds: Drawing[]) {
    this.drawings = this.drawings.filter(x => !ds.includes(x));
    ds.forEach(d => this.selected.delete(d));
    this.onSelect(); this.onChange(); this.update();
  }
  reorder(d: Drawing, how: 'front' | 'back' | 'forward' | 'backward') {
    const a = this.drawings, i = a.indexOf(d); if (i < 0) return;
    a.splice(i, 1);
    const j = how === 'front' ? a.length : how === 'back' ? 0 : how === 'forward' ? Math.min(i + 1, a.length) : Math.max(i - 1, 0);
    a.splice(j, 0, d); this.onChange(); this.update();
  }
  /** Move selected drawings by whole bars / pixels (arrow keys). */
  nudge(bars: number, px: number) {
    for (const d of this.selected) { const g = this.geo(this.paneOf(d)); if (!d.locked) d.pts = d.pts.map(p => this.shift(p, bars * g.barWidth, px, g, TOOL_MAP.get(d.type))) }
    this.onChange(); this.update();
  }

  // ---------- coordinates ----------
  private logical(t: number): number {
    const b = this.host.bars(), n = b.length, sec = this.host.tfSec();
    if (!n) return 0;
    if (t >= b[n - 1].time) return n - 1 + (t - b[n - 1].time) / sec;
    if (t <= b[0].time) return (t - b[0].time) / sec;
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (b[m].time <= t) lo = m; else hi = m }
    return lo + (t - b[lo].time) / (b[hi].time - b[lo].time);
  }
  /** Fractional bar index -> time (interpolated between bars, extrapolated outside). */
  private timeAt(l: number): number {
    const b = this.host.bars(), n = b.length, sec = this.host.tfSec();
    if (!n) return 0;
    if (l <= 0) return b[0].time + l * sec;
    if (l >= n - 1) return b[n - 1].time + (l - n + 1) * sec;
    const i = Math.floor(l);
    return b[i].time + (l - i) * (b[i + 1].time - b[i].time);
  }
  /** Coordinates of pane k (0 = main): x from the shared time scale, y from that pane's first series. */
  geo(k = 0): Geo {
    const ts = this.host.chart.timeScale(), pane = this.host.chart.panes()[k], s = (k && pane?.getSeries()[0]) || this.host.series;
    const x0 = ts.logicalToCoordinate(0 as Logical) ?? 0, x1 = ts.logicalToCoordinate(1 as Logical) ?? 1;
    return {
      x: t => ts.logicalToCoordinate(this.logical(t) as Logical) ?? -1e4,
      y: p => s.priceToCoordinate(p) ?? -1e4,
      t: x => this.timeAt(ts.coordinateToLogical(x) ?? 0),
      p: y => s.coordinateToPrice(y) ?? 0,
      logical: t => this.logical(t), timeAt: l => this.timeAt(l),
      W: ts.width(), H: pane?.getHeight() ?? 0, barWidth: x1 - x0 || 1,
      bars: this.host.bars(), tfSec: this.host.tfSec(), fmt: this.host.fmt,
    };
  }
  private P(d: Drawing, g: Geo, def?: ToolDef): XY[] {
    return def?.screenAnchored ? d.pts.map(p => [p.t * g.W, p.p * g.H]) : d.pts.map(p => [g.x(p.t), g.y(p.p)]);
  }
  private toPt(x: number, y: number, g: Geo, def: ToolDef | undefined, e?: MouseEvent): Pt {
    if (def?.screenAnchored) return { t: x / g.W, p: y / g.H };
    const l = this.host.chart.timeScale().coordinateToLogical(x) ?? 0;
    const t = def?.points === 0 ? this.timeAt(l) : this.timeAt(Math.round(l)); // snap to bars except freehand
    let p = g.p(y);
    let mode = this.magnet;
    if (e?.ctrlKey) mode = mode === 'off' ? 'strong' : 'off'; // Ctrl temporarily inverts the magnet
    const bar = g.bars[Math.round(l)];
    if (mode !== 'off' && bar) {
      const best = nearestOHLC(bar, y, g.y);
      if (mode === 'strong' || Math.abs(g.y(best) - y) < 14) p = best;
    }
    return { t, p };
  }
  private shift(p: Pt, dx: number, dy: number, g: Geo, def?: ToolDef): Pt {
    if (def?.screenAnchored) return { t: p.t + dx / g.W, p: p.p + dy / g.H };
    const l = this.logical(p.t) + dx / g.barWidth;
    return { t: def?.points === 0 ? this.timeAt(l) : this.timeAt(Math.round(l)), p: g.p(g.y(p.p) + dy) };
  }

  // ---------- interaction ----------
  applyCursor() {
    const c = this.cursor, ch = this.tool === 'cursor' && (c === 'cross' || c === 'demo' || c === 'magic');
    // Magic cursor: the crosshair snaps to the nearest open/high/low/close of the hovered bar.
    const mode = this.tool === 'cursor' && c === 'magic' ? CrosshairMode.MagnetOHLC : this.baseMode;
    this.host.chart.applyOptions({ crosshair: { mode, vertLine: { visible: ch || this.tool !== 'cursor' }, horzLine: { visible: ch || this.tool !== 'cursor' } } });
    this.el.style.cursor = this.tool === 'zoom' ? 'zoom-in' : this.tool === 'measure' ? 'crosshair' : this.tool !== 'cursor' ? 'crosshair' : c === 'dot' ? 'none' : c === 'eraser' ? 'not-allowed' : c === 'arrow' ? 'default' : '';
  }
  /** Mouse position relative to the pane under it (or pane `force`); k = -1 outside every pane. */
  private local(e: MouseEvent, force?: number) {
    const r = this.el.getBoundingClientRect(), panes = this.host.chart.panes();
    const rect = (i: number) => panes[i]?.getHTMLElement()?.getBoundingClientRect();
    const k = force ?? panes.findIndex((_, i) => { const b = rect(i); return !!b && e.clientY >= b.top && e.clientY < b.bottom });
    const g = this.geo(Math.max(k, 0)), x = e.clientX - r.left, y = e.clientY - (rect(Math.max(k, 0))?.top ?? r.top);
    return { x, y, g, k, inPane: k >= 0 && x >= 0 && x <= g.W && y >= 0 && y <= g.H };
  }
  private onMouse(e: MouseEvent) {
    let { x, y, g, k, inPane } = this.local(e);
    if (this.drag) ({ x, y, g } = this.local(e, this.drag.k));
    else if (this.draft) { const dk = this.draft.d.pane ?? 0; inPane = inPane && k === dk; ({ x, y, g } = this.local(e, dk)); k = dk }
    const stop = () => { e.stopPropagation(); e.preventDefault() };
    this.mouse = inPane && k === 0 ? [x, y] : null;
    switch (e.type) {
      case 'mousedown': {
        if (e.button !== 0 || !inPane) return;
        if (this.draft && !this.freehand) { stop(); this.click(this.draft.def, this.toPt(x, y, g, this.draft.def, e), g); return }
        if (k && (this.tool === 'zoom' || this.tool === 'measure')) return;   // zoom box and ruler work in the main pane
        if (this.tool === 'zoom') { stop(); this.zoomBox = { x0: x, y0: y, x1: x, y1: y }; return }
        if (this.tool === 'measure') { stop(); const p = this.toPt(x, y, g, undefined, e); this.measure = { a: p, b: p, done: false }; return }
        const def = TOOL_MAP.get(this.tool);
        if (def) {
          stop();
          if (def.points === 0) { this.freehand = true; this.startDraft(def, this.toPt(x, y, g, def, e), k); }
          else this.click(def, this.toPt(x, y, g, def, e), g, k);
          return;
        }
        if (this.measure?.done) { this.measure = null; this.update() }
        const hit = this.findHit(x, y, k);
        if (this.cursor === 'eraser') { if (hit) { stop(); this.remove(hit.d) } return }
        if (e.shiftKey && !hit && !k) { stop(); const p = this.toPt(x, y, g, undefined, e); this.measure = { a: p, b: p, done: false }; return }
        if (!hit) { if (this.selected.size) this.select([]); return }
        if (e.ctrlKey && !e.altKey && this.selected.has(hit.d) && hit.handle < 0) { // Ctrl+drag clones
          const c = structuredClone(hit.d); c.id = Date.now(); c.locked = false;
          this.drawings.push(c); hit.d = c;
          this.select([c]);
        } else this.select([hit.d], e.ctrlKey);
        if (!hit.d.locked) { stop(); this.drag = { hit, k, x, y, orig: hit.d.pts.map(p => ({ ...p })), moved: false } }
        return;
      }
      case 'mousemove': {
        if (this.zoomBox) { stop(); this.zoomBox.x1 = x; this.zoomBox.y1 = y; this.update(); return }
        if (this.drag) { stop(); this.dragTo(x, y, g, e); return }
        if (this.measure && !this.measure.done) { this.measure.b = this.toPt(x, y, g, undefined, e); this.update(); return }
        if (this.draft) {
          const pt = this.toPt(x, y, g, this.draft.def, e);
          if (this.freehand) { const last = this.draft.raw.at(-1)!; if (Math.hypot(g.x(last.t) - x, g.y(last.p) - y) > 3 || this.draft.def.screenAnchored) this.draft.raw.push(pt) }
          else this.draft.raw[this.draft.placed] = pt;
          this.rebuildDraft(g);
          stop(); return;
        }
        if (this.tool === 'cursor' && this.cursor !== 'eraser') this.el.style.cursor = inPane && this.findHit(x, y, k) ? 'pointer' : this.cursor === 'dot' ? 'none' : this.cursor === 'arrow' ? 'default' : '';
        if (this.cursor === 'dot' || this.cursor === 'demo') this.update();
        return;
      }
      case 'mouseup': {
        if (this.zoomBox) { stop(); this.applyZoom(g); return }
        if (this.measure && !this.measure.done) {
          this.measure.done = true;
          if (this.tool === 'measure') { this.setTool('cursor'); this.onToolDone() }
          this.update(); return;
        }
        if (this.freehand && this.draft) { stop(); this.freehand = false; this.finishDraft(g); return }
        if (this.drag) { const moved = this.drag.moved; this.drag = null; if (moved) this.onChange() }
        return;
      }
      case 'dblclick': { const hit = inPane && this.findHit(x, y, k); if (hit) { stop(); this.onEdit(hit.d) } return }
      case 'contextmenu': { const hit = inPane && this.findHit(x, y, k); if (hit) { stop(); this.select([hit.d], this.selected.has(hit.d)); this.onContext(hit.d, e) } return }
      case 'mouseleave': this.mouse = null; this.update(); return;
    }
  }
  private startDraft(def: ToolDef, pt: Pt, pane = 0) {
    const raw = def.points === 1 || def.points === 0 ? [pt] : [pt, { ...pt }];
    const d: Drawing = { id: Date.now(), type: def.id, pts: raw.slice(), style: styleFor(def, this.color, this.templates(def.id)), ...(pane ? { pane } : {}) };
    this.draft = { d, raw, placed: 1, def };
  }
  private rebuildDraft(g: Geo) {
    const dr = this.draft!;
    dr.d.pts = dr.def.build ? dr.def.build(dr.raw.map(p => ({ ...p })), g, dr.d) : dr.raw.slice();
    this.update();
  }
  private click(def: ToolDef, pt: Pt, g: Geo, pane = 0) {
    if (!this.draft) this.startDraft(def, pt, pane);
    else this.draft.raw[this.draft.placed++] = pt;
    const dr = this.draft!;
    if (dr.placed < def.points) { if (dr.raw.length <= dr.placed) dr.raw.push({ ...pt }); this.rebuildDraft(g); return }
    dr.raw.length = def.points;
    this.finishDraft(g);
  }
  private finishDraft(g: Geo) {
    const { d, raw, def } = this.draft!;
    d.pts = def.build ? def.build(raw, g, d) : raw;
    this.draft = null;
    this.add(d);
    if (def.needsText) this.onEdit(d, 'text');
    if (!this.keepDrawing) { this.setTool('cursor'); this.onToolDone() }
    this.update();
  }
  private dragTo(x: number, y: number, g: Geo, e: MouseEvent) {
    const dr = this.drag!, d = dr.hit.d, def = TOOL_MAP.get(d.type);
    let dx = x - dr.x, dy = y - dr.y;
    if (!dr.moved && Math.hypot(dx, dy) < 2) return;
    dr.moved = true;
    if (dr.hit.handle < 0) {
      if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0 }   // axis-locked move
      d.pts = dr.orig.map(p => this.shift(p, dx, dy, g, def));
    } else {
      d.pts = dr.orig.map(p => ({ ...p }));
      const pt = this.toPt(x, y, g, def, e);
      if (def?.moveHandle) def.moveHandle(d, dr.hit.handle, pt, g); else d.pts[dr.hit.handle] = pt;
      if (def?.build) d.pts = def.build(d.pts, g, d);
    }
    this.update();
  }
  private applyZoom(g: Geo) {
    const z = this.zoomBox!; this.zoomBox = null;
    if (Math.abs(z.x1 - z.x0) > 8 && Math.abs(z.y1 - z.y0) > 8) {
      const ts = this.host.chart.timeScale();
      const l0 = ts.coordinateToLogical(Math.min(z.x0, z.x1)), l1 = ts.coordinateToLogical(Math.max(z.x0, z.x1));
      if (l0 != null && l1 != null) ts.setVisibleLogicalRange({ from: l0, to: l1 });
      this.host.series.priceScale().setVisibleRange({ from: g.p(Math.max(z.y0, z.y1)), to: g.p(Math.min(z.y0, z.y1)) });
    }
    this.setTool('cursor'); this.onToolDone();
  }

  // ---------- hit testing ----------
  handlesOf(d: Drawing, g = this.geo(this.paneOf(d))): XY[] {
    const def = TOOL_MAP.get(d.type), P = this.P(d, g, def);
    return def?.handles ? def.handles(d, P, g) : P;
  }
  findHit(x: number, y: number, k = 0): Hit | null {
    const g = this.geo(k);
    for (const d of this.selected) {
      if (!isVisible(d, g.tfSec) || this.hideAll || this.paneOf(d) !== k) continue;
      const h = this.handlesOf(d, g).findIndex(([hx, hy]) => Math.hypot(hx - x, hy - y) < 7);
      if (h >= 0) return { d, handle: h };
    }
    for (const d of [...this.drawings].reverse()) {
      const shapes = this.paneOf(d) === k && this.hits.get(d);
      if (shapes && hitShapes(shapes, x, y)) return { d, handle: -1 };
    }
    return null;
  }

  // ---------- rendering ----------
  private render(target: Target, k: number) {
    target.useMediaCoordinateSpace(({ context: ctx }: { context: CanvasRenderingContext2D }) => {
      const g = this.geo(k);
      for (const d of this.drawings) if (this.paneOf(d) === k) {
        this.hits.delete(d);
        if (!this.hideAll && isVisible(d, g.tfSec)) this.renderOne(ctx, d, g, true);
      }
      if (this.draft && (this.draft.d.pane ?? 0) === k) this.renderOne(ctx, this.draft.d, g, false);
      if (k) return;
      if (this.measure) this.renderMeasure(ctx, g);
      if (this.zoomBox) {
        const z = this.zoomBox;
        ctx.fillStyle = rgba('#2962ff', 0.12); ctx.strokeStyle = '#2962ff'; ctx.setLineDash([4, 3]);
        ctx.fillRect(Math.min(z.x0, z.x1), Math.min(z.y0, z.y1), Math.abs(z.x1 - z.x0), Math.abs(z.y1 - z.y0));
        ctx.strokeRect(Math.min(z.x0, z.x1), Math.min(z.y0, z.y1), Math.abs(z.x1 - z.x0), Math.abs(z.y1 - z.y0));
        ctx.setLineDash([]);
      }
      if (this.mouse && this.tool === 'cursor' && (this.cursor === 'dot' || this.cursor === 'demo')) {
        ctx.beginPath();
        ctx.arc(this.mouse[0], this.mouse[1], this.cursor === 'demo' ? 18 : 3, 0, Math.PI * 2);
        ctx.fillStyle = this.cursor === 'demo' ? rgba('#ff9800', 0.35) : '#787b86';
        ctx.fill();
      }
    });
  }
  private renderOne(ctx: CanvasRenderingContext2D, d: Drawing, g: Geo, record: boolean) {
    const def = TOOL_MAP.get(d.type); if (!def) return;
    const sel = this.selected.has(d) || this.draft?.d === d;
    const r = new RecordingRenderer(ctx, d.style, sel, g.W, g.H);
    ctx.save();
    try { def.draw(r, d, this.P(d, g, def), g) } catch (err) { console.error(`draw ${d.type}`, err) }
    ctx.restore();
    if (record) this.hits.set(d, r.shapes);
    if (sel) for (const [hx, hy] of this.handlesOf(d, g)) {
      ctx.beginPath(); ctx.arc(hx, hy, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = d.locked ? '#787b86' : '#fff'; ctx.fill();
      ctx.strokeStyle = d.style.color; ctx.lineWidth = 1.5; ctx.stroke();
    }
  }
  private renderMeasure(ctx: CanvasRenderingContext2D, g: Geo) {
    const { a, b } = this.measure!, up = b.p >= a.p, c = up ? '#2962ff' : '#f23645';
    const r = new RecordingRenderer(ctx, { ...BASE_STYLE, color: c }, false, g.W, g.H);
    const A: XY = [g.x(a.t), g.y(a.p)], B: XY = [g.x(b.t), g.y(b.p)];
    r.rect(A, B, { fill: r.fill(c, 0.15), stroke: false });
    r.line([(A[0] + B[0]) / 2, A[1]], [(A[0] + B[0]) / 2, B[1]], { width: 1, arrowEnd: true });
    r.line([A[0], (A[1] + B[1]) / 2], [B[0], (A[1] + B[1]) / 2], { width: 1, arrowEnd: true });
    const diff = b.p - a.p, bars = Math.round(g.logical(b.t) - g.logical(a.t));
    let vol = 0;
    for (let i = Math.max(0, Math.round(g.logical(Math.min(a.t, b.t)))); i <= Math.min(g.bars.length - 1, Math.round(g.logical(Math.max(a.t, b.t)))); i++) vol += g.bars[i].volume;
    r.label(`${diff >= 0 ? '+' : ''}${g.fmt(diff)} (${((diff / a.p) * 100).toFixed(2)}%)\n${bars} bars · Vol ${vol.toFixed(2)}`, [(A[0] + B[0]) / 2, Math.max(A[1], B[1]) + 22], c);
  }
}
