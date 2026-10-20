import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.CT_DATA_DIR = mkdtempSync(join(tmpdir(), 'ct-derivs-'));
const D = await import('./derivs.ts');
D.deps.gapMs = 0;

// A fake CCXT exchange answering with recorded Binance payloads (2026-10-20, BTC/USDT:USDT 1h); counts calls.
function fakeBinance() {
  const calls: string[] = [];
  const x = {
    has: { fetchOpenInterestHistory: true, fetchOpenInterest: true, fetchFundingRateHistory: true, fetchFundingRate: true, fetchLongShortRatioHistory: true },
    loadMarkets: async () => ({}),
    market: () => ({ id: 'BTCUSDT', contractSize: 1 }),
    fetchOpenInterestHistory: async (...a: unknown[]) => { calls.push('oi:' + a.slice(0, 2).join(',')); return [{ timestamp: 1792490400000, openInterestAmount: 95328.017, openInterestValue: 7764524181.4602 }, { timestamp: 1792486800000, openInterestAmount: 95159.166, openInterestValue: 7755648806.054214 }] },
    fetchOpenInterest: async () => { calls.push('oinow'); return { timestamp: 1792494000000, openInterestAmount: 95433.237, openInterestValue: 7779879716.7429 } },
    fetchFundingRateHistory: async () => { calls.push('fh'); return [{ timestamp: 1792454400006, fundingRate: 0.00009208 }] },
    fetchFundingRate: async () => { calls.push('fnow'); return { fundingRate: 0.00002177, fundingTimestamp: 1792512000000 } },
    fetchLongShortRatioHistory: async () => { calls.push('ls'); return [{ timestamp: 1792494000000, longShortRatio: 1.805 }] },
    fapiDataGetTopLongShortAccountRatio: async (p: { symbol: string }) => { calls.push('top:' + p.symbol); return [{ symbol: 'BTCUSDT', longShortRatio: '1.7772', timestamp: 1792490400000 }] },
    fapiDataGetTopLongShortPositionRatio: async () => [{ symbol: 'BTCUSDT', longShortRatio: '1.7843', timestamp: 1792494000000 }],
  };
  return { x, calls };
}
const q = (o: Record<string, string>) => new URLSearchParams(o);

test('routes normalise exchange payloads and cache them', async () => {
  const { x, calls } = fakeBinance();
  D.deps.rest = () => x as never;
  const oi = await D.derivs('oi', q({ ex: 'binanceusdm', sym: 'BTC/USDT:USDT', period: '1h' })) as { hist: { t: number }[]; now: { oi: number } };
  assert.deepEqual(oi.hist.map(p => p.t), [1792486800, 1792490400]);
  assert.equal(oi.now.oi, 95433.237);
  await D.derivs('oi', q({ ex: 'binanceusdm', sym: 'BTC/USDT:USDT', period: '1h' }));
  assert.deepEqual(calls, ['oi:BTC/USDT:USDT,1h', 'oinow'], 'second call served from cache');
  const f = await D.derivs('funding', q({ ex: 'binanceusdm', sym: 'BTC/USDT:USDT' })) as { hist: unknown[]; now: { rate: number; next: number } };
  assert.deepEqual(f.now, { rate: 0.00002177, next: 1792512000000, interval: null });
  const r = await D.derivs('ratio', q({ ex: 'binanceusdm', sym: 'BTC/USDT:USDT', period: '1h' })) as { accounts: { v: number }[]; top: { v: number }[]; topPos: { v: number }[] };
  assert.equal(r.accounts[0].v, 1.805); assert.equal(r.top[0].v, 1.7772); assert.equal(r.topPos[0].v, 1.7843);
  assert.ok(calls.includes('top:BTCUSDT'));
});

test('validates input and reports exchange failures clearly', async () => {
  await assert.rejects(D.derivs('oi', q({ ex: 'nope', sym: 'BTC/USDT:USDT' })), /Unknown exchange/);
  await assert.rejects(D.derivs('oi', q({ ex: 'bybit', sym: 'BTC USDT' })), /Bad symbol/);
  D.deps.rest = () => ({ has: { fetchOpenInterestHistory: true }, loadMarkets: async () => { throw new Error('binance GET https://fapi.binance.com 451 Service unavailable from a restricted location') } }) as never;
  await assert.rejects(D.derivs('oi', q({ ex: 'bybit', sym: 'ETH/USDT:USDT', period: '5m' })), (e: Error & { status: number }) => e.status === 502 && /bybit: .*451.*VPN/.test(e.message));
  D.deps.rest = () => ({ has: {}, loadMarkets: async () => ({}) }) as never;
  await assert.rejects(D.derivs('funding', q({ ex: 'gate', sym: 'ETH/USDT:USDT' })), /gate has no public FundingRateHistory/);
});

test('limiter runs one request at a time per exchange; failures are not cached', async () => {
  let running = 0, peak = 0;
  const job = () => D.limited('kraken', async () => { running++; peak = Math.max(peak, running); await new Promise(r => setTimeout(r, 5)); running--; return 1 });
  await Promise.all([job(), job(), job(), D.limited('okx', async () => 2)]);
  assert.equal(peak, 1);
  let n = 0;
  await assert.rejects(D.cached('k', 60_000, async () => { n++; throw Error('x') }));
  await new Promise(r => setTimeout(r, 0));
  assert.equal(await D.cached('k', 60_000, async () => ++n), 2);
  assert.equal(await D.cached('k', 60_000, async () => ++n), 2);
});

test('liquidation feed: watcher rows are normalised, de-duplicated and filtered by since', async () => {
  const batches = [
    [{ timestamp: 1000_000, price: 9910, contracts: 0.014, side: 'sell' }, { timestamp: 1001_000, price: 9920, contracts: 2, side: 'buy' }],
    [{ timestamp: 1001_000, price: 9920, contracts: 2, side: 'buy' }],   // repeat
  ];
  let waiting: (() => void) | null = null;
  D.deps.rest = () => ({ has: {}, loadMarkets: async () => ({}), market: () => ({ contractSize: 1 }) }) as never;
  D.deps.pro = () => ({ has: { watchLiquidations: true }, watchLiquidations: () => batches.length ? Promise.resolve(batches.shift()) : new Promise<never>(r => (waiting = r as never)) }) as never;
  const args = q({ ex: 'binanceusdm', sym: 'SOL/USDT:USDT' });
  await D.derivs('liqs', args);
  await new Promise(r => setTimeout(r, 10));
  const all = await D.derivs('liqs', args) as { list: { t: number; long: boolean; value: number }[] };
  assert.deepEqual(all.list.map(l => [l.t, l.long]), [[1000, true], [1001, false]]);
  const later = await D.derivs('liqs', q({ ex: 'binanceusdm', sym: 'SOL/USDT:USDT', since: '1000' })) as { list: unknown[] };
  assert.equal(later.list.length, 1);
  assert.ok(waiting, 'watcher keeps waiting for more');
});
