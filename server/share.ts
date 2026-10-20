// Share links (ROADMAP phase 2 → 5):
//   POST /api/share/snapshot (raw png/jpeg/webp ≤ 8 MB) → { id, url }   GET /s/:id → the image, no login needed
//   POST /api/share/layout { name, layout, drawings } → { id, url }     GET /api/share/layout/:id → that JSON (logged in)
//   GET /api/share → [{ id, kind, url, name, created, bytes }]   DELETE /api/share/:id
// Ids are 128-bit random: a snapshot link is public to whoever has it (on the LAN now, the internet once on a VPS).
import { randomBytes } from 'node:crypto';
import { db, migration } from './core/db.ts';
import { HttpError, RAW, bad, route } from './core/http.ts';

migration('share/1', `CREATE TABLE shares (id TEXT PRIMARY KEY, kind TEXT NOT NULL, type TEXT NOT NULL, data BLOB NOT NULL, created INTEGER NOT NULL)`);

const newId = () => randomBytes(16).toString('base64url');
const put = (kind: 'snap' | 'layout', type: string, data: Uint8Array | string) => {
  const id = newId();
  db.prepare('INSERT INTO shares (id, kind, type, data, created) VALUES (?, ?, ?, ?, ?)').run(id, kind, type, data, Date.now());
  return id;
};
const get = (kind: string, id: string) => {
  const r = db.prepare('SELECT type, data FROM shares WHERE id = ? AND kind = ?').get(id, kind) as { type: string; data: Uint8Array | string } | undefined;
  if (!r) throw new HttpError(404, 'This link does not exist (any more)');
  return r;
};

route('POST', '/api/share/snapshot', c => {
  const type = String(c.req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase(), data = c.body as Buffer;
  if (!/^image\/(png|jpeg|webp)$/.test(type)) throw bad('Only png, jpeg or webp');
  if (!data.length) throw bad('Empty image');
  const id = put('snap', type, data);
  return { id, url: `/s/${id}` };
}, { raw: true, limit: 8 * 1024 * 1024 });

route('GET', '/s/:id', c => {
  const r = get('snap', c.params.id), data = r.data as Uint8Array;
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
  const id = put('layout', 'application/json', JSON.stringify({ name, layout: b.layout, drawings: b.drawings ?? {} }));
  return { id, url: `/?layout=${id}` };
});

route('GET', '/api/share/layout/:id', c => JSON.parse(String(get('layout', c.params.id).data)));

route('GET', '/api/share', () => (db.prepare(`SELECT id, kind, created, length(data) AS bytes, CASE kind WHEN 'layout' THEN json_extract(data, '$.name') END AS name FROM shares ORDER BY created DESC`).all() as { id: string; kind: string }[])
  .map(r => ({ ...r, url: r.kind === 'snap' ? `/s/${r.id}` : `/?layout=${r.id}` })));
route('DELETE', '/api/share/:id', c => { if (!db.prepare('DELETE FROM shares WHERE id = ?').run(c.params.id).changes) throw new HttpError(404, 'No such link') });
