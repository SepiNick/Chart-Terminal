// "CCXT in the app": the Android standalone app (no data server) runs CCXT itself, loaded lazily from a script bundle, and
// serves the same EXCH:SYMBOL series the server's /api/bars would (symbol and timeframe rules copied from server/ccxt.ts and
// server/market.ts, which are node-only). Everything the outside world supplies (library, clock, storage) is injected, so
// the tests need no network. Safe to import in node.
import { aggregate, bucket, tfSeconds, type Bar, type RemoteMarket } from '../data.ts';

export interface Market { sym: string; ccxt: string; base: string; quote: string; type: string; active: boolean }
export interface CcxtEx {
  has: Record<string, unknown>; timeframes?: Record<string, unknown>; options?: Record<string, unknown>;
  loadMarkets(): Promise<Record<string, unknown>>;
  fetchOHLCV(symbol: string, tf: string, since?: number, limit?: number): Promise<(number | undefined)[][]>;
  fetchTickers?(): Promise<Record<string, { symbol?: string; last?: number; percentage?: number; quoteVolume?: number }>>;
}
export interface Kv { get(k: string): Promise<string | undefined>; set(k: string, v: string): Promise<void> }
export interface AppDeps {
  /** Constructor of a CCXT exchange class (loads the script bundle on first use). Rejects for an unknown id. */
  ctor(id: string): Promise<new (o: object) => CcxtEx>;
  /** Resolves after `ms`, or at once (clearing its timer) when `signal` aborts. */
  now(): number; sleep(ms: number, signal?: AbortSignal): Promise<void>; kv: Kv;
  visible?(): boolean;
}

export const TTL = 3600_000, MAX_MEM = 8, POLL = 3000, POLL_MAX = 60_000;

/** Default list of the in-app source (ids are CCXT ids; the same ids the server uses). */
export const DEFAULT_EXCHANGES = ['binance', 'binanceusdm', 'bybit', 'okx', 'kraken', 'coinbase', 'kucoin', 'bitget', 'gate', 'mexc', 'htx', 'bitfinex', 'bitstamp', 'gemini', 'cryptocom',
  'deribit', 'phemex', 'bingx', 'lbank', 'whitebit', 'upbit', 'bithumb', 'poloniex', 'bitvavo'];   // hyperliquid is left out until the native proxy can forward POST bodies (its API is POST-only)
/** Option-market downloads are dropped where the exchange takes a type list (they are never charted: symOf returns null). */
const LOAD_TYPES: Record<string, string[]> = { bybit: ['spot', 'linear', 'inverse'], okx: ['spot', 'future', 'swap'] };

/** Our symbol for a CCXT market (null for options and other kinds we don't chart). Same output as server/ccxt.ts symOf. */
export function symOf(m: { base: string; quote: string; type?: string; settle?: string; expiry?: number }): string | null {
  const clean = (s: string) => s.replace(/[^A-Z0-9]/gi, '').toUpperCase();
  const pair = `${clean(m.base)}_${clean(m.quote)}`;
  if (m.type === 'spot') return pair;
  if (m.type === 'swap') return `${pair}.P${m.settle && clean(m.settle) !== clean(m.quote) ? clean(m.settle) : ''}`;
  if (m.type === 'future' && m.expiry) return `${pair}.F${new Date(m.expiry).toISOString().slice(2, 10).replace(/-/g, '')}`;
  return null;
}
/** The exchange's largest native timeframe that evenly divides `tf` (months excluded from division). Same as server/ccxt.ts nativeBase. */
export function nativeBase(supported: string[], tf: string): { base: string; n: number } | null {
  if (supported.includes(tf)) return { base: tf, n: 1 };
  const sec = tfSeconds(tf);
  const ok = supported.filter(s => /^\d+[smhdwM]$/.test(s) && !s.endsWith('M') && sec % tfSeconds(s) === 0).sort((a, b) => tfSeconds(b) - tfSeconds(a));
  return ok.length ? { base: ok[0], n: sec / tfSeconds(ok[0]) } : null;
}
const row2bar = (r: (number | undefined)[]): Bar => ({ time: (r[0] as number) / 1000, open: r[1] as number, high: r[2] as number, low: r[3] as number, close: r[4] as number, volume: r[5] ?? 0 });

interface Entry { at: number; list: Market[]; map: Map<string, Market> }
const entryOf = (at: number, list: Market[]): Entry => ({ at, list, map: new Map(list.map(m => [m.sym, m])) });

export function createCcxtApp(d: AppDeps) {
  const exs = new Map<string, Promise<CcxtEx>>(), mem = new Map<string, Entry>(), inflight = new Map<string, Promise<Entry>>();

  const exOf = (id: string) => {
    let p = exs.get(id);
    if (!p) {
      p = d.ctor(id).then(C => {
        const x = new C({ enableRateLimit: true, timeout: 15000 });
        const t = LOAD_TYPES[id];
        if (t && x.options && Array.isArray(x.options['fetchMarkets'])) x.options['fetchMarkets'] = t;   // only where the option is a list
        return x;
      });
      exs.set(id, p); p.catch(() => exs.delete(id));
    }
    return p;
  };
  const remember = (id: string, e: Entry) => { mem.delete(id); mem.set(id, e); if (mem.size > MAX_MEM) mem.delete(mem.keys().next().value!) };

  async function refresh(id: string): Promise<Entry> {
    let p = inflight.get(id);
    if (!p) {
      p = (async () => {
        const ms = await (await exOf(id)).loadMarkets();
        const list: Market[] = [], seen = new Set<string>();
        for (const m of Object.values(ms) as { base: string; quote: string; type?: string; settle?: string; expiry?: number; symbol: string; active?: boolean }[]) {
          if (!m) continue;
          const sym = symOf(m);
          if (!sym || seen.has(sym)) continue;
          seen.add(sym); list.push({ sym, ccxt: m.symbol, base: m.base, quote: m.quote, type: m.type ?? 'spot', active: m.active !== false });
        }
        const e = entryOf(d.now(), list);
        remember(id, e);
        await d.kv.set('v1:' + id, JSON.stringify({ at: e.at, list: list.map(m => [m.sym, m.ccxt, m.base, m.quote, m.type, m.active ? 1 : 0]) })).catch(() => {});
        return e;
      })().finally(() => inflight.delete(id));
      inflight.set(id, p);
    }
    return p;
  }
  async function stored(id: string): Promise<Entry | undefined> {
    try {
      const j = JSON.parse((await d.kv.get('v1:' + id)) ?? 'null') as { at: number; list: [string, string, string, string, string, number][] } | null;
      return j && Array.isArray(j.list) ? entryOf(j.at, j.list.map(([sym, ccxt, base, quote, type, a]) => ({ sym, ccxt, base, quote, type, active: !!a }))) : undefined;
    } catch { return undefined }
  }
  /** Market list of an exchange: memory, then storage (an hour old or more is served at once and refreshed in the background), then the exchange. */
  async function markets(id: string): Promise<Entry> {
    let e = mem.get(id) ?? await stored(id);
    if (!e) return refresh(id);
    remember(id, e);
    if (d.now() - e.at >= TTL) refresh(id).catch(() => {});
    return e;
  }
  /** Active markets in the shape the symbol search takes. */
  const marketList = async (id: string): Promise<RemoteMarket[]> => (await markets(id)).list.filter(m => m.active).map(({ sym, base, quote, type }) => ({ sym, base, quote, type }));

  async function ohlcv(id: string, sym: string, tf: string, until?: number, limit = 1000): Promise<{ bars: Bar[]; base: string; n: number }> {
    const m = (await markets(id)).map.get(sym);
    if (!m) throw Error(`Unknown market ${id}:${sym}`);
    const x = await exOf(id);
    if (!x.has['fetchOHLCV']) throw Error(`${id} does not provide candles`);
    const nb = nativeBase(Object.keys(x.timeframes ?? {}), tf);
    if (!nb) throw Error(`${id} has no timeframe compatible with ${tf}`);
    const want = Math.min(1500, limit * nb.n);
    if (!until) return { bars: (await x.fetchOHLCV(m.ccxt, nb.base, undefined, Math.min(want, 1000))).map(row2bar), base: nb.base, n: nb.n };
    // Exchanges cap candles per request and page forward from `since`, so walk pages until `until`.
    const step = tfSeconds(nb.base) * 1000, bars: Bar[] = [];
    let from = until - want * step;
    for (let page = 0; page < 8 && from < until; page++) {
      const rows = await x.fetchOHLCV(m.ccxt, nb.base, from, Math.min(want, 1000));
      if (!rows.length) break;
      for (const r of rows) { const b = row2bar(r); if (b.time * 1000 <= until && (!bars.length || b.time > bars.at(-1)!.time)) bars.push(b) }
      const next = (rows.at(-1)![0] as number) + step;
      if (next <= from) break;
      from = next;
    }
    return { bars, base: nb.base, n: nb.n };
  }
  /** Up to `limit` bars of `tf` ending at `until` (ms; latest when omitted). Non-native timeframes are aggregated; a partial first bucket is dropped. */
  async function bars(id: string, sym: string, tf: string, until?: number, limit = 1000): Promise<Bar[]> {
    const r = await ohlcv(id, sym, tf, until, limit);
    if (r.n === 1) return r.bars;
    const out = aggregate(r.bars, tfSeconds(tf));
    return out.length > 1 && r.bars[0].time !== out[0].time ? out.slice(1) : out;
  }

  /** Live bars by polling the newest candles: every POLL ms (backing off after errors, idle while the page is hidden). */
  function stream(id: string, sym: string, tf: string, onBar: (b: Bar) => void): () => void {
    const stopper = new AbortController(), S = tfSeconds(tf);
    let alive = true, wait = POLL, warned = false;
    (async () => {
      while (alive) {
        await d.sleep(wait, stopper.signal);
        if (!alive) break;
        if (d.visible && !d.visible()) continue;
        try {
          const m = (await markets(id)).map.get(sym);
          const x = await exOf(id), nb = nativeBase(Object.keys(x.timeframes ?? {}), tf);
          if (!m || !nb) throw Error('no market');
          // aggregated: ask from the start of the current bucket so the newest bucket is whole (n base bars, one spare)
          const rows = (await x.fetchOHLCV(m.ccxt, nb.base, nb.n === 1 ? undefined : bucket(d.now() / 1000, S) * 1000, nb.n === 1 ? 2 : nb.n + 1)).map(row2bar);
          if (!alive) break;
          if (nb.n === 1) rows.forEach(onBar);
          else { const a = rows.length ? aggregate(rows, S).at(-1) : undefined; if (a && rows[0].time <= a.time) onBar(a) }   // base candles must reach the bucket start, else it is partial
          wait = POLL; warned = false;
        } catch (e) {
          if (!warned) { warned = true; console.warn('ccxt stream failing, backing off: %s %s %s %s', id, sym, tf, (e as Error).message) }
          wait = Math.min(wait * 2, POLL_MAX);
        }
      }
    })();
    return () => { alive = false; stopper.abort() };
  }

  /** 24h tickers keyed by our symbols (empty when the exchange has no bulk tickers). */
  async function tickers(id: string): Promise<{ sym: string; last: number; change: number; quoteVolume: number }[]> {
    const x = await exOf(id);
    if (!x.has['fetchTickers'] || !x.fetchTickers) return [];
    const by = new Map((await markets(id)).list.map(m => [m.ccxt, m.sym]));
    return Object.values(await x.fetchTickers()).flatMap(k => { const sym = k.symbol ? by.get(k.symbol) : undefined; return sym && k.last ? [{ sym, last: k.last, change: k.percentage ?? 0, quoteVolume: k.quoteVolume ?? 0 }] : [] });
  }
  return { markets, marketList, bars, stream, tickers };
}
export type CcxtApp = ReturnType<typeof createCcxtApp>;

// ---------- exchange list: curated defaults plus what the user added (stored per device) ----------
export const EXTRA_KEY = 'ctccxtx';
type Sync = Pick<Storage, 'getItem' | 'setItem'>;
export const ID_RE = /^[a-z0-9]{2,32}$/;
export function extraExchanges(kv?: Sync): string[] {
  try { const l = JSON.parse(kv?.getItem(EXTRA_KEY) ?? '[]'); return Array.isArray(l) ? l.filter((x): x is string => typeof x === 'string' && ID_RE.test(x)) : [] } catch { return [] }
}
export const exchangeIds = (kv?: Sync) => [...new Set([...DEFAULT_EXCHANGES, ...extraExchanges(kv)])];
export function setExtra(kv: Sync | undefined, id: string, on: boolean) {
  if (!ID_RE.test(id)) throw Error('Exchange ids are lower case letters and digits, e.g. bitso');
  const l = extraExchanges(kv).filter(x => x !== id);
  try { kv?.setItem(EXTRA_KEY, JSON.stringify(on ? [...l, id] : l)) } catch {}
}
