// Server-side order emulation for what an exchange lacks natively: trailing stops, stops / stop-limits where missing,
// OCO legs and TP/SL brackets. Pure trigger logic; index.ts persists the records and sends the orders.
import type { OrderKind, Side } from '../../src/broker/types.ts';

export interface Trigger { dir: 'up' | 'down'; at: number; best?: number; trail?: { pct?: number; amount?: number } }
type Armable = { side: Side; kind: OrderKind; price?: number; stopPrice?: number; trail?: { pct?: number; amount?: number } };

const dist = (t: NonNullable<Trigger['trail']>, px: number) => (t.pct ? (px * t.pct) / 100 : t.amount ?? 0);

/**
 * When to fire. Stops trigger in their side's direction (buy stop above, sell stop below); a limit leg (OCO / take
 * profit) fires when price touches its limit; a trailing stop follows the best price since it was armed at `px`.
 */
export function arm(o: Armable, px: number): Trigger {
  if (o.kind === 'trailing_stop') {
    const trail = o.trail!, d = dist(trail, px);
    return o.side === 'sell' ? { dir: 'down', at: px - d, best: px, trail } : { dir: 'up', at: px + d, best: px, trail };
  }
  if (o.kind === 'limit') return { dir: o.side === 'sell' ? 'up' : 'down', at: o.price! };
  if (o.kind === 'stop' || o.kind === 'stop_limit') return { dir: o.side === 'buy' ? 'up' : 'down', at: o.stopPrice! };
  throw Error(`${o.kind} orders are not emulated`);
}

/** Feed one price. Moves a trailing trigger with new extremes; returns true when the order must be sent now. */
export function step(t: Trigger, px: number): boolean {
  if (t.trail && t.best !== undefined) {
    if (t.dir === 'down' && px > t.best) { t.best = px; t.at = px - dist(t.trail, px) }
    if (t.dir === 'up' && px < t.best) { t.best = px; t.at = px + dist(t.trail, px) }
  }
  return t.dir === 'up' ? px >= t.at : px <= t.at;
}

/** What goes to the exchange when the trigger fires. */
export const sendKind = (k: OrderKind): 'market' | 'limit' => (k === 'stop_limit' || k === 'limit' ? 'limit' : 'market');
