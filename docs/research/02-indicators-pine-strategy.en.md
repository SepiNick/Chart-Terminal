[English](02-indicators-pine-strategy.en.md) · [فارسی](02-indicators-pine-strategy.md)

# 02 — Indicators, Pine Script and Strategy Tester

> Goal: document the **behavior** of TradingView's features for a clean-room rebuild. No code or long text has been copied from TradingView; everything is rewritten.
> Research date: October 2026. Sources are listed at the end of the file.

Column guide:
- **Complexity**: `S` = a few hours to a day, `M` = a few days, `L` = a week or more.
- **Priority**: `Core` (the product makes no sense without it), `High`, `Medium`, `Low`.

---

## 1. Built-in indicators (Technicals → Indicators)

The official Built-in indicators folder in the Help Center has about 209 articles; roughly 90 of them are crypto on-chain metrics (section 1.13). The rest, plus the tools in the Patterns and Volume profile tabs, are listed in the tables below. **In total about 170 non-on-chain indicators/patterns**, plus ~90 on-chain metrics.

Shared behavioral note: almost all classic indicators in TradingView are themselves written in Pine, and their source can be viewed in the editor. So if we build a Pine interpreter, a large part of this catalog comes "for free" as scripts.

### 1.1 Moving averages

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Simple Moving Average (SMA) | Simple average of the last N candles | S | Core |
| Exponential Moving Average (EMA) | Average with exponentially higher weight on recent data | S | Core |
| Weighted Moving Average (WMA) | Average with linear weights | S | High |
| Smoothed Moving Average (SMMA/RMA) | Wilder-style smoothed average | S | High |
| Double EMA (DEMA) | Combines EMA and EMA-of-EMA to reduce lag | S | Medium |
| Triple EMA (TEMA) | Three-layer version for even less lag | S | Medium |
| Hull Moving Average (HMA) | Fast, smooth average using nested WMAs | S | High |
| Arnaud Legoux MA (ALMA) | Average with a Gaussian window and adjustable offset | S | Medium |
| Kaufman's Adaptive MA (KAMA) | Its speed adapts to the market efficiency ratio | S | Medium |
| McGinley Dynamic | An average that adjusts itself to market speed | S | Low |
| Least Squares MA (LSMA) | End point of the linear regression line of each window | S | Medium |
| Volume-Weighted MA (VWMA) | Volume-weighted average | S | High |
| Moving Average Ribbon | Several MAs at once with ribbon coloring | S | Medium |
| MA Cross / MovingAvg Cross / MovingAvg2Line Cross | Shows two MAs and marks their crossover | S | High |
| Moving Averages (multi) | A configurable multi-MA panel in one place | S | Medium |
| Median | Median price over the window + ATR band | S | Low |
| Envelope (ENV) | Percentage band above/below an MA | S | Medium |
| Linear Regression (Curve) | Moving linear regression curve | S | Medium |
| Multi-Time Period Charts | Higher-timeframe high/low/open levels on the chart | M | Low |

### 1.2 Trend

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Average Directional Index (ADX) | Non-directional trend strength | S | High |
| Directional Movement (DMI) | +DI/-DI and ADX together | S | High |
| Aroon Indicator | Time since the last N-candle high/low | S | Medium |
| Aroon Oscillator | Difference between Aroon Up and Down | S | Low |
| Parabolic SAR | Accelerating trailing stop points | S | High |
| Supertrend | ATR-based line that changes color with trend direction | S | Core |
| Ichimoku Cloud | Tenkan/Kijun/Senkou A,B/Chikou with a cloud shifted into the future | M | High |
| Vortex Indicator | Two lines, VI+ and VI-, to detect the start of a trend | S | Low |
| Chande Kroll Stop | ATR-based stops for long and short | S | Low |
| Chandelier Exit | Exit stop at the highest high minus an ATR multiple | S | Medium |
| Volatility Stop | Trailing stop based on ATR | S | Low |
| Trend Strength Index | Correlation of price with time as trend strength | S | Low |
| Chop Zone | Colors the EMA angle to mark range/trend zones | S | Low |
| Choppiness Index (CHOP) | Measures how range-bound the market is | S | Low |
| BBTrend | Trend strength from the distance between two Bollinger Bands | S | Low |
| Williams Alligator | Three shifted SMMAs (jaw/teeth/lips) | S | Medium |
| Coppock Curve | Long-term momentum from weighted ROCs | S | Low |
| Know Sure Thing (KST) | Combination of four smoothed ROCs | S | Low |
| Mass Index | Detects reversals from range expansion | S | Low |
| Zig Zag | Connects high/low pivots with a minimum deviation | M | High |
| Auto Trendlines | Automatically draws trendlines on pivots | L | Medium |
| Auto Pitchfork | Automatically draws an Andrews pitchfork | M | Low |
| Auto Key Levels | Automatic key support/resistance levels | M | Medium |

### 1.3 Momentum / Oscillators

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Relative Strength Index (RSI) | 0-to-100 oscillator using RMA of gains/losses | S | Core |
| RSI Divergence | Automatically marks RSI/price divergence | M | Medium |
| Stochastic (STOCH) | Position of close within the N-candle range (%K/%D) | S | Core |
| Stochastic RSI | Stochastic applied to the RSI value | S | High |
| Stochastic Momentum Index (SMI) | Stochastic relative to the midpoint of the range | S | Low |
| MACD | Difference of two EMAs + signal + histogram | S | Core |
| Percentage Price Oscillator (PPO) | MACD in percent | S | Low |
| Price Oscillator | Difference of two MAs | S | Low |
| Price Momentum Oscillator (PMO) | Twice-smoothed ROC | S | Low |
| Commodity Channel Index (CCI) | Deviation of typical price from its average | S | High |
| Woodies CCI | CCI with turbo CCI and histogram | S | Low |
| Momentum | Today's close minus the close N candles ago | S | Medium |
| Rate of Change (ROC) | Percentage change over N candles | S | Medium |
| Awesome Oscillator (AO) | Difference of SMA 5 and 34 of the median price | S | Medium |
| Accelerator Oscillator (AC) | AO minus its own SMA | S | Low |
| Williams %R | Inverse stochastic in the 0 to -100 range | S | Medium |
| Ultimate Oscillator (UO) | Combines buying pressure over three timeframes | S | Low |
| TRIX | ROC of a triple EMA | S | Low |
| True Strength Index (TSI) | Twice-smoothed momentum | S | Low |
| Chande Momentum Oscillator (CMO) | Gains minus losses divided by their sum | S | Low |
| Connors RSI (CRSI) | Average of RSI, streak RSI and percent rank | S | Low |
| Detrended Price Oscillator (DPO) | Removes the trend to reveal cycles | S | Low |
| Fisher Transform | Converts price to a near-Gaussian distribution | S | Low |
| Relative Vigor Index (RVI) | Compares close-open with high-low | S | Low |
| Balance of Power (BOP) | Buyer strength versus seller strength in each candle | S | Low |
| Bull Bear Power | Distance of high/low from the EMA | S | Low |
| SMI Ergodic Indicator / Oscillator | TSI variant with a signal line | S | Low |
| Pring's Special K | Combination of several ROCs for cycles | S | Low |
| Rank Correlation Index (RCI) / RCI Ribbon | Rank correlation of price and time | S | Low |
| Correlation Coefficient | Correlation with another symbol (needs request.security) | M | Medium |
| Performance | Percentage return over various periods | S | Low |
| Technical Ratings | Buy/sell summary from a mix of MAs and oscillators | M | Medium |

### 1.4 Volatility

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Bollinger Bands (BB) | SMA ± k standard deviations | S | Core |
| Bollinger Bands %b | Position of price inside the bands | S | Medium |
| Bollinger BandWidth (BBW) | Relative width of the bands | S | Medium |
| Bollinger Bars | Candles colored based on the bands | S | Low |
| Keltner Channels (KC) | EMA ± ATR multiple | S | High |
| Donchian Channels (DC) | Highest high and lowest low over N candles | S | High |
| Average True Range (ATR) | Average of True Range | S | Core |
| Average Daily Range (ADR) | Average daily range | S | Low |
| Historical Volatility | Annualized standard deviation of log returns | S | Medium |
| Relative Volatility Index | RSI applied to standard deviation | S | Low |
| Ulcer Index | Depth and duration of drawdown from the peak | S | Low |
| Standard Deviation | Standard deviation of price | S | Medium |

### 1.5 Volume

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Volume | Volume columns colored by candle direction + MA | S | Core |
| On Balance Volume (OBV) | Cumulative volume signed by price change | S | High |
| Accumulation/Distribution (ADL) | Cumulative money flow based on the close position | S | Medium |
| Chaikin Money Flow (CMF) | ADL normalized over a window | S | Medium |
| Chaikin Oscillator | MACD applied to ADL | S | Low |
| Money Flow Index (MFI) | Volume-weighted RSI | S | High |
| Volume Weighted Average Price (VWAP) | Volume-weighted average price, reset each session/period + bands | M | Core |
| VWAP Auto Anchored | VWAP with an automatic anchor (e.g. the last pivot) | M | Medium |
| Time Weighted Average Price (TWAP) | Time-weighted average price in each period | S | Low |
| Visible Average Price | Average price only over the visible range of the chart | M | Low |
| Elder's Force Index (EFI) | Price change multiplied by volume | S | Low |
| Ease of Movement (EOM) | Relationship between price change and volume | S | Low |
| Klinger Oscillator | Long- and short-term volume flow | S | Low |
| Net Volume | Approximate buy volume minus sell volume | S | Low |
| Price Volume Trend (PVT) | Cumulative volume weighted by percentage change | S | Low |
| Positive / Negative Volume Index (PVI/NVI) | Price changes on high/low volume days | S | Low |
| Percentage Volume Oscillator (PVO) | PPO applied to volume | S | Low |
| Volume Oscillator | Difference of two volume MAs | S | Low |
| Cumulative Volume Index (CVI) | Breadth line from advancing/declining volume | S | Low |
| Up/Down Volume | Splits up and down volume (from intrabar data) | M | Medium |
| Volume Delta | Per-candle volume delta from intrabar | M | Medium |
| Cumulative Volume Delta (CVD) | Cumulative delta in each period | M | Medium |
| Relative Volume at Time | Current volume versus the average for the same hour on previous days | M | Low |
| 24-hour Volume | 24-hour crypto volume | S | Low |

### 1.6 Volume profiles

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Visible Range Volume Profile (VRVP/VPVR) | Volume-at-price histogram for the visible range; recalculated on scroll | L | High |
| Fixed Range Volume Profile | Profile between two points in time that the user drags (drawing tool) | L | High |
| Anchored Volume Profile | Profile from an anchor to the last candle (drawing tool) | M | Medium |
| Session Volume Profile (and HD) | A separate profile for each session | L | Medium |
| Periodic Volume Profile | Profile for each fixed period (day/week/...) | L | Medium |
| Auto Anchored Volume Profile | Automatic anchor (e.g. highest/lowest or session) | M | Low |
| Shared components | POC, Value Area (usually 70%), VAH/VAL, up/down volume split, row size (number of rows or ticks per row) | — | — |

Implementation note: all profiles need intrabar data (a lower timeframe) to distribute volume across price levels correctly. In Pine, TradingView has also added `request.footprint()` and the `footprint`/`volume_row` types (January 2026) for this purpose.

### 1.7 Bill Williams

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Williams Alligator | Three shifted SMMAs | S | Medium |
| Williams Fractals | Marks 5-candle high/low pivots | S | Medium |
| Awesome Oscillator | SMA5 − SMA34 on hl2 | S | Medium |
| Accelerator Oscillator | AO − SMA5(AO) | S | Low |
| Market Facilitation Index | Range divided by volume (optional) | S | Low |

### 1.8 Breadth / Market internals

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Advance/Decline Line | Cumulative difference of advancing and declining stocks (market symbol) | M | Low |
| Advance/Decline Ratio | Ratio of advancers to decliners | M | Low |
| Advance/Decline Ratio (Bars) | The same ratio over the candles of one symbol | S | Low |
| Seasonality | Compares the performance of different years on one axis | M | Low |
| Moon Phases | Marks full/new moon on the chart | S | Low |
| Trading Sessions | Shades the Asia/London/New York sessions | S | Medium |
| Pivot Points Standard | Traditional/Fibonacci/Woodie/Classic/DM/Camarilla pivots on a higher timeframe | M | High |
| Pivot Points High Low | Labels local pivots with left/right lengths | S | Medium |
| Rob Booker (6 items) | Intraday/Missed/Ziv Ghost pivots, ADX Breakout, Knoxville Divergence, Reversal | S–M | Low |
| Auto Fib Retracement | Automatic Fibonacci levels between the last swing (based on the zigzag) | M | High |
| Auto Fib Extension | Automatic three-point Fibonacci extension | M | Medium |
| Analyst price forecast / Price target | Analyst price forecast (fundamental data) | M | Low |
| Dividend Yield | Cash dividend yield (fundamental data) | M | Low |
| Power-Law Model | Power-law model for long-term price | S | Low |

### 1.9 Crypto derivatives (futures data)

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Open Interest | Number of open contracts | M | Medium |
| Funding rate | Perpetual funding rate | M | Medium |
| Basis / Premium | Gap between the futures price and spot/index | S | Low |
| Mark price / Index price | The exchange's reference price | S | Low |
| Long/Short ratio (Accounts, Top traders: 6 items) | Ratio of long to short accounts/positions | M | Low |
| Liquidation data | Liquidation volume | M | Low |

### 1.10 Candlestick patterns (Technicals → Patterns)

Behavior: each pattern is a separate indicator; it places a small label on the candle (blue = bullish, red = bearish, gray = neutral/two-sided). Shared input: detection of the prior trend using SMA50, or SMA50+SMA200, or no filter. All are implemented with simple body/shadow size logic.

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| All Candlestick Patterns | All patterns in one indicator with checkboxes | M | High |
| Abandoned Baby (Bull/Bear) | Gaps on both sides of a doji | S | Low |
| Dark Cloud Cover / Piercing | Two-candle bearish/bullish reversal | S | Medium |
| Doji, Dragonfly Doji, Gravestone Doji | Near-zero body with various shadows | S | High |
| Doji Star (Bull/Bear) | A doji after a long candle with a gap | S | Low |
| Engulfing (Bull/Bear) | The second candle's body fully covers the first | S | High |
| Evening Star / Evening Doji Star | Three-candle bearish reversal | S | Medium |
| Morning Star / Morning Doji Star | Three-candle bullish reversal | S | Medium |
| Hammer / Inverted Hammer | Long lower/upper shadow after a downtrend | S | High |
| Hanging Man / Shooting Star | The same shapes after an uptrend | S | High |
| Harami / Harami Cross (Bull/Bear) | The second candle is inside the first's body | S | Medium |
| Kicking (Bull/Bear) | Two opposite marubozu with a gap | S | Low |
| Long Lower / Upper Shadow | A long one-sided shadow | S | Low |
| Marubozu (Black/White) | A candle with no shadows | S | Low |
| On Neck | Two-candle bearish continuation | S | Low |
| Rising / Falling Three Methods | Five-candle continuation pattern | S | Low |
| Rising / Falling Window | Continuation gap | S | Low |
| Spinning Top (Black/White) | Small body with two shadows | S | Low |
| Three White Soldiers / Three Black Crows | Three strong candles in the same direction | S | Medium |
| Tri-Star (Bull/Bear) | Three dojis with gaps | S | Low |
| Tweezer Top / Bottom | Two candles with equal highs/lows | S | Low |
| Upside / Downside Tasuki Gap | Three-candle continuation gap | S | Low |

(About 42 patterns in total, counting separate Bull/Bear versions.)

### 1.11 Chart patterns (auto)

Behavior: in the Patterns tab; scans only the last ~600 candles; preset settings; to examine the past, Bar Replay must be used. Patterns may change as new candles arrive (repaint).

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| All Chart Patterns | All classic patterns in one indicator | L | Medium |
| Head and Shoulders / Inverse | Head and shoulders with a neckline | L | Medium |
| Double Top / Bottom, Triple Top / Bottom | Tops/bottoms at the same level | M | Medium |
| Ascending / Descending / Symmetrical Triangle | Triangles from pivot lines | L | Medium |
| Rising / Falling Wedge | Wedge | L | Low |
| Bull / Bear Flag, Bull / Bear Pennant | Flag and pennant after a sharp move | L | Low |
| Rectangle | Horizontal range | M | Low |
| Elliott Wave | Automatic 5-3 wave counting | L | Low |

### 1.12 Other

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Compare / Overlay symbol | Shows another symbol on the same chart (in percent) | M | High |
| Ratio / Spread | Ratio or difference of two symbols | M | Medium |
| Linear Regression Channel | Regression channel with standard deviation | M | Medium |
| Learn using Seasonals | Teaching seasonality | — | Low |

### 1.13 Crypto on-chain metrics (~90 items)

They all share one behavioral pattern: "show an external time series as an indicator below the chart". Categories: Addresses (active/sending/receiving, addresses with balance ≥ X), Supply (1y active supply, held tokens ≥ X, supply equality ratio), Blocks/mining (hash rate, difficulty, block height, block size/interval), Transactions (fees, gas, transfer count/rate/volume, large transactions), UTXO (created/spent/value), Valuation (realized cap, SOPR, RVT, Stock-to-Flow), Ethereum staking (deposits, value staked), ETF flows/balances, El Salvador balance.

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Generic "external series" indicator | One engine to display any on-chain/fundamental series | M | Low |

---

## 2. Built-in strategies (Technicals → Strategies) — 20 items

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| BarUpDn Strategy | Enters in the direction of the current candle when the open gaps from the previous close | S | Medium |
| Bollinger Bands Strategy | Enters when price returns from the band to the inside | S | High |
| Bollinger Bands Strategy Directed | The same, but in one selected direction only | S | Low |
| Channel BreakOut Strategy | Stop order on a breakout of the N-candle high/low | S | Medium |
| Consecutive Up/Down Strategy | Enters after X consecutive up/down candles (default 3) | S | Medium |
| Greedy Strategy | Enters on a gap and adds in steps (pyramiding) | S | Low |
| InSide Bar Strategy | Enters based on the inside bar | S | Low |
| Keltner Channels Strategy | Keltner channel breakout | S | Medium |
| MACD Strategy | MACD histogram crossing zero | S | High |
| Momentum Strategy | Stop order in the direction of positive/negative momentum | S | Medium |
| OutSide Bar Strategy | Enters based on the outside bar | S | Low |
| Parabolic SAR Strategy | Stop at the next SAR level (always in the market) | S | Medium |
| Pivot Extension Strategy | Reversal trade on pivots | S | Low |
| Pivot Reversal Strategy | Stop order on a breakout of the last pivot high/low | S | Medium |
| Price Channel Strategy | High/low channel breakout | S | Low |
| RSI Strategy | Enters when RSI turns back from overbought/oversold | S | Core |
| Stochastic Slow Strategy | %K/%D crossover in overbought/oversold zones | S | Medium |
| Supertrend Strategy | Enters/reverses on a Supertrend direction change | S | High |
| Technical Ratings Strategy | Trades based on the Technical Ratings signal | M | Low |
| Volty Expan Close Strategy | Stop order at a multiple-of-ATR distance | S | Low |

Note: "only one strategy runs at a time on a chart" (current Strategy Report behavior).

---

## 3. Pine Script v6 language

### 3.1 Script structure

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| `//@version=6` | Selects the compiler version; without it an older version is assumed | S | Core |
| Declaration: `indicator()` / `strategy()` / `library()` | Script type and global settings (overlay, precision, format, max_*_count, max_bars_back, timeframe, calc_bars_count, behind_chart) | M | Core |
| Comments and annotations | `//`, `//@function`, `//@param`, `//@returns`, `//@strategy_alert_message` | S | Medium |
| Line wrapping | Line continuation with an indent that is not a multiple of 4; multiline strings (2026) | S | High |
| Indentation-based blocks | Blocks are defined by 4-space/tab indentation (like Python) | M | Core |

### 3.2 Type system

It has two independent axes: the **qualifier** (when the value is determined) and the **type** (the data type).

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Qualifiers: `const` < `input` < `simple` < `series` | const = compile time; input = from settings; simple = fixed at bar zero; series = may change on every bar. Rule: a stronger qualifier cannot take the place of a weaker one | L | Core |
| Fundamental types: `int`, `float`, `bool`, `color`, `string` | int converts to float automatically; in v6 implicit int/float to bool conversion was removed | M | Core |
| `na` | The "not available" value for int/float/color/string and references; in v6 bool no longer takes na | M | Core |
| Special types: `plot`, `hline`, `line`, `label`, `box`, `table`, `linefill`, `polyline`, `chart.point` | Handles to drawing objects | M | Core |
| `void` | Return type of functions with no output | S | Core |
| Tuples `[a, b] = f()` | Returning multiple values | S | Core |
| `array<T>` | Dynamic array (up to 100,000 elements); negative indices in v6 | M | High |
| `matrix<T>` | Two-dimensional matrix with linear algebra operations (inv, det, eigen, mult…) | L | Medium |
| `map<K, V>` | Dictionary with insertion order (up to 50,000 pairs); keys only of primitive types | M | Medium |
| User-defined types (`type`) | Creates a struct with fields and default values; `.new()`, `.copy()`; reference behavior | L | High |
| Methods (`method`) | Functions called with `obj.fn()` syntax on a specific type; built-in methods for array/matrix/map/line/... | M | High |
| Enums (`enum`) | Enumeration type with fields and titles; `input.enum()` for a dropdown (June 2024) | M | Medium |
| Type casting | `int()`, `float()`, `bool()`, `color()`, `string()`, `line()`… | S | Core |
| `footprint` / `volume_row` | Footprint data from `request.footprint()` (2026) | L | Low |

### 3.3 Variables and control flow

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Declaration `x = …` | Defines a variable; re-initialized on every bar | S | Core |
| Reassignment `:=` and `+= -= *= /= %=` | Changes the value of an existing variable | S | Core |
| `var` | Initialized only once (first bar); the value is kept across bars | M | Core |
| `varip` | Like var, but is not rolled back between realtime ticks either | M | Medium |
| Explicit type keyword `float x = na` | Specifies the type when it cannot be inferred from the value | S | Core |
| History operator `x[n]` | Value n bars ago (history buffer of 5,000 / 10,000) | L | Core |
| `if / else if / else` | Both a statement and an expression (returns a value) | S | Core |
| `switch` (with/without an expression) | Multi-branch selection, an expression | S | High |
| `for i = a to b by s` | Counting loop; the end bound is evaluated on every iteration (2025) | S | Core |
| `for x in arr` / `for [i, x] in arr` | Iterating over an array/matrix/map | S | High |
| `while` | Conditional loop | S | High |
| `break` / `continue` | Loop control | S | High |
| Ternary `c ? a : b` | Inline conditional | S | Core |
| Operators | Arithmetic, comparison, `and`/`or`/`not` (short-circuit in v6), `[]` | S | Core |
| `once` | A conditional block that runs only once (August 2026) | S | Low |

### 3.4 Functions, libraries, namespaces

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| User functions `f(x, y) => …` | Single-line or multiline; default parameters; optional parameter types | M | Core |
| Overloading | Multiple functions with the same name and different signatures | M | Medium |
| Function scope rules | User functions are global; nested/recursive functions are not allowed; each call-site has its own separate history | L | Core |
| `library()` + `export` | Publishing functions, types, methods, enums and constants (2025) | L | Medium |
| `import user/lib/version as alias` | Using a published library at a specific version | L | Medium |
| Namespaces | `ta`, `math`, `str`, `array`, `matrix`, `map`, `request`, `input`, `strategy`, `syminfo`, `timeframe`, `ticker`, `color`, `chart`, `barstate`, `session`, `log`, `runtime`, `label`, `line`, `box`, `table`, `polyline`… | — | — |

### 3.5 Key built-ins

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Built-in series | `open high low close volume time time_close bar_index last_bar_index hl2 hlc3 ohlc4 hlcc4` | S | Core |
| `barstate.*` | isfirst, islast, ishistory, isrealtime, isnew, isconfirmed, islastconfirmedhistory | S | Core |
| `syminfo.*` | ticker, tickerid, mintick, pointvalue, currency, type, session, timezone and fundamental data | M | High |
| `timeframe.*` | period, multiplier, isintraday/isdaily/…, `in_seconds()`, `change()`, `from_seconds()` | S | High |
| `ta.*` (~60 functions) | sma, ema, rma, wma, vwma, hma, alma, swma, linreg, rsi, macd, stoch, cci, mfi, atr, tr, bb, bbw, kc, kcw, dmi, sar, supertrend, mom, roc, change, cum, highest/lowest, highestbars/lowestbars, crossover/crossunder/cross, rising/falling, pivothigh/pivotlow, valuewhen, barssince, stdev, variance, dev, median, mode, percentrank, percentile_*, correlation, cog, cmo, tsi, wpr, vwap, obv/accdist/pvt/nvi/pvi/wad/wvad/iii (variables), range, max/min | L | Core |
| `math.*` | abs, max, min, round, round_to_mintick, floor, ceil, pow, sqrt, log, log10, exp, sin…atan, avg, sum, sign, random, todegrees, pi/e/phi | S | Core |
| `str.*` | tostring (with format), tonumber, format, format_time, length, substring, contains, pos, replace/replace_all, split, upper/lower, startswith/endswith, match (regex), repeat, trim | M | High |
| `color.*` | Constants, `color.new()`, `rgb()`, `from_gradient()`, `r/g/b/t()` | S | Core |
| `input.*` | int, float, bool, string (with options), color, source, symbol, timeframe, session, time, price, text_area, enum; parameters group, inline, tooltip, confirm, display, active | M | Core |
| `request.security()` | Fetches the value of an expression from another symbol/timeframe with `gaps` and `lookahead` | L | High |
| `request.security_lower_tf()` | An array of intrabar values | L | Medium |
| Other `request.*` | currency_rate, dividends, splits, earnings, financial, economic, quandl/seed, footprint; in v6 "dynamic" (callable in loops with a series string) | L | Low |
| `plot()` | Draws a series (line, stepline, histogram, columns, area, circles, cross, with dynamic color, offset, linestyle) | M | Core |
| `plotshape()` / `plotchar()` / `plotarrow()` | Marks on candles | M | Core |
| `plotcandle()` / `plotbar()` | Draws custom candles/bars | M | Medium |
| `hline()` + `fill()` | Horizontal line and coloring between two plots/hlines | S | Core |
| `bgcolor()` / `barcolor()` | Background color / candle color | S | Core |
| `label.*` | Text/label at any point with style, size, tooltip, xloc | M | High |
| `line.*` | Line segment with extend, style, width | M | High |
| `box.*` | Rectangle with text inside | M | Medium |
| `table.*` | Fixed table at the chart corners (maximum 9) | M | High |
| `linefill.*` | Fills between two lines | S | Low |
| `polyline.*` + `chart.point` | Polygon/curve from an array of points (maximum 100 objects) | M | Low |
| `alertcondition()` | Defines an alert condition the user picks from the alert dialog (indicator only) | M | High |
| `alert()` | Sends a dynamic alert with text built at runtime (indicator and strategy) | M | High |
| `log.info/warning/error()` | Message to the Pine Logs panel with the bar time | S | Medium |
| `runtime.error()` | Stops the script with an error message | S | Medium |
| `fixnan()`, `nz()`, `na()` | na handling | S | Core |
| `time()`, `timestamp()`, `year/month/…`, `session.*` | Working with time and sessions | M | High |
| `ticker.*` | Builds Heikin Ashi/Renko/... or modified tickers for request | M | Low |

### 3.6 strategy.* API

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| `strategy.entry()` | Long/short entry; automatically reverses the opposite position; market/limit/stop/stop-limit | L | Core |
| `strategy.order()` | Raw order without reverse; nets against the current position | M | High |
| `strategy.exit()` | TP/SL/trailing (trail_price, trail_points, trail_offset), profit/loss in ticks, qty/qty_percent, from_entry; orders form one OCA group | L | Core |
| `strategy.close()` / `close_all()` | Close with a market order | S | Core |
| `strategy.cancel()` / `cancel_all()` | Cancel pending orders | S | High |
| `strategy.risk.*` | allow_entry_in, max_cons_loss_days, max_drawdown, max_intraday_filled_orders, max_intraday_loss, max_position_size | M | Low |
| `oca_name` / `oca_type` | OCA groups: cancel, reduce, none | M | Medium |
| State variables | position_size, position_avg_price, position_entry_name, equity, netprofit, grossprofit, grossloss, openprofit, max_drawdown, max_runup, wintrades, losstrades, eventrades, initial_capital, margin_liquidation_price, avg_* | M | High |
| `strategy.opentrades.*` / `closedtrades.*` | Per-trade data by index (entry/exit price/time/bar/id/comment, profit, commission, max_runup/drawdown, size) | M | High |
| `strategy.convert_to_account/symbol()` | Currency conversion | S | Low |
| `strategy()` parameters | initial_capital, currency, default_qty_type (`fixed` / `cash` / `percent_of_equity`), default_qty_value, pyramiding, commission_type (`percent` / `cash_per_contract` / `cash_per_order`), commission_value, slippage (ticks), margin_long/short, close_entries_rule (FIFO/ANY), calc_on_order_fills, calc_on_every_tick, calc_on_every_history_tick (2026), process_orders_on_close, use_bar_magnifier, fill_orders_on_standard_ohlc, backtest_fill_limits_assumption, risk_free_rate | L | Core |

### 3.7 Execution model

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Bar-by-bar execution | The whole script runs once for each historical candle from left to right; each series has a history buffer | L | Core |
| Realtime + rollback | On the open candle, it runs on every tick; before each run, variables roll back to the previous candle's state (rollback); it commits when the candle closes | L | High |
| `var` / `varip` semantics | var is not exempt from rollback but is not reset either; varip is exempt from rollback too | M | High |
| Repainting | Difference between historical and realtime behavior (lookahead, security on the open candle, calc_on_every_tick) | — | High (documentation) |
| `max_bars_back` inference | The compiler guesses the required history depth; if it is too small, a runtime error and a re-run occur | M | Medium |
| Strategy execution | Default: once at candle close; orders fill at the next candle's open (broker emulator) | L | Core |
| Broker emulator intrabar path | Without Bar Magnifier: if the open is closer to the high, the path open→high→low→close is assumed, otherwise open→low→high→close; gaps between candles fill at the next open | M | Core |

### 3.8 Limits

| Item | Value |
|---|---|
| Compile time | 2 minutes (3 consecutive warnings → one-hour ban) |
| Total execution time | 20 seconds (basic) / 40 seconds (other plans) |
| Time per loop on one bar | 500 ms |
| plot count | 64 per script (one call counts up to 7) |
| line/box/label | Default 50, maximum 500; polyline maximum 100; table maximum 9 |
| Unique `request.*` | 40 (Ultimate: 64); footprint only 1; intrabar up to 100K–200K; tuple total 127 |
| Compiled tokens | 100,256 per script; 1 million with libraries |
| Variables per scope | 1,000 |
| collections | 100,000 elements; map 50,000 pairs |
| History buffer | 5,000 (OHLC and time: 10,000) |
| Drawings with xloc.bar_index | 10,000 bars back, 500 bars forward |
| String length | 40,960 characters |
| Backtest orders | 9,000 (v6 trims the oldest); Deep Backtesting up to 1 million |
| Chart candles | 5K to 40K depending on the plan |

### 3.9 Suggested MVP subset for the first Pine interpreter

MVP goal: run unmodified about 80% of simple community scripts and all the Core indicators of section 1.

**Phase 1 — core (must have):**
1. Lexer/parser with indentation blocks, line wrapping, comments; only `//@version=6`.
2. `indicator()` and `strategy()` (no `library`).
3. Basic types: int, float, bool, color, string + `na`; keep qualifiers **simple**: everything is series, with only the necessary input/const checks on specific parameters (such as length in ta.*). Postpone the full qualifier system.
4. Variables, `:=`, compound operators, `var`, tuples, ternary, `if`/`switch` as expressions, `for`, `while`, `break/continue`.
5. History operator `[]` with a ring buffer for each series and each function call-site.
6. Single-line/multiline user functions with independent state per call-site (this is the key to making `ta.*` work correctly inside functions).
7. Built-in series and `barstate.*`, `syminfo.mintick/ticker`, `timeframe.period`.
8. `ta.*` (about 35 commonly used functions): sma, ema, rma, wma, vwma, hma, rsi, macd, stoch, atr, tr, bb, cci, mfi, dmi, sar, supertrend, change, mom, roc, highest/lowest, crossover/crossunder/cross, pivothigh/pivotlow, valuewhen, barssince, stdev, cum, rising/falling, vwap, linreg.
9. Full `math.*` (it is simple), `nz`, `na`, `fixnan`, `str.tostring`, basic `str.format`.
10. `input.*`: int, float, bool, string(options), color, source, timeframe, symbol + `group/inline/tooltip` → automatic generation of the Settings panel.
11. Output: `plot` (line/histogram/area/circles/columns/stepline), `plotshape`, `plotchar`, `hline`, `fill`, `bgcolor`, `barcolor`.
12. `alertcondition()` and `alert()`.
13. `strategy.entry/exit/close/close_all/cancel` + a simple broker emulator (fill at the next open, limit/stop along the OHLC path) + the parameters initial_capital, default_qty_type, pyramiding, commission, slippage + the variables position_size/equity/netprofit.

**Phase 2:** `label`/`line`/`box`/`table` (with count caps), `array` + methods, `request.security()` (without lookahead at first), realtime rollback and `varip`, `log.*`, full `str.*`, `strategy.opentrades/closedtrades.*`, Bar Magnifier.

**Phase 3 (postpone):** UDT, user methods, `map`, `matrix`, `enum`, `library/import`, `polyline`, fundamental/economic request.*, footprint, `strategy.risk.*`, advanced OCA, margin call, dynamic requests, the full qualifier system and its precise error messages.

**Suggested architecture decision:** a tree-walking interpreter or compilation to JS (closures) in a worker; each call-site has its own state "slot"; bar-by-bar execution over columnar OHLCV arrays. Compatibility test: compare the SMA/EMA/RSI/MACD outputs with reference values (note: RSI and ATR in TradingView use RMA, not a plain EMA).

---

## 4. Pine Editor and ecosystem

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Code editor | Editor with syntax highlighting, which since 2025 lives in a side panel or a separate (detached) window connected to the chart tab | M | Core |
| Autocomplete | Suggests namespaces/functions/parameters, snippets, auto-closing parentheses (2026) | M | High |
| Inline docs / hover | Shows a function's signature and description on hover or Ctrl+click to the reference manual | M | Medium |
| Error/warning highlighting | Compile errors on the line and in the console; non-blocking warnings | M | Core |
| Add to chart / Update | Compile and add/reset on the chart with one button | S | Core |
| Save / Open / Version history | Saving to the user's account and a version history with the ability to revert | M | High |
| Templates (New indicator/strategy/library) | Start from a template | S | Medium |
| Convert to v6 | Automatic migration from older versions | L | Low |
| Word wrap, find/replace, command palette, multi-cursor | Editor features (Monaco-like) | S | Medium |
| Pine Logs panel | Shows `log.*` messages with level filter, search and jump to bar | M | Medium |
| Pine Profiler | Profiled run showing the time/execution count of each line next to the code (May 2024) | L | Low |
| Publish script | Publishing to Community Scripts with a title, description, sample chart, category; subject to House Rules and moderation | L | Medium |
| Visibility: Open-source / Protected / Invite-only | Open source; hidden source but free to use; invited users only (needs a paid plan) | M | Medium |
| Public vs private publish | Public publishing or link-only | S | Low |
| Library publishing | Publishing a library with automatic versioning for import | M | Low |
| Pine Screener | Runs an indicator (from favorites) over a watchlist/index and filters by its plots; columns = plots | L | Medium |
| Script settings dialog (auto-generated) | Inputs / Style / Visibility tabs generated from inputs and plots | M | Core |
| Data Window / status line values | Shows plot values at the candle under the cursor | S | Core |

---

## 5. Strategy Tester (now "Strategy Report")

### 5.1 Current UI layout

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Report panel (bottom of the screen) | Opens when a strategy is added; one strategy per chart | M | Core |
| Metrics / Overview | Equity curve + summary (Total P&L, max drawdown, percent profitable, profit factor) | M | Core |
| Buy & hold toggle | Draws the buy-and-hold equity on the same chart | S | High |
| Trades run-up & drawdown toggle | Shows each trade's MFE/MAE on the chart | S | Medium |
| Hover tooltip | Trade number and type, cumulative P&L, time, buy & hold value | S | High |
| Date range selector | Limits the report's calculation range | M | High |
| Performance analysis (5 sub-tabs) | Breakdown, Periodical (monthly/yearly), Benchmarking (versus buy & hold), Margin usage, Growth and decline | L | Medium |
| Trades analysis (3 sub-tabs) | Distribution (return histogram), Streaks (win/loss streaks), Time patterns (hour/weekday/month) | L | Medium |
| List of trades | Table: number, type, entry and exit date/time, signal (id/comment), price, size, Net P&L, Run-up, Drawdown, cumulative P&L; sortable | M | Core |
| Properties | Summary of the strategy's settings and inputs and the symbol | S | High |
| Long / Short / All columns | All metrics for total, long and short separately | S | High |
| Export | Export of trade/metric data (CSV/Excel) from the strategy menu | S | High |
| Trade markers on chart | Entry/exit arrows with id and size labels on the chart | M | Core |

### 5.2 All metrics (53 official ones)

| Group | Metrics |
|---|---|
| Returns | Initial capital, Open P&L, Net P&L, Gross profit, Gross loss, Profit factor, Commission paid, Expected payoff, Buy & hold P&L, Buy & hold % gain, Strategy outperformance, Annualized return (CAGR), Return on initial capital |
| Risk-adjusted | Sharpe ratio, Sortino ratio (based on risk_free_rate and monthly returns) |
| Trades | Total trades, Total open trades, Total winners, Total losers, Even trades, Percent profitable, Average P&L, Average profit, Average loss, Avg profit / avg loss, Largest profit (+ % of gross profit), Largest loss (+ % of gross loss), Average bars in trades / winners / losers, Max contracts held |
| Capital efficiency | Account size required, Return on account size required, Net profit as % of largest loss, Average margin used, Max margin used, Margin efficiency, Margin calls, Total liquidated volume, Largest liquidated volume |
| Run-up | Average run-up duration (close-to-close), Average run-up (c2c), Max run-up (c2c), Max run-up (intrabar), Max run-up as % of initial capital |
| Drawdown | Average drawdown duration (c2c), Average drawdown (c2c), Max drawdown (c2c), Max drawdown (intrabar), Max drawdown as % of initial capital, Return of max drawdown |

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Core metrics (Net P&L, Gross, PF, Win rate, Max DD, Total trades, Avg trade, Buy&hold) | Simple formulas over the trade list and equity | S | Core |
| Sharpe / Sortino / CAGR | Statistics over periodic returns | S | High |
| Run-up/drawdown close-to-close and intrabar | Requires tracking equity on every bar with high/low | M | High |
| Margin metrics and margin call | Simulates margin and liquidation (4 times the coverage amount) | L | Low |

### 5.3 Settings (Properties)

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Initial capital + Base currency | Starting capital and account currency (converted at the previous day's rate) | S | Core |
| Order size | Contracts / Cash (USD) / % of equity | S | Core |
| Pyramiding | Maximum number of same-direction entries | S | Core |
| Commission | Percent / Cash per contract / Cash per order | S | Core |
| Slippage | Number of ticks in the unfavorable direction | S | High |
| Margin long / short (Leverage) | Margin percentage; 100% = no leverage | M | Medium |
| Limit order execution | "Requested price" or "Requested price and 1 tick beyond" (`backtest_fill_limits_assumption`) | S | Medium |
| Script execution mode | On bar close, On every tick (realtime), After order is filled (`calc_on_order_fills`), On every history tick (higher plan) | M | High |
| Order execution delay | Artificial delay to simulate latency | M | Low |
| Bar detalization (Bar Magnifier) | Fills using lower-timeframe data; cap of 200K intrabar bars | L | Medium |
| Fill orders on standard OHLC | On Heikin Ashi and non-standard charts, fills at real prices | M | Medium |
| Process orders on close | Fills at the same close instead of the next open | S | High |
| Deep Backtesting | Server-side run over the full history (up to 2M bars and 1M trades) with a date range; in the report only, not on the chart; Update report button | L | Medium |
| Inputs / Style tabs | Same as indicators | S | Core |

### 5.4 Forward testing / Paper trading

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Realtime forward test | The strategy keeps running on live candles and new trades are added to the report | M | High |
| Strategy alerts | Alert on an order-fill event with placeholders (`{{strategy.order.action}}`, `{{ticker}}`…) and a configurable default message; for webhooks and automation | M | High |
| Paper Trading | A separate virtual account in the Trading Panel; the strategy does not trade directly, the connection is through alerts/webhooks or manual | L | Medium |

---

## 6. Gaps and unconfirmed items

- The full indicator list in the Help Center has no listed article for the Volume Profile tools, candlestick patterns, and chart patterns; these sections were completed from a mix of support articles and general platform knowledge, and must be checked against the real Indicators dialog.
- Several indicators (Accelerator Oscillator, Standard Deviation, Volume Oscillator, Price Oscillator, Market Facilitation Index, Compare/Ratio/Spread) were not in the official folder but exist, or used to exist, in the dialog; verify before implementing.
- The exact Sharpe/Sortino formula in TradingView (monthly interval, annualization) was not found in the sources read.
- The export file format (CSV or XLSX) and its plan limits were not confirmed.
- The details of Pine Screener (maximum symbols, plans) were only superficially checked.
- In 2026 the Strategy Tester changed to "Strategy Report" with a new UI; the old names (Overview / Performance Summary / List of Trades / Properties) are still present in much of the documentation.

---

## Sources

- Built-in indicators folder — https://www.tradingview.com/support/folders/43000587405-built-in-indicators/
- Built-in strategies folder — https://www.tradingview.com/support/folders/43000587406-built-in-strategies/
- Consecutive Up/Down Strategy — https://www.tradingview.com/support/solutions/43000599836-consecutive-up-down-strategy/
- Automatic candlestick pattern detection — https://www.tradingview.com/support/solutions/43000584462-automatic-candlestick-pattern-detection/
- Auto chart patterns — https://www.tradingview.com/support/solutions/43000690464-what-are-chart-patterns
- Strategy report metrics folder — https://www.tradingview.com/support/folders/43000599093-strategy-report-metrics/
- Strategy Report: How to start — https://www.tradingview.com/support/solutions/43000764138-tradingview-strategy-report-how-to-start/
- Strategy tester metrics explained — https://www.tradingview.com/support/solutions/43000681683-strategy-tester-metrics-and-data-explained/
- Max run-up (intrabar) — https://www.tradingview.com/support/solutions/43000682585/
- How Deep Backtesting works — https://www.tradingview.com/support/solutions/43000666265-how-deep-backtesting-works/
- Deep Backtesting is out of beta (blog) — https://www.tradingview.com/blog/en/deep-backtesting-is-out-of-beta-41158
- Bar Magnifier (blog) — https://www.tradingview.com/blog/en/accurate-backtesting-with-bar-magnifier-31746
- Bar Magnifier backtesting mode — https://www.tradingview.com/support/solutions/43000669285-what-s-bar-magnifier-backtesting-mode/
- Strategies, backtesting and forward testing — https://www.tradingview.com/support/solutions/43000562362-what-are-strategies-backtesting-and-forward-testing/
- Pine Script docs: Strategies — https://www.tradingview.com/pine-script-docs/concepts/strategies/
- Pine Script docs: Limitations — https://www.tradingview.com/pine-script-docs/writing/limitations/
- Pine Script docs: Release notes — https://www.tradingview.com/pine-script-docs/release-notes/
- Pine Script v6 reference — https://www.tradingview.com/pine-script-reference/v6/
