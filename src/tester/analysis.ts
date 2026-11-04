// Strategy Report extras: a date range to restrict the report to, and the analysis tabs (monthly returns, distribution
// of trade returns, win/loss streaks). Pure functions on TesterData and the bars it ran on.
import { equityFromTrades } from './metrics.ts';
import type { Bar, TesterData, Trade } from './types.ts';

type RangePreset = 'all' | '30d' | '90d' | 'ytd' | '1y' | 'custom';
/** The user's choice; custom dates are 'YYYY-MM-DD' (UTC, both days inclusive). */
export interface RangeSel { preset: RangePreset; from?: string; to?: string }
/** Unix-second bounds, both inclusive; null = open. */
export interface Bounds { from: number | null; to: number | null }

const DAY = 86400;
/** Bounds of a choice. Presets count back from `end` (the last bar's time) so old data still gets a useful range. */
export function rangeBounds(sel: RangeSel, end: number): Bounds {
  const back = (days: number) => ({ from: end - days * DAY, to: null });
  switch (sel.preset) {
    case '30d': return back(30);
    case '90d': return back(90);
    case '1y': return back(365);
    case 'ytd': return { from: Date.UTC(new Date(end * 1000).getUTCFullYear(), 0, 1) / 1000, to: null };
    case 'custom': {
      const d = (s?: string) => { const t = s ? Date.parse(`${s}T00:00:00Z`) : NaN; return Number.isFinite(t) ? t / 1000 : null };
      const to = d(sel.to);
      return { from: d(sel.from), to: to == null ? null : to + DAY - 1 };
    }
    default: return { from: null, to: null };
  }
}

/**
 * The report restricted to trades opened inside `b`: bars start at the range's first bar and run to its last one (or
 * further, until the last of those trades closed), trades are re-indexed to that slice and the equity is rebuilt from
 * them alone, starting at the initial capital. The open position counts only when the range reaches the last bar.
 */
export function sliceReport(d: TesterData, bars: Bar[], b: Bounds): { data: TesterData; bars: Bar[] } {
  if (b.from == null && b.to == null) return { data: d, bars };
  const inside = (t: number) => (b.from == null || t >= b.from) && (b.to == null || t <= b.to);
  const i0 = bars.findIndex(x => inside(x.time));
  if (i0 < 0) return { data: { ...d, trades: [], equity: [], openPL: 0, openCount: 0 }, bars: [] };
  let i1 = i0;
  while (i1 < bars.length && inside(bars[i1].time)) i1++;
  const picked = d.trades.filter(t => inside(t.entryTime) && t.entryBar >= i0);
  for (const t of picked) i1 = Math.max(i1, Math.min(bars.length, t.exitBar + 1));
  const trades = picked.map(t => ({ ...t, entryBar: t.entryBar - i0, exitBar: t.exitBar - i0 }));
  const sb = bars.slice(i0, i1), atEnd = i1 === bars.length;
  return { bars: sb, data: { trades, equity: equityFromTrades(trades, sb, d.initialCapital), initialCapital: d.initialCapital, openPL: atEnd ? d.openPL : 0, openCount: atEnd ? d.openCount : 0 } };
}

interface MonthCell { pct: number; pl: number }
export interface YearRow { year: number; months: (MonthCell | null)[]; total: MonthCell }
/** Equity change per calendar month (UTC): % of the previous month's closing equity (initial capital for the first). */
export function monthlyReturns(d: TesterData, bars: Bar[]): YearRow[] {
  const rows = new Map<number, YearRow>();
  let eq = d.initialCapital, prevEnd = eq, key = -1, yearStart = eq;
  const close = () => {
    if (key < 0) return;
    const y = Math.floor(key / 12), r = rows.get(y) ?? { year: y, months: Array(12).fill(null), total: { pct: 0, pl: 0 } };
    if (!rows.has(y)) { rows.set(y, r); yearStart = prevEnd }
    r.months[key % 12] = { pl: eq - prevEnd, pct: prevEnd ? (eq / prevEnd - 1) * 100 : 0 };
    r.total = { pl: eq - yearStart, pct: yearStart ? (eq / yearStart - 1) * 100 : 0 };
    prevEnd = eq;
  };
  bars.forEach((b, i) => {
    const t = new Date(b.time * 1000), k = t.getUTCFullYear() * 12 + t.getUTCMonth();
    if (k !== key) { close(); key = k }
    eq = d.equity[i] ?? eq;
  });
  close();
  return [...rows.values()];
}

export interface Distribution { width: number; buckets: { from: number; to: number; count: number }[]; mean: number; median: number; wins: number; losses: number }
/** Histogram of trade % returns: equal-width buckets aligned on 0 (so none mixes profits and losses), about `target` of them. */
export function returnDistribution(trades: Trade[], target = 20): Distribution {
  const r = trades.map(t => t.profitPct).filter(Number.isFinite).sort((a, b) => a - b);
  if (!r.length) return { width: 0, buckets: [], mean: 0, median: 0, wins: 0, losses: 0 };
  const lo = r[0], hi = r.at(-1)!, raw = (hi - lo) / target || 1, mag = 10 ** Math.floor(Math.log10(raw));
  const width = [1, 2, 2.5, 5, 10].map(m => m * mag).find(w => w >= raw)!;
  const k0 = Math.floor(lo / width), k1 = Math.floor(hi / width);
  const buckets = Array.from({ length: k1 - k0 + 1 }, (_, i) => ({ from: (k0 + i) * width, to: (k0 + i + 1) * width, count: 0 }));
  for (const x of r) buckets[Math.floor(x / width) - k0].count++;
  const mid = r.length >> 1;
  return { width, buckets, mean: r.reduce((s, x) => s + x, 0) / r.length, median: r.length % 2 ? r[mid] : (r[mid - 1] + r[mid]) / 2, wins: r.filter(x => x > 0).length, losses: r.filter(x => x < 0).length };
}

export interface Streaks { maxWin: number; maxLoss: number; current: { kind: 'win' | 'loss' | null; len: number }; dist: { len: number; wins: number; losses: number }[] }
/** Runs of consecutive winning / losing trades in exit order (an even trade ends a run). */
export function streaks(trades: Trade[]): Streaks {
  const runs: { kind: 'win' | 'loss'; len: number }[] = [];
  let run: { kind: 'win' | 'loss'; len: number } | null = null;
  for (const t of [...trades].sort((a, b) => a.exitTime - b.exitTime)) {
    const kind = t.profit > 0 ? 'win' : t.profit < 0 ? 'loss' : null;
    if (run && run.kind === kind) run.len++;
    else { run = kind ? { kind, len: 1 } : null; if (run) runs.push(run) }
  }
  const max = (k: 'win' | 'loss') => Math.max(0, ...runs.filter(x => x.kind === k).map(x => x.len));
  const lens = [...new Set(runs.map(x => x.len))].sort((a, b) => a - b);
  return {
    maxWin: max('win'), maxLoss: max('loss'), current: run ? { ...run } : { kind: null, len: 0 },
    dist: lens.map(len => ({ len, wins: runs.filter(x => x.kind === 'win' && x.len === len).length, losses: runs.filter(x => x.kind === 'loss' && x.len === len).length })),
  };
}
