// Pure matching and ranking for the symbol search (no DOM, no network): one list across all exchanges, or one exchange.
export interface SearchEntry { ex: string; sym: string; base: string; quote: string; type: string; name?: string }
export type Kind = 'spot' | 'perp' | 'future' | 'index' | 'other';

/** Exchanges shown first (and the only CCXT ones searched in the all-exchanges view: the server keeps few market lists in memory). */
export const POPULAR = ['binance', 'binanceusdm', 'bybit', 'okx', 'bitget', 'coinbase', 'kraken', 'kucoin', 'gate', 'mexc', 'htx', 'bingx', 'binancecoinm', 'kucoinfutures', 'hyperliquid', 'cryptocap', 'fx'];
const QUOTE_PREF = ['USDT', 'USD', 'USDC', 'BUSD', 'FDUSD', 'EUR'];

/** Comparison key: upper case, no separators (BTC/USDT = BTC_USDT = btcusdt), Arabic ي/ك folded to Persian ی/ک. */
export const norm = (s: string) => s.toUpperCase().replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/[^A-Z0-9؀-ۿ]/g, '');

/** Kind of an entry: CCXT markets say swap / future, dominance sources are indices. */
export function kindOf(e: SearchEntry): Kind {
  if (e.type === 'swap') return 'perp';
  if (e.type === 'future') return 'future';
  if (e.type === 'spot') return 'spot';
  return e.ex === 'cryptocap' || e.type === 'index' ? 'index' : 'other';
}
const KIND_ORDER: Record<Kind, number> = { spot: 0, perp: 1, future: 2, index: 3, other: 4 };
export const kindLabel = (e: SearchEntry) => ({ spot: 'spot', perp: 'perpetual', future: 'future', index: 'index', other: e.type } as Record<Kind, string>)[kindOf(e)];

/** "btcusdt.p", "btcusdt perp", "BTCUSDTPERP" -> key BTCUSDT and kind perp. */
export function parseQuery(raw: string): { key: string; kind?: Kind } {
  const u = raw.trim().toUpperCase().replace(/\s+/g, ' ');
  const m = /(?:\.P|[.\s_-](?:PERPETUAL|PERP|SWAP)|PERP(?:ETUAL)?)$/.exec(u);
  const key = m ? norm(u.slice(0, m.index)) : '';
  return key ? { key, kind: 'perp' } : { key: norm(u) };
}

/** Symbol without the CCXT .P / .P<settle> / .F<date> suffix, so "btcusdt" is an exact hit for BTC_USDT.P too. */
const stem = (e: SearchEntry) => norm(e.type === 'swap' ? e.sym.replace(/\.P[A-Z0-9]*$/, '') : e.type === 'future' ? e.sym.replace(/\.F\d+$/, '') : e.sym);

/** Match tier (0 best) or -1. */
function tier(e: SearchEntry, key: string): number {
  const s = stem(e), b = norm(e.base);
  if (s === key) return 0;
  if (b === key) return 1;
  if (s.startsWith(key)) return 2;
  if (s.includes(key)) return 3;
  return e.name && norm(e.name).includes(key) ? 4 : -1;
}

const popIdx = (ex: string) => { const i = POPULAR.indexOf(ex); return i < 0 ? POPULAR.length : i };
const quoteIdx = (q: string) => { const i = QUOTE_PREF.indexOf(q.toUpperCase()); return i < 0 ? QUOTE_PREF.length : i };

/** Ranked, de-duplicated matches. Scoped (one exchange) has no per-exchange cap; the all-exchanges view caps each exchange so a big one cannot flood the list. */
export function rank(entries: SearchEntry[], raw: string, o: { limit?: number; perEx?: number } = {}): SearchEntry[] {
  const { key, kind } = parseQuery(raw);
  if (!key) return [];
  const seen = new Set<string>(), hit: { e: SearchEntry; t: number }[] = [];
  for (const e of entries) {
    const id = `${e.ex}|${e.sym}`;
    if (seen.has(id) || (kind && kindOf(e) !== kind)) continue;
    const t = tier(e, key);
    if (t >= 0) { seen.add(id); hit.push({ e, t }) }
  }
  hit.sort((a, b) => a.t - b.t || KIND_ORDER[kindOf(a.e)] - KIND_ORDER[kindOf(b.e)] || popIdx(a.e.ex) - popIdx(b.e.ex) || quoteIdx(a.e.quote) - quoteIdx(b.e.quote) || a.e.sym.length - b.e.sym.length || a.e.sym.localeCompare(b.e.sym));
  const cnt = new Map<string, number>(), out: SearchEntry[] = [];
  for (const { e } of hit) {
    const n = (cnt.get(e.ex) ?? 0) + 1; cnt.set(e.ex, n);
    if (o.perEx && n > o.perEx) continue;
    out.push(e);
    if (out.length >= (o.limit ?? 100)) break;
  }
  return out;
}

/** The symbol string the chart takes. Binance spot is the bare name (BTCUSDT); the server lists use an underscore, so it is removed there. */
export const toSymbol = (e: SearchEntry) => e.ex === 'binance' ? e.sym.replace(/_/g, '') : `${e.ex.toUpperCase()}:${e.sym}`;

/** Binance spot names (BTCUSDT) as entries, quote split off by the common quote assets. */
export function binanceEntries(names: string[]): SearchEntry[] {
  return names.map(s => { const q = ['USDT', 'USDC', 'FDUSD', 'BTC', 'ETH', 'TRY', 'EUR'].find(x => s.endsWith(x)) ?? ''; return { ex: 'binance', sym: s, base: s.slice(0, s.length - q.length), quote: q, type: 'spot' } });
}

/** Which exchange ids the all-exchanges view reads: every non-CCXT source (brokers, fx, dominance, Iran) plus the popular CCXT ones; `ccxt` is the set of ids that are CCXT exchanges. */
export function allSources(ids: string[], isCcxt: (id: string) => boolean, maxCcxt = 10): string[] {
  const set = new Set(ids), ccxt = POPULAR.filter(x => x !== 'binance' && isCcxt(x) && set.has(x)).slice(0, maxCcxt);
  return [...new Set([...ccxt, ...ids.filter(x => x !== 'binance' && !isCcxt(x))])];
}
