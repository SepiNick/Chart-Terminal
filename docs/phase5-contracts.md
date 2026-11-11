# Phase 5 — contracts for parallel work

Phase 5 = local server with SQLite, login and multi-device sync, server-side alerts and notifications, server-side
forward tests, trade recording, HTTPS on the home network and Web Push. Several agents build it in parallel, each on
its own branch. **This file is the single source of truth for the interfaces between them.** If you need something
that is not here, implement the smallest version inside your own files and say so in your final report — never edit
a file you don't own.

## 0. Decisions already made by the user (do not change)
- Server runs on this Windows PC now (always behind a VPN, so Binance/Bybit/Telegram are reachable); it must move to
  a Linux VPS later with the same code (no Windows-only APIs).
- Single user, one password. All app data lives on the server; every device sees the same data.
- Phone access over home Wi-Fi now, via HTTPS with a locally generated CA (Android + iPhone).
- Notifications: in-app popup + sound, Web Push (desktop + phone; native apps may come later), Telegram, Email, Webhook.
  No Bale.
- Secrets (bot token, SMTP password, VAPID private key, later exchange keys) are encrypted in the DB (`core/secrets.ts`).
- Server-side: forward tests, trade recording for a user-chosen symbol list kept **30 days** (default BTCUSDT, ETHUSDT),
  and script alerts (Pine `alertcondition`, `alert()`, strategy orders).

## 1. Ground rules
- TypeScript run directly by Node 25 (`--experimental-strip-types` is default): **no parameter properties, no enums,
  no namespaces**, `import type` for types. Match the existing style: compact, few comments that explain *why*.
- Server tests: `node:test` files next to the code (`server/**/*.test.ts`), run with `cd server && npm test`.
  Client tests: `src/**/*.test.ts`, run with `npm test` in the repo root (add your glob to the root `test` script only if
  you own `package.json` — otherwise list the command in your report).
- Every HTML string built from data must escape it (`esc` in `src/store.ts`). Synced state comes from other devices.
- No new dependencies except: `web-push` and `nodemailer` (+ `@types/nodemailer`) in `server/package.json` (notify agent only).
- Clean-room: build from behaviour/docs, never copy code from other products.
- Before finishing: `npx tsc --noEmit` (root) and `npx tsc --noEmit -p server` both pass, your tests pass, and you commit
  on your branch with a clear message.

## 2. Core (already written — use, don't change)
- `server/core/db.ts` — `db` (node:sqlite `DatabaseSync`), `migration(name, sql)` (runs once; prefix names with your
  module, e.g. `'alerts/1'`), `configGet(key, fallback)` / `configSet(key, value)` for small JSON settings, `DATA_DIR`.
- `server/core/secrets.ts` — `secretSet(name, value)`, `secretGet(name)`, `secretHas`, `secretDel`. Never return a secret to a client.
- `server/core/auth.ts` — sessions; you normally don't need it (routes are protected by default).
- `server/core/http.ts` — `route(method, path, handler, { public?, raw?, limit? })` with `:param` paths; handler gets
  `Ctx { req, res, url, params, body, secure, session }` and returns JSON / `undefined` (204) / `RAW`. Throw
  `HttpError(status, msg)` or `bad(msg)`. All routes need a login unless `public`. Non-GET requests from another
  origin are rejected. `onWs(op, (client, msg) => …)` for client→server WebSocket messages (use `'<module>.<action>'`
  ops), `onWsClose`, `broadcast(msg, except?)` to every connected client, `clients`.
- `server/core/bars.ts` — `fetchBars(sym, tf)`, `streamBars(sym, tf, onBar)`, and `watchSeries(sym, tf, (bars, closed) => …)`:
  a shared rolling series (history + live) per symbol/tf; `closed === true` when a new bar just began, i.e. `bars.at(-2)` closed.
- `server/state.ts` — `stateGet(key)`, `stateSet(key, value, originClient?)` (bumps `rev`, broadcasts
  `{ type: 'state', key, rev, value, updated }`), `stateDel`, `stateAll()`, `KEY_RE`.
- `server/notify/index.ts` — `notify(notice)`; the stub only does popups (see §4).
- `src/sync.ts` — client: `onServer(type, handler)`, `api(path, { method, body })`, `serverMode`.
- `src/push.ts` — client push API (stub, see §8). `src/alerttypes.ts` — the alert model (§5).
- Server entry `server/index.ts` imports every module; HTTP on 127.0.0.1:8787 (Vite proxies `/api` and `/ws`).

## 3. Sync (agent **sync**)
Owns: `server/state.ts` (add routes + media; keep the existing exports and their behaviour), `server/media.ts` (new),
`src/boot.ts` (new), `src/login.ts` (new), `src/sync.ts`, `src/store.ts`, `src/journal/media.ts`, the persistence parts of
`src/journalui.ts` (load/save only), the `<script type="module">` line in `index.html`, tests.

Server API:
- `GET /api/state` → `{ [key]: { value, rev, updated } }`.
- `PUT /api/state/:key` body `{ value }` (≤ 8 MB, key matches `KEY_RE`) → `{ rev }`; broadcast to the other clients
  (pass the requesting client's socket as `origin` when known — the client sends its socket id in header `x-ct-client`,
  the server keeps a map id → WsClient from a `sync.hello` WS message). Last write wins.
- `DELETE /api/state/:key`.
- `POST /api/media` raw body (`image/*` or `audio/*`, ≤ 15 MB) → `{ id }`; `GET /api/media/:id` → bytes with the stored
  type, `cache-control: private, max-age=31536000, immutable`; `DELETE /api/media/:id`. Table of your choice.

Client:
- `index.html` loads `/src/boot.ts` instead of `/src/main.ts`. Boot: `GET /api/auth/status`.
  - Server unreachable (dev without server / offline) → **offline mode**: run on localStorage only, show a small banner
    "Offline — changes stay on this device". `serverMode = false`.
  - `setup` → first-password screen (only works from this PC; explain that on other devices).
  - not logged in → login screen (password, error text, lockout message from the server).
  - logged in → `GET /api/state`. If the server has **no** state yet and this browser has `ct.*` localStorage keys,
    ask once "Upload the data in this browser to the server?" and upload every key + IndexedDB media (journal pictures/voice
    from the old `ct-journal-media` DB; rewrite media ids if they change). Otherwise write every server value into
    localStorage (`ct.<key>`), removing synced keys the server doesn't have. Then `await import('./main.ts')`.
- `store.set(key, v)` writes localStorage and, in server mode, PUTs the key (debounced ~400 ms per key; retries with
  backoff; a small status dot "synced / saving / offline" is welcome but optional).
- Device-local keys (never synced): `bottomH`, `side`, `jwFormTab`, `tsTab`, `domCfg`, `pineEditing`, `lastTool`, `searchEx`.
- Incoming `{ type: 'state' }` from another device: update localStorage and show one toast
  "Updated on another device — Reload" (reload button). Do not hot-apply (the app reads state at start-up).
- `journalui.ts` currently reads/writes `localStorage['ct.journal']` directly — route it through `store` (same key
  `journal`) so it syncs; keep its quota-error toast.
- `src/journal/media.ts` keeps its exported functions and signatures but stores on the server in server mode
  (IndexedDB stays as the offline fallback).
- The event WebSocket: one socket to `/ws` owned by `sync.ts`, reconnecting; every message with a `type` goes to
  `dispatchServer`. On open send `{ op: 'sync.hello', client: <random id> }`.
- Account menu somewhere unobtrusive (e.g. a button in the top bar): signed-in state, log out, change password,
  devices/sessions list (`/api/auth/*`).

## 4. Notifications (agent **notify**)
Owns: `server/notify/**`, `server/package.json` (add `web-push`, `nodemailer`, `@types/nodemailer`), tests.
Keep the exported `notify(n: Notice): Promise<Delivery[]>`, `Notice`, `Delivery`, `Channel` exactly.
- `popup`: `broadcast({ type: 'notify', id, title, body, sound, data, at })`.
- `push`: Web Push with VAPID keys generated on first use (private key in secrets, public in config).
  Table of subscriptions (endpoint, keys, agent, created, last_ok). Payload JSON `{ title, body, tag, data }`
  (`data.url` = where a click should go). Delete subscriptions on 404/410.
  Routes: `GET /api/notify/push/key` → `{ publicKey }`; `POST /api/notify/push/subscribe` `{ subscription, agent }`;
  `POST /api/notify/push/unsubscribe` `{ endpoint }`.
- `telegram`: token in secret `telegram.token`, chat id in config. `GET /api/notify/telegram/chats` calls `getUpdates`
  and returns the recent chats so the UI can offer “pick your chat” after the user messages the bot.
- `email`: SMTP via nodemailer; config `{ host, port, secure, user, from, to }`, password in secret `email.password`.
- `webhook`: `POST` to `notice.webhook.url` (or the default URL in settings) with the rendered body; `application/json`
  if the body parses as JSON, else `text/plain`; 10 s timeout; http/https only.
- `GET /api/notify/settings` → `{ telegram: { chatId, hasToken }, email: { host, port, secure, user, from, to, hasPassword }, webhook: { url }, push: { subscriptions } }`
  (never secrets). `PUT /api/notify/settings` partial; `token` / `password` fields: string = set, `null` = delete,
  absent = keep. `POST /api/notify/test` `{ channel }` → `Delivery`.
- Per-channel rate limiting/queueing (Telegram ≈ 1 msg/s per chat), a `notify_log` table and `GET /api/notify/log`.
- Export `render(template, vars)` that replaces `{{name}}` (unknown names stay as they are) — the alerts engine uses it.

## 5. Alerts engine (agent **alerts**)
Owns: `server/alerts/**`, tests. Model: `src/alerttypes.ts` (don't change it without listing why in the report).
- Routes: `GET /api/alerts` → `Alert[]`; `POST /api/alerts` `AlertInput` → `Alert` (validate everything; symbols match
  the market module's rules; scripts must compile); `PUT /api/alerts/:id` partial; `DELETE /api/alerts/:id`;
  `GET /api/alerts/log?limit=` → `AlertLog[]`; `DELETE /api/alerts/log`. After any change broadcast `{ type: 'alerts', alerts }`;
  when one fires broadcast `{ type: 'alert.fired', log }` and call `notify()` with the alert's channels (always include
  `popup`), title `"<name or sym> alert"`, body = rendered message, `data: { alertId, sym, tf, url: '/?symbol=…&tf=…' }`.
- Evaluation with `watchSeries(sym, tf)`:
  price → forming bar's close vs `value`/`value2`/line (crossing uses the previous evaluated price; `once_per_bar_close`
  evaluates only the bar that just closed); drawing → `LineRef` price at the evaluation time (trend lines extrapolate
  linearly in time; respect extendLeft/Right); indicator → run the Pine source (`src/pine/engine.ts`) and use plot N;
  script → `alertcondition[index].fired` / `alert()` calls / strategy fills on the last (or last closed) bar.
  Throttle script/indicator runs (≤ 1 per 2 s per alert while a bar forms; always at bar close).
- Frequencies as in TradingView (`once` deactivates after firing). Expiration, auto-stop (default 15 fires in 3 min),
  `stoppedReason`. Persist alerts and log in SQLite; restart-safe.

## 6. Forward tests on the server (agent **runner**)
Owns: `server/forward.ts`, `server/recorder.ts`, tests, and on the client `src/testerui.ts` (forward tab only) and
`src/orderflow/feed.ts` (history source).
- `POST /api/forward` `{ name, sym, tf, job: Job (src/tester/runner.ts), qtyMult, channels: Channel[] }` → `{ id }`;
  `GET /api/forward` → list with status, start time, fills mirrored, last error; `DELETE /api/forward/:id`;
  `GET /api/forward/:id/log`. Broadcast `{ type: 'forward', list }` on change.
- On every live update (throttled 2 s) and every bar close, run the strategy on the series; fills newer than the start
  (dedupe like `testerui.ts` `fillKey`) become market orders on the paper account: read `stateGet('acct')`, apply
  `placeOrder` from `src/trading.ts` at the last close, `stateSet('acct', …)`. Notify on each mirrored fill.
- Client forward tab: in server mode create/stop/list server forward tests (keep the browser-only version for offline mode).

## 7. Trade recording (agent **runner**)
- Config `recorder` `{ symbols: string[] }` (default `['BTCUSDT', 'ETHUSDT']`), retention 30 days.
  Record live prints (Binance plain symbols via the aggTrade stream; `EXCH:` symbols via `ccxt.watchPrints`) into SQLite in
  batches; prune daily. `GET /api/recorder` → `{ symbols, retentionDays, stats: [{ sym, from, to, count, approxBytes }] }`;
  `PUT /api/recorder` `{ symbols }`; `GET /api/recorder/trades?sym=&from=&to=&limit=` → `Print[]` (seconds, ≤ 200 000).
- `src/orderflow/feed.ts` `fetchPrints`: in server mode use the recording first, then fill any gap from the exchange.

## 8. HTTPS on the LAN + Web Push client + PWA (agent **lan**)
Owns: `server/lan.ts`, `public/**` (manifest, `sw.js`, icons), `src/push.ts`, the PWA `<head>` tags in `index.html`,
`docs/lan-setup.md` (Persian, Android + iPhone steps), tests.
- Config `lan` `{ enabled, port: 8443 }`. Certificates with the `openssl` CLI under `DATA_DIR/tls`: a local CA
  (10 years) and a server certificate with SANs for `localhost`, `127.0.0.1` and every non-internal IPv4 of this PC;
  regenerate when the IP set changes. `startLan()` serves `handle(req, res, true)` + `upgrade` over HTTPS on 0.0.0.0.
- `GET /api/lan` → `{ enabled, port, urls, caFingerprint }`; `POST /api/lan` `{ enabled }` (only from localhost).
  Public downloads: `GET /ca.crt` and `GET /ca.mobileconfig` (iOS profile containing the CA).
- `public/sw.js`: `push` → `showNotification`, `notificationclick` → focus or open `data.url`. Manifest + icons so the app can be
  installed (iOS needs Home Screen install for push).
- `src/push.ts`: implement the stub's exports against `/api/notify/push/*`.

## 9. Client alerts + settings UI (agent **ui**)
Owns: `src/main.ts`, `src/alertsui.ts` (new), `src/settingsui.ts` (new), the rest of `index.html`, `src/style.css`, `src/chart.ts` (alert lines only).
- Replace the browser-side price alerts with server alerts in server mode (keep the old behaviour offline). On first
  server-mode start, migrate the old `alerts` state (`{ sym, price, dir, on, drawingId, note }`) to `POST /api/alerts`
  once, then clear it.
- Create-alert dialog like TradingView: source (price / indicator on the chart / drawing / script on the chart),
  condition, value(s), interval, frequency, expiration, message with placeholder help, channels (+ webhook URL). Entry points:
  the existing Alert button / Alt+A, chart context menu, drawing context menu, script legend.
- Alerts side panel: list with status, edit, pause/resume, delete, log with delivery results. Price lines on the chart
  stay (from the server list).
- Popups: `onServer('notify')` → toast + sound + desktop Notification when allowed.
- Settings dialog "Server & notifications": Telegram (token, pick chat, test), Email (SMTP fields, test), default webhook,
  push on this device (`src/push.ts`), trade recording symbols + stats (`/api/recorder`), home network access
  (`/api/lan`, URLs, certificate download links + link to the setup guide).
