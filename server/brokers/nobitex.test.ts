import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nobitexAdapter } from './nobitex.ts';
import { MainnetRefused } from './safety.ts';

// Response shapes as documented by Nobitex (apiv2 docs), recorded here so no test touches the network.
const RESP: Record<string, unknown> = {
  'POST /users/wallets/list': { status: 'ok', wallets: [
    { currency: 'rls', balance: '50000000', blockedBalance: '10000000', activeBalance: '40000000' },
    { currency: 'btc', balance: '0.5', blockedBalance: '0', activeBalance: '0.5' },
    { currency: 'eth', balance: '0', blockedBalance: '0', activeBalance: '0' },
  ] },
  'GET /market/stats?srcCurrency=btc&dstCurrency=rls': { status: 'ok', stats: { 'btc-rls': { latest: '65000000000' } } },
  'POST /market/orders/add': { status: 'ok', order: { id: 25, type: 'buy', execution: 'Limit', srcCurrency: 'btc', dstCurrency: 'rls', price: '64000000000', amount: '0.01', matchedAmount: '0', averagePrice: '0', status: 'Active', created_at: '2026-10-22T10:00:00+00:00' } },
  'POST /market/orders/list': { status: 'ok', orders: [{ id: 26, type: 'sell', execution: 'StopLimit', srcCurrency: 'btc', dstCurrency: 'usdt', price: '60000', stopPrice: '60100', amount: '0.1', matchedAmount: '0.02', status: 'Inactive', created_at: '2026-10-22T10:00:00+00:00' }] },
  'POST /market/orders/update-status': { status: 'ok', updatedStatus: 'Canceled' },
};

function recorder(override?: unknown) {
  const calls: { url: string; method: string; headers: Record<string, string>; body?: unknown }[] = [];
  const fetchFn = async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined });
    const path = url.replace('https://testnetapiv2.nobitex.ir', '');
    return { status: 200, json: async () => override ?? RESP[`${init.method} ${path}`] ?? { status: 'failed', message: 'unknown endpoint' } };
  };
  return { calls, fetchFn };
}

test('Nobitex: token auth on the testnet host, Rial ↔ Toman, request shapes', async () => {
  const r = recorder(), nx = nobitexAdapter('TOKEN-abc', r.fetchFn);
  assert.deepEqual(nx.hosts, ['testnetapiv2.nobitex.ir']);

  assert.deepEqual(await nx.balances(), [{ asset: 'IRT', free: 4_000_000, locked: 1_000_000 }, { asset: 'BTC', free: 0.5, locked: 0 }]);
  assert.equal(r.calls[0].headers.authorization, 'Token TOKEN-abc');
  assert.equal(r.calls[0].headers['content-type'], 'application/json');
  assert.equal(r.calls[0].url, 'https://testnetapiv2.nobitex.ir/users/wallets/list');

  assert.equal(await nx.price('BTCIRT'), 6_500_000_000, 'Rial price ÷ 10 = Toman');

  const o = await nx.place({ sym: 'BTCIRT', side: 'buy', kind: 'limit', qty: 0.01, price: 6_400_000_000, clientId: 'c1' });
  assert.deepEqual(r.calls.at(-1)!.body, { type: 'buy', execution: 'limit', srcCurrency: 'btc', dstCurrency: 'rls', amount: '0.01', price: '64000000000', clientOrderId: 'c1' });
  assert.equal(r.calls.at(-1)!.method, 'POST');
  assert.equal(o.id, '25'); assert.equal(o.sym, 'BTCIRT'); assert.equal(o.price, 6_400_000_000); assert.equal(o.status, 'open'); assert.equal(o.kind, 'limit');

  await nx.place({ sym: 'BTCUSDT', side: 'sell', kind: 'stop', qty: 0.1, stopPrice: 60100 });
  assert.deepEqual(r.calls.at(-1)!.body, { type: 'sell', execution: 'stop_market', srcCurrency: 'btc', dstCurrency: 'usdt', amount: '0.1', stopPrice: '60100' });

  const [open] = await nx.openOrders();
  assert.deepEqual(r.calls.at(-1)!.body, { status: 'open', details: 2 });
  assert.deepEqual({ ...open, created: 0, updated: 0 }, { id: '26', sym: 'BTCUSDT', side: 'sell', kind: 'stop_limit', qty: 0.1, filled: 0.02, price: 60000, stopPrice: 60100, status: 'open', created: 0, updated: 0 });

  await nx.cancel('26', 'BTCUSDT');
  assert.deepEqual(r.calls.at(-1)!.body, { order: 26, status: 'canceled' });
  assert.ok(r.calls.every(c => c.url.startsWith('https://testnetapiv2.nobitex.ir/')));
});

test('Nobitex: API errors surface as readable messages; mainnet base refused', async () => {
  const r = recorder({ status: 'failed', code: 'InsufficientBalance', message: 'Insufficient balance' });
  await assert.rejects(nobitexAdapter('T', r.fetchFn).balances(), /Nobitex: Insufficient balance/);
  assert.throws(() => nobitexAdapter('T', r.fetchFn, 'https://api.nobitex.ir'), MainnetRefused);
  await assert.rejects(nobitexAdapter('T', r.fetchFn).place({ sym: 'BYBIT:BTC_USDT.P', side: 'buy', kind: 'market', qty: 1 }), /spot only/);
});
