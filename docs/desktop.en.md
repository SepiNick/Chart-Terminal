[English](desktop.en.md) · [فارسی](desktop.md)

# Chart Terminal desktop app (Windows, Mac, Linux)

The desktop app is the same Chart Terminal, with its own server inside the app. You do not need to install Node, run the server separately, or use a browser.

## How it works
- **Structure:** an Electron shell (`desktop/main.cjs`) runs the server on a free port of `127.0.0.1` and shows the app from that server in a window.
- **Data:** the app's data (password, layouts, journal, alerts and encrypted keys) is stored in the user's data folder:
  - Windows: `%APPDATA%\Chart Terminal\data`
  - Mac: `~/Library/Application Support/Chart Terminal/data`
  - Linux: `~/.config/Chart Terminal/data`
- **First run:** the app starts with empty data and asks for the first password. The separate server (`server/data`) is not touched.
- **Closing the window:** by default the window hides in the system tray and the server (alerts, forward tests, trade recording) keeps going; a full exit is from the tray icon's menu. You can turn this behaviour off from that menu; then closing the last window also closes the server. "Start with Windows" starts the app hidden in the tray. For round-the-clock work without a window: [lite.en.md](lite.en.md) (`--no-window`) or [headless-server.en.md](headless-server.en.md).
- **Web Push:** does not work in the desktop app. The alert popup and sound work.
- **Opening twice:** if you open the app again, the existing window comes to the front.
- **Crashes:** if the window's renderer process dies, the window reloads and a crash log is sent automatically (see [bug-report.en.md](bug-report.en.md)).

## Building the installer
Prerequisite: Node.js version 24 or newer on the same system (the server uses `node:sqlite`).

```bash
npm ci
```
```bash
cd desktop
```
```bash
npm ci
```
Then run the command for each operating system:

| OS | Command | Output in `desktop/release/` |
|---|---|---|
| Windows | `npm run dist:win` | `Chart Terminal Setup <version>.exe` |
| Mac | `npm run dist:mac` | two `.dmg` files: Intel (x64) and Apple Silicon (arm64) |
| Linux | `npm run dist:linux` | `.AppImage` and `.deb` |

The Mac installer is only built on a Mac itself. Build the Linux installer on Linux too.

To try it without installing: `npm start` in the `desktop` folder. If npm did not run Electron's install script, `npm start` cannot find the app. In that case run `node node_modules/electron/install.js` once. The `dist:*` commands do not need this.

## Installing without a digital signature
The installers are unsigned. The operating system warns once:

- **Windows (SmartScreen):** click "More info" and then "Run anyway".
- **Mac:** drag the app to Applications. The first time, right-click it, press "Open" and confirm "Open" again. If a "damaged" message appears, run this in Terminal:
  ```bash
  xattr -dr com.apple.quarantine "/Applications/Chart Terminal.app"
  ```
  The app is built with an ad-hoc signature because Apple Silicon will not run a completely unsigned app.
- **Linux:**
  - **deb (recommended for Ubuntu 24.04):** `sudo apt install ./<file>.deb`.
  - **AppImage:** first `chmod +x <file>.AppImage` and then run it. On recent Ubuntu `libfuse2` is needed (on 24.04 it is called `libfuse2t64`). If AppArmor blocks the sandbox, install the deb or run the AppImage with `--no-sandbox`.

## For development
- **`window.prompt()`:** Electron does not have this function. `desktop/preload.cjs` replaces it with a small input window so naming a layout, a template and a custom timeframe works.
- **Fixed port:** the chosen port is saved in `port.txt` and the app always opens at the same address, so the browser's local settings are kept too.
- `desktop/build.mjs` does two things:
  - builds the client with Vite (`app/dist`).
  - bundles the server and the script-engine worker into one file with esbuild (`app/server`).
- The server's npm packages (ccxt, ws, nodemailer, web-push) are installed from `desktop/package.json`.
- To experiment without touching real data, change the data folder with `CT_USER_DATA=<folder>`.
- **Automatic update** uses `electron-updater` and only works when `build.publish` is set in `desktop/package.json` (it is not for now; without it the check fails silently).
- **Not built yet:** tabs and several synced windows (phase 13).
- **The light version without Electron:** [lite.en.md](lite.en.md).
