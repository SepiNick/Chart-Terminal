[English](lite.en.md) · [فارسی](lite.md)

# The Lite version for Windows and Linux

Lite is the same Chart Terminal but without Electron. The server (Node) runs in the background and the interface opens in an "app mode" window of the browser you already have on the system (Edge or Chrome on Windows; chromium, chrome or edge on Linux), with its own separate profile. If no Chromium browser is found, `xdg-open` (Linux) or the default browser (Windows) is used.

## Differences from the Electron version
| | Electron (`desktop/`) | Lite (`lite/`) |
|---|---|---|
| Install size | about 127 MB (installer), about 430 MB after install | about 45 MB zip (Windows, with `node.exe`), about 7 MB tar.gz (Linux, without Node) |
| After closing the window | a whole Electron folder stays in the tray | only the Node server stays, about 65 MB |
| Headless / always-on mode | no | yes (`--no-window`, systemd service) |
| Tray click, automatic update, `window.prompt` | yes | no (instead of the tray: `--status` and `--stop`) |

## Memory measurement (Windows 11, 20 to 28 seconds after start, the app's first page)
The total Working Set of all processes (shared memory is counted several times, so the real number is a little lower):

| Mode | Processes | Working Set | Private |
|---|---|---|---|
| Electron (`win-unpacked`) | 5 | about 497 MB | about 324 MB |
| Lite: server + Edge window | 11 | about 581 MB | about 386 MB |
| Lite: server only (window closed) | 1 | about 65 MB | |

The honest conclusion: **while the window is open, Lite is not lighter than Electron** (about 17% more, because Edge has several helper processes; without the flags that remove extensions and sync the number was about 700 MB). The saving is in three things: download and disk size (about 10 times smaller), the fact that once the window closes the use drops to about 65 MB while alerts and forward tests continue, and the ability to run headless. The numbers were measured on one machine, once, and change with the browser version.

## Installing on Windows (no admin needed)
1. Extract `chart-terminal-win-x64-<version>.zip` into a folder (Node is inside, nothing to install).
2. In that folder:
```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```
Add `-Autostart` to start automatically with Windows. The app is copied to `%LOCALAPPDATA%\Programs\ChartTerminal` and a "Chart Terminal" item is created in the Start Menu. Data is in `%APPDATA%\ChartTerminal`.

You can also use it without installing: inside the extracted folder run `chart-terminal.vbs` (no console window) or `chart-terminal.cmd`.

## Installing on Linux
Requirement: Node.js version 24 or newer.
```bash
tar xzf chart-terminal-linux-<version>.tar.gz
cd chart-terminal
sh ./install.sh
```
- If you do not have Node: `sh ./install.sh --download-node` (gets the official tarball from nodejs.org, checks the checksum and puts it inside the install folder; needs `xz`).
- Installing an always-on service: `sh ./install.sh --service` (a `systemd --user` service). To run without logging in: `sudo loginctl enable-linger $USER`.
- Paths: the app in `~/.local/opt/chart-terminal`, the command in `~/.local/bin/chart-terminal` (must be in `PATH`), the menu item with icon in `~/.local/share/applications`. Data in `~/.local/share/chart-terminal`.

## Usage
```
chart-terminal              # starts the server (if it is not on) and opens a window
chart-terminal --no-window  # server only, no window (headless)
chart-terminal --status     # the server's address and pid
chart-terminal --stop       # clean stop of the server (the trade recorder is flushed)
```
Running the app again only opens another window on the same server. The port is saved in `port.txt` so the address stays fixed and the browser's local settings (localStorage) are not lost. Change the data folder with `CT_DATA_DIR` and the browser path with `CT_BROWSER`. The server only listens on `127.0.0.1`; for access from the internal network see `docs/lan-setup.en.md`.

## Headless
On a server or a laptop without a screen: `chart-terminal --no-window` or the systemd service above. For access from a phone on the home network (HTTPS, first password, firewall): [headless-server.en.md](headless-server.en.md) and [android.en.md](android.en.md). To reach it from this same computer after an SSH port forward (`ssh -L 8787:127.0.0.1:<port> ...`, see the port with `--status`) open it in your own browser.

## Updating
Extract the new version and run `install.ps1` or `install.sh` again. The running server is stopped first, the app files are replaced and the data is not touched. (There is no automatic update.)

## Uninstalling
- Windows: `powershell -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\Programs\ChartTerminal\uninstall.ps1"`
- Linux: `sh ~/.local/opt/chart-terminal/uninstall.sh`

User data (password, layouts, journal, alerts) is deliberately not deleted. To remove everything, delete the data folder yourself.

## Building from source
Prerequisite: Node 24+ and `npm ci` in the root and in `desktop/` (the server packages are taken from `desktop/node_modules`).
```bash
npm run build:lite            # output: dist-lite/chart-terminal + Windows zip + Linux tar.gz
node lite/build.mjs --reuse-dist   # without rebuilding the UI
```
Windows: `node.exe` is the same Node that ran the build. Because the tar.gz is built on Windows, the executable bit of the files is not kept; that is why the commands are run as `sh ./install.sh`.
