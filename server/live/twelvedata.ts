// Twelve Data as a live data source (forex, stocks, indices, crypto). Polled every 5 s with the user's own key.
// The free plan has a small daily credit budget: every poll costs one credit, so keep few charts open on it.
import { tfSeconds, type Bar } from '../../src/data.ts';
import type { IranSource, MarketRow } from '../iran/index.ts';
import { providerKeys } from '../providerkeys.ts';

const NATIVE: [string, string][] = [['1m', '1min'], ['5m', '5min'], ['15m', '15min'], ['30m', '30min'], ['1h', '1h'], ['4h', '4h'], ['1d', '1day'], ['1w', '1week']];
export function pickInterval(tf: string): { base: string; interval: string } | null {
  if (tf.endsWith('M')) return null;
  const sec = tfSeconds(tf);
  const b = NATIVE.filter(([t]) => sec % tfSeconds(t) === 0).sort((a, c) => tfSeconds(c[0]) - tfSeconds(a[0]))[0];
  return b ? { base: b[0], interval: b[1] } : null;
}

const key = () => { const k = providerKeys('twelvedata'); if (!k) throw Error('Add your Twelve Data API key in Connections first'); return k['apiKey'] };
async function get<T>(url: string): Promise<T> {
  const r = await fetch(url, { headers: { Authorization: `apikey ${key()}` }, signal: AbortSignal.timeout(15_000), redirect: 'error' });
  if (!r.ok) throw Error(`Twelve Data answered ${r.status}`);
  const j = await r.json() as T & { status?: string; message?: string };
  if (j.status === 'error') throw Error(`Twelve Data: ${String(j.message ?? 'request refused').slice(0, 140)}`);   // 200 with an error body: bad key, out of credits, unknown symbol
  return j;
}

let mk: { at: number; rows: MarketRow[] } | null = null;
async function markets(): Promise<MarketRow[]> {
  if (mk && Date.now() - mk.at < 6 * 3600_000) return mk.rows;
  const rows: MarketRow[] = [];
  const fx = await get<{ data?: { symbol: string; currency_base?: string; currency_quote?: string }[] }>('https://api.twelvedata.com/forex_pairs');
  for (const p of fx.data ?? []) rows.push({ sym: p.symbol.replace('/', '_'), base: p.currency_base ?? '', quote: p.currency_quote ?? '', type: 'forex' });
  const st = await get<{ data?: { symbol: string; name?: string }[] }>('https://api.twelvedata.com/stocks?country=United%20States').catch(() => ({ data: [] }));
  for (const s of st.data ?? []) if (/^[A-Z0-9.]{1,10}$/.test(s.symbol)) rows.push({ sym: s.symbol, base: s.symbol, quote: 'USD', type: 'stock', name: s.name });
  mk = { at: Date.now(), rows }; return rows;
}

async function bars(sym: string, tf: string, until?: number, limit = 1000): Promise<{ bars: Bar[]; base: string }> {
  const g = pickInterval(tf); if (!g) throw Error(`Twelve Data has no bars for ${tf}`);
  const q = new URLSearchParams({ symbol: sym.includes('_') ? sym.replace('_', '/') : sym, interval: g.interval, outputsize: String(Math.min(5000, Math.max(1, limit))), order: 'desc', timezone: 'UTC' });
  if (until) q.set('end_date', new Date(until * 1000).toISOString().slice(0, 19).replace('T', ' '));
  const j = await get<{ status?: string; message?: string; values?: { datetime: string; open: string; high: string; low: string; close: string; volume?: string }[] }>(`https://api.twelvedata.com/time_series?${q}`);
  const out = (j.values ?? []).map(v => ({ time: Math.floor(Date.parse(v.datetime.length > 10 ? v.datetime.replace(' ', 'T') + 'Z' : v.datetime + 'T00:00:00Z') / 1000), open: +v.open, high: +v.high, low: +v.low, close: +v.close, volume: +(v.volume ?? 0) }));
  return { bars: out.reverse(), base: g.base };
}

export const TWELVEDATA: IranSource = { id: 'twelvedata', name: 'Twelve Data (your key: forex, stocks, indices)', bars, markets, every: 5000, weekAnchor: 345600 };
