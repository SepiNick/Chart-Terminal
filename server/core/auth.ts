// Single-user login: password (scrypt) set on first run, opaque session tokens in an HttpOnly cookie,
// failed-login throttling per IP. Every /api route and the WebSocket require a session except the auth routes.
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { configGet, configSet, db, migration } from './db.ts';

migration('auth/1', `CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, created INTEGER NOT NULL, last_seen INTEGER NOT NULL, agent TEXT, ip TEXT)`);

export const COOKIE = 'ct_session';
const SESSION_DAYS = 60;
const hash = (t: string) => createHash('sha256').update(t).digest('hex');

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

// ---------- throttling: 5 failures per IP, then exponential lock (1 min, 2, 4 … up to 1 h) ----------
const fails = new Map<string, { n: number; until: number }>();
export function loginBlocked(ip: string) { const f = fails.get(ip); return f && f.until > Date.now() ? Math.ceil((f.until - Date.now()) / 1000) : 0 }
export function loginFailed(ip: string) { const f = fails.get(ip) ?? { n: 0, until: 0 }; f.n++; if (f.n >= 5) f.until = Date.now() + Math.min(3600_000, 60_000 * 2 ** (f.n - 5)); fails.set(ip, f) }
export function loginOk(ip: string) { fails.delete(ip) }

export function createSession(req: IncomingMessage): string {
  const token = randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions (token_hash, created, last_seen, agent, ip) VALUES (?, ?, ?, ?, ?)').run(hash(token), Date.now(), Date.now(), String(req.headers['user-agent'] ?? '').slice(0, 200), clientIp(req));
  return token;
}
export function endSession(token: string) { db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash(token)) }
export function cookieToken(req: IncomingMessage): string | null {
  const m = String(req.headers.cookie ?? '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}
/** Valid session for this request (refreshes last_seen at most once a minute). */
export function sessionOf(req: IncomingMessage): string | null {
  const t = cookieToken(req); if (!t) return null;
  const r = db.prepare('SELECT last_seen FROM sessions WHERE token_hash = ?').get(hash(t)) as { last_seen: number } | undefined;
  if (!r || Date.now() - r.last_seen > SESSION_DAYS * 86400_000) return null;
  if (Date.now() - r.last_seen > 60_000) db.prepare('UPDATE sessions SET last_seen = ? WHERE token_hash = ?').run(Date.now(), hash(t));
  return t;
}
export const sessionCookie = (token: string, secure: boolean) => `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}${secure ? '; Secure' : ''}`;
export const clearCookie = (secure: boolean) => `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`;
export const clientIp = (req: IncomingMessage) => req.socket.remoteAddress ?? '';
export const listSessions = () => db.prepare('SELECT created, last_seen, agent, ip FROM sessions ORDER BY last_seen DESC').all();
