// Menu placement maths (pure, so node tests cover it).
/** A submenu's parent row. */
export interface Anchor { left: number; bottom: number }
/** Where a menu of size w×h goes. Top level: at (x, y), pulled back inside the window. Submenu: beside its parent row on the right,
 *  else beside it on the left; in a window too narrow for either, under the parent row (so the row you hover stays readable),
 *  full width. Always inside the window, scrolling when taller than it. */
export function place(x: number, y: number, w: number, h: number, vw: number, vh: number, a?: Anchor): { left: number; top: number; maxH: number } {
  const M = 4, maxH = vh - 2 * M;
  let left = Math.min(x, vw - w - M), top = y;
  if (a && x + w > vw - M) {
    if (a.left - w >= M) left = a.left - w;                 // room on the parent's left
    else { left = M; top = a.bottom + 2; }                  // neither side: under the parent row
  }
  const hh = Math.min(h, maxH);
  return { left: Math.max(M, left), top: Math.max(M, Math.min(top, vh - hh - M)), maxH };
}
