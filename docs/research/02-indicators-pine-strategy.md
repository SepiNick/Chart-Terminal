[فارسی](02-indicators-pine-strategy.md) · [English](02-indicators-pine-strategy.en.md)

# ۰۲ — اندیکاتورها، Pine Script و Strategy Tester

> هدف: مستندسازیِ **رفتار** قابلیت‌های TradingView برای بازسازی clean-room. هیچ کد یا متن طولانی از TradingView کپی نشده؛ همه‌چیز بازنویسی شده است.
> تاریخ تحقیق: اکتبر ۲۰۲۶. منابع در انتهای فایل.

راهنمای ستون‌ها:
- **Complexity**: `S` = چند ساعت تا یک روز، `M` = چند روز، `L` = یک هفته یا بیشتر.
- **Priority**: `Core` (بدون آن محصول معنا ندارد)، `High`، `Medium`، `Low`.

---

## ۱. اندیکاتورهای داخلی (Technicals → Indicators)

پوشه‌ی رسمی Built-in indicators در Help Center حدود ۲۰۹ مقاله دارد؛ نزدیک به ۹۰ مورد آن‌ها متریک‌های on-chain کریپتو هستند (بخش ۱.۱۳). بقیه، به‌اضافه‌ی ابزارهایی که در تب‌های Patterns و Volume profile هستند، در جدول‌های زیر آمده‌اند. **جمعاً حدود ۱۷۰ اندیکاتور/الگوی غیر on-chain** به‌اضافه‌ی ~۹۰ متریک on-chain.

نکته‌ی رفتاری مشترک: تقریباً همه‌ی اندیکاتورهای کلاسیک در TradingView خودشان به Pine نوشته شده‌اند و سورس‌شان در ادیتور قابل مشاهده است. پس اگر مفسر Pine بسازیم، بخش بزرگی از این کاتالوگ را «مجانی» به‌صورت اسکریپت داریم.

### ۱.۱ Moving averages

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Simple Moving Average (SMA) | میانگین ساده‌ی N کندل آخر | S | Core |
| Exponential Moving Average (EMA) | میانگین با وزن نمایی بیشتر روی داده‌ی جدید | S | Core |
| Weighted Moving Average (WMA) | میانگین با وزن خطی | S | High |
| Smoothed Moving Average (SMMA/RMA) | میانگین هموار به سبک Wilder | S | High |
| Double EMA (DEMA) | ترکیب EMA و EMA-of-EMA برای کاهش تأخیر | S | Medium |
| Triple EMA (TEMA) | نسخه‌ی سه‌لایه برای تأخیر کمتر | S | Medium |
| Hull Moving Average (HMA) | میانگین سریع و نرم با WMA تودرتو | S | High |
| Arnaud Legoux MA (ALMA) | میانگین با پنجره‌ی گاوسی و offset قابل تنظیم | S | Medium |
| Kaufman's Adaptive MA (KAMA) | سرعتش با نسبت کارایی بازار تطبیق می‌یابد | S | Medium |
| McGinley Dynamic | میانگینی که خودش را با سرعت بازار تنظیم می‌کند | S | Low |
| Least Squares MA (LSMA) | انتهای خط رگرسیون خطی هر پنجره | S | Medium |
| Volume-Weighted MA (VWMA) | میانگین وزن‌دار با حجم | S | High |
| Moving Average Ribbon | چند MA هم‌زمان با رنگ‌بندی ریبون | S | Medium |
| MA Cross / MovingAvg Cross / MovingAvg2Line Cross | نمایش دو MA و علامت تقاطع آن‌ها | S | High |
| Moving Averages (multi) | پنل چند MA قابل تنظیم یک‌جا | S | Medium |
| Median | میانه‌ی قیمت در پنجره + باند ATR | S | Low |
| Envelope (ENV) | باند درصدی بالا/پایین یک MA | S | Medium |
| Linear Regression (Curve) | منحنی رگرسیون خطی متحرک | S | Medium |
| Multi-Time Period Charts | سطح high/low/open تایم‌فریم بالاتر روی چارت | M | Low |

### ۱.۲ Trend

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Average Directional Index (ADX) | قدرت روند بدون جهت | S | High |
| Directional Movement (DMI) | +DI/-DI و ADX با هم | S | High |
| Aroon Indicator | زمان از آخرین سقف/کف N کندل | S | Medium |
| Aroon Oscillator | تفاضل Aroon Up و Down | S | Low |
| Parabolic SAR | نقاط توقف دنباله‌دار شتاب‌دار | S | High |
| Supertrend | خط ATR-محور که با جهت روند رنگ عوض می‌کند | S | Core |
| Ichimoku Cloud | Tenkan/Kijun/Senkou A,B/Chikou با ابر جابجاشده به آینده | M | High |
| Vortex Indicator | دو خط VI+ و VI- برای تشخیص شروع روند | S | Low |
| Chande Kroll Stop | استاپ‌های مبتنی بر ATR برای لانگ و شورت | S | Low |
| Chandelier Exit | استاپ خروج از بیشترین سقف منهای ضریب ATR | S | Medium |
| Volatility Stop | استاپ دنباله‌دار بر اساس ATR | S | Low |
| Trend Strength Index | همبستگی قیمت با زمان به‌عنوان قدرت روند | S | Low |
| Chop Zone | رنگ‌بندی زاویه‌ی EMA برای ناحیه‌ی رنج/روند | S | Low |
| Choppiness Index (CHOP) | سنجش رنج‌بودن بازار | S | Low |
| BBTrend | قدرت روند از فاصله‌ی دو Bollinger | S | Low |
| Williams Alligator | سه SMMA جابجاشده (فک/دندان/لب) | S | Medium |
| Coppock Curve | مومنتوم بلندمدت از ROCهای وزن‌دار | S | Low |
| Know Sure Thing (KST) | ترکیب چهار ROC هموار | S | Low |
| Mass Index | تشخیص برگشت از گسترش رنج | S | Low |
| Zig Zag | اتصال پیوت‌های بالا/پایین با حداقل انحراف | M | High |
| Auto Trendlines | رسم خودکار خطوط روند روی پیوت‌ها | L | Medium |
| Auto Pitchfork | رسم خودکار Andrews pitchfork | M | Low |
| Auto Key Levels | سطوح کلیدی حمایت/مقاومت خودکار | M | Medium |

### ۱.۳ Momentum / Oscillators

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Relative Strength Index (RSI) | اسیلاتور ۰ تا ۱۰۰ با RMA سود/زیان | S | Core |
| RSI Divergence | علامت‌گذاری خودکار واگرایی RSI با قیمت | M | Medium |
| Stochastic (STOCH) | موقعیت close در رنج N کندل (%K/%D) | S | Core |
| Stochastic RSI | استوکاستیک روی مقدار RSI | S | High |
| Stochastic Momentum Index (SMI) | استوکاستیک نسبت به میانه‌ی رنج | S | Low |
| MACD | تفاضل دو EMA + سیگنال + هیستوگرام | S | Core |
| Percentage Price Oscillator (PPO) | MACD به درصد | S | Low |
| Price Oscillator | تفاضل دو MA | S | Low |
| Price Momentum Oscillator (PMO) | ROC دوبار هموارشده | S | Low |
| Commodity Channel Index (CCI) | انحراف قیمت تیپیکال از میانگین | S | High |
| Woodies CCI | CCI با turbo CCI و هیستوگرام | S | Low |
| Momentum | close امروز منهای close N کندل قبل | S | Medium |
| Rate of Change (ROC) | تغییر درصدی در N کندل | S | Medium |
| Awesome Oscillator (AO) | تفاضل SMA 5 و 34 از median price | S | Medium |
| Accelerator Oscillator (AC) | AO منهای SMA خودش | S | Low |
| Williams %R | معکوس استوکاستیک در بازه‌ی ۰ تا ‑۱۰۰ | S | Medium |
| Ultimate Oscillator (UO) | ترکیب سه بازه‌ی زمانی فشار خرید | S | Low |
| TRIX | ROC یک EMA سه‌لایه | S | Low |
| True Strength Index (TSI) | مومنتوم دوبار هموارشده | S | Low |
| Chande Momentum Oscillator (CMO) | سود منهای زیان تقسیم بر مجموع | S | Low |
| Connors RSI (CRSI) | میانگین RSI، streak RSI و percent rank | S | Low |
| Detrended Price Oscillator (DPO) | حذف روند برای دیدن سیکل‌ها | S | Low |
| Fisher Transform | تبدیل قیمت به توزیع نزدیک گاوسی | S | Low |
| Relative Vigor Index (RVI) | مقایسه‌ی close-open با high-low | S | Low |
| Balance of Power (BOP) | قدرت خریدار در برابر فروشنده در هر کندل | S | Low |
| Bull Bear Power | فاصله‌ی high/low با EMA | S | Low |
| SMI Ergodic Indicator / Oscillator | نسخه‌ی TSI با خط سیگنال | S | Low |
| Pring's Special K | ترکیب ROCهای متعدد برای سیکل | S | Low |
| Rank Correlation Index (RCI) / RCI Ribbon | همبستگی رتبه‌ای قیمت و زمان | S | Low |
| Correlation Coefficient | همبستگی با نماد دیگر (نیاز به request.security) | M | Medium |
| Performance | بازده درصدی در بازه‌های مختلف | S | Low |
| Technical Ratings | خلاصه‌ی خرید/فروش از ترکیب MAها و اسیلاتورها | M | Medium |

### ۱.۴ Volatility

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Bollinger Bands (BB) | SMA ± k انحراف معیار | S | Core |
| Bollinger Bands %b | موقعیت قیمت داخل باند | S | Medium |
| Bollinger BandWidth (BBW) | پهنای نسبی باند | S | Medium |
| Bollinger Bars | کندل‌های رنگی بر اساس باند | S | Low |
| Keltner Channels (KC) | EMA ± ضریب ATR | S | High |
| Donchian Channels (DC) | بالاترین high و پایین‌ترین low در N کندل | S | High |
| Average True Range (ATR) | میانگین True Range | S | Core |
| Average Daily Range (ADR) | میانگین رنج روزانه | S | Low |
| Historical Volatility | انحراف معیار سالانه‌شده‌ی بازده لگاریتمی | S | Medium |
| Relative Volatility Index | RSI روی انحراف معیار | S | Low |
| Ulcer Index | عمق و مدت افت از سقف | S | Low |
| Standard Deviation | انحراف معیار قیمت | S | Medium |

### ۱.۵ Volume

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Volume | ستون حجم رنگ‌شده با جهت کندل + MA | S | Core |
| On Balance Volume (OBV) | حجم تجمعی با علامت تغییر قیمت | S | High |
| Accumulation/Distribution (ADL) | جریان پول تجمعی بر اساس موقعیت close | S | Medium |
| Chaikin Money Flow (CMF) | ADL نرمال‌شده در پنجره | S | Medium |
| Chaikin Oscillator | MACD روی ADL | S | Low |
| Money Flow Index (MFI) | RSI حجم‌دار | S | High |
| Volume Weighted Average Price (VWAP) | میانگین قیمت وزن‌دار با حجم، ری‌ست در هر session/دوره + باندها | M | Core |
| VWAP Auto Anchored | VWAP با لنگر خودکار (مثلاً آخرین پیوت) | M | Medium |
| Time Weighted Average Price (TWAP) | میانگین زمانی قیمت در هر دوره | S | Low |
| Visible Average Price | میانگین قیمت فقط در محدوده‌ی قابل مشاهده‌ی چارت | M | Low |
| Elder's Force Index (EFI) | تغییر قیمت ضرب در حجم | S | Low |
| Ease of Movement (EOM) | رابطه‌ی تغییر قیمت و حجم | S | Low |
| Klinger Oscillator | جریان حجم بلند و کوتاه‌مدت | S | Low |
| Net Volume | حجم خرید منهای فروش تقریبی | S | Low |
| Price Volume Trend (PVT) | حجم تجمعی وزن‌دار با درصد تغییر | S | Low |
| Positive / Negative Volume Index (PVI/NVI) | تغییرات قیمت در روزهای حجم بالا/پایین | S | Low |
| Percentage Volume Oscillator (PVO) | PPO روی حجم | S | Low |
| Volume Oscillator | تفاضل دو MA حجم | S | Low |
| Cumulative Volume Index (CVI) | خط breadth از حجم صعودی/نزولی | S | Low |
| Up/Down Volume | تفکیک حجم صعودی و نزولی (از داده‌ی intrabar) | M | Medium |
| Volume Delta | دلتای حجم هر کندل از intrabar | M | Medium |
| Cumulative Volume Delta (CVD) | دلتای تجمعی در هر دوره | M | Medium |
| Relative Volume at Time | حجم فعلی در برابر میانگین همان ساعت روزهای قبل | M | Low |
| 24-hour Volume | حجم ۲۴ ساعته‌ی کریپتو | S | Low |

### ۱.۶ Volume profiles

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Visible Range Volume Profile (VRVP/VPVR) | هیستوگرام حجم-در-قیمت برای بازه‌ی قابل مشاهده؛ با اسکرول بازمحاسبه می‌شود | L | High |
| Fixed Range Volume Profile | پروفایل بین دو نقطه‌ی زمانی که کاربر می‌کشد (ابزار ترسیم) | L | High |
| Anchored Volume Profile | پروفایل از یک لنگر تا آخرین کندل (ابزار ترسیم) | M | Medium |
| Session Volume Profile (و HD) | یک پروفایل جدا برای هر session | L | Medium |
| Periodic Volume Profile | پروفایل برای هر دوره‌ی ثابت (روز/هفته/...) | L | Medium |
| Auto Anchored Volume Profile | لنگر خودکار (مثلاً highest/lowest یا session) | M | Low |
| اجزای مشترک | POC، Value Area (معمولاً ۷۰٪)، VAH/VAL، تفکیک up/down volume، row size (تعداد ردیف یا ticks per row) | — | — |

نکته‌ی پیاده‌سازی: همه‌ی پروفایل‌ها به داده‌ی intrabar (تایم‌فریم پایین‌تر) نیاز دارند تا حجم را درست روی سطوح قیمت پخش کنند. TradingView در Pine هم `request.footprint()` و نوع‌های `footprint`/`volume_row` (ژانویه ۲۰۲۶) را برای این کار اضافه کرده است.

### ۱.۷ Bill Williams

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Williams Alligator | سه SMMA جابجاشده | S | Medium |
| Williams Fractals | علامت پیوت ۵-کندلی بالا/پایین | S | Medium |
| Awesome Oscillator | SMA5 − SMA34 روی hl2 | S | Medium |
| Accelerator Oscillator | AO − SMA5(AO) | S | Low |
| Market Facilitation Index | رنج تقسیم بر حجم (اختیاری) | S | Low |

### ۱.۸ Breadth / Market internals

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Advance/Decline Line | تفاضل تجمعی سهام صعودی و نزولی (نماد بازار) | M | Low |
| Advance/Decline Ratio | نسبت صعودی‌ها به نزولی‌ها | M | Low |
| Advance/Decline Ratio (Bars) | همان نسبت روی کندل‌های یک نماد | S | Low |
| Seasonality | مقایسه‌ی عملکرد سال‌های مختلف روی یک محور | M | Low |
| Moon Phases | علامت ماه کامل/نو روی چارت | S | Low |
| Trading Sessions | سایه‌زنی session‌های آسیا/لندن/نیویورک | S | Medium |
| Pivot Points Standard | پیوت‌های Traditional/Fibonacci/Woodie/Classic/DM/Camarilla روی تایم‌فریم بالاتر | M | High |
| Pivot Points High Low | برچسب پیوت‌های محلی با طول چپ/راست | S | Medium |
| Rob Booker (۶ مورد) | Intraday/Missed/Ziv Ghost pivots، ADX Breakout، Knoxville Divergence، Reversal | S–M | Low |
| Auto Fib Retracement | سطوح فیبوناچی خودکار بین آخرین swing (بر پایه‌ی زیگزاگ) | M | High |
| Auto Fib Extension | اکستنشن فیبوناچی خودکار سه‌نقطه‌ای | M | Medium |
| Analyst price forecast / Price target | پیش‌بینی قیمت تحلیل‌گران (داده‌ی بنیادی) | M | Low |
| Dividend Yield | بازده سود نقدی (داده‌ی بنیادی) | M | Low |
| Power-Law Model | مدل قانون توان برای قیمت بلندمدت | S | Low |

### ۱.۹ مشتقات کریپتو (futures data)

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Open Interest | تعداد قراردادهای باز | M | Medium |
| Funding rate | نرخ تأمین مالی perpetual | M | Medium |
| Basis / Premium | فاصله‌ی قیمت futures با spot/index | S | Low |
| Mark price / Index price | قیمت مرجع صرافی | S | Low |
| Long/Short ratio (Accounts, Top traders: ۶ مورد) | نسبت حساب‌ها/پوزیشن‌های لانگ به شورت | M | Low |
| Liquidation data | حجم لیکوییدیشن‌ها | M | Low |

### ۱.۱۰ Candlestick patterns (Technicals → Patterns)

رفتار: هر الگو یک اندیکاتور جداست؛ روی کندل برچسب کوچک می‌گذارد (آبی=bullish، قرمز=bearish، خاکستری=دوطرفه). ورودی مشترک: تشخیص روند قبلی با SMA50 یا SMA50+SMA200 یا بدون فیلتر. همه با منطق ساده‌ی اندازه‌ی بدنه/سایه پیاده می‌شوند.

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| All Candlestick Patterns | همه‌ی الگوها در یک اندیکاتور با چک‌باکس | M | High |
| Abandoned Baby (Bull/Bear) | گپ دوطرفه دور یک doji | S | Low |
| Dark Cloud Cover / Piercing | برگشت دوکندلی نزولی/صعودی | S | Medium |
| Doji، Dragonfly Doji، Gravestone Doji | بدنه‌ی تقریباً صفر با انواع سایه | S | High |
| Doji Star (Bull/Bear) | doji بعد از کندل بلند با گپ | S | Low |
| Engulfing (Bull/Bear) | بدنه‌ی کندل دوم کاملاً اولی را می‌پوشاند | S | High |
| Evening Star / Evening Doji Star | برگشت نزولی سه‌کندلی | S | Medium |
| Morning Star / Morning Doji Star | برگشت صعودی سه‌کندلی | S | Medium |
| Hammer / Inverted Hammer | سایه‌ی بلند پایین/بالا بعد از روند نزولی | S | High |
| Hanging Man / Shooting Star | همان شکل‌ها بعد از روند صعودی | S | High |
| Harami / Harami Cross (Bull/Bear) | کندل دوم داخل بدنه‌ی اولی | S | Medium |
| Kicking (Bull/Bear) | دو marubozu مخالف با گپ | S | Low |
| Long Lower / Upper Shadow | سایه‌ی بلند یک‌طرفه | S | Low |
| Marubozu (Black/White) | کندل بدون سایه | S | Low |
| On Neck | ادامه‌ی نزولی دوکندلی | S | Low |
| Rising / Falling Three Methods | الگوی ادامه‌ی پنج‌کندلی | S | Low |
| Rising / Falling Window | گپ ادامه‌دهنده | S | Low |
| Spinning Top (Black/White) | بدنه‌ی کوچک با دو سایه | S | Low |
| Three White Soldiers / Three Black Crows | سه کندل هم‌جهت قوی | S | Medium |
| Tri-Star (Bull/Bear) | سه doji با گپ | S | Low |
| Tweezer Top / Bottom | دو کندل با high/low برابر | S | Low |
| Upside / Downside Tasuki Gap | گپ ادامه‌ی سه‌کندلی | S | Low |

(حدود ۴۲ الگو در مجموع، با احتساب نسخه‌های Bull/Bear جدا.)

### ۱.۱۱ Chart patterns (auto)

رفتار: در تب Patterns؛ فقط آخرین ~۶۰۰ کندل را اسکن می‌کند؛ تنظیمات از پیش تعیین‌شده؛ برای بررسی گذشته باید از Bar Replay استفاده کرد. الگوها ممکن است با کندل‌های جدید تغییر کنند (repaint).

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| All Chart Patterns | همه‌ی الگوهای کلاسیک در یک اندیکاتور | L | Medium |
| Head and Shoulders / Inverse | سر و شانه با neckline | L | Medium |
| Double Top / Bottom، Triple Top / Bottom | سقف/کف‌های هم‌سطح | M | Medium |
| Ascending / Descending / Symmetrical Triangle | مثلث‌ها از خطوط پیوت | L | Medium |
| Rising / Falling Wedge | گوه | L | Low |
| Bull / Bear Flag، Bull / Bear Pennant | پرچم و پرچم سه‌گوش بعد از حرکت تند | L | Low |
| Rectangle | رنج افقی | M | Low |
| Elliott Wave | شمارش خودکار امواج ۵-۳ | L | Low |

### ۱.۱۲ سایر

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Compare / Overlay symbol | نمایش نماد دیگر روی همان چارت (درصدی) | M | High |
| Ratio / Spread | نسبت یا تفاضل دو نماد | M | Medium |
| Linear Regression Channel | کانال رگرسیون با انحراف معیار | M | Medium |
| Learn using Seasonals | آموزش فصلی‌بودن | — | Low |

### ۱.۱۳ متریک‌های on-chain کریپتو (~۹۰ مورد)

همه یک الگوی رفتاری دارند: «نمایش یک سری زمانی خارجی به‌عنوان اندیکاتور زیر چارت». دسته‌ها: Addresses (active/sending/receiving، addresses with balance ≥ X)، Supply (1y active supply، held tokens ≥ X، supply equality ratio)، Blocks/mining (hash rate، difficulty، block height، block size/interval)، Transactions (fees، gas، transfer count/rate/volume، large transactions)، UTXO (created/spent/value)، Valuation (realized cap، SOPR، RVT، Stock-to-Flow)، Ethereum staking (deposits، value staked)، ETF flows/balances، El Salvador balance.

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Generic "external series" indicator | یک موتور برای نمایش هر سری on-chain/بنیادی | M | Low |

---

## ۲. استراتژی‌های داخلی (Technicals → Strategies) — ۲۰ مورد

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| BarUpDn Strategy | ورود در جهت کندل فعلی وقتی open با close قبلی گپ دارد | S | Medium |
| Bollinger Bands Strategy | ورود وقتی قیمت از باند به داخل برمی‌گردد | S | High |
| Bollinger Bands Strategy Directed | همان، فقط در یک جهت انتخابی | S | Low |
| Channel BreakOut Strategy | stop order روی شکست سقف/کف N کندل | S | Medium |
| Consecutive Up/Down Strategy | ورود بعد از X کندل صعودی/نزولی متوالی (پیش‌فرض ۳) | S | Medium |
| Greedy Strategy | ورود روی گپ و افزودن پله‌ای (pyramiding) | S | Low |
| InSide Bar Strategy | ورود بر اساس inside bar | S | Low |
| Keltner Channels Strategy | شکست کانال Keltner | S | Medium |
| MACD Strategy | تقاطع هیستوگرام MACD با صفر | S | High |
| Momentum Strategy | stop order در جهت مومنتوم مثبت/منفی | S | Medium |
| OutSide Bar Strategy | ورود بر اساس outside bar | S | Low |
| Parabolic SAR Strategy | stop در سطح SAR بعدی (همیشه در بازار) | S | Medium |
| Pivot Extension Strategy | معامله‌ی برگشتی روی پیوت‌ها | S | Low |
| Pivot Reversal Strategy | stop order روی شکست آخرین pivot high/low | S | Medium |
| Price Channel Strategy | شکست کانال high/low | S | Low |
| RSI Strategy | ورود وقتی RSI از اشباع خرید/فروش برمی‌گردد | S | Core |
| Stochastic Slow Strategy | تقاطع %K/%D در نواحی اشباع | S | Medium |
| Supertrend Strategy | ورود/برگشت با تغییر جهت Supertrend | S | High |
| Technical Ratings Strategy | معامله بر اساس سیگنال Technical Ratings | M | Low |
| Volty Expan Close Strategy | stop order با فاصله‌ی ضریبی از ATR | S | Low |

نکته: «فقط یک استراتژی در هر زمان روی یک چارت اجرا می‌شود» (رفتار فعلی Strategy Report).

---

## ۳. زبان Pine Script v6

### ۳.۱ ساختار اسکریپت

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| `//@version=6` | انتخاب نسخه‌ی کامپایلر؛ بدون آن نسخه‌ی قدیمی فرض می‌شود | S | Core |
| Declaration: `indicator()` / `strategy()` / `library()` | نوع اسکریپت و تنظیمات کلی (overlay، precision، format، max_*_count، max_bars_back، timeframe، calc_bars_count، behind_chart) | M | Core |
| Comments و annotationها | `//`، `//@function`، `//@param`، `//@returns`، `//@strategy_alert_message` | S | Medium |
| Line wrapping | ادامه‌ی خط با تورفتگی غیرمضرب ۴؛ رشته‌ی چندخطی (۲۰۲۶) | S | High |
| Indentation-based blocks | بلاک‌ها با تورفتگی ۴ فاصله/tab تعریف می‌شوند (مثل Python) | M | Core |

### ۳.۲ سیستم نوع (Type system)

دو محور مستقل دارد: **qualifier** (زمانِ مشخص‌شدن مقدار) و **type** (نوع داده).

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Qualifiers: `const` < `input` < `simple` < `series` | const = زمان کامپایل؛ input = از تنظیمات؛ simple = در bar صفر ثابت؛ series = هر bar ممکن است تغییر کند. قانون: qualifier قوی‌تر جای ضعیف‌تر نمی‌نشیند | L | Core |
| Fundamental types: `int`، `float`، `bool`، `color`، `string` | int به‌صورت خودکار به float تبدیل می‌شود؛ در v6 تبدیل ضمنی int/float به bool حذف شد | M | Core |
| `na` | مقدار «موجود نیست» برای int/float/color/string و ارجاع‌ها؛ در v6 bool دیگر na نمی‌گیرد | M | Core |
| Special types: `plot`، `hline`، `line`، `label`، `box`، `table`، `linefill`، `polyline`، `chart.point` | handle به اشیای نمایشی | M | Core |
| `void` | نوع بازگشتی توابع بدون خروجی | S | Core |
| Tuples `[a, b] = f()` | بازگرداندن چند مقدار | S | Core |
| `array<T>` | آرایه‌ی پویا (تا ۱۰۰٬۰۰۰ عنصر)؛ اندیس منفی در v6 | M | High |
| `matrix<T>` | ماتریس دوبعدی با عملیات جبر خطی (inv، det، eigen، mult…) | L | Medium |
| `map<K, V>` | دیکشنری با ترتیب درج (تا ۵۰٬۰۰۰ جفت)؛ کلید فقط از نوع پایه | M | Medium |
| User-defined types (`type`) | ساخت struct با فیلد و مقدار پیش‌فرض؛ `.new()`، `.copy()`؛ رفتار reference | L | High |
| Methods (`method`) | توابعی که با سینتکس `obj.fn()` روی نوع خاص صدا زده می‌شوند؛ built-in methods برای array/matrix/map/line/... | M | High |
| Enums (`enum`) | نوع شمارشی با فیلد و عنوان؛ `input.enum()` برای dropdown (ژوئن ۲۰۲۴) | M | Medium |
| Type casting | `int()`، `float()`، `bool()`، `color()`، `string()`، `line()`… | S | Core |
| `footprint` / `volume_row` | داده‌ی footprint از `request.footprint()` (۲۰۲۶) | L | Low |

### ۳.۳ متغیرها و کنترل جریان

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Declaration `x = …` | تعریف متغیر؛ هر bar دوباره مقداردهی اولیه می‌شود | S | Core |
| Reassignment `:=` و `+= -= *= /= %=` | تغییر مقدار متغیر موجود | S | Core |
| `var` | فقط یک‌بار (bar اول) مقداردهی؛ مقدار بین barها حفظ می‌شود | M | Core |
| `varip` | مثل var ولی بین tickهای realtime هم rollback نمی‌شود | M | Medium |
| Type keyword صریح `float x = na` | تعیین نوع وقتی از مقدار قابل حدس نیست | S | Core |
| History operator `x[n]` | مقدار n bar قبل (بافر تاریخچه‌ی ۵۰۰۰ / ۱۰۰۰۰) | L | Core |
| `if / else if / else` | هم statement هم expression (مقدار برمی‌گرداند) | S | Core |
| `switch` (با/بدون عبارت) | انتخاب چند-شاخه، expression | S | High |
| `for i = a to b by s` | حلقه‌ی شمارشی؛ مرز پایانی هر تکرار ارزیابی می‌شود (۲۰۲۵) | S | Core |
| `for x in arr` / `for [i, x] in arr` | پیمایش آرایه/ماتریس/map | S | High |
| `while` | حلقه‌ی شرطی | S | High |
| `break` / `continue` | کنترل حلقه | S | High |
| Ternary `c ? a : b` | شرط درون‌خطی | S | Core |
| Operators | حسابی، مقایسه‌ای، `and`/`or`/`not` (short-circuit در v6)، `[]` | S | Core |
| `once` | بلاک شرطی که فقط یک‌بار اجرا می‌شود (اوت ۲۰۲۶) | S | Low |

### ۳.۴ توابع، کتابخانه‌ها، namespaceها

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| User functions `f(x, y) => …` | تک‌خطی یا چندخطی؛ پارامتر پیش‌فرض؛ نوع پارامتر اختیاری | M | Core |
| Overloading | چند تابع هم‌نام با امضای متفاوت | M | Medium |
| Function scope rules | توابع کاربر global هستند؛ تابع تودرتو/بازگشتی مجاز نیست؛ هر call-site تاریخچه‌ی جدای خودش را دارد | L | Core |
| `library()` + `export` | انتشار توابع، typeها، methodها، enumها و ثابت‌ها (۲۰۲۵) | L | Medium |
| `import user/lib/version as alias` | استفاده از کتابخانه‌ی منتشرشده با نسخه‌ی مشخص | L | Medium |
| Namespaces | `ta`، `math`، `str`، `array`، `matrix`، `map`، `request`، `input`، `strategy`، `syminfo`، `timeframe`، `ticker`، `color`، `chart`، `barstate`، `session`، `log`، `runtime`، `label`، `line`، `box`، `table`، `polyline`… | — | — |

### ۳.۵ built-inهای کلیدی

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Built-in series | `open high low close volume time time_close bar_index last_bar_index hl2 hlc3 ohlc4 hlcc4` | S | Core |
| `barstate.*` | isfirst، islast، ishistory، isrealtime، isnew، isconfirmed، islastconfirmedhistory | S | Core |
| `syminfo.*` | ticker، tickerid، mintick، pointvalue، currency، type، session، timezone و داده‌ی بنیادی | M | High |
| `timeframe.*` | period، multiplier، isintraday/isdaily/…، `in_seconds()`، `change()`، `from_seconds()` | S | High |
| `ta.*` (~۶۰ تابع) | sma، ema، rma، wma، vwma، hma، alma، swma، linreg، rsi، macd، stoch، cci، mfi، atr، tr، bb، bbw، kc، kcw، dmi، sar، supertrend، mom، roc، change، cum، highest/lowest، highestbars/lowestbars، crossover/crossunder/cross، rising/falling، pivothigh/pivotlow، valuewhen، barssince، stdev، variance، dev، median، mode، percentrank، percentile_*، correlation، cog، cmo، tsi، wpr، vwap، obv/accdist/pvt/nvi/pvi/wad/wvad/iii (متغیر)، range، max/min | L | Core |
| `math.*` | abs، max، min، round، round_to_mintick، floor، ceil، pow، sqrt، log، log10، exp، sin…atan، avg، sum، sign، random، todegrees، pi/e/phi | S | Core |
| `str.*` | tostring (با format)، tonumber، format، format_time، length، substring، contains، pos، replace/replace_all، split، upper/lower، startswith/endswith، match (regex)، repeat، trim | M | High |
| `color.*` | ثابت‌ها، `color.new()`، `rgb()`، `from_gradient()`، `r/g/b/t()` | S | Core |
| `input.*` | int، float، bool، string (با options)، color، source، symbol، timeframe، session، time، price، text_area، enum؛ پارامترهای group، inline، tooltip، confirm، display، active | M | Core |
| `request.security()` | گرفتن مقدار یک expression از نماد/تایم‌فریم دیگر با `gaps` و `lookahead` | L | High |
| `request.security_lower_tf()` | آرایه‌ای از مقادیر intrabar | L | Medium |
| `request.*` سایر | currency_rate، dividends، splits، earnings، financial، economic، quandl/seed، footprint؛ در v6 «dynamic» (قابل فراخوانی در حلقه با series string) | L | Low |
| `plot()` | رسم سری (line، stepline، histogram، columns، area، circles، cross، با رنگ پویا، offset، linestyle) | M | Core |
| `plotshape()` / `plotchar()` / `plotarrow()` | علامت روی کندل‌ها | M | Core |
| `plotcandle()` / `plotbar()` | رسم کندل/بار سفارشی | M | Medium |
| `hline()` + `fill()` | خط افقی و رنگ‌آمیزی بین دو plot/hline | S | Core |
| `bgcolor()` / `barcolor()` | رنگ پس‌زمینه / رنگ کندل‌ها | S | Core |
| `label.*` | متن/برچسب در هر نقطه با style، size، tooltip، xloc | M | High |
| `line.*` | پاره‌خط با extend، style، width | M | High |
| `box.*` | مستطیل با متن داخل | M | Medium |
| `table.*` | جدول ثابت روی گوشه‌های چارت (حداکثر ۹) | M | High |
| `linefill.*` | پرکردن بین دو line | S | Low |
| `polyline.*` + `chart.point` | چندضلعی/منحنی از آرایه‌ی نقاط (حداکثر ۱۰۰ شیء) | M | Low |
| `alertcondition()` | تعریف شرط هشدار که کاربر از دیالوگ alert انتخاب می‌کند (فقط indicator) | M | High |
| `alert()` | ارسال هشدار پویا با متن ساخته‌شده در runtime (indicator و strategy) | M | High |
| `log.info/warning/error()` | پیام به پنل Pine Logs با زمان bar | S | Medium |
| `runtime.error()` | توقف اسکریپت با پیام خطا | S | Medium |
| `fixnan()`، `nz()`، `na()` | مدیریت na | S | Core |
| `time()`، `timestamp()`، `year/month/…` ، `session.*` | کار با زمان و session | M | High |
| `ticker.*` | ساخت تیکر Heikin Ashi/Renko/... یا اصلاح‌شده برای request | M | Low |

### ۳.۶ strategy.* API

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| `strategy.entry()` | ورود لانگ/شورت؛ پوزیشن مخالف را خودکار برمی‌گرداند؛ market/limit/stop/stop-limit | L | Core |
| `strategy.order()` | سفارش خام بدون reverse؛ با پوزیشن فعلی net می‌شود | M | High |
| `strategy.exit()` | TP/SL/trailing (trail_price، trail_points، trail_offset)، profit/loss به tick، qty/qty_percent، from_entry؛ سفارش‌ها یک گروه OCA | L | Core |
| `strategy.close()` / `close_all()` | بستن با market | S | Core |
| `strategy.cancel()` / `cancel_all()` | لغو سفارش‌های pending | S | High |
| `strategy.risk.*` | allow_entry_in، max_cons_loss_days، max_drawdown، max_intraday_filled_orders، max_intraday_loss، max_position_size | M | Low |
| `oca_name` / `oca_type` | گروه‌های OCA: cancel، reduce، none | M | Medium |
| متغیرهای وضعیت | position_size، position_avg_price، position_entry_name، equity، netprofit، grossprofit، grossloss، openprofit، max_drawdown، max_runup، wintrades، losstrades، eventrades، initial_capital، margin_liquidation_price، avg_* | M | High |
| `strategy.opentrades.*` / `closedtrades.*` | داده‌ی هر معامله با اندیس (entry/exit price/time/bar/id/comment، profit، commission، max_runup/drawdown، size) | M | High |
| `strategy.convert_to_account/symbol()` | تبدیل ارز | S | Low |
| پارامترهای `strategy()` | initial_capital، currency، default_qty_type (`fixed` / `cash` / `percent_of_equity`)، default_qty_value، pyramiding، commission_type (`percent` / `cash_per_contract` / `cash_per_order`)، commission_value، slippage (tick)، margin_long/short، close_entries_rule (FIFO/ANY)، calc_on_order_fills، calc_on_every_tick، calc_on_every_history_tick (۲۰۲۶)، process_orders_on_close، use_bar_magnifier، fill_orders_on_standard_ohlc، backtest_fill_limits_assumption، risk_free_rate | L | Core |

### ۳.۷ مدل اجرا (Execution model)

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Bar-by-bar execution | کل اسکریپت یک‌بار برای هر کندل تاریخی از چپ به راست اجرا می‌شود؛ هر سری یک بافر تاریخچه دارد | L | Core |
| Realtime + rollback | روی کندل باز، با هر tick اجرا می‌شود؛ قبل از هر اجرا متغیرها به وضعیت کندل قبلی برمی‌گردند (rollback)؛ در بسته‌شدن کندل commit می‌شود | L | High |
| `var` / `varip` semantics | var از rollback مستثنی نیست ولی ری‌ست هم نمی‌شود؛ varip از rollback هم مستثنی است | M | High |
| Repainting | اختلاف رفتار تاریخی و realtime (lookahead، security روی کندل باز، calc_on_every_tick) | — | High (مستندسازی) |
| `max_bars_back` inference | کامپایلر عمق لازم تاریخچه را حدس می‌زند؛ اگر کم باشد خطای runtime و اجرای مجدد | M | Medium |
| Strategy execution | پیش‌فرض: یک‌بار در close کندل؛ سفارش‌ها در open کندل بعدی fill می‌شوند (broker emulator) | L | Core |
| Broker emulator intrabar path | بدون Bar Magnifier: اگر open به high نزدیک‌تر باشد مسیر open→high→low→close، در غیر این صورت open→low→high→close فرض می‌شود؛ گپ بین کندل‌ها در open بعدی fill می‌شود | M | Core |

### ۳.۸ محدودیت‌ها (Limits)

| مورد | مقدار |
|---|---|
| زمان کامپایل | ۲ دقیقه (۳ هشدار متوالی ← بن یک‌ساعته) |
| زمان کل اجرا | ۲۰ ثانیه (basic) / ۴۰ ثانیه (پلن‌های دیگر) |
| زمان هر حلقه روی یک bar | ۵۰۰ ms |
| plot count | ۶۴ در هر اسکریپت (یک call تا ۷ شمارش می‌شود) |
| line/box/label | پیش‌فرض ۵۰، حداکثر ۵۰۰؛ polyline حداکثر ۱۰۰؛ table حداکثر ۹ |
| `request.*` یکتا | ۴۰ (Ultimate: ۶۴)؛ footprint فقط ۱؛ intrabar تا ۱۰۰K–۲۰۰K؛ مجموع tuple ۱۲۷ |
| توکن کامپایل‌شده | ۱۰۰٬۲۵۶ در اسکریپت؛ ۱ میلیون با کتابخانه‌ها |
| متغیر در هر scope | ۱٬۰۰۰ |
| collections | ۱۰۰٬۰۰۰ عنصر؛ map ۵۰٬۰۰۰ جفت |
| بافر تاریخچه | ۵٬۰۰۰ (OHLC و time: ۱۰٬۰۰۰) |
| drawing با xloc.bar_index | ۱۰٬۰۰۰ bar به عقب، ۵۰۰ bar به جلو |
| طول رشته | ۴۰٬۹۶۰ کاراکتر |
| سفارش‌های backtest | ۹٬۰۰۰ (v6 قدیمی‌ترها را trim می‌کند)؛ Deep Backtesting تا ۱ میلیون |
| کندل‌های چارت | ۵K تا ۴۰K بسته به پلن |

### ۳.۹ زیرمجموعه‌ی پیشنهادی MVP برای اولین مفسر Pine

هدف MVP: اجرای بدون تغییر حدود ۸۰٪ اسکریپت‌های ساده‌ی کامیونیتی و همه‌ی اندیکاتورهای Core بخش ۱.

**فاز ۱ — هسته (باید داشته باشیم):**
1. Lexer/parser با بلاک‌های تورفتگی، line wrapping، کامنت؛ فقط `//@version=6`.
2. `indicator()` و `strategy()` (بدون `library`).
3. Typeهای پایه: int، float، bool، color، string + `na`؛ qualifierها را **ساده** کنید: همه‌چیز series، فقط چک‌های لازم برای input/const در پارامترهای خاص (مثل length در ta.*). سیستم qualifier کامل را عقب بیندازید.
4. متغیر، `:=`، عملگرهای ترکیبی، `var`، tuple، ternary، `if`/`switch` به‌عنوان expression، `for`، `while`، `break/continue`.
5. History operator `[]` با بافر حلقوی برای هر سری و هر call-site تابع.
6. توابع کاربر تک‌خطی/چندخطی با state مستقل برای هر call-site (این کلید درست‌کارکردن `ta.*` درون تابع است).
7. Built-in series و `barstate.*`، `syminfo.mintick/ticker`، `timeframe.period`.
8. `ta.*` (حدود ۳۵ تابع پراستفاده): sma، ema، rma، wma، vwma، hma، rsi، macd، stoch، atr، tr، bb، cci، mfi، dmi، sar، supertrend، change، mom، roc، highest/lowest، crossover/crossunder/cross، pivothigh/pivotlow، valuewhen، barssince، stdev، cum، rising/falling، vwap، linreg.
9. `math.*` کامل (ساده است)، `nz`، `na`، `fixnan`، `str.tostring`، `str.format` پایه.
10. `input.*`: int، float، bool، string(options)، color، source، timeframe، symbol + `group/inline/tooltip` → تولید خودکار پنل Settings.
11. خروجی: `plot` (line/histogram/area/circles/columns/stepline)، `plotshape`، `plotchar`، `hline`، `fill`، `bgcolor`، `barcolor`.
12. `alertcondition()` و `alert()`.
13. `strategy.entry/exit/close/close_all/cancel` + broker emulator ساده (fill در open بعدی، limit/stop با مسیر OHLC) + پارامترهای initial_capital، default_qty_type، pyramiding، commission، slippage + متغیرهای position_size/equity/netprofit.

**فاز ۲:** `label`/`line`/`box`/`table` (با سقف تعداد)، `array` + methodها، `request.security()` (بدون lookahead ابتدا)، realtime rollback و `varip`، `log.*`، `str.*` کامل، `strategy.opentrades/closedtrades.*`، Bar Magnifier.

**فاز ۳ (عقب بیندازید):** UDT، methodهای کاربر، `map`، `matrix`، `enum`، `library/import`، `polyline`، request.* بنیادی/اقتصادی، footprint، `strategy.risk.*`، OCA پیشرفته، margin call، dynamic requests، سیستم کامل qualifier و پیام‌های خطای دقیق آن.

**تصمیم معماری پیشنهادی:** مفسر tree-walking یا کامپایل به JS (closure) روی worker؛ هر call-site یک «slot» state داشته باشد؛ اجرای بار-به-بار روی آرایه‌های ستونی OHLCV. تست سازگاری: خروجی SMA/EMA/RSI/MACD را با مقادیر مرجع مقایسه کنید (نکته: RSI و ATR در TradingView از RMA استفاده می‌کنند، نه EMA ساده).

---

## ۴. Pine Editor و اکوسیستم

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Code editor | ادیتور با syntax highlighting، که از ۲۰۲۵ در side panel یا پنجره‌ی جدا (detached، متصل به تب چارت) است | M | Core |
| Autocomplete | پیشنهاد namespace/تابع/پارامتر، snippet، پرانتز خودکار (۲۰۲۶) | M | High |
| Inline docs / hover | نمایش امضا و توضیح تابع با hover یا Ctrl+click به reference manual | M | Medium |
| Error/warning highlighting | خطای کامپایل در خط و کنسول؛ هشدارهای غیرمسدودکننده | M | Core |
| Add to chart / Update | کامپایل و افزودن/بازنشانی روی چارت با یک دکمه | S | Core |
| Save / Open / Version history | ذخیره در حساب کاربر و تاریخچه‌ی نسخه‌ها با امکان بازگشت | M | High |
| Templates (New indicator/strategy/library) | شروع از قالب | S | Medium |
| Convert to v6 | مهاجرت خودکار از نسخه‌های قدیمی | L | Low |
| Word wrap، find/replace، command palette، multi-cursor | قابلیت‌های ادیتور (مبتنی بر Monaco-like) | S | Medium |
| Pine Logs panel | نمایش پیام‌های `log.*` با فیلتر سطح، جستجو و پرش به bar | M | Medium |
| Pine Profiler | اجرای پروفایل‌شده و نمایش زمان/تعداد اجرای هر خط کنار کد (مه ۲۰۲۴) | L | Low |
| Publish script | انتشار در Community Scripts با عنوان، توضیح، چارت نمونه، دسته‌بندی؛ تابع قوانین House Rules و moderation | L | Medium |
| Visibility: Open-source / Protected / Invite-only | سورس باز؛ سورس مخفی ولی استفاده آزاد؛ فقط کاربران دعوت‌شده (نیاز به پلن پولی) | M | Medium |
| Public vs private publish | انتشار عمومی یا فقط با لینک | S | Low |
| Library publishing | انتشار library با نسخه‌گذاری خودکار برای import | M | Low |
| Pine Screener | اجرای یک اندیکاتور (از favorites) روی یک watchlist/index و فیلتر بر اساس plotهای آن؛ ستون‌ها = plotها | L | Medium |
| Script settings dialog (auto-generated) | تب‌های Inputs / Style / Visibility از روی input و plotها | M | Core |
| Data Window / status line values | نمایش مقدار plotها در کندل زیر cursor | S | Core |

---

## ۵. Strategy Tester (اکنون «Strategy Report»)

### ۵.۱ چیدمان UI فعلی

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Report panel (پایین صفحه) | با اضافه‌شدن استراتژی باز می‌شود؛ یک استراتژی در هر چارت | M | Core |
| Metrics / Overview | منحنی equity + خلاصه (Total P&L، max drawdown، درصد سودده، profit factor) | M | Core |
| Buy & hold toggle | رسم equity خرید-و-نگهداری روی همان نمودار | S | High |
| Trades run-up & drawdown toggle | نمایش MFE/MAE هر معامله روی نمودار | S | Medium |
| Hover tooltip | شماره و نوع معامله، P&L تجمعی، زمان، مقدار buy & hold | S | High |
| Date range selector | محدودکردن بازه‌ی محاسبه‌ی گزارش | M | High |
| Performance analysis (۵ زیرتب) | Breakdown، Periodical (ماهانه/سالانه)، Benchmarking (در برابر buy & hold)، Margin usage، Growth and decline | L | Medium |
| Trades analysis (۳ زیرتب) | Distribution (هیستوگرام بازده)، Streaks (رشته‌ی برد/باخت)، Time patterns (ساعت/روز هفته/ماه) | L | Medium |
| List of trades | جدول: شماره، نوع، تاریخ/زمان ورود و خروج، سیگنال (id/comment)، قیمت، اندازه، Net P&L، Run-up، Drawdown، P&L تجمعی؛ قابل مرتب‌سازی | M | Core |
| Properties | خلاصه‌ی تنظیمات و inputهای استراتژی و نماد | S | High |
| Long / Short / All columns | همه‌ی متریک‌ها برای کل، لانگ و شورت جدا | S | High |
| Export | خروجی داده‌ی معاملات/متریک‌ها (CSV/Excel) از منوی استراتژی | S | High |
| Trade markers on chart | فلش ورود/خروج با برچسب id و اندازه روی چارت | M | Core |

### ۵.۲ همه‌ی متریک‌ها (۵۳ مورد رسمی)

| گروه | متریک‌ها |
|---|---|
| Returns | Initial capital، Open P&L، Net P&L، Gross profit، Gross loss، Profit factor، Commission paid، Expected payoff، Buy & hold P&L، Buy & hold % gain، Strategy outperformance، Annualized return (CAGR)، Return on initial capital |
| Risk-adjusted | Sharpe ratio، Sortino ratio (بر اساس risk_free_rate و بازده ماهانه) |
| Trades | Total trades، Total open trades، Total winners، Total losers، Even trades، Percent profitable، Average P&L، Average profit، Average loss، Avg profit / avg loss، Largest profit (+ % of gross profit)، Largest loss (+ % of gross loss)، Average bars in trades / winners / losers، Max contracts held |
| Capital efficiency | Account size required، Return on account size required، Net profit as % of largest loss، Average margin used، Max margin used، Margin efficiency، Margin calls، Total liquidated volume، Largest liquidated volume |
| Run-up | Average run-up duration (close-to-close)، Average run-up (c2c)، Max run-up (c2c)، Max run-up (intrabar)، Max run-up as % of initial capital |
| Drawdown | Average drawdown duration (c2c)، Average drawdown (c2c)، Max drawdown (c2c)، Max drawdown (intrabar)، Max drawdown as % of initial capital، Return of max drawdown |

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Core metrics (Net P&L، Gross، PF، Win rate، Max DD، Total trades، Avg trade، Buy&hold) | فرمول‌های ساده روی لیست معاملات و equity | S | Core |
| Sharpe / Sortino / CAGR | آمار روی بازده دوره‌ای | S | High |
| Run-up/drawdown close-to-close و intrabar | نیاز به ردیابی equity در هر bar با high/low | M | High |
| Margin metrics و margin call | شبیه‌سازی margin و لیکوییدیشن (۴ برابر مقدار پوشش) | L | Low |

### ۵.۳ تنظیمات (Properties)

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Initial capital + Base currency | سرمایه‌ی اولیه و ارز حساب (تبدیل با نرخ روز قبل) | S | Core |
| Order size | Contracts / Cash (USD) / % of equity | S | Core |
| Pyramiding | حداکثر ورود هم‌جهت | S | Core |
| Commission | Percent / Cash per contract / Cash per order | S | Core |
| Slippage | تعداد tick در جهت نامطلوب | S | High |
| Margin long / short (Leverage) | درصد مارجین؛ ۱۰۰٪ = بدون اهرم | M | Medium |
| Limit order execution | «Requested price» یا «Requested price and 1 tick beyond» (`backtest_fill_limits_assumption`) | S | Medium |
| Script execution mode | On bar close، On every tick (realtime)، After order is filled (`calc_on_order_fills`)، On every history tick (پلن بالا) | M | High |
| Order execution delay | تأخیر مصنوعی برای شبیه‌سازی latency | M | Low |
| Bar detalization (Bar Magnifier) | fill با داده‌ی تایم‌فریم پایین‌تر؛ سقف ۲۰۰K bar intrabar | L | Medium |
| Fill orders on standard OHLC | روی Heikin Ashi و چارت‌های غیراستاندارد با قیمت واقعی fill کند | M | Medium |
| Process orders on close | fill در همان close به‌جای open بعدی | S | High |
| Deep Backtesting | اجرای سمت سرور روی کل تاریخچه (تا ۲M bar و ۱M معامله) با date range؛ فقط در گزارش، نه روی چارت؛ دکمه‌ی Update report | L | Medium |
| Inputs / Style tabs | مثل اندیکاتورها | S | Core |

### ۵.۴ Forward testing / Paper trading

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Realtime forward test | استراتژی روی کندل‌های زنده ادامه می‌دهد و معاملات جدید به گزارش اضافه می‌شود | M | High |
| Strategy alerts | alert روی رویداد fill سفارش با placeholderها (`{{strategy.order.action}}`، `{{ticker}}`…) و پیام پیش‌فرض قابل تنظیم؛ برای webhook و اتوماسیون | M | High |
| Paper Trading | حساب مجازی جدا در Trading Panel؛ استراتژی مستقیماً معامله نمی‌کند، اتصال از طریق alert/webhook یا دستی است | L | Medium |

---

## ۶. شکاف‌ها و موارد تأییدنشده

- فهرست کامل اندیکاتورها در Help Center برای ابزارهای Volume Profile، الگوهای کندلی و الگوهای چارتی مقاله‌ی فهرست‌شده ندارد؛ این بخش‌ها از ترکیب مقاله‌های پشتیبانی و دانش عمومی پلتفرم تکمیل شده‌اند و باید با دیالوگ واقعی Indicators تطبیق داده شوند.
- چند اندیکاتور (Accelerator Oscillator، Standard Deviation، Volume Oscillator، Price Oscillator، Market Facilitation Index، Compare/Ratio/Spread) در پوشه‌ی رسمی نبودند ولی در دیالوگ وجود دارند یا داشته‌اند؛ پیش از پیاده‌سازی بررسی شود.
- فرمول دقیق Sharpe/Sortino در TradingView (بازه‌ی ماهانه، سالانه‌سازی) در منابع خوانده‌شده نبود.
- فرمت فایل export (CSV یا XLSX) و محدودیت پلن آن تأیید نشد.
- جزئیات Pine Screener (حداکثر نمادها، پلن‌ها) بررسی سطحی شد.
- Strategy Tester در ۲۰۲۶ به «Strategy Report» با UI جدید تغییر کرده؛ نام‌های قدیمی (Overview / Performance Summary / List of Trades / Properties) هنوز در بسیاری از مستندات هستند.

---

## Sources

- Built-in indicators folder — https://www.tradingview.com/support/folders/43000587405-built-in-indicators/
- Built-in strategies folder — https://www.tradingview.com/support/folders/43000587406-built-in-strategies/
- Consecutive Up/Down Strategy — https://www.tradingview.com/support/solutions/43000599836-consecutive-up-down-strategy/
- Automatic candlestick pattern detection — https://www.tradingview.com/support/solutions/43000584462-automatic-candlestick-pattern-detection/
- Auto chart patterns — https://www.tradingview.com/support/solutions/43000690464-what-are-chart-patterns
- Strategy report metrics folder — https://www.tradingview.com/support/folders/43000599093-strategy-report-metrics/
- Strategy Report: How to start — https://www.tradingview.com/support/solutions/43000764138-tradingview-strategy-report-how-to-start/
- Strategy tester metrics explained — https://www.tradingview.com/support/solutions/43000681683-strategy-tester-metrics-and-data-explained/
- Max run-up (intrabar) — https://www.tradingview.com/support/solutions/43000682585/
- How Deep Backtesting works — https://www.tradingview.com/support/solutions/43000666265-how-deep-backtesting-works/
- Deep Backtesting is out of beta (blog) — https://www.tradingview.com/blog/en/deep-backtesting-is-out-of-beta-41158
- Bar Magnifier (blog) — https://www.tradingview.com/blog/en/accurate-backtesting-with-bar-magnifier-31746
- Bar Magnifier backtesting mode — https://www.tradingview.com/support/solutions/43000669285-what-s-bar-magnifier-backtesting-mode/
- Strategies, backtesting and forward testing — https://www.tradingview.com/support/solutions/43000562362-what-are-strategies-backtesting-and-forward-testing/
- Pine Script docs: Strategies — https://www.tradingview.com/pine-script-docs/concepts/strategies/
- Pine Script docs: Limitations — https://www.tradingview.com/pine-script-docs/writing/limitations/
- Pine Script docs: Release notes — https://www.tradingview.com/pine-script-docs/release-notes/
- Pine Script v6 reference — https://www.tradingview.com/pine-script-reference/v6/
