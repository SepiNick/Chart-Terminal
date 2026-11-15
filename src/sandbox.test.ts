// Regression tests for the script-engine audit: user scripts must not reach Function/Object internals, and runaway inputs stop.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile as mql } from './mql/compiler/index.ts';
import { compile as ninja } from './ninja/compiler/index.ts';
import { parse } from './pine/parser.ts';
import { run } from './pine/interp.ts';
import { optimize } from './tester/optimize.ts';

const MQL_OPTS = { outParams: {}, builtinStructs: [], builtinClasses: [], nativeIncludes: [] };
const bars = Array.from({ length: 30 }, (_, i) => ({ time: 1_700_000_000 + i * 3600, open: 100 + i, high: 101 + i, low: 99 + i, close: 100 + i, volume: 10 }));
const pine = (src: string) => run(parse(src), bars, { symbol: 'X', tf: '1h', tfSec: 3600, mintick: 0.01, inputs: {} });

test('MQL: constructor / __proto__ chains do not compile', () => {
  for (const body of ['constructor.constructor("globalThis.PWNED=1")();', 'int a = 1; a.__proto__ = 0;', 'string s = ""; s.prototype = 1;']) {
    const r = mql('t.mq5', { 't.mq5': `int OnInit(){ ${body} return 0; }` }, MQL_OPTS);
    assert.equal(r.ok, false, body);
    assert.ok(r.errors.some(e => /not allowed/.test(e.msg)), body);
  }
  assert.equal(mql('t.mq5', { 't.mq5': 'int OnInit(){ return 0; }' }, MQL_OPTS).ok, true);
});

test('NinjaScript: the same names are rejected', () => {
  const r = ninja({ 'a.cs': 'class A { void F() { var x = constructor; } }' }, { globals: [] });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => /not allowed/.test(e.msg)));
});

test('NinjaScript: the names are also rejected inside interpolated strings', () => {
  const r = ninja({ 'a.cs': 'class A { void F() { var s = $"{constructor}"; var t = $"{1,constructor}"; } }' }, { globals: [] });
  assert.equal(r.ok, false);
  assert.ok(r.errors.filter(e => /not allowed/.test(e.msg)).length >= 2);
});

test('Pine: a huge array is an error, not a heap crash; builtin names are own properties only', () => {
  assert.throws(() => pine('//@version=6\nindicator("t")\na = array.new_float(2000000000, 0)\nplot(array.size(a))'), /at most 100000/);
  const v = pine('//@version=6\nindicator("t")\nplot(constructor)').plots[0]?.values ?? [];   // an unknown name is na, never Object's own `constructor`
  assert.ok(v.every(x => typeof x === 'number' && Number.isNaN(x)));
});

test('optimizer: an infinite score (one lucky trade, no loss) is not ranked', () => {
  const metrics = (pf: number) => ({ totalTrades: 5, profitFactor: pf });
  // evaluate returns a profit factor of Infinity for every set: nothing may be reported
  const evaluate = () => ({ metrics: metrics(Infinity), trades: [], equity: [], initialCapital: 1000 }) as never;
  const res = optimize(evaluate, bars, [{ name: 'p', min: 1, max: 3, step: 1, def: 1 } as never], {}, { objective: 'profitFactor', maximize: true, maxRuns: 10, range: { from: 0, to: 29 } } as never);
  assert.equal(res.length, 0);
});

test('NinjaScript / MQL: an endless loop stops with an error instead of freezing', async () => {
  const { compileNinja, runNinjaScript } = await import('./ninja/engine.ts');
  const { NEW_NT_INDICATOR } = await import('./ninja/templates.ts');
  const src = NEW_NT_INDICATOR.replace('protected override void OnBarUpdate()\n        {', 'protected override void OnBarUpdate()\n        {\n            while (true) { }');
  assert.notEqual(src, NEW_NT_INDICATOR);
  const cr = compileNinja({ 'MyBands.cs': src });
  assert.ok(cr.ok, cr.errors.map(e => e.msg).join('; '));
  const r = runNinjaScript(cr, 'MyBands', bars.map(b => ({ ...b, volume: 1 })), { symbol: 'ES', tfSec: 3600, tickSize: 0.25, pointValue: 50, initialCapital: 1e5, commissionPerContract: 0, inputs: {} });
  assert.match(r.result.error ?? '', /loop budget/);
  const m = mql('t.mq5', { 't.mq5': 'int OnInit(){ for(;;){} return 0; }' }, MQL_OPTS);
  assert.ok(m.ok && /__t\(\)/.test(m.js ?? ''));
});

test('NinjaScript / MQL: compiled code runs with the browser globals hidden', async () => {
  const { instantiate } = await import('./mql/compiler/index.ts');
  const probe = instantiate('return { t: [typeof fetch, typeof window, typeof globalThis, typeof localStorage] };', {} as never) as unknown as { t: string[] };
  assert.deepEqual(probe.t, ['undefined', 'undefined', 'undefined', 'undefined']);
});
