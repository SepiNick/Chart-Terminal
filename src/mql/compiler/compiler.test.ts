import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile, instantiate, type CompileOptions } from './index.ts';
import { MqlArray } from '../contract.ts';

type AnyFn = (...a: any[]) => any;
const OPTS: CompileOptions = {
  outParams: { 'StringSplitOut/2': [1], 'GetValue/1': [0] },
  builtinStructs: ['MqlTick', 'MqlTradeRequest', 'MqlTradeResult', 'MqlRates'],
  builtinClasses: ['CTrade', 'CPositionInfo'],
  nativeIncludes: ['Trade\\Trade.mqh', 'Trade/PositionInfo.mqh', 'MovingAverages.mqh'],
};
class MqlTick { time = 0; bid = 0; ask = 0 }
function mkRt(extra: Record<string, unknown> = {}) {
  const out: string[] = [];
  const rt: Record<string, unknown> = {
    Print: (...a: unknown[]) => { out.push(a.map(String).join('')) },
    __copy: (x: object) => Object.assign(Object.create(Object.getPrototypeOf(x)), x),
    ArrayResize: (a: MqlArray, n: number) => a.resize(n),
    ArraySize: (a: MqlArray) => a.size,
    ArraySetAsSeries: (a: MqlArray, s: boolean) => { a.series = s; return true },
    IntegerToString: (x: number) => String(x),
    DoubleToString: (x: number, d = 8) => x.toFixed(d),
    GetValue: (r: { v: number }) => { r.v = 42; return true },
    MqlTick, clrRed: 255, PERIOD_H1: 16385, INIT_SUCCEEDED: 0,
    ...extra,
  };
  return { rt, out };
}
const errText = (r: ReturnType<typeof compile>) => r.errors.map(e => `${e.file}(${e.line},${e.col}) ${e.msg}`).join('; ');
function build(src: string, name = 't.mq5', files: Record<string, string> = {}, extra: Record<string, unknown> = {}) {
  const r = compile(name, { [name]: src, ...files }, OPTS);
  assert.ok(r.ok, errText(r));
  const { rt, out } = mkRt(extra);
  const p = instantiate(r.js!, rt);
  return { p, out, rt, r };
}
const run = (src: string, name = 't.mq5', files: Record<string, string> = {}, extra: Record<string, unknown> = {}) => {
  const b = build(src, name, files, extra);
  (b.p.handlers.OnStart as AnyFn)();
  return b.out;
};
const fails = (src: string, re: RegExp, line?: number, name = 't.mq5', files: Record<string, string> = {}) => {
  const r = compile(name, { [name]: src, ...files }, OPTS);
  assert.ok(!r.ok, 'expected a compile error');
  const e = r.errors.find(x => re.test(x.msg));
  assert.ok(e, `no error matching ${re}: ${errText(r)}`);
  if (line != null) assert.equal(e!.line, line, errText(r));
};

test('integer division and truncation', () => {
  assert.deepEqual(run(`void OnStart() {
    int a = 7 / 2; double b = 7 / 2; double c = 7.0 / 2; int d = 9.99; int e = -7 / 2;
    int f = 10; f /= 3; f *= 1.5; uchar g = 300; char h = 200; int m = 17 % 5;
    Print(a, " ", b, " ", c, " ", d, " ", e, " ", f, " ", g, " ", h, " ", m);
  }`), ['3 3 3.5 9 -3 4 44 -56 2']);
});

test('zero divide on integers throws MqlError', () => {
  const b = build('void OnStart() { int z = 0; int x = 5 / z; Print(x); }');
  assert.throws(() => (b.p.handlers.OnStart as AnyFn)(), /zero divide/);
});

test('overload resolution by arity and kind', () => {
  assert.deepEqual(run(`
    string f(int x) { return "int"; }
    string f(double x) { return "double"; }
    string f(string s) { return "string"; }
    string f(int a, int b) { return "two"; }
    void OnStart() { Print(f(1), f(1.5), f("x"), f(1, 2)); }`), ['intdoublestringtwo']);
});

test('reference params write back to variables, elements and fields', () => {
  assert.deepEqual(run(`
    struct P { int v; };
    void inc(int &x, double &y) { x++; y += 0.5; }
    void OnStart() {
      int a = 1; double b = 1; int arr[3] = {0, 10, 20}; P p; p.v = 5;
      inc(a, b); inc(arr[1], b); inc(p.v, b);
      int r; GetValue(r);
      Print(a, " ", b, " ", arr[1], " ", p.v, " ", r);
    }`), ['2 2.5 11 6 42']);
});

test('static locals persist across calls', () => {
  assert.deepEqual(run(`
    int counter() { static int n = 0; n++; return n; }
    void OnStart() { counter(); counter(); Print(counter()); }`), ['3']);
});

test('struct copy vs class reference', () => {
  assert.deepEqual(run(`
    struct S { int x; double arr[2]; };
    class C { public: int x; };
    void OnStart() {
      S a; a.x = 1; a.arr[0] = 5; S b = a; b.x = 2; b.arr[0] = 6;
      S c; c = a; c.x = 3;
      C *p = new C(); C *q = p; q.x = 7;
      Print(a.x, b.x, c.x, " ", a.arr[0], b.arr[0], " ", p.x);
      delete p;
    }`), ['123 56 7']);
});

test('inheritance, constructors, virtual dispatch, static members', () => {
  assert.deepEqual(run(`
    class Shape {
    protected:
      string m_name;
    public:
      static int count;
      Shape(string n) : m_name(n) { count++; }
      virtual double Area() { return 0; }
      string Describe() { return m_name + "=" + DoubleToString(Area(), 1); }
    };
    int Shape::count = 0;
    class Rect : public Shape {
      double m_w, m_h;
    public:
      Rect(double w, double h) : Shape("rect"), m_w(w), m_h(h) {}
      virtual double Area() { return m_w * m_h; }
    };
    class Square : public Rect {
    public:
      Square(double s) : Rect(s, s) { m_name = "square"; }
      double Area();
    };
    double Square::Area() { return Rect::Area() + 0; }
    void OnStart() {
      Shape *list[2];
      list[0] = new Rect(2, 3);
      list[1] = new Square(4);
      for (int i = 0; i < 2; i++) Print(list[i].Describe());
      Print(Shape::count);
    }`), ['rect=6.0', 'square=16.0', '2']);
});

test('function and class templates', () => {
  assert.deepEqual(run(`
    template<typename T> T Max(T a, T b) { return a > b ? a : b; }
    template<typename T> class Stack {
      T m_items[];
      int m_n;
    public:
      Stack() { m_n = 0; }
      void Push(T v) { ArrayResize(m_items, m_n + 1); m_items[m_n++] = v; }
      T Pop() { return m_items[--m_n]; }
      int Size() { return m_n; }
    };
    void OnStart() {
      Stack<double> s; s.Push(1.5); s.Push(2.5);
      Print(Max(3, 7), " ", Max("a", "b"), " ", s.Pop(), " ", s.Size());
    }`), ['7 b 2.5 1']);
});

test('switch with fallthrough and default', () => {
  assert.deepEqual(run(`
    string g(int x) { string r = ""; switch (x) { case 1: r += "a"; case 2: r += "b"; break; case 3: { r += "c"; break; } default: r += "d"; } return r; }
    void OnStart() { Print(g(1), g(2), g(3), g(9)); }`), ['abbcd']);
});

test('arrays: static, dynamic, multi-dim, ArrayResize, init lists, struct arrays', () => {
  assert.deepEqual(run(`
    struct Pt { int x; int y; };
    void fill(double &a[], int n) { ArrayResize(a, n); for (int i = 0; i < n; i++) a[i] = i * 1.5; }
    void OnStart() {
      int s[3] = {1, 2, 3}; double d[]; int m[2][3]; string names[] = {"x", "y"};
      Pt pts[]; ArrayResize(pts, 2); pts[1].x = 9;
      Pt lit[2] = {{1, 2}, {3, 4}};
      fill(d, 4); m[1][2] = 7; m[1][2] += 3; s[0]++; ++s[2]; s[1] *= 10;
      Print(s[0], s[1], s[2], " ", d[3], " ", m[1][2], " ", ArraySize(d), names[1], " ", pts[1].x, pts[0].x, " ", lit[1].y);
    }`), ['2204 4.5 10 4y 90 4']);
});

test('array out of range throws', () => {
  const b = build('void OnStart() { int a[2]; a[5] = 1; }');
  assert.throws(() => (b.p.handlers.OnStart as AnyFn)(), /out of range/);
});

test('#define constants, function-like macros, # and ##, #undef, #ifdef', () => {
  assert.deepEqual(run(`
    #define N 3
    #define SQR(x) ((x) * (x))
    #define STR(x) #x
    #define CAT(a, b) a##b
    #define MAX(a, b) ((a) > (b) ? (a) : (b))
    #ifdef __MQL5__
      #define WHO "mql5"
    #else
      #define WHO "mql4"
    #endif
    #ifndef MISSING
      #define OK 1
    #endif
    #if defined(OK) && N > 2
      #define BIG 1
    #endif
    #define TEMP 1
    #undef TEMP
    void OnStart() {
      int CAT(my, Var) = SQR(N + 1);
      #ifdef TEMP
      myVar = 0;
      #endif
      Print(myVar, " ", STR(hello), " ", WHO, " ", MAX(2, 5), " ", BIG);
    }`), ['16 hello mql5 5 1']);
  const out4 = build('#ifdef __MQL4__\nint f() { return 4; }\n#else\nint f() { return 5; }\n#endif\nvoid OnStart() { Print(f()); }', 'a.mq4');
  (out4.p.handlers.OnStart as AnyFn)();
  assert.deepEqual(out4.out, ['4']);
});

test('#include of user files, native includes skipped, missing include errors', () => {
  const files = { 'Include/Utils/Math.mqh': '#include "Inner.mqh"\nint Twice(int x) { return Inner(x) * 2; }', 'Include/Utils/Inner.mqh': 'int Inner(int x) { return x + 1; }' };
  assert.deepEqual(run('#include <Trade\\Trade.mqh>\n#include <Utils\\Math.mqh>\n#include <utils/math.mqh>\nvoid OnStart() { Print(Twice(4)); }', 'Experts/t.mq5', files), ['10']);
  fails('#include <Nope.mqh>\nvoid OnStart() {}', /Include file 'Nope.mqh' not found/, 1);
});

test('#import and #resource', () => {
  fails('#import "user32.dll"\nint MessageBoxW(int h, string a, string b, int f);\n#import\nvoid OnStart() {}', /DLL imports are not supported/, 1);
  fails('#import "mylib.ex5"\nint F();\n#import\n', /Library imports are not supported/, 1);
  const r = compile('t.mq5', { 't.mq5': '#resource "\\\\Images\\\\a.bmp"\nvoid OnStart() {}' }, OPTS);
  assert.ok(r.ok && r.warnings.some(w => /resource/.test(w.msg)));
});

test('inputs: InputDef, comments, groups, enum options, setInput, globals initialized after setInput', () => {
  const { p, out } = build(`
    #property strict
    #property copyright "Me"
    #property version   "1.20"
    #property indicator_color1 clrRed
    #property indicator_buffers 3
    #property indicator_minimum -1.5
    enum Mode { Fast, Slow = 5, Smooth };
    input group "Main"
    input int    Period = 14;     // MA period
    input double Lots = 0.1;
    input Mode   M = Slow;
    sinput string Name = "abc";
    double twice = Period * 2;
    void OnStart() { Print(Period, " ", Lots, " ", M, " ", EnumToString(M), " ", twice); }`);
  assert.deepEqual(p.props, { strict: true, copyright: 'Me', version: '1.20', indicator_color1: 255, indicator_buffers: 3, indicator_minimum: -1.5 });
  assert.deepEqual(p.inputs[0], { name: 'Period', type: 'int', def: 14, comment: 'MA period', group: 'Main' });
  assert.deepEqual(p.inputs[2].options, [{ name: 'Fast', value: 0 }, { name: 'Slow', value: 5 }, { name: 'Smooth', value: 6 }]);
  assert.equal(p.inputs[2].def, 5);
  assert.equal(p.inputs[3].name, 'Name');
  p.setInput('Period', 20.7); p.setInput('M', 6); p.setInput('Lots', '0.5');
  (p.handlers.OnStart as AnyFn)();
  assert.deepEqual(out, ['20 0.5 6 Smooth 40']);
});

test('color and datetime literals, char literals, string concatenation', () => {
  assert.deepEqual(run(`void OnStart() {
    color c = C'255,0,0'; color c2 = C'0x00,0x80,0xFF'; datetime t = D'2024.01.01 10:00'; datetime t2 = D'2024.01.02';
    int ch = 'A' + 1; string s = "n=" + 5 + " d=" + 1.5 + " b=" + true;
    string ts = "t=" + t; s += 7;
    Print(c, " ", c2, " ", t, " ", t2 - t, " ", ch, " ", s, " ", ts);
  }`), [`255 16744448 2024.01.01 10:00:00 50400 66 n=5 d=1.5 b=true7 t=2024.01.01 10:00:00`]);
});

test('casts, sizeof, ternary, comma, bool from numbers, NULL, string comparison', () => {
  assert.deepEqual(run(`
    class Obj { public: int v; };
    void OnStart() {
      int a = (int)3.9; double b = double(7) / 2; bool f = 5; int i, j;
      for (i = 0, j = 10; i < j; i++, j--);
      Obj *o = NULL; string s1 = "abc", s2 = "abd";
      Print(a, " ", b, " ", f, " ", sizeof(int), sizeof(double), " ", i, " ", o == NULL, " ", s1 < s2, " ", (string)42 + "!", " ", int("12") + 1);
    }`), ['3 3.5 true 48 5 true true 42! 13']);
});

test('function pointers via typedef', () => {
  assert.deepEqual(run(`
    typedef int (*BinOp)(int a, int b);
    int Add(int a, int b) { return a + b; }
    int Mul(int a, int b) { return a * b; }
    int Apply(BinOp f, int x, int y) { return f(x, y); }
    void OnStart() { BinOp op = Add; int r1 = op(2, 3); op = Mul; Print(r1, " ", Apply(op, 4, 5), " ", Apply(Add, 1, 1)); }`), ['5 20 2']);
});

test('interfaces, destructors, CheckPointer/GetPointer, dynamic_cast', () => {
  const out = run(`
    interface IAnimal { string Sound(); };
    class Dog : public IAnimal { public: string Sound() { return "woof"; } ~Dog() { Print("bye"); } };
    class Cat : public IAnimal { public: string Sound() { return "meow"; } };
    void OnStart() {
      IAnimal *a = new Dog(); IAnimal *b = new Cat(); Cat local;
      Cat *pc = GetPointer(local);
      Print(a.Sound(), b.Sound(), pc.Sound(), " ", CheckPointer(a), " ", dynamic_cast<Dog *>(b) == NULL);
      delete a;
    }`, 't.mq5', {}, { CheckPointer: (p: unknown) => (p ? 1 : 0) });
  assert.deepEqual(out, ['woofmeowmeow 1 true', 'bye']);
});

test('builtin structs and classes come from rt; struct assignment copies via rt.__copy', () => {
  let made = 0;
  class CTrade { magic = 0; SetExpertMagicNumber(m: number) { this.magic = m; made++ } }
  assert.deepEqual(run(`
    #include <Trade\\Trade.mqh>
    CTrade trade;
    void OnStart() {
      MqlTick a; a.bid = 1.5; MqlTick b = a; b.bid = 2; MqlTick c; c = a; c.ask = 9;
      trade.SetExpertMagicNumber(7);
      Print(a.bid, " ", b.bid, " ", a.ask, " ", c.bid);
    }`, 't.mq5', {}, { CTrade }), ['1.5 2 0 1.5']);
  assert.equal(made, 1);
});

const EA4 = `//+------------------------------------------------------------------+
//| MA cross expert (MQL4)                                           |
//+------------------------------------------------------------------+
#property copyright "test"
#property strict

extern int    FastMA     = 5;
extern int    SlowMA     = 20;
extern double Lots       = 0.1;
extern int    StopLoss   = 50;
extern int    TakeProfit = 100;
extern int    MagicNum   = 12345;
extern bool   UseTrailing = true;
extern int    TrailingStop = 30;

int    ticket = -1;
double lastFast, lastSlow;
int    ticks = 0;

int init()
{
   Print("init ", Symbol(), " digits=", Digits);
   return(0);
}

int deinit()
{
   Print("deinit after ", ticks, " ticks");
   return(0);
}

int CountOrders(int type)
{
   int n = 0;
   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
      if(OrderSymbol() != Symbol() || OrderMagicNumber() != MagicNum) continue;
      if(OrderType() == type) n++;
   }
   return(n);
}

void CloseAll(int type)
{
   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      if(OrderSelect(i, SELECT_BY_POS, MODE_TRADES) && OrderMagicNumber() == MagicNum && OrderType() == type)
      {
         double price = (type == OP_BUY) ? Bid : Ask;
         if(!OrderClose(OrderTicket(), OrderLots(), price, 3, clrNONE))
            Print("close failed: ", GetLastError());
      }
   }
}

void Trail()
{
   if(!UseTrailing) return;
   for(int i = 0; i < OrdersTotal(); i++)
   {
      if(!OrderSelect(i, SELECT_BY_POS)) continue;
      if(OrderType() == OP_BUY && Bid - OrderOpenPrice() > TrailingStop * Point)
      {
         double sl = NormalizeDouble(Bid - TrailingStop * Point, Digits);
         if(sl > OrderStopLoss()) OrderModify(OrderTicket(), OrderOpenPrice(), sl, OrderTakeProfit(), 0);
      }
   }
}

double LotSize()
{
   double lots = Lots;
   if(AccountBalance() > 20000) lots *= 2;
   return(NormalizeDouble(lots, 2));
}

int start()
{
   ticks++;
   if(Bars < SlowMA + 2) return(0);
   double fast = iMA(NULL, 0, FastMA, 0, MODE_SMA, PRICE_CLOSE, 1);
   double slow = iMA(NULL, 0, SlowMA, 0, MODE_SMA, PRICE_CLOSE, 1);
   double range = High[1] - Low[1];
   bool crossUp = lastFast != 0 && lastFast <= lastSlow && fast > slow;
   bool crossDn = lastFast != 0 && lastFast >= lastSlow && fast < slow;
   lastFast = fast; lastSlow = slow;
   if(range <= 0) return(0);
   if(crossUp && CountOrders(OP_BUY) == 0)
   {
      CloseAll(OP_SELL);
      double sl = StopLoss > 0 ? Ask - StopLoss * Point : 0;
      double tp = TakeProfit > 0 ? Ask + TakeProfit * Point : 0;
      ticket = OrderSend(Symbol(), OP_BUY, LotSize(), Ask, 3, sl, tp, "buy", MagicNum, 0, clrBlue);
      if(ticket < 0) Print("OrderSend failed: ", GetLastError());
   }
   else if(crossDn && CountOrders(OP_SELL) == 0)
   {
      CloseAll(OP_BUY);
      ticket = OrderSend(Symbol(), OP_SELL, LotSize(), Bid, 3, 0, 0, "sell", MagicNum, 0, clrRed);
   }
   Trail();
   return(0);
}
`;

test('realistic MQL4 EA runs against rt mocks', () => {
  const orders: { ticket: number; type: number; lots: number; price: number; magic: number }[] = [];
  let sel: (typeof orders)[number] | undefined, bar = 0, nextTicket = 1;
  const closes = [1.0, 1.0, 1.0, 1.1, 1.2, 1.3, 1.2, 1.0, 0.9, 0.8, 0.9, 1.1, 1.3];
  const rt = {
    Symbol: () => 'EURUSD', Digits: 5, Point: 0.00001, Bars: 100, OP_BUY: 0, OP_SELL: 1, MODE_SMA: 0, PRICE_CLOSE: 0, SELECT_BY_POS: 0, MODE_TRADES: 0, clrNONE: -1, clrBlue: 0xff0000,
    get Bid() { return closes[bar] }, get Ask() { return closes[bar] + 0.0001 },
    High: Object.assign(new MqlArray(3, 1.5), { series: true }), Low: Object.assign(new MqlArray(3, 1.0), { series: true }),
    iMA: (_s: unknown, _tf: number, period: number) => period === 5 ? closes[bar] : 1.1,
    OrdersTotal: () => orders.length,
    OrderSelect: (i: number) => (sel = orders[i]) != null,
    OrderSymbol: () => 'EURUSD', OrderMagicNumber: () => sel!.magic, OrderType: () => sel!.type, OrderTicket: () => sel!.ticket, OrderLots: () => sel!.lots,
    OrderOpenPrice: () => sel!.price, OrderStopLoss: () => 0, OrderTakeProfit: () => 0, OrderModify: () => true,
    OrderSend: (_s: string, type: number, lots: number, price: number, _sl: number, _sl2: number, _tp: number, _c: string, magic: number) => { orders.push({ ticket: nextTicket, type, lots, price, magic }); return nextTicket++ },
    OrderClose: (t: number) => { const k = orders.findIndex(o => o.ticket === t); if (k >= 0) orders.splice(k, 1); return k >= 0 },
    GetLastError: () => 0, NormalizeDouble: (x: number, d: number) => +x.toFixed(d), AccountBalance: () => 10000,
  };
  const b = build(EA4, 'ma.mq4', {}, rt);
  assert.equal(b.r.dialect, 'mql4');
  assert.deepEqual(Object.keys(b.p.handlers).sort(), ['deinit', 'init', 'start']);
  assert.equal(b.p.inputs.length, 8);
  (b.p.handlers.init as AnyFn)();
  for (bar = 0; bar < closes.length; bar++) (b.p.handlers.start as AnyFn)();
  (b.p.handlers.deinit as AnyFn)();
  assert.equal(b.out[0], 'init EURUSD digits=5');
  assert.equal(b.out[b.out.length - 1], `deinit after ${closes.length} ticks`);
  assert.ok(nextTicket >= 3, `orders sent: ${nextTicket - 1}`);
  assert.equal(orders.length, 1);
  assert.equal(orders[0].type, 0);   // final cross is up
});

const EA5 = `#property strict
#include <Trade\\Trade.mqh>
#include <Trade/PositionInfo.mqh>

enum ENTRY_MODE { MODE_CROSS = 0, MODE_TREND = 1 };

input group "Signals"
input int        FastPeriod = 3;     // fast EMA
input int        SlowPeriod = 6;     // slow EMA
input ENTRY_MODE Entry      = MODE_CROSS;
input group "Money"
input double     Risk       = 1.0;
input ulong      Magic      = 555;

CTrade        trade;
CPositionInfo pos;

struct Signal
{
   int    dir;
   double strength;
   string Name() { return dir > 0 ? "BUY" : dir < 0 ? "SELL" : "FLAT"; }
};

class CEma
{
private:
   int    m_period;
   double m_value;
   bool   m_ready;
public:
   CEma(int period) : m_period(period), m_value(0), m_ready(false) {}
   double Update(double price)
   {
      double k = 2.0 / (m_period + 1);
      m_value = m_ready ? price * k + m_value * (1 - k) : price;
      m_ready = true;
      return m_value;
   }
   double Value() const { return m_value; }
};

CEma *fast, *slow;
int  trades = 0;

int OnInit()
{
   if(FastPeriod >= SlowPeriod) return INIT_PARAMETERS_INCORRECT;
   fast = new CEma(FastPeriod);
   slow = new CEma(SlowPeriod);
   trade.SetExpertMagicNumber(Magic);
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   delete fast;
   delete slow;
   PrintFormat("deinit %d trades=%d", reason, trades);
}

bool GetSignal(Signal &s)
{
   MqlTick tick;
   if(!SymbolInfoTick(_Symbol, tick)) return false;
   double pf = fast.Value(), ps = slow.Value();
   double f = fast.Update(tick.bid), sl = slow.Update(tick.bid);
   s.dir = 0;
   if(Entry == MODE_CROSS)
   {
      if(pf <= ps && f > sl) s.dir = 1;
      else if(pf >= ps && f < sl) s.dir = -1;
   }
   else s.dir = f > sl ? 1 : -1;
   s.strength = MathAbs(f - sl);
   return true;
}

double Volume()
{
   double v = NormalizeDouble(Risk * 0.1, 2);
   return v < 0.01 ? 0.01 : v;
}

void OnTick()
{
   Signal s;
   if(!GetSignal(s) || s.dir == 0) return;
   bool has = pos.Select(_Symbol);
   if(has && ((s.dir > 0 && pos.PositionType() == POSITION_TYPE_SELL) || (s.dir < 0 && pos.PositionType() == POSITION_TYPE_BUY)))
   {
      trade.PositionClose(_Symbol);
      has = false;
   }
   if(has) return;
   bool ok = s.dir > 0 ? trade.Buy(Volume(), _Symbol) : trade.Sell(Volume(), _Symbol);
   if(ok) { trades++; Print(s.Name(), " ", DoubleToString(s.strength, 4)); }
}
`;

test('realistic MQL5 EA with CTrade/CPositionInfo from rt', () => {
  const prices = [1, 1, 1, 1.2, 1.4, 1.5, 1.3, 1.0, 0.8, 0.7, 0.9, 1.2, 1.5];
  let k = 0, position: { type: number } | null = null;
  const log: string[] = [];
  class CTrade {
    magic = 0;
    SetExpertMagicNumber(m: number) { this.magic = m }
    Buy(v: number) { position = { type: 0 }; log.push(`buy ${v} ${this.magic}`); return true }
    Sell(v: number) { position = { type: 1 }; log.push(`sell ${v}`); return true }
    PositionClose() { position = null; log.push('close'); return true }
  }
  class CPositionInfo { Select() { return position != null } PositionType() { return position!.type } }
  const b = build(EA5, 'ea.mq5', {}, {
    CTrade, CPositionInfo, _Symbol: 'EURUSD', INIT_PARAMETERS_INCORRECT: 32767, POSITION_TYPE_BUY: 0, POSITION_TYPE_SELL: 1,
    SymbolInfoTick: (_s: string, t: MqlTick) => { t.bid = prices[k]; return true },
    MathAbs: Math.abs, NormalizeDouble: (x: number, d: number) => +x.toFixed(d),
    PrintFormat: (f: string, ...a: unknown[]) => { let n = 0; log.push(f.replace(/%d/g, () => String(a[n++]))) },
  });
  assert.deepEqual(b.p.inputs.map(i => [i.name, i.group]), [['FastPeriod', 'Signals'], ['SlowPeriod', 'Signals'], ['Entry', 'Signals'], ['Risk', 'Money'], ['Magic', 'Money']]);
  assert.deepEqual(b.p.inputs[2].options, [{ name: 'MODE_CROSS', value: 0 }, { name: 'MODE_TREND', value: 1 }]);
  assert.equal((b.p.handlers.OnInit as AnyFn)(), 0);
  for (k = 0; k < prices.length; k++) (b.p.handlers.OnTick as AnyFn)();
  (b.p.handlers.OnDeinit as AnyFn)(1);
  assert.equal(log[0], 'buy 0.1 555');
  assert.ok(log.includes('close') && log.some(l => l.startsWith('sell')), log.join('|'));
  assert.match(log[log.length - 1], /^deinit 1 trades=\d+$/);
  assert.ok(b.out.length >= 2 && /^(BUY|SELL) \d\.\d{4}$/.test(b.out[0]), b.out.join('|'));

  const bad = build(EA5, 'ea.mq5', {}, { CTrade, CPositionInfo, INIT_PARAMETERS_INCORRECT: 32767 });
  bad.p.setInput('FastPeriod', 10);
  assert.equal((bad.p.handlers.OnInit as AnyFn)(), 32767);
});

test('MQL5 indicator with OnCalculate and SetIndexBuffer', () => {
  const bound = new Map<number, MqlArray>();
  const b = build(`
    #property indicator_chart_window
    #property indicator_buffers 1
    #property indicator_plots   1
    #property indicator_type1   DRAW_LINE
    #property indicator_color1  clrRed
    #property indicator_label1  "SMA"
    input int Period = 3;
    double Buf[];
    int OnInit() { SetIndexBuffer(0, Buf, INDICATOR_DATA); return INIT_SUCCEEDED; }
    int OnCalculate(const int rates_total, const int prev_calculated, const int begin, const double &price[])
    {
      for (int i = MathMax(prev_calculated - 1, 0); i < rates_total; i++) {
        if (i < Period - 1) { Buf[i] = EMPTY_VALUE; continue; }
        double s = 0;
        for (int j = 0; j < Period; j++) s += price[i - j];
        Buf[i] = s / Period;
      }
      return rates_total;
    }`, 'ind.mq5', {}, { DRAW_LINE: 1, INDICATOR_DATA: 0, EMPTY_VALUE: -1, MathMax: Math.max, SetIndexBuffer: (i: number, a: MqlArray) => { bound.set(i, a); return true } });
  assert.deepEqual(b.p.props, { indicator_chart_window: true, indicator_buffers: 1, indicator_plots: 1, indicator_type1: 1, indicator_color1: 255, indicator_label1: 'SMA' });
  const oc = b.p.handlers.OnCalculate as AnyFn;
  assert.equal(oc.length, 4);
  (b.p.handlers.OnInit as AnyFn)();
  const buf = bound.get(0)!;
  buf.resize(5);
  const price = new MqlArray(5); price.data = [1, 2, 3, 4, 5];
  assert.equal(oc(5, 0, 0, price), 5);
  assert.deepEqual(buf.data, [-1, -1, 2, 3, 4]);
});

test('MQL4 predefined series and variables resolve to rt', () => {
  const close = new MqlArray(3); close.data = [1, 2, 3]; close.series = true;
  const b = build('void OnStart() { Print(Close[0], " ", Bars / 2, " ", Ask); }', 's.mq4', {}, { Close: close, Bars: 5, Ask: 1.25 });
  (b.p.handlers.OnStart as AnyFn)();
  assert.deepEqual(b.out, ['3 2 1.25']);
});

test('errors are reported with file and line', () => {
  fails('void OnStart()\n{\n  int x = 1\n  Print(x);\n}', /Expected ';'/, 4);
  fails('struct S { int a; };\nvoid OnStart() {\n  S s;\n  s.b = 1;\n}', /'b' is not a member of 'S'/, 4);
  fails('int f(int a, int b) { return a + b; }\nvoid OnStart() {\n  f(1);\n}', /'f' expects 2 argument\(s\) but got 1/, 3);
  fails('void OnStart() {\n  int x;\n  int x;\n}', /already declared/, 3);
  fails('class A {};\nint operator+(A &a, A &b) { return 0; }', /only be overloaded inside a class/, 2);
  fails('void OnStart() {\n  string s = "abc;\n}', /Unterminated string/, 2);
  fails('void f() { return 1; }', /cannot return a value/, 1);
  fails('#include "Lib.mqh"\nvoid OnStart() { }', /Expected/, 2, 'main.mq5', { 'Lib.mqh': 'int g() {\n  return 1 +;\n}' });
  const r = compile('main.mq5', { 'main.mq5': '#include "Lib.mqh"\n', 'Lib.mqh': 'int g() {\n  return 1 +;\n}' }, OPTS);
  assert.equal(r.errors[0].file, 'Lib.mqh');
  assert.equal(r.errors[0].line, 2);
  fails('#ifdef X\nint a;\n', /missing #endif/, 1);
});
