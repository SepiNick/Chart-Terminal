import { test } from 'node:test';
import assert from 'node:assert/strict';
import { remember, rememberedStandalone, retryDelay, statusFromResponse, bundledOrigin } from './standalone.ts';
import { STANDALONE_FEATURES, STANDALONE_WHY, gateFor, isStandalone, serverFetch, serverSocket, setStandalone } from './servers.ts';

const ok = JSON.stringify({ setup: false, loggedIn: true, mode: 'private' });
test('detection: only a real status JSON means a server', () => {
  assert.ok(statusFromResponse(true, ok));
  assert.equal(statusFromResponse(false, ok), null);                        // 404 / 5xx
  assert.equal(statusFromResponse(true, '<!doctype html><html>'), null);     // static hosting answers index.html
  assert.equal(statusFromResponse(true, '{"hello":1}'), null);
  assert.equal(statusFromResponse(true, ''), null);
});
test('retry delay grows and is capped', () => {
  assert.equal(retryDelay(0), 20_000);
  assert.ok(retryDelay(3) > retryDelay(2));
  assert.equal(retryDelay(50), 600_000);
  assert.equal(retryDelay(-1), 20_000);
});
test('session memory is per sync server', () => {
  const m = new Map<string, string>();
  const kv = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
  assert.equal(rememberedStandalone('local', kv), false);
  remember(true, 'local', kv);
  assert.equal(rememberedStandalone('local', kv), true);
  assert.equal(rememberedStandalone('srv1', kv), false);
  remember(false, 'local', kv);
  assert.equal(rememberedStandalone('local', kv), false);
  assert.equal(rememberedStandalone('local', undefined), false);
});
test('bundled origin', () => {
  assert.ok(bundledOrigin('https://appassets.androidplatform.net'));
  assert.ok(!bundledOrigin('http://localhost:5173'));
});
test('gating: standalone keeps scripts, turns everything else off with one reason', () => {
  assert.deepEqual(STANDALONE_FEATURES, { trading: false, ai: false, ml: false, forward: false, scripts: true, python: false });
  assert.deepEqual(gateFor('scripts', null, null, true), { on: true, why: '' });
  for (const f of ['trading', 'ai', 'ml', 'forward'] as const) assert.deepEqual(gateFor(f, { mode: 'private', features: undefined }, { mode: 'private', features: undefined }, true), { on: false, why: STANDALONE_WHY });
  assert.equal(gateFor('trading', null, { mode: 'private' }).on, true);     // normal mode unchanged
});
test('guard: no request or socket leaves the device in standalone mode', async () => {
  let called = 0; const real = globalThis.fetch; globalThis.fetch = (() => { called++; return Promise.reject(Error('x')) }) as typeof fetch;
  try {
    setStandalone(true); assert.ok(isStandalone());
    await assert.rejects(serverFetch('/api/state'), (e: Error & { code?: string }) => e.code === 'standalone' && e.message === STANDALONE_WHY);
    await assert.rejects(serverFetch('/api/x', {}, 'trade'));
    assert.throws(() => serverSocket('/ws'), /Standalone/);
    assert.equal(called, 0);
  } finally { setStandalone(false); globalThis.fetch = real }
  assert.ok(!isStandalone());
});
