# ATAS در برابر NinjaTrader، MetaTrader 5 و Chart Terminal

تاریخ بررسی: 2026-10-17. منبع‌ها پایین صفحه آمده‌اند. بیشتر منبع‌های ATAS سایت خود سازنده یا وبلاگ‌های وابسته‌اند، پس عددهای تبلیغاتی (مثل «۴۰۰ نوع footprint») را تقریبی بدانید. مواردی که خودم تأیید نکرده‌ام با (؟) علامت خورده‌اند.

## ATAS در یک نگاه

ATAS یک پلتفرم تخصصی **order flow** است، یعنی دیدن اینکه در هر سطح قیمت چه حجمی و از کدام طرف (خریدار یا فروشنده) معامله شده. هدفش تحلیل آن چیزی است که پشت هر کندل اتفاق افتاده. نمودار معمولی، اندیکاتور کلاسیک یا اسکریپت‌نویسی ساده تمرکز اصلی‌اش نیست.

- **سیستم‌عامل:** فقط ویندوز. نسخه‌ی جدید ATAS X برای ویندوز و macOS در بتا است. نسخه‌ی موبایل و وب ندارد.
- **قیمت:** Start رایگان است (۲ نماد، ۳ اندیکاتور، داده‌ی فیوچرز با ۱۵ دقیقه تأخیر). Plus ماهی ۲۴٫۹۵ یورو، Pro ماهی ۶۹٫۹۵ یورو و Ultra ماهی ۸۹٫۹۵ یورو است. لایسنس دائمی از ۹۹۹ تا ۱۹۹۹ یورو. داده‌ی لحظه‌ای فیوچرز و سهام جدا پول می‌خواهد، ولی داده‌ی کریپتو رایگان است.
- **اتصال‌ها:** Rithmic، CQG، dxFeed، IQFeed، Interactive Brokers، و خود NinjaTrader به‌عنوان بروکر. در کریپتو به Binance، Bybit، OKX، Kraken و Bitget وصل می‌شود. چند prop firm هم پشتیبانی می‌کند.
- **ضعف‌ها:** یادگیری سخت (حداقل یک ماه)، مصرف زیاد حافظه، گزارش هنگ کردن در معامله‌ی زنده، و رابط کاربری قدیمی و شلوغ. برای فارکس اسپات و CFD ساخته نشده.

## قابلیت‌های ATAS

| حوزه | قابلیت‌ها |
|---|---|
| Footprint و cluster | انواع footprint (Volume، Trades، Bid × Ask، Delta، Heatmap)، Cluster Statistics، Cluster Search، Stacked Imbalance، Absorption، Exhaustion، و ATAS Magnifier |
| تایم‌فریم‌ها | Renko، Range، Reversal، XV، Z، US، و تایم‌فریم OrderFlow |
| Tape | Smart Tape (چسباندن دوباره‌ی معاملات تکه‌شده به سفارش اصلی، و فیلتر حجم)، Speed of Tape، Big Trades و Adaptive Big Trades، Tape Patterns، و Bid/Ask Tape |
| DOM و نقدینگی | Smart DOM (ستون‌های footprint و تشخیص spoofing)، MBO DOM، DOM Levels، Heatmap و Rolling Heatmap، DOM Power، و ویجت DOM Pressure |
| Profile | Volume Profile، TPO و Market Profile (ثابت، anchored، ZigZag، جلسه‌ای) |
| Delta | Delta با واگرایی، CVD، CVD Pro / Market Power (چندنمادی)، و ویجت Delta Divergence |
| معامله | Chart Trader، سفارش از روی DOM و نمودار، و Exit Strategy (حد سود و ضرر، breakeven و trailing، و **خروج چندمرحله‌ای**). Following Manager برای کپی معامله بین حساب‌ها |
| تمرین | Market Replay (بازپخش تیک‌به‌تیک تاریخچه)، ATAS Sim، Crypto Sim، و ATAS Challenge |
| ژورنال | **Trading Journal:** آمار، تقویم معاملاتی با یادداشت روزانه، جدول معاملات با کامنت، Playbook (برچسب برای setupها)، تب‌های Orders و Executions، و خروجی. MAE/MFE ندارد و درخواستش در صف است |
| توسعه | API در C# (دسترسی به محتوای cluster و profile)، و Marketplace |

## مقایسه‌ی سه پلتفرم با ما

✅ دارد · 🟡 بخشی یا با افزونه‌ی پولی · ❌ ندارد

| قابلیت | ATAS | NinjaTrader 8 | MetaTrader 5 | Chart Terminal (ما) |
|---|---|---|---|---|
| تمرکز اصلی | order flow | فیوچرز و اتوماسیون | فارکس، CFD، اکسپرت | نمودار به سبک TradingView، همه‌ی بازارها |
| Footprint و cluster | ✅ بسیار کامل | 🟡 Volumetric Bars با لایسنس Order Flow+ | ❌ | ❌ فاز ۸ |
| DOM و heatmap نقدینگی | ✅ Smart DOM، Heatmap | ✅ SuperDOM، 🟡 Market Depth Map | 🟡 DOM ساده | ❌ فاز ۶ و ۸ |
| Tape و Big Trades | ✅ | 🟡 Time & Sales، Trade Detector (؟) | 🟡 Time & Sales | ❌ |
| CVD و delta | ✅ | 🟡 Order Flow+ | ❌ | ❌ فاز ۸ |
| Volume profile و TPO | ✅ | 🟡 | ❌ (فقط اندیکاتورهای Market) | 🟡 Fixed Range VP به‌عنوان ابزار رسم |
| زبان اسکریپت | C# API | NinjaScript (C#) | MQL5 | ✅ Pine، MQL4/5 و NinjaScript، هر سه بدون نصب |
| بک‌تست و بهینه‌سازی | ❌ (؟) | ✅ Strategy Analyzer، ژنتیک، walk-forward، Monte Carlo | ✅ تستر چندنمادی، ژنتیک، بهینه‌سازی ابری، forward | ✅ فاز ۴ (۵۳ معیار، ژنتیک، WFA، Monte Carlo، پورتفو، بدون کد) |
| Replay | ✅ تیک‌به‌تیک | ✅ Market Replay تیکی | 🟡 فقط تستر بصری | 🟡 Bar Replay (کندلی) |
| خروج چندمرحله‌ای و breakeven | ✅ Exit Strategy | ✅ ATM Strategy | 🟡 با اکسپرت | ❌ (فقط TP/SL و OCO) |
| کپی معامله | ✅ Following Manager | 🟡 افزونه | ✅ Signals | ❌ عمداً کنار گذاشته شد |
| ژورنال معاملاتی | ✅ ساده (آمار، تقویم، playbook) | 🟡 Trade Performance، بدون دلیل و احساس | 🟡 فقط تاریخچه و گزارش | ⏳ **همین الان ساخته می‌شود** |
| کریپتو | ✅ ۵ صرافی | 🟡 محدود | 🟡 بسته به بروکر | ✅ بیش از ۱۰۰ صرافی با CCXT |
| بازار ایران و فارسی | ❌ | ❌ | 🟡 بروکرهای ایرانی MT5 | ⏳ فاز ۷ |
| سیستم‌عامل | ویندوز (macOS در بتا) | ویندوز | ویندوز، مک، موبایل، وب | ✅ مرورگر |
| قیمت | ۰ تا ۹۰ یورو در ماه | ۰، ۹۹ دلار در ماه، یا ۱۴۹۹ دلار دائمی | رایگان (هزینه با بروکر) | رایگان و محلی |

## فرق‌های اصلی NinjaTrader و MetaTrader با ATAS

- **NinjaTrader:**
  - **قوت‌ها:** استاندارد فیوچرز آمریکا. **ATM Strategy** (مدیریت خودکار خروج)، SuperDOM، Market Replay تیکی، و Strategy Analyzer کامل با بهینه‌سازی، walk-forward و Monte Carlo. اکوسیستم افزونه‌ها هم بزرگ است.
  - **ضعف‌ها:** ابزارهای order flow فقط با لایسنس Order Flow+ یا افزونه‌های پولی می‌آیند. ژورنالش در حد گزارش Trade Performance است.
- **MetaTrader 5:**
  - **قوت‌ها:** رایگان است و همه‌ی بروکرهای فارکس و CFD از آن پشتیبانی می‌کنند. اکسپرت‌های MQL5 دارد، و تستر چندنمادی با شبیه‌سازی تیک واقعی و بهینه‌سازی ابری (MQL5 Cloud Network). Market، Signals و نسخه‌های موبایل و وب هم دارد.
  - **ضعف‌ها:** در order flow تقریباً هیچ ابزاری ندارد، و DOM و Time & Sales ساده‌اند.
- **ATAS:** در order flow از هر دو جلوتر است. ولی در بک‌تست و خودکارسازی استراتژی ضعیف است.

## چه چیزهایی ATAS دارد که ما نداریم (اولویت‌بندی‌شده)

| # | قابلیت | ارزش برای ما | فاز پیشنهادی | لازمه |
|---|---|---|---|---|
| 1 | **ژورنال معاملاتی** با آمار، تقویم، playbook و یادداشت روزانه | بسیار زیاد. نسخه‌ی ما فراتر می‌رود: دلیل ورود و خروج، احساس، اشتباه‌ها، R-multiple و MAE/MFE (که ATAS ندارد) | **الان** | — |
| 2 | **Exit Strategy چندمرحله‌ای:** چند TP، breakeven خودکار و trailing | زیاد، و ساده است | ۶ | فقط کد سمت ما |
| 3 | **Footprint، Delta، CVD و Stacked Imbalance** | زیاد برای کریپتو، چون داده‌ی معاملات صرافی‌ها رایگان است | ۸ | stream معاملات (aggTrades) از سرور داده |
| 4 | **Big Trades و Smart Tape:** فیلتر و چسباندن معاملات بزرگ | زیاد | ۸ | همان stream معاملات |
| 5 | **Heatmap دفتر سفارش و DOM Levels** | متوسط تا زیاد | ۸ | stream عمق بازار و ذخیره‌ی snapshot |
| 6 | **Market Replay تیکی** | متوسط. داده‌ی تیکی ذخیره‌شده لازم دارد | ۸ | ذخیره‌ی معاملات روی سرور محلی (فاز ۵) |
| 7 | **TPO و Session Volume Profile** به‌عنوان اندیکاتور | متوسط | ۸ | فقط کندل‌های کوچک‌تر |
| 8 | تایم‌فریم‌های Reversal و Delta-based | کم | ۸ | stream معاملات |
| 9 | Cluster Search: پیدا کردن خودکار clusterهای غیرعادی | متوسط | ۸ (بعد از footprint) | — |
| 10 | Following Manager (کپی معامله) | — | کنار گذاشته شد (ریسک حقوقی) | — |

**جمع‌بندی:** جای خالی اصلی ما order flow است (ردیف‌های ۳ تا ۹). همه‌شان در فاز ۸ جا دارند و برای کریپتو بدون هزینه‌ی داده شدنی‌اند. در بک‌تست، چند زبان اسکریپت، پوشش صرافی‌ها و اجرا در مرورگر، ما از ATAS جلوتریم.

## منابع
- [ATAS — Main advantages](https://atas.net/blog/main-advantages-of-the-atas-platform/)
- [ATAS — Trading Journal (help center)](https://help.atas.net/en/support/solutions/articles/72000660488-trading-journal-trading-statistics-)
- [ATAS — Exit strategies (Quick Start)](https://start.atas.net/step-3.-start-trading-with-atas/exit-strategies)
- [ATAS — Exchanges and brokers](https://atas.net/features/exchanges-connections/)
- [ATAS feature request: MAE/MFE in trade statistics](https://feedback.atas.net/p/feature-request-inclusion-of-mae-and-mfe-metrics-in-trade)
- [Complete Trader's Edge — ATAS review 2026](https://completetradersedge.com/atas-review/)
- [TPTE — NinjaTrader vs ATAS footprint](https://tpte.de/en/ninjatrader-footprint-vs-atas/)
- [QuantVPS — Best order flow trading software 2026](https://www.quantvps.com/blog/order-flow-trading-software)
- [QuantVPS — Best footprint chart software 2026](https://www.quantvps.com/blog/analyzing-footprint-charts)
- [Trader Dale — Order flow platforms and data explained](https://www.trader-dale.com/top-order-flow-platforms-data-explained-ninjatrader-sierra-chart-atas-quantower-tradingview/)
- [Tradervue — Best trading journals 2026](https://www.tradervue.com/blog/best-trading-journal)
- [LuxAlgo — Edgewonk analysis](https://www.luxalgo.com/blog/edgewonk-journal-tool-analysis/)
