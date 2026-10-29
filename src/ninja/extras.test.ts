import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileNinja, runNinjaScript } from './engine.ts';
import { sma } from '../indicators.ts';

let seed = 3;
const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
// 15-minute bars from Monday 2023-11-13 00:00 UTC, three days
const bars = Array.from({ length: 288 }, (_, i) => {
  const o = 4000 + Math.sin(i / 20) * 30 + rnd() * 4, c = o + (rnd() - 0.5) * 6;
  return { time: 1_699_833_600 + i * 900, open: o, high: Math.max(o, c) + rnd() * 2, low: Math.min(o, c) - rnd() * 2, close: c, volume: 100 + rnd() * 50 };
});
const opts = { symbol: 'ES', tfSec: 900, tickSize: 0.25, pointValue: 50, initialCapital: 100000, commissionPerContract: 0 };
const NS = (body: string) => `using System; using System.Linq; using System.Collections.Generic; using NinjaTrader.NinjaScript;
namespace NinjaTrader.NinjaScript.Indicators { ${body} }`;
const runCs = (src: string, cls: string, extra: object = {}) => {
  const cr = compileNinja({ 'T.cs': NS(src) });
  assert.ok(cr.ok, cr.errors.map(e => `(${e.line},${e.col}) ${e.msg}`).join('; '));
  const r = runNinjaScript(cr, cls, bars, { ...opts, ...extra });
  assert.equal(r.result.error, undefined, r.result.error);
  return r;
};
const logs = (r: ReturnType<typeof runCs>) => r.result.logs.map(l => l.msg);

test('LINQ on List, arrays and Series', () => {
  const r = runCs(`public class Lq : Indicator {
    protected override void OnBarUpdate() {
      if (CurrentBar != 10) return;
      var list = new List<double> { 3, 1, 4, 1, 5, 9, 2, 6 };
      double[] arr = new double[] { 2, 7, 1, 8 };
      Print(list.Where(x => x > 2).Count() + " " + list.Count(x => x == 1) + " " + list.Sum() + " " + list.Max() + " " + list.Min(x => -x));
      Print(arr.OrderByDescending(x => x).First() + " " + arr.Average() + " " + arr.Any(x => x > 7) + " " + arr.All(x => x > 0));
      var top = list.OrderBy(x => x).Skip(2).Take(3).ToList();
      Print(top.Count + " " + top[0] + " " + list.Select(x => x * 2).ToArray().Length + " " + list.FirstOrDefault(x => x > 4) + " " + list.Last() + " " + list.Distinct().Count());
      Print(Close.Take(3).Count() + " " + (Close.Take(1).First() == Close[0]) + " " + Enumerable.Range(1, 4).Sum());
    }
  }`, 'Lq');
  assert.deepEqual(logs(r), ['5 2 31 9 -9', '8 4.5 True True', '3 2 8 5 6 7', '3 True 10']);
});

test('events, delegate types, Action/Func and method groups (+= / -= / ?.Invoke)', () => {
  const r = runCs(`public delegate double Op(double a, double b);
  public class Pub {
    public event Action<int> Changed;
    public event EventHandler Ping;
    public void Fire(int v) { if (Changed != null) Changed(v); Changed?.Invoke(v * 10); Ping?.Invoke(this, EventArgs.Empty); }
  }
  public class Ev : Indicator {
    int total = 0, pings = 0;
    void OnChanged(int v) { total += v; }
    double Mul(double a, double b) { return a * b; }
    protected override void OnBarUpdate() {
      if (CurrentBar != 0) return;
      var p = new Pub();
      p.Fire(5);
      p.Changed += OnChanged;
      p.Changed += v => total += 1000;
      p.Ping += (s, e) => pings++;
      p.Fire(1);
      p.Changed -= OnChanged;
      p.Fire(2);
      Op add = (a, b) => a + b; Op mul = Mul;
      Func<int, int> sq = x => x * x;
      Action<string> log = s => Print("log " + s);
      log("x");
      Print(total + " " + pings + " " + add(2, 3) + " " + mul(2, 3) + " " + sq(4));
    }
  }`, 'Ev');
  assert.deepEqual(logs(r), ['log x', '4011 2 5 6 16']);
});

test('unmanaged orders: SubmitOrderUnmanaged, OCO bracket, ChangeOrder, OnOrderUpdate/OnExecutionUpdate', () => {
  const r = runCs(`public class Um : Strategy {
    Order entry, stop, target;
    protected override void OnStateChange() { if (State == State.SetDefaults) { Name = "Um"; IsUnmanaged = true; BarsRequiredToTrade = 1; } }
    protected override void OnBarUpdate() {
      if (CurrentBar == 5 && entry == null) entry = SubmitOrderUnmanaged(0, OrderAction.Buy, OrderType.Market, 2, 0, 0, "", "L");
      if (stop != null && stop.OrderState == OrderState.Working) ChangeOrder(stop, 2, 0, Low[0] - 500);
    }
    protected override void OnExecutionUpdate(Execution execution, string executionId, double price, int quantity, MarketPosition marketPosition, string orderId, DateTime time) {
      Print("exec " + execution.Order.Name + " " + quantity + " " + Position.MarketPosition);
      if (execution.Order == entry) {
        stop = SubmitOrderUnmanaged(0, OrderAction.Sell, OrderType.StopMarket, 2, 0, price - 500, "oco1", "SL");
        target = SubmitOrderUnmanaged(0, OrderAction.Sell, OrderType.Limit, 2, price + 2, 0, "oco1", "TP");
      }
    }
    protected override void OnOrderUpdate(Order order, double limitPrice, double stopPrice, int quantity, int filled, double averageFillPrice, OrderState orderState, DateTime time, ErrorCode error, string comment) {
      if (order.Name == "SL" && orderState == OrderState.Cancelled) Print("sl cancelled");
    }
  }`, 'Um');
  assert.deepEqual(logs(r), ['exec L 2 Long', 'exec TP 2 Flat', 'sl cancelled']);
  const t = r.tester!.trades;
  assert.equal(t.length, 1);
  assert.equal(t[0].exitId, 'TP');
  assert.equal(t[0].qty, 2);
  assert.ok(t[0].exitPrice >= t[0].entryPrice + 2 - 1e-9);   // limit at entry + 2 (or better on a gap)
});

test('OnRender: RenderTarget calls become drawings at chart coordinates (static snapshot)', () => {
  const r = runCs(`public class Rn : Indicator {
    protected override void OnStateChange() { if (State == State.SetDefaults) { Name = "Rn"; IsOverlay = true; } }
    protected override void OnBarUpdate() { }
    protected override void OnRender(ChartControl chartControl, ChartScale chartScale) {
      base.OnRender(chartControl, chartScale);
      SharpDX.Direct2D1.Brush dx = Brushes.Red.ToDxBrush(RenderTarget);
      int i = ChartBars.ToIndex, j = i - 10;
      float x1 = chartControl.GetXByBarIndex(ChartBars, j), x2 = chartControl.GetXByBarIndex(ChartBars, i);
      float y1 = chartScale.GetYByValue(High.GetValueAt(j)), y2 = chartScale.GetYByValue(Low.GetValueAt(i));
      RenderTarget.DrawLine(new SharpDX.Vector2(x1, y1), new SharpDX.Vector2(x2, y2), dx, 2);
      RenderTarget.FillRectangle(new SharpDX.RectangleF(x1, y1, x2 - x1, y2 - y1), dx);
      var tf = new SharpDX.DirectWrite.TextFormat(NinjaTrader.Core.Globals.DirectWriteFactory, "Arial", 12f);
      RenderTarget.DrawText("hi", tf, new SharpDX.RectangleF(x2, y2, 50, 20), dx);
      RenderTarget.DrawEllipse(new SharpDX.Direct2D1.Ellipse(new SharpDX.Vector2(x2, y2), 5, 5), dx);
      dx.Dispose();
    }
  }`, 'Rn');
  const d = r.out.drawings as any[], n = bars.length - 1, j = n - 10;
  assert.equal(d.length, 3 + 24);
  assert.equal(d[0].type, 'line');
  assert.equal(d[0].x1, bars[j].time * 1000); assert.equal(d[0].x2, bars[n].time * 1000);
  assert.ok(Math.abs(d[0].y1 - bars[j].high) < 1e-6 && Math.abs(d[0].y2 - bars[n].low) < 1e-6, `${d[0].y1} ${d[0].y2}`);
  assert.equal(d[0].color, '#ff0000');
  assert.equal(d[1].type, 'box');
  assert.equal(d[2].type, 'label'); assert.equal(d[2].text, 'hi');
});

test('OnRender with the chart view: real pixels of the visible bars, PathGeometry outlines', () => {
  const r = runCs(`public class Rg : Indicator {
    protected override void OnStateChange() { if (State == State.SetDefaults) { Name = "Rg"; IsOverlay = true; } }
    protected override void OnBarUpdate() { }
    protected override void OnRender(ChartControl chartControl, ChartScale chartScale) {
      Print(ChartBars.FromIndex + " " + ChartBars.ToIndex + " " + chartControl.GetXByBarIndex(ChartBars, ChartBars.FromIndex + 10));
      SharpDX.Direct2D1.PathGeometry g = new SharpDX.Direct2D1.PathGeometry(NinjaTrader.Core.Globals.D2DFactory);
      SharpDX.Direct2D1.GeometrySink sink = g.Open();
      int a = ChartBars.FromIndex, b = ChartBars.ToIndex;
      sink.BeginFigure(new SharpDX.Vector2(chartControl.GetXByBarIndex(ChartBars, a), chartScale.GetYByValue(High.GetValueAt(a))), SharpDX.Direct2D1.FigureBegin.Filled);
      sink.AddLine(new SharpDX.Vector2(chartControl.GetXByBarIndex(ChartBars, b), chartScale.GetYByValue(High.GetValueAt(b))));
      sink.AddLine(new SharpDX.Vector2(chartControl.GetXByBarIndex(ChartBars, b), chartScale.GetYByValue(Low.GetValueAt(b))));
      sink.EndFigure(SharpDX.Direct2D1.FigureEnd.Closed);
      sink.Close();
      RenderTarget.FillGeometry(g, Brushes.Blue.ToDxBrush(RenderTarget));
      g.Dispose();
    }
  }`, 'Rg', { view: { from: 200, to: 250, width: 500, height: 400 } });
  assert.deepEqual(logs(r), ['200 250 100']);
  assert.equal(r.result.rendered, true);
  const d = r.out.drawings as any[];
  assert.equal(d.length, 3, 'a closed triangle = 3 segments');
  assert.equal(d[0].x1, bars[200].time * 1000); assert.equal(d[0].x2, bars[250].time * 1000);
  assert.ok(Math.abs(d[2].y2 - bars[200].high) < 1e-6, 'closed back to the first point');
});

test('Calculate.OnEachTick ticks the primary series of a multi-series script', () => {
  const r = runCs(`public class Mt : Indicator {
    int ticks;
    protected override void OnStateChange() {
      if (State == State.SetDefaults) { Name = "Mt"; Calculate = Calculate.OnEachTick; }
      else if (State == State.Configure) AddDataSeries(BarsPeriodType.Minute, 60);
    }
    protected override void OnBarUpdate() { if (BarsInProgress == 0 && CurrentBar == 5) ticks++; if (CurrentBar == 6 && BarsInProgress == 0 && IsFirstTickOfBar) Print("t" + ticks); }
  }`, 'Mt', { barsFor: (_s: string, tf: number) => tf === 3600 ? bars.filter((_, i) => i % 4 === 0).map(b => ({ ...b })) : [] });
  assert.deepEqual(logs(r), ['t4']);
});

test('trading hours: IsFirstBarOfSession, SessionIterator and exit on session close follow the template', () => {
  const ind = runCs(`public class Ss : Indicator {
    protected override void OnBarUpdate() {
      if (CurrentBar > 0 && Bars.IsFirstBarOfSession) {
        var si = new SessionIterator(Bars);
        si.GetNextSession(Time[0], true);
        Print((Time[0].Hour * 100 + Time[0].Minute) + " " + si.ActualSessionBegin.Hour + ":" + si.ActualSessionBegin.Minute + "-" + si.ActualSessionEnd.Hour + ":" + si.ActualSessionEnd.Minute);
      }
    }
  }`, 'Ss', { inputs: { __tradingHours: 'CME US Index Futures RTH' } });
  assert.deepEqual(logs(ind), ['1445 14:30-21:15', '1445 14:30-21:15', '1445 14:30-21:15']);   // 08:30-15:15 Chicago (CST) in UTC
  assert.equal(ind.out.inputs.at(-1)!.value, 'CME US Index Futures RTH');
  const st = runCs(`public class Eo : Strategy {
    protected override void OnStateChange() { if (State == State.SetDefaults) { Name = "Eo"; BarsRequiredToTrade = 1; } }
    protected override void OnBarUpdate() { if (Position.MarketPosition == MarketPosition.Flat && Bars.IsFirstBarOfSession && CurrentBar > 0) EnterLong(); }
  }`, 'Eo', { session: 'CME US Index Futures RTH' });
  const t = st.tester!.trades;
  assert.equal(t.length, 3);   // one per day, each flattened on the session's last bar (21:00 UTC open)
  for (const x of t) { assert.equal(x.exitId, 'Exit on session close'); assert.equal(new Date(x.exitTime * 1000).getUTCHours() * 100 + new Date(x.exitTime * 1000).getUTCMinutes(), 2100) }
});

test('Calculate.OnEachTick replays OHLC ticks: IsFirstTickOfBar, forming-bar values, intrabar fills', () => {
  const r = runCs(`public class Tk : Indicator {
    int calls = 0, firsts = 0, bad = 0;
    protected override void OnStateChange() {
      if (State == State.SetDefaults) { Name = "Tk"; Calculate = Calculate.OnEachTick; AddPlot(Brushes.Blue, "S"); }
      else if (State == State.Terminated) Print(calls + " " + firsts + " " + bad);
    }
    protected override void OnBarUpdate() {
      calls++;
      if (IsFirstTickOfBar) { firsts++; if (Close[0] != Open[0] || High[0] != Open[0]) bad++; }
      Value[0] = SMA(Close, 3)[0];
    }
  }`, 'Tk');
  assert.deepEqual(logs(r), [`${bars.length * 4} ${bars.length} 0`]);
  const ref = sma(bars.map(b => b.close), 3);
  for (const i of [50, 200, 287]) assert.ok(Math.abs(r.out.plots[0].values[i] - ref[i]!) < 1e-9);
  const s = runCs(`public class Ts : Strategy {
    protected override void OnStateChange() { if (State == State.SetDefaults) { Name = "Ts"; Calculate = Calculate.OnEachTick; BarsRequiredToTrade = 1; } }
    protected override void OnBarUpdate() { if (CurrentBar == 10 && IsFirstTickOfBar) EnterLong(); if (CurrentBar == 20 && IsFirstTickOfBar) ExitLong(); }
  }`, 'Ts');
  const b = bars[10], e = s.result.executions![0];
  assert.equal(e.time, b.time);                                   // filled inside bar 10, not at bar 11's open
  assert.equal(e.price, b.close >= b.open ? b.low : b.high);      // at the next tick of the OHLC path
});
