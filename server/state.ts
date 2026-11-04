// Synced app state: one JSON document per key (the same keys the client keeps in localStorage as `ct.<key>`),
// with a revision counter. Server modules (forward tests writing the paper account) use stateGet/stateSet;
// the HTTP routes at the bottom serve the browser (docs/phase5-contracts.md §3); media blobs live in media.ts.
// Rows live in the owner's own database file; `uid` defaults to the single user of a private server.
import { soleUser, userDb, userMigration } from './core/userdb.ts';
import { HttpError, bad, broadcastTo, onWs, onWsClose, route, type Ctx, type WsClient } from './core/http.ts';
import { bytes, limits, tooBig, tooMany } from './core/quota.ts';
import './media.ts';

userMigration('state/1', `CREATE TABLE state (key TEXT PRIMARY KEY, value TEXT NOT NULL, rev INTEGER NOT NULL, updated INTEGER NOT NULL)`);

export const KEY_RE = /^[A-Za-z0-9_.-]{1,64}$/;
export interface StateRow { value: unknown; rev: number; updated: number }

export function stateGet<T>(key: string, uid = soleUser()): StateRow & { value: T } | null {
  const r = userDb(uid).prepare('SELECT value, rev, updated FROM state WHERE key = ?').get(key) as { value: string; rev: number; updated: number } | undefined;
  return r ? { value: JSON.parse(r.value) as T, rev: r.rev, updated: r.updated } : null;
}
/** Per-user quotas (public mode; a private server has none beyond the 8 MB per key of the route). */
function checkQuota(uid: number, key: string, size: number) {
  const L = limits(uid), cap = key === 'journal' ? L.journalKeyMb : L.stateKeyMb;
  if (size > bytes(cap)) throw tooBig(`"${key}"`, cap);
  if (!Number.isFinite(L.stateKeys) && !Number.isFinite(L.stateMb)) return;
  const d = userDb(uid), u = d.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(length(value)), 0) AS b FROM state').get() as { n: number; b: number };
  const old = d.prepare('SELECT length(value) AS l FROM state WHERE key = ?').get(key) as { l: number } | undefined;
  if (!old && u.n >= L.stateKeys) throw tooMany('synced documents', L.stateKeys);
  if (u.b - (old?.l ?? 0) + size > bytes(L.stateMb)) throw new HttpError(413, `Your synced data would exceed ${L.stateMb} MB`);
}
/**
 * Write a key (last write wins), bump its revision and tell every connected client of the same user except `origin`
 * with `{ type: 'state', key, rev, value, updated }`. Returns the new revision.
 */
export function stateSet(key: string, value: unknown, origin?: WsClient, uid = origin?.userId ?? soleUser()): number {
  if (!KEY_RE.test(key)) throw Error('Bad state key');
  const updated = Date.now(), json = JSON.stringify(value);
  checkQuota(uid, key, json.length);
  const r = userDb(uid).prepare('INSERT INTO state (key, value, rev, updated) VALUES (?, ?, 1, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, rev = state.rev + 1, updated = excluded.updated RETURNING rev')
    .get(key, json, updated) as { rev: number };
  broadcastTo(uid, { type: 'state', key, rev: r.rev, value, updated }, origin);
  return r.rev;
}
export function stateDel(key: string, origin?: WsClient, uid = origin?.userId ?? soleUser()) {
  userDb(uid).prepare('DELETE FROM state WHERE key = ?').run(key);
  broadcastTo(uid, { type: 'state', key, rev: 0, value: null, updated: Date.now() }, origin);
}
export function stateAll(uid = soleUser()): Record<string, StateRow> {
  const out: Record<string, StateRow> = {};
  for (const r of userDb(uid).prepare('SELECT key, value, rev, updated FROM state').all() as { key: string; value: string; rev: number; updated: number }[]) out[r.key] = { value: JSON.parse(r.value), rev: r.rev, updated: r.updated };
  return out;
}

// ---------- HTTP ----------
// Each browser tab says hello on its event socket with a random id and sends that id as `x-ct-client` on writes,
// so the broadcast skips the tab that made the change (it already has the value). Keyed by (user, id): one user's
// tab id can never name another user's socket.
const tabs = new Map<string, WsClient>();
onWs('sync.hello', (c, m) => {
  const id = String(m.client ?? '');
  if (!/^[\w-]{8,64}$/.test(id)) return;
  tabs.set(`${c.userId}:${id}`, c); c.data.set('sync.id', id);
});
onWsClose(c => { const id = c.data.get('sync.id') as string | undefined, k = `${c.userId}:${id}`; if (id && tabs.get(k) === c) tabs.delete(k) });
export function originOf(c: Ctx): WsClient | undefined {
  const ws = tabs.get(`${c.user.id}:${String(c.req.headers['x-ct-client'] ?? '')}`);
  return ws && ws.session === c.session ? ws : undefined;
}
const keyOf = (c: Ctx) => { if (!KEY_RE.test(c.params.key)) throw bad('Bad state key'); return c.params.key };

route('GET', '/api/state', c => stateAll(c.user.id));
route('PUT', '/api/state/:key', c => {
  const key = keyOf(c), b = c.body as { value?: unknown } | null | undefined;
  if (!b || typeof b !== 'object' || b.value === undefined) throw bad('Body must be { value }');
  return { rev: stateSet(key, b.value, originOf(c), c.user.id) };
}, { limit: 8 * 1024 * 1024 });
route('DELETE', '/api/state/:key', c => { stateDel(keyOf(c), originOf(c), c.user.id) });
