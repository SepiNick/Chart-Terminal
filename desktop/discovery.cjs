'use strict';
// Listens for the LAN beacon (UDP 41771, JSON, sent by server/discovery.ts) and keeps a map of the servers heard.
// Only runs while the page polls list() (see main.cjs): it stops itself ~15 s after the last call.
const dgram = require('node:dgram');

const PORT = 41771, MAX_BYTES = 2048, TTL_MS = 10_000, MAX_SERVERS = 50, MAX_URLS = 8, IDLE_MS = 15_000;

// http(s) URL whose host is an IPv4 literal in a private LAN range (10/8, 172.16/12, 192.168/16, 169.254/16).
function lanUrl(u) {
  if (typeof u !== 'string' || u.length > 200) return null;
  let p; try { p = new URL(u) } catch { return null }
  if (p.protocol !== 'http:' && p.protocol !== 'https:') return null;
  if (p.username || p.password) return null;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(p.hostname);
  if (!m) return null;
  const [a, b] = [+m[1], +m[2]];
  if (m.slice(1).some(x => +x > 255)) return null;
  if (!(a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254))) return null;
  return p.origin;
}

// Pure: raw datagram -> {id,name,urls,v,mode,twofa} or null.
// `from` = the datagram's sender address: only URLs on that host are kept (a rogue cannot announce someone else's address).
function parseBeacon(buf, from) {
  if (!buf || buf.length === 0 || buf.length > MAX_BYTES) return null;
  let j; try { j = JSON.parse(buf.toString('utf8')) } catch { return null }
  if (!j || typeof j !== 'object' || Array.isArray(j) || j.ct !== 1) return null;
  if (typeof j.id !== 'string' || !/^[\w-]{1,64}$/.test(j.id)) return null;
  if (typeof j.name !== 'string' || j.name.length > 80) return null;
  if (!Array.isArray(j.urls)) return null;
  const urls = [...new Set(j.urls.slice(0, MAX_URLS).map(lanUrl).filter(u => u && new URL(u).hostname === from))];
  if (!urls.length) return null;
  return {
    id: j.id,
    name: j.name.replace(/[\u0000-\u001f\u007f]/g, '').trim() || 'Chart Terminal',
    urls,
    v: typeof j.v === 'string' ? j.v.slice(0, 32) : '',
    mode: j.mode === 'public' ? 'public' : 'private',
    twofa: j.twofa === true,
  };
}

// Pure: drop entries not heard within ttl, return a snapshot array (newest id order not guaranteed).
function expire(map, now, ttl = TTL_MS) {
  for (const [id, e] of map) if (now - e.seen > ttl) map.delete(id);
  return [...map.values()].map(e => ({ ...e.info, ageMs: now - e.seen }));
}

// Beacons from loopback are our own local server or something spoofed on this host: ignore.
const isLoopback = a => typeof a === 'string' && (a.startsWith('127.') || a === '::1');

function create({ port = PORT } = {}) {
  const map = new Map();
  let sock = null, idle = null;
  const stop = () => { clearTimeout(idle); idle = null; if (sock) { try { sock.close() } catch {} sock = null } map.clear() };
  const start = () => {
    if (sock) return;
    const s = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    s.on('error', () => { if (sock === s) stop() });   // port busy or no network: nothing heard, page just shows an empty list
    s.on('message', (msg, rinfo) => {
      if (isLoopback(rinfo.address)) return;
      const info = parseBeacon(msg, rinfo.address);
      if (!info) return;
      const key = rinfo.address + '|' + info.id;   // sender + id: a rogue reusing a real id cannot overwrite the real entry
      if (!map.has(key) && map.size >= MAX_SERVERS) return;
      map.set(key, { info, seen: Date.now() });
    });
    sock = s;
    try { s.bind(port) } catch { stop() }
  };
  return {
    // Called by the renderer's poll: starts listening on demand and keeps it alive.
    list() {
      start();
      clearTimeout(idle); idle = setTimeout(stop, IDLE_MS); idle.unref?.();
      return expire(map, Date.now());
    },
    stop,
  };
}

module.exports = { create, parseBeacon, expire, lanUrl, PORT };
