import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describePlan, parseExitPlan, planError, resolvePlan } from './exits.ts';
import { newAccount, onPrice, placeOrder, type Account } from './trading.ts';

test('parse: the full form, and every way it can be wrong', () => {
  const p = parseExitPlan('sl 2%; tp 1R 50%, 3R 30%, 110 20%; be 1 +0.1%; trail 1% 2');
  assert.deepEqual(p, { sl: { pct: 2 }, targets: [{ at: { r: 1 }, qtyPct: 50 }, { at: { r: 3 }, qtyPct: 30 }, { at: { price: 110 }, qtyPct: 20 }], breakeven: { after: 1, offsetPct: 0.1 }, trail: { after: 2, pct: 1 } });
  assert.deepEqual(parseExitPlan('SL 98\nTP 2r').targets, [{ at: { r: 2 }, qtyPct: 100 }], 'one target defaults to 100%; case and newlines are fine');
  assert.deepEqual(parseExitPlan('sl 98; tp 2R 100%; trail 0.5 after 1').trail, { after: 1, amount: 0.5 });
  for (const [bad, msg] of [
    ['tp 2R 100%', /needs a stop/], ['sl 98', /needs targets/], ['sl 2R; tp 2R 100%', /not R/], ['sl 98; tp 2R, 3R', /add its share/], ['sl 98; tp 2R 60%, 3R 60%', /more than 100%/],
    ['sl 98; tp 2R 50', /end in %/], ['sl 98; tp 2R 100%; be 2', /target 2, but there is 1 target/], ['sl 98; tp 2R 100%; foo 1', /Unknown "foo"/], ['sl abc; tp 2R', /not a number/], ['sl 0; tp 2R', /above zero/],
    ['sl 98; sl 97; tp 2R', /Only one "sl"/], ['sl 98; tp 2R; trail 1% x', /"trail" is like/],
  ] as const) assert.throws(() => parseExitPlan(bad), msg, bad);
});

test('resolve: prices from percent, R multiples and absolute levels, long and short; sides validated', () => {
  const p = parseExitPlan('sl 2%; tp 1R 50%, 3% 25%, 110 25%');
  const long = resolvePlan(p, 1, 100);
  assert.deepEqual([long.sl, ...long.targets.map(t => t.price)], [98, 102, 103, 110]);
  const short = resolvePlan(p, -1, 100);
  assert.deepEqual([short.sl, ...short.targets.map(t => t.price)], [102, 98, 97, 110]);
  assert.equal(planError(p, 1, 100), null);
  assert.match(planError(p, -1, 100)!, /Target 3 must be below/);
  assert.match(planError(parseExitPlan('sl 101; tp 2R'), 1, 100)!, /stop must be below/);
  assert.match(describePlan(p), /stop 2% · T1 1R \(50%\) · T2 3% \(25%\)/);
});

const buy = (a: Account, plan: string, px = 100, qty = 1, side: 'buy' | 'sell' = 'buy') => { const e = placeOrder(a, { sym: 'X', side, type: 'market', qty, plan: parseExitPlan(plan) }, px, 1); assert.equal(e, null); return a };
const orders = (a: Account) => a.orders.map(o => `${o.type}:${o.price}x${o.qty}`).sort();

test('entry fill places the stop and the target ladder, sized to the fill', () => {
  const a = buy(newAccount(), 'sl 98; tp 1R 50%, 2R 50%');
  assert.deepEqual(orders(a), ['limit:102x0.5', 'limit:104x0.5', 'stop:98x1']);
  assert.ok(a.orders.every(o => o.reduceOnly));
  assert.equal(Object.keys(a.plans!).length, 1);
});

test('target 1 fills: the stop covers the rest and moves to breakeven; the stop then closes the remainder', () => {
  const a = buy(newAccount(), 'sl 98; tp 1R 50%, 2R 50%; be 1');
  onPrice(a, 'X', 102, 2);
  assert.equal(a.pos['X'].qty, 0.5);
  assert.deepEqual(orders(a), ['limit:104x0.5', 'stop:100x0.5']);
  const fills = onPrice(a, 'X', 99.5, 3);
  assert.equal(fills.length, 1);
  assert.equal(a.pos['X'], undefined, 'flat');
  assert.deepEqual(a.orders, [], 'the unused target is gone');
  assert.deepEqual(a.plans, {}, 'and so is the plan');
  const pnl = a.fills.reduce((s, f) => s + f.realized, 0);
  assert.ok(Math.abs(pnl - (0.5 * 2 + 0.5 * -0.5)) < 1e-9, String(pnl));   // T1 +1.0, rest stopped at 99.5 (market fill below the 100 stop) -0.25
});

test('breakeven offset and "only tightens"', () => {
  const a = buy(newAccount(), 'sl 99.9; tp 1R 50%, 3R 50%; be 1 +0.5%');
  assert.deepEqual(orders(a).filter(x => x.startsWith('stop')), ['stop:99.9x1']);
  onPrice(a, 'X', 100.1, 2);
  assert.deepEqual(orders(a).filter(x => x.startsWith('stop')), ['stop:100.5x0.5']);
});

test('trail after target 1: the stop becomes a trailing stop that only tightens', () => {
  const a = buy(newAccount(), 'sl 2%; tp 1R 50%, 4R 50%; trail 1% 1');
  onPrice(a, 'X', 102, 2);
  const t = a.orders.find(o => o.type === 'trailing_stop')!;
  assert.deepEqual([t.qty, t.trail], [0.5, { pct: 1 }]);
  assert.ok(Math.abs(t.price! - 100.98) < 1e-9, String(t.price));
  onPrice(a, 'X', 103, 3); assert.ok(Math.abs(t.price! - 101.97) < 1e-9);
  onPrice(a, 'X', 102.5, 4); assert.ok(Math.abs(t.price! - 101.97) < 1e-9, 'never loosens');
  const f = onPrice(a, 'X', 101.9, 5);
  assert.equal(f.length, 1); assert.equal(a.pos['X'], undefined);
});

test('stop hit before any target: flat, nothing left behind', () => {
  const a = buy(newAccount(), 'sl 98; tp 1R 50%, 2R 50%; be 1');
  onPrice(a, 'X', 97.5, 2);
  assert.deepEqual([a.pos['X'], a.orders, a.plans], [undefined, [], {}]);
});

test('short side mirrors the long side', () => {
  const a = buy(newAccount(), 'sl 102; tp 1R 50%, 2R 50%; be 1', 100, 2, 'sell');
  assert.deepEqual(orders(a), ['limit:96x1', 'limit:98x1', 'stop:102x2']);
  onPrice(a, 'X', 98, 2);
  assert.deepEqual(orders(a), ['limit:96x1', 'stop:100x1']);
  onPrice(a, 'X', 96, 3);
  assert.deepEqual([a.pos['X'], a.orders.length], [undefined, 0]);
});

test('shares that do not divide evenly add up exactly; shares below 100% leave a runner for the stop', () => {
  const a = buy(newAccount(), 'sl 98; tp 1R 33%, 2R 33%, 3R 34%', 100, 0.3);
  const qs = a.orders.filter(o => o.type === 'limit').map(o => o.qty);
  assert.equal(+qs.reduce((s, q) => s + q, 0).toFixed(10), 0.3);
  const b = buy(newAccount(), 'sl 98; tp 1R 50%', 100, 1);
  assert.deepEqual(orders(b), ['limit:102x0.5', 'stop:98x1']);
});

test('validation at placement: both TP/SL and a plan, wrong sides, reduce-only; the account survives JSON', () => {
  const a = newAccount();
  assert.match(placeOrder(a, { sym: 'X', side: 'buy', type: 'market', qty: 1, sl: 90, plan: parseExitPlan('sl 98; tp 2R') }, 100, 1)!, /either TP\/SL or an exit plan/);
  assert.match(placeOrder(a, { sym: 'X', side: 'buy', type: 'market', qty: 1, plan: parseExitPlan('sl 101; tp 2R') }, 100, 1)!, /stop must be below/);
  assert.match(placeOrder(a, { sym: 'X', side: 'buy', type: 'market', qty: 1, reduceOnly: true, plan: parseExitPlan('sl 98; tp 2R') }, 100, 1)!, /entry order/);
  assert.match(placeOrder(a, { sym: 'X', side: 'buy', type: 'limit', qty: 1, price: 99, plan: parseExitPlan('sl 100; tp 2R') }, 100, 1)!, /stop must be below/);
  assert.equal(a.orders.length + a.fills.length, 0);
  const b = buy(newAccount(), 'sl 98; tp 1R 50%, 2R 50%; be 1');
  const c: Account = JSON.parse(JSON.stringify(b));
  onPrice(c, 'X', 102, 2);
  assert.deepEqual(orders(c), ['limit:104x0.5', 'stop:100x0.5'], 'a saved and reloaded account keeps managing its plan');
});

test('a resting entry fills later and only then places its exits', () => {
  const a = newAccount();
  assert.equal(placeOrder(a, { sym: 'X', side: 'buy', type: 'limit', qty: 1, price: 95, plan: parseExitPlan('sl 93; tp 1R 100%') }, 100, 1), null);
  assert.equal(a.orders.length, 1);
  onPrice(a, 'X', 95, 2);
  assert.deepEqual(orders(a), ['limit:97x1', 'stop:93x1']);
});
