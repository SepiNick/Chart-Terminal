// Journal pictures and voice notes as BLOBs in SQLite (one file to back up; they are small after client-side shrinking).
//   POST /api/media (raw image/* or audio/*, ≤ 15 MB) → { id };  GET /api/media/:id → bytes;  DELETE /api/media/:id
import { randomBytes } from 'node:crypto';
import { db, migration } from './core/db.ts';
import { HttpError, RAW, bad, route } from './core/http.ts';

migration('media/1', `CREATE TABLE media (id TEXT PRIMARY KEY, type TEXT NOT NULL, data BLOB NOT NULL, created INTEGER NOT NULL)`);

// SVG can carry script, so only raster images and audio are accepted.
export const MEDIA_TYPE_RE = /^(image\/(png|jpeg|gif|webp|avif|bmp)|audio\/[\w.+-]+)$/;

route('POST', '/api/media', c => {
  const type = String(c.req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase(), data = c.body as Buffer;
  if (!MEDIA_TYPE_RE.test(type)) throw bad('Only pictures (png, jpeg, gif, webp) and audio can be stored');
  if (!data.length) throw bad('Empty file');
  const id = 'm' + randomBytes(12).toString('base64url');
  db.prepare('INSERT INTO media (id, type, data, created) VALUES (?, ?, ?, ?)').run(id, type, data, Date.now());
  return { id };
}, { raw: true, limit: 15 * 1024 * 1024 });

route('GET', '/api/media/:id', c => {
  const r = db.prepare('SELECT type, data FROM media WHERE id = ?').get(c.params.id) as { type: string; data: Uint8Array } | undefined;
  if (!r) throw new HttpError(404, 'No such media');
  c.res.writeHead(200, {
    'content-type': r.type, 'content-length': r.data.byteLength, 'cache-control': 'private, max-age=31536000, immutable',
    'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox", 'referrer-policy': 'no-referrer',
  }).end(r.data);
  return RAW;
});

route('DELETE', '/api/media/:id', c => { db.prepare('DELETE FROM media WHERE id = ?').run(c.params.id) });
