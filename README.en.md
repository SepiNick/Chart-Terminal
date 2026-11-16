[English](README.en.md) · [فارسی](README.md)

# Chart Terminal

**A free, open-source charting and trading-research terminal for crypto, forex, stocks and the Iranian market.**
Charts, drawing tools, indicators, your own scripts (Pine, MQL, NinjaScript, Python), backtesting, alerts, a trading journal, a community feed, and a Persian right-to-left interface, in one app that runs on Windows, Linux, Android and your own server.

> Chart Terminal is an independent project written from scratch. It is not affiliated with TradingView, MetaQuotes or NinjaTrader. Charts are drawn with TradingView's open-source `lightweight-charts` library (Apache-2.0).

## Contents

- [Features](#features)
- [What works and what does not (yet)](#what-works-and-what-does-not-yet)
- [Get started](#get-started)
  - [A. Install the app](#a-install-the-app-the-easiest-way)
  - [B. Run your own server](#b-run-your-own-private-server-raspberry-pi-linux-docker)
  - [C. Run a public server with accounts and a community](#c-run-a-public-server-with-accounts-and-a-community)
  - [D. Run from source](#d-run-from-source)
- [Documentation](#documentation)
- [Licence](#licence)

## Features

**Charting**
- 18 chart types (candles, Heikin-Ashi, Renko, Kagi, Point & Figure, Range, Line break, Baseline and more).
- 92 drawing tools in 7 groups: trend lines, Fibonacci, Gann, pitchforks, channels, patterns, shapes, notes, measurements, position boxes. Each has a properties dialog, templates, a floating toolbar, magnet and multi-select.
- Layouts of up to 16 charts with synced symbol, timeframe, crosshair and time; save, export and share layouts.
- Symbol comparison and math on symbols (`BTCUSDT/ETHUSDT`), custom timeframes from seconds to months, Bar Replay, Undo/Redo, log and percent scales.
- One search box for everything: type `btcusdt` and see spot, perpetual (`.P`), futures and dominance symbols from all connected exchanges; pick one exchange to search only that one.

**Your own scripts, no extra software needed**
- **Pine Script** interpreter (v5/v6 subset) with a code editor, autocomplete and a library of ready scripts.
- **MQL4 / MQL5** compiler and runtime (Expert Advisors and indicators) without installing MetaTrader.
- **NinjaScript (C#)** compiler and runtime (indicators and strategies) without installing NinjaTrader.
- **Python** tab to run your own Python on chart data.
- Scripts run with a loop budget, with browser globals hidden from them and with a deny-list of dangerous names; they are not run in a separate process, so only run scripts you trust.

**Backtesting**
- Strategy Tester with 53 metrics, equity curve versus buy-and-hold, list of trades, CSV export.
- Optimization, walk-forward analysis, Monte Carlo, portfolio backtests on several symbols, and a no-code strategy builder.
- Forward test: run a strategy live against the paper account.

**Markets and data**
- 103 crypto exchanges through CCXT (spot, perpetual, futures), forex, metals, energy, indices and stocks.
- Watchlists, screener (also by typing a sentence), heatmap, movers, DEX pairs, economic calendar, news, crypto dominance (`BTC.D`, `TOTAL`, `TOTAL2` ...).
- **Iranian market:** Nobitex, tgju (dollar, gold, coins) and the Tehran Stock Exchange, with the Jalali calendar and a Persian right-to-left interface.
- Order flow and Level 2 depth, open interest, funding and liquidations.

**Trading**
- Paper trading with market, limit and stop orders, TP/SL and multi-stage exit plans.
- Exchange **testnet** accounts and an MT5 demo bridge, through the same order panel.

**Alerts and notifications**
- Server-side alerts that keep working when the app is closed.
- Popup and sound, Web Push, Telegram, e-mail and webhooks.

**Journal, risk and analysis helpers**
- A trading journal with a full workspace, and risk tools (position sizing and more).
- Automatic chart analysis and trading "skills" that run inside the app without any AI service.
- Optional: a local language model and machine-learning tools with Python.

**Community** *(on a public server)*
- Share analyses with a chart snapshot, like, comment, follow people, and talk in live chat rooms (a general room and one per symbol), with reporting, blocking and admin moderation.

**Accounts and sync**
- One password for a private server. On a public server: accounts with sign-in through **Google, Apple or Telegram**, invite codes, and sync of settings, watchlists and layouts across devices.

**Apps for every device**
- Windows installer (x64 and ARM64), Linux (AppImage, deb, pacman), Android (APK and PWA), a light package without Electron, Docker, and a one-command Raspberry Pi server.
- Automatic bug and crash reports to the developer (no keys, passwords or addresses are included; you can switch it off).

## What works and what does not (yet)

- **Real-money trading is not enabled.** Only paper accounts and exchange testnets are supported.
- **Not tried against live services** (built and unit-tested only): the Iranian sources, and the MetaTrader 5 bridge.
- The Windows installers are **not code-signed**, so Windows SmartScreen shows a warning the first time.
- Free data sources (for example Yahoo for forex and stocks) are unofficial, may be delayed and are for personal use.
- Compiled `.ex4` / `.ex5` files and DLLs cannot run; you need the source code of MQL programs.
- Binance and Bybit block some countries (for example Iran). Run the server abroad or behind a VPN.

## Get started

### A. Install the app (the easiest way)

Download the latest version from the **[Releases](../../releases)** page.

| Your device | File | Steps |
|---|---|---|
| **Windows** | `Chart Terminal Setup <version>.exe` (x64 or ARM64) | Run it. If SmartScreen warns, click *More info → Run anyway*. On first start the app asks you to choose a password. |
| **Android** | `Chart-Terminal-<version>-android.apk` | Allow installing from your browser/file manager, open the APK. One app: alone on the phone it has Binance only; connect it to your server (found automatically on the same Wi-Fi, or paired by QR) for every exchange and broker. |
| **Linux** | `.AppImage`, `.deb` or pacman package | `sudo apt install ./<file>.deb`, or `chmod +x <file>.AppImage` and run it. |
| **Light version (Windows/Linux)** | zip / tar.gz | Extract and run `install.ps1` / `install.sh`; see [docs/lite.en.md](docs/lite.en.md). |

The app stores its data on your computer (Windows: `%APPDATA%\Chart Terminal`). Closing the window keeps the server running in the system tray, so alerts keep working. Full guide: [docs/desktop.en.md](docs/desktop.en.md), [docs/android-apk.en.md](docs/android-apk.en.md).

### B. Run your own private server (Raspberry Pi, Linux, Docker)

A personal server keeps alerts and notifications on 24/7 and lets your phone and PC share the same data. Needs: Docker (or Node.js 24+), and an always-on computer on your home network.

**With Docker (any Linux, Raspberry Pi 4/5):**
```bash
git clone https://github.com/SepiNick/Chart-Terminal.git
cd Chart-Terminal
docker compose up -d --build
```
1. On that machine open `http://localhost:8787` and choose the first password (it can only be set from the machine itself).
2. From your phone or PC use `https://<machine IP>:8443`, and install the certificate once from `/ca.crt` (iPhone: `/ca.mobileconfig`).
3. To get alerts in Telegram: create a bot with `@BotFather`, then in the app open *Server & notifications → Telegram*, paste the token and pick your chat.

**Raspberry Pi in one command** (from your PC): `scripts/deploy-pi.sh pi@<Pi address>`; see [docs/raspberry-pi.en.md](docs/raspberry-pi.en.md). **Without Docker, or on a laptop:** [docs/headless-server.en.md](docs/headless-server.en.md). **Phone setup and certificates:** [docs/lan-setup.en.md](docs/lan-setup.en.md), [docs/android.en.md](docs/android.en.md).

### C. Run a public server with accounts and a community

For several people: accounts, Google/Apple/Telegram sign-in, and the Community feed and chat.

```bash
DOMAIN=charts.example.com docker compose -f docker-compose.public.yml up -d --build
docker compose -f docker-compose.public.yml exec app node server/cli.ts invite 1 7 "friend"
```
1. Point your domain to the server and open ports 80 and 443; HTTPS is set up automatically.
2. The first administrator password is printed once in the log: `docker compose -f docker-compose.public.yml logs app`.
3. Registration is by invite code by default (`CT_REGISTRATION=invite`; also `open` or `closed`).
4. Turn on social sign-in by setting environment variables on the server: Google and Apple ([docs/oauth-setup.en.md](docs/oauth-setup.en.md)) and Telegram ([docs/telegram-login-setup.en.md](docs/telegram-login-setup.en.md)). Without them only the password sign-in is shown.
5. The Community needs nothing else; see [docs/community.en.md](docs/community.en.md).

Full guide: [docs/docker.en.md](docs/docker.en.md).

**Optional: receive bug and crash reports.** Deploy the small Cloudflare Worker in `bugreport-worker/` (free account and a Telegram bot): run `npx wrangler login` and then `node setup.mjs` there, and build the apps with `VITE_BUG_REPORT_URL` set to its address. Details: [bugreport-worker/README.en.md](bugreport-worker/README.en.md).

### D. Run from source

Needs Node.js 24 or newer.

```bash
npm install && npm --prefix server install
npm run server   # data server on 127.0.0.1:8787 (needed for other exchanges, forex and the Iranian market)
npm run dev      # the app at http://localhost:5173
npm test         # tests
npm run build    # production build
```
Build the installers yourself: Windows `cd desktop && npm run dist:win`, Android `cd android && ./gradlew assembleRelease`, light package `npm run build:lite`. Contributors: see [docs/development.en.md](docs/development.en.md) for the code map.

## Documentation

All guides exist in English and Persian: [docs/README.en.md](docs/README.en.md) is the index. The roadmap and research notes are in [ROADMAP.en.md](ROADMAP.en.md) and `docs/research/`.

## Licence

GNU General Public License version 2 **or any later version** (GPL-2.0-or-later); the full text is in [LICENSE](LICENSE). Charts are built with TradingView's Apache-2.0 library (`lightweight-charts`), which is not compatible with GPL version 2 alone but is compatible with version 3; that is why the "or later" option is needed. The notice for the libraries is in the app under ☰ → "Licences" and in [public/licenses.html](public/licenses.html).
