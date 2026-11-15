[English](05-beyond-tradingview.en.md) · [فارسی](05-beyond-tradingview.md)

# 05 — Beyond TradingView: Features Competitors Have That TradingView Lacks (or Does Poorly)

> Research date: 2026-10-13 · Scope: web analysis/trading terminal, crypto first (Binance / Bybit / OKX / KuCoin / Nobitex), forex later via MT5, user based in Iran.
>
> Method: web search plus reading official documentation and independent reviews. No code or long passages were copied from competitors; only behavior and functionality are described. Some sources are the marketing pages of the vendors themselves or of their rivals; wherever a claim comes from a single non-independent source, it is marked (?).

## Summary of TradingView's position (documented weaknesses)

- **Footprint:** Since 2026 Pine has had a `request.footprint()` function, but only for Premium/Ultimate plans, with little historical depth far back; community scripts also hit Pine's cap of 500 boxes/labels and for most symbols only produce an approximation of bid/ask. [S9][S10]
- **Order book heatmap, historical DOM, iceberg:** Not available. [S5][S6]
- **Backtest:** Single-symbol backtesting; no portfolio backtest, no built-in walk-forward/Monte Carlo/genetic optimization; Bar Replay is bar-by-bar rather than tick-by-tick; a limit of 40 `request.security` calls for multi-symbol scanning. [S11]
- **Derivatives/on-chain data:** No native liquidation map, cross-exchange aggregated OI, funding, long/short ratio, or on-chain metrics (only via scripts/third-party data).
- **Journal, risk tools, execution bots (grid/DCA):** Not available; automation only through webhooks and external tools (3Commas, etc.). [S17][S24]
- **Iranian market:** No Toman pairs on Nobitex, no TSETMC, no gold/coin prices, no Jalali calendar, and no RTL interface.

---

## 1) Order Flow and Market Microstructure

| Feature | Who offers it | Why valuable | Data needed | Complexity S/M/L | Priority |
|---|---|---|---|---|---|
| Footprint / Cluster chart (bid×ask, delta, volume, imbalance modes) | ATAS, Exocharts, Sierra Chart (Numbers Bars), Bookmap (add-on) | Shows who was aggressive at each price level inside every candle; limited and paid in TradingView | Tick-by-tick trades with aggressor side (exchange `aggTrade`/`trades` WebSocket) + historical storage | L | High |
| Stacked imbalance (3+ consecutive imbalanced levels) | ATAS, Exocharts | Noise filter; ATAS itself warns that a lone imbalance is not a signal | Same footprint data | S (after footprint) | High |
| CVD (Cumulative Volume Delta) + CVD/price divergence; separate CVD for spot and perp | Bookmap, ATAS, Exocharts | Detects whether a price move has real participation; spot vs perp comparison is very widely used in crypto | Tick trades with aggressor side | M | High |
| Order book liquidity heatmap (depth history over time) | Bookmap, ATAS (free on all plans), Sierra Chart (Market Depth Historical Graph) | Shows order walls and their movement/cancellation before price arrives; TradingView does not have it | Continuous L2 depth snapshots/diffs (`depth@100ms`), compressed storage | L | High |
| DOM ladder (price ladder with bid/ask and traded volume) + one-click order placement | ATAS, Sierra Chart, Exocharts Desktop Pro | Scalping and precise order management | Live L2 + trading API | M | Medium |
| Iceberg / absorption detector | Bookmap (3 algorithms; higher accuracy with MBO data) | Reveals large hidden orders and absorption points; inherently an estimate | Trades + L2 simultaneously (crypto has no MBO, so lower accuracy) | L | Low |
| Large-trade bubbles / trade-size filter | Bookmap, Exocharts (trade-size clustering) | See whale entries on the chart | Tick trades | S | Medium |
| Time & Sales (tape) with size filter | ATAS, Exocharts, Sierra | Real-time context | Tick trades | S | Medium |
| Tick-level Market Replay (not just bar) | ATAS, Sierra Chart | Realistic practice and manual backtesting; Bar Replay in TradingView is bar-by-bar only | Tick and depth archive | L | Medium |

## 2) Volume Profile / Market Profile (TPO)

| Feature | Who offers it | Why valuable | Data needed | Complexity S/M/L | Priority |
|---|---|---|---|---|---|
| Full TPO / Market Profile (Value Area, POC, Initial Balance, single prints, split/merge) | Sierra Chart, Exocharts, ATAS | Auction structure analysis; weak in TradingView | Fine-grained OHLCV (1m, or 30m for TPO letters) | M | High |
| Composite / dynamic / session volume profile with naked POC | Exocharts, ATAS, Sierra | Volume-based support/resistance levels across multiple days | Volume-at-price from trades (or an estimate from 1m) | M | High |
| Raindrop chart (candle with volume-at-price shape, two halves split by VWAP) | TrendSpider (proprietary) | Combines candle + volume profile in one glyph; distinctive | Volume-at-price for each candle | M | Medium |
| Delta profile / profile of volume by trade count | ATAS (heatmap with volume/trades/delta modes) | Faster view of the dominant side at each level | Tick trades | S | Medium |

## 3) Crypto Derivatives Data (Coinglass-style)

| Feature | Who offers it | Why valuable | Data needed | Complexity S/M/L | Priority |
|---|---|---|---|---|---|
| Cross-exchange aggregated Open Interest as an indicator below the chart | Coinglass, Exocharts | Distinguishes moves driven by new positions from those driven by position closures | Public REST OI from Binance/Bybit/OKX (free) | S | High |
| Funding rate (current, predicted, historical, cross-exchange comparison) | Coinglass | Long/short crowding; a source of funding arbitrage | Public exchange REST | S | High |
| Long/Short ratio (accounts, top traders) | Coinglass | Positioning sentiment | Public REST from Binance/Bybit/OKX | S | Medium |
| Liquidation feed + liquidation bubbles on the chart | Coinglass, Exocharts | Capitulation and squeeze points | `forceOrder` WebSocket (Binance) and equivalents (Binance sends only the largest one per second, so it is incomplete) | S | High |
| Liquidation heatmap / map (estimated liquidation levels) | Coinglass (paid) | A price "magnet"; Coinglass's most visited tool | Model based on OI + assumed leverage distribution; explicitly **an estimate**, and more reliable for BTC/ETH | M | High |
| Futures-to-spot basis / premium and term structure | Coinglass, Laevitas/Velo (?) | Sentiment and cash-and-carry opportunity | Spot, perp, and quarterly prices | S | Medium |
| Options: OI by strike, max pain, IV smile, put/call | Coinglass, Deribit tools | Serious view of large players' positioning | Public Deribit / OKX / Bybit options API | M | Low |
| Bitcoin ETF flows, token unlocks | Coinglass | Macro supply/demand events | External source/scrape | S | Low |

## 4) On-chain and Sentiment

| Feature | Who offers it | Why valuable | Data needed | Complexity S/M/L | Priority |
|---|---|---|---|---|---|
| Exchange netflow (coins moving in/out of exchanges), stablecoin netflow | Glassnode, CryptoQuant | Potential selling/buying pressure | Paid Glassnode/CryptoQuant API (they own the address labels) | M (integration) | Medium |
| MVRV, SOPR (aSOPR, STH/LTH), Realized cap | Glassnode, CryptoQuant | Identifies cycle phases; a tool for medium-term analysts | Paid API | S (integration) | Medium |
| Social volume / weighted sentiment / dev activity | Santiment | Spikes in discussion are often a sign of a local top in altcoins (Santiment's own claim) | Santiment API (paid) | S (integration) | Low |
| Fear & Greed, Altcoin Season Index, market RSI heatmap | Coinglass, Alternative.me | At-a-glance summary of market state | Computable from prices | S | Medium |

> Note for Iran: Most of these APIs are paid, and payment/registration from Iran may be problematic; prioritize metrics that can be computed from exchange data (OI, funding, RSI heatmap).

## 5) Automated Analysis and AI

| Feature | Who offers it | Why valuable | Data needed | Complexity S/M/L | Priority |
|---|---|---|---|---|---|
| Auto trendlines / auto S&R / auto Fibonacci | TrendSpider (core of the product) | Saves time and removes subjective bias in drawing | OHLCV | M | High |
| Multi-timeframe overlay (e.g., daily SMA on a 15-minute chart, no coding) | TrendSpider | Requires Pine in TradingView | Multi-timeframe OHLCV | S | High |
| Automatic chart and candlestick pattern detection + market scan for them | TrendSpider | Fast idea discovery | OHLCV | M | Medium |
| Natural-language scanner (user writes "coins with daily RSI below 30 and volume 2x the average") | TrendSpider Sidekick | Lowers the entry barrier; turns text into scanner conditions | LLM + internal scanner engine | M | High |
| AI assistant on the chart (symbol status summary, indicator explanation, alert creation) | TrendSpider Sidekick, PionexGPT (Pine generation) | Distinctive user experience | LLM + access to chart data | M | Medium |
| AI Strategy Lab (training an ML model on user data) | TrendSpider | Advanced research | Historical data + ML infrastructure | L | Low |

## 6) Backtesting, Optimization, and Validation

| Feature | Who offers it | Why valuable | Data needed | Complexity S/M/L | Priority |
|---|---|---|---|---|---|
| No-code backtest (rule builder) and one-click conversion of a backtest into a bot/alert | TrendSpider, Option Alpha | Non-programmer users | OHLCV | M | High |
| Portfolio / multi-symbol backtest with shared capital | QuantConnect, Backtrader, Freqtrade | TradingView is single-symbol only; more realism | Multi-symbol OHLCV | M | Medium |
| Parameter optimization (full grid or genetic) + parameter heatmap | MT5 Strategy Tester (complete / fast genetic, multi-core and cloud execution), Freqtrade hyperopt | Finds a stable parameter region rather than a single overfit point | OHLCV; runs in a server-side worker | M | Medium |
| Walk-forward / forward test (out-of-sample) | MT5 (forward), QuantConnect (walk-forward docs) | Counters overfitting; optimal parameters depend on the training window | Same | M | High |
| Monte Carlo on trade order (drawdown distribution, risk of ruin) | Standalone tools; QuantConnect does not have it built in | Realistic view of the worst case | Backtest trade list | S | Medium |
| Lookahead bias detection and recursive indicator differences | Freqtrade (`lookahead-analysis`, `recursive-analysis`) | Prevents false backtests | Re-running the backtest for each signal | M | Medium |
| Fee/slippage/funding modeling and tick-based backtest | MT5 (Every tick), Freqtrade | Reported to be weak in TradingView | Tick/1m + exchange fee table | M | High |

## 7) Trade Journal and Performance Analytics

| Feature | Who offers it | Why valuable | Data needed | Complexity S/M/L | Priority |
|---|---|---|---|---|---|
| Auto-import of trades from exchanges (read-only API) and from MT5 | TradeZella (500+ brokers, its own claim), Tradervue, Edgewonk (MT sync) | Journal without manual entry; a user retention tool | Read-only API key / CSV file / MT5 report | M | High |
| Tagging of setup, emotion, mistake + "cost of mistakes" in dollars | Edgewonk (tiltmeter, mistake-cost), TradeZella | Turns behavior into numbers; the strongest driver of trader improvement | Trade data + user tags | S | High |
| Statistics dashboard (win rate, expectancy, profit factor, R-multiple, by day/hour/setup) | All journals | Knowing your real edge | Trades | S | High |
| Playbook / pre-trade checklist and discipline score | TradeZella, Edgewonk | Sticking to the plan | — | S | Medium |
| Trade replay on the chart (entry/exit on candles) + AI summary | TradeZella | Links the journal to the chart; a natural advantage for us since we have the chart | Trades + OHLCV | S | High |

## 8) Risk Management

| Feature | Who offers it | Why valuable | Data needed | Complexity S/M/L | Priority |
|---|---|---|---|---|---|
| Position size calculator on the chart (drag SL/TP → size based on % risk and leverage, liquidation price) | Standalone tools, exchange terminals | Prevents the biggest beginner mistake | Balance + price + exchange margin rules | S | High |
| Risk-of-ruin / Monte Carlo simulation from journal statistics | Standalone tools | Deciding the % risk per trade | Win rate, payoff, % risk | S | Medium |
| Symbol correlation matrix (rolling) | Portfolio Visualizer and Python tools (?) | In a crash, crypto correlations approach 1; reveals apparent diversification | OHLCV returns | S | Medium |
| Portfolio exposure view (net long/short in USD across all exchanges, effective leverage) | Professional terminals | Unified multi-exchange view | Read-only positions API | M | Medium |
| Guardrail rules (max daily loss, trade lock after N losses) | Edgewonk (tilt), some prop-firm tools | Prevents revenge trading | Positions/trades | S | Medium |

## 9) Alerts, Automation, and Bots

| Feature | Who offers it | Why valuable | Data needed | Complexity S/M/L | Priority |
|---|---|---|---|---|---|
| Native Telegram alerts (and Bale/Eitaa for Iran) with no relay needed | TradingView only has a generic webhook; users build their own relays | Telegram is the main channel for Iranian traders | Telegram Bot API + server-side alert engine | S | High |
| Alerts on non-price data (funding, OI, liquidations, CVD, cross-exchange spread) | Coinglass (alerts on the paid plan) | Alerts TradingView cannot do | Section 3 data | M | High |
| Grid bot (spot/futures, infinity grid) | Pionex (16 built-in bots), 3Commas | Popular in ranging markets; subscription revenue | Exchange trading API | L | Medium |
| DCA bot with safety orders and TP | 3Commas (core product), Pionex | A common strategy among retail users | Trading API | L | Medium |
| Signal bot: executing signals from the terminal's own alerts/webhook | 3Commas, TrendSpider (SignalStack) | Bridge from analysis to execution | Trading API | M | Medium |
| Trailing / TWAP / server-side conditional orders | 3Commas SmartTrade, Pionex | Orders the exchange does not natively offer (e.g., Nobitex) | Trading API | M | Medium |
| Copy trading / following a signal provider with a verified track record | Bybit/OKX/Binance copy trading, 3Commas marketplace | User acquisition; but legal and trust risk is high | Trading API + verifiable record | L | Low |

> Security warning: Any feature that holds a user's trading API key must store the key encrypted, reject withdrawal permission, and recommend an IP whitelist.

## 10) Multi-Exchange and Arbitrage

| Feature | Who offers it | Why valuable | Data needed | Complexity S/M/L | Priority |
|---|---|---|---|---|---|
| Spread chart between two symbols/exchanges (e.g., Binance BTCUSDT minus Bybit BTCUSDT, or Nobitex BTC in Toman ÷ USDT price in Toman) | LuxAlgo Arbitrage Matrix (script), community scripts | TradingView offers this only via limited symbol formulas; for Iran, the "Tether premium / domestic BTC" is very important | Simultaneous tickers/OHLCV from multiple exchanges | S | High |
| Price matrix of one asset across all exchanges + funding arbitrage | LuxAlgo, terminal tools such as wangr | Opportunity discovery | Multi-exchange tickers + funding | M | Medium |
| Aggregated price/volume from multiple exchanges on one chart | Exocharts (multi-exchange data), Coinglass | True market volume, not a single exchange | Multi-exchange trades/OHLCV | M | Medium |

## 11) Options (for a later phase / MT5 and Deribit)

| Feature | Who offers it | Why valuable | Data needed | Complexity S/M/L | Priority |
|---|---|---|---|---|---|
| Risk profile / P&L chart of a multi-leg strategy with date lines and IV changes | thinkorswim (Analyze tab) | The backbone of options trading | Options chain + pricing model (Black-Scholes) | M | Low |
| Probability cone / expected price range based on IV, probability of profit | thinkorswim (Probability Analysis) | — | IV | S | Low |
| No-code options strategy builder and backtest | Option Alpha | — | Options history (expensive) | L | Low |

> For an Iranian user, crypto options (Deribit/OKX/Bybit) are low priority; only the "probability cone based on volatility" can be added cheaply on any symbol.

## 12) MetaTrader 5 (Forex Phase)

| Feature | Who offers it | Why valuable | Data needed | Complexity S/M/L | Priority |
|---|---|---|---|---|---|
| MT5 account connection (show positions/trades on the chart, automatic journal) | MT5, journals | Iranian forex users are on MT5 brokers | MT5 Python bridge or MetaApi | M | Medium |
| Exporting a strategy to an EA or executing signals on MT5 | MT5 EAs | Bridge from analysis to execution in forex | — | L | Low |

## 13) Iran-Specific Market Needs (Main Competitive Advantage)

| Feature | Who offers it | Why valuable | Data needed | Complexity S/M/L | Priority |
|---|---|---|---|---|---|
| Nobitex Toman pairs (and other domestic exchanges such as Wallex/Ramzinex/Excoino) with Rial/Toman display | The exchanges themselves (basic charts); TradingView does not have it | Iranian users trade in Toman | Nobitex public API (market data + WebSocket; currency code `rls` is Rial, Toman = Rial ÷ 10) | M | High |
| "Tether premium" / implied dollar price index (USDT in Toman ÷ 1 compared with the open-market dollar) | — | An important gauge of the Iranian economy and domestic/foreign arbitrage | Nobitex USDT/IRT + tgju dollar rate | S | High |
| Gold, coin, mithqal, and open-market dollar prices (from tgju) | tgju.org (no official API; community scraping libraries) | Main investment assets of Iranians; comparing BTC with coins | Scrape tgju with caching and respecting site rules; risk of the scraper breaking | M | High |
| Tehran Stock Exchange (TSETMC): symbols, retail/institutional, buy/sell queues | tsetmc.com, Python library `tsetmc-api` | Large domestic market; "retail money inflow" data is unique | Scrape TSETMC (sometimes 403 → retry) | L | Medium |
| Jalali calendar on the time axis, dates and date-picker; Iranian holidays; Tehran Stock Exchange trading session | — | Native experience | Date conversion library (browser-native `Intl.DateTimeFormat('fa-IR-u-ca-persian')`) | S | High |
| Full Persian RTL interface, Persian font (Vazirmatn), optional Persian digits | — | TradingView has no complete native Persian interface | — | M | High |
| Operating under sanctions/filtering: server-side proxy for foreign exchange APIs, no dependence on blocked CDNs | — | Without this, the other features do not work for an Iranian user | Relay server outside Iran | M | High |
| Rial payment for subscriptions | — | Iranian users do not have international cards | Domestic payment gateway | S | High |

---

## Suggested Prioritization (Top 15)

1. **Derivatives data as indicators below the chart** (OI, funding, long/short, liquidation feed) — free exchange data, S, the most value per effort.
2. **Nobitex Toman pairs + Tether premium chart / domestic-vs-foreign spread** — the main differentiator for the Iranian market.
3. **Gold/coin/dollar from tgju** alongside crypto.
4. **Jalali calendar + full RTL + anti-filtering operation** — the product foundation for Iran.
5. **Native Telegram alerts** (and Bale) + alerts on funding/OI/spread.
6. **Footprint/cluster chart + stacked imbalance.**
7. **CVD (separate for spot and perp) with divergence.**
8. **Order book liquidity heatmap.**
9. **TPO/Market Profile and composite volume profile.**
10. **Estimated liquidation heatmap** (with an explicit "estimate" label).
11. **Position-size calculator on the chart** with liquidation price.
12. **Automatic journal** with exchange API import, mistake tagging, and trade replay on the chart.
13. **Auto trendlines / S&R + no-code multi-timeframe overlay.**
14. **No-code backtest + walk-forward + realistic fees/slippage** (Monte Carlo and parameter heatmap in the next stage).
15. **Natural-language scanner (in Persian!)** — turning a Persian sentence into scanner conditions with an LLM.

Items **not suggested for now:** copy trading (legal/trust risk), full options, AI Strategy Lab, iceberg detector (crypto has no MBO data), and paid on-chain data (cost and payment problems from Iran) — add these after demand is proven.

---

## Sources

- [S1] TrendSpider Help — Introduction to TrendSpider: https://help.trendspider.com/kb/overview/introduction-to-trendspider-d59c9fcabbcd8360
- [S2] TrendSpider Blog — Scanning the Markets With Sidekick AI: https://trendspider.com/blog/scanning-the-markets-with-sidekick-ai/
- [S3] TrendSpider Blog — Meet Sidekick: https://trendspider.com/blog/sidekick-trading-ai/
- [S4] Liberated Stock Trader — TrendSpider review: https://www.liberatedstocktrader.com/trendspider-review-automated-stock-trend-analysis/ ; ChartingLens — TrendSpider plans: https://chartinglens.com/blog/is-trendspider-worth-it
- [S5] ATAS — Best heatmap trading software 2026 (vendor source): https://atas.net/blog/best-heatmap-trading-software-2026/ ; ATAS heatmap: https://atas.net/de/heatmap
- [S6] ATAS Learn — Volume analysis types, benchmarks, limits: https://learn.atas.net/volume-basics/volume-analysis/types-benchmarks-limits
- [S7] Bookmap Knowledge Base — Iceberg Orders Tracker: https://bookmap.com/knowledgebase/docs/KB-Bookmap-Wiki-Iceberg-Orders-Tracker ; Bookmap blog — iceberg orders: https://bookmap.com/blog/how-to-read-and-trade-iceberg-orders-hidden-liquidity-in-plain-sight
- [S8] Exocharts — Features: https://exocharts.com/features.html ; Tradingtoolshub review: https://tradingtoolshub.com/review/exocharts/ ; TheGodFunded: https://thegodfunded.com/en/tools/exocharts/
- [S9] TradersPost — Pine Script request.footprint() guide: https://blog.traderspost.io/article/pine-script-footprint-requests
- [S10] NexusFi thread on TradingView footprint: https://nexusfi.com/showthread.php?p=910363
- [S11] ForexTester — TradingView alternatives (competitor source): https://forextester.com/blog/it/tradingview-alternatives/ ; TradersPost — understanding the TradingView backtester: https://blog.traderspost.io/article/understanding-the-tradingview-backtester
- [S12] Sierra Chart 2019 patch notes (Optimus Futures community): https://community.optimusfutures.com/t/sierra-chart-whats-new-2019-patch-notes/2937 ; Sierra Chart: https://www.sierrachart.com
- [S13] CoinGlass homepage: https://www.coinglass.com/ ; CryptoRank — what is CoinGlass: https://cryptorank.io/news/feed/bf393-what-is-coinglass-crypto-liquidation-data-explained
- [S14] CryptoQuant glossary: https://docs.cryptoquant.com/guides/glossary ; CryptoQuant stablecoin netflow: https://userguide.cryptoquant.com/cryptoquant-metrics/stablecoin/stablecoin-exchange-in-outflow-and-netflow
- [S15] Glassnode Studio — exchange net transfer volume: https://studio.glassnode.com/charts/transactions.TransfersVolumeExchangesNet?a=BTC ; Spark — Glassnode vs CryptoQuant vs Nansen: https://www.spark.money/tools/bitcoin-onchain-analytics-comparison
- [S16] Santiment Academy — Weighted sentiment: https://academy.santiment.net/metrics/sentiment-metrics/weighted-sentiment-metrics/ ; metrics overview: https://academy.santiment.net/metrics/
- [S17] Schwab — Analyze trades using Risk Profile on thinkorswim: https://www.schwab.com/learn/story/analyze-trades-using-risk-profile-on-thinkorswim ; thinkManual Analyze: https://toslc.thinkorswim.com/center/howToTos/thinkManual/Analyze
- [S18] Option Alpha — compare/pricing: https://optionalpha.com/compare ; toolbox: https://optionalpha.com/toolbox
- [S19] MetaTrader 5 Help — Strategy Optimization: https://www.metatrader5.com/en/terminal/help/algotrading/strategy_optimization
- [S20] QuantConnect Docs — Walk-forward optimization: https://www.quantconnect.com/docs/v2/writing-algorithms/optimization/walk-forward-optimization ; forum on Monte Carlo: https://www.quantconnect.com/forum/discussion/7094
- [S21] Freqtrade Docs — Lookahead analysis: https://www.freqtrade.io/en/stable/lookahead-analysis/ ; Backtesting docs: https://codeclimate.com/github/freqtrade/freqtrade/docs/backtesting.md/source
- [S22] TradeZella — Edgewonk vs TradeZella (vendor source): https://www.tradezella.com/blog/edgewonk-vs-tradezella ; TradeZella vs Tradervue: https://www.tradezella.com/blog/tradezella-vs-tradervue ; DayTradingz — Edgewonk vs TradeZella: https://daytradingz.com/edgewonk-vs-tradezella/
- [S23] Geekflare — crypto trading bots: https://geekflare.com/crypto-trading-bots/ ; Capterra — 3Commas: https://www.capterra.com.sg/software/1077401/3Commas ; ToolWorthy — 3Commas: https://www.toolworthy.ai/tool/3commas
- [S24] Quant Nomad — TradingView alerts to Telegram: https://quantnomad.com/how-to-connect-tradingview-alerts-to-telegram-bots-100-free/ ; TradingView-Webhook-Bot: https://github.com/vsnz/TradingView-Webhook-Bot
- [S25] LuxAlgo — Arbitrage Matrix: https://www.luxalgo.com/library/indicator/arbitrage-matrix/ ; Arbitrage Detector: https://www.luxalgo.com/library/indicator/arbitrage-detector/ ; wangr (PyPI): https://pypi.org/project/wangr/
- [S26] Risk-management framework (correlation → 1 in crashes): https://claudeskills.info/skills/agiprolabs/claude-trading-skills/risk-management/
- [S27] Nobitex API docs: https://apidocs.nobitex.ir/ ; nobitex MCP server source: https://glama.ai/mcp/servers/@xmannii/nobitex-mcp-server/blob/bd8d253a1306ed7f09745befc05b0d5dc4550888/services/nobitex.service.ts
- [S28] tgju scraper (Python): https://github.com/amirh0ss3in/tgju_api ; tgju-api-go: https://pkg.go.dev/github.com/amiranmanesh/tgju-api-go
- [S29] tsetmc-api (Python): https://github.com/mahs4d/tsetmc-api ; https://pypi.org/project/tsetmc-api
