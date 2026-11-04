// Paper-trading engine: no DOM, no network. Fills orders against prices it is fed.
export type Side = 'buy' | 'sell';
export type OrderType = 'market' | 'limit' | 'stop' | 'stop_limit' | 'trailing_stop';
export interface Order {
  id: number; sym: string; side: Side; type: OrderType; qty: number;
  price?: number;              // limit price (limit, stop_limit), trigger (stop) or the current level (trailing_stop)
  stopPx?: number;             // stop_limit trigger; once hit `triggered` is set and it rests as a limit
  triggered?: boolean;
  trail?: { pct?: number; amount?: number };   // trailing_stop: distance from the best price since placement
  tp?: number; sl?: number;    // bracket: placed as OCO exits once this order fills
  oco?: number;                // orders sharing an oco id cancel each other
  reduceOnly?: boolean;
  ts?: number;                 // placed at (seconds); missing on accounts saved before phase 6
}
interface Position { qty: number; avg: number }   // qty < 0 = short
export interface Fill { id: number; sym: string; side: Side; qty: number; px: number; fee: number; realized: number; ts: number; orderType: OrderType }
export interface Account { cash: number; pos: Record<string, Position>; orders: Order[]; fills: Fill[]; nextId: number }
/** Change a resting order: only the given fields; `null` removes a bracket TP/SL. */
export interface OrderPatch { price?: number; stopPrice?: number; qty?: number; tp?: number | null; sl?: number | null }

const FEE = 0.001;
export const newAccount = (cash = 10000): Account => ({ cash, pos: {}, orders: [], fills: [], nextId: 1 });
const round = (x: number) => +x.toFixed(10);
const dirOf = (o: { side: Side }) => (o.side === 'buy' ? 1 : -1);
const trailDist = (o: Pick<Order, 'trail'>, px: number) => (o.trail?.pct ? (px * o.trail.pct) / 100 : o.trail?.amount ?? 0);
/** Where a trailing stop sits for price `px`: below it for a sell, above it for a buy. */
const trailLevel = (o: Order, px: number) => round(px + dirOf(o) * trailDist(o, px));

/** Validation shared by placing and modifying; `px` is the market price. */
function check(o: Order, px: number): string | null {
  if (!(o.qty > 0)) return 'Quantity must be positive';
  if (o.type !== 'market' && !(o.price! > 0)) return o.type === 'trailing_stop' ? 'Trailing distance must be positive and below the price' : 'Price required';
  if (o.type === 'stop_limit' && !o.triggered && !(o.stopPx! > 0)) return 'Stop price required';
  const dir = dirOf(o);
  if (o.type === 'limit' && dir * (o.price! - px) > 0) return `Limit ${o.side} must be ${o.side === 'buy' ? 'below' : 'above'} market (use stop)`;
  const trig = o.type === 'stop' ? o.price! : o.type === 'stop_limit' && !o.triggered ? o.stopPx! : null;
  if (trig != null && dir * (trig - px) < 0) return `Stop ${o.side} must be ${o.side === 'buy' ? 'above' : 'below'} market (use limit)`;
  const ref = o.type === 'market' ? px : o.price!;
  if (o.tp != null && dir * (o.tp - ref) <= 0) return 'Take-profit is on the wrong side';
  if (o.sl != null && dir * (o.sl - ref) >= 0) return 'Stop-loss is on the wrong side';
  return null;
}

/** Submit an order. Market orders fill immediately at `px`; others rest until `onPrice` triggers them. */
export function placeOrder(a: Account, o: Omit<Order, 'id'>, px: number, ts: number): string | null {
  const order: Order = { ...o, id: 0, ts };
  if (o.type === 'trailing_stop') {
    const d = trailDist(o, px);
    order.price = d > 0 && d < px ? trailLevel(order, px) : undefined;
  }
  const err = check(order, px);
  if (err) return err;
  if (o.type === 'market' && o.reduceOnly) {
    const p = a.pos[o.sym];
    if (!p || Math.sign(p.qty) === dirOf(o)) return 'Reduce-only: there is no opposite position to reduce';
  }
  order.id = a.nextId++;
  if (o.type === 'market') fill(a, order, px, ts);
  else a.orders.push(order);
  return null;
}

/** Standalone OCO: resting orders that cancel each other when one fills. All or nothing. */
export function placeOco(a: Account, legs: Omit<Order, 'id' | 'oco'>[], px: number, ts: number): string | null {
  if (legs.length < 2) return 'OCO needs two orders';
  if (legs.some(l => l.type === 'market')) return 'OCO legs must be resting orders (not market)';
  const n = a.orders.length, id0 = a.nextId;
  for (const l of legs) {
    const err = placeOrder(a, { ...l, oco: id0 }, px, ts);
    if (err) { a.orders.length = n; a.nextId = id0; return err }
  }
  return null;
}

export function cancelOrder(a: Account, id: number) { a.orders = a.orders.filter(o => o.id !== id) }

/** Change a resting order; returns an error and leaves it untouched when the result would be invalid. */
export function modifyOrder(a: Account, id: number, patch: OrderPatch, px: number): string | null {
  const i = a.orders.findIndex(o => o.id === id);
  if (i < 0) return 'Order not found';
  const n: Order = { ...a.orders[i] };
  if (patch.qty != null) n.qty = patch.qty;
  if (patch.price != null) n.price = patch.price;
  if (patch.stopPrice != null) {
    if (n.type === 'stop_limit' && !n.triggered) n.stopPx = patch.stopPrice;
    else if (n.type === 'stop' || n.type === 'trailing_stop') n.price = patch.stopPrice;
    else return 'This order has no stop price';
  }
  if (patch.tp !== undefined) { if (patch.tp === null) delete n.tp; else n.tp = patch.tp }
  if (patch.sl !== undefined) { if (patch.sl === null) delete n.sl; else n.sl = patch.sl }
  const err = check(n, px);
  if (err) return err;
  a.orders[i] = n;
  return null;
}

/** Feed a price for a symbol; triggers resting orders and moves trailing stops. Returns fills that happened. */
export function onPrice(a: Account, sym: string, px: number, ts: number): Fill[] {
  const out: Fill[] = [];
  for (const o of [...a.orders]) {
    if (o.sym !== sym || !a.orders.includes(o)) continue;
    const dir = dirOf(o);
    if (o.type === 'trailing_stop') { const lv = trailLevel(o, px); if (dir * (lv - o.price!) < 0) o.price = lv }   // only ever tightens
    if (o.type === 'stop_limit' && !o.triggered) { if (dir * (px - o.stopPx!) < 0) continue; o.triggered = true }
    const limit = o.type === 'limit' || o.type === 'stop_limit';
    const hit = limit ? dir * (px - o.price!) <= 0 : dir * (px - o.price!) >= 0;
    if (!hit) continue;
    a.orders = a.orders.filter(x => x !== o && (o.oco == null || x.oco !== o.oco));
    // Limit fills at its price or better; stops fill at market (slippage on gaps).
    const f = fill(a, o, limit ? (dir > 0 ? Math.min(px, o.price!) : Math.max(px, o.price!)) : px, ts);
    if (f) out.push(f);
  }
  return out;
}

function fill(a: Account, o: Order, px: number, ts: number): Fill | null {
  const p = a.pos[o.sym] ?? { qty: 0, avg: 0 };
  let qty = o.qty;
  if (o.reduceOnly) {
    if (p.qty === 0 || Math.sign(p.qty) === dirOf(o)) return null;
    qty = Math.min(qty, Math.abs(p.qty));
  }
  const q = o.side === 'buy' ? qty : -qty;
  let realized = 0;
  if (p.qty === 0 || Math.sign(p.qty) === Math.sign(q)) {
    p.avg = (p.avg * Math.abs(p.qty) + px * qty) / (Math.abs(p.qty) + qty);
    p.qty = round(p.qty + q);
  } else {
    realized = Math.min(qty, Math.abs(p.qty)) * (px - p.avg) * Math.sign(p.qty);
    const rem = round(p.qty + q);
    if (rem !== 0 && Math.sign(rem) !== Math.sign(p.qty)) p.avg = px; // flipped
    p.qty = rem;
  }
  const fee = px * qty * FEE;
  a.cash = round(a.cash + realized - fee);
  if (p.qty === 0) delete a.pos[o.sym]; else a.pos[o.sym] = p;
  const f: Fill = { id: o.id, sym: o.sym, side: o.side, qty, px, fee, realized, ts, orderType: o.type };
  a.fills.unshift(f);
  // Bracket exits become an OCO pair sized to this fill.
  if (o.tp != null || o.sl != null) {
    const exit: Side = o.side === 'buy' ? 'sell' : 'buy', oco = a.nextId;
    if (o.tp != null) a.orders.push({ id: a.nextId++, sym: o.sym, side: exit, type: 'limit', qty, price: o.tp, oco, reduceOnly: true, ts });
    if (o.sl != null) a.orders.push({ id: a.nextId++, sym: o.sym, side: exit, type: 'stop', qty, price: o.sl, oco, reduceOnly: true, ts });
  }
  // A flat position orphans its reduce-only exits.
  if (!a.pos[o.sym]) a.orders = a.orders.filter(x => !(x.sym === o.sym && x.reduceOnly));
  return f;
}

export function closePosition(a: Account, sym: string, px: number, ts: number) {
  const p = a.pos[sym];
  if (p) placeOrder(a, { sym, side: p.qty > 0 ? 'sell' : 'buy', type: 'market', qty: Math.abs(p.qty), reduceOnly: true }, px, ts);
}

export function equity(a: Account, prices: Record<string, number | undefined>) {
  let u = 0;
  for (const [s, p] of Object.entries(a.pos)) { const px = prices[s]; if (px) u += (px - p.avg) * p.qty }
  return { equity: a.cash + u, unrealized: u };
}
