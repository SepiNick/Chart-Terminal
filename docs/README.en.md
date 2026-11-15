[English](README.en.md) · [فارسی](README.md)

# Documentation guide

## Install and run: which way is for me?

| Goal | Guide | Summary |
|---|---|---|
| Windows installer (Electron, with tray and updates) | [desktop.en.md](desktop.en.md) | `Chart Terminal Setup <version>.exe`; build: `cd desktop && npm run dist:win` |
| Windows or Linux, light package without Electron | [lite.en.md](lite.en.md) | Windows zip with `install.ps1`, Linux tar.gz with `install.sh`; build: `npm run build:lite` |
| Linux desktop (AppImage and deb) | [desktop.en.md](desktop.en.md) | `npm run dist:linux` in `desktop/` |
| Always-on server on a Linux laptop | [lite.en.md](lite.en.md) (prebuilt) or [headless-server.en.md](headless-server.en.md) (from source) | systemd service, `CT_LAN=1` |
| Android, PWA app (Push notifications) | [android.en.md](android.en.md) | install the CA, then Install app in Chrome |
| Android, APK (two flavours: client and standalone) | [android-apk.en.md](android-apk.en.md) | client: server address; standalone: no server at all, phone only |
| iPhone and access from the home network | [lan-setup.en.md](lan-setup.en.md) | HTTPS with a local CA |
| Development | [../README.en.md](../README.en.md) | `npm install`, `npm run server`, `npm run dev`, `npm test` |

Every way needs Node.js 24 or newer to build/run from source (`node:sqlite`); the Windows package ships its own Node. Docker and Raspberry Pi: the Docker files are written and have been run on a real Raspberry Pi ([raspberry-pi.en.md](raspberry-pi.en.md)).

## Signing in (accounts / SSO)

Sign-in buttons ("Continue with Google / Apple / Telegram") exist only on a **public server**; the server owner turns each one on with environment variables: [oauth-setup.en.md](oauth-setup.en.md) (Google, Apple) and [telegram-login-setup.en.md](telegram-login-setup.en.md) (Telegram). A private server uses one password (and optionally the Telegram bot approval); the standalone app has no accounts.

## All files

- [desktop.en.md](desktop.en.md): the Electron app (Windows, Mac, Linux), data, tray, building the installer.
- [lite.en.md](lite.en.md): the light version without Electron, size and memory comparison, install and uninstall.
- [headless-server.en.md](headless-server.en.md): running the server from source on a Linux laptop, systemd, firewall, backups.
- [bug-report.en.md](bug-report.en.md): in-app bug report (description, screenshots, diagnostics), automatic crash logs, and where they go.
- [raspberry-pi.en.md](raspberry-pi.en.md): a personal server on a Raspberry Pi with one command, adding it to the apps and the Telegram bot (notifications and Telegram sign-in).
- [docker.en.md](docker.en.md): running with Docker on a Raspberry Pi, Linux or VPS (private and public server with Caddy; not built or tested).
- [lan-setup.en.md](lan-setup.en.md): HTTPS on the home network, installing the certificate on Android and iPhone, Windows firewall.
- [android.en.md](android.en.md): installing as a PWA on Android, notifications, battery, fixed IP.
- [android-apk.en.md](android-apk.en.md): the APK app with two flavours (client and standalone), the app's Standalone mode, HTTP/HTTPS rules, building and signing.
- [competitor-gaps.en.md](competitor-gaps.en.md): comparison with competitors and gaps.
- [dominance.en.md](dominance.en.md): dominance and market share.
- [iran-market.en.md](iran-market.en.md): the Iranian market (Nobitex, tgju, TSE).
- [oauth-setup.en.md](oauth-setup.en.md): setting up Google and Apple sign-in (public server).
- [telegram-login-setup.en.md](telegram-login-setup.en.md): setting up Sign in with Telegram (public server).
- [phase7-plan.en.md](phase7-plan.en.md): the phase 7 plan.
- [multi-server.en.md](multi-server.en.md): device-token sign-in and CORS for clients on another origin.
- [python.en.md](python.en.md): the Python tab; run your own Python on chart data (contract, examples, installing pandas, security model and limits).
- [performance.en.md](performance.en.md): measuring and optimising server CPU/RAM use.
- [desktop-shell-spec.en.md](desktop-shell-spec.en.md): behavioural spec of the TradingView Desktop shell (clean-room reference).
- [phase5-contracts.md](phase5-contracts.md) (English) / [فارسی](phase5-contracts.fa.md): phase 5 contracts (server, SQLite, sign-in, alerts, Push). Historical.
- [phase6-contracts.md](phase6-contracts.md) (English) / [فارسی](phase6-contracts.fa.md): phase 6 contracts (broker layer, testnet). Historical.
- [leftovers-contracts.md](leftovers-contracts.md) (English) / [فارسی](leftovers-contracts.fa.md): contract for the leftover work of phases 2 to 10. Historical.
- [research/](research/): the early research notes (01 to 07) and the [multi-user design](research/multiuser-design.md).
