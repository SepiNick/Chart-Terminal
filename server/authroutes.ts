// Login API. First run: the password can only be set from this PC (localhost), so nobody on the LAN can claim the server.
//   GET  /api/auth/status   → { setup: boolean, loggedIn: boolean }          (public)
//   POST /api/auth/setup    { password }           → sets the first password (localhost only, once)
//   POST /api/auth/login    { password }           → session cookie (5 failures → growing lockout per IP)
//   POST /api/auth/logout
//   POST /api/auth/password { current, password }  → signs out every device
//   GET  /api/auth/sessions → [{ id, created, last_seen, agent, ip, current }]
//   DELETE /api/auth/sessions/:id → signs that one device out (its open socket is closed too)
import { HttpError, bad, clients, isLoopbackHost, route } from './core/http.ts';
import { checkPassword, clearCookie, clientIp, createSession, endSession, endSessionById, hasPassword, listSessions, sessionId, loginBlocked, loginFailed, loginOk, sessionCookie, sessionOf, setPassword } from './core/auth.ts';

const isLocal = (ip: string) => ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
const pw = (b: unknown, k = 'password') => { const v = (b as Record<string, unknown> | undefined)?.[k]; if (typeof v !== 'string' || !v) throw bad('Password required'); return v };

route('GET', '/api/auth/status', c => ({ setup: !hasPassword(), loggedIn: !!sessionOf(c.req) }), { public: true });
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
  for (const cl of clients) if (sessionId(cl.session) === c.params.id) cl.ws.close(4001, 'Signed out');
});
