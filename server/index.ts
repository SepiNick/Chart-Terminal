// Chart Terminal server: market data, login, synced app state, alerts and notifications, server-side forward tests,
// trade recording. HTTP on CT_HOST (default 127.0.0.1; the Vite dev server proxies to it) and, in private mode when
// enabled, HTTPS on the LAN for phones and other devices (see lan.ts). Modules are chosen in app.ts by CT_MODE.
import { createServer } from './app.ts';
import { HOST, isPublic } from './core/mode.ts';
import * as cx from './ccxt.ts';

const PORT = Number(process.env.PORT ?? 8787);

// A bug in one request or feed must not take the whole server down; only a failure before it listens is fatal.
// Messages are cut and long token-like strings masked so nothing secret reaches the log.
let started = !!process.env.CT_NO_AUTOSTART;   // embedded use (tests) has no listen step to wait for
const safeMsg = (e: unknown) => String((e as Error)?.message ?? e).replace(/\s+/g, ' ').replace(/[A-Za-z0-9_+/=-]{32,}/g, '***').slice(0, 300);
for (const ev of ['unhandledRejection', 'uncaughtException'] as const) process.on(ev, e => { console.error(`[${ev}] ${safeMsg(e)}`); if (!started) process.exit(1) });
if (isPublic) {
  const { ensureAdmin } = await import('./core/users.ts');
  const a = await ensureAdmin();
  if (a) console.log(`First admin created. Username: ${a.name}  one-time password: ${a.password}  (shown once; you must change it at first login)`);
  if (!process.env.CT_VAPID_PUBLIC || !process.env.CT_VAPID_PRIVATE) console.warn('CT_VAPID_PUBLIC/CT_VAPID_PRIVATE not set: push notifications are off (node server/cli.ts vapid makes a pair).');
}
if (!process.env.CT_NO_AUTOSTART) {
  const server = createServer();
  server.listen(PORT, HOST, () => { started = true; console.log(`Chart Terminal server (${isPublic ? 'public' : 'private'}) on http://${HOST}:${PORT} (${cx.exchangeIds().length} exchanges + FX)`) });
  if (!isPublic) (await import('./lan.ts')).startLan();
}
