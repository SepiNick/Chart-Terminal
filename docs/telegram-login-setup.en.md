[English](telegram-login-setup.en.md) · [فارسی](telegram-login-setup.md)

# Setting up "Sign in with Telegram" (guide for the public-server owner)

This sign-in only works on a **public server** (`CT_MODE=public` with HTTPS and `CT_PUBLIC_URL`) and is shown next to Google/Apple. Each person signs in with their own Telegram account, and their settings, watchlists and sync are attached to that account. (The bot-based sign-in of the private server, `/api/auth/telegram/*`, is separate and untouched.)

## Where is it in the app, and how do I sign in?
On the sign-in screen, below the form, there is a **"Continue with Telegram"** button (next to "Continue with Google" and "Continue with Apple"). A button appears only when the server owner has configured that provider. Click it, confirm in Telegram, and you come back signed in. Already signed in? Menu → account → **Sign-in methods** lets you link or unlink Telegram. The standalone app (no server) has no accounts, so it shows no buttons.

## Why OpenID Connect and not the old widget?
For sign-in Telegram offers standard OIDC (authorization code flow + PKCE, an RS256 token from `oauth.telegram.org`) and has moved away from the old widget (HMAC over `auth_date` with a key = SHA256 of the bot token). OIDC fits the existing Google code completely (single-use state, PKCE, single-use code, signature check with JWKS), the client secret is separate from the bot token, and the bot token never reaches the sign-in code; the widget needed `/setdomain`, a script in the page and new code for freshness and replay.

## BotFather steps
1. Open `@BotFather` in Telegram; create the bot with `/newbot` or pick one with `/mybots`.
2. Open the bot's web sign-in section (Bot Settings, the Login Widget / Web Login option). (Check the exact menu name in the current BotFather; it could not be seen in this project.)
3. Under **Allowed URLs** add both the site origin (`CT_PUBLIC_URL`) and this redirect URI exactly (no trailing `/`, https):
   `${CT_PUBLIC_URL}/api/auth/oauth/callback/telegram`
4. Copy the **Client ID** and **Client Secret**. Keep the signing algorithm on **RS256** (EdDSA / ES256 / ES256K are not supported and sign-in fails).
5. `/setdomain` is not needed (it was only for the old widget).

## Environment variables (server only, never in the front end)
| Variable | Meaning |
|---|---|
| `CT_TELEGRAM_CLIENT_ID`, `CT_TELEGRAM_CLIENT_SECRET` | both or neither (half set = an error at start) |
| `CT_TELEGRAM_BOT_USERNAME` | optional, display only (the bot's username, without `@`) |

After a restart, `GET /api/auth/status` should return `oauth.telegram: true`; the "Continue with Telegram" button only shows when the server is configured.

## Account rules
- The identity is only Telegram's signed `sub` (not the username, not the phone number). Telegram and Google accounts are never merged automatically; a signed-in user can link or unlink Telegram under "Sign-in methods" (the last sign-in method cannot be removed).
- Do not change `CT_TELEGRAM_CLIENT_ID`: IDs may differ per bot, and linked accounts would be orphaned.
- The desktop/Android app, when connected to a public server, behaves like Google; the standalone mode (no server) and a cross-origin page see no button and get an explanatory text.

## Network / VPN (Iran)
Two separate paths are needed: the user's browser must reach `oauth.telegram.org` (a VPN in Iran) and the server itself must reach it too, for the code exchange and JWKS (a server outside Iran, or a VPN). If the server cannot reach it, the user sees "could not reach Telegram" (in the audit: `oauth fail:network`); if the browser cannot reach it, the browser's own error page shows.

## Testing
The automated tests (`server/oauthtelegram.test.ts`) cover forged, expired and replayed tokens with a mock provider. **No live test with a real bot was done** (no token/bot available); the claims about `sub`, the absence of `nonce` and the scope names come from Telegram's documentation. Manual checklist: sign in, create an account, sign in again, link/unlink, cancel in Telegram, VPN off.
