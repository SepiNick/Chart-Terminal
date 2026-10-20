// Managed-approach Strategy with a historical fill emulator (Calculate.OnBarClose semantics):
// - orders submitted while processing bar i work from bar i+1: market orders fill at its open; limit/stop orders and
//   stop-loss/profit-target/trail brackets fill when the assumed path O→H→L→C (open nearer the high) or O→L→H→C touches them;
// - limit orders need price to trade through the limit unless IsFillLimitOnTouch; gaps fill at the open (better/worse);
// - working orders not submitted with isLiveUntilCancelled expire at the end of the bar after the one they were (re)submitted on;
// - an entry opposite to the position first closes it ("Close position") then opens the new one (reversal);
// - EntriesPerDirection is enforced per direction (AllEntries) or per signal name (UniqueEntries);
// - commission = commissionPerContract per contract per side; profits in currency (price move × qty × point value).
// Unmanaged approach (IsUnmanaged): SubmitOrderUnmanaged orders stay working until filled/cancelled, net the position
// FIFO (an opposite fill closes open entries first, the rest opens a new one), and cancel their OCO siblings on fill.
// With a trading-hours template, IsExitOnSessionCloseStrategy flattens at the close of each session's last bar.
// Tick-by-tick runs pass each tick's price segment to step() instead of the whole bar.
import type { Trade } from '../../pine/strategy.ts';
import type { NtResult } from '../contract.ts';
import { NinjaScriptBase } from './base.ts';
import { NtDateTime, NtList } from './helpers.ts';
import type { BarsCtx } from './series.ts';

interface Ent { name: string; long: boolean; qty: number; price: number; bar: number; comm: number; hi: number; lo: number; sl?: number; tp?: number; trail?: { off: number; best: number } }
interface Ord { id: number; name: string; entry: boolean; long: boolean; qty: number; type: string; limit?: number; stop?: number; from: string; live: boolean; last: number; trig?: boolean; o: any; u?: boolean; oco?: string }
interface Br { mode: string; value: number }
const DEF_NAME = (entry: boolean, long: boolean) => (entry ? (long ? 'Buy' : 'Sell short') : long ? 'Sell' : 'Buy to cover');

export class NtBroker {
  s: any; ctx: BarsCtx; comm: number; cap: number;
  ents: Ent[] = []; ords: Ord[] = []; trades: Trade[] = []; execs: NonNullable<NtResult['executions']> = []; equity: number[] = [];
  sl = new Map<string, Br>(); tp = new Map<string, Br>(); tr = new Map<string, Br>();
  entryBars: { name: string; bar: number }[] = []; exitBars: { name: string; bar: number }[] = []; seq = 0; realized = 0;
  constructor(s: any, ctx: BarsCtx, comm: number, cap: number) { this.s = s; this.ctx = ctx; this.comm = comm; this.cap = cap }
  private get cur() { return this.ctx.cur }
  private t(bar: number) { return this.ctx.bars[bar].time }

  // ---------- submission ----------
  private sameKey(o: Ord, x: Partial<Ord>) { return o.entry === x.entry && o.long === x.long && o.name === x.name && o.type === x.type && o.from === x.from }
  canEnter(long: boolean, name: string, pending: Partial<Ord> | null) {
    const m = (n: string) => this.s.EntryHandling !== 'UniqueEntries' || n === name;
    const open = this.ents.filter(e => e.long === long && m(e.name)).length;
    const pend = pending ? this.ords.filter(o => o.entry && o.long === long && m(o.name) && !this.sameKey(o, pending)).length : 0;
    return open + pend < this.s.EntriesPerDirection;
  }
  order(entry: boolean, long: boolean, type: string, a: any[]) {
    const prices = type === 'Market' ? 0 : type === 'StopLimit' ? 2 : 1;
    let i = 0, live = false;
    if (typeof a[1] === 'boolean') { live = a[1]; i = 2 }
    const nums: number[] = [];
    while (i < a.length && typeof a[i] === 'number') nums.push(a[i++]);
    const strs = a.slice(i).filter(x => typeof x === 'string');
    const qty = nums.length > prices ? nums[nums.length - prices - 1] : undefined, px = nums.slice(nums.length - prices);
    let name = '', from = '';
    if (entry) name = strs[0] ?? '';
    else if (strs.length === 1) from = strs[0];
    else if (strs.length >= 2) { name = strs[0]; from = strs[1] }
    return this.submit({
      entry, long, type, live, name: name || DEF_NAME(entry, long), from, qty: qty ?? (entry ? this.s.DefaultQuantity : 0),
      limit: type === 'Limit' || type === 'StopLimit' ? px[0] : undefined, stop: type === 'StopMarket' ? px[0] : type === 'StopLimit' ? px[1] : undefined,
    });
  }
  private submit(x: Omit<Ord, 'id' | 'last' | 'o'>) {
    const s = this.s;
    if (this.cur < s.BarsRequiredToTrade) return null;
    if (x.entry ? !this.canEnter(x.long, x.name, x) : !this.ents.some(e => e.long === x.long && (!x.from || e.name === x.from))) return null;
    const old = this.ords.find(o => this.sameKey(o, x));
    if (old) { Object.assign(old, { qty: x.qty, limit: x.limit, stop: x.stop, live: x.live, last: this.cur }); Object.assign(old.o, { Quantity: x.qty, LimitPrice: x.limit ?? 0, StopPrice: x.stop ?? 0 }); return old.o }
    const id = ++this.seq;
    const o: Ord = {
      ...x, id, last: this.cur,
      o: {
        Name: x.name, OrderId: String(id), FromEntrySignal: x.from, OrderType: x.type, OrderState: 'Working', Quantity: x.qty, Filled: 0, AverageFillPrice: 0,
        LimitPrice: x.limit ?? 0, StopPrice: x.stop ?? 0, IsLiveUntilCancelled: x.live, Time: s.__ctx.Time.get(0),
        OrderAction: x.entry ? (x.long ? 'Buy' : 'SellShort') : x.long ? 'Sell' : 'BuyToCover', IsLong: x.entry === x.long, IsShort: x.entry !== x.long,
      },
    };
    this.ords.push(o);
    this.notifyOrder(o.o);
    return o.o;
  }
  cancel(order: any) { const o = this.ords.find(q => q.o === order); if (o) this.drop(o, 'Cancelled') }
  /** SubmitOrderUnmanaged(barsInProgress, orderAction, orderType, quantity[, limitPrice, stopPrice, oco, signalName]) */
  submitU(a: any[]) {
    const s = this.s, [, action, type, qty = 1, limit = 0, stop = 0, oco = '', name = ''] = a;
    if (!s.IsUnmanaged) { s.__eng.warn('SubmitOrderUnmanaged() needs IsUnmanaged = true; ignored'); return null }
    if (this.cur < s.BarsRequiredToTrade) return null;
    const buy = action === 'Buy' || action === 'BuyToCover', t = type === 'MIT' ? 'Limit' : String(type);
    if (type === 'MIT') s.__eng.warn('MIT orders are simulated as limit orders');
    const id = ++this.seq;
    const o: Ord = {
      id, name: name || String(action), entry: true, long: buy, qty, type: t, from: '', live: true, last: this.cur, u: true, oco: oco || undefined,
      limit: t === 'Limit' || t === 'StopLimit' ? limit : undefined, stop: t === 'StopMarket' || t === 'StopLimit' ? stop : undefined,
      o: {
        Name: name || String(action), OrderId: String(id), FromEntrySignal: '', OrderType: type, OrderState: 'Working', Quantity: qty, Filled: 0, AverageFillPrice: 0,
        LimitPrice: limit, StopPrice: stop, IsLiveUntilCancelled: true, Time: s.__ctx.Time.get(0), OrderAction: action, IsLong: buy, IsShort: !buy, Oco: oco,
      },
    };
    this.ords.push(o);
    this.notifyOrder(o.o);
    return o.o;
  }
  /** ChangeOrder(order, quantity, limitPrice, stopPrice) */
  change(order: any, qty: number, limit: number, stop: number) {
    const o = this.ords.find(q => q.o === order); if (!o) return;
    o.qty = qty; if (o.limit != null) o.limit = limit; if (o.stop != null) o.stop = stop;
    Object.assign(o.o, { Quantity: qty, LimitPrice: o.limit ?? 0, StopPrice: o.stop ?? 0, OrderState: 'Working' });
    this.notifyOrder(o.o);
  }
  private ufill(o: Ord, px: number, bar: number) {
    let left = o.qty;
    for (const e of this.ents.filter(e => e.long !== o.long)) { if (left <= 0) break; const q = Math.min(left, e.qty); left -= q; this.close(e, q, px, bar, o.name, o.o, true) }
    if (left > 1e-12) { this.ents.push({ name: o.name, long: o.long, qty: left, price: px, bar, comm: left * this.comm, hi: px, lo: px }); this.entryBars.push({ name: o.name, bar }) }
    this.ords.splice(this.ords.indexOf(o), 1);
    this.exec(o.o, px, o.qty, o.long, bar);
    if (o.oco) for (const x of [...this.ords]) if (x.oco === o.oco) this.drop(x, 'Cancelled');
  }
  private drop(o: Ord, state: string) { this.ords.splice(this.ords.indexOf(o), 1); o.o.OrderState = state; this.notifyOrder(o.o) }

  // ---------- brackets ----------
  setBracket(kind: 'sl' | 'tp' | 'tr', from: string, mode: string, value: number) {
    this[kind].set(from, { mode, value });
    for (const e of this.ents) if (!from || e.name === from) this.applyBr(e);
  }
  private lvl(e: Ent, b: Br, sgn: number) {
    const d = (e.long ? 1 : -1) * sgn;
    return b.mode === 'Price' ? b.value : b.mode === 'Percent' ? e.price * (1 + d * b.value) : b.mode === 'Currency' ? e.price + (d * b.value) / (e.qty * this.ctx.pv) : e.price + d * b.value * this.ctx.tick;
  }
  private applyBr(e: Ent) {
    const g = (m: Map<string, Br>) => m.get(e.name) ?? m.get('');
    const sl = g(this.sl), tp = g(this.tp), tr = g(this.tr);
    e.sl = sl ? this.lvl(e, sl, -1) : undefined;
    e.tp = tp ? this.lvl(e, tp, 1) : undefined;
    // trail offset in price units (Price mode is taken as a distance)
    e.trail = tr && !sl ? { off: tr.mode === 'Price' ? Math.abs(tr.value) : Math.abs(this.lvl(e, tr, 1) - e.price), best: e.trail?.best ?? e.price } : undefined;
  }

  // ---------- fills ----------
  private slip(px: number, buy: boolean) { return px + (buy ? 1 : -1) * (this.s.Slippage || 0) * this.ctx.tick }
  private through(buy: boolean, lim: number, lo: number, hi: number) { return this.s.IsFillLimitOnTouch ? (buy ? lo <= lim : hi >= lim) : buy ? lo < lim : hi > lim }
  private trigger(o: Ord, a: number, lo: number, hi: number): number | null {
    const buy = o.entry === o.long;
    if (o.type === 'Limit') return this.through(buy, o.limit!, lo, hi) ? (buy ? Math.min(a, o.limit!) : Math.max(a, o.limit!)) : null;
    const hit = buy ? hi >= o.stop! : lo <= o.stop!, spx = buy ? Math.max(a, o.stop!) : Math.min(a, o.stop!);
    if (o.type === 'StopMarket') return hit ? this.slip(spx, buy) : null;
    if (!o.trig) { if (!hit) return null; o.trig = true; return (buy ? spx <= o.limit! : spx >= o.limit!) ? spx : null }
    return this.through(buy, o.limit!, lo, hi) ? (buy ? Math.min(a, o.limit!) : Math.max(a, o.limit!)) : null;
  }
  private fill(o: Ord, px: number, bar: number) {
    if (o.u) return this.ufill(o, px, bar);
    if (o.entry) {
      for (const e of this.ents.filter(e => e.long !== o.long)) this.close(e, e.qty, px, bar, 'Close position', o.o);
      if (!this.canEnter(o.long, o.name, null)) return this.drop(o, 'Cancelled');
      const e: Ent = { name: o.name, long: o.long, qty: o.qty, price: px, bar, comm: o.qty * this.comm, hi: px, lo: px };
      this.ents.push(e); this.applyBr(e);
      this.entryBars.push({ name: o.name, bar });
      this.exec(o.o, px, o.qty, o.long, bar);
    } else {
      let left = o.qty || Infinity;
      for (const e of this.ents.filter(e => e.long === o.long && (!o.from || e.name === o.from))) {
        if (left <= 0) break;
        const q = Math.min(left, e.qty); left -= q;
        this.close(e, q, px, bar, o.name, o.o);
      }
    }
    this.ords.splice(this.ords.indexOf(o), 1);
  }
  private close(e: Ent, qty: number, px: number, bar: number, name: string, order?: any, silent = false) {
    const q = Math.min(qty, e.qty), d = e.long ? 1 : -1, pv = this.ctx.pv, c = q * this.comm, ec = (e.comm * q) / e.qty;
    const gross = (px - e.price) * q * d * pv;
    this.trades.push({
      entryId: e.name, exitId: name, dir: e.long ? 'long' : 'short', qty: q, entryBar: e.bar, entryTime: this.t(e.bar), entryPrice: e.price,
      exitBar: bar, exitTime: this.t(bar), exitPrice: px, profit: gross - c - ec, profitPct: (((px - e.price) * d) / e.price) * 100, commission: c + ec,
      runup: (e.long ? e.hi - e.price : e.price - e.lo) * q * pv, drawdown: (e.long ? e.price - e.lo : e.hi - e.price) * q * pv, comment: '',
    });
    this.realized += gross - c - ec;
    e.comm -= ec; e.qty -= q;
    if (e.qty <= 1e-12) this.ents.splice(this.ents.indexOf(e), 1);
    this.exitBars.push({ name, bar });
    if (!silent) this.exec(order ?? { Name: name, OrderType: 'StopMarket', OrderAction: e.long ? 'Sell' : 'BuyToCover', FromEntrySignal: e.name, Quantity: q }, px, q, !e.long, bar);
  }
  private exec(order: any, px: number, qty: number, buy: boolean, bar: number) {
    this.execs.push({ time: this.t(bar), price: px, qty, side: buy ? 'buy' : 'sell', name: order.Name });
    const time = NtDateTime.of((this.t(bar) + this.ctx.tfSec) * 1000), s = this.s, pos = s.Position;
    Object.assign(order, { OrderState: 'Filled', Filled: qty, AverageFillPrice: px });
    this.notifyOrder(order);
    if (typeof s.OnExecutionUpdate === 'function') {
      const ex = { Order: order, Price: px, Quantity: qty, Time: time, Name: order.Name, MarketPosition: buy ? 'Long' : 'Short', ExecutionId: String(this.execs.length), Instrument: s.Instrument };
      s.OnExecutionUpdate(ex, ex.ExecutionId, px, qty, ex.MarketPosition, order.OrderId ?? '', time);
    }
    if (typeof s.OnPositionUpdate === 'function') s.OnPositionUpdate(pos, pos.AveragePrice, pos.Quantity, pos.MarketPosition);
  }
  private notifyOrder(o: any) {
    const s = this.s;
    if (typeof s.OnOrderUpdate === 'function') s.OnOrderUpdate(o, o.LimitPrice ?? 0, o.StopPrice ?? 0, o.Quantity, o.Filled ?? 0, o.AverageFillPrice ?? 0, o.OrderState, s.__ctx.Time.get(0), 'NoError', '');
  }
  private brackets(e: Ent, a: number, lo: number, hi: number, bar: number) {
    let stop = e.sl, sname = 'Stop loss';
    if (e.trail) { const ts = e.trail.best - (e.long ? 1 : -1) * e.trail.off; if (stop == null || (e.long ? ts > stop : ts < stop)) { stop = ts; sname = 'Trail stop' } }
    const sHit = stop != null && (e.long ? lo <= stop : hi >= stop), tHit = e.tp != null && this.through(!e.long, e.tp, lo, hi);
    if (sHit || tHit) {
      const useStop = sHit && (!tHit || Math.abs(a - stop!) <= Math.abs(a - e.tp!));
      const px = useStop ? this.slip(e.long ? Math.min(a, stop!) : Math.max(a, stop!), !e.long) : e.long ? Math.max(a, e.tp!) : Math.min(a, e.tp!);
      this.close(e, e.qty, px, bar, useStop ? sname : 'Profit target');
      return;
    }
    if (e.trail) e.trail.best = e.long ? Math.max(e.trail.best, hi) : Math.min(e.trail.best, lo);
  }
  /** Fill working orders against bar `bar` (before OnBarUpdate of that bar): market orders at `mkt`, the rest along `path`. */
  step(bar: number, path?: number[], mkt?: number) {
    const b = this.ctx.bars[bar];
    for (const o of this.ords.filter(o => o.type === 'Market')) if (this.ords.includes(o)) this.fill(o, this.slip(mkt ?? b.open, o.entry === o.long), bar);
    path ??= Math.abs(b.open - b.high) < Math.abs(b.open - b.low) ? [b.open, b.high, b.low, b.close] : [b.open, b.low, b.high, b.close];
    for (let k = 0; k < path.length - 1; k++) {
      const a = path[k], z = path[k + 1], lo = Math.min(a, z), hi = Math.max(a, z);
      for (const e of [...this.ents]) if (this.ents.includes(e)) this.brackets(e, a, lo, hi, bar);
      for (const o of [...this.ords]) {
        if (!this.ords.includes(o)) continue;
        const px = this.trigger(o, a, lo, hi);
        if (px == null) continue;
        if (!o.entry && !this.ents.some(e => e.long === o.long && (!o.from || e.name === o.from))) { this.drop(o, 'Cancelled'); continue }
        this.fill(o, px, bar);
      }
      for (const e of this.ents) { e.hi = Math.max(e.hi, hi); e.lo = Math.min(e.lo, lo) }
    }
  }
  /** After OnBarUpdate of `bar`: expire unrenewed working orders and record equity. */
  endBar(bar: number) {
    for (const o of [...this.ords]) if (!o.live && o.type !== 'Market' && o.last < bar) this.drop(o, 'Cancelled');
    const c = this.ctx;
    if (this.s.IsExitOnSessionCloseStrategy && c.session && bar < c.bars.length - 1 && c.isLastOfSession(bar))
      for (const e of [...this.ents]) this.close(e, e.qty, c.bars[bar].close, bar, 'Exit on session close');
    this.equity[bar] = this.cap + this.realized - this.ents.reduce((a, e) => a + e.comm, 0) + this.openPL(this.ctx.bars[bar].close);
  }
  openPL(px: number) { return this.ents.reduce((a, e) => a + (px - e.price) * e.qty * (e.long ? 1 : -1) * this.ctx.pv, 0) }
}

class TradeCollection extends NtList<any> {
  get TradesCount() { return this.length }
  get WinningTrades() { return new TradeCollection(this.filter(t => t.ProfitCurrency > 0)) }
  get LosingTrades() { return new TradeCollection(this.filter(t => t.ProfitCurrency < 0)) }
  get EvenTrades() { return new TradeCollection(this.filter(t => t.ProfitCurrency === 0)) }
  GetTrades(_instrument?: string, entryName?: string) { return entryName ? new TradeCollection(this.filter(t => t.Entry.Name === entryName)) : this }
  get TradesPerformance() {
    const p = this.map(t => t.ProfitCurrency), gp = p.filter(x => x > 0).reduce((a, b) => a + b, 0), gl = p.filter(x => x < 0).reduce((a, b) => a + b, 0);
    let peak = 0, cum = 0, dd = 0;
    for (const x of p) { cum += x; peak = Math.max(peak, cum); dd = Math.min(dd, cum - peak) }
    const streak = (f: (x: number) => boolean) => { let m = 0, c = 0; for (const x of p) { c = f(x) ? c + 1 : 0; m = Math.max(m, c) } return m };
    const net = gp + gl, n = p.length;
    return {
      NetProfit: net, GrossProfit: gp, GrossLoss: gl, ProfitFactor: gl ? gp / -gl : gp ? Infinity : 1, TradesCount: n,
      TotalCommission: this.reduce((a, t) => a + t.Commission, 0), MaxConsecutiveWinner: streak(x => x > 0), MaxConsecutiveLoser: streak(x => x < 0),
      AverageBarsInTrade: n ? this.reduce((a, t) => a + t.BarsInTrade, 0) / n : 0, PercentProfitable: n ? p.filter(x => x > 0).length / n : 0,
      Currency: { CumProfit: net, AverageProfit: n ? net / n : 0, Drawdown: dd, LargestWinner: Math.max(0, ...p), LargestLoser: Math.min(0, ...p) },
      Points: { CumProfit: this.reduce((a, t) => a + t.ProfitPoints, 0) },
      Percent: { CumProfit: this.reduce((a, t) => a + t.ProfitPercent, 0) },
    };
  }
}

export class Strategy extends NinjaScriptBase {
  constructor() {
    super();
    Object.assign(this, {
      IsOverlay: true, EntriesPerDirection: 1, EntryHandling: 'AllEntries', DefaultQuantity: 1, BarsRequiredToTrade: 20, Slippage: 0,
      IsFillLimitOnTouch: false, IsExitOnSessionCloseStrategy: true, ExitOnSessionCloseSeconds: 30, IsUnmanaged: false, IncludeCommission: false,
      TraceOrders: false, StartBehavior: 'WaitUntilFlat', TimeInForce: 'Gtc', OrderFillResolution: 'Standard', StopTargetHandling: 'PerEntryExecution',
      RealtimeErrorHandling: 'StopCancelClose', IsInstantiatedOnEachOptimizationIteration: true,
    });
    const o = this.__eng.opts;
    this.__br = new NtBroker(this, this.__ctx, o.commissionPerContract ?? 0, o.initialCapital ?? 0);
    const br: NtBroker = this.__br, self = this;
    this.__pos = {
      get MarketPosition() { return br.ents.length ? (br.ents[0].long ? 'Long' : 'Short') : 'Flat' },
      get Quantity() { return br.ents.reduce((a, e) => a + e.qty, 0) },
      get AveragePrice() { const q = this.Quantity; return q ? br.ents.reduce((a, e) => a + e.price * e.qty, 0) / q : 0 },
      get Instrument() { return self.Instrument },
      GetUnrealizedProfitLoss(unit = 'Currency', price?: number) {
        const px = price ?? self.__ctx.bars[Math.max(0, self.__ctx.cur)]?.close ?? 0, pts = br.ents.reduce((a, e) => a + (px - e.price) * (e.long ? 1 : -1), 0) / Math.max(1, br.ents.length);
        return unit === 'Points' ? pts : unit === 'Ticks' ? pts / self.TickSize : unit === 'Percent' ? (this.AveragePrice ? pts / this.AveragePrice : 0) : br.openPL(px);
      },
    };
  }
  get Position() { return this.__pos }
  get Positions() { return [this.__pos] }
  get Account() { return { Name: 'Sim101', Get: () => this.__eng.opts.initialCapital } }
  get SystemPerformance() {
    const br: NtBroker = this.__br, tick = this.TickSize;
    const all = br.trades.map((t, i) => {
      const pts = (t.exitPrice - t.entryPrice) * (t.dir === 'long' ? 1 : -1), side = t.dir === 'long' ? 'Long' : 'Short';
      return {
        TradeNumber: i, Quantity: t.qty, ProfitCurrency: t.profit, ProfitPoints: pts, ProfitTicks: pts / tick, ProfitPercent: t.profitPct / 100, Commission: t.commission,
        MaeCurrency: t.drawdown, MfeCurrency: t.runup, BarsInTrade: t.exitBar - t.entryBar,
        Entry: { Price: t.entryPrice, Quantity: t.qty, Name: t.entryId, MarketPosition: side, Time: NtDateTime.of((t.entryTime + this.__ctx.tfSec) * 1000), BarIndex: t.entryBar },
        Exit: { Price: t.exitPrice, Quantity: t.qty, Name: t.exitId, MarketPosition: side, Time: NtDateTime.of((t.exitTime + this.__ctx.tfSec) * 1000), BarIndex: t.exitBar },
      };
    });
    return {
      AllTrades: new TradeCollection(all), LongTrades: new TradeCollection(all.filter(t => t.Entry.MarketPosition === 'Long')),
      ShortTrades: new TradeCollection(all.filter(t => t.Entry.MarketPosition === 'Short')), RealTimeTrades: new TradeCollection(),
    };
  }
  /** SetStopLoss(mode, value) | (fromEntrySignal, mode, value, isSimulatedStop) */
  SetStopLoss(...a: any[]) { a.length >= 3 ? this.__br.setBracket('sl', a[0], a[1], a[2]) : this.__br.setBracket('sl', '', a[0], a[1]) }
  /** SetTrailStop(mode, value) | (fromEntrySignal, mode, value, isSimulatedStop) */
  SetTrailStop(...a: any[]) { a.length >= 3 ? this.__br.setBracket('tr', a[0], a[1], a[2]) : this.__br.setBracket('tr', '', a[0], a[1]) }
  /** SetProfitTarget(mode, value[, isMIT]) | (fromEntrySignal, mode, value[, isMIT]) */
  SetProfitTarget(...a: any[]) { typeof a[0] === 'string' && typeof a[1] === 'string' ? this.__br.setBracket('tp', a[0], a[1], a[2]) : this.__br.setBracket('tp', '', a[0], a[1]) }
  CancelOrder(o: any) { this.__br.cancel(o) }
  SubmitOrderUnmanaged(...a: any[]) { return this.__br.submitU(a) }
  ChangeOrder(o: any, qty: number, limit: number, stop: number) { this.__br.change(o, qty, limit, stop) }
  private __since(list: { name: string; bar: number }[], a: any[]) {
    const name = a.find(x => typeof x === 'string') ?? '', ago = typeof a[2] === 'number' ? a[2] : 0;
    const hits = list.filter(x => !name || x.name === name);
    const h = hits[hits.length - 1 - ago];
    return h ? this.__ctx.cur - h.bar : -1;
  }
  BarsSinceEntryExecution(...a: any[]) { return this.__since(this.__br.entryBars, a) }
  BarsSinceExitExecution(...a: any[]) { return this.__since(this.__br.exitBars, a) }
}

// Order methods: [name, isEntry, isLong, orderType]. NT7-style *Stop names alias the StopMarket variants.
const ORDERS: [string, boolean, boolean, string][] = [];
for (const [pre, entry] of [['Enter', true], ['Exit', false]] as const)
  for (const [side, long] of [['Long', true], ['Short', false]] as const)
    for (const [suf, type] of [['', 'Market'], ['Limit', 'Limit'], ['StopMarket', 'StopMarket'], ['Stop', 'StopMarket'], ['StopLimit', 'StopLimit']])
      ORDERS.push([pre + side + suf, entry, long, type]);
for (const [name, entry, long, type] of ORDERS) (Strategy.prototype as any)[name] = function (this: Strategy, ...a: any[]) { return this.__br.order(entry, long, type, a) };
