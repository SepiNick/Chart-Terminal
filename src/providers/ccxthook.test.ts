import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changeExchange, loadCcxt } from './ccxthook.ts';

type G = { document?: unknown; ccxtLite?: unknown };
const g = globalThis as G;

/** Fake browser script loading: each src runs its handler (what the bundle would do) then fires onload. */
function fakeScripts(handlers: Record<string, () => void>) {
  const loaded: string[] = [];
  g.document = {
    head: { append: (s: { src: string; onload(): void; onerror(): void }) => { loaded.push(s.src); queueMicrotask(() => { handlers[s.src]?.(); s.onload() }) } },
    createElement: () => ({}),
  };
  return loaded;
}

test('loadCcxt: lite first, then full.js replaces ccxtLite with a superset; lookups ignore inherited keys', async () => {
  class A {} class B {}
  const loaded = fakeScripts({
    'ccxt/lite.js': () => { g.ccxtLite = { a: A, ids: ['a'] } },
    'ccxt/full.js': () => { g.ccxtLite = { a: A, b: B, ids: ['a', 'b'] } },
  });
  try {
    assert.equal(await loadCcxt('a'), A); assert.deepEqual(loaded, ['ccxt/lite.js']);
    assert.equal(await loadCcxt('b'), B); assert.deepEqual(loaded, ['ccxt/lite.js', 'ccxt/full.js']);
    await assert.rejects(loadCcxt('toString'), /not available/);
    await assert.rejects(loadCcxt('constructor'), /not available/);
    await assert.rejects(loadCcxt('ids'), /not available/);
    await assert.rejects(loadCcxt('nosuch'), /not available/);
  } finally { delete g.document; delete g.ccxtLite }
});

test('changeExchange: an id the bundle lacks is rejected before anything is stored', async () => {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v) } };
  fakeScripts({ 'ccxt/lite.js': () => { g.ccxtLite = { ids: [] } }, 'ccxt/full.js': () => { g.ccxtLite = { ids: [] } } });
  try {
    await assert.rejects(changeExchange('nosuchex'), /not available in this app/);
    assert.equal(store.size, 0);
    await assert.rejects(changeExchange('Bad Id!'), /lower case/);
    assert.equal(store.size, 0);
  } finally { delete g.document; delete g.ccxtLite; delete (globalThis as { localStorage?: unknown }).localStorage }
});
