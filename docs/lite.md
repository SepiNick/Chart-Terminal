# نسخه‌ی سبک (Lite) برای ویندوز و لینوکس

نسخه‌ی Lite همان Chart Terminal است، ولی بدون Electron. سرور (Node) در پس‌زمینه اجرا می‌شود و رابط کاربری در پنجره‌ی «app mode» همان مرورگری باز می‌شود که از قبل روی سیستم دارید (Edge یا Chrome در ویندوز؛ chromium، chrome یا edge در لینوکس) با پروفایل جداگانه‌ی خودش. اگر مرورگر Chromium پیدا نشود، `xdg-open` (لینوکس) یا مرورگر پیش‌فرض (ویندوز) استفاده می‌شود.

## تفاوت با نسخه‌ی Electron
| | Electron (`desktop/`) | Lite (`lite/`) |
|---|---|---|
| حجم نصبی | حدود ۱۲۷ MB (installer)، حدود ۴۳۰ MB بعد از نصب | حدود ۴۵ MB zip (ویندوز، با `node.exe`)، حدود ۷ MB tar.gz (لینوکس، بدون Node) |
| بعد از بستن پنجره | یک پوشه‌ی کامل Electron در tray می‌ماند | فقط سرور Node می‌ماند، حدود ۶۵ MB |
| حالت headless / همیشه روشن | ندارد | دارد (`--no-window`، سرویس systemd) |
| کلیک‌کردن روی tray، به‌روزرسانی خودکار، `window.prompt` | دارد | ندارد (جای tray: `--status` و `--stop`) |

## اندازه‌گیری حافظه (ویندوز ۱۱، ۲۰ تا ۲۸ ثانیه بعد از شروع، صفحه‌ی اول برنامه)
جمع Working Set همه‌ی پردازه‌ها (حافظه‌ی مشترک چند بار شمرده می‌شود، پس عدد واقعی کمی کمتر است):

| حالت | پردازه‌ها | Working Set | Private |
|---|---|---|---|
| Electron (`win-unpacked`) | ۵ | حدود ۴۹۷ MB | حدود ۳۲۴ MB |
| Lite: سرور + پنجره‌ی Edge | ۱۱ | حدود ۵۸۱ MB | حدود ۳۸۶ MB |
| Lite: فقط سرور (پنجره بسته) | ۱ | حدود ۶۵ MB | |

نتیجه‌ی صادقانه: **تا وقتی پنجره باز است، Lite از Electron سبک‌تر نیست** (حدود ۱۷٪ بیشتر، چون Edge چند پردازه‌ی کمکی دارد؛ بدون فلگ‌های حذف افزونه و sync عدد حدود ۷۰۰ MB بود). صرفه‌جویی در سه چیز است: حجم دانلود و دیسک (حدود ۱۰ برابر کمتر)، اینکه با بسته‌شدن پنجره مصرف به حدود ۶۵ MB می‌رسد در حالی که هشدارها و forward testها ادامه دارند، و امکان اجرای headless. عددها روی یک دستگاه و یک بار اندازه‌گیری شده‌اند و با نسخه‌ی مرورگر عوض می‌شوند.

## نصب روی ویندوز (بدون نیاز به admin)
۱. فایل `chart-terminal-win-x64-<نسخه>.zip` را در یک پوشه extract کنید (Node داخلش هست، چیزی نصب نمی‌خواهد).
۲. در همان پوشه:
```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```
برای شروع خودکار همراه ویندوز، `-Autostart` اضافه کنید. برنامه در `%LOCALAPPDATA%\Programs\ChartTerminal` کپی می‌شود و در Start Menu آیتم «Chart Terminal» ساخته می‌شود. داده‌ها در `%APPDATA%\ChartTerminal` هستند.

بدون نصب هم می‌شود: داخل پوشه‌ی extract‌شده `chart-terminal.vbs` را (بدون پنجره‌ی کنسول) یا `chart-terminal.cmd` را اجرا کنید.

## نصب روی لینوکس
نیاز: Node.js نسخه‌ی ۲۴ یا بالاتر.
```bash
tar xzf chart-terminal-linux-<نسخه>.tar.gz
cd chart-terminal
sh ./install.sh
```
- اگر Node ندارید: `sh ./install.sh --download-node` (tarball رسمی را از nodejs.org می‌گیرد، checksum را چک می‌کند و داخل پوشه‌ی نصب می‌گذارد؛ به `xz` نیاز دارد).
- نصب سرویس همیشه‌روشن: `sh ./install.sh --service` (یک سرویس `systemd --user`). برای اجرا بدون لاگین: `sudo loginctl enable-linger $USER`.
- مسیرها: برنامه در `~/.local/opt/chart-terminal`، دستور در `~/.local/bin/chart-terminal` (باید در `PATH` باشد)، آیتم منو با آیکون در `~/.local/share/applications`. داده‌ها در `~/.local/share/chart-terminal`.

## استفاده
```
chart-terminal              # سرور را (اگر روشن نیست) بالا می‌آورد و پنجره باز می‌کند
chart-terminal --no-window  # فقط سرور، بدون پنجره (headless)
chart-terminal --status     # آدرس و pid سرور
chart-terminal --stop       # توقف تمیز سرور (recorder معاملات flush می‌شود)
```
اجرای دوباره‌ی برنامه فقط یک پنجره‌ی دیگر روی همان سرور باز می‌کند. پورت در `port.txt` ذخیره می‌شود تا آدرس ثابت بماند و تنظیمات محلی مرورگر (localStorage) از بین نرود. با `CT_DATA_DIR` پوشه‌ی داده را عوض کنید، با `CT_BROWSER` مسیر مرورگر را. سرور فقط روی `127.0.0.1` گوش می‌دهد؛ برای دسترسی از شبکه‌ی داخلی به `docs/lan-setup.md` نگاه کنید.

## Headless
روی سرور یا لپ‌تاپ بدون صفحه: `chart-terminal --no-window` یا سرویس systemd بالا. برای دسترسی گوشی از شبکه‌ی خانه (HTTPS، رمز اول، فایروال): [headless-server.md](headless-server.md) و [android.md](android.md). برای دسترسی از همین کامپیوتر بعد از یک پورت‌فوروارد SSH (`ssh -L 8787:127.0.0.1:<port> ...`، پورت را با `--status` ببینید) از مرورگر خودتان باز کنید.

## به‌روزرسانی
نسخه‌ی جدید را extract کنید و دوباره `install.ps1` یا `install.sh` را اجرا کنید. سرور در حال اجرا اول متوقف می‌شود، فایل‌های برنامه جایگزین می‌شوند و داده‌ها دست نمی‌خورند. (به‌روزرسانی خودکار ندارد.)

## حذف
- ویندوز: `powershell -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\Programs\ChartTerminal\uninstall.ps1"`
- لینوکس: `sh ~/.local/opt/chart-terminal/uninstall.sh`

داده‌ی کاربر (رمز، چیدمان‌ها، ژورنال، هشدارها) عمداً پاک نمی‌شود. برای پاک‌کردن کامل، پوشه‌ی داده را خودتان حذف کنید.

## ساختن از سورس
پیش‌نیاز: Node 24+ و `npm ci` در ریشه و در `desktop/` (بسته‌های سرور از `desktop/node_modules` برداشته می‌شوند).
```bash
npm run build:lite            # خروجی: dist-lite/chart-terminal + zip ویندوز + tar.gz لینوکس
node lite/build.mjs --reuse-dist   # بدون ساخت دوباره‌ی UI
```
ویندوز: `node.exe` همان Node‌ای است که ساخت را اجرا کرده. چون tar.gz روی ویندوز ساخته می‌شود، بیت اجرایی فایل‌ها حفظ نمی‌شود؛ برای همین دستورها با `sh ./install.sh` اجرا می‌شوند.
