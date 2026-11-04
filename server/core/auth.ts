// Sessions: opaque tokens in an HttpOnly cookie, SHA-256-hashed at rest. Every /api route and the WebSocket require one
// except the auth routes. Private mode: one password (scrypt) set on first run, user 1, per-IP failure throttle.
// Public mode: accounts in users.db (core/users.ts, imported only there); `__Host-` + Secure cookie behind HTTPS.
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { configGet, configSet, db, migration } from './db.ts';
import { clientIp, isPublic } from './mode.ts';
import { PRIVATE_USER, type User } from './userdb.ts';

export { clientIp };
const U = isPublic ? await import('./users.ts') : null;
if (!isPublic) migration('auth/1', `CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, created INTEGER NOT NULL, last_seen INTEGER NOT NULL, agent TEXT, ip TEXT)`);

export const COOKIE = 'ct_session';
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
export function endSession(token: string) { if (U) U.endSession(token); else db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash(token)) }
export function cookieToken(req: IncomingMessage, secure = false): string | null {
  const m = String(req.headers.cookie ?? '').match(new RegExp(`(?:^|;\\s*)${cookieName(secure)}=([^;]+)`));
  if (!m) return null;
  try { return decodeURIComponent(m[1]) } catch { return null }
}
/** The user behind a session token, or null (expired, unknown, account disabled). Refreshes last_seen at most once a minute. */
export function userOfToken(t: string): User | null {
  if (U) return U.sessionUser(t);
  const r = db.prepare('SELECT last_seen FROM sessions WHERE token_hash = ?').get(hash(t)) as { last_seen: number } | undefined;
  if (!r || Date.now() - r.last_seen > SESSION_DAYS * 86400_000) return null;
  if (Date.now() - r.last_seen > 60_000) db.prepare('UPDATE sessions SET last_seen = ? WHERE token_hash = ?').run(Date.now(), hash(t));
  return PRIVATE_USER;
}
export function authenticate(req: IncomingMessage, secure: boolean): { token: string; user: User } | null {
  const token = cookieToken(req, secure); if (!token) return null;
  const user = userOfToken(token);
  return user ? { token, user } : null;
}
/** Valid session token for this request, or null. */
export const sessionOf = (req: IncomingMessage, secure = false): string | null => authenticate(req, secure)?.token ?? null;
export const sessionCookie = (token: string, secure: boolean) => `${cookieName(secure)}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}${secure ? '; Secure' : ''}`;
export const clearCookie = (secure: boolean) => `${cookieName(secure)}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`;
/** Public id of a session: a prefix of its token's hash (never the token). `current` marks the caller's own. */
export const sessionId = (token: string) => hash(token).slice(0, 16);
export const listSessions = (mine: string | null, user: User = PRIVATE_USER) =>
  ((U ? U.listSessions(user.id) : db.prepare('SELECT substr(token_hash, 1, 16) AS id, created, last_seen, agent, ip FROM sessions ORDER BY last_seen DESC').all()) as { id: string }[])
    .map(s => ({ ...s, current: !!mine && s.id === sessionId(mine) }));
/** Sign one of the user's sessions out; false when they have no such session (another user's id looks exactly the same). */
export function endSessionById(id: string, user: User = PRIVATE_USER): boolean {
  if (U) return U.endSessionById(user.id, id);
  if (!/^[0-9a-f]{16}$/.test(id)) return false;
  return db.prepare("DELETE FROM sessions WHERE substr(token_hash, 1, 16) = ?").run(id).changes > 0;
}
