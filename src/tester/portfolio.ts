// Portfolio backtest: the same strategy run on several symbols, capital split equally, results merged on one timeline.
import { metrics } from './metrics.ts';
import type { Bar, Metrics, TesterData, Trade } from './types.ts';

export interface Leg { symbol: string; bars: Bar[]; data: TesterData }
export interface Portfolio {
  bars: Bar[];                 // shared timeline; OHLC = equal-weight buy & hold index (starts at 100)
  data: TesterData;            // merged, trades re-indexed to the timeline and scaled to each leg's allocation
  metrics: Metrics;
  legs: { symbol: string; metrics: Metrics; share: number /* % of portfolio net profit */ }[];
}

export function combine(legs: Leg[], capital: number): Portfolio {
  const times = [...new Set(legs.flatMap(l => l.bars.map(b => b.time)))].sort((a, b) => a - b);
  const idx = new Map(times.map((t, i) => [t, i]));
  const alloc = capital / (legs.length || 1);
  const equity = new Array<number>(times.length).fill(0), index = new Array<number>(times.length).fill(0);
  const trades: Trade[] = [];
  let openPL = 0, openCount = 0;
  for (const l of legs) {
    const k = alloc / l.data.initialCapital, first = l.bars[0]?.open || 1;
    let j = 0, eq = l.data.initialCapital, px = first;
    // Forward-fill each leg on the shared timeline (before its first bar it holds cash).
    times.forEach((t, i) => {
      while (j < l.bars.length && l.bars[j].time <= t) { eq = l.data.equity[j] ?? eq; px = l.bars[j].close; j++ }
      equity[i] += eq * k; index[i] += (px / first) * 100 / legs.length;
    });
    const at = (bar: number) => idx.get(l.bars[Math.min(bar, l.bars.length - 1)]?.time) ?? 0;
    for (const t of l.data.trades) trades.push({ ...t, entryId: `${l.symbol} ${t.entryId}`, entryBar: at(t.entryBar), exitBar: at(t.exitBar), qty: t.qty * k, profit: t.profit * k, commission: t.commission * k, runup: t.runup * k, drawdown: t.drawdown * k });
    openPL += l.data.openPL * k; openCount += l.data.openCount;
  }
  trades.sort((a, b) => a.exitTime - b.exitTime);
  const bars = times.map((time, i) => ({ time, open: index[i], high: index[i], low: index[i], close: index[i], volume: 0 }));
  if (bars.length) bars[0].open = 100;
  const data: TesterData = { trades, equity, initialCapital: capital, openPL, openCount };
  const m = metrics(data, bars, { positions: false });
  return {
    bars, data, metrics: m,
    legs: legs.map(l => { const lm = metrics(l.data, l.bars); return { symbol: l.symbol, metrics: lm, share: m.netProfit ? (lm.netProfit * (alloc / l.data.initialCapital) / m.netProfit) * 100 : 0 } }),
  };
}
