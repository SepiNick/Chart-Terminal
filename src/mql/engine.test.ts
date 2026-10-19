import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileMql, runMql } from './engine.ts';
import { NEW_MQL4_EA, NEW_MQL5_EA, NEW_MQL5_INDICATOR } from './templates.ts';
import { ema } from '../indicators.ts';

let seed = 11;
const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
const bars = Array.from({ length: 600 }, (_, i) => {
  const o = 1.1 + Math.sin(i / 20) * 0.01 + rnd() * 0.002, c = o + (rnd() - 0.5) * 0.004;
  return { time: 1_700_000_000 + i * 3600, open: o, high: Math.max(o, c) + rnd() * 0.001, low: Math.min(o, c) - rnd() * 0.001, close: c, volume: 100 + rnd() * 50 };
});
const opts = (dialect: 'mql4' | 'mql5') => ({ dialect, symbol: 'EURUSD', tfSec: 3600, digits: 5, spreadPoints: 10, account: { contractSize: 100000, minLot: 0.01, lotStep: 0.01 } });
const build = (name: string, src: string, extra: Record<string, string> = {}) => {
  const r = compileMql(name, { [name]: src, ...extra });
  assert.ok(r.ok, `${name}: ${r.errors.map(e => `${e.file}(${e.line},${e.col}) ${e.msg}`).join('; ')}`);
  return r;
};

test('MQL5 template expert trades through CTrade and iMA handles', () => {
  const r = build('MyExpert.mq5', NEW_MQL5_EA);
  const run = runMql(r.js!, bars, opts('mql5'));
  assert.equal(run.error, undefined, run.error);
  assert.equal(run.kind, 'expert');
  assert.ok(run.broker!.deals.length > 4, `deals: ${run.broker!.deals.length}`);
  assert.equal(run.equity.length, bars.length);
});

test('MQL4 template expert trades through OrderSend/OrderClose and iRSI', () => {
  const r = build('MyExpert4.mq4', NEW_MQL4_EA);
  const run = runMql(r.js!, bars, opts('mql4'));
  assert.equal(run.error, undefined, run.error);
  assert.equal(run.kind, 'expert');
  assert.ok(run.broker!.deals.length > 2, `deals: ${run.broker!.deals.length}`);
});

test('MQL5 template indicator fills buffers that match an EMA', () => {
  const r = build('MyIndicator.mq5', NEW_MQL5_INDICATOR);
  const run = runMql(r.js!, bars, opts('mql5'));
  assert.equal(run.error, undefined, run.error);
  assert.equal(run.kind, 'indicator');
  assert.equal(run.out.plots.length, 2);
  // template seeds with price[0], unlike indicators.ts which waits `length` bars: compare well after warm-up
  const ref = ema(bars.map(b => b.close), 9);
  const v = run.out.plots[0].values;
  assert.ok(Math.abs(v[500] - ref[500]!) < 1e-6, `${v[500]} vs ${ref[500]}`);
  assert.equal(run.out.plots[0].title, 'Fast');
});

test('MQL4 classic indicator with start(), IndicatorCounted and series buffers', () => {
  const src = `
#property indicator_separate_window
#property indicator_buffers 1
#property indicator_color1 Red
extern int Period_ = 10;
double Mom[];
int init() { SetIndexBuffer(0, Mom); SetIndexStyle(0, DRAW_LINE); IndicatorShortName("Mom(" + Period_ + ")"); return(0); }
int start()
{
   int counted = IndicatorCounted();
   int limit = Bars - counted - 1;
   for(int i = limit; i >= 0; i--)
   {
      if(i + Period_ >= Bars) continue;
      Mom[i] = Close[i] - Close[i + Period_];
   }
   return(0);
}`;
  const r = build('Mom.mq4', src);
  const run = runMql(r.js!, bars, opts('mql4'));
  assert.equal(run.error, undefined, run.error);
  assert.equal(run.kind, 'indicator');
  assert.equal(run.out.meta.overlay, false);
  const v = run.out.plots[0].values;
  assert.ok(Math.abs(v[300] - (bars[300].close - bars[290].close)) < 1e-12);
  assert.equal(run.out.meta.shorttitle, 'Mom(10)');
});

test('include files, classes, structs, enums and inputs work together', () => {
  const lib = `
enum Mode { ModeFast = 0, ModeSlow = 1 };
struct Signal { int dir; double price; };
class Counter { private: int n; public: Counter() { n = 0; } void Add() { n++; } int Get() { return n; } };
double Mid(double a, double b) { return (a + b) / 2; }`;
  const ea = `
#include "Utils.mqh"
input Mode   Speed = ModeSlow;
input int    Every = 50;
Counter c;
Signal last;
int OnInit() { return INIT_SUCCEEDED; }
void OnTick()
{
   c.Add();
   if(c.Get() % Every == 0) { last.dir = Speed == ModeFast ? 1 : -1; last.price = Mid(SymbolInfoDouble(_Symbol, SYMBOL_BID), SymbolInfoDouble(_Symbol, SYMBOL_ASK)); Print("tick ", c.Get(), " dir ", last.dir); }
}`;
  const r = build('Combo.mq5', ea, { 'Utils.mqh': lib });
  const run = runMql(r.js!, bars.slice(0, 120), { ...opts('mql5'), inputs: { Speed: 'ModeFast', Every: 100 } });
  assert.equal(run.error, undefined, run.error);
  const prints = run.logs.filter(l => l.level === 'print').map(l => l.msg);
  assert.ok(prints.some(m => /tick 100 dir 1/.test(m)), prints.join(' | '));
  assert.deepEqual(run.out.inputs.map(i => i.id), ['Speed', 'Every']);
  assert.deepEqual(run.out.inputs[0].options, ['ModeFast', 'ModeSlow']);
});

test('compile errors carry file and line', () => {
  const r = compileMql('Bad.mq5', { 'Bad.mq5': 'int OnInit() {\n  int x = ;\n  return 0;\n}' });
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].line, 2);
  assert.equal(r.errors[0].file, 'Bad.mq5');
});
