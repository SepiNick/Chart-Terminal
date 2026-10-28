import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Balance, BrokerOrder, BrokerPosition } from '../../src/broker/types.ts';
import type { Adapter, Native } from './adapter.ts';

process.env.CT_DATA_DIR = mkdtempSync(join(tmpdir(), 'ct-brokers-'));
process.env.CT_NO_AUTOSTART = '1';
const B = await import('./index.ts');
const { secretGet } = await import('../core/secrets.ts');
const { db } = await import('../core/db.ts');

const KEY = 'AKTESTKEY0123456789', SECRET = 'SECRETVALUE9876543210';

/** A fake exchange: futures or spot, market orders fill at `px`, everything recorded. */
function fake(spot = false, native: ('stop' | 'stop_limit')[] = ['stop', 'stop_limit']) {
  let n = 0;
  const f = {
    px: 100, fail: '', withdraw: null as boolean | null, placeFail: '',
    balances: [{ asset: 'USDT', free: 10_000, locked: 0 }] as Balance[],
    positions: [] as BrokerPosition[], book: new Map<string, BrokerOrder>(), placed: [] as Native[], canceled: [] as string[],
  };
  const fill = (o: Native) => {
    if (spot) {
      const base = o.sym.replace(/USDT$/, ''), b = f.balances.find(x => x.asset === base) ?? (f.balances.push({ asset: base, free: 0, locked: 0 }), f.balances.at(-1)!);
      b.free += o.side === 'buy' ? o.qty : -o.qty;
      return;
    }
    const d = o.side === 'buy' ? o.qty : -o.qty, p = f.positions.find(x => x.sym === o.sym);
    if (p) { p.qty += d; if (!p.qty) f.positions.splice(f.positions.indexOf(p), 1) } else f.positions.push({ sym: o.sym, qty: d, entry: f.px });
  };
  const ad: Adapter = {
    hosts: ['testnet.example'], native: new Set(native), canEdit: false,
    async balances() { if (f.fail) throw Error(f.fail); return f.balances.map(b => ({ ...b })) },
    async positions() { return f.positions.map(p => ({ ...p })) },
    async openOrders() { return [...f.book.values()].filter(o => o.status === 'open') },
    async order(id) { const o = f.book.get(id); if (!o) throw Error('no such order'); return o },
    async fills() { return [] },
    async price() { return f.px },
    async place(o) {
      if (f.placeFail) throw Error(f.placeFail);
      f.placed.push(o);
      const id = `n${++n}`, mk = o.kind === 'market';
      const r: BrokerOrder = { id, sym: o.sym, side: o.side, kind: o.kind, qty: o.qty, filled: mk ? o.qty : 0, status: mk ? 'filled' : 'open', created: 0, updated: 0, ...(o.price ? { price: o.price } : {}), ...(o.stopPrice ? { stopPrice: o.stopPrice } : {}), ...(o.reduceOnly ? { reduceOnly: true } : {}) };
      f.book.set(id, r);
      if (mk) fill(o);
      return r;
    },
    async cancel(id) { f.canceled.push(id); const o = f.book.get(id); if (o) o.status = 'canceled' },
    async canWithdraw() { return f.withdraw },
    close() {},
  };
  return { f, ad };
}
const fakes = new Map<string, ReturnType<typeof fake>>();
let nextFake: ReturnType<typeof fake> | null = null;
B.deps.adapter = a => { let x = fakes.get(a.id); if (!x) { x = nextFake ?? fake(); nextFake = null; fakes.set(a.id, x) } return x.ad };
let clock = Date.parse('2026-10-22T10:00:00Z');
B.deps.now = () => clock;

const input = (p: object = {}) => ({ broker: 'bybit', label: 'Bybit test', market: 'futures', apiKey: KEY, secret: SECRET, guard: { confirmedNoWithdraw: true }, ...p });
async function activeAccount(p: object = {}, fk = fake()) {
  const a = B.createAccount(input(p));
  nextFake = fk; fakes.delete(a.id);
  const r = await B.check(a.id);
  assert.ok(r.ok, JSON.stringify(r.items));
  await B.refresh(a.id);
  return { id: a.id, ...fk };
}
const rejects = (p: Promise<unknown>, re: RegExp) => assert.rejects(p, (e: Error & { status?: number }) => { assert.match(e.message, re); return true });

test('accounts CRUD: keys stored encrypted, never in responses or the accounts table', () => {
  const a = B.createAccount(input({ broker: 'okx', passphrase: 'PASSPHRASE123' }));
  assert.equal(a.status, 'pending'); assert.equal(a.testnet, true); assert.equal(a.hasPassphrase, true);
  assert.deepEqual(a.guard, { maxDailyLossPct: 3, maxPositionPct: 20, requireStop: true, confirmedNoWithdraw: true });
  const all = JSON.stringify([a, B.listAccounts(), B.updateAccount(a.id, { label: 'Renamed', guard: { maxPositionPct: 10 } })]);
  for (const s of [KEY, SECRET, 'PASSPHRASE123']) assert.ok(!all.includes(s), 'secret leaked into a response');
  const raw = JSON.stringify(db.prepare('SELECT * FROM broker_accounts').all());
  assert.ok(!raw.includes(KEY) && !raw.includes(SECRET));
  assert.equal(secretGet(`broker:${a.id}:apiKey`), KEY);
  assert.equal(secretGet(`broker:${a.id}:passphrase`), 'PASSPHRASE123');
  assert.equal(B.listAccounts().find(x => x.id === a.id)!.label, 'Renamed');
  B.deleteAccount(a.id);
  assert.equal(secretGet(`broker:${a.id}:apiKey`), null);
  assert.equal(secretGet(`broker:${a.id}:secret`), null);
  assert.ok(!B.listAccounts().some(x => x.id === a.id));
});

test('account validation', () => {
  assert.throws(() => B.createAccount(input({ broker: 'kucoin', market: 'spot' })), /KuCoin is not available/);
  assert.throws(() => B.createAccount(input({ broker: 'okx' })), /passphrase/);
  assert.throws(() => B.createAccount(input({ broker: 'binance' })), /spot/);
  assert.throws(() => B.createAccount(input({ extra: 1 })), /Unknown field/);
  assert.throws(() => B.createAccount(input({ apiKey: 'has space' })), /apiKey/);
  assert.throws(() => B.createAccount(input({ guard: { maxDailyLossPct: -1 } })), /0–100/);
});

test('guardian check: PASS/FAIL items, activation only when all pass, errors are key-free', async () => {
  const a = B.createAccount(input({ guard: { confirmedNoWithdraw: false } }));
  const fk = fake(); nextFake = fk;
  let r = await B.check(a.id);
  assert.equal(r.ok, false);
  assert.deepEqual(r.items.filter(i => !i.ok).map(i => i.id), ['withdraw', 'confirm']);
  assert.equal(B.listAccounts().find(x => x.id === a.id)!.status, 'pending');
  await rejects(B.placeOrder(a.id, { sym: 'BTCUSDT', side: 'buy', kind: 'market', qty: 1, sl: 90 }), /pending/);

  B.updateAccount(a.id, { guard: { confirmedNoWithdraw: true, maxDailyLossPct: 0 } });
  r = await B.check(a.id);
  assert.deepEqual(r.items.filter(i => !i.ok).map(i => i.id), ['dailyLoss']);

  B.updateAccount(a.id, { guard: { maxDailyLossPct: 3 } });
  fk.f.withdraw = true;
  r = await B.check(a.id);
  assert.deepEqual(r.items.filter(i => !i.ok).map(i => i.id), ['withdraw'], 'exchange-reported withdraw permission fails even when confirmed');

  fk.f.withdraw = null;
  fk.f.fail = `bybit GET https://api-testnet.bybit.com/v5/account/wallet-balance?api_key=${KEY}&sign=deadbeef 10003 invalid key ${SECRET}`;
  r = await B.check(a.id);
  const key = r.items.find(i => i.id === 'key')!;
  assert.equal(key.ok, false);
  assert.ok(!JSON.stringify(r).includes(KEY) && !JSON.stringify(r).includes(SECRET) && !JSON.stringify(r).includes('deadbeef'), key.detail);

  fk.f.fail = '';
  r = await B.check(a.id);
  assert.equal(r.ok, true);
  assert.deepEqual(r.items.map(i => i.id), ['testnet', 'key', 'withdraw', 'confirm', 'dailyLoss', 'positionCap', 'stop']);
  assert.equal(B.listAccounts().find(x => x.id === a.id)!.status, 'active');
  B.updateAccount(a.id, { guard: { maxPositionPct: 0 } });
  assert.equal(B.listAccounts().find(x => x.id === a.id)!.status, 'pending', 'loosening below the guardian bar deactivates');

  // RISK_RULES #1: the stop-loss can't be switched off on an active account.
  B.updateAccount(a.id, { guard: { maxPositionPct: 20 } });
  assert.equal((await B.check(a.id)).ok, true);
  B.updateAccount(a.id, { guard: { requireStop: false } });
  assert.equal(B.listAccounts().find(x => x.id === a.id)!.status, 'pending', 'turning the stop-loss off deactivates');
  assert.deepEqual((await B.check(a.id)).items.filter(i => !i.ok).map(i => i.id), ['stop']);
});

test('guard: requireStop, position cap, reduce-only always allowed', async () => {
  const { id, f } = await activeAccount();
  await rejects(B.placeOrder(id, { sym: 'BTCUSDT', side: 'buy', kind: 'market', qty: 1 }), /stop-loss is required/);
  await rejects(B.placeOrder(id, { sym: 'BTCUSDT', side: 'buy', kind: 'market', qty: 30, sl: 90 }), /Position cap/);   // 3000 > 20% of 10000
  await rejects(B.placeOrder(id, { sym: 'BTCUSDT', side: 'buy', kind: 'market', qty: 1, sl: 101 }), /Stop loss must be below/);
  const o = await B.placeOrder(id, { sym: 'BTCUSDT', side: 'buy', kind: 'market', qty: 15, sl: 90 });
  assert.equal(o.sl, 90);
  await B.refresh(id);
  assert.equal(f.positions[0].qty, 15);
  await rejects(B.placeOrder(id, { sym: 'BTCUSDT', side: 'buy', kind: 'limit', price: 99, qty: 10, sl: 90 }), /Position cap/, );
  await B.placeOrder(id, { sym: 'BTCUSDT', side: 'sell', kind: 'market', qty: 5 });   // reduces: no stop needed
  await B.refresh(id);
  assert.equal(f.positions[0].qty, 10);
});

test('circuit breaker trips at the daily loss limit, allows only reducing orders, resets next UTC day', async () => {
  clock = Date.parse('2026-10-23T08:00:00Z');
  const { id, f } = await activeAccount();
  assert.equal((await B.getState(id)).dayStartEquity, 10_000);
  await B.placeOrder(id, { sym: 'BTCUSDT', side: 'buy', kind: 'market', qty: 5, sl: 90 });
  f.balances[0].free = 9_650;   // −3.5% today
  await B.refresh(id);
  assert.equal(B.listAccounts().find(x => x.id === id)!.status, 'tripped');
  await rejects(B.placeOrder(id, { sym: 'BTCUSDT', side: 'buy', kind: 'market', qty: 1, sl: 90 }), /Circuit breaker tripped/);
  await B.placeOrder(id, { sym: 'BTCUSDT', side: 'sell', kind: 'market', qty: 2 });
  await B.placeOrder(id, { sym: 'BTCUSDT', side: 'sell', kind: 'limit', price: 120, qty: 1, reduceOnly: true });
  clock = Date.parse('2026-10-24T00:00:05Z');
  const st = await B.refresh(id);
  assert.equal(B.listAccounts().find(x => x.id === id)!.status, 'active');
  assert.equal(st.dayStartEquity, 9_650, 'new day, new snapshot');
});

test('emulated trailing stop follows the best price and fires a market order', async () => {
  const { id, f } = await activeAccount();
  await B.placeOrder(id, { sym: 'BTCUSDT', side: 'buy', kind: 'market', qty: 10, sl: 80 });
  await B.refresh(id); await B.refresh(id);   // fill, then the bracket's native stop goes out
  const t = await B.placeOrder(id, { sym: 'BTCUSDT', side: 'sell', kind: 'trailing_stop', qty: 10, trail: { pct: 1 }, reduceOnly: true });
  assert.ok(t.id.startsWith('emu:')); assert.match(t.error!, /Emulated by the server \(trailing stop\)/); assert.equal(t.stopPrice, 99);
  f.px = 110; let st = await B.refresh(id);
  assert.equal(st.orders.find(o => o.id === t.id)!.stopPrice, 108.9);
  f.px = 109; await B.refresh(id);
  const before = f.placed.length;
  assert.ok(st.orders.some(o => o.id === t.id));
  f.px = 108.5; st = await B.refresh(id);
  assert.deepEqual(f.placed.slice(before), [{ sym: 'BTCUSDT', side: 'sell', kind: 'market', qty: 10, reduceOnly: true }]);
  assert.ok(!st.orders.some(o => o.id === t.id));
});

test('emulated OCO: the first leg to trigger cancels the other', async () => {
  const { id, f } = await activeAccount();
  await B.placeOrder(id, { sym: 'BTCUSDT', side: 'buy', kind: 'market', qty: 10, sl: 80 });
  await B.refresh(id);
  const leg = await B.placeOrder(id, { sym: 'BTCUSDT', side: 'sell', kind: 'limit', price: 120, qty: 10, reduceOnly: true, ocoWith: { sym: 'BTCUSDT', side: 'sell', kind: 'stop', stopPrice: 90, qty: 10, reduceOnly: true } });
  let st = await B.refresh(id);
  const legs = st.orders.filter(o => o.ocoGroup === leg.ocoGroup);
  assert.equal(legs.length, 2); assert.ok(legs.every(o => /Emulated/.test(o.error!)));
  const before = f.placed.length;
  f.px = 121; st = await B.refresh(id);
  assert.deepEqual(f.placed.slice(before), [{ sym: 'BTCUSDT', side: 'sell', kind: 'limit', qty: 10, price: 120, reduceOnly: true }]);
  assert.equal(st.orders.filter(o => o.ocoGroup === leg.ocoGroup).length, 0);
  f.px = 85; await B.refresh(id);
  assert.equal(f.placed.length, before + 1, 'the stop leg is gone');
});

test('bracket: after the entry fills, a native SL and an emulated TP go out as an OCO pair; persisted across a restart', async () => {
  const { id, f } = await activeAccount();
  const e = await B.placeOrder(id, { sym: 'BTCUSDT', side: 'buy', kind: 'limit', price: 99, qty: 10, tp: 120, sl: 90 });
  let st = await B.refresh(id);
  assert.deepEqual([st.orders[0].tp, st.orders[0].sl], [120, 90], 'pending bracket shown on the entry');
  f.book.get(e.id)!.status = 'filled'; f.book.get(e.id)!.filled = 10; f.positions.push({ sym: 'BTCUSDT', qty: 10, entry: 99 });
  st = await B.refresh(id);
  assert.deepEqual(f.placed.at(-1), { sym: 'BTCUSDT', side: 'sell', kind: 'stop', qty: 10, stopPrice: 90, reduceOnly: true });
  st = await B.refresh(id);
  const sl = st.orders.find(o => o.kind === 'stop')!, tp = st.orders.find(o => o.kind === 'limit' && o.id.startsWith('emu:'))!;
  assert.ok(sl && tp && sl.ocoGroup && sl.ocoGroup === tp.ocoGroup);

  // Restart: a fresh module instance loads the emulated TP from SQLite.
  const again = './index.ts?restart';   // a second module instance over the same database
  const B2 = await import(again) as typeof B;
  B2.deps.adapter = B.deps.adapter; B2.deps.now = B.deps.now;
  st = await B2.refresh(id);
  assert.ok(st.orders.some(o => o.id === tp.id), 'emulated TP survived the restart');
  f.px = 121; await B2.refresh(id);
  assert.deepEqual(f.placed.at(-1), { sym: 'BTCUSDT', side: 'sell', kind: 'limit', qty: 10, price: 120, reduceOnly: true });
  assert.ok(f.canceled.includes(sl.id), 'native SL canceled when the TP fired');
});

test('stop kinds the exchange lacks are emulated; modify = cancel+replace with a clear failure', async () => {
  const { id, f } = await activeAccount({ broker: 'binance', market: 'spot' }, fake(true, ['stop_limit']));
  f.balances.push({ asset: 'BTC', free: 5, locked: 0 });
  await B.refresh(id);
  const s = await B.placeOrder(id, { sym: 'BTCUSDT', side: 'sell', kind: 'stop', stopPrice: 95, qty: 2 });
  assert.match(s.error!, /Emulated by the server \(stop\)/);
  const sl = await B.placeOrder(id, { sym: 'BTCUSDT', side: 'sell', kind: 'stop_limit', stopPrice: 95, price: 94, qty: 2 });
  assert.ok(!sl.id.startsWith('emu:'), 'stop-limit is native here');
  await B.refresh(id);
  const moved = await B.modifyOrder(id, sl.id, { stopPrice: 96, price: 95 });
  assert.ok(f.canceled.includes(sl.id) && moved.id !== sl.id && moved.stopPrice === 96);
  await B.refresh(id);
  f.placeFail = 'insufficient balance';
  await rejects(B.modifyOrder(id, moved.id, { price: 94.5 }), /canceled but its replacement failed/);
  f.placeFail = '';
  const m2 = await B.modifyOrder(id, s.id, { stopPrice: 97 });
  assert.equal(m2.stopPrice, 97);
  await B.cancelOrder(id, s.id);
  assert.ok(!(await B.refresh(id)).orders.some(o => o.id === s.id));
});

// trade-guardian review fixes (RISK_RULES #1, #3, #4)
test('guardian fixes: SL can\'t be removed, resting orders count toward the cap, price patches re-check, spot "reduce-only" buys are still guarded', async () => {
  // #1: a stop-loss can't be patched away while requireStop is on.
  const a = await activeAccount();
  const entry = await B.placeOrder(a.id, { sym: 'BTCUSDT', side: 'buy', kind: 'limit', price: 99, qty: 15, sl: 90 });
  await rejects(B.modifyOrder(a.id, entry.id, { sl: null }), /stop-loss is required/);

  // #3: the resting 15 @ 99 counts, so another 10 would exceed 20% of 10 000.
  await rejects(B.placeOrder(a.id, { sym: 'BTCUSDT', side: 'buy', kind: 'limit', price: 99, qty: 10, sl: 90 }), /Position cap/);

  // #3: moving a far limit toward the market raises its notional, so the cap is checked again.
  const b = await activeAccount();
  const far = await B.placeOrder(b.id, { sym: 'BTCUSDT', side: 'buy', kind: 'limit', price: 50, qty: 35, sl: 40 });   // 1750 notional: fits
  await B.refresh(b.id);
  await rejects(B.modifyOrder(b.id, far.id, { price: 99 }), /Position cap/);   // 35 × 99 = 3465 > 2000

  // #3/#4: an emulated spot buy flagged reduce-only, grown after placement, is checked when it fires.
  const spot = fake(true, ['stop_limit']);
  spot.f.balances.push({ asset: 'BTC', free: 5, locked: 0 });
  const c = await activeAccount({ broker: 'binance', market: 'spot' }, spot);
  await B.placeOrder(c.id, { sym: 'BTCUSDT', side: 'sell', kind: 'stop', stopPrice: 90, qty: 5 });   // protects the 5 BTC held
  const stop = await B.placeOrder(c.id, { sym: 'BTCUSDT', side: 'buy', kind: 'stop', stopPrice: 105, qty: 10, reduceOnly: true });
  assert.ok(stop.id.startsWith('emu:'));
  await B.modifyOrder(c.id, stop.id, { qty: 100 });
  const sent = c.f.placed.length;
  c.f.px = 106;
  const st = await B.refresh(c.id);
  assert.equal(c.f.placed.length, sent, 'nothing reached the exchange');
  const o = st.orders.find(x => x.id === stop.id)!;
  assert.equal(o.status, 'rejected'); assert.match(o.error!, /Position cap/);
});

test('spot protective sells always count as reducing, so a tripped breaker never blocks a stop', async () => {
  const { checkOrder } = await import('./risk.ts');
  const ctx = { status: 'tripped' as const, guard: { maxDailyLossPct: 3, maxPositionPct: 20, requireStop: true, confirmedNoWithdraw: true }, spot: true, pos: 5, spotFree: 3, price: 100, equity: 10_000, dayEquity: 9_600, dayStart: 10_000, hasStop: false, skipStop: true };
  // bracket SL sized at the filled qty while part of the coins is locked or went to a fee
  assert.deepEqual(checkOrder({ side: 'sell', qty: 5 }, ctx), { ok: true, reducing: true });
  // a native stop whose own coins are locked (free 0) being moved
  assert.deepEqual(checkOrder({ side: 'sell', qty: 5 }, { ...ctx, spotFree: 0 }), { ok: true, reducing: true });
  // buys are still blocked while tripped
  assert.equal(checkOrder({ side: 'buy', qty: 1, sl: 90 }, ctx).ok, false);
});

test('demoting an active account (stop-loss switched off) keeps protecting and showing its position', async () => {
  const spot = fake(true, ['stop_limit']);   // every SL emulated, like Binance spot
  const { id, f } = await activeAccount({ broker: 'binance', market: 'spot' }, spot);
  await B.placeOrder(id, { sym: 'BTCUSDT', side: 'buy', kind: 'market', qty: 5, sl: 90 });
  await B.refresh(id); await B.refresh(id);   // fill, then the bracket SL is armed
  B.updateAccount(id, { guard: { requireStop: false } });
  assert.equal(B.listAccounts().find(x => x.id === id)!.status, 'pending');
  const st = await B.getState(id);
  assert.ok(st.balances.some(b => b.asset === 'BTC' && b.free === 5), 'the position stays visible');
  await rejects(B.placeOrder(id, { sym: 'BTCUSDT', side: 'buy', kind: 'market', qty: 1, sl: 80 }), /pending/);   // no new risk
  const before = f.placed.length;
  f.px = 89; await B.refresh(id);
  assert.deepEqual(f.placed.slice(before).map(o => [o.side, o.qty]), [['sell', 5]], 'the emulated SL still fires');
  await B.placeOrder(id, { sym: 'BTCUSDT', side: 'sell', kind: 'market', qty: 0.1 }).catch(() => {});   // closing stays allowed (nothing left here)
});
