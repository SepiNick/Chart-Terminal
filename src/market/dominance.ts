// Crypto market series as ordinary symbols: CRYPTOCAP:BTC.D (dominance, in percent) and CRYPTOCAP:TOTAL (market cap, USD).
// Pure functions only (no fetch, no node APIs) so the server and the standalone browser share one implementation.
// Data honesty: no free keyless source has the history. Before the server's own recording starts, every bar is an
// APPROXIMATION: market cap = Binance close x current circulating supply (stablecoins: CoinGecko's market_chart),
// the part of the market outside the fetched coins scaled with the altcoin basket. See docs/dominance.md.
import type { Bar } from '../data.ts';

export const DOM_EX = 'cryptocap';
export const APPROX_NOTE = 'approximation from price × current supply';

export interface DomSym { sym: string; name: string; kind: 'share' | 'cap' }
export const DOM_SYMS: DomSym[] = [
  { sym: 'BTC.D', name: 'Bitcoin dominance', kind: 'share' },
  { sym: 'ETH.D', name: 'Ethereum dominance', kind: 'share' },
  { sym: 'USDT.D', name: 'Tether dominance', kind: 'share' },
  { sym: 'USDC.D', name: 'USDC dominance', kind: 'share' },
  { sym: 'OTHERS.D', name: 'Others dominance (without the top 10)', kind: 'share' },
  { sym: 'STABLE.D', name: 'Stablecoin share', kind: 'share' },
  { sym: 'TOTAL', name: 'Total crypto market cap', kind: 'cap' },
  { sym: 'TOTAL2', name: 'Total market cap without BTC', kind: 'cap' },
  { sym: 'TOTAL3', name: 'Total market cap without BTC and ETH', kind: 'cap' },
];
const bare = (s: string) => s.trim().toUpperCase().replace(/^CRYPTOCAP:/, '');
export const domOf = (s: string) => DOM_SYMS.find(d => d.sym === bare(s));
/** `btc.d` or `CRYPTOCAP:BTC.D` → `CRYPTOCAP:BTC.D`; anything else → null. */
export const asDomSym = (s: string) => { const d = domOf(s); return d ? `CRYPTOCAP:${d.sym}` : null };
export const isDomSym = (s: string) => /^CRYPTOCAP:/i.test(s) && !!domOf(s);
export const isShare = (s: string) => domOf(s)?.kind === 'share';

/** Axis text: "57.31%" for dominance, "2.45T" / "812.30B" for market caps. */
export function fmtDom(sym: string, v: number): string {
  if (!Number.isFinite(v)) return '';
  if (isShare(sym)) return v.toFixed(2) + '%';
  const a = Math.abs(v);
  return a >= 1e12 ? (v / 1e12).toFixed(3) + 'T' : a >= 1e9 ? (v / 1e9).toFixed(2) + 'B' : a >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : v.toFixed(0);
}

// ---------- components: everything a series is derived from, in USD ----------
export interface Comp { total: number; btc: number; eth: number; usdt: number; usdc: number; stable: number; top10: number }
const KEYS: (keyof Comp)[] = ['total', 'btc', 'eth', 'usdt', 'usdc', 'stable', 'top10'];
export const share = (part: number, total: number) => (total > 0 && Number.isFinite(part) ? (part / total) * 100 : NaN);
export function valueOf(sym: string, c: Comp): number {
  switch (bare(sym)) {
    case 'BTC.D': return share(c.btc, c.total);
    case 'ETH.D': return share(c.eth, c.total);
    case 'USDT.D': return share(c.usdt, c.total);
    case 'USDC.D': return share(c.usdc, c.total);
    case 'STABLE.D': return share(c.stable, c.total);
    case 'OTHERS.D': return share(c.total - c.top10, c.total);
    case 'TOTAL': return c.total;
    case 'TOTAL2': return c.total - c.btc;
    case 'TOTAL3': return c.total - c.btc - c.eth;
  }
  return NaN;
}

// ---------- CoinGecko replies (fixtures in dominance.test.ts) ----------
export interface Coin { id: string; sym: string; cap: number; price: number; supply: number; stable: boolean; rank: number }
export type Pt = [number, number];   // [seconds, value]
/** Stablecoins priced at 1 USD. Fixed list: a wrong guess only moves STABLE.D slightly. */
export const STABLE_SYMS = new Set(['USDT', 'USDC', 'DAI', 'USDE', 'FDUSD', 'USDS', 'USD1', 'PYUSD', 'TUSD', 'USDD', 'BUSD', 'USDTB', 'GUSD', 'USDP', 'FRAX', 'RLUSD', 'USDG', 'USDF', 'USDX']);
/** Wrapped / staked tokens that follow another coin's price: their history follows that coin's candles. */
export const ALIAS: Record<string, string> = { WBTC: 'BTC', CBBTC: 'BTC', TBTC: 'BTC', WBETH: 'ETH', STETH: 'ETH', WSTETH: 'ETH', WETH: 'ETH', WEETH: 'ETH', RETH: 'ETH', CBETH: 'ETH' };

const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : NaN);
export function parseGlobal(j: unknown): { total: number; updated: number } {
  const d = (j as { data?: { total_market_cap?: { usd?: unknown }; updated_at?: unknown } } | null)?.data, total = num(d?.total_market_cap?.usd);
  if (!(total > 0)) throw Error('CoinGecko /global: unexpected reply (no total_market_cap.usd)');
  return { total, updated: num(d?.updated_at) || 0 };
}
/** /coins/markets rows → coins sorted by market cap (rank 0 = biggest). Rows without a cap or price are dropped. */
export function parseMarkets(j: unknown): Coin[] {
  if (!Array.isArray(j)) throw Error('CoinGecko /coins/markets: unexpected reply (not a list)');
  const rows: Coin[] = [];
  for (const r of j as Record<string, unknown>[]) {
    const cap = num(r?.['market_cap']), price = num(r?.['current_price']), sym = typeof r?.['symbol'] === 'string' ? r['symbol'].toUpperCase() : '', id = typeof r?.['id'] === 'string' ? r['id'] : '';
    if (!(cap > 0) || !(price > 0) || !sym || !id) continue;
    const supply = num(r?.['circulating_supply']) > 0 ? num(r['circulating_supply']) : cap / price;
    rows.push({ id, sym, cap, price, supply, stable: STABLE_SYMS.has(sym), rank: 0 });
  }
  if (rows.length < 10) throw Error('CoinGecko /coins/markets: unexpected reply (fewer than 10 coins)');
  rows.sort((a, b) => b.cap - a.cap);
  return rows.map((c, rank) => ({ ...c, rank }));
}
/** /coins/{id}/market_chart → [seconds, market cap] ascending. */
export function parseChart(j: unknown): Pt[] {
  const a = (j as { market_caps?: unknown } | null)?.market_caps;
  if (!Array.isArray(a)) throw Error('CoinGecko market_chart: unexpected reply (no market_caps)');
  const out: Pt[] = [];
  for (const p of a) if (Array.isArray(p) && num(p[0]) > 0 && num(p[1]) > 0) out.push([Math.floor(num(p[0]) / 1000), num(p[1])]);
  return out.sort((x, y) => x[0] - y[0]);
}
/** Components of "now" from a /global total and the coin list; the recorder stores exactly this. */
export function compNow(total: number, coins: Coin[]): Comp {
  const cap = (id: string) => coins.find(c => c.id === id)?.cap ?? 0, sum = (f: (c: Coin) => boolean) => coins.filter(f).reduce((a, c) => a + c.cap, 0);
  return { total, btc: cap('bitcoin'), eth: cap('ethereum'), usdt: cap('tether'), usdc: cap('usd-coin'), stable: sum(c => c.stable), top10: sum(c => c.rank < 10) };
}

// ---------- rate limit / backoff ----------
/** How long to stay away after the `fails`-th consecutive failure: Retry-After when given, else 30 s doubling, capped at 15 min. */
export function backoffMs(fails: number, retryAfterSec?: number): number {
  const cap = 900_000;
  if (retryAfterSec !== undefined && Number.isFinite(retryAfterSec) && retryAfterSec > 0) return Math.min(cap, Math.max(1000, retryAfterSec * 1000));
  return Math.min(cap, 30_000 * 2 ** Math.max(0, fails - 1));
}

// ---------- history by approximation ----------
const FIELDS = ['open', 'high', 'low', 'close'] as const;
type Field = (typeof FIELDS)[number];
export interface CompBar { time: number; f: Record<Field, Comp> }

/** `bars` resampled onto `times` (ascending): the last bar at or before each time, the first bar's value before it begins. Gaps stay flat. */
export function align(bars: Bar[], times: number[], f: Field): number[] {
  const out: number[] = []; let j = 0;
  for (const t of times) {
    while (j + 1 < bars.length && bars[j + 1].time <= t) j++;
    out.push(bars[j][f]);
  }
  return out;
}
/** A [seconds, value] series as a step function on `times` (value in force at each time; the first value before the series begins). */
export function stepAlign(pts: Pt[], times: number[]): number[] {
  const out: number[] = []; let j = 0;
  for (const t of times) {
    while (j + 1 < pts.length && pts[j + 1][0] <= t) j++;
    out.push(pts[j][1]);
  }
  return out;
}
/** The Binance base asset whose candles stand in for this coin (itself, or the coin a wrapped token follows). */
export const baseOf = (c: Coin) => ALIAS[c.sym] ?? c.sym;
/** Binance base assets to fetch candles for: the biggest `n` non-stable coins (BTC and ETH always included). */
export function candleAssets(coins: Coin[], n = 30): string[] {
  const set = new Set<string>(['BTC', 'ETH']);
  for (const c of coins) { if (set.size >= n) break; if (!c.stable) set.add(baseOf(c)) }
  return [...set];
}

/**
 * Component series from candles. cap(t) = Binance price(t) x current circulating supply. Coins without candles stay at
 * today's cap; stablecoins use `charts` (CoinGecko market caps by coin id) when given. The market outside the fetched list
 * (`totalNow` minus the list) moves with the altcoin basket (scaling assumption, see docs/dominance.md).
 * `candles` is keyed by Binance base asset ("BTC"); BTC and ETH are required.
 */
export function approxComps(candles: Record<string, Bar[] | undefined>, coins: Coin[], totalNow: number, charts: Record<string, Pt[] | undefined> = {}): CompBar[] {
  const master = candles['BTC'];
  if (!master?.length) throw Error('No BTC candles');
  if (!candles['ETH']?.length) throw Error('No ETH candles');
  const times = master.map(b => b.time), n = times.length;
  const zero = () => FIELDS.map(() => new Array<number>(n).fill(0)), sum = (a: number[][], b: number[][]) => a.forEach((x, k) => x.forEach((_, i) => (x[i] += b[k][i])));
  const acc: Record<keyof Comp, number[][]> = { total: zero(), btc: zero(), eth: zero(), usdt: zero(), usdc: zero(), stable: zero(), top10: zero() };
  const alt = zero();
  let listed = 0;
  for (const c of coins) {
    listed += c.cap;
    let bars = candles[baseOf(c)];
    // A pair that is delisted or is a different asset with the same ticker (XMR) is far from CoinGecko's price: not used.
    const r = bars?.length ? bars.at(-1)!.close / c.price : 1;
    if (baseOf(c) === c.sym && (r < 0.8 || r > 1.25) && !c.stable) bars = undefined;
    const ch = c.stable ? charts[c.id] : undefined;
    let caps: number[][];
    if (ch?.length) caps = FIELDS.map(() => stepAlign(ch, times));
    else if (!c.stable && bars?.length) {
      const direct = baseOf(c) === c.sym, ref = bars.at(-1)!.close;
      caps = FIELDS.map(f => align(bars, times, f).map(p => (direct ? p * c.supply : (c.cap * p) / ref)));
    } else caps = FIELDS.map(() => new Array<number>(n).fill(c.cap));
    sum(acc.total, caps);
    if (c.id === 'bitcoin') sum(acc.btc, caps);
    if (c.id === 'ethereum') sum(acc.eth, caps);
    if (c.id === 'tether') sum(acc.usdt, caps);
    if (c.id === 'usd-coin') sum(acc.usdc, caps);
    if (c.stable) sum(acc.stable, caps);
    if (c.rank < 10) sum(acc.top10, caps);
    if (!c.stable && bars?.length && !['BTC', 'ETH'].includes(baseOf(c))) sum(alt, caps);
  }
  const tail = Math.max(0, totalNow - listed), altRef = alt[3][n - 1];
  FIELDS.forEach((_, k) => { for (let i = 0; i < n; i++) acc.total[k][i] += altRef > 0 ? (tail * alt[k][i]) / altRef : tail });
  // CoinGecko's global total leaves out some listed tokens (wrapped / staked ones are in the list but not the total): the
  // series is scaled so its last bar equals the global total, the figure the recorder stores.
  const ref = acc.total[3][n - 1], k = ref > 0 ? totalNow / ref : 1;
  acc.total.forEach(a => a.forEach((_, i) => (a[i] *= k)));
  return times.map((time, i) => ({ time, f: Object.fromEntries(FIELDS.map((f, k) => [f, Object.fromEntries(KEYS.map(key => [key, acc[key][k][i]]))])) as unknown as CompBar['f'] }));
}

// ---------- recorded series and the blend ----------
export interface Snap { t: number; c: Comp }
/** Start of the bar that holds time `t` (seconds), like the exchange candles: weeks from Monday, months from the 1st (UTC). */
export function bucketFn(tf: string): (t: number) => number {
  const n = +tf.slice(0, -1), u = tf.at(-1)!;
  if (u === 'M') return t => { const d = new Date(t * 1000), m = d.getUTCFullYear() * 12 + d.getUTCMonth(), k = Math.floor(m / n) * n; return Date.UTC(Math.floor(k / 12), k % 12, 1) / 1000 };
  const sec = n * ({ s: 1, m: 60, h: 3600, d: 86400, w: 604800 }[u] ?? 60), a = sec % 604800 === 0 ? 345600 : 0;
  return t => Math.floor((t - a) / sec) * sec + a;
}
/** A bar of the crypto market series; `approx` is true while it is an approximation (not recorded). */
export type DomBar = Bar & { approx?: boolean };
const toBar = (sym: string, cb: CompBar, k: Comp | null, approx: boolean): DomBar => {
  const v = (f: Field) => valueOf(sym, k ? scale(cb.f[f], k) : cb.f[f]);
  const o = v('open'), c = v('close'), h = Math.max(o, c, v('high'), v('low')), l = Math.min(o, c, v('high'), v('low'));
  return { time: cb.time, open: o, high: h, low: l, close: c, volume: 0, approx };
};
const scale = (c: Comp, k: Comp): Comp => Object.fromEntries(KEYS.map(key => [key, c[key] * k[key]])) as unknown as Comp;
/** Recorded snapshots as bars: open = first, close = last, high/low = extremes of the value inside each bar. */
export function snapBars(sym: string, snaps: Snap[], tf: string): DomBar[] {
  const bucket = bucketFn(tf), out: DomBar[] = [];
  for (const s of snaps) {
    const v = valueOf(sym, s.c), t = bucket(s.t);
    if (!Number.isFinite(v)) continue;
    const last = out.at(-1);
    if (last && last.time === t) { last.high = Math.max(last.high, v); last.low = Math.min(last.low, v); last.close = v }
    else out.push({ time: t, open: v, high: v, low: v, close: v, volume: 0, approx: false });
  }
  return out;
}
/** Per-component ratio recorded / approximated at the first recorded snapshot: scaling the approximation by it removes the seam. */
export function seamRatio(cb: CompBar[], s0: Snap): Comp | null {
  let at: CompBar | undefined;
  for (const b of cb) { if (b.time <= s0.t) at = b; else break }
  if (!at) return null;
  const r = Object.fromEntries(KEYS.map(k => [k, at.f.close[k] > 0 && s0.c[k] > 0 ? s0.c[k] / at.f.close[k] : 1])) as unknown as Comp;
  return r;
}
/**
 * The final series: recorded bars where the recorder has them, the approximation everywhere else (before the recording
 * began and across gaps while the server was off), the approximation scaled so it meets the recorded values at `anchor`.
 * Every bar carries `approx`.
 */
export function merge(sym: string, cb: CompBar[], snaps: Snap[], tf: string, first?: Snap | null): DomBar[] {
  const rec = new Map(snapBars(sym, snaps, tf).map(b => [b.time, b]));
  const a = first && cb.length && first.t >= cb[0].time ? first : snaps[0];
  const k = a && cb.length ? seamRatio(cb, a) : null;
  const out: DomBar[] = [];
  for (const b of cb) out.push(rec.get(b.time) ?? toBar(sym, b, k, true));
  return out.filter(b => [b.open, b.high, b.low, b.close].every(Number.isFinite));
}
