[English](desktop-shell-spec.en.md) · [فارسی](desktop-shell-spec.md)

# Behavioral Specification of the TradingView 3.4.1 Desktop Shell

> **Clean-room method:** this document describes *behavior* only. No TradingView code has been copied into it or into the project.
> Source: the version installed on this very system (`TradingView.Desktop_3.4.1.8194`), including the file listing of `app.asar`, the `configs/*.json` files, the IPC channel names in `preload/*.js`, and 367 UI strings in `resources/locales/en.json`.
> REA evidence ID for `app.asar`: `ev_3ed35508f7d7d60b30650a272eb11f3b762d67368e2af424731b51caf7151c4e`

## 1. Architecture

| Area | Observed | Equivalent in our project |
|---|---|---|
| Main process | `index.js`; manages windows and tabs and loads the `www.tradingview.com/chart/` site in each tab | Phase 7: Electron loading our own `index.html` |
| Local pages | `window`, `new-tab`, `menu`, `splash`, `toast`, `tooltip`, `dialog-window`, `crash-view`, `error-view`, `tab-monitor`, `drag-service` | This same list is the page map for phase 7 |
| Browser-to-app bridge | 5 preload files that give the site a desktop-specific API (table in section 3) | A single preload using `contextBridge` |
| Storage | `classic_level` (LevelDB database), `keytar` (secure password storage in Windows Credential Manager) | Phase 4: exchange API keys in keytar, not in a file |
| Native module | `tvdbridge.node` (its exact purpose was not examined; unknown) | — |
| Navigation rules | `nav-rules.json`: each link decides whether it opens in a new tab, a popup window, or the external browser | A simple rules table in the main process |
| Auto-save | `persistence.autoSaveInterval = 300000`, i.e. every 5 minutes | Saving the layout to disk |
| Error reporting | Sentry and Google Analytics | Not needed |

## 2. Shell features (from the UI strings)

- **Tabs:** duplicate, detach into a new window, close other tabs or tabs to the right, rename, tab groups, and hide tabs in full-screen mode.
- **Color-coded sync between tabs:** symbol, timeframe, time (date range) and crosshair. Tabs with the same color label stay in sync with each other, even across multiple monitors.
- **Layouts:** create, rename, copy, delete (showing the number of drawings), sort by name or date, a cap on the count depending on the subscription type, and automatic restoring of symbol and timeframe.
- **App settings:** theme (dark, light, or follow the system), disabling hardware acceleration, clearing the cache, Factory reset, download folder, auto-filling the broker password, and access to the microphone, camera and screen recording.
- **Start menu (new-tab):** Heatmap (crypto and ETF), calendars (economic, dividends, earnings, IPO), Fundamental Graphs, Community ideas, CEX and DEX pairs, and market categories (bonds, ETFs, crypto).
- **Signing in:** through the browser, two-factor code, and pasting a secret key.
- **Auto-update**, error page and crash page.
- **45 alert sounds** in 5 categories: general, funny, nature, soft and voices.

## 3. IPC channels (the interface between the site and the app)

| Channel | What its name suggests (inferred) |
|---|---|
| `tvd:get-credentials` / `tvd:set-credentials` | Reading and saving the broker password in keytar |
| `tvd:get-watchlist` / `tvd:watchlist-change` | Syncing the Watchlist between tabs |
| `tvd:get-crosshair-sync` / `tvd:crosshair-sync-setting-update` | Crosshair sync |
| `tvd:update-link-values` | Broadcasting symbol, timeframe and time between tabs of the same color |
| `tvd:layout-change` / `tvd:layout-restored` | Saving and restoring the layout |
| `tvd:get-theme` / `tvd:set-theme-setting` / `tvd:update-theme` | Theme |
| `tvd:set-notification` / `tvd:set-notification-viewed` | System notifications (for alerts) |
| `tvd:focus-pine-editor` | Bringing the Pine Editor to the front |
| `tvd:open-new-window` / `tvd:reload-tab` / `tvd:set-title` | Window and tab management |
| `tvd:get-audio` / `tvd:get-camera` / `tvd:get-screen` | Media permissions |
| `tvd:native-input-string` | Native text input (exact use unknown) |
| `tvd-main:initiate-sign-in` / `tvd-main:set-locale` | Signing in and language |

The second column is inferred from the channel names; their actual behavior was not observed at runtime.

## 4. What this app does not contain (and must be built from scratch)

The chart engine, drawing tools, indicators, Pine Script (compiler on the server), Strategy Tester, Screener, Trading Panel and broker connections. All of these are loaded from the TradingView site. To pin down their behavior, we observe the running app's UI (menus, settings dialogs, tool lists) and document the behavior, not the code.
