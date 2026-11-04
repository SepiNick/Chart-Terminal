import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { deps, clearCache } from './http.ts';
import * as N from './nobitex.ts';

// These replies are reconstructed from third-party descriptions of the API, not captured from the live service.
const udf = (t: number[], c: number[]) => ({ s: 'ok', t, o: c, h: c.map(x => x * 1.01), l: c.map(x => x * 0.99), c, v: c.map(() => 5) });
const T = Date.UTC(2026, 10, 4, 12) / 1000;
let calls: string[] = [];
const serve = (f: (url: string, init?: RequestInit) => unknown) => {
  deps.fetch = async (url, init) => { calls.push(`${init?.method ?? 'GET'} ${url}`); return new Response(JSON.stringify(f(url, init))) };
};
beforeEach(() => { deps.now = () => T * 1000; deps.sleep = async () => {}; clearCache(); N.resetUnit(); delete process.env['CT_NOBITEX_UNIT']; calls = [] });

test('timeframes: native, built from a smaller one, weeks and months from daily', () => {
  assert.deepEqual(N.nobitexBase('1h'), { base: '1h', res: '60', sec: 3600 });
  assert.equal(N.nobitexBase('2h')!.base, '1h');
  assert.equal(N.nobitexBase('45m')!.base, '15m');
  assert.equal(N.nobitexBase('1w')!.base, '1d');
  assert.equal(N.nobitexBase('1M')!.base, '1d');
  assert.equal(N.nobitexBase('2M'), null);
});

test('parseUdf: Rial becomes Toman, daily bars land on the Tehran date, no_data is empty, errors throw', () => {
  const day = Date.UTC(2026, 10, 3, 20, 30) / 1000;   // Tehran midnight starting 4 Nov
  const bars = N.parseUdf(udf([day], [1_000_000]), 10, true);
  assert.deepEqual(bars[0], { time: Date.UTC(2026, 10, 4) / 1000, open: 100000, high: 101000, low: 99000, close: 100000, volume: 5 });
  assert.equal(N.parseUdf(udf([day], [1_000_000]), 10, false)[0].time, day);
  assert.deepEqual(N.parseUdf({ s: 'no_data' }, 1, false), []);
  assert.throws(() => N.parseUdf({ s: 'error', errmsg: 'bad symbol' }, 1, false), /bad symbol/);
  assert.equal(N.parseUdf({ s: 'ok', t: ['100'], o: ['5'], h: ['6'], l: ['4'], c: ['5.5'], v: ['2'] }, 1, false)[0].close, 5.5, 'string numbers are accepted');
});

test('Rial vs Toman is detected from USDTIRT and can be forced', async () => {
  serve(() => udf([T - 86400, T], [1_650_000, 1_660_000]));
  assert.equal(await N.irtDivisor(), 10);
  N.resetUnit(); clearCache();
  serve(() => udf([T - 86400, T], [165_000, 166_000]));
  assert.equal(await N.irtDivisor(), 1);
  process.env['CT_NOBITEX_UNIT'] = 'rial';
  assert.equal(await N.irtDivisor(), 10);
});

test('bars: IRT prices in Toman, USDT prices untouched, symbol validated, until respected, months are calendar months', async () => {
  serve(url => (url.includes('USDTIRT') || url.includes('BTCIRT') ? udf([T - 7200, T - 3600, T], [1_600_000, 1_610_000, 1_620_000]) : udf([T - 3600, T], [60_000, 61_000])));
  const r = await N.nobitexBars('USDTIRT', '1h', undefined, 3);
  assert.equal(r.base, '1h');
  assert.deepEqual(r.bars.map(b => b.close), [160000, 161000, 162000]);
  assert.deepEqual((await N.nobitexBars('BTCUSDT', '1h', undefined, 2)).bars.map(b => b.close), [60_000, 61_000]);
  assert.deepEqual((await N.nobitexBars('USDTIRT', '1h', (T - 3600) * 1000 + 1, 3)).bars.map(b => b.close), [160000, 161000]);
  await assert.rejects(N.nobitexBars('BTC/USDT', '1h'), /Unknown symbol/);
  await assert.rejects(N.nobitexBars('BTCUSDT', '2M'), /not available/);
  const d = Date.UTC(2026, 9, 30) / 1000;
  serve(() => udf([d, d + 86400, d + 3 * 86400], [100, 110, 120]));
  const m = (await N.nobitexBars('BTCUSDT', '1M', undefined, 5)).bars;
  assert.deepEqual(m.map(b => [b.time, b.close]), [[Date.UTC(2026, 9, 1) / 1000, 110], [Date.UTC(2026, 10, 1) / 1000, 120]]);
});

test('bars: keeps asking for older chunks until it has enough, then stops on no_data', async () => {
  let n = 0;
  serve(() => (++n <= 2 ? udf(Array.from({ length: 3 }, (_, i) => T - n * 100000 + i * 60), [10, 11, 12]) : { s: 'no_data' }));
  const r = await N.nobitexBars('BTCUSDT', '1m', undefined, 1000);
  assert.equal(r.bars.length, 6);
  assert.ok(r.bars.every((b, i) => i === 0 || b.time > r.bars[i - 1].time), 'ascending');
  assert.equal(n, 3);
});

test('markets: from the order book keys when available, built-in list when not', async () => {
  serve(() => ({ status: 'ok', BTCIRT: {}, ETHUSDT: {}, ignore: {} }));
  assert.deepEqual((await N.nobitexMarkets()).map(m => m.sym), ['BTCIRT', 'ETHUSDT']);
  clearCache(); N.resetUnit();
  deps.now = () => T * 1000 + 2 * 3600_000;
  deps.fetch = async () => { throw Error('down') };
  const fb = await N.nobitexMarkets();
  assert.ok(fb.some(m => m.sym === 'USDTIRT') && fb.some(m => m.sym === 'BTCUSDT') && !fb.some(m => m.sym === 'USDTUSDT'));
});

test('tickers: stats keys map to symbols, Rial prices to Toman', async () => {
  process.env['CT_NOBITEX_UNIT'] = 'rial';
  serve((url, init) => (url.includes('orderbook') ? { status: 'ok', BTCIRT: {}, USDTIRT: {}, BTCUSDT: {} }
    : (assert.equal(init?.method, 'POST'), { status: 'ok', stats: { 'btc-rls': { latest: '50000000000', dayChange: '-1.5', volumeDst: '1000000' }, 'usdt-rls': { latest: '1650000', dayChange: '0.2', volumeDst: '10' }, 'btc-usdt': { latest: '65000', dayChange: '1', volumeDst: '5' }, 'foo-rls': { latest: '1' } } })));
  const t = await N.nobitexTickers();
  assert.deepEqual(t.map(x => [x.sym, x.last, x.change]), [['BTCIRT', 5_000_000_000, -1.5], ['USDTIRT', 165000, 0.2], ['BTCUSDT', 65000, 1]]);
});
