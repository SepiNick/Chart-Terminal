// Synced app state: one JSON document per key (the same keys the client keeps in localStorage as `ct.<key>`),
// with a revision counter. Server modules (forward tests writing the paper account) use stateGet/stateSet;
// the HTTP routes at the bottom serve the browser (docs/phase5-contracts.md §3); media blobs live in media.ts.
import { db, migration } from './core/db.ts';
import { bad, broadcast, onWs, onWsClose, route, type Ctx, type WsClient } from './core/http.ts';
import './media.ts';

migration('state/1', `CREATE TABLE state (key TEXT PRIMARY KEY, value TEXT NOT NULL, rev INTEGER NOT NULL, updated INTEGER NOT NULL)`);

export const KEY_RE = /^[A-Za-z0-9_.-]{1,64}$/;
export interface StateRow { value: unknown; rev: number; updated: number }

export function stateGet<T>(key: string): StateRow & { value: T } | null {
  const r = db.prepare('SELECT value, rev, updated FROM state WHERE key = ?').get(key) as { value: string; rev: number; updated: number } | undefined;
  return r ? { value: JSON.parse(r.value) as T, rev: r.rev, updated: r.updated } : null;
}
/**
 * Write a key (last write wins), bump its revision and tell every connected client except `origin`
 * with `{ type: 'state', key, rev, value, updated }`. Returns the new revision.
 */
export function stateSet(key: string, value: unknown, origin?: WsClient): number {
  if (!KEY_RE.test(key)) throw Error('Bad state key');
  const updated = Date.now(), json = JSON.stringify(value);
  const r = db.prepare('INSERT INTO state (key, value, rev, updated) VALUES (?, ?, 1, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, rev = state.rev + 1, updated = excluded.updated RETURNING rev')
    .get(key, json, updated) as { rev: number };
  broadcast({ type: 'state', key, rev: r.rev, value, updated }, origin);
  return r.rev;
}
export function stateDel(key: string, origin?: WsClient) {
  db.prepare('DELETE FROM state WHERE key = ?').run(key);
  broadcast({ type: 'state', key, rev: 0, value: null, updated: Date.now() }, origin);
}
export function stateAll(): Record<string, StateRow> {
  const out: Record<string, StateRow> = {};
  for (const r of db.prepare('SELECT key, value, rev, updated FROM state').all() as { key: string; value: string; rev: number; updated: number }[]) out[r.key] = { value: JSON.parse(r.value), rev: r.rev, updated: r.updated };
  return out;
}

// ---------- HTTP ----------
// Each browser tab says hello on its event socket with a random id and sends that id as `x-ct-client` on writes,
// so the broadcast skips the tab that made the change (it already has the value).
const tabs = new Map<string, WsClient>();
onWs('sync.hello', (c, m) => {
  const id = String(m.client ?? '');
  if (!/^[\w-]{8,64}$/.test(id)) return;
  tabs.set(id, c); c.data.set('sync.id', id);
});
onWsClose(c => { const id = c.data.get('sync.id') as string | undefined; if (id && tabs.get(id) === c) tabs.delete(id) });
export function originOf(c: Ctx): WsClient | undefined {
  const ws = tabs.get(String(c.req.headers['x-ct-client'] ?? ''));
  return ws && ws.session === c.session ? ws : undefined;
}
const keyOf = (c: Ctx) => { if (!KEY_RE.test(c.params.key)) throw bad('Bad state key'); return c.params.key };

route('GET', '/api/state', () => stateAll());
route('PUT', '/api/state/:key', c => {
  const key = keyOf(c), b = c.body as { value?: unknown } | null | undefined;
  if (!b || typeof b !== 'object' || b.value === undefined) throw bad('Body must be { value }');
  return { rev: stateSet(key, b.value, originOf(c)) };
}, { limit: 8 * 1024 * 1024 });
route('DELETE', '/api/state/:key', c => { stateDel(keyOf(c), originOf(c)) });
