import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile, instantiate } from './index.ts';

type AnyFn = (...a: any[]) => any;
const GLOBALS = ['Math', 'Brushes', 'State', 'Calculate', 'Series', 'List', 'Dictionary', 'CalculationMode', 'PlotStyle', 'MarketPosition', 'SolidColorBrush', 'Color', 'Print', 'Draw'];

class FakeSeries { data: number[] = []; constructor(..._a: unknown[]) {} get(i: number) { return this.data[this.data.length - 1 - i] } set(i: number, v: number) { this.data[this.data.length - 1 - i] = v } }
class FakeList<T> { items: T[] = []; Add(x: T) { this.items.push(x) } get Count() { return this.items.length } [Symbol.iterator]() { return this.items[Symbol.iterator]() } }
class FakeDict<K, V> {
  m = new Map<K, V>();
  Add(k: K, v: V) { this.m.set(k, v) }
  ContainsKey(k: K) { return this.m.has(k) }
  TryGetValue(k: K, r: { v: V | undefined }) { r.v = this.m.get(k); return this.m.has(k) }
  get Count() { return this.m.size }
  *[Symbol.iterator]() { for (const [Key, Value] of this.m) yield { Key, Value } }
}
function mkRt() {
  const out: string[] = [], calls: string[] = [];
  class NinjaBase {
    Close = Object.assign(new FakeSeries(), { data: [10, 11, 12] });
    CurrentBar = 2; State = 'SetDefaults'; Name = ''; Values: FakeSeries[] = []; Plots: unknown[] = [];
    Print(x: unknown) { out.push(String(x)) }
    AddPlot(_b: unknown, n: string) { this.Values.push(new FakeSeries()); calls.push(`AddPlot(${n})`) }
    SMA(...a: unknown[]) { calls.push(`SMA(${a.filter(x => typeof x !== 'object').join(',')})`); return Object.assign(new FakeSeries(), { data: [a.at(-1) as number] }) }
  }
  class Indicator extends NinjaBase {}
  class Strategy extends NinjaBase {
    CrossAbove(a: FakeSeries, b: FakeSeries, n: number) { calls.push(`CrossAbove(${a.get(0)},${b.get(0)},${n})`); return a.get(0) > b.get(0) }
    EnterLong(...a: unknown[]) { calls.push(`EnterLong(${a.join(',')})`) }
    SetStopLoss(...a: unknown[]) { calls.push(`SetStopLoss(${a.join(',')})`) }
  }
  const rt: Record<string, unknown> = {
    Indicator, Strategy, Series: FakeSeries, List: FakeList, Dictionary: FakeDict,
    __get: (o: any, i: any) => o instanceof FakeSeries ? o.get(i) : Array.isArray(o) || typeof o === 'string' ? o[i] : o instanceof FakeDict ? o.m.get(i) : o.items[i],
    __set: (o: any, i: any, v: any) => { if (o instanceof FakeSeries) o.set(i, v); else if (Array.isArray(o)) o[i] = v; else if (o instanceof FakeDict) o.m.set(i, v); else o.items[i] = v },
    __fmt: (v: any, f?: string, al?: number) => { let s = f && /^F\d$/.test(f) ? Number(v).toFixed(+f[1]) : String(v); if (al) s = al > 0 ? s.padStart(al) : s.padEnd(-al); return s },
    __format: (f: string, a: unknown[]) => f.replace(/\{(\d+)\}/g, (_, k) => String(a[+k])),
    Math: { Max: Math.max, Min: Math.min, Abs: Math.abs, Sqrt: Math.sqrt, Round: Math.round, Floor: Math.floor },
    Brushes: { Red: 'red', Blue: 'blue' }, State: { SetDefaults: 'SetDefaults', Configure: 'Configure', DataLoaded: 'DataLoaded' },
    Calculate: { OnBarClose: 'obc' }, CalculationMode: { Ticks: 'ticks' }, PlotStyle: { Line: 'line' }, MarketPosition: { Flat: 'flat' },
    SolidColorBrush: class { c: unknown; constructor(c: unknown) { this.c = c } }, Color: { FromRgb: (r: number, g: number, b: number) => `rgb(${r},${g},${b})` },
    Print: (x: unknown) => out.push(String(x)),
  };
  return { rt, out, calls };
}
const errText = (r: ReturnType<typeof compile>) => r.errors.map(e => `${e.file}(${e.line},${e.col}) ${e.msg}`).join('; ');
function build(files: Record<string, string> | string) {
  const f = typeof files === 'string' ? { 'a.cs': files } : files;
  const r = compile(f, { globals: GLOBALS });
  assert.ok(r.ok, errText(r));
  const m = mkRt();
  return { cls: instantiate(r.js!, m.rt) as Record<string, any>, r, ...m };
}
/** Wraps statements in a static Run() method and returns what Print wrote. */
const run = (body: string, extra = '') => {
  const b = build(`using System; class P { ${extra} public static void Run() { ${body} } }`);
  b.cls.P.Run();
  return b.out;
};
const fails = (src: string, re: RegExp, line?: number) => {
  const r = compile({ 'a.cs': src }, { globals: GLOBALS });
  assert.ok(!r.ok, 'expected a compile error');
  const e = r.errors.find(x => re.test(x.msg));
  assert.ok(e, `no error matching ${re}: ${errText(r)}`);
  if (line != null) assert.equal(e!.line, line, errText(r));
};

test('integer division, truncation and divide by zero', () => {
  assert.deepEqual(run(`int a = 7 / 2; double b = 7 / 2; double c = 7.0 / 2; int d = (int)9.99; int e = -7 / 2; int f = 10; f /= 3; f *= 1.5;
    byte g = (byte)300; long h = 5L * 3; int m = 17 % 5; Print(a + " " + b + " " + c + " " + d + " " + e + " " + f + " " + g + " " + h + " " + m);`),
  ['3 3 3.5 9 -3 4 44 15 2']);
  assert.throws(() => run('int z = 0; int x = 5 / z; Print(x);'), /divide by zero/);
  assert.deepEqual(run(`int x = 1_000; long big = 0xFF; double d = 1e3; float f = 2.5f; decimal m = 1.25m; Print(x + big + d + f + m);`), ['2258.75']);
});

test('name resolution: locals, fields, inherited and globals', () => {
  const b = build(`
    namespace NinjaTrader.NinjaScript.Indicators {
      public class N : Indicator {
        private int count = 5;
        public static int Shared = 7;
        protected override void OnBarUpdate() {
          int count2 = count + 1;
          double c = Close[0];
          Print(count2 + " " + c + " " + CurrentBar + " " + Math.Max(3, 4) + " " + Shared + " " + Brushes.Red);
          int CurrentBar = 99; Print(CurrentBar);
          if (State == State.SetDefaults) Print("defaults");
        }
      }
    }`);
  const n = new b.cls.N();
  n.OnBarUpdate();
  assert.deepEqual(b.out, ['6 12 2 4 7 red', '99', 'defaults']);
  assert.match(b.r.js!, /rt\.__get\(this\.Close, 0\)/);
  assert.match(b.r.js!, /this\.State === rt\.State\.SetDefaults/);
});

test('properties, [NinjaScriptProperty]/Range/Display → __inputs', () => {
  const b = build(`
    public enum MaKind { Simple, Exponential = 5, Weighted }
    public class Ind : Indicator {
      private double mult;
      [NinjaScriptProperty]
      [Range(1, int.MaxValue)]
      [Display(Name = "Period", Order = 2, GroupName = "NinjaScriptParameters")]
      public int Period { get; set; } = 14;
      [NinjaScriptProperty]
      [Display(Name = "Multiplier", Order = 1, GroupName = "Bands")]
      public double Mult { get { return mult; } set { mult = Math.Max(0, value); } }
      [NinjaScriptProperty] public MaKind Kind { get; set; } = MaKind.Exponential;
      [Browsable(false)] [XmlIgnore] public Series<double> Upper => Values[0];
      public int Doubled => Period * 2;
    }`);
  const info = b.r.classes.find(c => c.name === 'Ind')!;
  assert.equal(info.kind, 'indicator');
  assert.deepEqual(info.inputs.map(i => [i.name, i.type, i.def, i.displayName, i.group, i.min, i.max]), [
    ['Mult', 'double', undefined, 'Multiplier', 'Bands', undefined, undefined],
    ['Period', 'int', 14, 'Period', 'Parameters', 1, 2147483647],
    ['Kind', 'MaKind', 'Exponential', 'Kind', 'Parameters', undefined, undefined],
  ]);
  assert.deepEqual(info.inputs[2].options, ['Simple', 'Exponential', 'Weighted']);
  assert.deepEqual(b.cls.Ind.__inputs, info.inputs);
  assert.equal(b.cls.Ind.__name, 'Ind');
  const o = new b.cls.Ind();
  o.Mult = -3; o.Period = 10;
  assert.equal(o.Mult, 0);
  assert.equal(o.Doubled, 20);
});

test('overloads, optional/named/params arguments', () => {
  assert.deepEqual(run(`Print(F(1) + "," + F(1.5) + "," + F("s") + "," + G(1) + "," + G(1, c: 5) + "," + S() + "," + S(1, 2, 3) + "," + S(new int[] { 4, 5 }));`,
    `static string F(int x) { return "int"; } static string F(double x) { return "dbl"; } static string F(string s) { return "str"; }
     static int G(int a, int b = 10, int c = 100) { return a + b + c; }
     static int S(params int[] xs) { int t = 0; foreach (var x in xs) t += x; return t; }`), ['int,dbl,str,111,16,0,6,9']);
});

test('out/ref parameters and TryParse', () => {
  assert.deepEqual(run(`int a = 1; Inc(ref a); Inc(ref a); Split(7, out int q, out var r); int.TryParse("42", out int n); bool bad = double.TryParse("x", out double d);
    Print(a + " " + q + " " + r + " " + n + " " + bad + " " + d);`,
    `static void Inc(ref int x) { x++; } static void Split(int v, out int q, out int r) { q = v / 2; r = v % 2; }`), ['3 3 1 42 False 0']);
});

test('structs copy by value, classes by reference', () => {
  assert.deepEqual(run(`Pt a = new Pt(1, 2); Pt b = a; b.X = 9; Box c = new Box(); Box d = c; d.V = 9; Bump(a); Print(a.X + " " + b.X + " " + c.V + " " + a.Sum());`,
    `struct Pt { public int X; public int Y; public Pt(int x, int y) { X = x; Y = y; } public int Sum() => X + Y; }
     class Box { public int V; }
     static void Bump(Pt p) { p.X = 100; }`), ['1 9 9 3']);
});

test('inheritance, base calls, constructors chaining, virtual dispatch', () => {
  assert.deepEqual(run(`Animal a = new Dog("Rex"); Print(a.Speak() + " " + a.Name + " " + new Dog().Name + " " + Animal.Count);`,
    `abstract class Animal { public static int Count; public string Name { get; protected set; }
       protected Animal(string n) { Name = n; Count++; }
       public virtual string Speak() { return "..."; } }
     class Dog : Animal { public Dog() : this("Anon") { } public Dog(string n) : base(n) { }
       public override string Speak() { return "Woof" + base.Speak(); } }`), ['Woof... Rex Anon 2']);
});

test('switch statement/expression and pattern matching', () => {
  assert.deepEqual(run(`foreach (object o in new object[] { 3, "hi", 2.5, null, new Box() }) Print(Kind(o));
    for (int i = 0; i < 6; i++) { switch (i) { case 0: case 1: Print("low"); break; case int n when n > 3: Print("big" + n); break; default: Print("mid"); break; } }
    Print(Grade(95) + Grade(75) + Grade(10)); Shape s = Shape.Circle; Print(s switch { Shape.Square => "sq", Shape.Circle => "ci", _ => "?" });
    string t = "b"; switch (t) { case "a": Print("A"); break; case "b": Print("B"); break; }`,
    `enum Shape { Square, Circle } class Box { }
     static string Kind(object o) { if (o is int i && i > 2) return "int" + i; if (o is string s) return "str" + s.Length; if (o is null) return "null"; if (o is Box) return "box"; return o is double ? "dbl" : "other"; }
     static string Grade(int x) => x switch { >= 90 => "A", >= 70 and < 90 => "C", _ => "F" };`),
  ['int3', 'str2', 'dbl', 'null', 'box', 'low', 'low', 'mid', 'mid', 'big4', 'big5', 'ACF', 'ci', 'B']);
});

test('string interpolation, formats, string methods, chars', () => {
  assert.deepEqual(run(`double p = 3.14159; int n = 7; bool ok = true; char c = 'A'; c++; string s = null;
    Print($"p={p:F2} n={n,4}| ok={ok} c={c} {{x}} s={s}");
    Print(string.Format("{0}-{1}", n, "z") + " " + p.ToString("F1") + " " + "Hello".Substring(1, 3).ToUpper() + " " + "a,b".Split(',').Length);
    Print(@"C:\\path" + " " + (char)(c + 1) + " " + (int)'a' + " " + ('z' - 'a') + " " + string.IsNullOrEmpty(s) + " " + "abc".IndexOf('c'));`),
  ['p=3.14 n=   7| ok=True c=B {x} s=', '7-z 3.1 ELL 2', 'C:\\path C 97 25 True 2']);
});

test('List/Dictionary foreach, lambdas, local functions, nullable', () => {
  assert.deepEqual(run(`var l = new List<int> { 1, 2, 3 }; int sum = 0; foreach (int x in l) sum += x;
    var d = new Dictionary<string, int>(); d.Add("a", 1); d["b"] = 2; string keys = ""; foreach (var kv in d) keys += kv.Key + kv.Value;
    Func<int, int> sq = x => x * x; Func<int, int, int> add = (a, b) => { return a + b; }; Action hi = () => Print("hi"); hi();
    int Twice(int v) => v * 2;
    double? maybe = null; double v1 = maybe ?? -1; maybe = 2.5; int? ni = null;
    d.TryGetValue("b", out int got);
    Print(sum + " " + keys + " " + sq(4) + " " + add(2, 3) + " " + Twice(21) + " " + v1 + " " + maybe.Value + " " + maybe.HasValue + " " + ni.HasValue + " " + got + " " + l.Count);`),
  ['hi', '6 a1b2 16 5 42 -1 2.5 True False 2 3']);
});

test('arrays: new T[n], 2D, jagged, initializers, try/catch', () => {
  assert.deepEqual(run(`double[] a = new double[3]; a[1] = 2; int[,] g = new int[2, 3]; g[1, 2] = 5; int[][] j = new int[2][]; j[0] = new[] { 7, 8 };
    string[] names = { "x", "y" }; bool[] f = new bool[1];
    try { throw new InvalidOperationException("boom"); } catch (ArgumentException) { Print("wrong"); } catch (InvalidOperationException ex) { Print("caught " + ex.Message); } finally { Print("fin"); }
    Print(a[0] + a[1] + " " + g[1, 2] + " " + j[0][1] + " " + names.Length + names[1] + " " + f[0] + " " + a.Length);`),
  ['caught boom', 'fin', '2 5 8 2y False 3']);
});

const SMA_CROSS = `
#region Using declarations
using System;
using NinjaTrader.Cbi;
using NinjaTrader.NinjaScript.Indicators;
using SharpDX.DirectWrite;
#endregion
namespace NinjaTrader.NinjaScript.Strategies
{
  public class SmaCross : Strategy
  {
    private SMA fast, slow;
    protected override void OnStateChange()
    {
      if (State == State.SetDefaults)
      {
        Description = @"SMA cross";
        Name = "SmaCross";
        Calculate = Calculate.OnBarClose;
        Fast = 10; Slow = 25;
      }
      else if (State == State.DataLoaded)
      {
        fast = SMA(Fast); slow = SMA(Close, Slow);
      }
    }
    protected override void OnBarUpdate()
    {
      if (CurrentBar < BarsRequiredToTrade) return;
      if (CrossAbove(fast, slow, 1)) { EnterLong("L"); SetStopLoss(CalculationMode.Ticks, 20); }
    }
    #region Properties
    [NinjaScriptProperty] [Range(1, int.MaxValue)] [Display(Name = "Fast", Order = 1, GroupName = "Parameters")]
    public int Fast { get; set; }
    [NinjaScriptProperty] [Range(1, int.MaxValue)] [Display(Name = "Slow", Order = 2, GroupName = "Parameters")]
    public int Slow { get; set; }
    #endregion
  }
}`;

test('realistic NT8 SMA-cross strategy', () => {
  const b = build({ 'SmaCross.cs': SMA_CROSS });
  const s = new b.cls.SmaCross();
  s.BarsRequiredToTrade = 0;
  s.OnStateChange();
  assert.equal(s.Name, 'SmaCross');
  assert.equal(s.Calculate, 'obc');
  assert.equal(s.Fast, 10);
  s.State = 'DataLoaded'; s.OnStateChange();
  s.OnBarUpdate();
  assert.deepEqual(b.calls, ['SMA(10)', 'SMA(25)', 'CrossAbove(10,25,1)']);
  s.Fast = 30; s.OnStateChange(); s.OnBarUpdate();
  assert.deepEqual(b.calls.slice(3), ['SMA(30)', 'SMA(25)', 'CrossAbove(30,25,1)', 'EnterLong(L)', 'SetStopLoss(ticks,20)']);
  const info = b.r.classes[0];
  assert.equal(info.kind, 'strategy');
  assert.deepEqual(info.inputs.map(i => [i.name, i.min]), [['Fast', 1], ['Slow', 1]]);
});

const MY_IND = `
namespace NinjaTrader.NinjaScript.Indicators
{
  public class MyRange : Indicator
  {
    private Series<double> tmp;
    protected override void OnStateChange()
    {
      if (State == State.SetDefaults) { Name = "MyRange"; AddPlot(Brushes.Orange, "Range"); AddPlot(new SolidColorBrush(Color.FromRgb(1, 2, 3)), "Half"); Period = 3; }
      else if (State == State.DataLoaded) tmp = new Series<double>(this);
    }
    protected override void OnBarUpdate()
    {
      Values[0][0] = Close[0] * Period;
      Values[1][0] = Values[0][0] / 2;
      Value[0] += 1;
    }
    [NinjaScriptProperty] public int Period { get; set; }
    [Browsable(false)] [XmlIgnore] public Series<double> Range { get { return Values[0]; } }
  }
}

#region NinjaScript generated code. Neither change nor remove.
namespace NinjaTrader.NinjaScript.Indicators
{
  public partial class Indicator : NinjaTrader.Gui.NinjaScript.IndicatorRenderBase
  {
    private MyRange[] cacheMyRange;
    public MyRange MyRange(int period) { return MyRange(Input, period); }
    public MyRange MyRange(ISeries<double> input, int period)
    {
      if (cacheMyRange != null) for (int idx = 0; idx < cacheMyRange.Length; idx++) if (cacheMyRange[idx] != null && cacheMyRange[idx].Period == period && cacheMyRange[idx].EqualsInput(input)) return cacheMyRange[idx];
      return CacheIndicator<MyRange>(new MyRange(){ Period = period }, input, ref cacheMyRange);
    }
  }
}
namespace NinjaTrader.NinjaScript.Strategies
{
  public partial class Strategy : NinjaTrader.Gui.NinjaScript.StrategyRenderBase
  {
    public Indicators.MyRange MyRange(int period) { return indicator.MyRange(Input, period); }
  }
}
#endregion`;

test('realistic indicator with AddPlot/Values; generated cache region ignored', () => {
  const b = build({ 'MyRange.cs': MY_IND });
  assert.deepEqual(b.r.classes.map(c => c.name), ['MyRange']);
  const ind = new b.cls.MyRange();
  ind.OnStateChange();
  assert.deepEqual(b.calls, ['AddPlot(Range)', 'AddPlot(Half)']);
  ind.Value = ind.Values[0];
  for (const s of ind.Values) s.data = [0];
  ind.OnBarUpdate();
  assert.equal(ind.Values[0].get(0), 37);
  assert.equal(ind.Values[1].get(0), 18);
  assert.equal(ind.Range, ind.Values[0]);
});

test('two-file compilation: strategy calls a user indicator', () => {
  const strat = `namespace NinjaTrader.NinjaScript.Strategies { public class UseIt : Strategy {
    protected override void OnBarUpdate() { Print(MyRange(5).Range[0] + " " + MyRange(5).Period); } } }`;
  const b = build({ 'MyRange.cs': MY_IND, 'UseIt.cs': strat });
  assert.match(b.r.js!, /this\.MyRange\(5\)\.Range/);
  const s = new b.cls.UseIt();
  s.MyRange = (p: number) => Object.assign(new b.cls.MyRange(), { Values: [Object.assign(new FakeSeries(), { data: [p * 2] })], Period: p });
  s.OnBarUpdate();
  assert.deepEqual(b.out, ['10 5']);
});

test('errors carry line numbers and resync', () => {
  fails('class A {\n  void F() {\n    int x = ;\n  }\n}', /Expected an expression/, 3);
  const r = compile({ 'a.cs': 'class A {\n void F() { int x = ; }\n void G() { y = 2 +; }\n int H() { return 1 }\n}' }, { globals: [] });
  assert.ok(r.errors.length >= 3, errText(r));
  assert.deepEqual(r.errors.slice(0, 3).map(e => e.line), [2, 3, 4]);
  fails('class A {\n void F() { G(1, 2); }\n void G(int a) { }\n}', /expects 1 argument/, 2);
  fails('class A { void F() { var q = from x in xs select x; } }', /LINQ query syntax/);
  fails('class A { public event EventHandler E; }', /Events are not supported/);
  fails('class A { unsafe void F() { } }', /Unsafe code/);
  fails('class A : Indicator {\n protected override void OnRender(ChartControl c, ChartScale s) { } }', /OnRender/, 2);
  fails('class A {\n void F() { Foo(); }\n}', /The name 'Foo' does not exist/, 2);
  fails('class B { public int X; }\nclass A { void F() { var b = new B(); b.Y = 1; } }', /does not contain a definition for 'Y'/, 2);
  fails('class A { void F() { int x = 1; goto done; } }', /goto/);
});

test('#if/#else and verbatim/escaped strings', () => {
  assert.deepEqual(run(`
#if false
    Print("no");
#else
    Print("yes\\t" + @"a""b");
#endif
`), ['yes\ta"b']);
});
