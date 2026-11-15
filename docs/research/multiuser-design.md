[English](multiuser-design.md) · [فارسی](multiuser-design.fa.md)

# Multi-user design: PUBLIC and PRIVATE server modes

Status: design only (nothing implemented). Written against the code as of 2026-11-04.
Selector: `CT_MODE=public|private` (default `private`). Private = today's behaviour, byte for byte.

Line references are `file:line` in `server/` unless stated otherwise. "~" means approximate.

---

## 0. Findings that shape everything

1. **Global state is the enemy, not the SQL.** Almost every module loads its rows into a module-level `Map` at import time (alerts `alerts/index.ts:28`, brokers `brokers/index.ts:~45`, forward, recorder config) and pushes changes with the global `broadcast()` (`core/http.ts:146`) to the global `clients` set (`core/http.ts:141`). Eight call sites broadcast (alerts/index.ts:42,169; brokers/index.ts:97,143; forward.ts:75; notify/index.ts:290; state.ts:26,31). In a multi-user server every one of them would leak one user's alerts, notifications, paper account and state to everyone. This is the single most likely source of a cross-user leak.
2. **Settings live in the global `config` table** (`core/db.ts:24`): `auth.password`, `notify.telegram/email/webhook`, `notify.vapid.public`, `lan`, `recorder`. These are per-server today and must be split into server-level and per-user.
3. **User code runs inside the server process.** `src/mql/compiler/index.ts:42` and `src/ninja/compiler/index.ts:39` do `new Function(...)` on compiled user source, and Pine is interpreted in the same engine pool (`engine.ts:50`, `engineworker.ts`). A worker thread shares the process environment (`CT_SECRET_KEY`, files, network, dynamic `import()`), and `new Function` code can call `import('node:fs')`. This is remote code execution for any registered user. **It must be off in public mode.** The timeout in `engine.ts` (`RUN_TIMEOUT` 20 s) bounds CPU only, not capability.
4. **Client IP is the socket address** (`core/auth.ts:53`). Behind Caddy/Docker every request comes from 127.0.0.1 or the bridge IP, so per-IP throttling and the "localhost-only setup" check (`authroutes.ts:18`) silently degrade. `secure` is hard-coded `false` for the HTTP listener (`index.ts:~25`, `http.ts:71`), so the session cookie would never get `Secure` behind a TLS proxy. The listener is hard-wired to `127.0.0.1` (`index.ts:24`), which suits a proxy on the same host but not Docker's bridge network.
5. **Market-data fan-out is already shared.** `market.ts:80` (`feeds` map keyed `exchange|symbol|tf`) and `core/bars.ts:28` (`series` keyed `sym|tf`) multiplex many clients onto one upstream stream. What is missing are caps (per socket, per user, global distinct streams) and a REST response cache for `/api/bars`.
6. **Brokers are testnet-only today** (`brokers/safety.ts` allow-list), but the plumbing (encrypted API keys in `secrets`, `broker_accounts`, emulated OCO/trailing orders, polling loop) is exactly what must never exist on the public host, even for testnets: a compromised public server would hold keys and could be made to trade.
7. **Share links and media are un-owned.** `GET /api/media/:id` and `DELETE /api/media/:id` (`media.ts:21,31`) and `DELETE /api/share/:id`, `GET /api/share`, `GET /api/share/layout/:id` (`share.ts:50-54`) check only "logged in", never ownership. Ids are 128-bit random, so today this is safe by unguessability only; under multiple users it is an IDOR by design.

---

## 1. Inventory

Legend: **U** = per-user data (needs owner scoping), **G** = global/shared (safe to share), **X** = disabled in public mode, **S** = server-level setting (admin/env only, not per user).

### 1.1 Tables

| Table | Defined | Class | Notes |
|---|---|---|---|
| `_migrations` | core/db.ts:13 | per DB file | Run in every user DB and in the users DB. |
| `config` (key/value) | core/db.ts:24 | split | See 1.3. `auth.password` goes away (users table). `notify.*`, `recorder` become per-user (U). `lan` is X. `notify.vapid.public` is S. |
| `secrets` | core/secrets.ts:8 | **X** for exchange/broker keys; **S** for the server's own VAPID private key | Public mode: `secretSet` refuses any name starting `broker:`; user-supplied Telegram bot token / SMTP password are also refused (see 1.2 notify). Only server-owned secrets remain (`push.vapid.private`). |
| `sessions` | core/auth.ts:7 | S (central) | Gains `user_id`, `expires`. Lives in `users.db`. |
| `state` | state.ts:8 | **U** | The synced `ct.*` documents: layouts, drawings, watchlists, scripts, settings, paper account `acct`, journal. Largest per-user store. Key charset `KEY_RE` state.ts:~13. PUT limit 8 MB (state.ts:58). |
| `media` | media.ts:7 | **U** | Journal pictures/voice (BLOB, 15 MB each). Needs owner and quota. |
| `shares` | share.ts:10 | **U** (owner) but `GET /s/:id` is intentionally public | Snapshot images are public-by-link; layouts are logged-in-only by id. Needs owner column for list/delete; per-user bytes quota. |
| `alerts`, `alert_log` | alerts/index.ts:22-23 | **U** | `alert_log` also stores TradingView-imported rows (20k per import, alerts/index.ts:~196). |
| `notify_push_subs` | notify/index.ts:34 | **U** | `endpoint` is the primary key today; two users cannot share an endpoint (see 6). |
| `notify_log` | notify/index.ts:35 | **U** | Trimmed to 2000 rows globally (notify/index.ts:~296); must trim per user. |
| `forward`, `forward_log` | forward.ts:21-25 | **U**, **X** in public | Runs user Pine/MQL/Ninja server-side and writes into the user's paper account. |
| `prints`, `prints_days` | recorder.ts:13-15 | **G** data, **X** in public | Tick recorder is a shared resource (disk and upstream connections); in public mode off by default, optionally admin-configured shared list that users read but cannot change. |
| `broker_accounts`, `broker_day`, `broker_emu` | brokers/index.ts:22-24 | **X** | Keys, orders, emulated triggers. Never exist on the public server. |
| `dominance` | marketdata.ts:7 | **G** | CoinGecko history. |

New tables (central `users.db`): `users`, `sessions`, `invites`, `recovery_codes`, `audit`, `login_attempts` (see 2).

### 1.2 Modules and routes

| Module / file | Routes (file:line) | Class | Public-mode action |
|---|---|---|---|
| `authroutes.ts` | `/api/auth/status|setup|login|logout|password|sessions` (:15-40) | S | Rewrite (see 2). `setup` removed in public (replaced by first-admin flow). Sessions list/delete must filter by `user_id` (`core/auth.ts:listSessions`, `endSessionById` currently list/delete everything). |
| `state.ts` | `GET /api/state`, `PUT|DELETE /api/state/:key` (:55,56,61); WS `sync.hello` (:43) | U | Scope by user. `tabs` map (state.ts:~42) is keyed by random tab id: key by `(userId, id)`. |
| `media.ts` | `/api/media`, `/api/media/:id` (:12,21,31) | U | Add owner + quota; 404 on foreign id. |
| `share.ts` | `/api/share/*`, `/s/:id` (:24-54) | U/public-by-link | Owner column; `/s/:id` stays public but add per-user cap and CSP already set (share.ts:~33). |
| `alerts/` | `/api/alerts*` (:180-222), WS `alerts`, `alert.fired` | U | Scope. Public: only `price`, `indicator` with **built-in** indicators and `drawing` conditions; reject `kind:'script'` and `code` sources (`alerttypes.ts:15-17`). `DELETE /api/alerts/log` (:195) today wipes the entire table. |
| `notify/` | `/api/notify/push/*`, `settings`, `test`, `log`, `telegram/chats` (:192-316) | U | Push: keep. Telegram bot token, SMTP and free-form webhook URL are per-user outbound channels that turn the server into an SSRF/spam relay: **public mode allows push + in-app popup only** (admin may enable a shared server-owned Telegram bot, user supplies only a chat id, later). `sendWebhook` (:266) and `sendEmail` (:250) disabled. `GET /api/notify/telegram/chats` (:237) calls `getUpdates` with the server's token and would list *other users'* chats: disabled. |
| `forward.ts` + `engine.ts` + `engineworker.ts` + `scripts.ts` + `scriptsource.ts` | `/api/forward*` (:181-184), WS `forward.fills` | **X** | Remove routes and `resumeAll()` (:189). The worker pool is never started. |
| `recorder.ts` | `/api/recorder*` (:211-226) | **X** (read-only optional) | See 1.1. |
| `brokers/` (+ `ccxtx.ts`, `nobitex.ts`, `mt5.ts`, `emulate.ts`, `risk.ts`) | `/api/broker/*` (:634-643) | **X** | Module not imported at all in public mode (gate in `index.ts`, not inside handlers). |
| `core/secrets.ts` | none | **X**/S | See 1.1. |
| `llm.ts` | `/api/ai/status|chat` (:52-53) | **X** | Proxies to loopback LLM servers (Ollama / LM Studio). On a VPS that is the server's own localhost, a free compute and port-probe oracle. |
| `mt5.ts` | none (used by `market.ts`) | **X** | `market.ts` lists `mt5` as an exchange (`market.ts:~46`); remove it from `/api/exchanges` and `LOCAL` set in public mode. |
| `ml.ts` | `/api/ml/:task` (:37) | **X** | Spawns Python (`execFile`, :14), 20 MB bodies, 120 s. |
| `lan.ts`, `lan/*` | `/api/lan`, `/ca.crt`, `/ca.mobileconfig` (:72-95) | **X** | Local CA and 0.0.0.0 HTTPS listener are meaningless on a VPS (TLS comes from Caddy). `/ca.*` are public routes that hand out a CA. |
| `market.ts`, `core/bars.ts`, `ccxt.ts`, `ccxtlib.ts`, `yahoo.ts` | `/api/health` (public), `/api/exchanges|markets|bars|tickers|trades|calendar|dividends` (:203-205), WS `sub|unsub` (:150) | **G** | Keep (login required). Add caps and caching (4). |
| `derivs.ts` | `/api/derivs/:kind` (:143) | **G** | Keep; already cached and per-exchange limited (derivs.ts:35-62). Liquidation feeds are shared (`liqFeeds`, :72) but start a websocket per (ex,sym) on demand: cap total. |
| `marketdata.ts` | `/api/news|dex|coins|global|breadth|uptrend|treasury|us-stocks` (:90-131) | **G** | Keep; cached with stale fallback. |
| `sec.ts`, `ptr.ts` | `/api/sec/*`, `/api/ptr/*` | **G** | Keep. `ptr.ts` shells out to `pdftotext` on fetched PDFs: keep disabled by default in public (parser surface), admin opt-in. SEC fetches serialize through one global `polite()` queue (sec.ts:~12): one user can starve others, add per-user fairness. |
| `index.ts` | imports :4-21, `HOST` :24 | S | Mode switch lives here (see 3.4). |
| client `desktop/`, `lite/` | spawns `server/index.js` with `CT_DATA_DIR` | private | Unchanged; they always run `private`. |

### 1.3 Config keys

| Key / env | Today | Public mode |
|---|---|---|
| `auth.password` | single scrypt hash (`core/auth.ts:17`) | removed (users table) |
| `notify.telegram`, `notify.email`, `notify.webhook` | global | private only |
| `notify.vapid.public` + secret `push.vapid.private` | global, auto-generated (notify/index.ts:156) | S: one VAPID pair per server, from `CT_VAPID_*` env or generated once; never regenerated automatically, because regenerating deletes every subscription (:~162) |
| `recorder` | global symbol list | private only |
| `lan` | global | private only |
| env: `CT_DATA_DIR`, `CT_DB`, `CT_SECRET_KEY`, `CT_ALLOWED_HOSTS`, `CT_DIST_DIR`, `CT_NO_AUTOSTART`, `CT_LAN`, `CT_ENGINE_WORKERS`, `CT_LLM_*`, `CT_PYTHON`, `CT_SEC_USER_AGENT`, `PORT`, `MT5_BRIDGE_PORT` | | Public ignores `CT_LAN`, `CT_ENGINE_WORKERS`, `CT_LLM_*`, `CT_PYTHON`, `MT5_*`. |

---

## 2. Authentication

### 2.1 Data model (`users.db`, public mode only)

```
users(id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE, pw TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',          -- 'admin' | 'user'
      status TEXT NOT NULL DEFAULT 'active',      -- 'active' | 'disabled'
      must_change INTEGER NOT NULL DEFAULT 0,     -- set after an admin reset
      created INTEGER, last_login INTEGER, invited_by INTEGER, quota TEXT /* JSON overrides */)
sessions(token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users ON DELETE CASCADE,
         created INTEGER, last_seen INTEGER, expires INTEGER, agent TEXT, ip TEXT)
invites(code_hash TEXT PRIMARY KEY, created_by INTEGER, uses_left INTEGER, expires INTEGER, note TEXT)
recovery_codes(user_id INTEGER, code_hash TEXT, used INTEGER DEFAULT 0, PRIMARY KEY (user_id, code_hash))
login_attempts(key TEXT PRIMARY KEY, n INTEGER, until INTEGER)     -- persisted so a restart does not reset a lockout
audit(id INTEGER PRIMARY KEY, at INTEGER, user_id INTEGER, ip TEXT, event TEXT)  -- login ok/fail, register, reset, delete, admin actions; capped
```

Private mode keeps today's `config['auth.password']` and `sessions` table untouched; `Ctx` gets a synthetic `user = { id: 1, role: 'admin' }`, so handlers are written once against `c.user`.

### 2.2 Registration (no email infrastructure)

- `CT_REGISTRATION=invite|open|closed`, default **invite** in public mode.
- Username `^[a-z0-9_.-]{3,32}$` (case-insensitive unique), reserved names blocked (`admin`, `root`, `system`...).
- Password: 10 to 200 characters (upper bound prevents scrypt-based DoS), rejected if in a bundled list of ~10k most common passwords or equal to the username. No composition rules.
- `POST /api/auth/register {name, password, invite?}`: invite codes are 128-bit random, stored hashed, with `uses_left` and `expires`; the admin makes them with the CLI or `POST /api/admin/invites`.
- On success the response shows **8 recovery codes once** (see 2.6) and sets the session cookie.
- Open registration (if the owner insists) needs, at minimum: per-IP limit 3 registrations/hour, a global cap of N new users/day, and a hashcash-style proof of work (client computes a SHA-256 prefix, ~2 s) because CAPTCHA/email are not available. Default stays invite-only.
- Constant-time, uniform responses are not possible for registration (a taken username is visible); accept that, but rate-limit it.

### 2.3 Password hashing

Keep scrypt (already in `core/auth.ts:17`, `node:crypto`, no new dependency) but:
- Store a self-describing string `scrypt$N$r$p$salt$hash` (N=2^15, r=8, p=1, 64-byte key, 16-byte salt) so parameters can be raised later and old hashes rehashed on next login.
- Use the **async** `crypto.scrypt` with a 2-slot semaphore. The current `scryptSync` (auth.ts:17,23) blocks the event loop ~50-100 ms per attempt, which makes login a trivial DoS on a server with live market sockets.
- Always run one scrypt, with a dummy salt, when the username does not exist (equalises timing, avoids user enumeration).
- Compare with `timingSafeEqual` (already done).

### 2.4 Login throttling

Replace the single in-memory per-IP map (`core/auth.ts:28-31`) with three independent limits stored in `login_attempts`:
1. per IP: 10 failures / 10 min, then exponential lock up to 1 h;
2. per (account, IP) pair: 5 failures, exponential;
3. per account (any IP): after 20 failures/hour add a **delay** (1 s per excess attempt, max 10 s), do not hard-lock, otherwise an attacker locks the victim out forever.
Plus a global limiter on `POST /api/auth/*` (60/min/IP) and uniform error text "Wrong username or password".
Client IP comes from a trusted-proxy helper (3.4): `CT_TRUST_PROXY=1` reads `X-Forwarded-For` only when the socket peer is the proxy (loopback or `CT_PROXY_IPS`), and takes the right-most untrusted hop. Caddy must be configured to overwrite, not append, the header.

### 2.5 Sessions and cookies

- Keep opaque 32-byte tokens, SHA-256-hashed at rest (`core/auth.ts:34-35`, good as is). Add `user_id` and an absolute `expires` (30 days; idle 14 days) rather than the current 60-day sliding window (`SESSION_DAYS`, auth.ts:~9).
- Cookie `__Host-ct_session; Secure; HttpOnly; SameSite=Strict; Path=/` in public mode (requires `Secure`, hence the trusted `X-Forwarded-Proto`). Today's `sessionCookie` (auth.ts:51) already has the other attributes.
- Password change and admin reset delete all of that user's sessions (today: `DELETE FROM sessions`, auth.ts:18, all users). Per-user cap of 20 sessions; oldest evicted.
- WebSocket: `WsClient` gets `userId` (http.ts:137). On logout, disable or delete, close that user's sockets (`authroutes.ts:42-44` already closes by session id; extend to user).

### 2.6 Account lifecycle

- **Delete account**: `DELETE /api/account {password}` → remove sessions, push subscriptions, alerts from memory registry, stop watchers, then `unlink` the user's DB file (+ `-wal`, `-shm`), delete the `users` row, write an audit line without personal content. Share links die with the file. Also available to the admin via CLI.
- **Data export**: `GET /api/account/export` → streams a JSON (or zip) of state, alerts, alert_log, notify settings (no subscription endpoints), journal media. Implementation with per-user files: `VACUUM INTO` a temp file then stream/serialise; rate-limited to 1/hour; size-capped.
- **Admin role**: the first admin is created out of band, never by a race on `/register`: `CT_ADMIN=<name>` and on first start the server prints a one-time password (or `node server/cli.ts create-admin <name>` prompting for it). The admin can list users (name, created, last_login, bytes), disable/enable, reset password, delete, create invites. The admin **cannot read user data** by design (no impersonation endpoint); this should be stated in the UI privacy note. Admin routes require role + re-entering the admin password (step-up) + are only reachable with `Origin` same-site.
- **Password reset without email**:
  1. *Recovery codes*: 8 single-use codes (80 bits each, shown once at registration or regenerated from settings), hashed with scrypt; `POST /api/auth/recover {name, code, newPassword}` throttled like login. Consuming a code signs out all sessions and offers a fresh set.
  2. *Admin reset*: CLI/endpoint sets a random temporary password shown once to the admin, `must_change=1`; the user is forced through a change-password screen before any other API works.
- **Disabled users**: sessions rejected at `sessionOf`, sockets closed, alert evaluation paused.

### 2.7 CSRF, Origin, Host

- `sameOrigin()` (`core/http.ts:109-112`) accepts requests with no `Origin` (curl/tests). In public mode, for non-GET requests with a cookie session: require `Origin` host equal to `Host`, **or** `Sec-Fetch-Site: same-origin`, **and** require the custom header `x-ct-client` (the client already sends it, `src/sync.ts:api`); a cross-site form cannot set it. Keep `SameSite=Strict` as the second layer. Bearer-token clients (Android app later, 5) skip cookie CSRF but never get cookies.
- WebSocket upgrade (`http.ts:150`): require `Origin` in public mode (browsers always send it).
- `allowedHost` (`http.ts:131`): in public mode only `CT_ALLOWED_HOSTS` is accepted (drop the loopback and machine-IP allowance, except for the healthcheck path), preventing DNS-rebinding and Host-header tricks.
- Security headers: add `Strict-Transport-Security` (from Caddy), a CSP for the app shell (`default-src 'self'; connect-src 'self' wss: https://data-api.binance.vision ...; img-src 'self' data: blob:`), `Permissions-Policy`, in `SECURITY_HEADERS` (`http.ts:54`). `X-Frame-Options: DENY` already there.

---

## 3. Isolation

### 3.1 Options compared

**A. `user_id` column + a single data-access wrapper.**
+ one file, one backup, trivial cross-user admin queries and alert evaluation order;
- every table and every query needs `WHERE user_id = ?`; one forgotten clause anywhere (70+ routes, raw `db.prepare` in 12 files) leaks data, and the leak is silent. Tests must prove a negative on every route;
- in-memory registries and `broadcast` still need the same rewrite;
- per-user export/delete means filtered copies and many `DELETE ... WHERE user_id`;
- one noisy user's writes and WAL checkpoints affect everyone; one corrupt page corrupts all.

**B. One SQLite file per user** (`data/users/<id>.db`) + a small central `users.db`.
+ **isolation by construction**: a handler only receives `c.db` for its own user; a missing filter cannot cross users because the other rows are not in that file. A foreign id simply 404s. IDOR across 70+ routes becomes a non-issue for all SQL-backed data;
+ export = `VACUUM INTO` one file; delete = unlink; quota = file size (plus `PRAGMA max_page_count` as a hard cap);
+ no schema change to existing module tables (no `user_id` columns, no migration of the private DB: the private-mode `chart-terminal.db` *is* user 1's file);
+ failures and writes are isolated; WAL per file;
- many open handles: use an LRU of at most ~64 `DatabaseSync` handles, closed after 5 min idle; open + migrate lazily (each migration list is small);
- cross-user jobs (alert evaluation, push fan-out) must iterate users: solve with an in-memory registry loaded at boot from a small `users.has_active_alerts` hint and populated lazily;
- backups are N files (use `VACUUM INTO` in a nightly loop, or Litestream per file); acceptable for hundreds to low thousands of users, revisit past ~10k.

**Recommendation: B.** The deciding reason is the 100+ route / 12-file surface with module-level `db` imports: B converts "remember to filter in every query" into "there is no way to reach another user's rows", which is the only property that holds up under future edits. The remaining cross-user leak surface is the in-memory layer and WebSockets, which both options need to fix anyway (3.2). Keep a lint/test guard that no module outside `core/` imports `db` directly.

### 3.2 Mechanics

1. `core/db.ts` keeps exporting `db` for private mode (the single DB) and gains `userDb(id): DatabaseSync` (LRU; applies all registered migrations lazily; `DATA_DIR/users/<id>.db`). `migration(name, sql)` is currently run once at import against the one DB (`db.ts:16-21`); change it to *register* `(name, sql, scope: 'user'|'central')` and run on open. Private mode runs them immediately on the single DB exactly like today.
2. `Ctx` (`core/http.ts:15`) gains `user: { id, name, role }` and `db: DatabaseSync`. The auth gate (`http.ts:82`) fills them. Handlers use `c.db`, never a module-level `db`. TypeScript then flags every unconverted module (the compile step `tsc --noEmit` is already in `npm run build`).
3. `WsClient` gets `userId`; `broadcast(msg, except)` → `broadcastTo(userId, msg, except?)`. The old name is removed so every one of the 8 call sites fails to compile until given a user (this is the cheap, mechanical safety net).
4. Per-user in-memory registries: `alerts: Map<userId, Map<id, Alert>>`, `states` keyed `(userId,id)`. Alert watchers stay shared by `(sym,tf)` (`alerts/index.ts:52-59`) with a reverse index to the owners.
5. Background work that has no request (alert firing, push) uses `withUser(id, fn)` to get `db` and the broadcast target.
6. Lint test: grep that `from '../core/db.ts'` appears only in `core/`, `users/` and the CLI.

### 3.3 Isolation test plan

- `server/isolation.test.ts` (node:test, in-process, `CT_MODE=public`, temp `CT_DATA_DIR`, `CT_NO_AUTOSTART=1`):
  1. register users A and B (invite), log both in (separate cookie jars);
  2. as A create one of everything: state keys, alert, push subscription, media, share snapshot + layout, notify settings;
  3. enumerate **every registered route** from the router (`routes` array exposed in test builds) and, as B, call each with A's ids and with list/query variants; assert the response body contains none of A's marker strings (use unique markers like `A-SECRET-<random>` in every stored value) and that id-addressed routes answer 404, not 200 or 403 (403 leaks existence);
  4. WebSocket: connect A and B, mutate as A, assert B receives no frame containing the marker (covers `broadcast`);
  5. public-mode blocklist: assert `/api/broker/*`, `/api/forward*`, `/api/ml/*`, `/api/ai/*`, `/api/lan`, `/ca.crt`, `/api/recorder` PUT, `/api/notify/telegram/chats` all answer 404 (routes absent, not just forbidden), and `POST /api/alerts` with `kind:'script'` answers 400;
  6. route-coverage guard: fail the test if a route exists that the test table does not classify (U/G/X/auth), so new routes cannot ship unreviewed;
  7. deletion: delete A, assert the file is gone, A's cookie is rejected, A's share link 404s, B unaffected;
  8. session: B cannot list or delete A's sessions (`/api/auth/sessions`).
- Fuzz variant: random ids, path traversal in `:key`, oversized bodies, `Content-Type` mismatch.

### 3.4 Mode gating and proxy trust (the `CT_MODE` switch)

- `server/core/mode.ts`: `export const MODE = process.env.CT_MODE === 'public' ? 'public' : 'private'`; fail fast on any other non-empty value.
- `index.ts`: replace the unconditional imports (:4-21) with a list per mode. Public does **not import** `brokers`, `forward`, `engine`, `recorder`, `llm`, `ml`, `lan`, `mt5`, so there is no code path to reach, not merely a guarded handler. Public refuses to start if `CT_SECRET_KEY` is set to anything (keys must not exist) or if `server/data/secret.key` is present with broker secrets.
- Public listener: `CT_HOST` (default `127.0.0.1`, compose sets `0.0.0.0` inside the container network only), `CT_TRUST_PROXY`, `CT_PUBLIC_URL` (used for `secure`, cookie `__Host-`, CORS and VAPID subject).
- Public startup self-check: refuses to run with `CT_ALLOWED_HOSTS` empty, `NODE_ENV` unset warns.
- `/api/auth/status` advertises `{ mode, registration, features: { brokers:false, ... } }` so the client can adapt (5).

---

## 4. Quotas and abuse controls

All limits are in `server/core/quota.ts` with defaults per mode and per-user overrides in `users.quota`. A request that exceeds a quota gets `429` or `413` with a human message.

| Resource | Today | Public default | Where |
|---|---|---|---|
| Alerts per user | 500 global (`alerts/index.ts:25`) | 50 | createAlert (:~182) |
| Distinct (sym,tf) watched by all alerts | unbounded | 400 server-wide, per-user 30 | `sync()` (:52) |
| Alert log rows | 5000 | 1000/user | trim in `fire` |
| Push subscriptions | unbounded | 5 per user | subscribe (notify/index.ts:193) |
| Notifications/min | per-channel queue of 30 (:54) | 20/min/user, 200/day | `notify()` (:282) |
| State bytes | 8 MB per PUT, unlimited keys | 20 MB total, 200 keys, 2 MB per key except `journal` (8 MB) | state.ts:58 |
| Media | 15 MB each, unlimited | 100 MB total, 15 MB each, 200 items | media.ts:12-19 |
| Shares | unlimited | 50 links, 30 MB total, snapshot 4 MB | share.ts:24 |
| DB file | none | 150 MB hard (`PRAGMA max_page_count`) | `userDb` |
| Request rate | none | token bucket 20 req/s sustained, burst 60 per user; 5 req/s per IP unauthenticated | http.ts before the handler |
| WebSocket | unbounded | 4 sockets/user, 1 KB/msg after hello, 20 msg/s, max 40 market subscriptions per socket, 100 per user | http.ts:149, market.ts:119 |
| Body limits | 2 MB default | 256 KB default; per-route larger only where needed | `route()` http.ts:30 |
| Uploads limit by content | content-type only | additionally sniff magic bytes for png/jpeg/webp/gif and reject mismatches | media.ts, share.ts |
| Concurrent in-flight requests | none | 16 per user | http.ts |

### 4.1 Server-side script execution: **disable in public mode**

Recommended and non-negotiable (finding 0.3): no engine pool, no `forward`, no `kind:'script'` alerts, no MQL/Ninja compile on the server, no `ml`. Pine/MQL/Ninja strategies, indicators and backtests keep working fully in the user's browser (the interpreters live in `src/`). If server-side script alerts are ever wanted, the minimum viable sandbox is: Pine only (the interpreter, not `new Function`), a separate OS process per tenant group with no env, `--permission` flags with no fs/net, cgroup CPU/memory limits (systemd `CPUQuota`), 1 s per run and 2 runs/s/user. That is a project of its own; do not start with it.
Users who need script alerts or forward tests run a private-mode server (their own PC) and point the client at it (5).

### 4.2 Market-data fan-out for 1000 users

What already works: one upstream feed per `(exchange,symbol,tf)` (`market.ts:80-118`), one bar series per `(sym,tf)` for alerts (`core/bars.ts:28`), shared CCXT instances (`ccxt.ts:11`), cached derivs/macro/news (see 1.2).
To add:
1. **Global caps on distinct upstream feeds**: e.g. 300 candle feeds, 60 trade feeds, 40 order-book feeds (`market.ts:119-149`); beyond the cap a new subscription is refused with a typed `{type:'error', code:'feed_limit'}` unless an existing feed matches. Order-book and trades feeds are expensive: restrict to users with an account age or an admin flag if needed.
2. **Idle teardown with grace**: feeds already stop when `subs` is empty (`market.ts:~95`); add a 20 s grace period so reconnect flapping does not churn upstream sockets.
3. **REST cache + request coalescing** for `/api/bars` (`market.ts:~63`, `ccxt.ts:74`): key `(exchange,symbol,tf,until,limit)`, TTL 5 s for the latest page, 10 min for historical `until` pages, in-flight promise sharing, LRU of 500 entries / 64 MB. Same for `/api/tickers` (TTL 3 s) and `/api/trades`.
4. **Per-exchange outbound token bucket** shared by all users (CCXT's built-in limiter is per instance; cap at ~60% of the exchange's published weight limit) with fair queuing per user so one user's backfill cannot starve others.
5. **Alerts feed from the 1-minute kline once per symbol** and derive larger timeframes (the code already aggregates in `market.ts` `emitAgg`); today `streamBars` for plain symbols opens a Binance kline socket per `(sym,tf)` (`src/data.ts:~128`), so 1000 users x 10 alerts could mean thousands of sockets. Use Binance combined streams (`/stream?streams=`, up to 1024 streams per connection) and one connection pool.
6. **Yahoo/FX** polling every 15 s per symbol (`market.ts:~97`): share by symbol and cap to 100 symbols.
7. Metrics on feed counts exposed at `/api/admin/stats` (admin only) and logged every minute.

### 4.3 Other abuse vectors

- `GET /api/alerts/log` etc. are cheap, but `importLog` accepts 20,000 rows per call (alerts/index.ts:~196) and `PUT /api/state` 8 MB: covered by the byte quotas.
- `/s/:id` is public and served from the app origin; keep `nosniff` + CSP sandbox (already) and consider serving user images from a separate cookieless origin (`CT_SHARE_ORIGIN`) so a content-sniffing bug cannot ride on the app origin's cookies.
- Outbound SSRF surface in public mode is reduced to push-service endpoints. `notify_push_subs.endpoint` is user-supplied and fetched by `web-push`: require https and an allow-list of known push hosts (`fcm.googleapis.com`, `*.push.apple.com`, `*.notify.windows.com`, `updates.push.services.mozilla.com`, `*.push.services.mozilla.com`); reject IP literals and everything else. (Today only `https://` is checked, notify/index.ts:~197.)

---

## 5. Client: two servers

### 5.1 Concepts

- **Sync server** (`syncUrl`): holds account, synced state, alerts, push. Can be the public server or the user's private server. This is where the app is *served from* by default.
- **Trading server** (`tradeUrl`): optional, **must be** the user's private server or `localhost`; brokers, forward tests, recorder, LLM, MT5, ML live here.
- Private-mode server = both roles (today's single-server experience stays the default and needs no new UI).

### 5.2 What changes in `src/`

- Today every call is same-origin and relative (`api()` in `src/sync.ts`, raw `fetch('/api/...')` in `boot.ts:11`, `journal/media.ts:21,44`, `ai/panel.ts:81`, `sync.ts:169`; three WebSocket constructors at `data.ts:74`, `orderflow/feed.ts:142`, `sync.ts:158` all use `location.host`). Introduce `src/servers.ts`: `endpoints = { sync: {base, token?}, trade: {base, token?} }`, `apiSync(path)`, `apiTrade(path)`, `wsUrl('sync'|'trade')`; replace the raw fetches (5 places) and `new WebSocket` (3) with it. `broker/remote.ts` (`RemoteBroker`, `call: Api = api`, :12-16) is already injectable: construct it with `apiTrade`; `ai/panel.ts`, `ml` callers, `recorder` readers (`orderflow/source.ts`) likewise.
- **Auth across origins**: cookies with `SameSite=Strict` do not work when the page is served from server A and calls server B. Options: (a) the page is always served by the *sync* server and the trade server is only used by `fetch` with `Authorization: Bearer <token>` (no cookies), with CORS on the trade server restricted to the exact page origin; (b) the user opens the app from the trade server directly. Choose (a): add device tokens to private mode: `POST /api/auth/device {password}` → long-lived random token (hashed server-side, revocable in the existing sessions list). WS carries it as a first message `{op:'auth', token}` (not in the URL, to keep it out of logs). The trade server's CORS allow-list is a setting (`CT_CORS_ORIGINS`), default empty, so nothing changes for existing users.
- **Mixed content**: a page served over HTTPS (public) cannot call `http://192.168.x.x`. The trade server therefore must be `https` (the existing LAN CA flow, `docs/lan-setup.md`) or the user reaches it through a tunnel (Tailscale/Cloudflare Tunnel) that gives it real HTTPS. `http://localhost` is exempt in browsers (secure context), so a desktop-app user on the same PC works; document this explicitly. The Electron desktop shell keeps loading its own bundled server (same origin) and can be a trade server for the web app.
- **Never send trade credentials to the sync server**: `apiTrade` has no fallback to `apiSync`; if `tradeUrl` is empty the broker/forward/ML/AI UI is hidden. A unit test asserts that no code path calls `/api/broker` through the sync client.

### 5.3 UI

- **Server picker** on the first screen and in Settings → Servers: list of saved servers `{name, url, role}`; "Add server" probes `GET /api/auth/status` (gets `mode`, `registration`, `features`) and tells the user what kind of server this is. Stored in `localStorage` only (not synced; it is per device and contains tokens).
- **Sign-up / login screens** (`src/login.ts`): replace the password-only `loginScreen` with username + password; add "Create account" (invite code field when `registration:'invite'`), recovery-code display with "I saved them" checkbox, "Forgot password? use a recovery code", and the forced password-change screen. Private mode keeps the single-password screen (status says `mode:'private'`).
- **Account menu** (`login.ts:accountMenu`): "Exchange accounts…" entry hidden on public servers; add "Export my data", "Delete my account", "Recovery codes".
- **Hide trading UI on public**: when `features.brokers === false` and no trade server is set, hide the Accounts side panel (`main.ts:795` `renderAccounts`, rail button `data-side="accts"`), order-ticket broker selector (`main.ts:1007`; only the built-in Paper broker remains, which is fully client-side and synced as state `acct`), Forward-test UI, AI panel, ML tools, recorder settings, LAN settings.
- **Explain why**: a one-time notice and a persistent "Why?" link: "This public server never stores exchange keys or places orders. To trade, connect your own server (your PC or a private server) under Settings → Trading server." Include a short how-to link to `docs/headless-server.md` and a QR/URL helper.
- **Paper trading** stays fully usable on public servers, it is local state.
- **Android/PWA**: the installed app is bound to the page origin (`docs/android.md`); users choose one origin as home. Supporting "public home + private trade" in a PWA relies on 5.2(a) with CORS. A later native shell (Capacitor) can hold both URLs natively.
- The `lite/` and `desktop/` builds keep `private` and are unaffected.

---

## 6. Web Push

- VAPID: one key pair per **server** (not per user). Web Push binds a subscription to the application server key, so per-user keys would force re-subscription and buy no isolation. Keep `notify.vapid.public` / secret `push.vapid.private` (notify/index.ts:156-163) but: public mode reads `CT_VAPID_PUBLIC`/`CT_VAPID_PRIVATE` (or generates once and persists to `users.db`/`secrets`), and **never auto-regenerates**: the current code wipes all subscriptions when either key is missing (:~162). A lost key must fail loudly.
- `vapidSubject()` (:~164) currently uses an email from the user's SMTP config, else `chart-terminal@example.com`. Use `CT_VAPID_SUBJECT` (`mailto:` or `https:` URL of the operator).
- Subscriptions: table per user (in the user DB). `sendPush(n)` (:171) queries all rows; make it `sendPush(n, userId)` using that user's DB. Because `endpoint` is a primary key, the same browser subscribing under two accounts (account switch) would be last-writer-wins on one DB, but with per-user files the same endpoint could end up in two users' files and notify the wrong person after a logout/login switch. Fix: central `push_endpoints(endpoint PRIMARY KEY, user_id)` in `users.db`; subscribing moves the endpoint to the new user and deletes it from the previous user's file; logout optionally unsubscribes.
- Payloads carry no secrets beyond alert text; keep `data.url` same-origin only (the service worker already enforces it, `public/sw.js`).
- Caps: 5 subscriptions/user, remove on 404/410 (exists, :~180), purge subscriptions not `last_ok` for 60 days.
- Fan-out: a send queue with global concurrency 20 and a per-user rate limit (4); web-push returns 429s from push services when abused, back off with jitter.
- Service worker: the `pushsubscriptionchange` handler "needs a logged-in session cookie" (sw.js tail); under multi-user this is correct, but cache nothing user-specific in the worker.
- Private mode: unchanged, a single user, own VAPID pair.
- **Push from the private server for an app logged in to a public server**: the browser has one subscription per service worker scope, and the service worker is bound to the page origin. If the home origin is the public server, push comes from the public server's VAPID key; alerts evaluated on the private server cannot push directly. Two designs: (i) private server alerts only push when the page origin is the private server; (ii) later: private server forwards fired alerts to the public server's authenticated `POST /api/notify/relay` for that user (user-supplied device token), which then pushes. Ship (i) first and document it.

---

## 7. Deployment (VPS, no publishing)

Files to write later (do **not** commit any real secrets or domain). Layout: `deploy/` with `Dockerfile`, `compose.yaml`, `Caddyfile`, `chart-terminal.service`, `.env.example`.

### 7.1 Dockerfile (multi-stage, non-root, read-only rootfs friendly)

```dockerfile
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build                      # tsc --noEmit && vite build -> dist/
FROM node:24-bookworm-slim AS deps
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev
FROM node:24-bookworm-slim
ENV NODE_ENV=production CT_MODE=public CT_DATA_DIR=/data CT_DIST_DIR=/app/dist CT_HOST=0.0.0.0 PORT=8787
WORKDIR /app
COPY --from=deps /app/server/node_modules server/node_modules
COPY server server
COPY src src                            # server imports shared code from ../src
COPY --from=build /app/dist dist
RUN useradd -r -u 10001 -s /usr/sbin/nologin ct && mkdir /data && chown ct /data
USER ct
VOLUME /data
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:8787/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node","--experimental-strip-types","server/index.ts"]
```
(Node 24 strips types by default; keep the flag only if the pinned patch version needs it. The public image omits `ml/`, `mt5bridge/`, `desktop/`, `lite/` and Python entirely.)

### 7.2 compose.yaml

```yaml
services:
  app:
    build: .
    restart: unless-stopped
    env_file: .env
    environment: { CT_MODE: public, CT_TRUST_PROXY: "1", CT_ALLOWED_HOSTS: "${CT_DOMAIN}", CT_PUBLIC_URL: "https://${CT_DOMAIN}" }
    volumes: [ "ct-data:/data" ]
    read_only: true
    tmpfs: [ "/tmp" ]
    cap_drop: [ ALL ]
    security_opt: [ "no-new-privileges:true" ]
    pids_limit: 200
    mem_limit: 1g
    cpus: "1.5"
    expose: [ "8787" ]            # not published to the host
    networks: [ internal ]
  caddy:
    image: caddy:2
    restart: unless-stopped
    ports: [ "80:80", "443:443", "443:443/udp" ]
    environment: { CT_DOMAIN: "${CT_DOMAIN}" }
    volumes: [ "./Caddyfile:/etc/caddy/Caddyfile:ro", "caddy-data:/data", "caddy-config:/config" ]
    networks: [ internal, default ]
volumes: { ct-data: {}, caddy-data: {}, caddy-config: {} }
networks: { internal: { internal: false } }
```
`Caddyfile`:
```
{$CT_DOMAIN} {
  encode zstd gzip
  header { Strict-Transport-Security "max-age=31536000"  -Server }
  request_body { max_size 16MB }
  reverse_proxy app:8787 {
    header_up X-Forwarded-For {remote_host}     # overwrite, never append client-supplied values
    header_up X-Forwarded-Proto {scheme}
  }
}
```
Caddy obtains and renews Let's Encrypt certificates automatically (needs DNS A/AAAA and ports 80/443). Backups: a sidecar/cron `sqlite3 "VACUUM INTO"` per user DB plus `users.db` nightly to a separate volume, then `rclone`/`restic` off-box (owner decides target).

### 7.3 Hardened systemd unit (no Docker)

```ini
[Unit]
Description=Chart Terminal (public)
After=network-online.target
[Service]
User=chartterminal
Group=chartterminal
WorkingDirectory=/opt/chart-terminal
EnvironmentFile=/etc/chart-terminal/env
ExecStart=/usr/bin/node server/index.ts
Restart=on-failure
RestartSec=5
StateDirectory=chart-terminal
Environment=CT_MODE=public CT_DATA_DIR=/var/lib/chart-terminal CT_DIST_DIR=/opt/chart-terminal/dist CT_HOST=127.0.0.1
NoNewPrivileges=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectSystem=strict
ProtectHome=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
ProtectClock=yes
ProtectHostname=yes
RestrictNamespaces=yes
RestrictSUIDSGID=yes
RestrictRealtime=yes
LockPersonality=yes
MemoryDenyWriteExecute=no          # V8 JIT needs W+X
SystemCallArchitectures=native
SystemCallFilter=@system-service
SystemCallFilter=~@privileged @resources
CapabilityBoundingSet=
AmbientCapabilities=
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
IPAddressDeny=any
IPAddressAllow=localhost
# outbound market data needs the internet: replace the two IPAddress lines with an allow-list or drop them
MemoryMax=1G
TasksMax=200
CPUQuota=150%
[Install]
WantedBy=multi-user.target
```
Caddy runs as its own package service in front.

### 7.4 Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `CT_MODE` | `private` | `public` or `private` |
| `CT_DATA_DIR` | `server/data` | users.db, users/, VAPID |
| `CT_HOST` | `127.0.0.1` | bind address (compose: `0.0.0.0` inside the network) |
| `PORT` | 8787 | listener |
| `CT_PUBLIC_URL` | none | canonical origin; required in public (secure cookie, CORS, VAPID) |
| `CT_ALLOWED_HOSTS` | none | required in public |
| `CT_TRUST_PROXY` | 0 | trust `X-Forwarded-*` from loopback/`CT_PROXY_IPS` |
| `CT_REGISTRATION` | `invite` | `invite|open|closed` |
| `CT_ADMIN` | none | first admin's username (password printed once / set via CLI) |
| `CT_VAPID_PUBLIC`, `CT_VAPID_PRIVATE`, `CT_VAPID_SUBJECT` | generated | push identity |
| `CT_QUOTA_*` | defaults in 4 | override per-user limits (alerts, state_mb, media_mb, shares, subs, rps) |
| `CT_FEED_LIMIT_*` | 300/60/40 | global upstream feed caps |
| `CT_SESSION_DAYS` | 30 | session lifetime |
| `CT_CORS_ORIGINS` | none | private server: origins allowed to call it with bearer tokens |
| `CT_SHARE_ORIGIN` | none | optional separate origin for public share images |
| Ignored in public | | `CT_SECRET_KEY`, `CT_LAN`, `CT_LLM_*`, `CT_PYTHON`, `CT_ENGINE_WORKERS`, `MT5_BRIDGE_PORT` |

---

## 8. Phased plan

Each phase leaves `private` mode behaviour identical and has its own tests. Sizes are lines of code, order is by risk (earliest = prerequisite for safe public use, latest = nice-to-have).

| # | Phase | Contents | Files | Size | Test |
|---|---|---|---|---|---|
| 0 | **Mode switch + hardening shell** | `core/mode.ts`; per-mode import list in `index.ts`; `CT_HOST`, trusted-proxy IP/proto helper; `clientIp`/`secure` through it; `allowedHost` strict in public; stricter CSRF; route allow-list assertion (public registers no X routes). No users yet: public refuses to start without `CT_ADMIN`. | core/mode.ts (new), core/http.ts, core/auth.ts, index.ts, lan.ts (gate) | ~250 | unit tests for proxy trust (spoofed XFF ignored from untrusted peer), route table per mode |
| 1 | **Users + sessions (central DB)** | `core/users.ts` (tables, scrypt v2, async hash, throttling in DB, recovery codes, invites, audit), `authroutes.ts` rewrite behind mode, `Ctx.user`, session `user_id`, CLI `server/cli.ts` (create-admin, list, reset, disable, delete, invite). Private path retained. | core/users.ts, core/auth.ts, authroutes.ts, core/http.ts, cli.ts, tests | ~700 | auth tests: register, login lockouts, timing equalisation, recovery code single-use, disabled user rejected, cookie flags |
| 2 | **Per-user DB + scoped data layer** | `userDb()` LRU, lazy migrations, `Ctx.db`; convert `state.ts`, `media.ts`, `share.ts` (small modules first). `tabs` map keyed per user. Introduce `broadcastTo`; WsClient.userId. | core/db.ts, core/http.ts, state.ts, media.ts, share.ts | ~500 | isolation test v1 (state/media/share, WS) |
| 3 | **Alerts + notify per user** | alerts registry per user, watchers shared; notify settings in user DB; push per user + `push_endpoints`; remove webhook/email/telegram in public; reject script alerts; VAPID from env/no auto-regenerate; push host allow-list. | alerts/*, notify/index.ts, core/bars.ts (no change) | ~600 | isolation test v2 (alerts firing reaches only owner, push routing after account switch), public-blocklist test |
| 4 | **Quotas and rate limits** | `core/quota.ts`, token buckets in `handle()`, WS caps, byte accounting per DB, `max_page_count`, body limits, magic-byte checks. | core/quota.ts (new), core/http.ts, state/media/share/alerts/notify | ~400 | quota exceed tests (429/413), WS flood test |
| 5 | **Market fan-out controls** | feed caps, grace-period teardown, REST cache + coalescing, per-exchange bucket, kline multiplexing for alerts, admin stats. | market.ts, ccxt.ts, core/bars.ts, src/data.ts (shared stream), derivs.ts | ~450 | load test script (1000 fake sockets, count upstream feeds), cache hit tests |
| 6 | **Account lifecycle + admin UI** | export, delete, change password UX, recovery code regeneration, admin endpoints (users, invites, stats) with step-up auth; privacy note. | authroutes.ts, core/users.ts, new admin.ts, src/login.ts, src/admin.ts | ~500 | export/delete tests; admin authz tests |
| 7 | **Client: sign-up/login + feature flags** | username/password screens, registration with invite, recovery flow, hide X features from `features`, "why" notice. | src/login.ts, src/boot.ts, src/main.ts (panel visibility), index.html, style | ~450 | DOM tests where they exist (`alertsui.test.ts` style), manual matrix |
| 8 | **Client: two servers** | `src/servers.ts`, server picker, device tokens + CORS on private server, `apiTrade`, WS auth message, mixed-content guidance. | src/servers.ts, sync.ts, boot.ts, data.ts, orderflow/feed.ts, ai/panel.ts, journal/media.ts, broker/remote.ts, authroutes.ts (device tokens), http.ts (CORS) | ~600 | unit tests for URL resolution; test that broker calls never use the sync client |
| 9 | **Packaging** | `deploy/` files from 7, `.env.example`, backup script, runbook (restore drill). | deploy/* | ~200 (config) | `docker compose up` smoke on a throwaway VPS or local, healthcheck, TLS staging cert |
| 10 | **Hardening extras** | CSP rollout, separate share origin, audit-log viewer, optional proof of work for open registration, push relay private to public (6 ii). | various | ~400 | |

Phases 0-4 are the minimum before exposing the server to anyone; 5 before more than a handful of users; 6-9 before inviting non-technical users.

---

## 9. Top 10 risks of a public multi-user trading-terminal server

1. **Cross-user data leak through the global WS `broadcast` and module-level state** (finding 0.1). Mitigation: per-user DB handle in `Ctx`, `broadcastTo(userId,...)` replaces `broadcast` (compile-time break), route/WS isolation test that classifies every route.
2. **Remote code execution via server-side user scripts** (`new Function` in compilers, 0.3). Mitigation: engine, forward, script alerts, ML not imported in public; test that those routes are absent; container with no secrets, read-only rootfs, dropped caps.
3. **Exchange keys or trading capability ending up on the public host**. Mitigation: brokers module not imported; `secretSet` refuses `broker:*`; startup refuses with `CT_SECRET_KEY` or an existing secret key file; client never routes broker calls to the sync server; documentation of the trade-server model.
4. **Credential attacks: stuffing, brute force, user enumeration, account lockout abuse.** Mitigation: three-layer throttling in DB, uniform errors and dummy scrypt, async scrypt with semaphore, breached/common password check, invite-only registration, audit log, per-user session cap.
5. **Proxy/IP spoofing and cookie downgrade** (`clientIp` = socket address, `secure=false`, 0.4). Mitigation: `CT_TRUST_PROXY` with peer verification, Caddy overwriting XFF, `__Host-` Secure cookie, `Host` allow-list, HSTS.
6. **CSRF / cross-site WebSocket hijack** (missing-`Origin` allowance `http.ts:110`, WS `http.ts:150`). Mitigation: require Origin or `Sec-Fetch-Site` plus `x-ct-client` on mutating requests, `SameSite=Strict`, Origin required on upgrade.
7. **SSRF and spam relay through outbound channels** (webhook, SMTP, Telegram, arbitrary push endpoints, LLM/MT5 localhost proxies). Mitigation: those channels removed in public mode; push endpoints restricted to known push-service hosts; no outbound fetch of user-supplied URLs; no loopback proxies.
8. **Resource exhaustion / DoS**: unbounded feeds and alerts, 8-20 MB bodies, synchronous scrypt, SQLite growth, SEC/derivs queues, WebSocket floods. Mitigation: quotas (4), caps on distinct upstream feeds, token buckets, async hashing, `max_page_count`, container CPU/memory/pids limits.
9. **Upstream bans and terms-of-service problems**: 1000 users multiplied into exchange connections gets the VPS IP banned; redistributing Yahoo/CoinGecko/ForexFactory data may violate their terms. Mitigation: shared multiplexed feeds, caching, per-exchange budgets, kill switch per upstream, review data licences before opening registration beyond friends.
10. **Data loss and privacy obligations**: one volume holds everyone's journal and pictures; no email means a lost password and lost recovery codes lose the account; export/delete expectations. Mitigation: nightly `VACUUM INTO` + off-box encrypted backups with a tested restore, recovery codes shown once with explicit confirmation, working export and delete, minimal logs (hash or truncate IPs after 30 days), a short privacy page; admin cannot read user data.

(Also watch: user-uploaded images served from the app origin (`/s/:id`, `/api/media/:id`; nosniff + `CSP sandbox` already, move to a separate origin later), and the `ptr.ts` PDF parser surface.)
