import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDominance, type DomDeps, type DomStore } from './domsource.ts';
import type { Bar } from '../data.ts';

const row = (id: string, symbol: string, cap: number, price: number, supply: number) => ({ id, symbol, market_cap: cap, current_price: price, circulating_supply: supply });
const MARKETS = [row('bitcoin', 'btc', 1e6, 100, 1e4), row('ethereum', 'eth', 3e5, 30, 1e4), row('tether', 'usdt', 1.5e5, 1, 1.5e5), row('ripple', 'xrp', 1e5, 2, 5e4), row('usd-coin', 'usdc', 6e4, 1, 6e4),
  row('binancecoin', 'bnb', 5e4, 50, 1e3), row('solana', 'sol', 3e4, 15, 2e3), row('dogecoin', 'doge', 2e4, 0.2, 1e5), row('tron', 'trx', 1.5e4, 0.3, 5e4), row('cardano', 'ada', 1e4, 0.5, 2e4)];
const GLOBAL = { data: { total_market_cap: { usd: 2e6 }, updated_at: 1 } };
const CHART = { market_caps: [[0, 1.4e5], [86400_000, 1.5e5]] };
const ok = (j: unknown) => new Response(JSON.stringify(j));

function harness() {
  let now = 1_800_000_000_000;
  const urls: string[] = [], candleCalls: string[] = [];
  let mode: 'ok' | '429' | '403' | 'down' | 'junk' = 'ok';
  const d: DomDeps = {
    fetch: async url => {
      urls.push(url);
      if (mode === '429') return new Response('', { status: 429, headers: { 'retry-after': '120' } });
      if (mode === '403') return new Response('<html>blocked</html>', { status: 403 });
      if (mode === 'down') throw Error('getaddrinfo ENOTFOUND');
      if (mode === 'junk') return ok({ nothing: true });
      return ok(url.includes('/global') ? GLOBAL : url.includes('market_chart') ? CHART : MARKETS);
    },
    now: () => now,
    sleep: async ms => { now += ms },
    candles: async (pair, tf) => {
      candleCalls.push(`${pair}|${tf}`);
      if (pair === 'XRPUSDT') throw Error('delisted');   // one coin missing must not break the series
      const p = { BTCUSDT: 100, ETHUSDT: 30 }[pair] ?? 1, t0 = Math.floor(now / 1000 / 86400) * 86400 - 4 * 86400;
      return [0, 1, 2, 3, 4].map((i): Bar => ({ time: t0 + i * 86400, open: p, high: p, low: p, close: p * (1 + i / 100), volume: 1 }));
    },
  };
  return { d, urls, candleCalls, set: (m: typeof mode) => { mode = m }, tick: (ms: number) => { now += ms } };
}

test('bars: fixed host, a missing coin is tolerated, bars are flagged approximated, unknown things are refused', async () => {
  const h = harness(), dom = createDominance(h.d);
  const r = await dom.bars('BTC.D', '1d', undefined, 1000, null);
  assert.equal(r.bars.length, 5);
  assert.ok(r.bars.every(b => b.approx === true && b.close > 0 && b.close < 100));
  assert.equal(r.base, '1d');
  assert.ok(h.urls.length > 0 && h.urls.every(u => u.startsWith('https://api.coingecko.com/api/v3/')));
  assert.ok(h.urls.some(u => u.includes('/coins/tether/market_chart')));
  const total = await dom.bars('TOTAL', '1d', undefined, 2, null);
  assert.equal(total.bars.length, 2);
  assert.equal(total.bars.at(-1)!.close, 2e6);   // last bar = CoinGecko's global total
  await assert.rejects(dom.bars('FOO.D', '1d'), /Unknown symbol/);
  await assert.rejects(dom.bars('BTC.D', '1s'), /1 minute/);
  await assert.rejects(dom.bars('BTC.D', 'xyz'), /1 minute/);
  const stable = await dom.bars('STABLE.D', '1d', undefined, 1000, null);
  assert.ok(stable.bars[0].close < stable.bars[4].close || stable.bars[0].close > 0);
});

test('polite: CoinGecko answers are cached, so a second chart costs no new CoinGecko call, and calls are spaced', async () => {
  const h = harness(), dom = createDominance(h.d);
  await dom.bars('BTC.D', '1d');
  const n = h.urls.length;
  await dom.bars('ETH.D', '4h');
  assert.equal(h.urls.length, n);
  h.tick(10 * 60_000);   // older than every cache ttl except none: all refetched
  await dom.bars('BTC.D', '1d');
  assert.ok(h.urls.length > n);
});

test('429: backs off for Retry-After, serves the stale copy and says so; a clear error when there is none', async () => {
  const h = harness(), dom = createDominance(h.d);
  h.set('429');
  await assert.rejects(dom.bars('BTC.D', '1d'), /rate limit \(HTTP 429\)/);
  const calls = h.urls.length;
  await assert.rejects(dom.bars('BTC.D', '1d'), /not answering this network.*next try in/);
  assert.equal(h.urls.length, calls, 'no request while backing off');
  assert.equal(dom.status().fails, 1);
  assert.ok(dom.status().blockedUntil > 0);
  h.tick(121_000); h.set('ok');
  const good = await dom.bars('BTC.D', '1d');
  assert.equal(good.stale, false);
  assert.equal(dom.status().fails, 0);
  h.tick(30 * 60_000); h.set('429');
  const stale = await dom.bars('BTC.D', '1d');   // history candles are cached too, CoinGecko is blocked: the last copy is served
  assert.equal(stale.stale, true);
  assert.equal(dom.status().stale, true);
});

test('blocked network, no connection and junk replies give plain sentences', async () => {
  const h = harness(), dom = createDominance(h.d);
  h.set('403');
  await assert.rejects(dom.snapshot(), /refused this network \(HTTP 403; some VPNs and countries are blocked\)/);
  h.tick(16 * 60_000); h.set('down');
  await assert.rejects(dom.snapshot(), /CoinGecko unreachable: getaddrinfo ENOTFOUND/);
  h.tick(16 * 60_000); h.set('junk');
  await assert.rejects(dom.snapshot(), /unexpected reply/);
});

test('recorded series is blended in through the store', async () => {
  const h = harness(), dom = createDominance(h.d);
  const base = await dom.bars('BTC.D', '1d', undefined, 1000, null);
  const t3 = base.bars[3].time;
  const read: DomStore['read'] = (from, to) => (from <= t3 + 10 && to > t3 + 10 ? [{ t: t3 + 10, c: { total: 2e6, btc: 1.2e6, eth: 3e5, usdt: 1.5e5, usdc: 6e4, stable: 2.1e5, top10: 1.8e6 } }] : []);
  const store: DomStore = { read, first: () => ({ t: t3 + 10, c: { total: 2e6, btc: 1.2e6, eth: 3e5, usdt: 1.5e5, usdc: 6e4, stable: 2.1e5, top10: 1.8e6 } }) };
  const r = await dom.bars('BTC.D', '1d', undefined, 1000, store);
  assert.deepEqual(r.bars.map(b => b.approx), [true, true, true, false, true]);
  assert.equal(r.bars[3].close, 60);
  assert.ok(Math.abs(r.bars[2].close - 60) < 1, 'seam: the approximation before the recording is scaled to meet it');
});

test('upstream budget bounds candle fetches per minute', async () => {
  const h = harness(), dom = createDominance(h.d);
  let failed = 0;
  for (let i = 0; i < 200; i++) { h.tick(1); try { await dom.bars('BTC.D', i % 2 ? '1h' : '5m', 1_700_000_000_000 + i * 1000) } catch (e) { failed++; assert.match((e as Error).message, /Too many candle requests/) } }
  assert.ok(failed > 0 && h.candleCalls.length <= 1200 + 1);
});
