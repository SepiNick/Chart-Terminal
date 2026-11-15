[فارسی](05-beyond-tradingview.md) · [English](05-beyond-tradingview.en.md)

# ۰۵ — فراتر از TradingView: قابلیت‌هایی که رقبا دارند و TradingView ندارد (یا ضعیف دارد)

> تاریخ تحقیق: ۲۰۲۶-۱۰-۱۳ · دامنه: ترمینال تحلیل/معامله‌ی وب، اول کریپتو (Binance / Bybit / OKX / KuCoin / Nobitex)، بعداً فارکس از طریق MT5، کاربر در ایران.
>
> روش: جست‌وجوی وب و خواندن مستندات رسمی و نقدهای مستقل. هیچ کد یا متن طولانی‌ای از رقبا کپی نشده؛ فقط رفتار و کارکرد توصیف شده است. بخشی از منابع، صفحه‌های بازاریابی خودِ فروشنده‌ها یا رقبایشان‌اند؛ هر جا ادعا فقط از یک منبع غیرمستقل آمده، علامت (؟) خورده است.

## خلاصه‌ی جایگاه TradingView (نقاط ضعف مستند)

- **Footprint:** از ۲۰۲۶ تابع `request.footprint()` در Pine اضافه شده، ولی فقط برای پلن‌های Premium/Ultimate، با عمق تاریخی کم در گذشته‌ی دور؛ اسکریپت‌های جامعه هم به سقف ۵۰۰ box/label در Pine می‌خورند و برای بیشتر نمادها فقط تخمینی از bid/ask می‌سازند. [S9][S10]
- **Heatmap دفتر سفارش، DOM تاریخی، iceberg:** ندارد. [S5][S6]
- **Backtest:** بک‌تست تک‌نماد؛ بدون بک‌تست پورتفو، بدون walk-forward/Monte Carlo/بهینه‌سازی ژنتیک داخلی؛ Bar Replay به‌صورت bar-by-bar و نه tick-by-tick؛ محدودیت ۴۰ فراخوانی `request.security` برای اسکن چندنماده. [S11]
- **داده‌ی مشتقات/آن‌چین:** نقشه‌ی لیکوئیدیشن، OI تجمیعی بین صرافی‌ها، فاندینگ، نسبت long/short، و متریک‌های آن‌چین به‌صورت بومی ندارد (فقط از طریق اسکریپت‌ها/داده‌ی شخص ثالث).
- **ژورنال، ابزار ریسک، ربات اجرا (grid/DCA):** ندارد؛ اتوماسیون فقط از طریق webhook و ابزارهای بیرونی (3Commas و غیره). [S17][S24]
- **بازار ایران:** نه جفت‌های تومانی نوبیتکس، نه TSETMC، نه قیمت طلا/سکه، نه تقویم جلالی و رابط RTL.

---

## ۱) Order Flow و ریزساختار بازار

| Feature | Who offers it | Why valuable | Data needed | Complexity S/M/L | Priority |
|---|---|---|---|---|---|
| Footprint / Cluster chart (حالت‌های bid×ask، delta، volume، imbalance) | ATAS، Exocharts، Sierra Chart (Numbers Bars)، Bookmap (افزونه) | نشان می‌دهد درون هر کندل در هر سطح قیمت چه کسی تهاجمی بوده؛ در TradingView محدود و پولی است | تریدهای تیک‌به‌تیک با سمت aggressor (WebSocket `aggTrade`/`trades` صرافی‌ها) + ذخیره‌ی تاریخی | L | High |
| Stacked imbalance (۳+ سطح متوالی عدم‌تعادل) | ATAS، Exocharts | فیلتر نویز؛ ATAS خودش هشدار می‌دهد یک imbalance تنها سیگنال نیست | همان داده‌ی footprint | S (بعد از footprint) | High |
| CVD (Cumulative Volume Delta) + واگرایی CVD/قیمت؛ CVD جدا برای spot و perp | Bookmap، ATAS، Exocharts | تشخیص اینکه حرکت قیمت مشارکت واقعی دارد یا نه؛ مقایسه‌ی spot vs perp در کریپتو بسیار پرکاربرد است | تریدهای تیک با سمت aggressor | M | High |
| Heatmap نقدینگی دفتر سفارش (تاریخچه‌ی عمق در طول زمان) | Bookmap، ATAS (رایگان در همه‌ی پلن‌ها)، Sierra Chart (Market Depth Historical Graph) | دیوارهای سفارش و جابه‌جایی/کنسل‌شدن آن‌ها را قبل از رسیدن قیمت نشان می‌دهد؛ TradingView ندارد | snapshot/diff عمق L2 (`depth@100ms`) پیوسته، ذخیره‌ی فشرده | L | High |
| DOM ladder (نردبان قیمت با bid/ask و حجم معامله‌شده) + سفارش‌گذاری یک‌کلیکی | ATAS، Sierra Chart، Exocharts Desktop Pro | اسکالپ و مدیریت سفارش دقیق | L2 زنده + API معاملاتی | M | Medium |
| Iceberg / absorption detector | Bookmap (۳ الگوریتم؛ دقت بالاتر با داده‌ی MBO) | سفارش‌های پنهان بزرگ و نقاط جذب را نشان می‌دهد؛ ذاتاً تخمینی است | تریدها + L2 هم‌زمان (کریپتو MBO ندارد → دقت کمتر) | L | Low |
| Large-trade bubbles / trade-size filter | Bookmap، Exocharts (trade-size clustering) | دیدن ورود نهنگ‌ها روی چارت | تریدهای تیک | S | Medium |
| Time & Sales (tape) با فیلتر اندازه | ATAS، Exocharts، Sierra | زمینه‌ی لحظه‌ای | تریدهای تیک | S | Medium |
| Market Replay در سطح تیک (نه فقط bar) | ATAS، Sierra Chart | تمرین و بک‌تست دستی واقع‌گرایانه؛ Bar Replay در TradingView فقط bar-by-bar است | آرشیو تیک و عمق | L | Medium |

## ۲) Volume Profile / Market Profile (TPO)

| Feature | Who offers it | Why valuable | Data needed | Complexity S/M/L | Priority |
|---|---|---|---|---|---|
| TPO / Market Profile کامل (Value Area، POC، Initial Balance، single prints، split/merge) | Sierra Chart، Exocharts، ATAS | تحلیل ساختار حراج؛ در TradingView ضعیف است | OHLCV ریزدانه (۱m یا ۳۰m برای حروف TPO) | M | High |
| Composite / dynamic / session volume profile با naked POC | Exocharts، ATAS، Sierra | سطوح حمایت/مقاومت مبتنی بر حجم در چند روز | volume-at-price از تریدها (یا تخمین از ۱m) | M | High |
| Raindrop chart (کندل با شکل حجم در قیمت، دو نیمه بر اساس VWAP) | TrendSpider (اختصاصی) | ترکیب کندل + پروفایل حجم در یک نماد؛ متمایزکننده | volume-at-price هر کندل | M | Medium |
| Delta profile / profile حجم بر اساس تعداد معامله | ATAS (heatmap با حالت volume/trades/delta) | دید سریع‌تر از سمت غالب در هر سطح | تریدهای تیک | S | Medium |

## ۳) داده‌ی مشتقات کریپتو (Coinglass-style)

| Feature | Who offers it | Why valuable | Data needed | Complexity S/M/L | Priority |
|---|---|---|---|---|---|
| Open Interest تجمیعی بین صرافی‌ها، به‌صورت اندیکاتور زیر چارت | Coinglass، Exocharts | تمایز حرکت با پوزیشن‌های جدید یا بسته شدن پوزیشن‌ها | REST OI عمومی Binance/Bybit/OKX (رایگان) | S | High |
| Funding rate (فعلی، پیش‌بینی‌شده، تاریخی، مقایسه بین صرافی‌ها) | Coinglass | شلوغی سمت long/short؛ منبع آربیتراژ funding | REST عمومی صرافی‌ها | S | High |
| Long/Short ratio (حساب‌ها، top traders) | Coinglass | سنتیمنت پوزیشن‌ها | REST عمومی Binance/Bybit/OKX | S | Medium |
| فید لیکوئیدیشن‌ها + حباب لیکوئیدیشن روی چارت | Coinglass، Exocharts | نقاط کپیتولاسیون و squeeze | WebSocket `forceOrder` (Binance) و معادل‌ها (Binance فقط بزرگ‌ترینِ هر ثانیه را می‌فرستد → ناقص) | S | High |
| Liquidation heatmap / map (سطوح تخمینی لیکوئید شدن) | Coinglass (پولی) | «آهنربای» قیمت؛ پربازدیدترین ابزار Coinglass | مدل از OI + توزیع اهرم فرضی؛ صراحتاً **تخمینی** است و برای BTC/ETH قابل‌اتکاتر | M | High |
| Basis / premium فیوچرز به اسپات و term structure | Coinglass، Laevitas/Velo (؟) | سنتیمنت و فرصت cash-and-carry | قیمت spot، perp، quarterly | S | Medium |
| آپشن: OI بر اساس strike، max pain، IV smile، put/call | Coinglass، Deribit tools | دید جدی به موقعیت بازیگران بزرگ | API عمومی Deribit / OKX / Bybit options | M | Low |
| جریان ETF بیت‌کوین، Token unlocks | Coinglass | رویدادهای کلان عرضه/تقاضا | منبع خارجی/scrape | S | Low |

## ۴) آن‌چین و سنتیمنت

| Feature | Who offers it | Why valuable | Data needed | Complexity S/M/L | Priority |
|---|---|---|---|---|---|
| Exchange netflow (ورود/خروج کوین به صرافی‌ها)، stablecoin netflow | Glassnode، CryptoQuant | فشار فروش/خرید بالقوه | API پولی Glassnode/CryptoQuant (برچسب آدرس‌ها را خودشان دارند) | M (ادغام) | Medium |
| MVRV، SOPR (aSOPR، STH/LTH)، Realized cap | Glassnode، CryptoQuant | تشخیص فازهای سیکل؛ ابزار تحلیل‌گران میان‌مدت | API پولی | S (ادغام) | Medium |
| Social volume / weighted sentiment / dev activity | Santiment | اوج‌گیری بحث‌ها اغلب نشانه‌ی سقف محلی در آلت‌کوین‌هاست (ادعای خود Santiment) | API Santiment (پولی) | S (ادغام) | Low |
| Fear & Greed، Altcoin Season Index، RSI heatmap بازار | Coinglass، Alternative.me | خلاصه‌ی وضعیت بازار در یک نگاه | قابل محاسبه از قیمت‌ها | S | Medium |

> نکته‌ی ایران: بیشتر این APIها پولی هستند و ممکن است پرداخت/ثبت‌نام از ایران مشکل داشته باشد؛ متریک‌های قابل‌محاسبه از داده‌ی صرافی (OI، funding، heatmap RSI) را در اولویت بگذارید.

## ۵) تحلیل خودکار و AI

| Feature | Who offers it | Why valuable | Data needed | Complexity S/M/L | Priority |
|---|---|---|---|---|---|
| Auto trendlines / auto S&R / auto Fibonacci | TrendSpider (هسته‌ی محصول) | صرفه‌جویی زمان و حذف سوگیری ذهنی در رسم | OHLCV | M | High |
| Multi-timeframe overlay (مثلاً SMA روزانه روی چارت ۱۵ دقیقه، بدون کدنویسی) | TrendSpider | در TradingView نیازمند Pine است | OHLCV چند تایم‌فریم | S | High |
| تشخیص خودکار الگوهای چارت و کندل + اسکن بازار برای آن‌ها | TrendSpider | ایده‌یابی سریع | OHLCV | M | Medium |
| اسکنر با زبان طبیعی (کاربر می‌نویسد «ارزهایی که RSI روزانه زیر ۳۰ و حجم ۲ برابر میانگین») | TrendSpider Sidekick | پایین آوردن مانع ورود؛ تبدیل متن به شرط‌های اسکنر | LLM + موتور اسکنر داخلی | M | High |
| دستیار AI روی چارت (خلاصه‌ی وضعیت نماد، توضیح اندیکاتور، ساخت هشدار) | TrendSpider Sidekick، PionexGPT (تولید Pine) | تجربه‌ی کاربری متمایز | LLM + دسترسی به داده‌ی چارت | M | Medium |
| AI Strategy Lab (آموزش مدل ML روی داده‌ی کاربر) | TrendSpider | تحقیق پیشرفته | داده‌ی تاریخی + زیرساخت ML | L | Low |

## ۶) بک‌تست، بهینه‌سازی و اعتبارسنجی

| Feature | Who offers it | Why valuable | Data needed | Complexity S/M/L | Priority |
|---|---|---|---|---|---|
| بک‌تست بدون کد (rule builder) و تبدیل بک‌تست به ربات/هشدار با یک کلیک | TrendSpider، Option Alpha | کاربر غیربرنامه‌نویس | OHLCV | M | High |
| بک‌تست پورتفو / چندنماده با سرمایه‌ی مشترک | QuantConnect، Backtrader، Freqtrade | TradingView فقط تک‌نماد؛ واقع‌گرایی بیشتر | OHLCV چندنماد | M | Medium |
| بهینه‌سازی پارامتر (grid کامل یا genetic) + heatmap پارامترها | MT5 Strategy Tester (complete / fast genetic، اجرای چندهسته‌ای و cloud)، Freqtrade hyperopt | پیدا کردن ناحیه‌ی پایدار پارامتر، نه یک نقطه‌ی overfit | OHLCV؛ اجرا در worker سمت سرور | M | Medium |
| Walk-forward / forward test (out-of-sample) | MT5 (forward)، QuantConnect (مستندات walk-forward) | مقابله با overfitting؛ پارامترهای بهینه به بازه‌ی آموزش وابسته‌اند | همان | M | High |
| Monte Carlo روی ترتیب معاملات (توزیع drawdown، ریسک ورشکستگی) | ابزارهای مستقل؛ QuantConnect آن را داخلی ندارد | دید واقعی از بدترین حالت | لیست معاملات بک‌تست | S | Medium |
| تشخیص lookahead bias و تفاوت recursive اندیکاتورها | Freqtrade (`lookahead-analysis`، `recursive-analysis`) | جلوگیری از بک‌تست‌های دروغین | اجرای مجدد بک‌تست برای هر سیگنال | M | Medium |
| مدل‌سازی کارمزد/slippage/funding و بک‌تست تیکی | MT5 (Every tick)، Freqtrade | TradingView در این بخش ضعیف گزارش شده | تیک/۱m + جدول کارمزد صرافی | M | High |

## ۷) ژورنال معاملات و تحلیل عملکرد

| Feature | Who offers it | Why valuable | Data needed | Complexity S/M/L | Priority |
|---|---|---|---|---|---|
| Auto-import معاملات از صرافی (API فقط-خواندنی) و از MT5 | TradeZella (۵۰۰+ بروکر، ادعای خودش)، Tradervue، Edgewonk (MT sync) | ژورنال بدون ورود دستی؛ ابزار نگه‌دارنده‌ی کاربر | API key فقط‌خواندنی / فایل CSV / گزارش MT5 | M | High |
| تگ‌گذاری setup، احساس، اشتباه + «هزینه‌ی اشتباه» به دلار | Edgewonk (tiltmeter، mistake-cost)، TradeZella | تبدیل رفتار به عدد؛ قوی‌ترین عامل بهبود معامله‌گر | داده‌ی معاملات + تگ کاربر | S | High |
| داشبورد آمار (win rate، expectancy، profit factor، R-multiple، بر اساس روز/ساعت/setup) | همه‌ی ژورنال‌ها | شناخت لبه‌ی واقعی | معاملات | S | High |
| Playbook / چک‌لیست قبل از معامله و امتیاز انضباط | TradeZella، Edgewonk | پیروی از برنامه | — | S | Medium |
| بازپخش معامله روی چارت (ورود/خروج روی کندل‌ها) + خلاصه‌ی AI | TradeZella | اتصال ژورنال به چارت؛ مزیت طبیعی ما چون چارت داریم | معاملات + OHLCV | S | High |

## ۸) مدیریت ریسک

| Feature | Who offers it | Why valuable | Data needed | Complexity S/M/L | Priority |
|---|---|---|---|---|---|
| Position size calculator روی چارت (درگ کردن SL/TP → حجم بر اساس ٪ ریسک و اهرم، قیمت لیکوئید شدن) | ابزارهای مستقل، ترمینال‌های صرافی | جلوگیری از بزرگ‌ترین خطای مبتدی‌ها | موجودی + قیمت + قوانین margin صرافی | S | High |
| Risk-of-ruin / شبیه‌سازی Monte Carlo از روی آمار ژورنال | ابزارهای مستقل | تصمیم‌گیری درباره‌ی ٪ ریسک هر معامله | win rate، payoff، ٪ ریسک | S | Medium |
| Correlation matrix نمادها (rolling) | Portfolio Visualizer و ابزارهای پایتونی (؟) | در کرش، همبستگی کریپتوها به ۱ نزدیک می‌شود؛ تنوع ظاهری را نشان می‌دهد | بازده‌های OHLCV | S | Medium |
| نمای exposure پورتفو (net long/short بر حسب USD در همه‌ی صرافی‌ها، اهرم مؤثر) | ترمینال‌های حرفه‌ای | دید یکپارچه چند صرافی | API فقط‌خواندنی پوزیشن‌ها | M | Medium |
| قوانین محافظ (حداکثر ضرر روزانه، قفل معامله پس از N ضرر) | Edgewonk (tilt)، برخی prop-firm ابزارها | جلوگیری از revenge trading | پوزیشن/معاملات | S | Medium |

## ۹) هشدار، اتوماسیون و ربات‌ها

| Feature | Who offers it | Why valuable | Data needed | Complexity S/M/L | Priority |
|---|---|---|---|---|---|
| هشدار بومی Telegram (و Bale/Eitaa برای ایران) بدون نیاز به relay | TradingView فقط webhook عمومی دارد؛ کاربران relay خودشان را می‌سازند | تلگرام کانال اصلی معامله‌گران ایرانی است | Bot API تلگرام + موتور هشدار سمت سرور | S | High |
| هشدار روی داده‌ی غیرقیمتی (funding، OI، لیکوئیدیشن، CVD، اسپرد بین صرافی‌ها) | Coinglass (alerts در پلن پولی) | هشدارهایی که TradingView نمی‌تواند | داده‌های بخش ۳ | M | High |
| Grid bot (spot/futures، infinity grid) | Pionex (۱۶ ربات داخلی)، 3Commas | محبوب در بازار رنج؛ درآمد اشتراک | API معاملاتی صرافی | L | Medium |
| DCA bot با safety orders و TP | 3Commas (محصول اصلی)، Pionex | استراتژی رایج کاربران خرد | API معاملاتی | L | Medium |
| Signal bot: اجرای سیگنال از هشدارهای خود ترمینال/webhook | 3Commas، TrendSpider (SignalStack) | پل تحلیل به اجرا | API معاملاتی | M | Medium |
| Trailing / TWAP / سفارش‌های شرطی سمت سرور | 3Commas SmartTrade، Pionex | سفارش‌هایی که صرافی بومی ندارد (مثلاً نوبیتکس) | API معاملاتی | M | Medium |
| Copy trading / دنبال کردن سیگنال‌دهنده با رکورد تأییدشده | Bybit/OKX/Binance copy trading، 3Commas marketplace | جذب کاربر؛ ولی ریسک حقوقی و اعتماد بالاست | API معاملاتی + رکورد قابل تأیید | L | Low |

> هشدار امنیتی: هر قابلیتی که API key معاملاتی کاربر را نگه می‌دارد باید کلید را رمزنگاری‌شده نگه دارد، مجوز برداشت را رد کند، و IP whitelist را توصیه کند.

## ۱۰) چندصرافی و آربیتراژ

| Feature | Who offers it | Why valuable | Data needed | Complexity S/M/L | Priority |
|---|---|---|---|---|---|
| چارت اسپرد بین دو نماد/صرافی (مثلاً BTCUSDT بایننس منهای BTCUSDT بای‌بیت، یا BTC نوبیتکس به تومان ÷ قیمت USDT تومانی) | LuxAlgo Arbitrage Matrix (اسکریپت)، اسکریپت‌های جامعه | TradingView فقط با فرمول نماد محدود این را می‌دهد؛ برای ایران «پرمیوم تتر/BTC داخلی» بسیار مهم است | تیکر/OHLCV چند صرافی هم‌زمان | S | High |
| ماتریس قیمت یک دارایی در همه‌ی صرافی‌ها + آربیتراژ funding | LuxAlgo، ابزارهای ترمینالی مثل wangr | فرصت‌یابی | تیکر + funding چند صرافی | M | Medium |
| قیمت/حجم تجمیعی (aggregated) از چند صرافی در یک چارت | Exocharts (داده‌ی چند صرافی)، Coinglass | حجم واقعی بازار، نه یک صرافی | تریدها/OHLCV چند صرافی | M | Medium |

## ۱۱) آپشن (برای فاز بعدی / MT5 و Deribit)

| Feature | Who offers it | Why valuable | Data needed | Complexity S/M/L | Priority |
|---|---|---|---|---|---|
| Risk profile / نمودار P&L استراتژی چندپایه با خطوط تاریخ و تغییر IV | thinkorswim (Analyze tab) | ستون اصلی معامله‌ی آپشن | زنجیره‌ی آپشن + مدل قیمت‌گذاری (Black-Scholes) | M | Low |
| Probability cone / بازه‌ی قیمت مورد انتظار بر اساس IV، احتمال سود | thinkorswim (Probability Analysis) | — | IV | S | Low |
| Strategy builder و بک‌تست آپشن بدون کد | Option Alpha | — | تاریخچه‌ی آپشن (گران) | L | Low |

> برای کاربر ایرانی آپشن کریپتو (Deribit/OKX/Bybit) در اولویت پایین است؛ فقط «مخروط احتمال بر اساس volatility» را می‌توان ارزان روی هر نمادی اضافه کرد.

## ۱۲) MetaTrader 5 (فاز فارکس)

| Feature | Who offers it | Why valuable | Data needed | Complexity S/M/L | Priority |
|---|---|---|---|---|---|
| اتصال حساب MT5 (نمایش پوزیشن/معاملات روی چارت، ژورنال خودکار) | MT5، ژورنال‌ها | کاربران فارکس ایرانی روی بروکرهای MT5 هستند | MT5 Python bridge یا MetaApi | M | Medium |
| خروجی استراتژی به EA یا اجرای سیگنال روی MT5 | MT5 EAs | پل تحلیل به اجرا در فارکس | — | L | Low |

## ۱۳) نیازهای اختصاصی بازار ایران (مزیت رقابتی اصلی)

| Feature | Who offers it | Why valuable | Data needed | Complexity S/M/L | Priority |
|---|---|---|---|---|---|
| جفت‌های تومانی نوبیتکس (و صرافی‌های داخلی دیگر مثل Wallex/Ramzinex/Excoino) با نمایش ریال/تومان | خود صرافی‌ها (چارت ساده)؛ TradingView ندارد | کاربر ایرانی با تومان معامله می‌کند | API عمومی نوبیتکس (market data + WebSocket؛ کد ارز `rls` به ریال است، تومان = ریال ÷ ۱۰) | M | High |
| «پرمیوم تتر» / شاخص قیمت دلار ضمنی (USDT تومانی ÷ ۱ و مقایسه با دلار بازار آزاد) | — | نماگر مهم اقتصاد ایران و آربیتراژ داخل/خارج | USDT/IRT نوبیتکس + نرخ دلار tgju | S | High |
| قیمت طلا، سکه، مثقال، دلار بازار آزاد (از tgju) | tgju.org (بدون API رسمی؛ کتابخانه‌های scrape جامعه) | دارایی‌های اصلی سرمایه‌گذاری ایرانیان؛ مقایسه‌ی BTC با سکه | scrape tgju با cache و رعایت قوانین سایت؛ ریسک شکستن scraper | M | High |
| بورس تهران (TSETMC): نمادها، حقیقی/حقوقی، صف خرید/فروش | tsetmc.com، کتابخانه‌ی پایتون `tsetmc-api` | بازار بزرگ داخلی؛ داده‌ی «ورود پول حقیقی» منحصربه‌فرد است | scrape TSETMC (گاهی 403 → retry) | L | Medium |
| تقویم جلالی در محور زمان، تاریخ‌ها و Date-picker؛ تعطیلات ایران؛ جلسه‌ی معاملاتی بورس تهران | — | تجربه‌ی بومی | کتابخانه‌ی تبدیل تاریخ (`Intl.DateTimeFormat('fa-IR-u-ca-persian')` بومی مرورگر) | S | High |
| رابط کامل RTL فارسی، فونت فارسی (Vazirmatn)، اعداد فارسی اختیاری | — | TradingView رابط فارسی کامل و بومی ندارد | — | M | High |
| کارکرد در شرایط تحریم/فیلترینگ: پروکسی سمت سرور برای API صرافی‌های خارجی، بدون وابستگی به CDNهای مسدود | — | بدون این، بقیه‌ی قابلیت‌ها برای کاربر ایرانی کار نمی‌کنند | سرور relay خارج از ایران | M | High |
| پرداخت ریالی اشتراک | — | کاربر ایرانی کارت بین‌المللی ندارد | درگاه پرداخت داخلی | S | High |

---

## اولویت‌بندی پیشنهادی (۱۵ مورد برتر)

1. **داده‌ی مشتقات به‌صورت اندیکاتور زیر چارت** (OI، funding، long/short، فید لیکوئیدیشن) — داده‌ی رایگان صرافی، S، بیشترین ارزش به ازای تلاش.
2. **جفت‌های تومانی نوبیتکس + چارت پرمیوم تتر/اسپرد داخل و خارج** — تمایز اصلی بازار ایران.
3. **طلا/سکه/دلار از tgju** در کنار کریپتو.
4. **تقویم جلالی + RTL کامل + کارکرد ضدفیلتر** — پایه‌ی محصول برای ایران.
5. **هشدار بومی تلگرام** (و بله) + هشدار روی funding/OI/اسپرد.
6. **Footprint/cluster چارت + stacked imbalance.**
7. **CVD (جدا برای spot و perp) با واگرایی.**
8. **Heatmap نقدینگی دفتر سفارش.**
9. **TPO/Market Profile و composite volume profile.**
10. **Liquidation heatmap تخمینی** (با برچسب صریح «تخمین»).
11. **Position-size calculator روی چارت** با قیمت لیکوئید شدن.
12. **ژورنال خودکار** با import از API صرافی، تگ اشتباه، و بازپخش معامله روی چارت.
13. **Auto trendlines / S&R + overlay چندتایم‌فریم بدون کد.**
14. **بک‌تست بدون کد + walk-forward + کارمزد/slippage واقعی** (Monte Carlo و heatmap پارامتر در مرحله‌ی بعد).
15. **اسکنر با زبان طبیعی (فارسی!)** — تبدیل جمله‌ی فارسی به شرط‌های اسکنر با LLM.

مواردی که **فعلاً پیشنهاد نمی‌شوند:** copy trading (ریسک حقوقی/اعتماد)، آپشن کامل، AI Strategy Lab، iceberg detector (کریپتو داده‌ی MBO ندارد)، و داده‌ی آن‌چین پولی (هزینه و مشکل پرداخت از ایران) — این‌ها را بعد از اثبات تقاضا اضافه کنید.

---

## Sources

- [S1] TrendSpider Help — Introduction to TrendSpider: https://help.trendspider.com/kb/overview/introduction-to-trendspider-d59c9fcabbcd8360
- [S2] TrendSpider Blog — Scanning the Markets With Sidekick AI: https://trendspider.com/blog/scanning-the-markets-with-sidekick-ai/
- [S3] TrendSpider Blog — Meet Sidekick: https://trendspider.com/blog/sidekick-trading-ai/
- [S4] Liberated Stock Trader — TrendSpider review: https://www.liberatedstocktrader.com/trendspider-review-automated-stock-trend-analysis/ ؛ ChartingLens — TrendSpider plans: https://chartinglens.com/blog/is-trendspider-worth-it
- [S5] ATAS — Best heatmap trading software 2026 (منبع فروشنده): https://atas.net/blog/best-heatmap-trading-software-2026/ ؛ ATAS heatmap: https://atas.net/de/heatmap
- [S6] ATAS Learn — Volume analysis types, benchmarks, limits: https://learn.atas.net/volume-basics/volume-analysis/types-benchmarks-limits
- [S7] Bookmap Knowledge Base — Iceberg Orders Tracker: https://bookmap.com/knowledgebase/docs/KB-Bookmap-Wiki-Iceberg-Orders-Tracker ؛ Bookmap blog — iceberg orders: https://bookmap.com/blog/how-to-read-and-trade-iceberg-orders-hidden-liquidity-in-plain-sight
- [S8] Exocharts — Features: https://exocharts.com/features.html ؛ Tradingtoolshub review: https://tradingtoolshub.com/review/exocharts/ ؛ TheGodFunded: https://thegodfunded.com/en/tools/exocharts/
- [S9] TradersPost — Pine Script request.footprint() guide: https://blog.traderspost.io/article/pine-script-footprint-requests
- [S10] NexusFi thread on TradingView footprint: https://nexusfi.com/showthread.php?p=910363
- [S11] ForexTester — TradingView alternatives (منبع رقیب): https://forextester.com/blog/it/tradingview-alternatives/ ؛ TradersPost — understanding the TradingView backtester: https://blog.traderspost.io/article/understanding-the-tradingview-backtester
- [S12] Sierra Chart 2019 patch notes (Optimus Futures community): https://community.optimusfutures.com/t/sierra-chart-whats-new-2019-patch-notes/2937 ؛ Sierra Chart: https://www.sierrachart.com
- [S13] CoinGlass homepage: https://www.coinglass.com/ ؛ CryptoRank — what is CoinGlass: https://cryptorank.io/news/feed/bf393-what-is-coinglass-crypto-liquidation-data-explained
- [S14] CryptoQuant glossary: https://docs.cryptoquant.com/guides/glossary ؛ CryptoQuant stablecoin netflow: https://userguide.cryptoquant.com/cryptoquant-metrics/stablecoin/stablecoin-exchange-in-outflow-and-netflow
- [S15] Glassnode Studio — exchange net transfer volume: https://studio.glassnode.com/charts/transactions.TransfersVolumeExchangesNet?a=BTC ؛ Spark — Glassnode vs CryptoQuant vs Nansen: https://www.spark.money/tools/bitcoin-onchain-analytics-comparison
- [S16] Santiment Academy — Weighted sentiment: https://academy.santiment.net/metrics/sentiment-metrics/weighted-sentiment-metrics/ ؛ metrics overview: https://academy.santiment.net/metrics/
- [S17] Schwab — Analyze trades using Risk Profile on thinkorswim: https://www.schwab.com/learn/story/analyze-trades-using-risk-profile-on-thinkorswim ؛ thinkManual Analyze: https://toslc.thinkorswim.com/center/howToTos/thinkManual/Analyze
- [S18] Option Alpha — compare/pricing: https://optionalpha.com/compare ؛ toolbox: https://optionalpha.com/toolbox
- [S19] MetaTrader 5 Help — Strategy Optimization: https://www.metatrader5.com/en/terminal/help/algotrading/strategy_optimization
- [S20] QuantConnect Docs — Walk-forward optimization: https://www.quantconnect.com/docs/v2/writing-algorithms/optimization/walk-forward-optimization ؛ forum on Monte Carlo: https://www.quantconnect.com/forum/discussion/7094
- [S21] Freqtrade Docs — Lookahead analysis: https://www.freqtrade.io/en/stable/lookahead-analysis/ ؛ Backtesting docs: https://codeclimate.com/github/freqtrade/freqtrade/docs/backtesting.md/source
- [S22] TradeZella — Edgewonk vs TradeZella (منبع فروشنده): https://www.tradezella.com/blog/edgewonk-vs-tradezella ؛ TradeZella vs Tradervue: https://www.tradezella.com/blog/tradezella-vs-tradervue ؛ DayTradingz — Edgewonk vs TradeZella: https://daytradingz.com/edgewonk-vs-tradezella/
- [S23] Geekflare — crypto trading bots: https://geekflare.com/crypto-trading-bots/ ؛ Capterra — 3Commas: https://www.capterra.com.sg/software/1077401/3Commas ؛ ToolWorthy — 3Commas: https://www.toolworthy.ai/tool/3commas
- [S24] Quant Nomad — TradingView alerts to Telegram: https://quantnomad.com/how-to-connect-tradingview-alerts-to-telegram-bots-100-free/ ؛ TradingView-Webhook-Bot: https://github.com/vsnz/TradingView-Webhook-Bot
- [S25] LuxAlgo — Arbitrage Matrix: https://www.luxalgo.com/library/indicator/arbitrage-matrix/ ؛ Arbitrage Detector: https://www.luxalgo.com/library/indicator/arbitrage-detector/ ؛ wangr (PyPI): https://pypi.org/project/wangr/
- [S26] Risk-management framework (correlation → 1 in crashes): https://claudeskills.info/skills/agiprolabs/claude-trading-skills/risk-management/
- [S27] Nobitex API docs: https://apidocs.nobitex.ir/ ؛ nobitex MCP server source: https://glama.ai/mcp/servers/@xmannii/nobitex-mcp-server/blob/bd8d253a1306ed7f09745befc05b0d5dc4550888/services/nobitex.service.ts
- [S28] tgju scraper (Python): https://github.com/amirh0ss3in/tgju_api ؛ tgju-api-go: https://pkg.go.dev/github.com/amiranmanesh/tgju-api-go
- [S29] tsetmc-api (Python): https://github.com/mahs4d/tsetmc-api ؛ https://pypi.org/project/tsetmc-api
