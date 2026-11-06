// Window placement maths for pop-out windows (pure; shared by the web client and, bundled by desktop/build.mjs, by the
// Electron shell). A display is a rectangle in the global desktop space; ids are whatever the platform gives (Electron
// display.id, or a label for the Window Management API).
export interface Rect { x: number; y: number; width: number; height: number }
export interface Display { id: number | string; bounds: Rect; workArea?: Rect; primary?: boolean; label?: string }
export interface SavedWin { rect: Rect; displayId: number | string | null }

const MIN_W = 320, MIN_H = 240;
const area = (d: Display) => d.workArea ?? d.bounds;
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x), h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}
/** Shrink to fit inside `box` (never below the minimum size unless the box itself is smaller) and move fully inside it. */
export function clampRect(r: Rect, box: Rect): Rect {
  const width = Math.min(Math.max(r.width, Math.min(MIN_W, box.width)), box.width), height = Math.min(Math.max(r.height, Math.min(MIN_H, box.height)), box.height);
  return { width, height, x: Math.min(Math.max(r.x, box.x), box.x + box.width - width), y: Math.min(Math.max(r.y, box.y), box.y + box.height - height) };
}
export const centered = (size: { width: number; height: number }, box: Rect): Rect => clampRect({ width: size.width, height: size.height, x: box.x + (box.width - size.width) / 2, y: box.y + (box.height - size.height) / 2 }, box);
export const primaryOf = (ds: Display[]): Display | undefined => ds.find(d => d.primary) ?? ds[0];

/** The display a window mostly sits on: largest overlap, else the nearest by centre distance. */
export function displayFor(r: Rect, ds: Display[]): Display | undefined {
  let best: Display | undefined, bestA = 0;
  for (const d of ds) { const a = overlap(r, d.bounds); if (a > bestA) { best = d; bestA = a } }
  if (best) return best;
  const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
  let nd = Infinity;
  for (const d of ds) { const dx = d.bounds.x + d.bounds.width / 2 - cx, dy = d.bounds.y + d.bounds.height / 2 - cy, dist = dx * dx + dy * dy; if (dist < nd) { nd = dist; best = d } }
  return best;
}
export const snapshot = (rect: Rect, ds: Display[]): SavedWin => ({ rect: { ...rect }, displayId: displayFor(rect, ds)?.id ?? null });

/**
 * Where to open a window that was saved earlier. The saved display still exists: the saved rectangle, clamped into its
 * work area (a resolution change may have shrunk it). The display is gone (unplugged): the same offset on the primary
 * display, or centred when the old offset does not fit. `moved` says the window had to leave its old display.
 */
export function restoreRect(saved: SavedWin | undefined, ds: Display[], size = { width: 1100, height: 720 }): { rect: Rect; displayId: number | string | null; moved: boolean } {
  const primary = primaryOf(ds);
  if (!primary) return { rect: saved?.rect ?? { x: 0, y: 0, ...size }, displayId: null, moved: false };
  if (!saved?.rect) return { rect: centered(size, area(primary)), displayId: primary.id, moved: false };
  const r = { x: num(saved.rect.x, 0), y: num(saved.rect.y, 0), width: num(saved.rect.width, size.width), height: num(saved.rect.height, size.height) };
  const home = saved.displayId == null ? undefined : ds.find(d => d.id === saved.displayId);
  if (home) return { rect: clampRect(r, area(home)), displayId: home.id, moved: false };
  // Saved display unknown (never recorded) but the rectangle is still on a screen: keep it there.
  if (saved.displayId == null) { const d = displayFor(r, ds)!; if (overlap(r, d.bounds) > 0) return { rect: clampRect(r, area(d)), displayId: d.id, moved: false } }
  return { rect: centered(r, area(primary)), displayId: primary.id, moved: true };
}
/** Windows that no longer fit their display (after unplugging or a resolution change): one rectangle per input window. */
export function reflow(wins: Record<string, SavedWin>, ds: Display[]): Record<string, { rect: Rect; displayId: number | string | null; moved: boolean }> {
  return Object.fromEntries(Object.entries(wins).map(([k, w]) => [k, restoreRect(w, ds)]));
}
/** Rectangle for a window on display `d` (centred, or offset a little per already-open window so they do not stack exactly). */
export function placeOn(d: Display, size = { width: 1000, height: 700 }, index = 0): Rect {
  const b = area(d), r = centered(size, b), o = (index % 6) * 28;
  return clampRect({ ...r, x: r.x + o, y: r.y + o }, b);
}
