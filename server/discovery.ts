// LAN discovery beacon: while Home network access is on, the server broadcasts a small JSON datagram every 2 s on UDP 41771 to the
// broadcast address of each private IPv4 interface, so the phone / desktop app can list "Servers on this network" without typing an address.
//   { ct: 1, id, name, urls: ["https://192.168.1.20:8443", "http://192.168.1.20:8787"], v, mode: 'private' | 'public', twofa: boolean }
// No secrets, no account names, nothing that is not already in GET /api/auth/status. Same subnet only: routers do not forward broadcasts, and
// guest Wi-Fi with client isolation drops them. Off with CT_DISCOVERY=0 (or the `discovery` switch of POST /api/lan). Never started on a loopback-only server.
// No database here (lan.ts passes everything in), so the pure parts are unit-testable. Also holds the LAN state that pairing.ts reads for its URL list.
import dgram from 'node:dgram';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

export const BEACON_PORT = 41771;
export interface BeaconInfo { id: string; name: string; urls: string[]; v: string; mode: 'private' | 'public'; twofa: boolean }
type Ifaces = Record<string, NetworkInterfaceInfo[] | undefined>;

/** Wire format of one datagram. */
export const buildBeacon = (i: BeaconInfo): Buffer =>
  Buffer.from(JSON.stringify({ ct: 1, id: i.id, name: i.name.slice(0, 60), urls: i.urls.slice(0, 8), v: i.v, mode: i.mode, twofa: !!i.twofa }));

/** RFC 1918 / link-local IPv4 (the only networks a beacon is ever sent to). */
export const isPrivateV4 = (a: string) => { const m = a.match(/^(\d+)\.(\d+)\.\d+\.\d+$/); if (!m) return false; const [x, y] = [+m[1], +m[2]]; return x === 10 || (x === 172 && y >= 16 && y <= 31) || (x === 192 && y === 168) || (x === 169 && y === 254) };
const toInt = (a: string) => a.split('.').reduce((n, p) => n * 256 + +p, 0);
const toIp = (n: number) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');

/** One entry per private, non-loopback IPv4 interface: its address and the directed broadcast address of its subnet. */
export function broadcastTargets(ifaces: Ifaces = networkInterfaces()): { ip: string; bcast: string }[] {
  const out: { ip: string; bcast: string }[] = [];
  for (const list of Object.values(ifaces)) for (const i of list ?? []) {
    if (i.family !== 'IPv4' || i.internal || !isPrivateV4(i.address) || !/^\d+\.\d+\.\d+\.\d+$/.test(i.netmask)) continue;
    const mask = toInt(i.netmask), bcast = toIp(((toInt(i.address) & mask) | (~mask >>> 0)) >>> 0);
    if (bcast !== i.address) out.push({ ip: i.address, bcast });
  }
  return out;
}

/** Server URLs a client can use on this network: https first (Home network access), then plain http when the HTTP listener is not loopback-only. */
export function lanUrls(o: { ips: string[]; httpsPort: number | null; host: string; httpPort: number }): string[] {
  const all = o.host === '0.0.0.0' || o.host === '::';
  return [
    ...(o.httpsPort ? o.ips.map(ip => `https://${ip}:${o.httpsPort}`) : []),
    ...o.ips.filter(ip => all || ip === o.host).map(ip => `http://${ip}:${o.httpPort}`),
  ];
}

/** Stable random server id kept in the data directory (so a client can recognise the same server on a new address). */
export function serverId(dir: string): string {
  const f = join(dir, 'server-id');
  try { const s = readFileSync(f, 'utf8').trim(); if (/^[0-9a-f]{16}$/.test(s)) return s } catch {}
  const id = randomBytes(8).toString('hex');
  try { mkdirSync(dir, { recursive: true }); if (!existsSync(f)) writeFileSync(f, id) } catch {}
  return id;
}

export const discoveryEnabled = (env: Record<string, string | undefined> = process.env, setting = true) =>
  !['0', 'false', 'no', 'off'].includes((env.CT_DISCOVERY ?? '').trim().toLowerCase()) && setting;

/** Send the beacon every `every` ms from one socket per interface (so the datagram leaves by the right adapter, VPN or not). */
export function startBeacon(info: () => BeaconInfo, o: { every?: number; port?: number; ifaces?: () => Ifaces; send?: (sock: dgram.Socket, data: Buffer, port: number, to: string) => void } = {}) {
  const socks = new Map<string, dgram.Socket>(), port = o.port ?? BEACON_PORT;
  const drop = (ip: string) => { try { socks.get(ip)?.close() } catch {} socks.delete(ip) };
  const tick = () => {
    const t = broadcastTargets(o.ifaces?.()), data = buildBeacon(info());
    for (const ip of [...socks.keys()]) if (!t.some(x => x.ip === ip)) drop(ip);
    for (const { ip, bcast } of t) {
      let s = socks.get(ip);
      if (!s) {
        s = dgram.createSocket('udp4'); socks.set(ip, s);
        s.on('error', () => drop(ip));
        s.bind(0, ip, () => { try { s!.setBroadcast(true) } catch { drop(ip) } });
      }
      try { (o.send ?? ((k, d, p, a) => k.send(d, p, a)))(s, data, port, bcast) } catch {}   // not bound yet on the first tick: the next one sends
    }
  };
  tick();
  const timer = setInterval(tick, o.every ?? 2000); timer.unref();
  return { stop() { clearInterval(timer); for (const ip of [...socks.keys()]) drop(ip) } };
}

// ---------- LAN state (set by lan.ts, read by pairing.ts) ----------
let lanHttps: number | null = null, sender: { stop(): void } | null = null;
export const lanHttpsPort = () => lanHttps;

let ver = '';
const version = () => ver ||= (() => { try { return String(JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8')).version ?? 'unknown') } catch { return 'unknown' } })();

/** lan.ts calls this when HTTPS on the LAN starts; it also starts the beacon unless discovery is off. */
export function lanStarted(o: { httpsPort: number; dir: string; host: string; httpPort: number; name: string; twofa: () => boolean; discovery: boolean }) {
  lanHttps = o.httpsPort;
  sender?.stop(); sender = null;
  if (!o.discovery) return;
  const id = serverId(o.dir);
  sender = startBeacon(() => ({ id, name: o.name, urls: lanUrls({ ips: broadcastTargets().map(t => t.ip), httpsPort: o.httpsPort, host: o.host, httpPort: o.httpPort }), v: version(), mode: 'private', twofa: o.twofa() }));
}
export function lanStopped() { lanHttps = null; sender?.stop(); sender = null }
