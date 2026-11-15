import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.CT_ENGINE_WORKERS = '2';
const E = await import('./engine.ts');
const { NEW_MQL5_EA } = await import('../src/mql/templates.ts');

const bars = Array.from({ length: 60 }, (_, i) => { const c = 100 + Math.sin(i / 3) * 5; return { time: 1_700_000_000 + i * 60, open: c - 0.5, high: c + 1, low: c - 1, close: c, volume: 10 } });
const pine = { lang: 'pine' as const, files: { 't.pine': 'strategy("t")\nif bar_index % 6 == 0\n    strategy.entry("L", strategy.long)\nif bar_index % 6 == 3\n    strategy.close("L")' }, main: 't.pine', prec: 2 };
// A hang the loop budget cannot see (exponential recursion, no loop): only the 3 s watchdog stops it. (An endless loop ends on the script's own budget.)
const hung = { lang: 'mql5' as const, files: { 'H.mq5': NEW_MQL5_EA.replace(/void\s+OnTick\s*\(\s*\)\s*\{/, 'int F(int n) { if(n <= 0) return 1; return F(n - 1) + F(n - 1); } void OnTick() { F(60);') }, main: 'H.mq5', prec: 2 };
const keyOn = (slot: number) => { for (let i = 0; ; i++) if (E.slotOf(`k${i}`) === slot) return `k${i}` };
const req = (key: string, source: typeof pine | typeof hung) => ({ key, source, sym: 'BTCUSDT', tf: '1m', inputs: {} });

test('pool size: env override, else min(4, cores-1), at least 1; a key always maps to the same worker', () => {
  assert.equal(E.poolSize(), 2);
  process.env.CT_ENGINE_WORKERS = '0'; assert.ok(E.poolSize() >= 1 && E.poolSize() <= 4);
  process.env.CT_ENGINE_WORKERS = '2';
  assert.equal(E.slotOf('abc'), E.slotOf('abc'));
  assert.notEqual(keyOn(0), keyOn(1));
});

test('two keys run in parallel; a hung script only kills its own worker', async t => {
  t.after(() => E.engineStop());
  E.engineOpts.timeoutMs = 3000;
  const a = keyOn(0), b = keyOn(1);
  assert.match(hung.files['H.mq5'], /F\(60\)/);
  const fills = await E.engineFills(req(b, pine), bars);
  assert.ok(fills.length >= 4);
  const tidB = E.engineThreads()[1];
  assert.notEqual(tidB, null);

  let hungDone = false;
  const h = E.engineFills(req(a, hung), bars).finally(() => { hungDone = true });
  h.catch(() => {});
  assert.deepEqual(await E.engineFills(req(b, pine), bars), fills);
  assert.equal(hungDone, false, 'the other worker answered while the hung script was still running');
  await assert.rejects(h, /longer than 3 s/);
  assert.equal(E.engineThreads()[0], null, 'the hung worker was restarted');
  assert.equal(E.engineThreads()[1], tidB, 'the healthy worker kept running');
  assert.deepEqual(await E.engineFills(req(b, pine), bars), fills, 'its compiled job is still there');
  assert.deepEqual(await E.engineFills(req(a, pine), bars), fills, 'the restarted slot works again with fresh sources');
});
