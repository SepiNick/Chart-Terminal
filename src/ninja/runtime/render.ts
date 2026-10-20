// OnRender as a static snapshot: after the bar loop, OnRender(chartControl, chartScale) runs ONCE over all bars and the
// common SharpDX RenderTarget calls become ordinary drawings (lines, boxes, labels) in time/price coordinates.
// Pixels are virtual: x = bar index × BAR_PX, y maps the whole price range of the run onto HEIGHT px (top = highest high),
// so ChartControl/ChartScale helpers and small pixel offsets round-trip sensibly. Nothing re-renders on scroll/zoom.
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
export const DX = { Vector2, RectangleF, Ellipse, RoundedRectangle, TextFormat, TextLayout, DirectWriteFactory: {}, Direct2DFactory: {} };

export function renderSnapshot(s: any, e: Engine) {
  const ctx: BarsCtx = s.__ctx, bars = ctx.bars, N = bars.length;
  if (!N) return;
  let lo = Infinity, hi = -Infinity;
  for (const b of bars) { lo = Math.min(lo, b.low); hi = Math.max(hi, b.high) }
  if (!(hi > lo)) { hi = lo + 1; lo -= 1 }
  const yOf = (v: number) => ((hi - v) / (hi - lo)) * HEIGHT, vOf = (y: number) => hi - (y / HEIGHT) * (hi - lo);
  const tOf = (x: number) => { const f = x / BAR_PX, i = Math.max(0, Math.min(N - 1, Math.floor(f))); return Math.round(bars[i].time + (f - i) * ctx.tfSec) };
  const chartBars = { FromIndex: 0, ToIndex: N - 1, Count: N, Bars: ctx.barsObj, GetBarIdxByX: (_c: unknown, x: number) => Math.round(x / BAR_PX), GetTimeByBarIdx: (_c: unknown, i: number) => ctx.barsObj.GetTime(i) };
  const chartControl = {
    GetXByBarIndex: (_cb: unknown, i: number) => i * BAR_PX, GetXByTime: (t: NtDateTime) => ctx.indexAt(t) * BAR_PX,
    GetBarPaintWidth: () => BAR_PX * 0.6, BarWidth: BAR_PX * 0.3, BarMarginRight: 0, CanvasLeft: 0, CanvasRight: N * BAR_PX,
    GetTimeBySlotIndex: (i: number) => ctx.barsObj.GetTime(Math.max(0, Math.min(N - 1, Math.round(i)))), GetSlotIndexByX: (x: number) => Math.round(x / BAR_PX),
    Properties: { ChartBackground: null, ChartText: null, LabelFont: null }, ChartPanels: [], Instrument: ctx.instrument, BarsPeriod: ctx.period,
  };
  const chartScale = { GetYByValue: yOf, GetYByValueWpf: yOf, GetValueByY: vOf, GetValueByYWpf: vOf, MaxValue: hi, MinValue: lo, MaxMinusMin: hi - lo, Height: HEIGHT, Width: N * BAR_PX, IsVisible: true };
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
  const rt = {
    AntialiasMode: 'PerPrimitive', Transform: null, __rt: true,
    DrawLine: (a: Vector2, z: Vector2, b: unknown) => line(a.X, a.Y, z.X, z.Y, b),
    DrawRectangle: rect, FillRectangle: rect,
    DrawRoundedRectangle: (r: RoundedRectangle, b: unknown) => rect(r.Rect, b), FillRoundedRectangle: (r: RoundedRectangle, b: unknown) => rect(r.Rect, b),
    DrawEllipse: ellipse, FillEllipse: ellipse,
    DrawText: (t: unknown, _f: unknown, r: RectangleF, b: unknown) => text(t, r.X, r.Y, b),
    DrawTextLayout: (p: Vector2, l: TextLayout, b: unknown) => text(l.Text, p.X, p.Y, b),
    DrawGeometry: () => e.warn('RenderTarget.DrawGeometry is not supported; ignored'), FillGeometry: () => e.warn('RenderTarget.FillGeometry is not supported; ignored'),
    PushAxisAlignedClip: () => {}, PopAxisAlignedClip: () => {},
  };
  Object.assign(s, { RenderTarget: rt, ChartControl: chartControl, ChartBars: chartBars, ChartPanel: { X: 0, Y: 0, W: N * BAR_PX, H: HEIGHT, MinValue: lo, MaxValue: hi } });
  const save = ctx.cur;
  ctx.cur = N - 1;
  try { s.OnRender(chartControl, chartScale) } finally { ctx.cur = save }
}
