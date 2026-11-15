[English](raspberry-pi.en.md) · [فارسی](raspberry-pi.md)

# A personal server on a Raspberry Pi + Telegram bot

The private server (the same `docker-compose.yml`) runs on the Pi and is only reachable from the home network. Alerts, trade recording and the Telegram bot stay on all the time, even when your computer is off.

## 1. Installing on the Pi

Prerequisite: a Pi with Raspberry Pi OS (64-bit), connected to the home network with SSH on (`sudo raspi-config` → Interface Options → SSH). It is best to give the Pi a fixed IP in the router (a DHCP reservation).

From the project folder on your computer (Git Bash or WSL):

```bash
scripts/deploy-pi.sh pi@192.168.1.50
```

(Replace the address with the Pi's address.) The script copies the source, installs Docker if it is missing, and builds and starts the server. The first build on the Pi takes a few minutes. To update, run the same command again; the data (volume) stays.

The first password can only be set from the Pi itself (the server refuses it over the network). The command below asks you for the password (at least 8 characters) and registers it on the Pi itself:

```bash
ssh -t pi@192.168.1.50 'read -rsp "New password: " p; echo; curl -s -X POST http://127.0.0.1:8787/api/auth/setup -H "content-type: application/json" -d "{\"password\":\"$p\"}"'
```

The answer `{"ok":true}` means the password was set.

## 2. Adding the server to the apps

The server's address on the home network: `https://<Pi IP>:8443`. Install the certificate once so the browser and WebView do not warn: `https://<Pi IP>:8443/ca.crt` (iPhone: `/ca.mobileconfig`); details in [lan-setup.en.md](lan-setup.en.md) and [android-apk.en.md](android-apk.en.md).

- **Android:** install the *client* APK and type the address on the first page. (The standalone version has no server; for a server it must be *client*.)
- **Windows (desktop app):** in the standalone app's bottom bar click "Connect to a server" and give the address; sign in with the password you set.
- **Browser / iPhone:** open the address directly and press "Add to Home Screen".

## 3. The Telegram bot

The bot is for two things: alert notifications and **signing in with a Telegram account**.

1. In Telegram create a bot with @BotFather (`/newbot`) and keep the token.
2. In the app (connected to the Pi server): "Server & notifications" → the Telegram section → paste the token and press Save.
3. Send your bot a message in Telegram, then in the same section press "Pick chat" and choose your personal chat.
4. Press "Send test"; the test message should arrive.

**Sign in with Telegram:** after these steps, a "Sign in with Telegram" button appears on the sign-in page: the `t.me` link opens, press Start, and press Approve only if the bot shows the same 4-digit code as the page. Only the Telegram account that is the notification chat can sign in. It needs no domain or public HTTPS.

> **The Pi's internet:** the Pi must reach `api.telegram.org` and, for Binance data, `binance.com`. In Iran these are usually not open without a VPN; so the Pi needs a VPN or a proxy too (for example a VPN client on the Pi itself or on the router). Without it, the bot and live data do not work.

## 4. Official Telegram sign-in (multi-user accounts)

The account-based "Continue with Telegram" button (OpenID Connect, like Google) needs a **public server with a real domain and valid HTTPS**, registered in BotFather. It does not work on the home network's IP address. Set-up: [telegram-login-setup.en.md](telegram-login-setup.en.md); the public server: [docker.en.md](docker.en.md).

## Maintenance

```bash
ssh pi@192.168.1.50 'cd ~/chart-terminal && sudo docker compose logs -f app'      # log
ssh pi@192.168.1.50 'cd ~/chart-terminal && sudo docker compose restart app'      # restart
```

Data backup: the `docker run --rm -v chart-terminal-data:/d ...` command in [docker.en.md](docker.en.md).
