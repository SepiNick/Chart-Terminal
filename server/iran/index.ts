// The Iranian market sources as one table, so market.ts treats them like the other local sources (fx, mt5).
// Public multi-user servers leave them out unless CT_IRAN_PUBLIC=1: these are unofficial feeds for personal use and
// must not be re-served to other people (see docs/iran-market.md).
import type { Bar } from '../../src/data.ts';
import { isPublic } from '../core/mode.ts';
import { nobitexBars, nobitexMarkets, nobitexTickers } from './nobitex.ts';
import { tgjuBars, tgjuMarkets, tgjuTickers } from './tgju.ts';
import { tseBars, tseMarkets, tseTickers } from './tse.ts';
import { SATURDAY } from './util.ts';

export interface MarketRow { sym: string; base: string; quote: string; type: string; name?: string }
export interface Tick { sym: string; last: number; change: number; quoteVolume: number }
export interface IranSource {
  id: string; name: string;
  bars(sym: string, tf: string, until?: number, limit?: number): Promise<{ bars: Bar[]; base: string }>;
  markets(): Promise<MarketRow[]> | MarketRow[];
  tickers?(): Promise<Tick[]>;
  /** Live polling interval, ms. */
  every: number;
  /** Where week buckets start (seconds from the epoch week). */
  weekAnchor: number;
}
const MONDAY = 345600;
const ALL: IranSource[] = [
  { id: 'nobitex', name: 'Nobitex (Toman and Tether markets)', bars: nobitexBars, markets: nobitexMarkets, tickers: nobitexTickers, every: 5_000, weekAnchor: MONDAY },
  { id: 'tgju', name: 'Dollar, gold and coins (Iran free market)', bars: tgjuBars, markets: tgjuMarkets, tickers: tgjuTickers, every: 60_000, weekAnchor: SATURDAY },
  { id: 'tse', name: 'Tehran Stock Exchange: stocks, funds, bonds, indices', bars: tseBars, markets: tseMarkets, tickers: tseTickers, every: 15_000, weekAnchor: SATURDAY },
];
export const IRAN: Record<string, IranSource> = isPublic && process.env['CT_IRAN_PUBLIC'] !== '1' ? {} : Object.fromEntries(ALL.map(s => [s.id, s]));
