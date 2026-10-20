// Phase 6 broker contract (docs/phase6-contracts.md), shared by the client and the server. Types only.
// One model for every account: our paper account (in the browser) and exchange testnet accounts (on the server).
import type { Side } from '../trading.ts';

export type { Side };
/** 'paper' is the synced paper account; the rest are exchange TESTNETS only (the server refuses mainnet). */
export type BrokerId = 'paper' | 'binance' | 'binanceusdm' | 'bybit' | 'okx' | 'kucoin' | 'nobitex';
export type Market = 'spot' | 'futures';
export type OrderKind = 'market' | 'limit' | 'stop' | 'stop_limit' | 'trailing_stop';

/** Risk limits checked on the server before every order (trade/docs/RISK_RULES.md). */
export interface Guard {
  maxDailyLossPct: number;      // circuit breaker: no new risk once today's loss reaches this % of start-of-day equity
  maxPositionPct: number;       // a position's notional may not exceed this % of equity
  requireStop: boolean;         // orders that open or add to a position need a stop-loss
  confirmedNoWithdraw: boolean; // the user confirmed the key has no withdraw/transfer permission
}
export const DEFAULT_GUARD: Guard = { maxDailyLossPct: 3, maxPositionPct: 20, requireStop: true, confirmedNoWithdraw: false };

export interface BrokerAccount {
  id: string;                   // 'paper' for the paper account
  broker: BrokerId;
  label: string;
  market: Market;
  testnet: boolean;             // always true for exchange accounts
  /** 'pending' until the guardian check passes; 'tripped' after the circuit breaker (resets next UTC day). */
  status: 'active' | 'pending' | 'tripped' | 'disabled' | 'error';
  error?: string;
  guard: Guard;
  hasPassphrase?: boolean;      // OKX / KuCoin need one; never returned, only whether it is set
}

/** New exchange account: keys go to the server once and are never sent back (stored encrypted, server/core/secrets.ts). */
export interface AccountInput { broker: Exclude<BrokerId, 'paper'>; label: string; market: Market; apiKey: string; secret: string; passphrase?: string; guard?: Partial<Guard> }

export interface OrderReq {
  sym: string;                  // the app's symbol (BTCUSDT, BYBIT:BTC_USDT.P, …); the broker maps it
  side: Side;
  kind: OrderKind;
  qty: number;                  // base units
  price?: number;               // limit price (limit, stop_limit)
  stopPrice?: number;           // trigger (stop, stop_limit)
  trail?: { pct?: number; amount?: number };   // trailing_stop: distance from the best price since placement
  reduceOnly?: boolean;
  tp?: number; sl?: number;     // bracket: placed as an OCO pair once this order fills
  ocoWith?: Omit<OrderReq, 'tp' | 'sl' | 'ocoWith'>;   // standalone OCO: this order and `ocoWith` cancel each other
  clientId?: string;
}
export interface BrokerOrder {
  id: string; sym: string; side: Side; kind: OrderKind; qty: number; filled: number;
  price?: number; stopPrice?: number; trail?: { pct?: number; amount?: number };
  reduceOnly?: boolean; tp?: number; sl?: number; ocoGroup?: string;
  status: 'open' | 'filled' | 'canceled' | 'rejected';
  avgPrice?: number; created: number; updated: number; error?: string;
}
/** Change a resting order (dragging its line on the chart): only the given fields. */
export interface OrderPatch { price?: number; stopPrice?: number; qty?: number; tp?: number | null; sl?: number | null }
export interface BrokerPosition { sym: string; qty: number; entry: number; mark?: number; upnl?: number; liq?: number; leverage?: number }   // qty < 0 = short
export interface BrokerFill { id: string; orderId: string; sym: string; side: Side; qty: number; price: number; fee: number; realized?: number; ts: number }
export interface Balance { asset: string; free: number; locked: number }
export interface BrokerState { account: string; balances: Balance[]; positions: BrokerPosition[]; orders: BrokerOrder[]; fills: BrokerFill[]; equity?: number; dayStartEquity?: number; updated: number }

/** What every account offers the UI (ticket, chart lines, DOM, panels). Errors reject with a readable message. */
export interface Broker {
  readonly account: BrokerAccount;
  state(): BrokerState | null;                        // last known, synchronous (null until loaded)
  refresh(): Promise<BrokerState>;
  place(o: OrderReq): Promise<BrokerOrder>;
  cancel(orderId: string): Promise<void>;
  modify(orderId: string, patch: OrderPatch): Promise<BrokerOrder>;
  closePosition(sym: string): Promise<void>;
  onChange(fn: (s: BrokerState) => void): () => void;
}

// ---------- server API (all routes need a login) ----------
//   GET    /api/broker/accounts                 → BrokerAccount[]   (exchange accounts; the client adds 'paper')
//   POST   /api/broker/accounts   AccountInput  → BrokerAccount (status 'pending')
//   PUT    /api/broker/accounts/:id { label?, guard? } → BrokerAccount
//   DELETE /api/broker/accounts/:id             (also deletes its secrets)
//   POST   /api/broker/accounts/:id/check       → GuardianReport; activates the account only when every item passes
//   GET    /api/broker/:id/state                → BrokerState
//   POST   /api/broker/:id/orders   OrderReq    → BrokerOrder   (400 with the guard's reason when refused)
//   PATCH  /api/broker/:id/orders/:oid OrderPatch → BrokerOrder
//   DELETE /api/broker/:id/orders/:oid
//   POST   /api/broker/:id/close    { sym }
//   WS  ←  { type: 'broker', account, state: BrokerState } after every change (orders, fills, balances)
export interface GuardianItem { id: string; label: string; ok: boolean; detail?: string }
export interface GuardianReport { ok: boolean; items: GuardianItem[] }
