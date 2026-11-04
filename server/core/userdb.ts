// Per-user databases. Private mode: user 1 IS the single database (`db`), unchanged. Public mode: one SQLite file per
// user (DATA_DIR/users/<id>.db), so a handler that only holds its own user's handle cannot reach another user's rows.
// Per-user modules declare tables with userMigration() and never import db.ts (isolation.test.ts enforces this).
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR, PRAGMAS, db, runMigration } from './db.ts';
import { isPublic } from './mode.ts';
import { bytes, limits } from './quota.ts';

export interface User { id: number; name: string; role: 'admin' | 'user'; mustChange?: boolean }
export const PRIVATE_USER: User = { id: 1, name: 'owner', role: 'admin' };
export const ANON: User = { id: 0, name: '', role: 'user' };
/** The one user of a private server. Public mode has none: callers must pass a user id, so this throws there. */
export const soleUser = (): number => { if (isPublic) throw Error('user id required'); return 1 };

const migs: { name: string; sql: string }[] = [];
/** Per-user table(s). Private mode runs it now on the single database (exactly as before); public mode on each user file when it opens. */
export function userMigration(name: string, sql: string) {
  migs.push({ name, sql });
  if (!isPublic) runMigration(db, name, sql);
}

const DIR = join(DATA_DIR, 'users');
const MAX_OPEN = 64, IDLE_MS = 5 * 60_000;
const open = new Map<number, { d: DatabaseSync; used: number; migs: number }>();   // insertion order = least recently used first
const file = (id: number) => join(DIR, `${id}.db`);
const closeQuiet = (d: DatabaseSync) => { try { d.close() } catch {} };

function openFile(id: number, create: boolean): DatabaseSync {
  if (!Number.isInteger(id) || id < 1) throw Error('no such user');
  if (!create && !existsSync(file(id))) throw Error('no such user');
  mkdirSync(DIR, { recursive: true });
  const d = new DatabaseSync(file(id));
  d.exec(PRAGMAS);
  d.exec('CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, at INTEGER NOT NULL)');
  const cap = limits(id).dbMb;
  if (Number.isFinite(cap)) d.exec(`PRAGMA max_page_count = ${Math.max(1, Math.floor(bytes(cap) / 4096))}`);   // hard ceiling on the file
  return d;
}
function handle(id: number, create: boolean): DatabaseSync {
  let h = open.get(id);
  if (!h) {
    h = { d: openFile(id, create), used: 0, migs: 0 };
    open.set(id, h);
    while (open.size > MAX_OPEN) { const [k, v] = open.entries().next().value!; closeQuiet(v.d); open.delete(k) }
  } else { open.delete(id); open.set(id, h) }
  while (h.migs < migs.length) { const m = migs[h.migs++]; runMigration(h.d, m.name, m.sql) }
  h.used = Date.now();
  return h.d;
}
/**
 * Handle of an EXISTING user's database. Do not keep it across an await: the handle may be closed when idle or evicted;
 * call userDb(id) again instead (Ctx.db does this on every access).
 */
export function userDb(id: number): DatabaseSync {
  if (!isPublic) { if (id !== 1) throw Error('no such user'); return db }
  return handle(id, false);
}
/** Create the file of a brand-new user (registration). */
export function createUserDb(id: number): DatabaseSync { return isPublic ? handle(id, true) : db }
export function closeUserDb(id: number) { const h = open.get(id); if (h) { closeQuiet(h.d); open.delete(id) } }
/** Delete the user's whole data (account deletion). */
export function deleteUserDb(id: number) {
  closeUserDb(id);
  for (const s of ['', '-wal', '-shm']) rmSync(file(id) + s, { force: true });
}
export const userDbExists = (id: number) => !isPublic ? id === 1 : existsSync(file(id));
/** Size of the user's database file in bytes (0 when it does not exist). */
export function userDbBytes(id: number): number {
  try { const d = userDb(id); const p = (d.prepare('PRAGMA page_count').get() as { page_count: number }).page_count, s = (d.prepare('PRAGMA page_size').get() as { page_size: number }).page_size; return p * s } catch { return 0 }
}

if (isPublic) setInterval(() => { for (const [k, v] of open) if (Date.now() - v.used > IDLE_MS) { closeQuiet(v.d); open.delete(k) } }, 60_000).unref();
