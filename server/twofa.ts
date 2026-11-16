// Two-factor sign-in (TOTP, RFC 6238) for password accounts, private and public mode. Docs: docs/team-server.md.
// Signed in (session cookie or device token):
//   GET  /api/auth/2fa/status                 → { enabled, required, recoveryLeft }
//   POST /api/auth/2fa/setup   { password }   → { secret, otpauth, qrSvg }   (pending for 10 min; nothing is saved yet)
//   POST /api/auth/2fa/enable  { code }       → { ok, recoveryCodes }        (8 codes, shown once; the code proves the app works)
//   POST /api/auth/2fa/disable { password, code }   (code = a 6-digit code or a recovery code; refused while the server requires 2FA)
// Sign-in (/api/auth/login answers { twofa: true, ticket } for an account with 2FA, { enroll: true, ticket } when the server requires it
// and the account has none; no session and no token exist yet). The ticket lives 3 min, is single use, bound to the client address, 5 wrong codes kill it.
//   POST /api/auth/login/2fa        { ticket, code | recovery, device? } → like a login: { ok, user, token? } (+ cookie without `device`)
//   POST /api/auth/login/2fa/setup  { ticket }                           → { secret, otpauth, qrSvg }   (enrol tickets only)
//   POST /api/auth/login/2fa/enroll { ticket, code, device? }            → { ok, user, token?, recoveryCodes }
// The TOTP secret is encrypted at rest: private mode with the secrets module (AES-256-GCM), public mode (which must never hold secret.key)
// with the same cipher under data/totp.key. A used step can never be accepted again; failures are rate limited per account and per address.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IncomingMessage } from 'node:http';
import { HttpError, bad, route, type Ctx } from './core/http.ts';
import { DATA_DIR, db, migration } from './core/db.ts';
import { checkPassword, clientIp, createDevice, createSession, endSession, loginBlocked, loginFailed, loginOk, sessionCookie } from './core/auth.ts';
import { SERVER_NAME, isPublic } from './core/mode.ts';
import type { User } from './core/userdb.ts';
import { newSecret, otpauth, verify } from './core/totp.ts';
import { qrSvg } from './core/qrsvg.ts';
import { addrKey, failGate } from './core/failgate.ts';

const U = isPublic ? await import('./core/users.ts') : null;
const sealed = isPublic ? null : await import('./core/secrets.ts');
migration('twofa/1', `CREATE TABLE twofa (user_id INTEGER PRIMARY KEY, enc TEXT, enabled INTEGER NOT NULL DEFAULT 0, last_step INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL);
  CREATE TABLE twofa_codes (user_id INTEGER NOT NULL, code_hash TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, code_hash))`);
U?.onRemoved(id => { db.prepare('DELETE FROM twofa WHERE user_id = ?').run(id); db.prepare('DELETE FROM twofa_codes WHERE user_id = ?').run(id) });

const body = (c: Ctx) => ((c.body && typeof c.body === 'object' && !Array.isArray(c.body)) ? c.body : {}) as Record<string, unknown>;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const audit = (id: number | null, req: IncomingMessage, ev: string) => U?.audit(id, clientIp(req), ev);

/** Public server: administrators always need 2FA (it enrols right after the password step); CT_REQUIRE_2FA=1 extends that to every account, CT_REQUIRE_2FA=0 switches it off (tests, a closed lab). */
const REQ = isPublic ? (process.env.CT_REQUIRE_2FA ?? '').trim().toLowerCase() : '0';
export const required = (role: string) => ['1', 'true', 'yes', 'on'].includes(REQ) || (!['0', 'false', 'no', 'off'].includes(REQ) && role === 'admin');

// ---------- storage ----------
let pubKey: Buffer | null = null;
function key(): Buffer {
  if (pubKey) return pubKey;
  const f = join(DATA_DIR, 'totp.key');
  if (!existsSync(f)) writeFileSync(f, randomBytes(32).toString('base64'), { mode: 0o600 });
  return (pubKey = Buffer.from(readFileSync(f, 'utf8').trim(), 'base64'));
}
function seal(id: number, secret: string): string {
  const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', key(), iv); c.setAAD(Buffer.from('twofa:' + id));
  const d = Buffer.concat([c.update(secret, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), d]).toString('base64');
}
function unseal(id: number, enc: string): string {
  const b = Buffer.from(enc, 'base64'), d = createDecipheriv('aes-256-gcm', key(), b.subarray(0, 12)); d.setAAD(Buffer.from('twofa:' + id)); d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
}
const row = (id: number) => db.prepare('SELECT enc, enabled FROM twofa WHERE user_id = ?').get(id) as { enc: string | null; enabled: number } | undefined;
export const isEnabled = (id: number) => row(id)?.enabled === 1;
const secretOf = (id: number) => { const r = row(id); if (!r) return null; return sealed ? sealed.secretGet('twofa.' + id) : r.enc ? unseal(id, r.enc) : null };

const B32 = 'abcdefghijklmnopqrstuvwxyz234567';
function newRecoveryCode(): string {   // 80 bits, like the password recovery codes: 16 base32 characters in groups of four
  let bits = 0, v = 0, out = '';
  for (const x of randomBytes(10)) { v = ((v << 8) | x) & 0xfff; bits += 8; while (bits >= 5) { out += B32[(v >>> (bits - 5)) & 31]; bits -= 5 } }
  return out.match(/.{4}/g)!.join('-');
}
const codeKey = (c: string) => sha(c.toLowerCase().replace(/[^a-z2-7]/g, ''));
function save(id: number, secret: string, step: number): string[] {
  db.prepare('INSERT INTO twofa (user_id, enc, enabled, last_step, created) VALUES (?, ?, 1, ?, ?) ON CONFLICT(user_id) DO UPDATE SET enc = excluded.enc, enabled = 1, last_step = excluded.last_step')
    .run(id, sealed ? null : seal(id, secret), step, Date.now());
  sealed?.secretSet('twofa.' + id, secret);
  const codes = Array.from({ length: 8 }, newRecoveryCode);
  db.prepare('DELETE FROM twofa_codes WHERE user_id = ?').run(id);
  for (const c of codes) db.prepare('INSERT INTO twofa_codes (user_id, code_hash) VALUES (?, ?)').run(id, codeKey(c));
  return codes;
}
function wipe(id: number) {
  db.prepare('DELETE FROM twofa WHERE user_id = ?').run(id); db.prepare('DELETE FROM twofa_codes WHERE user_id = ?').run(id);
  sealed?.secretDel('twofa.' + id);
}

// ---------- checking a code ----------
const byUser = failGate(10, 15 * 60_000, 15 * 60_000), byAddr = failGate(10, 10 * 60_000, 10 * 60_000);
const tooMany = (s: number) => Object.assign(new HttpError(429, `Too many attempts. Try again in ${s} s`), { retryAfter: s });
const locked = (id: number, req: IncomingMessage) => { const w = Math.max(byUser.wait('u' + id), byAddr.wait(addrKey(clientIp(req)))); if (w) throw tooMany(w) };
const failed = (id: number, req: IncomingMessage) => { byUser.fail('u' + id); byAddr.fail(addrKey(clientIp(req))) };
/** True when `code` is the current TOTP of the account (a step is accepted once) or one unused recovery code. Counts failures; throws 429 while locked. */
function checkCode(id: number, req: IncomingMessage, o: { code?: unknown; recovery?: unknown }): boolean {
  locked(id, req);
  let ok = false;
  const secret = secretOf(id);
  if (secret && typeof o.code === 'string') {
    const step = verify(secret, o.code);
    ok = step !== null && db.prepare('UPDATE twofa SET last_step = ? WHERE user_id = ? AND last_step < ?').run(step, id, step).changes === 1;   // replay: the step must be newer than the last one used
  } else if (typeof o.recovery === 'string' && o.recovery.length <= 64) {
    ok = db.prepare('UPDATE twofa_codes SET used = 1 WHERE user_id = ? AND code_hash = ? AND used = 0').run(id, codeKey(o.recovery)).changes === 1;
    if (ok) audit(id, req, '2fa recovery code used');
  }
  if (ok) { byUser.ok('u' + id); byAddr.ok(addrKey(clientIp(req))) } else { failed(id, req); audit(id, req, '2fa fail') }
  return ok;
}
async function confirm(c: Ctx, pw: unknown): Promise<boolean> {
  if (U) return U.confirmPassword(c.user.id, pw, c.req);
  const ip = clientIp(c.req), wait = loginBlocked(ip);
  if (wait) throw tooMany(wait);
  const ok = typeof pw === 'string' && checkPassword(pw);
  if (ok) loginOk(ip); else loginFailed(ip);
  return ok;
}

// ---------- tickets (password step done, second step pending) ----------
interface Ticket { user: User; ip: string; exp: number; kind: 'verify' | 'enroll'; tries: number; pending?: string; finish?: () => object }
const tickets = new Map<string, Ticket>(), TICKET_MS = 3 * 60_000;
const BAD_TICKET = 'Invalid or expired sign-in. Start again';
function sweep() { const t = Date.now(); for (const [k, v] of tickets) if (v.exp < t) tickets.delete(k) }
/**
 * Called by /api/auth/login after the password is right. Null = no second step, carry on as before. Otherwise the body to answer with:
 * { twofa: true, ticket } (the account has 2FA) or { enroll: true, ticket } (the server requires it and the account has none).
 */
export function challenge(user: User, c: Ctx, finish?: () => object): { twofa: true; ticket: string } | { enroll: true; ticket: string } | null {
  const on = isEnabled(user.id);
  if (!on && !required(user.role)) return null;
  sweep();
  if (tickets.size >= 1000) throw tooMany(30);
  const ticket = randomBytes(24).toString('base64url');
  tickets.set(sha(ticket), { user, ip: clientIp(c.req), exp: Date.now() + TICKET_MS, kind: on ? 'verify' : 'enroll', tries: 0, finish });   // finish: work held back until the second factor passes (password recovery)
  audit(user.id, c.req, on ? 'login password ok, 2fa pending' : 'login password ok, 2fa enrolment pending');
  return on ? { twofa: true, ticket } : { enroll: true, ticket };
}
function ticketOf(c: Ctx, kind: Ticket['kind']): { id: string; t: Ticket } {
  const v = body(c).ticket, id = typeof v === 'string' && v.length <= 64 ? sha(v) : '', t = tickets.get(id);
  if (!t || t.exp < Date.now() || t.kind !== kind || t.ip !== clientIp(c.req)) { if (t && t.ip !== clientIp(c.req)) tickets.delete(id); throw new HttpError(401, BAD_TICKET) }
  return { id, t };
}
/** The `device` label rule of /api/auth/login: with it the answer carries a token and no cookie; a cross-origin call without it is refused. */
export function deviceLabel(c: Ctx, must = false): string | null {
  const d = body(c).device;
  if (d === undefined || d === null) { if (must) throw bad('device must be a non-empty label'); if (c.crossSite) throw new HttpError(403, 'Cross-site request blocked'); return null }
  const label = typeof d === 'string' ? d.replace(/\p{Cc}/gu, '').trim().slice(0, 60) : '';
  if (!label) throw bad('device must be a non-empty label');
  return label;
}
function issue(c: Ctx, label: string | null, user: User) {
  const u = { name: user.name, role: user.role, ...(user.mustChange ? { mustChange: true } : {}) };
  if (label) return { ok: true, token: createDevice(c.req, label, user), user: u };
  if (c.session) endSession(c.session);
  c.res.setHeader('set-cookie', sessionCookie(createSession(c.req, user), c.secure));
  return { ok: true, user: u };
}
const enrolInfo = (secret: string, name: string) => { const uri = otpauth(secret, name, SERVER_NAME || 'Chart Terminal'); return { secret, otpauth: uri, qrSvg: qrSvg(uri) } };

// ---------- routes: sign-in ----------
const LIM = { limit: 4096 };
route('POST', '/api/auth/login/2fa', c => {
  const label = deviceLabel(c);
  const { id, t } = ticketOf(c, 'verify');
  if (!checkCode(t.user.id, c.req, body(c))) {
    if (++t.tries >= 5) tickets.delete(id);
    throw new HttpError(401, 'Wrong code');
  }
  tickets.delete(id);   // single use
  audit(t.user.id, c.req, 'login (2fa)');
  const extra = t.finish?.();
  return { ...issue(c, label, t.user), ...extra };
}, { public: true, ...LIM });
route('POST', '/api/auth/login/2fa/setup', c => {
  const { t } = ticketOf(c, 'enroll');
  t.pending ??= newSecret();   // the same secret on a retry: the authenticator app the user already scanned keeps working
  return enrolInfo(t.pending, t.user.name);
}, { public: true, ...LIM });
route('POST', '/api/auth/login/2fa/enroll', c => {
  const label = deviceLabel(c);
  const { id, t } = ticketOf(c, 'enroll');
  locked(t.user.id, c.req);
  const step = t.pending ? verify(t.pending, body(c).code) : null;
  if (step === null) { failed(t.user.id, c.req); if (++t.tries >= 5) tickets.delete(id); throw new HttpError(401, 'Wrong code') }
  tickets.delete(id);
  const recoveryCodes = save(t.user.id, t.pending!, step);
  audit(t.user.id, c.req, '2fa enabled (at sign-in)');
  return { ...issue(c, label, t.user), recoveryCodes };
}, { public: true, ...LIM });

// ---------- routes: settings (signed in) ----------
const pendingSetup = new Map<number, { secret: string; exp: number }>();
route('GET', '/api/auth/2fa/status', c => ({
  enabled: isEnabled(c.user.id), required: required(c.user.role),
  recoveryLeft: (db.prepare('SELECT COUNT(*) AS n FROM twofa_codes WHERE user_id = ? AND used = 0').get(c.user.id) as { n: number }).n,
}));
route('POST', '/api/auth/2fa/setup', async c => {
  if (!await confirm(c, body(c).password)) throw new HttpError(401, 'Wrong password');
  if (isEnabled(c.user.id)) throw new HttpError(409, 'Two-factor sign-in is already on. Turn it off first to set it up again');
  const p = pendingSetup.get(c.user.id), secret = p && p.exp > Date.now() ? p.secret : newSecret();
  pendingSetup.set(c.user.id, { secret, exp: Date.now() + 10 * 60_000 });
  if (pendingSetup.size > 500) for (const [k, v] of pendingSetup) if (v.exp < Date.now()) pendingSetup.delete(k);
  return enrolInfo(secret, c.user.name);
}, LIM);
route('POST', '/api/auth/2fa/enable', c => {
  const p = pendingSetup.get(c.user.id);
  if (!p || p.exp < Date.now()) throw bad('Start the setup first');
  locked(c.user.id, c.req);
  const step = verify(p.secret, body(c).code);
  if (step === null) { failed(c.user.id, c.req); throw new HttpError(401, 'Wrong code') }
  pendingSetup.delete(c.user.id);
  const recoveryCodes = save(c.user.id, p.secret, step);
  audit(c.user.id, c.req, '2fa enabled');
  return { ok: true, recoveryCodes };
}, LIM);
route('POST', '/api/auth/2fa/disable', async c => {
  if (required(c.user.role)) throw new HttpError(403, 'This server requires two-factor sign-in');
  if (!isEnabled(c.user.id)) throw new HttpError(409, 'Two-factor sign-in is not on');
  if (!await confirm(c, body(c).password)) throw new HttpError(401, 'Wrong password');
  const code = body(c).code;
  if (!checkCode(c.user.id, c.req, /^\s*\d{6}\s*$/.test(String(code)) ? { code } : { recovery: code })) throw new HttpError(401, 'Wrong code');
  wipe(c.user.id);
  audit(c.user.id, c.req, '2fa disabled');
  return { ok: true };
}, LIM);
