// Runtime tests with hand-written classes shaped like the compiler's output (rt.__get/__set, this.X, rt.X).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRt, runNinja } from './index.ts';
import { atr, bb, ema, macd, rsi, sma, stoch } from '../../indicators.ts';
import type { Bar } from '../../data.ts';

let seed = 7;
const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
const BARS: Bar[] = Array.from({ length: 300 }, (_, i) => {
  const o = 100 + Math.sin(i / 12) * 8 + rnd() * 2, c = o + (rnd() - 0.5) * 3;
  return { time: 1_700_000_000 + i * 60, open: o, high: Math.max(o, c) + rnd(), low: Math.min(o, c) - rnd(), close: c, volume: 100 + rnd() * 50 };
});
const OPTS = { symbol: 'TEST', tfSec: 60, tickSize: 0.25, pointValue: 10, initialCapital: 10000, commissionPerContract: 1 };
const rt: any = createRt();
const G = rt.__get, S = rt.__set;
const run = (classes: Record<string, Function>, name: string, bars = BARS, extra: object = {}) => runNinja(classes, name, rt, { ...OPTS, bars, ...extra });
const close = (a: number, b: number | null, eps = 1e-9) => assert.ok(b != null && Math.abs(a - b) < eps, `${a} vs ${b}`);
const flat = (n: number, f: (i: number) => Partial<Bar> = () => ({})): Bar[] =>
  Array.from({ length: n }, (_, i) => ({ time: 1_700_000_000 + i * 60, open: 100, high: 101, low: 99, close: 100, volume: 1, ...f(i) }));

test('lifecycle: state order and one OnBarUpdate per bar', () => {
  const seen: string[] = [];
  class L extends rt.Indicator {
    OnStateChange() { seen.push(this.State) }
    OnBarUpdate() { if (this.CurrentBar === 0 || this.CurrentBar === 299) seen.push('bar' + this.CurrentBar) }
  }
  const r = run({ L }, 'L');
  assert.equal(r.error, undefined);
  assert.deepEqual(seen, ['SetDefaults', 'Configure', 'DataLoaded', 'Historical', 'bar0', 'bar299', 'Transition', 'Realtime', 'Terminated']);
});

test('series: bars-ago indexing, custom Series<T>, out-of-range error', () => {
  const got: number[] = [];
  class A extends rt.Indicator {
    OnStateChange() { if (this.State === rt.State.DataLoaded) this.s = new rt.Series(this) }
    OnBarUpdate() {
      S(this.s, 0, G(this.Close, 0) * 2);
      if (this.CurrentBar === 10) got.push(G(this.Close, 2), G(this.s, 1), G(this.High, 0), +this.s.IsValidDataPoint(3));
    }
  }
  assert.equal(run({ A }, 'A').error, undefined);
  assert.deepEqual(got, [BARS[8].close, BARS[9].close * 2, BARS[10].high, 1]);
  class B extends rt.Indicator { OnBarUpdate() { G(this.Close, 1) } }
  const r = run({ B }, 'B');
  assert.match(r.error!, /OnBarUpdate.*bar 0.*out-of-range/);
});

test('plots: AddPlot/Values/PlotBrushes/AddLine/BackBrush output', () => {
  class P extends rt.Indicator {
    OnStateChange() {
      if (this.State === rt.State.SetDefaults) {
        this.Name = 'P'; this.IsOverlay = true; this.BarsRequiredToPlot = 2;
        this.AddPlot(rt.Brushes.Red, 'A'); this.AddPlot(new rt.Stroke(rt.Brushes.Blue, 3), rt.PlotStyle.Bar, 'B'); this.AddLine(rt.Brushes.Gray, 50, 'Mid');
      }
    }
    get B() { return G(this.Values, 1) }
    OnBarUpdate() {
      S(this.Value, 0, this.CurrentBar);
      S(this.B, 0, -this.CurrentBar);
      if (this.CurrentBar === 5) { S(G(this.PlotBrushes, 0), 0, rt.Brushes.Lime); this.BackBrush = rt.Brushes.Yellow }
    }
  }
  const r = run({ P }, 'P');
  assert.equal(r.error, undefined);
  assert.equal(r.overlay, true);
  assert.deepEqual(r.plots.map(p => [p.name, p.color, p.style, p.width]), [['A', '#ff0000', 'line', 1], ['B', '#0000ff', 'bar', 3]]);
  assert.ok(Number.isNaN(r.plots[0].values[1]));
  assert.equal(r.plots[0].values[7], 7);
  assert.equal(r.plots[1].values[7], -7);
  assert.equal(r.plots[0].colors[5], '#00ff00');
  assert.equal(r.plots[0].colors[6], null);
  assert.equal(r.backColors[5], '#ffff00');
  assert.deepEqual(r.lines, [{ name: 'Mid', value: 50, color: '#808080' }]);
});

test('built-in indicators match src/indicators.ts', () => {
  const cl = BARS.map(b => b.close);
  const ref = {
    sma: sma(cl, 14), ema: ema(cl, 20), rsi: rsi(cl, 14), macd: macd(cl), bb: bb(cl, 20, 2), atr: atr(BARS, 14), st: stoch(BARS, 14, 3),
  };
  const rows: Record<string, number[]> = {};
  const at = [40, 120, 299];
  class T extends rt.Indicator {
    OnBarUpdate() {
      if (!at.includes(this.CurrentBar)) return;
      const r = (k: string, v: number) => (rows[k] ??= []).push(v);
      r('sma', G(this.SMA(14), 0)); r('ema', G(this.EMA(this.Close, 20), 0)); r('rsi', G(this.RSI(14, 3), 0));
      const m = this.MACD(12, 26, 9); r('macd', G(m, 0)); r('macdAvg', G(m.Avg, 0)); r('macdDiff', G(m.Diff, 0));
      const b = this.Bollinger(2, 20); r('bbU', G(b.Upper, 0)); r('bbM', G(b.Middle, 0)); r('bbL', G(b.Lower, 0));
      r('atr', G(this.ATR(14), 0));
      const s = this.StochasticsFast(3, 14); r('k', G(s.K, 0)); r('d', G(s.D, 0));
    }
  }
  assert.equal(run({ T }, 'T').error, undefined);
  at.forEach((i, j) => {
    close(rows.sma[j], ref.sma[i]); close(rows.ema[j], ref.ema[i]); close(rows.rsi[j], ref.rsi[i]);
    close(rows.macd[j], ref.macd.MACD[i]); close(rows.bbU[j], ref.bb.Upper[i]); close(rows.bbM[j], ref.bb.Basis[i]); close(rows.bbL[j], ref.bb.Lower[i]);
    close(rows.atr[j], ref.atr[i]); close(rows.k[j], ref.st['%K'][i]); close(rows.d[j], ref.st['%D'][i]);
  });
  // MACD Avg is seeded at bar 0 in NT vs at the first full MACD value in the reference: equal once converged
  close(rows.macdAvg[2], ref.macd.Signal[299], 1e-6);
  close(rows.macdDiff[2], ref.macd.Hist[299], 1e-6);
});

test('CrossAbove / CrossBelow with series and constants, MRO', () => {
  const c = [1, 2, 3, 6, 7, 2, 1];
  const bars = flat(c.length, i => ({ close: c[i] }));
  const ups: number[] = [], downs: number[] = [], mro: number[] = [];
  class X extends rt.Indicator {
    OnBarUpdate() {
      if (this.CrossAbove(this.Close, 5, 1)) ups.push(this.CurrentBar);
      if (this.CrossBelow(this.Close, this.SMA(3), 1)) downs.push(this.CurrentBar);
      if (this.CurrentBar === 6) mro.push(this.MRO(() => G(this.Close, 0) > 5, 1, 7), this.CrossAbove(this.Close, 5, 4) ? 1 : 0, this.CrossAbove(this.Close, 5, 3) ? 1 : 0);
    }
  }
  assert.equal(run({ X }, 'X', bars).error, undefined);
  assert.deepEqual(ups, [3]);
  assert.deepEqual(downs, [5]);
  assert.deepEqual(mro, [2, 1, 0]);
});

test('strategy: market entry at next open, stop loss in ticks inside bar, commission', () => {
  const bars = flat(6, i => (i === 4 ? { low: 97.5 } : {}));
  class St extends rt.Strategy {
    OnStateChange() { if (this.State === rt.State.SetDefaults) this.BarsRequiredToTrade = 0; if (this.State === rt.State.Configure) this.SetStopLoss(rt.CalculationMode.Ticks, 8) }
    OnBarUpdate() { if (this.CurrentBar === 2) this.EnterLong('L') }
  }
  const r = run({ St }, 'St', bars);
  assert.equal(r.error, undefined);
  assert.equal(r.trades!.length, 1);
  const t = r.trades![0];
  assert.deepEqual([t.entryId, t.entryBar, t.entryPrice, t.exitId, t.exitBar, t.exitPrice, t.dir], ['L', 3, 100, 'Stop loss', 4, 98, 'long']);
  close(t.profit, -2 * 10 - 2);
  close(r.equity![5], 10000 - 22);
  assert.equal(r.openCount, 0);
});

test('strategy: reversal closes then opens; profit target', () => {
  const bars = flat(8, i => (i === 6 ? { low: 95 } : {}));
  class Rv extends rt.Strategy {
    OnStateChange() { if (this.State === rt.State.SetDefaults) { this.BarsRequiredToTrade = 0; this.SetProfitTarget('S', rt.CalculationMode.Ticks, 12) } }
    OnBarUpdate() {
      if (this.CurrentBar === 1) this.EnterLong();
      if (this.CurrentBar === 3) this.EnterShort('S');
      if (this.CurrentBar === 4) this.Print(`${this.Position.MarketPosition} ${this.Position.Quantity} ${this.BarsSinceEntryExecution()}`);
    }
  }
  const r = run({ Rv }, 'Rv', bars);
  assert.equal(r.error, undefined);
  assert.deepEqual(r.trades!.map(t => [t.dir, t.entryBar, t.exitBar, t.exitId, t.exitPrice]), [['long', 2, 4, 'Close position', 100], ['short', 4, 6, 'Profit target', 97]]);
  assert.deepEqual(r.logs.map(l => l.msg), ['Short 1 0']);
  assert.deepEqual(r.executions!.map(x => x.side), ['buy', 'sell', 'sell', 'buy']);
});

test('strategy: SMA cross fills at next open, alternating reversals', () => {
  class Cross extends rt.Strategy {
    OnStateChange() { if (this.State === rt.State.DataLoaded) { this.f = this.SMA(5); this.s = this.SMA(15) } }
    OnBarUpdate() {
      if (this.CurrentBar < this.BarsRequiredToTrade) return;
      if (this.CrossAbove(this.f, this.s, 1)) this.EnterLong('Long');
      else if (this.CrossBelow(this.f, this.s, 1)) this.EnterShort('Short');
    }
  }
  const r = run({ Cross }, 'Cross');
  assert.equal(r.error, undefined);
  const t = r.trades!;
  assert.ok(t.length >= 4, `trades ${t.length}`);
  t.forEach((x, k) => {
    assert.equal(x.entryPrice, BARS[x.entryBar].open);
    if (k) { assert.equal(x.entryBar, t[k - 1].exitBar); assert.notEqual(x.dir, t[k - 1].dir) }
  });
  const f = sma(BARS.map(b => b.close), 5), s = sma(BARS.map(b => b.close), 15), e = t[0].entryBar - 1;
  assert.ok((f[e]! > s[e]!) !== (f[e - 1]! > s[e - 1]!), 'entry follows a cross on the previous bar');
  assert.equal(r.equity!.length, BARS.length);
});

test('strategy: non-live limit order expires at end of next bar; live-until-cancelled stays', () => {
  const bars = flat(6, i => (i === 3 ? { low: 90 } : {}));
  const mk = (live: boolean) => class extends rt.Strategy {
    OnStateChange() { if (this.State === rt.State.SetDefaults) this.BarsRequiredToTrade = 0 }
    OnBarUpdate() { if (this.CurrentBar === 1) live ? this.EnterLongLimit(0, true, 1, 95, 'L') : this.EnterLongLimit(95, 'L') }
  };
  assert.equal(run({ A: mk(false) }, 'A', bars).executions!.length, 0);
  const r = run({ A: mk(true) }, 'A', bars);
  assert.deepEqual(r.executions!.map(x => [x.time, x.price, x.side]), [[bars[3].time, 95, 'buy']]);
});

test('strategy: EntriesPerDirection with AllEntries and UniqueEntries', () => {
  const mk = (epd: number, handling: string, names: string[]) => class extends rt.Strategy {
    OnStateChange() { if (this.State === rt.State.SetDefaults) { this.BarsRequiredToTrade = 0; this.EntriesPerDirection = epd; this.EntryHandling = handling } }
    OnBarUpdate() { for (const n of names) this.EnterLong(n) }
  };
  const bars = flat(10);
  assert.equal(run({ A: mk(1, 'AllEntries', ['A', 'B']) }, 'A', bars).openCount, 1);
  assert.equal(run({ A: mk(2, 'AllEntries', ['A']) }, 'A', bars).openCount, 2);
  assert.equal(run({ A: mk(1, 'UniqueEntries', ['A', 'B']) }, 'A', bars).openCount, 2);
});

test('user indicator called by name from a strategy (cached, inputs in __inputs order)', () => {
  class MyInd extends rt.Indicator {
    static __inputs = [{ name: 'Period' }, { name: 'Mult' }];
    OnStateChange() { if (this.State === rt.State.SetDefaults) { this.Period = 3; this.Mult = 1; this.AddPlot(rt.Brushes.Red, 'V') } }
    OnBarUpdate() { S(this.Value, 0, G(this.SMA(this.Period), 0) * this.Mult) }
  }
  const got: number[] = [];
  let same = true;
  class UsesIt extends rt.Strategy {
    OnBarUpdate() { const a = this.MyInd(4, 2); same &&= a === this.MyInd(4, 2); if (this.CurrentBar === 50) got.push(G(a, 0), G(a, 3)) }
  }
  const r = run({ MyInd, UsesIt }, 'UsesIt');
  assert.equal(r.error, undefined);
  const ref = sma(BARS.map(b => b.close), 4);
  close(got[0], 2 * ref[50]!); close(got[1], 2 * ref[47]!);
  assert.ok(same);
});

test('Draw: tag replacement, barsAgo/DateTime anchors', () => {
  class D extends rt.Indicator {
    OnBarUpdate() {
      rt.Draw.Dot(this, 'last', false, 0, G(this.Close, 0), rt.Brushes.Red);
      if (this.CurrentBar === 20) rt.Draw.Line(this, 'ln', false, 10, 1, G(this.Time, 0), 2, rt.Brushes.Blue);
      if (this.CurrentBar === 30) rt.Draw.Text(this, 'tx', 'hi', 0, 5);
      if (this.CurrentBar === 31) this.RemoveDrawObject('tx');
    }
  }
  const r = run({ D }, 'D');
  assert.equal(r.error, undefined);
  assert.deepEqual(r.draws.map(d => d.tag).sort(), ['last', 'ln']);
  const dot = r.draws.find(d => d.tag === 'last')!, ln = r.draws.find(d => d.tag === 'ln')!;
  assert.deepEqual([dot.type, dot.t1, dot.p1, dot.color], ['dot', BARS[299].time, BARS[299].close, '#ff0000']);
  assert.deepEqual([ln.t1, ln.t2, ln.color], [BARS[10].time, BARS[20].time, '#0000ff']);
});

test('__fmt / __format / Math / collections / DateTime', () => {
  const f = rt.__fmt;
  assert.equal(f(1234.567, 'F2'), '1234.57');
  assert.equal(f(1234.567, 'N0'), '1,235');
  assert.equal(f(0.1234, 'P1'), '12.3 %');
  assert.equal(f(1234.567, 'C'), '$1,234.57');
  assert.equal(f(-1234.567, 'C'), '($1,234.57)');
  assert.equal(f(1234.567, 'E3'), '1.235E+003');
  assert.equal(f(42, 'D5'), '00042');
  assert.equal(f(255, 'X4'), '00FF');
  assert.equal(f(1234.567, '0.00'), '1234.57');
  assert.equal(f(1234567.891, '#,##0.0'), '1,234,567.9');
  assert.equal(f(0.5, '#.##'), '.5');
  assert.equal(f(-3, '0;(0)'), '(3)');
  assert.equal(f(0.256, '0%'), '26%');
  assert.equal(f(1.005, 'F2'), '1.01');
  assert.equal(f(0.1 + 0.2), '0.3');
  assert.equal(f(1e-7), '1E-07');
  assert.equal(f(true), 'True');
  const dt = new rt.DateTime(2024, 3, 5, 14, 7, 9);
  assert.equal(f(dt, 'yyyy-MM-dd HH:mm:ss'), '2024-03-05 14:07:09');
  assert.equal(dt.ToString('ddd MMM d h:mm tt'), 'Tue Mar 5 2:07 PM');
  assert.equal(f(dt), '3/5/2024 2:07:09 PM');
  assert.equal(dt.DayOfWeek, rt.DayOfWeek.Tuesday);
  assert.equal(dt.AddDays(30).Month, 4);
  close(dt.TimeOfDay.TotalMinutes, 14 * 60 + 7 + 9 / 60);
  assert.ok(dt.AddMinutes(1) > dt);
  assert.equal(rt.__format('{0:F2} | {1,5} | {{x}} {2:0.0}', [3.14159, 'ab', 2]), '3.14 |    ab | {x} 2.0');
  assert.equal(rt.Math.Round(2.5), 2);
  assert.equal(rt.Math.Round(2.5, rt.MidpointRounding.AwayFromZero), 3);
  assert.equal(rt.Math.Round(1.2345, 2), 1.23);
  assert.equal(rt.__cast('int', -3.9), -3);
  assert.equal(rt.__cast('int', rt.MarketPosition.Short), 2);
  const ref = { v: 0 };
  assert.equal(rt.__double.TryParse('1,234.5', ref), true); assert.equal(ref.v, 1234.5);
  assert.equal(rt.__int.TryParse('x', ref), false);
  const l = new rt.List(); l.Add(3); l.Add(1); l.Add(2); l.Sort();
  assert.deepEqual([...l], [1, 2, 3]); assert.equal(l.Count, 3); assert.equal(l.Sum(), 6); assert.equal(l.RemoveAll((x: number) => x > 1), 2);
  assert.throws(() => G(l, 5), /out of range|outside/);
  const d = new rt.Dictionary(); d.Add('a', 1); S(d, 'b', 2);
  assert.equal(G(d, 'b'), 2); assert.equal(d.TryGetValue('z', ref), false); assert.equal(d.Count, 2);
  assert.deepEqual([...d].map((kv: any) => kv.Key + kv.Value), ['a1', 'b2']);
  assert.throws(() => d.Add('a', 3));
  assert.equal(rt.String.Join(',', l), '1');
  assert.equal(rt.String.IsNullOrEmpty(''), true);
});

test('every built-in indicator runs with defaults and yields finite values', async () => {
  const { BUILTINS } = await import('./indicators/index.ts');
  const bad: string[] = [];
  for (const name of Object.keys(BUILTINS)) {
    class U extends rt.Indicator {
      OnBarUpdate() { const x = this[name](); if (this.CurrentBar === 299 && x.Values.some((v: any) => v.IsValidDataPoint(0) && !Number.isFinite(G(v, 0)))) bad.push(name) }
    }
    const r = run({ U }, 'U');
    if (r.error) bad.push(`${name}: ${r.error}`);
  }
  assert.deepEqual(bad, []);
});
