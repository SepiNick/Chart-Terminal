// Client of the local MetaTrader 5 bridge (mt5bridge/bridge.py, ROADMAP phase 11): market data as the exchange 'mt5',
// and the calls the MT5 broker adapter makes. The bridge only listens on 127.0.0.1 and only trades on demo accounts.
import { tfSeconds, type Bar } from '../src/data.ts';
import { HttpError } from './core/http.ts';

export const MT5_URL = `http://127.0.0.1:${Number(process.env.MT5_BRIDGE_PORT ?? 8789)}`;
/** Swappable for tests. */
export const deps = { fetch: (url: string, init?: RequestInit) => fetch(url, { ...init, signal: AbortSignal.timeout(15_000) }) };

export async function mt5Call<T>(path: string, token?: string, body?: object): Promise<T> {
  let r: Response;
  try {
    r = await deps.fetch(MT5_URL + path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(token ? { 'x-bridge-token': token } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  } catch { throw new HttpError(502, 'The MT5 bridge is not running: open MetaTrader 5 (demo account), then run python mt5bridge/bridge.py') }
  const j = await r.json().catch(() => ({ error: `MT5 bridge error ${r.status}` })) as T & { error?: string };
  if (!r.ok) throw new HttpError(r.status === 401 ? 401 : 502, `MT5: ${j.error ?? r.status}`);
  return j;
}

export const mt5Markets = async () => (await mt5Call<{ sym: string; name: string; path: string }[]>('/symbols'))
  .map(s => ({ sym: s.sym, base: s.sym, quote: '', type: s.path.split('\\')[0] || 'cfd', name: s.name }));
export const mt5Bars = (symbol: string, tf: string, until?: number, limit = 1000) =>
  mt5Call<Bar[]>(`/bars?${new URLSearchParams({ symbol, tf, count: String(limit), ...(until ? { until: String(Math.floor(until / 1000)) } : {}) })}`);
/** Supported natively by the bridge; other timeframes are built from these by the caller. */
export const MT5_TFS = ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w', '1M'];
/** Bars at `tf`: natively when the bridge has it, else the largest native timeframe that divides it (caller aggregates). */
export async function mt5Ohlcv(symbol: string, tf: string, until?: number, limit = 1000): Promise<{ bars: Bar[]; base: string }> {
  const sec = tfSeconds(tf), base = MT5_TFS.includes(tf) ? tf : [...MT5_TFS].reverse().find(b => !b.endsWith('M') && sec % tfSeconds(b) === 0) ?? '1m';
  return { bars: await mt5Bars(symbol, base, until, Math.min(5000, Math.ceil((limit * sec) / tfSeconds(base)))), base };
}
