// Adapter from a Broker run to the shared Strategy Tester input.
import type { Bar } from '../data.ts';
import type { Broker, Trade } from './strategy.ts';

/** What the tester needs, from any engine (Pine strategy or MQL expert). */
export interface TesterData { trades: Trade[]; equity: (number | undefined)[]; initialCapital: number; openPL: number; openCount: number }
export const fromBroker = (br: Broker, bars: Bar[]): TesterData => ({ trades: br.trades, equity: br.equity, initialCapital: br.props.initialCapital, openPL: br.openProfit(bars.at(-1)?.close ?? 0), openCount: br.open.length });
