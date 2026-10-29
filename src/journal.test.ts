import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newAccount, placeOrder, closePosition, onPrice } from './trading.ts';
import { applyFill, barIndex, barPath, mark, newJournal, rMultiple, stats, syncFills, syncBrokerFills, toCsv, incomplete } from './journal.ts';

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

test('journal: Bar Replay fills go to their own account with the replay time, apart from the paper trades', () => {
  const a = newAccount(10000), j = newJournal();
  placeOrder(a, { sym: 'BTC', side: 'buy', type: 'market', qty: 1 }, 100, 1);
  syncFills(j, a, 5000);
  // a replay long on the same symbol, at 2021 bar times
  applyFill(j, 'BTC', { t: 1_609_459_200, side: 'buy', qty: 2, px: 30000, fee: 0, realized: 0 }, { accountId: 'bt', source: 'Bar Replay', stop: 29000 });
  mark(j, 'BTC', 31000, 'bt'); mark(j, 'BTC', 200);   // paper ticks never touch the replay trade
  const r = applyFill(j, 'BTC', { t: 1_609_462_800, side: 'sell', qty: 2, px: 31000, fee: 0, realized: 2000 }, { accountId: 'bt' });
  const bt = j.trades.find(t => t.accountId === 'bt')!, paper = j.trades.find(t => t.accountId === 'paper')!;
  assert.equal(r.closed[0], bt);
  assert.equal(bt.openTime, 1_609_459_200); assert.equal(bt.closeTime, 1_609_462_800);
  assert.equal(bt.net, 2000); assert.equal(bt.mfe, 2000); assert.equal(rMultiple(bt), 1);
  assert.equal(paper.status, 'open'); assert.equal(paper.qty, 1); assert.equal(paper.mfe, 100);
  // a paper account reset closes paper trades only
  applyFill(j, 'ETH', { t: 1, side: 'buy', qty: 1, px: 10, fee: 0, realized: 0 }, { accountId: 'bt' });
  syncFills(j, newAccount(), 6000);
  assert.equal(paper.status, 'closed'); assert.equal(j.trades.find(t => t.sym === 'ETH')!.status, 'open');
});

test('journal: replay helpers find the bar of a time and walk a bar', () => {
  const bars = [{ time: 0 }, { time: 60 }, { time: 120 }];
  assert.equal(barIndex(bars, -1), -1); assert.equal(barIndex(bars, 0), 0); assert.equal(barIndex(bars, 90), 1); assert.equal(barIndex(bars, 999), 2);
  assert.deepEqual(barPath({ open: 10, high: 11, low: 5, close: 8 }), [10, 11, 5, 8]);
  assert.deepEqual(barPath({ open: 10, high: 15, low: 9, close: 12 }), [10, 9, 15, 12]);
});

test('exchange fills: imported once by id, spot P&L from the average entry', () => {
  const j = newJournal(), F = (id: string, side: 'buy' | 'sell', qty: number, price: number, ts: number) => ({ id, sym: 'BTCUSDT', side, qty, price, fee: 0.1, ts });
  let r = syncBrokerFills(j, 'acc1', [F('b', 'sell', 1, 110, 2_000_000_000_000), F('a', 'buy', 1, 100, 1_900_000_000_000)]);
  assert.equal(r.added, 2); assert.equal(r.closed.length, 1);
  const t = j.trades[0];
  assert.equal(t.accountId, 'acc1'); assert.equal(t.gross, 10); assert.ok(Math.abs(t.net - 9.8) < 1e-9); assert.equal(t.openTime, 1_900_000_000);
  r = syncBrokerFills(j, 'acc1', [F('a', 'buy', 1, 100, 1_900_000_000_000)]);
  assert.equal(r.added, 0, 'seen ids are skipped');
});
