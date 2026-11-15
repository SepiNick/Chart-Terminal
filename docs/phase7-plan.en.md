[English](phase7-plan.en.md) · [فارسی](phase7-plan.md)

# Phase 7 Implementation Plan: The Iranian Market

Date: 2026-11-04. Status: built, not tested live. The result of the work is described in `docs/iran-market.md` and `ROADMAP.md`. This plan is the initial document, and some details (such as module names) changed during the build.

This plan turns the ⏳ Phase 7 work in `ROADMAP.md` into buildable, testable steps. Why it takes priority: in the competitor report (appendix below), the Iranian market is the only place where TradingView, ATAS, NinjaTrader and MT5 are all weak, and no Iranian competitor with Pine, backtesting and order flow was found either.

## 1. Scope

| # | Feature | Proposed source | Difficulty |
|---|---|---|---|
| 7.1 | Nobitex toman pairs on the chart (BTCIRT, USDTIRT and others) | Nobitex public API | Low to medium |
| 7.2 | Chart of the Tether price gap, domestic vs. foreign (`USDTIRT` against the free-market dollar or foreign pairs) | Built from 7.1 and 7.3 | Low (symmath already exists) |
| 7.3 | Gold, coins and the free-market dollar | tgju (page scraping) or a third-party API | Medium, fragile |
| 7.4 | Right-to-left UI and the Jalali calendar | Browser `Intl`, no library | Medium (UI work) |
| 7.5 | Tehran Stock Exchange (TSETMC) and Codal | Unofficial TSETMC endpoints | High, last |

Build order: 7.1 → 7.4 → 7.3 → 7.2 → 7.5. 7.1 and 7.4 need no keys and will win over Iranian users sooner. 7.5 carries the most risk and must stay last.

## 2. Source verification status

In the research session, the sandbox network could not reach `api.nobitex.ir` or `cdn.tsetmc.com` (the proxy returned 403), so **I have not run any of the endpoints below**. Before writing code, each one must be confirmed with a `curl` from your PC. These are guesses based on secondhand sources:

- **Nobitex:** according to one source, the official docs are at `apidocs.nobitex.ir` (it did not open). A sample snippet uses `POST /market/stats` with `srcCurrency` and `dstCurrency`, and `/market/global-stats`. A third-party listing says an OHLCV route exists but does not name it. **The exact path for candles and history (probably a UDF-style endpoint) is unconfirmed.**
- **TSETMC:** the unofficial libraries (`tse-client` on npm, `tsetmc` on PyPI) pull data from several TSETMC servers. That means it is not an official, stable source and may change without notice.
- **tgju:** community projects only scrape the page. One states itself that it is not affiliated with tgju, and the terms of use must be read. A gist also says its endpoint stopped working because tgju broke. I did not find BrsApi in my search; you will need to check its terms and whether it is free yourself.
- **Currency unit:** Nobitex and tgju quote prices in rials; your app uses toman (IRT), and `server/brokers/nobitex.ts` already has this ÷10 conversion. The same rule must apply to market data.

## 3. Architecture

The attachment point already exists: `server/market.ts` keeps local sources in the `LOCAL` set (currently `fx` and `mt5`), and `bars()` dispatches by exchange name. `server/yahoo.ts` is the complete pattern for a source (`fxMarkets`, `yahooBars`, `yahooBase`). The plan:

```
server/iran/
  nobitex.ts    nobitexBars(sym, tf, until, limit), nobitexMarkets(), nobitexTickers()
  tgju.ts       tgjuBars / tgjuQuote with cache (live price; we build candles ourselves from snapshots)
  tsetmc.ts     (step 7.5)
  jalali.ts     only if Intl turns out to be insufficient
```

- New exchanges in `LOCAL`: `nobitex` (symbols like `BTCIRT`) and `ir` for gold, currencies and the stock exchange (`IR:USD`, `IR:SEKKEH`, `IR:GOLD18`, `IR:فولاد`); Persian stock-exchange symbols would require changing `SYM_RE` (it currently accepts only `[A-Z0-9_.]`), or the Latin TSETMC code can be used instead.
- Every source returns the same `{bars, base}` contract. The existing `aggregate()` builds the other timeframes. No change to the `src/data.ts` client is needed beyond registering the exchange name in symbol search.
- Live: like `fx`, a polling feed (`every`) inside `server/market.ts`, because these sources have no reliable public WebSocket (Nobitex's WebSocket is marked "unconfirmed" in ROADMAP).
- Server-side cache with a polite interval between requests (like `server/sec.ts`); if a source goes down, show the latest version marked "stale" (the Phase 9 rule).
- No API key. If a source asks for a key, it should stay optional, like Finnhub.

### The server location problem

Binance and Bybit block Iranian IPs, whereas Nobitex, tgju and TSETMC are probably either slow or blocked from outside Iran (unconfirmed). A single server may be unable to see both groups. The solution is already in the app: **multiple servers** (`docs/multi-server.md`, Phase 15). Suggestion: the Iranian user connects one server inside Iran for the `nobitex` and `ir` sources and one server (or VPN) outside for foreign exchanges. Settle this first with a real test; if it turns out both work from the same place, the complexity is unnecessary.

## 4. Client

- **RTL:** `index.html` is currently `lang="en"`. Suggested mechanism: a "UI language" setting with `fa` that puts `dir="rtl"` and `lang="fa"` on `<html>` and updates the styles to use logical properties (`margin-inline`, `inset-inline`). **The chart itself (time and price axes, the drawing toolbar) must stay LTR**, because lightweight-charts is direction-sensitive. Only panels, menus and forms become RTL.
- **Jalali calendar:** `Intl.DateTimeFormat('fa-IR-u-ca-persian')` for the time-axis labels, the Data window, the journal (`calendar?: 'gregorian' | 'jalali'` already exists at `src/journal.ts:52`) and the date filter. The week starts on Saturday. Persian digits only in display; inputs stay ASCII-based (`src/market/query.ts` already normalizes digits).
- **Market session:** Tehran Stock Exchange hours (Saturday to Wednesday), and TPO/volume profile with a configurable session start (which already exists for UTC; just add a "Tehran Stock Exchange" preset).
- **Translation:** a string table (`src/i18n.ts`) with English and Persian keys. Translate only the market panels and the journal first, not the whole app.
- **Alerts:** Telegram and email messages should have a Persian template (placeholders already exist). Bale and Eitaa only if they have an official bot API and someone uses them.

## 5. Testing

- Unit (no network, like the rest of the project): rial-to-toman conversion, building candles from a snapshot, data gaps, `aggregate` on Iranian intervals, Jalali conversion with a few known dates (1 Farvardin, the last day of Esfand in a leap year), rejection of malformed input in `SYM_RE`.
- Contract: a recorded response (fixture) from each source in the repo, so a change in response shape is caught by a test.
- Live, run by you: an `npm run check:ir` script that calls each source once and reports which ones work.
- Write the mocks in `server/*.test.ts`, like `nobitex.test.ts`.

## 6. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| tgju or TSETMC change the response shape without notice | High | Fixtures, a clear error message, stale cache with a label |
| The terms of use forbid scraping | Medium | Read the terms before any public release; private mode for personal use only; keep the source swappable |
| Redistributing data in public multi-user mode | High | The same ROADMAP principle: public release needs a data budget or a contract; get legal advice |
| Payments and sanctions for public-mode users | Unclear | The app is free and has no payments; but you would be opening a public server to Iranian users, so legal advice is needed |
| Source request rate limits | Medium | Cache, intervals between requests, a feed cap like `FEED_CAP` |
| Persian stock-exchange symbols with `SYM_RE`, URLs and layout storage | Medium | Use the Latin TSETMC code as the symbol and the Persian name for display only |

## 7. Definition of done

- 7.1: `BTCIRT` and `USDTIRT` open from symbol search, timeframes 1m to 1d work, the price is in toman, and a new candle arrives every few seconds.
- 7.2: `NOBITEX:USDTIRT` minus the free-market dollar (or the ratio) is drawn on the chart with symmath.
- 7.4: With the Persian setting, the market panels are right-to-left, the time axis is Jalali, and the chart and drawing tools have not moved.
- 7.3: The free-market dollar, coin and 18-karat gold prices, with a cache and a "stale" label when the source is down.
- 7.5: At least one stock-exchange symbol with daily candles, with no breakage on holidays.
- `npm test` and `npm run build` are green, and ROADMAP marks each sub-step as "tested or not" (like Phases 6 and 11).

## 8. First steps (one working session)

1. Confirm from your own PC: the Nobitex candle path, a sample response from tgju, and whether each one opens from inside Iran and from outside Iran.
2. Put the response fixtures in `server/iran/fixtures/`.
3. Build `server/iran/nobitex.ts` with unit tests and add `nobitex` to `LOCAL` and `exchanges`.
4. Try `NOBITEX:BTCIRT` in the browser with no client changes.

## Appendix: why this phase

From the competitor report (2026-11-04): the recurring complaints about TradingView are currency payments and pricing for Iranians (Persian sources), and the lack of toman pairs, the stock exchange, gold and coins, the Jalali calendar and an RTL UI. GoCharting and MT5 are recommended as alternatives in Persian sources. This is only a web search, not a user survey; real criticism from Iranian users on Cafe Bazaar and in Telegram groups has not been read yet.
