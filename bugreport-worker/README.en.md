[English](README.en.md) · [فارسی](README.md)

# Bug report receiver (Cloudflare Worker)

The app sends the report to this Worker, and the Worker delivers it to your Telegram bot (text, diagnostics file, screenshots) and, optionally, to a GitHub Issue. The tokens live only on the Worker, never inside the app.

## How it works

1. The app calls `GET /challenge` and receives a **proof-of-work puzzle**: find a number whose SHA-256 hash starts with a given number of zero bits. The user's phone or computer works for about a second; bots that want to send reports in bulk have to pay the same cost.
2. The app calls `POST /report` with the report plus the puzzle solution. The Worker checks the puzzle's signature, expiry (10 minutes), difficulty and the correctness of the answer, and accepts each puzzle only once.
3. Limits: at most 9 MB, 3 images of up to 2 MB each, 5 reports per hour per IP, 300 reports per day.
4. The Worker sends the text and images to Telegram. If sending to Telegram fails, it responds with 502 and the app offers the user to save the report as a file.

### About the CAPTCHA

This CAPTCHA is not Turnstile or reCAPTCHA; it is **proof of work**. Why it was chosen: it does not need to load a script from another site (in Iran `challenges.cloudflare.com` and similar domains may be blocked and would lock up the user's form), and it protects privacy. Its weakness: it does not prove that the sender is "human", it only makes bulk submission expensive. Together with the IP limit and the daily cap, it is enough for a bug-report tool. If you later see spam arriving, raise `DIFFICULTY` to 18 or 20 (every 2 extra bits makes it 4 times slower) or we will add Turnstile.

## Setup (one time, about 15 minutes)

Prerequisites: Node.js, a Cloudflare account (free) and a Telegram bot. (In Iran, a VPN is usually needed to reach the Cloudflare dashboard and Telegram.)

1. **Account and tooling**
```bash
cd bugreport-worker
npx wrangler login
```

2. **Telegram bot:** if you already have the notifications bot, use that one; otherwise send `/newbot` to `@BotFather` in Telegram and keep the token.

3. **Your chat ID:** send a message to your own bot, then open this address in a browser (replace `TOKEN` with the bot token):
`https://api.telegram.org/botTOKEN/getUpdates`
In the response, find `"chat":{"id":123456789`. That number is `TELEGRAM_CHAT_ID`. Write it in `wrangler.toml` in place of `REPLACE_WITH_YOUR_CHAT_ID`.

4. **Limits and preventing puzzle reuse:** this is handled by a Durable Object (with SQLite storage) that is defined in `wrangler.toml`; you do not need to create anything by hand. (A Durable Object processes one request at a time, so concurrent submissions with the same puzzle or from the same IP cannot get around the cap. If this component is unavailable, the Worker rejects the report instead of accepting it without limits.)

5. **Secrets** (each one is prompted for and not written anywhere):
```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN      # the bot token
npx wrangler secret put CHALLENGE_SECRET        # a long random string; for example the output of: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

6. **(Optional) GitHub Issue** — explained below. If you want it:
```bash
npx wrangler secret put GITHUB_TOKEN
```
and enable the `GITHUB_REPO` line in `wrangler.toml`.

7. **Deploy**
```bash
npx wrangler deploy
```
The printed address (for example `https://chart-terminal-bugreport.<your-account>.workers.dev`) is the receiver address.

8. **Test:** open `https://<address>/challenge` in a browser; you should see a JSON with `salt` and `difficulty`.

## Connecting the apps to this address

The address is embedded into the app at **build** time:

- **Windows and Android build (on this same computer):**
  ```powershell
  $env:VITE_BUG_REPORT_URL = "https://<receiver-address>"
  cd desktop; npm run dist:win                        # Windows installer
  cd ..\android; .\gradlew.bat assembleStandaloneRelease assembleClientRelease -PbugReportHost=<domain-name-only>
  ```
  (For the standalone Android app, `bugReportHost` is the domain name without `https://`, so that the app is allowed to connect to it; first run `npm run build` from the root with the same variable.)
- **Linux (GitHub Actions):** in the repo: Settings ← Secrets and variables ← Actions ← Variables ← create a variable named `BUG_REPORT_URL` with the same address.
- **Server (Pi/PWA):** set the environment variable `CT_BUG_REPORT_URL` on the server so the page is allowed to connect to the receiver.

## Option 4: what does a GitHub Issue mean?

If you set `GITHUB_TOKEN` and `GITHUB_REPO`, then in addition to Telegram the Worker creates an **Issue** in your private repo for every report (with the `bug-report` label): title = the first line of the description, body = the user's description + diagnostic information. Benefits:

- an organized, searchable list of bugs, without them getting lost in the Telegram chat history;
- you can set a status (open/closed), add labels, link the commit that fixed it (`fixes #12`) and later find out what was fixed and when;
- the Issue link also appears in the Telegram message.

What does **not** go into the Issue: images (the GitHub API has no image upload for Issues) and the user's contact details. These two only arrive in Telegram. The `@` character is also neutralized so that a report cannot mention anyone.

**Creating the token:** GitHub ← Settings ← Developer settings ← Personal access tokens ← **Fine-grained tokens** ← Generate. Select only the `SepiNick/Chart-Terminal` repo, grant **Issues: Read and write** (and only that), and set an expiry (for example 90 days). Enter the token with `wrangler secret put GITHUB_TOKEN`; do not put it anywhere else.

## Cost and limits (Cloudflare free plan)

- Workers free: 100,000 requests per day, 10 ms of CPU per request, request body up to 100 MB (we cap it at 9 MB). Each report is two requests, so the theoretical ceiling is 50,000 reports per day.
- A Durable Object with SQLite storage is possible on the free plan (per the docs, about 100,000 requests and 100,000 row writes per day). Each report makes 3 requests to it; the `PER_DAY=300` reports-per-day cap is consistent with that from the start. If one day there are many reports: the $5 Workers plan removes the caps.
- CPU: the app solves the puzzle and the Worker only computes one hash; CPU use per request is on the order of milliseconds.
- The figures come from the Cloudflare documentation; before relying on them seriously, also check their limits page.

## Access from Iran

I did not find a clear assessment of whether `workers.dev` is open or blocked in Iran. 2026 reports say Iran's filtering works by SNI (domain name) and domains behind Cloudflare are blocked too, so do not count on it being open. Ways to reduce the risk:

1. **Saving a file:** if sending fails, the app saves the report as a file so the user can send it to you. (Done.)
2. **A custom domain** on Cloudflare instead of `workers.dev` (less likely to be a filtering target).
3. **A server outside Iran:** the Worker code is a simple Fetch module and can easily run on Deno Deploy, Bun or a VPS too; only the KV has to be replaced.
4. Reporters who are in Iran may send reports through a VPN.
