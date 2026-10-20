import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDeltas, align, barIndex, cvdLine, derivSym, liqLevels, niceBin, normFunding, normFundingHist, normLiq, normOI, normRatio, periodFor, type OIPt } from './model.ts';
import type { Bar } from '../data.ts';

// Recorded 2026-10-20 through CCXT 4.5.88 (BTC/USDT:USDT, 1h), trimmed to the fields CCXT fills.
const REC = {
  binanceOI: [
    { timestamp: 1792486800000, openInterestAmount: 95159.166, openInterestValue: 7755648806.054214, info: { symbol: 'BTCUSDT', sumOpenInterest: '95159.16600000', sumOpenInterestValue: '7755648806.05421400', timestamp: 1792486800000 } },
    { timestamp: 1792490400000, openInterestAmount: 95328.017, openInterestValue: 7764524181.4602 },
    { timestamp: 1792494000000, openInterestAmount: 95433.237, openInterestValue: 7779879716.7429 },
  ],
  bybitOI: [   // Bybit gives contracts only
    { timestamp: 1792494000000, openInterestAmount: 60986.337, info: { openInterest: '60986.33700000', timestamp: '1792494000000' } },
    { timestamp: 1792486800000, openInterestAmount: 60693.557, info: { openInterest: '60693.55700000', timestamp: '1792486800000' } },
  ],
  binanceFundingHist: [{ timestamp: 1792454400006, fundingRate: 0.00009208 }, { timestamp: 1792483200005, fundingRate: 0.00007102 }],
  binanceFunding: { fundingRate: 0.00002177, fundingTimestamp: 1792512000000 },
  bybitFunding: { fundingRate: -0.00002478, fundingTimestamp: 1792512000000, interval: '8h' },
  binanceRatio: [{ timestamp: 1792490400000, longShortRatio: 1.7855 }, { timestamp: 1792494000000, longShortRatio: 1.805 }],
  binanceTopRaw: [   // fapi/futures/data/topLongShortPositionRatio, raw strings
    { symbol: 'BTCUSDT', longAccount: '0.6399', longShortRatio: '1.7772', shortAccount: '0.3601', timestamp: 1792490400000 },
    { symbol: 'BTCUSDT', longAccount: '0.6408', longShortRatio: '1.7843', shortAccount: '0.3592', timestamp: 1792494000000 },
  ],
  // Documented forceOrder / allLiquidation samples parsed by CCXT's parseWsLiquidation.
  binanceLiq: { symbol: 'BTC/USDT:USDT', contracts: 0.014, price: 9910, side: 'sell', timestamp: 1568014460893 },
  bybitLiq: { symbol: 'ROSE/USDT:USDT', contracts: 20000, price: 0.04499, side: 'sell', timestamp: 1739502302929 },
};

test('derivSym maps chart symbols to the perpetual and its spot/perp feeds', () => {
  assert.deepEqual(derivSym('BTCUSDT'), { ex: 'binanceusdm', base: 'BTC', quote: 'USDT', ccxt: 'BTC/USDT:USDT', spot: 'BINANCE:BTCUSDT', perp: 'BINANCEUSDM:BTC_USDT.P' });
  assert.equal(derivSym('BINANCE:ETHFDUSD')!.ccxt, 'ETH/USDT:USDT');
  assert.deepEqual(derivSym('BYBIT:SOL_USDT.P'), { ex: 'bybit', base: 'SOL', quote: 'USDT', ccxt: 'SOL/USDT:USDT', spot: 'BYBIT:SOL_USDT', perp: 'BYBIT:SOL_USDT.P' });
  assert.equal(derivSym('OKX:BTC_USDC')!.ccxt, 'BTC/USDC:USDC');
  assert.equal(derivSym('BTCUSDT', 'bybit')!.perp, 'BYBIT:BTC_USDT.P');
  assert.equal(derivSym('FX:EURUSD'), null);
  assert.equal(derivSym('BTCUSDT/ETHUSDT'), null);
  assert.equal(derivSym('USDT'), null);
});

test('periodFor picks the largest shared history period that fits a bar', () => {
  assert.equal(periodFor(60), '5m'); assert.equal(periodFor(900), '15m'); assert.equal(periodFor(7200), '1h');
  assert.equal(periodFor(4 * 3600), '4h'); assert.equal(periodFor(7 * 86400), '1d');
});

test('normalises recorded open interest, funding and ratio payloads', () => {
  const b = normOI(REC.binanceOI);
  assert.deepEqual(b[0], { t: 1792486800, oi: 95159.166, oiv: 7755648806.054214 });
  assert.equal(b.length, 3);
  const y = normOI(REC.bybitOI);
  assert.deepEqual(y.map(x => x.t), [1792486800, 1792494000], 'sorted by time');
  assert.equal(y[1].oiv, null, 'Bybit has no value: client multiplies by price');
  assert.deepEqual(normFundingHist(REC.binanceFundingHist).map(x => x.v), [0.00009208, 0.00007102]);
  assert.deepEqual(normFunding(REC.binanceFunding), { rate: 0.00002177, next: 1792512000000, interval: null });
  assert.deepEqual(normFunding(REC.bybitFunding), { rate: -0.00002478, next: 1792512000000, interval: '8h' });
  assert.deepEqual(normRatio(REC.binanceRatio), [{ t: 1792490400, v: 1.7855 }, { t: 1792494000, v: 1.805 }]);
  assert.deepEqual(normRatio(REC.binanceTopRaw).map(x => x.v), [1.7772, 1.7843], 'raw strings parsed');
  assert.deepEqual(normRatio([{ timestamp: 1, longShortRatio: '' }]), [], 'empty values dropped');
});

test('liquidation side: Binance reports the order side, Bybit the position side', () => {
  assert.deepEqual(normLiq('binanceusdm', REC.binanceLiq), { t: 1568014460.893, long: true, qty: 0.014, px: 9910, value: 0.014 * 9910 });
  const y = normLiq('bybit', REC.bybitLiq)!;
  assert.equal(y.long, false, 'Bybit Sell = a short was liquidated');
  assert.equal(y.value, 20000 * 0.04499);
  assert.equal(normLiq('okx', { ...REC.binanceLiq, contractSize: 0.01, contracts: 3 })!.qty, 0.03, 'contracts × contract size');
  assert.equal(normLiq('bybit', { ...REC.bybitLiq, side: undefined }), null);
});

test('align / barIndex put each point in the bar that contains it', () => {
  const times = [100, 200, 300];
  assert.equal(barIndex(times, 99), -1); assert.equal(barIndex(times, 100), 0); assert.equal(barIndex(times, 299), 1); assert.equal(barIndex(times, 999), 2);
  const a = align([{ t: 50, v: 0 }, { t: 110, v: 1 }, { t: 150, v: 2 }, { t: 310, v: 3 }], times);
  assert.deepEqual([...a].map(([k, x]) => [k, x.v]), [[100, 2], [300, 3]]);
});

test('CVD spot vs perp: per-bar deltas, both lines starting at the same bar', () => {
  const times = [0, 60, 120];
  const spot = new Map<number, number>(), perp = new Map<number, number>();
  addDeltas(spot, [{ t: 5, px: 1, qty: 2, buy: true }, { t: 70, px: 1, qty: 1, buy: false }, { t: 130, px: 1, qty: 4, buy: true }], times);
  addDeltas(perp, [{ t: 65, px: 1, qty: 3, buy: false }, { t: 125, px: 1, qty: 1, buy: false }], times);
  assert.deepEqual(cvdLine(spot, times, 0).map(x => x.value), [2, 1, 5]);
  assert.deepEqual(cvdLine(spot, times, 60), [{ time: 60, value: -1 }, { time: 120, value: 3 }]);
  assert.deepEqual(cvdLine(perp, times, 60).map(x => x.value), [-3, -4]);
});

test('estimated liquidation heatmap: projects OI increases to leverage tiers, shrinks on OI drops, ends when traded through', () => {
  const bar = (time: number, low: number, high: number, close: number): Bar => ({ time, open: close, high, low, close, volume: 0 });
  const bars = [bar(0, 99, 101, 100), bar(1, 99, 101, 100), bar(2, 99, 101, 100), bar(3, 89, 101, 100)];
  const oi = new Map<number, OIPt>([[0, { t: 0, oi: 1000, oiv: null }], [1, { t: 1, oi: 1100, oiv: null }], [2, { t: 2, oi: 1045, oiv: null }]]);
  const lv = liqLevels(bars, oi, 0.5, 0, [[10, 1]]);   // one 10× tier, no maintenance margin → long 90, short 110
  assert.equal(lv.length, 2);
  const long = lv.find(l => l.long)!, short = lv.find(l => !l.long)!;
  assert.equal(long.px, 90); assert.equal(short.px, 110);
  // +100 contracts at p=100 → 5 000 per side, then −55 of 1100 (5 %) → 4 750
  assert.ok(Math.abs(short.size - 4750) < 1e-9);
  assert.equal(long.t0, 1); assert.equal(long.t1, 3, 'bar 3 traded down through 90');
  assert.equal(short.t1, null, 'still open');
  // default tiers: 5 tiers × 2 sides, each long below and short above the price
  const all = liqLevels(bars.slice(0, 2), oi, 0.5);
  assert.equal(all.length, 10);
  assert.ok(all.every(l => (l.long ? l.px < 100 : l.px > 100)));
  assert.ok(Math.abs(all.reduce((a, l) => a + l.size, 0) - 100 * 100) < 1e-6, 'all new notional is placed');
});

test('niceBin', () => { assert.equal(niceBin(65000), 50); assert.equal(niceBin(3000), 2); assert.equal(niceBin(0.5), 0.0005) });
