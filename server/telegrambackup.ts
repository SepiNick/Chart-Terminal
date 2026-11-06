// Sends an encrypted backup file to the owner's personal Telegram chat. The file is encrypted in the browser with a passphrase the
// server never sees, and holds only synced app state (layouts, drawings, alerts, watchlists, settings): never API keys.
//   POST /api/notify/telegram/backup { name, data }   data = base64 of the encrypted file (at most 8 MB)  → { ok: true }
import { HttpError, bad, route, type Ctx } from './core/http.ts';
import { secretGet } from './core/secrets.ts';
import { senders, tgChatId } from './notify/index.ts';

const MAX = 8 * 1024 * 1024;

route('POST', '/api/notify/telegram/backup', async (c: Ctx) => {
  const b = (c.body && typeof c.body === 'object' ? c.body : {}) as Record<string, unknown>;
  const token = secretGet('telegram.token'), chat = tgChatId();
  if (!token || !/^\d{1,20}$/.test(chat)) throw new HttpError(409, 'Set a Telegram bot and a personal chat in the notification settings first');
  const name = typeof b.name === 'string' && /^[\w.-]{1,80}$/.test(b.name) ? b.name : 'chart-terminal-backup.enc.json';
  if (typeof b.data !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(b.data)) throw bad('Backup data missing');
  const bytes = Buffer.from(b.data, 'base64');
  if (!bytes.length || bytes.length > MAX) throw bad('Backup is empty or larger than 8 MB');
  const form = new FormData();
  form.set('chat_id', chat);
  form.set('caption', 'Chart Terminal backup (encrypted). Keep the passphrase: it cannot be recovered.');
  form.set('document', new Blob([bytes], { type: 'application/json' }), name);
  const r = await senders.fetch(`https://api.telegram.org/bot${token}/sendDocument`, { method: 'POST', body: form, signal: AbortSignal.timeout(60_000) });
  const j = await r.json().catch(() => ({})) as { ok?: boolean; description?: string };
  if (!j.ok) throw bad(`Telegram: ${(j.description ?? `HTTP ${r.status}`).replaceAll(token, '***')}`);
  return { ok: true };
}, { limit: 12 * 1024 * 1024 });
