// Polygon.io as a live data source (US stocks and ETFs). Polled every 5 s through the aggregates endpoint with the user's own key.
// Free keys are rate-limited (a few calls a minute) and delayed: charts update slowly until the key has a real-time plan.
import { tfSeconds, type Bar } from '../../src/data.ts';
import type { IranSource, MarketRow } from '../iran/index.ts';
import { providerKeys } from '../providerkeys.ts';

const NATIVE: [string, number, string][] = [['1m', 1, 'minute'], ['5m', 5, 'minute'], ['15m', 15, 'minute'], ['30m', 30, 'minute'], ['1h', 1, 'hour'], ['4h', 4, 'hour'], ['1d', 1, 'day'], ['1w', 1, 'week']];
export function pickSpan(tf: string): { base: string; mult: number; span: string } | null {
  if (tf.endsWith('M')) return null;
  const sec = tfSeconds(tf);
  const b = NATIVE.filter(([t]) => sec % tfSeconds(t) === 0).sort((a, c) => tfSeconds(c[0]) - tfSeconds(a[0]))[0];
  return b ? { base: b[0], mult: b[1], span: b[2] } : null;
}

const key = () => { const k = providerKeys('polygon'); if (!k) throw Error('Add your Polygon API key in Connections first'); return k['apiKey'] };
async function get<T>(url: string): Promise<T> {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${key()}` }, signal: AbortSignal.timeout(15_000), redirect: 'error' });
  if (r.status === 401 || r.status === 403) throw Error('Polygon rejected the key (or the plan does not include this data)');
  if (r.status === 429) throw Error('Polygon rate limit reached: a free key allows only a few calls a minute');
  if (!r.ok) throw Error(`Polygon answered ${r.status}`);
  return r.json() as Promise<T>;
}

let mk: { at: number; rows: MarketRow[] } | null = null;
async function markets(): Promise<MarketRow[]> {
  if (mk && Date.now() - mk.at < 6 * 3600_000) return mk.rows;
  const rows: MarketRow[] = [];
  let url: string | undefined = 'https://api.polygon.io/v3/reference/tickers?market=stocks&active=true&limit=1000';
  for (let page = 0; url && page < 5; page++) {   // shortcut: 5 pages (5000 tickers), the free plan allows few calls a minute; upgrade by paging on demand
    const j: { results?: { ticker: string; name?: string; type?: string }[]; next_url?: string } = await get<{ results?: { ticker: string; name?: string; type?: string }[]; next_url?: string }>(url).catch(e => { if (!rows.length) throw e; return {} });
    for (const t of j.results ?? []) if (/^[A-Z0-9.]{1,10}$/.test(t.ticker)) rows.push({ sym: t.ticker, base: t.ticker, quote: 'USD', type: t.type === 'ETF' || t.type === 'ETV' ? 'etf' : 'stock', name: t.name });
    url = j.next_url && j.next_url.startsWith('https://api.polygon.io/') ? j.next_url : undefined;
  }
  mk = { at: Date.now(), rows }; return rows;
}

async function bars(sym: string, tf: string, until?: number, limit = 1000): Promise<{ bars: Bar[]; base: string }> {
  const g = pickSpan(tf); if (!g) throw Error(`Polygon has no bars for ${tf}`);
  const n = Math.min(50000, Math.max(1, limit)), end = until ?? Date.now();
  const start = end - n * tfSeconds(g.base) * 1000 * (tfSeconds(g.base) >= 86400 ? 2 : 6);   // nights, weekends and holidays have no bars
  const q = new URLSearchParams({ adjusted: 'true', sort: 'desc', limit: String(n) });
  const j = await get<{ results?: { t: number; o: number; h: number; l: number; c: number; v: number }[] }>(`https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(sym)}/range/${g.mult}/${g.span}/${Math.floor(start)}/${Math.floor(end)}?${q}`);
  return { bars: (j.results ?? []).map(b => ({ time: Math.floor(b.t / 1000), open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v })).reverse(), base: g.base };
}

export const POLYGON: IranSource = { id: 'polygon', name: 'Polygon.io (your key: US stocks and ETFs)', bars, markets, every: 5000, weekAnchor: 345600 };
