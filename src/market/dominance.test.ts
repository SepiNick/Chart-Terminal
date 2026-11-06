import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALIAS, align, approxComps, asDomSym, backoffMs, bucketFn, candleAssets, compNow, fmtDom, isDomSym, merge, parseChart, parseGlobal, parseMarkets, seamRatio, share, snapBars, stepAlign, valueOf, type Comp, type Snap } from './dominance.ts';
import type { Bar } from '../data.ts';

// Shapes copied from CoinGecko's public replies (trimmed), plus junk rows that must be skipped.
const GLOBAL = { data: { active_cryptocurrencies: 17000, total_market_cap: { usd: 2_000_000, eur: 1_800_000 }, market_cap_percentage: { btc: 50, eth: 15 }, updated_at: 1_762_300_000 } };
const row = (id: string, symbol: string, market_cap: number, current_price: number, circulating_supply?: number) => ({ id, symbol, name: id, market_cap, current_price, circulating_supply, market_cap_rank: 1 });
const MARKETS = [
  row('bitcoin', 'btc', 1_000_000, 100, 10_000), row('ethereum', 'eth', 300_000, 30, 10_000), row('tether', 'usdt', 150_000, 1, 150_000), row('ripple', 'xrp', 100_000, 2, 50_000),
  row('usd-coin', 'usdc', 60_000, 1, 60_000), row('binancecoin', 'bnb', 50_000, 50, 1_000), row('staked-ether', 'steth', 40_000, 30, 1_333), row('solana', 'sol', 30_000, 15, 2_000),
  row('dogecoin', 'doge', 20_000, 0.2, 100_000), row('tron', 'trx', 15_000, 0.3, 50_000), row('cardano', 'ada', 10_000, 0.5, 20_000), row('xmr-clone', 'xmr', 8_000, 600, 13),
  { id: 'broken', symbol: 'bad', market_cap: null, current_price: 1 }, null, { symbol: 'noid', market_cap: 5, current_price: 1 },
];
const bar = (time: number, c: number, spread = 0): Bar => ({ time, open: c, high: c + spread, low: c - spread, close: c, volume: 1 });
const series = (closes: number[], t0 = 0, step = 86400) => closes.map((c, i) => bar(t0 + i * step, c));

test('CoinGecko replies are parsed, junk rows skipped, ranks by market cap', () => {
  assert.deepEqual(parseGlobal(GLOBAL), { total: 2_000_000, updated: 1_762_300_000 });
  assert.throws(() => parseGlobal({ data: {} }), /unexpected reply/);
  assert.throws(() => parseGlobal('<html>blocked</html>'), /unexpected reply/);
  const coins = parseMarkets(MARKETS);
  assert.equal(coins.length, 12);
  assert.deepEqual(coins.slice(0, 3).map(c => [c.sym, c.rank]), [['BTC', 0], ['ETH', 1], ['USDT', 2]]);
  assert.ok(coins.find(c => c.sym === 'USDC')!.stable && !coins.find(c => c.sym === 'BTC')!.stable);
  assert.equal(coins.find(c => c.sym === 'BTC')!.supply, 10_000);
  assert.equal(parseMarkets([...MARKETS.slice(0, 11), row('x', 'xx', 5, 1)].map(r => (r && 'circulating_supply' in r && r.id === 'x' ? { ...r, circulating_supply: undefined } : r))).find(c => c.sym === 'XX')!.supply, 5);   // supply = cap / price when missing
  assert.throws(() => parseMarkets({ error: 'rate limit' }), /not a list/);
  assert.throws(() => parseMarkets(MARKETS.slice(0, 4)), /fewer than 10/);
  assert.deepEqual(parseChart({ prices: [], market_caps: [[2000, 5], [1000, 4], [3000, 'x'], [4000, -1]] }), [[1, 4], [2, 5]]);
  assert.throws(() => parseChart({}), /no market_caps/);
});

test('share computation and every symbol from one set of components', () => {
  assert.equal(share(50, 200), 25);
  assert.ok(Number.isNaN(share(5, 0)) && Number.isNaN(share(NaN, 10)));
  const c = compNow(2_000_000, parseMarkets(MARKETS));
  assert.deepEqual(c, { total: 2_000_000, btc: 1_000_000, eth: 300_000, usdt: 150_000, usdc: 60_000, stable: 210_000, top10: 1_000_000 + 300_000 + 150_000 + 100_000 + 60_000 + 50_000 + 40_000 + 30_000 + 20_000 + 15_000 });
  assert.equal(valueOf('BTC.D', c), 50);
  assert.equal(valueOf('CRYPTOCAP:ETH.D', c), 15);
  assert.equal(valueOf('USDT.D', c), 7.5);
  assert.equal(valueOf('USDC.D', c), 3);
  assert.equal(valueOf('STABLE.D', c), 10.5);
  assert.equal(valueOf('OTHERS.D', c), (100 * (2_000_000 - 1_765_000)) / 2_000_000);
  assert.equal(valueOf('TOTAL', c), 2_000_000);
  assert.equal(valueOf('TOTAL2', c), 1_000_000);
  assert.equal(valueOf('TOTAL3', c), 700_000);
  assert.ok(Number.isNaN(valueOf('NOPE', c)));
});

test('symbol names, bare names and axis text', () => {
  assert.equal(asDomSym('btc.d'), 'CRYPTOCAP:BTC.D');
  assert.equal(asDomSym('CRYPTOCAP:total2'), 'CRYPTOCAP:TOTAL2');
  assert.equal(asDomSym('BTCUSDT'), null);
  assert.ok(isDomSym('CRYPTOCAP:OTHERS.D') && !isDomSym('CRYPTOCAP:FOO') && !isDomSym('BTC.D'));
  assert.equal(fmtDom('CRYPTOCAP:BTC.D', 57.314), '57.31%');
  assert.equal(fmtDom('CRYPTOCAP:TOTAL', 2.45e12), '2.450T');
  assert.equal(fmtDom('CRYPTOCAP:TOTAL3', 8.1e11), '810.00B');
});

test('alignment: gaps are carried forward, a late start is back-filled', () => {
  const times = [10, 20, 30, 40, 50];
  const b = [bar(20, 5), bar(40, 7)];   // no bar at 10 (not listed yet), 30 and 50 (gap)
  assert.deepEqual(align(b, times, 'close'), [5, 5, 5, 7, 7]);
  assert.deepEqual(stepAlign([[25, 100], [45, 200]], times), [100, 100, 100, 100, 200]);
});

test('supply scaling: cap = close x supply, last bar meets the global total, bad pairs and wrapped tokens handled', () => {
  const coins = parseMarkets(MARKETS), t = [0, 86400, 2 * 86400];
  const candles = {
    BTC: series([90, 95, 100]), ETH: series([27, 28.5, 30]), XRP: series([1, 1.5, 2]), BNB: series([40, 45, 50]), SOL: series([10, 12, 15]),
    DOGE: series([0.1, 0.15, 0.2]), TRX: series([0.3, 0.3, 0.3]), ADA: series([0.4, 0.45, 0.5]),
    XMR: series([100, 100, 118]),   // delisted / a different asset: far from CoinGecko's 600, must be ignored
  };
  const totalNow = 2_100_000;   // more than the list: the rest is the tail
  const cb = approxComps(candles, coins, totalNow);
  assert.deepEqual(cb.map(b => b.time), t);
  const last = cb[2].f.close, first = cb[0].f.close;
  assert.equal(last.total, totalNow);
  assert.equal(last.btc, 100 * 10_000);
  assert.equal(first.btc, 90 * 10_000);   // price(t) x current supply
  assert.equal(first.eth, 27 * 10_000);
  assert.equal(first.usdt, 150_000);      // stable without a chart: flat at today's cap
  assert.ok(first.total < last.total && first.total > 0);
  // stETH follows ETH's candles: 40_000 x 27/30 at the start, so the top-10 sum falls with the market
  assert.ok(first.top10 < last.top10);
  const noMonero = approxComps({ ...candles, XMR: undefined }, coins, totalNow);
  assert.equal(cb[0].f.close.total, noMonero[0].f.close.total);
  // tail: grows and shrinks with the altcoin basket
  const listed = coins.reduce((a, c) => a + c.cap, 0), tail = totalNow - listed;
  assert.ok(tail > 0);
  assert.throws(() => approxComps({ ETH: candles.ETH }, coins, totalNow), /No BTC/);
  assert.throws(() => approxComps({ BTC: candles.BTC }, coins, totalNow), /No ETH/);
});

test('real stablecoin history (market_chart) replaces the flat guess', () => {
  const coins = parseMarkets(MARKETS), candles = { BTC: series([100, 100, 100]), ETH: series([30, 30, 30]) };
  const cb = approxComps(candles, coins, 2_000_000, { tether: [[0, 100_000], [86400, 120_000], [2 * 86400, 150_000]] });
  assert.deepEqual(cb.map(b => b.f.close.usdt), [100_000, 120_000, 150_000]);
  assert.ok(valueOf('USDT.D', cb[0].f.close) < valueOf('USDT.D', cb[2].f.close));
});

test('which candles to fetch: BTC and ETH always, wrapped tokens map to their base, stables never', () => {
  const coins = parseMarkets(MARKETS), a = candleAssets(coins, 30);
  assert.deepEqual(a.slice(0, 2), ['BTC', 'ETH']);
  assert.ok(!a.includes('USDT') && !a.includes('USDC') && !a.includes('STETH') && a.includes('XRP'));
  assert.equal(ALIAS['WBTC'], 'BTC');
  assert.equal(candleAssets(coins, 4).length, 4);
});

test('rate-limit backoff: Retry-After wins, otherwise 30 s doubling up to 15 min', () => {
  assert.equal(backoffMs(1), 30_000);
  assert.equal(backoffMs(2), 60_000);
  assert.equal(backoffMs(3), 120_000);
  assert.equal(backoffMs(50), 900_000);
  assert.equal(backoffMs(1, 90), 90_000);
  assert.equal(backoffMs(1, 99999), 900_000);
  assert.equal(backoffMs(2, NaN), 60_000);
  assert.equal(backoffMs(0), 30_000);
});

test('bars land in the same buckets as exchange candles', () => {
  const day = bucketFn('1d'), week = bucketFn('1w'), month = bucketFn('1M'), h4 = bucketFn('4h');
  assert.equal(day(86400 * 3 + 5000), 86400 * 3);
  assert.equal(new Date(week(Date.UTC(2026, 10, 5) / 1000) * 1000).getUTCDay(), 1);   // Monday
  assert.equal(month(Date.UTC(2026, 10, 17) / 1000), Date.UTC(2026, 10, 1) / 1000);
  assert.equal(h4(4 * 3600 + 1), 4 * 3600);
});

const comp = (total: number, btc: number): Comp => ({ total, btc, eth: total * 0.1, usdt: total * 0.05, usdc: total * 0.02, stable: total * 0.08, top10: total * 0.9 });
test('recorded series: bars from snapshots, high/low inside a bar', () => {
  const snaps: Snap[] = [{ t: 100, c: comp(1000, 500) }, { t: 200, c: comp(1000, 600) }, { t: 300, c: comp(1000, 400) }, { t: 86400 + 5, c: comp(1000, 450) }];
  const b = snapBars('BTC.D', snaps, '1d');
  assert.deepEqual(b.map(x => [x.time, x.open, x.high, x.low, x.close, x.approx]), [[0, 50, 60, 40, 40, false], [86400, 45, 45, 45, 45, false]]);
});

test('merge: no seam at the first recorded bar, recorded wins, gaps fall back to the (scaled) approximation, every bar says which it is', () => {
  const coins = parseMarkets(MARKETS), n = 6, day = 86400;
  const candles = { BTC: series(Array(n).fill(100), 0), ETH: series(Array(n).fill(30), 0) };
  const cb = approxComps(candles, coins, 2_000_000);
  const approxVal = valueOf('BTC.D', cb[0].f.close);   // flat prices: constant approximation
  // recording starts on day 3; its BTC share is 10 % higher than the approximation said (supply drift)
  const rec = (d: number, k = 1.1): Snap => ({ t: d * day + 100, c: { ...cb[d].f.close, btc: cb[d].f.close.btc * k } });
  const snaps = [rec(3), rec(4), /* day 5 missing: the server was off */];
  const out = merge('BTC.D', cb, snaps, '1d', snaps[0]);
  assert.equal(out.length, n);
  assert.deepEqual(out.map(b => b.approx), [true, true, true, false, false, true]);
  const recVal = valueOf('BTC.D', snaps[0].c);
  assert.ok(Math.abs(recVal / approxVal - 1.1) < 1e-9);
  // the approximation before the start is scaled to meet the recording: day 2 (approx) equals day 3 (recorded)
  assert.ok(Math.abs(out[2].close - out[3].close) < 1e-9, `seam ${out[2].close} vs ${out[3].close}`);
  assert.ok(Math.abs(out[5].close - out[4].close) < 1e-9, 'a gap continues from the recorded level');
  // nothing recorded: pure approximation, flagged
  const none = merge('BTC.D', cb, [], '1d', null);
  assert.ok(none.every(b => b.approx === true) && Math.abs(none[0].close - approxVal) < 1e-9);
  // ratio helper
  assert.equal(seamRatio(cb, { t: -5, c: snaps[0].c }), null);
  assert.ok(Math.abs(seamRatio(cb, snaps[0])!.btc - 1.1) < 1e-9);
});

test('OHLC of the approximation: high and low bracket open and close', () => {
  const coins = parseMarkets(MARKETS);
  const mk = (c: number): Bar => ({ time: 0, open: c, high: c * 1.1, low: c * 0.9, close: c, volume: 0 });
  const cb = approxComps({ BTC: [mk(100)], ETH: [mk(30)] }, coins, 2_000_000);
  const b = merge('TOTAL', cb, [], '1d', null)[0];
  assert.ok(b.high >= Math.max(b.open, b.close) && b.low <= Math.min(b.open, b.close));
});
