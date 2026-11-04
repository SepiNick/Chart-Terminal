# راهنمای مستندات

## نصب و اجرا: کدام راه برای من؟

| هدف | راهنما | خلاصه |
|---|---|---|
| ویندوز، نصب‌کننده (Electron، با tray و به‌روزرسانی) | [desktop.md](desktop.md) | `Chart Terminal Setup <نسخه>.exe`؛ ساخت: `cd desktop && npm run dist:win` |
| ویندوز یا لینوکس، بسته‌ی سبک بدون Electron | [lite.md](lite.md) | zip ویندوز با `install.ps1`، tar.gz لینوکس با `install.sh`؛ ساخت: `npm run build:lite` |
| لینوکس، دسکتاپ (AppImage و deb) | [desktop.md](desktop.md) | `npm run dist:linux` در `desktop/` |
| سرور همیشه‌روشن روی لپ‌تاپ لینوکسی | [lite.md](lite.md) (آماده) یا [headless-server.md](headless-server.md) (از سورس) | سرویس systemd، `CT_LAN=1` |
| اندروید، اپ PWA (اعلان Push) | [android.md](android.md) | نصب CA، سپس Install app در Chrome |
| اندروید، APK (دو نسخه: client و standalone) | [android-apk.md](android-apk.md) | client: آدرس سرور؛ standalone: بدون هیچ سرور، فقط روی گوشی |
| آیفون و دسترسی از شبکه‌ی خانه | [lan-setup.md](lan-setup.md) | HTTPS با CA محلی |
| توسعه | [../README.md](../README.md) | `npm install`، `npm run server`، `npm run dev`، `npm test` |

همه‌ی راه‌ها Node.js 24 یا بالاتر برای ساخت/اجرا از سورس می‌خواهند (`node:sqlite`)؛ بسته‌ی ویندوز Node را داخل خودش دارد. Docker و Raspberry Pi هنوز بسته‌ی رسمی ندارند (ROADMAP، مرحله‌ی ۹).

## فهرست همه‌ی فایل‌ها

- [desktop.md](desktop.md): برنامه‌ی Electron (ویندوز، مک، لینوکس)، داده‌ها، tray، ساخت نصبی.
- [lite.md](lite.md): نسخه‌ی سبک بدون Electron، مقایسه‌ی حجم و حافظه، نصب و حذف.
- [headless-server.md](headless-server.md): اجرای سرور از سورس روی لپ‌تاپ لینوکسی، systemd، فایروال، پشتیبان‌گیری.
- [lan-setup.md](lan-setup.md): HTTPS روی شبکه‌ی خانه، نصب گواهی روی اندروید و آیفون، فایروال ویندوز.
- [android.md](android.md): نصب به‌صورت PWA روی اندروید، اعلان‌ها، باتری، IP ثابت.
- [android-apk.md](android-apk.md): اپ APK با دو flavor (client و standalone)، حالت Standalone برنامه، قواعد HTTP/HTTPS، ساخت و امضا.
- [multi-server.md](multi-server.md): ورود با توکن دستگاه و CORS برای کلاینت‌های origin دیگر.
- [performance.md](performance.md): اندازه‌گیری و بهینه‌سازی مصرف CPU/رم سرور.
- [desktop-shell-spec.md](desktop-shell-spec.md): مشخصات رفتاری پوسته‌ی TradingView Desktop (مرجع clean-room).
- [phase5-contracts.md](phase5-contracts.md): قراردادهای فاز ۵ (سرور، SQLite، ورود، هشدار، Push). سند تاریخی.
- [phase6-contracts.md](phase6-contracts.md): قراردادهای فاز ۶ (لایه‌ی بروکر، testnet). سند تاریخی.
- [leftovers-contracts.md](leftovers-contracts.md): قرارداد کارهای باقی‌مانده‌ی فازهای ۲ تا ۱۰. سند تاریخی.
- [research/](research/): تحقیق‌های اولیه (۰۱ تا ۰۷) و [طراحی چندکاربره](research/multiuser-design.md).
