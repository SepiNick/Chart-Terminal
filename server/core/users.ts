// Accounts of the public server (users.db, public mode only; private mode never imports this file).
// Passwords: scrypt (async, 2 at a time) in a self-describing string. Sessions, invites, recovery codes, a persisted
// three-layer login throttle and an audit trail live in the same central database.
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { db, migration } from './db.ts';
import { HttpError, bad } from './errors.ts';
import { REGISTRATION, clientIp } from './mode.ts';
import { setOverrides, type Limits } from './quota.ts';
import { createUserDb, deleteUserDb, userDbBytes, type User } from './userdb.ts';

migration('users/1', `
  CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE, pw TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user',
    status TEXT NOT NULL DEFAULT 'active', must_change INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL, last_login INTEGER,
    invited_by INTEGER, quota TEXT, alerts_active INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users ON DELETE CASCADE, created INTEGER NOT NULL,
    last_seen INTEGER NOT NULL, expires INTEGER NOT NULL, agent TEXT, ip TEXT);
  CREATE INDEX sessions_user ON sessions (user_id);
  CREATE TABLE invites (code_hash TEXT PRIMARY KEY, created_by INTEGER, uses_left INTEGER NOT NULL, expires INTEGER NOT NULL, note TEXT);
  CREATE TABLE recovery_codes (user_id INTEGER NOT NULL REFERENCES users ON DELETE CASCADE, code_hash TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, code_hash));
  CREATE TABLE login_attempts (key TEXT PRIMARY KEY, n INTEGER NOT NULL, until INTEGER NOT NULL, at INTEGER NOT NULL);
  CREATE TABLE audit (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, user_id INTEGER, ip TEXT, event TEXT NOT NULL);
  CREATE TABLE push_endpoints (endpoint TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users ON DELETE CASCADE);
  CREATE TABLE share_index (id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users ON DELETE CASCADE);`);

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const SESSION_MS = (Number(process.env.CT_SESSION_DAYS) > 0 ? Number(process.env.CT_SESSION_DAYS) : 30) * 86400_000, IDLE_MS = 14 * 86400_000, MAX_SESSIONS = 20;
export const UNIFORM_LOGIN_ERROR = 'Wrong username or password';

// ---------- passwords ----------
export const stats = { hashes: 0 };   // scrypt runs, so tests can prove an unknown user costs the same work as a known one
const PARAMS = { N: 2 ** 15, r: 8, p: 1, len: 64 };
let running = 0;
const queue: (() => void)[] = [];
async function slot<T>(f: () => Promise<T>): Promise<T> {   // at most 2 scrypts at once: logins cannot starve the event loop's thread pool
  if (running >= 2) await new Promise<void>(r => queue.push(r));
  running++;
  try { return await f() } finally { running--; queue.shift()?.() }
}
const derive = (pw: string, salt: Buffer, N: number, r: number, p: number, len: number) => slot(() => new Promise<Buffer>((res, rej) => {
  stats.hashes++;
  scrypt(pw.normalize('NFKC'), salt, len, { N, r, p, maxmem: 128 * N * r * 2 + 1024 * 1024 }, (e, k) => (e ? rej(e) : res(k)));
}));
export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16), { N, r, p, len } = PARAMS;
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${(await derive(pw, salt, N, r, p, len)).toString('base64')}`;
}
export async function verifyPassword(stored: string, pw: string): Promise<boolean> {
  const [alg, N, r, p, salt, h] = stored.split('$');
  if (alg !== 'scrypt' || !h || +N > 2 ** 20) return false;
  const want = Buffer.from(h, 'base64'), got = await derive(pw, Buffer.from(salt, 'base64'), +N, +r, +p, want.length);
  return got.length === want.length && timingSafeEqual(got, want);
}
const outdated = (stored: string) => { const [, N, r, p] = stored.split('$'); return +N !== PARAMS.N || +r !== PARAMS.r || +p !== PARAMS.p };
const DUMMY = hashPassword('dummy-' + randomBytes(9).toString('hex'));   // unknown usernames verify against this, so timing does not reveal them
DUMMY.catch(() => {});

const COMMON = new Set(('password,password1,password12,password123,passw0rd,1234567890,12345678901,qwertyuiop,qwerty123,qwerty12345,1q2w3e4r5t,iloveyou123,letmein123,welcome123,' +
  'admin12345,administrator,abc1234567,abcdefghij,0123456789,1111111111,0000000000,123456789a,a123456789,changeme123,trustno1234,monkey12345,dragon12345,football123,baseball123,' +
  'superman123,princess123,sunshine123,master12345,shadow12345,111111111111,123123123123,zaq12wsxcde3,asdfghjkl1,qazwsxedc123,tradingview,chartterminal,bitcoin1234,ethereum123').split(','));
export function checkNewPassword(pw: unknown, name: string): string {
  if (typeof pw !== 'string') throw bad('Password required');
  if (pw.length < 10) throw bad('Password must be at least 10 characters');
  if (pw.length > 200) throw bad('Password must be at most 200 characters');
  const l = pw.toLowerCase();
  if (COMMON.has(l) || /^(.)\1+$/.test(pw) || l === name || (name.length >= 4 && l.includes(name))) throw bad('That password is too easy to guess');
  return pw;
}

// ---------- rows ----------
interface Row { id: number; name: string; pw: string; role: 'admin' | 'user'; status: 'active' | 'disabled'; must_change: number; created: number; last_login: number | null; quota: string | null }
const byName = (n: string) => db.prepare('SELECT * FROM users WHERE name = ?').get(n) as Row | undefined;
const byId = (id: number) => db.prepare('SELECT * FROM users WHERE id = ?').get(id) as Row | undefined;
const toUser = (r: Row): User => ({ id: r.id, name: r.name, role: r.role, ...(r.must_change ? { mustChange: true } : {}) });
export const userByName = (n: string) => { const r = byName(n.toLowerCase()); return r && toUser(r) };
export const userExists = (id: number) => !!byId(id);

let activeAt = 0, activeSet = new Set<number>();
/** Enabled accounts (30 s cache: the CLI runs in another process). */
export function isActive(id: number) {
  if (Date.now() - activeAt > 30_000) { activeSet = new Set((db.prepare("SELECT id FROM users WHERE status = 'active'").all() as { id: number }[]).map(r => r.id)); activeAt = Date.now() }
  return activeSet.has(id);
}
const qCache = new Map<number, { at: number; v: Partial<Limits> }>();
setOverrides(uid => {
  const c = qCache.get(uid);
  if (c && Date.now() - c.at < 60_000) return c.v;
  let v: Partial<Limits> = {};
  try { v = JSON.parse(byId(uid)?.quota ?? '{}') } catch {}
  qCache.set(uid, { at: Date.now(), v });
  return v;
});
export const setAlertsHint = (id: number, on: boolean) => { db.prepare('UPDATE users SET alerts_active = ? WHERE id = ? AND alerts_active != ?').run(on ? 1 : 0, id, on ? 1 : 0) };
export const usersWithAlerts = () => (db.prepare('SELECT id FROM users WHERE alerts_active = 1').all() as { id: number }[]).map(r => r.id);

export function audit(userId: number | null, ip: string, event: string) {
  const r = db.prepare('INSERT INTO audit (at, user_id, ip, event) VALUES (?, ?, ?, ?)').run(Date.now(), userId, ip.slice(0, 64), event.slice(0, 200));
  if (Number(r.lastInsertRowid) % 200 === 0) db.prepare('DELETE FROM audit WHERE id <= ?').run(Number(r.lastInsertRowid) - 10000);
}

// ---------- throttling ----------
type Att = { n: number; until: number; at: number };
const att = (key: string) => db.prepare('SELECT n, until, at FROM login_attempts WHERE key = ?').get(key) as Att | undefined;
function bump(key: string, windowMs: number, threshold: number, lockMs: number) {
  const now = Date.now(), r = att(key), n = (r && now - r.at < windowMs ? r.n : 0) + 1;
  const until = n >= threshold ? now + Math.min(3600_000, lockMs * 2 ** Math.min(n - threshold, 20)) : 0;
  db.prepare('INSERT INTO login_attempts (key, n, until, at) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET n = excluded.n, until = excluded.until, at = excluded.at').run(key, n, until, now);
}
/** Throws 429 while this IP or this (account, IP) pair is locked; returns the per-account slowdown in ms. */
function throttleCheck(ip: string, name: string): number {
  const now = Date.now();
  const until = Math.max(att('ip:' + ip)?.until ?? 0, att(`pair:${name}|${ip}`)?.until ?? 0);
  if (until > now) throw Object.assign(new HttpError(429, `Too many attempts. Try again in ${Math.ceil((until - now) / 1000)} s`), { retryAfter: Math.ceil((until - now) / 1000) });
  const a = att('acct:' + name);
  return a && now - a.at < 3600_000 ? Math.min(10, Math.max(0, a.n - 20)) * 1000 : 0;   // account-wide: slow down, never lock out the owner
}
const failed = (ip: string, name: string) => { bump('ip:' + ip, 600_000, 10, 60_000); bump(`pair:${name}|${ip}`, 3600_000, 5, 60_000); bump('acct:' + name, 3600_000, Infinity, 0) };
const succeeded = (name: string, ip: string) => { db.prepare('DELETE FROM login_attempts WHERE key IN (?, ?)').run(`pair:${name}|${ip}`, 'acct:' + name) };   // never the IP counter: a login of your own must not reset guessing elsewhere
/** Fixed-window counter for things that are not logins (registrations). */
function allow(key: string, max: number, windowMs: number): boolean {
  const now = Date.now(), r = att(key), live = !!r && now - r.at < windowMs, n = live ? r!.n : 0;   // here `at` is the window start
  if (n >= max) return false;
  db.prepare('INSERT INTO login_attempts (key, n, until, at) VALUES (?, ?, 0, ?) ON CONFLICT(key) DO UPDATE SET n = excluded.n, at = excluded.at').run(key, n + 1, live ? r!.at : now);
  return true;
}

// ---------- sessions ----------
export function createSession(userId: number, req: IncomingMessage): string {
  const token = randomBytes(32).toString('base64url'), now = Date.now();
  db.prepare('INSERT INTO sessions (token_hash, user_id, created, last_seen, expires, agent, ip) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(sha(token), userId, now, now, now + SESSION_MS, String(req.headers['user-agent'] ?? '').slice(0, 200), clientIp(req));
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash NOT IN (SELECT token_hash FROM sessions WHERE user_id = ? ORDER BY last_seen DESC LIMIT ?)').run(userId, userId, MAX_SESSIONS);
  return token;
}
export const endSession = (token: string) => { db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(token)) };
export function sessionUser(token: string): User | null {
  const h = sha(token), now = Date.now();
  const r = db.prepare('SELECT s.last_seen, s.expires, u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?').get(h) as (Row & { last_seen: number; expires: number }) | undefined;
  if (!r || r.expires < now || now - r.last_seen > IDLE_MS || r.status !== 'active') return null;
  if (now - r.last_seen > 60_000) db.prepare('UPDATE sessions SET last_seen = ? WHERE token_hash = ?').run(now, h);
  return toUser(r);
}
export const revokeUserSessions = (userId: number) => { db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId) };
export const listSessions = (userId: number) => db.prepare('SELECT substr(token_hash, 1, 16) AS id, created, last_seen, agent, ip FROM sessions WHERE user_id = ? ORDER BY last_seen DESC').all(userId) as { id: string }[];
export function endSessionById(userId: number, id: string): boolean {
  if (!/^[0-9a-f]{16}$/.test(id)) return false;
  return db.prepare('DELETE FROM sessions WHERE user_id = ? AND substr(token_hash, 1, 16) = ?').run(userId, id).changes > 0;
}
export const sessionIdOf = (token: string) => sha(token).slice(0, 16);

// ---------- invites and recovery codes ----------
export function createInvite(createdBy: number | null, o: { uses?: number; days?: number; note?: string } = {}): string {
  const code = randomBytes(16).toString('base64url');
  db.prepare('INSERT INTO invites (code_hash, created_by, uses_left, expires, note) VALUES (?, ?, ?, ?, ?)')
    .run(sha(code), createdBy, Math.min(Math.max(Math.floor(o.uses ?? 1), 1), 1000), Date.now() + Math.min(Math.max(o.days ?? 7, 0.01), 365) * 86400_000, (o.note ?? '').slice(0, 200));
  return code;
}
const inviteOk = (code: string) => !!db.prepare('SELECT 1 FROM invites WHERE code_hash = ? AND uses_left > 0 AND expires > ?').get(sha(code), Date.now());
const takeInvite = (code: string) => db.prepare('UPDATE invites SET uses_left = uses_left - 1 WHERE code_hash = ? AND uses_left > 0 AND expires > ?').run(sha(code), Date.now()).changes === 1;

const B32 = 'abcdefghijklmnopqrstuvwxyz234567';
function newRecoveryCode(): string {   // 80 bits: 10 bytes = 16 base32 characters
  const b = randomBytes(10); let bits = 0, v = 0, out = '';
  for (const x of b) { v = (v << 8) | x; bits += 8; while (bits >= 5) { out += B32[(v >>> (bits - 5)) & 31]; bits -= 5 } }
  return out.match(/.{4}/g)!.join('-');
}
const codeKey = (c: string) => sha(c.toLowerCase().replace(/[^a-z2-7]/g, ''));   // high entropy: a fast hash is enough
export function newRecoveryCodes(userId: number): string[] {
  const codes = Array.from({ length: 8 }, newRecoveryCode);
  db.prepare('DELETE FROM recovery_codes WHERE user_id = ?').run(userId);
  for (const c of codes) db.prepare('INSERT INTO recovery_codes (user_id, code_hash) VALUES (?, ?)').run(userId, codeKey(c));
  return codes;
}

// ---------- registration, login, recovery ----------
const RESERVED = new Set(['admin', 'administrator', 'root', 'system', 'support', 'owner', 'null', 'undefined', 'api', 'www', 'anonymous']);
export function checkName(n: unknown): string {
  const name = typeof n === 'string' ? n.trim().toLowerCase() : '';
  if (!/^[a-z0-9_.-]{3,32}$/.test(name)) throw bad('Username: 3 to 32 characters, letters, digits, . _ -');
  return name;
}
const adminName = () => (process.env.CT_ADMIN ?? '').trim().toLowerCase();

export async function register(b: { name?: unknown; password?: unknown; invite?: unknown }, req: IncomingMessage): Promise<{ user: User; recoveryCodes: string[] }> {
  if (REGISTRATION === 'closed') throw new HttpError(403, 'Registration is closed on this server');
  const ip = clientIp(req), name = checkName(b.name), pw = checkNewPassword(b.password, name), invite = typeof b.invite === 'string' ? b.invite.slice(0, 64) : '';
  if (!allow('reg:' + ip, Number(process.env.CT_REG_PER_HOUR) || (REGISTRATION === 'open' ? 3 : 10), 3600_000)) throw new HttpError(429, 'Too many sign-ups from this address. Try again later');
  if (REGISTRATION === 'open' && !allow('reg:day', Number(process.env.CT_OPEN_REG_PER_DAY) || 50, 86400_000)) throw new HttpError(429, 'Sign-ups are paused for today');
  if (REGISTRATION === 'invite' && !(invite && inviteOk(invite))) throw new HttpError(403, 'Invalid or expired invite code');
  if (RESERVED.has(name) || name === adminName()) throw new HttpError(409, 'That username is taken');
  if (byName(name)) throw new HttpError(409, 'That username is taken');
  const hash = await hashPassword(pw);
  // Everything below is synchronous: the invite is spent and the account created in one step, or neither.
  db.exec('BEGIN IMMEDIATE');
  let id = 0;
  try {
    if (REGISTRATION === 'invite' && !takeInvite(invite)) throw new HttpError(403, 'Invalid or expired invite code');
    const r = db.prepare("INSERT INTO users (name, pw, role, created, invited_by) VALUES (?, ?, 'user', ?, (SELECT created_by FROM invites WHERE code_hash = ?))").run(name, hash, Date.now(), sha(invite));
    id = Number(r.lastInsertRowid);
    createUserDb(id);
    const recoveryCodes = newRecoveryCodes(id);
    db.exec('COMMIT');
    audit(id, ip, 'register');
    return { user: { id, name, role: 'user' }, recoveryCodes };
  } catch (e) {
    db.exec('ROLLBACK');
    if (id) deleteUserDb(id);
    if (/UNIQUE/i.test((e as Error).message)) throw new HttpError(409, 'That username is taken');
    throw e;
  }
}

export async function login(b: { name?: unknown; password?: unknown }, req: IncomingMessage): Promise<User> {
  const ip = clientIp(req), name = typeof b.name === 'string' ? b.name.trim().toLowerCase().slice(0, 64) : '', pw = typeof b.password === 'string' ? b.password.slice(0, 1000) : '';
  const delay = throttleCheck(ip, name);
  if (delay) await new Promise(r => setTimeout(r, delay));
  const row = byName(name);
  const ok = row ? await verifyPassword(row.pw, pw) : (await verifyPassword(await DUMMY, pw), false);
  if (!ok || !row) { failed(ip, name); audit(row?.id ?? null, ip, 'login fail'); throw new HttpError(401, UNIFORM_LOGIN_ERROR) }
  if (row.status !== 'active') { audit(row.id, ip, 'login disabled'); throw new HttpError(403, 'This account is disabled') }   // only someone holding the right password learns this
  succeeded(name, ip);
  db.prepare('UPDATE users SET last_login = ? WHERE id = ?').run(Date.now(), row.id);
  if (outdated(row.pw)) db.prepare('UPDATE users SET pw = ? WHERE id = ?').run(await hashPassword(pw), row.id);
  audit(row.id, ip, 'login');
  return toUser(row);
}
/** Verify the logged-in user's own password (password change, admin step-up). */
export async function confirmPassword(userId: number, pw: unknown): Promise<boolean> {
  const row = byId(userId);
  return !!row && typeof pw === 'string' && await verifyPassword(row.pw, pw.slice(0, 1000));
}
export async function setPassword(userId: number, pw: string, o: { mustChange?: boolean } = {}) {
  const hash = await hashPassword(pw);
  db.prepare('UPDATE users SET pw = ?, must_change = ? WHERE id = ?').run(hash, o.mustChange ? 1 : 0, userId);
  revokeUserSessions(userId);   // a new password signs every device out
}
/** Reset with a recovery code. Same throttle as login; an unknown name costs the same work and gets the same answer. */
export async function recover(b: { name?: unknown; code?: unknown; newPassword?: unknown }, req: IncomingMessage): Promise<{ user: User; recoveryCodes: string[] }> {
  const ip = clientIp(req), name = typeof b.name === 'string' ? b.name.trim().toLowerCase().slice(0, 64) : '';
  const delay = throttleCheck(ip, name);
  if (delay) await new Promise(r => setTimeout(r, delay));
  const pw = checkNewPassword(b.newPassword, name), hash = await hashPassword(pw);
  const row = byName(name), code = typeof b.code === 'string' ? b.code.slice(0, 64) : '';
  const ok = !!row && row.status === 'active' && db.prepare('UPDATE recovery_codes SET used = 1 WHERE user_id = ? AND code_hash = ? AND used = 0').run(row.id, codeKey(code)).changes === 1;
  if (!ok || !row) { failed(ip, name); audit(row?.id ?? null, ip, 'recover fail'); throw new HttpError(401, 'Wrong username or recovery code') }
  succeeded(name, ip);
  db.prepare('UPDATE users SET pw = ?, must_change = 0 WHERE id = ?').run(hash, row.id);
  revokeUserSessions(row.id);
  audit(row.id, ip, 'recover');
  return { user: toUser(row), recoveryCodes: newRecoveryCodes(row.id) };
}

// ---------- administration (CLI and /api/admin) ----------
const tempPassword = () => randomBytes(12).toString('base64url');
export async function createAdmin(name: string): Promise<string> {
  name = checkName(name);
  if (byName(name)) throw bad('That user exists already');
  const pw = tempPassword(), r = db.prepare("INSERT INTO users (name, pw, role, must_change, created) VALUES (?, ?, 'admin', 1, ?)").run(name, await hashPassword(pw), Date.now());
  createUserDb(Number(r.lastInsertRowid));
  newRecoveryCodes(Number(r.lastInsertRowid));
  audit(Number(r.lastInsertRowid), 'cli', 'create admin');
  return pw;
}
/** CT_ADMIN=<name>: on the first start without that user, create it with a one-time password (printed once). Never by a race on /register. */
export async function ensureAdmin(): Promise<{ name: string; password: string } | null> {
  const name = adminName();
  if (!name) return null;
  const ex = byName(name);
  if (ex) { if (ex.role !== 'admin') console.warn(`CT_ADMIN=${name} exists but is not an admin; promote it with the CLI`); return null }
  return { name, password: await createAdmin(name) };
}
export async function resetPassword(name: string): Promise<string> {
  const row = byName(name.toLowerCase()); if (!row) throw new HttpError(404, 'No such user');
  const pw = tempPassword(); await setPassword(row.id, pw, { mustChange: true });
  audit(row.id, 'cli', 'reset password');
  return pw;
}
export function setStatus(name: string, status: 'active' | 'disabled') {
  const row = byName(name.toLowerCase()); if (!row) throw new HttpError(404, 'No such user');
  db.prepare('UPDATE users SET status = ? WHERE id = ?').run(status, row.id);
  if (status === 'disabled') revokeUserSessions(row.id);
  activeAt = 0;
  audit(row.id, 'cli', status === 'disabled' ? 'disable' : 'enable');
}
export function removeUser(name: string): number {
  const row = byName(name.toLowerCase()); if (!row) throw new HttpError(404, 'No such user');
  db.prepare('DELETE FROM users WHERE id = ?').run(row.id);   // sessions, recovery codes, push endpoints and share index cascade
  deleteUserDb(row.id);
  activeAt = 0;
  audit(null, 'cli', `delete user ${row.id}`);
  return row.id;
}
export const listUsers = () => (db.prepare('SELECT id, name, role, status, created, last_login FROM users ORDER BY id').all() as { id: number }[]).map(u => ({ ...u, bytes: userDbBytes(u.id) }));

// ---------- central indexes (push endpoints, public share links) ----------
/** Give a push endpoint to `uid`; returns the user that had it before, if any (the caller removes it from that user's file). */
export function claimPushEndpoint(endpoint: string, uid: number): number | null {
  const prev = (db.prepare('SELECT user_id FROM push_endpoints WHERE endpoint = ?').get(endpoint) as { user_id: number } | undefined)?.user_id ?? null;
  db.prepare('INSERT INTO push_endpoints (endpoint, user_id) VALUES (?, ?) ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id').run(endpoint, uid);
  return prev !== uid ? prev : null;
}
export const releasePushEndpoint = (endpoint: string, uid: number) => { db.prepare('DELETE FROM push_endpoints WHERE endpoint = ? AND user_id = ?').run(endpoint, uid) };
export const indexShare = (id: string, uid: number) => { db.prepare('INSERT INTO share_index (id, user_id) VALUES (?, ?)').run(id, uid) };
export const unindexShare = (id: string) => { db.prepare('DELETE FROM share_index WHERE id = ?').run(id) };
export const shareOwner = (id: string) => (db.prepare('SELECT user_id FROM share_index WHERE id = ?').get(id) as { user_id: number } | undefined)?.user_id ?? null;

setInterval(() => {
  const now = Date.now();
  db.prepare('DELETE FROM sessions WHERE expires < ? OR last_seen < ?').run(now, now - IDLE_MS);
  db.prepare('DELETE FROM invites WHERE expires < ? OR uses_left <= 0').run(now - 86400_000);
  db.prepare('DELETE FROM login_attempts WHERE until < ? AND at < ?').run(now, now - 86400_000);
}, 600_000).unref();
