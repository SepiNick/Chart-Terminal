import test from 'node:test';
import assert from 'node:assert/strict';
import { searchAll, retryFailed } from './searchall.ts';
import type { RemoteMarket } from './data.ts';

test('one failing source does not break the list; sources load once and results appear when ready', async () => {
  const cache = new Map<string, RemoteMarket[]>(), calls: string[] = [];
  const fetch = async (ex: string) => { calls.push(ex); if (ex === 'okx') throw Error('down'); return [{ sym: 'BTC_USDT.P', base: 'BTC', quote: 'USDT', type: 'swap' }] };
  let done: () => void; const ticked = new Promise<void>(r => (done = r)); let n = 0;
  const o = { ids: ['bybit', 'okx', 'binance'], isCcxt: () => true, binance: ['BTCUSDT'], extra: [], cache, fetch, tick: () => { if (++n === 2) done() } };
  const first = searchAll('btcusdt', o);
  assert.equal(first.loading, 2);
  assert.equal(first.list[0].ex, 'binance');            // bare Binance spot is available at once
  await ticked;
  const r = searchAll('btcusdt', o);
  assert.deepEqual(r.list.map(x => x.ex), ['binance', 'bybit']);
  assert.equal(r.failed, 1);
  assert.equal(r.loading, 0);
  assert.deepEqual(calls.sort(), ['bybit', 'okx']);      // binance is the native list, not fetched; no second fetch
});

const mk = (ids: string[], fetch: (ex: string) => Promise<RemoteMarket[]>, tick: () => void, kind?: 'perp') =>
  ({ ids, isCcxt: () => true, kind, binance: ['BTCUSDT'], extra: [], cache: new Map<string, RemoteMarket[]>(), fetch, tick });
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() };

test('kind filter keeps only that type', async () => {
  const fetch = async () => [{ sym: 'BTC_USDT', base: 'BTC', quote: 'USDT', type: 'spot' }, { sym: 'BTC_USDT.P', base: 'BTC', quote: 'USDT', type: 'swap' }];
  const o = mk(['kucoin'], fetch, () => {}, 'perp');
  searchAll('btcusdt', o); await flush();
  const r = searchAll('btcusdt', o);
  assert.deepEqual(r.list.map(x => `${x.ex}:${x.sym}`), ['kucoin:BTC_USDT.P']);
});

test('retryFailed makes a failed source load again', async () => {
  let n = 0;
  const o = mk(['gate'], async () => { n++; throw Error('down') }, () => {});
  searchAll('btc', o); await flush();
  assert.equal(searchAll('btc', o).failed, 1); await flush();
  assert.equal(n, 1);                                    // not retried while failed
  retryFailed(); searchAll('btc', o); await flush();
  assert.equal(n, 2);
});

test('a source that never answers is marked failed after 15 s', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const o = mk(['mexc'], () => new Promise<RemoteMarket[]>(() => {}), () => {});
  assert.equal(searchAll('btc', o).loading, 1);
  t.mock.timers.tick(15000); await flush();
  const r = searchAll('btc', o);
  assert.equal(r.failed, 1);
  assert.equal(r.loading, 0);
});
