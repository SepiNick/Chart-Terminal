// MQL5 Standard Library trade classes (CTrade, CPositionInfo, ...), implemented from the public class reference.
import type { Env, Rt } from '../contract.ts';
import { MtBroker, ORDER_NAMES, type Deal, type Ord, type Pos, type TradeReq } from './broker.ts';
import { rcText } from './constants.ts';
import { MqlTradeCheckResult, MqlTradeRequest, MqlTradeResult, copyCheck, copyResult, okRc, type Sel } from './mql5.ts';

const desc = (code: number) => ORDER_NAMES[code]?.replace(/_/g, ' ') ?? 'unknown';
const STATES = ['started', 'placed', 'canceled', 'partial', 'filled', 'rejected', 'expired'];
const ENTRIES = ['in', 'out', 'in/out', 'out by'];

export function installClasses(rt: Rt, b: MtBroker, env: Env, st: Sel) {
  const sym = (s?: string | null) => s || env.symbol;
  const findPos = (t: number) => b.positions.find(p => p.ticket === t);

  class CTrade {
    magic = 0; deviation = 10; filling = 0; async = false; marginMode = b.hedging ? 2 : 0; logLevel = 1;
    req = new MqlTradeRequest(); res = new MqlTradeResult(); chk = new MqlTradeCheckResult();
    private run(r: Partial<TradeReq>) {
      this.req = Object.assign(new MqlTradeRequest(), { magic: this.magic, deviation: this.deviation, type_filling: this.filling, symbol: env.symbol }, r);
      this.res = new MqlTradeResult(); this.chk = new MqlTradeCheckResult();
      const c = copyCheck(this.chk, b.send(this.req, true));
      if (c.retcode !== 0) { this.res.retcode = c.retcode; this.res.comment = c.comment; return false }
      copyResult(this.res, b.send(this.req));
      if (this.logLevel > 1) this.PrintResult();
      return okRc(this.res.retcode);
    }
    private pos(x: string | number) { return typeof x === 'number' ? findPos(x) : b.positions.find(p => p.symbol === sym(x)) }
    private close(p: Pos | undefined, volume: number) {
      if (!p) { this.res = new MqlTradeResult(); this.res.retcode = 10036; return false }
      return this.run({ action: 1, position: p.ticket, symbol: p.symbol, type: p.type === 'buy' ? 1 : 0, volume, price: b.closePrice(p) });
    }
    SetExpertMagicNumber(m: number) { this.magic = m }
    SetDeviationInPoints(d: number) { this.deviation = d }
    SetTypeFilling(f: number) { this.filling = f }
    SetTypeFillingBySymbol(_s: string) { this.filling = 0; return true }
    SetAsyncMode(a: boolean) { this.async = a }
    SetMarginMode() { this.marginMode = b.hedging ? 2 : 0 }
    LogLevel(l: number) { this.logLevel = l }
    RequestMagic() { return this.req.magic }
    // market & pending
    PositionOpen(s: string, type: number, volume: number, price: number, sl: number, tp: number, comment = '') {
      return this.run({ action: 1, symbol: sym(s), type, volume, price: price || (type === 0 ? b.ask : b.bid), sl, tp, comment });
    }
    Buy(volume: number, s: string | null = null, price = 0, sl = 0, tp = 0, comment = '') { return this.PositionOpen(sym(s), 0, volume, price, sl, tp, comment) }
    Sell(volume: number, s: string | null = null, price = 0, sl = 0, tp = 0, comment = '') { return this.PositionOpen(sym(s), 1, volume, price, sl, tp, comment) }
    OrderOpen(s: string, type: number, volume: number, limit: number, price: number, sl: number, tp: number, type_time = 0, expiration = 0, comment = '') {
      return this.run({ action: 5, symbol: sym(s), type, volume, stoplimit: limit, price, sl, tp, type_time, expiration, comment });
    }
    BuyLimit(volume: number, price: number, s: string | null = null, sl = 0, tp = 0, tt = 0, exp = 0, comment = '') { return this.OrderOpen(sym(s), 2, volume, 0, price, sl, tp, tt, exp, comment) }
    SellLimit(volume: number, price: number, s: string | null = null, sl = 0, tp = 0, tt = 0, exp = 0, comment = '') { return this.OrderOpen(sym(s), 3, volume, 0, price, sl, tp, tt, exp, comment) }
    BuyStop(volume: number, price: number, s: string | null = null, sl = 0, tp = 0, tt = 0, exp = 0, comment = '') { return this.OrderOpen(sym(s), 4, volume, 0, price, sl, tp, tt, exp, comment) }
    SellStop(volume: number, price: number, s: string | null = null, sl = 0, tp = 0, tt = 0, exp = 0, comment = '') { return this.OrderOpen(sym(s), 5, volume, 0, price, sl, tp, tt, exp, comment) }
    OrderModify(ticket: number, price: number, sl: number, tp: number, type_time = 0, expiration = 0, stoplimit = 0) {
      return this.run({ action: 7, order: ticket, price, sl, tp, type_time, expiration, stoplimit });
    }
    OrderDelete(ticket: number) { return this.run({ action: 8, order: ticket }) }
    // positions (symbol or ticket overloads)
    PositionModify(x: string | number, sl: number, tp: number) {
      const p = this.pos(x);
      return this.run({ action: 6, position: p?.ticket ?? 0, symbol: p?.symbol ?? sym(String(x)), sl, tp });
    }
    PositionClose(x: string | number, _deviation?: number) { const p = this.pos(x); return this.close(p, p?.volume ?? 0) }
    PositionClosePartial(x: string | number, volume: number, _deviation?: number) { return this.close(this.pos(x), volume) }
    PositionCloseBy(ticket: number, by: number) { return this.run({ action: 10, position: ticket, position_by: by }) }
    // request / result / check accessors
    Request(r: MqlTradeRequest) { Object.assign(r, this.req) }
    RequestAction() { return this.req.action } RequestActionDescription() { return String(this.req.action) }
    RequestOrder() { return this.req.order } RequestSymbol() { return this.req.symbol } RequestVolume() { return this.req.volume }
    RequestPrice() { return this.req.price } RequestStopLimit() { return this.req.stoplimit } RequestSL() { return this.req.sl } RequestTP() { return this.req.tp }
    RequestDeviation() { return this.req.deviation } RequestType() { return this.req.type } RequestTypeDescription() { return desc(this.req.type) }
    RequestTypeFilling() { return this.req.type_filling } RequestTypeTime() { return this.req.type_time } RequestExpiration() { return this.req.expiration }
    RequestComment() { return this.req.comment } RequestPosition() { return this.req.position } RequestPositionBy() { return this.req.position_by }
    Result(r: MqlTradeResult) { Object.assign(r, this.res) }
    ResultRetcode() { return this.res.retcode } ResultRetcodeDescription() { return rcText(this.res.retcode) } ResultRetcodeExternal() { return this.res.retcode_external }
    ResultDeal() { return this.res.deal } ResultOrder() { return this.res.order } ResultVolume() { return this.res.volume } ResultPrice() { return this.res.price }
    ResultBid() { return this.res.bid } ResultAsk() { return this.res.ask } ResultComment() { return this.res.comment }
    CheckResult(r: MqlTradeCheckResult) { Object.assign(r, this.chk) }
    CheckResultRetcode() { return this.chk.retcode } CheckResultRetcodeDescription() { return rcText(this.chk.retcode) }
    CheckResultBalance() { return this.chk.balance } CheckResultEquity() { return this.chk.equity } CheckResultProfit() { return this.chk.profit }
    CheckResultMargin() { return this.chk.margin } CheckResultMarginFree() { return this.chk.margin_free } CheckResultMarginLevel() { return this.chk.margin_level }
    CheckResultComment() { return this.chk.comment }
    PrintRequest() { const r = this.req; env.log('print', `request: action=${r.action} ${desc(r.type)} ${r.volume} ${r.symbol} at ${r.price} sl=${r.sl} tp=${r.tp} position=${r.position} order=${r.order}`) }
    PrintResult() { const r = this.res; env.log('print', `result: ${r.retcode} (${rcText(r.retcode)}) deal=${r.deal} order=${r.order} volume=${r.volume} price=${r.price}`) }
  }

  class CPositionInfo {
    t = 0; private saved = '';
    private p() { return findPos(this.t) }
    private f<T>(g: (p: Pos) => T, d: T) { const p = this.p(); return p ? g(p) : d }
    Select(s: string) { const p = b.positions.find(x => x.symbol === sym(s)); this.t = p?.ticket ?? 0; if (p) st.pos = p.ticket; return !!p }
    SelectByIndex(i: number) { const p = b.positions[i]; this.t = p?.ticket ?? 0; if (p) st.pos = p.ticket; return !!p }
    SelectByTicket(t: number) { const p = findPos(t); this.t = p ? t : 0; if (p) st.pos = t; return !!p }
    SelectByMagic(s: string, magic: number) { const p = b.positions.find(x => x.symbol === sym(s) && x.magic === magic); this.t = p?.ticket ?? 0; if (p) st.pos = p.ticket; return !!p }
    Ticket() { return this.f(p => p.ticket, 0) } Time() { return this.f(p => p.time, 0) } TimeMsc() { return this.f(p => p.time * 1000, 0) }
    TimeUpdate() { return this.f(p => p.timeUpdate, 0) } TimeUpdateMsc() { return this.f(p => p.timeUpdate * 1000, 0) }
    PositionType() { return this.f(p => (p.type === 'buy' ? 0 : 1), 0) } Type() { return this.PositionType() } TypeDescription() { return this.f(p => p.type, '') }
    Magic() { return this.f(p => p.magic, 0) } Identifier() { return this.f(p => p.identifier, 0) } Volume() { return this.f(p => p.volume, 0) }
    PriceOpen() { return this.f(p => p.price, 0) } StopLoss() { return this.f(p => p.sl, 0) } TakeProfit() { return this.f(p => p.tp, 0) }
    PriceCurrent() { return this.f(p => b.closePrice(p), 0) } Commission() { return this.f(p => p.commission, 0) } Swap() { return this.f(p => p.swap, 0) }
    Profit() { return this.f(p => b.posProfit(p), 0) } Symbol() { return this.f(p => p.symbol, '') } Comment() { return this.f(p => p.comment, '') }
    private state() { return this.f(p => [p.type, p.volume, p.price, p.sl, p.tp].join(), '') }
    StoreState() { this.saved = this.state() }
    CheckState() { return this.state() !== this.saved }
  }

  // Order info over active (COrderInfo) or history (CHistoryOrderInfo) orders.
  const orderInfo = (list: () => Ord[], history: boolean) => class {
    t = 0; private saved = '';
    protected o() { return (history ? b.historyOrders : b.orders).find(x => x.ticket === this.t) }
    protected f<T>(g: (o: Ord) => T, d: T) { const o = this.o(); return o ? g(o) : d }
    Ticket(t?: number) { if (t === undefined) return this.t; this.t = t; return t }
    Select(t: number) { this.t = t; if (!history && this.o()) st.ord = t; return !!this.o() }
    SelectByIndex(i: number) { const o = list()[i]; this.t = o?.ticket ?? 0; if (o && !history) st.ord = o.ticket; return !!o }
    TimeSetup() { return this.f(o => o.time, 0) } TimeSetupMsc() { return this.f(o => o.time * 1000, 0) } TimeDone() { return this.f(o => o.timeDone, 0) }
    TimeDoneMsc() { return this.f(o => o.timeDone * 1000, 0) } TimeExpiration() { return this.f(o => o.expiration, 0) }
    OrderType() { return this.f(o => o.code, 0) } Type() { return this.OrderType() } TypeDescription() { return this.f(o => desc(o.code), '') }
    State() { return this.f(o => o.state, 0) } StateDescription() { return this.f(o => STATES[o.state] ?? '', '') }
    TypeFilling() { return this.f(o => o.filling, 0) } TypeTime() { return this.f(o => o.typeTime, 0) } Magic() { return this.f(o => o.magic, 0) }
    PositionId() { return this.f(o => o.positionId, 0) } PositionById() { return this.f(o => o.positionBy, 0) }
    VolumeInitial() { return this.f(o => o.volumeInit, 0) } VolumeCurrent() { return this.f(o => o.volume, 0) } PriceOpen() { return this.f(o => o.price, 0) }
    StopLoss() { return this.f(o => o.sl, 0) } TakeProfit() { return this.f(o => o.tp, 0) } PriceStopLimit() { return this.f(o => o.stopLimit, 0) }
    PriceCurrent() { return this.f(o => (o.code % 2 ? b.bid : b.ask), 0) } Symbol() { return this.f(o => o.symbol, '') } Comment() { return this.f(o => o.comment, '') }
    StoreState() { this.saved = this.f(o => [o.code, o.state, o.price, o.sl, o.tp, o.volume].join(), '') }
    CheckState() { return this.f(o => [o.code, o.state, o.price, o.sl, o.tp, o.volume].join(), '') !== this.saved }
  };
  const COrderInfo = orderInfo(() => b.orders, false), CHistoryOrderInfo = orderInfo(() => st.horders, true);

  class CDealInfo {
    t = 0;
    private f<T>(g: (d: Deal) => T, d: T) { const x = b.deals.find(y => y.ticket === this.t); return x ? g(x) : d }
    Ticket(t?: number) { if (t === undefined) return this.t; this.t = t; return t }
    SelectByIndex(i: number) { const d = st.deals[i]; this.t = d?.ticket ?? 0; return !!d }
    Order() { return this.f(d => d.order, 0) } Time() { return this.f(d => d.time, 0) } TimeMsc() { return this.f(d => d.time * 1000, 0) }
    DealType() { return this.f(d => (d.type === 'buy' ? 0 : 1), 0) } Type() { return this.DealType() } TypeDescription() { return this.f(d => d.type, '') }
    Entry() { return this.f(d => d.entryCode, 0) } EntryDescription() { return this.f(d => ENTRIES[d.entryCode], '') } Magic() { return this.f(d => d.magic, 0) }
    PositionId() { return this.f(d => d.position, 0) } Volume() { return this.f(d => d.volume, 0) } Price() { return this.f(d => d.price, 0) }
    Commission() { return this.f(d => d.commission, 0) } Swap() { return this.f(d => d.swap, 0) } Profit() { return this.f(d => d.profit, 0) }
    Symbol() { return this.f(d => d.symbol, '') } Comment() { return this.f(d => d.comment, '') }
  }

  class CSymbolInfo {
    name = env.symbol;
    Name(s?: string) { if (s === undefined) return this.name; this.name = s; return s === env.symbol }
    Select() { return true } IsSynchronized() { return true } Refresh() { return true } RefreshRates() { return true }
    Bid() { return b.bid } Ask() { return b.ask } Last() { return b.bid } Time() { return b.now }
    Point() { return env.point } Digits() { return env.digits } Spread() { return Math.round((b.ask - b.bid) / env.point) } SpreadFloat() { return true }
    StopsLevel() { return env.account.stopLevelPoints } FreezeLevel() { return 0 }
    LotsMin() { return env.account.minLot } LotsMax() { return env.account.maxLot } LotsStep() { return env.account.lotStep } LotsLimit() { return 0 }
    ContractSize() { return env.account.contractSize } TickSize() { return env.point }
    TickValue() { return env.account.contractSize * env.point } TickValueProfit() { return this.TickValue() } TickValueLoss() { return this.TickValue() }
    SwapLong() { return 0 } SwapShort() { return 0 } TradeExecution() { return 2 } TradeFillFlags() { return 3 } TradeMode() { return 4 }
    CurrencyBase() { return env.account.currency } CurrencyProfit() { return env.account.currency } CurrencyMargin() { return env.account.currency }
    Description() { return env.symbol }
    NormalizePrice(p: number) { return +(Math.round(p / env.point) * env.point).toFixed(env.digits) }
  }

  class CAccountInfo {
    Login() { return 1 } TradeMode() { return 0 } TradeModeDescription() { return 'Demo trading account' } Leverage() { return env.account.leverage }
    MarginMode() { return b.hedging ? 2 : 0 } MarginModeDescription() { return b.hedging ? 'Retail hedging' : 'Retail netting' }
    StopoutMode() { return 0 } TradeAllowed() { return true } TradeExpert() { return true } LimitOrders() { return 0 }
    Balance() { return b.balance() } Credit() { return 0 } Profit() { return b.profit() } Equity() { return b.equity() } Margin() { return b.margin() }
    FreeMargin() { return b.freeMargin() } MarginLevel() { return b.marginLevel() } MarginCall() { return b.marginCallLevel } MarginStopOut() { return b.stopOutLevel }
    Name() { return 'Simulator' } Server() { return 'Simulator' } Company() { return 'Simulator' } Currency() { return env.account.currency }
    OrderProfitCheck(_s: string, type: number, volume: number, open: number, close: number) { return b.pnl(type % 2 ? 'sell' : 'buy', volume, open, close) }
    MarginCheck(_s: string, _type: number, volume: number, price: number) { return b.marginFor(volume, price) }
    FreeMarginCheck(_s: string, type: number, volume: number, price: number) {
      const side = type % 2 ? 'sell' : 'buy';
      return Math.round((b.equity() - b.marginAfter(side, volume, price, b.hedging ? undefined : b.netPos(env.symbol))) * 100) / 100;
    }
    MaxLotCheck(_s: string, _type: number, price: number, percent = 100) {
      const a = env.account, per = b.marginFor(1, price);
      if (!(per > 0)) return 0;
      const v = Math.min(a.maxLot, Math.floor(b.freeMargin() * percent / 100 / per / a.lotStep + 1e-9) * a.lotStep);
      return v < a.minLot ? 0 : +v.toFixed(8);
    }
  }

  Object.assign(rt, { CTrade, CPositionInfo, COrderInfo, CHistoryOrderInfo, CDealInfo, CSymbolInfo, CAccountInfo });
}
