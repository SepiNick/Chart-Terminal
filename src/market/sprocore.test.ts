import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Bar } from '../data.ts';
import { emptyFilters, familyOf, sourcesFor, matchesAll, matchesCheap, metricsOf, needsMetrics, parseSymbol, safeQuery, sortRows, titleOf, toRow, type Row } from './sprocore.ts';

test('exchange symbols are split into base, quote and type', () => {
  assert.deepEqual(parseSymbol('BTC_USDT'), { base: 'BTC', quote: 'USDT', type: 'spot' });
  assert.deepEqual(parseSymbol('BTC_USDT.P'), { base: 'BTC', quote: 'USDT', type: 'perpetual' });
  assert.deepEqual(parseSymbol('ETH_USD.PETH'), { base: 'ETH', quote: 'USD', type: 'perpetual' });
  assert.deepEqual(parseSymbol('BTC_USD.F250627'), { base: 'BTC', quote: 'USD', type: 'future' });
  assert.deepEqual(parseSymbol('BTCUSDT'), { base: 'BTC', quote: 'USDT', type: 'spot' });
  assert.equal(parseSymbol('???'), null);
});

const row = (sym: string, ex = 'bybit', over: Partial<Row> = {}): Row => ({ ...toRow(ex, { sym, last: 10, change: 2, quoteVolume: 5e6 }, false)!, ...over });

test('app symbols: Binance direct stays bare, others carry the exchange', () => {
  assert.equal(toRow('binance', { sym: 'BTCUSDT', last: 1, change: 0, quoteVolume: 1 }, true)!.sym, 'BTCUSDT');
  assert.equal(row('BTC_USDT.P').sym, 'BYBIT:BTC_USDT.P');
  assert.equal(toRow('x', { sym: 'BTC_USDT', last: 0, change: 0, quoteVolume: 1 }, false), null, 'no price, no row');
  assert.equal(row('BTC_EUR').qv !== null, false, 'volume in a non-dollar quote is not a dollar volume');
});

test('cheap filters: exchange, type, quote, base, ranges, watchlist', () => {
  const F = { ...emptyFilters(), exchanges: ['bybit'], types: ['perpetual' as const], quotes: ['USDT'] };
  assert.equal(matchesCheap(row('BTC_USDT.P'), F), true);
  assert.equal(matchesCheap(row('BTC_USDT'), F), false, 'spot');
  assert.equal(matchesCheap(row('BTC_USDT.P', 'okx'), F), false, 'other exchange');
  assert.equal(matchesCheap(row('BTC_USDT.P'), { ...F, bases: ['ETH'] }), false);
  assert.equal(matchesCheap(row('BTC_USDT.P'), { ...F, ranges: { chg: { min: 3 } } }), false);
  assert.equal(matchesCheap(row('BTC_USDT.P'), { ...F, ranges: { qv: { min: 1e6, max: 1e7 } } }), true);
  assert.equal(matchesCheap(row('BTC_USDT.P'), { ...F, watch: ['BYBIT:ETH_USDT.P'] }), false);
});

function bars(n: number, f: (i: number) => number): Bar[] {
  return Array.from({ length: n }, (_, i) => ({ time: 1_700_000_000 + i * 86400, open: f(i), high: f(i) + 1, low: f(i) - 1, close: f(i), volume: 100 }));
}
test('metrics from daily bars: performance, volume change, rating', () => {
  const m = metricsOf(bars(250, i => 100 + i), 200 * 349)!;   // 24h dollar volume = 2x the previous day's (100 coins at ~349)
  assert.ok(Math.abs(m.perf1w! - ((349 / 342) - 1) * 100) < 1e-9);
  assert.ok(m.perf1m! > m.perf1w!);
  assert.ok(m.volchg! > 90 && m.volchg! < 110);
  assert.equal(m.label, 'Strong buy', 'a steady uptrend');
  assert.equal(metricsOf(bars(5, () => 1), 1), null, 'too little history');
});
test('lazy filters need metrics; rows without them do not pass', () => {
  const F = { ...emptyFilters(), exchanges: [], ranges: { perf1m: { min: 5 } } };   // the test series gains about 9.4% a month
  assert.equal(needsMetrics(F), true); assert.equal(needsMetrics(emptyFilters()), false);
  const r = row('BTC_USDT'); assert.equal(matchesAll(r, F, null), false);
  r.m = metricsOf(bars(250, i => 100 + i), 1)!; assert.equal(matchesAll(r, F, null), true);
});
test('plain-words condition and sorting, title', () => {
  assert.ok(safeQuery('change > 1').q); assert.ok(safeQuery('banana banana').error);
  const rows = [row('A_USDT', 'bybit', { chg: 1 }), row('B_USDT', 'bybit', { chg: 5 }), row('C_USDT', 'bybit', { chg: -2 })];
  assert.deepEqual(sortRows(rows, 'chg', true).map(r => r.base), ['B', 'A', 'C']);
  assert.deepEqual(sortRows(rows, 'sym', false).map(r => r.base), ['A', 'B', 'C']);
  assert.equal(sortRows([row('A_USDT'), row('B_USDT')], 'rsi', true).length, 2, 'missing values sink, nothing is dropped');
  assert.equal(titleOf({ ...emptyFilters(), types: ['perpetual'] }), '*/usdt.p');
});

test('"Binance" covers its spot and futures sources', () => {
  assert.deepEqual(sourcesFor(['binance'], []), ['binance', 'binanceusdm', 'binancecoinm']);
  assert.deepEqual(sourcesFor(['binance'], ['perpetual']), ['binanceusdm', 'binancecoinm']);
  assert.deepEqual(sourcesFor(['binance'], ['spot']), ['binance']);
  assert.deepEqual(sourcesFor(['bybit', 'binance'], ['future']), ['bybit', 'binanceusdm', 'binancecoinm']);
  assert.equal(familyOf('binanceusdm'), 'binance'); assert.equal(familyOf('bybit'), 'bybit');
  const r = toRow('binanceusdm', { sym: 'BTC_USDT.P', last: 1, change: 0, quoteVolume: 1 }, false)!;
  assert.equal(matchesCheap(r, { ...emptyFilters(), exchanges: ['binance'], quotes: [] }), true, 'a USD-M row passes the Binance filter');
});
