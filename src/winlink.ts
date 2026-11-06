// Message protocol between the main window and its pop-outs (pure; the BroadcastChannel glue is in popout.ts).
// Everything arriving on a channel is untrusted input from "some page of this origin": every message is validated
// and rebuilt field by field before it is used.
import type { Rect } from './winplace.ts';

export const KINDS = ['chart', 'watch', 'dom', 'tester', 'positions', 'pine', 'alerts'] as const;
export type Kind = (typeof KINDS)[number];
export const isKind = (v: unknown): v is Kind => typeof v === 'string' && (KINDS as readonly string[]).includes(v);
export const isWid = (v: unknown): v is string => typeof v === 'string' && /^[a-z0-9]{4,16}$/.test(v);
/** Stable id of a pop-out slot (one window per panel, one per chart pane), so its size and position are remembered. */
export const slotId = (kind: Kind, pane?: number) => `po${kind}${kind === 'chart' ? (pane ?? 0) : ''}`;
export const newWid = (rnd: () => number = Math.random) => Array.from({ length: 8 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(rnd() * 36)]).join('');
const SYMBOL = /^([A-Z0-9]+:)?[A-Z0-9_.؀-ۿ]{2,40}$/;

export type Msg =
  | { t: 'hello'; id: string; kind: Kind | 'main'; pane?: number }           // a window announces itself (and asks the others to do the same)
  | { t: 'bye'; id: string }                                    // a window is closing
  | { t: 'wants'; id: string; keys: string[] }                  // live-data keys this window displays
  | { t: 'live'; key: string; data: unknown }                   // one live update from the window that owns the connection
  | { t: 'cfg'; id: string; pane: number; active: boolean; cfg: Record<string, unknown> }   // a chart's config changed
  | { t: 'select'; symbol: string }                             // a panel without a chart (watchlist) picked a symbol
  | { t: 'dock'; id: string }                                   // "Bring back": main asks a pop-out to close itself
  | { t: 'closing' };                                           // the main window is closing

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
/** Live-data keys: `t|SYMBOL` (24 h ticker) or `b|SYMBOL|tf` (bar stream). */
export const isLiveKey = (k: unknown): k is string => typeof k === 'string' && k.length < 80 && /^(t\|[^|]+|b\|[^|]+\|[^|]+)$/.test(k);

export function parseMsg(x: unknown): Msg | null {
  if (!isObj(x)) return null;
  switch (x.t) {
    case 'hello': {
      if (!isWid(x.id) || !(x.kind === 'main' || isKind(x.kind))) return null;
      const pane = Number.isInteger(x.pane) && (x.pane as number) >= 0 && (x.pane as number) < 16 ? (x.pane as number) : undefined;
      return pane === undefined ? { t: 'hello', id: x.id, kind: x.kind } : { t: 'hello', id: x.id, kind: x.kind, pane };
    }
    case 'bye': case 'dock': return isWid(x.id) ? { t: x.t, id: x.id } : null;
    case 'wants': return isWid(x.id) && Array.isArray(x.keys) && x.keys.length <= 500 ? { t: 'wants', id: x.id, keys: x.keys.filter(isLiveKey) } : null;
    case 'live': return isLiveKey(x.key) && x.data !== undefined ? { t: 'live', key: x.key, data: x.data } : null;
    case 'cfg': {
      if (!isWid(x.id) || !Number.isInteger(x.pane) || (x.pane as number) < 0 || (x.pane as number) > 15 || !isObj(x.cfg)) return null;
      const cfg = JSON.parse(JSON.stringify(x.cfg)) as Record<string, unknown>;   // plain data only, no prototypes
      delete cfg.link;   // colour groups belong to each window
      if (typeof cfg.symbol !== 'string' || !SYMBOL.test(cfg.symbol) && !/^[A-Z0-9_.:+\-*/() ]{1,200}$/.test(cfg.symbol)) return null;
      return { t: 'cfg', id: x.id, pane: x.pane as number, active: x.active === true, cfg };
    }
    case 'select': return typeof x.symbol === 'string' && SYMBOL.test(x.symbol) ? { t: 'select', symbol: x.symbol } : null;
    case 'closing': return { t: 'closing' };
    default: return null;
  }
}

// ---- who is open, and what live data they need ----
export const WANT_TTL = 15_000;
/** Windows seen recently with the live keys they display. A window that crashed stops refreshing and drops out after the TTL. */
export class Peers {
  private m = new Map<string, { kind: Kind | 'main'; keys: Set<string>; seen: number }>();
  hello(id: string, kind: Kind | 'main', now: number) { const p = this.m.get(id); if (p) { p.seen = now; p.kind = kind } else this.m.set(id, { kind, keys: new Set(), seen: now }) }
  wants(id: string, keys: string[], now: number) { const p = this.m.get(id) ?? { kind: 'chart' as Kind, keys: new Set<string>(), seen: now }; p.keys = new Set(keys); p.seen = now; this.m.set(id, p) }
  bye(id: string) { this.m.delete(id) }
  private prune(now: number) { for (const [k, p] of this.m) if (now - p.seen > WANT_TTL) this.m.delete(k) }
  ids(now: number): string[] { this.prune(now); return [...this.m.keys()] }
  has(id: string, now: number) { this.prune(now); return this.m.has(id) }
  hasKind(kind: Kind | 'main', now: number) { this.prune(now); return [...this.m.values()].some(p => p.kind === kind) }
  /** Every key any other window displays: the owner of the connections must keep these open too. */
  union(now: number): Set<string> { this.prune(now); const u = new Set<string>(); for (const p of this.m.values()) p.keys.forEach(k => u.add(k)); return u }
}

// ---- the pop-out arrangement of this device ----
// Stored under the device-local key `winArr` (never synced: a laptop layout must not overwrite a desktop one).
export interface PopSpec { id: string; kind: Kind; pane?: number; open: boolean; rect?: Rect; displayId?: number | string | null }
export interface Arrangement { v: 1; wins: PopSpec[] }
export const ARR_KEY = 'winArr';
const rectOf = (r: unknown): Rect | undefined => {
  if (!isObj(r)) return undefined;
  const o = { x: r.x, y: r.y, width: r.width, height: r.height };
  return Object.values(o).every(v => typeof v === 'number' && Number.isFinite(v)) && (o.width as number) >= 100 && (o.height as number) >= 80 && (o.width as number) < 20000 && (o.height as number) < 20000 ? (o as Rect) : undefined;
};
export function parseArrangement(raw: unknown): Arrangement {
  const out: PopSpec[] = [];
  if (isObj(raw) && Array.isArray(raw.wins)) for (const w of raw.wins.slice(0, 24)) {
    if (!isObj(w) || !isWid(w.id) || !isKind(w.kind) || out.some(o => o.id === w.id)) continue;
    const s: PopSpec = { id: w.id, kind: w.kind, open: w.open === true };
    if (Number.isInteger(w.pane) && (w.pane as number) >= 0 && (w.pane as number) < 16) s.pane = w.pane as number;
    const r = rectOf(w.rect); if (r) s.rect = r;
    if (typeof w.displayId === 'number' || (typeof w.displayId === 'string' && w.displayId.length < 120) || w.displayId === null) s.displayId = w.displayId as PopSpec['displayId'];
    out.push(s);
  }
  return { v: 1, wins: out };
}
/** Insert or update one window, leaving the rest of the arrangement alone. */
export function upsert(a: Arrangement, s: PopSpec): Arrangement {
  const i = a.wins.findIndex(w => w.id === s.id), wins = a.wins.slice();
  if (i < 0) wins.push(s); else wins[i] = { ...wins[i], ...s };
  return { v: 1, wins };
}
export const remove = (a: Arrangement, id: string): Arrangement => ({ v: 1, wins: a.wins.filter(w => w.id !== id) });
