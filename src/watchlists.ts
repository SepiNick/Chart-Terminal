// Multiple watchlists (pure logic: no DOM, no storage, so node tests cover it).
// Synced key `watchLists`: Record<listId, WList>. Merge rule (syncmerge.ts SCHEMA): union by list id with tombstones,
// per list `syms` = set union with tombstones, `flags` = per-symbol last-writer-wins, name/color/icon/ord = per-field LWW.
// The old single list (`watch`, `watchFlags`) becomes the list with the stable id 'default'; the legacy keys are never
// rewritten or deleted by this module (rollback-safe).
import { parseTvWatchlist } from './tvimport.ts';

export interface WList { name: string; color: string; icon?: string; ord: number; syms: string[]; flags: Record<string, string> }
export type WLists = Record<string, WList>;
export type R = { ok: true; msg?: string } | { ok: false; msg: string };

export const MAX_LISTS = 50, MAX_SYMS = 500, MAX_NAME = 40;
/** Serialized size cap of the whole key: under the public server's 2 MB per-key quota (CT_STATE_KEY_MB) with room for the sync envelope. */
export const MAX_BYTES = 1_500_000;
export const DEFAULT_ID = 'default';
export const DEFAULT_SYMS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT'];
export const COLORS = ['#2962ff', '#f23645', '#ff9800', '#ffeb3b', '#4caf50', '#00bcd4', '#9c27b0', '#e91e63', '#8d6e63', '#9aa0a6'];
export const MSG = {
  lists: 'You can have at most 50 watchlists',
  syms: 'A watchlist can hold at most 500 symbols',
  big: 'Your watchlists are too large to sync; remove some symbols or lists',
  last: 'Keep at least one watchlist',
  name: 'Enter a name for the watchlist',
};

const HEX = /^#[0-9a-f]{6}$/i, ID = /^[A-Za-z0-9_-]{1,32}$/;
export const isSection = (s: string) => s.startsWith('###');
export const symCount = (l: WList) => l.syms.filter(s => !isSection(s)).length;
const cleanName = (n: unknown) => String(n ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
const cleanIcon = (i: unknown) => (typeof i === 'string' && i.trim() ? [...i.trim()].slice(0, 2).join('') : undefined);
const err = (msg: string): R => ({ ok: false, msg });

/** Validates untrusted synced data: drops malformed lists/symbols, never throws. */
export function sanitize(raw: unknown): WLists {
  const out: WLists = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  let n = 0;
  for (const [id, v] of Object.entries(raw as Record<string, any>)) {
    if (!ID.test(id) || !v || typeof v !== 'object' || n >= MAX_LISTS) continue;
    const syms = [...new Set((Array.isArray(v.syms) ? v.syms : []).filter((s: unknown): s is string => typeof s === 'string' && !!s && s.length <= 80))] as string[];
    const flags: Record<string, string> = {};
    for (const [s, c] of Object.entries(v.flags && typeof v.flags === 'object' ? v.flags : {})) if (HEX.test(String(c))) flags[s] = String(c);
    out[id] = { name: cleanName(v.name) || 'List', color: HEX.test(v.color) ? v.color : COLORS[n % COLORS.length], ...(cleanIcon(v.icon) ? { icon: cleanIcon(v.icon) } : {}), ord: Number.isFinite(+v.ord) ? +v.ord : n, syms: capSyms(syms), flags };
    n++;
  }
  return out;
}
function capSyms(syms: string[]) { let k = 0; return syms.filter(s => isSection(s) || ++k <= MAX_SYMS) }

/** The lists to use at start-up. Stored lists win; otherwise the old single watchlist becomes 'Default' (nothing is dropped). */
export function migrate(raw: unknown, legacyWatch?: unknown, legacyFlags?: unknown, defaults = DEFAULT_SYMS): WLists {
  const lists = sanitize(raw);
  if (Object.keys(lists).length) return lists;
  const syms = Array.isArray(legacyWatch) ? legacyWatch.filter((s): s is string => typeof s === 'string') : defaults;
  // legacy lists above the per-list limit are kept whole on purpose: migration must not lose data
  const flags: Record<string, string> = {};
  for (const [s, c] of Object.entries(legacyFlags && typeof legacyFlags === 'object' ? legacyFlags : {})) if (HEX.test(String(c)) && syms.includes(s)) flags[s] = String(c);
  return { [DEFAULT_ID]: { name: 'Default', color: COLORS[0], ord: 0, syms: [...new Set(syms)], flags } };
}

export const sortedIds = (L: WLists) => Object.keys(L).sort((a, b) => L[a].ord - L[b].ord || (a < b ? -1 : 1));
export const sizeOf = (L: WLists) => JSON.stringify(L).length;
export const checkBytes = (L: WLists): R => (sizeOf(L) > MAX_BYTES ? err(MSG.big) : { ok: true });
/** The list to show: the wanted one if it still exists, else the first by order. */
export const resolveActive = (L: WLists, want?: string | null) => (want && L[want] ? want : sortedIds(L)[0] ?? '');

export function newId(L: WLists, rnd: () => number = Math.random, now: () => number = Date.now) {
  let id: string;
  do id = 'l' + now().toString(36) + Math.floor(rnd() * 46656).toString(36); while (L[id]);
  return id;
}
const nextOrd = (L: WLists) => Math.max(-1, ...Object.values(L).map(l => l.ord)) + 1;

export function createList(L: WLists, name: string, color?: string, icon?: string, id = newId(L)): R & { id?: string } {
  const nm = cleanName(name);
  if (!nm) return err(MSG.name);
  if (Object.keys(L).length >= MAX_LISTS) return err(MSG.lists);
  L[id] = { name: nm, color: color && HEX.test(color) ? color : COLORS[Object.keys(L).length % COLORS.length], icon: cleanIcon(icon), ord: nextOrd(L), syms: [], flags: {} };
  return { ok: true, id };
}
export function renameList(L: WLists, id: string, name: string): R {
  const nm = cleanName(name);
  if (!nm) return err(MSG.name);
  if (!L[id]) return err('No such watchlist');
  L[id].name = nm; return { ok: true };
}
export function setColor(L: WLists, id: string, color: string): R { if (!L[id] || !HEX.test(color)) return err('Invalid colour'); L[id].color = color; return { ok: true } }
export function setIcon(L: WLists, id: string, icon: string): R { if (!L[id]) return err('No such watchlist'); L[id].icon = cleanIcon(icon); if (!L[id].icon) delete L[id].icon; return { ok: true } }
export function duplicateList(L: WLists, id: string, copyOf = '(copy)', newid = newId(L)): R & { id?: string } {
  const src = L[id];
  if (!src) return err('No such watchlist');
  if (Object.keys(L).length >= MAX_LISTS) return err(MSG.lists);
  L[newid] = { ...structuredClone(src), name: cleanName(`${src.name} ${copyOf}`), ord: nextOrd(L) };
  return checkBytes(L).ok ? { ok: true, id: newid } : (delete L[newid], err(MSG.big));
}
/** Deletes a list and returns it so the caller can offer undo with restoreList. The last list cannot be deleted. */
export function deleteList(L: WLists, id: string): R & { removed?: WList } {
  if (!L[id]) return err('No such watchlist');
  if (Object.keys(L).length <= 1) return err(MSG.last);
  const removed = L[id]; delete L[id];
  return { ok: true, removed };
}
export function restoreList(L: WLists, id: string, list: WList): R {
  if (L[id]) return err('No such watchlist');
  if (Object.keys(L).length >= MAX_LISTS) return err(MSG.lists);
  L[id] = list; return { ok: true };
}
/** New order of the list ids (ids not mentioned keep their relative place after the mentioned ones). */
export function reorder(L: WLists, order: string[]) {
  const ids = [...order.filter(i => L[i]), ...sortedIds(L).filter(i => !order.includes(i))];
  ids.forEach((id, i) => { if (L[id].ord !== i) L[id].ord = i });
}
/** Moves `id` before `target` (or to the end when target is undefined). */
export function moveBefore(L: WLists, id: string, target?: string) {
  const ids = sortedIds(L).filter(i => i !== id);
  const at = target ? ids.indexOf(target) : -1;
  ids.splice(at < 0 ? ids.length : at, 0, id);
  reorder(L, ids);
}

export function addSymbol(L: WLists, id: string, sym: string): R {
  const l = L[id];
  if (!l) return err('No such watchlist');
  if (l.syms.includes(sym)) return err(`${sym} is already in ${l.name}`);
  if (!isSection(sym) && symCount(l) >= MAX_SYMS) return err(MSG.syms);
  l.syms.push(sym);
  if (!checkBytes(L).ok) { l.syms.pop(); return err(MSG.big) }
  return { ok: true };
}
export function removeSymbol(L: WLists, id: string, sym: string) {
  const l = L[id]; if (!l) return;
  l.syms = l.syms.filter(s => s !== sym); delete l.flags[sym];
}
/** Moves (or copies) a symbol between lists; its flag colour travels with it. */
export function moveSymbol(L: WLists, from: string, to: string, sym: string, copy = false): R {
  const a = L[from], b = L[to];
  if (!a || !b || isSection(sym)) return err('No such watchlist');
  if (from === to) return err(`${sym} is already in ${b.name}`);
  const r = addSymbol(L, to, sym);
  if (!r.ok) return r;
  if (a.flags[sym]) b.flags[sym] = a.flags[sym];
  if (!copy) removeSymbol(L, from, sym);
  return { ok: true };
}

// ---------- import / export ----------
/** Plain text, one symbol per line; '###Name' lines are sections. The app's own symbols (EXCH:BASE_QUOTE) pass through unchanged. */
export function exportText(l: WList): string { return l.syms.join('\n') + '\n' }
const own = (x: string) => /^[A-Za-z0-9]+:[A-Za-z0-9]*_/.test(x.trim());
/** Entries of a text file: plain one-per-line, our own export, or TradingView's comma-separated export (EXCH:TICKER). */
export function parseImport(text: string): string[] {
  const parts = text.replace(/^﻿/, '').split(/[,\n\r]+/).map(x => x.trim()).filter(Boolean);
  const out: string[] = [], seen = new Set<string>();
  for (const x of parts) {
    if (isSection(x)) { out.push(x); continue }
    const s = own(x) ? x.toUpperCase() : parseTvWatchlist(x)[0];
    if (s && !seen.has(s)) { seen.add(s); out.push(s) }
  }
  return out;
}
/** Adds new entries (skipping ones already there and rejected ones such as expressions); stops at the limits with a clear message. */
export function importEntries(L: WLists, id: string, entries: string[], reject: (s: string) => boolean = () => false): { added: number; skipped: number; msg?: string } {
  const l = L[id]; let added = 0, skipped = 0, msg: string | undefined;
  if (!l) return { added, skipped, msg: 'No such watchlist' };
  for (const e of entries) {
    if (l.syms.includes(e) || (!isSection(e) && reject(e))) continue;
    if (!isSection(e) && symCount(l) >= MAX_SYMS) { skipped++; msg = MSG.syms; continue }
    l.syms.push(e); if (!isSection(e)) added++;
    if (!checkBytes(L).ok) { l.syms.pop(); if (!isSection(e)) added--; skipped++; msg = MSG.big }
  }
  return { added, skipped, msg };
}
/** A new list from an import file. */
export function importAsList(L: WLists, name: string, entries: string[], reject?: (s: string) => boolean): R & { id?: string; added?: number; skipped?: number } {
  const c = createList(L, name);
  if (!c.ok) return c;
  const r = importEntries(L, c.id!, entries, reject);
  return { ok: true, id: c.id, added: r.added, skipped: r.skipped, msg: r.msg };
}

// ---------- combined view ----------
export interface Row { sym: string; lists: string[] }
/** Symbols of several lists in one view: lists in their order, symbols in list order, duplicates merged (every list that holds one is kept). Sections are left out. */
export function combinedRows(L: WLists, ids: string[]): Row[] {
  const rows = new Map<string, Row>();
  for (const id of sortedIds(L).filter(i => ids.includes(i))) for (const s of L[id].syms) {
    if (isSection(s)) continue;
    const r = rows.get(s); if (r) r.lists.push(id); else rows.set(s, { sym: s, lists: [id] });
  }
  return [...rows.values()];
}
