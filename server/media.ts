// Journal pictures and voice notes as BLOBs in SQLite (one file to back up; they are small after client-side shrinking).
//   POST /api/media (raw image/* or audio/*, ≤ 15 MB) → { id };  GET /api/media/:id → bytes;  DELETE /api/media/:id
// Each user's rows live in that user's own database file, so an id from another account simply does not exist (404).
import { randomBytes } from 'node:crypto';
import { userMigration } from './core/userdb.ts';
import { HttpError, RAW, bad, route } from './core/http.ts';
import { isPublic } from './core/mode.ts';
import { bytes, limits, tooBig, tooMany } from './core/quota.ts';

userMigration('media/1', `CREATE TABLE media (id TEXT PRIMARY KEY, type TEXT NOT NULL, data BLOB NOT NULL, created INTEGER NOT NULL)`);

// SVG can carry script, so only raster images and audio are accepted.
export const MEDIA_TYPE_RE = /^(image\/(png|jpeg|gif|webp|avif|bmp)|audio\/[\w.+-]+)$/;
const MAGIC: Record<string, (b: Buffer) => boolean> = {
  'image/png': b => b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])),
  'image/jpeg': b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/gif': b => b.subarray(0, 4).toString('latin1') === 'GIF8',
  'image/webp': b => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
  'image/bmp': b => b.subarray(0, 2).toString('latin1') === 'BM',
  'image/avif': b => b.subarray(4, 8).toString('latin1') === 'ftyp',
};
/** Public mode: the bytes must really be the picture the Content-Type claims (a polyglot cannot ride on a share link). */
export const sniffOk = (type: string, data: Buffer) => !isPublic || !MAGIC[type] || MAGIC[type](data);

route('POST', '/api/media', c => {
  const type = String(c.req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase(), data = c.body as Buffer, L = limits(c.user.id);
  if (!MEDIA_TYPE_RE.test(type)) throw bad('Only pictures (png, jpeg, gif, webp) and audio can be stored');
  if (!data.length) throw bad('Empty file');
  if (!sniffOk(type, data)) throw bad('The file is not the kind of picture it claims to be');
  if (data.length > bytes(L.mediaEachMb)) throw tooBig('This file', L.mediaEachMb);
  if (Number.isFinite(L.mediaItems) || Number.isFinite(L.mediaMb)) {
    const u = c.db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(length(data)), 0) AS b FROM media').get() as { n: number; b: number };
    if (u.n >= L.mediaItems) throw tooMany('pictures and recordings', L.mediaItems);
    if (u.b + data.length > bytes(L.mediaMb)) throw new HttpError(413, `Your pictures and recordings would exceed ${L.mediaMb} MB`);
  }
  const id = 'm' + randomBytes(12).toString('base64url');
  c.db.prepare('INSERT INTO media (id, type, data, created) VALUES (?, ?, ?, ?)').run(id, type, data, Date.now());
  return { id };
}, { raw: true, limit: 15 * 1024 * 1024 });

route('GET', '/api/media/:id', c => {
  const r = c.db.prepare('SELECT type, data FROM media WHERE id = ?').get(c.params.id) as { type: string; data: Uint8Array } | undefined;
  if (!r) throw new HttpError(404, 'No such media');
  c.res.writeHead(200, {
    'content-type': r.type, 'content-length': r.data.byteLength, 'cache-control': 'private, max-age=31536000, immutable',
    'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox", 'referrer-policy': 'no-referrer',
  }).end(r.data);
  return RAW;
});

route('DELETE', '/api/media/:id', c => {
  const n = c.db.prepare('DELETE FROM media WHERE id = ?').run(c.params.id).changes;
  if (!n && isPublic) throw new HttpError(404, 'No such media');
});
