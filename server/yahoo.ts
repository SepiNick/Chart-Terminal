// Forex, metals, energy, indices and stocks from Yahoo Finance's public chart API (no account needed).
// Unofficial and for personal use; quotes may be delayed. Symbols: FX:EURUSD, FX:XAUUSD, FX:US500, FX:AAPL …
import { tfSeconds } from '../src/data.ts';
import type { Bar } from '../src/data.ts';

const MAJORS = ['EUR', 'USD', 'GBP', 'JPY', 'CHF', 'AUD', 'NZD', 'CAD'];
const EXOTICS = ['SEK', 'NOK', 'DKK', 'PLN', 'HUF', 'CZK', 'TRY', 'ZAR', 'MXN', 'SGD', 'HKD', 'CNY', 'INR', 'BRL', 'THB', 'ILS', 'AED', 'SAR', 'KRW', 'RUB', 'IDR', 'MYR', 'PHP', 'VND', 'TWD', 'CLP', 'COP', 'ARS', 'PEN', 'EGP', 'NGN', 'KES', 'PKR', 'BDT', 'UAH', 'KZT', 'QAR', 'KWD', 'RON', 'BGN', 'ISK', 'MAD', 'LKR'];
const RANK = Object.fromEntries(MAJORS.map((c, i) => [c, i]));

interface FxMarket { sym: string; yahoo: string; name: string; type: 'forex' | 'metal' | 'energy' | 'index' | 'commodity' | 'stock' | 'crypto' }
const SPECIAL: FxMarket[] = [
  ['XAUUSD', 'GC=F', 'Gold', 'metal'], ['XAGUSD', 'SI=F', 'Silver', 'metal'], ['XPTUSD', 'PL=F', 'Platinum', 'metal'], ['XPDUSD', 'PA=F', 'Palladium', 'metal'], ['COPPER', 'HG=F', 'Copper', 'metal'],
  ['USOIL', 'CL=F', 'WTI crude oil', 'energy'], ['UKOIL', 'BZ=F', 'Brent crude oil', 'energy'], ['NATGAS', 'NG=F', 'Natural gas', 'energy'], ['GASOLINE', 'RB=F', 'Gasoline', 'energy'],
  ['US500', '^GSPC', 'S&P 500', 'index'], ['NAS100', '^NDX', 'Nasdaq 100', 'index'], ['US30', '^DJI', 'Dow Jones 30', 'index'], ['US2000', '^RUT', 'Russell 2000', 'index'],
  ['GER40', '^GDAXI', 'DAX 40', 'index'], ['UK100', '^FTSE', 'FTSE 100', 'index'], ['FRA40', '^FCHI', 'CAC 40', 'index'], ['EU50', '^STOXX50E', 'Euro Stoxx 50', 'index'],
  ['JPN225', '^N225', 'Nikkei 225', 'index'], ['HK50', '^HSI', 'Hang Seng', 'index'], ['AUS200', '^AXJO', 'ASX 200', 'index'], ['VIX', '^VIX', 'Volatility index', 'index'], ['VIX3M', '^VIX3M', '3-month volatility index', 'index'], ['DXY', 'DX-Y.NYB', 'US dollar index', 'index'],
  ['WHEAT', 'ZW=F', 'Wheat', 'commodity'], ['CORN', 'ZC=F', 'Corn', 'commodity'], ['SOYBEAN', 'ZS=F', 'Soybeans', 'commodity'], ['COFFEE', 'KC=F', 'Coffee', 'commodity'], ['SUGAR', 'SB=F', 'Sugar', 'commodity'], ['COCOA', 'CC=F', 'Cocoa', 'commodity'],
  ['US10Y', '^TNX', 'US 10Y yield', 'index'],
  ['US3M', '^IRX', 'US 13-week yield', 'index'], ['US5Y', '^FVX', 'US 5Y yield', 'index'], ['US30Y', '^TYX', 'US 30Y yield', 'index'],
  ['IXIC', '^IXIC', 'Nasdaq Composite', 'index'], ['NYA', '^NYA', 'NYSE Composite', 'index'], ['SP400', '^MID', 'S&P MidCap 400', 'index'], ['CAN60', '^GSPTSE', 'S&P/TSX Composite', 'index'],
  ['BRA', '^BVSP', 'Bovespa', 'index'], ['MEX', '^MXX', 'IPC Mexico', 'index'], ['ARG', '^MERV', 'Merval', 'index'], ['SPA35', '^IBEX', 'IBEX 35', 'index'], ['NED25', '^AEX', 'AEX', 'index'],
  ['SUI20', '^SSMI', 'SMI', 'index'], ['ITA40', 'FTSEMIB.MI', 'FTSE MIB', 'index'], ['CHN', '000001.SS', 'Shanghai Composite', 'index'], ['SZ', '399001.SZ', 'Shenzhen Component', 'index'],
  ['KOR', '^KS11', 'KOSPI', 'index'], ['IND', '^NSEI', 'Nifty 50', 'index'], ['SENSEX', '^BSESN', 'BSE Sensex', 'index'], ['TWN', '^TWII', 'Taiwan Weighted', 'index'], ['SGP', '^STI', 'Straits Times', 'index'],
  ['IDN', '^JKSE', 'Jakarta Composite', 'index'], ['MYS', '^KLSE', 'FTSE Bursa Malaysia', 'index'], ['NZ50', '^NZ50', 'NZX 50', 'index'], ['TUR', 'XU100.IS', 'BIST 100', 'index'],
  ['HEATOIL', 'HO=F', 'Heating oil', 'energy'], ['LUMBER', 'LBR=F', 'Lumber', 'commodity'], ['COTTON', 'CT=F', 'Cotton', 'commodity'], ['OJ', 'OJ=F', 'Orange juice', 'commodity'], ['OATS', 'ZO=F', 'Oats', 'commodity'], ['RICE', 'ZR=F', 'Rough rice', 'commodity'],
  ['SOYOIL', 'ZL=F', 'Soybean oil', 'commodity'], ['SOYMEAL', 'ZM=F', 'Soybean meal', 'commodity'], ['CATTLE', 'LE=F', 'Live cattle', 'commodity'], ['FEEDER', 'GF=F', 'Feeder cattle', 'commodity'], ['HOGS', 'HE=F', 'Lean hogs', 'commodity'], ['MILK', 'DC=F', 'Class III milk', 'commodity'],
  ['BTCFUT', 'BTC=F', 'Bitcoin CME futures', 'crypto'], ['ETHFUT', 'ETH=F', 'Ethereum CME futures', 'crypto'],
  ['SPY', 'SPY', 'SPDR S&P 500 ETF', 'stock'], ['QQQ', 'QQQ', 'Invesco QQQ', 'stock'], ['DIA', 'DIA', 'SPDR Dow Jones ETF', 'stock'], ['IWM', 'IWM', 'iShares Russell 2000', 'stock'], ['VTI', 'VTI', 'Vanguard Total Market', 'stock'], ['VOO', 'VOO', 'Vanguard S&P 500', 'stock'], ['GLD', 'GLD', 'SPDR Gold', 'stock'], ['SLV', 'SLV', 'iShares Silver', 'stock'], ['USO', 'USO', 'US Oil Fund', 'stock'], ['TLT', 'TLT', 'iShares 20+ Year Treasury', 'stock'], ['IBIT', 'IBIT', 'iShares Bitcoin Trust', 'stock'], ['FBTC', 'FBTC', 'Fidelity Bitcoin ETF', 'stock'], ['ETHA', 'ETHA', 'iShares Ethereum Trust', 'stock'], ['ARKK', 'ARKK', 'ARK Innovation', 'stock'], ['XLK', 'XLK', 'Technology Select Sector', 'stock'], ['XLF', 'XLF', 'Financial Select Sector', 'stock'], ['XLE', 'XLE', 'Energy Select Sector', 'stock'], ['EEM', 'EEM', 'iShares Emerging Markets', 'stock'], ['VNQ', 'VNQ', 'Vanguard Real Estate', 'stock'], ['HYG', 'HYG', 'iShares High Yield Corp Bond', 'stock'], ['AAPL', 'AAPL', 'Apple', 'stock'], ['MSFT', 'MSFT', 'Microsoft', 'stock'], ['NVDA', 'NVDA', 'NVIDIA', 'stock'], ['GOOGL', 'GOOGL', 'Alphabet', 'stock'], ['AMZN', 'AMZN', 'Amazon', 'stock'], ['META', 'META', 'Meta Platforms', 'stock'], ['TSLA', 'TSLA', 'Tesla', 'stock'], ['BRKB', 'BRK-B', 'Berkshire Hathaway', 'stock'], ['AVGO', 'AVGO', 'Broadcom', 'stock'], ['JPM', 'JPM', 'JPMorgan Chase', 'stock'], ['V', 'V', 'Visa', 'stock'], ['MA', 'MA', 'Mastercard', 'stock'], ['WMT', 'WMT', 'Walmart', 'stock'], ['XOM', 'XOM', 'Exxon Mobil', 'stock'], ['UNH', 'UNH', 'UnitedHealth', 'stock'], ['LLY', 'LLY', 'Eli Lilly', 'stock'], ['JNJ', 'JNJ', 'Johnson & Johnson', 'stock'], ['PG', 'PG', 'Procter & Gamble', 'stock'], ['HD', 'HD', 'Home Depot', 'stock'], ['COST', 'COST', 'Costco', 'stock'], ['NFLX', 'NFLX', 'Netflix', 'stock'], ['AMD', 'AMD', 'AMD', 'stock'], ['INTC', 'INTC', 'Intel', 'stock'], ['ORCL', 'ORCL', 'Oracle', 'stock'], ['CRM', 'CRM', 'Salesforce', 'stock'], ['ADBE', 'ADBE', 'Adobe', 'stock'], ['DIS', 'DIS', 'Disney', 'stock'], ['BA', 'BA', 'Boeing', 'stock'], ['KO', 'KO', 'Coca-Cola', 'stock'], ['PEP', 'PEP', 'PepsiCo', 'stock'], ['MCD', 'MCD', 'McDonalds', 'stock'], ['NKE', 'NKE', 'Nike', 'stock'], ['PYPL', 'PYPL', 'PayPal', 'stock'], ['UBER', 'UBER', 'Uber', 'stock'], ['PLTR', 'PLTR', 'Palantir', 'stock'], ['COIN', 'COIN', 'Coinbase', 'stock'], ['MSTR', 'MSTR', 'MicroStrategy', 'stock'], ['MARA', 'MARA', 'Marathon Digital', 'stock'], ['RIOT', 'RIOT', 'Riot Platforms', 'stock'], ['SHOP', 'SHOP', 'Shopify', 'stock'], ['BABA', 'BABA', 'Alibaba', 'stock'], ['TSM', 'TSM', 'TSMC', 'stock'], ['ASML', 'ASML', 'ASML', 'stock'], ['SAP', 'SAP', 'SAP', 'stock'], ['TM', 'TM', 'Toyota', 'stock'], ['NVO', 'NVO', 'Novo Nordisk', 'stock'], ['SONY', 'SONY', 'Sony', 'stock'], ['CVX', 'CVX', 'Chevron', 'stock'], ['BAC', 'BAC', 'Bank of America', 'stock'], ['GS', 'GS', 'Goldman Sachs', 'stock'],
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

const divCache = new Map<string, { at: number; data: { date: string; dividend: number }[] }>();
/** Cash dividends per share (ex-date, amount) over the last `years`, oldest first; cached for 12 hours. */
export async function yahooDividends(sym: string, years = 12): Promise<{ date: string; dividend: number }[]> {
  const t = yahooTicker(sym); if (!t) throw Error(`Unknown symbol FX:${sym}`);
  const c = divCache.get(t); if (c && Date.now() - c.at < 12 * 3600_000) return c.data;
  const end = Math.floor(Date.now() / 1000), start = end - years * 366 * 86400;
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(t)}?interval=1mo&period1=${start}&period2=${end}&events=div`, { headers: { 'user-agent': 'Mozilla/5.0' } });
  const j = await r.json() as { chart: { result?: { events?: { dividends?: Record<string, { amount: number; date: number }> } }[]; error?: { description: string } } };
  if (!r.ok || j.chart.error) throw Error(j.chart.error?.description ?? `Yahoo ${r.status}`);
  const data = Object.values(j.chart.result?.[0]?.events?.dividends ?? {}).filter(d => Number.isFinite(d.amount) && d.amount > 0).map(d => ({ date: new Date(d.date * 1000).toISOString().slice(0, 10), dividend: d.amount })).sort((a, b) => (a.date < b.date ? -1 : 1));
  divCache.set(t, { at: Date.now(), data }); if (divCache.size > 2000) divCache.delete(divCache.keys().next().value!);
  return data;
}
