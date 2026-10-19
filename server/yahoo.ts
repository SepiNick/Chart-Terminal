// Forex, metals, energy, indices and stocks from Yahoo Finance's public chart API (no account needed).
// Unofficial and for personal use; quotes may be delayed. Symbols: FX:EURUSD, FX:XAUUSD, FX:US500, FX:AAPL …
import { tfSeconds } from '../src/data.ts';
import type { Bar } from '../src/data.ts';

const MAJORS = ['EUR', 'USD', 'GBP', 'JPY', 'CHF', 'AUD', 'NZD', 'CAD'];
const EXOTICS = ['SEK', 'NOK', 'DKK', 'PLN', 'HUF', 'CZK', 'TRY', 'ZAR', 'MXN', 'SGD', 'HKD', 'CNY', 'INR', 'BRL', 'THB', 'ILS', 'AED', 'SAR', 'KRW', 'RUB'];
const RANK = Object.fromEntries(MAJORS.map((c, i) => [c, i]));

export interface FxMarket { sym: string; yahoo: string; name: string; type: 'forex' | 'metal' | 'energy' | 'index' | 'commodity' | 'stock' | 'crypto' }
const SPECIAL: FxMarket[] = [
  ['XAUUSD', 'GC=F', 'Gold', 'metal'], ['XAGUSD', 'SI=F', 'Silver', 'metal'], ['XPTUSD', 'PL=F', 'Platinum', 'metal'], ['XPDUSD', 'PA=F', 'Palladium', 'metal'], ['COPPER', 'HG=F', 'Copper', 'metal'],
  ['USOIL', 'CL=F', 'WTI crude oil', 'energy'], ['UKOIL', 'BZ=F', 'Brent crude oil', 'energy'], ['NATGAS', 'NG=F', 'Natural gas', 'energy'], ['GASOLINE', 'RB=F', 'Gasoline', 'energy'],
  ['US500', '^GSPC', 'S&P 500', 'index'], ['NAS100', '^NDX', 'Nasdaq 100', 'index'], ['US30', '^DJI', 'Dow Jones 30', 'index'], ['US2000', '^RUT', 'Russell 2000', 'index'],
  ['GER40', '^GDAXI', 'DAX 40', 'index'], ['UK100', '^FTSE', 'FTSE 100', 'index'], ['FRA40', '^FCHI', 'CAC 40', 'index'], ['EU50', '^STOXX50E', 'Euro Stoxx 50', 'index'],
  ['JPN225', '^N225', 'Nikkei 225', 'index'], ['HK50', '^HSI', 'Hang Seng', 'index'], ['AUS200', '^AXJO', 'ASX 200', 'index'], ['VIX', '^VIX', 'Volatility index', 'index'], ['DXY', 'DX-Y.NYB', 'US dollar index', 'index'],
  ['WHEAT', 'ZW=F', 'Wheat', 'commodity'], ['CORN', 'ZC=F', 'Corn', 'commodity'], ['SOYBEAN', 'ZS=F', 'Soybeans', 'commodity'], ['COFFEE', 'KC=F', 'Coffee', 'commodity'], ['SUGAR', 'SB=F', 'Sugar', 'commodity'], ['COCOA', 'CC=F', 'Cocoa', 'commodity'],
  ['US10Y', '^TNX', 'US 10Y yield', 'index'],
].map(([sym, yahoo, name, type]) => ({ sym, yahoo, name, type }) as FxMarket);

/** All curated markets: every major cross, USD vs exotics, plus metals/energy/indices/commodities. */
export function fxMarkets(): FxMarket[] {
  const pairs: FxMarket[] = [];
  for (const a of MAJORS) for (const b of MAJORS) if (a !== b && RANK[a] < RANK[b]) pairs.push({ sym: a + b, yahoo: `${a}${b}=X`, name: `${a}/${b}`, type: 'forex' });
  for (const x of EXOTICS) pairs.push({ sym: `USD${x}`, yahoo: `USD${x}=X`, name: `USD/${x}`, type: 'forex' }, { sym: `EUR${x}`, yahoo: `EUR${x}=X`, name: `EUR/${x}`, type: 'forex' });
  return [...pairs, ...SPECIAL];
}
const BY_SYM = new Map(fxMarkets().map(m => [m.sym, m]));
/** Map our symbol to a Yahoo ticker: curated names first; any other plain ticker is treated as a stock. */
export const yahooTicker = (sym: string) => BY_SYM.get(sym)?.yahoo ?? (/^[A-Z0-9.]{1,12}$/.test(sym) ? sym : null);

// Yahoo intervals and how far back each can go.
const NATIVE: [string, string, number][] = [['1m', '1m', 7], ['2m', '2m', 60], ['5m', '5m', 60], ['15m', '15m', 60], ['30m', '30m', 60], ['1h', '60m', 730], ['1d', '1d', 36500], ['1w', '1wk', 36500], ['1M', '1mo', 36500]];
export function yahooBase(tf: string): { base: string; interval: string; maxDays: number } | null {
  const exact = NATIVE.find(n => n[0] === tf);
  if (exact) return { base: exact[0], interval: exact[1], maxDays: exact[2] };
  if (tf.endsWith('M')) return null;
  const sec = tfSeconds(tf);
  const best = [...NATIVE].filter(n => !n[0].endsWith('M') && sec % tfSeconds(n[0]) === 0).sort((a, b) => tfSeconds(b[0]) - tfSeconds(a[0]))[0];
  return best ? { base: best[0], interval: best[1], maxDays: best[2] } : null;
}

export async function yahooBars(sym: string, tf: string, until?: number, limit = 1000): Promise<{ bars: Bar[]; base: string }> {
  const t = yahooTicker(sym); if (!t) throw Error(`Unknown symbol FX:${sym}`);
  const nb = yahooBase(tf); if (!nb) throw Error(`Timeframe ${tf} is not available for FX:${sym}`);
  const end = Math.floor((until ?? Date.now()) / 1000);
  const span = Math.min(nb.maxDays * 86400 - 3600, limit * Math.max(tfSeconds(tf), tfSeconds(nb.base)) * 1.6);   // weekends/closed hours
  const start = Math.max(end - span, Math.floor(Date.now() / 1000) - nb.maxDays * 86400 + 3600);
  if (start >= end) return { bars: [], base: nb.base };
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(t)}?interval=${nb.interval}&period1=${start}&period2=${end}&includePrePost=false`;
  const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' } });
  const j = await r.json() as { chart: { result?: { timestamp?: number[]; indicators: { quote: { open: number[]; high: number[]; low: number[]; close: number[]; volume: number[] }[] } }[]; error?: { description: string } } };
  if (!r.ok || j.chart.error) throw Error(j.chart.error?.description ?? `Yahoo ${r.status}`);
  const res = j.chart.result?.[0], q = res?.indicators.quote[0];
  if (!res?.timestamp || !q) return { bars: [], base: nb.base };
  const bars: Bar[] = [];
  res.timestamp.forEach((time, i) => {
    const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i];
    if ([o, h, l, c].every(v => v != null && Number.isFinite(v))) bars.push({ time: nb.base === '1d' || nb.base === '1w' || nb.base === '1M' ? Math.floor(time / 86400) * 86400 : time, open: o, high: h, low: l, close: c, volume: q.volume[i] ?? 0 });
  });
  return { bars, base: nb.base };
}
