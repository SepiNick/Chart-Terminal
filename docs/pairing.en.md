[English](pairing.en.md) · [فارسی](pairing.md)

# Pairing a phone with your desktop (QR code) and what syncs

Pairing signs a phone (or another computer) in to **your server** without typing a username and password on a small keyboard. After that, the phone has every exchange and broker the server has, and everything below stays in step between the devices.

## Pair with a QR code

1. On the computer that runs the server, open the account menu and choose **Pair a phone…** (Windows app: tray icon → **Pair a phone**). You must be signed in.
2. A QR code, a 10-character code and a countdown appear. A code works **once** and expires after **5 minutes**. At most 5 codes can be waiting at the same time.
3. On the phone open Chart Terminal → **Servers** → **Scan QR** and point the camera at the screen. The app asks for camera permission the first time (it is used only for this).
4. The phone connects and signs in. A toast on the computer says "Paired: <device>", and the phone appears in the **Paired devices** list of the same window.

No camera? Under Servers choose **Enter pairing code** and type the code (spaces and dashes are ignored). If the code does not carry a server address, type the address shown on the pairing window first.

To remove a phone, press **Sign out** next to it in the Paired devices list. The phone is signed out at once. Devices are the same list as "Devices & sessions".

## If the server asks for a second step

If your account uses two-step verification (Account menu → **Two-step verification…**), signing in with a password asks for the 6-digit code of your authenticator app, or one recovery code. Pairing by QR does not ask again: the computer that made the code has already signed in.

## Finding the server by itself

A server with **Home network access** on announces itself on the local network. On the phone, **Servers** shows "Servers on this network"; press Connect and, if needed, sign in (and give the 2FA code). Limits:

- It works only on the **same subnet** (same Wi-Fi or switch). Guest Wi-Fi that isolates devices, and some routers' "AP isolation", block it.
- A VPN on the PC or the phone, or the Windows firewall, can stop the phone reaching the PC even when it can see it. The firewall rule is in [lan-setup.en.md](lan-setup.en.md).
- Away from home, add the server's `https://` address by hand under Servers → Add.

## What syncs

Everything is kept on the server and every signed-in device follows it within a few seconds:

| Synced | Notes |
|---|---|
| Alerts (price, indicator, script) | live on the server, so they fire even when no device is open; push goes to every paired phone |
| Drawings, chart layouts, tabs | per symbol; a change on one device shows on the others |
| Watchlists, favourites, favourite toolbar | |
| Indicators, indicator and drawing templates, chart templates | |
| Settings (theme, language, chart options) | |
| Journal, notes, scripts, risk settings | |

Stays on each device: panel sizes and positions, the active side panel, the phone/desktop UI mode, search filters, open pop-out windows, the AI server address, which broker is active, tutorial progress.

The Servers page shows "Synced with <server> · last sync <time>". Two devices editing the same item at once: the newer edit wins per item, and nothing is lost silently (see Restore points in the account menu).

## Honest limits

- **Without a server** (Use this device only) the phone has Binance only and its data lives on that phone. Every other exchange and broker needs a server: a PC running the desktop app with Home network access, a Raspberry Pi, or a VPS.
- Pairing and discovery need the phone to reach the server's address (same network, or a public `https://` address).
- A pairing code is a password for five minutes: do not post a photo of the screen.
