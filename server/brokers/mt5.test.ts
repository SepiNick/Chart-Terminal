import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deps } from '../mt5.ts';
import { mt5Adapter } from './mt5.ts';

test('MT5 adapter: refuses a real or hedging account, sends the token only on account calls, strips the exchange prefix', async () => {
  const calls: { url: string; token?: string; body?: string }[] = [];
  let acct = { demo: false, netting: true };
  deps.fetch = async (url, init) => {
    const h = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url, token: h['x-bridge-token'], body: init?.body as string | undefined });
    const path = new URL(url).pathname;
    const body = path === '/account' ? acct : path === '/balances' ? [{ asset: 'USD', free: 1000, locked: 0 }] : path === '/tick' ? { last: 1.1 } : path === '/order' ? { id: '7' } : {};
    return new Response(JSON.stringify(body));
  };
  const ad = mt5Adapter('TOKEN123');
  await assert.rejects(ad.balances(), /REAL account/);
  acct = { demo: true, netting: false };
  await assert.rejects(ad.balances(), /netting/);
  acct = { demo: true, netting: true };
  assert.deepEqual(await ad.balances(), [{ asset: 'USD', free: 1000, locked: 0 }]);
  assert.equal(await ad.price('MT5:EURUSD'), 1.1);
  await ad.place({ sym: 'MT5:EURUSD', side: 'buy', kind: 'market', qty: 1000 });
  const tick = calls.find(c => c.url.includes('/tick'))!, place = calls.at(-1)!;
  assert.ok(tick.url.endsWith('symbol=EURUSD') && !tick.token, 'market data needs no token');
  assert.equal(place.token, 'TOKEN123');
  assert.equal(JSON.parse(place.body!).sym, 'EURUSD');
  assert.equal(await ad.canWithdraw(), false);
  deps.fetch = async () => { throw Error('ECONNREFUSED') };
  await assert.rejects(ad.positions(), /bridge is not running/);
});
