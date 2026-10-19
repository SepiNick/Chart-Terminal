// HTTPS on the home network (local CA + server certificate) so phones get a secure context for push and the PWA.
// See docs/phase5-contracts.md §8 and docs/lan-setup.md.
import https from 'node:https';
import { join } from 'node:path';
import { route, handle, upgrade, HttpError, RAW } from './core/http.ts';
import { configGet, configSet, DATA_DIR } from './core/db.ts';
import { ensureCerts, lanIps, readCa, caFingerprint, mobileconfig, type Certs } from './lan/tls.ts';

interface LanConfig { enabled: boolean; port: number }
const TLS_DIR = join(DATA_DIR, 'tls');
const cfg = () => ({ enabled: false, port: 8443, ...configGet<Partial<LanConfig>>('lan', {}) });

let server: https.Server | null = null;
let certs: Certs | null = null;
let watch: ReturnType<typeof setInterval> | undefined;

function start(port: number): Promise<void> {
  certs = ensureCerts(TLS_DIR);
  const s = https.createServer({ key: certs.key, cert: certs.cert }, (req, res) => handle(req, res, true));
  s.on('upgrade', upgrade);
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
      console.log(`Home network: ${urls(port).join(', ') || `https://0.0.0.0:${port}`}`);
      resolve();
    });
  });
}
function stop(): Promise<void> {
  clearInterval(watch);
  const s = server; server = null;
  if (!s) return Promise.resolve();
  return new Promise(r => { s.close(() => r()); s.closeAllConnections() });
}

const urls = (port: number) => lanIps().map(ip => `https://${ip}:${port}`);
function status() {
  const c = cfg(), ca = readCa(TLS_DIR);
  return { enabled: c.enabled && !!server, port: c.port, urls: urls(c.port), caFingerprint: ca ? caFingerprint(ca) : null };
}

/** Called once from index.ts after the HTTP server starts. */
export function startLan() {
  const c = cfg();
  if (c.enabled) start(c.port).catch(e => console.error(`Home network HTTPS could not start on port ${c.port}: ${e.message}`));
}

route('GET', '/api/lan', () => status());
route('POST', '/api/lan', async c => {
  // Only this PC may open or close the server to the network.
  const ip = c.req.socket.remoteAddress ?? '';
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip)) throw new HttpError(403, 'Home network access can only be changed on this PC');
  const { enabled } = (c.body ?? {}) as { enabled?: unknown };
  if (typeof enabled !== 'boolean') throw new HttpError(400, 'enabled must be true or false');
  const conf = cfg();
  await stop();
  if (enabled) {
    try { await start(conf.port) } catch (e) { throw new HttpError(500, `Could not start HTTPS on port ${conf.port}: ${(e as Error).message}`) }
  }
  configSet('lan', { ...conf, enabled });
  return status();
});

function ca() {
  try { return ensureCerts(TLS_DIR) } catch (e) { throw new HttpError(500, (e as Error).message) }
}
route('GET', '/ca.crt', c => {
  c.res.writeHead(200, { 'content-type': 'application/x-x509-ca-cert', 'content-disposition': 'attachment; filename="chart-terminal-ca.crt"', 'cache-control': 'no-store' }).end(ca().caDer);
  return RAW;
}, { public: true });
route('GET', '/ca.mobileconfig', c => {
  c.res.writeHead(200, { 'content-type': 'application/x-apple-aspen-config', 'content-disposition': 'attachment; filename="chart-terminal.mobileconfig"', 'cache-control': 'no-store' }).end(mobileconfig(ca().caDer));
  return RAW;
}, { public: true });
