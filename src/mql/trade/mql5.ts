// MQL5 trade functions (www.mql5.com/en/docs/trading) and AccountInfo* (both dialects) on top of MtBroker.
import type { Env, Ref, Rt } from '../contract.ts';
import { MtBroker, sideOf, type Deal, type Ord, type Pos, type TradeRes } from './broker.ts';
import { ERR5, RC } from './constants.ts';

export class MqlTradeRequest { action = 0; magic = 0; order = 0; symbol = ''; volume = 0; price = 0; stoplimit = 0; sl = 0; tp = 0; deviation = 0; type = 0; type_filling = 0; type_time = 0; expiration = 0; comment = ''; position = 0; position_by = 0 }
export class MqlTradeResult { retcode = 0; deal = 0; order = 0; volume = 0; price = 0; bid = 0; ask = 0; comment = ''; request_id = 0; retcode_external = 0 }
export class MqlTradeCheckResult { retcode = 0; balance = 0; equity = 0; profit = 0; margin = 0; margin_free = 0; margin_level = 0; comment = '' }
export class MqlTradeTransaction { deal = 0; order = 0; symbol = ''; type = 0; order_type = 0; order_state = 0; deal_type = 0; time_type = 0; time_expiration = 0; price = 0; price_trigger = 0; price_sl = 0; price_tp = 0; volume = 0; position = 0; position_by = 0 }

export const copyResult = (dst: MqlTradeResult, r: TradeRes) => { for (const k of Object.keys(new MqlTradeResult()) as (keyof MqlTradeResult)[]) (dst as unknown as Record<string, unknown>)[k] = r[k]; return dst };
export const copyCheck = (dst: MqlTradeCheckResult, r: TradeRes) => { for (const k of Object.keys(new MqlTradeCheckResult()) as (keyof MqlTradeCheckResult)[]) (dst as unknown as Record<string, unknown>)[k] = r[k]; return dst };
export const okRc = (rc: number) => rc === RC.DONE || rc === RC.PLACED || rc === RC.DONE_PARTIAL;

/** Selection state shared with the standard-library classes. */
export interface Sel { pos: number; ord: number; deals: Deal[]; horders: Ord[] }

type G<T> = Map<unknown, (x: T) => unknown>;
/** Define property constants (unique ids from `base`, std-lib values win) and map their values to getters. */
const group = <T>(rt: Rt, base: number, getters: Record<string, (x: T) => unknown>): G<T> => {
  const m: G<T> = new Map();
  Object.entries(getters).forEach(([n, g], i) => { if (rt[n] === undefined) rt[n] = base + i; m.set(rt[n], g) });
  return m;
};
/** Build Get*(prop) / Get*(prop, &out) (or (ticket, prop[, &out]) when keyed) accessors. */
const getter = <T>(rt: Rt, m: G<T>, find: (key?: number) => T | undefined, errCode: number, dflt: unknown, keyed: boolean) =>
  (...a: unknown[]) => {
    const [key, prop, out] = keyed ? a as [number, unknown, Ref?] : [undefined, a[0], a[1] as Ref | undefined];
    const x = find(key), g = m.get(prop);
    if (!x || !g) { rt._LastError = x ? 4003 : errCode; return out ? false : dflt }
    const v = g(x);
    if (out) { out.v = v; return true }
    return v;
  };

export function installAccount(rt: Rt, b: MtBroker, env: Env) {
  const one = () => 1, zero = () => 0;
  const I = group<1>(rt, 300, {
    ACCOUNT_LOGIN: one, ACCOUNT_TRADE_MODE: zero, ACCOUNT_LEVERAGE: () => env.account.leverage, ACCOUNT_LIMIT_ORDERS: zero, ACCOUNT_MARGIN_SO_MODE: zero,
    ACCOUNT_TRADE_ALLOWED: one, ACCOUNT_TRADE_EXPERT: one, ACCOUNT_MARGIN_MODE: () => (b.hedging ? 2 : 0), ACCOUNT_CURRENCY_DIGITS: () => 2,
    ACCOUNT_FIFO_CLOSE: zero, ACCOUNT_HEDGE_ALLOWED: () => (b.hedging ? 1 : 0),
  });
  const D = group<1>(rt, 330, {
    ACCOUNT_BALANCE: () => b.balance(), ACCOUNT_CREDIT: zero, ACCOUNT_PROFIT: () => b.profit(), ACCOUNT_EQUITY: () => b.equity(), ACCOUNT_MARGIN: () => b.margin(),
    ACCOUNT_MARGIN_FREE: () => b.freeMargin(), ACCOUNT_MARGIN_LEVEL: () => b.marginLevel(), ACCOUNT_MARGIN_SO_CALL: () => b.marginCallLevel,
    ACCOUNT_MARGIN_SO_SO: () => b.stopOutLevel, ACCOUNT_MARGIN_INITIAL: zero, ACCOUNT_MARGIN_MAINTENANCE: zero, ACCOUNT_ASSETS: zero, ACCOUNT_LIABILITIES: zero,
    ACCOUNT_COMMISSION_BLOCKED: zero,
  });
  const S = group<1>(rt, 360, { ACCOUNT_NAME: () => 'Simulator', ACCOUNT_SERVER: () => 'Simulator', ACCOUNT_CURRENCY: () => env.account.currency, ACCOUNT_COMPANY: () => 'Simulator' });
  const acc = () => 1 as const;   // truthy token: the account always exists
  Object.assign(rt, {
    AccountInfoInteger: getter(rt, I, acc, 4003, 0, false), AccountInfoDouble: getter(rt, D, acc, 4003, 0, false), AccountInfoString: getter(rt, S, acc, 4003, '', false),
  });
}

export function installMql5(rt: Rt, b: MtBroker, env: Env): Sel {
  const st: Sel = { pos: 0, ord: 0, deals: [], horders: [] };
  const pos = (t?: number) => b.positions.find(p => p.ticket === (t ?? st.pos));
  const ord = (t?: number) => b.orders.find(o => o.ticket === (t ?? st.ord));
  const hord = (t?: number) => b.historyOrders.find(o => o.ticket === t);
  const deal = (t?: number) => b.deals.find(d => d.ticket === t);
  const symOk = (s: unknown) => !s || s === env.symbol;

  const PI = group<Pos>(rt, 400, {
    POSITION_TICKET: p => p.ticket, POSITION_TIME: p => p.time, POSITION_TIME_MSC: p => p.time * 1000, POSITION_TIME_UPDATE: p => p.timeUpdate,
    POSITION_TIME_UPDATE_MSC: p => p.timeUpdate * 1000, POSITION_TYPE: p => (p.type === 'buy' ? 0 : 1), POSITION_MAGIC: p => p.magic,
    POSITION_IDENTIFIER: p => p.identifier, POSITION_REASON: p => p.reason,
  });
  const PD = group<Pos>(rt, 430, {
    POSITION_VOLUME: p => p.volume, POSITION_PRICE_OPEN: p => p.price, POSITION_SL: p => p.sl, POSITION_TP: p => p.tp, POSITION_PRICE_CURRENT: p => b.closePrice(p),
    POSITION_SWAP: p => p.swap, POSITION_PROFIT: p => b.posProfit(p), POSITION_COMMISSION: p => p.commission,
  });
  const PS = group<Pos>(rt, 460, { POSITION_SYMBOL: p => p.symbol, POSITION_COMMENT: p => p.comment, POSITION_EXTERNAL_ID: () => '' });
  const OI = group<Ord>(rt, 500, {
    ORDER_TICKET: o => o.ticket, ORDER_TIME_SETUP: o => o.time, ORDER_TYPE: o => o.code, ORDER_STATE: o => o.state, ORDER_TIME_EXPIRATION: o => o.expiration,
    ORDER_TIME_DONE: o => o.timeDone, ORDER_TIME_SETUP_MSC: o => o.time * 1000, ORDER_TIME_DONE_MSC: o => o.timeDone * 1000, ORDER_TYPE_FILLING: o => o.filling,
    ORDER_TYPE_TIME: o => o.typeTime, ORDER_MAGIC: o => o.magic, ORDER_REASON: o => o.reason, ORDER_POSITION_ID: o => o.positionId, ORDER_POSITION_BY_ID: o => o.positionBy,
  });
  const OD = group<Ord>(rt, 530, {
    ORDER_VOLUME_INITIAL: o => o.volumeInit, ORDER_VOLUME_CURRENT: o => o.volume, ORDER_PRICE_OPEN: o => o.price, ORDER_SL: o => o.sl, ORDER_TP: o => o.tp,
    ORDER_PRICE_CURRENT: o => (sideOf(o.code) === 'buy' ? b.ask : b.bid), ORDER_PRICE_STOPLIMIT: o => o.stopLimit,
  });
  const OS = group<Ord>(rt, 560, { ORDER_SYMBOL: o => o.symbol, ORDER_COMMENT: o => o.comment, ORDER_EXTERNAL_ID: () => '' });
  const DI = group<Deal>(rt, 600, {
    DEAL_TICKET: d => d.ticket, DEAL_ORDER: d => d.order, DEAL_TIME: d => d.time, DEAL_TIME_MSC: d => d.time * 1000, DEAL_TYPE: d => (d.type === 'buy' ? 0 : 1),
    DEAL_ENTRY: d => d.entryCode, DEAL_MAGIC: d => d.magic, DEAL_REASON: d => d.reason, DEAL_POSITION_ID: d => d.position,
  });
  const DD = group<Deal>(rt, 630, {
    DEAL_VOLUME: d => d.volume, DEAL_PRICE: d => d.price, DEAL_COMMISSION: d => d.commission, DEAL_SWAP: d => d.swap, DEAL_PROFIT: d => d.profit, DEAL_FEE: () => 0,
    DEAL_SL: () => 0, DEAL_TP: () => 0,
  });
  const DS = group<Deal>(rt, 660, { DEAL_SYMBOL: d => d.symbol, DEAL_COMMENT: d => d.comment, DEAL_EXTERNAL_ID: () => '' });
  const P = ERR5.ERR_TRADE_POSITION_NOT_FOUND, O = ERR5.ERR_TRADE_ORDER_NOT_FOUND, D = ERR5.ERR_TRADE_DEAL_NOT_FOUND;
  const pick = <T extends { ticket: number }>(list: T[], i: number, set: (t: number) => void) => { const x = list[i]; if (!x) return 0; set(x.ticket); return x.ticket };
  const send = (req: MqlTradeRequest, res: MqlTradeResult) => {
    const r = copyResult(res, b.send(req));
    if (okRc(r.retcode)) return true;
    rt._LastError = ERR5.ERR_TRADE_SEND_FAILED;
    return false;
  };

  Object.assign(rt, {
    MqlTradeRequest, MqlTradeResult, MqlTradeCheckResult, MqlTradeTransaction,
    OrderSend: send, OrderSendAsync: send,
    OrderCheck: (req: MqlTradeRequest, cr: MqlTradeCheckResult) => copyCheck(cr, b.send(req, true)).retcode === 0,
    OrderCalcMargin(_type: number, symbol: string, volume: number, price: number, out: Ref<number>) {
      if (!symOk(symbol)) { rt._LastError = ERR5.ERR_TRADE_CALC_FAILED; return false }
      out.v = b.marginFor(volume, price); return true;
    },
    OrderCalcProfit(type: number, symbol: string, volume: number, open: number, close: number, out: Ref<number>) {
      if (!symOk(symbol)) { rt._LastError = ERR5.ERR_TRADE_CALC_FAILED; return false }
      out.v = b.pnl(sideOf(type), volume, open, close); return true;
    },
    PositionsTotal: () => b.positions.length,
    PositionGetSymbol: (i: number) => { const p = b.positions[i]; if (!p) { rt._LastError = P; return '' } st.pos = p.ticket; return p.symbol },
    PositionGetTicket: (i: number) => pick(b.positions, i, t => { st.pos = t }),
    PositionSelect: (symbol: string) => { const p = b.positions.find(x => x.symbol === (symbol || env.symbol)); if (!p) { rt._LastError = P; return false } st.pos = p.ticket; return true },
    PositionSelectByTicket: (t: number) => { if (!pos(t)) { rt._LastError = P; return false } st.pos = t; return true },
    PositionGetInteger: getter(rt, PI, () => pos(), P, 0, false), PositionGetDouble: getter(rt, PD, () => pos(), P, 0, false), PositionGetString: getter(rt, PS, () => pos(), P, '', false),
    OrdersTotal: () => b.orders.length,
    OrderGetTicket: (i: number) => pick(b.orders, i, t => { st.ord = t }),
    OrderSelect: (t: number) => { if (!ord(t)) { rt._LastError = O; return false } st.ord = t; return true },
    OrderGetInteger: getter(rt, OI, () => ord(), O, 0, false), OrderGetDouble: getter(rt, OD, () => ord(), O, 0, false), OrderGetString: getter(rt, OS, () => ord(), O, '', false),
    HistorySelect(from: number, to: number) {
      st.deals = b.deals.filter(d => d.time >= from && d.time <= to);
      st.horders = b.historyOrders.filter(o => (o.timeDone || o.time) >= from && (o.timeDone || o.time) <= to);
      return true;
    },
    HistorySelectByPosition(id: number) {
      st.deals = b.deals.filter(d => d.position === id);
      st.horders = b.historyOrders.filter(o => o.positionId === id);
      return true;
    },
    HistoryDealSelect: (t: number) => { const d = deal(t); if (!d) { rt._LastError = D; return false } st.deals = [d]; return true },
    HistoryOrderSelect: (t: number) => { const o = hord(t); if (!o) { rt._LastError = O; return false } st.horders = [o]; return true },
    HistoryDealsTotal: () => st.deals.length,
    HistoryOrdersTotal: () => st.horders.length,
    HistoryDealGetTicket: (i: number) => st.deals[i]?.ticket ?? 0,
    HistoryOrderGetTicket: (i: number) => st.horders[i]?.ticket ?? 0,
    HistoryDealGetInteger: getter(rt, DI, deal, D, 0, true), HistoryDealGetDouble: getter(rt, DD, deal, D, 0, true), HistoryDealGetString: getter(rt, DS, deal, D, '', true),
    HistoryOrderGetInteger: getter(rt, OI, hord, O, 0, true), HistoryOrderGetDouble: getter(rt, OD, hord, O, 0, true), HistoryOrderGetString: getter(rt, OS, hord, O, '', true),
  });
  return st;
}
