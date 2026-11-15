[English](06-atas-vs-ninjatrader-metatrader.en.md) · [فارسی](06-atas-vs-ninjatrader-metatrader.md)

# ATAS vs NinjaTrader, MetaTrader 5 and Chart Terminal

Research date: 2026-10-17. Sources are listed at the bottom. Most ATAS sources are the vendor's own site or affiliated blogs, so treat marketing figures (such as "400 footprint types") as approximate. Items I have not verified myself are marked with (?).

## ATAS at a glance

ATAS is a specialised **order flow** platform: it shows how much volume traded at each price level and from which side (buyer or seller). Its goal is to analyse what happened behind each candle. Ordinary charting, classic indicators and simple scripting are not its main focus.

- **Operating system:** Windows only. The new ATAS X for Windows and macOS is in beta. There is no mobile or web version.
- **Price:** Start is free (2 symbols, 3 indicators, futures data delayed by 15 minutes). Plus is 24.95 EUR/month, Pro is 69.95 EUR/month and Ultra is 89.95 EUR/month. Lifetime licences range from 999 to 1999 EUR. Real-time futures and stock data cost extra, but crypto data is free.
- **Connections:** Rithmic, CQG, dxFeed, IQFeed, Interactive Brokers, and NinjaTrader itself as a broker. For crypto it connects to Binance, Bybit, OKX, Kraken and Bitget. It also supports several prop firms.
- **Weaknesses:** Steep learning curve (at least a month), heavy memory use, reports of freezing during live trading, and a dated, cluttered interface. It is not built for spot forex and CFDs.

## ATAS features

| Area | Features |
|---|---|
| Footprint and cluster | Footprint types (Volume, Trades, Bid × Ask, Delta, Heatmap), Cluster Statistics, Cluster Search, Stacked Imbalance, Absorption, Exhaustion, and ATAS Magnifier |
| Timeframes | Renko, Range, Reversal, XV, Z, US, and the OrderFlow timeframe |
| Tape | Smart Tape (re-merging fragmented trades into the original order, and volume filtering), Speed of Tape, Big Trades and Adaptive Big Trades, Tape Patterns, and Bid/Ask Tape |
| DOM and liquidity | Smart DOM (footprint columns and spoofing detection), MBO DOM, DOM Levels, Heatmap and Rolling Heatmap, DOM Power, and the DOM Pressure widget |
| Profile | Volume Profile, TPO and Market Profile (fixed, anchored, ZigZag, session) |
| Delta | Delta with divergence, CVD, CVD Pro / Market Power (multi-symbol), and the Delta Divergence widget |
| Trading | Chart Trader, orders from the DOM and the chart, and Exit Strategy (take profit and stop loss, breakeven and trailing, and **multi-stage exits**). Following Manager for copying trades between accounts |
| Practice | Market Replay (tick-by-tick history playback), ATAS Sim, Crypto Sim, and ATAS Challenge |
| Journal | **Trading Journal:** statistics, a trading calendar with daily notes, a trades table with comments, Playbook (tags for setups), Orders and Executions tabs, and export. It has no MAE/MFE, and the request for it is in the queue |
| Development | C# API (access to cluster and profile content), and a Marketplace |

## Comparing the three platforms with ours

✅ has it · 🟡 partial or via a paid add-on · ❌ does not have it

| Feature | ATAS | NinjaTrader 8 | MetaTrader 5 | Chart Terminal (ours) |
|---|---|---|---|---|
| Main focus | order flow | futures and automation | forex, CFDs, expert advisors | TradingView-style charting, all markets |
| Footprint and cluster | ✅ very complete | 🟡 Volumetric Bars with the Order Flow+ licence | ❌ | ❌ phase 8 |
| DOM and liquidity heatmap | ✅ Smart DOM, Heatmap | ✅ SuperDOM, 🟡 Market Depth Map | 🟡 basic DOM | ❌ phases 6 and 8 |
| Tape and Big Trades | ✅ | 🟡 Time & Sales, Trade Detector (?) | 🟡 Time & Sales | ❌ |
| CVD and delta | ✅ | 🟡 Order Flow+ | ❌ | ❌ phase 8 |
| Volume profile and TPO | ✅ | 🟡 | ❌ (only Market indicators) | 🟡 Fixed Range VP as a drawing tool |
| Scripting language | C# API | NinjaScript (C#) | MQL5 | ✅ Pine, MQL4/5 and NinjaScript, all three with no installation |
| Backtesting and optimisation | ❌ (?) | ✅ Strategy Analyzer, genetic, walk-forward, Monte Carlo | ✅ multi-symbol tester, genetic, cloud optimisation, forward | ✅ phase 4 (53 metrics, genetic, WFA, Monte Carlo, portfolio, no code) |
| Replay | ✅ tick-by-tick | ✅ tick Market Replay | 🟡 visual tester only | 🟡 Bar Replay (candle-based) |
| Multi-stage exit and breakeven | ✅ Exit Strategy | ✅ ATM Strategy | 🟡 via expert advisor | ❌ (only TP/SL and OCO) |
| Trade copying | ✅ Following Manager | 🟡 add-on | ✅ Signals | ❌ deliberately dropped |
| Trading journal | ✅ simple (statistics, calendar, playbook) | 🟡 Trade Performance, no reasons or emotions | 🟡 history and reports only | ⏳ **being built right now** |
| Crypto | ✅ 5 exchanges | 🟡 limited | 🟡 depends on the broker | ✅ 100+ exchanges via CCXT |
| Iranian market and Persian | ❌ | ❌ | 🟡 Iranian MT5 brokers | ⏳ phase 7 |
| Operating system | Windows (macOS in beta) | Windows | Windows, Mac, mobile, web | ✅ browser |
| Price | 0 to 90 EUR per month | 0, 99 USD per month, or 1499 USD lifetime | free (cost depends on the broker) | free and local |

## Main differences between NinjaTrader / MetaTrader and ATAS

- **NinjaTrader:**
  - **Strengths:** The US futures standard. **ATM Strategy** (automatic exit management), SuperDOM, tick Market Replay, and a full Strategy Analyzer with optimisation, walk-forward and Monte Carlo. The add-on ecosystem is also large.
  - **Weaknesses:** Order flow tools only come with the Order Flow+ licence or paid add-ons. Its journal is limited to the Trade Performance report.
- **MetaTrader 5:**
  - **Strengths:** It is free and every forex and CFD broker supports it. It has MQL5 expert advisors, and a multi-symbol tester with real tick simulation and cloud optimisation (MQL5 Cloud Network). It also has Market, Signals, and mobile and web versions.
  - **Weaknesses:** It has almost no order flow tools, and its DOM and Time & Sales are basic.
- **ATAS:** Ahead of both in order flow, but weak in backtesting and strategy automation.

## What ATAS has that we do not (prioritised)

| # | Feature | Value for us | Suggested phase | Requirement |
|---|---|---|---|---|
| 1 | **Trading journal** with statistics, calendar, playbook and daily notes | Very high. Our version goes further: entry and exit reasons, emotions, mistakes, R-multiple and MAE/MFE (which ATAS lacks) | **Now** | — |
| 2 | **Multi-stage Exit Strategy:** multiple TPs, automatic breakeven and trailing | High, and simple | 6 | Only code on our side |
| 3 | **Footprint, Delta, CVD and Stacked Imbalance** | High for crypto, since exchange trade data is free | 8 | Trade stream (aggTrades) from the data server |
| 4 | **Big Trades and Smart Tape:** filtering and merging large trades | High | 8 | The same trade stream |
| 5 | **Order book heatmap and DOM Levels** | Medium to high | 8 | Market depth stream and snapshot storage |
| 6 | **Tick Market Replay** | Medium. Needs stored tick data | 8 | Storing trades on the local server (phase 5) |
| 7 | **TPO and Session Volume Profile** as an indicator | Medium | 8 | Only smaller candles |
| 8 | Reversal and Delta-based timeframes | Low | 8 | Trade stream |
| 9 | Cluster Search: automatically finding unusual clusters | Medium | 8 (after footprint) | — |
| 10 | Following Manager (trade copying) | — | Dropped (legal risk) | — |

**Summary:** Our main gap is order flow (rows 3 to 9). All of it fits in phase 8 and is achievable for crypto with no data cost. In backtesting, multiple scripting languages, exchange coverage and running in the browser, we are ahead of ATAS.

## Sources
- [ATAS — Main advantages](https://atas.net/blog/main-advantages-of-the-atas-platform/)
- [ATAS — Trading Journal (help center)](https://help.atas.net/en/support/solutions/articles/72000660488-trading-journal-trading-statistics-)
- [ATAS — Exit strategies (Quick Start)](https://start.atas.net/step-3.-start-trading-with-atas/exit-strategies)
- [ATAS — Exchanges and brokers](https://atas.net/features/exchanges-connections/)
- [ATAS feature request: MAE/MFE in trade statistics](https://feedback.atas.net/p/feature-request-inclusion-of-mae-and-mfe-metrics-in-trade)
- [Complete Trader's Edge — ATAS review 2026](https://completetradersedge.com/atas-review/)
- [TPTE — NinjaTrader vs ATAS footprint](https://tpte.de/en/ninjatrader-footprint-vs-atas/)
- [QuantVPS — Best order flow trading software 2026](https://www.quantvps.com/blog/order-flow-trading-software)
- [QuantVPS — Best footprint chart software 2026](https://www.quantvps.com/blog/analyzing-footprint-charts)
- [Trader Dale — Order flow platforms and data explained](https://www.trader-dale.com/top-order-flow-platforms-data-explained-ninjatrader-sierra-chart-atas-quantower-tradingview/)
- [Tradervue — Best trading journals 2026](https://www.tradervue.com/blog/best-trading-journal)
- [LuxAlgo — Edgewonk analysis](https://www.luxalgo.com/blog/edgewonk-journal-tool-analysis/)
