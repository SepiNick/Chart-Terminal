// HTTPS on the home network (local CA + server certificate) so phones get a secure context for push and the PWA.
// See docs/phase5-contracts.md §8 and docs/lan-setup.md.
import https from 'node:https';
import type { Socket } from 'node:net';
import { join } from 'node:path';
import { route, handle, upgrade, HttpError, RAW } from './core/http.ts';
import { configGet, configSet, DATA_DIR } from './core/db.ts';
import { hostname } from 'node:os';
import { ensureCerts, lanIps, lanNames, readCa, caFingerprint, mobileconfig, type Certs } from './lan/tls.ts';
import { hasPassword } from './core/auth.ts';
import { HOST, SERVER_NAME } from './core/mode.ts';
import { discoveryEnabled, lanStarted, lanStopped } from './discovery.ts';
import { isEnabled as twofaOn } from './twofa.ts';
import { banner, isPrivateAddr, lanAuthClosed, lanPort, lanRequested } from './lan/startup.ts';

interface LanConfig { enabled: boolean; port: number; discovery?: boolean }
const TLS_DIR = join(DATA_DIR, 'tls');
const cfg = () => { const c = { enabled: false, port: 8443, ...configGet<Partial<LanConfig>>('lan', {}) }; return { ...c, port: lanPort(c.port) } };

/** Discovery beacon (discovery.ts): on while Home network access is on, unless CT_DISCOVERY=0 or the `discovery` setting is off. */
const beacon = () => lanStarted({ httpsPort: cfg().port, dir: DATA_DIR, host: HOST, httpPort: Number(process.env.PORT ?? 8787), name: SERVER_NAME || hostname(), twofa: () => twofaOn(1), discovery: discoveryEnabled(process.env, cfg().discovery !== false) });
let server: https.Server | null = null;
let certs: Certs | null = null;
let watch: ReturnType<typeof setInterval> | undefined;

function start(port: number): Promise<void> {
  // The Host-header guard (http.ts) must accept this machine's mDNS name too (it is also in the certificate).
  for (const n of lanNames(hostname())) if (!(process.env.CT_ALLOWED_HOSTS ?? '').split(',').includes(n)) process.env.CT_ALLOWED_HOSTS = [process.env.CT_ALLOWED_HOSTS, n].filter(Boolean).join(',');
  certs = ensureCerts(TLS_DIR);
  const s = https.createServer({ key: certs.key, cert: certs.cert }, (req, res) => {
    // No password yet: the LAN cannot log in or claim the server (setup is also localhost-only in authroutes.ts).
    if (lanAuthClosed(new URL(req.url ?? '/', 'http://x').pathname, hasPassword())) {
      res.writeHead(403, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'Set the first password on the computer running the server' }));
      return;
    }
    handle(req, res, true);
  });
  s.on('upgrade', upgrade);
  // Private networks only: a public source address (port forward, public IPv4 on the NIC) never gets to talk TLS.
  s.on('connection', (sock: Socket) => { if (!isPrivateAddr(sock.remoteAddress)) sock.destroy() });
  return new Promise((resolve, reject) => {
    s.once('error', reject);
    s.listen(port, '0.0.0.0', () => {
      s.off('error', reject);
      s.on('error', e => console.error('LAN HTTPS:', e.message));
      server = s;
      // Wi-Fi/DHCP can hand out a new address: re-issue the server certificate (same CA) and swap it in live.
      watch = setInterval(() => {
        if (!certs || lanIps().join() === certs.ips.join()) return;
        try { certs = ensureCerts(TLS_DIR); s.setSecureContext({ key: certs.key, cert: certs.cert }) } catch (e) { console.error('LAN certificate:', (e as Error).message) }
      }, 60_000);
      watch.unref();
      beacon();
      process.stdout.write(banner({ urls: urls(port), port, httpPort: Number(process.env.PORT ?? 8787), hasPassword: hasPassword() }));
      resolve();
    });
  });
}
function stop(): Promise<void> {
  clearInterval(watch); lanStopped();
  const s = server; server = null;
  if (!s) return Promise.resolve();
  return new Promise(r => { s.close(() => r()); s.closeAllConnections() });
}

const urls = (port: number) => lanIps().map(ip => `https://${ip}:${port}`);
function status() {
  const c = cfg(), ca = readCa(TLS_DIR);
  return { enabled: !!server, port: c.port, discovery: discoveryEnabled(process.env, c.discovery !== false), urls: urls(c.port), caFingerprint: ca ? caFingerprint(ca) : null };
}

/** Called once from index.ts after the HTTP server starts. CT_LAN=1 or --lan turns it on without the browser (not saved). */
export function startLan() {
  const c = cfg();
  if (c.enabled || lanRequested()) start(c.port).catch(e => console.error(`Home network HTTPS could not start on port ${c.port}: ${e.message}`));
}

route('GET', '/api/lan', () => status());
route('POST', '/api/lan', async c => {
  // Only this PC may open or close the server to the network.
  const ip = c.req.socket.remoteAddress ?? '';
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip)) throw new HttpError(403, 'Home network access can only be changed on this PC');
  const { enabled, discovery } = (c.body ?? {}) as { enabled?: unknown; discovery?: unknown };
  if (typeof discovery === 'boolean' && enabled === undefined) {   // only the discovery switch
    configSet('lan', { ...configGet<Partial<LanConfig>>('lan', {}), discovery });
    if (server) beacon();
    return status();
  }
  if (typeof enabled !== 'boolean') throw new HttpError(400, 'enabled must be true or false');
  const conf = cfg();
  await stop();
  if (enabled) {
    try { await start(conf.port) } catch (e) { throw new HttpError(500, `Could not start HTTPS on port ${conf.port}: ${(e as Error).message}`) }
  }
  configSet('lan', { ...configGet<Partial<LanConfig>>('lan', {}), enabled });   // not conf: CT_LAN_PORT must not be saved
  return status();
});

function ca() {
  try { return ensureCerts(TLS_DIR) } catch (e) { throw new HttpError(500, (e as Error).message) }
}
route('GET', '/ca.crt', c => {
  c.res.writeHead(200, { 'content-type': 'application/x-x509-ca-cert', 'content-disposition': 'attachment; filename="chart-terminal-ca.crt"', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }).end(ca().caDer);
  return RAW;
}, { public: true });
route('GET', '/ca.mobileconfig', c => {
  c.res.writeHead(200, { 'content-type': 'application/x-apple-aspen-config', 'content-disposition': 'attachment; filename="chart-terminal.mobileconfig"', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }).end(mobileconfig(ca().caDer));
  return RAW;
}, { public: true });
