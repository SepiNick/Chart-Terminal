# پژوهش ۰۳ — Alerts، Watchlists، Trading Panel و Brokers

> هدف: مستندسازی **رفتار** امکانات TradingView برای بازسازی clean-room. هیچ کد یا متن طولانی از TradingView کپی نشده؛ همه‌چیز بازنویسی شده است.
> تاریخ پژوهش: 2026-10-13. مواردی که با «⚠ تأییدنشده» علامت خورده‌اند از دانش عمومی آمده‌اند و پیش از پیاده‌سازی باید دوباره بررسی شوند.

راهنمای ستون‌ها: Complexity = S (کوچک، چند روز) / M (متوسط) / L (بزرگ، نیازمند زیرساخت). Priority = Core / High / Medium / Low.

---

## ۱. Alerts (هشدارها)

### ۱.۱ معماری کلی (رفتار)

- **Server-side:** همه‌ی هشدارها روی سرور ساخته و ارزیابی می‌شوند؛ بستن مرورگر یا خروج از چارت آن‌ها را متوقف نمی‌کند و کاربر لازم نیست login باشد.
- **Snapshot:** هنگام ساخت هشدار، یک «عکس فوری» از اسکریپت، ورودی‌ها و تنظیمات چارت گرفته می‌شود. تغییر بعدی اندیکاتور یا چارت روی هشدار موجود اثری ندارد؛ برای اعمال تغییر باید هشدار را پاک کرد و دوباره ساخت (یا Edit که عملاً بازسازی است).
- **Price alerts ساده** روی کندل‌های ۱ دقیقه‌ای ارزیابی می‌شوند؛ هشدارهای اندیکاتور/drawing به resolution انتخاب‌شده وابسته‌اند (Interval می‌تواند با تایم‌فریم چارت فرق کند).
- **Once per bar close:** سرور برای اطمینان از بسته‌شدن کندل منتظر اولین معامله‌ی کندل بعدی می‌ماند؛ پس در بازارهای کم‌معامله تأخیر دارد.
- **محافظت در برابر spam:** اگر یک هشدار بیش از ۱۵ بار در ۳ دقیقه trigger شود، خودکار متوقف می‌شود. برای Watchlist alert: ۱۵ بار در ۳ دقیقه برای هر نماد و ۱۰۰۰ بار در ۳ دقیقه برای کل هشدار.
- **Log scale:** ارزیابی drawing alertها روی مقیاس لگاریتمی ممکن است ناپایدار باشد (TradingView توصیه به مقیاس خطی می‌کند).
- وضعیت‌های هشدار در Alert manager: Active، Stopped (دستی/محدودیت)، Triggered (برای Only once)، Expired.

### ۱.۲ انواع شرط (Condition operators)

| Feature | What it does | Complexity | Priority |
|---|---|---|---|
| Crossing | وقتی مقدار (قیمت/اندیکاتور) از سطح یا سری دیگر در هر جهتی عبور کند | S | Core |
| Crossing Up | فقط عبور از پایین به بالا | S | Core |
| Crossing Down | فقط عبور از بالا به پایین | S | Core |
| Greater Than | وقتی مقدار از سطح بالاتر باشد (لمس کافی نیست) | S | Core |
| Less Than | وقتی مقدار از سطح پایین‌تر باشد | S | Core |
| Entering Channel | ورود مقدار به بازه‌ی بین دو مرز (upper/lower) | S | High |
| Exiting Channel | خروج مقدار از بازه | S | High |
| Inside Channel | تا وقتی درون بازه است (حالت‌محور، نه رویدادمحور) | S | Medium |
| Outside Channel | تا وقتی بیرون بازه است | S | Medium |
| Moving Up | افزایش به اندازه‌ی مقدار مطلق ظرف N کندل | M | Medium |
| Moving Down | کاهش به اندازه‌ی مقدار مطلق ظرف N کندل | M | Medium |
| Moving Up % | افزایش درصدی ظرف N کندل | M | High |
| Moving Down % | کاهش درصدی ظرف N کندل | M | High |

نکته: سمت دوم مقایسه می‌تواند «Value» (عدد ثابت) یا یک plot دیگر از همان/اندیکاتور دیگر باشد (مثلاً EMA20 crossing EMA50).

### ۱.۳ منبع شرط (Alert sources)

| Feature | What it does | Complexity | Priority |
|---|---|---|---|
| Price alert | شرط روی قیمت نماد (Last) با عملگرهای بالا؛ سریع‌ساز از روی price scale (کلیک «+» یا Alt+A) | S | Core |
| Indicator alert | شرط روی هر plot از اندیکاتور built-in یا Pine؛ تا ۲۰ plot اول قابل ارجاع | M | Core |
| Drawing alert | روی trend line، ray، horizontal line، parallel channel، rectangle، Anchored VWAP و سطوح Fibonacci؛ هشدار با جابه‌جایی drawing همراه می‌شود. Line ← crossing/greater/less؛ Channel/Rectangle ← entering/exiting/inside/outside | M | High |
| Pine `alertcondition()` | اسکریپت شرط‌های نام‌دار تعریف می‌کند و کاربر یکی را در دیالوگ انتخاب می‌کند؛ پیام پیش‌فرض با placeholder | M | High |
| Pine `alert()` | هشدار برنامه‌نویسی‌شده با پیام پویا (رشته‌ی ساخته‌شده در runtime)؛ گزینه‌ی «Any alert() function call»؛ freq: `freq_all` / `freq_once_per_bar` (پیش‌فرض) / `freq_once_per_bar_close` | M | High |
| Strategy alert | روی رویداد fill سفارش در broker emulator، فقط realtime (نه کندل‌های تاریخی)؛ در strategy بدون `calc_on_every_tick` همه‌ی `alert()`ها عملاً once-per-bar-close هستند؛ placeholderهای `strategy.*` | L | High |
| Watchlist alert | یک شرط برای همه‌ی نمادهای یک watchlist؛ هر نماد مستقل trigger می‌شود؛ عضویت لیست live است (افزودن/حذف نماد اثر دارد)؛ open-ended مجاز نیست؛ گزینه‌ی Session = Regular/Extended | L | Medium |
| Multi-condition alert | ترکیب AND تا ۵ شرط (قیمت/drawing/اندیکاتور) روی یک نماد؛ تایم‌فریم‌های مختلط مجاز و فرکانس براساس کوچک‌ترین تایم‌فریم؛ strategy و `alert()` پشتیبانی نمی‌شوند؛ یک technical alert حساب می‌شود | L | Medium |
| Alert on Screener / Pine Screener | ⚠ تأییدنشده — هشدار روی نتایج screener در نسخه‌های جدید | L | Low |

### ۱.۴ تنظیمات هشدار

| Feature | What it does | Complexity | Priority |
|---|---|---|---|
| Trigger: Only once | یک بار اجرا و سپس توقف | S | Core |
| Trigger: Once per bar | حداکثر یک بار در هر کندل، حتی در کندل در حال شکل‌گیری (خطر repaint) | S | Core |
| Trigger: Once per bar close | فقط پس از بسته‌شدن کندل | S | Core |
| Trigger: Once per minute / Every time | بررسی هر دقیقه / هر بار برقراری شرط | S | High |
| Expiration | تاریخ/ساعت انقضا یا گزینه‌ی Open-ended (برای پلن‌های پولی؛ پلن رایگان سقف زمانی دارد) | S | Core |
| Alert name | عنوان در Alert manager، toast و log | S | Core |
| Message + placeholders | متن پیام با جایگزینی متغیرها (جدول ۱.۶) | M | Core |
| Alert presets | ذخیره‌ی تنظیمات notification تا ۵ preset (URL وب‌هوک ذخیره نمی‌شود) | S | Low |
| Edit / Clone / Pause / Restart / Delete | مدیریت چرخه‌ی عمر در Alert manager، فیلتر/مرتب‌سازی | M | High |
| Alert log | تاریخچه‌ی همه‌ی triggerها با زمان و پیام؛ ستون Webhook status؛ خروجی CSV | M | High |

### ۱.۵ کانال‌های اعلان

| Feature | What it does | Complexity | Priority |
|---|---|---|---|
| In-app popup / toast | پنجره‌ی پاپ‌آپ حتی در تب دیگر (با اجازه‌ی desktop notification) | S | Core |
| Sound | پخش صدا با انتخاب از لیست چند صدای از پیش تعیین‌شده و مدت (یک بار/تکرار) | S | High |
| Email | ارسال به ایمیل پروفایل | M | High |
| Plain-text email (email-to-SMS) | ارسال متن ساده به آدرس ایمیل جایگزین با تأیید کد ۶ رقمی (برای gatewayهای SMS اپراتورها) | S | Low |
| Mobile push | از طریق اپ موبایل؛ برای همه‌ی پلن‌ها | L | Medium |
| Webhook | POST به URL دلخواه (جزئیات پایین) | M | Core |
| Desktop app notification | اعلان سیستم‌عامل در نسخه‌ی desktop | M | Low |

**رفتار Webhook (از صفحه‌ی رسمی):**
- متد `POST`، بدنه = متن پیام هشدار.
- اگر پیام JSON معتبر باشد `Content-Type: application/json`، وگرنه `text/plain`.
- فقط پورت 80 و 443؛ IPv6 پشتیبانی نمی‌شود.
- timeout حدود ۳ ثانیه؛ retry مستند نشده و تحویل تضمینی نیست.
- درخواست‌ها از چهار IP ثابت می‌آیند (52.89.214.238، 34.212.75.30، 54.218.53.128، 52.32.178.7) تا گیرنده allowlist کند.
- فعال‌سازی وب‌هوک نیازمند 2FA روی حساب است؛ توصیه به قرار ندادن credential در بدنه.
- پیام شرط‌پذیر نیست؛ برای buy/sell جدا، هشدار جدا لازم است (یا `alert()` با پیام پویا).

### ۱.۶ Placeholderهای پیام

| Placeholder | معنا |
|---|---|
| `{{ticker}}`، `{{exchange}}` | نماد و صرافی (داده‌ی تأخیری پسوند `_DL`) |
| `{{open}}` `{{high}}` `{{low}}` `{{close}}` `{{volume}}` | مقادیر کندلِ لحظه‌ی trigger |
| `{{time}}` | زمان باز شدن کندل (UTC، ISO) |
| `{{timenow}}` | زمان واقعی trigger (دقت ثانیه) |
| `{{interval}}` | تایم‌فریم (برای price alert همیشه "1") |
| `{{syminfo.currency}}`، `{{syminfo.basecurrency}}` | ارز نماد / ارز پایه |
| `{{plot_0}}`…`{{plot_19}}`، `{{plot("Name")}}` | خروجی‌های اندیکاتور (فقط اندیکاتور اول در هشدار چندتایی) |
| `{{strategy.order.action}}` / `.contracts` / `.price` / `.id` / `.comment` / `.alert_message` | جزئیات سفارش fill‌شده |
| `{{strategy.position_size}}`، `{{strategy.market_position}}`، `{{strategy.market_position_size}}`، `{{strategy.prev_market_position}}`، `{{strategy.prev_market_position_size}}` | وضعیت پوزیشن فعلی/قبلی |

### ۱.۷ محدودیت پلن‌ها (صفحه‌ی Pricing، اکتبر ۲۰۲۶)

| Plan | Price alerts | Technical alerts | Watchlist alerts | Expiry |
|---|---|---|---|---|
| Basic (رایگان) | 3 | (محدود، ⚠) | 0 | دارای انقضا (حدود ۱–۲ ماه، ⚠) |
| Essential | 20 | 20 | 0 | بدون انقضا |
| Plus | 100 | 100 | 0 | بدون انقضا |
| Premium | 400 | 400 | 2 | بدون انقضا |
| Ultimate | 1000 | 1000 | 15 | بدون انقضا |

(پلن‌های حرفه‌ای Expert/Elite در صفحه‌ی فعلی نمایش داده نشدند؛ طبق بلاگ قدیمی Expert = ۱۰ watchlist alert.)
**پیشنهاد برای clone:** سقف‌ها را در جدول `plans` پیکربندی‌پذیر کنیم، نه hard-code.

---

## ۲. Watchlists

| Feature | What it does | Complexity | Priority |
|---|---|---|---|
| Multiple watchlists | ساخت/تغییرنام/کپی/حذف چند لیست و سوییچ سریع؛ رایگان = ۱ لیست، پولی = چندتایی | S | Core |
| Symbols per list | سقف ۳۰ (رایگان) و ۱۰۰۰ (پولی) نماد در هر لیست | S | Core |
| Sections | جداکننده‌ی نام‌دار بین نمادها (کلیک راست ← Add section)؛ جابه‌جایی، collapse، حذف | S | High |
| Flags / colored lists | ۷ رنگ پرچم (قرمز، آبی، سبز، نارنجی، بنفش، فیروزه‌ای، صورتی)؛ هر رنگ خودکار یک لیست مجزا می‌سازد و پرچم در چارت/screener هم دیده می‌شود | S | High |
| Columns | فعال/غیرفعال‌سازی ستون‌ها: Last، Change، Change %، Volume، Extended hours (Pre/Post-market price/change)، Open/High/Low، Technical rating، Market cap، و غیره؛ ستون symbol logo و description | M | Core |
| Sorting | مرتب‌سازی با کلیک روی header هر ستون (صعودی/نزولی/حالت دستی) | S | Core |
| Drag & drop reorder | جابه‌جایی دستی نمادها و بین sectionها | S | High |
| Real-time ticking | به‌روزرسانی زنده‌ی قیمت با چشمک رنگی تغییر | M | Core |
| Import (.txt) | بارگذاری فایل متنی با نمادهای `EXCHANGE:SYMBOL` جداشده با کاما | S | Medium |
| Export (.txt) | دانلود لیست به همان فرمت (از Advanced view یا منوی لیست) | S | Medium |
| Advanced view | نمای تمام‌صفحه با تب‌های Overview / Earnings / Dividends / News؛ گروه‌بندی بر اساس section، ارز، نوع نماد، sector، exchange؛ ردیف خلاصه (min/max/avg/median)؛ نمودار توزیع | L | Medium |
| Details panel | زیر لیست: قیمت و تغییر، پیک و بازه‌ی روز/۵۲ هفته، Key stats (market cap، P/E، dividend yield، EPS)، Performance (1W/1M/3M/6M/YTD/1Y)، Technicals gauge، Seasonals، Profile، Earnings بعدی | M | High |
| Symbol notes | یادداشت شخصی روی نماد (پنل Notes در right toolbar)؛ در Details قابل‌مشاهده | S | Low |
| News per symbol | فید خبر هر نماد در Details و تب News در Advanced view | M | Medium |
| Hotlists | لیست‌های آماده‌ی سرور: Top gainers/losers، Most active (volume)، Gap up/down، Unusual volume، Most volatile و غیره به ازای هر بورس/بازار | M | Medium |
| Shared / published watchlists | اشتراک‌گذاری لیست با لینک | S | Low |
| Watchlist alert | (بخش ۱.۳) | L | Medium |
| Sync across devices | همگام‌سازی لیست‌ها بین وب/دسکتاپ/موبایل از طریق حساب کاربری | M | High |

---

## ۳. Trading Panel

### ۳.۱ ساختار

- **Trading Panel** (تب پایین صفحه) لیست brokerها + Paper Trading را نشان می‌دهد؛ هم‌زمان فقط یک broker متصل می‌شود.
- پس از اتصال، **Account Manager** پایین چارت تب‌های Positions، Orders (Working/Filled/Cancelled/Rejected)، Account Summary، History/Journal (Notifications log) دارد.
- دکمه‌ی **Trade** / **Buy/Sell buttons** روی چارت پنل سمت راست را با دو تب **Order** (order ticket) و **DOM** باز می‌کند.

### ۳.۲ Paper Trading

| Feature | What it does | Complexity | Priority |
|---|---|---|---|
| Virtual account | موجودی اولیه‌ی قابل تنظیم، ارز حساب، کمیسیون (درصد/ثابت) | M | Core |
| Multiple paper accounts | چند حساب مجازی برای آزمودن استراتژی‌های مختلف | S | Medium |
| Leverage per asset class | margin و اهرم جدا برای سهام/کریپتو/فارکس/فیوچرز/CFD | M | High |
| Realistic broker simulation | fill بر اساس قیمت live، پشتیبانی همه‌ی نمادهای دارای داده | L | Core |
| Reset account | بازنشانی موجودی و پاک‌سازی تاریخچه | S | High |
| Order history / journal | لاگ رویدادها (placed/filled/modified/cancelled) و trade history | M | High |

### ۳.۳ انواع سفارش و order ticket

| Feature | What it does | Complexity | Priority |
|---|---|---|---|
| Market order | اجرا به بهترین قیمت فعلی | S | Core |
| Limit order | اجرا در قیمت مشخص یا بهتر | S | Core |
| Stop (stop-market) | پس از رسیدن به stop price، market اجرا می‌شود | S | Core |
| Stop-Limit | پس از stop، یک limit ثبت می‌شود (وابسته به broker) | M | High |
| Brackets (TP/SL) | الصاق Take Profit و/یا Stop Loss به سفارش/پوزیشن؛ هر دو یک گروه OCO (یکی fill شود دیگری لغو) | M | Core |
| Trailing stop | نوعی bracket که با حرکت قیمت به نفع پوزیشن جابه‌جا می‌شود؛ فاصله بر حسب pips/قیمت/درصد/پول (وابسته به broker) | M | High |
| OCO مستقل | دو سفارش مرتبط که fill یکی دیگری را لغو می‌کند (در برخی brokerها) | M | Medium |
| Reduce-only / Post-only | گزینه‌های خاص صرافی‌های کریپتو (Bybit/Binance و...) در ticket | S | Medium |
| Time in Force | DAY، GTC، GTD (تاریخ)، IOC، FOK — بسته به broker (قبلاً «Duration» نام داشت) | S | High |
| Quantity modes | units/contracts/lots، مبلغ پولی (cash)، درصد موجودی، money risk، و % risk of balance (فیلدهای risk فقط با SL فعال) | M | High |
| Order info box | نمایش pip value، margin مورد نیاز، commission تخمینی، reward/risk | M | Medium |
| Order presets | ذخیره‌ی پیش‌تنظیم (bracketها نسبی/درصدی، TIF، مقدار) | S | Low |
| Confirmation toggle | پیام تأیید قبل از ارسال قابل خاموش‌کردن؛ «instant order placement» | S | Medium |
| Buy/Sell buttons on chart | دکمه‌های one-click با bid/ask و spread روی گوشه‌ی چارت | S | High |

### ۳.۴ مدیریت روی چارت

| Feature | What it does | Complexity | Priority |
|---|---|---|---|
| Order lines | نمایش سفارش‌ها به صورت خط افقی با برچسب (نوع، مقدار، قیمت) | M | Core |
| Drag to modify | کشیدن خط سفارش برای تغییر قیمت؛ کشیدن از خط پوزیشن/سفارش برای ساخت TP/SL؛ Shift برای جابه‌جایی سفارش همراه bracketها | M | Core |
| Position line | خط قیمت ورود با P&L زنده (پول/pips/درصد)، دکمه‌ی close و reverse | M | Core |
| Executions markers | فلش‌های اجرای معاملات روی کندل‌ها | S | Medium |
| Context-menu trading | کلیک راست روی چارت ← Buy/Sell Limit یا Stop در قیمت نشانگر | S | High |
| Long/Short Position tool | ابزار drawing محاسبه‌ی risk/reward و اندازه‌ی پوزیشن (جدا از سفارش واقعی) | M | High |

### ۳.۵ Depth of Market (DOM)

| Feature | What it does | Complexity | Priority |
|---|---|---|---|
| Price ladder | ستون‌های bid/ask حجم در هر سطح قیمت (داده از broker، Level 2 وابسته به حساب) | L | Medium |
| Click-to-trade | کلیک روی سلول ← Limit؛ Ctrl+کلیک ← Stop؛ منوی راست‌کلیک برای market/limit/stop | M | Medium |
| Order markers in ladder | نمایش سفارش‌های کاربر روی سطح؛ drag برای تغییر؛ X برای لغو | M | Medium |
| Bulk cancel | لغو همه‌ی buyها، همه‌ی sellها، یا CXL ALL | S | Medium |
| Flatten / Reverse | بستن پوزیشن / معکوس‌کردن | S | Medium |
| Buy Mkt / Sell Mkt | سفارش بازار با quantity فیلد | S | Medium |
| Static ladder + recenter | سطوح ثابت با دکمه‌ی مرکزکردن | S | Low |
| Status colors | رنگ متفاوت برای limit/stop/stop-limit فعال | S | Low |

### ۳.۶ Account Manager

| Feature | What it does | Complexity | Priority |
|---|---|---|---|
| Account summary | Balance، Equity، Realized/Unrealized P&L، Margin used/available، Margin level | M | Core |
| Positions tab | لیست پوزیشن‌ها با side، qty، avg price، last، P&L، TP/SL، دکمه close | M | Core |
| Orders tab | فیلتر Working/Filled/Cancelled/Rejected/All؛ modify/cancel | M | Core |
| History / Journal | لاگ زمان‌دار همه‌ی رویدادهای حساب، قابل export (⚠ export وابسته به broker) | M | High |
| Close all / Cancel all | اقدامات گروهی | S | High |

---

## ۴. Broker integrations

### ۴.۱ لیست brokerها (از tradingview.com/brokers و صفحات broker، اکتبر ۲۰۲۶)

صفحه‌ی brokers بیش از ۱۰۰ partner ذکر می‌کند و فهرست بر اساس کشور کاربر فیلتر می‌شود؛ جدول زیر هر آنچه تأیید شد را دارد.

| Broker | Asset class | API type | Testnet? | CCXT? | Notes |
|---|---|---|---|---|---|
| Binance | Crypto spot + USDⓈ-M futures | REST + WS (HMAC/Ed25519 keys) | ✅ Spot testnet و Futures testnet | ✅ | futures از 2022، spot از مه 2023 روی TV |
| Bybit | Crypto spot + derivatives | REST v5 + WS | ✅ testnet + Demo trading | ✅ | روی TV از فوریه 2024 |
| OKX | Crypto spot/swap/futures/options | REST v5 + WS | ✅ Demo trading (هدر simulated) | ✅ | |
| Kraken | Crypto spot (+ futures) | REST + WS | ⚠ فقط Futures demo؛ spot ندارد | ✅ (kraken، krakenfutures) | |
| Coinbase Advanced | Crypto spot + futures | REST + WS (CDP keys) | ⚠ sandbox محدود | ✅ (coinbase، coinbaseadvanced) | |
| Bitget | Crypto spot + futures | REST v2 + WS | ✅ Demo trading (paptrading) | ✅ | |
| BingX | Crypto spot + perpetual | REST + WS | ✅ VST demo (perp) | ✅ | |
| Gate | Crypto spot + futures | REST v4 + WS | ✅ futures testnet | ✅ (gate) | |
| BitMEX | Crypto derivatives + spot | REST + WS | ✅ testnet.bitmex.com | ✅ | روی TV از آوریل 2025 |
| WhiteBIT | Crypto spot + futures | REST v4 + WS | ❌ (⚠ تأییدنشده) | ✅ | futures در 2025 اضافه شد |
| Interactive Brokers | Stocks, options, futures, forex, bonds | TWS API / Client Portal Web API | ✅ Paper account | ❌ | multi-asset |
| TradeStation | Stocks, options, futures | REST v3 + streaming | ✅ SIM environment | ❌ | DOM با Level 2 |
| Tradovate | Futures | REST + WS | ✅ demo | ❌ | |
| NinjaTrader | Futures | (اتصال از طریق Tradovate stack) | ✅ demo | ❌ | |
| AMP Futures | Futures | CQG/Rithmic gateways | ✅ demo | ❌ | |
| AvaFutures، WH SelfInvest Futures | Futures | broker-specific | ✅ demo | ❌ | |
| Alpaca | US stocks, options, crypto | REST + WS | ✅ Paper trading API | ✅ (alpaca، crypto) | multi-leg options از TV پشتیبانی نمی‌شود |
| Tastytrade / tastyfx | Stocks, options, futures / Forex | REST + WS | ✅ cert sandbox | ❌ | |
| Webull | US stocks, options | OpenAPI | ⚠ | ❌ | |
| Tradier | US stocks, options | REST | ✅ sandbox | ❌ | |
| CapTrader، MEXEM | Multi-asset (IBKR introducing brokers) | via IBKR | ✅ paper | ❌ | |
| OANDA | Forex/CFD | REST v20 + streaming | ✅ practice account | ❌ | trailing stop پشتیبانی |
| FOREX.com | Forex/CFD | REST (GAIN) | ✅ demo | ❌ | |
| FXCM | Forex/CFD | REST/socket.io | ✅ demo | ❌ | |
| Pepperstone | Forex/CFD | cTrader/MT bridges | ✅ demo | ❌ | |
| IC Markets | Forex/CFD | cTrader/MT | ✅ demo | ❌ | در لیست با نام «IC» |
| Capital.com | Forex/CFD | REST + WS | ✅ demo API | ❌ | |
| Eightcap | Forex/CFD | MT5 bridge | ✅ demo | ❌ | |
| ThinkMarkets، FxPro، Tickmill، ActivTrades، CMC Markets، IG، GO Markets، FP Markets، Swissquote، Darwinex، easyMarkets، Trade Nation، GBE brokers، Alchemy Markets، Purple Trading، CFI، Skilling | Forex/CFD | broker-specific (اغلب MT4/MT5 یا REST اختصاصی) | ✅ معمولاً demo | ❌ | |
| ColmexPro، RoboMarkets | Stocks/ETF (+CFD) | broker-specific | ✅ demo | ❌ | |
| Saxo، Zerodha، Fidelity و... | — | — | — | — | ⚠ در این پژوهش اتصال مستقیم TV تأیید نشد |

**جمع‌بندی برای clone:** نمی‌توانیم integrationهای رسمی TV را بازتولید کنیم (قراردادی‌اند). مسیر عملی: یک لایه‌ی `BrokerAdapter` با سه پیاده‌سازی اولیه — Paper (داخلی)، CCXT (همه‌ی صرافی‌های کریپتو بالا با testnet)، MT5 (فارکس) — و بعداً Nobitex.

### ۴.۲ Nobitex (صرافی ایرانی) — API عمومی

| Item | Detail |
|---|---|
| Base URL | `https://apiv2.nobitex.ir` |
| Testnet | ✅ `https://testnetapiv2.nobitex.ir` |
| Auth | هدر `Authorization: Token <token>` یا API key با `Nobitex-Key` + امضای Ed25519 (`Nobitex-Signature`، base64 url-safe) + `Nobitex-Timestamp`؛ مجوزهای READ / TRADE |
| Market data (عمومی) | `/v3/orderbook/{symbol}` (یا `all`) — 300/min؛ `/v2/depth/{symbol}` — 300/min؛ `/v2/trades/{symbol}` (۲۰ معامله‌ی آخر) — 60/min؛ `/market/stats` — 20/min |
| OHLC | `/market/udf/history` (فرمت UDF — مناسب datafeed چارت)؛ resolutionها: 1,5,15,30,60,180,240,360,720 دقیقه و D/2D/3D؛ حداکثر ۵۰۰ کندل در پاسخ، با `countback` و `page`؛ کندل دقیقه‌ای از ابتدای ۱۴۰۱ |
| Symbol format | `BTCIRT`، `BTCUSDT` (ریال = IRT در نماد، `rls` در stats) |
| Order types | `limit`، `market`، `stop_limit`، `stop_market`، و OCO از طریق `mode=oco` |
| Order endpoints | `/market/orders/add` (300 در ۱۰ دقیقه)، `/status`، `/list`، `/update-status` (لغو)، `/cancel-old`، `/market/trades/list`؛ `clientOrderId` تا ۳۲ کاراکتر |
| Margin | ✅ بخش جدای margin trading |
| WebSocket | ✅ (بخش WebSocket در مستندات) |
| CCXT | ❌ در CCXT رسمی نیست؛ ✅ در fork غیررسمی `ccxt-ir` (PyPI) همراه Wallex، Ramzinex، Tabdeal، OMPFinex، Bitpin و... |
| نکته | توصیه‌ی هدر `User-Agent: TraderBot/<name-version>`؛ بررسی تکراری‌بودن سفارش ظرف ۱۰ ثانیه (با `pro=true` غیرفعال) |

### ۴.۳ MetaTrader 5 + Python (فارکس)

- پکیج رسمی `MetaTrader5` (pip) از طریق IPC به ترمینال MT5 نصب‌شده روی همان ماشین وصل می‌شود؛ ترمینال باید اجرا/قابل‌اجرا باشد. عملاً **فقط Windows** (روی Linux فقط با Wine — ⚠).
- ۳۲ تابع: اتصال (`initialize`، `login`، `shutdown`، `version`، `last_error`)، اطلاعات (`account_info`، `terminal_info`، `symbols_get`، `symbol_info`، `symbol_info_tick`، `symbol_select`)، Level 2 (`market_book_add/get/release`)، داده‌ی تاریخی (`copy_rates_from`، `copy_rates_from_pos`، `copy_rates_range`، `copy_ticks_from`، `copy_ticks_range`)، معامله (`order_check`، `order_send`، `order_calc_margin`، `order_calc_profit`)، وضعیت (`orders_get`، `positions_get`) و تاریخچه (`history_orders_get`، `history_deals_get`).
- streaming push ندارد → باید polling (مثلاً `symbol_info_tick` هر ۲۰۰–۵۰۰ms) کرد.
- حساب demo تقریباً در همه‌ی brokerهای MT5 رایگان است ← testnet عملی.
- **پیشنهاد معماری:** یک microservice ویندوزی کوچک (Python) که MT5 را wrap کند و از طریق WS/REST به backend اصلی وصل شود.

---

## ۵. خلاصه‌ی اولویت‌ها برای MVP

1. **Core:** Price/indicator alerts با عملگرهای crossing/greater/less + فرکانس‌ها + expiration + popup/sound/webhook + alert log؛ watchlist چندتایی با ستون‌ها و sort؛ Paper trading با market/limit/stop + brackets + drag روی چارت + account summary.
2. **High:** Drawing alerts، `alert()`/`alertcondition`، sections و flags، details panel، trailing stop، TIF، risk-% sizing، adapter CCXT با testnet.
3. **Medium/Low:** Watchlist و multi-condition alerts، DOM، hotlists، advanced view، push موبایل، Nobitex و MT5 adapter.

## ۶. شکاف‌ها (Gaps)

- صفحه‌ی brokers با JS رندر می‌شود؛ لیست کامل کشوربه‌کشور (به‌خصوص brokerهای هند، ترکیه، کره) استخراج نشد.
- سقف technical alert و مدت انقضای پلن رایگان، و سقف‌های پلن‌های Expert/Elite به‌طور دقیق تأیید نشد.
- لیست کامل ستون‌های watchlist و لیست صداهای هشدار از مستند رسمی استخراج نشد (از دانش عمومی).
- وضعیت testnet برای WhiteBIT، Coinbase و Webull تأیید مستقل نشد.
- جزئیات WebSocket نوبیتکس (کانال‌ها/پروتکل) بررسی نشد.

## Sources

- https://www.tradingview.com/support/solutions/43000763312-learn-how-to-configure-alerts/
- https://www.tradingview.com/support/solutions/43000474415 (alert frequencies)
- https://www.tradingview.com/support/solutions/43000529348-about-webhooks/
- https://www.tradingview.com/support/solutions/43000531021-how-to-use-a-variable-value-in-alert/
- https://www.tradingview.com/support/solutions/43000761492-multi-condition-alerts/
- https://www.tradingview.com/support/solutions/43000739708-watchlist-alerts-your-trading-edge/
- https://www.tradingview.com/support/solutions/43000763315-getting-started-with-technical-alerts/
- https://www.tradingview.com/support/solutions/43000481368-strategy-alerts/
- https://www.tradingview.com/support/solutions/43000548327-will-alerts-work-if-tradingview-is-not-open-on-the-computer/
- https://www.tradingview.com/support/solutions/43000773948-delays-in-onceperbarclose-alerts/
- https://www.tradingview.com/support/solutions/43000474389-how-to-receive-phone-notifications-for-alerts/
- https://www.tradingview.com/support/solutions/43000774194-alert-presets/
- https://www.tradingview.com/blog/en/alerts-on-fibonacci-drawings-58692/
- https://www.tradingview.com/pine-script-docs/concepts/alerts/
- https://www.tradingview.com/pricing/
- https://www.tradingview.com/support/solutions/43000487233-how-to-import-or-export-a-watchlist/
- https://www.tradingview.com/support/solutions/43000771546-watchlist-advanced-view-mode/
- https://www.tradingview.com/support/solutions/43000615520-how-to-add-a-section-to-the-watchlist/
- https://www.tradingview.com/support/solutions/43000487210-i-want-to-add-or-remove-columns-to-the-watchlist/
- https://www.tradingview.com/blog/en/introducing-flagged-symbols-7443/
- https://www.tradingview.com/support/solutions/43000516466-paper-trading-main-functionality/
- https://www.tradingview.com/trading/
- https://www.tradingview.com/support/solutions/43000754951-order-brackets/
- https://www.tradingview.com/support/solutions/43000501552-how-do-i-place-a-trailing-stop-order/
- https://www.tradingview.com/blog/en/optimize-trading-with-order-presets-48237/
- https://www.tradingview.com/support/solutions/43000516459-depth-of-market-dom-what-it-is-and-how-traders-can-use-it/
- https://www.tradingview.com/brokers/
- https://www.tradingview.com/blog/en/binance-spot-trading-on-tradingview-38297
- https://www.tradingview.com/blog/en/welcoming-binance-futures-to-tradingview-35227
- https://www.tradingview.com/blog/en/whitebit-integration-update-futures-trading-now-live-52174
- https://www.tradingview.com/broker/Bybit/
- https://blog.bitmex.com/bitmex-tradingview-partnership
- https://alpaca.markets/learn/how-to-trade-options-on-tradingview-with-alpaca-trading-api-account
- https://www.businesswire.com/news/home/20241023358076/en/Leading-forex-broker-tastyfx-offers-integration-with-TradingView
- https://www.webull.com/partners/tradingview
- https://trade.tradier.com/tradingview/
- https://apidocs.nobitex.ir/ (و فایل‌های `openapi/market_data.yaml` و `openapi/spot_trade.yaml`)
- https://pypi.org/project/ccxt-ir/
- https://www.mql5.com/en/docs/python_metatrader5
