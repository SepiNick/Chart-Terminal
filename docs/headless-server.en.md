[English](headless-server.en.md) · [فارسی](headless-server.md)

# Running the server on a Linux laptop (no browser)

Goal: an always-on laptop that runs the Chart Terminal server, with the phone (guide: [android.en.md](android.en.md)) connecting to it over the home Wi-Fi. Needs: Node 24 or newer, `openssl`, `git`.

> If you only want a simple always-on server on Linux and do not need to build from source, the prebuilt [lite.en.md](lite.en.md) package (`install.sh --service`) is faster. This guide is for running directly from source and setting up HTTPS/LAN.

## 1. Install

```bash
git clone <repo> ~/chart-terminal && cd ~/chart-terminal
npm ci && (cd server && npm ci)
npm run build            # the dist/ folder that is served to the phone
```

## 2. Turning on network access without a UI

With `CT_LAN=1` (or `node index.ts --lan`) the server opens HTTPS on port 8443 itself, creates the local CA if it is missing, and prints the addresses, the certificate link and a QR in the log. Another port: `CT_LAN_PORT=9443`. This setting is not saved in the database; it is turned on with this variable every time.

Connections from the network are only accepted from private addresses (192.168.x.x, 10.x, 172.16 to 31) and **no API is open without signing in with a password**.

The **first password** can only be set on the laptop itself (it is refused from the network; until then LAN sign-in is closed too). Once, on that laptop:

```bash
curl -X POST http://127.0.0.1:8787/api/auth/setup -H "content-type: application/json" -d '{"password":"at-least-8-chars"}'
```

Or from another computer with `ssh -L 8787:127.0.0.1:8787 user@laptop` and opening `http://127.0.0.1:8787` in the browser. (Put a space before the curl command so it does not stay in the shell history.)

Why is there no "one-time code over the network"? Every way of setting the password from the network, even with a printed code, is an extra attack surface (the code stays in logs and can be guessed/stolen on a LAN). Setting the password from localhost or SSH is only needed once, so it is the simplest and safest option.

## 3. A user systemd service

The file `~/.config/systemd/user/chart-terminal.service`:

```ini
[Unit]
Description=Chart Terminal server
After=network-online.target
Wants=network-online.target

[Service]
WorkingDirectory=%h/chart-terminal/server
Environment=CT_LAN=1
# Environment=CT_DATA_DIR=%h/chart-data
ExecStart=/usr/bin/node index.ts
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

Check the node path with `which node` (if you installed it with nvm, put its full path).

```bash
systemctl --user daemon-reload
systemctl --user enable --now chart-terminal
sudo loginctl enable-linger $USER      # also come up after a reboot without logging in
journalctl --user -u chart-terminal -f # log and QR
```

## 4. Firewall (port 8443 only for the home subnet)

See the subnet with `ip -4 addr` (e.g. `192.168.1.0/24`).

**ufw:**
```bash
sudo ufw allow from 192.168.1.0/24 to any port 8443 proto tcp
sudo ufw status
```

**firewalld:**
```bash
sudo firewall-cmd --permanent --add-rich-rule='rule family="ipv4" source address="192.168.1.0/24" port port="8443" protocol="tcp" accept'
sudo firewall-cmd --reload
```

Port 8787 only listens on 127.0.0.1 and must not be opened. Do not set any port forward on the router.

## 5. Staying awake with the lid closed

In `/etc/systemd/logind.conf` (or a file in `/etc/systemd/logind.conf.d/`):

```ini
HandleLidSwitch=ignore
HandleLidSwitchExternalPower=ignore
HandleLidSwitchDocked=ignore
IdleAction=ignore
```

```bash
sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target
sudo reboot                              # the simplest way to apply the logind settings
```

Keep the laptop plugged in. Turn off Wi-Fi power saving (`sudo iw dev wlan0 set power_save off`, or in NetworkManager `wifi.powersave = 2`) and use a network cable if you can. Get a DHCP reservation for the laptop (android.en.md).

## 6. Updating

```bash
cd ~/chart-terminal && git pull && npm ci && (cd server && npm ci) && npm run build
systemctl --user restart chart-terminal
```

The app on the phone gets the new version from the server; if needed close it completely and open it again once.

## 7. Backups

All data is in `server/data/` (or `CT_DATA_DIR`): the database `chart-terminal.db` (password, sessions, alerts, settings) and the `tls/` folder (the CA key). Keep the file `tls/ca.key` to yourself; if it is deleted a new CA is created and the phones must install the certificate again.

```bash
systemctl --user stop chart-terminal            # the database is in WAL mode; stop the service for a consistent copy
tar czf ~/chart-backup-$(date +%F).tgz -C ~/chart-terminal/server data
systemctl --user start chart-terminal
chmod 600 ~/chart-backup-*.tgz
```

Without stopping the service: `sqlite3 server/data/chart-terminal.db ".backup '/path/backup.db'"` and copy `tls/` separately. Keep one copy on another disk or computer too.
