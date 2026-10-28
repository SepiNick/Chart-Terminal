import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newAccount, placeOrder, placeOco, modifyOrder, onPrice, closePosition, equity, type Account } from './trading.ts';
import { PaperBroker } from './broker/paper.ts';

const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);

test('market round trip realizes PnL minus fees', () => {
  const a = newAccount(1000);
  placeOrder(a, { sym: 'X', side: 'buy', type: 'market', qty: 2 }, 100, 0);
  closePosition(a, 'X', 110, 1);
  near(a.cash, 1000 + 20 - 0.2 - 0.22);
  assert.deepEqual(a.pos, {});
});

test('limit and stop trigger on the correct side', () => {
  const a = newAccount();
  assert.equal(placeOrder(a, { sym: 'X', side: 'buy', type: 'limit', qty: 1, price: 105 }, 100, 0)?.includes('below'), true);
  placeOrder(a, { sym: 'X', side: 'buy', type: 'limit', qty: 1, price: 95 }, 100, 0);
  placeOrder(a, { sym: 'X', side: 'buy', type: 'stop', qty: 1, price: 110 }, 100, 0);
  assert.equal(onPrice(a, 'X', 99, 1).length, 0);
  const f = onPrice(a, 'X', 94, 2);
  assert.equal(f.length, 1); near(f[0].px, 94); // limit filled at better price on a gap
  assert.equal(onPrice(a, 'X', 112, 3)[0].px, 112); // stop slips to market
  assert.equal(a.pos.X.qty, 2);
});

test('bracket: take-profit fill cancels the stop-loss (OCO)', () => {
  const a = newAccount(1000);
  placeOrder(a, { sym: 'X', side: 'buy', type: 'market', qty: 1, tp: 120, sl: 90 }, 100, 0);
  assert.equal(a.orders.length, 2);
  onPrice(a, 'X', 120, 1);
  assert.equal(a.orders.length, 0);
  assert.deepEqual(a.pos, {});
  near(a.cash, 1000 + 20 - 0.1 - 0.12);
});

test('short flip and equity', () => {
  const a = newAccount(1000);
  placeOrder(a, { sym: 'X', side: 'buy', type: 'market', qty: 1 }, 100, 0);
  placeOrder(a, { sym: 'X', side: 'sell', type: 'market', qty: 3 }, 100, 1);
  assert.equal(a.pos.X.qty, -2); near(a.pos.X.avg, 100);
  near(equity(a, { X: 90 }).unrealized, 20);
});

test('stop-limit: rests until the trigger, then fills as a limit', () => {
  const a = newAccount();
  assert.match(placeOrder(a, { sym: 'X', side: 'buy', type: 'stop_limit', qty: 1, stopPx: 95, price: 96 }, 100, 0)!, /above/);
  assert.equal(placeOrder(a, { sym: 'X', side: 'buy', type: 'stop_limit', qty: 1, stopPx: 105, price: 106 }, 100, 0), null);
  assert.equal(onPrice(a, 'X', 104, 1).length, 0);
  assert.equal(onPrice(a, 'X', 108, 2).length, 0);   // triggered, but above the limit
  assert.equal(a.orders[0].triggered, true);
  const f = onPrice(a, 'X', 105.5, 3);
  assert.equal(f.length, 1); near(f[0].px, 105.5); assert.equal(f[0].orderType, 'stop_limit');
});

test('trailing stop (pct and amount) only tightens and fills at market', () => {
  const a = newAccount();
  placeOrder(a, { sym: 'X', side: 'buy', type: 'market', qty: 2 }, 100, 0);
  placeOrder(a, { sym: 'X', side: 'sell', type: 'trailing_stop', qty: 1, trail: { pct: 5 }, reduceOnly: true }, 100, 0);
  placeOrder(a, { sym: 'X', side: 'sell', type: 'trailing_stop', qty: 1, trail: { amount: 3 }, reduceOnly: true }, 100, 0);
  near(a.orders[0].price!, 95); near(a.orders[1].price!, 97);
  onPrice(a, 'X', 120, 1);
  near(a.orders[0].price!, 114); near(a.orders[1].price!, 117);
  onPrice(a, 'X', 118, 2);                    // pull-back: levels stay
  near(a.orders[0].price!, 114); near(a.orders[1].price!, 117);
  const f = onPrice(a, 'X', 116, 3);
  assert.equal(f.length, 1); near(f[0].px, 116); assert.equal(a.pos.X.qty, 1);
  assert.match(placeOrder(a, { sym: 'X', side: 'sell', type: 'trailing_stop', qty: 1, trail: {} }, 100, 0)!, /Trailing/);
});

test('standalone OCO: one fill cancels the other; all-or-nothing placement', () => {
  const a = newAccount();
  assert.match(placeOco(a, [{ sym: 'X', side: 'buy', type: 'limit', qty: 1, price: 90 }, { sym: 'X', side: 'buy', type: 'stop', qty: 1, price: 95 }], 100, 0)!, /above/);
  assert.equal(a.orders.length, 0); assert.equal(a.nextId, 1);
  assert.equal(placeOco(a, [{ sym: 'X', side: 'buy', type: 'limit', qty: 1, price: 90 }, { sym: 'X', side: 'buy', type: 'stop', qty: 1, price: 110 }], 100, 0), null);
  assert.equal(a.orders.length, 2);
  onPrice(a, 'X', 111, 1);
  assert.equal(a.orders.length, 0); assert.equal(a.pos.X.qty, 1);
});

test('reduce-only market needs an opposite position and never flips', () => {
  const a = newAccount();
  assert.match(placeOrder(a, { sym: 'X', side: 'sell', type: 'market', qty: 1, reduceOnly: true }, 100, 0)!, /Reduce-only/);
  placeOrder(a, { sym: 'X', side: 'buy', type: 'market', qty: 1 }, 100, 0);
  placeOrder(a, { sym: 'X', side: 'sell', type: 'market', qty: 5, reduceOnly: true }, 100, 1);
  assert.deepEqual(a.pos, {});
});

test('modify: moves prices, adds/removes TP/SL, rejects invalid changes untouched', () => {
  const a = newAccount();
  placeOrder(a, { sym: 'X', side: 'buy', type: 'limit', qty: 1, price: 90, sl: 85 }, 100, 0);
  const id = a.orders[0].id;
  assert.equal(modifyOrder(a, id, { price: 92, tp: 110, sl: null }, 100), null);
  assert.deepEqual([a.orders[0].price, a.orders[0].tp, a.orders[0].sl], [92, 110, undefined]);
  assert.match(modifyOrder(a, id, { price: 105 }, 100)!, /below/);
  assert.equal(a.orders[0].price, 92);
  assert.match(modifyOrder(a, id, { stopPrice: 1 }, 100)!, /no stop/);
  assert.equal(modifyOrder(a, 999, { price: 1 }, 100), 'Order not found');
  // A bracket's stop-loss leg is a stop order: drag it via stopPrice.
  placeOrder(a, { sym: 'Y', side: 'buy', type: 'market', qty: 1, tp: 120, sl: 90 }, 100, 0);
  const sl = a.orders.find(o => o.sym === 'Y' && o.type === 'stop')!;
  assert.equal(modifyOrder(a, sl.id, { stopPrice: 95 }, 100), null);
  assert.equal(a.orders.find(o => o.id === sl.id)!.price, 95);
});

test('PaperBroker: place, OCO, modify, cancel, close through the Broker API', async () => {
  let a = newAccount(1000), saves = 0, px = 100;
  const b = new PaperBroker({ acct: () => a, save: () => saves++, px: () => px, now: () => 1 });
  const seen: number[] = []; b.onChange(s => seen.push(s.orders.length));
  const m = await b.place({ sym: 'X', side: 'buy', kind: 'market', qty: 2, tp: 120, sl: 90 });
  assert.equal(m.status, 'filled'); assert.equal(m.avgPrice, 100);
  const st = b.state();
  assert.deepEqual(st.positions, [{ sym: 'X', qty: 2, entry: 100, mark: 100, upnl: 0 }]);
  assert.deepEqual(st.orders.map(o => [o.kind, o.price, o.stopPrice, o.reduceOnly]), [['limit', 120, undefined, true], ['stop', undefined, 90, true]]);
  assert.equal(st.orders[0].ocoGroup, st.orders[1].ocoGroup);
  await b.modify(st.orders[1].id, { stopPrice: 95 });
  assert.equal(b.state().orders[1].stopPrice, 95);
  await assert.rejects(b.modify(st.orders[1].id, { stopPrice: 101 }), /below market/);
  const oco = await b.place({ sym: 'X', side: 'sell', kind: 'limit', qty: 1, price: 130, ocoWith: { sym: 'X', side: 'sell', kind: 'stop_limit', qty: 1, stopPrice: 80, price: 79 } });
  assert.equal(oco.status, 'open'); assert.equal(b.state().orders.filter(o => o.ocoGroup === oco.id).length, 2);
  await b.cancel(oco.id);
  await assert.rejects(b.cancel('999'), /not found/);
  await assert.rejects(b.place({ sym: 'X', side: 'buy', kind: 'limit', qty: 1, price: 105 }), /below market/);
  await b.closePosition('X');
  assert.deepEqual(b.state().positions, []);
  await assert.rejects(b.closePosition('X'), /No X position/);
  px = 0; await assert.rejects(b.place({ sym: 'X', side: 'buy', kind: 'market', qty: 1 }), /No price/);
  assert.equal(saves, 5); assert.equal(seen.length, 5);
  px = 100; a = newAccount();
  const tr = await b.place({ sym: 'Y', side: 'sell', kind: 'trailing_stop', qty: 1, trail: { pct: 1 } });
  assert.equal(tr.stopPrice, 99); assert.deepEqual(tr.trail, { pct: 1 });
});

test('accounts saved before phase 6 still load and trade', () => {
  const old = JSON.parse('{"cash":9000,"pos":{"X":{"qty":1,"avg":100}},"orders":[{"id":3,"sym":"X","side":"sell","type":"limit","qty":1,"price":120,"oco":3,"reduceOnly":true}],"fills":[],"nextId":5}') as Account;
  assert.equal(onPrice(old, 'X', 121, 1).length, 1);
  near(old.cash, 9000 + 21 - 0.121);   // sell limit fills at the better gap price
});
