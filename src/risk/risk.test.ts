import { test } from 'node:test';
import assert from 'node:assert/strict';
import { correlation, correlationMatrix, exposure, pearson, splitPair, stacks } from './risk.ts';

const series = (closes: number[], t0 = 0) => closes.map((close, i) => ({ time: t0 + i * 60, close }));

test('risk: Pearson and log-return correlation, aligned on common bar times', () => {
  assert.equal(pearson([1, 2, 3], [2, 4, 6]), 1);
  assert.equal(pearson([1, 2, 3], [3, 2, 1]), -1);
  assert.equal(pearson([1, 1, 1], [1, 2, 3]), null);
  const a = series([100, 110, 99, 120, 118, 130]);
  // same percentage moves at double the price → identical log returns
  assert.ok(Math.abs(correlation(a, series([200, 220, 198, 240, 236, 260])).r! - 1) < 1e-12);
  // the inverse price has negated log returns
  assert.ok(Math.abs(correlation(a, a.map(x => ({ time: x.time, close: 1 / x.close }))).r! + 1) < 1e-12);
  // a missing bar in one series: returns are taken over the common bars only
  const b = series([200, 220, 198, 240, 236, 260]).filter((_, i) => i !== 2);
  const c = correlation(a, b);
  assert.equal(c.n, 4);
  assert.ok(Math.abs(c.r! - 1) < 1e-12);
  const m = correlationMatrix({ A: a, B: b });
  assert.deepEqual(m.syms, ['A', 'B']);
  assert.equal(m.r[0][0], 1); assert.equal(m.r[0][1], m.r[1][0]);
});

test('risk: symbol → base and quote', () => {
  assert.deepEqual(splitPair('BTCUSDT'), { base: 'BTC', quote: 'USDT' });
  assert.deepEqual(splitPair('BINANCE:ETHBTC'), { base: 'ETH', quote: 'BTC' });
  assert.deepEqual(splitPair('BTCFDUSD'), { base: 'BTC', quote: 'FDUSD' });
  assert.deepEqual(splitPair('bybit:SOL/USDT:USDT'), { base: 'SOL', quote: 'USDT' });
  assert.deepEqual(splitPair('AAPL'), { base: 'AAPL', quote: '?' });
});

test('risk: exposure per asset and quote, largest position, open risk to stops', () => {
  const e = exposure([
    { sym: 'BTCUSDT', qty: 0.1, avg: 50000, px: 52000, stop: 49000 },   // 5200 long; 300 to the stop of an initial 100 → 3R
    { sym: 'ETHUSDT', qty: -2, avg: 3000, px: 2900, stop: 3100 },       // 5800 short, risk (2900-3100)·-2 = 400, initial 200 → 2R
    { sym: 'ETHBTC', qty: 1, avg: 0.05, px: 0.05, fx: 52000 },          // 2600 long ETH, short BTC, no stop
  ], 10000);
  assert.equal(e.rows[0].risk, 300); assert.equal(e.rows[0].r, 3);
  assert.equal(e.rows[1].risk, 400); assert.equal(e.rows[1].r, 2);
  assert.equal(e.risk, 700); assert.equal(e.riskR, 5); assert.deepEqual(e.noStop, ['ETHBTC']);
  assert.equal(e.gross, 5200 + 5800 + 2600); assert.equal(e.net, 5200 - 5800 + 2600); assert.equal(e.grossPct, 136);
  assert.equal(e.largest?.sym, 'ETHUSDT');
  const eth = e.byAsset.find(l => l.key === 'ETH')!;
  assert.equal(eth.net, -5800 + 2600); assert.equal(eth.gross, 8400);
  const usdt = e.byQuote.find(l => l.key === 'USDT')!, btcQ = e.byQuote.find(l => l.key === 'BTC')!;
  assert.equal(usdt.net, -(5200 - 5800)); assert.equal(btcQ.net, -2600);
  // a stop beyond the entry in profit risks nothing more
  assert.equal(exposure([{ sym: 'X', qty: 1, avg: 10, px: 15, stop: 16 }], 100).rows[0].risk, 0);
});

test('risk: correlated positions that stack in one direction', () => {
  const r: Record<string, number> = { 'A|B': 0.9, 'A|C': -0.85, 'B|C': -0.8, 'A|D': 0.2, 'B|D': 0.1, 'C|D': 0 };
  const corr = (x: string, y: string) => r[`${x}|${y}`] ?? r[`${y}|${x}`] ?? null;
  const row = (sym: string, qty: number, risk: number | null) => ({ sym, qty, notional: qty * 100, risk });
  // A long, B long (ρ .9), C short (ρ −.85 with A): one bet; D unrelated
  const s = stacks([row('A', 1, 10), row('B', 2, 20), row('C', -1, 5), row('D', 1, 1)], corr);
  assert.equal(s.length, 1);
  assert.deepEqual(s[0].syms, ['A', 'B', 'C']); assert.equal(s[0].risk, 35); assert.equal(s[0].minCorr, 0.8);
  // a hedge (A long, B short with ρ .9) does not stack
  assert.equal(stacks([row('A', 1, 10), row('B', -1, 10)], corr).length, 0);
  // an unknown stop makes the group's risk unknown
  assert.equal(stacks([row('A', 1, null), row('B', 1, 10)], corr)[0].risk, null);
});
