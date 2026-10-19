import { test } from 'node:test';
import assert from 'node:assert/strict';
import { symOf, nativeBase } from './ccxt.ts';
import { fxMarkets, yahooTicker, yahooBase } from './yahoo.ts';

test('CCXT markets map to operator-free symbols', () => {
  assert.equal(symOf({ base: 'BTC', quote: 'USDT', type: 'spot' }), 'BTC_USDT');
  assert.equal(symOf({ base: 'BTC', quote: 'USDT', type: 'swap', settle: 'USDT' }), 'BTC_USDT.P');
  assert.equal(symOf({ base: 'BTC', quote: 'USD', type: 'swap', settle: 'BTC' }), 'BTC_USD.PBTC');
  assert.equal(symOf({ base: '1000PEPE', quote: 'USDT', type: 'spot' }), '1000PEPE_USDT');
  assert.equal(symOf({ base: 'BTC', quote: 'USDT', type: 'option' }), null);
});

test('native timeframe selection', () => {
  assert.deepEqual(nativeBase(['1m', '5m', '1h', '1d'], '1h'), { base: '1h', n: 1 });
  assert.deepEqual(nativeBase(['1m', '5m', '1h', '1d'], '4h'), { base: '1h', n: 4 });
  assert.deepEqual(nativeBase(['1m', '5m', '1h', '1d'], '45m'), { base: '5m', n: 9 });
  assert.equal(nativeBase(['1h'], '30m'), null);
});

test('FX catalogue and Yahoo mapping', () => {
  const all = fxMarkets();
  assert.ok(all.length > 80);
  assert.equal(new Set(all.map(m => m.sym)).size, all.length);
  assert.equal(yahooTicker('EURUSD'), 'EURUSD=X');
  assert.equal(yahooTicker('XAUUSD'), 'GC=F');
  assert.equal(yahooTicker('AAPL'), 'AAPL');
  assert.equal(yahooTicker('BAD/SYM'), null);
  assert.equal(yahooBase('4h')?.base, '1h');
  assert.equal(yahooBase('1M')?.interval, '1mo');
});
