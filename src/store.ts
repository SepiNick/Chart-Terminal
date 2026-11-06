import { memo, queueState } from './sync.ts';
import { isStandalone } from './servers.ts';
import { emptyMeta, hasSchema, pruneMeta, stampChange, type Meta } from './syncmerge.ts';

// App state: localStorage (`ct.<key>`) as the working copy; in server mode every write is also queued to the server
// (sync.ts). Every access is guarded: storage can be missing, blocked or full.
let full = false;
/** Edit / delete stamps for merging (sync tombstones). Never blocks or breaks a save. */
function stamp(key: string, value: unknown) {
  if (!hasSchema(key)) return;
  try {
    const prev = memo.get(key) ?? localStorage.getItem('ct.' + key), next = JSON.stringify(value);
    if (prev === next || next === undefined) return;
    const m = store.get<Meta>('syncmeta', emptyMeta());
    stampChange(m, key, prev ? JSON.parse(prev) : undefined, value, Date.now());
    store.set('syncmeta', pruneMeta(m, Date.now()));
  } catch {}
}
/** A pop-out window keeps its own layout, side panel and sizes: these keys are redirected to `po.<id>.<key>` (device-local, never synced). */
const alias = new Map<string, string>();
export const aliasKeys = (id: string, keys: string[]) => keys.forEach(k => alias.set(k, `po.${id}.${k}`));
/** Called after every write (key and whether this browser's storage accepted it): the "saved" indicator listens here. */
export let onStored: (key: string, ok: boolean) => void = () => {};
export const setOnStored = (f: typeof onStored) => { onStored = f };
export const store = {
  get<T>(key: string, fallback: T): T {
    key = alias.get(key) ?? key;
    let v: string | null | undefined = memo.get(key);   // newer than localStorage when present
    try { v ??= localStorage.getItem('ct.' + key) } catch {}
    try { return v ? (JSON.parse(v) as T) : fallback } catch { return fallback }
  },
  /** Returns false when this browser's storage refused the value (it is still kept for this session and sent to the server). */
  set(key: string, value: unknown): boolean {
    key = alias.get(key) ?? key;
    let ok = true;
    stamp(key, value);
    try { localStorage.setItem('ct.' + key, JSON.stringify(value)); memo.delete(key) }
    catch { ok = false; if (isStandalone() && !full) { full = true; setTimeout(() => toast('Device storage is full: recent changes may be lost on restart. Delete old scripts or journal pictures.', 8000), 0) } const j = JSON.stringify(value); if (j !== undefined) memo.set(key, j) }
    queueState(key, value);
    onStored(key, ok);
    return ok;
  },
};

export const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;
export const $$ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => [...root.querySelectorAll(sel)] as T[];
export const esc = (s: unknown) => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

export function toast(msg: string, ms = 3000) {
  const d = document.createElement('div');
  d.textContent = msg;
  $('#toast').append(d);
  setTimeout(() => d.remove(), ms);
}

export const calcPrec = (p: number) => (p >= 1000 ? 2 : p >= 10 ? 3 : p >= 1 ? 4 : p >= 0.01 ? 6 : 8);
export const fmtVol = (v: number) =>
  v >= 1e9 ? (v / 1e9).toFixed(2) + 'B' : v >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(2) + 'K' : v.toFixed(2);
