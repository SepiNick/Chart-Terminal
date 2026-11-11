// Alpaca as a live data source (US stocks and ETFs). Polled every 5 s through the REST bars endpoint with the user's own keys.
// Free keys get the IEX feed only (a slice of US volume); a paid plan gets the full SIP feed. IEX is requested here, which works on both.
import { tfSeconds, type Bar } from '../../src/data.ts';
import type { IranSource, MarketRow } from '../iran/index.ts';
import { providerKeys } from '../providerkeys.ts';

const NATIVE: [string, string][] = [['1m', '1Min'], ['2m', '2Min'], ['5m', '5Min'], ['10m', '10Min'], ['15m', '15Min'], ['30m', '30Min'], ['1h', '1Hour'], ['2h', '2Hour'], ['4h', '4Hour'], ['1d', '1Day'], ['1w', '1Week']];
export function pickTimeframe(tf: string): { base: string; tf: string } | null {
  if (tf.endsWith('M')) return null;
  const sec = tfSeconds(tf);
  const best = NATIVE.filter(([t]) => sec % tfSeconds(t) === 0).sort((a, b) => tfSeconds(b[0]) - tfSeconds(a[0]))[0];
  return best ? { base: best[0], tf: best[1] } : null;
}

function keys() { const k = providerKeys('alpaca'); if (!k) throw Error('Add your Alpaca keys in Connections first'); return k }
async function get<T>(url: string, k: Record<string, string>): Promise<T> {
  const r = await fetch(url, { headers: { 'APCA-API-KEY-ID': k['apiKey'], 'APCA-API-SECRET-KEY': k['secret'] }, signal: AbortSignal.timeout(15_000), redirect: 'error' });
  if (r.status === 401 || r.status === 403) throw Error('Alpaca rejected the keys (check them and the paper / live choice)');
  if (r.status === 429) throw Error('Alpaca rate limit reached, slow down');
  if (!r.ok) throw Error(`Alpaca answered ${r.status}`);
  return r.json() as Promise<T>;
}

let mk: { at: number; rows: MarketRow[] } | null = null;
async function markets(): Promise<MarketRow[]> {
  if (mk && Date.now() - mk.at < 6 * 3600_000) return mk.rows;
  const k = keys(), base = k['env'] === 'live' ? 'https://api.alpaca.markets' : 'https://paper-api.alpaca.markets';
  const j = await get<{ symbol: string; name?: string; tradable?: boolean }[]>(`${base}/v2/assets?status=active&asset_class=us_equity`, k);
  const rows = j.filter(a => a.tradable && /^[A-Z0-9.]{1,10}$/.test(a.symbol)).map(a => ({ sym: a.symbol, base: a.symbol, quote: 'USD', type: 'stock', name: a.name }));
  mk = { at: Date.now(), rows }; return rows;
}

async function bars(sym: string, tf: string, until?: number, limit = 1000): Promise<{ bars: Bar[]; base: string }> {
  const g = pickTimeframe(tf); if (!g) throw Error(`Alpaca has no bars for ${tf}`);
  const k = keys(), n = Math.min(10000, Math.max(1, limit)), end = Math.floor((until ?? Date.now()) / 1000);
  // Nights, weekends and holidays have no bars: look back several times further than n bars of this size.
  const start = end - n * tfSeconds(g.base) * (tfSeconds(g.base) >= 86400 ? 2 : 6);
  const q = new URLSearchParams({ timeframe: g.tf, limit: String(n), feed: 'iex', adjustment: 'raw', sort: 'desc', start: new Date(start * 1000).toISOString(), end: new Date(end * 1000).toISOString() });
  const j = await get<{ bars?: { t: string; o: number; h: number; l: number; c: number; v: number }[] | null }>(`https://data.alpaca.markets/v2/stocks/${encodeURIComponent(sym)}/bars?${q}`, k);
  const out = (j.bars ?? []).map(b => ({ time: Math.floor(Date.parse(b.t) / 1000), open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v })).reverse();
  return { bars: out, base: g.base };
}

export const ALPACA: IranSource = { id: 'alpaca', name: 'Alpaca (your keys: US stocks and ETFs)', bars, markets, every: 5000, weekAnchor: 345600 };
