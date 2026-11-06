// Screener Pro, the data side (no DOM): rows from exchange tickers, filters, and the daily-bar metrics (performance, volume change,
// technical rating, RSI) that are computed lazily for the rows being looked at.
import type { Bar } from '../data.ts';
import { rsi } from '../indicators.ts';
import { technicalRating } from './analysis.ts';
import { matches, parseQuery, type Query } from './query.ts';

export type SymType = 'spot' | 'perpetual' | 'future';
export interface Metrics { perf1w: number | null; perf1m: number | null; perf3m: number | null; perf6m: number | null; perfytd: number | null; volchg: number | null; rsi: number | null; rating: number | null; ma: number | null; osc: number | null; label: string }
export interface Row { key: string; sym: string; ex: string; base: string; quote: string; type: SymType; price: number; chg: number; qv: number | null; m?: Metrics }

const QUOTES = ['FDUSD', 'USDT', 'USDC', 'BUSD', 'TUSD', 'DAI', 'USD', 'EUR', 'TRY', 'BRL', 'BTC', 'ETH', 'BNB'];
export const USD_QUOTES = new Set(['USDT', 'USDC', 'USD', 'BUSD', 'FDUSD', 'TUSD', 'DAI', 'USDE']);

/** Raw exchange symbol ("BTC_USDT", "BTC_USDT.P", "BTC_USD.F250627", Binance's "BTCUSDT") → its parts. */
export function parseSymbol(raw: string): { base: string; quote: string; type: SymType } | null {
  const [pair, suffix = ''] = raw.toUpperCase().split('.');
  const type: SymType = suffix.startsWith('P') ? 'perpetual' : suffix.startsWith('F') ? 'future' : 'spot';
  if (pair.includes('_')) { const [base, quote] = pair.split('_'); return base && quote ? { base, quote, type } : null }
  const q = QUOTES.find(x => pair.endsWith(x) && pair.length > x.length);
  return q ? { base: pair.slice(0, -q.length), quote: q, type } : null;
}

export interface RawTicker { sym: string; last: number; change: number; quoteVolume: number }
/** `direct`: Binance spot read by the browser (app symbol "BTCUSDT"); otherwise the symbol is "EXCHANGE:RAW". */
export function toRow(ex: string, t: RawTicker, direct: boolean): Row | null {
  const p = parseSymbol(t.sym);
  if (!p || !Number.isFinite(t.last) || t.last <= 0) return null;
  const sym = direct ? t.sym : `${ex.toUpperCase()}:${t.sym}`;
  return { key: `${ex}|${t.sym}`, sym, ex, ...p, price: t.last, chg: t.change, qv: USD_QUOTES.has(p.quote) && Number.isFinite(t.quoteVolume) ? t.quoteVolume : null };
}

// ---------- metrics from daily bars ----------
const pct = (a: number, b: number | undefined) => (b && Number.isFinite(b) ? (a / b - 1) * 100 : null);
export function metricsOf(b: Bar[], qv: number | null): Metrics | null {
  if (b.length < 8) return null;
  const c = b.map(x => x.close), last = c.at(-1)!, back = (n: number) => (c.length > n ? pct(last, c[c.length - 1 - n]) : null);
  const year = new Date(b.at(-1)!.time * 1000).getUTCFullYear(), first = b.find(x => new Date(x.time * 1000).getUTCFullYear() === year);
  const prev = b.at(-2)!, r = b.length > 30 ? technicalRating(b) : null;
  return {
    perf1w: back(7), perf1m: back(30), perf3m: back(90), perf6m: back(180), perfytd: first && first.time !== b[0].time ? pct(last, first.open) : null,
    volchg: qv != null && prev.volume && prev.close ? pct(qv, prev.volume * prev.close) : null,
    rsi: rsi(c, 14).at(-1) ?? null, rating: r?.all ?? null, ma: r?.ma ?? null, osc: r?.osc ?? null, label: r?.label ?? '',
  };
}

// ---------- filters ----------
export type Field = 'chg' | 'qv' | 'price' | 'volchg' | 'rating' | 'rsi' | 'perf1w' | 'perf1m' | 'perf3m' | 'perf6m' | 'perfytd';
export const LAZY = new Set<Field>(['volchg', 'rating', 'rsi', 'perf1w', 'perf1m', 'perf3m', 'perf6m', 'perfytd']);
export interface Range { min?: number; max?: number }
export interface Filters { exchanges: string[]; types: SymType[]; bases: string[]; quotes: string[]; watch: string[] | null; ranges: Partial<Record<Field, Range>>; cond: string }
export const emptyFilters = (): Filters => ({ exchanges: ['binance'], types: [], bases: [], quotes: ['USDT'], watch: null, ranges: {}, cond: '' });

export const valueOf = (r: Row, f: Field): number | null => (f === 'chg' ? r.chg : f === 'qv' ? r.qv : f === 'price' ? r.price : r.m?.[f] ?? null);
export const needsMetrics = (F: Filters) => Object.keys(F.ranges).some(k => LAZY.has(k as Field) && (F.ranges[k as Field]?.min != null || F.ranges[k as Field]?.max != null)) || /\b(rsi|rating|sma|ema)\b/i.test(F.cond);

/** The conditions that need no daily bars (everything but the lazy fields). */
export function matchesCheap(r: Row, F: Filters): boolean {
  if (F.exchanges.length && !F.exchanges.includes(r.ex)) return false;
  if (F.types.length && !F.types.includes(r.type)) return false;
  if (F.bases.length && !F.bases.includes(r.base)) return false;
  if (F.quotes.length && !F.quotes.includes(r.quote)) return false;
  if (F.watch && !F.watch.includes(r.sym)) return false;
  for (const [k, g] of Object.entries(F.ranges) as [Field, Range][]) {
    if (LAZY.has(k) || !g) continue;
    const v = valueOf(r, k);
    if ((g.min != null || g.max != null) && v == null) return false;
    if ((g.min != null && v! < g.min) || (g.max != null && v! > g.max)) return false;
  }
  return true;
}
/** Everything, with the lazy fields: a row whose metrics are not loaded yet does not pass a lazy filter. */
export function matchesAll(r: Row, F: Filters, q: Query | null): boolean {
  if (!matchesCheap(r, F)) return false;
  for (const [k, g] of Object.entries(F.ranges) as [Field, Range][]) {
    if (!LAZY.has(k) || !g || (g.min == null && g.max == null)) continue;
    const v = valueOf(r, k);
    if (v == null || (g.min != null && v < g.min) || (g.max != null && v > g.max)) return false;
  }
  if (q) return matches(q, { price: r.price, change: r.chg, volume: r.qv ?? 0, rsi: r.m?.rsi, rating: r.m?.rating });
  return true;
}
export function safeQuery(text: string): { q: Query | null; error?: string } {
  if (!text.trim()) return { q: null };
  try { return { q: parseQuery(text) } } catch (e) { return { q: null, error: (e as Error).message } }
}

export function sortRows(rows: Row[], key: string, desc: boolean): Row[] {
  const get = (r: Row): number | string | null => (key === 'sym' ? r.base + r.quote : valueOf(r, key as Field));
  return [...rows].sort((a, b) => {
    const x = get(a), y = get(b);
    if (x == null && y == null) return 0;
    if (x == null) return 1;   // rows without a value always sink
    if (y == null) return -1;
    return (typeof x === 'string' ? x.localeCompare(y as string) : x - (y as number)) * (desc ? -1 : 1);
  });
}

/** "*​/usdt.p" style summary of the symbol filters, shown as the screen title. */
export function titleOf(F: Filters): string {
  const suffix = F.types.length === 1 ? { spot: '', perpetual: '.p', future: '.f' }[F.types[0]] : '';
  return `${F.bases.length ? F.bases.map(x => x.toLowerCase()).join(',') : '*'}/${F.quotes.length ? F.quotes.map(x => x.toLowerCase()).join(',') : '*'}${suffix}`;
}
