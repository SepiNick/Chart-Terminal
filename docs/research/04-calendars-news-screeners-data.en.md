[English](04-calendars-news-screeners-data.en.md) · [فارسی](04-calendars-news-screeners-data.md)

# 04 — Market Data Products: Calendars, News, Screeners, Heatmaps, Fundamentals, Social + Data Sources

> Goal: document the **behavior** of TradingView features for a clean-room rebuild. No code or long text has been copied from TradingView; everything is rewritten.
> Research date: 2026-10-13. Free-tier numbers come from official or secondary sources; items marked **(verify)** must be re-checked on the official page before implementation, since these numbers change often.

Column guide: **Complexity**: S = a few days, M = one to two weeks, L = several weeks or more / depends on paid data. **Priority**: P0 = required for the MVP, P1 = second release, P2 = later/optional.

---

## 1. Calendars

### Behavior in TradingView
- **Economic calendar**: a chronological list of economic events (CPI, interest rate, NFP, GDP, PMI, etc.). Each row: time, country (flag), event name, importance level, **Actual / Forecast / Prior**, unit. Filters:
  - **Region/Country**: pick several countries or "the whole world";
  - **Importance**: a "high importance only" toggle;
  - **Categories**: interest rates, inflation, bonds, employment, housing, energy, production, foreign sector, etc. (default: all);
  - **Period**: yesterday / today / tomorrow / this week / upcoming;
  - **Time zone**: converts the displayed times.
  - Clicking an event shows: a description of the indicator, the official source, and a historical chart of that indicator (each event is linked to an economic symbol such as `USCPI`).
- **Earnings calendar**: companies reporting within the selected range; columns: symbol, Market cap, EPS estimate / reported, Revenue estimate / reported, surprise, time (before market/after market), fiscal period. Filters by country/exchange, date range, and "my watchlist only".
- **Dividends calendar**: symbol, ex-date, payment date, amount per share, dividend yield, frequency.
- **IPO calendar**: upcoming/recent initial public offerings; company, exchange, proposed price range, number of shares, offering value, date.
- **Events on chart**: small markers on the chart's time axis for Earnings (E), Dividends (D), Splits (S), and economic events of the relevant country; hover → details (estimated/actual EPS, dividend amount, split ratio). Can be toggled on/off from chart settings. "Upcoming" events appear as faded markers in the future area of the chart.

### Feature table

| Feature | What it does | Data source(s) to rebuild | Complexity S/M/L | Priority |
|---|---|---|---|---|
| Economic calendar (list + country/importance/category/period/time zone filters) | Event table with Actual/Forecast/Prior | ForexFactory weekly JSON (unofficial), FMP economic calendar, Finnhub economic calendar (premium), FRED `releases/dates` for scheduling + FRED/BLS/BEA for Actual | M | P0 |
| Forecast (consensus) in the economic calendar | Market forecast value | **Gap**: consensus is mostly proprietary (Trading Economics/Investing/Bloomberg). Free only from the ForexFactory JSON or FMP | L | P1 |
| Event detail page + indicator history chart | Event link → indicator time series | FRED API (thousands of US and international series), DBnomics, World Bank, ECB Data Portal | M | P1 |
| Earnings calendar | List of reports with EPS/Revenue estimate vs actual | Finnhub `/calendar/earnings` (free), FMP earnings calendar, Nasdaq api (unofficial), Alpha Vantage `EARNINGS_CALENDAR` (CSV) | M | P0 |
| Dividends calendar | ex-date / pay date / amount / yield | Massive (Polygon) free: corporate actions (dividends), FMP dividends calendar, Nasdaq api (unofficial), Yahoo (unofficial) | S | P1 |
| IPO calendar | Upcoming offerings | Finnhub `/calendar/ipo` (free), Nasdaq api (unofficial), FMP, Alpha Vantage `IPO_CALENDAR` | S | P2 |
| Splits | Split ratio and date | Massive free (splits), Yahoo events, Finnhub (premium) | S | P1 |
| Events on chart (E/D/S + economic) | Markers on the chart time axis | Combination of the data above + a render layer on the chart (markers API in lightweight-charts) | M | P0 |
| "Watchlist only" filter in calendars | Client-side filter | Internal (join with watchlist) | S | P1 |
| Iran market calendar (general meetings, capital increases, cash dividends) | Corporate events of the Tehran Stock Exchange | codal.ir (announcements: meeting notices, dividend distribution, capital increases) — semi-public scraping/API | M | P1 |

---

## 2. News & Community

### Behavior in TradingView
- **News Flow**: a full-page news view with a filter panel above the list. Filters: **Watchlist**, **Symbol**, **Market** (stocks, crypto, forex, futures, bonds, economy), **Corporate news** (earnings, M&A, insider, analyst, etc.), **Region**, **Provider**. Several filters can be combined; with no filter, all news in the user's language is shown.
- **Providers**: TradingView claims more than 100 sources; including Dow Jones Newswires (added in 2023: Equity Trader, Commodity Trader, Global News Select), Reuters, Benzinga, MarketWatch, Zacks, Cointelegraph, CoinDesk, newsbtc, and TradingView's own produced news (summaries). Some providers (such as Dow Jones) are real-time only for paid plans.
- **Top stories / Editor's picks**: grouped important news (e.g. "5 hot stories"); in the mobile app, sorted by top stories, asset class, global economy.
- **Symbol news**: on the symbol page and the chart's side panel, news related to that symbol; in the watchlist, a "new news" icon next to the symbol.
- **News on chart**: a marker on the chart at the publication time of news related to the symbol (can be turned off).
- **News alerts**: real-time alert for new news on a symbol/watchlist.
- **Ideas**: medium-length analysis posts built around a chart snapshot (long/short direction, timeframe, description); likes (boost), comments, follow, showing an old idea on the live chart (the idea's "play"). Filters by market, timeframe, "all / followed / mine", Editor's picks.
- **Minds**: a short per-symbol discussion feed (similar to tweets) in the Discussions/Minds tab of the symbol page; posting from the chart's Publish menu ("Speak your mind"). At launch, posting was only for paid plans (verify).
- **Streams**: live streaming of the screen/chart by eligible users (beta).
- **Community scripts**: a library of published Pine scripts (open/protected/invite-only).
- **Chats / Private messages**, **Profile** with followers, reputation.
- **Newsletter**: a weekly email (Weekly digest, Mondays) containing selected ideas, top scripts, the earnings and economic calendar; can be enabled from Profile settings → Notifications.

### Feature table

| Feature | What it does | Data source(s) to rebuild | Complexity S/M/L | Priority |
|---|---|---|---|---|
| News Flow (list + market/region/provider/symbol filters) | News aggregator with symbol tags | RSS (CoinDesk, Cointelegraph, SEC EDGAR, Fed, ECB), Finnhub company/market news (free), Alpaca News API (Benzinga, with a free account), Marketaux, CryptoPanic, NewsAPI (dev only) | M | P0 |
| News symbol tagging | Assigning news to symbols | From provider metadata (Finnhub/Alpaca/CryptoPanic have tags) + simple NER on headlines for RSS | M | P0 |
| Symbol news (symbol page/chart panel) | Filter by symbol | Same pipeline | S | P0 |
| News on chart | News marker on the time axis | Same pipeline + markers | S | P1 |
| Top stories | Important news | Internal algorithm (number of covering sources/engagement) or manual curation | M | P2 |
| News alerts | New-news alert | Internal WebSocket + notification | M | P1 |
| Persian news / Iran market | Stock exchange and currency news | News agency RSS (e.g. Eghtesadnews, Donya-e-Eqtesad — check licensing), codal.ir announcements | M | P1 |
| Ideas (analysis post with chart snapshot) | Idea social network | Internal: DB + storing chart state (JSON drawings) | L | P1 |
| Minds (per-symbol feed) | Short per-symbol posts | Internal | M | P2 |
| Streams | Live streaming | Third-party service (LiveKit/WebRTC) | L | P2 |
| Community scripts library | Script publishing | Internal (depends on our script engine) | L | P2 |
| Newsletter | Weekly email | Internal + email service (Resend/SES) | S | P2 |

---

## 3. Screeners, Heatmaps, Fundamentals

### Screener behavior in TradingView
Types: **Stock**, **ETF**, **Bond**, **Crypto coins**, **CEX pairs** (trading pairs of centralized exchanges), **DEX pairs** (pools of decentralized exchanges), **Forex** (in newer versions folded into CEX/forex), and **Pine Screener**.

Shared behavior:
- A table with selectable columns; ready-made **Column sets** (Overview, Performance, Valuation, Dividends, Profitability, Income statement, Balance sheet, Cash flow, Technicals, Extended hours …) and saving a custom layout.
- **Filters** as pills above the table: operators above/below/between/crosses/equal, comparing two fields with each other (e.g. Price > SMA50), a timeframe for technical fields.
- **Saved screens**, Universe (country/exchange/watchlist/index), sorting, export to CSV, automatic refresh (real-time for paid plans), clicking a row → opens the chart (synced with the chart in the layout).
- **Stock**: Price, Change %, Volume, Rel Volume, Market cap, P/E, EPS dil TTM, EPS growth, Div yield, Sector, Industry, Analyst rating, Perf (1W/1M/3M/6M/YTD/1Y), Volatility, Beta, ROE, Gross margin, Debt/Equity, Free cash flow, Technical Rating, RSI, MACD, MAs, Patterns, pre/post market, Upcoming earnings date.
- **ETF**: AUM, Expense ratio, Asset class, Focus, Issuer, NAV, Premium/discount, Holdings count, Fund flows, Dividend yield, Performance.
- **Bond**: Coupon, Yield to maturity, Maturity date, Issuer, Credit rating (in some markets), Outstanding amount, Current yield, Duration (when available), type (government/corporate).
- **Crypto coins**: Rank, Price, Market cap, FD market cap, Circulating/Total/Max supply, Volume 24h, Change %, Category (DeFi, Layer 1, Meme…), Social dominance, Technical rating.
- **CEX pairs**: symbol/exchange, Price, Change, Volume 24h (base/quote/USD), Volatility, Technicals.
- **DEX pairs**: network (chain), DEX, Liquidity (pool TVL), Volume 24h, Transactions/Txns, Buyers/Sellers, FDV, Pool age, Price change.
- **Pine Screener** (Premium and above): runs **one** Pine indicator across all symbols of a watchlist; columns = the indicator's plots, filters = plots or alertconditions; fixed timeframes (1/5/15/30m, 1/2/4h, 1D/1W/1M); indicator-on-indicator is not supported.

### Heatmaps
- **Stock heatmap**: a treemap grouped by Sector→Industry; universe: an index or a whole country. **Cell size**: Market cap, Volume, FD market cap, Turnover, or uniform (mono). **Cell color**: Change %, Performance (W/M/…), pre/post market change, volume change, Rel Volume, Volatility, Gap, Beta. Zoom into a section, tooltip, click → chart, color-blind/monochrome mode.
- **ETF heatmap**: grouped by asset class/focus; size: AUM/Volume/Turnover/mono.
- **Crypto heatmap**: universe: all / excluding BTC / excluding stablecoins / DeFi; size: market cap / volume.

### Technical Ratings (the "Technicals" gauge)
- Two groups: **Moving averages** (15 items: SMA and EMA of lengths 10/20/30/50/100/200, Hull MA 9, VWMA 20, Ichimoku 9/26/52) and **Oscillators** (11 items: RSI 14, Stoch 14/3/3, CCI 20, ADX 14, AO, Momentum 10, MACD 12/26/9, Stoch RSI, Williams %R 14, Bull Bear Power, Ultimate Oscillator).
- Each indicator votes −1/0/+1 (e.g. MA below price = buy; RSI below 30 and rising = buy). The average of each group lies in [−1, +1]; the overall score = the average of the two groups. Mapped to five labels Strong Sell/Sell/Neutral/Buy/Strong Buy (thresholds are in the official Help Center; commonly ±0.1 and ±0.5 — **verify**).
- A gauge for each timeframe (1m to 1M) and a table counting Buy/Neutral/Sell for each group. **Fully computable from OHLCV** — no paid data needed.

### Seasonals
- Each year is one line on a January→December axis; a slider to choose years, a percentage mode (change since the start of the year), an average line (dashed), a snapshot. A small 3-year version in the Overview tab of the symbol page. **Computable from daily OHLCV.**

### Fundamentals
- **Financials** on the symbol page: Income statement, Balance sheet, Cash flow; annual/quarterly; bar chart + table; Statistics (ratios), Dividends, Earnings (historical EPS/Revenue + future estimate, surprise), Revenue breakdown by segment/geography.
- **Fundamental graphs**: plotting any fundamental metric (e.g. P/E, Revenue, FCF) as a time series and comparing several symbols; also "Financials" as an indicator on the chart.
- **Key stats**: Market cap, P/E, EPS, Div yield, Shares float, Beta, Employees, 52W high/low, etc.
- **Analyst forecasts**: Price target (min/avg/max) with a 1-year cone chart, rating distribution (Strong buy…Strong sell) over time, quarterly/annual EPS/Revenue estimates.
- **Markets overview pages**: Indices, Futures, World markets, Currencies, Bonds, Crypto, Stocks per country pages; each page has mini-chart cards + a movers table + news.

### Feature table

| Feature | What it does | Data source(s) to rebuild | Complexity S/M/L | Priority |
|---|---|---|---|---|
| Screener engine (filter/column/sort/saved screens/CSV) | Query engine over a snapshot of all symbols | Internal: a snapshot table in the DB (Postgres/DuckDB) filled periodically | L | P0 |
| Crypto coins screener | Market cap/supply/category columns | CoinGecko `/coins/markets` (250 coins per page), CoinMarketCap listings | M | P0 |
| CEX pairs screener | All pairs of the exchanges | Binance/Bybit/OKX public (`/ticker/24hr` returns all pairs at once), CCXT for normalization, Nobitex for rial pairs | M | P0 |
| DEX pairs screener | Pools with liquidity/volume/txns | DexScreener API, GeckoTerminal API, DefiLlama (DEX volume) | M | P1 |
| Stock screener (US) | Fundamental + technical filters | Massive free (EOD + reference), FMP (stock screener endpoint, limited), SEC EDGAR XBRL for fundamentals, internal technical calculation | L | P1 |
| Stock screener (Tehran Stock Exchange) | Filtering TSE symbols | TSETMC (market watch, history, retail/institutional) + codal (financial statements) | L | P0 (for the Iranian target market) |
| ETF screener | AUM/expense ratio/... | **Gap**: little free ETF data; FMP ETF info (limited), Yahoo (unofficial), issuer files | L | P2 |
| Bond screener | yield/coupon/maturity | **Gap** for corporate bonds; US government bonds from Treasury/FRED; Iranian bonds (Akhza) from TSETMC/Farabourse | L | P2 |
| Forex screener | Currency pairs + technicals | Twelve Data, Alpha Vantage FX, Finnhub forex, ECB reference rates (daily) | M | P1 |
| Pine Screener equivalent | Running a user script over a watchlist | Internal: our script engine + OHLCV | L | P2 |
| Stock heatmap | Sector/industry treemap | Same screener snapshot + d3-hierarchy treemap | M | P1 |
| Crypto heatmap | Coin treemap | CoinGecko markets | S | P0 |
| ETF heatmap | ETF treemap | Depends on ETF data (gap) | M | P2 |
| Technical Ratings gauge | −1..+1 score from 26 indicators | Internal calculation from OHLCV (no external API) | M | P0 |
| Seasonals | Yearly lines overlaid | Internal calculation from daily OHLCV | S | P1 |
| Financials (IS/BS/CF) | Annual/quarterly financial statements | SEC EDGAR companyfacts (free, official, US), FMP (5 years limited in free), Finnhub financials-as-reported, Alpha Vantage `INCOME_STATEMENT` etc.; Iran: codal.ir | L | P1 |
| Key stats | Ratios and key statistics | Finnhub `/stock/metric` (basic financials, free), computed from EDGAR + price | M | P1 |
| Fundamental graphs | Fundamental metric time series on the chart | From the stored Financials data | M | P2 |
| Analyst forecasts | price target, rating, estimates | Finnhub recommendation trends (free), price target/estimates (premium — verify), FMP (partly free), Yahoo (unofficial). **Major gap** | L | P2 |
| Earnings (historical + surprise) | Actual vs estimated EPS | Finnhub `/stock/earnings` (free, several recent quarters), Alpha Vantage `EARNINGS` | S | P1 |
| Markets overview (Indices/Futures/World/Currencies/Crypto) | Market summary pages | Yahoo (unofficial) or Stooq (free CSV) for indices; Twelve Data; CoinGecko global; TSETMC overall/equal-weight index; tgju for Iranian gold/currency | M | P0 |

---

## 4. Other Features

### Behavior in TradingView
- **Market Movers**: lists of Top gainers, Top losers, Most active, Unusual volume, Most volatile, 52W high/low, Pre-market/After-hours gainers, Largest companies — per country and per asset class (crypto movers exist too).
- **Yield curves**: a bonds page with a yield curve chart (maturities 1M to 30Y) for major countries, comparison with a previous curve, and common spreads (2s10s). Yield symbols (such as `US10Y`) can be plotted on the chart.
- **Options** (since 2024): **Options chain** with Calls/Puts side by side, columns bid/ask/last/volume/OI/IV/Greeks (Delta, Gamma, Theta, Vega, Rho), expiration selection; **Strategy builder** with ready-made strategies (bullish/bearish/neutral filter), editing strike/expiry/quantity on the chart, P&L chart at expiration and before, max profit/loss/breakeven/probability of profit, comparing several strategies; a **Volatility** tab (IV smile/term structure); broker connection for execution.
- **Crypto market cap / dominance symbols** (prefix `CRYPTOCAP:`): `TOTAL` (the whole market), `TOTAL2` (excluding BTC), `TOTAL3` (excluding BTC and ETH), `OTHERS` (total minus coins that have their own `.D` symbol), `BTC.D`, `ETH.D`, `USDT.D`, `USDC.D`, `OTHERS.D`, etc. (percentage share). Also `TOTALDEFI`, `TOTALES` (stablecoins) and similar. These are plotted on the chart like a normal symbol (daily/intraday OHLC) and used in composite calculations (`TOTAL-TOTAL2`).

### Feature table

| Feature | What it does | Data source(s) to rebuild | Complexity S/M/L | Priority |
|---|---|---|---|---|
| Market Movers | gainers/losers/active/unusual volume | Computed from the screener snapshot; Alpha Vantage `TOP_GAINERS_LOSERS` (US), Massive snapshot (paid plan), Binance 24hr ticker, TSETMC market watch | S | P0 |
| Pre/after-market movers | Out-of-hours moves | **Gap** in the free tier (Massive/Polygon paid) | M | P2 |
| Yield curve (US) | 1M..30Y curve + comparison | US Treasury daily par yield curve (XML/CSV, public domain), FRED `DGS1MO..DGS30` | S | P1 |
| Yield curve (other countries) | International curve | ECB Data Portal (euro curve), Bank of England, central banks; Iran: Akhza yields from Farabourse | M | P2 |
| Bond yield symbols on chart (US10Y…) | Yield series as a symbol | FRED (daily) | S | P1 |
| Options chain | Chain with IV/Greeks | Tradier sandbox (15-minute delay), Alpaca indicative options feed, Yahoo options (unofficial); Greeks can be computed internally with Black-Scholes. Tehran exchange options from TSETMC | L | P2 |
| Strategy builder (P&L payoff) | Profit/loss curve of multiple legs | Internal (Black-Scholes math + payoff) — needs little live data | M | P2 |
| Crypto TOTAL/TOTAL2/TOTAL3/OTHERS | Aggregate market cap series | CoinGecko `/global` (snapshot) + `/global/market_cap_chart` (paid plan only — verify); alternative: internal computation from historical market cap of top-N coins (CoinGecko `/coins/{id}/market_chart`) and storing periodic snapshots; CoinMarketCap global-metrics historical (paid) | M | P1 |
| Dominance (BTC.D, ETH.D, USDT.D …) | Percentage share | Same: coin mcap ÷ TOTAL; current snapshot in CoinGecko `/global` (`market_cap_percentage`) | S | P1 |
| DeFi TVL / stablecoin cap symbols | DeFi series | DefiLlama (free, no key): TVL, stablecoins, DEX volume | S | P2 |

---

## 5. Data Sources

| API | Covers | Free tier & limits | Terms caveat | URL |
|---|---|---|---|---|
| **Finnhub** | US quotes, company/market news, earnings & IPO calendar, basic financials, financials-as-reported, recommendation trends, forex/crypto | Free ~60 calls/min. Economic calendar, price target, historical splits/dividends are usually **premium** (verify in docs) | Free is personal/non-commercial only; redistribution/public display requires a paid plan | https://finnhub.io/docs/api |
| **Financial Modeling Prep (FMP)** | financials, calendars (earnings/dividends/IPO/economic), screener, ratios, analyst | Basic free: 250 calls/day, EOD, ~500MB/30-day bandwidth, a subset of endpoints; Starter from ~$22/month | Display/redistribution requires a separate agreement | https://site.financialmodelingprep.com/developer/docs |
| **Alpha Vantage** | Stock/FX/crypto OHLCV, fundamentals (IS/BS/CF), earnings/IPO calendar CSV, top gainers/losers, news sentiment, economic indicators | 25 requests/day, 5/min | Free for personal use; commercial is paid (from ~$49.99/month) | https://www.alphavantage.co/documentation/ |
| **Twelve Data** | Stock/FX/crypto/ETF time series, technicals, some fundamentals | Basic: 8 credits/min, 800 credits/day; heavy fundamental endpoints (e.g. income statement = 100 credits) and some only on Grow/Pro | Basic is for personal use; public display requires a commercial plan | https://twelvedata.com/docs |
| **Massive (formerly Polygon.io)** | US stock EOD/aggregates, reference, **dividends/splits**, technicals; options/forex/crypto on paid plans | Basic: 5 calls/min, EOD + 15-minute delay, ~2 years of history; api.polygon.io and api.massive.com work in parallel | Free is non-commercial; redistribution forbidden without a license | https://massive.com/pricing |
| **Yahoo Finance (unofficial / yfinance)** | Almost everything: quote, history, financials, options, analyst, events | No key; unpublished limits; frequent 429s, especially from cloud IPs | No official API; Yahoo's ToS does not allow automated/commercial use → prototype only | (unofficial) https://github.com/ranaroussi/yfinance |
| **Stooq** | Daily OHLCV for stocks/indices/FX/commodities (CSV) | Free, no key; daily limit unclear | Commercial terms of use are unclear | https://stooq.com |
| **FRED (St. Louis Fed)** | 800k+ economic series, release dates (for the calendar), bond yields | Free with a key; ~120 requests/min | Some series carry the original source's copyright; check the source note before republishing | https://fred.stlouisfed.org/docs/api/fred/ |
| **US Treasury (Fiscal Data / yield curve)** | Daily yield curve, rates | Free, no key | Public domain | https://home.treasury.gov/resource-center/data-chart-center/interest-rates |
| **BLS / BEA** | CPI, employment, GDP (official Actual) + release schedule | BLS v2: with a key 500 queries/day; BEA with a key | Public domain | https://www.bls.gov/developers/ , https://apps.bea.gov/api/ |
| **DBnomics / ECB Data Portal / World Bank** | International macroeconomic data | Free | Generally open data (ECB with attribution) | https://db.nomics.world , https://data.ecb.europa.eu |
| **Trading Economics** | Economic calendar with forecast, indicators, news | The guest:guest account for REST is reported to no longer work (2026); the free developer key covers only limited datasets (World Bank/UN/…) — calendar and forecast are paid (Standard ~$149/month) | Proprietary data; public display only with a license | https://docs.tradingeconomics.com |
| **ForexFactory calendar feed** | Weekly calendar: title, country, date, impact, forecast, previous (actual varies) | Free, weekly JSON/XML file (`nfs.faireconomy.media/ff_calendar_thisweek.json`); updated several times per hour; too many requests → block | Unofficial, no documentation/license; legal risk for a public product — cache it and credit the source | https://nfs.faireconomy.media/ff_calendar_thisweek.json |
| **Investing.com** | Economic/earnings calendar, news, prices | No public API; scraping is protected by Cloudflare | ToS explicitly forbids scraping → **do not use** | https://www.investing.com |
| **Nasdaq (api.nasdaq.com)** | earnings/dividends/IPO/splits calendar, screener | No key, undocumented; needs browser headers | Unofficial; Nasdaq's ToS restricts automated use → prototype only | https://www.nasdaq.com/market-activity/earnings |
| **SEC EDGAR** | Filings, XBRL companyfacts/companyconcept/frames (US financial statements), new-filing RSS, insider (Form 4) | Free, no key; max 10 requests/s; a User-Agent with an email is required; daily bulk ZIP | Public domain; fair access only | https://www.sec.gov/edgar/sec-api-documentation |
| **CoinGecko** | Coins, markets, categories, global (dominance), exchanges, history | Demo (free with a key): ~30 calls/min, 10,000 calls/month, 1-year history | Attribution required; free is for non-commercial/limited use | https://docs.coingecko.com |
| **CoinMarketCap** | listings, quotes, global metrics, categories | Basic free: ~10k–15k credits/month (conflicting sources — verify), no history in free | CMC claims Basic includes commercial-use rights (verify); attribution | https://coinmarketcap.com/api/documentation/v1/ |
| **CryptoPanic** | Crypto news aggregator with coin tags and bullish/bearish votes | Developer plan (free) with limits; some parameters (search, panic sort) are Enterprise only — verify the exact cap | Link to the source and attribute; republishing full text is forbidden | https://cryptopanic.com/developers/api/ |
| **Binance public API** | All pairs: 24h ticker, klines, depth, trades; WebSocket | No key; 6000 weight/min per IP (/api); repeated violations → IP ban (2 minutes to 3 days); geo-blocked from some countries (including Iran and the US) | Market data for display is generally permitted with attribution; check the ToS | https://developers.binance.com/docs/binance-spot-api-docs |
| **Bybit public API (v5)** | spot/derivatives/options tickers, klines, OI, funding | 600 requests / 5s per IP; violation → ban ~30 minutes; similar geo-blocking | Similar to Binance | https://bybit-exchange.github.io/docs/v5/intro |
| **CCXT (library)** | A uniform wrapper for 100+ exchanges | Free (MIT); each exchange's own limits | — | https://github.com/ccxt/ccxt |
| **DexScreener** | DEX pairs across multiple chains: price, liquidity, volume, txns, FDV | Free, no key; secondary reports: ~300 req/min for pairs, ~60 req/min for profile/boost (verify) | ToS restricts commercial use/bulk republishing — verify | https://docs.dexscreener.com/api/reference |
| **GeckoTerminal** | DEX pools, pool OHLCV, trending pools | Free public API: 30 calls/min; higher limits with a CoinGecko plan | Attribution | https://apiguide.geckoterminal.com |
| **DefiLlama** | TVL, DEX volume, stablecoins, fees, yields | Free, no key (Pro paid for specific endpoints) | Open; credit the source | https://defillama.com/docs/api |
| **Messari** | Crypto metrics, research, token unlocks | Free tier status is contradictory (some sources: Lite with ~200 req/min, others: no free tier) — verify | Commercial license required | https://docs.messari.io |
| **NewsAPI.org** | General news from thousands of sources | Developer: 100 requests/day, 24-hour delay, ~1 month of history | **Development only** — use in staging/production is forbidden | https://newsapi.org/pricing |
| **Alpaca Market Data** | US stocks (IEX free), **News API (Benzinga)** REST+WS, options indicative feed | Free with an (paper) account; ~200 req/min (verify) | Data redistribution is restricted; display in a personal app is OK | https://docs.alpaca.markets/docs/about-market-data-api |
| **Marketaux** | Financial news with symbol tags and sentiment | Free ~100 requests/day (verify) | Attribution | https://www.marketaux.com |
| **RSS feeds** | CoinDesk, Cointelegraph, Decrypt, The Block, SEC press, Fed, ECB, BLS releases | Free | Headline + summary + link only; republishing full text is forbidden. **Reuters** discontinued its public RSS feeds in 2020 — there is no free alternative | https://www.coindesk.com/arc/outboundfeeds/rss/ , https://cointelegraph.com/rss |
| **Tradier (sandbox)** | Options chain with Greeks/IV, quotes | Free sandbox, 15-minute delay | Development only; production requires an account | https://documentation.tradier.com |
| **TSETMC (Tehran Stock Exchange)** | market watch, price/volume, history, retail/institutional flow history, orders, indices, options | No key; semi-public JSON endpoints (`cdn.tsetmc.com/api/...`); occasional 403s and changes without notice; libraries: `tsetmc-api` (Python), `tse-client` (Node) | Unofficial; exchange data redistribution rules (Tehran Stock Exchange Technology Management Co.) — for commercial real-time use, an authorized data feed must be purchased | http://www.tsetmc.com |
| **codal.ir** | Issuer announcements and financial statements, general meetings, dividend distribution | Semi-public JSON search (`search.codal.ir/api/search/v2/q`); financial statements in HTML/Excel — need parsing | Unofficial; keep the request rate low | https://codal.ir |
| **tgju.org** | Gold, coins, dollar and other currencies of the Iranian free market | No official public API; scraper libraries (`tgju-api-go`, `tgju_api` Python); alternative: brsapi.ir (free, no key — verify) | Scraping; for a commercial product contact tgju for a license | https://www.tgju.org |
| **Nobitex public API** | Rial/Tether crypto market: `/market/stats`, `/v2/orderbook/{symbol}`, `/v2/trades/{symbol}`, `/market/udf/history` (UDF-compatible OHLC) | Market endpoints need no key; per-endpoint rate limits are in the docs (verify) | Public data; credit the source | https://apidocs.nobitex.ir |

### Best free source per feature (recommendation)

| Feature | First choice (free) | Backup |
|---|---|---|
| Economic calendar | ForexFactory JSON + FRED release dates | FMP (250/day) |
| Earnings calendar | Finnhub | Nasdaq api / Alpha Vantage CSV |
| Dividends/Splits | Massive (Polygon) free | Yahoo / FMP |
| IPO calendar | Finnhub | Nasdaq api |
| News (stocks) | Alpaca News (Benzinga) + Finnhub | SEC EDGAR RSS, general RSS |
| News (crypto) | CryptoPanic + RSS (CoinDesk/Cointelegraph) | — |
| Crypto screener/heatmap/dominance | CoinGecko Demo | CoinMarketCap Basic |
| CEX pairs | Binance/Bybit/OKX via CCXT (+ Nobitex) | — |
| DEX pairs | DexScreener | GeckoTerminal |
| Financials US | SEC EDGAR XBRL | FMP / Finnhub as-reported |
| Financials Iran | codal.ir | — |
| Key stats | Finnhub basic financials | Computed from EDGAR |
| Technical ratings / Seasonals / Movers | Internal calculation from OHLCV | — |
| Yield curve | US Treasury + FRED | ECB |
| Options | Tradier sandbox + internal Black-Scholes | Alpaca indicative |
| Iran market (stocks/gold/currency/crypto) | TSETMC + codal + tgju + Nobitex | brsapi.ir |

### Gaps
1. **Consensus forecast** in the economic calendar — there is no stable, legal free source (only the unofficial ForexFactory).
2. **Analyst forecasts** (price target, estimates) — almost all are paid; Finnhub offers only recommendation trends for free.
3. **ETF and Bond screeners** — no comprehensive free data exists (AUM, expense ratio, holdings, corporate bonds).
4. **Real-time US stocks and pre/after-market** — not in the free tiers (IEX on Alpaca is partial).
5. **Premium news** (Reuters, Dow Jones) — only via license agreements; Reuters has no public RSS.
6. **History of TOTAL/dominance** — we must take snapshots ourselves or buy a paid CoinGecko/CMC plan.
7. **Redistribution**: almost all free tiers forbid public/commercial display → for a public launch a data budget is needed (or focus on public-domain sources: SEC, FRED, Treasury, crypto exchanges).
8. **Iran market**: all sources are unofficial and change without notice; an adapter layer with health tests is required. Binance/Bybit are geo-blocked from Iranian IPs → the backend must be outside Iran or go through an authorized proxy.

### Architecture notes (short)
- Put all sources behind an **adapter layer** with a cache (Redis) and a scheduler; the client must never connect directly to an external API (keys and rate limits live server-side).
- Feed the screener/heatmap/movers from **one shared snapshot table** (every 1 to 5 minutes for crypto, EOD for free-tier stocks).
- **Compute internally** Technical ratings, seasonals, Greeks, and dominance to reduce dependence on paid data.
- **Do not use TradingView's internal endpoints (such as scanner)** — it violates the ToS and clean-room rules.

---

## Sources
- TradingView Help — Economic Calendar: https://ru.tradingview.com/support/solutions/43000759911/
- TradingView Economic calendar page: https://www.tradingview.com/economic-calendar/
- TradingView Help — News Flow filters: https://in.tradingview.com/support/solutions/43000732560-news-flow-s-filters-overview
- TradingView Blog — Dow Jones Newswires: https://www.tradingview.com/blog/en/dow-jones-newswires-on-tradingview-36656
- TradingView Blog — Real-time news alerts: https://www.tradingview.com/blog/en/real-time-news-alerts-54444/
- TradingView Help — Screener category: https://tradingview.com/support/categories/screener
- TradingView Help — Pine Screener overview: https://www.tradingview.com/support/solutions/43000742435-what-is-pine-screener-quick-overview-of-the-screener-s-functionality
- TradingView Help — Pine Screener limitations: https://cn.tradingview.com/support/solutions/43000742437
- TradingView Help — Technical Ratings: https://tradingview.com/support/solutions/43000614331-technical-ratings
- TradingView Technical Ratings script overview: https://cn.tradingview.com/script/Jdw7wW2g-Technical-Ratings
- TradingView Help — Heatmaps: https://www.tradingview.com/support/solutions/43000766446
- CMC Markets — TradingView heatmaps explained: https://www.cmcmarkets.com/en-gb/trading-platforms/tradingview/tradingview-heatmaps-explained
- TradingView Help — Seasonals: https://in.tradingview.com/support/solutions/43000745201-seasonals/
- TradingView Blog — Seasonality charts: https://www.tradingview.com/blog/en/tradingview-seasonality-charts-49444
- TradingView Blog — TradingView Options: https://www.tradingview.com/blog/en/new-product-tradingview-options-44783
- TradingView — Crypto market cap symbols (community): https://my.tradingview.com/chart/TOTAL/LrVZMyQU-How-to-chart-crypto-market-caps-beyond-TOTAL-TOTAL2-etc
- TradingView Blog — Introducing Minds: https://www.tradingview.com/blog/en/introducing-minds-35320
- TradingView Help — Minds: https://in.tradingview.com/support/solutions/43000690226-how-to-use-minds-and-what-they-are-made-for/
- TradingView — Newsletter: https://in.tradingview.com/ideas/newsletter
- Finnhub free tier (secondary): https://apicostcalc.com/finnhub.html , https://qveris.ai/guides/stock-api-free-comparison/
- FMP free plan: https://site.financialmodelingprep.com/de/education/other/do-you-need-a-credit-card-to-use-financial-modeling-prep , https://multiples.vc/compare/fmp-api-alternatives
- Alpha Vantage limits: https://www.macroption.com/alpha-vantage-api-limits/
- Twelve Data limits: https://support.twelvedata.com/en/articles/5194820-api-credits-limits , https://support.twelvedata.com/en/articles/5615854-credits
- Polygon → Massive: https://apicostcalc.com/blog/polygon-massive-rebrand-api-pricing.html , https://try.qveris.ai/polygon-pricing-optimized/
- Yahoo / yfinance: https://pypi.org/project/yfinance/0.2.16 , https://scrapfly.io/blog/posts/guide-to-yahoo-finance-api
- FRED rate limit (secondary): https://readme.hex.pm/fred_api_client/0.1.2 , https://freeapihub.com/apis/fred-api
- Trading Economics: https://github.com/tradingeconomics/notebooks , https://apis.io/plans/tradingeconomics/tradingeconomics-plans-pricing/
- ForexFactory feed usage: https://www.mql5.com/en/forum/343908/16870225 , https://apify.com/xtracto/forexfactory-calendar
- SEC EDGAR: https://www.sec.gov/os/accessing-edgar-data , https://www.sec.gov/edgar/sec-api-documentation
- CoinGecko: https://docs.coingecko.com/docs/cli , https://docs.coingecko.com/docs/common-errors-rate-limit
- CoinMarketCap: https://coinmarketcap.com/academy/vi/article/understanding-crypto-api-subscription-models-for-traders-in-2026 , https://zuplo.com/learning-center/coinmarketcap-api.md
- CryptoPanic: https://github.com/tigusigalpa/cryptopanic-php
- DexScreener (secondary): https://github.com/opensvm/dexscreener-mcp-server
- GeckoTerminal: https://apiguide.geckoterminal.com/faq , https://support.coingecko.com/hc/en-us/articles/22612838274841-Does-GeckoTerminal-have-an-API
- Binance rate limits: https://developers.binance.com/docs/binance-spot-api-docs/websocket-api/rate-limits
- Bybit rate limits: https://bybit-exchange.github.io/docs/zh-TW/v5/rate-limit , https://bybit-exchange.github.io/doc-v3-offline/spot/rate-limit
- Messari: https://www.spark.money/tools/crypto-api-pricing-comparison , https://costbench.com/software/onchain-analytics/messari/free-plan
- NewsAPI terms: https://newsapi.org/terms , https://apicostcalc.com/newsapi.html
- Options data: https://qveris.ai/guides/free-options-chain-api , https://www.nuget.org/packages/Tradier.Client
- Nasdaq calendar API (unofficial): https://apify.com/gochujang/stock-earnings-tracker
- TSETMC libraries: https://pypi.org/project/tsetmc-api , https://www.npmjs.org/package/tse-client
- tgju: https://pkg.go.dev/github.com/amiranmanesh/tgju-api-go , https://github.com/amirh0ss3in/tgju_api , https://github.com/Hameds/APIs-made-in-Iran/issues/120
- Nobitex (unofficial wrapper): https://glama.ai/mcp/servers/@xmannii/nobitex-mcp-server/blob/bd8d253a1306ed7f09745befc05b0d5dc4550888/services/nobitex.service.ts
