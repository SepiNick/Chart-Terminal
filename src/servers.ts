// Saved servers (docs/research/multiuser-design.md §5): the SYNC server (account, synced state, alerts, push; where the page is
// served from by default) and an optional separate TRADING server (brokers, forward tests, MT5, AI/ML; a private server or
// this machine only). Stored per device in localStorage under `ctsrv` (not `ct.*`, so it never syncs; it holds tokens).
// Imports nothing from the app (sync.ts builds on it) and is safe to import in node (tests).
export type Role = 'sync' | 'trade';
export interface Features { trading: boolean; ai: boolean; ml: boolean; forward: boolean; scripts: boolean }
export interface ServerStatus {
  setup: boolean; loggedIn: boolean; mode: 'public' | 'private'; registration: 'invite' | 'open' | 'closed';
  version?: string; serverName?: string; features: Features; user?: { name: string; role?: string; mustChange?: boolean };
}
export interface Server { id: string; name: string; baseUrl: string; token?: string; mode?: 'public' | 'private'; serverName?: string; features?: Features }
type Kv = Pick<Storage, 'getItem' | 'setItem'>;

const KEY = 'ctsrv', LOCAL = 'local';
export const ALL_FEATURES: Features = { trading: true, ai: true, ml: true, forward: true, scripts: true };

/** Random id of this tab: sent as `x-ct-client`, so the server doesn't echo our own writes back. */
export const clientId = Array.from(globalThis.crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, '0')).join('');

// ---------- pure helpers ----------
const LOOPBACK = /^(localhost|127(\.\d{1,3}){3}|\[::1\])$/i;
export const isLoopbackHost = (host: string) => LOOPBACK.test(host.replace(/:\d+$/, '').replace(/^(\[::1\]):\d+$/, '$1'));
const LANISH = /^(localhost|127(\.\d{1,3}){3}|10(\.\d{1,3}){3}|192\.168(\.\d{1,3}){2}|172\.(1[6-9]|2\d|3[01])(\.\d{1,3}){2}|[^/:]+\.local|\[::1\])(:\d+)?(\/|$)/i;

/** "my.server.com", "192.168.1.5:8787" or a full URL → "https://my.server.com" / "http://192.168.1.5:8787" (origin only). Throws a readable Error. */
export function normalizeBaseUrl(input: string): string {
  let s = String(input).trim();
  if (!s) throw Error('Enter the server address');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = (LANISH.test(s) ? 'http://' : 'https://') + s;
  let u: URL;
  try { u = new URL(s) } catch { throw Error('That is not a valid address') }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw Error('Only http:// and https:// addresses work');
  if (u.username || u.password) throw Error('Do not put a username or password in the address');
  if (!u.hostname) throw Error('That is not a valid address');
  return u.origin;
}
export const originOf = () => (globalThis.location?.origin as string | undefined) ?? '';
const protoOf = () => (globalThis.location?.protocol as string | undefined) ?? 'http:';
export const isSameOrigin = (s: Pick<Server, 'baseUrl'>, origin = originOf()) => s.baseUrl === '' || s.baseUrl === origin;

/** Absolute URL for an API path. Only same-server paths are accepted so a token can never be sent somewhere else. */
export function serverUrl(s: Pick<Server, 'baseUrl'>, path: string, origin = originOf()): string {
  if (!/^\/(?!\/)/.test(path)) throw Error(`Bad API path: ${path}`);
  return isSameOrigin(s, origin) ? path : s.baseUrl + path;
}
export function authHeaders(s: Pick<Server, 'baseUrl' | 'token'>, id = clientId, origin = originOf()): Record<string, string> {
  const h: Record<string, string> = { 'x-ct-client': id };
  if (s.token && !isSameOrigin(s, origin)) h.authorization = `Bearer ${s.token}`;
  return h;
}
/** WebSocket URL and subprotocols; the token travels as subprotocol `ct.<token>`, never in the URL. */
export function socketArgs(s: Pick<Server, 'baseUrl' | 'token'>, path: string, loc = { origin: originOf(), protocol: protoOf(), host: globalThis.location?.host ?? '' }): { url: string; protocols?: string[] } {
  if (!/^\/(?!\/)/.test(path)) throw Error(`Bad API path: ${path}`);
  if (isSameOrigin(s, loc.origin)) return { url: `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.host}${path}` };
  return { url: s.baseUrl.replace(/^http/, 'ws') + path, protocols: s.token ? [`ct.${s.token}`] : undefined };
}

/** Normalise `/api/auth/status`; null when the answer is not from a Chart Terminal server. Unknown features: on for private servers, off for public ones. */
export function parseStatus(j: unknown): ServerStatus | null {
  const o = j as Record<string, unknown> | null;
  if (!o || typeof o !== 'object' || typeof o.loggedIn !== 'boolean') return null;
  const mode = o.mode === 'public' ? 'public' : 'private';
  const f = (o.features && typeof o.features === 'object' ? o.features : {}) as Record<string, unknown>, d = mode === 'private';
  const flag = (v: unknown) => (typeof v === 'boolean' ? v : d);
  const u = o.user as Record<string, unknown> | undefined;
  return {
    setup: !!o.setup, loggedIn: o.loggedIn, mode,
    registration: o.registration === 'open' || o.registration === 'closed' ? o.registration : 'invite',
    version: typeof o.version === 'string' ? o.version : undefined,
    serverName: typeof o.serverName === 'string' && o.serverName ? o.serverName.slice(0, 60) : undefined,
    features: { trading: flag(f.trading ?? f.brokers), ai: flag(f.ai), ml: flag(f.ml), forward: flag(f.forward), scripts: flag(f.scripts ?? f.scriptAlerts) },
    user: u && typeof u.name === 'string' ? { name: u.name, role: typeof u.role === 'string' ? u.role : undefined, mustChange: !!u.mustChange } : undefined,
  };
}

/** A trading server must be a private server or this machine. */
export function canBeTradeServer(s: Pick<Server, 'baseUrl' | 'mode'>, host = globalThis.location?.hostname ?? ''): { ok: boolean; why?: string } {
  const loopback = s.baseUrl ? isLoopbackHost(new URL(s.baseUrl).hostname) : isLoopbackHost(host);
  if (s.mode === 'private' || loopback) return { ok: true };
  return { ok: false, why: s.mode === 'public' ? 'A public server never stores exchange keys. Use your own private server or this computer.' : 'Check the server first: only a private server or this computer can be a trading server.' };
}
/** Plain http to a non-local address from an https page is blocked by browsers (mixed content). */
export function mixedContentWarning(s: Pick<Server, 'baseUrl'>, pageProtocol = protoOf()): string | null {
  if (pageProtocol !== 'https:' || !/^http:/i.test(s.baseUrl)) return null;
  try { if (isLoopbackHost(new URL(s.baseUrl).hostname)) return null } catch {}
  return 'This address uses plain http, but this page is https: the browser will block it. Give the server https (see docs/lan-setup.md) or open the app from that server directly.';
}

export const NO_TRADE = 'No trading server is connected. Trading, forward tests and AI need your own private server (Settings → Servers).';
const WHY_PUBLIC = 'This public server never stores exchange keys; connect your own private server for trading.';
/** Is a feature usable, and if not, one short reason. Pure: takes the servers explicitly. */
export function gateFor(f: keyof Features, sync: Pick<Server, 'features' | 'mode'> | null, trade: Pick<Server, 'features' | 'mode'> | null): { on: boolean; why: string } {
  if (f === 'scripts') return sync?.features?.scripts === false ? { on: false, why: 'This server does not run scripts (Pine, MQL, NinjaScript). The chart still runs them in your browser.' } : { on: true, why: '' };
  if (!trade) return { on: false, why: sync?.mode === 'public' ? WHY_PUBLIC : NO_TRADE };
  if (trade.features?.[f] === false) return { on: false, why: `The trading server has this turned off (${f}).` };
  return { on: true, why: '' };
}

/** "Windows · Chrome" style label for the devices list. */
export function deviceLabel(ua = globalThis.navigator?.userAgent ?? ''): string {
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'Device';
  const br = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'browser';
  return `${os} · ${br}`;
}

// ---------- storage ----------
interface Saved { servers: Server[]; sync: string; trade: string | null }
let kv: Kv | undefined, cache: Saved | null = null;
const subs = new Set<() => void>();
const store = (): Kv | undefined => kv ?? (typeof localStorage !== 'undefined' ? localStorage : undefined);
/** Tests: replace the storage and drop the cache. */
export function _reset(storage?: Kv) { kv = storage; cache = null }
const localServer = (): Server => ({ id: LOCAL, name: 'This server', baseUrl: '' });
function load(): Saved {
  if (cache) return cache;
  let s: Partial<Saved> = {};
  try { s = JSON.parse(store()?.getItem(KEY) ?? '{}') } catch {}
  const list = (Array.isArray(s.servers) ? s.servers : []).filter(x => x && typeof x.id === 'string' && typeof x.baseUrl === 'string' && x.id !== LOCAL);
  const servers = [localServer(), ...list.map(x => ({ ...x, token: typeof x.token === 'string' ? x.token : undefined }))];
  const has = (id: unknown) => servers.some(x => x.id === id);
  // the local entry keeps the status we learned (mode, features) but never a token
  const lc = (Array.isArray(s.servers) ? s.servers : []).find(x => x?.id === LOCAL);
  if (lc) Object.assign(servers[0], { mode: lc.mode, serverName: lc.serverName, features: lc.features });
  return (cache = { servers, sync: has(s.sync) ? s.sync! : LOCAL, trade: s.trade && has(s.trade) ? s.trade : null });
}
function save() {
  const c = load();
  try { store()?.setItem(KEY, JSON.stringify({ ...c, servers: c.servers.map(x => (x.id === LOCAL ? { ...x, token: undefined } : x)) })) } catch {}
  subs.forEach(f => f());
}
export const onServersChanged = (fn: () => void) => { subs.add(fn); return () => { subs.delete(fn) } };

export const listServers = (): Server[] => load().servers;
export const serverById = (id: string | null | undefined) => load().servers.find(s => s.id === id) ?? null;
export const syncServer = (): Server => serverById(load().sync) ?? load().servers[0];
export const tradeId = () => load().trade;
/** The server brokers / forward tests / AI talk to: the one chosen, else the sync server when it is private or this machine. Never a public server. */
export function tradeServer(): Server | null {
  const c = load();
  if (c.trade) return serverById(c.trade);
  const s = syncServer();
  return canBeTradeServer(s).ok ? s : null;
}
export const serverFor = (role: Role) => (role === 'trade' ? tradeServer() : syncServer());
export const gate = (f: keyof Features) => gateFor(f, syncServer(), tradeServer());

export function addServer(baseUrl: string, name?: string, origin = originOf()): Server {
  const url = normalizeBaseUrl(baseUrl), c = load();
  const same = url === origin ? c.servers[0] : c.servers.find(s => s.baseUrl === url);
  if (same) return same;
  const s: Server = { id: 'srv' + Array.from(globalThis.crypto.getRandomValues(new Uint8Array(5)), b => b.toString(16).padStart(2, '0')).join(''), name: (name?.trim() || new URL(url).host).slice(0, 60), baseUrl: url };
  c.servers.push(s); save();
  return s;
}
export function removeServer(id: string) {
  const c = load();
  if (id === LOCAL) return;
  c.servers = c.servers.filter(s => s.id !== id);
  if (c.sync === id) c.sync = LOCAL;
  if (c.trade === id) c.trade = null;
  save();
}
export function setSyncServer(id: string) { if (serverById(id)) { load().sync = id; save() } }
/** null = automatic (the sync server when it is private or this machine). Refuses a server that cannot trade. */
export function setTradeServer(id: string | null) {
  const s = id ? serverById(id) : null;
  if (id && (!s || !canBeTradeServer(s).ok)) throw Error(s ? canBeTradeServer(s).why : 'Unknown server');
  load().trade = id; save();
}
/** Tokens are kept only for other servers; the same-origin server uses its cookie. */
export function setToken(id: string, token?: string) { const s = serverById(id); if (s && s.id !== LOCAL && !isSameOrigin(s)) { s.token = token; save() } }
export function recordStatus(id: string, st: ServerStatus) {
  const s = serverById(id); if (!s) return;
  s.mode = st.mode; s.features = st.features; s.serverName = st.serverName; save();
}

// ---------- calls ----------
/** fetch against the sync (default) or trading server: base URL, bearer token and x-ct-client added. Trading never falls back to the sync server. */
export async function serverFetch(path: string, init: RequestInit = {}, role: Role = 'sync'): Promise<Response> {
  const s = serverFor(role);
  if (!s) throw Object.assign(Error(NO_TRADE), { status: 0, code: 'no-trade-server' });
  const headers = new Headers(init.headers);
  for (const [k, v] of Object.entries(authHeaders(s))) headers.set(k, v);
  return fetch(serverUrl(s, path), { ...init, headers, credentials: isSameOrigin(s) ? 'same-origin' : 'omit' });
}
export function serverSocket(path: string, role: Role = 'sync'): WebSocket {
  const s = serverFor(role);
  if (!s) throw Object.assign(Error(NO_TRADE), { status: 0, code: 'no-trade-server' });
  const a = socketArgs(s, path);
  return a.protocols ? new WebSocket(a.url, a.protocols) : new WebSocket(a.url);
}
/** GET /api/auth/status of any address, without credentials (adding a server). Null when it is not a Chart Terminal server or unreachable. */
export async function probeStatus(baseUrl: string, timeoutMs = 8000): Promise<ServerStatus | null> {
  try {
    const r = await fetch(baseUrl + '/api/auth/status', { credentials: 'omit', signal: AbortSignal.timeout(timeoutMs) });
    return r.ok ? parseStatus(await r.json()) : null;
  } catch { return null }
}
