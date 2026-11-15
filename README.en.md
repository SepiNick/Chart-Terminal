[English](README.en.md) · [فارسی](README.md)

# Chart Terminal

A TradingView-style charting app built from scratch. The roadmap and the findings of the app review are in [ROADMAP.md](ROADMAP.md) (Persian). Install and run on Windows, Linux, Android and as a server: [docs/README.en.md](docs/README.en.md).

```bash
npm install && npm --prefix server install
npm run server  # data server on 127.0.0.1:8787 (needed for other exchanges and forex)
npm run dev     # http://localhost:5173
npm test        # app tests (Pine, MQL, NinjaScript, tester, journal, sync, ...)
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
| `src/pine/` | Pine Script interpreter, function library, strategy simulator, Pine Editor |
| `server/` | data server: CCXT (103 crypto exchanges) and FX (forex, metals, energy, indices and stocks from Yahoo) |
| `server/iran/` | Iranian market: Nobitex, tgju (dollar, gold, coins), TSE and bonds (TSETMC). Guide: `docs/iran-market.en.md`; live check: `npm run check:ir` |
| `src/jalali.ts`, `src/i18n.ts` | Jalali calendar and the right-to-left Persian interface |

All shortcuts: the ⌨ button or `Ctrl+/` inside the app.

## Shortcuts

`Alt+T` trend line · `Alt+H` horizontal line · `Alt+J` horizontal ray · `Alt+V` vertical line · `Alt+F` Fibonacci · `Alt+Shift+R` rectangle · `Shift+click` measure · `Alt+A` alert · `Delete` remove the selected drawing · `Esc` back to Cursor · double-click text to edit

## Licence

GNU General Public License version 2 **or any later version** (GPL-2.0-or-later); the full text is in [LICENSE](LICENSE). Charts are built with TradingView's Apache-2.0 library (`lightweight-charts`), which is not compatible with GPL version 2 alone but is compatible with version 3; that is why the "or later" option is needed. The notice for the libraries is in the app under ☰ → "Licences" and in [public/licenses.html](public/licenses.html).
