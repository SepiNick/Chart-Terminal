// OnRender as a snapshot: after the bar loop, OnRender(chartControl, chartScale) runs ONCE and the common SharpDX
// RenderTarget calls become ordinary drawings (lines, boxes, polygons, labels) in time/price coordinates.
// With `view` (the chart's visible bars and pane size) pixels are the chart's own and the host re-runs on scroll/zoom;
// without it they are virtual: x = bar index × BAR_PX, y maps the run's whole price range onto HEIGHT px.
import type { Engine } from './base.ts';
import { css } from './brushes.ts';
import type { NtDateTime } from './helpers.ts';
import type { BarsCtx } from './series.ts';

export const BAR_PX = 10, HEIGHT = 1000;

export class Vector2 { X: number; Y: number; constructor(x = 0, y = 0) { this.X = x; this.Y = y } }
export class RectangleF {
  X: number; Y: number; Width: number; Height: number;
  constructor(x = 0, y = 0, w = 0, h = 0) { this.X = x; this.Y = y; this.Width = w; this.Height = h }
  get Left() { return this.X } get Top() { return this.Y } get Right() { return this.X + this.Width } get Bottom() { return this.Y + this.Height }
}
export class Ellipse { Point: Vector2; RadiusX: number; RadiusY: number; constructor(p = new Vector2(), rx = 0, ry = 0) { this.Point = p; this.RadiusX = rx; this.RadiusY = ry } }
export class RoundedRectangle { Rect: RectangleF; RadiusX: number; RadiusY: number; constructor(r = new RectangleF(), rx = 0, ry = 0) { this.Rect = r; this.RadiusX = rx; this.RadiusY = ry } }
export class TextFormat {
  FontFamilyName: string; FontSize: number; TextAlignment = 'Leading'; WordWrapping = 'NoWrap';
  /** TextFormat(factory, family, [weight, style, stretch,] size) */
  constructor(_f?: unknown, family = 'Arial', ...rest: unknown[]) { this.FontFamilyName = String(family); this.FontSize = Number(rest.findLast(x => typeof x === 'number') ?? 12) }
  Dispose() { }
}
export class TextLayout {
  Text: string; Format: TextFormat; MaxWidth: number; MaxHeight: number;
  constructor(_f: unknown, text: unknown, format: TextFormat, w = 0, h = 0) { this.Text = String(text ?? ''); this.Format = format; this.MaxWidth = w; this.MaxHeight = h }
  get Metrics() { const s = this.Format?.FontSize ?? 12; return { Width: this.Text.length * s * 0.6, Height: s * 1.2 } }
  Dispose() { }
}
/** SharpDX.Direct2D1.PathGeometry: figures of straight segments. */
export class PathGeometry {
  figures: { pts: Vector2[]; closed: boolean }[] = [];
  constructor(_factory?: unknown) { }
  Open() {
    const g = this; let cur: { pts: Vector2[]; closed: boolean } | null = null;
    return {
      BeginFigure: (p: Vector2) => { cur = { pts: [p], closed: false } },
      AddLine: (p: Vector2) => { cur?.pts.push(p) },
      AddLines: (ps: Vector2[]) => { cur?.pts.push(...ps) },
      EndFigure: (end?: unknown) => { if (cur) { cur.closed = String(end) === 'Closed'; g.figures.push(cur); cur = null } },
      Close: () => { }, Dispose: () => { },
    };
  }
  Dispose() { }
}
export const DX = { Vector2, RectangleF, Ellipse, RoundedRectangle, TextFormat, TextLayout, PathGeometry, DirectWriteFactory: {}, Direct2DFactory: {}, FigureBegin: { Filled: 'Filled', Hollow: 'Hollow' }, FigureEnd: { Open: 'Open', Closed: 'Closed' } };

export interface RenderView { from: number; to: number; width: number; height: number }
export function renderSnapshot(s: any, e: Engine, view?: RenderView) {
  const ctx: BarsCtx = s.__ctx, bars = ctx.bars, N = bars.length;
  if (!N) return;
  const F = view ? Math.max(0, Math.min(N - 1, Math.floor(view.from))) : 0, T = view ? Math.max(F, Math.min(N - 1, Math.ceil(view.to))) : N - 1;
  const PX = view ? view.width / Math.max(1, view.to - view.from) : BAR_PX, H = view?.height || HEIGHT, x0 = view ? view.from : 0;
  let lo = Infinity, hi = -Infinity;
  for (let i = F; i <= T; i++) { lo = Math.min(lo, bars[i].low); hi = Math.max(hi, bars[i].high) }
  if (!(hi > lo)) { hi = lo + 1; lo -= 1 }
  const yOf = (v: number) => ((hi - v) / (hi - lo)) * H, vOf = (y: number) => hi - (y / H) * (hi - lo);
  const xOf = (i: number) => (i - x0) * PX, iOf = (x: number) => x / PX + x0;
  const tOf = (x: number) => { const f = iOf(x), i = Math.max(0, Math.min(N - 1, Math.floor(f))); return Math.round(bars[i].time + (f - i) * ctx.tfSec) };
  const chartBars = { FromIndex: F, ToIndex: T, Count: N, Bars: ctx.barsObj, GetBarIdxByX: (_c: unknown, x: number) => Math.round(iOf(x)), GetTimeByBarIdx: (_c: unknown, i: number) => ctx.barsObj.GetTime(i) };
  const chartControl = {
    GetXByBarIndex: (_cb: unknown, i: number) => xOf(i), GetXByTime: (t: NtDateTime) => xOf(ctx.indexAt(t)),
    GetBarPaintWidth: () => PX * 0.6, BarWidth: PX * 0.3, BarMarginRight: 0, CanvasLeft: 0, CanvasRight: view ? view.width : N * PX,
    GetTimeBySlotIndex: (i: number) => ctx.barsObj.GetTime(Math.max(0, Math.min(N - 1, Math.round(i)))), GetSlotIndexByX: (x: number) => Math.round(iOf(x)),
    Properties: { ChartBackground: null, ChartText: null, LabelFont: null }, ChartPanels: [], Instrument: ctx.instrument, BarsPeriod: ctx.period,
  };
  const chartScale = { GetYByValue: yOf, GetYByValueWpf: yOf, GetValueByY: vOf, GetValueByYWpf: vOf, MaxValue: hi, MinValue: lo, MaxMinusMin: hi - lo, Height: H, Width: view ? view.width : N * PX, IsVisible: true };
  let k = 0;
  const color = (b: unknown) => css((b as any)?.__wpf ?? b) ?? '#1e90ff';
  const put = (r: Record<string, unknown>) => { const tag = `__render${++k}`; e.draws.set(tag, { tag, Tag: tag, ...r }) };
  const line = (x1: number, y1: number, x2: number, y2: number, b: unknown) => put({ type: 'line', t1: tOf(x1), p1: vOf(y1), t2: tOf(x2), p2: vOf(y2), color: color(b) });
  const rect = (r: RectangleF, b: unknown) => put({ type: 'rect', t1: tOf(r.X), p1: vOf(r.Y), t2: tOf(r.X + r.Width), p2: vOf(r.Y + r.Height), color: color(b) });
  const ellipse = (el: Ellipse, b: unknown) => {   // polygon of 24 segments
    const P = (a: number) => [el.Point.X + el.RadiusX * Math.cos(a), el.Point.Y + el.RadiusY * Math.sin(a)];
    for (let j = 0; j < 24; j++) { const [x1, y1] = P((j / 24) * 2 * Math.PI), [x2, y2] = P(((j + 1) / 24) * 2 * Math.PI); line(x1, y1, x2, y2, b) }
  };
  const text = (t: unknown, x: number, y: number, b: unknown) => put({ type: 'text', t1: tOf(x), p1: vOf(y), text: String(t ?? ''), color: color(b) });
  // FillGeometry draws the outline too: the drawing layer has no filled polygon.
  const geometry = (g: unknown, b: unknown) => {
    if (!(g instanceof PathGeometry)) return e.warn('RenderTarget.DrawGeometry: only PathGeometry is supported; ignored');
    for (const f of g.figures) {
      const pts = f.closed ? [...f.pts, f.pts[0]] : f.pts;
      for (let j = 1; j < pts.length; j++) line(pts[j - 1].X, pts[j - 1].Y, pts[j].X, pts[j].Y, b);
    }
  };
  const rt = {
    AntialiasMode: 'PerPrimitive', Transform: null, __rt: true,
    DrawLine: (a: Vector2, z: Vector2, b: unknown) => line(a.X, a.Y, z.X, z.Y, b),
    DrawRectangle: rect, FillRectangle: rect,
    DrawRoundedRectangle: (r: RoundedRectangle, b: unknown) => rect(r.Rect, b), FillRoundedRectangle: (r: RoundedRectangle, b: unknown) => rect(r.Rect, b),
    DrawEllipse: ellipse, FillEllipse: ellipse,
    DrawText: (t: unknown, _f: unknown, r: RectangleF, b: unknown) => text(t, r.X, r.Y, b),
    DrawTextLayout: (p: Vector2, l: TextLayout, b: unknown) => text(l.Text, p.X, p.Y, b),
    DrawGeometry: geometry, FillGeometry: geometry,
    PushAxisAlignedClip: () => {}, PopAxisAlignedClip: () => {},
  };
  Object.assign(s, { RenderTarget: rt, ChartControl: chartControl, ChartBars: chartBars, ChartPanel: { X: 0, Y: 0, W: chartScale.Width, H, MinValue: lo, MaxValue: hi } });
  const save = ctx.cur;
  ctx.cur = N - 1;
  try { s.OnRender(chartControl, chartScale) } finally { ctx.cur = save }
}
