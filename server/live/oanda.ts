// OANDA as a live data source (forex, metals, CFDs). Polled every 2 s through the REST candles endpoint with the user's own token.
import { tfSeconds, type Bar } from '../../src/data.ts';
import type { IranSource, MarketRow } from '../iran/index.ts';
import { providerKeys } from '../providerkeys.ts';

// [our timeframe, OANDA granularity]; the largest one that divides the requested timeframe is fetched and the rest is aggregated.
const NATIVE: [string, string][] = [['5s', 'S5'], ['10s', 'S10'], ['15s', 'S15'], ['30s', 'S30'], ['1m', 'M1'], ['2m', 'M2'], ['4m', 'M4'], ['5m', 'M5'], ['10m', 'M10'], ['15m', 'M15'], ['30m', 'M30'], ['1h', 'H1'], ['2h', 'H2'], ['3h', 'H3'], ['4h', 'H4'], ['6h', 'H6'], ['8h', 'H8'], ['12h', 'H12'], ['1d', 'D'], ['1w', 'W']];
export function pickGranularity(tf: string): { base: string; gran: string } | null {
  if (tf === '1M') return { base: '1M', gran: 'M' };
  if (tf.endsWith('M')) return null;   // 3M, 6M, 12M: no exact native bar and months do not aggregate from smaller ones here
  const sec = tfSeconds(tf);
  const best = NATIVE.filter(([t]) => sec % tfSeconds(t) === 0).sort((a, b) => tfSeconds(b[0]) - tfSeconds(a[0]))[0];
  return best ? { base: best[0], gran: best[1] } : null;
}

const host = (k: Record<string, string>) => (k['env'] === 'live' ? 'https://api-fxtrade.oanda.com' : 'https://api-fxpractice.oanda.com');
function keys() { const k = providerKeys('oanda'); if (!k) throw Error('Add your OANDA API token in Connections first'); return k }

async function get<T>(path: string): Promise<T> {
  const k = keys(), r = await fetch(host(k) + path, { headers: { Authorization: `Bearer ${k['apiKey']}` }, signal: AbortSignal.timeout(15_000), redirect: 'error' });
  if (r.status === 401 || r.status === 403) throw Error('OANDA rejected the token (check it and the practice / live choice)');
  if (!r.ok) throw Error(`OANDA answered ${r.status}`);
  return r.json() as Promise<T>;
}

let acct: { id: string; at: number } | null = null;
async function accountId() {
  if (acct && Date.now() - acct.at < 3600_000) return acct.id;
  const j = await get<{ accounts?: { id: string }[] }>('/v3/accounts'), id = j.accounts?.[0]?.id;
  if (!id) throw Error('This OANDA token has no accounts');
  acct = { id, at: Date.now() }; return id;
}

let mk: { at: number; rows: MarketRow[] } | null = null;
async function markets(): Promise<MarketRow[]> {
  if (mk && Date.now() - mk.at < 6 * 3600_000) return mk.rows;
  const j = await get<{ instruments?: { name: string; type: string; displayName?: string }[] }>(`/v3/accounts/${await accountId()}/instruments`);
  const rows = (j.instruments ?? []).map(i => {
    const [base, quote = ''] = i.name.split('_');
    return { sym: i.name, base, quote, type: i.type === 'CURRENCY' ? 'forex' : i.type === 'METAL' ? 'metal' : 'cfd', name: i.displayName };
  });
  mk = { at: Date.now(), rows }; return rows;
}

async function bars(sym: string, tf: string, until?: number, limit = 1000): Promise<{ bars: Bar[]; base: string }> {
  const g = pickGranularity(tf); if (!g) throw Error(`OANDA has no candles for ${tf}`);
  const q = new URLSearchParams({ granularity: g.gran, price: 'M', count: String(Math.min(5000, Math.max(1, limit))) });
  if (until) q.set('to', String(Math.floor(until / 1000)));
  const j = await get<{ candles?: { time: string; volume: number; mid?: { o: string; h: string; l: string; c: string } }[] }>(`/v3/instruments/${encodeURIComponent(sym)}/candles?${q}`);
  const out: Bar[] = [];
  for (const c of j.candles ?? []) if (c.mid) out.push({ time: Math.floor(Date.parse(c.time) / 1000), open: +c.mid.o, high: +c.mid.h, low: +c.mid.l, close: +c.mid.c, volume: c.volume });
  return { bars: out, base: g.base };
}

export const OANDA: IranSource = { id: 'oanda', name: 'OANDA (your token: forex, metals, CFDs)', bars, markets, every: 2000, weekAnchor: 345600 };
