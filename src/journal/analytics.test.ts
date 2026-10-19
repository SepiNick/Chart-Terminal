import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migrate, newJournal, type JTrade } from '../journal.ts';
import { addImported, award, balance, dashboard, discipline, evalProp, parseCsv, parseMtHtml, pointsOf, sessionOf } from './analytics.ts';

const T0 = Date.UTC(2026, 9, 12, 9, 0) / 1000;   // Monday 09:00 UTC
const tr = (net: number, i: number, x: Partial<JTrade> = {}): JTrade => ({ id: `t${i}`, accountId: 'paper', kind: 'trade', sym: 'BTCUSDT', dir: 'long', status: 'closed', openTime: T0 + i * 3600, closeTime: T0 + i * 3600 + 600, createdAt: T0 + i * 3600,
  qty: 0, maxQty: 1, avgEntry: 100, avgExit: 100 + net, exitQty: 1, gross: net, fees: 0, net, fills: [], mfe: Math.max(0, net), mae: Math.min(0, net), ...x });

test('dashboard: balance with transfers, win rate, streaks, risk buckets, sessions', () => {
  const j = migrate(newJournal());
  j.accounts![0].initial = 1000; j.accounts![0].transfers.push({ id: 'd', t: T0, amount: 500 });
  j.trades = [tr(30, 0, { stop: 90 }), tr(-20, 1, { stop: 80 }), tr(50, 2), tr(40, 3), tr(-10, 4)];
  assert.equal(balance(j), 1590);
  const d = dashboard(j, j.trades, 1500);
  assert.equal(d.trades, 5); assert.equal(d.winRate, 60); assert.equal(d.net, 90);
  assert.equal(d.consecWins, 2); assert.equal(d.consecWinAmt, 90);
  assert.equal(d.risk.n, 3);                       // two stops + one realised loss
  assert.deepEqual(d.risk.buckets, [2, 1, 0, 0]);   // 0.67%, 1.33%, 0.67%
  assert.equal(d.stopSet, 2); assert.equal(d.noPlan, 3);
  assert.deepEqual(sessionOf(T0), ['London']);
  assert.equal(d.curve.at(-1)!.bal, 1590);
});

test('R for manual entries uses prices (lots have unknown contract size); captured trades use money', async () => {
  const { rOf } = await import('./analytics.ts');
  const fx = tr(84.5, 0, { fills: [], maxQty: 0.5, avgEntry: 1.085, avgExit: 1.0867, stop: 1.083 });
  assert.ok(Math.abs(rOf(fx)! - 0.85) < 1e-9);
  const cap = tr(20, 0, { fills: [{ t: 0, side: 'buy', qty: 2, px: 100, fee: 0, realized: 0 }], maxQty: 2, stop: 95 });
  assert.equal(rOf(cap), 2);   // 20 ÷ (5 × 2)
});

test('discipline: 7 items × 10 + bonus = 80, late completion earns nothing, no-trade day = 80, streak skips rest days', () => {
  const t = tr(10, 0, { stop: 90, entryReasons: ['Breakout'], exitReason: 'target', notes: 'ok', checklist: { id: 'c', done: ['a'] }, media: [{ id: 'm', kind: 'image' }], emotionsBefore: ['Calm'] });
  award(t, T0 + 100);
  assert.equal(pointsOf(t), 80);
  const late = tr(10, 1, { stop: 90 });
  award(late, T0 + 3 * 86400);
  assert.equal(pointsOf(late), 0);
  delete t.notes; award(t, T0 + 200);
  assert.equal(pointsOf(t), 60);                    // notes and the bonus are gone
  const j = migrate(newJournal());
  const nt = tr(0, 0, { kind: 'notrade', createdAt: T0 - 3 * 86400 });   // previous Friday
  award(nt);
  j.trades = [t, nt];
  const d = discipline(j, T0 + 1000);
  assert.equal(d.today, 60);
  assert.equal(d.streak, 2);                        // Monday + Friday, weekend skipped
});

test('prop: trailing drawdown fails, static passes with target and min days', () => {
  const j = migrate(newJournal()); j.accounts![0].initial = 1000;
  j.trades = [tr(100, 0), tr(-60, 30), tr(30, 60)];
  const base = { id: 'p', name: 'X', accountId: 'paper', phase: '1', target: 5, maxDD: 5, dailyDD: 0, minDays: 2, start: 0 };
  assert.equal(evalProp({ ...base, ddType: 'trailing' }, j).status, 'failed');    // 1100 → 1040 = 6% of start
  const s = evalProp({ ...base, ddType: 'static' }, j);
  assert.equal(s.status, 'passed'); assert.ok(Math.abs(s.profitPct - 7) < 1e-9); assert.equal(s.days, 3);
});

test('import: MT5 and MT4 HTML statements, CSV, no duplicates', () => {
  const mt5 = `<table><tr><td>2026.10.01 10:00:00</td><td>123</td><td>EURUSD</td><td>buy</td><td>0.10</td><td>1.10000</td><td>1.09500</td><td>1.11000</td><td>2026.10.01 12:00:00</td><td>1.10500</td><td>-0.70</td><td>0.00</td><td>50.00</td></tr></table>`;
  const mt4 = `<tr><td>9876</td><td>2026.10.02 08:00</td><td>sell</td><td>1.00</td><td>xauusd</td><td>2400.00</td><td>0.00</td><td>0.00</td><td>2026.10.02 09:30</td><td>2390.00</td><td>-7.00</td><td>0.00</td><td>-1.20</td><td>1 000.00</td></tr>`;
  const a = parseMtHtml(mt5), b = parseMtHtml(mt4);
  assert.equal(a.length, 1); assert.equal(a[0].sym, 'EURUSD'); assert.equal(a[0].stop, 1.095); assert.equal(a[0].openTime, Date.UTC(2026, 9, 1, 10) / 1000);
  assert.equal(b[0].sym, 'XAUUSD'); assert.equal(b[0].dir, 'short'); assert.equal(b[0].profit, 1000);
  const c = parseCsv('Symbol;Side;Open time;Close time;Qty;Entry price;Exit price;Realized PnL;Fee\nBTC/USDT;SELL;2026-10-03 10:00:00;2026-10-03 11:00:00;0.5;60000;59000;500;3');
  assert.equal(c[0].sym, 'BTCUSDT'); assert.equal(c[0].dir, 'short'); assert.equal(c[0].commission, 3);
  const j = migrate(newJournal());
  assert.equal(addImported(j, [...a, ...b], 'paper'), 2);
  assert.equal(addImported(j, a, 'paper'), 0);
  assert.equal(j.trades[0].net, 50 - 0.7);
});
