// Synced app state: one JSON document per key (the same keys the client keeps in localStorage as `ct.<key>`),
// with a revision counter. Server modules (forward tests writing the paper account) use stateGet/stateSet;
// the HTTP routes and media storage are added by the sync agent — see docs/phase5-contracts.md §3.
import { db, migration } from './core/db.ts';
import { broadcast, type WsClient } from './core/http.ts';

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
