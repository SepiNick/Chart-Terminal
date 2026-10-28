// The one internal interface every exchange adapter implements, plus the app-symbol parser they share.
import type { Balance, BrokerFill, BrokerOrder, BrokerPosition, Side } from '../../src/broker/types.ts';

/** An order the exchange itself takes (market and limit everywhere; stop / stop_limit only where `native` says so). */
export interface Native { sym: string; side: Side; kind: 'market' | 'limit' | 'stop' | 'stop_limit'; qty: number; price?: number; stopPrice?: number; reduceOnly?: boolean; clientId?: string }

export interface Adapter {
  /** Hosts this adapter calls (all verified testnet hosts) — shown in the guardian report. */
  readonly hosts: string[];
  /** Trigger kinds the exchange holds natively; the rest are emulated by the server. */
  readonly native: ReadonlySet<'stop' | 'stop_limit'>;
  readonly canEdit: boolean;
  balances(): Promise<Balance[]>;
  positions(): Promise<BrokerPosition[]>;
  openOrders(): Promise<BrokerOrder[]>;
  order(id: string, sym: string): Promise<BrokerOrder>;
  fills(syms: string[]): Promise<BrokerFill[]>;
  price(sym: string): Promise<number>;
  place(o: Native): Promise<BrokerOrder>;
  cancel(id: string, sym: string, trigger?: boolean): Promise<void>;
  edit?(id: string, o: Native): Promise<BrokerOrder>;
  /** true / false where the exchange exposes key permissions, null where it doesn't (the user's confirmation decides). */
  canWithdraw(): Promise<boolean | null>;
  /** Push channel (CCXT pro): calls `nudge` on account events so the state loop polls at once. */
  watch?(nudge: () => void): () => void;
  close(): void;
}

// Longest first: BTCFDUSD must not parse as BTCF + DUSD, ETHUSDT not as ETHUS + DT.
const QUOTES = ['FDUSD', 'USDT', 'USDC', 'BUSD', 'TUSD', 'DAI', 'IRT', 'TRY', 'EUR', 'BRL', 'USD', 'BTC', 'ETH', 'BNB'];

/**
 * App symbol → base / quote / perpetual. Accepts BTCUSDT, BINANCE:BTCUSDT, BYBIT:BTC_USDT, BYBIT:BTC_USDT.P,
 * OKX:BTC_USD.PBTC (inverse, settled in BTC). Dated futures (.F…) are not traded here.
 */
export function parseSym(sym: string): { base: string; quote: string; perp: boolean; settle?: string } {
  let s = sym.toUpperCase();
  const i = s.indexOf(':');
  if (i >= 0) s = s.slice(i + 1);
  let perp = false, settle: string | undefined;
  const p = /^(.+)\.P([A-Z0-9]*)$/.exec(s);
  if (p) { s = p[1]; perp = true; settle = p[2] || undefined }
  if (s.includes('.')) throw Error(`Unsupported contract ${sym}`);
  let base: string, quote: string;
  if (s.includes('_')) [base, quote] = s.split('_');
  else {
    const q = QUOTES.find(q => s.endsWith(q) && s.length > q.length);
    if (!q) throw Error(`Cannot tell the quote currency of ${sym}`);
    base = s.slice(0, -q.length); quote = q;
  }
  if (!base || !quote) throw Error(`Bad symbol ${sym}`);
  return { base, quote, perp, ...(settle ? { settle } : {}) };
}
