[English](android-apk.en.md) · [فارسی](android-apk.md)

# Android app (APK) for Chart Terminal

There is **one** app (`app.chartterminal`, file `Chart-Terminal-<version>-android.apk`). It replaces the old `client` and `standalone` builds. It has two modes and starts in the one you used last:

| mode | what it is | exchanges and brokers |
|---|---|---|
| **Local** (no server) | the web app is bundled in the APK; everything stays on this phone | **Binance only** |
| **Server** | the app opens your Chart Terminal server full-screen | **everything the server has** (every exchange and broker, as on Windows), server-side alerts, sync |

For the full set of exchanges and brokers on the phone, connect to a server: the Windows app with *Home network access* on, a Raspberry Pi, or a VPS. See [lan-setup.en.md](lan-setup.en.md) (the Windows firewall rule is there too).

Upgrading: the app id is the old client's id, so it installs over the old client app and keeps its saved server. The old standalone app (id `app.chartterminal.standalone`) is a different app and its data cannot move; export what you need from it, then uninstall it.

## Picking a server

Open the menu (Back on the first page, or long-press the top-right corner) and choose **Servers...**; it opens the Servers page in local mode.

- **Servers on this network**: servers found automatically (see Discovery). Tap one to connect.
- **Add a server** by address, for example `https://192.168.1.20:8443` or `http://192.168.1.20:8787`. Saved servers can be renamed and removed.
- **Scan QR** / **Enter pairing code**: pair this phone with a server you are signed in to on the PC, see [pairing.en.md](pairing.en.md).
- **Use this device only (local mode)** goes back to the bundled app.

On a team server the server asks for username, password and the 2FA code when needed: [team-server.en.md](team-server.en.md).

## Discovery

The server (private mode with Home network access, or `CT_LAN`) broadcasts a small UDP beacon every 2 seconds on port **41771**. The phone listens only while the Servers page is open. It works only on the same subnet; guest Wi-Fi with client isolation, a VPN on the phone or on the PC, and the Windows firewall block it. Add the address by hand in that case.

## Menu

Back goes back while there is a page to return to; on the first page it opens the menu: **Servers...**, Reload, Keep screen on (off by default), Exit.

## HTTP and HTTPS (security)

- **Plain HTTP** is allowed only for home-network addresses: `10/8`, `172.16/12`, `192.168/16` and `localhost`, checked when the address is entered and for every request. (`network-security-config` cannot express IP ranges, so it is done in code.)
- **WebSocket**: `ws://` is allowed only to those private addresses; a script injected into every page refuses `ws://` to a public host.
- **HTTPS**: certificate validation is never disabled. The release build trusts **system CAs only**, not a user-installed CA. Use `http://` on the LAN or a publicly trusted certificate. The debug build also trusts user CAs (install the CA as in `docs/lan-setup.en.md` and use `Chart-Terminal-<version>-android-debug.apk`).
- Navigation never leaves the current origin: other links open in the system browser.
- Local mode only reaches the app itself and the two Binance public hosts (`data-api.binance.vision`, `wss://data-stream.binance.vision`); everything else is blocked.
- The native bridge `window.CTNative` (server list, discovery, switching mode) exists only for the bundled app and the saved server, never for other sites. Camera access (QR scanning) is granted only to those pages, video only.
- Permissions: Internet, Wi-Fi state and multicast (discovery), Camera (QR scan, asked at first use).

## Local mode

The built app (`dist/`) is packaged into `assets/www` and served from `https://appassets.androidplatform.net` (missing paths and `/api/*` answer 404; `..` and `\` are rejected). At start the app calls `GET /api/auth/status`; a 404 means local mode: no login, charts and live data straight from Binance. Data lives in the WebView's localStorage and IndexedDB (cleared by "Clear app data" or uninstalling; `allowBackup` is off). Features that need a server (server-side alerts, broker accounts, non-Binance markets, news/calendar, AI, forward test) are disabled with a message.

## Building

Prerequisites: JDK 17 and the Android SDK (platform 35, build-tools 35.0.0); put the SDK path in `android/local.properties` (`sdk.dir=C\:\\Users\\<name>\\Android\\Sdk`).

```
npm run build:android            # builds dist/, bundles it, signed release  (npm run build:android debug for debug)
# or: npm run build, then
cd android && gradlew.bat assembleRelease    # app/build/outputs/apk/release/Chart-Terminal-<version>-android.apk
```

The Gradle task `syncWebAssets` copies `dist/` into `android/app/src/main/assets/www` (not in git) before every build and stops with a clear message if `dist/` is missing. Run `npm run build` again after every web change (the script does it).

The release signature comes from `android/keystore.properties` and `android/chartterminal.jks`, both in `.gitignore`: **never commit them** and keep a safe backup (without them you cannot ship an update with the same signature). New keystore: `keytool -genkeypair -v -keystore chartterminal.jks -alias chartterminal -keyalg RSA -keysize 2048 -validity 10000`.

## Installing on the phone

Allow installing from unknown sources for the browser or file manager and open the APK, or with USB debugging `adb install -r Chart-Terminal-<version>-android.apk`.

## Limitations

- No push notifications from the APK; alerts live on the server and show when the app is open. For push install the PWA over HTTPS ([android.en.md](android.en.md)).
- The camera (QR scan) needs a secure page: use local mode, or an `https://` server.
- Not every phone/Wi-Fi allows the discovery broadcast; typing the address always works.
