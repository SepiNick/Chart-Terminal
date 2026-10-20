import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileMql, runMql } from './engine.ts';
import { MtBroker } from './trade/index.ts';
import type { Env } from './contract.ts';

let seed = 5;
const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
const bars = Array.from({ length: 300 }, (_, i) => {
  const o = 1.1 + Math.sin(i / 15) * 0.01 + rnd() * 0.002, c = o + (rnd() - 0.5) * 0.004;
  return { time: 1_700_006_400 + i * 3600, open: o, high: Math.max(o, c) + rnd() * 0.001, low: Math.min(o, c) - rnd() * 0.001, close: c, volume: 100 + Math.floor(rnd() * 50) };
});
const opts = (dialect: 'mql4' | 'mql5') => ({ dialect, symbol: 'EURUSD', tfSec: 3600, digits: 5, spreadPoints: 10, account: { contractSize: 100000, minLot: 0.01, lotStep: 0.01 } });
const build = (name: string, files: Record<string, string>) => {
  const r = compileMql(name, files);
  assert.ok(r.ok, `${name}: ${r.errors.map(e => `${e.file}(${e.line},${e.col}) ${e.msg}`).join('; ')}`);
  return r.js!;
};
const prints = (r: ReturnType<typeof runMql>) => r.logs.filter(l => l.level === 'print').map(l => l.msg);

const MOM4 = `
#property indicator_separate_window
#property indicator_buffers 1
extern int Len = 10;
double Mom[];
int init() { SetIndexBuffer(0, Mom); return(0); }
int start() {
   int limit = Bars - IndicatorCounted() - 1;
   for(int i = limit; i >= 0; i--) { if(i + Len >= Bars) continue; Mom[i] = Close[i] - Close[i + Len]; }
   return(0);
}`;

test('MQL4 iCustom runs another installed indicator file with inputs, buffer and shift', () => {
  const user = `
#property indicator_separate_window
#property indicator_buffers 1
double B[];
int init() { SetIndexBuffer(0, B); return(0); }
int start() { for(int i = Bars - 1; i >= 0; i--) B[i] = iCustom(NULL, 0, "Mom4", 5, 0, i); return(0); }`;
  const js = build('UseMom.mq4', { 'UseMom.mq4': user, 'Mom4.mq4': MOM4 });
  const run = runMql(js, bars, opts('mql4'));
  assert.equal(run.error, undefined, run.error);
  const v = run.out.plots[0].values;
  for (const i of [20, 150, 299]) assert.ok(Math.abs(v[i] - (bars[i].close - bars[i - 5].close)) < 1e-12, `bar ${i}: ${v[i]}`);
  // an unknown name warns and returns 0
  const js2 = build('Bad.mq4', { 'Bad.mq4': user.replace('"Mom4"', '"Nope"') });
  const r2 = runMql(js2, bars, opts('mql4'));
  assert.ok(r2.logs.some(l => /Nope/.test(l.msg)));
});

test('MQL5 iCustom handle + CopyBuffer is incremental: the forming bar only sees ticks so far', () => {
  const ind = `
#property indicator_chart_window
#property indicator_buffers 1
#property indicator_plots 1
double Buf[];
int OnInit() { SetIndexBuffer(0, Buf, INDICATOR_DATA); return INIT_SUCCEEDED; }
int OnCalculate(const int total, const int prev, const datetime &time[], const double &open[], const double &high[], const double &low[], const double &close[], const long &tv[], const long &v[], const int &sp[])
{ for(int i = MathMax(prev - 1, 0); i < total; i++) Buf[i] = close[i]; return total; }`;
  const ea = `
int h; int bad = 0, n = 0;
int OnInit() { h = iCustom(_Symbol, PERIOD_CURRENT, "Examples\\\\Echo"); return h == INVALID_HANDLE ? INIT_FAILED : INIT_SUCCEEDED; }
void OnTick() { double b[]; if(CopyBuffer(h, 0, 0, 1, b) == 1) { n++; if(MathAbs(b[0] - SymbolInfoDouble(_Symbol, SYMBOL_BID)) > 1e-12) bad++; } }
void OnDeinit(const int r) { Print("n=", n, " bad=", bad); }`;
  const js = build('EchoUser.mq5', { 'EchoUser.mq5': ea, 'Echo.mq5': ind });
  const run = runMql(js, bars.slice(0, 50), opts('mql5'));
  assert.equal(run.error, undefined, run.error);
  assert.deepEqual(prints(run), ['n=200 bad=0']);
});

test('sandboxed file functions: CSV write/read, seek, size, exist, delete', () => {
  const src = `
void OnStart() {
   int h = FileOpen("data\\\\out.csv", FILE_WRITE | FILE_CSV, ';');
   FileWrite(h, "a", 1.5, 7); FileWrite(h, "b", 2.25, 8); FileClose(h);
   Print("exists ", FileIsExist("data/out.csv"));
   h = FileOpen("data\\\\out.csv", FILE_READ | FILE_CSV, ';');
   Print("size ", FileSize(h));
   double sum = 0; string names = "";
   while(!FileIsEnding(h)) { names += FileReadString(h); sum += FileReadNumber(h); sum += FileReadNumber(h); }
   Print(names, " ", sum);
   FileSeek(h, 0, SEEK_SET); Print("first ", FileReadString(h));
   FileClose(h);
   h = FileOpen("log.txt", FILE_READ | FILE_WRITE | FILE_TXT); FileSeek(h, 0, SEEK_END); FileWriteString(h, "line1\\r\\n"); FileClose(h);
   h = FileOpen("log.txt", FILE_READ | FILE_TXT); Print("txt ", FileReadString(h)); FileClose(h);
   Print("missing ", FileOpen("nope.txt", FILE_READ));
   Print("del ", FileDelete("log.txt"), " ", FileIsExist("log.txt"));
}`;
  const run = runMql(build('Files.mq5', { 'Files.mq5': src }), bars, opts('mql5'));
  assert.equal(run.error, undefined, run.error);
  assert.deepEqual(prints(run), ['exists true', 'size 19', 'ab 18.75', 'first a', 'txt line1', 'missing -1', 'del true false']);
  assert.equal(run.files.get('data/out.csv'), 'a;1.5;7\r\nb;2.25;8\r\n');
});

test('OnTradeTransaction and OnTrade are called for orders, deals, SL/TP changes and requests', () => {
  const src = `
#include <Trade\\Trade.mqh>
CTrade t; int trades = 0; string seen = "";
void OnTick() {
   if(PositionsTotal() == 0 && trades == 0) t.Buy(0.1);
   else if(PositionsTotal() == 1 && trades < 20) { PositionSelect(_Symbol); t.PositionModify(_Symbol, PositionGetDouble(POSITION_PRICE_OPEN) - 0.01, 0); }
}
void OnTrade() { trades++; }
void OnTradeTransaction(const MqlTradeTransaction &tr, const MqlTradeRequest &rq, const MqlTradeResult &rs) {
   if(StringLen(seen) < 40) seen += IntegerToString(tr.type) + (tr.type == TRADE_TRANSACTION_REQUEST ? "r" + IntegerToString(rs.retcode) + "," : ",");
}
void OnDeinit(const int r) { Print(seen); Print(trades > 0); }`;
  const run = runMql(build('Tx.mq5', { 'Tx.mq5': src }), bars.slice(0, 30), opts('mql5'));
  assert.equal(run.error, undefined, run.error);
  // ORDER_ADD, DEAL_ADD, ORDER_DELETE, HISTORY_ADD, REQUEST(done); then POSITION + REQUEST for the SL change
  assert.ok(prints(run)[0].startsWith('0,6,2,3,10r10009,9,10r10009,'), prints(run)[0]);
  assert.equal(prints(run)[1], 'true');
});

test('operator overloading in structs and classes: + - == != [] = += unary', () => {
  const src = `
struct Vec {
   double x, y;
   Vec operator+(const Vec &o) { Vec r; r.x = x + o.x; r.y = y + o.y; return r; }
   Vec operator-() { Vec r; r.x = -x; r.y = -y; return r; }
   bool operator==(const Vec &o) { return x == o.x && y == o.y; }
   double operator[](int i) { return i == 0 ? x : y; }
   void operator+=(double k) { x += k; y += k; }
};
class Acc { public: int n; Acc() { n = 0; } void operator=(int v) { n = v * 10; } Acc *operator<<(int v); };
Acc *Acc::operator<<(int v) { n += v; return GetPointer(this); }
void OnStart() {
   Vec a, b; a.x = 1; a.y = 2; b.x = 3; b.y = 4;
   Vec c = a + b;
   Vec d = -c;
   Print(c.x, " ", c.y, " ", d[0], " ", d[1], " ", c == a, " ", c != a);
   c += 0.5; Print(c[0]);
   Acc k; k = 4; k << 2 << 3; Print(k.n);
}`;
  const run = runMql(build('Ops.mq5', { 'Ops.mq5': src }), bars, opts('mql5'));
  assert.equal(run.error, undefined, run.error);
  assert.deepEqual(prints(run), ['4 6 -4 -6 false true', '4.5', '45']);
});

test('daily swap: per-night charge, triple on Wednesday night, none for weekend nights, realized on close', () => {
  const env = { dialect: 'mql5', symbol: 'EURUSD', point: 0.00001, digits: 5, tfSec: 3600,
    account: { balance: 10000, leverage: 100, hedging: true, currency: 'USD', contractSize: 100000, commissionPerLot: 0, minLot: 0.01, lotStep: 0.01, maxLot: 100, stopLevelPoints: 0, swapLong: -10, swapShort: 5 } } as unknown as Env;
  const b = new MtBroker(env), mon = 1699833600 + 12 * 3600, day = 86400;   // Monday 2023-11-13 12:00 UTC
  b.onTick(1.1, 1.1, mon);
  b.send({ action: 1, type: 0, volume: 1, symbol: 'EURUSD' });
  const sw = () => b.positions[0].swap;
  b.onTick(1.1, 1.1, mon + day); assert.equal(sw(), -10);
  b.onTick(1.1, 1.1, mon + 2 * day); assert.equal(sw(), -20);
  b.onTick(1.1, 1.1, mon + 3 * day); assert.equal(sw(), -50);    // Wednesday night ×3
  b.onTick(1.1, 1.1, mon + 4 * day); assert.equal(sw(), -60);
  b.onTick(1.1, 1.1, mon + 7 * day); assert.equal(sw(), -70);    // Friday night only
  assert.equal(b.equity(), 10000 - 70);
  b.send({ action: 1, type: 1, volume: 1, symbol: 'EURUSD', position: b.positions[0].ticket });
  assert.equal(b.deals.at(-1)!.swap, -70);
  assert.equal(b.balance(), 10000 - 70);
});

test('iAD, iChaikin, iBWMFI, iGator: MQL4 values and MQL5 handles', () => {
  const ad: number[] = [];
  bars.forEach((x, i) => ad.push((i ? ad[i - 1] : 0) + (x.high > x.low ? ((x.close - x.low) - (x.high - x.close)) / (x.high - x.low) * x.volume : 0)));
  const ema = (a: number[], n: number) => { const k = 2 / (n + 1), o: number[] = []; a.forEach((v, i) => o.push(i ? v * k + o[i - 1] * (1 - k) : v)); return o };
  const f3 = ema(ad, 3), s10 = ema(ad, 10), i = 200, sh = bars.length - 1 - i;
  const src4 = `
void OnStart() {
   int s = ${sh};
   Print(iAD(NULL, 0, s)); Print(iChaikin(NULL, 0, 3, 10, MODE_EMA, s)); Print(iBWMFI(NULL, 0, s));
   double up = iGator(NULL, 0, 13, 8, 8, 5, 5, 3, MODE_SMMA, PRICE_MEDIAN, MODE_UPPER, s);
   double jaw = iAlligator(NULL, 0, 13, 8, 8, 5, 5, 3, MODE_SMMA, PRICE_MEDIAN, MODE_GATORJAW, s), teeth = iAlligator(NULL, 0, 13, 8, 8, 5, 5, 3, MODE_SMMA, PRICE_MEDIAN, MODE_GATORTEETH, s);
   double lo = iGator(NULL, 0, 13, 8, 8, 5, 5, 3, MODE_SMMA, PRICE_MEDIAN, MODE_LOWER, s);
   double lips = iAlligator(NULL, 0, 13, 8, 8, 5, 5, 3, MODE_SMMA, PRICE_MEDIAN, MODE_GATORLIPS, s);
   Print(MathAbs(up - MathAbs(jaw - teeth)) < 1e-12, " ", MathAbs(lo + MathAbs(teeth - lips)) < 1e-12, " ", up > 0);
}`;
  const p = prints(runMql(build('Ind.mq4', { 'Ind.mq4': src4 }), bars, opts('mql4')));
  const near = (s: string, v: number) => assert.ok(Math.abs(Number(s) - v) < 1e-6 * Math.max(1, Math.abs(v)), `${s} vs ${v}`);
  near(p[0], ad[i]); near(p[1], f3[i] - s10[i]); near(p[2], (bars[i].high - bars[i].low) / bars[i].volume);
  assert.equal(p[3], 'true true true');
  const src5 = `
void OnStart() {
   double a[], g[], m[];
   int ha = iAD(_Symbol, PERIOD_CURRENT, VOLUME_TICK), hg = iGator(_Symbol, PERIOD_CURRENT, 13, 8, 8, 5, 5, 3, MODE_SMMA, PRICE_MEDIAN), hm = iBWMFI(_Symbol, PERIOD_CURRENT, VOLUME_TICK);
   Print(CopyBuffer(ha, 0, ${sh}, 1, a), " ", a[0]);
   Print(CopyBuffer(hg, 3, ${sh}, 2, g), " ", CopyBuffer(hm, 1, ${sh}, 1, m), " ", m[0] >= 0 && m[0] <= 3);
   int hc = IndicatorCreate(_Symbol, PERIOD_CURRENT, IND_CHAIKIN, 0); Print(hc != INVALID_HANDLE);
}`;
  const q = prints(runMql(build('Ind.mq5', { 'Ind.mq5': src5 }), bars, opts('mql5')));
  assert.equal(q[0].split(' ')[0], '1'); near(q[0].split(' ')[1], ad[i]);
  assert.equal(q[1], '2 1 true');
  assert.equal(q[2], 'true');
});
