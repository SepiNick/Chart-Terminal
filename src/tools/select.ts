import type { Drawing, Pt, XY } from './types.ts';

/** New drawing id: an integer above every existing id (legacy float ids included) and not below the clock, so devices rarely collide. */
export function nextId(all: { id: number }[], now = Date.now()): number {
  let m = Math.floor(now) - 1;
  for (const d of all) if (Number.isFinite(d.id)) m = Math.max(m, Math.floor(d.id));
  return m + 1;
}

/** Group names the auto-analysis owns; they are replaced wholesale, never selected as a unit. */
export const AUTO_GROUP = 'Auto analysis', HTF_GROUP = 'Higher-timeframe levels';

/** Selecting one member of a user-named group selects the whole group (auto-analysis groups excluded). */
export function expandGroups(sel: Drawing[], all: Drawing[]): Drawing[] {
  const groups = new Set(sel.map(d => d.group).filter(g => g && g !== AUTO_GROUP && g !== HTF_GROUP));
  if (!groups.size) return sel;
  return [...new Set([...sel, ...all.filter(d => d.group && groups.has(d.group))])];
}

/** Drawings with any anchor inside the marquee rectangle (screen px). */
export function rectSelect<T>(items: { d: T; pts: XY[] }[], a: XY, b: XY): T[] {
  const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
  return items.filter(({ pts }) => pts.some(([x, y]) => x >= x0 && x <= x1 && y >= y0 && y <= y1)).map(i => i.d);
}

/** Deep copies with fresh unique integer ids, unlocked and out of the source's group (so a copy never moves with its original). */
export function freshCopies(src: Drawing[], existing: Drawing[]): Drawing[] {
  const all = [...existing];
  return structuredClone(src).map(d => { const c = { ...d, id: nextId(all), locked: false }; delete c.group; all.push(c); return c });
}

/** Shift copies `bars` to the right in time; screen-anchored drawings (their points are pixels) stay where they are. */
export function offsetCopies(copies: Drawing[], bars: number, g: { timeAt(l: number): number; logical(t: number): number }, screenAnchored: (type: string) => boolean | undefined) {
  for (const c of copies) if (!screenAnchored(c.type)) c.pts = c.pts.map(p => ({ t: g.timeAt(g.logical(p.t) + bars), p: p.p }));
}

/** Anchor snapshot of the members a group drag may move (locked ones stay put). */
export const movable = (sel: Iterable<Drawing>): Map<Drawing, Pt[]> => new Map([...sel].filter(s => !s.locked).map(s => [s, s.pts.map(p => ({ ...p }))]));

/** Shift+drag keeps the dominant axis only. */
export const lockAxis = (dx: number, dy: number, on: boolean): [number, number] => (!on ? [dx, dy] : Math.abs(dx) > Math.abs(dy) ? [dx, 0] : [0, dy]);

/** New anchors for every member of a group drag. `shift` moves one point; `ownScale` is false for members in another pane (they get dy = 0). */
export function moveGroup(origs: Map<Drawing, Pt[]>, dx: number, dy: number, shift: (d: Drawing, p: Pt, dx: number, dy: number) => Pt, ownScale: (d: Drawing) => boolean): Map<Drawing, Pt[]> {
  return new Map([...origs].map(([d, pts]) => [d, pts.map(p => shift(d, p, dx, ownScale(d) ? dy : 0))]));
}

/** Hit sizes in px: bigger for touch / coarse pointers. `handle` is a radius, `stroke` the full band width. */
export const hitRadius = (coarse: boolean) => (coarse ? { handle: 14, stroke: 20 } : { handle: 7, stroke: 8 });

/** Merge a style patch into many drawings. */
export function applyStyle(ds: Drawing[], patch: Partial<Drawing['style']>) { for (const d of ds) Object.assign(d.style, patch) }
