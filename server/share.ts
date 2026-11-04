// Share links (ROADMAP phase 2 → 5):
//   POST /api/share/snapshot (raw png/jpeg/webp ≤ 8 MB) → { id, url }   GET /s/:id → the image, no login needed
//   POST /api/share/layout { name, layout, drawings } → { id, url }     GET /api/share/layout/:id → that JSON (logged in)
//   GET /api/share → [{ id, kind, url, name, created, bytes }]   DELETE /api/share/:id
// Ids are 128-bit random: a snapshot link is public to whoever has it (on the LAN now, the internet once on a VPS).
// Public mode: rows live in the owner's file; a small central index (id → owner) lets /s/:id find the right file.
// Layouts are private to their owner there (a foreign id is a 404); snapshots stay public-by-link on purpose.
import { randomBytes } from 'node:crypto';
import { userDb, userMigration } from './core/userdb.ts';
import { HttpError, RAW, bad, route, type Ctx } from './core/http.ts';
import { isPublic } from './core/mode.ts';
import { bytes, limits, tooBig, tooMany } from './core/quota.ts';
import { sniffOk } from './media.ts';

const U = isPublic ? await import('./core/users.ts') : null;
userMigration('share/1', `CREATE TABLE shares (id TEXT PRIMARY KEY, kind TEXT NOT NULL, type TEXT NOT NULL, data BLOB NOT NULL, created INTEGER NOT NULL)`);

const newId = () => randomBytes(16).toString('base64url');
function put(c: Ctx, kind: 'snap' | 'layout', type: string, data: Uint8Array | string) {
  const L = limits(c.user.id), size = typeof data === 'string' ? Buffer.byteLength(data) : data.byteLength;
  if (Number.isFinite(L.shares) || Number.isFinite(L.shareMb)) {
    const u = c.db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(length(data)), 0) AS b FROM shares').get() as { n: number; b: number };
    if (u.n >= L.shares) throw tooMany('share links', L.shares);
    if (u.b + size > bytes(L.shareMb)) throw new HttpError(413, `Your share links would exceed ${L.shareMb} MB`);
  }
  const id = newId();
  c.db.prepare('INSERT INTO shares (id, kind, type, data, created) VALUES (?, ?, ?, ?, ?)').run(id, kind, type, data, Date.now());
  if (kind === 'snap') U?.indexShare(id, c.user.id);
  return id;
}
const row = (d: ReturnType<typeof userDb>, kind: string, id: string) => d.prepare('SELECT type, data FROM shares WHERE id = ? AND kind = ?').get(id, kind) as { type: string; data: Uint8Array | string } | undefined;
const gone = () => new HttpError(404, 'This link does not exist (any more)');

route('POST', '/api/share/snapshot', c => {
  const type = String(c.req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase(), data = c.body as Buffer;
  if (!/^image\/(png|jpeg|webp)$/.test(type)) throw bad('Only png, jpeg or webp');
  if (!data.length) throw bad('Empty image');
  if (!sniffOk(type, data)) throw bad('The file is not the kind of picture it claims to be');
  if (data.length > bytes(limits(c.user.id).snapMb)) throw tooBig('The image', limits(c.user.id).snapMb);
  const id = put(c, 'snap', type, data);
  return { id, url: `/s/${id}` };
}, { raw: true, limit: bytes(limits(0).snapMb) });

route('GET', '/s/:id', c => {
  const owner = U ? U.shareOwner(c.params.id) : 1;
  if (!owner) throw gone();
  let r; try { r = row(userDb(owner), 'snap', c.params.id) } catch { r = undefined }
  if (!r) throw gone();
  const data = r.data as Uint8Array;
  c.res.writeHead(200, {
    'content-type': r.type, 'content-length': data.byteLength, 'cache-control': 'no-cache',   // deleting a link must take effect
    'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox", 'referrer-policy': 'no-referrer',
  }).end(data);
  return RAW;
}, { public: true });

route('POST', '/api/share/layout', c => {
  const b = c.body as { name?: unknown; layout?: { panes?: unknown }; drawings?: unknown } | undefined;
  if (!b || typeof b !== 'object' || !Array.isArray(b.layout?.panes)) throw bad('Not a layout');
  if (b.drawings != null && (typeof b.drawings !== 'object' || Array.isArray(b.drawings))) throw bad('Bad drawings');
  const name = typeof b.name === 'string' ? b.name.slice(0, 100) : 'Shared';
  const id = put(c, 'layout', 'application/json', JSON.stringify({ name, layout: b.layout, drawings: b.drawings ?? {} }));
  return { id, url: `/?layout=${id}` };
});

route('GET', '/api/share/layout/:id', c => {
  const r = row(c.db, 'layout', c.params.id);
  if (!r) throw gone();
  return JSON.parse(String(r.data));
});

route('GET', '/api/share', c => (c.db.prepare(`SELECT id, kind, created, length(data) AS bytes, CASE kind WHEN 'layout' THEN json_extract(data, '$.name') END AS name FROM shares ORDER BY created DESC`).all() as { id: string; kind: string }[])
  .map(r => ({ ...r, url: r.kind === 'snap' ? `/s/${r.id}` : `/?layout=${r.id}` })));
route('DELETE', '/api/share/:id', c => {
  if (!c.db.prepare('DELETE FROM shares WHERE id = ?').run(c.params.id).changes) throw new HttpError(404, 'No such link');
  U?.unindexShare(c.params.id);
});
