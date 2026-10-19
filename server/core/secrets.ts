// Secrets (bot tokens, SMTP password, exchange keys later) encrypted with AES-256-GCM in the database.
// The 32-byte key comes from CT_SECRET_KEY (base64) or server/data/secret.key, created on first run. Never logged, never sent to clients.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR, db, migration } from './db.ts';

migration('secrets/1', `CREATE TABLE secrets (name TEXT PRIMARY KEY, iv BLOB NOT NULL, tag BLOB NOT NULL, data BLOB NOT NULL, updated INTEGER NOT NULL)`);

function loadKey(): Buffer {
  if (process.env.CT_SECRET_KEY) { const k = Buffer.from(process.env.CT_SECRET_KEY, 'base64'); if (k.length !== 32) throw Error('CT_SECRET_KEY must be 32 bytes, base64'); return k }
  const file = join(DATA_DIR, 'secret.key');
  if (!existsSync(file)) { writeFileSync(file, randomBytes(32).toString('base64'), { mode: 0o600 }); try { chmodSync(file, 0o600) } catch {} }
  return Buffer.from(readFileSync(file, 'utf8').trim(), 'base64');
}
const KEY = loadKey();

export function secretSet(name: string, value: string) {
  const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', KEY, iv);
  c.setAAD(Buffer.from(name));   // a ciphertext can't be moved to another name
  const data = Buffer.concat([c.update(value, 'utf8'), c.final()]);
  db.prepare('INSERT INTO secrets (name, iv, tag, data, updated) VALUES (?, ?, ?, ?, ?) ON CONFLICT(name) DO UPDATE SET iv = excluded.iv, tag = excluded.tag, data = excluded.data, updated = excluded.updated')
    .run(name, iv, c.getAuthTag(), data, Date.now());
}
export function secretGet(name: string): string | null {
  const r = db.prepare('SELECT iv, tag, data FROM secrets WHERE name = ?').get(name) as { iv: Uint8Array; tag: Uint8Array; data: Uint8Array } | undefined;
  if (!r) return null;
  const d = createDecipheriv('aes-256-gcm', KEY, r.iv);
  d.setAAD(Buffer.from(name)); d.setAuthTag(r.tag);
  return Buffer.concat([d.update(r.data), d.final()]).toString('utf8');
}
export const secretHas = (name: string) => !!db.prepare('SELECT 1 FROM secrets WHERE name = ?').get(name);
export function secretDel(name: string) { db.prepare('DELETE FROM secrets WHERE name = ?').run(name) }
