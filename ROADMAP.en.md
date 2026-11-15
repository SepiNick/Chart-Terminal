[English](ROADMAP.en.md) · [فارسی](ROADMAP.md)

# Chart Terminal Roadmap

This roadmap was built from the five research reports in `docs/research/`. Those reports list about 1180 feature rows, each with its source. Every implementation is written from scratch, based on observed behavior (clean-room method). Findings from the desktop app review are in `docs/desktop-shell-spec.md`.

| Report | Contents | Count |
|---|---|---|
| [01-charting-core](docs/research/01-charting-core.en.md) | Chart types, drawing tools, settings, layouts, Replay, shortcuts | 21 chart types, about 120 drawing tools, 63 settings |
| [02-indicators-pine-strategy](docs/research/02-indicators-pine-strategy.en.md) | Indicators, Pine v6, Strategy Report | about 170 indicators, 20 strategies, 53 metrics |
| [03-alerts-watchlists-trading-brokers](docs/research/03-alerts-watchlists-trading-brokers.en.md) | Alerts, Watchlist, trading panel, brokers | about 40 trading features, about 50 brokers |
| [04-calendars-news-screeners-data](docs/research/04-calendars-news-screeners-data.en.md) | Calendars, news, Screener, Heatmap, data sources | 58 features, 35 APIs |
| [05-beyond-tradingview](docs/research/05-beyond-tradingview.en.md) | Competitor features and Iranian market needs | 13 areas |
| [06-atas-vs-ninjatrader-metatrader](docs/research/06-atas-vs-ninjatrader-metatrader.en.md) | ATAS vs. NinjaTrader, MT5 and us; features we lack | 10 prioritized items |
| [07-my-journal](docs/research/07-my-journal.en.md) | My Journal sections and forms, the reference for our journal | 14 sections |

## Fixed principles

- **Real money:** only after passing the `trade-guardian` review, complying with `trade/docs/RISK_RULES.md`, and your explicit approval. Until then, testnet and paper accounts only.
- **API keys:** only on the local server and in Windows Credential Manager (keytar). Never in the browser or in a file.
- **Server:** Binance and Bybit block Iranian IPs, so the server must run outside Iran or behind a VPN.
- **Data:** we do not take data from Investing.com or from TradingView's internal URLs. Free sources usually forbid redistributing data, so a public release of the app needs a data budget.

## Phases

Legend: ✅ done · ⏳ remaining · ⭐ a feature TradingView does not have

### ✅ Phases 0 and 1: prototype and core
The chart and 7 chart types, layouts of 1 to 6 charts with sync, 12 drawing tools, Object tree, chart settings, 12 indicators, paper trading (Market/Limit/Stop and TP/SL as OCO), Watchlist, browser-side price alerts, Screener, Bar Replay.

### ✅ Phase 2: chart completion (done, 2026-10-15)
- **92 drawing tools in 7 groups:** each tool is a separate module in `src/tools/`. Hit testing is automatic, and every tool has a properties dialog with four tabs: Style, Text, Coordinates and Visibility. Drawing templates, floating toolbar, right-click menu, copy and paste, clone with Ctrl+drag, Shift-drag to move along one axis, moving with arrow keys, weak and strong Magnet, stay-in-drawing mode, lock and hide all, layer ordering, groups in the Object tree, per-timeframe visibility, and alerts on drawings.
- **Chart types:** 18 types, including Renko, Line break, Kagi, Point & Figure, Range, Volume candles, HLC area, High-low, Step, Columns and Baseline.
- **Chart settings:** 6 tabs: Symbol, Status line, Scales, Canvas, Trading and Alerts.
- **Layouts:** 13 layouts of up to 16 charts, with a draggable splitter and single-chart maximize. Sync of symbol, timeframe, crosshair and time, plus color groups.
- **Layouts and templates:** save, Save as, rename, copy, delete, auto-save, and file Export/Import. Indicator and chart templates.
- **Symbol and timeframe:** symbol comparison, math on symbols (`BTCUSDT/ETHUSDT`), timeframes from seconds to monthly, custom and favorite timeframes, and typing directly on the chart to change the symbol and timeframe.
- **Side tools:** Undo/Redo, Data window, full Replay (pick a candle or a date, random candle, backward and forward, 6 speeds), 1D to All ranges, go to date, CSV export, copy image, and 31 shortcuts.

**Deferred to later phases (reason in parentheses):**
- **Phase 8:** Volume footprint, TPO and Session volume profile as chart types, and tick and Range timeframes (they need trade data).
- **Phase 9:** financial events on the chart (needs calendar data).
- **Phase 5 (done):** layout sharing link and snapshot.
- **Completed in the leftovers round (2026-10-21):** Replay of all charts at once ("All charts" checkbox), moving a drawing to another pane ("Move to"), pane buttons (up, down, maximize, collapse, delete), Pin to scale for built-in indicators, and Magic cursor.
- **Not implemented:** pre-market and post-market sessions (meaningless for crypto). The "New left" scale, because lightweight-charts has only one left axis.

### (Reference) Phase 2: original contents (report 01)
- **Working with drawings:** floating toolbar, properties dialog (style, coordinates, visibility on specific timeframes), drawing templates, copy, Undo/Redo, and syncing drawings between layouts.
- **More drawing tools:** channels, Pitchfork, Gann, Fib extension and time zone, XABCD and Elliott patterns, Brush, arrows and notes, Anchored VWAP, Fixed Range Volume Profile, and Date/Price range.
- **More chart types:** Renko, Line break, Kagi, Point & Figure, Range, Step line, Columns and High-low.
- **Layout and side tools:** saving a layout by name, chart template, syncing time and date range, grouping charts with color labels, symbol comparison and math on symbols (like `BTCUSDT/ETHUSDT`), Data window, custom and favorite timeframes, and fuller Replay (random candle, jump to date).

### ✅ Phase 3: Pine Script and Pine Editor (done, 2026-10-15)
- **Pine interpreter (v5/v6 subset), in `src/pine/`:**
  - **Language structure:** an indentation- and line-break-based lexer and parser, `var`/`varip`, history with `[]`, and user functions that keep a separate state per call site.
  - **Control and data:** if/switch/for/while as expressions, tuples, methods and arrays.
  - **Library:** more than 150 functions in `ta.*`, `math.*`, `str.*`, `color.*` and `array.*`.
- **Outputs on the chart:**
  - `plot` with all styles, `plotshape`, `plotchar`, `plotarrow`, `hline` and `fill`
  - `bgcolor` and `barcolor`
  - `label`, `line` and `box`
  - `alertcondition`, `alert`, `log.*` and `input.*` (the inputs dialog is built automatically)
- **Strategy:** `strategy.entry/exit/close/order/cancel`, with a broker simulator: order fills on the next candle, intrabar path, pyramiding, commission, slippage and trailing stop.
- **Pine Editor:** CodeMirror with syntax highlighting, autocomplete and inline error display. Save, add to chart, and install and Export of `.pine` files. A library of 10 ready-made scripts, and an error and log console.
- **Strategy Tester (first version):** 14 metrics, an equity curve compared with Buy & Hold, and a list of trades.
- **Live execution:** the script re-runs on live candles at most once every 2 seconds.
- **Tests:** 57 tests; values match the reference indicators to 1e-9 precision.

**Completed in the leftovers round (2026-10-21):** `request.security` (another symbol or timeframe, no lookahead by default), `table.*`, `type`/`enum`/`import` (UDTs and libraries from installed scripts), full `plotcandle`/`plotbar`, and `matrix.*`/`map.*`.
**Completed (2026-10-29):**
- `request.security_lower_tf`: for each chart candle, returns an array of the lower-timeframe candle values. It works with tuples too.
- Other-symbol data is now live: after the first load, it streams.
- `security` and `import` also work inside the optimization worker. Their data is sent along with the job.
- A library can import another library. A circular import gives a clear error.

### ✅ Phase 3b: data for all markets and Expert Advisors
- ✅ **Data server (`server/`), on `127.0.0.1`, no API key:**
  - **Crypto:** CCXT for 103 exchanges; 77 with live WebSocket and the rest with polling. Spot, perpetual (`.P`) and futures.
  - **FX:** forex (68 currency pairs), metals, energy, indices, commodities and any stock, from Yahoo's public API. It is unofficial, for personal use only, and may be delayed.
  - **History and timeframes:** history pagination for exchanges that cap each request (such as OKX with 300 candles), and building timeframes the exchange lacks from smaller candles.
  - **Security:** reachable only through Vite's own proxy, and has no CORS. The Origin of WebSocket requests is checked.
- **Symbol search:** exchange selection and filtering by market type.
- **Dropped:** Dukascopy, because it is unreachable from the user's network (timeout and code 429).
- ✅ **Standalone MQL4/MQL5 compiler and runtime, without installing MT5 (`src/mql/`):**
  - **Compiler:** preprocessor (`#define` with macros, `#ifdef`, `#include` and `#property`), and translation of the whole language to JavaScript. Includes struct, class with inheritance and virtual, template, overload, reference parameters, static, enum, input/extern, and integer semantics.
  - **Standard library:** math, strings, StringFormat, time, arrays, time series, and more than 40 MQL4 indicators (`iMA`, `iRSI`, `iMACD` and others) and MQL5 ones (handles and `CopyBuffer`). Plus MovingAverages, the custom indicator API, chart objects and SymbolInfo/MarketInfo. None of them use future data.
  - **Trading:** an MT-style broker simulator (hedging and netting, pending orders, SL/TP, margin and stop-out), the MQL4 and MQL5 trading APIs, and the `CTrade`, `CPositionInfo`, `CSymbolInfo`, `CAccountInfo` classes and more.
  - **Execution:** Expert Advisors with an OHLC tick model without lookahead, indicators (`OnCalculate` or `start`) and scripts. Buffers and levels are drawn on the chart and the EA result appears in the Strategy Tester.
  - **Editor:** C++ syntax highlighting, installing several `.mq4`/`.mq5`/`.mqh` files at once, compiling with file:line:column errors, and an input dialog with enums.
  - **Tests:** all 105 tests of the whole project passed.
  - **Completed (2026-10-21):** `iCustom` (both MQL4 and MQL5 forms), file functions on a virtual file system, `OnTrade`/`OnTradeTransaction`, swap (with triple Wednesday), operator overloading, and iAD/iChaikin/iBWMFI/iGator.
  - **Completed (2026-10-29):** swap is set in the tester's Properties tab: long and short (points per lot per day) and the triple day.
  - **Limitations:** DLL and `#import` are not supported. MQL itself also lacks operator overloading outside a class, and `goto`.
- ✅ **NinjaScript (NinjaTrader 8), without installing NinjaTrader (`src/ninja/`):**
  - **C# to JavaScript compiler:** class, struct and enum, property and attribute (`[NinjaScriptProperty]`, `Range` and `Display`, which become inputs), inheritance, overload, `out`/`ref`, lambda, `List`/`Dictionary`, switch expression and pattern, string interpolation, and integer semantics.
  - **Runtime:** the `OnStateChange`/`OnBarUpdate` cycle, `Series` and plots, `AddLine`, `BackBrush`/`BarBrush`, 54 built-in NinjaTrader indicators, `Draw.*`, and `AddDataSeries`.
  - **Managed trading:** `Enter`/`Exit` of Market, Limit and Stop types, `SetStopLoss`/`ProfitTarget`/`TrailStop`, `EntriesPerDirection`, `Position` and `SystemPerformance`.
  - **Multi-file:** all `.cs` files compile together, and a strategy can call an indicator from another file.
  - **Tests:** all 139 tests of the whole project passed.
  - **Completed (2026-10-21):** LINQ, events and delegates, unmanaged orders (with OCO), `OnRender` (a fixed snapshot in drawing form), session template (a "Trading hours" input in every script), and `Calculate.OnEachTick`/`OnPriceChange` with the OHLC tick model.
  - **Completed (2026-10-29):**
    - `OnRender` runs over the visible bars with the chart's real pixels and redraws after zoom and scroll.
    - `PathGeometry` works with `DrawGeometry` and `FillGeometry`. Fill draws only the outline, because the drawing layer has no filled polygon.
    - Tick mode works for multi-series scripts: the main series is ticked and the extra series update when a candle closes.
- **Hard limitation:** compiled and locked `.ex4`/`.ex5` files and DLLs do not run. Decompiling them, and MT5 and NinjaTrader themselves, are not done.

### ✅ Phase 4: Strategy Report, backtest and live test (reports 02 and 05)
- ✅ **Strategy API:** built in phase 3 (`strategy.entry/exit/close/cancel`, capital, order size, pyramiding, commission, slippage, fill on the next candle).
- ✅ **Report (`src/tester/metrics.ts`):** all 53 official metrics in 5 groups, with All, Long and Short columns. It works for all three engines (Pine, MQL and NinjaScript), because the position at each candle is rebuilt from the list of trades.
  - Sharpe and Sortino are computed as in the TradingView docs, on monthly returns with a 2% risk-free rate.
  - **Approximate:** the margin metrics (margin call and liquid volume) are only reported, and the engines do not actually liquidate.
- ✅ **Strategy Tester tabs (`src/testerui.ts`):** Overview, Performance, List of trades (with cumulative P&L), Properties, and CSV export of the report and trades.
- ✅ ⭐ **Optimization (`src/tester/optimize.ts`)**, in a Web Worker so the UI does not freeze:
  - **Methods:** grid, random and genetic (tournament, crossover and mutation, with a fixed seed).
  - **Objective:** any of the 53 metrics, with a minimum number of trades.
  - **Result:** a heatmap of the first two parameters and a table of the top 100 results. One click on a row or heatmap cell applies the inputs to the chart.
- ✅ ⭐ **Walk-forward:** rolling or anchored window, optimization on each in-sample segment and running the winner on the next out-of-sample segment. A stitched OOS equity curve and the WF efficiency ratio.
- ✅ ⭐ **Monte Carlo:** shuffling the trade order or resampling (bootstrap), randomly dropping a percentage of trades, percentiles of final equity and max drawdown, and risk of ruin.
- ✅ **Forward test:** every new strategy fill on a live candle is sent to the paper account as a market order (with a volume multiplier). Trades from before the start are not repeated.
- ✅ ⭐ **Portfolio backtest (`src/tester/portfolio.ts`, Portfolio tab):** the same strategy with the same inputs and timeframe runs on several symbols and the capital is divided equally.
  - The results are merged on a shared timeline: whole-portfolio metrics, comparison with an equal-weight buy & hold, and a per-symbol table with each one's share of profit.
  - A symbol whose data does not arrive is dropped with an error message.
- ✅ ⭐ **No-code backtest (`src/tester/nocode.ts`, the "＋ No-code" button and the Pine Editor menu):**
  - **Conditions:** long and short entry and exit, each with several conditions joined by "all" or "any". Operands: price, volume, SMA/EMA/WMA, RSI, MACD, Bollinger Bands, Stochastic, VWAP and a constant. Comparisons: crosses above/below and is above/below.
  - **Other settings:** stop loss, take profit and trailing stop in percent, capital, order size and commission. The Mirror button inverts the long conditions for short (30 ↔ 70 for RSI and Stochastic).
  - **Output:** an ordinary Pine script is generated, so optimization, walk-forward and forward test work on it too. Generating again with the same name updates the same script.
- **Tests:** all 148 tests of the whole project passed.
- **Limitations:**
  - In the portfolio, margin and intrabar metrics are not computed, because the trades are at the prices of different symbols.
- ✅ **Completed in the leftovers round (2026-10-21):** date range selection for the report (all, 30 and 90 days, year to date, 365 days, custom), and the monthly returns, return distribution and streak tabs. From 2026-10-29 the date range also applies to these: optimization, WF and portfolio run only on candles inside the range, and Monte Carlo takes only the trades inside the range.

### ✅ Phase 5: server, login, sync, alerts and notifications (done, 2026-10-20)
This phase was built with 6 specialist agents at the same time. The contract between them is in `docs/phase5-contracts.md`.

- **Server core (`server/core/`):**
  - Node's built-in SQLite database.
  - Single-user login with a scrypt password, an HttpOnly cookie, and progressive lockout after 5 wrong attempts.
  - Secrets encrypted with AES-256-GCM. The key is in `server/data/secret.key` or `CT_SECRET_KEY`.
  - A router with CSRF checks, and a DNS rebinding guard that rejects unknown Hosts. The first password can be set only from this PC itself.
- **Multi-device sync:**
  - All data (layouts, drawings, scripts, paper account, journal, and photos and voice notes) lives on the server.
  - A login and setup page, one-time upload of the browser's data, and offline mode.
  - Account menu: sessions with per-device sign-out, password change, and sign-out.
  - The paper account is applied live when the server changes it.
- **Server-side alert engine (`server/alerts/`):**
  - **Sources:** price, indicator, drawing (horizontal line, trend line and channel), and script (alertcondition, alert()/Alert() and strategy orders). Scripts can be Pine, MQL or NinjaScript, and the server compiles the source itself.
  - **Conditions and repetition:** 13 conditions, 5 repeat modes, an expiry date, and automatic stop if it fires too often.
  - **Message and logging:** placeholders, and a delivery log for each channel.
- **Notifications (`server/notify/`):** popup and sound, Web Push, Telegram (chat selection with getUpdates), SMTP email and Webhook. Includes a queue and rate limit for each channel, a test button and a log.
- **Hybrid forward test:**
  - Pine, MQL and NinjaScript strategies run on live candles even with the browser closed, and the fills go to the paper account and the journal.
  - When this same strategy (same source, inputs, symbol and timeframe) is open on a chart, the browser runs it and sends the fills to the server. If nothing is heard from the browser for 15 seconds, the server continues on its own.
  - On the server side, all scripts (forward tests and alert scripts) run in one shared worker thread (`server/engine.ts`). If a run takes longer than 20 seconds, the worker is restarted.
  - **Security:** the server accepts only source and compiles it itself. JavaScript from the client is not accepted.
- **Trade recording:** selected symbols, 30 days, with automatic gap filling after an outage (Binance by trade ID, CCXT exchanges by time). The first footprint uses this recording.
- **HTTPS on the home network:**
  - A local CA, and a server certificate that renews automatically when the IP changes.
  - Download of `/ca.crt` and the iPhone profile (`/ca.mobileconfig`).
  - An installable PWA, a service worker for push, and the Persian guide `docs/lan-setup.md`.
- **User interface:**
  - A TradingView-style alert creation dialog, with entry from the Alert button, Alt+A, the chart menu, drawings and script legends.
  - An alerts panel with the delivery log.
  - The 🔔 "Server & notifications" setting.
  - Sharing links: "Copy link to image" in the Snapshot menu (public `/s/…` link), and "Share link" in the layouts dialog (`/?layout=…`), which opens a copy of the layout and its drawings. A list and deletion of links in the account menu, "Shared links…".
- **Tests:** 169 client tests and 44 server tests. After the leftovers round: 226 client tests and 51 server tests.
- **Leftovers round (2026-10-21):** 7 specialist agents worked at the same time (contract in `docs/leftovers-contracts.md`). The result of each is described in its own phase.
- **Moving to a VPS later:** the same code runs. Put the domain in `CT_ALLOWED_HOSTS` and put it behind real HTTPS (for example Caddy).
- **Known limitations:**
  - (fixed 2026-10-21) We now have several workers: at most 4, or `CT_ENGINE_WORKERS`. A stuck script restarts only its own worker.
  - (fixed 2026-10-29) The forward test fingerprint counts only files the script actually uses: `#include`, `iCustom` with a fixed name, and classes from other `.cs` files. If `iCustom` has a computed name, all files are counted.

### ✅ Phase 6: exchanges, testnet only (report 03), done 2026-10-28
This phase was built with 3 agents at the same time. The contract is in `docs/phase6-contracts.md` and `src/broker/types.ts`.
- **One layer for all accounts (`src/broker/`):** the paper account (`PaperBroker`) and the exchanges' testnet accounts (`RemoteBroker`). The order form, chart lines, DOM and trading panel all work on the "active account".
- **Server (`server/brokers/`):**
  - **Testnet only:** every exchange address, at construction and in every REST request and every WebSocket, is checked against the testnet allowlist. A mainnet address is rejected before sending. OKX is accepted only with the demo header, which CCXT itself sets. There is no path to mainnet.
  - **Keys:** stored only on the server, encrypted with AES-256-GCM (`server/core/secrets.ts`). They are never returned to the browser and never appear in logs or error messages, because `scrub()` strips them. Tested on a test server with a fake key.
  - **trade-guardian check before activating any account:** an account is activated only when all of these pass:
    - The address is a testnet.
    - The key works.
    - The key has no withdrawal permission. Bybit and OKX read this from the exchange itself, and for the others it comes from your confirmation.
    - A daily loss limit and a position size limit are set.
    - The mandatory stop loss is on.
    Loosening these settings returns the account to `pending`.
  - **Per-order controls:**
    - Daily loss limit (circuit breaker): the account is halted until 00:00 UTC and only reducing orders are accepted.
    - Position size limit, counting open same-direction orders too.
    - Mandatory stop loss: it cannot be removed.
    - These controls also run on order edits and at the moment simulated orders execute.
  - **Server-side simulation** for orders the exchange lacks. These orders survive a server restart:

    | Exchange | Native | Simulated |
    |---|---|---|
    | Binance spot testnet | market, limit, stop-limit | plain stop, trailing, OCO, both TP/SL legs |
    | Binance USDⓈ-M (demo trading) | market, limit, stop, stop-limit, SL | trailing, OCO, TP |
    | Bybit testnet | market, limit, stop, stop-limit, SL | trailing, OCO, TP |
    | OKX demo | market, limit, stop, stop-limit, SL | trailing, OCO, TP |
    | Nobitex testnet | market, limit, stop, stop-limit | trailing, OCO, both TP/SL legs |
  - **Binance USDⓈ-M:** works on Binance **demo trading**, because CCXT 4.5 rejects signed requests to the old futures testnet. Create the key from Demo Trading.
  - **KuCoin:** rejected, because it has no sandbox.
- **Client:**
  - **Paper account:** stop-limit, trailing stop and OCO.
  - **Order form:** account selection, all order types, TP/SL and reduce-only. Order size by unit, amount, percent of balance, or percent of risk down to the stop loss.
  - **Chart lines:** orders, TP, SL and position can be moved with the mouse. They are canceled or closed with ×.
  - **Accounts panel 🏦:** add a testnet account, 🛡 check with a pass or fail for each item, balance, positions, orders and fills. Account status arrives live on all devices.
  - **DOM:** trades on the active account. In Replay mode, orders go to the journal's backtest account.
- **Tests:** 240 client tests and 68 server tests. None needs a network.
- **Not tried live:** no network path has actually been run. These must be tried with your testnet key and a VPN:
  - Reading key permissions on Bybit and OKX.
  - Contract size and position mode on OKX.
  - The list of trigger orders.
  - The shape of Nobitex responses (written from the documentation).
  - The WebSocket on Binance demo trading.
- **Limitation fixes (2026-10-29):**
  - **Partial fill:** the part that was filled immediately gets its own SL and TP. This is respected when canceling an order, moving it (cancel and replace) and closing the position.
  - **Stop coverage:** each stop counts as covering only its own volume. Open same-direction entries that have no SL are counted too, and the legs of an OCO are counted once.
  - **SL cancel:** when a mandatory stop loss is on, a stop that covers the position cannot be canceled.
  - **Account halt:** open orders that add risk are canceled. If cancellation fails, it is retried every poll round. SL, TP, reduce-only orders and exits stay. An exit trigger that has grown larger than the position is sent at execution time clamped to the position size and reduce-only.
  - **Spot account value:** all coins in the account are counted (price once per minute). The start-of-day balance is recorded only when every coin has a price.
  - **Spot selling:** never sells more than the free coin.
  - **Execution order:** the poll and all order operations of one account run one after another (one lock per account), so there is no race between poll and moving an order.
  - **Nobitex:** requests time out after 15 seconds.
  - **trade-guardian review (2026-10-29):** the first round was FAIL, with one blocking item: a poll in the middle of moving an order removed the replacement SL. After the fix, the second round was PASS: "may be used with testnet keys". Six more minor items (N1 to N6) were also fixed and tested, but trade-guardian itself has not reviewed them again.
- **Remaining limitations:**
  - (medium) Simulated stops work only while the server is running. SL on Binance spot is always simulated.
  - (low) SL is sent about one poll round (about 2 seconds) after the order fills.
  - (low) Order operations now wait behind the account lock. If a request to the exchange is slow, execution of simulated stops is delayed too. Measure this on testnet.
  - (low) Futures counts value only in the base currency (USDT).
- **trade-guardian review verdict (2026-10-28):** "PASS — may be used with testnet keys". Three blocking items (removing SL by editing, bypassing the position limit, bypassing the daily loss limit with reduce-only in spot) and one regression (SL rejected in spot while the account is halted) were fixed and tested. After that, an account that returns to `pending` by loosening the rules was also locked down: monitoring and stops continue, the position is seen and can be closed, new risk is rejected, and removing SL is impossible. It also does not reactivate after a network error or restart without a new check. Last review: `b04d03b`. Note: if spot margin trading is ever added, `reduces()` in `server/brokers/risk.ts` must compare selling against the balance again.
- **Real money:** still forbidden. First a live trial on testnet, then another trade-guardian review for real money, and finally your explicit approval.

### 🟡 Phase 7: Iranian market ⭐ (reports 04 and 05), built 2026-11-04, not tried live
Guide: `docs/iran-market.md`. Initial plan: `docs/phase7-plan.md`. Code: `server/iran/`.
- ✅ **Nobitex (`nobitex`):** 1-minute to 1-day candles and built timeframes, Toman and Tether pairs, rial or toman unit detection, market list (with a built-in list when the source does not respond) and a ticker for the screener.
- ✅ **Domestic and foreign Tether:** a ready-made row in the `nobitex` search that fills in the expression `NOBITEX:USDTIRT/TGJU:USD-1`. Nobitex's daily candle is rounded to Tehran date so it lines up with tgju.
- ✅ **Gold, currency and coins (`tgju`):** free-market dollar, euro, pound, dirham, lira, 18- and 24-karat gold, mesghal, ounce, five types of coin. Daily and longer only.
- ✅ **Stock exchange and securities (`tse`):** stocks, funds, bonds (participation, ijara, sukuk, Akhza), rights, futures, options, commodities and three indices. Persian symbol or numeric code. Price adjustment for capital increases and dividends. Symbol type classification from the name (experimental). An "Iran bond yield" calculator in the Skills panel.
- ✅ **Week from Saturday and Jalali month** for tgju and tse. `aggregate()` gained an optional week-start parameter (default Monday, unchanged for the others).
- ✅ **Jalali calendar (`src/jalali.ts`):** exact date conversion. A day-by-day test from 1990 to 2060 matches the browser's calendar. The Calendar option in chart settings makes the time axis and crosshair Jalali.
- ✅ **Persian and right-to-left UI (`src/i18n.ts`):** an "فا / EN" button, about 400 strings, RTL panels and dialogs and an LTR chart. Tried in the browser. **The translation is not complete** (only exact strings in the dictionary).
- ✅ **Public server:** Iranian sources are off in `CT_MODE=public` unless `CT_IRAN_PUBLIC=1`.
- ✅ **`npm run check:ir`:** tries each source live, and with `--capture` saves the raw responses.
- **Tests:** 22 server tests for the sources (with reconstructed responses) and integration with `market.ts`, 6 bond tests, 3 calendar tests, 2 translation-dictionary tests.
- ⚠ **Not tried:** no Iranian endpoint was reachable from the build environment. The Nobitex candle and list path, the tgju table, and all TSETMC endpoints (market list, daily list, live price, index history and the code of the three indices) were written from second-hand descriptions. First run `npm run check:ir` from Iran.
- **Not done:** Codal (announcements and financial statements), intraday exchange candles (TSETMC does not provide them), Jalali month for Nobitex, full translation of all panels (settings, the alert dialog, the server panel, market tabs and the journal menu are done).

### ✅ Phase 8: derivatives and order flow ⭐ (reports 05 and 06)
- ✅ **Order flow and Level 2, done 2026-10-17 (`src/orderflow/`, the "▦ Order flow" button and the ≣ panel):**
  - **Data:**
    - **Binance:** directly from the browser. aggTrade trades, and a full local order book (a snapshot with 5000 levels plus the update stream, following Binance's official algorithm, with a resync if an update is missed).
    - **Other exchanges:** from the data server with CCXT; watchTrades and watchOrderBook, or polling if the exchange has no WebSocket.
    - **History:** the last 20 thousand trades, plus a "Load older trades" button.
  - **Footprint:** three modes, Bid × Ask, Delta and Volume profile, for each candle. Includes POC, 70% value area, diagonal imbalance with an adjustable ratio, stacked imbalance, and Δ and volume under each candle. Row height is automatic from the vertical zoom (about 14 pixels) or set manually.
  - **Big trades:** bubbles on the chart, with an automatic threshold (the top 0.5% of trades) or a manual one.
  - **Liquidity heatmap:** order book history, one column every 2 seconds and the last 3 hours.
  - **Panels:** a CVD panel as candles, and a per-candle delta panel.
  - **DOM / Level 2 panel:** a price ladder with ×1 to ×100 grouping, bid and ask volume, volume traded at each price, the user's own orders, spread and book imbalance. Clicking the ladder places a limit order on the paper account. Time & Sales with merging of trades from one order (Smart Tape) and a minimum value filter.
  - **Tests:** 4 model tests (footprint, CVD, imbalance, book history).
- ✅ **Completed in the leftovers round (2026-10-21):**
  - **Order flow (`src/orderflow/`):** TPO and volume profile for each session, Footprint and TPO as chart types, tick, Range, Reversal and Delta timeframes (`100T`, `R10`, `REV5`, `D500`), Cluster Search with alerts, Absorption, and tick Market Replay from trades recorded on the server (1x to 300x).
  - **Derivatives (`server/derivs.ts` and `src/derivs/`):** Open Interest (count and value), funding (history, current and predicted with a countdown), long/short ratio, a liquidation feed and bubbles, separate CVD for spot and perp, and a liquidation heatmap labeled "ESTIMATED". Binance Futures and OKX were tried live. Bybit is unreachable from this IP and shows a clear error.
- **Completed (2026-10-29):**
  - In server mode, tick timeframe history (100T, R10, REV5, D500) is built from the server's entire trade recording (up to 30 days and 20 thousand candles).
  - The TPO and volume profile session start is configurable, in UTC hours. For example 13:30 for the New York open and 20:30 for Tehran midnight.
  - Market Replay can go backward: with the ⏮ button or "Back 1/15 minutes". Replay restarts from the earlier point.
- **Limitations:**
  - Without server recording, tick timeframes are still built only from the trades loaded.
  - There is no history of liquidations, because exchanges have no public API for it.

### ✅ Phase 9: market data (report 04), done 2026-10-29
Only keyless sources are used (your decision). Server: `server/marketdata.ts`. Client: `src/market/` (the ▤ "Market" panel).
- **Watchlist:**
  - Sections with `###Name` rows, the same export format as TradingView. Importing a TradingView file now keeps the sections too.
  - Colored flags with 7 colors and sorting by flag, and an optional price-change column. All from the ⋯ menu.
  - A details panel ⓘ for each symbol: daily Technical Rating with 26 votes, Seasonals (monthly returns for each year and the average), and news for that symbol.
- **Screener:** any CCXT exchange (or Binance directly). Quote currency filter, minimum volume and search, sorting, a "Rate" button for the daily Technical Rating of the first 25 rows, and adding to the watchlist.
- **DEX:** pair search on DexScreener: price, 24-hour change, volume, liquidity and a link.
- **Heatmap and dominance:** a treemap of CoinGecko's top hundred coins (size by market cap, color by 24-hour change), plus `TOTAL`, `TOTAL2`, `TOTAL3`, `BTC.D`, `ETH.D` and `USDT.D`.
- **Movers:** top gainers, top losers and most traded USDT pairs on Binance (with a minimum volume of one million dollars).
- **Economic calendar:** ForexFactory with importance and currency filters. The "on charts" option shows events on all charts.
- **News:** RSS from CoinDesk, Cointelegraph, Decrypt and The Block, with a "this symbol only" filter.
- **Reliability:** all sources are cached on the server. If a source goes down, the latest version is shown.
- **Tests:** 4 analysis tests (rating, seasonals, movers, treemap) and 2 server tests (RSS and news). Also tried in the browser: all tabs loaded with live data.
- **Not done (they need keys):** FRED, financial reports and IPOs from Finnhub, and CryptoPanic. They will be added with a free key.
- **Limitations:**
  - `TOTAL` and `BTC.D` are only live numbers and have no historical chart. Their history is paid on CoinGecko.
  - DEX pairs do not open on the chart.
  - Technical Rating follows TradingView's published rules, but a few votes are simplified (Bull Bear Power, Ichimoku).

### ✅ Phase 10: journal and risk ⭐ (reports 05 and 06)
- ✅ **Trading journal (`src/journal.ts` and `src/journalui.ts`, the 📓 button in the side panel), done 2026-10-17:**
  - **Automatic logging:** every paper-account trade (manual, TP/SL bracket, or forward test) is turned into a complete trade from the fills: opening, adding to the position, partial exit, closing and position reversal. Earlier history is imported silently.
  - **Asking for the reason:** when a trade opens, it asks for the setup, entry reason, planned stop loss and target, feeling and confidence. When it closes: the exit type and reason, adherence to the plan, mistakes, feeling afterward, lesson learned and execution score. Both can be turned off in settings. Several questions in a row wait in a queue.
  - **Automatic calculation:** R-multiple, MAE and MFE (which ATAS lacks), and exit efficiency.
  - **Tabs:** Trades (incomplete trades are marked ⚠), Stats (16 metrics, a P&L curve, and a breakdown by setup, feeling, mistake, symbol, direction, weekday and hour), Calendar (daily P&L with a daily note), and Setups (playbooks with their stats).
  - **Other features:** filters for range, symbol, setup and result. A chart photo, jumping to the trade on the chart, CSV export, and JSON backup and restore.
- ✅ **Full journal workspace (`src/journal/`, the "⤢ Open" button in the journal panel), based on the My Journal review (report 07), done 2026-10-17:**
  - **Dashboard:**
    - Account and range filters (today, week, month, year, custom).
    - Cards: balance (with deposits and withdrawals), win rate, average R and PF.
    - Charts: an equity curve with a five-trade MA, and a profit and loss distribution.
    - Analysis by symbol, weekday, session, timeframe, entry and exit reasons, and setup.
    - A 12-month activity map in three modes: profit and loss, activity, and day quality.
    - Buy vs. sell, and a performance summary (recovery factor, Sharpe, absolute and relative drawdown, swap and consecutive records).
    - Risk distribution (less than 1% to more than 3%), checklist compliance, active stop loss, trades without a plan, and top sessions and symbols.
  - **Journals table:** search, sorting, grouping, column selection, pagination, CSV export, and **statement import** of MT4 and MT5 (HTML) or exchange CSV without duplicates.
  - **Entry form:**
    - **Modes:** a trade or a no-trade day.
    - **Required and optional information:** initial and final stop loss and target, manual R, commission, swap and risk percent.
    - **Reasons:** entry and exit reasons from editable lists, with notes and tips.
    - **Attachments:** a weighted checklist, photos (file, paste and chart photo) and voice (recording with the microphone), stored in IndexedDB. Also tags.
    - **Emotions:** up to 4 feelings before and 4 after the trade, energy, confidence in the setup, entry motivation, and custom yes-or-no questions.
    - **Crypto tab:** value, market, exchange, contract, leverage, margin, liquidation, funding and network fee.
    - **Custom fields** with any chosen type.
  - **Discipline path:**
    - **Score:** each journal entry has up to 80 points (7 items of 10 points each, plus a 10-point bonus), with a deadline of the end of the day. A no-trade day gets 80 points and 5 backtest trades get 20 points.
    - **Progress:** streaks with rest days, and Bronze to Diamond levels. No multiplayer league, because there is no server for it.
  - **Analytics:**
    - **Daily.**
    - **Psychology and behavior:** feeling, motivation, mistake, energy, tilt, revenge and overtrading.
    - **Time and efficiency:** hour, session, holding time and exit efficiency.
    - **Execution quality:** R histogram, planned vs. actual R, and checklist and risk effect.
    - **Professional:** Expectancy, SQN, Kelly and Monte Carlo.
  - **Tools:**
    - **Prop:** profit target, overall and daily drawdown (fixed or floating) and minimum trading days, with automatic monitoring.
    - **Economic calendar:** the weekly ForexFactory feed from the server.
    - **Forex session clock:** with DST.
    - **Resume:** PNG export and print.
    - **Account comparison.**
  - **Notes and accounts:** professional notes (search, pin and tags). Several accounts (manual and backtest) with deposits and withdrawals. A Jalali or Gregorian calendar, and management of all lists.
  - **Tests:** 5 analytics tests (dashboard, R, discipline, prop, and import from MT5, MT4 and CSV).
- ✅ **Completed in the leftovers round (2026-10-21):**
  - **Position size calculator:** the Long/Short position tool has these: account, risk (percent or amount), leverage, maintenance margin and lot step. It shows volume, margin, R:R and liquidation price (estimated, isolated), and a 📤 button sends a paper order with TP/SL.
  - **Trade replay:** a ▶ button beside each trade starts Bar Replay N candles before entry and has buttons to jump to entry and exit.
  - **Backtest from Replay:** orders placed in Replay mode fill on a separate simulated account at that candle's price and are recorded in a backtest account in the journal.
  - **Portfolio risk** (Journal → Tools → Portfolio risk): a correlation matrix, exposure for each asset and each quote currency, risk down to the stop loss, and a warning when several correlated positions in the same direction stack up.
- ✅ **Direct import from exchanges (2026-10-29):** fills of every connected exchange account (the phase 6 testnets and MT5 demo) are imported into the journal automatically. Each account has its own journal account, and fills are imported only once by their ID. Spot profit and loss is computed from the account's average entry. The first sync silently imports the fills the exchange still holds. From then on, open and close questions are asked as with the paper account.
- **Remaining:** import from a real account (mainnet) with a read-only key was not built, because it would open a path to mainnet for the first time. This is a security decision you must make first. AI (phase 12) and the Persian right-to-left UI (phase 7) also remain.

### 🟡 Phase 11: forex and stocks with MT5 (report 03), built 2026-10-29, not tried live
- **Python bridge (`mt5bridge/bridge.py`):**
  - Listens only on `127.0.0.1:8789` and calls the official `MetaTrader5` package.
  - Market data (symbols, candles, price) needs no token. Anything that reads or changes the account needs a token that the bridge prints at startup.
  - The Host of each request is checked, so a page in the browser cannot reach it through DNS rebinding.
  - **Demo only:** every trading request checks that MT5 is on a **demo** account with **netting**. Real accounts and hedging accounts are rejected.
  - Volumes are in units (lots × contract size), so the position limit compares real value. The symbol name is matched case-insensitively (such as `EURUSDm`).
- **Data:** the `mt5` exchange in symbol search. MT5 does not push prices to Python, so it is polled every 2 seconds. Timeframes MT5 lacks are built from smaller ones.
- **Trading:** the "MetaTrader 5 demo" account in the 🏦 panel, which takes the bridge token as the key. It goes through the same phase 6 layer with all the controls: the guardian check, position limit, daily loss limit and mandatory stop loss. stop and stop-limit are placed natively on MT5. Fills go to the journal too.
- **Tests:** an adapter test with a fake bridge (rejecting real and hedging accounts, and the token only in account requests). Plus 3 Python tests for the bridge itself with a fake MetaTrader5 module: rejecting real and hedging accounts, unit-to-lot conversion, and reduce-only being limited to the position. Run with `python -I mt5bridge/test_bridge.py`.
- **Not tried:** MT5 is not installed on this PC, so the bridge has not run, not even one real request. To try it: install MT5, log in with a netting demo account, `pip install MetaTrader5`, and then `python mt5bridge/bridge.py`.
- **Limitations:**
  - The MT5 account must be in dollars (USD).
  - Only symbols whose quote is USD are traded (EURUSD, XAUUSD, BTCUSD). The others, like USDJPY or indices, are rejected with a "No equity" or "Cannot tell the quote currency" error. This rejection is safe.
  - Symbols with `#` or special characters are not supported.
  - ~~the MT5 adapter has not yet had a trade-guardian review~~: reviewed (2026-11-04), with no blocking items. Verdict: "PASS for demo use through the app". Item N1 (volume rounding up, which bypassed the limit by up to about 67%) was fixed. What remains: the bridge itself does not enforce the stop loss, limit and circuit breaker, and enforces only demo and netting (acceptable on 127.0.0.1), and the stop loss is placed after the fill, as with the exchanges.
- **Status 2026-11-04:** the live test is waiting for a demo account (sign-up with an Iranian SMS is stuck). MT5 is installed.
- **Bridge hardening (2026-11-04):** the fill policy is chosen from the symbol itself (FOK, IOC or Return; before, it was always IOC and some brokers rejected it). A position or trade of a symbol the other terminal does not know no longer gives a 500 error. `mt5.shutdown()` is called on close. 2 new tests (5 Python tests).
- **Bridge security review (2026-11-04), no critical item; fixed:** an empty or incomplete token (a half-written file) is no longer accepted, `/account` requires a token, a `cross-site` request is rejected, a ten-second timeout for a silent connection, negative `content-length`, invalid `side` and `kind` (before, anything other than `buy` was a sell), volume above the symbol's limit is rejected instead of being silently reduced, the demo check again right before `order_send`, and a generic error message for a request without a token. 7 Python tests. Still not tried with a real MT5.

### ✅ Phase 12: artificial intelligence ⭐ (report 05), done 2026-11-04
- ✅ **Automatic analysis, without a language model (2026-10-29, `src/ai/`):** "Auto analysis" from the chart's right-click menu.
  - **Trend lines:** the latest rising support line and falling resistance line that have not been broken yet, with the number of touches.
  - **Support and resistance:** prices around which swings cluster, with at least two touches, strongest first.
  - **Patterns:** double top and bottom, head and shoulders and inverse head and shoulders (with a neckline), and ascending, descending and symmetrical triangles.
  - **Multi-timeframe overlay:** support and resistance of a higher timeframe (for example 1h → 4h → 1d) on this chart.
  - **Rules:** all tolerances are relative to ATR, so they work on any symbol and timeframe.
  - **Result:** ordinary drawings in an "Auto analysis" or "Higher-timeframe levels" group, so they can be moved or cleared. Running again replaces them.
  - **Tests:** 4 unit tests. Also tried on live BTCUSDT: two trend lines, the levels, a double top and bottom, and 6 daily levels.
- ✅ **Screener with a Persian or English sentence, without a language model (2026-10-30, `src/market/query.ts`):**
  - **Fixed grammar:** "field operator value", with "and" or "or". Examples: "RSI below 30 and volume above 1 million", "price above average 200", "change between 2 and 8 percent", "strong buy rating", `price above ema20 and change > 3%`.
  - **Normalization:** Persian and Arabic digits, Arabic ی and ک, ٪ and half-spaces.
  - **Transparency:** the condition that was understood is always shown. An unknown word gives an error and is never silently dropped.
  - **Daily data:** RSI, SMA/EMA (any period) and the technical score for at most 60 high-volume symbols, 6 at a time.
  - **Tests:** 3 tests, including ten sample sentences. Also tried live on Binance and the numbers matched a manual calculation.
- ✅ **🤖 panel with a local model (2026-11-04, `server/llm.ts`, `src/ai/`):**
  - **Chat:** with LM Studio or Ollama through an OpenAI-compatible API. The server is accepted only on this same computer (loopback), with fixed ports (11434 for Ollama, 1234 to 1239 for LM Studio or the `CT_LLM_URL` port) and the `/v1` path. The model server's error text is not returned to the user.
  - **Context:** the active chart (the app computes the numbers, not the model), and the journal for "Review my trades".
  - **Write Pine:** the model's code is compiled and run on the chart bars by the app's own Pine engine. If it has an error, the error is returned to the model and it is asked again.
  - **Live trial with LM Studio (nemotron-3-nano-4b):** chat and "Explain this chart" answered. "Write Pine" produced code after 2 replies that compiled and ran. The no-model mode also shows an installation guide message.
  - **A bug found in the live trial:** chat went to Ollama's default port instead of the discovered server (port 1235). Fixed.
- ✅ **Machine learning without a language model, with Python (2026-11-04, `ml/engine.py`, `server/ml.ts`):** only `numpy`, `pandas` and `scikit-learn`; install with `pip install -r ml/requirements.txt`. The server runs this file with a JSON on stdin (`CT_PYTHON` selects the interpreter). Three buttons in the panel:
  - **Regime:** market regime (up, down, range) with KMeans on trend, volatility and candle range, with each regime's share and the latest phases.
  - **Patterns:** candlestick patterns (doji, hammer, shooting star, engulfing, morning/evening star, three soldiers and three crows, inside bar) with their historical success rate on the same chart. Plus 10 past price windows similar to now (nearest neighbours) and what happened after them.
  - **Journal stats:** winners and losers by setup, mistake, weekday and hour, the effect of a previous loss, and a simple decision tree.
  - **Tests:** `python ml/test_engine.py` and `server/ml.test.ts`. Tried on the live BTCUSDT chart.
  - **Limitations:** the regime label is statistical, not a prediction. The journal was not tried with real trades (only fake data). Not run on Mac and Linux.
  - **Security:** two automated-review findings about SSRF in the model proxy were fixed.

### 🟡 Phase 13: desktop app (`docs/desktop-shell-spec.md`, guide: `docs/desktop.md`)
- ✅ **Windows, Mac and Linux installers (2026-10-28, `desktop/` folder):**
  - Electron 45 with built-in Node 24. The server runs inside the app on a free port of `127.0.0.1` and data is stored in the user's data folder.
  - Single instance. Closing the app shuts the server down cleanly.
  - External links open in the system browser.
  - **Outputs:** NSIS for Windows (built and tried on this PC), dmg for Mac (x64 and arm64, with an ad-hoc signature), and AppImage and deb for Linux. Each OS's installer is built on that OS with `npm run dist:<os>`.
  - **Tried on the packaged Windows version:**
    - Startup and login, the chart and WebSocket, and a forward test in the app's worker. These were tried through that same in-app server.
    - `prompt()` in the Electron window itself, through CDP: Electron does not have this function and `desktop/preload.cjs` replaces it with an input dialog.
    - Clean shutdown, data persisting after running again, and a fixed port between runs (to keep local settings).
    - Menus and buttons in the window itself were not tried with the mouse.
  - **Limitations:**
    - The installers are unsigned. How to get past the SmartScreen and Gatekeeper warning is written in the guide.
    - (fixed 2026-10-29) Closing the window leaves the app in the tray and alerts continue.
    - Web Push does not work.
    - The Mac and Linux installers were not built here.
- ✅ **Completed (2026-10-29):**
  - **System tray icon:** closing the window keeps the app in the tray, so the server, alerts, forward tests and trade recording continue. This fixes the previous limitation. The tray menu has: Open, "New window", toggle staying in the tray, "Start with Windows" (starts hidden in the tray), "Check for updates" and Quit.
  - **System notifications:** the app is registered in Windows under its own name (AppUserModelID). The page is not throttled in the background, so alerts also arrive as Windows notifications while the window is hidden. Clicking the notification opens the window.
  - **Multiple windows:** "New window" opens from the tray. prompt works in every window.
  - **Color-group sync between windows:** a symbol selected in a color group changes that group's charts in other windows and tabs too (BroadcastChannel).
  - **Auto-update:** with `electron-updater`, the code is ready. It checks ten seconds after start and notifies after the download. **No release source has been set yet** (`build.publish`), so for now it does nothing.
  - **Tried:** the development version with separate data started hidden in the tray, its server responded and it shut down cleanly. The tray menu and notification were not tried with the mouse.
- **Remaining:**
  - Tabs inside one window and detaching a tab. For now a separate window replaces it.
  - Update source: the GitHub repository is waiting for your decision.

### ✅ Phase 14: in-app trading skills, without a language model (from 2026-10-30, `src/skills/`), completed 2026-11-03
The installed trading-skills and trader-skills appear in the 🧰 "Skills" panel. Each skill uses the app's own data, not FMP. Their rules and scoring were rewritten in TypeScript from their descriptions, and wherever a skill had tests or runnable code, it was compared against the same numbers (golden tests). The outputs are only suggestions and no order is placed.
- **Framework:** each skill is an object (inputs and a `run` function) and a shared renderer draws the form and result.
- ✅ **Category A, done:**
  - **Position sizing:** position-sizer (fixed fraction, ATR, half-Kelly, position cap and sector cap) and futures-position-sizer (23 contracts with multiplier and tick).
  - **Portfolio:** trader-risk (order checks), trader-budget and trader-rebalance.
  - **Journal:** drawdown-circuit-breaker, pre-trade-discipline-gate, weekly-performance-digest and trade-performance-coach.
  - **Options:** options-strategy-advisor (Black-Scholes, Greeks and 10 strategies).
  - **Comparison with the original:** position-sizer, trader-budget and futures-position-sizer match the original skill's numbers. Black-Scholes matches to 6 decimal places with an independent `erf` implementation.
  - **Rest of category A (2026-10-30):**
    - **trader-tax (US rules):** lots are built from the paper account's fills. FIFO, highest cost first, custom lot, wash sale and tax-loss harvesting.
    - **breakout-trade-planner:** entry, stop loss and target, size by pattern score, and portfolio heat.
    - **contrarian-setup-gate:** Shapiro's three-stage state machine.
    - **residual-edge-analyzer:** OLS with Newey–West error, on the journal's daily returns or any custom series.
    - All four match the original skills' numbers.
    - **trader-memory-core** was not built separately, because the app's journal does the same job: idea through trade close, reasons, lessons and post-trade analysis.
- 🟡 **Category B, started:**
  - **crypto-regime-analyzer:** six components with the original weights. The dominance component activates after 31 days, because the server now records BTC dominance once a day.
  - **market-breadth-analyzer:** TraderMonty's public CSV, with a cache on the server.
  - Both match the original calculators on the same data: 9 crypto component scores, and six points of breadth history from "Critical" to "Healthy".
  - **Added on 2026-11-03:**
    - **uptrend-analyzer and sector-analyst:** the public Uptrend Ratio dashboard, including sector ranking and the economic cycle phase.
    - **ftd-detector:** follow-through day on the S&P 500 and Nasdaq, with a quality score.
    - **ibd-distribution-day-monitor:** distribution days on QQQ and SPY, with an exposure policy for TQQQ and QQQ.
    - All four match the original code: uptrend at four points of history, FTD in all 9 combinations, and distribution days in six histories. They were also run on live data.
  - **Rest of category B (2026-11-03), category B completed:**
    - **market-top-detector:** a 0 to 100 top-risk score for the next 2 to 8 weeks, from six components: distribution days, leading-ETF health, rotation into defensive sectors, breadth divergence, index technicals and sentiment (VIX and the VIX/VIX3M term structure). 200- and 50-day breadth comes from TraderMonty's public CSV. put/call and margin debt are optional inputs.
    - **macro-regime-detector:** a 1 to 2 year structural regime from six monthly ratios (RSP/SPY, 10Y−2Y, HYG/LQD, IWM/SPY, SPY/TLT with the stock-bond correlation, XLY/XLP). It returns one of five regimes: Concentration, Broadening, Contraction, Inflationary or Transitional. 10- and 2-year yields come from FRED's public CSV (`/api/treasury`).
    - **downtrend-duration-analyzer:** the duration of corrections from peak to trough in the largest US stocks, by sector and company size, with median and percentiles.
    - **exposure-coach:** combines all the regime skills into one status: the exposure ceiling, one of NEW ENTRY, REDUCE ONLY or CASH PRIORITY, growth or value direction, and breadth of participation.
    - **stanley-druckenmiller-investment:** conviction from 0 to 100, the Druckenmiller pattern and a target mix of stocks, bonds, alternatives and cash, plus a position size cap.
    - **US stock universe (`/api/us-stocks`):** all listed stocks with sector, industry, market cap, price and volume, from Nasdaq's public screener without a key. The foundation of the stock skills.
    - **Comparison with the original:** all five match the original code. market-top on 12 fake markets, macro on 16 markets and 300 direction combinations, downtrend on 10 paths, exposure on 400 input combinations and druckenmiller on 400 signal combinations. Rounding is now exactly like Python's `round()`. They were also run on live data and each took about 2 seconds.
    - **Limitations:**
      - Themes and institutional flow still have no in-app source, so they count as "missing" in exposure-coach and druckenmiller.
      - Daily history is about 4 years, not 5.
      - Yahoo prices are adjusted only for splits, not for cash dividends.
- ✅ **Category C, price scanners (2026-11-03):** all run on the US stock universe, meaning the largest companies from the Nasdaq list, or symbols you provide.
  - **vcp-screener:** Minervini's VCP pattern. Includes the trend template, ranked relative strength among candidates, zigzag contractions with ATR, volume dry-up, distance to the pivot, and an execution state that sets the rank cap.
  - **stockbee-momentum-burst-screener:** a four-percent breakout, a dollar breakout and range expansion out of a tight base.
  - **stockbee-exhaustion-hammer-screener:** an exhaustion hammer after a pullback in leading stocks, for buying near the close.
  - **stockbee-20pct-study:** stocks with a 20 percent move in 5 sessions. Includes the pattern, close quality, extension risk and scores, backfill over past sessions, the result 1 to 20 days later, and cohorts with candidate rules.
  - **stockbee-episodic-pivot-analyzer:** Episodic Pivot. You provide the catalyst events, or stocks that gapped or rose 4% or more today are scanned.
  - **stockbee-setup-fluency-trainer:** the model book. The momentum burst scan is re-run over past sessions, with 3- and 5-day results and cohorts by rank, trigger and tag.
  - **parabolic-short-trade-planner:** phase 1 (a five-component score and an A to D grade) and phase 2 (ORL, first red and VWAP fail plans, fixed-fractional sizing, and SSR and borrow checks). Phase 3, live trigger monitoring, was not built because it needs the broker's 5-minute feed and the stock's borrow availability.
  - **pair-trade-screener:** cointegrated pairs. The ADF test is implemented exactly like `adfuller` in statsmodels: lag selection by AIC, p-value and MacKinnon critical values. Plus the half-life with AR(1) and a ninety-day z-score.
  - **finviz-screener:** converts a request into a FinViz screener link using words from the skill's own reference table (more than 600 filters), plus a few Persian terms. A skill's result can now have an https link.
  - **Comparison with the original:** all match the original Python code on fake data. For pair-trade, statsmodels itself is the benchmark and the difference is about 1e-9. All were also run on live data and each took 1 to 7 seconds.
  - **Limitations:**
    - News catalysts and earnings dates have no source. 20pct and parabolic treat them as "unknown".
    - The number of institutional holders is unavailable, so exhaustion-hammer never gives that score.
    - The backfills run on today's stock universe, so they have survivorship bias.
- ✅ **Category D, fundamentals (2026-11-03):** the data source is keyless. Financial statements come from XBRL in SEC EDGAR, the dates and times of reports from item 2.02 8-Ks, fund portfolios from 13F-HR, and cash dividends from Yahoo.
  - **Server:** SEC (`/api/sec/*`) with a polite gap between requests, a cache and strict path validation. If you want the SEC to know who you are, put your name and email in `CT_SEC_USER_AGENT`. Without it, a generic app identifier is sent. Plus `/api/dividends` and congressional reports (`/api/ptr/*`).
  - **trader-analyst:** revenue, margins, net income and quarterly EPS compared with the prior year, TTM, and "what changed".
  - **canslim-screener:** seven components and the phase 3 thresholds.
  - **earnings-trade-analyzer and pead-screener:** the reaction to the earnings report and the drift after it.
  - **earnings-calendar:** dates are estimates: the last report plus the company's usual interval.
  - **dividend-growth-pullback and value-dividend.**
  - **kanchi-dividend-sop, kanchi-dividend-review-monitor and kanchi-dividend-us-tax-accounting.**
  - **trader-copycat:** portfolio, changes and copy weights from 13F.
  - **institutional-flow-tracker:** over a panel of well-known funds plus CIKs you add yourself, not all institutions. Thresholds are scaled down for the smaller panel.
  - **trader-pelosi:** the annual list and PTRs of the House of Representatives, read with `pdftotext -layout`.
  - **Comparison with the original:** all match the original Python code. analyst was tested on the real facts of Apple, Coca-Cola, JPMorgan, Microsoft and NVIDIA. copycat on the real 13Fs of Berkshire and Pershing Square. pelosi on the real 2026 list and PTRs. All were also run on live data.
  - **Limitations:**
    - CANSLIM: institutional ownership (I) has no free data. As in the original, it counts as zero unless you enter the institutional ownership percentage yourself. FinViz blocks automated requests and bypassing that was not built.
    - Kanchi: without adjusted EPS and without an event check from the primary source, it stays at HOLD-REVIEW as in the original.
    - P/E, P/B and ROE are computed from the latest 10-K and today's price, not from FMP.
    - Total debt and FCF are estimated from XBRL tags.
    - If `pdftotext` is not installed, PTR gives only the PDF link. Scanned PDFs are not read.
  - **Not built:** us-undervalued-growth-screener. Without analysts' forecast EPS (FY1 and analyst count, which is paid data), this skill does not even admit a single stock for review, and its last step is a language model's evaluation of SEC documents.
- **Set aside (at your request, for a future local model):** skills that are inherently a language model's job, and trader-broker. Also manifoldbt (an external Rust engine) and mt5-robot-tester (needs MT5).
- **License:** no LICENSE file was found in the skills folder. No code was copied and the rules were rewritten from the descriptions.

### 🟡 Phase 15: multi-platform and multi-server (2026-11-04, plan: `docs/research/multiuser-design.md`)
- ✅ **Lightweight Windows and Linux launcher (`lite/`, guide: `docs/lite.md`):** a Node server in the background and a system Edge/Chrome/Chromium window (app mode). A 45 MB Windows zip and a Linux tar.gz. **With the window open, about 581 MB of RAM, slightly more than Electron (about 497)**; the server alone (window closed) about 65 MB. The Linux scripts were only syntax-checked and not run. The launcher uses the `sha256(token, nonce)` protocol to make sure the process on the saved port is its own server.
- ✅ **Headless server on the home network (`docs/headless-server.md`, `docs/android.md`):** `CT_LAN=1` or `--lan` turns on LAN access without a graphical interface and prints an address and QR. The first password only from localhost. A connection from a non-private address is rejected.
- ✅ **Android:** two ways. A PWA (Chrome "Install app", with web push) and a client APK (`android/`, `docs/android-apk.md`): a plain WebView, internet permission only, about 13 KB, and it asks for the server address. The release version accepts only system CAs. **Not tested on a real phone.**
- ✅ **Resource usage (`docs/performance.md`):** the server's idle RAM went from 187 to about 95 MB (ccxt, web-push and nodemailer are lazy, and the recorder has no one-second timer).
- ✅ **Multi-user public mode (`CT_MODE=public`, steps 0 to 4 of the plan):** sign-up with an invite code, a separate SQLite database for each user, per-user alerts and push, quotas, CSRF and Host checks. Trading, exchange keys, the script engine, ML, language model, MT5, LAN and the recorder are not loaded at all in this mode, and if an exchange key is on that server, the server does not start. Private mode is exactly as before.
- ✅ **Security reviews (4 independent reviews + an automated reviewer):** fixed: reuse of a deleted user's ID (data leak), hijacking of the push endpoint and push on a shared browser, password confirmation without a retry limit, DoS with a large and slow body, bypassing the login limit with IPv6 and concurrent requests, a WebSocket memory leak, and feed caps. Plus CSP for the page, Electron hardening, and `undici` and `vite` updated (`npm audit` zero).
- ✅ **Broker race conditions (testnet only):** a poll inside the lock after every change, `close()` keeps protection until the exit succeeds, a deterministic order ID and a lookup before retrying, a legging marker for crashes, replacing a stop with "place first, then remove", and a transaction for forward test. Syncing two devices with `If-Match` and 409.
- ✅ **Login, sign-up and server selection (steps 7 and 8 of the plan, 2026-11-05):** a login, sign-up and recovery page with one-time codes, a sync server and a separate trading server, a device token (Bearer) and CORS with an origin list, and hiding the trading and AI sections on the public server (`docs/multi-server.md`).
- ✅ **Serverless standalone mode (2026-11-05):** when `/api` does not respond, the app considers itself standalone. The chart, Pine/MQL/Ninja, journal, paper trading, replay and backtest work in the browser and data stays on the device. Server-side parts are disabled with an explanation and the background probe becomes much less frequent. **Android:** the `standalone` APK (884 KB) serves the `dist/` files from `https://appassets.androidplatform.net`, with no extra library and only the internet permission. **Tested on BlueStacks (Android 7.1.1):** live chart, watchlist, indicator, touch, settings persisting after closing, and Back. (BlueStacks' own DNS was broken and was fixed in the emulator's Wi-Fi settings; it was not the app.)
- ✅ **Packages (`dist-release/`, not in git):** the Windows Electron installer (133 MB, installed and run on this same PC; 5 processes, about 428 MB RAM), the Windows lightweight launcher (47 MB zip), the Linux and Raspberry Pi package (6.7 MB tar.gz), and two APKs.
- **Docker (`Dockerfile`, `docker-compose.yml`, `docker-compose.public.yml`, `Caddyfile`, `docs/docker.md`):** written for amd64 and arm64 (Raspberry Pi), **but not built or run**, because Docker is not on this PC.
- **Remaining:**
  - Actually running the Docker package on a Raspberry Pi (the files are written).
  - The Google and Apple login return inside the APK/Electron (the login itself is in `server/oauth.ts` and `src/oauth.ts`; the `oauth-return.html` page and the `CTApp/` extension are not there yet).
  - Testing on a Linux laptop, a real phone and behind a real TLS proxy.
  - A semgrep scan and a client-side XSS check (158 `innerHTML` sites have not been reviewed line by line).
  - Merging 409 with field-by-field merging (for now "the server wins").
  - "Serverless": its meaning has not been determined yet.

### ✅ Phase 16: competitor gaps (2026-11-04, details and limitations: `docs/competitor-gaps.md`)
- ✅ **Repaint check** for Pine (`src/pine/repaint.ts`), multi-stage **Exit plan** for the paper account (`src/exits.ts`), **Diagnostics** (`src/diagnostics.ts`), order flow **Quick start** (`src/orderflow/presets.ts`), `npm run bench` and `npm run audit:html`.
- ⚠ **Exit plan on testnet accounts** and a signed installer were not done. The XSS audit has fully read only the free-text paths.

## Set aside, for now
copy trading (legal risk), a full options tool, paid on-chain data (payment from Iran is a problem), a social network (Ideas and Streams), and Reuters and Dow Jones news (they need a license).

## Unconfirmed items
Each report marked its unconfirmed items with ⚠️ or (?). The most important:
- Nobitex's WebSocket endpoints.
- The alert limits of TradingView's free plan.
- The exact Sharpe and Sortino formulas in TradingView.
- The free-tier limits of Finnhub and CoinMarketCap.
