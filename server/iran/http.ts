// Shared HTTP for the Iranian data sources: one fetch seam (tests replace it), a response cache that falls back to the
// last good copy when the source is down, and a polite gap between requests to the same host.
// None of these sources has an official, documented, stable public API for charts, so every call is defensive and
// every base URL can be redirected with an environment variable (CT_NOBITEX_BASE, CT_TGJU_BASE, CT_TSE_BASE).

export const deps = {
  fetch: (url: string, init?: RequestInit): Promise<Response> => fetch(url, init),
  now: () => Date.now(),
  sleep: (ms: number) => new Promise<void>(r => setTimeout(r, ms)),
};

const cache = new Map<string, { at: number; v: unknown }>();
const lastHit = new Map<string, number>();
const STALE_MAX = 24 * 3600_000;
const UA = 'Mozilla/5.0 (compatible; ChartTerminal)';

export interface GetOpts { ttl?: number; gap?: number; method?: 'GET' | 'POST'; body?: string; headers?: Record<string, string>; timeout?: number }
export interface Got<T> { data: T; stale: boolean }

/** JSON from `url`. A failure returns the last copy (up to 24 h old) flagged `stale`; with no copy it throws. */
export async function fetchJson<T>(url: string, o: GetOpts = {}): Promise<Got<T>> {
  const key = `${o.method ?? 'GET'} ${url} ${o.body ?? ''}`, ttl = o.ttl ?? 0, hit = cache.get(key);
  if (hit && deps.now() - hit.at < ttl) return { data: hit.v as T, stale: false };
  const host = new URL(url).host, wait = (o.gap ?? 300) - (deps.now() - (lastHit.get(host) ?? 0));
  if (wait > 0) await deps.sleep(wait);
  lastHit.set(host, deps.now());
  try {
    const r = await deps.fetch(url, {
      method: o.method ?? 'GET',
      headers: { 'user-agent': UA, accept: 'application/json, text/plain, */*', ...(o.body ? { 'content-type': 'application/json' } : {}), ...o.headers },
      ...(o.body ? { body: o.body } : {}),
      signal: AbortSignal.timeout(o.timeout ?? 15_000),
    });
    if (!r.ok) throw Error(`${host}: HTTP ${r.status}`);
    const text = await r.text();
    let v: unknown;
    try { v = JSON.parse(text) } catch { throw Error(`${host}: answered with a page instead of JSON`) }
    cache.set(key, { at: deps.now(), v });
    return { data: v as T, stale: false };
  } catch (e) {
    if (hit && deps.now() - hit.at < STALE_MAX) return { data: hit.v as T, stale: true };
    throw e;
  }
}
export const clearCache = () => { cache.clear(); lastHit.clear() };

/** Digits, minus and dot only: "1,234.5" → 1234.5, Persian digits included. Empty or junk → NaN. */
export function toNum(x: unknown): number {
  if (typeof x === 'number') return x;
  if (typeof x !== 'string') return NaN;
  const s = x.replace(/[۰-۹]/g, c => String(c.charCodeAt(0) - 0x06f0)).replace(/[٠-٩]/g, c => String(c.charCodeAt(0) - 0x0660)).replace(/[٬,\s]/g, '').replace(/[^\d.\-eE+]/g, '');
  return s === '' ? NaN : Number(s);
}
