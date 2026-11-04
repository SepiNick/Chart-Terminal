// Chart Terminal server: market data, login, synced app state, alerts and notifications, server-side forward tests,
// trade recording. HTTP on CT_HOST (default 127.0.0.1; the Vite dev server proxies to it) and, in private mode when
// enabled, HTTPS on the LAN for phones and other devices (see lan.ts). Modules are chosen in app.ts by CT_MODE.
import { createServer } from './app.ts';
import { HOST, TRUST_PROXY, isPublic } from './core/mode.ts';
import * as cx from './ccxt.ts';

const PORT = Number(process.env.PORT ?? 8787);
if (isPublic) {
  const { ensureAdmin } = await import('./core/users.ts');
  const a = await ensureAdmin();
  if (a) console.log(`First admin created. Username: ${a.name}  one-time password: ${a.password}  (shown once; you must change it at first login)`);
  if (!TRUST_PROXY) console.warn('CT_TRUST_PROXY is not set: all clients look like the proxy to the rate limits. Set CT_TRUST_PROXY=1 behind Caddy/nginx.');
  if (!process.env.CT_VAPID_PUBLIC || !process.env.CT_VAPID_PRIVATE) console.warn('CT_VAPID_PUBLIC/CT_VAPID_PRIVATE not set: push notifications are off (node server/cli.ts vapid makes a pair).');
}
if (!process.env.CT_NO_AUTOSTART) {
  const server = createServer();
  server.listen(PORT, HOST, () => console.log(`Chart Terminal server (${isPublic ? 'public' : 'private'}) on http://${HOST}:${PORT} (${cx.exchangeIds().length} exchanges + FX)`));
  if (!isPublic) (await import('./lan.ts')).startLan();
}
