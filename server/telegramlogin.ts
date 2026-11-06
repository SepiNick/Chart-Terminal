// Sign in with Telegram, private server only. No domain or HTTPS needed (unlike Telegram's login widget): the browser shows
// a t.me link, the owner taps Start in the bot chat, and the server sees that message through getUpdates.
//   GET  /api/auth/telegram/status                 → { enabled }            (enabled = bot token saved and a personal chat chosen)
//   POST /api/auth/telegram/start  { device? }     → { id, url, expires }
//   POST /api/auth/telegram/poll   { id, device? } → { pending: true } | { ok, token?, user }   (cookie or device token, like /login)
// Only the Telegram account whose id equals the chat chosen for notifications may sign in. The poll id stays in the browser that
// started the sign-in; the link carries a different one-time code, so a link seen by someone else is not enough.
import { randomBytes } from 'node:crypto';
import { HttpError, bad, route, type Ctx } from './core/http.ts';
import { clientIp, createDevice, createSession, loginBlocked, loginFailed, loginOk, sessionCookie } from './core/auth.ts';
import { PRIVATE_USER } from './core/userdb.ts';
import { secretHas } from './core/secrets.ts';
import { tgCall, tgChatId } from './notify/index.ts';

interface Pending { code: string; at: number; ip: string }
const TTL = 5 * 60_000, pending = new Map<string, Pending>();
let botName: { name: string; at: number } | null = null, lastFetch = 0, cache: Update[] = [];
interface Update { message?: { text?: string; chat?: { type?: string }; from?: { id?: number } } }

const owner = () => { const id = tgChatId(); return /^\d{1,20}$/.test(id) ? id : null };   // a personal chat's id is the user's id; groups are negative
const enabled = () => secretHas('telegram.token') && !!owner();
const body = (c: Ctx) => ((c.body && typeof c.body === 'object' && !Array.isArray(c.body)) ? c.body : {}) as Record<string, unknown>;
const sweep = () => { const now = Date.now(); for (const [k, p] of pending) if (now - p.at > TTL) pending.delete(k) };

/** The `device` label rule of /api/auth/login: with it the answer carries a token and no cookie. */
function label(c: Ctx): string | null {
  const d = body(c).device;
  if (d === undefined || d === null) { if (c.crossSite) throw new HttpError(403, 'Cross-site request blocked'); return null }
  const l = typeof d === 'string' ? d.replace(/\p{Cc}/gu, '').trim().slice(0, 60) : '';
  if (!l) throw bad('device must be a non-empty label');
  return l;
}

async function username(): Promise<string> {
  if (botName && Date.now() - botName.at < 3600_000) return botName.name;
  const me = await tgCall('getMe', {}) as { username?: string };
  if (!me.username) throw bad('The bot has no username');
  botName = { name: me.username, at: Date.now() };
  return me.username;
}

/** Recent messages to the bot. Read without confirming them, so the notification chat picker (also getUpdates) still sees them. */
async function updates(): Promise<Update[]> {
  if (Date.now() - lastFetch < 1500) return cache;   // many tabs polling must not become many Telegram calls
  lastFetch = Date.now();
  cache = await tgCall('getUpdates', { limit: 100, allowed_updates: ['message'] }) as Update[];
  return cache;
}

route('GET', '/api/auth/telegram/status', () => ({ enabled: enabled() }), { public: true });

route('POST', '/api/auth/telegram/start', async c => {
  if (!enabled()) throw new HttpError(404, 'Telegram sign-in is not set up');
  label(c);
  const ip = clientIp(c.req), wait = loginBlocked(ip);
  if (wait) throw new HttpError(429, `Too many attempts: try again in ${wait} s`);
  sweep();
  if (pending.size >= 20) throw new HttpError(429, 'Too many sign-ins in progress');
  const id = randomBytes(24).toString('base64url'), code = randomBytes(12).toString('base64url');
  pending.set(id, { code, at: Date.now(), ip });
  return { id, url: `https://t.me/${await username()}?start=${code}`, expires: TTL / 1000 };
}, { public: true, limit: 2048 });

route('POST', '/api/auth/telegram/poll', async c => {
  const id = String(body(c).id ?? ''), lab = label(c), p = pending.get(id), ip = clientIp(c.req);
  if (!p || Date.now() - p.at > TTL) { pending.delete(id); throw new HttpError(410, 'This sign-in expired: start again') }
  const hit = (await updates()).find(u => u.message?.chat?.type === 'private' && u.message.text === `/start ${p.code}`);
  const from = hit?.message?.from?.id;
  if (!from) return { pending: true };
  pending.delete(id);   // one use, whatever the outcome
  if (String(from) !== owner()) { loginFailed(ip); throw new HttpError(403, 'This Telegram account is not allowed on this server') }
  loginOk(ip);
  void tgCall('sendMessage', { chat_id: from, text: 'Signed in to Chart Terminal. If this was not you, change the server password.' }).catch(() => {});
  if (lab) return { ok: true, token: createDevice(c.req, lab), user: { name: PRIVATE_USER.name, role: PRIVATE_USER.role } };
  c.res.setHeader('set-cookie', sessionCookie(createSession(c.req), c.secure));
  return { ok: true };
}, { public: true, limit: 2048 });
