[English](android-apk.en.md) · [فارسی](android-apk.md)

# Android app (APK) for Chart Terminal

There are two product flavors that install side by side (separate applicationId) and produce differently named outputs:

| flavor | output file | what it does |
|---|---|---|
| `client` | `app-client-release.apk` (about 14 KB) | Thin client: takes the server address (see the sections below) |
| `standalone` | `app-standalone-release.apk` (about 880 KB) | No server at all; `dist/` is inside the APK and everything stays on this phone |

## The standalone version

- The built app (`dist/`) is packaged into `assets/www` and served through `WebViewClient.shouldInterceptRequest` from the secure address `https://appassets.androidplatform.net` (nonexistent paths and `/api/*` get a 404 response; `..` and `\` in the path are rejected; the MIME type is derived from the extension).
- At boot the app calls `GET /api/auth/status`; a 404 means **Standalone mode**: no login page, charts and live data straight from Binance (`data-api.binance.vision` and `wss://data-stream.binance.vision`), Pine/MQL/Ninja scripts, paper trading, journal, layers, watchlist, replay and strategy tester all run inside the app itself. A small «Standalone · data stays on this device» bar sits at the bottom of the screen.
- Data is stored in this WebView's `localStorage` and IndexedDB (closing the app does not erase it; it is erased by "Clear app data" or by uninstalling the app; `allowBackup` is off). Features that need a server (server-side alerts, broker account, non-Binance screener, news/calendar, AI, forward test, the 25 skills that read from `/api`) are hidden or disabled with the message "Standalone mode: this needs a server".
- Navigation is allowed only to the app's own origin; other links open in the system browser, and requests to any host other than the app's origin and the two Binance hosts are blocked. The app's only permission is `INTERNET`. Back returns to the previous page and exits on the first page.
- To use your own server, install the `client` version (in this version the "Connect to a server" button only explains this).
- Limitations: without the microphone permission, journal voice recording does not work; file download (Export, backup) is not supported in the WebView; file picking (Import) works. Not tested on an emulator or a real phone.

### Building standalone

```
npm run build:android-standalone           # signed release  (npm run build:android-standalone debug for debug)
# or manually: npm run build , then in the android folder:
gradlew.bat assembleStandaloneRelease      # app/build/outputs/apk/standalone/release/app-standalone-release.apk
```

The Gradle task named `syncStandaloneAssets` copies the `dist/` folder into `android/app/src/standalone/assets/www` before merging assets (it is not in git). If `dist/` is missing, the build stops with a clear message. Every time the web code changes, `npm run build` is needed again (the script above runs it too).

## The client version

This APK is a "thin client": the server does **not** run on the phone. The app only takes your server's address and shows the Chart Terminal interface full-screen in a WebView.

**Why a plain WebView and not Capacitor?** We only open a single web page, so Capacitor (with Node and its plugins) adds unnecessary weight; a Java Activity without AndroidX keeps the APK under a few hundred kilobytes and gives full control over TLS and HTTP.

## First run

1. Open the app and enter the server address, for example `https://192.168.1.20:8443` or `http://192.168.1.20:8787`.
2. The app reads `/api/auth/status`. If the response is valid, the address is saved and the interface opens.
3. On later launches the interface opens directly.

## Menu and changing the server

- The **Back** button goes back as long as there is a page to return to; on the first page it opens the menu.
- Or **long-press** the top-right corner of the screen.
- Menu: Reload, Change server, Keep screen on (off by default), Exit.

## HTTP and HTTPS (security)

- **Plain HTTP** is allowed only for home-network addresses: `10/8`, `172.16/12`, `192.168/16` and `localhost`. The app checks this both when the address is entered and for every request inside the WebView; any `http://` to a public address is blocked. (Android's `network-security-config` does not understand IP ranges, which is why the check is done in code.)
- **WebSocket**: `ws://` is likewise allowed only to these private addresses; a JavaScript guard in every page rejects `ws://` to a public host (`wss://` is unrestricted). This guard is injected in `onPageStarted` and is not an absolute guarantee against a malicious page; your own server is the only origin that gets loaded.
- **HTTPS**: certificate validation is not disabled anywhere. The **release version accepts only system CAs** and not a user-installed CA. So for release, either use `http://` on the LAN, or have a valid publicly trusted certificate.
- **Local CA (debug version only)**: the debug build trusts user-installed CAs (`debug-overrides`). Move the CA file to the phone as described in `docs/lan-setup.en.md`, install it from Android Settings > Security > Encryption & credentials > **Install a certificate > CA certificate**, and use `app-client-debug.apk`.
- Navigation to another origin (different scheme/host/port) is not performed inside the WebView; only http(s) links are opened in the external browser.

## Building

Prerequisites: JDK 17 and the Android SDK (platform 35, build-tools 35.0.0). Put the SDK path in `android/local.properties` (`sdk.dir=C\:\\Users\\<name>\\Android\\Sdk`).

```
cd android
gradlew.bat assembleClientDebug        # app/build/outputs/apk/client/debug/app-client-debug.apk
gradlew.bat assembleClientRelease      # app/build/outputs/apk/client/release/app-client-release.apk (signed)
```

(`assembleDebug` / `assembleRelease` build both flavors together.)

The release signature is read from `android/keystore.properties` and the file `android/chartterminal.jks`. Both are in `.gitignore`, so **never commit them** and keep a secure backup of them (without them you cannot build an updated version with the same signature). To create a new keystore:

```
keytool -genkeypair -v -keystore chartterminal.jks -alias chartterminal -keyalg RSA -keysize 2048 -validity 10000
```

## Installing on the phone

1. Enable "install from unknown sources" on the phone for the browser/file manager, transfer the APK file and open it; or
2. With USB debugging: `adb install -r app-client-release.apk`

## Limitations

- **Push notifications are not supported.** For notifications you must install the PWA over HTTPS (Web Push); the APK, in exchange, works without any certificate hassle.
- The current version has not been tested on a real device or an emulator.
