// Pure helpers for the position tools and the magic cursor (no DOM, tested in math.test.ts).

/** Isolated-margin liquidation price (fees and funding ignored): equity hits maintenance margin.
 *  Long: E/L + P − E = mmr·P;  short: E/L + E − P = mmr·P. null when it cannot be liquidated (long at 1x). */
export function liquidationPrice(entry: number, leverage: number, mmr: number, dir: 1 | -1): number | null {
  if (!(entry > 0) || !(leverage > 0)) return null;
  const p = dir > 0 ? (entry * (1 - 1 / leverage)) / (1 - mmr) : (entry * (1 + 1 / leverage)) / (1 + mmr);
  return p > 0 && Number.isFinite(p) ? p : null;
}

export interface SizeIn {
  entry: number; stop: number; target: number; dir: 1 | -1;
  account: number; riskMode: string; risk: number;   // riskMode '%' = risk is a percent of account, otherwise an amount
  leverage: number; lotStep: number; mmr: number;     // mmr as a fraction (0.005 = 0.5%)
}
export interface SizeOut {
  qty: number; riskAmt: number; loss: number; reward: number; rr: number;
  notional: number; margin: number; liq: number | null;
  liqFirst: boolean;      // liquidation is hit before the stop
  overMargin: boolean;    // margin needed exceeds the account
}
/** Quantity from risk ÷ stop distance, rounded down to the lot step; then notional, margin and liquidation. */
export function positionSize(i: SizeIn): SizeOut {
  const dist = Math.abs(i.entry - i.stop), riskAmt = i.riskMode === '%' ? (i.account * i.risk) / 100 : i.risk;
  let qty = dist > 0 && riskAmt > 0 ? riskAmt / dist : 0;
  if (i.lotStep > 0) qty = Math.floor(qty / i.lotStep + 1e-9) * i.lotStep;
  const lev = i.leverage > 0 ? i.leverage : 1, notional = qty * i.entry, liq = liquidationPrice(i.entry, lev, i.mmr, i.dir);
  return {
    qty, riskAmt, loss: qty * dist, reward: qty * Math.abs(i.target - i.entry), rr: dist ? Math.abs(i.target - i.entry) / dist : 0,
    notional, margin: notional / lev, liq,
    liqFirst: liq != null && (i.dir > 0 ? liq >= i.stop : liq <= i.stop),
    overMargin: notional / lev > i.account,
  };
}

/** Decimals needed to show multiples of `step` (0.001 → 3). */
export const stepDecimals = (step: number) => (step > 0 ? Math.max(0, Math.ceil(-Math.log10(step) - 1e-9)) : 0);

/** The bar's open/high/low/close closest to v, compared through f (e.g. price → screen y). */
export function nearestOHLC(b: { open: number; high: number; low: number; close: number }, v: number, f: (p: number) => number = p => p): number {
  return [b.open, b.high, b.low, b.close].reduce((a, c) => (Math.abs(f(c) - v) < Math.abs(f(a) - v) ? c : a));
}
