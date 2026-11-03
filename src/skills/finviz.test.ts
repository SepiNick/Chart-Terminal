import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildUrl, fromText, slugs, validate } from './finviz.ts';

// URL shape and validation follow open_finviz_screener.py; keyword matching uses its reference table.
test('FinViz URL building, validation and keyword matching', () => {
  assert.equal(buildUrl(['cap_small', 'fa_div_o3', 'fa_pe_u20'], { view: 'valuation', order: '-marketcap' }), 'https://finviz.com/screener.ashx?v=121&f=cap_small,fa_div_o3,fa_pe_u20&o=-marketcap');
  assert.equal(buildUrl(['cap_mid'], { elite: true, themes: ['artificialintelligence', 'cybersecurity'] }), 'https://elite.finviz.com/screener.ashx?v=111&f=theme_artificialintelligence%7Ccybersecurity,cap_mid');
  assert.throws(() => validate(['cap_small&x=1']), /Invalid filter token/);
  assert.throws(() => validate(['theme_ai']), /themes field/);
  assert.deepEqual(validate(['zz_x', 'cap_small', 'cap_small']), { ok: ['zz_x', 'cap_small'], warn: ["unknown prefix 'zz_' in 'zz_x'"] });
  assert.throws(() => buildUrl([], { order: '-pe;drop' }), /Invalid order/);
  assert.deepEqual(slugs('theme_aicloud, aicompute', 'theme'), ['aicloud', 'aicompute']);
  const r = fromText('Mid cap technology stocks, oversold, near new low');
  assert.ok(r.codes.includes('cap_mid') && r.codes.includes('sec_technology'), JSON.stringify(r));
  assert.ok(r.signals.includes('ta_oversold') && r.signals.includes('ta_newlow'), JSON.stringify(r));
  assert.ok(fromText('سهام کوچک فناوری').codes.includes('cap_small'));
});
