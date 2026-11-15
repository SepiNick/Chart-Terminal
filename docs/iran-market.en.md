[English](iran-market.en.md) · [فارسی](iran-market.md)

# Iran market: Nobitex, gold and dollar, stock exchange and bonds

**Status: the code is written and exercised by automated tests, but none of the services have been tried live.** The environment this section was built in had no access to Iranian services. The parsers were written from second-hand descriptions of these services, and their tests use responses reconstructed from those same descriptions, not real responses. The first thing to do after installing is:

```bash
npm run check:ir
```

This command calls each source once and prints ✔ or ✘ for each. With `-- --capture` it saves the raw responses in `server/iran/fixtures/live/`. If something shows ✘, those files show how the response shape differs and what change the parser needs.

## Symbols

In symbol search, pick the source or type it directly:

| Source | Example | Data |
|---|---|---|
| `NOBITEX` | `NOBITEX:BTCIRT`, `NOBITEX:USDTIRT`, `NOBITEX:ETHUSDT` | 1-minute to 1-day candles (the rest are built from these), prices in toman |
| `TGJU` | `TGJU:USD`, `TGJU:GOLD18`, `TGJU:SEKKEH`, `TGJU:ONS` | Daily and longer only. Dollar, euro, pound, dirham, lira, gold, mesghal, ounce, coins |
| `TSE` | `TSE:فولاد`, `TSE:وبملت`, `TSE:شاخص_کل`, `TSE:35425587644337450` | Daily and longer only. Stocks, funds, bonds, rights, futures, options, indices |

- Stock exchange symbols are Persian names; spaces become `_`, and "ح . فولاد" becomes `ح.فولاد`. The numeric TSETMC code (`insCode`) works too. Arabic letters (ي، ك) and Persian digits are normalized automatically.
- In the search, the exchange has the labels "stock, fund, bond, rights, futures, option, commodity, index" (سهام، صندوق، اوراق، حق تقدم، آتی، اختیار، کالا، شاخص). If the exchange list does not show up, type the symbol name; a "TSE:…" row is always suggested.
- **Domestic vs. foreign Tether:** when you search for `nobitex`, the "Tether premium" row inserts `NOBITEX:USDTIRT/TGJU:USD-1`: the gap between Tether's price on Nobitex and the free-market dollar, as a ratio. It works only on the daily timeframe because tgju has daily candles.

## Bonds

The type of each exchange symbol is guessed from its short name, full name and group (`classify` in `server/iran/tse.ts`), because TSETMC has no clean "type" field:

- **Bonds (اوراق)** = participation bonds, ijara, murabaha, sukuk, manfaat, rahni, treasury notes (اخزا)
- **Fund (صندوق)** = any symbol with "صندوق" in its name (equity, fixed income, gold, leveraged)
- **Futures (آتی)** = futures and forward-sale contracts · **Option (اختیار)** = call and put options · **Rights (حق تقدم)** = "ح . …" · **Commodity (کالا)** = commodity deposit certificates

This classification is a heuristic and may mislabel a few symbols. `npm run check:ir` prints the first bonds and funds in the list; if the bond list is empty, adjust the rule against the real names.

The 🧰 Skills panel has an **Iran bond yield** calculator: from the market price, face value, coupon rate and maturity, it computes the effective annual yield, the simple yield for treasury notes, the duration, and a cash-flow table. Both Jalali (`1405/12/29`) and Gregorian dates are accepted. Assumptions: the price is the total amount paid; coupon dates are counted back from maturity in whole months; tax is not calculated.

## Prices and units

- **Nobitex:** Nobitex's trading API returns the toman market in rial. The app shows toman. For candles, the unit is detected from the `USDTIRT` price (above 500,000 means rial, and it is divided by 10). If the detection is wrong: `CT_NOBITEX_UNIT=rial` or `toman`.
- **tgju:** rial, divided by 10, except the ounce (dollars).
- **Stock exchange:** rial, as TSETMC returns it (no conversion).
- **Exchange closing price:** it is the "closing price" (the weighted-average closing price). For the last trade use `CT_TSE_CLOSE=last`.
- **Adjustment:** exchange prices are **adjusted** for capital increases and cash dividends (otherwise a capital increase looks like a crash). Method: when a day's "yesterday price" differs from the previous day's close, all earlier days are multiplied by that ratio. Differences under 0.05% and unusual ratios are ignored. To turn it off: `CT_TSE_ADJUST=0`.

## Week and month

- The week for the `tgju` and `tse` sources starts on **Saturday**, not Monday. Nobitex starts on Monday like the rest of crypto.
- The monthly timeframe (`1M`) in `tgju` and `tse` is the **Jalali month**; in Nobitex it is the Gregorian month.
- Jalali calendar on the chart's time axis: chart settings ← Scales and lines ← Calendar ← `jalali`.

## Persian interface

The "فا / EN" button in the top bar switches the language. The first time, if the browser is Persian, the app becomes Persian.

- Translation works by exact lookup of the English text in the `FA` dictionary in `src/i18n.ts`. `<option>`s without a `value` are deliberately not translated, because their text is their value; this applies to text, title and placeholder, and to panels built later. Anything not in the dictionary stays English, and strings containing a number or a name (such as "Order · BTCUSDT") are not translated. **So the interface is not fully Persian**; what is covered: the top bar, side panels, bottom tabs, the search box, all chart settings, the alert dialog and the server panel (except a few long explanations with a tag in the middle), the market tabs, the journal menu and the skill group titles. Not yet translated: text inside tools and skill results, the strategy tester's labels, the journal forms and error messages.
- To add a translation, add the exact English string and its translation to `FA`. The `src/i18n.test.ts` test checks that every key actually exists in the code or HTML.
- Panels and dialogs become right-to-left. The chart, toolbar, code editor and numbers stay left-to-right.

## Where to run it

Binance and Bybit block Iranian IPs, but the sources on this page are probably slow or blocked from outside Iran (untested). If both groups are not reachable from a single server, run two servers and connect both in the app (`docs/multi-server.md`): one inside Iran for `nobitex`, `tgju` and `tse`, and one outside for foreign exchanges. The source addresses are changed with `CT_NOBITEX_BASE`, `CT_TGJU_BASE` and `CT_TSE_BASE` (for a mirror or proxy).

## Rules and limitations

- **The sources are unofficial.** tgju and TSETMC are for personal use and may change the response shape, address or access rules without notice. Read each site's terms of use yourself.
- **Public multi-user server:** these sources are **off** in `CT_MODE=public` (`CT_IRAN_PUBLIC=1` turns them on). Republishing this data to others requires legal advice.
- **The exchange is daily only.** TSETMC does not provide intraday candles. For the current day, live prices are read every 15 seconds.
- **Codal was not done.** Codal announcements and financial statements are not candle data, and no stable source for them was evaluated.
- **tgju** has no live candles; it is daily and updates once every 60 seconds. The ticker (last price and change from the previous day) exists for all items; each item is one small request, so the first time takes a few seconds and then it is cached for 2 minutes.
- **Screener:** Nobitex and the exchange are also in the Market ← Screener panel (price, change and traded value from the market list).
- **Trading:** none of these sources trade. The Nobitex testnet account in the 🏦 panel is separate, and real money is still off limits.
- **Code folders:** `server/iran/` (sources and tests), `src/jalali.ts` (Jalali calendar, tested over 70 years against the browser's calendar), `src/i18n.ts` (translation), `src/skills/irbond.ts` (bond yield).
