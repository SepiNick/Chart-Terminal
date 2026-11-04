// The synced paper account behind the Broker interface (docs/phase6-contracts.md). main.ts owns the account,
// saving and prices; this only translates between the broker model and the engine in trading.ts.
import { DEFAULT_GUARD, type Broker, type BrokerAccount, type BrokerOrder, type BrokerState, type OrderPatch, type OrderReq } from './types.ts';
import { cancelOrder, closePosition, equity, modifyOrder, placeOco, placeOrder, type Account, type Order } from '../trading.ts';

export interface PaperDeps {
  acct: () => Account;
  save: () => void;                          // persist (and sync) after a change
  px: (sym: string) => number | undefined;   // last price
  now?: () => number;                        // fill time in seconds (default: wall clock)
}

/** Broker order request → engine order. */
export function toOrder(r: Omit<OrderReq, 'ocoWith'>): Omit<Order, 'id'> {
  const o: Omit<Order, 'id'> = { sym: r.sym, side: r.side, type: r.kind, qty: r.qty };
  if (r.kind === 'limit' || r.kind === 'stop_limit') o.price = r.price;
  if (r.kind === 'stop') o.price = r.stopPrice ?? r.price;
  if (r.kind === 'stop_limit') o.stopPx = r.stopPrice;
  if (r.kind === 'trailing_stop') o.trail = r.trail;
  if (r.reduceOnly) o.reduceOnly = true;
  if (r.tp != null) o.tp = r.tp;
  if (r.sl != null) o.sl = r.sl;
  return o;
}
/** Engine order (the older call sites build these) → broker order request. */
export function fromOrder(o: Omit<Order, 'id'>): OrderReq {
  const r: OrderReq = { sym: o.sym, side: o.side, kind: o.type, qty: o.qty, reduceOnly: o.reduceOnly, tp: o.tp, sl: o.sl };
  if (o.type === 'limit' || o.type === 'stop_limit') r.price = o.price;
  if (o.type === 'stop') r.stopPrice = o.price;
  if (o.type === 'stop_limit') r.stopPrice = o.stopPx;
  if (o.type === 'trailing_stop') r.trail = o.trail;
  return r;
}
function toBrokerOrder(o: Order): BrokerOrder {
  const t = (o.ts ?? 0) * 1000, limit = o.type === 'limit' || o.type === 'stop_limit';
  return {
    id: String(o.id), sym: o.sym, side: o.side, kind: o.type, qty: o.qty, filled: 0,
    price: limit ? o.price : undefined,
    stopPrice: o.type === 'stop' || o.type === 'trailing_stop' ? o.price : o.type === 'stop_limit' && !o.triggered ? o.stopPx : undefined,
    trail: o.trail, reduceOnly: o.reduceOnly, tp: o.tp, sl: o.sl, ocoGroup: o.oco != null ? String(o.oco) : undefined,
    status: 'open', created: t, updated: t,
  };
}

export class PaperBroker implements Broker {
  readonly account: BrokerAccount = {
    id: 'paper', broker: 'paper', label: 'Paper', market: 'futures', testnet: true, status: 'active',
    guard: { ...DEFAULT_GUARD, requireStop: false, confirmedNoWithdraw: true },   // informational: paper has no server guard
  };
  private d: PaperDeps;
  private subs = new Set<(s: BrokerState) => void>();
  constructor(d: PaperDeps) { this.d = d }

  state(): BrokerState {
    const a = this.d.acct(), marks: Record<string, number | undefined> = {};
    for (const s of Object.keys(a.pos)) marks[s] = this.d.px(s);
    return {
      account: 'paper',
      balances: [{ asset: 'USDT', free: a.cash, locked: 0 }],
      positions: Object.entries(a.pos).map(([sym, p]) => ({ sym, qty: p.qty, entry: p.avg, mark: marks[sym], upnl: marks[sym] ? (marks[sym]! - p.avg) * p.qty : undefined })),
      orders: a.orders.map(toBrokerOrder),
      // ponytail: the newest 500 fills; the journal keeps the full history
      fills: a.fills.slice(0, 500).map((f, i) => ({ id: `${f.id}.${a.fills.length - i}`, orderId: String(f.id), sym: f.sym, side: f.side, qty: f.qty, price: f.px, fee: f.fee, realized: f.realized, ts: f.ts * 1000 })),
      equity: equity(a, marks).equity,
      updated: Date.now(),
    };
  }
  async refresh() { return this.state() }
  /** Tell subscribers the account changed (also called by main.ts after fills, syncs and resets). */
  emit() { const s = this.state(); this.subs.forEach(f => f(s)) }
  onChange(fn: (s: BrokerState) => void) { this.subs.add(fn); return () => { this.subs.delete(fn) } }

  private run(sym: string, op: (a: Account, px: number, ts: number) => string | null | void) {
    const px = this.d.px(sym);
    if (!px) throw new Error(`No price for ${sym} yet`);
    const err = op(this.d.acct(), px, this.d.now?.() ?? Date.now() / 1000);
    if (err) throw new Error(err);
    this.d.save(); this.emit();
  }
  async place(r: OrderReq): Promise<BrokerOrder> {
    const a = this.d.acct(), id = a.nextId;
    this.run(r.sym, (a, px, ts) => r.ocoWith ? placeOco(a, [toOrder(r), toOrder({ ...r.ocoWith, sym: r.sym })], px, ts) : placeOrder(a, toOrder(r), px, ts));
    const now = this.d.acct(), rest = now.orders.find(o => o.id === id);
    if (rest) return toBrokerOrder(rest);
    const f = now.fills.find(x => x.id === id);
    const t = (f?.ts ?? 0) * 1000;
    return { id: String(id), sym: r.sym, side: r.side, kind: r.kind, qty: r.qty, filled: f?.qty ?? 0, avgPrice: f?.px, reduceOnly: r.reduceOnly, tp: r.tp, sl: r.sl, status: 'filled', created: t, updated: t };
  }
  async cancel(orderId: string) {
    const a = this.d.acct();
    if (!a.orders.some(o => String(o.id) === orderId)) throw new Error('Order not found');
    cancelOrder(a, +orderId); this.d.save(); this.emit();
  }
  async modify(orderId: string, patch: OrderPatch): Promise<BrokerOrder> {
    const o = this.d.acct().orders.find(x => String(x.id) === orderId);
    if (!o) throw new Error('Order not found');
    this.run(o.sym, (a, px) => modifyOrder(a, +orderId, patch, px));
    return toBrokerOrder(this.d.acct().orders.find(x => String(x.id) === orderId)!);
  }
  async closePosition(sym: string) {
    if (!this.d.acct().pos[sym]) throw new Error(`No ${sym} position`);
    this.run(sym, (a, px, ts) => closePosition(a, sym, px, ts));
  }
}
