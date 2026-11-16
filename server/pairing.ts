// Pair a phone by QR code (or by typing the code). Docs: docs/pairing.md.
//   POST /api/auth/pair/start  (signed in)             → { code, expires, url, urls, qrSvg, payload }
//        code: 10 characters, unambiguous alphabet (no 0/O/1/I), 50 bits, single use, valid 5 min, at most 5 pending per user (the oldest is dropped).
//        payload (what the QR encodes): chartterminal://pair?c=<code>&n=<server name>&u=<url1>&u=<url2>   (https first, every LAN address)
//   POST /api/auth/pair/redeem { code, device }  (no session; per-address failure limit) → { ok, token, user }, exactly like a device login.
// The pairing is started from a session that already passed the password (and 2FA), so redeeming needs no second factor. The new device is an
// ordinary device token: it shows in GET /api/auth/devices and DELETE /api/auth/devices/:id signs it out.
import { createHash, randomInt } from 'node:crypto';
import { HttpError, route, type Ctx } from './core/http.ts';
import { clientIp, createDevice } from './core/auth.ts';
import { HOST, SERVER_NAME, isPublic, publicUrl } from './core/mode.ts';
import type { User } from './core/userdb.ts';
import { qrCapacity, qrSvg } from './core/qrsvg.ts';
import { addrKey, failGate } from './core/failgate.ts';
import { broadcastTargets, lanHttpsPort, lanUrls } from './discovery.ts';
import { deviceLabel } from './twofa.ts';

const U = isPublic ? await import('./core/users.ts') : null;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', TTL = 5 * 60_000, MAX_PENDING = 5;
interface Pending { user: User; exp: number }
const pending = new Map<string, Pending>();   // sha256(code) → who started it
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const norm = (s: unknown) => (typeof s === 'string' ? s.toUpperCase().replace(/[\s-]/g, '') : '');
const gate = failGate(8, 10 * 60_000, 10 * 60_000);

/** Every address the phone could reach this server at: LAN https and http, then the public URL. Falls back to the origin of this very request. */
function urlsFor(c: Ctx): string[] {
  const list = [
    ...(isPublic ? [] : lanUrls({ ips: broadcastTargets().map(t => t.ip), httpsPort: lanHttpsPort(), host: HOST, httpPort: Number(process.env.PORT ?? 8787) })),
    ...(publicUrl() ? [publicUrl()!.origin] : []),
  ];
  if (!list.length) list.push(`${c.secure ? 'https' : 'http'}://${c.req.headers.host ?? 'localhost'}`);
  const all = [...new Set(list)], routable = all.filter(u => !/^https?:\/\/169\.254\./.test(u));   // link-local addresses are useless to a phone
  return (routable.length ? routable : all).sort((a, b) => +b.startsWith('https') - +a.startsWith('https'));
}
const esc = (s: string) => encodeURIComponent(s).replace(/%3A/g, ':').replace(/%2F/g, '/');   // ':' and '/' are legal in a query and save QR space
/** The payload, shortened (extra URLs first, then the name) until the QR can carry it. */
function payloadFor(code: string, name: string, urls: string[]): string {
  const make = (n: string, u: string[]) => `chartterminal://pair?c=${code}${n ? '&n=' + esc(n) : ''}${u.map(x => '&u=' + esc(x)).join('')}`;
  let u = urls, n = name;
  while (Buffer.byteLength(make(n, u)) > qrCapacity && u.length > 1) u = u.slice(0, -1);
  while (Buffer.byteLength(make(n, u)) > qrCapacity && n) n = n.slice(0, -4).trimEnd();
  return make(n, u);
}
const sweep = () => { const t = Date.now(); for (const [k, v] of pending) if (v.exp < t) pending.delete(k) };

route('POST', '/api/auth/pair/start', c => {
  sweep();
  if (pending.size >= 2000) throw Object.assign(new HttpError(429, 'Too many pairing codes in progress'), { retryAfter: 30 });
  const mine = [...pending].filter(([, v]) => v.user.id === c.user.id);
  while (mine.length >= MAX_PENDING) pending.delete(mine.shift()![0]);   // Map keeps insertion order: the oldest goes
  const code = Array.from({ length: 10 }, () => ALPHABET[randomInt(32)]).join(''), exp = Date.now() + TTL, urls = urlsFor(c);
  pending.set(sha(code), { user: { id: c.user.id, name: c.user.name, role: c.user.role }, exp });
  U?.audit(c.user.id, clientIp(c.req), 'pair start');
  const payload = payloadFor(code, SERVER_NAME, urls);
  return { code, expires: exp, url: urls[0], urls, qrSvg: qrSvg(payload), payload };
});

route('POST', '/api/auth/pair/redeem', c => {
  const b = (c.body && typeof c.body === 'object' ? c.body : {}) as Record<string, unknown>;
  const label = deviceLabel(c, true), ip = addrKey(clientIp(c.req)), wait = gate.wait(ip);
  if (wait) throw Object.assign(new HttpError(429, `Too many attempts. Try again in ${wait} s`), { retryAfter: wait });
  const key = sha(norm(b.code)), p = pending.get(key);
  if (!p || p.exp < Date.now() || (U && !U.isActive(p.user.id))) {
    gate.fail(ip); pending.delete(key); U?.audit(null, clientIp(c.req), 'pair redeem fail');
    throw new HttpError(401, 'Invalid or expired pairing code');
  }
  pending.delete(key);   // single use: gone before anything else can happen
  try {
    const token = createDevice(c.req, label!, p.user);
    U?.audit(p.user.id, clientIp(c.req), 'pair redeem');
    return { ok: true, token, user: { name: p.user.name, role: p.user.role } };
  } catch (e) { pending.set(key, p); throw e }   // e.g. the device limit: the code stays valid so the user can free a slot and retry
}, { public: true, limit: 4096 });
