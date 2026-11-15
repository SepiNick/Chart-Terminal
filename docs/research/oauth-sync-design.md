[English](oauth-sync-design.md) · [فارسی](oauth-sync-design.fa.md)

# Sign in with Google / Apple + "match" of device data and account data

Status: design only (nothing implemented). Scope: public servers (`CT_MODE=public`). Private servers keep the single password.
Everything below is anchored to the code as it is today (`server/authroutes.ts`, `server/core/users.ts`, `server/core/http.ts`, `server/state.ts`, `src/sync.ts`, `src/boot.ts`, `android/.../MainActivity.java`).

## 0. Findings that shape the design

1. **Accounts have no email.** `users` is `(id, name UNIQUE, pw NOT NULL, role, …)` (`users.ts:13`). There is nothing to "match by email", so the classic OAuth account-takeover (auto-link by email) cannot be introduced by accident: we simply never add an email column used for matching.
2. **A username is required** (`checkName`, `users.ts:222`; `name NOT NULL UNIQUE`). An OAuth first sign-in therefore needs a "choose a username" step; it cannot create the account inside the provider callback.
3. **`pw NOT NULL`** and `verifyPassword` returns `false` *before* running scrypt when the stored string is not `scrypt$…` (`users.ts:52`). An OAuth-only account stored as `pw='oauth$'` would answer a password login faster than a wrong password: a timing oracle for "this username exists and is OAuth-only". `login()` (`users.ts:263`) must verify against `DUMMY` for such rows.
4. **The current sign-in sync is destructive when both sides have data.** `boot.ts:65-67`: if the server has any key, `hydrate(state)` runs; `hydrate` deletes every synced local key the server lacks and overwrites the rest (`sync.ts:64-73`). The only prompt (`offerUpload`, `boot.ts:33`) appears when the **server is empty**. Phone has local data + account has data = the phone's data is silently replaced. This is exactly the case the owner wants fixed, and it is independent of OAuth (a password login has the same bug).
5. **Logout does not clear `ct.*`** (`login.ts:122-129`: flush, API logout, `setToken(undefined)`, reload). On a shared browser, user B signs in and the *next* "first sign-in" logic would see user A's data as "this device's data" and offer to merge it into B's account. Needs an owner marker (section 4.2).
6. **The auth core already has what we need**: `issue()` (`authroutes.ts:90`) gives a fresh cookie session or a Bearer device token and never adopts a client-sent token (no fixation); `createDevice` (`auth.ts:52`, max 10); `DEVICE_AUTH` cross-origin door (`http.ts:110`, used at `:162`); throttles `reserve/allow` (`users.ts:145,154`); `audit` (`users.ts:108`).
7. **Android APK is a thin client** that loads the server origin in a WebView (`MainActivity.java:187`, `web.loadUrl(origin)`), same-origin, cookies. Off-origin navigations are already pushed to the system browser (`:157-165`). There is no bundled-asset APK yet (`docs/multi-server.md` §"اندروید" only describes it as a future option).
8. **Routes are classified by a test**: `isolation.test.ts` fails on an unclassified route and on a stale entry. New OAuth routes must be registered **unconditionally** in public mode (answering 404 when a provider is not configured), otherwise the route table would depend on env vars.

## 1. Protocol (server-side OIDC, no SDK)

### 1.1 Why no third-party SDK
`node:crypto` has everything: `createPublicKey({key: jwk, format: 'jwk'})`, `crypto.verify('RSA-SHA256', …)` for RS256 ID tokens, `createSign('SHA256').sign({key, dsaEncoding: 'ieee-p1363'})` for Apple's ES256 client secret, `randomBytes`, `createHash`, `timingSafeEqual`; global `fetch` for the token and JWKS calls. The whole verifier is ~180 lines we can read in one sitting. An SDK (passport, openid-client, jose) would add a dependency tree to a server that holds all users' data, bring its own discovery/redirect/cookie behaviour (SSRF through discovery documents, `alg` agility, library CVEs) and break the project's "no new dependencies" rule (`server/package.json`). Endpoints are **constants in code**, never discovered at runtime and never taken from a request.

| | Google | Apple |
|---|---|---|
| authorize | `https://accounts.google.com/o/oauth2/v2/auth` | `https://appleid.apple.com/auth/authorize` |
| token | `https://oauth2.googleapis.com/token` | `https://appleid.apple.com/auth/token` |
| JWKS | `https://www.googleapis.com/oauth2/v3/certs` | `https://appleid.apple.com/auth/keys` |
| `iss` | `https://accounts.google.com` (also accept bare `accounts.google.com`) | `https://appleid.apple.com` |
| `aud` | `CT_GOOGLE_CLIENT_ID` | `CT_APPLE_SERVICE_ID` |
| scope | `openid email` (no `profile`: we do not need a name/photo) | `email` (+ `name` forces form_post and gives a name once; we do not request it, see 1.4) |
| client auth | `client_secret` string | `client_secret` = ES256 JWT we sign |
| response | query (`GET` callback) | `response_mode=form_post` (**`POST`** callback) |

Only `id_token` is used from the token response. `access_token`/`refresh_token` are dropped immediately (never stored, never logged). No userinfo call.

### 1.2 Endpoints (all in a new `server/oauth.ts`, imported from the public branch of `authroutes.ts:81`)

| Route | Auth | Purpose |
|---|---|---|
| `GET /api/auth/status` (existing, `authroutes.ts:92`) | public | adds `oauth: { google: boolean, apple: boolean }` (derived from config). Buttons are hidden when false. |
| `POST /api/auth/oauth/start` | public (link intent checks the session itself) | body `{ provider, intent: 'login'\|'link'\|'reauth', challenge, ret, port?, device? }` -> `{ url }`. POST so the normal CSRF/`x-ct-client` rules apply and nothing sensitive sits in a navigable URL. |
| `GET /api/auth/oauth/callback/google` | public, raw | Google redirect target. |
| `POST /api/auth/oauth/callback/apple` | public, raw, **CSRF-exempt** | Apple `form_post` target (`application/x-www-form-urlencoded`: `code, id_token, state, user?, error?`). |
| `POST /api/auth/oauth/exchange` | public (cross-origin allowed via `DEVICE_AUTH`) | `{ code, verifier, device? }` -> login: `{ ok, user, token? }` (cookie or token exactly as `issue()`); new identity: `{ signup: true, ticket, hint }`; link: `{ linked: provider }`; failure: uniform error. |
| `POST /api/auth/oauth/signup` | public (via `DEVICE_AUTH`) | `{ ticket, verifier, name, invite?, device? }` -> account + `recoveryCodes` + session/token, same shape as `register` (`authroutes.ts:96`). |
| `GET /api/auth/identities` | session | `[{ provider, email, relay, created, lastLogin }]` + `{ hasPassword }`. |
| `DELETE /api/auth/identities/:provider` | session + step-up | unlink (rules in 2.4). |
| `POST /api/auth/password/set` | session + fresh OAuth re-auth | give an OAuth-only account a password (existing `/api/auth/password` needs the *current* password, `authroutes.ts:111`). |

New `http.ts` changes (about 8 lines): add `/api/auth/oauth/exchange` and `/api/auth/oauth/signup` to `DEVICE_AUTH` (`http.ts:110`); in the CSRF gate (`http.ts:159`) skip `csrfOk` and the `x-ct-client` requirement for exactly `POST /api/auth/oauth/callback/apple` (Apple's browser POST carries `Origin: https://appleid.apple.com` or `null` and cannot carry our header; the callback is authenticated by `state`, not by a cookie, so CSRF-by-cookie does not apply). That route must be `raw: true` with `limit: 8192` because `handle()` otherwise `JSON.parse`s the body (`http.ts:~186`); we parse `URLSearchParams` ourselves.

### 1.3 State, nonce, PKCE: two PKCE layers

Tables in `users.db` (central; migrations `users/3..5`, section 2.1):

```
oauth_state(state_hash PK, provider, nonce, p_verifier, c_challenge, intent, user_id, ret, port, device, created, expires)   -- 10 min, single use
oauth_code (code_hash  PK, kind, user_id, provider, subject, email, relay, c_challenge, expires)                          -- 60 s, single use
oauth_signup(ticket_hash PK, provider, subject, email, relay, c_challenge, expires)                                       -- 10 min, single use
```

* `state` = 32 random bytes (base64url); only its SHA-256 is stored. Consumed with `DELETE … WHERE state_hash=? AND expires>? RETURNING *`: the same state can never be used twice, even by parallel callbacks.
* `nonce` = 32 random bytes, sent to the provider, stored; compared to the ID token's `nonce` with `timingSafeEqual`.
* **Layer 1, server <-> provider**: `p_verifier` (43-128 chars) with `code_challenge=S256` is sent to Google. For Apple, send PKCE only if Apple's token endpoint accepts `code_verifier` (not verified here; check before implementing, and do not rely on it: for Apple the protection is `state` + `nonce` + the layer below).
* **Layer 2, our page <-> our server** (the important one): the client generates its own `verifier`, sends only `challenge = BASE64URL(SHA256(verifier))` in `/start`, keeps `verifier` in storage on the initiating device, and must present it at `/exchange` or `/signup`. The server stores `c_challenge` with the state and copies it into the one-time code. This single mechanism defeats login-CSRF (attacker makes the victim's browser finish the attacker's callback: the code is bound to the attacker's challenge, the victim's page has a different verifier), Android custom-scheme hijack, and leaked-code replay. Because of it we need **no `__Host-` binding cookie on the callback**, which is good: SameSite=Strict session cookies (`auth.ts:95`) are not sent on the cross-site redirect back, and a `SameSite=None` cookie would be needed otherwise for Apple's POST.

### 1.4 Redirect URI allow-list
* Provider `redirect_uri` is **never client-supplied**. It is `new URL('/api/auth/oauth/callback/<provider>', publicUrl())` (`mode.ts:146`, `CT_PUBLIC_URL`), registered byte-for-byte at Google/Apple. A server without `CT_PUBLIC_URL` is refused at startup already (`mode.ts:188`).
* Where the *user* ends up afterwards is `ret`, a **key**, not a URL: `web` -> `/#oauth=<code>` on `CT_PUBLIC_URL`; `app` -> the intermediate page `/oauth-return.html#code=<code>` (which then tries `chartterminal://oauth#code=…`, section 3.3); `loopback` -> `http://127.0.0.1:<port>/ct-oauth?code=<code>` where `port` is an integer 1024-65535 validated server-side (RFC 8252 loopback). Anything else: 400. There is no open redirect because no URL ever comes from the request.
* The code travels in the **fragment** for web/app (not sent to servers, not in `Referer`, not in proxy access logs) and in the query only for loopback (stays on 127.0.0.1).

### 1.5 Callback processing (Google GET / Apple POST), in order
1. Provider configured? else 404. Parse params; if `error` is present -> redirect with `#error=denied` (never echo provider text).
2. Per-IP throttle (`allow('oauth-cb:'+ipKey, 30, 600_000)`); global concurrency cap of 8 simultaneous token calls.
3. Consume `state` (single use, unexpired, provider matches the path). Unknown/expired: redirect `#error=expired`.
4. POST to the fixed token URL: `grant_type=authorization_code`, `code`, `redirect_uri`, `client_id`, `client_secret` (Apple: fresh ES256 JWT, 1.6), `code_verifier` (Google). `redirect: 'error'`, 5 s timeout, response <= 64 KB, `application/json` only, HTTPS only.
5. Verify the ID token (1.7). Any failure: audit `oauth fail:<reason>` (reason is a short fixed code, never token text) and redirect `#error=failed`. All failures look the same to the user.
6. Resolve outcome by intent (section 2.2) and create an `oauth_code` row (60 s, bound to `c_challenge`). Redirect (303) to `ret` with the code.
7. Apple: if a `user` form field is present (name, first authorization only) it is **ignored**: our users choose a username, and unauthenticated form data must not influence identity. The email comes from the verified ID token, never from the form.

### 1.6 Apple client secret (ES256)
Header `{alg:'ES256', kid: CT_APPLE_KEY_ID}`, claims `{iss: CT_APPLE_TEAM_ID, iat: now, exp: now+3600, aud: 'https://appleid.apple.com', sub: CT_APPLE_SERVICE_ID}`. Signed with the `.p8` (PKCS8 PEM) read once from `CT_APPLE_PRIVATE_KEY_FILE`: `createSign('SHA256').update(signingInput).sign({ key: pem, dsaEncoding: 'ieee-p1363' })` then base64url (JOSE needs raw `r||s`, not DER). Regenerated per token call (cheap); Apple allows up to 6 months but a short life costs nothing. The file path/contents are never logged. A malformed key makes the provider "misconfigured" at startup (warning + disabled), not a crash at the first user.

### 1.7 ID token verification (`core/oidc.ts`, ~180 lines, pure and unit-testable)
1. Split into 3 parts, max 8 KB, base64url-decode header/payload as JSON (any failure = reject).
2. `alg` must be exactly `RS256` and `typ`/`kid` present. `none`, `HS*`, `ES*` rejected (kills alg-confusion; we never use a shared secret to verify).
3. Key: from the per-provider JWKS cache by `kid`; `kty` must be `RSA`, `use` is `sig` or absent. `createPublicKey({ key: jwk, format: 'jwk' })`; `crypto.verify('RSA-SHA256', data, key, sig)`.
4. Claims: `iss` exact (or the Google bare form); `aud` equals our client id (string) or is an array containing it and `azp` equals it; `exp > now - 60 s`; `iat <= now + 60 s` and not older than 10 min; `nonce` equals stored (constant time); `sub` is a non-empty string <= 255.
5. `at_hash` if present: base64url of the left half of SHA-256(access_token) must match (we have the access token from the same TLS response; cheap and catches token-endpoint mix-ups).
6. `email`: kept only if `email_verified === true || === 'true'` (Apple sends the string). Unverified email is dropped (identity still valid by `sub`, but see 2.2: we do not need the email for anything security-relevant).
7. **JWKS fetch**: fixed URL per provider; HTTPS only; no redirects; 5 s timeout; <= 64 KB; honour `Cache-Control: max-age` clamped to 5 min..24 h; on an unknown `kid`, one refetch at most per 60 s per provider (an attacker sending random `kid`s cannot make us hammer Google/Apple); on fetch failure use the stale cache up to 24 h, else fail closed.

## 2. Account model

### 2.1 Schema (central `users.db`, in `users.ts`)
```sql
-- users/3
CREATE TABLE identities (provider TEXT NOT NULL, subject TEXT NOT NULL, user_id INTEGER NOT NULL REFERENCES users ON DELETE CASCADE,
  email TEXT, relay INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL, last_login INTEGER,
  PRIMARY KEY (provider, subject));
CREATE INDEX identities_user ON identities (user_id);
CREATE UNIQUE INDEX identities_one_per_provider ON identities (user_id, provider);   -- one Google + one Apple per account
-- users/4
ALTER TABLE users ADD COLUMN has_pw INTEGER NOT NULL DEFAULT 1;
-- users/5   oauth_state, oauth_code, oauth_signup (section 1.3); swept by the existing 10-minute interval (users.ts:359)
```
`ON DELETE CASCADE` + `removeUser` (`users.ts:339`) already remove identities with the account. `email` is display/admin information only and is **never used to find or link an account**.

### 2.2 Rules
| Situation | Behaviour |
|---|---|
| Callback, identity `(provider, sub)` exists, account active | log in that user (`issue()`); update `last_login`; audit `oauth login`. |
| Same, account disabled/deleting | uniform failure (`#error=failed`); audit `oauth disabled`. |
| Identity unknown, intent `login` | **no account is created and no email lookup happens.** `exchange` returns `{signup:true, ticket}`; the client shows "Choose a username" (+ invite code if `REGISTRATION==='invite'`). Text also says: "Already have an account here? Sign in with your password, then link Google under Account -> Sign-in methods." |
| Signup step | `REGISTRATION==='closed'` -> 403; `'invite'` -> invite required, consumed atomically with account creation exactly like `register()` (`users.ts:239-246`, same `BEGIN IMMEDIATE`); `'open'` -> `allow('reg:…')` limits (`users.ts:232-233`). Username goes through `checkName` + `reserved` (`users.ts:222-236`). `pw='oauth$'`, `has_pw=0`, identity row inserted in the same transaction; 8 recovery codes are created and shown once. |
| Intent `link` | needs a logged-in session (checked in `/start` *and* re-checked at `/exchange`, bound through `oauth_state.user_id`). Step-up first: password (`confirmPassword`, `users.ts:273`) if `has_pw`, otherwise an OAuth login or re-auth within the last 10 min. If the identity already belongs to a **different** account -> refuse ("This Google account is already linked to another account"); never move or merge accounts automatically. |
| Intent `reauth` | provider round trip that only proves the caller still controls an already-linked identity; used for step-up of OAuth-only accounts (set a password, unlink, delete data). |
| Apple private relay (`@privaterelay.appleid.com`, or `is_private_email`) | stored with `relay=1`, shown as "Hidden email (Apple)". Never matched with anything. Since we send no email, the relay forwarding setup at Apple is not needed. |
| Same email on Google and Apple | two unrelated identities; the user may link both to one account explicitly. |
| Admin role | OAuth may be added as an extra login. Admin tools keep their password step-up (`authroutes.ts:142-145`), so an admin account must keep a password; `CT_ADMIN` bootstrap (`users.ts:314`) never goes through OAuth. A "promote" CLI refuses accounts with `has_pw=0`. |

### 2.3 Password login for OAuth-only users
`login()`: `if (!row.has_pw) { await verifyPassword(await DUMMY, pw); fail uniformly }` so timing equals an unknown user (`users.ts:263`). `recover()` (`users.ts:286`) works unchanged and sets `has_pw=1`: the recovery codes are the "lost my Google account" path (set a password, sign in).

### 2.4 Unlink / last method
A sign-in method = (`has_pw ? 1 : 0`) + `COUNT(identities)`. `DELETE /api/auth/identities/:provider` is refused with 409 `last_method` if the count would drop below 1. Requires step-up (2.2). Unlinking does not revoke sessions or device tokens (too surprising); it audits `oauth unlink`, and the user can end sessions under "Devices & sessions". Password set for an OAuth-only account (`/api/auth/password/set`) needs a fresh reauth and enforces `checkNewPassword`.

### 2.5 Admin visibility
`listUsers` (`users.ts:352`) adds `has_pw` and `identities: [{provider, email}]`; the admin UI/CLI shows "Google (a***@gmail.com)". Audit events (`users.ts:108`): `oauth start|login|link|unlink|signup|fail:<code>`. Admin can disable an account (`setStatus`) which already revokes sessions; there is no admin "link on behalf of user".

## 3. Clients

All clients do the same four things: (1) make `verifier`/`challenge` (`crypto.getRandomValues`, 32 bytes) and store `{verifier, server, exp: now+10min}` in storage; (2) `POST /start` and open the returned `url`; (3) receive `code` (fragment/scheme/loopback); (4) `POST /exchange {code, verifier, device?}` and finish like a normal login (`authPost`, `login.ts:60` already adds `device` for another origin and stores the Bearer token with `setToken`). Only the *transport of the code* differs. New client file `src/oauth.ts` (~150 lines); `boot.ts` calls `resumeOAuth()` before `authStatus()`.

### 3.1 Web (same origin)
`/start` with `ret:'web'`, then `location.assign(url)`. Back at `/#oauth=<code>`: `boot()` reads the hash, `history.replaceState` removes it at once, loads the stored verifier, calls `/exchange` (same-origin, cookie is set by `issue()`, a previous cookie session is ended first - `start()` at `authroutes.ts:84`). Storage: `localStorage` key `ctoauth` (not `ct.*`, so it never syncs) with 10-minute expiry; mobile browsers evict tabs during the provider round trip, so `sessionStorage` is not safe.

### 3.2 PWA / Electron / lite
* **Installed PWA (Android)**: same as web; the provider page opens in an in-app custom tab and the https return is captured by the PWA. **iOS standalone PWA**: storage is separate from Safari and the return may open in Safari, losing the verifier. Honest limit: on iOS the OAuth button works in Safari; in the home-screen app we show "Open in Safari to sign in with Apple/Google, or use your password." (detected by `navigator.standalone`).
* **Electron (`desktop/main.cjs`) and lite**: `shell.openExternal(url)` (system browser, never an embedded window: Google refuses those, and users should see their real browser). The app starts a one-shot HTTP listener on `127.0.0.1:<random port>` serving a tiny "you can close this tab" page, uses `ret:'loopback'&port=…`, reads `?code=`, closes the listener, then `/exchange` with its device label -> Bearer token. ~40 lines in `desktop/main.cjs`, none in the server beyond the validated `port`.

### 3.3 Android APK (thin client, WebView of the server origin)
Problem: Google blocks OAuth in embedded WebViews (`disallowed_useragent`). Today, a navigation to `accounts.google.com` inside the WebView would be handed to the default browser by `shouldOverrideUrlLoading` (`MainActivity.java:157-165`) with no way back to the app and without our verifier.

Design: the page detects the app by a UA suffix (`" CTApp/1"`, added with `s.setUserAgentString(s.getUserAgentString() + " CTApp/1")`) and sends `ret:'app'`. The WebView lets the page navigate to the provider URL; `shouldOverrideUrlLoading` recognises the two provider hosts and opens a **Chrome Custom Tab** instead. The server's callback 303s to `https://<server>/oauth-return.html#code=…` (a ~30-line static page in `public/`): it runs `location.replace('chartterminal://oauth#code=' + code)` automatically and also shows an "Open Chart Terminal" button (user gesture, for Chrome versions that block scripted external-scheme launches). Android routes the custom scheme to `MainActivity`, which injects the code into the WebView page; the page completes `/exchange` with the verifier it kept in the WebView's `localStorage`.

Why a custom scheme and not an App Link: the APK connects to **any** server address the user types (`showSetup`, `:90-127`); App Links need a `/.well-known/assetlinks.json` on every host and a manifest entry per host, impossible for arbitrary servers. A custom scheme can be claimed by another app, so the security rests on the PKCE binding: the 60 s single-use code is useless to anyone without the verifier, and the verifier never leaves the WebView storage. A hijacker can only *burn* a code (the user retries); it cannot sign in.

`AndroidManifest.xml` (`android/app/src/main/AndroidManifest.xml:11-20`): replace the `<activity>` with
```xml
<activity android:name=".MainActivity" android:exported="true" android:launchMode="singleTask"
    android:configChanges="orientation|screenSize|keyboardHidden|smallestScreenSize|screenLayout" android:windowSoftInputMode="adjustResize">
  <intent-filter>
    <action android:name="android.intent.action.MAIN" />
    <category android:name="android.intent.category.LAUNCHER" />
  </intent-filter>
  <intent-filter>
    <action android:name="android.intent.action.VIEW" />
    <category android:name="android.intent.category.DEFAULT" />
    <category android:name="android.intent.category.BROWSABLE" />
    <data android:scheme="chartterminal" android:host="oauth" />
  </intent-filter>
</activity>
```
(`singleTask` so the returning intent reaches the existing WebView instead of creating a second activity.) Optional but recommended: `implementation 'androidx.browser:browser:1.8.0'` in `android/app/build.gradle` for `CustomTabsIntent`. The no-dependency alternative is `ACTION_VIEW` with the extra `android.support.customtabs.extra.SESSION` set to a null binder, which Chrome treats as a custom tab; with neither, the default browser still works because the return does not depend on the tab type.

`MainActivity.java` changes (about 70 lines):
1. `showWeb`: `s.setUserAgentString(s.getUserAgentString() + " CTApp/1");`
2. `shouldOverrideUrlLoading` (`:157`): before the generic external branch,
   `if ("https".equals(sch) && (host.equals("accounts.google.com") || host.equals("appleid.apple.com"))) { new CustomTabsIntent.Builder().build().launchUrl(MainActivity.this, u); return true; }`
3. New `@Override protected void onNewIntent(Intent i)`: `Uri d = i.getData(); if (d != null && "chartterminal".equals(d.getScheme()) && "oauth".equals(d.getHost())) { String f = d.getFragment(); String code = f != null && f.startsWith("code=") ? f.substring(5) : null; if (code != null && code.matches("[A-Za-z0-9_-]{20,64}") && web != null) web.evaluateJavascript("window.__ctOAuth&&window.__ctOAuth('" + code + "')", null); }`. The regex guarantees no JS injection. If `web == null` (activity was recreated), `onCreate` also reads `getIntent()` once `showWeb` has loaded.
4. The page defines `window.__ctOAuth(code)` -> `exchange`. If the verifier is gone (app killed during the round trip) the page shows "Sign-in was interrupted, try again".
5. The existing WS guard and `MIXED_CONTENT_NEVER_ALLOW` are unaffected; `usesCleartextTraffic` only matters for LAN http servers, which will rarely offer Google/Apple anyway (Google requires https redirect URIs except localhost).

### 3.4 Standalone APK with bundled assets (future, no home server)
The page origin is then not the server (`https://appassets.androidplatform.net`, `docs/multi-server.md`). Sign-in therefore **selects a server first** (the existing server picker, `src/servers.ts`): `redirect_uri`, client id and accounts all belong to that server. Calls are cross-origin Bearer: `/start`, `/exchange`, `/signup` need `device`, the app origin must be in `CT_CORS_ORIGINS`, and the three routes are in `DEVICE_AUTH` (section 1.2). The return path is identical to 3.3. Consequence to state in the UI: only servers that have configured Google/Apple (status `oauth.google/apple`) show the buttons. Each public server needs its own Google/Apple client (the redirect URI is per server); a shared "auth broker" is a non-goal.

## 4. Sync and matching

### 4.1 Inventory of synced client state
Synced = every `ct.<key>` except `LOCAL_KEYS` (`sync.ts:41`: `bottomH, side, jwFormTab, tsTab, domCfg, pineEditing, lastTool, searchEx`) and anything failing `KEY_RE` (`sync.ts:42`). Server rows are `{value, rev, updated}` (`state.ts:205`, quota `stateKeyMb=2`, `journalKeyMb=8`, `stateMb=20`, `stateKeys=200`, `quota.ts:9`). Keys found in `src/` via `store.get/set`:

| Key(s) | Shape | Merge rule |
|---|---|---|
| `journal` | `Journal`: `trades: JTrade[]` (string `id`, `fills[]`), `notes: Record<date,text>`, `setups/entryReasons/exitReasons/motives/questions/tagList: string[]`, `accounts/checklists/docs/fields/props` (by `id`), `brokerSeen: Record<acct, fillId[]>`, scalars (`seen, account, activeDays, calendar, replay*`) (`journal.ts:45`) | per-field: `trades` union by `id` (same id on both sides: keep the side with the later `closeTime ?? openTime`; fills union by fill `id`); also drop a device trade whose `(sym, dir, openTime, avgEntry, qty)` equals an account trade (same exchange fill imported on two devices); `notes` union by date, on conflict keep both joined by `\n---\n`; string arrays = ordered union (account order first); id-lists union by `id`; `brokerSeen` union per account; scalars per-field LWW. Pictures/voice notes: `uploadLocalMedia` (`boot.ts:28`) must run **before** the merge so ids in the merged journal are server ids. Media is never deleted by a merge. |
| `layouts` | `Record<name, Layout>` | union by name; same name with different content: account keeps `name`, device copy is added as `name (this device)`. |
| `layout`, `layoutName`, `autosave` | current layout doc, name, bool | atomic document: whole-doc LWW by stamp (merging pane arrays field by field is meaningless); no stamp: account wins. |
| `drawings` | `Record<symbol, Drawing[]>`, `id = Date.now()` (`drawings.ts:247`) | per symbol union by `id` + tombstones; id collision with different content (same-millisecond, vanishingly rare): re-id the device one. |
| `scripts` | `Record<id, {id,name,src,updated,lang}>` (`pineui.ts:23,31`) | union by `id`; both sides edited: later `updated` wins, the loser is saved as `<name> (this device, <date>)` so no source text is ever dropped. |
| `indTemplates`, `chartTemplates`, `drawTemplates`, `drawDefaults` | `Record<name, …>` | union by name; conflict: account wins, device copy renamed `name (this device)` (`drawDefaults` is one object -> scalar rule). |
| `watch`, `favTfs`, `customTfs`, `favTools`, `recentSymbols` | string arrays | ordered set union (account order, then device-only items); `recentSymbols` capped at 12, newest first by merged order. `watch` honours tombstones (a removed symbol must stay removed). |
| `watchFlags`, `watchCols`, `watchDetail` | small records | per-field LWW. |
| `watchLists` | `Record<listId, {name, color, icon?, ord, syms: string[], flags: Record<sym, hex>}>` (`src/watchlists.ts`) | union by stable list id with tombstones (a deleted list stays deleted unless edited later); per list `syms` = ordered set union with tombstones (a symbol removed on one device stays removed; `###Section` rows are entries too), `flags` = per-symbol LWW, `name/color/icon/ord` = per-field LWW. The old `watch`/`watchFlags` become the list with id `default` (`migrate`, in memory at start-up and in `mergeAll` for a side that has not migrated yet, so two devices merge instead of one list replacing the other); the legacy keys are left untouched. Device-local (not synced): `watchActive` (active list) and `watchView` (combined view). Limits: 50 lists, 500 symbols per list, 1.5 MB for the key (below `stateKeyMb` = 2). |
| `alerts` | `chart.ts:35 Alert {id:number, sym, price, dir, on, drawingId?}` (price alerts; engine alerts live in the server's own `/api/alerts` tables, **not** in state) | union by `id`; numeric ids are per-device counters, so on collision re-id the device alert and rewrite its `drawingId`. |
| `acct` (paper account) | `{cash, pos, orders, fills, nextId}` (`trading.ts:17`) and also written by the server for forward tests (`HOT_KEYS`, `sync.ts:39`) | **never merged** (cash/positions are a running ledger). The dialog asks which one to keep; default = the side with the most recent fill. The other is kept in the restore point and can be exported. |
| `settings`, `journalCfg`, `riskCfg`, `calCfg`, `jwCfg`, `mktScr`, `mktTab`, `mktNewsMine`, `mktDex`, `liqMin`, `nocode`, `favBar`, `skillInputs`, `skillCur`, `tsWfa`, `tsPort`, `tsOpt`, `tsMc`, `tsRange`, `tsFwd`, `mqlSwap`, `aiModel`, `aiLang`, `alertChannels` | flat objects/scalars (preferences) | per-field LWW using the field-timestamp sidecar (4.3); with no timestamps: account wins, fields missing on the account are filled from the device. |

**Recommended changes to what syncs** (add to `LOCAL_KEYS`, `sync.ts:41`): `aiUrl` (a URL that can embed credentials or be a LAN address), `brokerActive` (refers to broker ids that exist only on one device/private server). Never synced by design: `ctsrv` (saved servers + **Bearer tokens**, `servers.ts:14`), the OAuth `ctoauth` verifier, device tokens, session cookies, exchange API keys (`CT_MODE=public` refuses to hold them, `mode.ts:172-185`), push endpoints, the Apple/Google tokens. Caveat to document: `alerts[].webhook.url` (alert objects in the *server* alerts API, and any copy in state) can contain secret webhook tokens; they sync inside the user's own account only.

### 4.2 When matching runs (replaces `boot.ts:65-67`)
Two non-`ct.*` localStorage markers (never synced): `ctown = {server, userId, at}` ("this browser's `ct.*` data is in step with that account", written after every successful `hydrate`) and the existing `ctsrv`.

```
after login, before hydrate/startSync:
  state = GET /api/state ; local = localSnapshot() ; own = ctown
  deviceEmpty  = every local key absent or equal to its default
  if deviceEmpty:                      hydrate(state)                            # fresh device: silent
  elif own == {server,user.id}:        hydrate(state)                            # already matched: today's behaviour
  elif accountEmpty:                   dialog(upload) -> Merge == upload         # today's offerUpload, now with restore point
  elif own && own.userId != user.id:   foreign-data dialog: "This browser holds data from another account"
                                        [Discard it] [Merge it into this account] [Keep a backup file]  (default Discard)
  else:                                match dialog (4.4)
```
Because `hydrate` is destructive, it never runs on the "else" branches before the user chose. On logout in a public server, after `flushNow()` succeeds the client clears the synced `ct.*` keys and `ctown` (data is on the server), which also removes the shared-browser leak in finding 5; if the flush fails the user is asked to download the backup first (`boot.ts:21`).

### 4.3 Merge engine (`src/merge.ts`, pure, node-testable like `sync.test.ts`)
* A **schema registry** maps each key to a strategy: `set` (string array), `byId(idOf)`, `byName`, `recordOfArrays(idOf)` (drawings), `fields` (flat object), `doc` (atomic), `ledger` (never merge, ask).
* `merge(key, account, device, meta) -> {value, notes[]}` is **deterministic, idempotent and symmetric except for the stated tie rule (account wins)**, so repeated runs and runs on two devices converge. No branch discards an id that is not tombstoned.
* **Sidecar metadata** (one synced state key `syncmeta`, ~tens of KB, written by `store.set` through a small diff hook of ~80 lines in `store.ts`): `{ items: {key: {id: {u: updatedMs, d?: deletedMs}}}, fields: {key: {field: ms}} }`. `u` is set when an item is added/edited, `d` is a **tombstone** written when an item is deleted (`delete st.layouts[n]`, `main.ts:781`, drawing removal, trade removal, script delete...). Tombstones are kept 90 days and capped at 5,000 entries (oldest dropped first). Rule: item present on side A, tombstoned on side B -> if `d > u` it stays deleted, else (edited after deletion) it is resurrected. Items with no recorded stamp are treated as `u = 0` (a tombstone beats them; unknown history never beats an explicit delete, and never deletes on its own).
* Without any metadata (the first ever match, devices that predate this feature): no deletions are inferred; result = union; scalars: account wins, gaps filled. Information is only ever added.

### 4.4 The match dialog (new `src/matchui.ts`, ~200 lines, uses `dialog()` from `login.ts:76`)
```
Match this device with your account
                          This device     Your account
  Journal trades              14              212
  Watchlist symbols            9               23
  Layouts                      3                7
  Scripts                      2                5
  Drawings                    41              120
  Templates                    4                1
  Paper account (cash)    $9,420          $10,000     <- single choice, see below
  (Merged result would have: 221 trades, 27 symbols, 10 layouts, 7 scripts, ...)

  ( Merge (recommended) )   [ Use account data ]   [ Use this device's data ]
  [ Download a backup of this device first ]
  Paper account:  (o) keep account's   ( ) keep this device's
```
* **Merge**: client runs `merge()` per key, takes a restore point, writes everything in one transaction (4.5), writes `ctown`, hydrates, starts sync.
* **Use account**: restore point (device side), then `hydrate(state)` as today; device-only data is only in the restore point.
* **Use this device**: second explicit confirmation ("This replaces N items on your account"), restore point (account side), then PUT every device key (`baseRev` from the account rows), delete account keys the device lacks.
* **Restore points** ("undo for 30 days"): new per-user table `restore(id, at, label, json)` created with `userMigration` (`state.ts:202` pattern), routes `POST /api/restore`, `GET /api/restore` (list, no bodies), `GET /api/restore/:id`, `DELETE /api/restore/:id`, `POST /api/restore/:id/apply`. Two rows per match (`account-before`, `device-before`), purged after 30 days by an interval, capped at 5 rows and a new quota `restoreMb` (default 30, `quota.ts:9` pattern; counts toward `dbMb`). UI: Account menu -> "Restore points…" (`login.ts:102` menu) -> "Restore" runs the same flow in reverse and creates a new restore point of the current state, so undo is itself undoable. A toast "Merged. Undo" shows right after.
* Multi-tab: the whole match runs under `navigator.locks.request('ct-match')`; other tabs wait and then see `ctown` set.

### 4.5 Atomic write and the existing If-Match mechanism
Today each key is PUT separately (`sync.ts:95`, `state.ts:269`), so a failure midway leaves a half-merged account. Add `POST /api/state/batch {writes:[{key, value|null, baseRev}]}` to `state.ts` (~50 lines): `BEGIN IMMEDIATE`, apply every write with the same rev check as `stateSet` (`state.ts:229-232`), quota check over the final total, `COMMIT`, then one broadcast per key. Any `409` aborts the whole batch and returns the current `{key, rev, value}` of every conflicting key. The client then **re-merges those keys against the fresh server values (merge is idempotent) and retries, at most 3 times**, else shows "Your account changed on another device while merging; try again" with nothing written. `413`/quota: nothing written, the dialog explains which key is too big (e.g. merged journal > 8 MB) and offers "Merge everything except the journal".
Follow-up (not required for v1, safe only because of tombstones): `sync.ts conflict()` (`:116`) currently drops the local edit on a 409 and keeps the server version; it could use `merge()` instead, so concurrent edits on two devices are combined rather than one discarded.

### 4.6 Deliberately not synced
Secrets and device-bound things (list in 4.1), `LOCAL_KEYS` UI state, media blobs' bytes (they sync through `/api/media`, referenced by id), server-side alert engine state, push subscriptions (`releasePushOnServer`, `login.ts:125`), API keys of any exchange. Merge never reads or writes `ctsrv`.

## 5. Operations

### 5.1 Environment variables (read in `core/mode.ts`, next to `REGISTRATION`, `mode.ts:134`)
| Variable | Meaning |
|---|---|
| `CT_GOOGLE_CLIENT_ID`, `CT_GOOGLE_CLIENT_SECRET` | Google "Web application" OAuth client. Both or neither. |
| `CT_APPLE_SERVICE_ID` | Apple Services ID (e.g. `com.example.chartterminal.web`); this is the OAuth `client_id`/`aud`. |
| `CT_APPLE_TEAM_ID`, `CT_APPLE_KEY_ID` | 10-character Team ID; Key ID of the Sign in with Apple key. |
| `CT_APPLE_PRIVATE_KEY_FILE` | path to the downloaded `AuthKey_<KEYID>.p8` (outside `CT_DATA_DIR`, mode 0400, mounted read-only in Docker). |
| (existing) `CT_PUBLIC_URL`, `CT_REGISTRATION`, `CT_CORS_ORIGINS`, `CT_ALLOWED_HOSTS` | redirect base, signup policy, bundled-asset app origin, host guard. |

Redirect URIs to register exactly: `${CT_PUBLIC_URL}/api/auth/oauth/callback/google` and `${CT_PUBLIC_URL}/api/auth/oauth/callback/apple`.
A provider is **enabled** only if all its variables are set and (Apple) the key file parses; a **partly** set provider stops the server at startup with a message naming the missing variable (catches typos); nothing set = disabled silently. The enabled flags appear in `/api/auth/status` as `oauth:{google,apple}`; `parseStatus` (`servers.ts:59`) maps them (default `false`, so private servers and old servers show no buttons); `accountscreens.ts` renders a button only when its flag is true; `/start` and the callbacks answer 404 for a disabled provider. Reverse proxy: add `/api/auth/oauth/callback/*` to the "do not log query string" rule (Caddy `log` filter / nginx `access_log` format without `$args`) because Google's callback carries `code` and `state` in the query (both single-use, 10 min / provider-bound, but there is no reason to keep them).

### 5.2 چک‌لیست دستی برای مالک (فارسی)

**الف) Google Cloud Console (قدم اول، کافی و بدون هزینه)**
1. با VPN وارد `console.cloud.google.com` شوید (از ایران بدون VPN باز نمی‌شود؛ خودِ سرور باید روی VPS خارج از ایران باشد تا به `oauth2.googleapis.com` برسد).
2. یک Project جدید بسازید، مثلاً `chart-terminal`.
3. APIs & Services -> OAuth consent screen: نوع کاربر **External**، نام برنامه، ایمیل پشتیبانی، آدرس صفحه‌ی اصلی (همان `CT_PUBLIC_URL`) و آدرس سیاست حریم خصوصی (یک صفحه‌ی ساده روی همان دامنه)، دامنه‌ی سرور را در Authorized domains بنویسید.
4. Scopes: فقط `openid` و `email` (غیرحساس‌اند؛ نیازی به بررسی امنیتی گوگل نیست).
5. Publishing status را روی **In production** بگذارید. اگر روی Testing بماند فقط ۱۰۰ کاربر آزمایشی می‌توانند وارد شوند. (گوگل ممکن است برای برندینگ تأیید ساده بخواهد.)
6. Credentials -> Create credentials -> OAuth client ID -> Application type: **Web application**.
7. در Authorized redirect URIs دقیقاً بنویسید: `https://دامنه‌ی-شما/api/auth/oauth/callback/google` (بدون اسلش آخر). بخش Authorized JavaScript origins را خالی بگذارید.
8. Client ID و Client secret را کپی کنید و در محیط سرور بگذارید: `CT_GOOGLE_CLIENT_ID` و `CT_GOOGLE_CLIENT_SECRET`. سرور را ری‌استارت کنید؛ دکمه‌ی Google باید در صفحه‌ی ورود ظاهر شود.
9. برای تست محلی می‌توانید یک کلاینت جدا با redirect `http://localhost:PORT/api/auth/oauth/callback/google` بسازید (گوگل localhost با http را مجاز می‌داند).

**ب) Apple Developer (قدم دوم؛ ممکن است از ایران عملی نباشد)**
*صادقانه:* Sign in with Apple به عضویت **Apple Developer Program (حدود ۹۹ دلار در سال)**، یک دامنه‌ی واقعی با HTTPS (نه IP و نه localhost) و تأیید دامنه نیاز دارد. به‌دلیل تحریم‌ها، ثبت‌نام و پرداخت از ایران معمولاً ممکن نیست مگر با حساب و پرداخت قانونی خارج از ایران. اگر این شرایط را ندارید، **فقط Google را پیاده‌سازی و منتشر کنید؛ این یک milestone کاملاً معتبر است** و کد Apple بدون تنظیمات غیرفعال و دکمه‌اش پنهان می‌ماند.
1. عضویت Apple Developer Program را فعال کنید (developer.apple.com).
2. Certificates, Identifiers & Profiles -> Identifiers -> یک **App ID** بسازید و قابلیت *Sign in with Apple* را روشن کنید.
3. یک **Services ID** بسازید (مثل `com.example.chartterminal.web`)؛ این همان `CT_APPLE_SERVICE_ID` است. Sign in with Apple را روشن و Configure را بزنید: Primary App ID را انتخاب کنید، **Domains** = دامنه‌ی سرور، **Return URLs** = `https://دامنه‌ی-شما/api/auth/oauth/callback/apple`.
4. فایل تأیید دامنه (`apple-developer-domain-association.txt`) را که Apple می‌دهد در `public/.well-known/` بگذارید تا از `https://دامنه/.well-known/apple-developer-domain-association.txt` در دسترس باشد (به `MIME` در `http.ts` پسوند `.txt` را اضافه کنید)، سپس Verify بزنید.
5. Keys -> New key -> *Sign in with Apple* را تیک بزنید، Primary App ID را انتخاب کنید و فایل `.p8` را **فقط یک بار** دانلود کنید. Key ID همان `CT_APPLE_KEY_ID` است.
6. Team ID (۱۰ نویسه) را از صفحه‌ی Membership بردارید: `CT_APPLE_TEAM_ID`.
7. فایل `.p8` را روی سرور (خارج از پوشه‌ی داده، با دسترسی فقط‌خواندنی برای کاربر سرویس) بگذارید و مسیرش را در `CT_APPLE_PRIVATE_KEY_FILE` بنویسید.
8. ری‌استارت و تست؛ ایمیل واقعی کاربر ممکن است مخفی (`privaterelay`) باشد و نام فقط بار اول می‌آید که ما به آن وابسته نیستیم.

**ج) تنظیمات سرور:** `CT_REGISTRATION=invite` (یا `open`) تعیین می‌کند چه کسی می‌تواند با Google حساب **جدید** بسازد؛ در حالت invite کاربر بعد از ورود با Google، «نام کاربری» و «کد دعوت» را وارد می‌کند. لاگ پروکسی را طوری تنظیم کنید که query آدرس `/api/auth/oauth/callback/*` ثبت نشود.

## 6. Security

* **CSRF on callback / login-CSRF**: single-use server-held `state` + the layer-2 PKCE binding (1.3); the Apple POST exemption in `http.ts` covers exactly one path.
* **Open redirect**: no URL is accepted from the request; `ret` is a key; `port` is a validated integer; provider `redirect_uri` is computed from `CT_PUBLIC_URL` (1.4).
* **Replay**: `state` consumed by `DELETE … RETURNING`; code 60 s, single use, hash-only at rest; ID-token `nonce` + `exp`; ticket single use.
* **Token leakage**: code in the URL fragment (web/app) so not in `Referer` (also `referrer-policy: no-referrer`, `http.ts` SECURITY_HEADERS) or access logs; `replaceState` removes it; the server never logs query strings (`http.ts:202` logs only the path); no provider token is stored or logged; `console.error` of failures prints fixed reason codes only.
* **Rate limiting**: `/start` 20 per 10 min per IP (`allow`, `users.ts:154`); callbacks 30 per 10 min per IP and a global cap of 8 concurrent token requests; the generic anonymous buckets in `http.ts:~135` (`auth:` bucket 1/s) already apply; bad `/exchange` attempts count against a per-IP failure budget (10 per 10 min) with the same 429 text as login.
* **Enumeration**: callback failures are one uniform `#error=failed`; `/exchange` returns one error for unknown/expired/used code and wrong verifier; the password path keeps the timing equalisation (finding 3); signup says only "That username is taken" like `register`. A user who is *logged in* may learn that a Google account is linked elsewhere (it is their own account being linked).
* **Session fixation**: always `issue()` -> `start()` ends the presented session and sets a fresh token (`authroutes.ts:84-88`); a Bearer client never receives a cookie.
* **Android code-exchange hijack**: code bound to the PKCE challenge + single use + 60 s; verifier only in the WebView; code format validated before JS injection; optional extra: bind to the device label (`device` captured at `/start`, must match at `/exchange`).
* **JWT pitfalls**: RS256 only, `kid` lookup, no `jku`/`x5u`/embedded `jwk` honoured, key type pinned, `aud` exact, constant-time compares, bounded sizes, JWKS hosts fixed.

**Top 10 risks and mitigations**
1. Account takeover through email auto-link -> never link or look up by email; linking only from a logged-in session with step-up.
2. Login CSRF / session riding -> state + client-PKCE binding; fresh session on every login.
3. ID-token forgery (alg none/HS256, wrong `aud`/`iss`/`nonce`) -> strict verifier, mock-provider negative tests (7).
4. Custom-scheme hijack on Android -> PKCE-bound single-use 60 s code; token never in a URL.
5. Open redirect / SSRF -> no URL from the request; endpoints and JWKS hosts are constants; `redirect: 'error'`.
6. Silent data loss at sign-in (finding 4) and cross-user data leak on a shared browser (finding 5) -> match dialog, owner marker, clear on logout, 30-day restore points.
7. Lock-out of OAuth-only users -> recovery codes, cannot unlink the last method, password can be set later.
8. Abuse of signup through OAuth (bypassing invites) -> signup step enforces `CT_REGISTRATION` and invite atomically; per-IP and per-day limits.
9. Provider secret exposure (`CT_GOOGLE_CLIENT_SECRET`, Apple `.p8`) -> env/file only, 0400, outside data dir, never logged or returned; `assertPublicSafe` extended to refuse the `.p8` inside `CT_DATA_DIR`.
10. Availability: provider outage or blocked from the user's network -> password login always remains; JWKS stale-cache; Google/Apple unreachable from the server -> clear "try later" and button stays usable for others.

## 7. Testing without real providers

* `server/oidcmock.ts` (~150 lines, test-only): `node:http` on `127.0.0.1:0` with its own RSA key pair (`generateKeyPairSync`), `GET /jwks` (exports the JWK with a `kid`), `POST /token` (checks `grant_type`, `redirect_uri`, `code_verifier` (Google mode) or the **Apple client-secret JWT**: verifies its ES256 signature with the test public key and its `iss/sub/aud/kid`; returns a signed `id_token` built from a "pending authorization" the test registered), plus knobs to corrupt a claim.
* The providers table in `server/oauth.ts` is constants by default; a test-only setter `_setProvidersForTest()` swaps in the mock's URLs and works only when `process.env.CT_NO_AUTOSTART === '1'` (the same switch `publictest.ts` sets), so production cannot be pointed elsewhere by an env var.
* `server/oauth.test.ts` (uses `boot()`/`client()` from `publictest.ts`): the test calls `/start`, parses `state`/`nonce` from the returned URL, tells the mock "user X, sub S authorized", then drives the callback itself (Google `GET`, Apple `POST` with `Content-Type: application/x-www-form-urlencoded` and `Origin: https://appleid.apple.com`, including a `user` field that must be ignored).
* Cases: happy login (cookie and `device` token); signup in `invite` / `open` / `closed`; link / refuse link of an identity owned by another account / unlink / refuse last method; OAuth-only password login timing equals unknown user (`stats.hashes` trick, `users.ts:33`); `nonce` mismatch; wrong `aud`; wrong `iss`; expired; `alg: none`; HS256 signed with the public key as secret; signature by another key; unknown `kid` triggers exactly one refetch then rejects; `email_verified: false` / `"true"` string; replayed `state`; expired `state`; replayed `code`; wrong `verifier`; code from another client's start; non-allowed `ret`/`port`; Apple callback without the CSRF exemption path is still blocked on other routes; disabled provider -> 404 and `status.oauth.apple === false`; log capture contains no `code=`/`id_token`.
* `server/isolation.test.ts`: add the new routes to `CLASS` (`AUTH` for start/callbacks/exchange/signup, `U-list` for identities and restore routes).
* Client: `src/merge.test.ts` (property tests: idempotent, convergent on swap, no id lost unless tombstoned, tombstone vs later edit, `acct` never merged, quota-sized journal), `src/oauth.test.ts` (PKCE pair, fragment parsing, expiry), extend `sync.test.ts` for the new `hydrate` guard. Android: manual checklist plus a pure-Java check of the code regex.

## 8. Phased plan

| Phase | Files (approx. lines) | Done when |
|---|---|---|
| **1. Server OIDC + identities** (Google first) | `server/core/oidc.ts` new (~180); `server/oauth.ts` new (~320); `users.ts` (+~90: migrations 3-5, `createOAuthUser`, identity helpers, dummy-verify fix, `listUsers`); `authroutes.ts` (+~25: mount, `status.oauth`); `http.ts` (+~8); `mode.ts` (+~25); `isolation.test.ts` (+~8); `server/oidcmock.ts` (~150) + `oauth.test.ts` (~400) | Google login/signup/link/unlink pass against the mock; Apple code path included but env-disabled. |
| **2. Client buttons + linking UI** | `src/oauth.ts` new (~150); `servers.ts` (+~5 `oauth` in `parseStatus`/types); `accountscreens.ts` (+~60: buttons, username/invite screen after `signup:true`); `login.ts` (+~70: "Sign-in methods…" dialog, set password); `boot.ts` (+~20 `resumeOAuth`); `public/oauth-return.html` (~30) | web and PWA sign-in work end to end; buttons hidden when the provider is off. |
| **3. Merge engine + match dialog** (independent of OAuth, fixes finding 4) | `src/merge.ts` new (~350) + `merge.test.ts` (~400); `store.ts`/`sync.ts` (+~80 sidecar stamping, tombstones, `LOCAL_KEYS`); `server/state.ts` (+~50 batch) ; `server/restore.ts` new (~120) + `quota.ts` (+2); `src/matchui.ts` new (~200); `boot.ts` (rewrite `:65-67`, owner marker, logout clear) | both-sides-have-data sign-in shows the dialog; nothing is lost; restore works; tests green. |
| **4. Android Custom Tab (+ Electron loopback)** | `AndroidManifest.xml` (+16); `MainActivity.java` (+~70); `android/app/build.gradle` (+1 optional); `desktop/main.cjs` (+~40) | Google sign-in completes on a phone from the APK and returns to the app. |
| **5. Apple + docs** | enable/verify Apple path (`oidc.ts` ES256 secret is already in phase 1 but only testable with the mock until the owner has the credentials); `public/.well-known/` + MIME `.txt`; `docs/oauth.md` (Persian, from 5.2); update `docs/multi-server.md`, `multiuser-design.md` §2 and §7.4 env table | docs merged; Apple only if the owner can enrol. |

Order rationale: phase 3 can ship before or in parallel with 1-2 and already removes the existing data-loss bug for password users; phase 1 is the riskiest and gets the most tests; Android (4) depends on 1-2; Apple (5) is last because it may never be possible from Iran.
