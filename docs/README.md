[English](README.en.md) · [فارسی](README.md)

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

همه‌ی راه‌ها Node.js 24 یا بالاتر برای ساخت/اجرا از سورس می‌خواهند (`node:sqlite`)؛ بسته‌ی ویندوز Node را داخل خودش دارد. Docker و Raspberry Pi: فایل‌های Docker نوشته شده‌اند و روی یک رزبری پای واقعی اجرا شده‌اند ([raspberry-pi.md](raspberry-pi.md)).

## ورود با حساب (SSO)

دکمه‌های «Continue with Google / Apple / Telegram» فقط روی **سرور عمومی** هستند و مالک سرور هر کدام را با متغیرهای محیطی روشن می‌کند: [oauth-setup.md](oauth-setup.md) (Google و Apple) و [telegram-login-setup.md](telegram-login-setup.md) (تلگرام). سرور خصوصی یک رمز دارد (و اختیاری تأیید با ربات تلگرام)؛ برنامه‌ی standalone حساب ندارد.

## فهرست همه‌ی فایل‌ها

- [desktop.md](desktop.md): برنامه‌ی Electron (ویندوز، مک، لینوکس)، داده‌ها، tray، ساخت نصبی.
- [lite.md](lite.md): نسخه‌ی سبک بدون Electron، مقایسه‌ی حجم و حافظه، نصب و حذف.
- [headless-server.md](headless-server.md): اجرای سرور از سورس روی لپ‌تاپ لینوکسی، systemd، فایروال، پشتیبان‌گیری.
- [bug-report.md](bug-report.md): گزارش باگ داخل برنامه (توضیح، عکس، اطلاعات تشخیصی)، لاگ خودکار کرش و مقصد آن.
- [raspberry-pi.md](raspberry-pi.md): سرور شخصی روی رزبری پای با یک دستور، اضافه کردن به برنامه‌ها و ربات تلگرام (اعلان و ورود با تلگرام).
- [docker.md](docker.md): اجرا با Docker روی رزبری پای، لینوکس یا VPS (سرور خصوصی و عمومی با Caddy؛ ساخته‌نشده و تست‌نشده)
- [lan-setup.md](lan-setup.md): HTTPS روی شبکه‌ی خانه، نصب گواهی روی اندروید و آیفون، فایروال ویندوز.
- [android.md](android.md): نصب به‌صورت PWA روی اندروید، اعلان‌ها، باتری، IP ثابت.
- [android-apk.md](android-apk.md): اپ APK با دو flavor (client و standalone)، حالت Standalone برنامه، قواعد HTTP/HTTPS، ساخت و امضا.
- [competitor-gaps.md](competitor-gaps.md): مقایسه با رقبا و شکاف‌ها.
- [dominance.md](dominance.md): دامیننس و سهم بازار.
- [iran-market.md](iran-market.md): بازار ایران (نوبیتکس، tgju، بورس).
- [oauth-setup.md](oauth-setup.md): راه‌اندازی ورود با Google و Apple (سرور عمومی).
- [telegram-login-setup.md](telegram-login-setup.md): راه‌اندازی ورود با تلگرام (سرور عمومی).
- [phase7-plan.md](phase7-plan.md): طرح فاز ۷.
- [multi-server.md](multi-server.md): ورود با توکن دستگاه و CORS برای کلاینت‌های origin دیگر.
- [python.md](python.md): تب Python؛ اجرای کد پایتون خودتان روی داده‌ی نمودار (قرارداد، نمونه‌ها، نصب pandas، مدل امنیتی و محدودیت‌ها).
- [performance.md](performance.md): اندازه‌گیری و بهینه‌سازی مصرف CPU/رم سرور.
- [desktop-shell-spec.md](desktop-shell-spec.md): مشخصات رفتاری پوسته‌ی TradingView Desktop (مرجع clean-room).
- [phase5-contracts.md](phase5-contracts.md): قراردادهای فاز ۵ (سرور، SQLite، ورود، هشدار، Push). سند تاریخی.
- [phase6-contracts.md](phase6-contracts.md): قراردادهای فاز ۶ (لایه‌ی بروکر، testnet). سند تاریخی.
- [leftovers-contracts.md](leftovers-contracts.md): قرارداد کارهای باقی‌مانده‌ی فازهای ۲ تا ۱۰. سند تاریخی.
- [research/](research/): تحقیق‌های اولیه (۰۱ تا ۰۷) و [طراحی چندکاربره](research/multiuser-design.md).
