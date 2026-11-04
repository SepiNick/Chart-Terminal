// Keyless market data for phase 9: crypto news from public RSS feeds, DEX pairs (DexScreener), coin market caps and
// global dominance (CoinGecko). Fixed upstream hosts only, cached, and a stale copy is served when an upstream fails.
import { HttpError, bad, route } from './core/http.ts';
import { db, migration } from './core/db.ts';

// CoinGecko gives today's dominance only: one row per UTC day builds the history the regime analysis needs.
migration('marketdata/1', 'CREATE TABLE dominance (day TEXT PRIMARY KEY, btc REAL NOT NULL, eth REAL)');

/** Swappable for tests. */
export const deps = { fetch: (url: string) => fetch(url, { signal: AbortSignal.timeout(15_000), headers: { 'user-agent': 'ChartTerminal/0.1', accept: 'application/json, application/rss+xml, application/xml, text/xml' } }), now: () => Date.now() };

const cache = new Map<string, { at: number; data: unknown }>();
async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const c = cache.get(key);
  if (c && deps.now() - c.at < ttlMs) return c.data as T;
  try {
    const data = await load();
    cache.set(key, { at: deps.now(), data });
    if (cache.size > 200) cache.delete(cache.keys().next().value!);
    return data;
  } catch (e) {
    if (c) return c.data as T;   // stale beats nothing
    throw e instanceof HttpError ? e : new HttpError(502, `Upstream failed: ${(e as Error).message}`);
  }
}
async function getJson(url: string): Promise<unknown> {
  const r = await deps.fetch(url);
  if (!r.ok) throw new HttpError(502, `${new URL(url).host} returned ${r.status}`);
  return r.json();
}

// ---------- news (RSS) ----------
export const FEEDS = [
  { source: 'CoinDesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/' },
  { source: 'Cointelegraph', url: 'https://cointelegraph.com/rss' },
  { source: 'Decrypt', url: 'https://decrypt.co/feed' },
  { source: 'The Block', url: 'https://www.theblock.co/rss.xml' },
];
interface NewsItem { title: string; link: string; source: string; t: number }
const decode = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).trim();
/** Items of an RSS 2.0 (or Atom) document: title, http(s) link, time. Anything else is dropped. */
export function parseRss(xml: string, source: string): NewsItem[] {
  const out: NewsItem[] = [];
  for (const m of xml.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/g)) {
    const it = m[0], tag = (n: string) => it.match(new RegExp(`<${n}\\b[^>]*>([\\s\\S]*?)</${n}>`))?.[1];
    const title = decode(tag('title') ?? ''), link = decode(tag('link') ?? it.match(/<link\b[^>]*href="([^"]+)"/)?.[1] ?? '');
    const t = Date.parse(decode(tag('pubDate') ?? tag('published') ?? tag('updated') ?? tag('dc:date') ?? ''));
    if (title && /^https?:\/\//.test(link)) out.push({ title: title.slice(0, 300), link, source, t: Number.isFinite(t) ? t : 0 });
  }
  return out;
}
export async function news(q?: string): Promise<NewsItem[]> {
  const all = await cached('news', 10 * 60_000, async () => {
    const lists = await Promise.all(FEEDS.map(f => deps.fetch(f.url).then(r => (r.ok ? r.text() : '')).then(x => parseRss(x, f.source)).catch(() => [] as NewsItem[])));
    const items = lists.flat().sort((a, b) => b.t - a.t);
    if (!items.length) throw new HttpError(502, 'No news feed could be read');
    return items.slice(0, 300);
  });
  if (!q) return all.slice(0, 100);
  // A symbol's news: its ticker as a word (BTC) or a known name (Bitcoin).
  const words = q.split(',').map(w => w.trim()).filter(w => /^[\w .-]{2,30}$/.test(w));
  const re = words.length ? new RegExp(`\\b(${words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'i') : null;
  return re ? all.filter(n => re.test(n.title)).slice(0, 50) : [];
}

// ---------- DEX pairs ----------
interface DexPair { chainId: string; dexId: string; url: string; pairAddress: string; baseToken: { symbol: string; name: string }; quoteToken: { symbol: string }; priceUsd?: string; volume?: { h24?: number }; priceChange?: { h24?: number }; liquidity?: { usd?: number }; fdv?: number; pairCreatedAt?: number }
export async function dex(q: string) {
  if (!/^[\w .-]{1,40}$/.test(q)) throw bad('Search for a token symbol, name or address');
  const j = await cached(`dex|${q.toLowerCase()}`, 60_000, () => getJson(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(q)}`)) as { pairs?: DexPair[] };
  return (j.pairs ?? []).slice(0, 100).map(p => ({
    chain: p.chainId, dex: p.dexId, url: p.url?.startsWith('https://') ? p.url : 'https://dexscreener.com', pair: `${p.baseToken.symbol}/${p.quoteToken.symbol}`, name: p.baseToken.name,
    price: Number(p.priceUsd ?? NaN), ch: p.priceChange?.h24 ?? null, vol: p.volume?.h24 ?? 0, liq: p.liquidity?.usd ?? 0, fdv: p.fdv ?? null, created: p.pairCreatedAt ?? null,
  }));
}

// ---------- CoinGecko: market caps and dominance ----------
interface CgCoin { id: string; symbol: string; name: string; current_price: number; market_cap: number; price_change_percentage_24h: number | null; total_volume: number }
export const coins = () => cached('cg|markets', 5 * 60_000, async () => (await getJson('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1') as CgCoin[])
  .map(c => ({ id: c.id, sym: c.symbol.toUpperCase(), name: c.name, price: c.current_price, cap: c.market_cap, ch: c.price_change_percentage_24h, vol: c.total_volume })));
export const globalStats = () => cached('cg|global', 5 * 60_000, async () => {
  const d = (await getJson('https://api.coingecko.com/api/v3/global') as { data: { total_market_cap: Record<string, number>; total_volume: Record<string, number>; market_cap_percentage: Record<string, number>; market_cap_change_percentage_24h_usd: number } }).data;
  const pct = d.market_cap_percentage;
  // TradingView-style names: TOTAL (all), TOTAL2 (without BTC), TOTAL3 (without BTC and ETH), BTC.D, ETH.D, USDT.D
  const total = d.total_market_cap.usd;
  if (pct.btc != null) db.prepare('INSERT INTO dominance (day, btc, eth) VALUES (?, ?, ?) ON CONFLICT(day) DO UPDATE SET btc = excluded.btc, eth = excluded.eth').run(new Date(deps.now()).toISOString().slice(0, 10), pct.btc, pct.eth ?? null);
  return { TOTAL: total, TOTAL2: total * (1 - (pct.btc ?? 0) / 100), TOTAL3: total * (1 - ((pct.btc ?? 0) + (pct.eth ?? 0)) / 100), 'BTC.D': pct.btc ?? null, 'ETH.D': pct.eth ?? null, 'USDT.D': pct.usdt ?? null, volume24h: d.total_volume.usd, change24h: d.market_cap_change_percentage_24h_usd };
});

route('GET', '/api/news', c => news(c.url.searchParams.get('q') ?? undefined));
route('GET', '/api/dex', c => dex(c.url.searchParams.get('q') ?? ''));
route('GET', '/api/coins', () => coins());
route('GET', '/api/global', () => globalStats());
route('GET', '/api/global/history', () => db.prepare('SELECT day, btc, eth FROM dominance ORDER BY day').all());

// ---------- US market breadth (TraderMonty's public CSVs, used by the breadth skills) ----------
const BREADTH = 'https://tradermonty.github.io/market-breadth-analysis/';
/** Simple CSV (no quoted commas in these files) → header-keyed rows. */
export function parseCsv(text: string): Record<string, string>[] {
  const [head, ...lines] = text.trim().split(/\r?\n/), cols = head.split(',');
  return lines.filter(Boolean).map(l => { const v = l.split(','); return Object.fromEntries(cols.map((c, i) => [c, v[i] ?? ''])) });
}
const csvOf = (file: string) => cached(`csv|${file}`, 60 * 60_000, async () => { const r = await deps.fetch(BREADTH + file); if (!r.ok) throw new HttpError(502, `${file}: ${r.status}`); return parseCsv(await r.text()) });
route('GET', '/api/breadth', async () => {
  const [rows, summary] = await Promise.all([csvOf('market_breadth_data.csv'), csvOf('market_breadth_summary.csv')]);
  return { rows, summary: Object.fromEntries(summary.map(r => [r.Metric, r.Value])) };
});
// Uptrend ratio dashboard (share of stocks in an uptrend, overall and per sector), for the uptrend and sector skills.
const UPTREND = 'https://raw.githubusercontent.com/tradermonty/uptrend-dashboard/main/data/';
const upCsv = (file: string) => cached(`up|${file}`, 60 * 60_000, async () => { const r = await deps.fetch(UPTREND + file); if (!r.ok) throw new HttpError(502, `${file}: ${r.status}`); return parseCsv(await r.text()) });
route('GET', '/api/uptrend', async () => {
  const [ts, sectors] = await Promise.all([upCsv('uptrend_ratio_timeseries.csv'), upCsv('sector_summary.csv')]);
  return { all: ts.filter(r => r.worksheet === 'all'), sectors };
});
// 10Y and 2Y Treasury yields from FRED's public CSV (no key), oldest first, for the macro regime skill's yield curve.
export const treasury = () => cached('fred|treasury', 6 * 60 * 60_000, async () => {
  const r = await deps.fetch('https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10,DGS2');
  if (!r.ok) throw new HttpError(502, `FRED: ${r.status}`);
  return parseCsv(await r.text()).filter(x => x.observation_date >= '2015' && +x.DGS10 > -50 && +x.DGS2 > -50 && x.DGS10 !== '' && x.DGS2 !== '').map(x => ({ date: x.observation_date, year10: +x.DGS10, year2: +x.DGS2 }));
});
route('GET', '/api/treasury', () => treasury());
// Every US-listed stock with sector, industry, market cap, price and volume from Nasdaq's public screener (no key):
// the universe for the stock skills (downtrends, scanners, fundamentals).
interface UsStock { sym: string; name: string; sector: string; industry: string; cap: number; price: number; volume: number; chg: number; country: string }
const usd = (s: string) => Number(String(s ?? '').replace(/[$,%]/g, ''));
export const usStocks = () => cached('nasdaq|stocks', 6 * 60 * 60_000, async () => {
  const j = await getJson('https://api.nasdaq.com/api/screener/stocks?tableonly=true&download=true') as { data?: { rows?: Record<string, string>[] } };
  const rows = j.data?.rows; if (!rows?.length) throw new HttpError(502, 'Nasdaq screener returned no rows');
  return rows.filter(r => /^[A-Z]{1,5}$/.test(r.symbol)).map((r): UsStock => ({ sym: r.symbol, name: r.name.replace(/ (Common Stock|Class [A-C] Common Stock|Ordinary Shares).*$/, ''), sector: r.sector || 'Unknown', industry: r.industry || '', cap: usd(r.marketCap) || 0, price: usd(r.lastsale), volume: usd(r.volume) || 0, chg: usd(r.pctchange), country: r.country })).sort((a, b) => b.cap - a.cap);
});
route('GET', '/api/us-stocks', () => usStocks());
