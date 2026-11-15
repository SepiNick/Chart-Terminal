// Login API.
// Private server (one password; first run: it can only be set from this PC, so nobody on the LAN can claim the server):
//   GET  /api/auth/status   → { setup: boolean, loggedIn: boolean, mode: 'private', registration, version, serverName, features }
//   POST /api/auth/setup    { password }           → sets the first password (localhost only, once)
//   POST /api/auth/login    { password }           → session cookie (5 failures → growing lockout per IP)
//   POST /api/auth/logout
//   POST /api/auth/password { current, password }  → signs out every device (cookie sessions and device tokens)
//   GET  /api/auth/sessions → [{ id, created, last_seen, agent, ip, current }]
//   DELETE /api/auth/sessions/:id → signs that one device out (its open socket is closed too)
// Public server (accounts; docs/research/multiuser-design.md §2):
//   GET  /api/auth/status   → { mode: 'public', registration, loggedIn, user?, version, serverName, features }  (public)
//   POST /api/auth/register { name, password, invite? } → account + 8 recovery codes (shown once) + session cookie
//   POST /api/auth/login    { name, password }     → session cookie (three-layer throttle, uniform error)
//   POST /api/auth/logout · POST /api/auth/password { current, password } · POST /api/auth/recover { name, code, newPassword }
//   POST /api/auth/recovery-codes { password } → a fresh set of 8 (the old ones stop working)
//   GET /api/auth/sessions · DELETE /api/auth/sessions/:id   (only the caller's own)
//   Google / Apple sign-in, identities, password/set: see oauth.ts. GET /api/auth/status also carries oauth: { google, apple }.
// Both servers, clients on another origin (docs/multi-server.md): login/register/recover accept "device": "<label>" and then
// answer { ok, token, user } with NO cookie. Every route accepts `Authorization: Bearer <token>`.
//   GET /api/auth/devices → [{ id, label, created, lastUsed, ip, current }] · DELETE /api/auth/devices/:id (the caller's own)
//   POST /api/admin/invites { password, uses?, days?, note? } · GET /api/admin/users   (admins; others get a 404)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HttpError, bad, closeClients, isLoopbackHost, route, type Ctx } from './core/http.ts';
import { checkPassword, clearCookie, clientIp, createDevice, createSession, endDeviceById, endSession, endSessionById, hasPassword, listDevices, listSessions, sessionId, loginBlocked, loginFailed, loginOk, sessionCookie, setPassword } from './core/auth.ts';
import { REGISTRATION, SERVER_NAME, isPublic } from './core/mode.ts';
import { PRIVATE_USER } from './core/userdb.ts';

const pw = (b: unknown, k = 'password') => { const v = (b as Record<string, unknown> | undefined)?.[k]; if (typeof v !== 'string' || !v) throw bad('Password required'); return v };
const body = (c: Ctx) => ((c.body && typeof c.body === 'object' && !Array.isArray(c.body)) ? c.body : {}) as Record<string, unknown>;

/** `"device": label` → token mode (no cookie). A cross-origin call without it is refused: cookies never cross origins. */
const device = (c: Ctx): string | null => {
  const d = body(c).device;
  if (d === undefined || d === null) { if (c.crossSite) throw new HttpError(403, 'Cross-site request blocked'); return null }
  const label = typeof d === 'string' ? d.replace(/\p{Cc}/gu, '').trim().slice(0, 60) : '';
  if (!label) throw bad('device must be a non-empty label');
  return label;
};
let version = process.env.npm_package_version ?? 'unknown';
try { version = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8')).version ?? version } catch {}
const info = (features: Record<string, boolean>) => ({ version, serverName: SERVER_NAME, features });

if (!isPublic) {
  const isLocal = (ip: string) => ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  route('GET', '/api/auth/status', c => ({ setup: !hasPassword(), loggedIn: !!c.session, mode: 'private', registration: 'closed', oauth: { google: false, apple: false, telegram: false }, ...info({ trading: true, ai: true, ml: true, forward: true, scripts: true, python: true, social: false }) }), { public: true });
  route('POST', '/api/auth/setup', c => {
    if (hasPassword()) throw new HttpError(409, 'Already set up');
    // Loopback address AND loopback Host name: a rebinding page can't claim the server before the owner does.
    if (!isLocal(clientIp(c.req)) || !isLoopbackHost(c.req)) throw new HttpError(403, 'Set the first password from the computer running the server');
    setPassword(pw(c.body));
    c.res.setHeader('set-cookie', sessionCookie(createSession(c.req), c.secure));
    return { ok: true };
  }, { public: true, limit: 4096 });
  route('POST', '/api/auth/login', c => {
    const label = device(c);
    const ip = clientIp(c.req), wait = loginBlocked(ip);
    if (wait) throw new HttpError(429, `Too many attempts — try again in ${wait} s`);
    if (!checkPassword(pw(c.body))) { loginFailed(ip); throw new HttpError(401, 'Wrong password') }
    loginOk(ip);
    if (label) return { ok: true, token: createDevice(c.req, label), user: { name: PRIVATE_USER.name, role: PRIVATE_USER.role } };
    c.res.setHeader('set-cookie', sessionCookie(createSession(c.req), c.secure));
    return { ok: true };
  }, { public: true, limit: 4096 });
  route('POST', '/api/auth/logout', c => { if (c.session) { closeClients(cl => cl.session === c.session); endSession(c.session) } c.res.setHeader('set-cookie', clearCookie(c.secure)) });
  route('POST', '/api/auth/password', c => {
    if (!checkPassword(pw(c.body, 'current'))) throw new HttpError(401, 'Current password is wrong');
    setPassword(pw(c.body));   // every cookie session and device token ends
    closeClients(() => true);   // and so does every open socket
    if (!c.bearer) c.res.setHeader('set-cookie', sessionCookie(createSession(c.req), c.secure));
    return { ok: true };
  }, { limit: 4096 });
  route('GET', '/api/auth/sessions', c => listSessions(c.session));
  route('DELETE', '/api/auth/sessions/:id', c => {
    if (!endSessionById(c.params.id)) throw new HttpError(404, 'No such session');
    closeClients(cl => sessionId(cl.session) === c.params.id, 4001, 'Signed out');
  });
  route('GET', '/api/auth/devices', c => listDevices(c.session));
  route('DELETE', '/api/auth/devices/:id', c => {
    if (!endDeviceById(c.params.id)) throw new HttpError(404, 'No such device');
    closeClients(cl => sessionId(cl.session) === c.params.id, 4001, 'Signed out');
  });
} else {
  const U = await import('./core/users.ts');
  const O = await import('./oauth.ts');
  const FEATURES = { trading: false, scripts: false, brokers: false, forward: false, scriptAlerts: false, recorder: false, ai: false, ml: false, python: false, lan: false, telegram: false, email: false, webhook: false, social: true };
  const start = (c: Ctx, userId: number) => {   // always a brand-new token: a cookie sent by the client is never adopted (no session fixation)
    if (c.bearer) return;   // a token client that changed its password signs in again; it gets no cookie
    if (c.session) endSession(c.session);
    c.res.setHeader('set-cookie', sessionCookie(createSession(c.req, { id: userId, name: '', role: 'user' }), c.secure));
  };
  /** Token mode: a fresh device token and no cookie; otherwise the usual cookie session. */
  const issue = (c: Ctx, label: string | null, user: { id: number; name: string; role: 'admin' | 'user' }) =>
    label ? { token: createDevice(c.req, label, user) } : (start(c, user.id), {});
  route('GET', '/api/auth/status', c => {
    const u = c.session ? c.user : null;
    return { setup: false, mode: 'public', registration: REGISTRATION, oauth: O.oauthStatus(), loggedIn: !!u, ...(u ? { user: { name: u.name, role: u.role, mustChange: !!u.mustChange } } : {}), ...info(FEATURES) };
  }, { public: true });
  route('POST', '/api/auth/register', async c => {
    const label = device(c);
    const r = await U.register(body(c), c.req);
    return { ok: true, ...issue(c, label, r.user), user: { name: r.user.name, role: r.user.role }, recoveryCodes: r.recoveryCodes };
  }, { public: true, limit: 4096 });
  route('POST', '/api/auth/login', async c => {
    const label = device(c);
    const u = await U.login(body(c), c.req);
    return { ok: true, ...issue(c, label, u), user: { name: u.name, role: u.role, mustChange: !!u.mustChange } };
  }, { public: true, limit: 4096 });
  route('POST', '/api/auth/logout', c => {
    if (c.session) { closeClients(cl => cl.session === c.session); endSession(c.session) }
    c.res.setHeader('set-cookie', clearCookie(c.secure));
  });
  route('POST', '/api/auth/password', async c => {
    if (!await U.confirmPassword(c.user.id, body(c).current, c.req)) throw new HttpError(401, 'Current password is wrong');
    const next = U.checkNewPassword(body(c).password, c.user.name);
    await U.setPassword(c.user.id, next);   // every session and device token of this user ends, including this one
    closeClients(cl => cl.userId === c.user.id);
    start(c, c.user.id);
    U.audit(c.user.id, clientIp(c.req), 'password change');
    return { ok: true };
  }, { limit: 4096 });
  route('POST', '/api/auth/recover', async c => {
    const label = device(c);
    const r = await U.recover(body(c), c.req);
    closeClients(cl => cl.userId === r.user.id);   // recovery ended every session and device token
    return { ok: true, ...issue(c, label, r.user), user: { name: r.user.name, role: r.user.role }, recoveryCodes: r.recoveryCodes };
  }, { public: true, limit: 4096 });
  route('POST', '/api/auth/recovery-codes', async c => {
    if (!await U.confirmPassword(c.user.id, body(c).password, c.req)) throw new HttpError(401, 'Wrong password');
    U.audit(c.user.id, clientIp(c.req), 'recovery codes renewed');
    return { recoveryCodes: U.newRecoveryCodes(c.user.id) };
  }, { limit: 4096 });
  route('GET', '/api/auth/sessions', c => listSessions(c.session, c.user));
  route('DELETE', '/api/auth/sessions/:id', c => {
    if (!endSessionById(c.params.id, c.user)) throw new HttpError(404, 'No such session');   // another user's session id answers exactly like a missing one
    closeClients(cl => cl.userId === c.user.id && sessionId(cl.session) === c.params.id);
  });
  route('GET', '/api/auth/devices', c => listDevices(c.session, c.user));
  route('DELETE', '/api/auth/devices/:id', c => {
    if (!endDeviceById(c.params.id, c.user)) throw new HttpError(404, 'No such device');   // a foreign id looks exactly like a missing one
    closeClients(cl => cl.userId === c.user.id && sessionId(cl.session) === c.params.id);
  });

  O.mountOAuth({ device, body, issue, start });   // Google / Apple sign-in (routes answer 404 for a provider that is not configured)

  // Administration needs the admin role AND the admin's password again (step-up). Everyone else sees a 404.
  const admin = async (c: Ctx) => {
    if (c.user.role !== 'admin') throw new HttpError(404, 'Not found');
    if (!await U.confirmPassword(c.user.id, body(c).password, c.req)) throw new HttpError(401, 'Enter your password again to use admin tools');
  };
  route('POST', '/api/admin/invites', async c => {
    await admin(c);
    const b = body(c), code = U.createInvite(c.user.id, { uses: Number(b.uses) || 1, days: Number(b.days) || 7, note: typeof b.note === 'string' ? b.note : '' });
    U.audit(c.user.id, clientIp(c.req), 'invite created');
    return { code };
  }, { limit: 4096 });
  route('POST', '/api/admin/users', async c => { await admin(c); return U.listUsers() }, { limit: 4096 });
}
