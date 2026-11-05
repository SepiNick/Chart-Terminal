// Sessions: opaque tokens in an HttpOnly cookie, SHA-256-hashed at rest. Every /api route and the WebSocket require one
// except the auth routes. Private mode: one password (scrypt) set on first run, user 1, per-IP failure throttle.
// Public mode: accounts in users.db (core/users.ts, imported only there); `__Host-` + Secure cookie behind HTTPS.
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { HttpError } from './errors.ts';
import { configGet, configSet, db, migration } from './db.ts';
import { clientIp, isPublic } from './mode.ts';
import { PRIVATE_USER, type User } from './userdb.ts';

export { clientIp };
const U = isPublic ? await import('./users.ts') : null;
if (!isPublic) migration('auth/1', `CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, created INTEGER NOT NULL, last_seen INTEGER NOT NULL, agent TEXT, ip TEXT)`);

if (!isPublic) migration('auth/2', `ALTER TABLE sessions ADD COLUMN device TEXT`);   // non-NULL = Bearer device token (label)

const COOKIE = 'ct_session';
const SESSION_DAYS = isPublic ? (Number(process.env.CT_SESSION_DAYS) > 0 ? Number(process.env.CT_SESSION_DAYS) : 30) : 60;
const hash = (t: string) => createHash('sha256').update(t).digest('hex');
/** Public + HTTPS: `__Host-` (Secure, Path=/, no Domain) so a sibling subdomain cannot plant a cookie. Everything else keeps the old name. */
export const cookieName = (secure: boolean) => (isPublic && secure ? '__Host-' + COOKIE : COOKIE);

export const hasPassword = () => !!configGet<string | null>('auth.password', null);
export function setPassword(pw: string) {
  if (pw.length < 8) throw Error('Password must be at least 8 characters');
  const salt = randomBytes(16);
  configSet('auth.password', `${salt.toString('base64')}:${scryptSync(pw, salt, 64).toString('base64')}`);
  db.prepare('DELETE FROM sessions').run();   // a new password signs every device out
}
export function checkPassword(pw: string): boolean {
  const s = configGet<string | null>('auth.password', null); if (!s) return false;
  const [salt, h] = s.split(':').map(x => Buffer.from(x, 'base64'));
  const got = scryptSync(pw, salt, 64);
  return got.length === h.length && timingSafeEqual(got, h);
}

// ---------- private-mode throttling: 5 failures per IP, then exponential lock (1 min, 2, 4 … up to 1 h) ----------
const fails = new Map<string, { n: number; until: number }>();
export function loginBlocked(ip: string) { const f = fails.get(ip); return f && f.until > Date.now() ? Math.ceil((f.until - Date.now()) / 1000) : 0 }
export function loginFailed(ip: string) { const f = fails.get(ip) ?? { n: 0, until: 0 }; f.n++; if (f.n >= 5) f.until = Date.now() + Math.min(3600_000, 60_000 * 2 ** (f.n - 5)); fails.set(ip, f) }
export function loginOk(ip: string) { fails.delete(ip) }

/** New session for `user` (private mode: the one user). Always a fresh random token: a token sent by the client is never adopted. */
export function createSession(req: IncomingMessage, user: User = PRIVATE_USER): string {
  if (U) return U.createSession(user.id, req);
  const token = randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions (token_hash, created, last_seen, agent, ip) VALUES (?, ?, ?, ?, ?)').run(hash(token), Date.now(), Date.now(), String(req.headers['user-agent'] ?? '').slice(0, 200), clientIp(req));
  return token;
}
/** Bearer device token for `user` (labelled, at most MAX_DEVICES per user). Same random 256-bit token and hash-at-rest as a session. */
const MAX_DEVICES = 10;
export function createDevice(req: IncomingMessage, label: string, user: User = PRIVATE_USER): string {
  if (!U) db.prepare('DELETE FROM sessions WHERE device IS NOT NULL AND last_seen < ?').run(Date.now() - SESSION_DAYS * 86400_000);   // dead tokens must not hold the quota
  const n = U ? U.countDevices(user.id) : (db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE device IS NOT NULL').get() as { n: number }).n;
  if (n >= MAX_DEVICES) throw new HttpError(409, `Device limit reached (${MAX_DEVICES}). Remove one first`, { code: 'device_limit' });
  if (U) return U.createSession(user.id, req, label);
  const token = randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions (token_hash, created, last_seen, agent, ip, device) VALUES (?, ?, ?, ?, ?, ?)').run(hash(token), Date.now(), Date.now(), String(req.headers['user-agent'] ?? '').slice(0, 200), clientIp(req), label);
  return token;
}
export function endSession(token: string) { if (U) U.endSession(token); else db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash(token)) }
function cookieToken(req: IncomingMessage, secure = false): string | null {
  const m = String(req.headers.cookie ?? '').match(new RegExp(`(?:^|;\\s*)${cookieName(secure)}=([^;]+)`));
  if (!m) return null;
  try { return decodeURIComponent(m[1]) } catch { return null }
}
/** The user behind a session token, or null (expired, unknown, account disabled). Refreshes last_seen at most once a minute. */
export function userOfToken(t: string, kind?: 'cookie' | 'device'): User | null {
  if (U) return U.sessionUser(t, kind);
  const r = db.prepare('SELECT last_seen, device FROM sessions WHERE token_hash = ?').get(hash(t)) as { last_seen: number; device: string | null } | undefined;
  if (!r || (kind && (kind === 'device') !== (r.device !== null)) || Date.now() - r.last_seen > SESSION_DAYS * 86400_000) return null;
  if (Date.now() - r.last_seen > 60_000) db.prepare('UPDATE sessions SET last_seen = ? WHERE token_hash = ?').run(Date.now(), hash(t));
  return PRIVATE_USER;
}
/** `Authorization: Bearer <token>` (a device token). Never read from a URL. */
function bearerToken(req: IncomingMessage): string | null {
  const m = /^Bearer ([\w-]{20,128})$/i.exec(String(req.headers.authorization ?? ''));
  return m ? m[1] : null;
}
/** Device token offered as the WebSocket subprotocol `ct.<token>`. */
export function protocolToken(req: IncomingMessage): string | null {
  for (const p of String(req.headers['sec-websocket-protocol'] ?? '').split(',')) { const m = /^ct\.([\w-]{20,128})$/.exec(p.trim()); if (m) return m[1] }
  return null;
}
/** A Bearer token, when offered, is the only credential considered (an invalid one is not rescued by a cookie); otherwise the session cookie. */
export function authenticate(req: IncomingMessage, secure: boolean, wsToken?: string | null): { token: string; user: User; bearer: boolean } | null {
  const bearer = wsToken ?? bearerToken(req);
  if (bearer) { const user = userOfToken(bearer, 'device'); return user ? { token: bearer, user, bearer: true } : null }
  const token = cookieToken(req, secure); if (!token) return null;
  const user = userOfToken(token, 'cookie');
  return user ? { token, user, bearer: false } : null;
}
export const sessionCookie = (token: string, secure: boolean) => `${cookieName(secure)}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}${secure ? '; Secure' : ''}`;
export const clearCookie = (secure: boolean) => `${cookieName(secure)}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`;
/** Public id of a session: a prefix of its token's hash (never the token). `current` marks the caller's own. */
export const sessionId = (token: string) => hash(token).slice(0, 16);
export const listSessions = (mine: string | null, user: User = PRIVATE_USER) =>
  ((U ? U.listSessions(user.id) : db.prepare('SELECT substr(token_hash, 1, 16) AS id, created, last_seen, agent, ip FROM sessions WHERE device IS NULL ORDER BY last_seen DESC').all()) as { id: string }[])
    .map(s => ({ ...s, current: !!mine && s.id === sessionId(mine) }));
/** Sign one of the user's sessions out; false when they have no such session (another user's id looks exactly the same). */
export function endSessionById(id: string, user: User = PRIVATE_USER): boolean {
  if (U) return U.endSessionById(user.id, id);
  if (!/^[0-9a-f]{16}$/.test(id)) return false;
  return db.prepare("DELETE FROM sessions WHERE device IS NULL AND substr(token_hash, 1, 16) = ?").run(id).changes > 0;
}
/** The caller's device tokens (never the tokens themselves). `mine` = the token this request used. */
export const listDevices = (mine: string | null, user: User = PRIVATE_USER) =>
  ((U ? U.listDevices(user.id) : db.prepare('SELECT substr(token_hash, 1, 16) AS id, device AS label, created, last_seen AS lastUsed, ip FROM sessions WHERE device IS NOT NULL ORDER BY last_seen DESC').all()) as { id: string }[])
    .map(d => ({ ...d, current: !!mine && d.id === sessionId(mine) }));
export function endDeviceById(id: string, user: User = PRIVATE_USER): boolean {
  if (U) return U.endDeviceById(user.id, id);
  if (!/^[0-9a-f]{16}$/.test(id)) return false;
  return db.prepare("DELETE FROM sessions WHERE device IS NOT NULL AND substr(token_hash, 1, 16) = ?").run(id).changes > 0;
}
