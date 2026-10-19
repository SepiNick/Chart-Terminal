// MQL4 trade functions (docs.mql4.com/trading, /account, /check) on top of MtBroker.
import type { Env, Rt } from '../contract.ts';
import { MtBroker, sideOf } from './broker.ts';
import { RC, rcToErr4 } from './constants.ts';

interface View { ticket: number; code: number; lots: number; openPrice: number; openTime: number; closePrice: number; closeTime: number; sl: number; tp: number; profit: number; swap: number; commission: number; magic: number; comment: string; expiration: number; symbol: string }

export function installMql4(rt: Rt, b: MtBroker, env: Env) {
  const err = (c: number) => { rt._LastError = c };
  const fail = (c: number) => { err(c); return false };
  const view = (t: number): View | undefined => {
    const p = b.positions.find(x => x.ticket === t);
    if (p) return { ticket: t, code: p.type === 'buy' ? 0 : 1, lots: p.volume, openPrice: p.price, openTime: p.time, closePrice: b.closePrice(p), closeTime: 0, sl: p.sl, tp: p.tp,
      profit: b.posProfit(p), swap: p.swap, commission: p.commission, magic: p.magic, comment: p.comment, expiration: 0, symbol: p.symbol };
    const o = b.orders.find(x => x.ticket === t);
    if (o) return { ticket: t, code: o.code, lots: o.volume, openPrice: o.price, openTime: o.time, closePrice: sideOf(o.code) === 'buy' ? b.bid : b.ask, closeTime: 0, sl: o.sl, tp: o.tp,
      profit: 0, swap: 0, commission: 0, magic: o.magic, comment: o.comment, expiration: o.expiration, symbol: o.symbol };
    const h = b.history4.find(x => x.ticket === t);
    if (h) return { ...h, lots: h.volume, openPrice: h.price, openTime: h.time };
  };
  const open = () => [...b.positions, ...b.orders].map(x => x.ticket).sort((x, y) => x - y);
  let sel = 0;
  const get = <K extends keyof View>(k: K, d: View[K]) => () => { const v = view(sel); if (!v) { err(4105); return d } return v[k] };
  const tol = env.point * 1e-3;
  const deviates = (price: number, mkt: number, slip: number) => !(price > 0) ? 129 : Math.abs(price - mkt) > (slip || 0) * env.point + tol ? 138 : 0;
  const result = (rc: number, pending = false) => rc === RC.DONE || fail(rcToErr4(rc, pending));
  const symOk = (s: unknown) => !s || s === env.symbol;

  Object.assign(rt, {
    OrderSend(symbol: string, cmd: number, volume: number, price: number, slippage: number, sl: number, tp: number, comment = '', magic = 0, expiration = 0, _arrow = 0) {
      if (!symOk(symbol)) { err(4106); return -1 }
      if (!(cmd >= 0 && cmd <= 5)) { err(3); return -1 }
      if (cmd <= 1) { const e = deviates(price, cmd === 0 ? b.ask : b.bid, slippage); if (e) { err(e); return -1 } }
      const r = b.send({ action: cmd <= 1 ? 1 : 5, type: cmd, volume, price, sl, tp, comment: comment ?? '', magic, symbol: env.symbol,
        type_time: cmd > 1 && expiration > 0 ? 2 : 0, expiration });
      return result(r.retcode, cmd > 1) ? r.order : -1;
    },
    OrderClose(ticket: number, lotsArg: number, price: number, slippage: number, _arrow = 0) {
      const p = b.positions.find(x => x.ticket === ticket);
      if (!p) return fail(4108);
      const e = deviates(price, b.closePrice(p), slippage);
      if (e) return fail(e);
      return result(b.send({ action: 1, type: p.type === 'buy' ? 1 : 0, volume: lotsArg, position: ticket, magic: p.magic }).retcode);
    },
    OrderCloseBy(ticket: number, opposite: number, _arrow = 0) {
      if (!b.positions.some(x => x.ticket === ticket) || !b.positions.some(x => x.ticket === opposite)) return fail(4108);
      return result(b.send({ action: 10, position: ticket, position_by: opposite }).retcode);
    },
    OrderDelete(ticket: number, _arrow = 0) {
      if (!b.orders.some(x => x.ticket === ticket)) return fail(4108);
      return result(b.send({ action: 8, order: ticket }).retcode, true);
    },
    OrderModify(ticket: number, price: number, sl: number, tp: number, expiration: number, _arrow = 0) {
      if (b.positions.some(x => x.ticket === ticket)) return result(b.send({ action: 6, position: ticket, sl, tp }).retcode);
      if (!b.orders.some(x => x.ticket === ticket)) return fail(4108);
      return result(b.send({ action: 7, order: ticket, price, sl, tp, type_time: expiration > 0 ? 2 : 0, expiration }).retcode, true);
    },
    OrderSelect(index: number, select: number, pool = 0) {
      if (select === 1) { if (!view(index)) return false; sel = index; return true }
      const list = pool === 1 ? b.history4.map(h => h.ticket) : open();
      if (!(index >= 0 && index < list.length)) return false;
      sel = list[index];
      return true;
    },
    OrdersTotal: () => b.positions.length + b.orders.length,
    OrdersHistoryTotal: () => b.history4.length,
    OrderTicket: get('ticket', 0), OrderType: get('code', -1), OrderLots: get('lots', 0), OrderOpenPrice: get('openPrice', 0), OrderOpenTime: get('openTime', 0),
    OrderClosePrice: get('closePrice', 0), OrderCloseTime: get('closeTime', 0), OrderStopLoss: get('sl', 0), OrderTakeProfit: get('tp', 0), OrderProfit: get('profit', 0),
    OrderSwap: get('swap', 0), OrderCommission: get('commission', 0), OrderMagicNumber: get('magic', 0), OrderComment: get('comment', ''), OrderSymbol: get('symbol', ''),
    OrderExpiration: get('expiration', 0),
    OrderPrint() {
      const v = view(sel);
      if (!v) return void err(4105);
      const f = (x: number) => x.toFixed(env.digits);
      env.log('print', `#${v.ticket} ${v.openTime} ${['buy', 'sell', 'buy limit', 'sell limit', 'buy stop', 'sell stop'][v.code]} ${v.lots.toFixed(2)} ${v.symbol} ${f(v.openPrice)} ${f(v.sl)} ${f(v.tp)} ${v.closeTime} ${f(v.closePrice)} ${v.commission.toFixed(2)} ${v.swap.toFixed(2)} ${v.profit.toFixed(2)} ${v.comment} ${v.magic} ${v.expiration}`);
    },
    AccountBalance: () => b.balance(), AccountEquity: () => b.equity(), AccountFreeMargin: () => b.freeMargin(), AccountMargin: () => b.margin(),
    AccountProfit: () => b.profit(), AccountLeverage: () => env.account.leverage, AccountCurrency: () => env.account.currency, AccountNumber: () => 1,
    AccountName: () => 'Simulator', AccountServer: () => 'Simulator', AccountCompany: () => 'Simulator', AccountCredit: () => 0,
    AccountStopoutLevel: () => b.stopOutLevel, AccountStopoutMode: () => 0, AccountFreeMarginMode: () => 1,
    AccountFreeMarginCheck(symbol: string, cmd: number, volume: number) {
      if (!symOk(symbol)) { err(4106); return 0 }
      const side = sideOf(cmd), v = b.equity() - b.marginAfter(side, volume, side === 'buy' ? b.ask : b.bid);
      if (v < 0) err(134);
      return Math.round(v * 100) / 100;
    },
    IsTradeAllowed: () => true, IsTradeContextBusy: () => false, IsConnected: () => true, IsExpertEnabled: () => true,
  });

  // MarketInfo: answer trade-related modes, delegate the rest to the std lib's version if present.
  const prevMI = rt.MarketInfo as ((s: string, m: number) => number) | undefined, a = env.account;
  rt.MarketInfo = (symbol: string, mode: number) => {
    const m: Record<number, () => number> = {
      9: () => b.bid, 10: () => b.ask, 11: () => env.point, 12: () => env.digits, 13: () => Math.round((b.ask - b.bid) / env.point),
      14: () => a.stopLevelPoints, 15: () => a.contractSize, 16: () => a.contractSize * env.point, 17: () => env.point, 18: () => 0, 19: () => 0,
      22: () => 1, 23: () => a.minLot, 24: () => a.lotStep, 25: () => a.maxLot, 32: () => b.marginFor(1, b.ask), 33: () => 0,
    };
    if (symOk(symbol) && m[mode]) return m[mode]();
    if (prevMI) return prevMI(symbol, mode);
    err(symOk(symbol) ? 4051 : 4106);
    return 0;
  };
}
