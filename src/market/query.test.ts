import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describe as desc, matches, parseQuery } from './query.ts';

test('Persian and English sentences parse to the same filters', () => {
  const cases: [string, string][] = [
    ['RSI زیر ۳۰ و حجم بالای ۱ میلیون', 'RSI 14 (daily) < 30  AND  Volume > 1000000'],
    ['rsi < 30 and volume > 1m', 'RSI 14 (daily) < 30  AND  Volume > 1000000'],
    ['تغییر بیشتر از ۵٪ یا قیمت کمتر از 0.5', 'Change 24h % > 5  OR  Price < 0.5'],
    ['قیمت بالای میانگین ۵۰', 'Price above SMA 50 (daily)'],
    ['price above ema20', 'Price above EMA 20 (daily)'],
    ['قیمت بالای میانگین‌متحرک نمایی 200 و امتیاز خرید قوی', 'Price above EMA 200 (daily)  AND  Technical rating > 0.5'],
    ['change between -2 and 2', 'Change 24h % between -2 and 2'],
    ['تغییر بین ۲ و ۸ درصد', 'Change 24h % between 2 and 8'],
    ['امتیاز فروش', 'Technical rating < -0.1'],
    ['ارزهایی که RSI آنها زیر ۳۰ است', ''],
  ];
  for (const [s, want] of cases) {
    if (!want) { assert.throws(() => parseQuery(s), /Not understood: "آنها"/, 'unknown words are reported'); continue }
    assert.equal(desc(parseQuery(s)), want, s);
  }
});

test('errors name the problem; mixing and/or is refused', () => {
  assert.throws(() => parseQuery('RSI زیر'), /number is missing/);
  assert.throws(() => parseQuery('حجم ۱ میلیون'), /operator/);
  assert.throws(() => parseQuery('rsi < 30 and change > 1 or price < 2'), /Mixing/);
  assert.throws(() => parseQuery(''), /Write a condition/);
});

test('matching: missing data never passes', () => {
  const q = parseQuery('rsi < 30 and price above sma 50');
  assert.equal(matches(q, { price: 10, change: 0, volume: 1, rsi: 25, sma: { 50: 9 } }), true);
  assert.equal(matches(q, { price: 10, change: 0, volume: 1, rsi: 25, sma: { 50: 11 } }), false);
  assert.equal(matches(q, { price: 10, change: 0, volume: 1, rsi: null, sma: { 50: 9 } }), false);
});
