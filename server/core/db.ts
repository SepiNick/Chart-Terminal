// SQLite (Node's built-in node:sqlite). One file under server/data/ (git-ignored). Modules add their own tables
// through `migration(name, sql)`; each named migration runs once.
// Private mode: that one file is the whole database (= user 1). Public mode: this file is the central users.db (accounts,
// sessions, server config) and every user's own data lives in DATA_DIR/users/<id>.db (see userdb.ts).
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertPublicSafe, isPublic } from './mode.ts';

export const DATA_DIR = process.env.CT_DATA_DIR ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
mkdirSync(DATA_DIR, { recursive: true });
assertPublicSafe(DATA_DIR);

export const PRAGMAS = 'PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA journal_size_limit = 33554432;';   // WAL file shrinks back to 32 MB after a checkpoint
export const db = new DatabaseSync(isPublic ? join(DATA_DIR, 'users.db') : process.env.CT_DB ?? join(DATA_DIR, 'chart-terminal.db'));
db.exec(PRAGMAS);
db.exec('CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, at INTEGER NOT NULL)');

/** Run `sql` once on database `d`, recorded under `name`. */
export function runMigration(d: DatabaseSync, name: string, sql: string) {
  if (d.prepare('SELECT 1 FROM _migrations WHERE name = ?').get(name)) return;
  d.exec('BEGIN');
  try { d.exec(sql); d.prepare('INSERT INTO _migrations (name, at) VALUES (?, ?)').run(name, Date.now()); d.exec('COMMIT') }
  catch (e) { d.exec('ROLLBACK'); throw e }
}
/** Run `sql` once on the central database (use a module prefix, e.g. 'alerts/1'). Per-user tables use userMigration (userdb.ts). */
export const migration = (name: string, sql: string) => runMigration(db, name, sql);

/** Small key/value table for server-side settings (not user app state — that lives in `state`, see state.ts). */
migration('core/1', `CREATE TABLE config (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
export function configGet<T>(key: string, fallback: T): T {
  const r = db.prepare('SELECT value FROM config WHERE key = ?').get(key) as { value: string } | undefined;
  return r ? (JSON.parse(r.value) as T) : fallback;
}
export function configSet(key: string, value: unknown) {
  db.prepare('INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value));
}

export const now = () => Date.now();
