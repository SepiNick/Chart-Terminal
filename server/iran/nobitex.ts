// Nobitex market data (Toman and Tether markets) from the public API. No key.
//   candles  GET  /market/udf/history?symbol=BTCIRT&resolution=60&from=…&to=…     (TradingView UDF: {s, t[], o[], h[], l[], c[], v[]})
//   markets  GET  /v2/orderbook/all                                                (keys are symbols; falls back to a built-in list)
//   tickers  POST /market/stats {srcCurrency, dstCurrency}                         ({stats: {"btc-rls": {latest, dayChange, volumeDst}}})
// Routes and response shapes are written from third-party descriptions of the API and have NOT been run against the
// live service from here: run `npm run check:ir` to verify them, and see docs/iran-market.md.
// Prices: Nobitex quotes Toman markets in Rial in its trading API. The app speaks Toman (IRT), so IRT prices are
// divided by 10 unless the UDF turns out to be in Toman already (detected from USDTIRT, or forced with CT_NOBITEX_UNIT).
import { tfSeconds, type Bar } from '../../src/data.ts';
import { deps, fetchJson, toNum } from './http.ts';
import { TEHRAN_OFFSET, cleanBars, monthlyGregorian } from './util.ts';

export const nobitexBaseUrl = () => process.env['CT_NOBITEX_BASE'] ?? 'https://api.nobitex.ir';

// [our timeframe, UDF resolution, seconds]
const RES: [string, string, number][] = [['1m', '1', 60], ['5m', '5', 300], ['15m', '15', 900], ['30m', '30', 1800], ['1h', '60', 3600], ['3h', '180', 10800], ['4h', '240', 14400], ['6h', '360', 21600], ['12h', '720', 43200], ['1d', 'D', 86400]];
/** Native resolution to build `tf` from (the largest that divides it). Weeks and months come from daily bars. */
export function nobitexBase(tf: string): { base: string; res: string; sec: number } | null {
  const exact = RES.find(r => r[0] === tf);
  if (exact) return { base: exact[0], res: exact[1], sec: exact[2] };
  if (tf.endsWith('M')) return +tf.slice(0, -1) === 1 ? { base: '1d', res: 'D', sec: 86400 } : null;
  const sec = tfSeconds(tf), best = [...RES].reverse().find(r => sec % r[2] === 0);
  return best ? { base: best[0], res: best[1], sec: best[2] } : null;
}

export interface UdfReply { s?: string; errmsg?: string; t?: unknown[]; o?: unknown[]; h?: unknown[]; l?: unknown[]; c?: unknown[]; v?: unknown[] }
/** UDF arrays → bars (price divided by `div`). Daily bars are stamped with their Tehran date at 00:00 UTC. */
export function parseUdf(j: UdfReply, div: number, daily: boolean): Bar[] {
  if (j.s === 'no_data') return [];
  if (j.s !== 'ok' || !Array.isArray(j.t)) throw Error(`Nobitex: ${j.errmsg ?? 'unexpected candle reply'}`);
  const at = (a: unknown[] | undefined, i: number) => toNum(a?.[i]);
  return j.t.map((t, i): Bar => {
    const ts = toNum(t);
    return { time: daily ? Math.floor((ts + TEHRAN_OFFSET) / 86400) * 86400 : ts, open: at(j.o, i) / div, high: at(j.h, i) / div, low: at(j.l, i) / div, close: at(j.c, i) / div, volume: at(j.v, i) };
  });
}

// ---- Rial or Toman? ----
let unitCache: { div: number; at: number } | null = null;
/** 10 when the UDF quotes IRT markets in Rial, 1 when in Toman. CT_NOBITEX_UNIT=rial|toman forces it. */
export async function irtDivisor(): Promise<number> {
  const forced = process.env['CT_NOBITEX_UNIT'];
  if (forced === 'rial') return 10;
  if (forced === 'toman') return 1;
  if (unitCache && deps.now() - unitCache.at < 3600_000) return unitCache.div;
  // Tether trades near one US dollar: above ~500,000 it can only be Rial (a dollar is well under 500,000 Toman).
  const raw = await rawCandles('USDTIRT', 'D', 86400, 3);
  const last = raw.at(-1)?.close;
  if (!last) throw Error('Nobitex: cannot tell Rial from Toman (no USDTIRT candles)');
  unitCache = { div: last >= 500_000 ? 10 : 1, at: deps.now() };
  return unitCache.div;
}
export const resetUnit = () => { unitCache = null };

async function rawCandles(sym: string, res: string, sec: number, count: number, toSec = Math.floor(deps.now() / 1000)): Promise<Bar[]> {
  const q = new URLSearchParams({ symbol: sym, resolution: res, from: String(toSec - sec * count), to: String(toSec) });
  const { data } = await fetchJson<UdfReply>(`${nobitexBaseUrl()}/market/udf/history?${q}`, { ttl: res === 'D' ? 60_000 : 2_000, gap: 250 });
  return parseUdf(data, 1, res === 'D');
}

export const SYM = /^[A-Z0-9]{2,12}(IRT|USDT)$/;
const CHUNK = 500;   // bars asked for per request; the loop continues if the service returns fewer

export async function nobitexBars(sym: string, tf: string, until?: number, limit = 1000): Promise<{ bars: Bar[]; base: string }> {
  if (!SYM.test(sym)) throw Error(`Unknown symbol NOBITEX:${sym}`);
  const nb = nobitexBase(tf); if (!nb) throw Error(`Timeframe ${tf} is not available for NOBITEX:${sym}`);
  const per = Math.max(1, Math.round(Math.max(tfSeconds(tf), nb.sec) / nb.sec));
  const want = Math.min(4000, limit * per), irt = sym.endsWith('IRT'), div = irt ? await irtDivisor() : 1;
  let end = Math.floor((until ?? deps.now()) / 1000), got: Bar[] = [];
  for (let i = 0; i < 8 && got.length < want; i++) {
    const q = new URLSearchParams({ symbol: sym, resolution: nb.res, from: String(end - nb.sec * CHUNK), to: String(end) });
    const { data } = await fetchJson<UdfReply>(`${nobitexBaseUrl()}/market/udf/history?${q}`, { ttl: i === 0 && until === undefined ? 2_000 : 60_000, gap: 250 });
    const part = parseUdf(data, div, nb.res === 'D');
    if (!part.length) break;
    got = [...part, ...got];
    end = end - nb.sec * CHUNK - 1;
  }
  let bars = cleanBars(got).slice(-want);
  if (tf.endsWith('M')) return { bars: monthlyGregorian(bars), base: tf };
  if (until !== undefined) bars = bars.filter(b => b.time * 1000 < until);
  return { bars, base: nb.base };
}

// ---- markets and tickers ----
export interface NxMarket { sym: string; base: string; quote: string; type: 'spot'; name: string }
const COINS = ['BTC', 'ETH', 'USDT', 'LTC', 'XRP', 'BCH', 'BNB', 'EOS', 'DOGE', 'TRX', 'ADA', 'DOT', 'SOL', 'AVAX', 'LINK', 'MATIC', 'SHIB', 'UNI', 'XLM', 'ETC', 'ATOM', 'FIL', 'NEAR', 'TON', 'PEPE', 'AAVE', 'APT', 'ARB', 'SAND', 'MANA', 'GRT', 'FTM', 'OP', 'INJ', 'FLOKI', 'NOT', 'WLD', 'ENS', 'COMP', 'SNX'];
const split = (s: string) => (s.endsWith('IRT') ? [s.slice(0, -3), 'IRT'] : [s.slice(0, -4), 'USDT']) as [string, string];
const row = (s: string): NxMarket => { const [base, quote] = split(s); return { sym: s, base, quote, type: 'spot', name: `${base} / ${quote === 'IRT' ? 'Toman' : 'Tether'}` } };
export function fallbackMarkets(): NxMarket[] {
  return COINS.flatMap(c => (c === 'USDT' ? [`USDTIRT`] : [`${c}IRT`, `${c}USDT`])).map(row);
}
let mkCache: { at: number; list: NxMarket[] } | null = null;
export async function nobitexMarkets(): Promise<NxMarket[]> {
  if (mkCache && deps.now() - mkCache.at < 3600_000) return mkCache.list;
  let list: NxMarket[];
  try {
    const { data } = await fetchJson<Record<string, unknown>>(`${nobitexBaseUrl()}/v2/orderbook/all`, { ttl: 300_000, gap: 250 });
    const syms = Object.keys(data).filter(k => SYM.test(k));
    list = syms.length ? syms.sort().map(row) : fallbackMarkets();
  } catch { list = fallbackMarkets() }
  mkCache = { at: deps.now(), list };
  return list;
}

export interface Tick { sym: string; last: number; change: number; quoteVolume: number }
export async function nobitexTickers(): Promise<Tick[]> {
  const list = await nobitexMarkets(), div = await irtDivisor();
  const bases = [...new Set(list.map(m => m.base.toLowerCase()))].join(','), body = JSON.stringify({ srcCurrency: bases, dstCurrency: 'rls,usdt' });
  const { data } = await fetchJson<{ status?: string; stats?: Record<string, { latest?: string; dayChange?: string; volumeDst?: string }> }>(`${nobitexBaseUrl()}/market/stats`, { method: 'POST', body, ttl: 5_000, gap: 250 });
  if (data.status && data.status !== 'ok') throw Error('Nobitex: market stats refused');
  const known = new Set(list.map(m => m.sym));
  return Object.entries(data.stats ?? {}).flatMap(([k, v]) => {
    const [a, b] = k.split('-'), sym = `${a}${b === 'rls' ? 'IRT' : b}`.toUpperCase(), irt = sym.endsWith('IRT'), d = irt ? div : 1;
    const last = toNum(v.latest) / d;
    return known.has(sym) && last > 0 ? [{ sym, last, change: toNum(v.dayChange) || 0, quoteVolume: (toNum(v.volumeDst) || 0) / d }] : [];
  });
}
