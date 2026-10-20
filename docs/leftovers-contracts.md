# Leftovers — contracts for parallel work

Everything the ROADMAP lists as "not yet", "مانده" or "محدودیت" in phases 2–10 that does not belong to a future
phase (6, 7, 9, 11–13). Seven agents build it at the same time, each on its own branch in its own worktree.
**This file is the single source of truth for who owns what.** If you need something outside your files, make the
smallest possible edit, keep it local (a few lines, clearly marked), and list it in your final report.

## Ground rules (same as phase 5)
- TypeScript run directly by Node 25: **no parameter properties, no enums, no namespaces**, `import type` for types.
  Match the existing style: compact, few comments that explain *why*. Read the code around you first and reuse helpers.
- Your worktree has no `node_modules`: run `npm ci` in the repo root **and** in `server/` before anything else.
- Tests: `node:test` files next to the code. Client: `npm test` in the root (add your glob to the root `test` script if
  your test lives in a new folder). Server: `cd server && npm test`.
- Every HTML string built from data must escape it (`esc` in `src/store.ts`).
- No new npm dependencies.
- Clean-room: build from behaviour/docs, never copy code from other products.
- Before finishing: `npx tsc --noEmit` (root) and `npx tsc --noEmit -p server` pass, all tests pass, and you commit on
  your branch with a clear message ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Do **not** edit `ROADMAP.md` (the integrator does). Your final report: what you built, files touched outside your
  area, what you left out and why, and how to try it in the app.
- Shared hot files: `src/main.ts`, `src/chart.ts`, `index.html`, `src/style.css`. Only the **chart** agent owns them;
  everyone else adds at most a few lines there (a menu item, a button, an import, a hook call), never refactors them.

## Agents and their areas
| Agent | Owns | Builds |
|---|---|---|
| **pine** | `src/pine/**` | `request.security` (other symbol/timeframe), `table.*`, `type`/`enum`/`import` (UDTs, libraries from installed scripts), full `plotcandle`/`plotbar`, `matrix.*`/`map.*` |
| **mqlnt** | `src/mql/**`, `src/ninja/**` | MQL: `iCustom`, sandboxed file functions, `OnTrade`/`OnTradeTransaction`, `goto`, operator overloading, swap, iAD/iChaikin/iBWMFI/iGator. NinjaScript: LINQ, events, unmanaged orders, `OnRender` (as drawings), session templates, tick-by-tick where data allows |
| **tester** | `src/tester/**`, `src/testerui.ts`, `server/engine.ts`, `server/engineworker.ts` | Date-range selection for the report; analysis tabs (monthly returns, return distribution, streaks); several engine workers instead of one |
| **orderflow** | `src/orderflow/**`, `server/recorder.ts` | TPO and session volume profile, footprint/TPO as chart types, tick and Range/Reversal/Delta timeframes, Cluster Search, Absorption, tick-level Market Replay from the server's trade recording |
| **derivs** | new `server/derivs.ts`, new `src/derivs/**` | Open interest, funding, long/short ratio, liquidation feed, CVD spot vs perp, liquidation heatmap labelled "estimated" — free public exchange APIs via the server (CCXT where it has them) |
| **chart** | `src/chart.ts`, `src/main.ts`, `src/drawui.ts`, `src/drawings.ts`, `src/tools/**`, `index.html`, `src/style.css` | Replay of all charts in sync, move a drawing to another pane, pane buttons (up/down/maximize/close), a separate price scale per indicator, Magic cursor, a position-size calculator on the chart (drag SL/TP, see size and liquidation price) |
| **journal** | `src/journal/**`, `src/journal.ts`, `src/journalui.ts`, new `src/risk/**` | Replay a journal trade with Bar Replay, log trades made during Replay as backtest trades, portfolio risk: correlation matrix and exposure |

Cross-area needs (talk through the final report, don't block):
- **pine** `request.security` needs other bars: add an optional `security?: (symbol, tf) => Bar[] | undefined` to the Pine
  run options and return na plus a one-time warning when it is missing; chart wiring in `chart.ts` may be a few lines.
- **journal** trade replay uses the existing `ChartPane.startReplayAt(time)`; logging Replay trades uses the paper
  account hooks already in `main.ts` (a few lines at most).
- **derivs** panels are added like the existing order-flow panels (one button + one pane hook).
