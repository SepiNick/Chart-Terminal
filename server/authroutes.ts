// Login API.
// Private server (one password; first run: it can only be set from this PC, so nobody on the LAN can claim the server):
//   GET  /api/auth/status   → { setup: boolean, loggedIn: boolean, mode: 'private' }          (public)
//   POST /api/auth/setup    { password }           → sets the first password (localhost only, once)
//   POST /api/auth/login    { password }           → session cookie (5 failures → growing lockout per IP)
//   POST /api/auth/logout
//   POST /api/auth/password { current, password }  → signs out every device
//   GET  /api/auth/sessions → [{ id, created, last_seen, agent, ip, current }]
//   DELETE /api/auth/sessions/:id → signs that one device out (its open socket is closed too)
// Public server (accounts; docs/research/multiuser-design.md §2):
//   GET  /api/auth/status   → { mode: 'public', registration, loggedIn, user?, features }  (public)
//   POST /api/auth/register { name, password, invite? } → account + 8 recovery codes (shown once) + session cookie
//   POST /api/auth/login    { name, password }     → session cookie (three-layer throttle, uniform error)
//   POST /api/auth/logout · POST /api/auth/password { current, password } · POST /api/auth/recover { name, code, newPassword }
//   POST /api/auth/recovery-codes { password } → a fresh set of 8 (the old ones stop working)
//   GET /api/auth/sessions · DELETE /api/auth/sessions/:id   (only the caller's own)
//   POST /api/admin/invites { password, uses?, days?, note? } · GET /api/admin/users   (admins; others get a 404)
import { HttpError, bad, closeClients, isLoopbackHost, route, type Ctx } from './core/http.ts';
import { checkPassword, clearCookie, clientIp, createSession, endSession, endSessionById, hasPassword, listSessions, sessionId, loginBlocked, loginFailed, loginOk, sessionCookie, sessionOf, setPassword } from './core/auth.ts';
import { REGISTRATION, isPublic } from './core/mode.ts';

const pw = (b: unknown, k = 'password') => { const v = (b as Record<string, unknown> | undefined)?.[k]; if (typeof v !== 'string' || !v) throw bad('Password required'); return v };
const body = (c: Ctx) => ((c.body && typeof c.body === 'object' && !Array.isArray(c.body)) ? c.body : {}) as Record<string, unknown>;

if (!isPublic) {
  const isLocal = (ip: string) => ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  route('GET', '/api/auth/status', c => ({ setup: !hasPassword(), loggedIn: !!sessionOf(c.req, c.secure), mode: 'private' }), { public: true });
  route('POST', '/api/auth/setup', c => {
    if (hasPassword()) throw new HttpError(409, 'Already set up');
    // Loopback address AND loopback Host name: a rebinding page can't claim the server before the owner does.
    if (!isLocal(clientIp(c.req)) || !isLoopbackHost(c.req)) throw new HttpError(403, 'Set the first password from the computer running the server');
    setPassword(pw(c.body));
    c.res.setHeader('set-cookie', sessionCookie(createSession(c.req), c.secure));
    return { ok: true };
  }, { public: true, limit: 4096 });
  route('POST', '/api/auth/login', c => {
    const ip = clientIp(c.req), wait = loginBlocked(ip);
    if (wait) throw new HttpError(429, `Too many attempts — try again in ${wait} s`);
    if (!checkPassword(pw(c.body))) { loginFailed(ip); throw new HttpError(401, 'Wrong password') }
    loginOk(ip);
    c.res.setHeader('set-cookie', sessionCookie(createSession(c.req), c.secure));
    return { ok: true };
  }, { public: true, limit: 4096 });
  route('POST', '/api/auth/logout', c => { if (c.session) endSession(c.session); c.res.setHeader('set-cookie', clearCookie(c.secure)) });
  route('POST', '/api/auth/password', c => {
    if (!checkPassword(pw(c.body, 'current'))) throw new HttpError(401, 'Current password is wrong');
    setPassword(pw(c.body));
    c.res.setHeader('set-cookie', sessionCookie(createSession(c.req), c.secure));
    return { ok: true };
  }, { limit: 4096 });
  route('GET', '/api/auth/sessions', c => listSessions(c.session));
  route('DELETE', '/api/auth/sessions/:id', c => {
    if (!endSessionById(c.params.id)) throw new HttpError(404, 'No such session');
    closeClients(cl => sessionId(cl.session) === c.params.id, 4001, 'Signed out');
  });
} else {
  const U = await import('./core/users.ts');
  const FEATURES = { brokers: false, forward: false, scriptAlerts: false, recorder: false, ai: false, ml: false, lan: false, telegram: false, email: false, webhook: false };
  const start = (c: Ctx, userId: number) => {   // always a brand-new token: a cookie sent by the client is never adopted (no session fixation)
    if (c.session) endSession(c.session);
    c.res.setHeader('set-cookie', sessionCookie(createSession(c.req, { id: userId, name: '', role: 'user' }), c.secure));
  };
  route('GET', '/api/auth/status', c => {
    const s = sessionOf(c.req, c.secure), u = s ? U.sessionUser(s) : null;
    return { setup: false, mode: 'public', registration: REGISTRATION, loggedIn: !!u, ...(u ? { user: { name: u.name, role: u.role, mustChange: !!u.mustChange } } : {}), features: FEATURES };
  }, { public: true });
  route('POST', '/api/auth/register', async c => {
    const r = await U.register(body(c), c.req);
    start(c, r.user.id);
    return { ok: true, user: { name: r.user.name, role: r.user.role }, recoveryCodes: r.recoveryCodes };
  }, { public: true, limit: 4096 });
  route('POST', '/api/auth/login', async c => {
    const u = await U.login(body(c), c.req);
    start(c, u.id);
    return { ok: true, user: { name: u.name, role: u.role, mustChange: !!u.mustChange } };
  }, { public: true, limit: 4096 });
  route('POST', '/api/auth/logout', c => {
    if (c.session) { closeClients(cl => cl.session === c.session); endSession(c.session) }
    c.res.setHeader('set-cookie', clearCookie(c.secure));
  });
  route('POST', '/api/auth/password', async c => {
    if (!await U.confirmPassword(c.user.id, body(c).current)) throw new HttpError(401, 'Current password is wrong');
    const next = U.checkNewPassword(body(c).password, c.user.name);
    await U.setPassword(c.user.id, next);   // every session of this user ends, including this one
    closeClients(cl => cl.userId === c.user.id);
    start(c, c.user.id);
    U.audit(c.user.id, clientIp(c.req), 'password change');
    return { ok: true };
  }, { limit: 4096 });
  route('POST', '/api/auth/recover', async c => {
    const r = await U.recover(body(c), c.req);
    closeClients(cl => cl.userId === r.user.id);
    start(c, r.user.id);
    return { ok: true, recoveryCodes: r.recoveryCodes };
  }, { public: true, limit: 4096 });
  route('POST', '/api/auth/recovery-codes', async c => {
    if (!await U.confirmPassword(c.user.id, body(c).password)) throw new HttpError(401, 'Wrong password');
    U.audit(c.user.id, clientIp(c.req), 'recovery codes renewed');
    return { recoveryCodes: U.newRecoveryCodes(c.user.id) };
  }, { limit: 4096 });
  route('GET', '/api/auth/sessions', c => listSessions(c.session, c.user));
  route('DELETE', '/api/auth/sessions/:id', c => {
    if (!endSessionById(c.params.id, c.user)) throw new HttpError(404, 'No such session');   // another user's session id answers exactly like a missing one
    closeClients(cl => cl.userId === c.user.id && sessionId(cl.session) === c.params.id);
  });

  // Administration needs the admin role AND the admin's password again (step-up). Everyone else sees a 404.
  const admin = async (c: Ctx) => {
    if (c.user.role !== 'admin') throw new HttpError(404, 'Not found');
    if (!await U.confirmPassword(c.user.id, body(c).password)) throw new HttpError(401, 'Enter your password again to use admin tools');
  };
  route('POST', '/api/admin/invites', async c => {
    await admin(c);
    const b = body(c), code = U.createInvite(c.user.id, { uses: Number(b.uses) || 1, days: Number(b.days) || 7, note: typeof b.note === 'string' ? b.note : '' });
    U.audit(c.user.id, clientIp(c.req), 'invite created');
    return { code };
  }, { limit: 4096 });
  route('POST', '/api/admin/users', async c => { await admin(c); return U.listUsers() }, { limit: 4096 });
}
