import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Bar } from '../../data.ts';
import { aggregate } from '../../data.ts';
import * as ind from '../../indicators.ts';
import { MqlArray, makeRef, type Dialect, type Env, type Rt } from '../contract.ts';
import { installStd, STD_OUT_PARAMS, STD_STRUCTS, STD_CLASSES, NATIVE_INCLUDES } from './index.ts';

let seed = 7;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const BARS: Bar[] = [];
for (let i = 0, p = 100; i < 300; i++) {
  const o = p; p = Math.max(1, p + (rnd() - 0.5) * 4);
  BARS.push({ time: 1700006400 + i * 3600, open: o, close: p, high: Math.max(o, p) + rnd(), low: Math.min(o, p) - rnd(), volume: 100 + Math.floor(rnd() * 1000) });
}
const close = BARS.map(b => b.close);

function mk(dialect: Dialect, bars: Bar[] = BARS.map(b => ({ ...b }))) {
  let cur = bars.length - 1;
  const logs: string[] = [];
  const env: Env = {
    dialect, bars, cur: () => cur, price: () => bars[cur].close, symbol: 'EURUSD', tfSec: 3600, digits: 5, point: 0.00001, spreadPoints: 10,
    now: () => bars[cur].time, barsFor: (_s, tf) => aggregate(bars, tf), log: (_l, m) => logs.push(m),
    objects: new Map(), buffers: new Map(), plots: new Map(), indicator: { levels: [] }, stop() {},
    account: { balance: 1e4, leverage: 100, hedging: true, currency: 'USD', contractSize: 100000, commissionPerLot: 0, minLot: 0.01, lotStep: 0.01, maxLot: 100, stopLevelPoints: 5 },
  };
  const rt: Rt = {};
  installStd(rt, env);
  const f = (n: string) => rt[n] as (...a: unknown[]) => any;   // eslint-disable-line
  return { rt, env, f, logs, bars, setCur: (i: number) => { cur = i } };
}
const near = (a: number, b: number | null, msg = '', tol = 1e-9) => assert.ok(b != null && Math.abs(a - b) < tol, `${msg}: ${a} vs ${b}`);
const lwma = (v: number[], n: number, i: number) => { let s = 0, w = 0; for (let k = 0; k < n; k++) { s += v[i - k] * (n - k); w += n - k } return s / w };

test('MQL4 indicators vs src/indicators.ts (incremental walk)', () => {
  const { f, setCur } = mk('mql4');
  const N = BARS.length - 1;
  for (let c = 0; c <= N; c++) { setCur(c); f('iMA')(null, 0, 14, 0, 1, 0, 0); f('iRSI')(null, 0, 14, 0, 0) }   // exercise the incremental cache
  const sma = ind.sma(close, 20), ema = ind.ema(close, 20), rma = ind.rma(close, 20), rsi = ind.rsi(close, 14), bb = ind.bb(close, 20, 2), m = ind.macd(close, 12, 26, 9);
  const sig = ind.sma(m.MACD, 9), atr = ind.sma(ind.trueRange(BARS), 14), st = ind.stoch(BARS, 5, 3);
  for (const s of [0, 1, 7, 60]) {
    const i = N - s;
    near(f('iMA')(null, 0, 20, 0, 0, 0, s), sma[i], `sma@${s}`);
    near(f('iMA')(null, 0, 20, 0, 1, 0, s), ema[i], `ema@${s}`);
    near(f('iMA')(null, 0, 20, 0, 2, 0, s), rma[i], `smma@${s}`);
    near(f('iMA')(null, 0, 20, 0, 3, 0, s), lwma(close, 20, i), `lwma@${s}`);
    near(f('iRSI')(null, 0, 14, 0, s), rsi[i], `rsi@${s}`);
    near(f('iMACD')(null, 0, 12, 26, 9, 0, 0, s), m.MACD[i], `macd@${s}`);
    near(f('iMACD')(null, 0, 12, 26, 9, 0, 1, s), sig[i], `signal@${s}`);
    near(f('iBands')(null, 0, 20, 2, 0, 0, 1, s), bb.Upper[i], `bbU@${s}`);
    near(f('iBands')(null, 0, 20, 2, 0, 0, 2, s), bb.Lower[i], `bbL@${s}`);
    near(f('iBands')(null, 0, 20, 2, 0, 0, 0, s), bb.Basis[i], `bbM@${s}`);
    near(f('iATR')(null, 0, 14, s), atr[i], `atr@${s}`);
    near(f('iStochastic')(null, 0, 5, 3, 1, 0, 0, 0, s), st['%K'][i], `stK@${s}`);
    near(f('iStochastic')(null, 0, 5, 3, 1, 0, 0, 1, s), st['%D'][i], `stD@${s}`);
  }
  // ma_shift moves the line right; insufficient data → 0
  near(f('iMA')(null, 0, 20, 3, 0, 0, 0), sma[N - 3], 'ma_shift');
  assert.equal(f('iMA')(null, 0, 20, 0, 0, 0, N - 5), 0);
  // OnArray (series-indexed buffer) matches the price version
  const a = new MqlArray<number>(0); a.data = close.slice(); a.series = true;
  near(f('iMAOnArray')(a, 0, 20, 0, 0, 3), sma[N - 3], 'iMAOnArray');
  near(f('iRSIOnArray')(a, 0, 14, 2), rsi[N - 2], 'iRSIOnArray');
  near(f('iBandsOnArray')(a, 0, 20, 2, 0, 1, 0), bb.Upper[N], 'iBandsOnArray');
  // smoke: every other indicator returns a finite number
  const calls: [string, unknown[]][] = [['iCCI', [14, 0]], ['iMomentum', [14, 0]], ['iADX', [14, 0, 0]], ['iEnvelopes', [14, 0, 0, 0, 0.1, 1]], ['iSAR', [0.02, 0.2]], ['iStdDev', [20, 0, 0, 0]],
    ['iWPR', [14]], ['iDeMarker', [14]], ['iForce', [13, 0, 0]], ['iOsMA', [12, 26, 9, 0]], ['iOBV', [0]], ['iMFI', [14]], ['iBullsPower', [13, 0]], ['iBearsPower', [13, 0]],
    ['iAO', []], ['iAC', []], ['iAlligator', [13, 8, 8, 5, 5, 3, 2, 4, 1]], ['iIchimoku', [9, 26, 52, 1]], ['iRVI', [10, 0]]];
  for (const [n, p] of calls) { const v = f(n)(null, 0, ...p, 1); assert.ok(Number.isFinite(v) && v !== 0, `${n} -> ${v}`) }
  near(f('iStdDev')(null, 0, 20, 0, 0, 0, 0), ind.stdev(close, 20)[N], 'stddev');
});

test('MQL5 handles + CopyBuffer ordering', () => {
  const { f, rt } = mk('mql5');
  const N = BARS.length - 1, sma = ind.sma(close, 10);
  const h = f('iMA')('EURUSD', 0, 10, 0, rt.MODE_SMA, rt.PRICE_CLOSE);
  assert.ok(h > 0);
  assert.equal(f('iMA')('EURUSD', 0, 10, 0, rt.MODE_SMA, rt.PRICE_CLOSE), h, 'same params → same handle');
  const a = new MqlArray<number>(0);
  assert.equal(f('CopyBuffer')(h, 0, 0, 5, a), 5);
  near(a.get(4), sma[N], 'non-series last = newest'); near(a.get(0), sma[N - 4], 'non-series first = oldest');
  f('ArraySetAsSeries')(a, true);
  assert.equal(f('CopyBuffer')(h, 0, 2, 3, a), 3);
  near(a.get(0), sma[N - 2], 'series [0] = start_pos'); near(a.get(2), sma[N - 4], 'series [2]');
  assert.equal(f('BarsCalculated')(h), N + 1);
  assert.equal(f('CopyBuffer')(h, 5, 0, 1, a), -1, 'bad buffer');
  assert.equal(f('CopyBuffer')(f('iMACD')(null, 0, 12, 26, 9, rt.PRICE_CLOSE), 1, 0, 1, a), 1);
  near(a.get(0), ind.sma(ind.macd(close).MACD, 9)[N], 'macd signal buffer');
  const b = new MqlArray<number>(0);
  assert.equal(f('CopyBuffer')(h, 0, 0, 1000, b), N + 1, 'clipped to available bars');
  assert.equal(b.get(0), rt.EMPTY_VALUE, 'pre-period value is EMPTY_VALUE');
  assert.equal(f('iCustom')(null, 0, 'X'), rt.INVALID_HANDLE);
  const st = f('iBands')(null, 0, 20, 0, 2, rt.PRICE_CLOSE);
  f('CopyBuffer')(st, rt.UPPER_BAND, 0, 1, a); near(a.get(0), ind.bb(close).Upper[N], 'bands upper');
});

test('no lookahead: future bars and the forming bar', () => {
  const { f, env, bars, setCur } = mk('mql4');
  const c = 150; setCur(c);
  const ma0 = f('iMA')(null, 0, 10, 0, 1, 0, 0), ma1 = f('iMA')(null, 0, 10, 0, 1, 0, 1), rsi1 = f('iRSI')(null, 0, 14, 0, 1);
  assert.equal(env.bars.length, 300); assert.equal(f('iBars')(null, 0), c + 1); assert.equal((env as unknown as { bars: Bar[] }).bars.length, 300);
  for (let i = c + 1; i < bars.length; i++) { bars[i].close *= 3; bars[i].high *= 3 }   // scramble the future
  near(f('iMA')(null, 0, 10, 0, 1, 0, 0), ma0, 'future does not leak');
  bars[c].close += 5;                                                                     // forming bar ticks
  assert.equal(f('iClose')(null, 0, 0), bars[c].close);
  assert.ok(Math.abs(f('iMA')(null, 0, 10, 0, 1, 0, 0) - ma0) > 0.1, 'shift 0 tracks the forming bar');
  near(f('iMA')(null, 0, 10, 0, 1, 0, 1), ma1, 'closed history cached'); near(f('iRSI')(null, 0, 14, 0, 1), rsi1, 'rsi closed');
  const a = new MqlArray<number>(0);
  assert.equal(f('CopyClose')(null, 0, 0, 1000, a), c + 1);
  assert.equal(a.get(c), bars[c].close);
  // MQL4 predefined series and Bars are relative to cur
  const r = mk('mql4').rt; void r;
  const m = mk('mql4'); m.setCur(10);
  assert.equal(m.rt.Bars, 11); assert.equal((m.rt.Close as MqlArray<number>).get(0), m.bars[10].close); assert.equal((m.rt.Close as MqlArray<number>).get(10), m.bars[0].close);
  assert.equal((m.rt.Close as MqlArray<number>).size, 11);
  // higher timeframe: the current H4 bar is rebuilt from chart bars up to cur
  const h = mk('mql4'); h.setCur(201);
  const h4 = h.f('iClose')(null, 240, 0);
  assert.equal(h4, h.bars[201].close);
  const t0 = h.f('iTime')(null, 240, 0); assert.ok(t0 <= h.bars[201].time && t0 % 14400 === 0);
  const hi = h.f('iHigh')(null, 240, 0), exp = Math.max(...h.bars.filter((b, i) => i <= 201 && b.time >= t0).map(b => b.high));
  assert.equal(hi, exp);
});

test('StringFormat / conversions', () => {
  const { f } = mk('mql5');
  const F = f('StringFormat');
  assert.equal(F('%d|%5d|%-5d|%05d|%+d', 42, 42, 42, 42, 42), '42|   42|42   |00042|+42');
  assert.equal(F('%.2f|%8.3f|%f', 3.14159, 2.5, 1), '3.14|   2.500|1.000000');
  assert.equal(F('%e|%.2E', 12345.678, 0.000123), '1.234568e+04|1.23E-04');
  assert.equal(F('%g|%g|%g', 0.0001, 123456789, 100), '0.0001|1.23457e+08|100');
  assert.equal(F('%s=%s|%c|%x|%X|%o|%%|%u', 'a', 1.5, 65, 255, 255, 8, -1), 'a=1.5|A|ff|FF|10|%|4294967295');
  assert.equal(F('%.3s|%10s|', 'abcdef', 'hi'), 'abc|        hi|');
  assert.equal(f('DoubleToString')(1.23456789, 3), '1.235');
  assert.equal(f('DoubleToString')(2.5), '2.50000000');
  assert.equal(f('NormalizeDouble')(1.23456, 2), 1.23);
  assert.equal(f('NormalizeDouble')(-1.005, 2), -1.01);
  assert.equal(f('IntegerToString')(7, 3, 48), '007');
  assert.equal(f('StringToDouble')('3.5abc'), 3.5);
  assert.equal(f('StringToInteger')(' 12x'), 12);
  assert.equal(f('ColorToString')(0x0000ff), '255,0,0');
  assert.equal(f('ColorToString')(0x0000ff, true), 'clrRed');
  assert.equal(f('StringToColor')('clrBlue'), 0xff0000);
  const s = makeRef('a-b-c');
  assert.equal(f('StringReplace')(s, '-', '+'), 2); assert.equal(s.v, 'a+b+c');
  const t = makeRef('  x '); assert.equal(f('StringTrimLeft')(t), 2); assert.equal(t.v, 'x ');
  assert.equal(mk('mql4').f('StringTrimRight')('  x '), '  x');
  const parts = new MqlArray<string>(0, '');
  assert.equal(f('StringSplit')('a,b,,c', 44, parts), 4); assert.equal(parts.get(3), 'c');
  const ch = new MqlArray<number>(0);
  assert.equal(f('StringToCharArray')('AB', ch), 3); assert.equal(f('CharArrayToString')(ch), 'AB');
  assert.equal(f('StringSubstr')('hello', 1, 3), 'ell'); assert.equal(f('StringFind')('hello', 'l'), 2);
  assert.equal(f('MathRound')(-2.5), -3); assert.equal(f('MathMod')(7, 3), 1);
  f('MathSrand')(1); const r1 = f('MathRand')(); f('MathSrand')(1); assert.equal(f('MathRand')(), r1); assert.ok(r1 >= 0 && r1 <= 32767);
});

test('time', () => {
  const { f, rt } = mk('mql4');
  const t = Date.UTC(2024, 0, 5, 9, 7, 3) / 1000;
  assert.equal(f('TimeToString')(t), '2024.01.05 09:07');
  assert.equal(f('TimeToString')(t, rt.TIME_DATE), '2024.01.05');
  assert.equal(f('TimeToString')(t, (rt.TIME_DATE as number) | (rt.TIME_SECONDS as number)), '2024.01.05 09:07:03');
  assert.equal(f('StringToTime')('2024.01.05 09:07:03'), t);
  assert.equal(f('StrToTime')('2024.01.05'), Date.UTC(2024, 0, 5) / 1000);
  const dt = new (rt.MqlDateTime as new () => Record<string, number>)();
  f('TimeToStruct')(t, dt);
  assert.deepEqual([dt.year, dt.mon, dt.day, dt.hour, dt.min, dt.sec, dt.day_of_week, dt.day_of_year], [2024, 1, 5, 9, 7, 3, 5, 4]);
  assert.equal(f('StructToTime')(dt), t);
  assert.equal(f('TimeDayOfWeek')(t), 5); assert.equal(f('TimeDayOfYear')(t), 5);
  assert.equal(f('Period')(), 60); assert.equal(mk('mql5').f('Period')(), 16385);
  assert.equal(mk('mql5').f('PeriodSeconds')(16408), 86400);
  assert.equal(rt._Symbol, 'EURUSD');
});

test('arrays', () => {
  const { f, rt } = mk('mql5');
  const a = new MqlArray<number>(0); f('ArrayResize')(a, 5);
  [5, 1, 4, 2, 3].forEach((v, i) => a.set(i, v));
  assert.equal(f('ArrayMaximum')(a), 0); assert.equal(f('ArrayMinimum')(a), 1);
  f('ArraySort')(a); assert.deepEqual(a.data, [1, 2, 3, 4, 5]);
  f('ArraySetAsSeries')(a, true); assert.equal(a.get(0), 5); assert.equal(f('ArrayGetAsSeries')(a), true);
  assert.equal(f('ArrayMaximum')(a), 0, 'series-aware index');
  assert.equal(f('ArrayBsearch')(new MqlArray(0), 1), -1);
  const b = new MqlArray<number>(0);
  assert.equal(f('ArrayCopy')(b, a, 0, 1, 2), 2); assert.deepEqual([b.get(0), b.get(1)], [4, 3]);
  assert.equal(f('ArraySize')(a), 5); assert.equal(f('ArrayInitialize')(b, 7), 2); assert.deepEqual(b.data, [7, 7]);
  const m4 = mk('mql4'), c = new MqlArray<number>(0); c.data = [3, 1, 2];
  m4.f('ArraySort')(c, m4.rt.WHOLE_ARRAY, 0, m4.rt.MODE_DESCEND); assert.deepEqual(c.data, [3, 2, 1]);
  assert.equal(rt.WHOLE_ARRAY, -1); assert.equal(m4.rt.WHOLE_ARRAY, 0);
  const d = new MqlArray<number>(0); d.data = [1, 2, 3, 4];
  f('ArrayRemove')(d, 1, 2); assert.deepEqual(d.data, [1, 4]);
  f('ArrayInsert')(d, b, 1); assert.deepEqual(d.data, [1, 7, 7, 4]);
  f('ArrayReverse')(d); assert.deepEqual(d.data, [4, 7, 7, 1]);
  // __copy: deep for structs/arrays
  const r1 = new (rt.MqlRates as new () => { close: number })(); r1.close = 1;
  const r2 = (rt.__copy as <T>(x: T) => T)(r1); r2.close = 2; assert.equal(r1.close, 1);
});

test('CopyClose / CopyRates ranges', () => {
  const { f, setCur, bars } = mk('mql5');
  setCur(99);
  const a = new MqlArray<number>(0);
  assert.equal(f('CopyClose')(null, 0, 0, 10, a), 10); assert.equal(a.get(9), bars[99].close); assert.equal(a.get(0), bars[90].close);
  assert.equal(f('CopyClose')(null, 0, 95, 10, a), 5, 'clipped at history start');
  assert.equal(f('CopyClose')(null, 0, bars[50].time, 3, a), 3); assert.equal(a.get(2), bars[50].close);
  assert.equal(f('CopyClose')(null, 0, bars[40].time, bars[45].time, a), 6); assert.equal(a.get(0), bars[40].close);
  assert.equal(f('CopyClose')(null, 0, bars[90].time, bars[200].time, a), 10, 'stop beyond cur is clipped');
  assert.equal(f('CopyClose')(null, 0, 500, 1, a), -1);
  const r = new MqlArray<{ close: number; time: number }>(0);
  assert.equal(f('CopyRates')(null, 0, 0, 2, r), 2); assert.equal(r.get(1).close, bars[99].close);
  assert.equal(f('iBarShift')(null, 0, bars[97].time + 10), 2);
  assert.equal(f('iHighest')(null, 0, 2, 5, 0), [0, 1, 2, 3, 4].reduce((b, s) => (bars[99 - s].high > bars[99 - b].high ? s : b), 0));
  assert.equal(f('Bars')(null, 0), 100);
});

test('indicator API, chart objects, info, constants', () => {
  const { f, rt, env } = mk('mql5');
  const buf = new MqlArray<number>(0);
  assert.equal(f('SetIndexBuffer')(0, buf, rt.INDICATOR_DATA), true);
  f('SetIndexBuffer')(1, new MqlArray<number>(0), rt.INDICATOR_COLOR_INDEX);
  assert.equal(env.buffers.get(0)!.arr, buf); assert.equal(env.buffers.get(1)!.kind, 'color');
  f('PlotIndexSetInteger')(0, rt.PLOT_DRAW_TYPE, rt.DRAW_COLOR_LINE);
  f('PlotIndexSetInteger')(0, rt.PLOT_LINE_COLOR, 1, rt.clrRed);
  f('PlotIndexSetInteger')(0, rt.PLOT_LINE_WIDTH, 2);
  f('PlotIndexSetString')(0, rt.PLOT_LABEL, 'MA');
  f('PlotIndexSetDouble')(0, rt.PLOT_EMPTY_VALUE, 0);
  const pp = env.plots.get(0)!; assert.deepEqual([pp.type, pp.color?.[1], pp.width, pp.label, pp.empty], [10, 0x0000ff, 2, 'MA', 0]);
  f('IndicatorSetString')(rt.INDICATOR_SHORTNAME, 'X'); f('IndicatorSetInteger')(rt.INDICATOR_DIGITS, 3);
  f('IndicatorSetInteger')(rt.INDICATOR_LEVELS, 2); f('IndicatorSetDouble')(rt.INDICATOR_LEVELVALUE, 1, 70);
  assert.equal(env.indicator.shortName, 'X'); assert.equal(env.indicator.digits, 3); assert.equal(env.indicator.levels[1].value, 70);
  const m4 = mk('mql4'), b4 = new MqlArray<number>(0);
  m4.f('SetIndexBuffer')(0, b4); assert.equal(b4.series, true, 'MQL4 buffers are series');
  m4.f('SetIndexStyle')(0, m4.rt.DRAW_HISTOGRAM, m4.rt.STYLE_DOT, 2, m4.rt.Red);
  assert.deepEqual(m4.env.plots.get(0), { type: 2, style: 2, width: 2, color: [0x0000ff] });
  m4.rt.__counted = 42; assert.equal(m4.f('IndicatorCounted')(), 42);

  // objects
  assert.equal(f('ObjectCreate')(0, 'tl', rt.OBJ_TREND, 0, 100, 1.1, 200, 1.2), true);
  assert.equal(f('ObjectCreate')(0, 'tl', rt.OBJ_TREND, 0, 100, 1.1), false, 'duplicate');
  f('ObjectSetInteger')(0, 'tl', rt.OBJPROP_COLOR, rt.clrBlue); f('ObjectSetInteger')(0, 'tl', rt.OBJPROP_RAY_RIGHT, true);
  f('ObjectSetDouble')(0, 'tl', rt.OBJPROP_PRICE, 1, 1.3); f('ObjectSetString')(0, 'tl', rt.OBJPROP_TEXT, 'hi');
  const o = env.objects.get('tl')!;
  assert.deepEqual([o.type, o.time, o.price, o.props.color, o.props.ray_right, o.props.text], [2, [100, 200], [1.1, 1.3], 0xff0000, true, 'hi']);
  assert.equal(f('ObjectGetInteger')(0, 'tl', rt.OBJPROP_COLOR), 0xff0000);
  const out = makeRef(0); assert.equal(f('ObjectGetDouble')(0, 'tl', rt.OBJPROP_PRICE, 1, out), true); assert.equal(out.v, 1.3);
  near(f('ObjectGetValueByTime')(0, 'tl', 150), 1.2, 'value by time');
  assert.equal(f('ObjectFind')(0, 'tl'), 0); assert.equal(f('ObjectsTotal')(0), 1); assert.equal(f('ObjectName')(0, 0), 'tl');
  assert.equal(m4.f('ObjectCreate')('h', m4.rt.OBJ_HLINE, 0, 0, 1.5), true);
  m4.f('ObjectSet')('h', m4.rt.OBJPROP_COLOR, m4.rt.clrRed); assert.equal(m4.f('ObjectGet')('h', m4.rt.OBJPROP_PRICE1), 1.5);
  m4.f('ObjectSetText')('h', 'lbl', 10); assert.equal(m4.f('ObjectDescription')('h'), 'lbl');
  assert.equal(m4.f('ObjectsDeleteAll')(), 1); assert.equal(m4.env.objects.size, 0);

  // info / constants
  assert.equal(rt.clrRed, 0x0000ff); assert.equal(rt.clrWhite, 0xffffff); assert.equal(rt.clrDodgerBlue, 0xff901e);
  assert.equal(Object.keys(rt).filter(k => k.startsWith('clr') && k !== 'clrNONE').length, 132, 'every documented web color');
  assert.equal(m4.f('MarketInfo')('EURUSD', m4.rt.MODE_POINT), 0.00001); assert.equal(m4.f('MarketInfo')(null, m4.rt.MODE_DIGITS), 5);
  near(m4.rt.Ask as number, (m4.rt.Bid as number) + 10 * 0.00001, 'Ask = Bid + spread');
  assert.equal(f('SymbolInfoInteger')(null, rt.SYMBOL_DIGITS), 5);
  const sp = makeRef(0); assert.equal(f('SymbolInfoDouble')('EURUSD', rt.SYMBOL_POINT, sp), true); assert.equal(sp.v, 0.00001);
  assert.equal(f('SymbolInfoString')(null, rt.SYMBOL_CURRENCY_PROFIT), 'USD');
  const tick = new (rt.MqlTick as new () => { bid: number; ask: number })(); f('SymbolInfoTick')(null, tick); assert.ok(tick.ask > tick.bid);
  assert.equal(m4.rt.EMPTY_VALUE, 2147483647); assert.equal(rt.EMPTY_VALUE, Number.MAX_VALUE);
  assert.equal(m4.rt.PRICE_CLOSE, 0); assert.equal(rt.PRICE_CLOSE, 1); assert.equal(rt.PERIOD_H4, 16388); assert.equal(m4.rt.PERIOD_H4, 240);
  f('SetUserError')(5); assert.equal(rt._LastError, 65541); assert.equal(f('GetLastError')(), 65541); f('ResetLastError')(); assert.equal(rt._LastError, 0);
  f('Print')('a', 1, true, 1.5); f('PrintFormat')('%d-%s', 3, 'x');
  assert.ok(STD_OUT_PARAMS['StringReplace/3'] && STD_STRUCTS.includes('MqlRates') && STD_CLASSES.includes('CArrayDouble') && NATIVE_INCLUDES.includes('MovingAverages.mqh'));
  // MovingAverages.mqh
  const p = new MqlArray<number>(0); p.data = close.slice(0, 50); const ob = new MqlArray<number>(0);
  assert.equal(f('SimpleMAOnBuffer')(50, 0, 0, 10, p, ob), 50); near(ob.get(49), ind.sma(close, 10)[49], 'SimpleMAOnBuffer');
  near(f('SimpleMA')(49, 10, p), ind.sma(close, 10)[49], 'SimpleMA');
  // classes
  const ad = new (rt.CArrayDouble as new () => { Add(v: number): boolean; Sort(): void; At(i: number): number; Search(v: number): number; Total(): number })();
  [3, 1, 2].forEach(v => ad.Add(v)); ad.Sort(); assert.equal(ad.At(0), 1); assert.equal(ad.Search(3), 2); assert.equal(ad.Total(), 3);
});
