// Server mode and proxy trust. CT_MODE=private (default) is the single-user server on your own PC; CT_MODE=public is the
// multi-user server behind a TLS proxy (docs/research/multiuser-design.md). Every new behaviour here is inert in
// private mode unless its env var is set. Imports nothing from the app (db.ts calls assertPublicSafe before it opens a file).
import type { IncomingMessage } from 'node:http';
import { existsSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const raw = (process.env.CT_MODE ?? '').trim().toLowerCase();
if (raw && raw !== 'public' && raw !== 'private') throw Error(`CT_MODE must be "public" or "private" (got "${process.env.CT_MODE}")`);
export const MODE: 'public' | 'private' = raw === 'public' ? 'public' : 'private';
export const isPublic = MODE === 'public';

export const HOST = process.env.CT_HOST?.trim() || '127.0.0.1';
const TRUST_PROXY = ['1', 'true', 'yes'].includes((process.env.CT_TRUST_PROXY ?? '').toLowerCase());
const norm = (ip: string) => ip.replace(/^::ffff:/i, '').toLowerCase();
const PROXY_IPS = new Set(['127.0.0.1', '::1', ...(process.env.CT_PROXY_IPS ?? '').split(',').map(s => norm(s.trim())).filter(Boolean)]);
export const REGISTRATION: 'invite' | 'open' | 'closed' = (['invite', 'open', 'closed'] as const).find(x => x === (process.env.CT_REGISTRATION ?? '').toLowerCase()) ?? 'invite';
/**
 * Sign in with Google / Apple (docs/research/oauth-sync-design.md §5.1). A provider is enabled only when ALL its variables are set;
 * a partly set provider throws (a typo must not silently disable it); nothing set = off. Public servers only (private ones never read this).
 */
export interface OAuthConfig { google?: { clientId: string; secret: string }; apple?: { serviceId: string; teamId: string; keyId: string; keyFile: string } }
export function oauthConfig(env: Record<string, string | undefined> = process.env): OAuthConfig {
  const v = (k: string) => (env[k] ?? '').trim();
  const group = (names: string[]) => { const set = names.filter(n => v(n)); if (set.length && set.length < names.length) throw Error(`OAuth: ${names.filter(n => !v(n)).join(', ')} missing (set all of ${names.join(', ')} or none)`); return set.length === names.length };
  const out: OAuthConfig = {};
  if (group(['CT_GOOGLE_CLIENT_ID', 'CT_GOOGLE_CLIENT_SECRET'])) out.google = { clientId: v('CT_GOOGLE_CLIENT_ID'), secret: v('CT_GOOGLE_CLIENT_SECRET') };
  if (group(['CT_APPLE_SERVICE_ID', 'CT_APPLE_TEAM_ID', 'CT_APPLE_KEY_ID', 'CT_APPLE_PRIVATE_KEY_FILE'])) out.apple = { serviceId: v('CT_APPLE_SERVICE_ID'), teamId: v('CT_APPLE_TEAM_ID'), keyId: v('CT_APPLE_KEY_ID'), keyFile: v('CT_APPLE_PRIVATE_KEY_FILE') };
  return out;
}
export const OAUTH: OAuthConfig = isPublic ? oauthConfig() : {};

/**
 * CT_CORS_ORIGINS: exact origins (scheme://host[:port], comma-separated) that may call this server cross-origin with a
 * Bearer device token. Off by default. `*`, `null` and anything that is not a bare origin stop the server at start-up.
 */
export const CORS_ORIGINS: ReadonlySet<string> = new Set((process.env.CT_CORS_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean).map(s => {
  let o = ''; try { o = new URL(s).origin } catch {}
  if (!o || s.includes('*') || o === 'null' || o !== s) throw Error(`CT_CORS_ORIGINS: "${s}" is not an exact origin like https://app.example.com (wildcards and "null" are refused)`);
  return s;
}));
/** Shown to clients that connect to several servers (GET /api/auth/status). */
export const SERVER_NAME = (process.env.CT_SERVER_NAME ?? '').replace(/[^\P{Cc}]/gu, '').trim().slice(0, 60);
export const publicUrl = (): URL | null => { try { return process.env.CT_PUBLIC_URL ? new URL(process.env.CT_PUBLIC_URL) : null } catch { return null } };
/** Cookies get `Secure` (and in public mode the `__Host-` prefix) when the site is served over HTTPS. */
const publicHttps = () => isPublic && publicUrl()?.protocol === 'https:';

const trusted = (ip: string) => PROXY_IPS.has(norm(ip));
/** True when the socket peer is a proxy we were told to believe (CT_TRUST_PROXY=1 and loopback or CT_PROXY_IPS). */
const fromProxy = (req: IncomingMessage) => TRUST_PROXY && trusted(req.socket.remoteAddress ?? '');
const last = (h: string | string[] | undefined) => String(Array.isArray(h) ? h[h.length - 1] : h ?? '').split(',').map(s => s.trim()).filter(Boolean);

/**
 * Client address. Without CT_TRUST_PROXY (or when the peer is not a trusted proxy) it is the socket address and
 * X-Forwarded-For is ignored. Behind a trusted proxy it is the right-most hop that is not itself a trusted proxy:
 * values to the left of it are client-supplied and never believed.
 */
export function clientIp(req: IncomingMessage): string {
  const peer = norm(req.socket.remoteAddress ?? '');
  if (!fromProxy(req)) return req.socket.remoteAddress ?? '';
  const hops = last(req.headers['x-forwarded-for']).map(norm);
  for (let i = hops.length - 1; i >= 0; i--) if (!trusted(hops[i])) return hops[i];
  return hops[0] ?? peer;
}
/** Request arrived over HTTPS: the listener is TLS, the public URL is https, or a trusted proxy says so. */
export const isHttps = (req: IncomingMessage, listenerSecure: boolean) =>
  listenerSecure || publicHttps() || (fromProxy(req) && last(req.headers['x-forwarded-proto']).pop()?.toLowerCase() === 'https');

/** Startup checks for public mode. Throws (the process exits) with a message saying what to fix. */
export function assertPublicSafe(dataDir: string) {
  if (!isPublic) return;
  if (process.env.CT_SECRET_KEY) throw Error('CT_MODE=public refuses to start with CT_SECRET_KEY set: exchange keys must never exist on a public server');
  if (existsSync(join(dataDir, 'secret.key'))) throw Error(`CT_MODE=public refuses to start: ${join(dataDir, 'secret.key')} exists (secret material). Use a clean CT_DATA_DIR`);
  const legacy = join(dataDir, 'chart-terminal.db');
  if (existsSync(legacy)) {   // a private-mode database in this directory: broker keys must not be carried over
    let n = 0;
    try {
      const d = new DatabaseSync(legacy, { readOnly: true });
      for (const t of ['secrets', 'broker_accounts']) { try { n += Number((d.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n) } catch {} }
      d.close();
    } catch { n = 1 }
    if (n) throw Error(`CT_MODE=public refuses to start: ${legacy} holds secrets or broker accounts. Use a clean CT_DATA_DIR`);
  }
  if (!TRUST_PROXY && process.env.CT_NO_PROXY !== '1') throw Error('CT_MODE=public needs CT_TRUST_PROXY=1 (Caddy/nginx in front); without it every client looks like the proxy and the rate limits are shared. Set CT_NO_PROXY=1 only if clients really connect directly');
  // A proxy on a Docker bridge connects from a non-loopback address; unless CT_PROXY_IPS lists it, X-Forwarded-For is ignored and every client shares one limit.
  const loop = (ip: string) => ['127.0.0.1', '::1', 'localhost'].includes(norm(ip.trim()));
  if (TRUST_PROXY && !(process.env.CT_PROXY_IPS ?? '').split(',').some(s => s.trim() && !loop(s)) && !loop(HOST)) throw Error('CT_TRUST_PROXY=1 with CT_HOST bound to a non-loopback address needs CT_PROXY_IPS to list the proxy\'s address (e.g. the Docker bridge IP); otherwise the proxy is not trusted and all clients share one rate limit');
  const keyFile =process.env.CT_APPLE_PRIVATE_KEY_FILE?.trim();
  if (keyFile && (resolve(keyFile) + sep).startsWith(resolve(dataDir) + sep)) throw Error('CT_APPLE_PRIVATE_KEY_FILE must be outside CT_DATA_DIR (the .p8 is a secret and the data dir is backed up and shared)');
  const u = publicUrl();
  if (!u) throw Error('CT_MODE=public needs CT_PUBLIC_URL (e.g. https://charts.example.com)');
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname))) throw Error('CT_PUBLIC_URL must be https (plain http is only allowed for localhost)');
  if (!(process.env.CT_ALLOWED_HOSTS ?? '').split(',').some(s => s.trim())) throw Error('CT_MODE=public needs CT_ALLOWED_HOSTS (comma-separated host names this server answers to)');
}
