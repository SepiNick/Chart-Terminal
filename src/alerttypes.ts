// Alert model shared by the server engine (server/alerts) and the client UI. docs/phase5-contracts.md §5.
export type Channel = 'popup' | 'push' | 'telegram' | 'email' | 'webhook';

/** A line the client resolved from a drawing; the server evaluates its price at any time. Times in seconds. */
export type LineRef =
  | { type: 'hline'; price: number }
  | { type: 'trend'; t1: number; p1: number; t2: number; p2: number; extendLeft?: boolean; extendRight?: boolean };

export type AlertSource =
  | { kind: 'price' }                                                                    // last price (forming bar's close)
  | { kind: 'indicator'; script: string; inputs?: Record<string, unknown>; plot: number }  // Pine indicator source; value of plot N
  | { kind: 'drawing'; drawingId?: string; line: LineRef; line2?: LineRef }               // line2: second edge for channel conditions
  | { kind: 'script'; script: string; inputs?: Record<string, unknown>; event: 'alertcondition' | 'alert' | 'strategy'; index?: number };

export type Condition =
  | 'crossing' | 'crossing_up' | 'crossing_down' | 'greater' | 'less'
  | 'entering_channel' | 'exiting_channel' | 'inside_channel' | 'outside_channel'
  | 'moving_up' | 'moving_down' | 'moving_up_pct' | 'moving_down_pct';

export type Frequency = 'once' | 'once_per_bar' | 'once_per_bar_close' | 'every_time' | 'once_per_minute';

export interface Alert {
  id: string;
  name?: string;
  sym: string;                 // app symbol (BTCUSDT, BYBIT:BTC_USDT.P …)
  tf: string;                  // bar interval used for "per bar" frequencies, moving_* and script/indicator evaluation
  source: AlertSource;
  condition?: Condition;       // not used for script sources
  value?: number;              // level for price/indicator conditions; amount for moving_* (price units or %)
  value2?: number;             // upper bound for channel conditions on price/indicator sources
  bars?: number;               // lookback for moving_* conditions (default 1)
  frequency: Frequency;
  expires?: number | null;     // ms epoch; null = never
  channels: Channel[];
  webhook?: { url: string; body?: string };
  message: string;             // template: {{ticker}} {{exchange}} {{interval}} {{close}} {{open}} {{high}} {{low}} {{volume}} {{time}} {{timenow}} {{plot_0}}… {{strategy.order.action}} {{strategy.order.contracts}} {{strategy.order.price}} {{strategy.position_size}}
  active: boolean;
  created: number;             // ms
  lastFired?: number;          // ms
  fireCount: number;
  autoStop?: { count: number; minutes: number };   // disable when it fires more than count times within minutes (default 15 in 3)
  stoppedReason?: string;      // set when the engine deactivates it (expired, auto-stopped, script error)
}
export type AlertInput = Omit<Alert, 'id' | 'created' | 'fireCount' | 'lastFired' | 'stoppedReason'>;
export interface AlertLog { id: number; alertId: string; at: number; message: string; price?: number; deliveries: { channel: Channel; ok: boolean; error?: string }[] }
