// The data side of the crypto market symbols: CoinGecko's public keyless endpoints (fixed host, polite gap, cache,
// stale copy with a label, backoff after 429/403) plus Binance candles. All I/O is injected, so the server (node fetch)
// and the standalone browser (window.fetch) use the same code and the tests need no network.
import { APPROX_NOTE, DOM_SYMS, approxComps, candleAssets, domOf, merge, parseChart, parseGlobal, parseMarkets, backoffMs, compNow, type Coin, type Comp, type DomBar, type Pt, type Snap } from './dominance.ts';
import type { Bar } from '../data.ts';

const CG = 'https://api.coingecko.com/api/v3';   // the only CoinGecko host; paths below are built from constants, never from user input
const STALE_MAX = 7 * 86400_000, GAP = 2500, CANDLE_BUDGET = 1200, CANDLE_CACHE = 400, POOL = 6;
const TTL = { global: 120_000, markets: 300_000, chart: 6 * 3600_000 };
const UNIT: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400, w: 604800, M: 2592000 };

export interface DomDeps {
  fetch(url: string, init?: RequestInit): Promise<Response>;
  now(): number;
  sleep(ms: number): Promise<void>;
  /** Binance candles of `<pair>` at `tf` ending before `until` (ms), ascending; the app's own fetchBars. */
  candles(pair: string, tf: string, until?: number): Promise<Bar[]>;
}
/** What the server's recorder offers: snapshots in a time window, and the very first one. */
export interface DomStore { read(from: number, to: number): Snap[]; first(): Snap | null }
export interface DomStatus { blockedUntil: number; fails: number; lastOk: number; stale: boolean; lastError: string }

export function createDominance(d: DomDeps) {
  const cache = new Map<string, { at: number; v: unknown }>();
  const st: DomStatus = { blockedUntil: 0, fails: 0, lastOk: 0, stale: false, lastError: '' };
  let chain: Promise<unknown> = Promise.resolve(), lastHit = 0;

  /** One CoinGecko GET, serialised with a gap between requests. A failure returns the last copy (flagged) or throws a plain sentence. */
  async function cg<T>(path: string, ttl: number, parse: (j: unknown) => T): Promise<{ data: T; stale: boolean; at: number }> {
    const hit = cache.get(path);
    if (hit && d.now() - hit.at < ttl) return { data: hit.v as T, stale: false, at: hit.at };
    const fallback = (why: string) => {
      st.lastError = why;
      if (hit && d.now() - hit.at < STALE_MAX) { st.stale = true; return { data: hit.v as T, stale: true, at: hit.at } }
      throw Error(why);
    };
    if (d.now() < st.blockedUntil) return fallback(`CoinGecko is not answering this network (${st.lastError || 'rate limited'}); next try in ${Math.ceil((st.blockedUntil - d.now()) / 1000)} s`);
    const run = chain.then(async () => {
      const again = cache.get(path);   // an earlier queued call may have filled it
      if (again && d.now() - again.at < ttl) return { data: again.v as T, stale: false, at: again.at };
      const wait = GAP - (d.now() - lastHit);
      if (wait > 0) await d.sleep(wait);
      lastHit = d.now();
      try {
        const r = await d.fetch(CG + path, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
        if (!r.ok) {
          st.fails++; st.blockedUntil = d.now() + backoffMs(st.fails, Number(r.headers.get('retry-after')) || undefined);
          throw Error(r.status === 429 ? 'CoinGecko rate limit (HTTP 429)' : r.status === 403 || r.status === 451 ? `CoinGecko refused this network (HTTP ${r.status}; some VPNs and countries are blocked)` : `CoinGecko HTTP ${r.status}`);
        }
        const v = parse(await r.json());
        cache.set(path, { at: d.now(), v }); st.fails = 0; st.blockedUntil = 0; st.lastOk = d.now(); st.stale = false; st.lastError = '';
        return { data: v, stale: false, at: d.now() };
      } catch (e) {
        const why = e instanceof Error ? e.message : String(e), known = /^CoinGecko/.test(why);
        if (!known) { st.fails++; st.blockedUntil = d.now() + backoffMs(st.fails) }   // network error or timeout
        return fallback(known ? why : `CoinGecko unreachable: ${why.slice(0, 120)}`);
      }
    });
    chain = run.catch(() => {});
    return run as Promise<{ data: T; stale: boolean; at: number }>;
  }

  /** Total market cap and the top 100 coins, as of the last good answer. */
  async function snapshot(): Promise<{ total: number; coins: Coin[]; stale: boolean; at: number }> {
    const [g, m] = [await cg('/global', TTL.global, parseGlobal), await cg('/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1', TTL.markets, parseMarkets)];
    return { total: g.data.total, coins: m.data, stale: g.stale || m.stale, at: Math.min(g.at, m.at) };
  }
  /** Real market-cap history (about a year, daily) of USDT and USDC: supply moved a lot, so price x current supply would be wrong. */
  async function charts(): Promise<Record<string, Pt[]>> {
    const out: Record<string, Pt[]> = {};
    for (const id of ['tether', 'usd-coin']) { try { out[id] = (await cg(`/coins/${id}/market_chart?vs_currency=usd&days=365`, TTL.chart, parseChart)).data } catch { /* flat at today's cap */ } }
    return out;
  }

  // Binance side: a short cache, a bounded map and a per-minute budget, so many charts cannot multiply upstream calls.
  const cc = new Map<string, { at: number; bars: Bar[] }>(), spent = { min: 0, n: 0 };
  async function candle(base: string, tf: string, until?: number): Promise<Bar[]> {
    const k = `${base}|${tf}|${until ?? ''}`, hit = cc.get(k);
    if (hit && d.now() - hit.at < (until === undefined ? 25_000 : 600_000)) return hit.bars;
    const m = Math.floor(d.now() / 60_000);
    if (spent.min !== m) { spent.min = m; spent.n = 0 }
    if (++spent.n > CANDLE_BUDGET) throw Error('Too many candle requests for the crypto market series; try again in a minute');
    const bars = await d.candles(base + 'USDT', tf, until);
    cc.set(k, { at: d.now(), bars });
    if (cc.size > CANDLE_CACHE) cc.delete(cc.keys().next().value!);
    return bars;
  }
  async function pool<T, R>(items: T[], f: (x: T) => Promise<R>): Promise<R[]> {
    const out: R[] = new Array(items.length); let i = 0;
    await Promise.all(Array.from({ length: Math.min(POOL, items.length) }, async () => { while (i < items.length) { const j = i++; out[j] = await f(items[j]) } }));
    return out;
  }

  /** Bars of `sym` ("BTC.D") at `tf`, newest `limit`, each flagged `approx`. `store` blends in the recorded series. */
  async function bars(sym: string, tf: string, until?: number, limit = 1000, store?: DomStore | null): Promise<{ bars: DomBar[]; base: string; stale: boolean }> {
    if (!domOf(sym)) throw Error(`Unknown symbol CRYPTOCAP:${sym}`);
    if (!/^\d+[mhdwM]$/.test(tf) || +tf.slice(0, -1) * UNIT[tf.at(-1)!] < 60) throw Error('The crypto market series start at the 1 minute interval');
    const snap = await snapshot(), assets = candleAssets(snap.coins), ch = await charts();
    const got = await pool(assets, a => candle(a, tf, until).catch(e => (a === 'BTC' || a === 'ETH' ? Promise.reject(e) : [] as Bar[])));
    const candles = Object.fromEntries(assets.map((a, i) => [a, got[i]]));
    const cb = approxComps(candles, snap.coins, snap.total, ch);
    const snaps = store && cb.length ? store.read(cb[0].time, cb.at(-1)!.time + UNIT[tf.at(-1)!] * +tf.slice(0, -1)) : [];
    return { bars: merge(sym, cb, snaps, tf, store?.first()).slice(-limit), base: tf, stale: snap.stale };
  }
  /** Components of right now (what the recorder stores); null-safe for callers that only want to try. */
  async function now(): Promise<{ t: number; c: Comp; stale: boolean }> {
    const s = await snapshot();
    return { t: Math.floor(d.now() / 1000), c: compNow(s.total, s.coins), stale: s.stale };
  }
  const status = (): DomStatus => ({ ...st });
  return { bars, now, snapshot, status, APPROX_NOTE, symbols: DOM_SYMS };
}
