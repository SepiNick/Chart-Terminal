// Minimal router + static file server + WebSocket hub. Feature modules call `route()` / `onWs()` at import time;
// index.ts creates the HTTP (127.0.0.1) and optional HTTPS (LAN) servers on top of `handle()` and `upgrade()`.
// Every request resolves to a user (`c.user`) and a database handle that is that user's only (`c.db`).
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import type { DatabaseSync } from 'node:sqlite';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import { WebSocketServer, type WebSocket } from 'ws';
import { authenticate, protocolToken, userOfToken } from './auth.ts';
import { HttpError, bad } from './errors.ts';
import { CORS_ORIGINS, clientIp, isHttps, isPublic } from './mode.ts';
import { limits } from './quota.ts';
import { ANON, userDb, type User } from './userdb.ts';

export { HttpError, bad };
export type { User };

export interface Ctx {
  req: IncomingMessage; res: ServerResponse; url: URL; params: Record<string, string>;
  body: unknown;            // parsed JSON (or Buffer for raw routes)
  secure: boolean;          // request came over HTTPS
  session: string | null;   // session token (null only on public routes)
  bearer: boolean;          // authenticated by a Bearer device token (no cookie, no CSRF check)
  crossSite: boolean;       // device login/register/recover from another origin: the handler must hand out a token, never a cookie
  user: User;               // the caller (ANON on public routes without a session)
  readonly db: DatabaseSync;   // the caller's own database; there is no handle to anyone else's
}
type Handler = (c: Ctx) => unknown | Promise<unknown>;
interface Route { method: string; path: string; re: RegExp; keys: string[]; h: Handler; public: boolean; raw: boolean; limit: number | ((url: URL) => number) }
const routes: Route[] = [];
/** Every registered route (tests: isolation.test.ts fails on a route it has not classified). */
export const routeTable = () => routes.map(r => ({ method: r.method, path: r.path, public: r.public }));

/**
 * Register a route. Path params as `:name` (e.g. '/api/alerts/:id'). Handlers return a JSON-serialisable value
 * (sent as 200 JSON), `undefined` (204), or write to `c.res` themselves and return `RAW`.
 * opts.public: no session needed. opts.raw: body is a Buffer (uploads). opts.limit: max body bytes (default 2 MB, 256 KB in public mode).
 */
export function route(method: string, path: string, h: Handler, opts: { public?: boolean; raw?: boolean; limit?: number | ((url: URL) => number) } = {}) {
  const keys: string[] = [];
  const re = new RegExp('^' + path.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)' }) + '$');
  routes.push({ method, path, re, keys, h, public: !!opts.public, raw: !!opts.raw, limit: opts.limit ?? (isPublic ? 256 * 1024 : 2 * 1024 * 1024) });
}
export const RAW = Symbol('raw');

function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  // Listeners, not `for await`: leaving an async iterator early destroys the socket before the 413 can be sent.
  return new Promise((resolve, reject) => {
    const parts: Buffer[] = []; let n = 0, over = false;
    req.on('data', (chunk: Buffer) => {
      if (over) return;   // keep draining what the client still sends; the response closes the connection
      n += chunk.length;
      if (n > limit) { over = true; parts.length = 0; reject(new HttpError(413, 'Body too large')) } else parts.push(chunk);
    });
    req.on('end', () => { clearTimeout(timer); if (!over) resolve(Buffer.concat(parts)) });
    req.on('error', e => { clearTimeout(timer); reject(e) });
    // A body that trickles in must not hold its budget reservation forever (slow-body attack).
    const timer = setTimeout(() => { over = true; parts.length = 0; reject(Object.assign(new HttpError(408, 'Request body took too long'), { closeConn: true })); req.destroy() }, isPublic ? 30_000 : 10 * 60_000);
    timer.unref();
  });
}

// CT_DIST_DIR: the desktop app bundles the server, so the built client isn't at ../../dist there.
const DIST = process.env.CT_DIST_DIR ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist');
const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.crt': 'application/x-x509-ca-cert', '.mobileconfig': 'application/x-apple-aspen-config' };
const SECURITY_HEADERS: Record<string, string> = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY', ...(isPublic ? { 'permissions-policy': 'camera=(), geolocation=(), payment=(), usb=(), microphone=(self)' } : {}) };

/** Serve the built app (dist/) with an SPA fallback, for phones/other devices that don't go through Vite. */
// The page needs 'unsafe-eval' (the MQL/Ninja/Pine compilers use new Function) and inline styles; everything else is same-origin
// except the Binance public market-data hosts the client reads directly. Applied to the HTML only.
const CSP = "default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https://data-api.binance.vision wss://data-stream.binance.vision; worker-src 'self' blob:; manifest-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
function serveStatic(c: Ctx): boolean {
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') return false;
  let p: string; try { p = normalize(decodeURIComponent(c.url.pathname)) } catch { throw new HttpError(400, 'Bad path') }
  p = p.replace(/^([/\\])+/, '');
  if (p.includes('..')) return false;
  let file = join(DIST, p);
  const missing = !p || !existsSync(file) || statSync(file).isDirectory();
  if (missing && isPublic && /\.\w+$/.test(p)) return false;   // a missing file (/ca.crt, /x.js) is a 404, not the app shell
  if (missing) file = join(DIST, 'index.html');
  if (!existsSync(file)) return false;
  const type = MIME[extname(file)] ?? 'application/octet-stream';
  // Only Vite's content-hashed files under /assets are immutable; the manifest, icons and sw.js must revalidate.
  c.res.writeHead(200, { 'content-type': type, 'cache-control': /[\\/]assets[\\/]/.test(file) ? 'public, max-age=31536000, immutable' : 'no-cache', ...SECURITY_HEADERS, ...(type.startsWith('text/html') ? { 'content-security-policy': CSP } : {}) });
  createReadStream(file).pipe(c.res);
  return true;
}

// ---------- rate limits (public mode): token buckets in memory ----------
const buckets = new Map<string, { t: number; at: number }>();
/** 0 when allowed, else the seconds to wait. */
function take(key: string, rate: number, burst: number): number {
  if (!Number.isFinite(rate)) return 0;
  const now = Date.now(), b = buckets.get(key) ?? { t: burst, at: now };
  b.t = Math.min(burst, b.t + (now - b.at) / 1000 * rate); b.at = now;
  buckets.set(key, b);
  if (b.t >= 1) { b.t--; return 0 }
  return Math.ceil((1 - b.t) / rate);
}
if (isPublic) setInterval(() => { const old = Date.now() - 120_000; for (const [k, b] of buckets) if (b.at < old) buckets.delete(k) }, 60_000).unref();
const inflight = new Map<number, number>();
// Bytes of request bodies being received right now (public mode): each upload reserves what it declares, or its route limit.
const BUDGET = (Number(process.env.CT_BODY_BUDGET_MB) || 64) * 1024 * 1024;
let inBytes = 0;
const inBytesBy = new Map<string, number>();   // per principal: one account or address may hold at most a quarter of the budget
const MUST_CHANGE_OK = new Set(['/api/auth/password', '/api/auth/logout']);
const DEVICE_AUTH = new Set(['/api/auth/login', '/api/auth/register', '/api/auth/recover']);
const slow = (s: number, msg: string) => Object.assign(new HttpError(429, msg), { retryAfter: s });

/** CSRF. Private: a request with an Origin must match Host (curl, tests and the app send none or a matching one). Public: browsers only. */
export function csrfOk(req: IncomingMessage): boolean {
  if (!isPublic) return sameOrigin(req);
  const o = req.headers.origin, fetchSite = req.headers['sec-fetch-site'];
  const origin = o ? sameOrigin(req) : fetchSite === 'same-origin';
  return origin && /^[\w-]{8,64}$/.test(String(req.headers['x-ct-client'] ?? ''));   // a cross-site form cannot set this header
}

export async function handle(req: IncomingMessage, res: ServerResponse, listenerSecure: boolean) {
  const url = new URL(req.url ?? '/', 'http://local');
  const secure = isHttps(req, listenerSecure);
  const c: Ctx = { req, res, url, params: {}, body: undefined, secure, session: null, bearer: false, crossSite: false, user: ANON, get db() { return userDb(this.user.id) } };
  const ip = clientIp(req);
  let counted = 0;
  try {
    if (!allowedHost(req, url.pathname)) throw new HttpError(421, 'Unknown host');
    // CORS (off unless CT_CORS_ORIGINS): only the exact listed origin is echoed, never credentials (cookies do not cross origins).
    if (CORS_ORIGINS.size) {
      res.setHeader('vary', 'Origin');
      const o = req.headers.origin;
      if (typeof o === 'string' && CORS_ORIGINS.has(o)) {
        res.setHeader('access-control-allow-origin', o);
        res.setHeader('access-control-expose-headers', 'retry-after');
        if (req.method === 'OPTIONS') {
          res.writeHead(204, { 'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS', 'access-control-allow-headers': 'authorization, content-type, x-ct-client', 'access-control-max-age': '600', ...SECURITY_HEADERS }).end();
          return;
        }
      }
    }
    const r = routes.find(x => x.method === req.method && x.re.test(url.pathname));
    if (!r) {
      if (url.pathname.startsWith('/api/')) throw new HttpError(404, 'Not found');
      if (serveStatic(c)) return;
      throw new HttpError(404, 'Not found');
    }
    const a = authenticate(req, secure);
    if (a) { c.session = a.token; c.user = a.user; c.bearer = a.bearer }
    if (isPublic && (!a || r.public)) {   // anonymous callers: per-IP bucket, and a stricter one for the login/register family
      const w = take('ip:' + ip, 5, 30) || (url.pathname.startsWith('/api/auth/') ? take('auth:' + ip, 1, 60) : 0);
      if (w) throw slow(w, 'Too many requests');
    }
    if (!r.public && !a) throw new HttpError(401, 'Login required');
    // CSRF: state-changing requests must come from our own pages (cookies are SameSite=Strict too).
    // A Bearer header cannot be sent by a cross-site form, so token requests skip the Origin check but still need x-ct-client.
    const xct = /^[\w-]{8,64}$/.test(String(req.headers['x-ct-client'] ?? ''));
    if (a?.bearer && !xct) throw new HttpError(403, 'Missing client header');
    if (req.method !== 'GET' && req.method !== 'HEAD' && !a?.bearer && !csrfOk(req)) {
      // The one cross-origin door: device login/register/recover from a listed origin (or a non-browser client). The handler refuses it without `device`.
      const o = req.headers.origin;
      const ok = req.method === 'POST' && DEVICE_AUTH.has(url.pathname) && xct && (typeof o === 'string' ? CORS_ORIGINS.has(o) : !req.headers['sec-fetch-site']);
      if (!ok) throw new HttpError(403, 'Cross-site request blocked');
      c.crossSite = true;
    }
    if (a?.user.mustChange && !MUST_CHANGE_OK.has(url.pathname) && !r.public) throw Object.assign(new HttpError(403, 'Change your password first'), { code: 'must_change' });
    if (isPublic && a) {
      const L = limits(a.user.id), w = take('u:' + a.user.id, L.rps, L.burst);
      if (w) throw slow(w, 'Too many requests, slow down');
      if ((inflight.get(a.user.id) ?? 0) >= L.inflight) throw slow(1, 'Too many requests in progress');
      inflight.set(a.user.id, (inflight.get(a.user.id) ?? 0) + 1); counted = a.user.id;
    }
    const m = url.pathname.match(r.re)!;
    r.keys.forEach((k, i) => (c.params[k] = decodeURIComponent(m[i + 1])));
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const limit = typeof r.limit === 'function' ? r.limit(url) : r.limit;
      let held = 0, heldBy = '';
      if (isPublic) {   // refuse by the declared size before reading a byte, and keep a global budget for bodies in flight
        const declared = req.headers['content-length'] === undefined ? NaN : Number(req.headers['content-length']);
        if (declared > limit) throw Object.assign(new HttpError(413, 'Body too large'), { closeConn: true });
        held = Number.isFinite(declared) ? declared : limit;
        const who = c.user.id > 0 ? `u${c.user.id}` : `ip${ip}`, mine = inBytesBy.get(who) ?? 0;
        if (inBytes + held > BUDGET || mine + held > BUDGET / 4) throw Object.assign(new HttpError(503, 'The server is busy receiving other uploads. Try again in a moment'), { retryAfter: 2, closeConn: true });
        inBytes += held; inBytesBy.set(who, mine + held); heldBy = who;
      }
      try {
        const buf = await readBody(req, limit);
        c.body = r.raw ? buf : buf.length ? JSON.parse(buf.toString('utf8')) : undefined;
      } finally { inBytes -= held; if (heldBy) { const left = (inBytesBy.get(heldBy) ?? 0) - held; left > 0 ? inBytesBy.set(heldBy, left) : inBytesBy.delete(heldBy) } }
    }
    const out = await r.h(c);
    if (out === RAW) return;
    if (out === undefined) { res.writeHead(204, SECURITY_HEADERS).end(); return }
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store', ...SECURITY_HEADERS }).end(JSON.stringify(out));
  } catch (e) {
    const err = e as Error & { errcode?: number; code?: string; retryAfter?: number; closeConn?: boolean };
    const full = err.errcode === 13;   // SQLITE_FULL: the user's file hit its size ceiling
    const status = e instanceof HttpError ? e.status : e instanceof SyntaxError || e instanceof URIError ? 400 : full ? 413 : isPublic ? 500 : 502;
    // Public servers do not echo internal error text (paths, SQL); HttpErrors are written for users and pass through.
    const msg = e instanceof HttpError || e instanceof SyntaxError || e instanceof URIError || !isPublic ? err.message : full ? 'Your storage is full' : 'Internal error';
    if (isPublic && !(e instanceof HttpError || e instanceof URIError || e instanceof SyntaxError)) console.error(`[http] ${req.method} ${url.pathname}: ${String(err.message).replace(/\s+/g, ' ').slice(0, 300)}`);
    const send = () => {
      if (!res.headersSent) res.writeHead(status, { 'content-type': 'application/json', ...(err.retryAfter ? { 'retry-after': String(err.retryAfter) } : {}), ...SECURITY_HEADERS }).end(JSON.stringify({ error: msg, ...(err.code === 'must_change' ? { code: 'must_change' } : {}), ...(e instanceof HttpError ? e.extra : {}) }));
      else res.end();
    };
    // After a 413 the rest of the body is still arriving (readBody drains it). Answer once it has, or the client gets a
    // connection reset instead of the 413; a client that keeps sending is cut off after 5 s.
    if (err.closeConn) { send(); req.resume(); setTimeout(() => req.destroy(), 2000).unref() }   // refused unread: do not wait for the rest of the body
    else if (status === 413 && !req.readableEnded) {
      const t = setTimeout(() => { res.setHeader('connection', 'close'); send(); req.destroy() }, 5000);
      req.once('end', () => { clearTimeout(t); send() });
    } else send();
  } finally { if (counted) inflight.set(counted, Math.max(0, (inflight.get(counted) ?? 1) - 1)) }
}
export function sameOrigin(req: IncomingMessage) {
  const o = req.headers.origin; if (!o) return true;   // non-browser clients (curl, tests) send no Origin
  try { return new URL(o).host === req.headers.host } catch { return false }
}

/**
 * DNS-rebinding guard: a hostile page can point its own domain at 127.0.0.1 and then talk to us "same-origin".
 * Only accept Host names we actually serve: loopback names, this machine's own IPs (LAN access), and names listed in
 * CT_ALLOWED_HOSTS (comma-separated, e.g. the VPS domain later). Public mode accepts CT_ALLOWED_HOSTS only (plus
 * loopback for the container health check).
 */
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
let ownIps = new Set<string>(), ownIpsAt = 0;
function machineIps() {
  if (Date.now() - ownIpsAt > 60_000) {   // interfaces change (Wi-Fi reconnects); refresh at most once a minute
    ownIps = new Set(Object.values(networkInterfaces()).flat().filter(Boolean).map(i => (i!.family === 'IPv6' ? `[${i!.address}]` : i!.address)));
    ownIpsAt = Date.now();
  }
  return ownIps;
}
const extraHosts = () => new Set((process.env.CT_ALLOWED_HOSTS ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean));
export const hostName = (req: IncomingMessage) => String(req.headers.host ?? '').toLowerCase().replace(/:\d+$/, '');
export const isLoopbackHost = (req: IncomingMessage) => LOOPBACK.has(hostName(req));
export function allowedHost(req: IncomingMessage, path = '') {
  const h = hostName(req);
  if (isPublic) return extraHosts().has(h) || (path === '/api/health' && LOOPBACK.has(h));
  return LOOPBACK.has(h) || machineIps().has(h) || extraHosts().has(h);
}

// ---------- WebSocket hub: one socket per client, typed messages ----------
export interface WsClient { ws: WebSocket; session: string; userId: number; send: (msg: unknown) => void; data: Map<string, unknown> }
type WsHandler = (client: WsClient, msg: Record<string, unknown>) => void;
const wsHandlers = new Map<string, WsHandler>();   // keyed by msg.op
const closeHandlers: ((c: WsClient) => void)[] = [];
export const clients = new Set<WsClient>();
/** Handle client messages with `{ op: <op>, ... }`. */
export function onWs(op: string, h: WsHandler) { wsHandlers.set(op, h) }
export function onWsClose(h: (c: WsClient) => void) { closeHandlers.push(h) }
/** Send to every socket of one user (private mode: all sockets belong to the single user). There is deliberately no send-to-everyone. */
export function broadcastTo(userId: number, msg: unknown, except?: WsClient) {
  const s = JSON.stringify(msg);
  for (const c of clients) if (c !== except && c.ws.readyState === 1 && (!isPublic || c.userId === userId)) c.ws.send(s);
}
/** Close sockets matching `pred` (sign-out, password change, disabled account). */
export function closeClients(pred: (c: WsClient) => boolean, code = 4001, reason = 'Signed out') { for (const c of clients) if (pred(c)) c.ws.close(code, reason) }

const wss = new WebSocketServer({ noServer: true, handleProtocols: ps => [...ps].find(p => p.startsWith('ct.')) ?? false, maxPayload: isPublic ? 1024 : 1024 * 1024 });
export function upgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
  if (!req.url?.startsWith('/ws') || !allowedHost(req)) { socket.destroy(); return }
  const a = authenticate(req, isHttps(req, false), protocolToken(req));   // token: subprotocol `ct.<token>`, never a query string
  // Cookie auth keeps the Origin check (cross-site WebSocket hijacking); a token cannot be sent by a foreign page on its own.
  if (!a?.bearer && (!sameOrigin(req) || (isPublic && !req.headers.origin))) { socket.destroy(); return }   // browsers always send Origin
  if (!a) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return }
  if (isPublic) {
    const mine = [...clients].filter(x => x.userId === a.user.id).length;
    if (mine >= limits(a.user.id).sockets) { socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n'); socket.destroy(); return }
    if (a.user.mustChange) { socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy(); return }
  }
  wss.handleUpgrade(req, socket, head, ws => {
    const client: WsClient = { ws, session: a.token, userId: a.user.id, data: new Map(), send: m => { if (ws.readyState === 1) ws.send(JSON.stringify(m)) } };
    clients.add(client);
    const L = limits(a.user.id), bucket = 'ws:' + Math.random();
    ws.on('message', raw => {
      if (isPublic && take(bucket, L.wsMsgPerSec, L.wsMsgPerSec * 2)) { ws.close(1008, 'Too many messages'); return }
      let m: Record<string, unknown>;
      try { m = JSON.parse(String(raw)) } catch { return }
      const h = wsHandlers.get(String(m.op ?? ''));   // market data uses 'sub'/'unsub'; feature modules use 'module.action'
      try { h?.(client, m) } catch (e) { client.send({ type: 'error', msg: (e as Error).message }) }
    });
    ws.on('close', () => { clients.delete(client); closeHandlers.forEach(h => h(client)) });
  });
}
/** Public mode: sockets whose session ended elsewhere (expired, account disabled or deleted by the CLI) are closed. */
if (isPublic) setInterval(() => { for (const c of clients) if (!userOfToken(c.session)) c.ws.close(4001, 'Signed out') }, 30_000).unref();
