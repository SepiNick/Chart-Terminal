# Chart Terminal

نسخه‌ای از TradingView که از صفر ساخته شده. نقشه‌ی راه و یافته‌های بررسی برنامه در [ROADMAP.md](ROADMAP.md) آمده است. نصب و اجرا روی ویندوز، لینوکس، اندروید و سرور: [docs/README.md](docs/README.md).

```bash
npm install && npm --prefix server install
npm run server  # سرور داده روی 127.0.0.1:8787 (برای صرافی‌های دیگر و فارکس لازم است)
npm run dev     # http://localhost:5173
npm test        # تست‌های موتور معامله
npm run build
npm run check:ir    # بررسی زنده‌ی منبع‌های ایرانی (نوبیتکس، tgju، بورس)
npm run bench       # زمان و حافظه‌ی مسیرهای سنگین
npm run audit:html  # رشته‌های escape‌نشده در قالب‌های HTML
```

| فایل | کار |
|---|---|
| `src/main.ts` | چیدمان‌ها، نوارابزارها، پنل‌ها، پنجره‌ها، میانبرها، هشدار، معامله |
| `src/chart.ts` | یک نمودار (`ChartPane`): داده، تنظیمات، legend، خطوط مقیاس، Replay، Data window |
| `src/drawings.ts` | موتور رسم (ساخت، انتخاب، drag، hit-test، Magnet، زوم، اندازه‌گیری) |
| `src/tools/*.ts` | ۹۲ ابزار رسم؛ قرارداد ابزارها در `tools/types.ts` |
| `src/drawui.ts` | نوار ابزار چپ، نوار شناور، پنجره‌ی ویژگی‌ها، قالب‌ها |
| `src/charttypes.ts`, `charttransforms.ts` | ۱۸ نوع نمودار |
| `src/settings.ts` | مدل و فرم تنظیمات نمودار |
| `src/history.ts` | Undo/Redo |
| `src/symmath.ts` | ریاضی روی نمادها (پارسر امن) |
| `src/trading.ts` | موتور معامله‌ی تمرینی |
| `src/data.ts` | داده‌ی Binance (مستقیم)، نمادهای سرور (`BYBIT:BTC_USDT.P`، `FX:EURUSD`)، تایم‌فریم‌های سفارشی |
| `src/pine/` | مفسر Pine Script، کتابخانه‌ی توابع، شبیه‌ساز استراتژی، Pine Editor |
| `server/` | سرور داده: CCXT (۱۰۳ صرافی کریپتو) و FX (فارکس، فلزات، انرژی، شاخص‌ها و سهام از Yahoo) |
| `server/iran/` | بازار ایران: نوبیتکس، tgju (دلار، طلا، سکه)، بورس و اوراق (TSETMC). راهنما: `docs/iran-market.md`؛ بررسی زنده: `npm run check:ir` |
| `src/jalali.ts`, `src/i18n.ts` | تقویم شمسی و رابط فارسی راست‌به‌چپ |

میانبرهای کامل: دکمه‌ی ⌨ یا `Ctrl+/` داخل برنامه.

## میانبرها

`Alt+T` خط روند · `Alt+H` خط افقی · `Alt+J` شعاع افقی · `Alt+V` خط عمودی · `Alt+F` فیبوناچی · `Alt+Shift+R` مستطیل · `Shift+کلیک` اندازه‌گیری · `Alt+A` هشدار · `Delete` حذف رسم انتخاب‌شده · `Esc` بازگشت به Cursor · دوبار کلیک روی متن برای ویرایش
