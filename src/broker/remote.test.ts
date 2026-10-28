import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RemoteBroker, syncAccounts, deleteAccount, tripReset, type Api } from './remote.ts';
import { allBrokers, brokerById, setActiveBroker, activeBroker } from './registry.ts';
import { dispatchServer } from '../sync.ts';
import { DEFAULT_GUARD, type BrokerAccount, type BrokerOrder, type BrokerState } from './types.ts';

const acct = (id: string, x: Partial<BrokerAccount> = {}): BrokerAccount => ({ id, broker: 'bybit', label: `Acct ${id}`, market: 'futures', testnet: true, status: 'active', guard: DEFAULT_GUARD, ...x });
const state = (account: string, updated: number, orders: BrokerOrder[] = []): BrokerState => ({ account, balances: [{ asset: 'USDT', free: 1000, locked: 0 }], positions: [], orders, fills: [], updated });
const order = (id: string, x: Partial<BrokerOrder> = {}): BrokerOrder => ({ id, sym: 'BTCUSDT', side: 'buy', kind: 'limit', qty: 1, filled: 0, price: 100, status: 'open', created: 1, updated: 1, ...x });

/** Fake `api`: answers by "METHOD path" (null = 204), records every call. A function answer may throw. */
function fake(routes: Record<string, unknown>) {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const call = (async (path: string, init: { method?: string; body?: unknown } = {}) => {
    const method = init.method ?? (init.body === undefined ? 'GET' : 'POST');
    calls.push({ method, path, body: init.body });
    const r = routes[`${method} ${path}`];
    if (r === undefined) throw Object.assign(Error(`no route ${method} ${path}`), { status: 404 });
    return r === null ? undefined : typeof r === 'function' ? r(init.body) : structuredClone(r);
  }) as Api;
  return { call, calls };
}

test('refresh, place, modify and cancel merge into the local state at once', async () => {
  const f = fake({
    'GET /api/broker/a%2F1/state': state('a/1', 10, [order('o1')]),
    'POST /api/broker/a%2F1/orders': order('o2', { side: 'sell', price: 120 }),
    'PATCH /api/broker/a%2F1/orders/o1': order('o1', { price: 95 }),
    'DELETE /api/broker/a%2F1/orders/o2': null,
  });
  const b = new RemoteBroker(acct('a/1'), f.call);
  let seen = 0; b.onChange(() => seen++);
  assert.equal(b.state(), null);
  await b.refresh();
  assert.deepEqual(b.state()!.orders.map(o => o.id), ['o1']);
  const o2 = await b.place({ sym: 'BTCUSDT', side: 'sell', kind: 'limit', qty: 1, price: 120 });
  assert.equal(o2.id, 'o2');
  assert.deepEqual(b.state()!.orders.map(o => o.id), ['o1', 'o2']);
  await b.modify('o1', { price: 95 });
  assert.equal(b.state()!.orders.find(o => o.id === 'o1')!.price, 95);
  await b.cancel('o2');
  assert.deepEqual(b.state()!.orders.map(o => o.id), ['o1']);
  assert.equal(seen, 4);
  assert.equal(b.state()!.updated, 10);   // local merges keep the server's clock
  assert.deepEqual(f.calls.find(c => c.method === 'POST')!.body, { sym: 'BTCUSDT', side: 'sell', kind: 'limit', qty: 1, price: 120 });
});

test('errors reject with the account label and the server message; no status means unreachable', async () => {
  const b = new RemoteBroker(acct('x', { label: 'Bybit test' }), fake({ 'POST /api/broker/x/orders': () => { throw Object.assign(Error('Stop-loss required (requireStop)'), { status: 400 }) } }).call);
  await assert.rejects(b.place({ sym: 'BTCUSDT', side: 'buy', kind: 'market', qty: 1 }), (e: Error & { status?: number }) => e.message === 'Bybit test: Stop-loss required (requireStop)' && e.status === 400);
  const down = new RemoteBroker(acct('y', { label: 'OKX demo' }), (async () => { throw new TypeError('Failed to fetch') }) as Api);
  await assert.rejects(down.refresh(), /OKX demo: server not reachable/);
});

test('syncAccounts registers, updates and unregisters; WS pushes reach the right broker, stale ones are ignored', async () => {
  const f = fake({ 'GET /api/broker/s1/state': state('s1', 5), 'GET /api/broker/s2/state': state('s2', 5), 'DELETE /api/broker/accounts/s2': {} });
  syncAccounts([acct('s1'), acct('s2', { status: 'pending' })], f.call);
  await new Promise(r => setTimeout(r, 0));
  assert.ok(brokerById('s1') && brokerById('s2'));
  assert.equal(brokerById('s2')!.state()!.updated, 5);

  dispatchServer({ type: 'broker', account: 's1', state: state('s1', 9, [order('w1')]) });
  assert.deepEqual(brokerById('s1')!.state()!.orders.map(o => o.id), ['w1']);
  assert.equal(brokerById('s2')!.state()!.orders.length, 0);
  dispatchServer({ type: 'broker', account: 's1', state: state('s1', 7) });   // older than what we have
  assert.equal(brokerById('s1')!.state()!.updated, 9);

  const same = brokerById('s2');
  syncAccounts([acct('s1'), acct('s2', { status: 'active' })], f.call);
  assert.equal(brokerById('s2'), same);
  assert.equal(brokerById('s2')!.account.status, 'active');

  setActiveBroker('s2');
  await deleteAccount('s2', f.call);
  assert.equal(brokerById('s2'), undefined);
  assert.equal(activeBroker(), undefined);   // fell back to 'paper' (not registered in this test)
  syncAccounts([], f.call);
  assert.equal(allBrokers().length, 0);
});

test('tripped accounts reset at the next UTC midnight', () => {
  assert.equal(tripReset(Date.UTC(2026, 9, 21, 23, 59)), Date.UTC(2026, 9, 22));
  assert.equal(tripReset(Date.UTC(2026, 11, 31, 0, 1)), Date.UTC(2027, 0, 1));
});
