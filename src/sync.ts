// Client side of the server connection (docs/phase5-contracts.md §3): one event WebSocket with server messages fanned
// out by `type`, the queue that pushes `store.set` writes to the server, and the localStorage <-> server helpers boot uses.
// Imports nothing from the app so every module (store.ts included) can use it.
type Handler = (msg: Record<string, unknown>) => void;
const handlers = new Map<string, Set<Handler>>();

/** Subscribe to server messages of one `type` ('notify', 'state', 'alerts', 'alert.fired', 'forward', …). */
export function onServer(type: string, h: Handler): () => void {
  let s = handlers.get(type); if (!s) handlers.set(type, (s = new Set()));
  s.add(h);
  return () => s!.delete(h);
}
/** Called by the socket owner for every incoming message. */
export function dispatchServer(msg: Record<string, unknown>) { handlers.get(String(msg.type))?.forEach(h => h(msg)) }
/** True when the app is connected to (and logged in on) the server; false in offline / server-less mode. */
export let serverMode = false;
export function setServerMode(on: boolean) { serverMode = on }

/** Random id of this tab: sent in `sync.hello` and as `x-ct-client`, so the server doesn't echo our own writes back. */
export const clientId = Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, '0')).join('');

/** JSON call to the server API; throws Error(message) on failure (with `.status` when the server answered). */
export async function api<T>(path: string, init: { method?: string; body?: unknown; keepalive?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = { 'x-ct-client': clientId };
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  const r = await fetch(path, { method: init.method ?? (init.body === undefined ? 'GET' : 'POST'), headers, body: init.body === undefined ? undefined : JSON.stringify(init.body), credentials: 'same-origin', keepalive: init.keepalive });
  if (r.status === 204) return undefined as T;
  const j = await r.json().catch(() => ({ error: `Server error ${r.status}` }));
  if (!r.ok) throw Object.assign(Error((j as { error?: string }).error ?? String(r.status)), { status: r.status });
  return j as T;
}

// ---------- which keys sync ----------
/** Keys the running app applies live when another device or the server changes them (the server writes `acct` for forward-test fills). */
export const HOT_KEYS = new Set(['acct']);
/** Per-device UI state: never sent to the server. */
export const LOCAL_KEYS = new Set(['bottomH', 'side', 'jwFormTab', 'tsTab', 'domCfg', 'pineEditing', 'lastTool', 'searchEx']);
const KEY_RE = /^[A-Za-z0-9_.-]{1,64}$/;   // same as server/state.ts
export const isSynced = (key: string) => KEY_RE.test(key) && !LOCAL_KEYS.has(key);

type Kv = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;
export type ServerState = Record<string, { value: unknown; rev: number; updated: number }>;
/** Values that didn't fit in localStorage (quota): store.get falls back to them so nothing overwrites server data with defaults. */
export const memo = new Map<string, string>();
/** Last known server revision per key. */
export const revs = new Map<string, number>();

/** Synced `ct.*` keys present in this browser (without the prefix). */
export function localKeys(ls: Kv = localStorage): string[] {
  const out: string[] = [];
  for (let i = 0; i < ls.length; i++) { const k = ls.key(i); if (k?.startsWith('ct.') && isSynced(k.slice(3))) out.push(k.slice(3)) }
  return out;
}
/** Parsed values of the synced keys (unparseable entries are skipped). */
export function localSnapshot(ls: Kv = localStorage): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of localKeys(ls)) try { out[k] = JSON.parse(ls.getItem('ct.' + k)!) } catch {}
  return out;
}
/** Make this browser match the server: write every server value, drop synced keys the server doesn't have. Device-local keys stay. */
export function hydrate(state: ServerState, ls: Kv = localStorage) {
  for (const k of localKeys(ls)) if (!(k in state)) ls.removeItem('ct.' + k);
  for (const [k, row] of Object.entries(state)) {
    if (!isSynced(k)) continue;
    revs.set(k, row.rev);
    const json = JSON.stringify(row.value);
    try { ls.setItem('ct.' + k, json); memo.delete(k) } catch { ls.removeItem('ct.' + k); memo.set(k, json) }
  }
}

// ---------- outgoing writes: debounced per key, retried with backoff, last write wins on the server ----------
const pending = new Map<string, unknown>(), timers = new Map<string, number>(), busy = new Set<string>();
let failing = false, online = false;
/** Queue a key for the server (no-op offline or for device-local keys). `undefined` deletes it. */
export function queueState(key: string, value: unknown) {
  if (!serverMode || !isSynced(key)) return;
  pending.set(key, value);
  schedule(key, 400, 0);
}
function schedule(key: string, ms: number, attempt: number) {
  clearTimeout(timers.get(key));
  timers.set(key, window.setTimeout(() => { timers.delete(key); void send(key, attempt) }, ms));
  status();
}
async function send(key: string, attempt: number) {
  if (busy.has(key) || !pending.has(key)) return;   // a write in flight reschedules itself when it ends
  const value = pending.get(key); pending.delete(key); busy.add(key);
  let next = 400;
  try {
    if (value === undefined) { await api(`/api/state/${key}`, { method: 'DELETE' }); revs.delete(key) }
    else revs.set(key, (await api<{ rev: number }>(`/api/state/${key}`, { method: 'PUT', body: { value } })).rev);
    failing = false; attempt = 0;
  } catch (e) {
    const s = (e as { status?: number }).status;
    if (s === 400 || s === 413) note(`Could not save "${key}" on the server: ${(e as Error).message}`);
    else {
      if (!pending.has(key)) pending.set(key, value);
      failing = true; next = Math.min(30_000, 1000 * 2 ** attempt++);
      if (s === 401) signedOut();
    }
  } finally {
    busy.delete(key);
    if (pending.has(key) && !timers.has(key)) schedule(key, next, attempt);
    status();
  }
}
/** Send everything queued now (before logging out / leaving). keepalive lets small writes survive the page closing. */
export async function flushNow(keepalive = false) {
  await Promise.allSettled([...pending].map(([key, value]) => {
    clearTimeout(timers.get(key)); timers.delete(key); pending.delete(key);
    return value === undefined ? api(`/api/state/${key}`, { method: 'DELETE', keepalive }) : api(`/api/state/${key}`, { method: 'PUT', body: { value }, keepalive });
  }));
}

// ---------- status for the account button ----------
export type SyncStatus = 'synced' | 'saving' | 'offline';
const statusFns = new Set<(s: SyncStatus) => void>();
export function onSyncStatus(fn: (s: SyncStatus) => void) { statusFns.add(fn); fn(syncStatus()) }
export const syncStatus = (): SyncStatus => (!online || failing ? 'offline' : pending.size || busy.size ? 'saving' : 'synced');
function status() { const s = syncStatus(); statusFns.forEach(f => f(s)) }

// ---------- incoming ----------
let reloadShown = false, signedOutShown = false;
function applyRemote(key: string, value: unknown, rev: number) {
  if (!isSynced(key)) return;
  if (rev) revs.set(key, rev); else revs.delete(key);
  // A local write waiting to go out wins (it will overwrite the server anyway).
  if (!pending.has(key) && !busy.has(key)) try {
    if (!rev) localStorage.removeItem('ct.' + key); else localStorage.setItem('ct.' + key, JSON.stringify(value));
    memo.delete(key);
  } catch { memo.set(key, JSON.stringify(value)) }
  // The app reads its state at start-up, so a reload is the honest way to show the change.
  if (HOT_KEYS.has(key)) return;   // the app applies these live (main.ts), no reload needed
  if (!reloadShown) { reloadShown = true; note('Updated on another device', { label: 'Reload', run: () => location.reload() }) }
}
function signedOut() {
  if (signedOutShown) return; signedOutShown = true;
  note('Signed out on this device — your latest changes were not saved', { label: 'Sign in', run: () => location.reload() });
}
/** Writes that happened while the socket was down: compare revisions with the server. */
async function resync() {
  const st = await api<ServerState>('/api/state').catch(() => null); if (!st) return;
  for (const [k, row] of Object.entries(st)) if (revs.get(k) !== row.rev) applyRemote(k, row.value, row.rev);
  for (const k of [...revs.keys()]) if (!(k in st)) applyRemote(k, null, 0);
}

let started = false, wait = 1000;
/** Open the event socket (server mode, after login). Reconnects with backoff. */
export function startSync() {
  if (started) return; started = true;
  onServer('state', m => applyRemote(String(m.key), m.value, Number(m.rev) || 0));
  addEventListener('pagehide', () => void flushNow(true));
  connect(false);
}
function connect(again: boolean) {
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  let opened = false;
  ws.onopen = () => {
    opened = true; online = true; wait = 1000; status();
    ws.send(JSON.stringify({ op: 'sync.hello', client: clientId }));
    if (again) void resync();
  };
  ws.onmessage = e => { let m: unknown; try { m = JSON.parse(String(e.data)) } catch { return } if (m && typeof (m as { type?: unknown }).type === 'string') dispatchServer(m as Record<string, unknown>) };
  ws.onclose = async () => {
    online = false; status();
    if (!opened) {   // refused before opening: maybe the session ended (password changed on another device)
      const st = await fetch('/api/auth/status').then(r => r.json() as Promise<{ loggedIn?: boolean }>).catch(() => null);
      if (st && !st.loggedIn) return signedOut();
    }
    setTimeout(() => connect(true), wait); wait = Math.min(wait * 2, 30_000);
  };
}

/** Toast with an optional button (stays until clicked when it has one). Uses the app's #toast box. */
export function note(msg: string, action?: { label: string; run: () => void }, ms = 6000) {
  const box = document.getElementById('toast'); if (!box) return;
  const d = document.createElement('div'); d.textContent = msg;
  if (action) {
    const b = document.createElement('button'); b.textContent = action.label; b.style.marginLeft = '10px';
    b.onclick = () => { d.remove(); action.run() }; d.append(b);
  } else setTimeout(() => d.remove(), ms);
  box.append(d);
}
