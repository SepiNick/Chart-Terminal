// MetaTrader-style trade server emulator for a single symbol (hedging or netting), driven by onTick(bid, ask, time).
// Clean-room implementation from the public MQL4/MQL5 trading documentation.
import type { BrokerView, Env } from '../contract.ts';
import { RC, rcText } from './constants.ts';

export type Side = 'buy' | 'sell';
export interface Pos { ticket: number; identifier: number; type: Side; volume: number; price: number; sl: number; tp: number; time: number; timeUpdate: number; magic: number; comment: string; symbol: string; commission: number; swap: number; reason: number }
export interface Ord { ticket: number; code: number; type: string; volume: number; volumeInit: number; price: number; stopLimit: number; sl: number; tp: number; time: number; timeDone: number; expiration: number; typeTime: number; filling: number; state: number; magic: number; comment: string; symbol: string; positionId: number; positionBy: number; reason: number }
export type Deal = BrokerView['deals'][number] & { entryCode: number; reason: number };
/** MQL4 history record (closed market order or deleted pending order). */
export interface Closed4 { ticket: number; code: number; volume: number; price: number; time: number; closePrice: number; closeTime: number; sl: number; tp: number; profit: number; commission: number; swap: number; magic: number; comment: string; expiration: number; symbol: string }
export interface TradeReq { action: number; magic: number; order: number; symbol: string; volume: number; price: number; stoplimit: number; sl: number; tp: number; deviation: number; type: number; type_filling: number; type_time: number; expiration: number; comment: string; position: number; position_by: number }
export interface TradeRes { retcode: number; deal: number; order: number; volume: number; price: number; bid: number; ask: number; comment: string; request_id: number; retcode_external: number; balance: number; equity: number; profit: number; margin: number; margin_free: number; margin_level: number }
export type BrokerEnv = Pick<Env, 'dialect' | 'symbol' | 'point' | 'digits' | 'account'> & Partial<Pick<Env, 'tfSec' | 'spreadPoints' | 'price' | 'now'>>;

export const ORDER_NAMES = ['buy', 'sell', 'buy_limit', 'sell_limit', 'buy_stop', 'sell_stop', 'buy_stop_limit', 'sell_stop_limit', 'close_by'];
export const sideOf = (code: number): Side => (code % 2 ? 'sell' : 'buy');
export const ST = { PLACED: 1, CANCELED: 2, FILLED: 4, REJECTED: 5, EXPIRED: 6 };
export const RS = { EXPERT: 3, SL: 4, TP: 5, SO: 6 };
const ENTRY = ['in', 'out', 'inout', 'out'] as const;
const TAG: Record<number, string> = { 4: '[sl]', 5: '[tp]', 6: '[so]' };
const EPS = 1e-8;
const money = (x: number) => Math.round(x * 100) / 100;
const lots = (x: number) => +x.toFixed(8);
const eod = (t: number) => Math.floor(t / 86400) * 86400 + 86400;
interface Tick { bid: number; ask: number; time: number }
interface Opts { sl?: number; tp?: number; magic?: number; comment?: string; order: number; reason: number; target?: Pos; noComm?: boolean; entryCode?: number }

export class MtBroker implements BrokerView {
  env: BrokerEnv;
  hedging: boolean;
  mql4: boolean;
  positions: Pos[] = [];
  orders: Ord[] = [];
  deals: Deal[] = [];
  historyOrders: Ord[] = [];   // MQL5 history orders
  history4: Closed4[] = [];    // MQL4 account history
  stopOutLevel = 50;
  marginCallLevel = 100;
  private bal: number;
  private tick?: Tick;
  private nOrd = 1;
  private nDeal = 1;

  constructor(env: BrokerEnv) {
    this.env = env; this.mql4 = env.dialect === 'mql4';
    this.hedging = this.mql4 || env.account.hedging;
    this.bal = env.account.balance;
  }

  // ---------- quotes & account ----------
  get acct() { return this.env.account }
  get bid() { return this.tick ? this.tick.bid : this.env.price?.() ?? 0 }
  get ask() { return this.tick ? this.tick.ask : this.bid + (this.env.spreadPoints ?? 0) * this.env.point }
  get now() { return this.tick ? this.tick.time : this.env.now?.() ?? 0 }
  private get tol() { return this.env.point * 1e-3 }
  balance() { return this.bal }
  pnl(side: Side, vol: number, open: number, close: number) { return money((side === 'buy' ? close - open : open - close) * vol * this.acct.contractSize) }
  closePrice(p: { type: Side }) { return p.type === 'buy' ? this.bid : this.ask }
  posProfit(p: Pos) { return this.pnl(p.type, p.volume, p.price, this.closePrice(p)) }
  profit() { return money(this.positions.reduce((a, p) => a + this.posProfit(p) + p.swap, 0)) }
  equity() { return money(this.bal + this.profit()) }
  marginFor(vol: number, price: number) { return money(price * vol * this.acct.contractSize / this.acct.leverage) }
  margin() { return money(this.positions.reduce((a, p) => a + this.marginFor(p.volume, p.price), 0)) }
  freeMargin() { return money(this.equity() - this.margin()) }
  marginLevel() { const m = this.margin(); return m > 0 ? this.equity() / m * 100 : 0 }
  commission(vol: number) { return money(-this.acct.commissionPerLot * vol) }
  netPos(sym: string) { return this.positions.find(p => p.symbol === sym) }

  /** Account margin after a deal of `vol` on `side` at `price` (t = the position it would close/net against). */
  marginAfter(side: Side, vol: number, price: number, t?: Pos) {
    const m = this.margin();
    if (!t) return money(m + this.marginFor(vol, price));
    if (this.hedging) return t.type === side ? money(m + this.marginFor(vol, price)) : money(m - this.marginFor(Math.min(vol, t.volume), t.price));
    const base = m - this.marginFor(t.volume, t.price);
    if (t.type === side) return money(base + this.marginFor(t.volume + vol, (t.price * t.volume + price * vol) / (t.volume + vol)));
    const rest = vol - t.volume;
    return money(base + (rest > EPS ? this.marginFor(rest, price) : rest < -EPS ? this.marginFor(-rest, t.price) : 0));
  }
  noMoney(side: Side, vol: number, price: number, t?: Pos) {
    const after = this.marginAfter(side, vol, price, t);
    return after > this.margin() + EPS && this.equity() + this.commission(vol) - after < 0;
  }

  // ---------- validation ----------
  badVolume(v: number) {
    const a = this.acct, k = v / a.lotStep;
    return !(v > 0) || v < a.minLot - EPS || v > a.maxLot + EPS || Math.abs(k - Math.round(k)) > 1e-6;
  }
  /** SL/TP must sit at least StopLevel away from `ref` (market close price, or the pending order's price) on the correct side. */
  badStops(side: Side, ref: number, sl: number, tp: number) {
    const lvl = this.acct.stopLevelPoints * this.env.point, s = side === 'buy' ? 1 : -1;
    const bad = (d: number) => d <= this.tol || d < lvl - this.tol;
    return (sl > 0 && bad((ref - sl) * s)) || (tp > 0 && bad((tp - ref) * s));
  }
  private checkPending(code: number, price: number, sp: number, sl: number, tp: number) {
    const lvl = this.acct.stopLevelPoints * this.env.point;
    const d = code === 2 ? this.ask - price : code === 3 ? price - this.bid : code % 2 === 0 ? price - this.ask : this.bid - price;
    if (!(price > 0) || d <= this.tol || d < lvl - this.tol) return RC.INVALID_PRICE;
    if (code >= 6 && !(sp > 0)) return RC.INVALID_PRICE;
    return this.badStops(sideOf(code), code >= 6 ? sp : price, sl, tp) ? RC.INVALID_STOPS : 0;
  }
  /** Expiration time for ORDER_TIME_*; 0 = none, -1 = invalid. */
  expiry(tt: number, exp: number) {
    if (tt === 0) return 0;
    if (tt === 1) return eod(this.now);
    if (tt === 2) return exp > this.now ? exp : -1;
    if (tt === 3) return exp > 0 && eod(exp) > this.now ? eod(exp) : -1;
    return -1;
  }
  private same(a: number, b: number) { return Math.abs(a - b) <= this.tol }

  // ---------- trade requests (MqlTradeRequest semantics; dry = OrderCheck) ----------
  send(r: Partial<TradeReq>, dry = false): TradeRes {
    const eq = this.equity();
    const res: TradeRes = { retcode: 0, deal: 0, order: 0, volume: 0, price: 0, bid: this.bid, ask: this.ask, comment: '', request_id: 0, retcode_external: 0,
      balance: this.bal, equity: eq, profit: this.profit(), margin: this.margin(), margin_free: this.freeMargin(), margin_level: this.marginLevel() };
    const fail = (rc: number) => { res.retcode = rc; res.comment = rcText(rc); return res };
    const ok = (after = res.margin) => {
      res.retcode = dry ? 0 : RC.DONE; res.comment = dry ? 'done' : rcText(RC.DONE);
      res.margin = after; res.margin_free = money(eq - after); res.margin_level = after > 0 ? eq / after * 100 : 0;
      return res;
    };
    const sym = r.symbol || this.env.symbol, vol = r.volume ?? 0, sl = r.sl ?? 0, tp = r.tp ?? 0, type = r.type ?? 0;
    const findPos = (t?: number) => this.positions.find(p => p.ticket === t);
    switch (r.action) {
      case 1: { // TRADE_ACTION_DEAL
        if (sym !== this.env.symbol) return fail(RC.INVALID);
        if (type !== 0 && type !== 1) return fail(RC.INVALID_ORDER);
        if (this.badVolume(vol)) return fail(RC.INVALID_VOLUME);
        const side = sideOf(type), px = side === 'buy' ? this.ask : this.bid;
        let t: Pos | undefined;
        if (r.position) {
          t = findPos(r.position);
          if (!t) return fail(RC.POSITION_CLOSED);
          if (t.type === side) return fail(RC.INVALID);
          if (this.hedging && vol > t.volume + EPS) return fail(RC.INVALID_CLOSE_VOLUME);
        } else if (!this.hedging) t = this.netPos(sym);
        const closing = !!t && t.type !== side, rest = closing ? t!.volume - vol : 0;
        if (closing && rest > EPS && rest < this.acct.minLot - EPS) return fail(RC.INVALID_VOLUME);
        if ((!closing || rest < -EPS) && this.badStops(side, side === 'buy' ? this.bid : this.ask, sl, tp)) return fail(RC.INVALID_STOPS);
        if (this.noMoney(side, vol, px, t)) return fail(RC.NO_MONEY);
        if (dry) return ok(this.marginAfter(side, vol, px, t));
        const order = closing && this.mql4 ? 0 : this.mkOrder(type, vol, px, r, t?.identifier).ticket;
        const d = this.execute(side, vol, px, { sl, tp, magic: r.magic ?? 0, comment: r.comment ?? '', order, reason: RS.EXPERT, target: t });
        Object.assign(res, { deal: d.ticket, order, volume: vol, price: px });
        return ok(this.margin());
      }
      case 5: { // TRADE_ACTION_PENDING
        if (sym !== this.env.symbol) return fail(RC.INVALID);
        if (!(type >= 2 && type <= (this.mql4 ? 5 : 7))) return fail(RC.INVALID_ORDER);
        if (this.badVolume(vol)) return fail(RC.INVALID_VOLUME);
        const price = r.price ?? 0, sp = type >= 6 ? r.stoplimit ?? 0 : 0;
        const bad = this.checkPending(type, price, sp, sl, tp);
        if (bad) return fail(bad);
        const tt = r.type_time ?? 0, exp = this.expiry(tt, r.expiration ?? 0);
        if (exp < 0) return fail(RC.INVALID_EXPIRATION);
        if (dry) return ok();
        const o: Ord = { ticket: this.nOrd++, code: type, type: ORDER_NAMES[type], volume: vol, volumeInit: vol, price, stopLimit: sp, sl, tp, time: this.now, timeDone: 0,
          expiration: exp, typeTime: tt, filling: r.type_filling ?? 0, state: ST.PLACED, magic: r.magic ?? 0, comment: r.comment ?? '', symbol: sym, positionId: 0, positionBy: 0, reason: RS.EXPERT };
        this.orders.push(o);
        Object.assign(res, { order: o.ticket, volume: vol, price });
        return ok();
      }
      case 6: { // TRADE_ACTION_SLTP
        const p = r.position ? findPos(r.position) : this.netPos(sym);
        if (!p) return fail(RC.POSITION_CLOSED);
        if (this.same(sl, p.sl) && this.same(tp, p.tp)) return fail(RC.NO_CHANGES);
        if (this.badStops(p.type, this.closePrice(p), sl, tp)) return fail(RC.INVALID_STOPS);
        if (dry) return ok();
        p.sl = sl; p.tp = tp; p.timeUpdate = this.now;
        return ok();
      }
      case 7: { // TRADE_ACTION_MODIFY
        const o = this.orders.find(x => x.ticket === r.order);
        if (!o) return fail(RC.INVALID);
        const price = r.price || o.price, sp = o.code >= 6 ? r.stoplimit || o.stopLimit : 0;
        const tt = r.type_time ?? o.typeTime, exp = this.expiry(tt, r.expiration ?? 0);
        if (exp < 0) return fail(RC.INVALID_EXPIRATION);
        if (this.same(price, o.price) && this.same(sp, o.stopLimit) && this.same(sl, o.sl) && this.same(tp, o.tp) && exp === o.expiration) return fail(RC.NO_CHANGES);
        const bad = this.checkPending(o.code, price, sp, sl, tp);
        if (bad) return fail(bad);
        if (dry) return ok();
        Object.assign(o, { price, stopLimit: sp, sl, tp, typeTime: tt, expiration: exp });
        res.order = o.ticket;
        return ok();
      }
      case 8: { // TRADE_ACTION_REMOVE
        const o = this.orders.find(x => x.ticket === r.order);
        if (!o) return fail(RC.INVALID);
        if (dry) return ok();
        this.finishOrder(o, ST.CANCELED);
        res.order = o.ticket;
        return ok();
      }
      case 10: { // TRADE_ACTION_CLOSE_BY
        if (!this.hedging) return fail(RC.INVALID);
        const p = findPos(r.position), q = findPos(r.position_by);
        if (!p || !q) return fail(RC.POSITION_CLOSED);
        if (p.type === q.type || p.symbol !== q.symbol) return fail(RC.INVALID);
        if (dry) return ok();
        const v = Math.min(p.volume, q.volume), px = q.price;
        const order = this.mql4 ? 0 : this.mkOrder(8, v, px, r, p.identifier).ticket;
        const d = this.closePos(p, v, px, { order, reason: RS.EXPERT, noComm: true, entryCode: 3, magic: r.magic });
        this.closePos(q, v, px, { order, reason: RS.EXPERT, noComm: true, entryCode: 3, magic: r.magic });
        Object.assign(res, { deal: d.ticket, order, volume: v, price: px });
        return ok(this.margin());
      }
    }
    return fail(RC.INVALID);
  }

  // ---------- execution ----------
  private mkOrder(code: number, vol: number, px: number, r: Partial<TradeReq>, posId?: number, reason = RS.EXPERT): Ord {
    const t = this.nOrd++;
    const o: Ord = { ticket: t, code, type: ORDER_NAMES[code], volume: 0, volumeInit: vol, price: px, stopLimit: 0, sl: r.sl ?? 0, tp: r.tp ?? 0, time: this.now, timeDone: this.now,
      expiration: 0, typeTime: 0, filling: r.type_filling ?? 0, state: ST.FILLED, magic: r.magic ?? 0, comment: r.comment ?? '', symbol: this.env.symbol,
      positionId: posId ?? t, positionBy: r.position_by ?? 0, reason };
    if (!this.mql4) this.historyOrders.push(o);
    return o;
  }
  private addDeal(side: Side, entryCode: number, vol: number, px: number, profit: number, comm: number, o: Opts, position: number): Deal {
    this.bal = money(this.bal + profit + comm);
    const d: Deal = { ticket: this.nDeal++, order: o.order, position, time: this.now, type: side, entry: ENTRY[entryCode], entryCode, volume: vol, price: px,
      profit, commission: comm, swap: 0, magic: o.magic ?? 0, comment: o.comment ?? '', symbol: this.env.symbol, reason: o.reason };
    this.deals.push(d);
    return d;
  }
  /** Fill a deal: opens a position, adds to / reduces / reverses the netting position, or closes `target` (hedging). */
  private execute(side: Side, vol: number, px: number, o: Opts): Deal {
    const t = o.target, comm = this.commission(vol);
    if (t && t.type !== side) {
      if (this.hedging || vol <= t.volume + EPS) return this.closePos(t, Math.min(vol, t.volume), px, o);
      const profit = this.pnl(t.type, t.volume, t.price, px), rest = lots(vol - t.volume); // netting reversal: one in/out deal
      Object.assign(t, { type: side, volume: rest, price: px, time: this.now, timeUpdate: this.now, sl: o.sl ?? 0, tp: o.tp ?? 0, commission: money(comm * rest / vol) });
      return this.addDeal(side, 2, vol, px, profit, comm, o, t.identifier);
    }
    if (t) { // netting: add to position
      const v = lots(t.volume + vol);
      Object.assign(t, { price: (t.price * t.volume + px * vol) / v, volume: v, timeUpdate: this.now, commission: money(t.commission + comm) });
      if (o.sl) t.sl = o.sl;
      if (o.tp) t.tp = o.tp;
      return this.addDeal(side, 0, vol, px, 0, comm, o, t.identifier);
    }
    this.positions.push({ ticket: o.order, identifier: o.order, type: side, volume: vol, price: px, sl: o.sl ?? 0, tp: o.tp ?? 0, time: this.now, timeUpdate: this.now,
      magic: o.magic ?? 0, comment: o.comment ?? '', symbol: this.env.symbol, commission: comm, swap: 0, reason: RS.EXPERT });
    return this.addDeal(side, 0, vol, px, 0, comm, o, o.order);
  }
  /** Close `vol` of position p at px. MQL4 partial close: the closed part keeps the ticket, the remainder gets a new one. */
  private closePos(p: Pos, vol: number, px: number, o: Opts): Deal {
    const profit = this.pnl(p.type, vol, p.price, px), comm = o.noComm ? 0 : this.commission(vol);
    const full = vol >= p.volume - EPS, part = full ? p.commission : money(p.commission * vol / p.volume), tag = TAG[o.reason] ?? '';
    if (this.mql4) {
      const nt = full ? 0 : this.nOrd++;
      this.history4.push({ ticket: p.ticket, code: p.type === 'buy' ? 0 : 1, volume: vol, price: p.price, time: p.time, closePrice: px, closeTime: this.now, sl: p.sl, tp: p.tp,
        profit, commission: money(part + comm), swap: p.swap, magic: p.magic, comment: full ? p.comment + tag : `to #${nt}`, expiration: 0, symbol: p.symbol });
      if (nt) { p.comment = `from #${p.ticket}`; p.ticket = nt }
    }
    if (full) this.positions.splice(this.positions.indexOf(p), 1);
    else Object.assign(p, { volume: lots(p.volume - vol), commission: money(p.commission - part), timeUpdate: this.now });
    return this.addDeal(p.type === 'buy' ? 'sell' : 'buy', o.entryCode ?? 1, vol, px, profit, comm, { ...o, magic: o.magic ?? p.magic, comment: o.comment || tag }, p.identifier);
  }
  private closeAuto(p: Pos, px: number, reason: number) {
    const order = this.mql4 ? 0 : this.mkOrder(p.type === 'buy' ? 1 : 0, p.volume, px, { magic: p.magic, comment: TAG[reason] }, p.identifier, reason).ticket;
    this.closePos(p, p.volume, px, { order, reason, magic: p.magic, comment: `${TAG[reason].slice(0, -1)} ${px.toFixed(this.env.digits)}]` });
  }
  private finishOrder(o: Ord, state: number) {
    this.orders.splice(this.orders.indexOf(o), 1);
    o.state = state; o.timeDone = this.now;
    if (!this.mql4) { this.historyOrders.push(o); return }
    this.history4.push({ ticket: o.ticket, code: o.code, volume: o.volume, price: o.price, time: o.time, closePrice: sideOf(o.code) === 'buy' ? this.bid : this.ask, closeTime: this.now,
      sl: o.sl, tp: o.tp, profit: 0, commission: 0, swap: 0, magic: o.magic, comment: state === ST.EXPIRED ? o.comment + '[expiration]' : o.comment, expiration: o.expiration, symbol: o.symbol });
  }
  private activate(o: Ord, px: number) {
    const side = sideOf(o.code), t = this.hedging ? undefined : this.netPos(o.symbol);
    if (this.noMoney(side, o.volume, px, t)) return this.finishOrder(o, ST.REJECTED);
    const vol = o.volume;
    this.orders.splice(this.orders.indexOf(o), 1);
    Object.assign(o, { state: ST.FILLED, timeDone: this.now, volume: 0, positionId: t?.identifier ?? o.ticket });
    if (!this.mql4) this.historyOrders.push(o);
    this.execute(side, vol, px, { sl: o.sl, tp: o.tp, magic: o.magic, comment: o.comment, order: o.ticket, reason: o.reason, target: t });
  }

  // ---------- tick processing ----------
  onTick(bid: number, ask: number, time: number) {
    const prev = this.tick;
    this.tick = { bid, ask, time };
    // Ticks inside one bar form a continuous path (fill at the level); a new bar / first tick is a gap (fill at market).
    const tf = this.env.tfSec ?? 0, cont = !!prev && (!tf || Math.floor(prev.time / tf) === Math.floor(time / tf));
    const at = (lvl: number, from: number, to: number) => (cont && (lvl - from) * (lvl - to) <= 0 ? lvl : to);
    for (const o of [...this.orders]) if (o.expiration && time >= o.expiration) this.finishOrder(o, ST.EXPIRED);
    for (const o of [...this.orders]) {
      const buy = o.code % 2 === 0, cur = buy ? ask : bid, from = prev ? (buy ? prev.ask : prev.bid) : cur;
      if (o.code >= 6) { // stop-limit: stop hit → becomes a limit order at the StopLimit price
        if (!(buy ? cur >= o.price : cur <= o.price)) continue;
        Object.assign(o, { code: o.code - 4, price: o.stopLimit });
        o.type = ORDER_NAMES[o.code];
      }
      const limit = o.code <= 3;
      if (limit ? (buy ? cur <= o.price : cur >= o.price) : (buy ? cur >= o.price : cur <= o.price)) this.activate(o, at(o.price, from, cur));
    }
    for (const p of [...this.positions]) {
      const buy = p.type === 'buy', cur = buy ? bid : ask, from = prev ? (buy ? prev.bid : prev.ask) : cur;
      if (p.sl > 0 && (buy ? cur <= p.sl : cur >= p.sl)) this.closeAuto(p, at(p.sl, from, cur), RS.SL);
      else if (p.tp > 0 && (buy ? cur >= p.tp : cur <= p.tp)) this.closeAuto(p, at(p.tp, from, cur), RS.TP);
    }
    this.stopOut();
  }
  /** Close the worst position while margin level ≤ stop-out level. */
  private stopOut() {
    while (this.positions.length) {
      const m = this.margin();
      if (!(m > 0) || this.equity() / m * 100 > this.stopOutLevel) return;
      const worst = this.positions.reduce((a, p) => (this.posProfit(p) < this.posProfit(a) ? p : a));
      this.closeAuto(worst, this.closePrice(worst), RS.SO);
    }
  }
}
