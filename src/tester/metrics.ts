// The 53 Strategy Report metrics, computed from any engine's TesterData on the bars it ran on.
// Positions per bar are rebuilt from the trade list, so margin and intrabar figures work for every engine.
import type { Bar, MetricDef, Metrics, TesterData, Trade } from './types.ts';

export interface MetricOpts {
  side?: 'long' | 'short';     // only this side's trades (equity is rebuilt from them)
  riskFreeRate?: number;       // annual %, TradingView default 2
  marginPct?: number;          // margin for long and short positions, % of notional (100 = no leverage)
  positions?: boolean;         // false: trades are not priced by these bars (portfolio), skip margin/intrabar/contracts
}

const R = 'Returns', A = 'Risk-adjusted performance', T = 'Trades', C = 'Capital efficiency', D = 'Run-ups and drawdowns';
const def = (key: string, label: string, group: MetricDef['group'], format: MetricDef['format'], higherIsBetter = true): MetricDef => ({ key, label, group, format, higherIsBetter });
export const METRIC_DEFS: MetricDef[] = [
  def('initialCapital', 'Initial capital', R, 'money'), def('openPL', 'Open P&L', R, 'money'), def('netProfit', 'Net P&L', R, 'money'),
  def('netProfitPct', 'Return on initial capital', R, 'pct'), def('grossProfit', 'Gross profit', R, 'money'), def('grossLoss', 'Gross loss', R, 'money', false),
  def('profitFactor', 'Profit factor', R, 'ratio'), def('commission', 'Commission paid', R, 'money', false), def('expectedPayoff', 'Expected payoff', R, 'money'),
  def('buyHold', 'Buy & hold P&L', R, 'money'), def('buyHoldPct', 'Buy & hold % gain', R, 'pct'), def('outperformance', 'Strategy outperformance', R, 'money'),
  def('cagr', 'Annualized return (CAGR)', R, 'pct'),
  def('sharpe', 'Sharpe ratio', A, 'ratio'), def('sortino', 'Sortino ratio', A, 'ratio'),
  def('totalTrades', 'Total trades', T, 'int'), def('openTrades', 'Total open trades', T, 'int'), def('wins', 'Winning trades', T, 'int'),
  def('losses', 'Losing trades', T, 'int', false), def('even', 'Even trades', T, 'int'), def('winRate', 'Percent profitable', T, 'pct'),
  def('avgTrade', 'Average P&L', T, 'money'), def('avgWin', 'Average profit', T, 'money'), def('avgLoss', 'Average loss', T, 'money', false),
  def('winLossRatio', 'Avg profit / avg loss', T, 'ratio'), def('largestWin', 'Largest profit', T, 'money'), def('largestWinPct', 'Largest profit % of gross profit', T, 'pct', false),
  def('largestLoss', 'Largest loss', T, 'money'), def('largestLossPct', 'Largest loss % of gross loss', T, 'pct', false),
  def('avgBars', 'Average bars in trades', T, 'bars'), def('avgBarsWin', 'Average bars in winning trades', T, 'bars'), def('avgBarsLoss', 'Average bars in losing trades', T, 'bars', false),
  def('maxContracts', 'Max contracts held', T, 'number'),
  def('accountSize', 'Account size required', C, 'money', false), def('returnOnAccount', 'Return on account size required', C, 'pct'),
  def('netPctOfLargestLoss', 'Net profit as % of largest loss', C, 'pct'), def('avgMargin', 'Average margin used', C, 'money', false),
  def('maxMargin', 'Max margin used', C, 'money', false), def('marginEfficiency', 'Margin efficiency', C, 'pct'), def('marginCalls', 'Margin calls', C, 'int', false),
  def('liquidatedVolume', 'Total liquidated volume', C, 'number', false), def('largestLiquidation', 'Largest liquidated volume', C, 'number', false),
  def('avgRunupBars', 'Average run-up duration (bars)', D, 'bars'), def('avgRunup', 'Average run-up', D, 'money'), def('maxRunup', 'Max run-up (close-to-close)', D, 'money'),
  def('maxRunupIntrabar', 'Max run-up (intrabar)', D, 'money'), def('maxRunupPct', 'Max run-up % of initial capital', D, 'pct'),
  def('avgDrawdownBars', 'Average drawdown duration (bars)', D, 'bars', false), def('avgDrawdown', 'Average drawdown', D, 'money', false),
  def('maxDrawdown', 'Max drawdown (close-to-close)', D, 'money', false), def('maxDrawdownIntrabar', 'Max drawdown (intrabar)', D, 'money', false),
  def('maxDrawdownPct', 'Max drawdown % of initial capital', D, 'pct', false), def('returnOfMaxDrawdown', 'Return of max drawdown', D, 'ratio'),
];

const sum = (a: number[]) => a.reduce((s, x) => s + x, 0);
const avg = (a: number[]) => (a.length ? sum(a) / a.length : 0);

/** Equity per bar from a trade list: closed profit to date + open profit of trades still running at that bar's close. */
export function equityFromTrades(trades: Trade[], bars: Bar[], cap: number): number[] {
  const realized = new Array(bars.length).fill(0);
  for (const t of trades) if (t.exitBar < bars.length) realized[Math.max(0, t.exitBar)] += t.profit;
  let cum = 0;
  return bars.map((b, i) => {
    cum += realized[i];
    let open = 0;
    for (const t of trades) if (t.entryBar <= i && i < t.exitBar) open += (b.close - t.entryPrice) * t.qty * (t.dir === 'long' ? 1 : -1);
    return cap + cum + open;
  });
}

/** Peak-to-trough episodes of a series: each ends when the series makes a new high (drawdowns) or a new low (run-ups). */
function episodes(eq: number[], up: boolean) {
  const out: { depth: number; bars: number }[] = [];
  let ref = eq[0], refBar = 0, ext = eq[0], depth = 0;
  const flush = (i: number) => { if (depth > 0) out.push({ depth, bars: i - refBar }) };
  for (let i = 1; i < eq.length; i++) {
    const v = eq[i];
    if (up ? v <= ref : v >= ref) { flush(i); ref = ext = v; refBar = i; depth = 0; continue }
    if (up ? v > ext : v < ext) ext = v;
    depth = Math.abs(ext - ref);
  }
  flush(eq.length - 1);
  return out;
}

export function metrics(d: TesterData, bars: Bar[], o: MetricOpts = {}): Metrics {
  const cap = d.initialCapital, rf = (o.riskFreeRate ?? 2) / 100, margin = (o.marginPct ?? 100) / 100;
  const t = o.side ? d.trades.filter(x => x.dir === o.side) : d.trades;
  let eq: number[];
  if (o.side) eq = equityFromTrades(t, bars, cap);
  else { let prev = cap; eq = bars.map((_, i) => (prev = d.equity[i] ?? prev)) }
  if (!eq.length) eq = [cap];

  const wins = t.filter(x => x.profit > 0), losses = t.filter(x => x.profit < 0);
  const gp = sum(wins.map(x => x.profit)), gl = -sum(losses.map(x => x.profit)), net = gp - gl;
  const openPL = o.side ? 0 : d.openPL;
  const first = bars[0]?.open ?? 0, last = bars.at(-1)?.close ?? 0;
  const buyHold = first ? (cap / first) * (last - first) : 0;
  const days = bars.length > 1 ? (bars.at(-1)!.time - bars[0].time) / 86400 : 0;
  const finalEq = eq.at(-1)!;
  const largestWin = Math.max(0, ...wins.map(x => x.profit)), largestLoss = Math.min(0, ...losses.map(x => x.profit));

  // Monthly returns of equity → Sharpe/Sortino the way TradingView documents them (not annualised).
  const monthEnd = new Map<string, number>();
  bars.forEach((b, i) => monthEnd.set(new Date(b.time * 1000).toISOString().slice(0, 7), eq[i]));
  const months = [...monthEnd.values()], mr: number[] = [];
  let prevM = cap;
  for (const v of months) { mr.push(v / prevM - 1); prevM = v }
  const ex = mr.map(r => r - rf / 12), mean = avg(ex);
  const sd = Math.sqrt(avg(ex.map(r => (r - mean) ** 2))), dsd = Math.sqrt(avg(ex.map(r => Math.min(0, r) ** 2)));

  // Positions per bar (closed trades + whatever is still open shows only through openPL).
  let maxQty = 0, maxMargin = 0, marginSum = 0, marginBars = 0, calls = 0, liq = 0, liqMax = 0, inCall = false;
  const low = eq.slice(), high = eq.slice();
  for (let i = 0; i < bars.length && o.positions !== false; i++) {
    const b = bars[i];
    let qty = 0, notional = 0, adverse = 0, favour = 0;
    for (const x of t) {
      if (!(x.entryBar <= i && i < x.exitBar)) continue;
      const long = x.dir === 'long';
      qty += long ? x.qty : -x.qty; notional += x.qty * b.close;
      adverse += x.qty * (long ? b.close - b.low : b.high - b.close);
      favour += x.qty * (long ? b.high - b.close : b.close - b.low);
    }
    maxQty = Math.max(maxQty, Math.abs(qty));
    const used = notional * margin;
    if (used > 0) { marginSum += used; marginBars++; maxMargin = Math.max(maxMargin, used) }
    // shortcut: margin calls are reported, not simulated (the engines never liquidate). Volume = 4× the shortfall, like TradingView.
    const short = used - eq[i];
    if (short > 0 && !inCall) { calls++; const v = (4 * short) / (b.close * margin); liq += v; liqMax = Math.max(liqMax, v) }
    inCall = short > 0;
    low[i] = eq[i] - adverse; high[i] = eq[i] + favour;
  }

  const dds = episodes(eq, false), rus = episodes(eq, true);
  let peak = cap, ddI = 0, trough = cap, ruI = 0;
  for (let i = 0; i < eq.length; i++) {
    ddI = Math.max(ddI, peak - low[i]); ruI = Math.max(ruI, high[i] - trough);
    peak = Math.max(peak, eq[i]); trough = Math.min(trough, eq[i]);
  }
  const maxDD = Math.max(0, ...dds.map(e => e.depth)), maxRU = Math.max(0, ...rus.map(e => e.depth));
  const accountSize = maxMargin + Math.max(maxDD, ddI);
  const cagr = days > 0 && finalEq > 0 ? ((finalEq / cap) ** (365 / days) - 1) * 100 : 0;
  const avgMargin = marginBars ? marginSum / marginBars : 0;

  return {
    initialCapital: cap, openPL, netProfit: net, netProfitPct: (net / cap) * 100, grossProfit: gp, grossLoss: gl,
    profitFactor: gl ? gp / gl : gp ? Infinity : 0, commission: sum(t.map(x => x.commission)), expectedPayoff: t.length ? net / t.length : 0,
    buyHold, buyHoldPct: first ? ((last - first) / first) * 100 : 0, outperformance: net - buyHold, cagr,
    sharpe: sd ? mean / sd : 0, sortino: dsd ? mean / dsd : 0,
    totalTrades: t.length, openTrades: o.side ? 0 : d.openCount, wins: wins.length, losses: losses.length, even: t.length - wins.length - losses.length,
    winRate: t.length ? (wins.length / t.length) * 100 : 0, avgTrade: t.length ? net / t.length : 0,
    avgWin: wins.length ? gp / wins.length : 0, avgLoss: losses.length ? gl / losses.length : 0,
    winLossRatio: wins.length && losses.length ? (gp / wins.length) / (gl / losses.length) : 0,
    largestWin, largestWinPct: gp ? (largestWin / gp) * 100 : 0, largestLoss, largestLossPct: gl ? (-largestLoss / gl) * 100 : 0,
    avgBars: avg(t.map(x => x.exitBar - x.entryBar)), avgBarsWin: avg(wins.map(x => x.exitBar - x.entryBar)), avgBarsLoss: avg(losses.map(x => x.exitBar - x.entryBar)),
    maxContracts: maxQty,
    accountSize, returnOnAccount: accountSize ? (net / accountSize) * 100 : 0, netPctOfLargestLoss: largestLoss ? (net / -largestLoss) * 100 : 0,
    avgMargin, maxMargin, marginEfficiency: avgMargin ? (net / avgMargin) * 100 : 0, marginCalls: calls, liquidatedVolume: liq, largestLiquidation: liqMax,
    avgRunupBars: avg(rus.map(e => e.bars)), avgRunup: avg(rus.map(e => e.depth)), maxRunup: maxRU, maxRunupIntrabar: Math.max(maxRU, ruI), maxRunupPct: (maxRU / cap) * 100,
    avgDrawdownBars: avg(dds.map(e => e.bars)), avgDrawdown: avg(dds.map(e => e.depth)), maxDrawdown: maxDD, maxDrawdownIntrabar: Math.max(maxDD, ddI),
    maxDrawdownPct: (maxDD / cap) * 100, returnOfMaxDrawdown: maxDD ? net / maxDD : 0,
  };
}

/** Value formatted for display/CSV. */
export function fmtMetric(def: MetricDef, v: number): string {
  if (!Number.isFinite(v)) return v > 0 ? '∞' : '—';
  switch (def.format) {
    case 'money': return v.toFixed(2);
    case 'pct': return `${v.toFixed(2)}%`;
    case 'ratio': return v.toFixed(3);
    case 'int': return String(Math.round(v));
    case 'bars': return v.toFixed(1);
    default: return String(+v.toFixed(6));
  }
}
