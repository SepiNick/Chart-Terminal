// In-memory failure gate for second factors and pairing codes: `max` failures inside `windowMs` lock the key for `lockMs`.
// Memory only, on purpose: a restart is not a way around it for an attacker who has to hold the password first, and nothing is persisted.
export function failGate(max: number, windowMs: number, lockMs: number) {
  const m = new Map<string, { n: number; at: number; until: number }>();
  return {
    /** Seconds to wait, 0 when the key may try. */
    wait(key: string): number { const r = m.get(key), t = Date.now(); return r && r.until > t ? Math.ceil((r.until - t) / 1000) : 0 },
    fail(key: string) {
      const t = Date.now(), r = m.get(key), n = r && t - r.at < windowMs ? r.n + 1 : 1;
      m.set(key, { n, at: r && t - r.at < windowMs ? r.at : t, until: n >= max ? t + lockMs : 0 });
      if (m.size > 5000) for (const [k, v] of m) if (v.until < t && t - v.at > windowMs) m.delete(k);
    },
    ok(key: string) { m.delete(key) },
  };
}
/** IPv6 clients share one key per /64 (one machine cannot dodge a limit by rotating addresses inside it). */
export function addrKey(ip: string): string {
  ip = ip.toLowerCase().replace(/^::ffff:/, '');
  return ip.includes(':') ? ip.split(':').slice(0, 4).join(':') + '::/64' : ip;
}
