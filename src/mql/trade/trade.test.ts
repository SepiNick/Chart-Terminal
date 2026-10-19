import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Env, Rt } from '../contract.ts';
import { installTrade, MtBroker } from './index.ts';

type F = (...a: unknown[]) => any;
const mkEnv = (dialect: 'mql4' | 'mql5', acct: Partial<Env['account']> = {}) => ({
  dialect, symbol: 'EURUSD', point: 0.00001, digits: 5, tfSec: 60, spreadPoints: 20, logs: [] as string[],
  price: () => 0, now: () => 0, log(_l: string, m: string) { this.logs.push(m) },
  account: { balance: 10000, leverage: 100, hedging: true, currency: 'USD', contractSize: 100000, commissionPerLot: 7, minLot: 0.01, lotStep: 0.01, maxLot: 100, stopLevelPoints: 0, ...acct },
}) as unknown as Env;
const setup = (dialect: 'mql4' | 'mql5', acct: Partial<Env['account']> = {}) => {
  const rt: Rt = { _LastError: 0 }, env = mkEnv(dialect, acct);
  installTrade(rt, env);
  const b = rt.__broker as MtBroker, f = (n: string) => rt[n] as F;
  const tick = (bid: number, t = 0, spread = 0.0002) => b.onTick(bid, +(bid + spread).toFixed(5), t);
  return { rt, env, b, f, tick };
};
const near = (a: number, e: number) => assert.ok(Math.abs(a - e) < 1e-6, `${a} != ${e}`);

test('MQL4 market buy/sell P&L with contract size and commission', () => {
  const { b, f, tick, rt } = setup('mql4');
  tick(1.1000);
  const t1 = f('OrderSend')('EURUSD', rt.OP_BUY, 0.1, b.ask, 3, 0, 0, 'c', 7);
  assert.equal(t1, 1);
  near(b.balance(), 10000 - 0.7);
  tick(1.1050);
  near(f('AccountProfit')(), 48);                         // (1.1050 - 1.1002) * 0.1 * 100000
  assert.ok(f('OrderClose')(t1, 0.1, b.bid, 3));
  near(b.balance(), 10000 - 1.4 + 48);
  const t2 = f('OrderSend')('EURUSD', rt.OP_SELL, 0.2, b.bid, 3, 0, 0);
  assert.ok(t2 > t1);
  tick(1.1000);                                           // sell at 1.1050, buy back at ask 1.1002
  assert.ok(f('OrderClose')(t2, 0.2, b.ask, 3));
  near(b.deals.at(-1)!.profit, 96);
  assert.ok(f('OrderSelect')(1, rt.SELECT_BY_POS, rt.MODE_HISTORY));
  assert.equal(f('OrderTicket')(), t2);
  near(f('OrderCommission')(), -2.8);
  assert.equal(f('OrdersHistoryTotal')(), 2);
});

test('MQL4 SL/TP within a bar fill at the level, a gap fills at market', () => {
  const { b, f, tick, rt } = setup('mql4');
  tick(1.1000, 0);
  const a = f('OrderSend')(null, rt.OP_BUY, 1, b.ask, 0, 1.0950, 1.1100);
  const s = f('OrderSend')(null, rt.OP_SELL, 1, b.bid, 0, 1.1100, 1.0900);
  tick(1.1120, 30);                                       // same bar: buy TP at 1.1100, sell SL hit (ask 1.1122) at 1.1100
  assert.equal(b.positions.length, 0);
  const h = b.history4;
  assert.equal(h.find(x => x.ticket === a)!.closePrice, 1.1100);
  assert.equal(h.find(x => x.ticket === s)!.closePrice, 1.1100);
  assert.match(h.find(x => x.ticket === a)!.comment, /\[tp\]/);
  const c = f('OrderSend')(null, rt.OP_BUY, 1, b.ask, 0, 1.1050, 0);
  tick(1.1000, 60);                                       // new bar opens below the SL: gap → filled at bid
  assert.equal(b.history4.find(x => x.ticket === c)!.closePrice, 1.1000);
});

test('MQL4 pending order activation and expiration', () => {
  const { b, f, tick, rt } = setup('mql4');
  tick(1.1000, 0);
  const lim = f('OrderSend')(null, rt.OP_BUYLIMIT, 0.1, 1.0950, 0, 1.0900, 0);
  const stp = f('OrderSend')(null, rt.OP_SELLSTOP, 0.1, 1.0800, 0, 0, 0, '', 0, 120);
  assert.equal(f('OrderSend')(null, rt.OP_BUYSTOP, 0.1, 1.0900, 0, 0, 0), -1);  // buy stop below market
  assert.equal(rt._LastError, 130);
  assert.equal(f('OrdersTotal')(), 2);
  tick(1.0940, 30);                                       // ask 1.0942 ≤ 1.0950 → fills at the limit
  assert.ok(f('OrderSelect')(lim, rt.SELECT_BY_TICKET));
  assert.equal(f('OrderType')(), rt.OP_BUY);
  assert.equal(f('OrderOpenPrice')(), 1.0950);
  tick(1.0960, 125);
  assert.ok(f('OrderSelect')(stp, rt.SELECT_BY_TICKET));
  assert.equal(f('OrderCloseTime')(), 125);                // expired into history
  assert.equal(f('OrdersTotal')(), 1);
});

test('MQL4 OrderModify, partial close, select by pos', () => {
  const { b, f, tick, rt } = setup('mql4');
  tick(1.1000);
  const t = f('OrderSend')(null, rt.OP_BUY, 0.3, b.ask, 0, 0, 0, 'x');
  assert.ok(f('OrderModify')(t, 0, 1.0900, 1.1200, 0));
  assert.equal(f('OrderModify')(t, 0, 1.0900, 1.1200, 0), false);
  assert.equal(rt._LastError, 1);
  assert.equal(f('OrderModify')(t, 0, 1.1001, 0, 0), false);   // buy SL above bid
  assert.equal(rt._LastError, 130);
  assert.ok(f('OrderClose')(t, 0.1, b.bid, 0));
  assert.ok(f('OrderSelect')(0, rt.SELECT_BY_POS, rt.MODE_TRADES));
  const nt = f('OrderTicket')();
  assert.ok(nt > t);
  near(f('OrderLots')(), 0.2);
  assert.equal(f('OrderComment')(), `from #${t}`);
  assert.equal(f('OrderClose')(nt, 0.25, b.bid, 0), false);   // more than the remaining lots
  assert.equal(rt._LastError, 131);
  assert.equal(f('OrderClose')(nt, 0.2, b.bid + 0.001, 0), false);
  assert.equal(rt._LastError, 138);
});

test('MQL5 netting: reversal produces an in/out deal; hedging keeps two positions', () => {
  for (const hedging of [false, true]) {
    const { b, f, tick, rt } = setup('mql5', { hedging, commissionPerLot: 0 });
    tick(1.1000);
    const Req = rt.MqlTradeRequest as new () => Record<string, unknown>, Res = rt.MqlTradeResult as new () => Record<string, number>;
    const send = (type: number, volume: number) => { const q = new Req(), r = new Res(); Object.assign(q, { action: rt.TRADE_ACTION_DEAL, symbol: 'EURUSD', type, volume }); assert.ok(f('OrderSend')(q, r)); return r };
    send(rt.ORDER_TYPE_BUY as number, 1);
    tick(1.1010);
    send(rt.ORDER_TYPE_SELL as number, 3);
    if (!hedging) {
      assert.equal(b.positions.length, 1);
      assert.equal(b.positions[0].type, 'sell');
      near(b.positions[0].volume, 2);
      assert.equal(b.deals[1].entry, 'inout');
      near(b.deals[1].profit, 80);                          // (1.1010 - 1.1002) * 1 lot
      assert.ok(f('PositionSelect')('EURUSD'));
      assert.equal(f('PositionGetInteger')(rt.POSITION_TYPE), rt.POSITION_TYPE_SELL);
      const v = { v: 0 };
      assert.ok(f('PositionGetDouble')(rt.POSITION_VOLUME, v));
      near(v.v, 2);
    } else {
      assert.equal(b.positions.length, 2);
      assert.equal(f('PositionsTotal')(), 2);
      assert.ok(f('HistorySelect')(0, 1e10));
      assert.equal(f('HistoryDealsTotal')(), 2);
      assert.equal(f('HistoryDealGetInteger')(f('HistoryDealGetTicket')(1), rt.DEAL_ENTRY), rt.DEAL_ENTRY_IN);
    }
  }
});

test('MQL5 request validation: volume step, stops too close, no money', () => {
  const { b, f, tick, rt } = setup('mql5', { stopLevelPoints: 100, leverage: 10 });
  tick(1.1000);
  const Req = rt.MqlTradeRequest as new () => Record<string, unknown>, Res = rt.MqlTradeResult as new () => Record<string, number>;
  const send = (o: Record<string, unknown>) => { const q = Object.assign(new Req(), { action: rt.TRADE_ACTION_DEAL, type: 0, volume: 0.1 }, o), r = new Res(); return [f('OrderSend')(q, r), r.retcode] };
  assert.deepEqual(send({ volume: 0.015 }), [false, rt.TRADE_RETCODE_INVALID_VOLUME]);
  assert.equal(rt._LastError, rt.ERR_TRADE_SEND_FAILED);
  assert.deepEqual(send({ sl: 1.0995 }), [false, rt.TRADE_RETCODE_INVALID_STOPS]);   // 50 points < StopLevel 100
  assert.deepEqual(send({ volume: 10 }), [false, rt.TRADE_RETCODE_NO_MONEY]);        // needs ~110k margin
  assert.deepEqual(send({ sl: 1.0980 }), [true, rt.TRADE_RETCODE_DONE]);
  const m = { v: 0 };
  assert.ok(f('OrderCalcMargin')(0, 'EURUSD', 1, 1.1, m));
  near(m.v, 11000);
  near(f('AccountInfoDouble')(rt.ACCOUNT_MARGIN), b.margin());
  const q = Object.assign(new Req(), { action: rt.TRADE_ACTION_PENDING, type: rt.ORDER_TYPE_BUY_LIMIT, volume: 0.1, price: 1.0999 }), r = new Res();
  assert.equal(f('OrderSend')(q, r), false);
  assert.equal(r.retcode, rt.TRADE_RETCODE_INVALID_PRICE);
});

test('MQL5 stop-limit converts to limit, DAY order expires', () => {
  const { b, tick, rt } = setup('mql5');
  tick(1.1000, 1005);
  const trade = new (rt.CTrade as new () => any)();
  assert.ok(trade.OrderOpen('EURUSD', rt.ORDER_TYPE_BUY_STOP_LIMIT, 0.1, 1.1030, 1.1050, 0, 0));
  assert.ok(trade.BuyLimit(0.1, 1.0900, null, 0, 0, rt.ORDER_TIME_DAY));
  tick(1.1060, 1010);                                     // stop hit → buy limit at 1.1030
  assert.equal(b.orders.find(o => o.ticket === 1)!.type, 'buy_limit');
  tick(1.1020, 1015);
  assert.equal(b.positions.length, 1);
  assert.equal(b.positions[0].price, 1.1030);
  tick(1.1020, 86400);
  assert.equal(b.orders.length, 0);
  assert.equal(b.historyOrders.find(o => o.ticket === 2)!.state, rt.ORDER_STATE_EXPIRED);
});

test('CTrade Buy/Sell/PositionClose with ResultRetcode; CPositionInfo SelectByIndex', () => {
  const { b, tick, rt } = setup('mql5', { commissionPerLot: 0 });
  tick(1.1000);
  const trade = new (rt.CTrade as new () => any)(), pi = new (rt.CPositionInfo as new () => any)();
  trade.SetExpertMagicNumber(42);
  assert.ok(trade.Buy(0.5, null, 0, 1.0900, 1.1100, 'b'));
  assert.equal(trade.ResultRetcode(), rt.TRADE_RETCODE_DONE);
  assert.equal(trade.ResultPrice(), 1.1002);
  assert.ok(trade.Sell(0.2));
  assert.ok(pi.SelectByIndex(0));
  assert.equal(pi.Magic(), 42);
  assert.equal(pi.TypeDescription(), 'buy');
  assert.equal(pi.StopLoss(), 1.0900);
  tick(1.1010);
  near(pi.Profit(), 40);
  assert.ok(trade.PositionClose(pi.Ticket()));
  assert.equal(b.positions.length, 1);
  assert.equal(trade.Buy(0.013), false);
  assert.equal(trade.ResultRetcode(), rt.TRADE_RETCODE_INVALID_VOLUME);
  assert.equal(trade.PositionClose(999), false);
  const acc = new (rt.CAccountInfo as new () => any)();
  assert.equal(acc.MarginMode(), rt.ACCOUNT_MARGIN_MODE_RETAIL_HEDGING);
  near(acc.Balance(), 10040);
});

test('stop-out closes the worst position at margin level ≤ 50%', () => {
  const b = new MtBroker(mkEnv('mql5', { balance: 1000, leverage: 100, commissionPerLot: 0 }));
  b.onTick(1.0000, 1.0000, 0);
  assert.equal(b.send({ action: 1, type: 0, volume: 0.5 }).retcode, 10009);   // margin 500
  assert.equal(b.send({ action: 1, type: 0, volume: 0.4 }).retcode, 10009);   // margin 900
  assert.equal(b.send({ action: 1, type: 0, volume: 0.2 }).retcode, 10019);   // would exceed equity
  b.onTick(0.9950, 0.9950, 10);                           // equity 1000 - 450 = 550 → 61%
  assert.equal(b.positions.length, 2);
  b.onTick(0.9940, 0.9940, 20);                           // equity 460 → 51%… then 0.9938
  b.onTick(0.9938, 0.9938, 30);                           // equity 442 → 49% → stop-out
  assert.equal(b.positions.length, 1);
  assert.equal(b.deals.at(-1)!.reason, 6);
  assert.ok(b.marginLevel() > 50);
});
