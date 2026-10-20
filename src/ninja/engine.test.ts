import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileNinja, runNinjaScript } from './engine.ts';
import { NEW_NT_INDICATOR, NEW_NT_STRATEGY } from './templates.ts';
import { sma } from '../indicators.ts';

let seed = 5;
const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
const bars = Array.from({ length: 500 }, (_, i) => {
  const o = 4000 + Math.sin(i / 25) * 60 + rnd() * 8, c = o + (rnd() - 0.5) * 12;
  return { time: 1_700_000_000 + i * 900, open: o, high: Math.max(o, c) + rnd() * 3, low: Math.min(o, c) - rnd() * 3, close: c, volume: 100 + rnd() * 50 };
});
const opts = { symbol: 'ES', tfSec: 900, tickSize: 0.25, pointValue: 50, initialCapital: 100000, commissionPerContract: 2 };
const ok = (files: Record<string, string>) => {
  const r = compileNinja(files);
  assert.ok(r.ok, r.errors.map(e => `${e.file}(${e.line},${e.col}) ${e.msg}`).join('; '));
  return r;
};

test('template indicator: plots match SMA ± k·stdev and inputs are exposed', () => {
  const cr = ok({ 'MyBands.cs': NEW_NT_INDICATOR });
  const r = runNinjaScript(cr, 'MyBands', bars, { ...opts, inputs: { Period: 20, Width: 2 } });
  assert.equal(r.result.error, undefined, r.result.error);
  assert.equal(r.out.plots.length, 3);
  assert.equal(r.out.meta.overlay, true);
  const ref = sma(bars.map(b => b.close), 20);
  assert.ok(Math.abs(r.out.plots[0].values[300] - ref[300]!) < 1e-9, `${r.out.plots[0].values[300]} vs ${ref[300]}`);
  assert.deepEqual(r.out.inputs.map(i => i.id), ['Period', 'Width', '__tradingHours']);
});

test('template strategy: crossovers trade with stop/target and report', () => {
  const cr = ok({ 'MyMaCross.cs': NEW_NT_STRATEGY });
  const r = runNinjaScript(cr, 'MyMaCross', bars, { ...opts, inputs: { Fast: 10, Slow: 25, StopTicks: 40, TargetTicks: 80 } });
  assert.equal(r.result.error, undefined, r.result.error);
  assert.ok(r.tester && r.tester.trades.length > 3, `trades: ${r.tester?.trades.length}`);
  assert.equal(r.tester!.equity.length, bars.length);
});

test('strategy calls a user indicator from another file', () => {
  const strat = `
using NinjaTrader.NinjaScript.Indicators;
namespace NinjaTrader.NinjaScript.Strategies {
  public class UsesBands : Strategy {
    protected override void OnStateChange() { if (State == State.SetDefaults) { Name = "UsesBands"; } }
    protected override void OnBarUpdate() {
      if (CurrentBar < 30) return;
      if (Close[0] < MyBands(20, 2.0).Lower[0]) EnterLong();
      else if (Close[0] > MyBands(20, 2.0).Upper[0]) ExitLong();
    }
  }
}`;
  const cr = ok({ 'MyBands.cs': NEW_NT_INDICATOR, 'UsesBands.cs': strat });
  const r = runNinjaScript(cr, 'UsesBands', bars, opts);
  assert.equal(r.result.error, undefined, r.result.error);
  assert.equal(r.result.kind, 'strategy');
});

test('compile errors carry file and line', () => {
  const r = compileNinja({ 'Bad.cs': 'public class Bad : Indicator {\n  protected override void OnBarUpdate() {\n    double x = ;\n  }\n}' });
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].file, 'Bad.cs');
  assert.equal(r.errors[0].line, 3);
});
