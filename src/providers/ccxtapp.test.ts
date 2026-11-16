import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_EXCHANGES, EXTRA_KEY, TTL, createCcxtApp, exchangeIds, extraExchanges, nativeBase, setExtra, symOf, type AppDeps, type CcxtEx, type Kv } from './ccxtapp.ts';
import { ccxtBarHooks, ccxtOf } from './ccxthook.ts';
import { rank, toSymbol } from '../symsearch.ts';

const MARKETS = {
  'BTC/USDT': { symbol: 'BTC/USDT', base: 'BTC', quote: 'USDT', type: 'spot', active: true },
  'BTC/USDT:USDT': { symbol: 'BTC/USDT:USDT', base: 'BTC', quote: 'USDT', settle: 'USDT', type: 'swap', active: true },
  'BTC/USD:BTC': { symbol: 'BTC/USD:BTC', base: 'BTC', quote: 'USD', settle: 'BTC', type: 'swap', active: true },
  'BTC/USDT:USDT-251226': { symbol: 'BTC/USDT:USDT-251226', base: 'BTC', quote: 'USDT', type: 'future', expiry: Date.UTC(2025, 11, 26), active: true },
  'BTC/USDT:USDT-251226-100000-C': { symbol: 'x', base: 'BTC', quote: 'USDT', type: 'option', active: true },
  'OLD/USDT': { symbol: 'OLD/USDT', base: 'OLD', quote: 'USDT', type: 'spot', active: false },
};
const H = 3600_000, T0 = 1_800_000_000_000;

function harness(timeframes: Record<string, unknown> = { '1m': 1, '5m': 1, '1h': 1, '1d': 1 }) {
  let now = T0, loads = 0, mode: 'ok' | 'down' = 'ok';
  const calls: { sym: string; tf: string; since?: number; limit?: number }[] = [];
  let rows: (tf: string, since?: number, limit?: number) => number[][] = () => [];
  const X = class implements CcxtEx {
    has = { fetchOHLCV: true, fetchTickers: true }; timeframes = timeframes; options = { fetchMarkets: ['spot', 'linear', 'inverse', 'option'] };
    async loadMarkets() { loads++; if (mode === 'down') throw Error('offline'); return MARKETS }
    async fetchOHLCV(sym: string, tf: string, since?: number, limit?: number) { calls.push({ sym, tf, since, limit }); return rows(tf, since, limit) }
    async fetchTickers() { return { 'BTC/USDT': { symbol: 'BTC/USDT', last: 5, percentage: 1, quoteVolume: 9 } } }
  };
  const store = new Map<string, string>();
  const kv: Kv = { get: async k => store.get(k), set: async (k, v) => { store.set(k, v) } };
  const d: AppDeps = { ctor: async id => { if (id === 'nope') throw Error('not available'); return X }, now: () => now, sleep: async ms => { now += ms; await new Promise(r => setTimeout(r, 0)) }, kv };
  return { d, calls, store, kv, loads: () => loads, advance: (ms: number) => { now += ms }, setRows: (f: typeof rows) => { rows = f }, setMode: (m: typeof mode) => { mode = m } };
}
const ms = (t: number) => t * 1000;

test('symbol mapping: spot, swap (settle suffix only when it differs from quote), future, options dropped', () => {
  assert.equal(symOf({ base: 'BTC', quote: 'USDT', type: 'spot' }), 'BTC_USDT');
  assert.equal(symOf({ base: '1000PEPE', quote: 'USDT', type: 'swap', settle: 'USDT' }), '1000PEPE_USDT.P');
  assert.equal(symOf({ base: 'BTC', quote: 'USD', type: 'swap', settle: 'BTC' }), 'BTC_USD.PBTC');
  assert.equal(symOf({ base: 'BTC', quote: 'USDT', type: 'future', expiry: Date.UTC(2025, 11, 26) }), 'BTC_USDT.F251226');
  assert.equal(symOf({ base: 'BTC', quote: 'USDT', type: 'future' }), null);
  assert.equal(symOf({ base: 'BTC', quote: 'USDT', type: 'option' }), null);
  assert.equal(symOf({ base: 'a-b', quote: 'u.s', type: 'spot' }), 'AB_US');
});

test('timeframe base: native as is, else the largest dividing native, months never divide', () => {
  const sup = ['1m', '5m', '15m', '1h', '4h', '1d', '1w', '1M'];
  assert.deepEqual(nativeBase(sup, '1h'), { base: '1h', n: 1 });
  assert.deepEqual(nativeBase(sup, '2h'), { base: '1h', n: 2 });
  assert.deepEqual(nativeBase(sup, '8h'), { base: '4h', n: 2 });
  assert.deepEqual(nativeBase(sup, '45m'), { base: '15m', n: 3 });
  assert.deepEqual(nativeBase(sup, '3m'), { base: '1m', n: 3 });
  assert.deepEqual(nativeBase(sup, '2M'), { base: '1d', n: 60 });   // same as the server: only the native 1M itself is a month
  assert.deepEqual(nativeBase(sup, '7s'), null);
  assert.deepEqual(nativeBase(['1h'], '30m'), null);
});

test('bars: native fetch, aggregation and the partial first bucket is dropped', async () => {
  const h = harness();
  const app = createCcxtApp(h.d);
  h.setRows(() => [[ms(1800), 1, 2, 0.5, 1.5, 1], [ms(3600), 10, 12, 9, 11, 2]]);
  assert.equal((await app.bars('bybit', 'BTC_USDT', '1h')).length, 2);
  assert.deepEqual(h.calls[0], { sym: 'BTC/USDT', tf: '1h', since: undefined, limit: 1000 });
  // 2h from 1h candles: the 01:00 candle belongs to a 00:00 bucket that starts before the data -> partial, dropped
  h.calls.length = 0;
  h.setRows(() => [[ms(3600), 1, 4, 1, 2, 1], [ms(7200), 2, 5, 2, 3, 1], [ms(10800), 3, 6, 3, 4, 1], [ms(14400), 4, 7, 4, 5, 1]]);
  const out = await app.bars('bybit', 'BTC_USDT', '2h');
  assert.equal(h.calls[0].tf, '1h'); assert.equal(h.calls[0].limit, 1000);
  assert.deepEqual(out.map(b => b.time), [7200, 14400]);
  assert.deepEqual(out[0], { time: 7200, open: 2, high: 6, low: 2, close: 4, volume: 2 });
  // a full first bucket is kept
  h.setRows(() => [[ms(7200), 1, 4, 1, 2, 1], [ms(10800), 2, 5, 2, 3, 1]]);
  assert.deepEqual((await app.bars('bybit', 'BTC_USDT', '2h')).map(b => b.time), [7200]);
  await assert.rejects(app.bars('bybit', 'NOPE_USDT', '1h'), /Unknown market/);
  await assert.rejects(app.bars('bybit', 'BTC_USDT', '7s'), /compatible/);
});

test('bars: paging back with endTime walks forward pages up to the end', async () => {
  const h = harness();
  const app = createCcxtApp(h.d);
  const end = ms(10 * 3600);
  h.setRows((tf, since) => since! >= end ? [] : [0, 1, 2].map(i => [since! + i * H, 1, 1, 1, 1, 1]));
  const bars = await app.bars('okx', 'BTC_USDT', '1h', end);
  assert.ok(h.calls.length > 1 && h.calls.every(c => c.since !== undefined));
  assert.ok(bars.every(b => b.time * 1000 <= end));
  assert.deepEqual(bars.map(b => b.time), [...new Set(bars.map(b => b.time))].sort((a, b) => a - b));
});

test('market cache: memory, stored copy, TTL refresh in the background, bad refresh keeps the stale list', async () => {
  const h = harness();
  const app = createCcxtApp(h.d);
  const l1 = await app.marketList('bybit');
  assert.deepEqual(l1.map(m => m.sym).sort(), ['BTC_USDT', 'BTC_USDT.F251226', 'BTC_USDT.P', 'BTC_USD.PBTC'].sort());   // options and inactive dropped
  await app.markets('bybit'); assert.equal(h.loads(), 1);   // memory hit
  assert.ok(h.store.has('v1:bybit'));
  // a fresh app (restart) reads the stored copy without hitting the exchange
  const app2 = createCcxtApp(h.d);
  assert.equal((await app2.marketList('bybit')).length, 4); assert.equal(h.loads(), 1);
  // past the TTL: stale list returned at once, refreshed behind
  h.advance(TTL + 1);
  assert.equal((await app2.marketList('bybit')).length, 4);
  await new Promise(r => setTimeout(r, 0)); assert.equal(h.loads(), 2);
  // exchange down after the TTL: the stale copy still answers
  h.advance(TTL + 1); h.setMode('down');
  assert.equal((await app2.marketList('bybit')).length, 4);
  // nothing stored and down: the error reaches the caller
  await assert.rejects(createCcxtApp(harness().d).markets('nope'), /not available/);
});

test('market cache keeps at most 8 exchanges in memory', async () => {
  const h = harness(), app = createCcxtApp(h.d);
  for (let i = 0; i < 10; i++) await app.markets('ex' + i);
  assert.equal(h.loads(), 10);
  await app.markets('ex0'); assert.equal(h.loads(), 10);   // stored copy, no reload
  await app.markets('ex9'); assert.equal(h.loads(), 10);
});

test('stream: polls the newest candles, aggregates, backs off on errors, stops', async () => {
  const h = harness();
  const app = createCcxtApp(h.d);
  await app.markets('kraken');
  h.setRows((tf, _s, limit) => (limit === 2 ? [[ms(3600), 1, 2, 1, 2, 1], [ms(7200), 2, 3, 2, 3, 1]] : [[ms(3600), 1, 4, 1, 2, 1], [ms(7200), 2, 5, 2, 3, 1], [ms(10800), 3, 6, 3, 4, 1], [ms(14400), 4, 7, 4, 5, 1]]));
  const got: number[] = [];
  const stop = app.stream('kraken', 'BTC_USDT', '1h', b => { got.push(b.time); if (got.length >= 4) stop() });
  await new Promise(r => setTimeout(r, 20));
  assert.deepEqual(got.slice(0, 4), [3600, 7200, 3600, 7200]);
  got.length = 0;
  const stop2 = app.stream('kraken', 'BTC_USDT', '2h', b => { got.push(b.time); stop2() });
  await new Promise(r => setTimeout(r, 20));
  assert.deepEqual(got, [14400]);   // only the newest bucket
});

test('stream: backoff doubles up to the cap and a hidden page does not fetch', async () => {
  const h = harness(), waits: number[] = [];
  let visible = false, n = 0;
  const d = { ...h.d, visible: () => visible, sleep: async (ms: number) => { waits.push(ms); if (++n === 3) visible = true; await new Promise(r => setTimeout(r, 0)) } };
  const app = createCcxtApp(d);
  await app.markets('kraken');
  h.setRows(() => { throw Error('429') });
  const stop = app.stream('kraken', 'BTC_USDT', '1h', () => {});
  await new Promise(r => setTimeout(r, 120)); stop();
  assert.equal(h.calls.length > 0, true);
  assert.deepEqual(waits.slice(0, 3), [3000, 3000, 3000]);   // hidden: no fetch, no backoff
  assert.deepEqual(waits.slice(3, 6), [6000, 12000, 24000]);   // the first fetch after the page shows fails, so the wait doubles from then on
  assert.ok(Math.max(...waits) <= 60_000);
});

test('stream: aggregated poll starts at the bucket start and skips a partial newest bucket', async () => {
  const h = harness(), app = createCcxtApp(h.d);
  await app.markets('kraken');
  const got: number[] = [];
  // base candles begin after the bucket start (04:00 bucket, first candle 05:00) -> partial, not emitted
  h.setRows(() => [[ms(18000), 1, 1, 1, 1, 1], [ms(21600), 1, 1, 1, 1, 1]]);
  const stop = app.stream('kraken', 'BTC_USDT', '4h', b => got.push(b.time));
  await new Promise(r => setTimeout(r, 20)); stop();
  assert.ok(h.calls.length > 0 && got.length === 0);
  const c = h.calls[0];
  assert.equal(c.tf, '1h'); assert.equal(c.limit, 5); assert.equal(c.since! % (4 * H), 0);
});

test('stream: since is the newest bucket start; a whole bucket is emitted', async () => {
  const h = harness(), app = createCcxtApp(h.d);
  await app.markets('kraken');
  const got: number[] = [];
  h.setRows((_tf, since) => [0, 1].map(i => [since! + i * H, 1, 1, 1, 1, 1]));
  const stop = app.stream('kraken', 'BTC_USDT', '4h', b => { got.push(b.time); stop() });
  await new Promise(r => setTimeout(r, 20));
  assert.equal(h.calls[0].since! % (4 * H), 0);
  assert.deepEqual(got, [h.calls[0].since! / 1000]);
});

test('stream: stop aborts the pending sleep, and a permanent failure is logged once', async () => {
  const h = harness(), signals: AbortSignal[] = [];
  const d = { ...h.d, sleep: async (ms: number, s?: AbortSignal) => { signals.push(s!); await new Promise(r => setTimeout(r, 0)) } };
  const app = createCcxtApp(d), warns: unknown[][] = [], warn = console.warn;
  console.warn = (...a: unknown[]) => { warns.push(a) };
  try {
    await app.markets('kraken');
    h.setRows(() => { throw Error('symbol gone') });
    const stop = app.stream('kraken', 'BTC_USDT', '1h', () => {});
    await new Promise(r => setTimeout(r, 40));
    assert.ok(signals.length > 2 && warns.length === 1 && /symbol gone/.test(String(warns[0][4])));
    assert.equal(signals[0].aborted, false);
    stop();
    assert.ok(signals.every(s => s === signals[0]) && signals[0].aborted);
  } finally { console.warn = warn }
});

test('tickers use our symbols', async () => {
  const app = createCcxtApp(harness().d);
  assert.deepEqual(await app.tickers('okx'), [{ sym: 'BTC_USDT', last: 5, change: 1, quoteVolume: 9 }]);
});

test('exchange list: curated defaults, user extras stored per device, ids validated', () => {
  const m = new Map<string, string>(), kv = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) } };
  assert.deepEqual(exchangeIds(kv), DEFAULT_EXCHANGES);
  assert.ok(['binance', 'bybit', 'okx', 'kraken', 'coinbase', 'kucoin', 'bitget', 'gate', 'mexc', 'htx', 'bitfinex', 'bitstamp', 'gemini', 'cryptocom'].every(x => DEFAULT_EXCHANGES.includes(x)));
  setExtra(kv, 'bitso', true); setExtra(kv, 'bitso', true);
  assert.deepEqual(extraExchanges(kv), ['bitso']); assert.ok(exchangeIds(kv).includes('bitso'));
  setExtra(kv, 'bitso', false); assert.deepEqual(extraExchanges(kv), []);
  assert.throws(() => setExtra(kv, 'Bad Id', true));
  m.set(EXTRA_KEY, '{"x":1}'); assert.deepEqual(extraExchanges(kv), []);   // junk is ignored
  m.set(EXTRA_KEY, '["ok1","BAD!",3]'); assert.deepEqual(extraExchanges(kv), ['ok1']);
});

test('hook routing: only when active, only CCXT exchanges, never BINANCE: or other sources', async () => {
  const h = harness(); h.setRows(() => [[ms(3600), 1, 1, 1, 1, 1]]);
  const app = createCcxtApp(h.d);
  let on = false;
  const hook = ccxtBarHooks(() => app, () => on, ex => ccxtOf(ex, ['bybit', 'okx']));
  assert.equal(hook.fetch('BYBIT:BTC_USDT.P', '1h'), null);   // desktop / web / server mode
  assert.equal(hook.stream('BYBIT:BTC_USDT.P', '1h', () => {}), null);
  on = true;
  assert.equal(hook.fetch('BTCUSDT', '1h'), null);            // bare Binance keeps its own path
  assert.equal(hook.fetch('BINANCE:BTCUSDT', '1h'), null);
  assert.equal(hook.fetch('FX:EURUSD', '1h'), null);
  assert.equal(hook.fetch('CRYPTOCAP:BTC.D', '1h'), null);
  assert.equal(hook.fetch('NOBITEX:BTCUSDT', '1h'), null);
  assert.equal((await hook.fetch('BYBIT:BTC_USDT', '1h'))!.length, 1);
  assert.equal(ccxtOf('krakenfutures', []), 'krakenfutures');   // catalog ids resolve to their CCXT id
  const stop = hook.stream('OKX:BTC_USDT', '1h', () => {});
  assert.equal(typeof stop, 'function'); stop!();
});

test('search entries: in-app markets have the server shape and ranks across exchanges', async () => {
  const app = createCcxtApp(harness().d);
  const entries = [...(await app.marketList('bybit')).map(m => ({ ex: 'bybit', ...m })), ...(await app.marketList('okx')).map(m => ({ ex: 'okx', ...m }))];
  assert.deepEqual(Object.keys(entries[0]).sort(), ['base', 'ex', 'quote', 'sym', 'type']);
  const r = rank(entries, 'btcusdt');
  assert.ok(r.length >= 6 && new Set(r.map(e => e.ex)).size === 2);
  assert.equal(toSymbol(r[0]), `${r[0].ex.toUpperCase()}:${r[0].sym}`);
  assert.equal(rank(entries, 'btcusdt.p').every(e => e.type === 'swap'), true);
});
