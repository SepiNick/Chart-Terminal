[English](03-alerts-watchlists-trading-brokers.en.md) · [فارسی](03-alerts-watchlists-trading-brokers.md)

# Research 03 — Alerts, Watchlists, Trading Panel and Brokers

> Goal: document the **behavior** of TradingView features for a clean-room rebuild. No code or long passages were copied from TradingView; everything has been rewritten.
> Research date: 2026-10-13. Items marked "⚠ unconfirmed" come from general knowledge and must be re-verified before implementation.

Column guide: Complexity = S (small, a few days) / M (medium) / L (large, needs infrastructure). Priority = Core / High / Medium / Low.

---

## 1. Alerts

### 1.1 Overall architecture (behavior)

- **Server-side:** all alerts are created and evaluated on the server; closing the browser or leaving the chart does not stop them, and the user does not need to be logged in.
- **Snapshot:** when an alert is created, a "snapshot" of the script, its inputs and the chart settings is taken. Later changes to the indicator or chart have no effect on the existing alert; to apply a change the alert must be deleted and recreated (or edited, which is effectively a recreation).
- **Simple price alerts** are evaluated on 1-minute candles; indicator/drawing alerts depend on the selected resolution (the interval can differ from the chart timeframe).
- **Once per bar close:** to be sure the candle has closed, the server waits for the first trade of the next candle; so it is delayed in thinly traded markets.
- **Spam protection:** if an alert triggers more than 15 times in 3 minutes, it is stopped automatically. For a watchlist alert: 15 times in 3 minutes per symbol and 1000 times in 3 minutes for the whole alert.
- **Log scale:** evaluating drawing alerts on a logarithmic scale may be unstable (TradingView recommends a linear scale).
- Alert states in the Alert manager: Active, Stopped (manual/limit), Triggered (for Only once), Expired.

### 1.2 Condition operators

| Feature | What it does | Complexity | Priority |
|---|---|---|---|
| Crossing | When a value (price/indicator) crosses a level or another series in either direction | S | Core |
| Crossing Up | Only a cross from below to above | S | Core |
| Crossing Down | Only a cross from above to below | S | Core |
| Greater Than | When the value is above the level (touching is not enough) | S | Core |
| Less Than | When the value is below the level | S | Core |
| Entering Channel | The value enters the range between two bounds (upper/lower) | S | High |
| Exiting Channel | The value leaves the range | S | High |
| Inside Channel | As long as it is inside the range (state-based, not event-based) | S | Medium |
| Outside Channel | As long as it is outside the range | S | Medium |
| Moving Up | Increase by an absolute amount within N bars | M | Medium |
| Moving Down | Decrease by an absolute amount within N bars | M | Medium |
| Moving Up % | Percentage increase within N bars | M | High |
| Moving Down % | Percentage decrease within N bars | M | High |

Note: the second side of the comparison can be a "Value" (a fixed number) or another plot from the same/another indicator (e.g. EMA20 crossing EMA50).

### 1.3 Alert sources

| Feature | What it does | Complexity | Priority |
|---|---|---|---|
| Price alert | A condition on the symbol's price (Last) with the operators above; quick creation from the price scale (click "+" or Alt+A) | S | Core |
| Indicator alert | A condition on any plot of a built-in or Pine indicator; the first 20 plots can be referenced | M | Core |
| Drawing alert | On trend line, ray, horizontal line, parallel channel, rectangle, Anchored VWAP and Fibonacci levels; the alert follows the drawing when it is moved. Line → crossing/greater/less; Channel/Rectangle → entering/exiting/inside/outside | M | High |
| Pine `alertcondition()` | The script defines named conditions and the user picks one in the dialog; the default message uses placeholders | M | High |
| Pine `alert()` | A programmatic alert with a dynamic message (a string built at runtime); the "Any alert() function call" option; freq: `freq_all` / `freq_once_per_bar` (default) / `freq_once_per_bar_close` | M | High |
| Strategy alert | On the order-fill event in the broker emulator, realtime only (not historical bars); in a strategy without `calc_on_every_tick` all `alert()` calls are effectively once-per-bar-close; `strategy.*` placeholders | L | High |
| Watchlist alert | One condition for all symbols in a watchlist; each symbol triggers independently; list membership is live (adding/removing a symbol takes effect); open-ended is not allowed; Session = Regular/Extended option | L | Medium |
| Multi-condition alert | AND-combination of up to 5 conditions (price/drawing/indicator) on one symbol; mixed timeframes are allowed and the frequency is based on the smallest timeframe; strategy and `alert()` are not supported; counts as one technical alert | L | Medium |
| Alert on Screener / Pine Screener | ⚠ unconfirmed — alert on screener results in newer versions | L | Low |

### 1.4 Alert settings

| Feature | What it does | Complexity | Priority |
|---|---|---|---|
| Trigger: Only once | Fires once, then stops | S | Core |
| Trigger: Once per bar | At most once per bar, even on the forming bar (repaint risk) | S | Core |
| Trigger: Once per bar close | Only after the bar closes | S | Core |
| Trigger: Once per minute / Every time | Checked every minute / every time the condition holds | S | High |
| Expiration | Expiry date/time or the Open-ended option (for paid plans; the free plan has a time cap) | S | Core |
| Alert name | Title in the Alert manager, toast and log | S | Core |
| Message + placeholders | Message text with variable substitution (table 1.6) | M | Core |
| Alert presets | Save notification settings, up to 5 presets (the webhook URL is not saved) | S | Low |
| Edit / Clone / Pause / Restart / Delete | Lifecycle management in the Alert manager, with filtering/sorting | M | High |
| Alert log | History of all triggers with time and message; Webhook status column; CSV export | M | High |

### 1.5 Notification channels

| Feature | What it does | Complexity | Priority |
|---|---|---|---|
| In-app popup / toast | A popup window even in another tab (with desktop notification permission) | S | Core |
| Sound | Plays a sound chosen from a list of preset sounds, with a duration (once/repeating) | S | High |
| Email | Sent to the profile email | M | High |
| Plain-text email (email-to-SMS) | Sends plain text to an alternate email address, verified with a 6-digit code (for carrier SMS gateways) | S | Low |
| Mobile push | Via the mobile app; available on all plans | L | Medium |
| Webhook | POST to an arbitrary URL (details below) | M | Core |
| Desktop app notification | Operating-system notification in the desktop version | M | Low |

**Webhook behavior (from the official page):**
- Method `POST`, body = the alert message text.
- If the message is valid JSON, `Content-Type: application/json`; otherwise `text/plain`.
- Only ports 80 and 443; IPv6 is not supported.
- Timeout of about 3 seconds; retry is not documented and delivery is not guaranteed.
- Requests come from four fixed IPs (52.89.214.238, 34.212.75.30, 54.218.53.128, 52.32.178.7) so the receiver can allowlist them.
- Enabling webhooks requires 2FA on the account; do not put credentials in the body.
- The message cannot be conditional; separate buy/sell alerts require separate alerts (or `alert()` with a dynamic message).

### 1.6 Message placeholders

| Placeholder | Meaning |
|---|---|
| `{{ticker}}`, `{{exchange}}` | Symbol and exchange (delayed data has the `_DL` suffix) |
| `{{open}}` `{{high}}` `{{low}}` `{{close}}` `{{volume}}` | Values of the bar at trigger time |
| `{{time}}` | Bar open time (UTC, ISO) |
| `{{timenow}}` | Actual trigger time (second precision) |
| `{{interval}}` | Timeframe (always "1" for a price alert) |
| `{{syminfo.currency}}`, `{{syminfo.basecurrency}}` | Symbol currency / base currency |
| `{{plot_0}}`…`{{plot_19}}`, `{{plot("Name")}}` | Indicator outputs (only the first indicator in a multi-condition alert) |
| `{{strategy.order.action}}` / `.contracts` / `.price` / `.id` / `.comment` / `.alert_message` | Details of the filled order |
| `{{strategy.position_size}}`, `{{strategy.market_position}}`, `{{strategy.market_position_size}}`, `{{strategy.prev_market_position}}`, `{{strategy.prev_market_position_size}}` | Current/previous position state |

### 1.7 Plan limits (Pricing page, October 2026)

| Plan | Price alerts | Technical alerts | Watchlist alerts | Expiry |
|---|---|---|---|---|
| Basic (free) | 3 | (limited, ⚠) | 0 | Has expiry (about 1–2 months, ⚠) |
| Essential | 20 | 20 | 0 | No expiry |
| Plus | 100 | 100 | 0 | No expiry |
| Premium | 400 | 400 | 2 | No expiry |
| Ultimate | 1000 | 1000 | 15 | No expiry |

(The professional Expert/Elite plans were not shown on the current page; according to an old blog post, Expert = 10 watchlist alerts.)
**Suggestion for the clone:** make the limits configurable in a `plans` table rather than hard-coded.

---

## 2. Watchlists

| Feature | What it does | Complexity | Priority |
|---|---|---|---|
| Multiple watchlists | Create/rename/copy/delete multiple lists and switch quickly; free = 1 list, paid = several | S | Core |
| Symbols per list | Cap of 30 (free) and 1000 (paid) symbols per list | S | Core |
| Sections | Named separator between symbols (right-click → Add section); move, collapse, delete | S | High |
| Flags / colored lists | 7 flag colors (red, blue, green, orange, purple, turquoise, pink); each color automatically creates a separate list, and the flag is also visible in the chart/screener | S | High |
| Columns | Enable/disable columns: Last, Change, Change %, Volume, Extended hours (Pre/Post-market price/change), Open/High/Low, Technical rating, Market cap, etc.; symbol logo and description columns | M | Core |
| Sorting | Sort by clicking any column header (ascending/descending/manual mode) | S | Core |
| Drag & drop reorder | Manually move symbols, including between sections | S | High |
| Real-time ticking | Live price updates with a colored flash on change | M | Core |
| Import (.txt) | Upload a text file of `EXCHANGE:SYMBOL` symbols separated by commas | S | Medium |
| Export (.txt) | Download the list in the same format (from Advanced view or the list menu) | S | Medium |
| Advanced view | Full-screen view with Overview / Earnings / Dividends / News tabs; grouping by section, currency, symbol type, sector, exchange; summary row (min/max/avg/median); distribution chart | L | Medium |
| Details panel | Below the list: price and change, day/52-week high and range, Key stats (market cap, P/E, dividend yield, EPS), Performance (1W/1M/3M/6M/YTD/1Y), Technicals gauge, Seasonals, Profile, next Earnings | M | High |
| Symbol notes | Personal note on a symbol (Notes panel in the right toolbar); visible in Details | S | Low |
| News per symbol | Per-symbol news feed in Details and the News tab in Advanced view | M | Medium |
| Hotlists | Server-provided ready-made lists: Top gainers/losers, Most active (volume), Gap up/down, Unusual volume, Most volatile, etc., per exchange/market | M | Medium |
| Shared / published watchlists | Share a list via a link | S | Low |
| Watchlist alert | (section 1.3) | L | Medium |
| Sync across devices | Sync lists across web/desktop/mobile through the user account | M | High |

---

## 3. Trading Panel

### 3.1 Structure

- The **Trading Panel** (the tab at the bottom of the page) shows the list of brokers plus Paper Trading; only one broker can be connected at a time.
- After connecting, the **Account Manager** below the chart has the tabs Positions, Orders (Working/Filled/Cancelled/Rejected), Account Summary, and History/Journal (Notifications log).
- The **Trade** / **Buy/Sell buttons** on the chart open the right-hand panel with two tabs: **Order** (the order ticket) and **DOM**.

### 3.2 Paper Trading

| Feature | What it does | Complexity | Priority |
|---|---|---|---|
| Virtual account | Configurable initial balance, account currency, commission (percent/fixed) | M | Core |
| Multiple paper accounts | Several virtual accounts for testing different strategies | S | Medium |
| Leverage per asset class | Separate margin and leverage for stocks/crypto/forex/futures/CFD | M | High |
| Realistic broker simulation | Fills based on the live price, supports all symbols that have data | L | Core |
| Reset account | Reset the balance and clear the history | S | High |
| Order history / journal | Event log (placed/filled/modified/cancelled) and trade history | M | High |

### 3.3 Order types and the order ticket

| Feature | What it does | Complexity | Priority |
|---|---|---|---|
| Market order | Executes at the best current price | S | Core |
| Limit order | Executes at the specified price or better | S | Core |
| Stop (stop-market) | After the stop price is reached, a market order is executed | S | Core |
| Stop-Limit | After the stop, a limit order is placed (broker-dependent) | M | High |
| Brackets (TP/SL) | Attach Take Profit and/or Stop Loss to an order/position; both form one OCO group (when one fills, the other is cancelled) | M | Core |
| Trailing stop | A kind of bracket that moves as the price moves in favor of the position; distance in pips/price/percent/money (broker-dependent) | M | High |
| Standalone OCO | Two linked orders where filling one cancels the other (at some brokers) | M | Medium |
| Reduce-only / Post-only | Options specific to crypto exchanges (Bybit/Binance etc.) in the ticket | S | Medium |
| Time in Force | DAY, GTC, GTD (date), IOC, FOK — depending on the broker (previously called "Duration") | S | High |
| Quantity modes | Units/contracts/lots, cash amount, percent of balance, money risk, and % risk of balance (risk fields are active only with an SL) | M | High |
| Order info box | Shows pip value, required margin, estimated commission, reward/risk | M | Medium |
| Order presets | Save a preset (relative/percentage brackets, TIF, quantity) | S | Low |
| Confirmation toggle | The confirmation message before sending can be turned off; "instant order placement" | S | Medium |
| Buy/Sell buttons on chart | One-click buttons with bid/ask and spread in the chart corner | S | High |

### 3.4 On-chart management

| Feature | What it does | Complexity | Priority |
|---|---|---|---|
| Order lines | Show orders as horizontal lines with a label (type, quantity, price) | M | Core |
| Drag to modify | Drag an order line to change its price; drag from the position/order line to create TP/SL; Shift moves an order together with its brackets | M | Core |
| Position line | Entry price line with live P&L (money/pips/percent), close and reverse buttons | M | Core |
| Executions markers | Arrows showing trade executions on the candles | S | Medium |
| Context-menu trading | Right-click on the chart → Buy/Sell Limit or Stop at the cursor price | S | High |
| Long/Short Position tool | Drawing tool that computes risk/reward and position size (separate from the real order) | M | High |

### 3.5 Depth of Market (DOM)

| Feature | What it does | Complexity | Priority |
|---|---|---|---|
| Price ladder | Bid/ask volume columns at each price level (data from the broker, Level 2 depends on the account) | L | Medium |
| Click-to-trade | Click a cell → Limit; Ctrl+click → Stop; right-click menu for market/limit/stop | M | Medium |
| Order markers in ladder | Show the user's orders on the level; drag to modify; X to cancel | M | Medium |
| Bulk cancel | Cancel all buys, all sells, or CXL ALL | S | Medium |
| Flatten / Reverse | Close the position / reverse it | S | Medium |
| Buy Mkt / Sell Mkt | Market order with a quantity field | S | Medium |
| Static ladder + recenter | Fixed levels with a recenter button | S | Low |
| Status colors | Different color for active limit/stop/stop-limit orders | S | Low |

### 3.6 Account Manager

| Feature | What it does | Complexity | Priority |
|---|---|---|---|
| Account summary | Balance, Equity, Realized/Unrealized P&L, Margin used/available, Margin level | M | Core |
| Positions tab | List of positions with side, qty, avg price, last, P&L, TP/SL, close button | M | Core |
| Orders tab | Filter Working/Filled/Cancelled/Rejected/All; modify/cancel | M | Core |
| History / Journal | Timestamped log of all account events, exportable (⚠ export is broker-dependent) | M | High |
| Close all / Cancel all | Bulk actions | S | High |

---

## 4. Broker integrations

### 4.1 Broker list (from tradingview.com/brokers and broker pages, October 2026)

The brokers page mentions more than 100 partners and the list is filtered by the user's country; the table below contains everything that was confirmed.

| Broker | Asset class | API type | Testnet? | CCXT? | Notes |
|---|---|---|---|---|---|
| Binance | Crypto spot + USDⓈ-M futures | REST + WS (HMAC/Ed25519 keys) | ✅ Spot testnet and Futures testnet | ✅ | Futures on TV since 2022, spot since May 2023 |
| Bybit | Crypto spot + derivatives | REST v5 + WS | ✅ testnet + Demo trading | ✅ | On TV since February 2024 |
| OKX | Crypto spot/swap/futures/options | REST v5 + WS | ✅ Demo trading (simulated header) | ✅ | |
| Kraken | Crypto spot (+ futures) | REST + WS | ⚠ Futures demo only; no spot | ✅ (kraken, krakenfutures) | |
| Coinbase Advanced | Crypto spot + futures | REST + WS (CDP keys) | ⚠ limited sandbox | ✅ (coinbase, coinbaseadvanced) | |
| Bitget | Crypto spot + futures | REST v2 + WS | ✅ Demo trading (paptrading) | ✅ | |
| BingX | Crypto spot + perpetual | REST + WS | ✅ VST demo (perp) | ✅ | |
| Gate | Crypto spot + futures | REST v4 + WS | ✅ futures testnet | ✅ (gate) | |
| BitMEX | Crypto derivatives + spot | REST + WS | ✅ testnet.bitmex.com | ✅ | On TV since April 2025 |
| WhiteBIT | Crypto spot + futures | REST v4 + WS | ❌ (⚠ unconfirmed) | ✅ | Futures added in 2025 |
| Interactive Brokers | Stocks, options, futures, forex, bonds | TWS API / Client Portal Web API | ✅ Paper account | ❌ | multi-asset |
| TradeStation | Stocks, options, futures | REST v3 + streaming | ✅ SIM environment | ❌ | DOM with Level 2 |
| Tradovate | Futures | REST + WS | ✅ demo | ❌ | |
| NinjaTrader | Futures | (connection through the Tradovate stack) | ✅ demo | ❌ | |
| AMP Futures | Futures | CQG/Rithmic gateways | ✅ demo | ❌ | |
| AvaFutures, WH SelfInvest Futures | Futures | broker-specific | ✅ demo | ❌ | |
| Alpaca | US stocks, options, crypto | REST + WS | ✅ Paper trading API | ✅ (alpaca, crypto) | Multi-leg options not supported from TV |
| Tastytrade / tastyfx | Stocks, options, futures / Forex | REST + WS | ✅ cert sandbox | ❌ | |
| Webull | US stocks, options | OpenAPI | ⚠ | ❌ | |
| Tradier | US stocks, options | REST | ✅ sandbox | ❌ | |
| CapTrader, MEXEM | Multi-asset (IBKR introducing brokers) | via IBKR | ✅ paper | ❌ | |
| OANDA | Forex/CFD | REST v20 + streaming | ✅ practice account | ❌ | Trailing stop supported |
| FOREX.com | Forex/CFD | REST (GAIN) | ✅ demo | ❌ | |
| FXCM | Forex/CFD | REST/socket.io | ✅ demo | ❌ | |
| Pepperstone | Forex/CFD | cTrader/MT bridges | ✅ demo | ❌ | |
| IC Markets | Forex/CFD | cTrader/MT | ✅ demo | ❌ | Listed under the name "IC" |
| Capital.com | Forex/CFD | REST + WS | ✅ demo API | ❌ | |
| Eightcap | Forex/CFD | MT5 bridge | ✅ demo | ❌ | |
| ThinkMarkets, FxPro, Tickmill, ActivTrades, CMC Markets, IG, GO Markets, FP Markets, Swissquote, Darwinex, easyMarkets, Trade Nation, GBE brokers, Alchemy Markets, Purple Trading, CFI, Skilling | Forex/CFD | broker-specific (often MT4/MT5 or proprietary REST) | ✅ usually demo | ❌ | |
| ColmexPro, RoboMarkets | Stocks/ETF (+CFD) | broker-specific | ✅ demo | ❌ | |
| Saxo, Zerodha, Fidelity, etc. | — | — | — | — | ⚠ A direct TV connection was not confirmed in this research |

**Takeaway for the clone:** we cannot reproduce TV's official integrations (they are contractual). The practical path: a `BrokerAdapter` layer with three initial implementations — Paper (internal), CCXT (all the crypto exchanges above that have a testnet), MT5 (forex) — and Nobitex later.

### 4.2 Nobitex (Iranian exchange) — public API

| Item | Detail |
|---|---|
| Base URL | `https://apiv2.nobitex.ir` |
| Testnet | ✅ `https://testnetapiv2.nobitex.ir` |
| Auth | `Authorization: Token <token>` header, or an API key with `Nobitex-Key` + an Ed25519 signature (`Nobitex-Signature`, URL-safe base64) + `Nobitex-Timestamp`; READ / TRADE permissions |
| Market data (public) | `/v3/orderbook/{symbol}` (or `all`) — 300/min; `/v2/depth/{symbol}` — 300/min; `/v2/trades/{symbol}` (last 20 trades) — 60/min; `/market/stats` — 20/min |
| OHLC | `/market/udf/history` (UDF format — suited to a chart datafeed); resolutions: 1,5,15,30,60,180,240,360,720 minutes and D/2D/3D; at most 500 candles per response, with `countback` and `page`; 1-minute candles from the start of 1401 (Solar Hijri) |
| Symbol format | `BTCIRT`, `BTCUSDT` (rial = IRT in the symbol, `rls` in stats) |
| Order types | `limit`, `market`, `stop_limit`, `stop_market`, and OCO via `mode=oco` |
| Order endpoints | `/market/orders/add` (300 per 10 minutes), `/status`, `/list`, `/update-status` (cancel), `/cancel-old`, `/market/trades/list`; `clientOrderId` up to 32 characters |
| Margin | ✅ Separate margin trading section |
| WebSocket | ✅ (WebSocket section in the docs) |
| CCXT | ❌ Not in official CCXT; ✅ in the unofficial fork `ccxt-ir` (PyPI) along with Wallex, Ramzinex, Tabdeal, OMPFinex, Bitpin, etc. |
| Note | Recommended header `User-Agent: TraderBot/<name-version>`; duplicate-order check within 10 seconds (disabled with `pro=true`) |

### 4.3 MetaTrader 5 + Python (forex)

- The official `MetaTrader5` package (pip) connects over IPC to an MT5 terminal installed on the same machine; the terminal must be running/runnable. In practice **Windows only** (on Linux only via Wine — ⚠).
- 32 functions: connection (`initialize`, `login`, `shutdown`, `version`, `last_error`), information (`account_info`, `terminal_info`, `symbols_get`, `symbol_info`, `symbol_info_tick`, `symbol_select`), Level 2 (`market_book_add/get/release`), historical data (`copy_rates_from`, `copy_rates_from_pos`, `copy_rates_range`, `copy_ticks_from`, `copy_ticks_range`), trading (`order_check`, `order_send`, `order_calc_margin`, `order_calc_profit`), state (`orders_get`, `positions_get`) and history (`history_orders_get`, `history_deals_get`).
- No push streaming → polling is required (e.g. `symbol_info_tick` every 200–500ms).
- A demo account is free at almost all MT5 brokers ← a practical testnet.
- **Architecture suggestion:** a small Windows microservice (Python) that wraps MT5 and connects to the main backend over WS/REST.

---

## 5. MVP priority summary

1. **Core:** Price/indicator alerts with crossing/greater/less operators + frequencies + expiration + popup/sound/webhook + alert log; multiple watchlists with columns and sorting; Paper trading with market/limit/stop + brackets + on-chart drag + account summary.
2. **High:** Drawing alerts, `alert()`/`alertcondition`, sections and flags, details panel, trailing stop, TIF, risk-% sizing, CCXT adapter with testnet.
3. **Medium/Low:** Watchlist and multi-condition alerts, DOM, hotlists, advanced view, mobile push, Nobitex and MT5 adapters.

## 6. Gaps

- The brokers page is rendered with JS; the complete country-by-country list (especially Indian, Turkish and Korean brokers) was not extracted.
- The technical-alert cap and free-plan expiry duration, and the caps of the Expert/Elite plans, were not precisely confirmed.
- The complete list of watchlist columns and the list of alert sounds were not extracted from the official docs (taken from general knowledge).
- Testnet status for WhiteBIT, Coinbase and Webull was not independently confirmed.
- Nobitex WebSocket details (channels/protocol) were not examined.

## Sources

- https://www.tradingview.com/support/solutions/43000763312-learn-how-to-configure-alerts/
- https://www.tradingview.com/support/solutions/43000474415 (alert frequencies)
- https://www.tradingview.com/support/solutions/43000529348-about-webhooks/
- https://www.tradingview.com/support/solutions/43000531021-how-to-use-a-variable-value-in-alert/
- https://www.tradingview.com/support/solutions/43000761492-multi-condition-alerts/
- https://www.tradingview.com/support/solutions/43000739708-watchlist-alerts-your-trading-edge/
- https://www.tradingview.com/support/solutions/43000763315-getting-started-with-technical-alerts/
- https://www.tradingview.com/support/solutions/43000481368-strategy-alerts/
- https://www.tradingview.com/support/solutions/43000548327-will-alerts-work-if-tradingview-is-not-open-on-the-computer/
- https://www.tradingview.com/support/solutions/43000773948-delays-in-onceperbarclose-alerts/
- https://www.tradingview.com/support/solutions/43000474389-how-to-receive-phone-notifications-for-alerts/
- https://www.tradingview.com/support/solutions/43000774194-alert-presets/
- https://www.tradingview.com/blog/en/alerts-on-fibonacci-drawings-58692/
- https://www.tradingview.com/pine-script-docs/concepts/alerts/
- https://www.tradingview.com/pricing/
- https://www.tradingview.com/support/solutions/43000487233-how-to-import-or-export-a-watchlist/
- https://www.tradingview.com/support/solutions/43000771546-watchlist-advanced-view-mode/
- https://www.tradingview.com/support/solutions/43000615520-how-to-add-a-section-to-the-watchlist/
- https://www.tradingview.com/support/solutions/43000487210-i-want-to-add-or-remove-columns-to-the-watchlist/
- https://www.tradingview.com/blog/en/introducing-flagged-symbols-7443/
- https://www.tradingview.com/support/solutions/43000516466-paper-trading-main-functionality/
- https://www.tradingview.com/trading/
- https://www.tradingview.com/support/solutions/43000754951-order-brackets/
- https://www.tradingview.com/support/solutions/43000501552-how-do-i-place-a-trailing-stop-order/
- https://www.tradingview.com/blog/en/optimize-trading-with-order-presets-48237/
- https://www.tradingview.com/support/solutions/43000516459-depth-of-market-dom-what-it-is-and-how-traders-can-use-it/
- https://www.tradingview.com/brokers/
- https://www.tradingview.com/blog/en/binance-spot-trading-on-tradingview-38297
- https://www.tradingview.com/blog/en/welcoming-binance-futures-to-tradingview-35227
- https://www.tradingview.com/blog/en/whitebit-integration-update-futures-trading-now-live-52174
- https://www.tradingview.com/broker/Bybit/
- https://blog.bitmex.com/bitmex-tradingview-partnership
- https://alpaca.markets/learn/how-to-trade-options-on-tradingview-with-alpaca-trading-api-account
- https://www.businesswire.com/news/home/20241023358076/en/Leading-forex-broker-tastyfx-offers-integration-with-TradingView
- https://www.webull.com/partners/tradingview
- https://trade.tradier.com/tradingview/
- https://apidocs.nobitex.ir/ (and the files `openapi/market_data.yaml` and `openapi/spot_trade.yaml`)
- https://pypi.org/project/ccxt-ir/
- https://www.mql5.com/en/docs/python_metatrader5
