// Guard enforcement (trade/docs/RISK_RULES.md): pure checks, so they are easy to test and reason about.
import type { BrokerAccount, Guard, GuardianItem, OrderReq } from '../../src/broker/types.ts';

export const utcDay = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);

/** Loss so far today in % of start-of-day equity (0 when there is no snapshot yet). */
export const dayLossPct = (equity: number, dayStart?: number) => (dayStart && dayStart > 0 ? ((dayStart - equity) / dayStart) * 100 : 0);
export const breakerHit = (g: Guard, equity: number, dayStart?: number) => dayLossPct(equity, dayStart) >= g.maxDailyLossPct;

export interface OrderCtx {
  status: BrokerAccount['status'];
  guard: Guard;
  spot: boolean;
  /** Current position in base units (signed for futures; for spot: the base asset held, free part in `spotFree`). */
  pos: number;
  spotFree?: number;
  price: number;            // reference price for the notional (limit / trigger price, else the market)
  equity: number;           // in the order's quote currency
  dayEquity: number;        // in the account's main quote, for the breaker
  dayStart?: number;
  stopQty: number;          // remaining qty of open opposite-side stops for this symbol: they protect that much of the position
  pending?: number;         // other resting orders on this side that would open/add (base units): they count toward the cap
  pendingNoSl?: number;     // …the part of them with no bracket SL of its own: it needs cover from existing stops
  skipStop?: boolean;       // emulated child orders that were checked when placed
}
export type Verdict = { ok: true; reducing: boolean } | { ok: false; reason: string; trip?: boolean };

/** Does this order only reduce / close the current position? */
export function reduces(o: Pick<OrderReq, 'side' | 'qty' | 'reduceOnly'>, c: Pick<OrderCtx, 'spot' | 'pos' | 'spotFree'>): boolean {
  // Spot can't open a short: every sell reduces. (Comparing with the free balance wrongly blocked protective stops whose
  // coins are locked by the stop itself or shrunk by a fee, exactly when the breaker is tripped.)
  if (c.spot) return o.side === 'sell';
  if (o.reduceOnly) return true;
  const d = o.side === 'buy' ? o.qty : -o.qty;
  return c.pos !== 0 && Math.sign(d) !== Math.sign(c.pos) && Math.abs(d) <= Math.abs(c.pos) + 1e-12;
}

export function checkOrder(o: Pick<OrderReq, 'side' | 'qty' | 'reduceOnly' | 'sl'>, c: OrderCtx): Verdict {
  if (c.status === 'disabled') return { ok: false, reason: 'Account is disabled' };
  // Reducing / closing is always allowed (also on a demoted pending account), like on a tripped one.
  if (reduces(o, c)) return { ok: true, reducing: true };
  if (c.status === 'pending') return { ok: false, reason: 'Account is pending: run the guardian check first' };
  if (c.status === 'tripped') return { ok: false, reason: 'Circuit breaker tripped: only orders that reduce or close a position until 00:00 UTC' };
  if (c.status === 'error') return { ok: false, reason: 'Account has a connection error: only orders that reduce or close a position are allowed' };
  if (breakerHit(c.guard, c.dayEquity, c.dayStart))
    return { ok: false, trip: true, reason: `Circuit breaker: today's loss ${dayLossPct(c.dayEquity, c.dayStart).toFixed(2)}% reached the ${c.guard.maxDailyLossPct}% limit — only reducing orders until 00:00 UTC` };
  if (!(c.equity > 0)) return { ok: false, reason: 'No equity in this quote currency' };
  const after = Math.abs(c.pos + (o.side === 'buy' ? 1 : -1) * ((c.pending ?? 0) + o.qty)) * c.price, cap = (c.equity * c.guard.maxPositionPct) / 100;
  if (after > cap * (1 + 1e-9)) return { ok: false, reason: `Position cap: ${fmt(after)} notional would exceed ${c.guard.maxPositionPct}% of equity (${fmt(cap)})` };
  // Existing stops count only for the quantity they close: a tiny stop doesn't protect a big position.
  // Resting same-side entries without an SL of their own will add to it when they fill.
  const exposed = Math.abs(c.pos + (o.side === 'buy' ? 1 : -1) * ((c.pendingNoSl ?? 0) + o.qty));
  if (c.guard.requireStop && !c.skipStop && !o.sl && c.stopQty < exposed * (1 - 1e-9))
    return { ok: false, reason: c.stopQty > 0 ? `A stop-loss is required for the whole position: stops cover ${fmt(c.stopQty)} of ${fmt(exposed)} — add an SL to this order or enlarge the stop` : 'A stop-loss is required: add an SL to this order or place a stop first' };
  return { ok: true, reducing: false };
}
const fmt = (n: number) => (Math.abs(n) >= 100 ? n.toFixed(0) : n.toPrecision(4));

/** Guard items of the guardian report (testnet and key items come from the adapter). */
export function guardItems(g: Guard, canWithdraw: boolean | null | undefined): GuardianItem[] {
  return [
    {
      id: 'withdraw', label: 'Key has no withdraw/transfer permission',
      ok: canWithdraw === false || (canWithdraw == null && g.confirmedNoWithdraw),
      detail: canWithdraw === true ? 'The exchange reports withdraw/transfer permission on this key — create a trade-only key'
        : canWithdraw === false ? 'Read from the exchange: trade-only' : 'The exchange does not expose key permissions; relying on your confirmation',
    },
    { id: 'confirm', label: 'You confirmed the key cannot withdraw or transfer', ok: g.confirmedNoWithdraw },
    { id: 'dailyLoss', label: 'Daily loss limit (circuit breaker) set', ok: g.maxDailyLossPct > 0 && g.maxDailyLossPct <= 100, detail: `${g.maxDailyLossPct}% of start-of-day equity` },
    { id: 'positionCap', label: 'Position size capped', ok: g.maxPositionPct > 0 && g.maxPositionPct <= 100, detail: `${g.maxPositionPct}% of equity` },
    // trade/docs/RISK_RULES.md #1: a stop-loss is non-negotiable, so switching it off sends the account back to pending.
    { id: 'stop', label: 'Stop-loss required on every opening order', ok: g.requireStop },
  ];
}
