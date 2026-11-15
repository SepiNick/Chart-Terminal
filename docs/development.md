[English](development.en.md) · [فارسی](development.md)

# راهنمای توسعه (نقشه‌ی کد)

```bash
npm install && npm --prefix server install
npm run server      # سرور داده روی 127.0.0.1:8787 (برای صرافی‌های دیگر و فارکس)
npm run dev         # http://localhost:5173
npm test            # تست‌های برنامه (Pine، MQL، NinjaScript، تستر، ژورنال، همگام‌سازی و غیره)
npm --prefix server test   # تست‌های سرور
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
| `src/symsearch.ts`, `src/searchall.ts` | جستجوی نماد در همه‌ی صرافی‌ها (رتبه‌بندی، بارگذاری) |
| `src/pine/` | مفسر Pine Script، کتابخانه‌ی توابع، شبیه‌ساز استراتژی، Pine Editor |
| `src/mql/`, `src/ninja/` | کامپایلر و اجراکننده‌ی MQL4/MQL5 و NinjaScript |
| `src/social/` | پنل Community (فید و چت) |
| `server/` | سرور داده: CCXT (۱۰۳ صرافی کریپتو) و FX (فارکس، فلزات، انرژی، شاخص‌ها و سهام از Yahoo) |
| `server/iran/` | بازار ایران: نوبیتکس، tgju (دلار، طلا، سکه)، بورس و اوراق (TSETMC). راهنما: `docs/iran-market.md`؛ بررسی زنده: `npm run check:ir` |
| `server/oauth.ts`, `server/core/oidc.ts` | ورود با Google، Apple و تلگرام (OpenID Connect) |
| `server/social.ts` | API جامعه و چت زنده |
| `bugreport-worker/` | Cloudflare Worker که گزارش باگ و کرش را می‌گیرد |
| `desktop/`, `android/`, `lite/` | پوسته‌ی Electron، برنامه‌ی اندروید، بسته‌ی سبک |
| `src/jalali.ts`, `src/i18n.ts` | تقویم شمسی و رابط فارسی راست‌به‌چپ |

میانبرهای کامل: دکمه‌ی ⌨ یا `Ctrl+/` داخل برنامه. مهم‌ترین‌ها: `Alt+T` خط روند · `Alt+H` خط افقی · `Alt+J` شعاع افقی · `Alt+V` خط عمودی · `Alt+F` فیبوناچی · `Alt+Shift+R` مستطیل · `Shift+کلیک` اندازه‌گیری · `Alt+A` هشدار · `Delete` حذف رسم انتخاب‌شده · `Esc` بازگشت به Cursor · دوبار کلیک روی متن برای ویرایش.
