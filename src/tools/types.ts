// Public contract for drawing tools. Each tool is a plain ToolDef; the engine (src/drawings.ts)
// handles creation clicks, selection, dragging, hit-testing, undo, visibility and persistence.
import type { Bar } from '../data.ts';

/** A drawing anchor: unix time (seconds, may be in the future) + price. */
export interface Pt { t: number; p: number }
export type XY = [number, number];
export type Dash = 'solid' | 'dashed' | 'dotted';
export interface Level { v: number; color: string; on: boolean }

export interface Style {
  color: string; width: number; dash: Dash;
  fillColor: string; fillAlpha: number;           // 0 = no fill
  text: string; textColor: string; fontSize: number; bold: boolean; italic: boolean;
  extendLeft: boolean; extendRight: boolean;
  levels?: Level[];
  [extra: string]: unknown;                       // tool-specific props declared in ToolDef.props
}

export interface Drawing {
  id: number; type: string; pts: Pt[]; style: Style;
  locked?: boolean; hidden?: boolean;
  vis?: { min: number; max: number };             // visible only for timeframes (seconds) in [min, max]
  group?: string; name?: string;
  pane?: number;                                  // chart pane index (0/undefined = main pane)
}

/** Coordinate helpers for the main pane, in CSS pixels relative to the pane's top-left. */
export interface Geo {
  x(t: number): number; y(p: number): number;     // anchor -> screen
  t(x: number): number; p(y: number): number;     // screen -> anchor
  logical(t: number): number;                     // fractional bar index (extrapolated outside data)
  timeAt(l: number): number;                      // bar index -> time (rounded to a bar)
  W: number; H: number; barWidth: number;         // pane size, pixels per bar
  bars: Bar[]; tfSec: number;
  fmt(p: number): string;                         // price formatter at symbol precision
}

export interface StrokeOpts { color?: string; width?: number; dash?: Dash; arrowStart?: boolean; arrowEnd?: boolean; noHit?: boolean }
export interface FillOpts { fill?: string | false; stroke?: string | false; width?: number; dash?: Dash; noHit?: boolean }
export interface TextOpts {
  color?: string; size?: number; bold?: boolean; italic?: boolean;
  align?: CanvasTextAlign; baseline?: CanvasTextBaseline;
  bg?: string; border?: string; pad?: number; maxWidth?: number; noHit?: boolean;
}

/**
 * Drawing surface handed to ToolDef.draw. Every primitive both paints and registers a hit region,
 * so tools get click/hover selection for free. Defaults come from the drawing's style.
 */
export interface Renderer {
  ctx: CanvasRenderingContext2D;
  style: Style;
  selected: boolean;
  /** style.fillColor at style.fillAlpha, or the given hex at the given alpha. */
  fill(hex?: string, alpha?: number): string;
  line(a: XY, b: XY, o?: StrokeOpts): void;
  /** Line through a→b, optionally extended past a (left) and/or past b (right) to the pane edge. */
  ray(a: XY, b: XY, extendStart: boolean, extendEnd: boolean, o?: StrokeOpts): void;
  hline(y: number, x0?: number, x1?: number, o?: StrokeOpts): void;
  vline(x: number, o?: StrokeOpts): void;
  poly(pts: XY[], closed: boolean, o?: FillOpts & StrokeOpts): void;
  rect(a: XY, b: XY, o?: FillOpts): void;
  ellipse(c: XY, rx: number, ry: number, rotation?: number, o?: FillOpts): void;
  arc(c: XY, r: number, a0: number, a1: number, o?: StrokeOpts): void;
  /** Quadratic (3 pts) or cubic (4 pts) Bézier from first to last point. */
  bezier(pts: XY[], o?: StrokeOpts): void;
  /** Smooth curve through all points (Catmull-Rom). */
  spline(pts: XY[], o?: StrokeOpts & { closed?: boolean; fill?: string | false }): void;
  /** Returns the text's bounding box [x, y, w, h]. Multiline text splits on \n. */
  text(s: string, at: XY, o?: TextOpts): [number, number, number, number];
  /** Rounded "pill" label with white text, centered at `at`. */
  label(s: string, at: XY, bg: string, o?: TextOpts): void;
  /** Register an extra hit region without painting. */
  hit(path: Path2D, filled: boolean): void;
}

export type GroupId = 'cursors' | 'lines' | 'fib' | 'patterns' | 'forecast' | 'shapes' | 'annotations';
export interface PropDef {
  key: string; label: string;
  type: 'bool' | 'number' | 'color' | 'select' | 'text' | 'textarea' | 'image';
  options?: string[]; min?: number; max?: number; step?: number;
  default: unknown;
}

export interface ToolDef {
  id: string; name: string; group: GroupId; icon: string; key?: string;
  /** Clicks to create. 0 = freehand: press, drag, release (pts = sampled path). */
  points: number;
  defaults?: Partial<Style>;
  props?: PropDef[];
  levels?: Level[];
  /** Open the Text tab right after creation. */
  needsText?: boolean;
  /** Anchors are screen fractions (t = x/W, p = y/H) instead of time/price. */
  screenAnchored?: boolean;
  /** Derive/complete points while drafting and after creation (e.g. position tools add TP/SL). */
  build?(pts: Pt[], g: Geo, d: Drawing): Pt[];
  draw(r: Renderer, d: Drawing, P: XY[], g: Geo): void;
  /** Screen positions of drag handles; default = one per point. */
  handles?(d: Drawing, P: XY[], g: Geo): XY[];
  /** Apply a dragged handle; default sets d.pts[i] = pt. */
  moveHandle?(d: Drawing, i: number, pt: Pt, g: Geo): void;
  /** Price on this drawing at time t, for alerts on drawings (lines/channels). */
  priceAt?(d: Drawing, t: number, g: Geo): number | null;
}
