// Strategy performance summary from a Broker run (subset of TradingView's Strategy Report metrics).
import type { Bar } from '../data.ts';
import type { Broker, Trade } from './strategy.ts';

/** What the tester needs, from any engine (Pine strategy or MQL expert). */
export interface TesterData { trades: Trade[]; equity: (number | undefined)[]; initialCapital: number; openPL: number; openCount: number }
export const fromBroker = (br: Broker, bars: Bar[]): TesterData => ({ trades: br.trades, equity: br.equity, initialCapital: br.props.initialCapital, openPL: br.openProfit(bars.at(-1)?.close ?? 0), openCount: br.open.length });

export interface Report {
  netProfit: number; netProfitPct: number; grossProfit: number; grossLoss: number; profitFactor: number;
  totalTrades: number; wins: number; losses: number; winRate: number;
  avgTrade: number; avgWin: number; avgLoss: number; winLossRatio: number; largestWin: number; largestLoss: number;
  maxDrawdown: number; maxDrawdownPct: number; maxRunup: number; avgBarsInTrade: number;
  buyHold: number; buyHoldPct: number; sharpe: number; sortino: number; commission: number; openPL: number;
  equity: { time: number; value: number }[];
}

export function report(d: TesterData, bars: Bar[]): Report {
  const t = d.trades, cap = d.initialCapital, last = bars.at(-1)?.close ?? 0;
  const wins = t.filter(x => x.profit > 0), losses = t.filter(x => x.profit < 0);
  const gp = wins.reduce((a, x) => a + x.profit, 0), gl = -losses.reduce((a, x) => a + x.profit, 0);
  const net = gp - gl;
  let prev = cap;
  const equity = bars.map((b, i) => ({ time: b.time, value: (prev = d.equity[i] ?? prev) }));
  let peak = cap, dd = 0, ddPct = 0, trough = cap, runup = 0;
  for (const e of equity) {
    if (e.value > peak) peak = e.value;
    if (peak - e.value > dd) { dd = peak - e.value; ddPct = (dd / peak) * 100 }
    trough = Math.min(trough, e.value); runup = Math.max(runup, e.value - trough);
  }
  // Sharpe/Sortino on per-bar equity returns, annualised by bars per year.
  const rets = equity.slice(1).map((e, i) => e.value / equity[i].value - 1).filter(Number.isFinite);
  const mean = rets.reduce((a, r) => a + r, 0) / (rets.length || 1);
  const sd = Math.sqrt(rets.reduce((a, r) => a + (r - mean) ** 2, 0) / (rets.length || 1));
  const dsd = Math.sqrt(rets.reduce((a, r) => a + Math.min(0, r) ** 2, 0) / (rets.length || 1));
  const secs = bars.length > 1 ? (bars.at(-1)!.time - bars[0].time) / (bars.length - 1) : 86400;
  const ann = Math.sqrt((365 * 86400) / secs);
  const first = bars[0]?.open ?? 0;
  return {
    netProfit: net, netProfitPct: (net / cap) * 100, grossProfit: gp, grossLoss: gl, profitFactor: gl ? gp / gl : gp ? Infinity : 0,
    totalTrades: t.length, wins: wins.length, losses: losses.length, winRate: t.length ? (wins.length / t.length) * 100 : 0,
    avgTrade: t.length ? net / t.length : 0, avgWin: wins.length ? gp / wins.length : 0, avgLoss: losses.length ? gl / losses.length : 0,
    winLossRatio: losses.length && wins.length ? (gp / wins.length) / (gl / losses.length) : 0,
    largestWin: Math.max(0, ...wins.map(x => x.profit)), largestLoss: Math.min(0, ...losses.map(x => x.profit)),
    maxDrawdown: dd, maxDrawdownPct: ddPct, maxRunup: runup,
    avgBarsInTrade: t.length ? t.reduce((a, x) => a + x.exitBar - x.entryBar, 0) / t.length : 0,
    buyHold: first ? (cap / first) * (last - first) : 0, buyHoldPct: first ? ((last - first) / first) * 100 : 0,
    sharpe: sd ? (mean / sd) * ann : 0, sortino: dsd ? (mean / dsd) * ann : 0,
    commission: t.reduce((a, x) => a + x.commission, 0), openPL: d.openPL,
    equity,
  };
}
