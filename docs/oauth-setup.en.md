[English](oauth-setup.en.md) · [فارسی](oauth-setup.md)

# Setting up Google and Apple sign-in (guide for the server owner)

This document is only for the **public server** (`CT_MODE=public`). The private server keeps its single password and has no Google/Apple sign-in button.
Full design: `docs/research/oauth-sync-design.md`. Until you set a provider's environment variables, that provider is **off** and its button is not shown in the app.

## Where is SSO in the app, and how do I sign in?

- On the sign-in / register screen of a public server there are buttons below the form: **"Continue with Google"**, **"Continue with Apple"** and **"Continue with Telegram"**. Each button only appears if the server reports that provider as configured (`GET /api/auth/status` → `oauth.google|apple|telegram`).
- Click one; the browser goes to the provider, you approve, and you come back signed in. On a first sign-in the server asks for a **username** and an **invite code** (when `CT_REGISTRATION=invite`).
- Already signed in with a password? Open the account screen → **Sign-in methods** to link Google/Apple/Telegram (it asks you to confirm again). The last sign-in method cannot be removed.
- Private server: one password (plus the optional Telegram-bot approval button). Standalone app: no accounts, so no SSO.
- If no button shows, see "Troubleshooting" below.

## Prerequisites

- A real domain with HTTPS (required for Apple; for Google too in production).
- A correct `CT_PUBLIC_URL`, e.g. `https://charts.example.com` (no trailing slash). The redirect addresses are built from it.
- `CT_ALLOWED_HOSTS`, `CT_TRUST_PROXY=1` and, if the proxy runs on a Docker network, `CT_PROXY_IPS` (the proxy's address). If `CT_TRUST_PROXY=1` and `CT_HOST` is a non-loopback address but `CT_PROXY_IPS` only has loopback, the server **deliberately refuses to start**, because otherwise all users would look like one IP and the per-user limits would stop working.
- The server needs outbound access to `oauth2.googleapis.com`, `www.googleapis.com` and `appleid.apple.com` (a VPS outside Iran).

Addresses you must register **exactly** (byte for byte) in the consoles:

```
${CT_PUBLIC_URL}/api/auth/oauth/callback/google
${CT_PUBLIC_URL}/api/auth/oauth/callback/apple
```

## A) Google Cloud Console (step one; free)

1. Open `console.cloud.google.com` (with a VPN).
2. Create a new Project (e.g. `chart-terminal`).
3. **APIs & Services -> OAuth consent screen**: user type **External**; fill in the app name, support e-mail, home page address (the same `CT_PUBLIC_URL`) and a privacy-policy address (a simple page on the same domain). Write the server's domain under **Authorized domains**.
4. **Scopes**: only `openid` and `email` (non-sensitive; no Google security review needed).
5. Set **Publishing status** to **In production**. If it stays on Testing only up to 100 test users can sign in.
6. **Credentials -> Create credentials -> OAuth client ID -> Application type: Web application**.
7. Under **Authorized redirect URIs** write exactly `https://your-domain/api/auth/oauth/callback/google` (no trailing slash). Leave **Authorized JavaScript origins** empty.
8. Copy the Client ID and Client secret into the server environment:
   ```
   CT_GOOGLE_CLIENT_ID=...apps.googleusercontent.com
   CT_GOOGLE_CLIENT_SECRET=...
   ```
9. Restart the server. `GET /api/auth/status` should show `"oauth":{"google":true,"apple":false}` and the Google button appears on the sign-in page.
10. For local testing, create a separate client with the redirect `http://localhost:PORT/api/auth/oauth/callback/google` (Google allows `localhost` over http).

Both Google variables must be set together; if you set only one, the server refuses to start with a message naming the missing variable (to catch typos).

## B) Apple Developer (step two; may not be practical from Iran)

**Honestly:** Sign in with Apple needs **Apple Developer Program membership (about 99 USD a year)**, a real domain with HTTPS (not an IP, not localhost) and domain ownership verification. Because of sanctions, registering and paying from Iran is usually not possible, unless with a legitimate account and payment method outside Iran. If you do not meet these conditions, **set up only Google; that is a perfectly valid result.** The Apple code stays off without this configuration and its button is hidden.

1. Enable Apple Developer Program membership.
2. **Certificates, Identifiers & Profiles -> Identifiers**: create an **App ID** and turn on *Sign in with Apple*.
3. Create a **Services ID** (like `com.example.chartterminal.web`). This value is `CT_APPLE_SERVICE_ID`. Turn on Sign in with Apple and press **Configure**: choose the Primary App ID, **Domains** = the server's domain, **Return URLs** = `https://your-domain/api/auth/oauth/callback/apple`.
4. The domain verification file Apple gives you (`apple-developer-domain-association.txt`) must be reachable at `https://domain/.well-known/apple-developer-domain-association.txt` (the server serves the `.txt` extension as `text/plain`; put the file in `public/.well-known/` and build again). Then press **Verify**.
5. **Keys -> New key**: tick *Sign in with Apple*, choose the Primary App ID and download the `.p8` file **only once**. The Key ID is `CT_APPLE_KEY_ID`.
6. Take the **Team ID** (10 characters) from the Membership page: `CT_APPLE_TEAM_ID`.
7. Put the `.p8` file on the server **outside `CT_DATA_DIR`** (read-only for the service user, e.g. `chmod 400`; mount it read-only in Docker). The server refuses to start if the key path is inside the data folder.
8. Variables:
   ```
   CT_APPLE_SERVICE_ID=com.example.chartterminal.web
   CT_APPLE_TEAM_ID=ABCDE12345
   CT_APPLE_KEY_ID=KEYID12345
   CT_APPLE_PRIVATE_KEY_FILE=/run/secrets/AuthKey_KEYID12345.p8
   ```
9. Restart and test. Notes: the user's e-mail may be hidden (`privaterelay.appleid.com`); the user's name only comes from Apple the first time and **the server deliberately ignores it** (the user picks a username). If the key file cannot be read or is not a valid EC key, Apple stays off with a warning in the log (the server does not crash).

All four Apple variables must be set together; a partial set stops start-up with a clear message.

## C) Server settings

| Variable | Meaning |
|---|---|
| `CT_GOOGLE_CLIENT_ID`, `CT_GOOGLE_CLIENT_SECRET` | the Web client in Google |
| `CT_APPLE_SERVICE_ID`, `CT_APPLE_TEAM_ID`, `CT_APPLE_KEY_ID`, `CT_APPLE_PRIVATE_KEY_FILE` | Sign in with Apple |
| `CT_TELEGRAM_CLIENT_ID`, `CT_TELEGRAM_CLIENT_SECRET` | Sign in with Telegram ([telegram-login-setup.en.md](telegram-login-setup.en.md)) |
| `CT_REGISTRATION` | `invite` (default: after Google sign-in the user gives a "username" and an "invite code"), `open`, or `closed` (sign-in works for existing accounts; no new account is created) |
| `CT_PUBLIC_URL` | base of the redirect addresses |
| `CT_OAUTH_START_MAX`, `CT_OAUTH_CB_MAX` | (optional) cap on sign-in starts and callbacks per 10 minutes per address; default 20 and 30 |

Account rules (summary):
- The e-mail is **never** used to find or link an account. Linking Google to an existing account only happens from inside a signed-in session with a fresh confirmation (password, or sign in/confirm again with the provider within the last 10 minutes).
- The last sign-in method cannot be removed (409 `last_method`). An OAuth-only user is created with 8 recovery codes and can set a password later.
- The admin must have a password (admin tools ask for it again); `CT_ADMIN` is never created through OAuth.

## D) Proxy logs

Google's callback carries `code` and `state` in the query (both are single-use). It is better to turn off logging them:

- Caddy: for the path `/api/auth/oauth/callback/*` put a `delete` filter on `request>uri` in the `log` section, or log only the path.
- nginx: in `log_format` use `$request_method $uri` instead of `$request` (without `$args`).

The server itself never logs the query, and the `code` returned to the app arrives in the address **fragment** (`#...`), which goes to no server and no `Referer`.

## E) Troubleshooting

- The button does not show: look at `GET /api/auth/status`; `oauth.google` must be `true`.
- `redirect_uri_mismatch` in Google: the registered address is not the same as `${CT_PUBLIC_URL}/api/auth/oauth/callback/google` (http/https, trailing slash, port).
- "Sign-in failed" after signing in: the exact cause is recorded in the `audit` table as `oauth fail:<code>` (`nonce`, `aud`, `iss`, `exp`, `signature`, `token`, `network` ...). The token text is never recorded.
- The server cannot reach Google/Apple (`network`): check the VPS's outbound traffic; password sign-in always stays available.

> Sign in with Telegram: [telegram-login-setup.en.md](telegram-login-setup.en.md)
