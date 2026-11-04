// Speed and memory budget for the heavy paths: the question behind the "it freezes after a few hours" complaints that
// NinjaTrader and ATAS users raise. Not part of `npm test` (timings vary by machine): run `npm run bench`.
// Each case has a generous budget; the memory case repeats the work many times and fails if the heap keeps growing.
//   node --experimental-strip-types --expose-gc scripts/bench.ts
import { INDICATORS } from '../src/indicators.ts';
import { runScript } from '../src/pine/engine.ts';
import { aggregate, type Bar } from '../src/data.ts';
import { fromBroker } from '../src/pine/report.ts';

const gc = (globalThis as { gc?: () => void }).gc;
const mk = (n: number): Bar[] => { let c = 100, t = 1_700_000_000; return Array.from({ length: n }, (_, i) => { const o = c; c = Math.max(1, c + Math.sin(i / 11) * 0.8 + Math.sin(i / 97) * 1.5 + ((i * 7919) % 13 - 6) * 0.1); t += 60; return { time: t, open: o, high: Math.max(o, c) + 0.3, low: Math.min(o, c) - 0.3, close: c, volume: 50 + (i % 17) } }) };
const OPTS = { symbol: 'BENCH', tf: '1m', tfSec: 60, mintick: 0.01 };
const STRAT = `//@version=5
strategy("bench", overlay=true, default_qty_type=strategy.percent_of_equity, default_qty_value=10)
f = ta.ema(close, 12)
s = ta.ema(close, 40)
r = ta.rsi(close, 14)
a = ta.atr(14)
if ta.crossover(f, s) and r < 70
    strategy.entry("L", strategy.long)
if ta.crossunder(f, s)
    strategy.close("L")
strategy.exit("x", "L", stop = close - 2 * a, limit = close + 3 * a)`;
const IND = `//@version=5
indicator("bench")
plot(ta.sma(close, 20))
plot(ta.ema(close, 50))
plot(ta.rsi(close, 14))
plot(ta.atr(14))
[mm, sg, hs] = ta.macd(close, 12, 26, 9)
plot(mm)
plot(sg)
[u, m, l] = ta.bb(close, 20, 2)
plot(u)
plot(l)
plot(ta.stoch(close, high, low, 14))`;

const cases: { name: string; budgetMs: number; run: () => unknown }[] = [];
const big = mk(50_000), mid = mk(20_000);
cases.push({ name: 'built-in indicators: every one, 20,000 bars', budgetMs: 4000, run: () => { for (const d of Object.values(INDICATORS)) d.calc(mid) } });
cases.push({ name: 'Pine indicator (9 plots), 50,000 bars', budgetMs: 4000, run: () => { const r = runScript(IND, big, OPTS); if (!r.out) throw Error(r.error?.msg) } });
cases.push({ name: 'Pine strategy with exits, 20,000 bars', budgetMs: 4000, run: () => { const r = runScript(STRAT, mid, OPTS); if (!r.out?.broker) throw Error(r.error?.msg ?? 'no broker') } });
cases.push({ name: 'strategy report from the trade list', budgetMs: 1500, run: () => { const r = runScript(STRAT, mid, OPTS); fromBroker(r.out!.broker!, mid) } });
cases.push({ name: 'timeframe aggregation 1m → 1h, 50,000 bars', budgetMs: 300, run: () => aggregate(big, 3600) });

let failed = 0;
const row = (ok: boolean, name: string, v: string, budget: string) => console.log(`${ok ? '✔' : '✘'} ${name.padEnd(48)} ${v.padStart(10)}  (budget ${budget})`);
for (const c of cases) {
  c.run();   // warm up
  const t0 = performance.now(); c.run(); const ms = performance.now() - t0, ok = ms <= c.budgetMs;
  if (!ok) failed++;
  row(ok, c.name, `${ms.toFixed(0)} ms`, `${c.budgetMs} ms`);
}

// Memory: the same work 150 times. A steady state keeps the heap flat; a leak makes it climb with every round.
if (gc) {
  const bars = mk(5000), heap = () => { gc(); return process.memoryUsage().heapUsed / 1048576 };
  for (let i = 0; i < 10; i++) { runScript(STRAT, bars, OPTS); for (const d of Object.values(INDICATORS)) d.calc(bars) }
  const before = heap();
  for (let i = 0; i < 150; i++) { runScript(STRAT, bars, OPTS); for (const d of Object.values(INDICATORS)) d.calc(bars) }
  const grew = heap() - before, ok = grew < 25;
  if (!ok) failed++;
  row(ok, 'heap growth over 150 repeated runs', `${grew.toFixed(1)} MB`, '25 MB');
} else console.log('– heap growth not measured: run with --expose-gc (npm run bench does)');
console.log(failed ? `\n${failed} case(s) over budget.` : '\nAll within budget.');
process.exit(failed ? 1 : 0);
