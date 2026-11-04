// [agent: notify] Notification dispatcher (docs/phase5-contracts.md §4): popup (WebSocket), Web Push, Telegram,
// Email (SMTP) and webhooks. Secrets live in core/secrets.ts and never leave the server; network senders sit in
// `senders` so tests can replace them.
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import type webpush from 'web-push';
import type nodemailerNs from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';
import { HttpError, broadcastTo, route, bad } from '../core/http.ts';
import { soleUser, userDb, userMigration } from '../core/userdb.ts';
import { isPublic, publicUrl } from '../core/mode.ts';
import { limits, tooMany } from '../core/quota.ts';

// Private server: telegram / email / webhook with their secrets and the single settings table. A public server never
// loads the secret store (no key file, no SMTP or bot credentials of users) and has push + the in-app popup only.
const P = isPublic ? null : { ...(await import('../core/db.ts')), ...(await import('../core/secrets.ts')) };
const configGet = <T>(k: string, f: T) => P!.configGet<T>(k, f), configSet = (k: string, v: unknown) => P!.configSet(k, v);
const secretGet = (n: string) => (P ? P.secretGet(n) : null), secretSet = (n: string, v: string) => P!.secretSet(n, v), secretHas = (n: string) => !!P && P.secretHas(n), secretDel = (n: string) => P!.secretDel(n);

import type { Channel } from '../../src/alerttypes.ts';
export type { Channel };
export interface Notice {
  userId?: number;                               // whose notice it is (default: the single user of a private server)
  title: string;
  body: string;
  channels: Channel[];
  sound?: boolean;                               // popup: play the alert sound
  webhook?: { url: string; body?: string };      // per-alert webhook target and body (already rendered)
  data?: Record<string, unknown>;                // e.g. { alertId, sym, tf, price, url } — passed to popup/push
}
export interface Delivery { channel: Channel; ok: boolean; error?: string }

const CHANNELS: Channel[] = ['popup', 'push', 'telegram', 'email', 'webhook'];
const TIMEOUT = 10_000;
// web-push and nodemailer cost ~12 MB and ~150 ms to load; only the first push or mail needs them.
const req = createRequire(import.meta.url);
let wp: typeof webpush | undefined, nm: typeof nodemailerNs | undefined;
const webpushLib = () => wp ??= req('web-push') as typeof webpush;
const nodemailer = () => nm ??= req('nodemailer') as typeof nodemailerNs;

userMigration('notify/1', `
  CREATE TABLE notify_push_subs (endpoint TEXT PRIMARY KEY, p256dh TEXT NOT NULL, auth TEXT NOT NULL, agent TEXT NOT NULL, created INTEGER NOT NULL, last_ok INTEGER);
  CREATE TABLE notify_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, deliveries TEXT NOT NULL);`);

/** Network edges; tests swap these out. */
export const senders = {
  fetch: (url: string, init: RequestInit): Promise<Response> => fetch(url, init),
  push: (sub: webpush.PushSubscription, payload: string, opts: webpush.RequestOptions): Promise<unknown> => webpushLib().sendNotification(sub, payload, opts),
  mail: async (opts: SMTPTransport.Options, msg: { from: string; to: string; subject: string; text: string }) => { await nodemailer().createTransport(opts).sendMail(msg) },
};

/** Replace `{{name}}` (also `{{plot_0}}`, `{{plot("RSI")}}` …) with vars[name]; unknown placeholders stay as they are. */
export function render(template: string, vars: Record<string, unknown>): string {
  return template.replace(/\{\{([^{}]+?)\}\}/g, (m, k: string) => {
    const v = vars[k.trim()];
    return Object.hasOwn(vars, k.trim()) && v != null ? String(v) : m;
  });
}

// ---------- per-key queue with a minimum gap between sends ----------
const lanes = new Map<string, { tail: Promise<unknown>; last: number; pending: number }>();
const MAX_PENDING = 30;   // beyond this a burst is dropped rather than queued for minutes
/** Run `fn` after every earlier job on `key`, at least `gapMs` after the previous one started. */
export function limited<T>(key: string, gapMs: number, fn: () => Promise<T>): Promise<T> {
  let l = lanes.get(key);
  if (!l) lanes.set(key, l = { tail: Promise.resolve(), last: 0, pending: 0 });
  const lane = l;
  if (lane.pending >= MAX_PENDING) return Promise.reject(Error('rate limited: too many queued messages'));
  lane.pending++;
  const run = lane.tail.then(async () => {
    const wait = lane.last + gapMs - Date.now();
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    lane.last = Date.now();
    return fn();
  }).finally(() => lane.pending--);
  lane.tail = run.catch(() => {});
  return run;
}

// ---------- settings ----------
interface TelegramCfg { chatId: string }
interface EmailCfg { host: string; port: number; secure: boolean; user: string; from: string; to: string }
interface WebhookCfg { url: string }
const tgCfg = () => configGet<TelegramCfg>('notify.telegram', { chatId: '' });
const emailCfg = () => configGet<EmailCfg>('notify.email', { host: '', port: 587, secure: false, user: '', from: '', to: '' });
const hookCfg = () => configGet<WebhookCfg>('notify.webhook', { url: '' });

const EMPTY = { telegram: { chatId: '', hasToken: false }, email: { host: '', port: 587, secure: false, user: '', from: '', to: '', hasPassword: false }, webhook: { url: '' } };
/** Public mode: only push (and the popup) exist; the other channels report empty and `disabled`. */
export function settingsGet(uid = soleUser()) {
  const subs = userDb(uid).prepare('SELECT endpoint, agent, created, last_ok FROM notify_push_subs ORDER BY created').all() as { endpoint: string; agent: string; created: number; last_ok: number | null }[];
  if (!P) return { ...EMPTY, disabled: ['telegram', 'email', 'webhook'], push: { subscriptions: subs.map(s => ({ endpoint: s.endpoint, agent: s.agent, created: s.created, lastOk: s.last_ok })) } };
  return {
    telegram: { chatId: tgCfg().chatId, hasToken: secretHas('telegram.token') },
    email: { ...emailCfg(), hasPassword: secretHas('email.password') },
    webhook: { url: hookCfg().url },
    push: { subscriptions: subs.map(s => ({ endpoint: s.endpoint, agent: s.agent, created: s.created, lastOk: s.last_ok })) },
  };
}

const obj = (v: unknown, what: string): Record<string, unknown> => {
  if (v == null || typeof v !== 'object' || Array.isArray(v)) throw bad(`${what} must be an object`);
  return v as Record<string, unknown>;
};
const str = (v: unknown, what: string, max: number, re?: RegExp): string => {
  if (typeof v !== 'string' || v.length > max || /[\r\n\0]/.test(v)) throw bad(`Invalid ${what}`);
  const s = v.trim();
  if (s && re && !re.test(s)) throw bad(`Invalid ${what}`);
  return s;
};
/** Secret fields: string = set, null (or '') = delete, absent = keep. Validates now, writes later. */
function secretField(name: string, v: unknown, ok: (s: string) => boolean, label: string): () => void {
  if (v === undefined) return () => {};
  if (v === null || v === '') return () => secretDel(name);
  if (typeof v !== 'string' || !ok(v)) throw bad(`Invalid ${label}`);
  return () => secretSet(name, v);
}
export function httpUrl(s: string) {
  let u: URL;
  try { u = new URL(s) } catch { return false }
  return u.protocol === 'http:' || u.protocol === 'https:';
}

/** Partial update; validates everything before writing anything. */
export function settingsPut(body: unknown, uid = soleUser()) {
  const b = obj(body, 'body');
  if (isPublic && (b.telegram !== undefined || b.email !== undefined || b.webhook !== undefined)) throw bad('Telegram, email and webhook notifications are not available on this server');
  const writes: (() => void)[] = [];
  if (b.telegram !== undefined) {
    const t = obj(b.telegram, 'telegram');
    if (t.chatId !== undefined) {
      const chatId = t.chatId === null ? '' : str(typeof t.chatId === 'number' ? String(t.chatId) : t.chatId, 'chat id', 80, /^(-?\d{1,20}|@\w{4,64})$/);
      writes.push(() => configSet('notify.telegram', { ...tgCfg(), chatId }));
    }
    writes.push(secretField('telegram.token', typeof t.token === 'string' ? t.token.trim() : t.token, s => /^\d{3,20}:[\w-]{20,100}$/.test(s), 'bot token'));
  }
  if (b.email !== undefined) {
    const e = obj(b.email, 'email'), cur = emailCfg(), next = { ...cur };
    if (e.host !== undefined) next.host = str(e.host, 'SMTP host', 253, /^[\w.-]+$/);
    if (e.port !== undefined) { if (!Number.isInteger(e.port) || (e.port as number) < 1 || (e.port as number) > 65535) throw bad('Invalid SMTP port'); next.port = e.port as number }
    if (e.secure !== undefined) { if (typeof e.secure !== 'boolean') throw bad('Invalid secure flag'); next.secure = e.secure }
    if (e.user !== undefined) next.user = str(e.user, 'SMTP user', 254);
    if (e.from !== undefined) next.from = str(e.from, 'from address', 320);
    if (e.to !== undefined) next.to = str(e.to, 'to address', 1000);
    writes.push(secretField('email.password', e.password, s => s.length <= 500, 'password'));
    writes.push(() => configSet('notify.email', next));
  }
  if (b.webhook !== undefined) {
    const w = obj(b.webhook, 'webhook');
    if (w.url !== undefined) {
      const url = w.url === null ? '' : str(w.url, 'webhook URL', 2000);
      if (url && !httpUrl(url)) throw bad('Webhook URL must be http(s)');
      writes.push(() => configSet('notify.webhook', { url }));
    }
  }
  writes.forEach(f => f());
  return settingsGet(uid);
}

/** Errors may echo URLs or server replies; make sure no secret rides along into the log or the client. */
function scrub(msg: string) {
  for (const s of [secretGet('telegram.token'), secretGet('email.password')]) if (s && s.length >= 4) msg = msg.split(s).join('***');
  return msg.slice(0, 300);
}
const errText = (e: unknown) => scrub(e instanceof Error ? (e.name === 'TimeoutError' ? 'timed out' : e.message) : String(e));

// ---------- push ----------
export function vapid() {
  if (isPublic) {   // from the environment only, never generated: a new key would orphan every subscription
    const publicKey = process.env.CT_VAPID_PUBLIC, privateKey = process.env.CT_VAPID_PRIVATE;
    if (!publicKey || !privateKey) throw new HttpError(503, 'Push notifications are not configured on this server');
    return { publicKey, privateKey };
  }
  let pub = configGet<string>('notify.vapid.public', ''), priv = secretGet('push.vapid.private');
  if (!pub || !priv) {
    const k = webpushLib().generateVAPIDKeys();
    pub = k.publicKey; priv = k.privateKey;
    secretSet('push.vapid.private', priv); configSet('notify.vapid.public', pub);
    userDb(1).exec('DELETE FROM notify_push_subs');   // subscriptions are bound to the old key
  }
  return { publicKey: pub, privateKey: priv };
}
function vapidSubject() {
  if (isPublic) { const u = publicUrl(); return process.env.CT_VAPID_SUBJECT || (u?.protocol === 'https:' ? u.origin : 'mailto:chart-terminal@example.com') }
  const m = emailCfg().from.match(/[^\s<>"]+@[^\s<>"]+/) ?? emailCfg().to.match(/[^\s<>",]+@[^\s<>",]+/);
  return 'mailto:' + (m?.[0] ?? 'chart-terminal@example.com');   // Apple rejects malformed subjects
}

/** Push services a public server will talk to (the endpoint is chosen by the client, so it must not be an arbitrary URL). */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)notify\.windows\.com$/, /(^|\.)push\.services\.mozilla\.com$/];
const pushHostOk = (endpoint: string) => { try { const u = new URL(endpoint); return u.protocol === 'https:' && !u.port && !u.username && PUSH_HOSTS.some(r => r.test(u.hostname)) } catch { return false } };

export async function sendPush(n: Notice): Promise<void> {
  const uid = n.userId ?? soleUser(), d = () => userDb(uid);
  const subs = d().prepare('SELECT endpoint, p256dh, auth FROM notify_push_subs').all() as { endpoint: string; p256dh: string; auth: string }[];
  if (!subs.length) throw Error('no device subscribed to push');
  const { publicKey, privateKey } = vapid();
  const data: Record<string, unknown> = { url: '/', ...(n.data ?? {}) };
  const payload = JSON.stringify({ title: n.title.slice(0, 200), body: n.body.slice(0, 1500), tag: data.alertId ? `alert-${data.alertId}` : `ct-${Date.now()}`, data });
  const opts: webpush.RequestOptions = { vapidDetails: { subject: vapidSubject(), publicKey, privateKey }, TTL: 3600, urgency: 'high', timeout: TIMEOUT };
  const errs: string[] = [];
  await Promise.all(subs.map(async s => {
    try {
      await senders.push({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, opts);
      d().prepare('UPDATE notify_push_subs SET last_ok = ? WHERE endpoint = ?').run(Date.now(), s.endpoint);
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) { d().prepare('DELETE FROM notify_push_subs WHERE endpoint = ?').run(s.endpoint); errs.push('subscription expired (removed)') }
      else errs.push(code ? `push service HTTP ${code}` : errText(e));
    }
  }));
  if (errs.length === subs.length) throw Error(errs[0]);
}

route('GET', '/api/notify/push/key', () => ({ publicKey: vapid().publicKey }));
route('POST', '/api/notify/push/subscribe', c => {
  const b = obj(c.body, 'body'), s = obj(b.subscription, 'subscription'), keys = obj(s.keys, 'subscription.keys');
  const endpoint = str(s.endpoint, 'endpoint', 2000);
  if (!endpoint.startsWith('https://') || !httpUrl(endpoint) || (isPublic && !pushHostOk(endpoint))) throw bad('Invalid endpoint');
  const p256dh = str(keys.p256dh, 'p256dh', 200, /^[\w-]+=*$/), auth = str(keys.auth, 'auth', 100, /^[\w-]+=*$/);
  if (!p256dh || !auth) throw bad('Missing subscription keys');
  const agent = b.agent == null ? '' : str(String(b.agent).replace(/[\r\n\0]/g, ' ').slice(0, 300), 'agent', 300);
  vapid();
  const uid = c.user.id, mine = c.db;
  if (isPublic) {
    const max = limits(uid).pushSubs, has = mine.prepare('SELECT 1 FROM notify_push_subs WHERE endpoint = ?').get(endpoint), n = (mine.prepare('SELECT COUNT(*) AS n FROM notify_push_subs').get() as { n: number }).n;
    if (!has && n >= max) throw tooMany('push devices', max);
  }
  mine.prepare(`INSERT INTO notify_push_subs (endpoint, p256dh, auth, agent, created) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, agent = excluded.agent`).run(endpoint, p256dh, auth, agent, Date.now());
  return { ok: true };
});
route('POST', '/api/notify/push/unsubscribe', c => {
  const endpoint = str(obj(c.body, 'body').endpoint, 'endpoint', 2000);
  c.db.prepare('DELETE FROM notify_push_subs WHERE endpoint = ?').run(endpoint);
  return { ok: true };
});

// ---------- telegram ----------
async function tgCall(method: string, params: Record<string, unknown>): Promise<unknown> {
  const token = secretGet('telegram.token');
  if (!token) throw Error('Telegram bot token not set');
  const r = await senders.fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params), signal: AbortSignal.timeout(TIMEOUT) });
  const j = await r.json().catch(() => ({})) as { ok?: boolean; result?: unknown; description?: string; parameters?: { retry_after?: number } };
  if (!j.ok) { const e = Error(`Telegram: ${j.description ?? 'HTTP ' + r.status}`) as Error & { retryAfter?: number }; e.retryAfter = j.parameters?.retry_after; throw e }
  return j.result;
}
export async function sendTelegram(n: Notice): Promise<void> {
  const { chatId } = tgCfg();
  if (!chatId) throw Error('Telegram chat not chosen');
  // No parse_mode: the text goes out verbatim, so nothing in an alert message can break formatting.
  const text = `${n.title}\n${n.body}`.slice(0, 4096);
  await limited(`telegram:${chatId}`, 1100, async () => {
    try { await tgCall('sendMessage', { chat_id: chatId, text, disable_web_page_preview: true }) }
    catch (e) {
      const ra = (e as { retryAfter?: number }).retryAfter;
      if (!ra || ra > 30) throw e;
      await new Promise(r => setTimeout(r, ra * 1000));
      await tgCall('sendMessage', { chat_id: chatId, text, disable_web_page_preview: true });
    }
  });
}
interface TgChat { id: number; type: string; title?: string; username?: string; first_name?: string; last_name?: string }
/** Chats that recently messaged the bot (or added it), newest first. */
if (!isPublic) route('GET', '/api/notify/telegram/chats', async () => {
  try {
    const ups = await tgCall('getUpdates', { limit: 100, allowed_updates: ['message', 'channel_post', 'my_chat_member'] }) as Record<string, { chat?: TgChat }>[];
    const seen = new Map<number, { id: string; name: string; type: string }>();
    for (const u of ups.reverse()) {
      const chat = (u.message ?? u.channel_post ?? u.my_chat_member)?.chat;
      if (chat && !seen.has(chat.id)) seen.set(chat.id, { id: String(chat.id), type: chat.type, name: chat.title ?? ([chat.first_name, chat.last_name].filter(Boolean).join(' ') || (chat.username ? '@' + chat.username : String(chat.id))) });
    }
    return [...seen.values()];
  } catch (e) { throw bad(errText(e)) }
});

// ---------- email ----------
export async function sendEmail(n: Notice): Promise<void> {
  const c = emailCfg();
  if (!c.host || !c.to) throw Error('Email not configured (SMTP host and recipient)');
  const pass = secretGet('email.password');
  const opts: SMTPTransport.Options = {
    host: c.host, port: c.port, secure: c.secure, auth: c.user ? { user: c.user, pass: pass ?? '' } : undefined,
    connectionTimeout: TIMEOUT, greetingTimeout: TIMEOUT, socketTimeout: 15_000,
  };
  await limited('email', 1000, () => senders.mail(opts, { from: c.from || c.user, to: c.to, subject: n.title.replace(/[\r\n]+/g, ' ').slice(0, 200), text: n.body }));
}

// ---------- webhook ----------
/** TradingView-style: JSON content type when the body parses as JSON, plain text otherwise. */
export function webhookContentType(body: string) {
  try { JSON.parse(body); return 'application/json' } catch { return 'text/plain; charset=utf-8' }
}
export async function sendWebhook(n: Notice): Promise<void> {
  const url = n.webhook?.url || hookCfg().url;
  if (!url) throw Error('No webhook URL');
  if (!httpUrl(url)) throw Error('Webhook URL must be http(s)');
  const body = n.webhook?.body ?? n.body;
  await limited(`webhook:${new URL(url).host}`, 250, async () => {
    const r = await senders.fetch(url, { method: 'POST', headers: { 'content-type': webhookContentType(body), 'user-agent': 'ChartTerminal' }, body, signal: AbortSignal.timeout(TIMEOUT) });
    await r.body?.cancel().catch(() => {});
    if (!r.ok) throw Error(`webhook HTTP ${r.status}`);   // never echo the URL: it often carries a token
  });
}

// ---------- dispatch ----------
const SENDERS: Record<Exclude<Channel, 'popup'>, (n: Notice) => Promise<void>> = { push: sendPush, telegram: sendTelegram, email: sendEmail, webhook: sendWebhook };

// Public mode: 20 notices a minute and 200 a day per user, so one account cannot turn the server into a push cannon.
const sent = new Map<number, { min: number; nMin: number; day: number; nDay: number }>();
function withinQuota(uid: number): boolean {
  const L = limits(uid);
  if (!Number.isFinite(L.notifyPerMin) && !Number.isFinite(L.notifyPerDay)) return true;
  const now = Date.now();
  let w = sent.get(uid);
  if (!w) sent.set(uid, (w = { min: now, nMin: 0, day: now, nDay: 0 }));
  if (now - w.min >= 60_000) { w.min = now; w.nMin = 0 }
  if (now - w.day >= 86400_000) { w.day = now; w.nDay = 0 }
  if (w.nMin >= L.notifyPerMin || w.nDay >= L.notifyPerDay) return false;
  w.nMin++; w.nDay++;
  return true;
}
const ONLY_PUBLIC: Channel[] = ['popup', 'push'];

/** Deliver a notice on every requested channel. Never throws; returns one result per channel. */
export async function notify(n: Notice): Promise<Delivery[]> {
  try {
    const uid = n.userId ?? soleUser(), at = Date.now(), title = String(n.title ?? ''), body = String(n.body ?? '');
    if (!withinQuota(uid)) return [...new Set(n.channels ?? [])].map(channel => ({ channel, ok: false, error: 'notification limit reached (try again later)' }));
    const notice = { ...n, title, body };
    const chans = [...new Set(n.channels ?? [])];
    // Popup first and synchronously, so slow channels never delay it.
    const results = chans.map(async (ch): Promise<Delivery> => {
      try {
        if (isPublic && !ONLY_PUBLIC.includes(ch)) return { channel: ch, ok: false, error: 'not available on this server' };
        if (ch === 'popup') { broadcastTo(uid, { type: 'notify', id: randomUUID(), title, body, sound: n.sound ?? true, data: n.data ?? {}, at }); return { channel: ch, ok: true } }
        const send = SENDERS[ch as Exclude<Channel, 'popup'>];
        if (!send) return { channel: ch, ok: false, error: 'unknown channel' };
        await send(notice);
        return { channel: ch, ok: true };
      } catch (e) { return { channel: ch, ok: false, error: errText(e) } }
    });
    const out = await Promise.all(results);
    try {
      const d = userDb(uid);
      d.prepare('INSERT INTO notify_log (at, title, body, deliveries) VALUES (?, ?, ?, ?)').run(at, title.slice(0, 500), body.slice(0, 4000), JSON.stringify(out));
      d.prepare('DELETE FROM notify_log WHERE id <= (SELECT MAX(id) FROM notify_log) - 2000').run();
    } catch (e) { console.error('notify log:', (e as Error).message) }
    return out;
  } catch (e) {
    return (Array.isArray(n?.channels) ? n.channels : []).map(channel => ({ channel, ok: false, error: errText(e) }));
  }
}

route('GET', '/api/notify/settings', c => settingsGet(c.user.id));
route('PUT', '/api/notify/settings', c => settingsPut(c.body, c.user.id));
route('POST', '/api/notify/test', async c => {
  const ch = obj(c.body, 'body').channel as Channel;
  if (!CHANNELS.includes(ch)) throw bad('Unknown channel');
  const [d] = await notify({ title: 'Chart Terminal test', body: `Test notification sent at ${new Date().toISOString().slice(0, 19).replace('T', ' ')} UTC`, channels: [ch], data: { url: '/', test: true }, userId: c.user.id });
  return d;
});
route('GET', '/api/notify/log', c => {
  const limit = Math.min(1000, Math.max(1, Number(c.url.searchParams.get('limit')) || 100));
  const rows = c.db.prepare('SELECT id, at, title, body, deliveries FROM notify_log ORDER BY id DESC LIMIT ?').all(limit) as { id: number; at: number; title: string; body: string; deliveries: string }[];
  return rows.map(r => ({ ...r, deliveries: JSON.parse(r.deliveries) as Delivery[] }));
});
