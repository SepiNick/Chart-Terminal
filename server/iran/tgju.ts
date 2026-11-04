// Dollar, other currencies, gold and coins in the Iranian free market, from tgju.org's chart table (daily history).
//   GET {base}/market/indicator/summary-table-data/{slug}?lang=fa&order_dir=desc&start=0&length=N
//   → {data: [[open, low, high, close, change, change%, "2026-03-21", "1405/01/01"], …]}, newest first, Rial, numbers as text.
// This is the endpoint tgju's own chart pages use; it is undocumented, can change without notice, and has NOT been run
// from here. Check it with `npm run check:ir`. tgju's terms apply: personal use only, see docs/iran-market.md.
import type { Bar } from '../../src/data.ts';
import { toGregorian } from '../../src/jalali.ts';
import { fetchJson, toNum } from './http.ts';
import { cleanBars, monthlyJalali, window } from './util.ts';

export const tgjuBaseUrl = () => process.env['CT_TGJU_BASE'] ?? 'https://api.tgju.org/v1';

export interface TgjuItem { slug: string; name: string; type: 'currency' | 'gold' | 'coin'; /** Quoted in Rial (÷10 → Toman) unless it is a dollar price. */ rial: boolean }
export const TGJU_ITEMS: Record<string, TgjuItem> = {
  USD: { slug: 'price_dollar_rl', name: 'دلار آزاد', type: 'currency', rial: true },
  EUR: { slug: 'price_eur', name: 'یورو', type: 'currency', rial: true },
  GBP: { slug: 'price_gbp', name: 'پوند', type: 'currency', rial: true },
  AED: { slug: 'price_aed', name: 'درهم امارات', type: 'currency', rial: true },
  TRY: { slug: 'price_try', name: 'لیر ترکیه', type: 'currency', rial: true },
  GOLD18: { slug: 'geram18', name: 'طلای ۱۸ عیار (گرم)', type: 'gold', rial: true },
  GOLD24: { slug: 'geram24', name: 'طلای ۲۴ عیار (گرم)', type: 'gold', rial: true },
  MESGHAL: { slug: 'mesghal', name: 'مثقال طلا', type: 'gold', rial: true },
  ONS: { slug: 'ons', name: 'اونس طلا (دلار)', type: 'gold', rial: false },
  SEKKEH: { slug: 'sekee', name: 'سکه امامی', type: 'coin', rial: true },
  SEKKEH_OLD: { slug: 'sekeb', name: 'سکه بهار آزادی', type: 'coin', rial: true },
  NIM: { slug: 'nim', name: 'نیم‌سکه', type: 'coin', rial: true },
  ROB: { slug: 'rob', name: 'ربع‌سکه', type: 'coin', rial: true },
  GERAMI: { slug: 'gerami', name: 'سکه گرمی', type: 'coin', rial: true },
};

const stripTags = (x: unknown) => (typeof x === 'string' ? x.replace(/<[^>]*>/g, '') : x);
/** A table row → daily bar (Toman), or null for a row that cannot be read. */
export function rowToBar(r: unknown, rial: boolean): Bar | null {
  if (!Array.isArray(r) || r.length < 4) return null;
  const d = rial ? 10 : 1, [o, l, h, c] = r.slice(0, 4).map(x => toNum(stripTags(x)) / d);
  if (!(c > 0) || !(h > 0) || !(l > 0)) return null;
  const g = /(\d{4})\D+(\d{1,2})\D+(\d{1,2})/.exec(String(stripTags(r[6]) ?? '')), j = /(\d{4})\D+(\d{1,2})\D+(\d{1,2})/.exec(String(stripTags(r[7]) ?? ''));
  let t: number;
  if (g && +g[1] > 1900) t = Date.UTC(+g[1], +g[2] - 1, +g[3]) / 1000;
  else if (j) { const x = toGregorian(+j[1], +j[2], +j[3]); t = Date.UTC(x.y, x.m - 1, x.d) / 1000 }
  else return null;
  return { time: t, open: o > 0 ? o : c, high: Math.max(h, o || 0, c), low: Math.min(l, o > 0 ? o : l, c), close: c, volume: 0 };
}

export const known = (sym: string) => sym in TGJU_ITEMS;
export async function tgjuBars(sym: string, tf: string, until?: number, limit = 1000): Promise<{ bars: Bar[]; base: string }> {
  const it = TGJU_ITEMS[sym]; if (!it) throw Error(`Unknown symbol TGJU:${sym}`);
  if (!['1d', '1w', '1M'].includes(tf) && !/^\d+[dw]$/.test(tf)) throw Error(`TGJU has daily prices only: use 1D or longer (not ${tf})`);
  const n = tf === '1M' ? limit * 31 : /w$/.test(tf) ? limit * 7 * (parseInt(tf, 10) || 1) : limit * (parseInt(tf, 10) || 1);
  const q = new URLSearchParams({ lang: 'fa', order_dir: 'desc', start: '0', length: String(Math.min(6000, Math.max(40, Math.ceil(n)))) });
  const { data } = await fetchJson<{ data?: unknown[]; rows?: unknown[] }>(`${tgjuBaseUrl()}/market/indicator/summary-table-data/${it.slug}?${q}`, { ttl: 30_000, gap: 500 });
  const rows = data.data ?? data.rows;
  if (!Array.isArray(rows)) throw Error('TGJU: unexpected table reply');
  const bars = cleanBars(rows.flatMap(r => rowToBar(r, it.rial) ?? []));
  if (!bars.length && rows.length) throw Error('TGJU: could not read any row of the table');
  if (tf === '1M') return { bars: window(monthlyJalali(bars), until, limit), base: '1M' };
  return { bars: window(bars, until, Math.max(limit, 40)), base: '1d' };
}

export interface TgjuMarket { sym: string; base: string; quote: string; type: string; name: string }
export const tgjuMarkets = (): TgjuMarket[] => Object.entries(TGJU_ITEMS).map(([sym, i]) => ({ sym, base: sym, quote: i.rial ? 'IRT' : 'USD', type: i.type, name: i.name }));
