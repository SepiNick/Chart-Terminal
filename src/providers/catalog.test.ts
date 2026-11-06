import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CATALOG } from './catalog.ts';

const exchanges: string[] = JSON.parse(readFileSync(new URL('../../server/exchanges.json', import.meta.url), 'utf8'));

test('provider ids are unique', () => assert.equal(new Set(CATALOG.map(p => p.id)).size, CATALOG.length));
test('every CCXT provider is an exchange the server knows', () => {
  for (const p of CATALOG) if (p.ccxt) assert.ok(exchanges.includes(p.ccxt), p.id);
});
test('key tests only use {fields} the provider declares, over https', () => {
  for (const p of CATALOG) {
    if (!p.test) continue;
    assert.match(p.test.url, /^https:\/\//, p.id);
    const used = [p.test.url, ...Object.values(p.test.headers ?? {})].flatMap(s => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]));
    for (const u of used) assert.ok(p.keys?.some(k => k.name === u), `${p.id} uses {${u}}`);
  }
});
test('perpetual providers are free CCXT exchanges that stream live', () => {
  for (const p of CATALOG.filter(x => x.category === 'perp')) { assert.ok(p.ccxt && p.live && p.free, p.id) }
});
