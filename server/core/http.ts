// Minimal router + static file server + WebSocket hub. Feature modules call `route()` / `onWs()` at import time;
// index.ts creates the HTTP (127.0.0.1) and optional HTTPS (LAN) servers on top of `handle()` and `upgrade()`.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import { WebSocketServer, type WebSocket } from 'ws';
import { sessionOf } from './auth.ts';

export class HttpError extends Error { status: number; constructor(status: number, msg: string) { super(msg); this.status = status } }
export const bad = (msg: string) => new HttpError(400, msg);

export interface Ctx {
  req: IncomingMessage; res: ServerResponse; url: URL; params: Record<string, string>;
  body: unknown;            // parsed JSON (or Buffer for raw routes)
  secure: boolean;          // request came over HTTPS
  session: string | null;   // session token (null only on public routes)
}
type Handler = (c: Ctx) => unknown | Promise<unknown>;
interface Route { method: string; re: RegExp; keys: string[]; h: Handler; public: boolean; raw: boolean; limit: number }
const routes: Route[] = [];

/**
 * Register a route. Path params as `:name` (e.g. '/api/alerts/:id'). Handlers return a JSON-serialisable value
 * (sent as 200 JSON), `undefined` (204), or write to `c.res` themselves and return `RAW`.
 * opts.public: no session needed. opts.raw: body is a Buffer (uploads). opts.limit: max body bytes (default 2 MB).
 */
export function route(method: string, path: string, h: Handler, opts: { public?: boolean; raw?: boolean; limit?: number } = {}) {
  const keys: string[] = [];
  const re = new RegExp('^' + path.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)' }) + '$');
  routes.push({ method, re, keys, h, public: !!opts.public, raw: !!opts.raw, limit: opts.limit ?? 2 * 1024 * 1024 });
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
    req.on('end', () => { if (!over) resolve(Buffer.concat(parts)) });
    req.on('error', reject);
  });
}

const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist');
const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.crt': 'application/x-x509-ca-cert', '.mobileconfig': 'application/x-apple-aspen-config' };
const SECURITY_HEADERS = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY' };

/** Serve the built app (dist/) with an SPA fallback, for phones/other devices that don't go through Vite. */
function serveStatic(c: Ctx): boolean {
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') return false;
  let p = normalize(decodeURIComponent(c.url.pathname)).replace(/^([/\\])+/, '');
  if (p.includes('..')) return false;
  let file = join(DIST, p);
  if (!p || !existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
  if (!existsSync(file)) return false;
  const type = MIME[extname(file)] ?? 'application/octet-stream';
  // Only Vite's content-hashed files under /assets are immutable; the manifest, icons and sw.js must revalidate.
  c.res.writeHead(200, { 'content-type': type, 'cache-control': /[\\/]assets[\\/]/.test(file) ? 'public, max-age=31536000, immutable' : 'no-cache', ...SECURITY_HEADERS });
  createReadStream(file).pipe(c.res);
  return true;
}

export async function handle(req: IncomingMessage, res: ServerResponse, secure: boolean) {
  const url = new URL(req.url ?? '/', 'http://local');
  const c: Ctx = { req, res, url, params: {}, body: undefined, secure, session: null };
  try {
    if (!allowedHost(req)) throw new HttpError(421, 'Unknown host');
    const r = routes.find(x => x.method === req.method && x.re.test(url.pathname));
    if (!r) {
      if (url.pathname.startsWith('/api/')) throw new HttpError(404, 'Not found');
      if (serveStatic(c)) return;
      throw new HttpError(404, 'Not found');
    }
    if (!r.public) { c.session = sessionOf(req); if (!c.session) throw new HttpError(401, 'Login required') }
    // CSRF: state-changing requests must come from our own pages (cookies are SameSite=Strict too).
    if (req.method !== 'GET' && req.method !== 'HEAD' && !sameOrigin(req)) throw new HttpError(403, 'Cross-site request blocked');
    const m = url.pathname.match(r.re)!;
    r.keys.forEach((k, i) => (c.params[k] = decodeURIComponent(m[i + 1])));
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const buf = await readBody(req, r.limit);
      c.body = r.raw ? buf : buf.length ? JSON.parse(buf.toString('utf8')) : undefined;
    }
    const out = await r.h(c);
    if (out === RAW) return;
    if (out === undefined) { res.writeHead(204, SECURITY_HEADERS).end(); return }
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store', ...SECURITY_HEADERS }).end(JSON.stringify(out));
  } catch (e) {
    const status = e instanceof HttpError ? e.status : e instanceof SyntaxError ? 400 : 502;
    // After a 413 the rest of the body is unread: discard it and close the connection so it can't corrupt the next request.
    const close = status === 413 ? { connection: 'close' } : {};
    if (!res.headersSent) res.writeHead(status, { 'content-type': 'application/json', ...close, ...SECURITY_HEADERS }).end(JSON.stringify({ error: (e as Error).message }));
    else res.end();
  }
}
export function sameOrigin(req: IncomingMessage) {
  const o = req.headers.origin; if (!o) return true;   // non-browser clients (curl, tests) send no Origin
  try { return new URL(o).host === req.headers.host } catch { return false }
}

/**
 * DNS-rebinding guard: a hostile page can point its own domain at 127.0.0.1 and then talk to us "same-origin".
 * Only accept Host names we actually serve: loopback names, this machine's own IPs (LAN access), and names listed in
 * CT_ALLOWED_HOSTS (comma-separated, e.g. the VPS domain later).
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
export function allowedHost(req: IncomingMessage) {
  const h = hostName(req);
  return LOOPBACK.has(h) || machineIps().has(h) || extraHosts().has(h);
}

// ---------- WebSocket hub: one socket per client, typed messages ----------
export interface WsClient { ws: WebSocket; session: string; send: (msg: unknown) => void; data: Map<string, unknown> }
type WsHandler = (client: WsClient, msg: Record<string, unknown>) => void;
const wsHandlers = new Map<string, WsHandler>();   // keyed by msg.op
const closeHandlers: ((c: WsClient) => void)[] = [];
export const clients = new Set<WsClient>();
/** Handle client messages with `{ op: <op>, ... }`. */
export function onWs(op: string, h: WsHandler) { wsHandlers.set(op, h) }
export function onWsClose(h: (c: WsClient) => void) { closeHandlers.push(h) }
/** Send to every connected client (all of them belong to the single user). */
export function broadcast(msg: unknown, except?: WsClient) { const s = JSON.stringify(msg); for (const c of clients) if (c !== except && c.ws.readyState === 1) c.ws.send(s) }

const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
export function upgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
  if (!req.url?.startsWith('/ws') || !allowedHost(req) || !sameOrigin(req)) { socket.destroy(); return }
  const session = sessionOf(req);
  if (!session) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return }
  wss.handleUpgrade(req, socket, head, ws => {
    const client: WsClient = { ws, session, data: new Map(), send: m => { if (ws.readyState === 1) ws.send(JSON.stringify(m)) } };
    clients.add(client);
    ws.on('message', raw => {
      let m: Record<string, unknown>;
      try { m = JSON.parse(String(raw)) } catch { return }
      const h = wsHandlers.get(String(m.op ?? ''));   // market data uses 'sub'/'unsub'; feature modules use 'module.action'
      try { h?.(client, m) } catch (e) { client.send({ type: 'error', msg: (e as Error).message }) }
    });
    ws.on('close', () => { clients.delete(client); closeHandlers.forEach(h => h(client)) });
  });
}
