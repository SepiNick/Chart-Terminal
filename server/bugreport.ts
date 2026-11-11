// Bug reports from the app's "Report a bug" dialog: a description, an optional contact, the app's own diagnostic text (already
// redacted in the browser: no keys, tokens or addresses) and up to three screenshots.
//   POST /api/bugreport { description, contact?, info?, images?: [data:image/(jpeg|png|webp);base64,…] }  → { ok, id, sent }
// The report is kept in DATA_DIR/bugreports/<id>/ (report.txt and the images) and, when a Telegram bot and a personal chat are set
// up in the notification settings, sent to that chat (text, then each image). `sent` says whether Telegram took it.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { DATA_DIR } from './core/db.ts';
import { bad, route, type Ctx } from './core/http.ts';
import { secretGet } from './core/secrets.ts';
import { senders, tgChatId } from './notify/index.ts';

export const MAX_IMAGES = 3, MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export interface Report { description: string; contact: string; info: string; images: { ext: string; bytes: Buffer }[] }
const IMG = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/;
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\u0000/g, '').trim().slice(0, max) : '');

/** Validates the request body; throws a 400 for anything that is not a plain report. */
export function parseReport(b: unknown): Report {
  const o = (b && typeof b === 'object' && !Array.isArray(b) ? b : {}) as Record<string, unknown>;
  const description = text(o.description, 5000);
  if (description.length < 5) throw bad('Describe the problem (at least a few words)');
  const raw = Array.isArray(o.images) ? o.images : [];
  if (raw.length > MAX_IMAGES) throw bad(`At most ${MAX_IMAGES} images`);
  const images = raw.map(x => {
    const m = typeof x === 'string' ? IMG.exec(x) : null;
    if (!m) throw bad('Images must be jpeg, png or webp');
    const bytes = Buffer.from(m[2], 'base64');
    if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw bad('An image is empty or larger than 2 MB');
    return { ext: m[1] === 'jpeg' ? 'jpg' : m[1], bytes };
  });
  return { description, contact: text(o.contact, 200), info: text(o.info, 20000), images };
}

async function telegram(id: string, r: Report): Promise<boolean> {
  const token = secretGet('telegram.token'), chat = tgChatId();
  if (!token || !/^\d{1,20}$/.test(chat)) return false;
  const call = async (method: string, form: FormData) => {
    form.set('chat_id', chat);
    const res = await senders.fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', body: form, signal: AbortSignal.timeout(30_000) });
    return ((await res.json().catch(() => ({}))) as { ok?: boolean }).ok === true;
  };
  const head = new FormData();
  head.set('text', `Bug report ${id}${r.contact ? `\nContact: ${r.contact}` : ''}\n\n${r.description}`.slice(0, 4000));
  let ok = await call('sendMessage', head);
  if (r.info) { const f = new FormData(); f.set('document', new Blob([r.info], { type: 'text/plain' }), `diagnostics-${id}.txt`); ok = (await call('sendDocument', f)) && ok }
  for (const [i, im] of r.images.entries()) { const f = new FormData(); f.set('photo', new Blob([im.bytes], { type: `image/${im.ext === 'jpg' ? 'jpeg' : im.ext}` }), `screenshot-${i + 1}.${im.ext}`); ok = (await call('sendPhoto', f)) && ok }
  return ok;
}

route('POST', '/api/bugreport', async (c: Ctx) => {
  const r = parseReport(c.body), id = `${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')}-${randomBytes(3).toString('hex')}`;
  const dir = join(DATA_DIR, 'bugreports', id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'report.txt'), `${r.description}\n\nContact: ${r.contact || '-'}\n\n${r.info}\n`);
  r.images.forEach((im, i) => writeFileSync(join(dir, `screenshot-${i + 1}.${im.ext}`), im.bytes));
  let sent = false;
  try { sent = await telegram(id, r) } catch { /* kept on disk; the owner can still read it */ }
  return { ok: true, id, sent };
}, { limit: 9 * 1024 * 1024 });
