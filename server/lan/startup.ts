// Pure helpers for starting Home network access without the browser UI (CT_LAN=1 / --lan). No DB import, so tests can use them.
import { qrText } from './qr.ts';

const ON = new Set(['1', 'true', 'yes', 'on']);
/** Headless switch: env CT_LAN=1 (also true/yes/on) or the `--lan` command-line flag. */
export const lanRequested = (env: Record<string, string | undefined> = process.env, argv: string[] = process.argv) =>
  ON.has((env.CT_LAN ?? '').trim().toLowerCase()) || argv.includes('--lan');

/** HTTPS port: CT_LAN_PORT when it is a valid unprivileged port, else the saved one. */
export function lanPort(saved: number, env: Record<string, string | undefined> = process.env): number {
  const p = Number(env.CT_LAN_PORT);
  return Number.isInteger(p) && p >= 1024 && p <= 65535 ? p : saved;
}

/** Only machines on a private network may even complete a TCP connection (RFC 1918, loopback, link-local, IPv6 ULA). */
export function isPrivateAddr(addr: string | undefined): boolean {
  const a = (addr ?? '').replace(/^::ffff:/i, '').toLowerCase();
  const m = a.match(/^(\d+)\.(\d+)\.\d+\.\d+$/);
  if (m) { const [x, y] = [+m[1], +m[2]]; return x === 10 || x === 127 || (x === 172 && y >= 16 && y <= 31) || (x === 192 && y === 168) || (x === 169 && y === 254) }
  return a === '::1' || /^f[cd][0-9a-f]{2}:/.test(a) || /^fe[89ab][0-9a-f]:/.test(a);
}

/** Over the LAN, login and first-time setup stay closed until a password exists (set from this machine). */
export const lanAuthClosed = (pathname: string, hasPassword: boolean) => !hasPassword && (pathname === '/api/auth/login' || pathname === '/api/auth/setup');

export function banner(o: { urls: string[]; port: number; httpPort: number; hasPassword: boolean }): string {
  const L = ['', 'Home network access is ON (HTTPS, private networks only)'];
  if (!o.urls.length) L.push(`  No LAN address found; listening on port ${o.port}`);
  for (const u of o.urls) L.push(`  App:         ${u}`, `  Certificate: ${u}/ca.crt   (install once on the phone)`);
  if (o.urls[0]) L.push('', qrText(o.urls[0]), '  ^ scan with the phone camera to open the app');
  if (!o.hasPassword) L.push('', 'No password is set yet, so the LAN refuses login. Set it on THIS machine (it cannot be done over the network):',
    `  open http://127.0.0.1:${o.httpPort}   or   curl -X POST http://127.0.0.1:${o.httpPort}/api/auth/setup -H "content-type: application/json" -d '{"password":"at least 8 characters"}'`);
  return L.join('\n') + '\n';
}
