# Phase 6 — exchanges on testnet: contracts for parallel work

Phase 6 = one broker layer for every account (our paper account + exchange **testnets**), more order types, order
sizing, draggable TP/SL, account and DOM panels, and the `trade-guardian` gate. Three agents build it in parallel,
each on its own branch. **This file and `src/broker/types.ts` are the single source of truth for the interfaces.**
If you need something outside your files, make the smallest possible edit, keep it local and marked, and list it in
your final report.

## 0. Decisions (do not change)
- **Testnet only.** No mainnet code path at all: every exchange adapter forces sandbox/testnet mode and refuses to run
  if the resolved API host is not a testnet/sandbox/demo host. Real money needs the trade-guardian review and the
  user's explicit approval later — out of scope here.
- **Keys** live only on the server, encrypted in the DB with `server/core/secrets.ts` (`secretSet/Get/Del`), named
  `broker:<accountId>:apiKey|secret|passphrase`. (The ROADMAP's older keytar note is superseded by phase 5's decision:
  the same code must run on a Linux VPS.) A key is never returned to a client, logged, or put in an error message.
- **Guardian gate** (`trade/docs/RISK_RULES.md`, `trade/.claude/agents/trade-guardian.md`): a new account is
  `pending`; `POST /api/broker/accounts/:id/check` returns a PASS/FAIL list and activates it only if all pass:
  testnet host, the key works (balance fetch), the user confirmed the key has **no withdraw/transfer permission**
  (and, where the exchange exposes key permissions, they are read and a withdraw permission fails the check),
  `maxDailyLossPct > 0`, `maxPositionPct` in (0, 100]. Every order is then checked on the server: circuit breaker
  (today's loss vs start-of-day equity → account `tripped` until the next UTC day, only reduce-only/closing orders
  allowed), position cap, and `requireStop` (opening/adding orders need `sl`, either bracket or an existing stop).
- Exchanges: CCXT sandbox for Binance spot (`binance`), Binance USDⓈ-M futures testnet (`binanceusdm`), Bybit testnet,
  OKX demo trading, KuCoin sandbox if CCXT still supports it (if not, report it and leave it out), and Nobitex's
  official testnet `testnetapiv2.nobitex.ir` (own small REST client, token auth). This PC is in Iran: Binance/Bybit
  need the VPN; tests must never need the network (use recorded/mocked responses).
- Order types in the shared model: market, limit, stop, stop-limit, trailing stop, OCO, reduce-only, TP/SL bracket.
  Where an exchange lacks one natively, emulate it on the server (watch price, then send) and say so in the order's
  status/error text; never silently drop a stop.

## 1. Ground rules (same as earlier phases)
- TypeScript run directly by Node 25: no parameter properties, no enums, no namespaces, `import type` for types.
  Match the existing style: compact, few comments that explain *why*. Reuse helpers; read around you first.
- Your worktree has no `node_modules`: run `npm ci` in the root and in `server/` first.
- Tests next to the code (`node:test`); add new client test folders to the root `test` script. Escape every HTML
  string built from data (`esc` in `src/store.ts`). No new npm dependencies (CCXT is already in `server/`).
- Before finishing: `npx tsc --noEmit` and `npx tsc --noEmit -p server` pass, all tests pass, commit on your branch
  ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Don't edit `ROADMAP.md`.
  Final report: what works, what's emulated vs native per exchange, what you left out, files touched outside your area.

## 2. Ownership
| Agent | Owns | Builds |
|---|---|---|
| **brokers** (server) | `server/brokers/**` (new), registers it in `server/index.ts` | Accounts CRUD + encrypted keys, guardian check, adapters (CCXT testnets, Nobitex testnet), the order API and server-side emulation (trailing, OCO, brackets, stop-limit where missing), guard enforcement, a poll/stream loop that pushes `{ type: 'broker', account, state }` over WS, tests with mocked exchanges |
| **orders** (client) | `src/trading.ts`, new `src/broker/paper.ts`, the order ticket + trading panel parts of `src/main.ts`, `tradeOverlay` and order/position lines in `src/chart.ts` | Paper engine: stop-limit, trailing stop, OCO (standalone), reduce-only (already partly there). `PaperBroker implements Broker` over the synced paper account, registered from `main.ts`. Ticket: all order kinds, sizing by units / quote amount / % of balance / % risk to the stop, TP/SL fields, account selector (from `registry.ts`). Chart: order, TP and SL lines for the **active** broker, draggable to modify (`Broker.modify`), with a cancel ×. |
| **accounts** (client) | new `src/broker/remote.ts`, new `src/broker/ui.ts`, `src/orderflow/domui.ts` (trading part only), small marked hooks in `main.ts`/`index.html` | `RemoteBroker implements Broker` over the API + WS (one per exchange account, registered in `registry.ts`). Account manager: add testnet account (keys typed by the user, sent once), guardian checklist with PASS/FAIL and the no-withdraw confirmation, guard settings, delete. Panels: balances, positions (close), open orders (cancel), fills/history per account, account status (tripped/pending). DOM ladder: click to place limit/stop on the **active** broker. |

Shared files written by the integrator (use, don't change): `src/broker/types.ts`, `src/broker/registry.ts`.
If you must change a shared type, add an optional field only and say so in your report.
