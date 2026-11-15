[English](development.en.md) · [فارسی](development.md)

# Development guide (code map)

```bash
npm install && npm --prefix server install
npm run server      # data server on 127.0.0.1:8787 (for other exchanges and forex)
npm run dev         # http://localhost:5173
npm test            # app tests (Pine, MQL, NinjaScript, tester, journal, sync, ...)
npm --prefix server test   # server tests
npm run build
npm run check:ir    # live check of the Iranian sources (Nobitex, tgju, TSE)
npm run bench       # time and memory of the heavy paths
npm run audit:html  # unescaped strings in HTML templates
```

| File | Purpose |
|---|---|
| `src/main.ts` | layouts, toolbars, panels, windows, shortcuts, alerts, trading |
| `src/chart.ts` | one chart (`ChartPane`): data, settings, legend, scale lines, Replay, Data window |
| `src/drawings.ts` | drawing engine (create, select, drag, hit-test, Magnet, zoom, measure) |
| `src/tools/*.ts` | 92 drawing tools; the tool contract is in `tools/types.ts` |
| `src/drawui.ts` | left toolbar, floating bar, properties dialog, templates |
| `src/charttypes.ts`, `charttransforms.ts` | 18 chart types |
| `src/settings.ts` | chart settings model and form |
| `src/history.ts` | Undo/Redo |
| `src/symmath.ts` | math on symbols (safe parser) |
| `src/trading.ts` | paper-trading engine |
| `src/data.ts` | Binance data (direct), server symbols (`BYBIT:BTC_USDT.P`, `FX:EURUSD`), custom timeframes |
| `src/symsearch.ts`, `src/searchall.ts` | symbol search across all exchanges (ranking, loading) |
| `src/pine/` | Pine Script interpreter, function library, strategy simulator, Pine Editor |
| `src/mql/`, `src/ninja/` | MQL4/MQL5 and NinjaScript compilers and runtimes |
| `src/social/` | the Community panel (feed and chat) |
| `server/` | data server: CCXT (103 crypto exchanges) and FX (forex, metals, energy, indices and stocks from Yahoo) |
| `server/iran/` | Iranian market: Nobitex, tgju (dollar, gold, coins), TSE and bonds (TSETMC). Guide: `docs/iran-market.en.md`; live check: `npm run check:ir` |
| `server/oauth.ts`, `server/core/oidc.ts` | Google, Apple and Telegram sign-in (OpenID Connect) |
| `server/social.ts` | Community API and live chat |
| `bugreport-worker/` | Cloudflare Worker that receives bug and crash reports |
| `desktop/`, `android/`, `lite/` | Electron shell, Android app, light package |
| `src/jalali.ts`, `src/i18n.ts` | Jalali calendar and the right-to-left Persian interface |

All shortcuts: the ⌨ button or `Ctrl+/` inside the app. Main ones: `Alt+T` trend line · `Alt+H` horizontal line · `Alt+J` horizontal ray · `Alt+V` vertical line · `Alt+F` Fibonacci · `Alt+Shift+R` rectangle · `Shift+click` measure · `Alt+A` alert · `Delete` remove the selected drawing · `Esc` back to Cursor · double-click text to edit.
