[English](lan-setup.en.md) · [فارسی](lan-setup.md)

# Access from a phone on the home network (HTTPS, notifications and installing the app)

With this guide you can open Chart Terminal on a phone (Android or iPhone) over the home Wi-Fi, get Push notifications and install it on the home screen like an app.

Why HTTPS? Browsers only enable Push notifications and Service Workers on a secure connection. So the server creates a "local certificate authority" (Local CA) just for this computer. You only need to install this certificate on the phone once so the phone trusts the server. This certificate is created only on your computer and is not sent anywhere else.

## 1. Turning on access from the home network

1. Run the server (`npm run server`) and open the app on **this same computer**.
2. In the "Server & notifications" settings turn on **Home network access**. This is only possible from this computer itself.
3. Addresses like `https://192.168.1.20:8443` are shown. You will open this address on the phone.

So that the phone sees the built app, run `npm run build` once (the server serves the `dist/` folder).

If the computer's IP address changes (for example the router gives a new IP), the server rebuilds the certificate itself. The CA does not change, so you do not need to install the certificate on the phone again. It is best to set a fixed IP (DHCP reservation) for this computer in the router settings so the address always stays the same.

> **Without a browser / Android:** run the server with `CT_LAN=1` (or `node index.ts --lan`) to turn on network access without a UI (the first password still only from the computer itself). For an always-on Linux laptop: [headless-server.en.md](headless-server.en.md). The full Android steps and installing as an app: [android.en.md](android.en.md).

## 2. Opening the port in the Windows firewall

Open PowerShell **as Administrator** and run this command. The rule is only for Private networks (the home network), not public ones:

```powershell
New-NetFirewallRule -DisplayName "Chart Terminal HTTPS (LAN)" -Direction Inbound -Protocol TCP -LocalPort 8443 -Action Allow -Profile Private
```

Make sure the home Wi-Fi network is set to **Private** in Windows (Settings → Network & internet → Wi-Fi → the network name → Network profile type → Private).

To remove the rule in future:

```powershell
Remove-NetFirewallRule -DisplayName "Chart Terminal HTTPS (LAN)"
```

## 3. Android

1. Connect the phone to the same Wi-Fi and open `https://<IP>:8443/ca.crt` in Chrome so the certificate file downloads. (If Chrome gives a security warning, that is normal because the certificate is not installed yet; choose Advanced and continue.)
2. Go to **Settings → Security → Encryption & credentials → Install a certificate → CA certificate**, confirm the warning and choose the file `chart-terminal-ca.crt`. Menu names differ a little between phones; if needed search Settings for "CA certificate".
3. Close Chrome completely and open `https://<IP>:8443` again. Now a healthy lock should show.
4. Sign in and in the settings turn on notifications (Push) for this device and press **Allow** when Chrome asks permission.
5. (Optional) From the ⋮ menu choose **Add to Home screen** or **Install app** so the app opens like a separate app.

## 4. iPhone (iOS 16.4 or newer)

1. Connect the phone to the same Wi-Fi and in **Safari** open `https://<IP>:8443/ca.mobileconfig` and confirm the profile download.
2. Go to **Settings**; "Profile Downloaded" shows at the top. Open it and press **Install** (it asks for the phone's passcode).
3. Now turn on full trust: **Settings → General → About → Certificate Trust Settings** and turn on the switch next to "Chart Terminal Local CA". Without this step Safari does not trust the server.
4. In Safari open `https://<IP>:8443` and sign in.
5. Press the **Share** button and choose **Add to Home Screen**.
6. Open the app **from the icon on the home screen** (not from Safari), sign in again, turn on notifications in the settings and press **Allow** when it asks.

Important note: on iPhone, Push notifications only work from an app installed on the home screen. In a normal Safari tab the notification option is not available.

## Troubleshooting

- **The phone does not open the page:** make sure both devices are on the same Wi-Fi, the firewall rule was added and the network is Private. A VPN on the phone may block access to the local network; if the page does not open, turn the phone's VPN off once or turn on its "Allow LAN" option.
- **A certificate error after installing:** on Android close Chrome completely; on iPhone re-check the Certificate Trust Settings step. If you deleted the `server/data/tls` folder, a fresh CA was created and must be installed again.
- **openssl not found:** the server looks for openssl in this order: the `CT_OPENSSL` environment variable, then PATH, then the copy that comes with Git for Windows. If none exists, install Git for Windows or put the full path of `openssl.exe` in `CT_OPENSSL`.
- **Certificate fingerprint:** in the settings the SHA-256 fingerprint of the CA certificate is shown. If you want to be sure you installed the right certificate, compare it with the certificate's details on the phone.
