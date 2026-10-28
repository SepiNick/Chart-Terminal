// Order ticket sizing: turn "how much" (units, quote amount, % of balance, % of equity risked to the stop) into a quantity.
import type { Balance } from './broker/types.ts';

export type SizeMode = 'units' | 'quote' | 'pct' | 'risk';
export interface SizeInput {
  mode: SizeMode; value: number;
  price: number;        // expected entry price
  available: number;    // free quote balance
  equity: number;
  sl?: number;          // needed for 'risk'
  step?: number;        // lot step; the quantity is rounded down to it
}

export function sizeQty(s: SizeInput): { qty: number; error?: string } {
  if (!(s.value > 0)) return { qty: 0, error: 'Size must be positive' };
  if (!(s.price > 0)) return { qty: 0, error: 'No price yet' };
  let q: number;
  if (s.mode === 'units') q = s.value;
  else if (s.mode === 'quote') q = s.value / s.price;
  else if (s.mode === 'pct') q = (s.available * s.value) / 100 / s.price;
  else {
    if (s.sl == null) return { qty: 0, error: 'Risk sizing needs a stop-loss' };
    const d = Math.abs(s.price - s.sl);
    if (!(d > 0)) return { qty: 0, error: 'Stop-loss is at the entry price' };
    q = (s.equity * s.value) / 100 / d;
  }
  const step = s.step ?? 1e-8;
  const qty = +(Math.floor(q / step + 1e-9) * step).toFixed(8);
  return qty > 0 ? { qty } : { qty: 0, error: 'Size rounds to 0' };
}

const QUOTES = ['USDT', 'USDC', 'FDUSD', 'BUSD', 'USD', 'IRT', 'RLS', 'TMN', 'BTC', 'ETH'];
/** The balance a symbol is bought with: its quote asset if the account holds it, else the first balance. */
export function quoteBalance(sym: string, balances: Balance[]): Balance | undefined {
  const s = sym.toUpperCase().replace(/^[A-Z0-9]+:/, '').replace(/\.P$/, '');
  const q = QUOTES.find(x => s.endsWith(x) && balances.some(b => b.asset.toUpperCase() === x));
  return balances.find(b => b.asset.toUpperCase() === q) ?? balances[0];
}
