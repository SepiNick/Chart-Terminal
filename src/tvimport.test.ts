import { test } from 'node:test';
import assert from 'node:assert/strict';
import { csvRows, parseTvAccountHistory, parseTvAlertLog, parseTvWatchlist, tvSymbol } from './tvimport.ts';

test('TradingView symbols map to the app\'s symbols', () => {
  assert.equal(tvSymbol('BINANCE:BTCUSDT'), 'BTCUSDT');
  assert.equal(tvSymbol('BINANCE:BTCUSDT.P'), 'BINANCEUSDM:BTC_USDT.P');
  assert.equal(tvSymbol('BYBIT:ETHUSDT.P'), 'BYBIT:ETH_USDT.P');
  assert.equal(tvSymbol('okx:solusdc'), 'OKX:SOL_USDC');
  assert.equal(tvSymbol('NASDAQ:AAPL'), 'FX:AAPL');
  assert.equal(tvSymbol('OANDA:XAUUSD'), 'FX:XAUUSD');
  assert.equal(tvSymbol('ETHBTC'), 'ETHBTC');
});

test('watchlist export: sections kept, order kept, duplicates removed', () => {
  assert.deepEqual(parseTvWatchlist('###Crypto,BINANCE:BTCUSDT,BYBIT:ETHUSDT.P,###Stocks,NASDAQ:AAPL,BINANCE:BTCUSDT\n'), ['###Crypto', 'BTCUSDT', 'BYBIT:ETH_USDT.P', '###Stocks', 'FX:AAPL']);
});

test('CSV: quotes, escaped quotes, commas inside fields', () => {
  assert.deepEqual(csvRows('a,b\n"x, y","say ""hi"""\n'), [['a', 'b'], ['x, y', 'say "hi"']]);
});

test('alerts log export', () => {
  const rows = parseTvAlertLog('Alert ID,Ticker,Name,Description,Time\n123,BINANCE:BTCUSDT,BTC up,"Crossing 65,000",2026-10-01T12:30:00Z\n');
  assert.deepEqual(rows, [{ at: Date.parse('2026-10-01T12:30:00Z'), message: 'BINANCE:BTCUSDT — BTC up: Crossing 65,000' }]);
  assert.throws(() => parseTvAlertLog('foo,bar\n1,2'), /alerts log/);
});

test('Paper Trading account history: only closing rows become trades', () => {
  const csv = 'Time,Balance Before,Balance After,Realized P&L (value),Action\n' +
    '2026-10-02 10:00:00,100000,100000,0,"Open long position for symbol BINANCE:BTCUSDT at price 60000.00 for 0.5 units"\n' +
    '2026-10-03 11:00:00,100000,101000,1000,"Close long position for symbol BINANCE:BTCUSDT at price 62000.00 for 0.5 units. Position AVG Price was 60000.00, currency: USD"\n' +
    '2026-10-04 09:00:00,101000,100800,-200,"Close short position for symbol NASDAQ:AAPL at price 210.00 for 10 units. Position AVG Price was 190.00, currency: USD"\n';
  const t = parseTvAccountHistory(csv);
  assert.equal(t.length, 2);
  assert.deepEqual(t[0], { sym: 'BTCUSDT', dir: 'long', openTime: Date.parse('2026-10-03T11:00:00Z') / 1000, closeTime: Date.parse('2026-10-03T11:00:00Z') / 1000, qty: 0.5, entry: 60000, exit: 62000, profit: 1000, commission: 0, swap: 0 });
  assert.equal(t[1].sym, 'FX:AAPL'); assert.equal(t[1].dir, 'short'); assert.equal(t[1].profit, -200);
});
