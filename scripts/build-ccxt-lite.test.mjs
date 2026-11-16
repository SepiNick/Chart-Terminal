// Offline check of dist-ccxt/{lite,full}.js: evaluates them in a bare vm context and checks the globalThis.ccxtLite contract.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DEFAULT_EXCHANGES } from '../src/providers/ccxtapp.ts';
import { CATALOG } from '../src/providers/catalog.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const files = ['lite', 'full'].map(n => root + `dist-ccxt/${n}.js`);

function load() {
  if (!files.every(existsSync)) assert.equal(spawnSync(process.execPath, [root + 'scripts/build-ccxt-lite.mjs'], { stdio: 'inherit' }).status, 0);
  const win = { fetch: () => { throw new Error('offline'); }, location: { href: 'https://appassets.androidplatform.net/' }, navigator: { userAgent: 'test' } };
  const ctx = vm.createContext({ ...win, window: win, self: win, console, setTimeout, clearTimeout, TextEncoder, TextDecoder, URL, URLSearchParams, AbortController });
  vm.runInContext(readFileSync(files[0], 'utf8'), ctx);
  const lite = ctx.ccxtLite;
  vm.runInContext(readFileSync(files[1], 'utf8'), ctx);   // the app loads full.js after lite.js: it replaces globalThis.ccxtLite
  return { lite, full: ctx.ccxtLite };
}

test('lite.js exposes ccxtLite.ids and exchange classes', () => {
  const c = load().lite;
  assert.ok(c.binance, 'binance');
  assert.ok(Array.isArray(c.ids) && c.ids.includes('binance') && c.ids.length >= 20);
  for (const id of c.ids) {
    const ex = new c[id]({ enableRateLimit: false });
    assert.equal(typeof ex.describe, 'function', id);
    assert.ok(ex.timeframes && Object.keys(ex.timeframes).length, id + ' timeframes');
  }
});

test('lite holds every default exchange and every ccxt-routed catalog provider', () => {
  const { lite } = load(), have = new Set(lite.ids);
  assert.deepEqual(DEFAULT_EXCHANGES.filter(id => !have.has(id)), [], 'DEFAULT_EXCHANGES missing from lite');
  const routed = CATALOG.flatMap(p => (p.ccxt ? [p.ccxt] : []));
  assert.deepEqual(routed.filter(id => !have.has(id)), [], 'catalog ccxt ids missing from lite');
});

test('full.js replaces ccxtLite with a superset of lite', () => {
  const { lite, full } = load();
  assert.notEqual(full, lite);
  assert.ok(lite.ids.every(id => full.ids.includes(id)) && full.ids.length > lite.ids.length);
  assert.ok(full.ids.every(id => typeof full[id] === 'function'));
});
