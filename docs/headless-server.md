# اجرای سرور روی لپ‌تاپ لینوکسی (بدون مرورگر)

هدف: یک لپ‌تاپ همیشه‌روشن که سرور Chart Terminal را اجرا می‌کند و گوشی (راهنما: [android.md](android.md)) از طریق Wi-Fi خانه به آن وصل می‌شود. نیازها: Node 24 یا جدیدتر، `openssl`، `git`.

## ۱. نصب

```bash
git clone <repo> ~/chart-terminal && cd ~/chart-terminal
npm ci && (cd server && npm ci)
npm run build            # پوشه‌ی dist/ که به گوشی سرو می‌شود
```

## ۲. روشن کردن دسترسی شبکه بدون UI

سرور با `CT_LAN=1` (یا `node index.ts --lan`) خودش HTTPS را روی پورت 8443 باز می‌کند، CA محلی را در صورت نبودن می‌سازد و نشانی‌ها، لینک گواهی و QR را در لاگ چاپ می‌کند. پورت دیگر: `CT_LAN_PORT=9443`. این تنظیم در پایگاه داده ذخیره نمی‌شود؛ هر بار با همین متغیر روشن می‌شود.

اتصال از شبکه فقط از آدرس‌های خصوصی (192.168.x.x، 10.x، 172.16 تا 31) پذیرفته می‌شود و **بدون ورود با رمز هیچ API‌ای باز نیست**.

**رمز اول** را فقط می‌شود روی خود لپ‌تاپ گذاشت (از شبکه رد می‌شود؛ تا آن موقع ورود از LAN هم بسته است). یک بار، روی همان لپ‌تاپ:

```bash
curl -X POST http://127.0.0.1:8787/api/auth/setup -H "content-type: application/json" -d '{"password":"at-least-8-chars"}'
```

یا از کامپیوتر دیگر با `ssh -L 8787:127.0.0.1:8787 user@laptop` و باز کردن `http://127.0.0.1:8787` در مرورگر. (قبل از دستور curl یک space بگذارید تا در تاریخچه‌ی shell نماند.)

چرا «کد یک‌بارمصرف روی شبکه» نداریم؟ هر راه تنظیم رمز از شبکه، حتی با کد چاپ‌شده، یک سطح حمله‌ی اضافه است (کد در لاگ‌ها می‌ماند و روی LAN قابل حدس‌زدن/دزدیدن است). تنظیم رمز از localhost یا SSH فقط یک بار لازم است، پس همان ساده‌ترین و امن‌ترین گزینه است.

## ۳. سرویس systemd کاربری

فایل `~/.config/systemd/user/chart-terminal.service`:

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

مسیر node را با `which node` بررسی کنید (اگر با nvm نصب کرده‌اید مسیر کامل آن را بگذارید).

```bash
systemctl --user daemon-reload
systemctl --user enable --now chart-terminal
sudo loginctl enable-linger $USER      # بعد از ریبوت بدون لاگین هم بالا بیاید
journalctl --user -u chart-terminal -f # لاگ و QR
```

## ۴. فایروال (پورت 8443 فقط برای زیرشبکه‌ی خانه)

زیرشبکه را با `ip -4 addr` ببینید (مثلاً `192.168.1.0/24`).

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

پورت 8787 فقط روی 127.0.0.1 گوش می‌دهد و نباید باز شود. روی مودم هیچ port forward نگذارید.

## ۵. بیدار ماندن با بسته بودن درِ لپ‌تاپ

در `/etc/systemd/logind.conf` (یا یک فایل در `/etc/systemd/logind.conf.d/`):

```ini
HandleLidSwitch=ignore
HandleLidSwitchExternalPower=ignore
HandleLidSwitchDocked=ignore
IdleAction=ignore
```

```bash
sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target
sudo reboot                              # ساده‌ترین راه برای اعمال تنظیمات logind
```

لپ‌تاپ را به شارژر وصل نگه دارید. صرفه‌جویی انرژی Wi-Fi را خاموش کنید (`sudo iw dev wlan0 set power_save off` یا در NetworkManager مقدار `wifi.powersave = 2`) و اگر ممکن است از کابل شبکه استفاده کنید. برای لپ‌تاپ DHCP reservation بگیرید (android.md).

## ۶. به‌روزرسانی

```bash
cd ~/chart-terminal && git pull && npm ci && (cd server && npm ci) && npm run build
systemctl --user restart chart-terminal
```

اپ روی گوشی نسخه‌ی جدید را از سرور می‌گیرد؛ در صورت نیاز یک بار آن را کامل ببندید و باز کنید.

## ۷. پشتیبان‌گیری

همه‌ی داده در `server/data/` است (یا `CT_DATA_DIR`): پایگاه `chart-terminal.db` (رمز، نشست‌ها، هشدارها، تنظیمات) و پوشه‌ی `tls/` (کلید CA). فایل `tls/ca.key` را فقط خودتان داشته باشید؛ اگر پاک شود CA جدید ساخته می‌شود و گوشی‌ها باید گواهی را دوباره نصب کنند.

```bash
systemctl --user stop chart-terminal            # پایگاه در حالت WAL است؛ برای کپی سازگار سرویس را متوقف کنید
tar czf ~/chart-backup-$(date +%F).tgz -C ~/chart-terminal/server data
systemctl --user start chart-terminal
chmod 600 ~/chart-backup-*.tgz
```

بدون توقف سرویس: `sqlite3 server/data/chart-terminal.db ".backup '/path/backup.db'"` و جداگانه `tls/` را کپی کنید. یک نسخه را روی دیسک یا کامپیوتر دیگر هم نگه دارید.
