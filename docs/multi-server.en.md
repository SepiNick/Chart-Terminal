[English](multi-server.en.md) · [فارسی](multi-server.md)

# Connecting a client from another origin (device token + CORS)

For a client that is served from somewhere other than the server itself (the Android APK, an Electron/lite window connected to a remote server, a PWA on another domain). The same-origin web app still works with the cookie alone and nothing changed for it.

## Contract (both private and public modes)

1. **Token sign-in.** `POST /api/auth/login`, `/api/auth/register` and `/api/auth/recover` accept an optional field `"device": "<label up to 60 characters>"`. If present, the response is `{ok:true, token, user:{name,role}}` and **no cookie** is set (register and recover still return `recoveryCodes` too). The token is 256 random bits and is stored only as a sha256 together with the label, creation time, last use and IP. Each user has at most **10** tokens; after that a `409` error with `code: "device_limit"`.
2. **Use.** Every route accepts an `Authorization: Bearer <token>` header in place of the cookie. Token requests are exempt from the Origin / Sec-Fetch-Site check (a cross-site form cannot send an Authorization header) but **the `x-ct-client` header (8 to 64 characters of `[\w-]`) is required**, and they get the same throttle and quota as sessions. If the Bearer header is invalid the cookie does not take its place (401). A device token is not accepted as a cookie and a session cookie is not accepted as a Bearer. A token is never read from the URL.
3. **WebSocket.** The subprotocol is `ct.<token>` in `Sec-WebSocket-Protocol` (never the query string). The server echoes it. The Origin check remains only for cookie authentication; it does not reject a token. Revoking a token closes the open socket with code `4001`.
4. **Management.** `GET /api/auth/devices` → `[{id,label,created,lastUsed,ip,current}]` (never the token itself). `DELETE /api/auth/devices/:id` → `204`; an unknown id, or one belonging to someone else, gives `404`. Changing the password, recovery (recover) and disabling the account all revoke every token; `logout` with a Bearer revokes that token. Tokens do not appear in `GET /api/auth/sessions`. Token lifetime and idle limit are like sessions (public: 30 days / 14 days idle; private: 60 days).
5. **status.** `GET /api/auth/status` also returns: `registration` (`invite|open|closed`; always `closed` in private), `version`, `mode`, `serverName` (from `CT_SERVER_NAME`, up to 60 characters) and `features:{trading,ai,ml,forward,scripts,python}` (private all `true`, public all `false`; `python:true` means the module exists, not that it is on: `GET /api/py/status` says whether it is on) so the client can hide panels the server does not have.

Sign-in/register/recover from another origin is accepted **only with `device`** (without it `403`) and only when the Origin is in `CT_CORS_ORIGINS` (or a non-browser client that has no Origin and Sec-Fetch-Site).

## CORS

**Off** by default. The `CT_CORS_ORIGINS` variable is a list of exact origins, comma-separated, e.g.:

```
CT_CORS_ORIGINS=https://app.example.com,http://localhost:5173
```

- Exact string comparison only; `*`, `null`, a path, a trailing slash and anything that is not a bare origin cause an error at server start and the server does not come up.
- For a listed origin: `Access-Control-Allow-Origin: <that origin>`, `Vary: Origin`, and on preflight (`OPTIONS`) also `Allow-Headers: authorization, content-type, x-ct-client`, `Allow-Methods: GET, POST, PUT, DELETE, OPTIONS`, `Max-Age: 600`. `Access-Control-Expose-Headers: retry-after` so the 429 wait time can be read.
- It **never sends `Access-Control-Allow-Credentials`**: a cookie from another origin is not accepted, only a Bearer.
- An unknown origin gets no CORS header (its preflight is a 404 as before). The Host guard (`CT_ALLOWED_HOSTS` etc.) stays in place.

## Android and opaque origins

The current APK (`android/app/.../MainActivity.java`) loads the page with `web.loadUrl(origin)` straight from the server itself; so it is **same-origin** and needs neither CORS nor a token. If the APK ever serves the app's assets locally: `file://` in a WebView sends `Origin: null`, which is **not accepted**. The right way is `WebViewAssetLoader`, which serves the page from `https://appassets.androidplatform.net`; write that origin (plus the real Capacitor/Electron origin if used, e.g. `https://localhost` or `app://...`, to be checked against the real `location.origin`) explicitly in `CT_CORS_ORIGINS`.

## Mixed content and self-signed certificates

- An https page cannot connect to `http://` or `ws://` (mixed content). For a remote server use `https://`/`wss://` (Caddy/nginx with a valid certificate).
- On a LAN with a self-signed certificate, the browser/WebView must accept the CA: install `/ca.crt` (and `/ca.mobileconfig` for iOS); details in `docs/lan-setup.en.md` and `docs/android-apk.en.md`. The APK deliberately refuses an unknown certificate.
- These are set-up matters and there is no code in the server for them.

## Environment variables

| Variable | Meaning |
|---|---|
| `CT_CORS_ORIGINS` | exact allowed origins, comma-separated. Empty = CORS off |
| `CT_SERVER_NAME` | display name in `/api/auth/status` (up to 60 characters) |

## Security notes

- A token is like a password: keep it only in the client's memory/secure storage; XSS in the client's origin = token theft (unlike an HttpOnly cookie). That is why each device has its own label and can be revoked with `DELETE /api/auth/devices/:id`.
- The token does not appear in server logs (only the path is logged, and long strings are masked).
- Tests: `server/devices.test.ts`, `devicesprivate.test.ts`, `cors.test.ts`, `corsoff.test.ts` and the route classification in `isolation.test.ts`.
