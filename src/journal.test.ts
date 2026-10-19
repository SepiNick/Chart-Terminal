import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newAccount, placeOrder, closePosition, onPrice } from './trading.ts';
import { mark, newJournal, rMultiple, stats, syncFills, toCsv, incomplete } from './journal.ts';

test('journal: open, scale in, partial exit, close → one round trip with matching P&L', () => {
  const a = newAccount(10000), j = newJournal();
  placeOrder(a, { sym: 'BTC', side: 'buy', type: 'market', qty: 1 }, 100, 1);
  let r = syncFills(j, a, 1000, () => ({ tf: '1h', stop: 90 }));
  assert.equal(r.opened.length, 1);
  placeOrder(a, { sym: 'BTC', side: 'buy', type: 'market', qty: 1 }, 110, 2);
  placeOrder(a, { sym: 'BTC', side: 'sell', type: 'market', qty: 1 }, 120, 3);
  r = syncFills(j, a, 2000);
  assert.equal(r.opened.length + r.closed.length, 0);
  const t = j.trades[0];
  assert.equal(t.avgEntry, 105); assert.equal(t.maxQty, 2); assert.equal(t.qty, 1);
  mark(j, 'BTC', 130); mark(j, 'BTC', 95);
  closePosition(a, 'BTC', 125, 4);
  r = syncFills(j, a, 3000);
  assert.equal(r.closed.length, 1);
  assert.equal(t.status, 'closed'); assert.equal(t.closeTime, 3000); assert.equal(t.openTime, 1);
  assert.equal(t.avgExit, 122.5);
  assert.equal(t.gross, 35);                                   // (120-105) + (125-105)
  const fees = a.fills.reduce((s, f) => s + f.fee, 0);
  assert.ok(Math.abs(t.fees - fees) < 1e-9);
  assert.ok(Math.abs(t.net - (10000 + 0 - a.cash) * -1) < 1e-9, 'journal net equals account cash change');
  assert.equal(t.mfe, 15 + 25);                                // realized 15 + open 1×(130-105)
  assert.equal(t.mae, 0);                                       // never below breakeven: 15 realized - 10 open
  assert.ok(Math.abs(rMultiple(t)! - t.net / 30) < 1e-9);       // risk = (105-90) × 2
  assert.ok(incomplete(t));
});

test('journal: a reversal closes the trade and opens the opposite one; bracket exits are captured', () => {
  const a = newAccount(10000), j = newJournal();
  placeOrder(a, { sym: 'ETH', side: 'buy', type: 'market', qty: 2 }, 50, 1);
  placeOrder(a, { sym: 'ETH', side: 'sell', type: 'market', qty: 5 }, 55, 2);
  const r = syncFills(j, a, 10);
  assert.equal(j.trades.length, 2);
  assert.equal(r.closed.length, 1);
  assert.deepEqual(j.trades.map(t => [t.dir, t.status, t.qty]), [['long', 'closed', 0], ['short', 'open', 3]]);
  assert.equal(j.trades[0].gross, 10);
  // take-profit bracket on a new trade
  placeOrder(a, { sym: 'SOL', side: 'buy', type: 'market', qty: 1, tp: 12, sl: 8 }, 10, 3);
  onPrice(a, 'SOL', 12.5, 4);
  syncFills(j, a, 20);
  const sol = j.trades.find(t => t.sym === 'SOL')!;
  assert.equal(sol.status, 'closed'); assert.equal(sol.gross, 2.5);                       // limit sells at the better tick price
});

test('journal: stats, CSV and account reset', () => {
  const a = newAccount(10000), j = newJournal();
  for (const [px1, px2] of [[100, 110], [100, 95], [100, 120]]) {
    placeOrder(a, { sym: 'X', side: 'buy', type: 'market', qty: 1 }, px1, 1);
    closePosition(a, 'X', px2, 2);
  }
  syncFills(j, a, 5);
  j.trades[0].setup = 'Breakout'; j.trades[2].setup = 'Breakout'; j.trades[1].mistakes = ['Late entry'];
  const s = stats(j.trades);
  assert.equal(s.trades, 3);
  assert.equal(Math.round(s.winRate), 67);
  assert.equal(s.bySetup[0].key, 'Breakout'); assert.equal(s.bySetup[0].n, 2);
  assert.ok(s.byMistake.some(g => g.key === 'Late entry' && g.net < 0));
  assert.equal(s.bestStreak, 1); assert.equal(s.worstStreak, 1);
  assert.equal(toCsv(j.trades).split('\n').length, 4);
  placeOrder(a, { sym: 'X', side: 'buy', type: 'market', qty: 1 }, 100, 3);
  syncFills(j, a, 6);
  a.fills = []; a.pos = {};
  syncFills(j, a, 7);
  assert.ok(j.trades.every(t => t.status === 'closed'));
});
