// Local CA + server certificate for HTTPS on the home network, made with the openssl CLI (no extra dependency).
// Pure helpers live here (no DB import) so tests can use them directly.
import { execFileSync } from 'node:child_process';
import { X509Certificate, randomUUID, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';

export const CA_NAME = 'Chart Terminal Local CA';
const SERVER_DAYS = 825;   // iOS rejects TLS server certificates valid for longer than 825 days

/** Where to look for openssl: $CT_OPENSSL, then PATH, then the copies that ship with Git for Windows. */
export function opensslCandidates(env: Record<string, string | undefined> = process.env, platform: string = process.platform): string[] {
  const win = platform === 'win32', exe = win ? 'openssl.exe' : 'openssl';
  const path = env.PATH ?? env.Path ?? '';
  return [
    ...(env.CT_OPENSSL ? [env.CT_OPENSSL] : []),
    ...path.split(win ? ';' : ':').filter(Boolean).map(d => join(d, exe)),
    ...(win ? ['C:\\Program Files\\Git\\usr\\bin\\openssl.exe', 'C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe'] : []),
  ];
}
export function findOpenssl(env = process.env, platform: string = process.platform, exists: (p: string) => boolean = existsSync): string | null {
  return opensslCandidates(env, platform).find(p => exists(p)) ?? null;
}

type Ifaces = ReturnType<typeof networkInterfaces>;
/** Non-internal IPv4 addresses of this machine, sorted and unique (link-local 169.254.x.x is unreachable, skip it). */
export function lanIps(ifaces: Ifaces = networkInterfaces()): string[] {
  const ips = Object.values(ifaces).flat().filter(a => a && a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')).map(a => a!.address);
  return [...new Set(ips)].sort();
}
export const sanList = (ips: string[]) => ['DNS:localhost', 'IP:127.0.0.1', ...ips.filter(ip => ip !== '127.0.0.1').map(ip => 'IP:' + ip)];

/** IPv4 SANs of an existing certificate (from Node's "DNS:x, IP Address:y" format). */
export const certIps = (c: X509Certificate) => [...(c.subjectAltName ?? '').matchAll(/IP Address:([\d.]+)/g)].map(m => m[1]).filter(ip => ip !== '127.0.0.1').sort();

/** Regenerate when there is no certificate, the IP set changed, it expires within 30 days, or the CA was replaced. */
export function needsNewCert(cert: X509Certificate | null, ips: string[], ca: X509Certificate, now = Date.now()): boolean {
  if (!cert) return true;
  if (certIps(cert).join() !== [...ips].sort().join()) return true;
  if (Date.parse(cert.validTo) - now < 30 * 86400_000) return true;
  return !cert.checkIssued(ca);
}

export interface Certs { key: string; cert: string; caPem: string; caDer: Buffer; caFingerprint: string; ips: string[] }

const readCert = (f: string) => { try { return new X509Certificate(readFileSync(f)) } catch { return null } };
export const caFingerprint = (ca: X509Certificate) => ca.fingerprint256;
export function readCa(dir: string): X509Certificate | null { return readCert(join(dir, 'ca.crt')) }

/** Make sure `dir` holds a CA and a server certificate for the current IPs; returns what the HTTPS server needs. */
export function ensureCerts(dir: string, ips: string[] = lanIps(), openssl = findOpenssl()): Certs {
  mkdirSync(dir, { recursive: true });
  const f = (n: string) => join(dir, n);
  const run = (args: string[]) => {
    if (!openssl) throw Error('openssl was not found. Install it, add it to PATH or set CT_OPENSSL to its full path.');
    execFileSync(openssl, args, { cwd: dir, stdio: 'pipe', env: { ...process.env, OPENSSL_CONF: f('req.cnf') } });
  };
  // A minimal config of our own: Git for Windows' openssl often can't find its default openssl.cnf.
  writeFileSync(f('req.cnf'), '[req]\ndistinguished_name = dn\nprompt = no\n[dn]\nCN = Chart Terminal\n');
  let ca = readCa(dir);
  if (!ca || !existsSync(f('ca.key'))) {
    run(['req', '-x509', '-new', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '3650', '-config', 'req.cnf',
      '-keyout', 'ca.key', '-out', 'ca.crt', '-subj', '/CN=' + CA_NAME,
      '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign']);
    ca = readCa(dir)!;
  }
  if (needsNewCert(readCert(f('server.crt')), ips, ca)) {
    writeFileSync(f('server.ext'), [
      'basicConstraints = CA:FALSE', 'keyUsage = critical,digitalSignature,keyEncipherment', 'extendedKeyUsage = serverAuth',
      'subjectAltName = ' + sanList(ips).join(','), ''].join('\n'));
    run(['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-config', 'req.cnf', '-keyout', 'server.key', '-out', 'server.csr', '-subj', '/CN=Chart Terminal']);
    run(['x509', '-req', '-in', 'server.csr', '-CA', 'ca.crt', '-CAkey', 'ca.key', '-set_serial', '0x' + randomBytes(16).toString('hex'),
      '-days', String(SERVER_DAYS), '-sha256', '-extfile', 'server.ext', '-out', 'server.crt']);
    rmSync(f('server.csr'), { force: true });
  }
  for (const k of ['ca.key', 'server.key']) try { chmodSync(f(k), 0o600) } catch { /* not supported on this FS */ }
  return { key: readFileSync(f('server.key'), 'utf8'), cert: readFileSync(f('server.crt'), 'utf8'), caPem: ca.toString(), caDer: ca.raw, caFingerprint: caFingerprint(ca), ips };
}

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** iOS configuration profile that installs the CA as a trusted root (the user still has to enable full trust). */
export function mobileconfig(caDer: Buffer, uuid: () => string = randomUUID): string {
  const b64 = caDer.toString('base64').replace(/.{1,64}/g, '\t\t\t$&\n');
  const id = 'local.chart-terminal.ca';
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>PayloadContent</key>
	<array>
		<dict>
			<key>PayloadCertificateFileName</key><string>chart-terminal-ca.cer</string>
			<key>PayloadContent</key>
			<data>
${b64}			</data>
			<key>PayloadDescription</key><string>${xml(CA_NAME)}</string>
			<key>PayloadDisplayName</key><string>${xml(CA_NAME)}</string>
			<key>PayloadIdentifier</key><string>${id}.root</string>
			<key>PayloadType</key><string>com.apple.security.root</string>
			<key>PayloadUUID</key><string>${uuid().toUpperCase()}</string>
			<key>PayloadVersion</key><integer>1</integer>
		</dict>
	</array>
	<key>PayloadDescription</key><string>Trust the certificate of Chart Terminal on your home network.</string>
	<key>PayloadDisplayName</key><string>Chart Terminal</string>
	<key>PayloadIdentifier</key><string>${id}</string>
	<key>PayloadRemovalDisallowed</key><false/>
	<key>PayloadType</key><string>Configuration</string>
	<key>PayloadUUID</key><string>${uuid().toUpperCase()}</string>
	<key>PayloadVersion</key><integer>1</integer>
</dict>
</plist>
`;
}
