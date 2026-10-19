// Paper-trading engine: no DOM, no network. Fills orders against prices it is fed.
export type Side = 'buy' | 'sell';
export type OrderType = 'market' | 'limit' | 'stop';
export interface Order {
  id: number; sym: string; side: Side; type: OrderType; qty: number;
  price?: number;              // limit or stop trigger price
  tp?: number; sl?: number;    // bracket: placed as OCO exits once this order fills
  oco?: number;                // orders sharing an oco id cancel each other
  reduceOnly?: boolean;
}
export interface Position { qty: number; avg: number }   // qty < 0 = short
export interface Fill { id: number; sym: string; side: Side; qty: number; px: number; fee: number; realized: number; ts: number; orderType: OrderType }
export interface Account { cash: number; pos: Record<string, Position>; orders: Order[]; fills: Fill[]; nextId: number }

export const FEE = 0.001;
export const newAccount = (cash = 10000): Account => ({ cash, pos: {}, orders: [], fills: [], nextId: 1 });
const round = (x: number) => +x.toFixed(10);

/** Submit an order. Market orders fill immediately at `px`; others rest until `onPrice` triggers them. */
export function placeOrder(a: Account, o: Omit<Order, 'id'>, px: number, ts: number): string | null {
  if (!(o.qty > 0)) return 'Quantity must be positive';
  if (o.type !== 'market' && !(o.price! > 0)) return 'Price required';
  const dir = o.side === 'buy' ? 1 : -1;
  if (o.type === 'limit' && dir * (o.price! - px) > 0) return `Limit ${o.side} must be ${o.side === 'buy' ? 'below' : 'above'} market (use stop)`;
  if (o.type === 'stop' && dir * (o.price! - px) < 0) return `Stop ${o.side} must be ${o.side === 'buy' ? 'above' : 'below'} market (use limit)`;
  const ref = o.type === 'market' ? px : o.price!;
  if (o.tp != null && dir * (o.tp - ref) <= 0) return 'Take-profit is on the wrong side';
  if (o.sl != null && dir * (o.sl - ref) >= 0) return 'Stop-loss is on the wrong side';
  const order: Order = { ...o, id: a.nextId++ };
  if (o.type === 'market') fill(a, order, px, ts);
  else a.orders.push(order);
  return null;
}

export function cancelOrder(a: Account, id: number) { a.orders = a.orders.filter(o => o.id !== id) }

/** Feed a price for a symbol; triggers resting orders. Returns fills that happened. */
export function onPrice(a: Account, sym: string, px: number, ts: number): Fill[] {
  const out: Fill[] = [];
  for (const o of [...a.orders]) {
    if (o.sym !== sym || !a.orders.includes(o)) continue;
    const dir = o.side === 'buy' ? 1 : -1;
    const hit = o.type === 'limit' ? dir * (px - o.price!) <= 0 : dir * (px - o.price!) >= 0;
    if (!hit) continue;
    a.orders = a.orders.filter(x => x !== o && (o.oco == null || x.oco !== o.oco));
    // Limit fills at its price or better; stop fills at market (slippage on gaps).
    const f = fill(a, o, o.type === 'limit' ? (dir > 0 ? Math.min(px, o.price!) : Math.max(px, o.price!)) : px, ts);
    if (f) out.push(f);
  }
  return out;
}

function fill(a: Account, o: Order, px: number, ts: number): Fill | null {
  const p = a.pos[o.sym] ?? { qty: 0, avg: 0 };
  let qty = o.qty;
  if (o.reduceOnly) {
    if (p.qty === 0 || Math.sign(p.qty) === (o.side === 'buy' ? 1 : -1)) return null;
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
    if (o.tp != null) a.orders.push({ id: a.nextId++, sym: o.sym, side: exit, type: 'limit', qty, price: o.tp, oco, reduceOnly: true });
    if (o.sl != null) a.orders.push({ id: a.nextId++, sym: o.sym, side: exit, type: 'stop', qty, price: o.sl, oco, reduceOnly: true });
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
