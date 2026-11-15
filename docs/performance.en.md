[English](performance.en.md) · [فارسی](performance.md)

# Performance and server resource usage

Goal: the local server should be able to stay on for days on a laptop and serve a phone as well, with the lowest possible CPU, RAM and battery usage.

## Measurement method

The server was started with `node --experimental-strip-types server/index.ts`, a temporary `CT_DATA_DIR` and a free port (neither 8787 nor the ports of other tools). No clients, broker accounts, alerts or forward tests were attached. Measured with Windows `Get-Process`: Working Set, thread count and CPU time over 30 idle seconds (after a 35-second warm-up).

## Before and after

| Metric | Before | After |
|---|---|---|
| Time until `/api/health` is ready | 2.0 s | 0.9 s |
| Startup CPU (total) | 1.45 s | 0.7–0.95 s |
| RAM (Working Set) after startup | 187 MB | 93–98 MB |
| RAM after 30 seconds idle | 149 MB | 92–94 MB |
| Idle CPU | about 0.7% of one core (first 30 seconds) | about 0.5% of one core (after warm-up) |
| Threads | 17 | 14–17 (internal V8 and libuv threads) |

Module load time (measured separately): `ccxt` about 1 second and 75–90 MB; `web-push` and `nodemailer` about 150 ms and 12 MB.

## What changed

- **`ccxt` is now lazy** (`server/ccxtlib.ts`): it is loaded only on the first real request to an exchange. The list of exchange ids lives in `server/exchanges.json`, so validation, `/api/exchanges` and `/api/health` do not load the library. A test in `server/server.test.ts` makes sure the file matches the installed ccxt version (after upgrading ccxt, `exchanges.json` must be regenerated).
- **`web-push` and `nodemailer` are now lazy** (`server/notify/index.ts`): they are loaded only on the first push/email send or when a VAPID key is generated.
- **recorder**: instead of a `setInterval` every 1 second, a 1-second `setTimeout` is created only when a new tick is queued. Without recording, there is no wake-up at all anymore.
- **SQLite**: `journal_size_limit` is set to 32 MB so the WAL file shrinks after a checkpoint.
- **The exchange market-list cache** holds at most 12 entries.
- Fixed an old `tsc` error in `server/ml.ts` (narrowing of the `last` variable); behavior did not change.

## What was already optimized

The script engine workers (`engine.ts`) are created only on first use and are `unref`'d; the alert timer (15 seconds), the liquidations cleanup (30 seconds) and the recorder's daily `prune` are all `unref`'d; the `marketdata`, `sec`, `ptr`, `yahoo` and `derivs` caches have an entry cap; there is no `setInterval` under 1 second and no busy loop; WAL and `synchronous = NORMAL` were already enabled.

## What is still heavy, and why

- **The first crypto request** needs about 1 second of CPU and 80–90 MB of RAM to load ccxt, and after that ccxt stays in memory (it cannot be released). This is a one-time cost.
- **Loading `market.ts`/`alerts`** still makes up a large part of the baseline RAM (about 64 MB for Node itself plus about 30 MB of code).
- **Broker account polling** (every 5 seconds, and every 2 seconds with a simulated open order) deliberately continues regardless of whether a client is connected, because the simulated stop-loss/bracket must be executed on the server side. Reducing it would change behavior, so it was not done.
- **Forward tests and live recording** hold a WebSocket and a worker for as long as they are active. That is their main job.
- Each engine worker (up to 4, `CT_ENGINE_WORKERS`) takes its own RAM while running a script.
