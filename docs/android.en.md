[English](android.en.md) · [فارسی](android.md)

# Using it on Android (installing as an app)

In this method the phone is only a "display" and everything (server, notifications, data) runs on an always-on computer at home: a Linux laptop (guide: [headless-server.en.md](headless-server.en.md)) or the same Windows PC ([lan-setup.en.md](lan-setup.en.md)). The app is installed with Chrome as a PWA and Chrome builds a real WebAPK for it: an icon on the home screen, no address bar, its own notifications.

## Prerequisites

- The server is running on the laptop and Home network access is on (`CT_LAN=1`). In the server log you see addresses like `https://192.168.1.20:8443` and a QR.
- **You must set the first password on the laptop itself** (not from the phone). Open the laptop's browser at `http://127.0.0.1:8787`, or remotely: `ssh -L 8787:127.0.0.1:8787 user@laptop` and then open `http://127.0.0.1:8787` on your own computer. Until the password is set, sign-in from the network is refused.
- `npm run build` has been run (the server serves the `dist/` folder).
- The phone and laptop are on **one Wi-Fi** and the phone's VPN is off (or has a local-network access option); a VPN usually blocks local-network access.

## Step 1: Installing the certificate (only once)

1. In the phone's Chrome open `https://<IP>:8443/ca.crt`. Chrome gives a security warning; that is normal. Press **Advanced → Proceed** so the file `chart-terminal-ca.crt` downloads.
2. **Settings → Security & privacy → More security settings → Encryption & credentials → Install a certificate → CA certificate** → **Install anyway** → choose the downloaded file. (The menu name differs between phones; search Settings for "CA certificate". The phone must have a screen lock.)
3. Close Chrome completely from the recent apps list and open it again.
4. Open `https://<IP>:8443`. It should open with no warning and a healthy lock. To be sure, compare the SHA-256 fingerprint of the certificate (in the app's settings on the laptop) with the installed certificate's details.

## Step 2: Installing as an app

1. Sign in (the password you set on the laptop).
2. Chrome's ⋮ menu → **Install app** (or **Add to Home screen → Install**). If you only see "Add shortcut", Chrome does not yet consider the certificate valid: re-check step 1.
3. Open the app **from the icon on the home screen**. It should open full-screen with no address bar.

Important: the app is tied to the **exact address** (`https://192.168.1.20:8443`). If the IP changes, the installed app no longer opens and must be installed again. So be sure to do the "fixed IP" step below.

## Step 3: Notifications (Push)

1. In the installed app: Settings → Server & notifications → turn on notifications for this device → **Allow**.
2. Create a test alert and check that the notification arrives.
3. Notifications pass through Google's service (FCM), so both the phone and the laptop need **internet**; local Wi-Fi alone is not enough.
4. If a notification did not arrive: the phone's Settings → Apps → Chart Terminal → Notifications must be on.

## Battery settings (so notifications arrive in the background)

- Settings → Apps → **Chart Terminal** (some phones only show "Chrome") → Battery → **Unrestricted** (or "Don't optimize").
- Do the same for **Chrome**.
- Samsung: Battery → Background usage limits → Never sleeping apps → add it. Xiaomi/Huawei/Oppo: turn on Autostart too and lock the app in Recent.
- Turn Data Saver off for this app.

## When the laptop's IP changes

1. **The best way: a DHCP reservation.** In the router panel (usually `192.168.1.1`) go to LAN → DHCP → Static lease / Address reservation and bind the laptop's MAC to a fixed IP (e.g. `192.168.1.20`). On Linux see the MAC with `ip -br link`. After that the app's address never changes.
2. If the IP changed: within about a minute the server rebuilds the certificate with the same CA (do not install the CA again), but the installed app is tied to the old address: delete it, open the new address in Chrome and press Install app again.
3. **The mDNS name (experimental):** the server also puts the name `<hostname>.local` in the certificate and accepts it (`avahi-daemon` must be active on the laptop). On Android, resolving a `.local` name is not reliable on every version and phone; try `https://<hostname>.local:8443` and if it does not open go back to the fixed IP. If it works, install the app with this name so it does not depend on the IP.

## Quick troubleshooting

| Problem | Cause and fix |
|---|---|
| The page does not open | The laptop's firewall, a different Wi-Fi, or the phone's VPN. First try `https://<IP>:8443/ca.crt`. |
| A certificate warning after installing | Close Chrome completely; the certificate must be a "CA certificate", not a "VPN & app user certificate". |
| Sign-in is refused (403) | The first password has not been set on the laptop yet. |
| There is no Install app | Update Chrome; it must be opened at a trusted HTTPS address. |
