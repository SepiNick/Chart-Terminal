import test from 'node:test';
import assert from 'node:assert/strict';
import { isRemote, splitSym } from './data.ts';
import { norm, parseQuery, rank, toSymbol, allSources, binanceEntries, type SearchEntry } from './symsearch.ts';

const e = (ex: string, sym: string, base: string, quote: string, type: string, name?: string): SearchEntry => ({ ex, sym, base, quote, type, name });
const DATA = [
  e('binance', 'BTCUSDT', 'BTC', 'USDT', 'spot'),
  e('bybit', 'BTC_USDT', 'BTC', 'USDT', 'spot'),
  e('bybit', 'BTC_USDT.P', 'BTC', 'USDT', 'swap'),
  e('binanceusdm', 'BTC_USDT.P', 'BTC', 'USDT', 'swap'),
  e('binancecoinm', 'BTC_USD.PBTC', 'BTC', 'USD', 'swap'),
  e('okx', 'BTC_USDT.F250328', 'BTC', 'USDT', 'future'),
  e('obscure', 'BTC_USDT', 'BTC', 'USDT', 'spot'),
  e('bybit', 'BTC_USDT', 'BTC', 'USDT', 'spot'),  // duplicate
  e('bybit', 'BTCUSDT_FOO', 'BTCUSDT', 'FOO', 'spot'),
  e('cryptocap', 'BTC.D', 'BTC', '', 'index', 'Bitcoin dominance'),
  e('tse', 'فولاد', 'فولاد', 'IRR', 'stock', 'فولاد مباركه'),
];

test('norm folds separators and Arabic letters', () => {
  assert.equal(norm('btc/usdt'), 'BTCUSDT');
  assert.equal(norm('BTC_USDT.P'), 'BTCUSDTP');
  assert.equal(norm('مباركه'), norm('مبارکه'));
});

test('parseQuery reads a perpetual hint', () => {
  assert.deepEqual(parseQuery('btcusdt.p'), { key: 'BTCUSDT', kind: 'perp' });
  assert.deepEqual(parseQuery('btcusdt perp'), { key: 'BTCUSDT', kind: 'perp' });
  assert.deepEqual(parseQuery('perp'), { key: 'PERP' });
  assert.deepEqual(parseQuery('btc.d'), { key: 'BTCD' });
  assert.deepEqual(parseQuery('uniswap'), { key: 'UNISWAP' });
  assert.deepEqual(parseQuery('pancakeswap'), { key: 'PANCAKESWAP' });
  assert.deepEqual(parseQuery('uni swap'), { key: 'UNI', kind: 'perp' });
  assert.deepEqual(parseQuery('btcusdtperp'), { key: 'BTCUSDT', kind: 'perp' });
});

test('every ranked row opens a chart symbol the chart resolver parses back', () => {
  for (const x of rank(DATA, 'btc')) {
    const s = toSymbol(x);
    if (x.ex === 'binance') { assert.equal(isRemote(s), false); continue }
    assert.equal(isRemote(s), true, s);
    assert.deepEqual(splitSym(s), { exchange: x.ex, symbol: x.sym });
  }
});

test('btcusdt finds spot, perps and futures; exact before prefix; spot first; popular first; dedupe', () => {
  const r = rank(DATA, 'btcusdt');
  const ids = r.map(x => `${x.ex}:${x.sym}`);
  assert.deepEqual(ids.slice(0, 3), ['binance:BTCUSDT', 'bybit:BTC_USDT', 'obscure:BTC_USDT']);
  assert.ok(ids.includes('binanceusdm:BTC_USDT.P') && ids.includes('okx:BTC_USDT.F250328'));
  assert.equal(ids.filter(x => x === 'bybit:BTC_USDT').length, 1);
  assert.ok(ids.indexOf('binanceusdm:BTC_USDT.P') < ids.indexOf('bybit:BTC_USDT.P'));
  assert.ok(ids.indexOf('bybit:BTC_USDT.P') < ids.indexOf('bybit:BTCUSDT_FOO'));   // exact tier before prefix tier
});

test('btcusdt.p keeps only perpetuals', () => {
  const r = rank(DATA, 'btcusdt.p');
  assert.deepEqual(r.map(x => x.ex), ['binanceusdm', 'bybit']);
});

test('btc.d finds dominance first among its key', () => {
  assert.equal(rank(DATA, 'btc.d')[0].sym, 'BTC.D');
  assert.ok(rank(DATA, 'btc').some(x => x.sym === 'BTC.D'));
});

test('persian names match, empty query gives nothing, per-exchange cap and limit', () => {
  assert.equal(rank(DATA, 'مبارکه')[0].ex, 'tse');
  assert.deepEqual(rank(DATA, '  '), []);
  assert.equal(rank(DATA, 'btc', { perEx: 1 }).filter(x => x.ex === 'bybit').length, 1);
  assert.equal(rank(DATA, 'btc', { limit: 2 }).length, 2);
});

test('scoped use: filtering the input list to one exchange only returns it', () => {
  assert.ok(rank(DATA.filter(x => x.ex === 'bybit'), 'btc').every(x => x.ex === 'bybit'));
});

test('toSymbol, binanceEntries and allSources', () => {
  assert.equal(toSymbol(DATA[0]), 'BTCUSDT');
  assert.equal(toSymbol(DATA[2]), 'BYBIT:BTC_USDT.P');
  assert.deepEqual(binanceEntries(['ETHBTC'])[0], { ex: 'binance', sym: 'ETHBTC', base: 'ETH', quote: 'BTC', type: 'spot' });
  const ccxt = new Set(['binance', 'binanceusdm', 'bybit', 'obscure']);
  assert.deepEqual(allSources(['binance', 'obscure', 'bybit', 'fx', 'tse', 'binanceusdm'], x => ccxt.has(x), 2), ['binanceusdm', 'bybit', 'fx', 'tse']);
});
