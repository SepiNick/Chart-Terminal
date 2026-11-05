// Restore points: "undo for 30 days" for the client's match/merge (docs/research/oauth-sync-design.md 4.4). A restore point is a
// snapshot { key: value } of synced keys, kept in the owner's own database. At most 5, 30 days, restoreMb in total.
//   POST   /api/restore { label, keys? }  -> { id }   keys omitted: the server snapshots the account's current synced state
//   GET    /api/restore                   -> [{ id, at, label, keys, bytes }]   (no bodies)
//   GET    /api/restore/:id               -> { id, at, label, keys: { key: value } }
//   DELETE /api/restore/:id
//   POST   /api/restore/:id/apply         -> { ok, revs, undo: <id of the new restore point of the state it replaced> }
// Applying replaces the account's synced keys with the snapshot (keys the snapshot lacks are deleted) in one transaction.
import { userDb, userMigration } from './core/userdb.ts';
import { HttpError, bad, obj, route, type Ctx } from './core/http.ts';
import { bytes, limits, tooBig } from './core/quota.ts';
import { isPublic } from './core/mode.ts';
import { KEY_RE, stateAll, stateBatch } from './state.ts';

userMigration('restore/1', `CREATE TABLE restore (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, label TEXT NOT NULL, json TEXT NOT NULL)`);
const DAYS = 30, MAX_ROWS = 5;

function purge(uid: number) { userDb(uid).prepare('DELETE FROM restore WHERE at < ?').run(Date.now() - DAYS * 86400_000) }
function create(uid: number, label: string, keys: Record<string, unknown>): number {
  const d = userDb(uid), json = JSON.stringify(keys), cap = limits(uid).restoreMb;
  if (Buffer.byteLength(json) > bytes(cap)) throw tooBig('A restore point', cap);
  purge(uid);
  d.prepare('INSERT INTO restore (at, label, json) VALUES (?, ?, ?)').run(Date.now(), label.slice(0, 60), json);
  const id = (d.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id;
  // Oldest go first: past 5 rows, or past the byte budget (the new one always stays).
  for (;;) {
    const rows = d.prepare('SELECT id, length(CAST(json AS BLOB)) AS b FROM restore ORDER BY id').all() as { id: number; b: number }[];
    if (rows.length <= 1 || (rows.length <= MAX_ROWS && rows.reduce((s, r) => s + r.b, 0) <= bytes(cap))) break;
    d.prepare('DELETE FROM restore WHERE id = ?').run(rows[0].id);
  }
  return id;
}
const snapshot = (uid: number) => Object.fromEntries(Object.entries(stateAll(uid)).map(([k, r]) => [k, r.value]));
const rowOf = (c: Ctx) => {   // a non-numeric or foreign id is a plain 404
  const id = /^\d{1,12}$/.test(c.params.id) ? Number(c.params.id) : 0;
  purge(c.user.id);
  const r = id ? userDb(c.user.id).prepare('SELECT id, at, label, json FROM restore WHERE id = ?').get(id) as { id: number; at: number; label: string; json: string } | undefined : undefined;
  if (!r) throw new HttpError(404, 'No such restore point');
  return r;
};
const big = { limit: () => (isPublic ? bytes(limits(0).restoreMb) + 65536 : 64 * 1024 * 1024) };

route('POST', '/api/restore', c => {
  const b = obj(c.body ?? {}, 'Body'), label = typeof b.label === 'string' && b.label ? b.label : 'restore point';
  let keys: Record<string, unknown>;
  if (b.keys === undefined) keys = snapshot(c.user.id);
  else { keys = obj(b.keys, 'keys'); for (const k of Object.keys(keys)) if (!KEY_RE.test(k)) throw bad('Bad state key') }
  return { id: create(c.user.id, label, keys) };
}, big);
route('GET', '/api/restore', c => {
  purge(c.user.id);
  return (userDb(c.user.id).prepare('SELECT id, at, label, json FROM restore ORDER BY id DESC').all() as { id: number; at: number; label: string; json: string }[])
    .map(r => ({ id: r.id, at: r.at, label: r.label, keys: Object.keys(JSON.parse(r.json)).length, bytes: Buffer.byteLength(r.json) }));
});
route('GET', '/api/restore/:id', c => { const r = rowOf(c); return { id: r.id, at: r.at, label: r.label, keys: JSON.parse(r.json) } });
route('DELETE', '/api/restore/:id', c => { userDb(c.user.id).prepare('DELETE FROM restore WHERE id = ?').run(rowOf(c).id) });
route('POST', '/api/restore/:id/apply', c => {
  const r = rowOf(c), keys = JSON.parse(r.json) as Record<string, unknown>, current = snapshot(c.user.id);
  const undo = create(c.user.id, `before restore #${r.id}`, current);   // undo is itself undoable
  const writes = [...Object.entries(keys).filter(([, v]) => v !== null).map(([key, value]) => ({ key, value })), ...Object.keys(current).filter(k => keys[k] == null).map(key => ({ key, value: null }))];
  return { ok: true, revs: stateBatch(c.user.id, writes), undo };
}, { limit: 4096 });
