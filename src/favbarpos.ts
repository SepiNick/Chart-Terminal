// Pure geometry for the floating favorites toolbar: snap anchors, clamping, orientation. No DOM here (see drawui.ts).
export type Anchor = 'tl' | 't' | 'tr' | 'l' | 'r' | 'bl' | 'b' | 'br';
export type Orient = 'auto' | 'h' | 'v';
export interface Rect { x: number; y: number; w: number; h: number }
export interface FavPos { anchor: Anchor | null; x: number; y: number; orient: Orient; collapsed: boolean }

export const SNAP = 24;
export const GAP = 8;
export const ANCHORS: Anchor[] = ['tl', 't', 'tr', 'l', 'r', 'bl', 'b', 'br'];
export const DEFAULT_POS: FavPos = { anchor: 't', x: 0, y: 0, orient: 'auto', collapsed: false };

const num = (n: unknown, d: number) => (typeof n === 'number' && Number.isFinite(n) ? n : d);
/** Accepts whatever came out of storage / sync and returns a safe position. */
export function sanitize(p: unknown): FavPos {
  const o = (p && typeof p === 'object' ? p : {}) as Record<string, unknown>;
  return {
    anchor: ANCHORS.includes(o.anchor as Anchor) ? (o.anchor as Anchor) : o.anchor === null ? null : DEFAULT_POS.anchor,
    x: num(o.x, 0), y: num(o.y, 0),
    orient: o.orient === 'h' || o.orient === 'v' ? o.orient : 'auto',
    collapsed: o.collapsed === true,
  };
}

/** Vertical on the left/right edges, horizontal elsewhere; an explicit h/v choice only applies on the side edges and when free. */
export function orientFor(anchor: Anchor | null, pref: Orient): 'h' | 'v' {
  const side = anchor === 'l' || anchor === 'r';
  if (pref === 'auto') return side ? 'v' : 'h';
  return anchor === null || side ? pref : 'h';
}

/** Keep a w*h box inside bounds; a box larger than the bounds pins to the top-left. */
export function clampBox(x: number, y: number, w: number, h: number, b: Rect) {
  return { x: Math.max(b.x, Math.min(x, b.x + b.w - w)), y: Math.max(b.y, Math.min(y, b.y + b.h - h)) };
}

/** Top-left of the box when docked at an anchor inside bounds. */
export function anchorXY(a: Anchor, w: number, h: number, b: Rect, gap = GAP) {
  const left = b.x + gap, right = b.x + b.w - w - gap, cx = b.x + (b.w - w) / 2;
  const top = b.y + gap, bottom = b.y + b.h - h - gap, cy = b.y + (b.h - h) / 2;
  const x = a === 'tl' || a === 'l' || a === 'bl' ? left : a === 'tr' || a === 'r' || a === 'br' ? right : cx;
  const y = a === 'tl' || a === 't' || a === 'tr' ? top : a === 'bl' || a === 'b' || a === 'br' ? bottom : cy;
  return clampBox(x, y, w, h, b);
}

/** The anchor whose docked position is within `snap` px of the dragged box's top-left, nearest first; null if none. */
export function snapAnchor(x: number, y: number, w: number, h: number, b: Rect, snap = SNAP): Anchor | null {
  let best: Anchor | null = null, bd = snap;
  for (const a of ANCHORS) {
    const p = anchorXY(a, w, h, b), d = Math.hypot(p.x - x, p.y - y);
    if (d <= bd) { best = a; bd = d }
  }
  return best;
}

/** Nearest anchor regardless of distance (keyboard "snap now"). */
export function nearestAnchor(x: number, y: number, w: number, h: number, b: Rect): Anchor {
  return snapAnchor(x, y, w, h, b, Infinity)!;
}

/** Final top-left for a saved position: docked ones follow the bounds, free ones are clamped (viewport resize, small screens). */
export function place(p: FavPos, w: number, h: number, dock: Rect, free: Rect) {
  return p.anchor ? anchorXY(p.anchor, w, h, dock) : clampBox(p.x, p.y, w, h, free);
}
