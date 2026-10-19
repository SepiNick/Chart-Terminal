// Login API. First run: the password can only be set from this PC (localhost), so nobody on the LAN can claim the server.
//   GET  /api/auth/status   → { setup: boolean, loggedIn: boolean }          (public)
//   POST /api/auth/setup    { password }           → sets the first password (localhost only, once)
//   POST /api/auth/login    { password }           → session cookie (5 failures → growing lockout per IP)
//   POST /api/auth/logout
//   POST /api/auth/password { current, password }  → signs out every device
//   GET  /api/auth/sessions → [{ created, last_seen, agent, ip }]
import { HttpError, bad, route } from './core/http.ts';
import { checkPassword, clearCookie, clientIp, createSession, endSession, hasPassword, listSessions, loginBlocked, loginFailed, loginOk, sessionCookie, sessionOf, setPassword } from './core/auth.ts';

const isLocal = (ip: string) => ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
const pw = (b: unknown, k = 'password') => { const v = (b as Record<string, unknown> | undefined)?.[k]; if (typeof v !== 'string' || !v) throw bad('Password required'); return v };

route('GET', '/api/auth/status', c => ({ setup: !hasPassword(), loggedIn: !!sessionOf(c.req) }), { public: true });
route('POST', '/api/auth/setup', c => {
  if (hasPassword()) throw new HttpError(409, 'Already set up');
  if (!isLocal(clientIp(c.req))) throw new HttpError(403, 'Set the first password from the computer running the server');
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
route('GET', '/api/auth/sessions', () => listSessions());
