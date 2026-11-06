import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exchangeOptions, groupOf, EX_GROUPS } from './exchangegroups.ts';

test('exchanges land in the right group', () => {
  assert.equal(EX_GROUPS[groupOf('bybit')], 'Crypto perpetuals');
  assert.equal(EX_GROUPS[groupOf('kraken')], 'Crypto spot');
  assert.equal(EX_GROUPS[groupOf('oanda')], 'Your brokers & data keys');
  assert.equal(EX_GROUPS[groupOf('fx')], 'Forex, stocks, indices & commodities');
  assert.equal(EX_GROUPS[groupOf('cryptocap')], 'Crypto market data');
  assert.equal(EX_GROUPS[groupOf('nobitex')], 'Iran markets');
  assert.equal(EX_GROUPS[groupOf('bitstamp')], 'Other crypto exchanges');
});
test('options are grouped, deduplicated and escaped', () => {
  const html = exchangeOptions([{ id: 'bybit', name: 'bybit' }, { id: 'bybit', name: 'bybit' }, { id: 'bitstamp', name: 'Bit<stamp>' }, { id: 'fx', name: 'Forex' }]);
  assert.equal(html.match(/value="bybit"/g)?.length, 1);
  assert.match(html, /<optgroup label="Crypto perpetuals">/);
  assert.match(html, /Bit&#60;stamp&#62;/);
  assert.doesNotMatch(html, /Crypto spot/);   // empty groups are left out
});
