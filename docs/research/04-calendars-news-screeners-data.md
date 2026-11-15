[فارسی](04-calendars-news-screeners-data.md) · [English](04-calendars-news-screeners-data.en.md)

# ۰۴ — محصولات داده‌ی بازار: تقویم‌ها، اخبار، اسکرینرها، هیت‌مپ‌ها، بنیادی، اجتماعی + منابع داده

> هدف: مستندسازی **رفتار** امکانات TradingView برای بازسازی clean-room. هیچ کد یا متن طولانی از TradingView کپی نشده؛ همه‌چیز بازنویسی شده است.
> تاریخ بررسی: 2026-10-13. اعداد free tier از منابع رسمی یا ثانویه گرفته شده‌اند و مواردی که با علامت **(verify)** مشخص شده‌اند قبل از پیاده‌سازی باید روی صفحه‌ی رسمی دوباره چک شوند؛ این اعداد مرتب تغییر می‌کنند.

راهنمای ستون‌ها: **Complexity**: S = چند روز، M = یک تا دو هفته، L = چند هفته یا بیشتر / وابسته به داده‌ی پولی. **Priority**: P0 = برای MVP لازم، P1 = نسخه‌ی دوم، P2 = بعداً/اختیاری.

---

## ۱. تقویم‌ها (Calendars)

### رفتار در TradingView
- **Economic calendar**: فهرست زمانی رویدادهای اقتصادی (CPI، نرخ بهره، NFP، GDP، PMI و…). هر ردیف: زمان، کشور (پرچم)، نام رویداد، درجه‌ی اهمیت، **Actual / Forecast / Prior**، واحد. فیلترها:
  - **Region/Country**: انتخاب چند کشور یا «کل دنیا»؛
  - **Importance**: حالت «فقط اهمیت بالا» (toggle)؛
  - **Categories**: نرخ بهره، تورم، اوراق، اشتغال، مسکن، انرژی، تولید، بخش خارجی و… (پیش‌فرض: همه)؛
  - **Period**: دیروز / امروز / فردا / این هفته / آینده؛
  - **Time zone**: تبدیل زمان نمایش.
  - با کلیک روی رویداد: توضیح شاخص، منبع رسمی، نمودار تاریخچه‌ی آن شاخص (هر رویداد به یک symbol اقتصادی مثل `USCPI` وصل است).
- **Earnings calendar**: شرکت‌هایی که در بازه‌ی انتخابی گزارش می‌دهند؛ ستون‌ها: نماد، Market cap، EPS estimate / reported، Revenue estimate / reported، surprise، زمان (قبل از بازار/بعد از بازار)، دوره‌ی مالی. فیلتر بر اساس کشور/بورس، بازه‌ی تاریخ، و «فقط watchlist من».
- **Dividends calendar**: نماد، ex-date، payment date، مبلغ هر سهم، dividend yield، فرکانس.
- **IPO calendar**: عرضه‌های اولیه‌ی آینده/اخیر؛ شرکت، بورس، بازه‌ی قیمت پیشنهادی، تعداد سهام، ارزش عرضه، تاریخ.
- **Events on chart**: روی محور زمان نمودار، نشانگرهای کوچک برای Earnings (E)، Dividends (D)، Splits (S) و رویدادهای اقتصادی کشور مرتبط نمایش داده می‌شود؛ hover → جزئیات (EPS برآوردی/واقعی، مبلغ سود، نسبت split). از تنظیمات چارت قابل خاموش/روشن است. «Upcoming» به‌صورت نشانگر کم‌رنگ در آینده‌ی نمودار.

### جدول امکانات

| Feature | What it does | Data source(s) to rebuild | Complexity S/M/L | Priority |
|---|---|---|---|---|
| Economic calendar (لیست + فیلتر کشور/اهمیت/دسته/دوره/time zone) | جدول رویدادها با Actual/Forecast/Prior | ForexFactory weekly JSON (غیررسمی)، FMP economic calendar، Finnhub economic calendar (premium)، FRED `releases/dates` برای زمان‌بندی + FRED/BLS/BEA برای Actual | M | P0 |
| Forecast (consensus) در تقویم اقتصادی | مقدار پیش‌بینی بازار | **شکاف**: consensus عمدتاً proprietary است (Trading Economics/Investing/Bloomberg). رایگان فقط از ForexFactory JSON یا FMP | L | P1 |
| صفحه‌ی جزئیات رویداد + نمودار تاریخچه‌ی شاخص | لینک رویداد → سری زمانی شاخص | FRED API (هزاران سری آمریکا و بین‌الملل)، DBnomics، World Bank، ECB Data Portal | M | P1 |
| Earnings calendar | لیست گزارش‌ها با EPS/Revenue estimate vs actual | Finnhub `/calendar/earnings` (free)، FMP earnings calendar، Nasdaq api (غیررسمی)، Alpha Vantage `EARNINGS_CALENDAR` (CSV) | M | P0 |
| Dividends calendar | ex-date / pay date / amount / yield | Massive(Polygon) free: corporate actions (dividends)، FMP dividends calendar، Nasdaq api (غیررسمی)، Yahoo (غیررسمی) | S | P1 |
| IPO calendar | عرضه‌های آینده | Finnhub `/calendar/ipo` (free)، Nasdaq api (غیررسمی)، FMP، Alpha Vantage `IPO_CALENDAR` | S | P2 |
| Splits | نسبت split و تاریخ | Massive free (splits)، Yahoo events، Finnhub (premium) | S | P1 |
| Events on chart (E/D/S + اقتصادی) | نشانگر روی محور زمان چارت | ترکیب داده‌های بالا + لایه‌ی رندر روی چارت (markers API در lightweight-charts) | M | P0 |
| فیلتر «فقط watchlist» در تقویم‌ها | فیلتر سمت کاربر | داخلی (join با watchlist) | S | P1 |
| تقویم بازار ایران (مجامع، افزایش سرمایه، سود نقدی) | رویدادهای شرکتی بورس تهران | codal.ir (اطلاعیه‌ها: آگهی مجمع، تقسیم سود، افزایش سرمایه) — scraping/API نیمه‌عمومی | M | P1 |

---

## ۲. اخبار و امکانات اجتماعی (News & Community)

### رفتار در TradingView
- **News Flow**: صفحه‌ی خبر تمام‌صفحه با پنل فیلتر بالای لیست. فیلترها: **Watchlist**، **Symbol**، **Market** (سهام، کریپتو، فارکس، آتی، اوراق، اقتصاد)، **Corporate news** (earnings، M&A، insider، تحلیلگر و…)، **Region**، **Provider**. چند فیلتر قابل ترکیب‌اند؛ بدون فیلتر، همه‌ی اخبار به زبان کاربر.
- **Providers**: TradingView ادعای بیش از ۱۰۰ منبع را دارد؛ از جمله Dow Jones Newswires (اضافه شده در 2023: Equity Trader، Commodity Trader، Global News Select)، Reuters، Benzinga، MarketWatch، Zacks، Cointelegraph، CoinDesk، newsbtc، و اخبار تولیدی خود TradingView (خلاصه‌ها). برخی providerها (مثل Dow Jones) فقط برای پلن‌های پولی real-time هستند.
- **Top stories / Editor's picks**: خبرهای مهم گروه‌بندی‌شده (مثلاً «۵ خبر داغ»)؛ در اپ موبایل مرتب‌سازی بر اساس top stories، کلاس دارایی، اقتصاد جهانی.
- **Symbol news**: در صفحه‌ی نماد و پنل کناری چارت، اخبار مرتبط با همان نماد؛ در watchlist، آیکن «خبر جدید» کنار نماد.
- **News on chart**: نشانگر روی چارت در زمان انتشار خبر مرتبط با نماد (قابل خاموش کردن).
- **News alerts**: هشدار real-time برای خبر جدید یک نماد/watchlist.
- **Ideas**: پست‌های تحلیلی نیمه‌بلند حول یک chart snapshot (جهت long/short، تایم‌فریم، توضیح)؛ لایک (boost)، کامنت، follow، نمایش ایده‌ی قدیمی روی چارت زنده (“play” ایده). فیلتر بر اساس بازار، تایم‌فریم، «همه / دنبال‌شده‌ها / خودم»، Editor's picks.
- **Minds**: فید گفتگوی کوتاه per-symbol (شبیه توییت) در تب Discussions/Minds صفحه‌ی نماد؛ ارسال از منوی Publish چارت («Speak your mind»). در زمان عرضه ارسال فقط برای پلن‌های پولی بود (verify).
- **Streams**: پخش زنده‌ی صفحه/چارت توسط کاربران واجد شرایط (بتا).
- **Community scripts**: کتابخانه‌ی اسکریپت‌های Pine منتشرشده (open/protected/invite-only).
- **Chats / Private messages**، **Profile** با followers، reputation.
- **Newsletter**: ایمیل هفتگی (Weekly digest، دوشنبه‌ها) شامل ایده‌های منتخب، اسکریپت‌های برتر، تقویم درآمد و اقتصادی؛ قابل فعال‌سازی از Profile settings → Notifications.

### جدول امکانات

| Feature | What it does | Data source(s) to rebuild | Complexity S/M/L | Priority |
|---|---|---|---|---|
| News Flow (لیست + فیلتر market/region/provider/symbol) | aggregator خبر با برچسب نماد | RSS (CoinDesk، Cointelegraph، SEC EDGAR، Fed، ECB)، Finnhub company/market news (free)، Alpaca News API (Benzinga، با حساب رایگان)، Marketaux، CryptoPanic، NewsAPI (فقط dev) | M | P0 |
| Symbol tagging خبر | نسبت دادن خبر به نماد | از metadata ارائه‌دهنده (Finnhub/Alpaca/CryptoPanic برچسب دارند) + NER ساده روی تیتر برای RSS | M | P0 |
| Symbol news (صفحه‌ی نماد/پنل چارت) | فیلتر بر اساس نماد | همان pipeline | S | P0 |
| News on chart | نشانگر خبر روی محور زمان | همان pipeline + markers | S | P1 |
| Top stories | خبرهای مهم | الگوریتم داخلی (تعداد منابع پوشش‌دهنده/تعامل) یا curation دستی | M | P2 |
| News alerts | هشدار خبر جدید | WebSocket داخلی + notification | M | P1 |
| خبر فارسی / بازار ایران | اخبار بورس و ارز | RSS خبرگزاری‌ها (مثلاً اقتصادنیوز، دنیای اقتصاد — بررسی مجوز)، اطلاعیه‌های codal.ir | M | P1 |
| Ideas (پست تحلیلی با chart snapshot) | شبکه‌ی اجتماعی ایده | داخلی: DB + ذخیره‌ی state چارت (JSON drawings) | L | P1 |
| Minds (فید per-symbol) | پست کوتاه per-symbol | داخلی | M | P2 |
| Streams | پخش زنده | سرویس سوم (LiveKit/WebRTC) | L | P2 |
| Community scripts library | انتشار اسکریپت | داخلی (وابسته به موتور اسکریپت ما) | L | P2 |
| Newsletter | ایمیل هفتگی | داخلی + سرویس ایمیل (Resend/SES) | S | P2 |

---

## ۳. اسکرینرها، هیت‌مپ‌ها، بنیادی

### رفتار اسکرینرها در TradingView
انواع: **Stock**، **ETF**، **Bond**، **Crypto coins**، **CEX pairs** (جفت‌ارزهای صرافی‌های متمرکز)، **DEX pairs** (استخرهای صرافی‌های غیرمتمرکز)، **Forex** (در نسخه‌های جدیدتر در دل CEX/فارکس)، و **Pine Screener**.

رفتار مشترک:
- جدول با ستون‌های قابل انتخاب؛ **Column sets** آماده (Overview، Performance، Valuation، Dividends، Profitability، Income statement، Balance sheet، Cash flow، Technicals، Extended hours …) و ذخیره‌ی چیدمان دلخواه.
- **Filters** به‌صورت pillهای بالای جدول: عملگرهای above/below/between/crosses/equal، مقایسه‌ی دو فیلد با هم (مثلاً Price > SMA50)، تایم‌فریم برای فیلدهای تکنیکال.
- **Saved screens**، Universe (کشور/بورس/watchlist/index)، مرتب‌سازی، export به CSV، به‌روزرسانی خودکار (real-time برای پلن پولی)، کلیک روی ردیف → باز شدن چارت (sync با چارت در layout).
- **Stock**: Price، Change %، Volume، Rel Volume، Market cap، P/E، EPS dil TTM، EPS growth، Div yield، Sector، Industry، Analyst rating، Perf (1W/1M/3M/6M/YTD/1Y)، Volatility، Beta، ROE، Gross margin، Debt/Equity، Free cash flow، Technical Rating، RSI، MACD، MAها، Pattern ها، pre/post market، Upcoming earnings date.
- **ETF**: AUM، Expense ratio، Asset class، Focus، Issuer، NAV، Premium/discount، Holdings count، Fund flows، Dividend yield، Performance.
- **Bond**: Coupon، Yield to maturity، Maturity date، Issuer، Credit rating (در برخی بازارها)، Outstanding amount، Current yield، Duration (در صورت وجود)، نوع (دولتی/شرکتی).
- **Crypto coins**: Rank، Price، Market cap، FD market cap، Circulating/Total/Max supply، Volume 24h، Change %، Category (DeFi، Layer 1، Meme…)، Social dominance، Technical rating.
- **CEX pairs**: نماد/صرافی، Price، Change، Volume 24h (base/quote/USD)، Volatility، Technicals.
- **DEX pairs**: شبکه (chain)، DEX، Liquidity (TVL استخر)، Volume 24h، Transactions/Txns، Buyers/Sellers، FDV، Pool age، Price change.
- **Pine Screener** (Premium به بالا): اجرای **یک** اندیکاتور Pine روی تمام نمادهای یک watchlist؛ ستون‌ها = plotهای آن اندیکاتور، فیلترها = plotها یا alertconditionها؛ تایم‌فریم‌های ثابت (1/5/15/30m، 1/2/4h، 1D/1W/1M)؛ indicator-on-indicator پشتیبانی نمی‌شود.

### Heatmaps
- **Stock heatmap**: treemap گروه‌بندی‌شده بر اساس Sector→Industry؛ universe: یک index یا کل یک کشور. **Cell size**: Market cap، Volume، FD market cap، Turnover، یا یکسان (mono). **Cell color**: Change %، Performance (W/M/…)، pre/post market change، volume change، Rel Volume، Volatility، Gap، Beta. Zoom به یک بخش، tooltip، کلیک → چارت، حالت color-blind/monochrome.
- **ETF heatmap**: گروه بر اساس asset class/focus؛ size: AUM/Volume/Turnover/mono.
- **Crypto heatmap**: universe: همه / بدون BTC / بدون stablecoin / DeFi؛ size: market cap / volume.

### Technical Ratings (گیج «Technicals»)
- دو گروه: **Moving averages** (۱۵ مورد: SMA و EMA طول‌های 10/20/30/50/100/200، Hull MA 9، VWMA 20، Ichimoku 9/26/52) و **Oscillators** (۱۱ مورد: RSI 14، Stoch 14/3/3، CCI 20، ADX 14، AO، Momentum 10، MACD 12/26/9، Stoch RSI، Williams %R 14، Bull Bear Power، Ultimate Oscillator).
- هر اندیکاتور رأی −1/0/+1 می‌دهد (مثلاً MA زیر قیمت = خرید؛ RSI زیر 30 و رو به بالا = خرید). میانگین هر گروه در بازه‌ی [−1, +1]؛ امتیاز کلی = میانگین دو گروه. نگاشت به پنج برچسب Strong Sell/Sell/Neutral/Buy/Strong Buy (آستانه‌ها در Help Center رسمی؛ رایج: ±0.1 و ±0.5 — **verify**).
- گیج برای هر تایم‌فریم (1m تا 1M) و جدول شمارش Buy/Neutral/Sell هر گروه. **کاملاً از OHLCV قابل محاسبه است** — نیاز به داده‌ی پولی ندارد.

### Seasonals
- هر سال در یک خط روی محور ژانویه→دسامبر؛ اسلایدر انتخاب سال‌ها، حالت درصدی (تغییر از ابتدای سال)، خط میانگین (dashed)، snapshot. نسخه‌ی کوچک ۳ساله در تب Overview صفحه‌ی نماد. **از OHLCV روزانه قابل محاسبه.**

### Fundamentals
- **Financials** در صفحه‌ی نماد: Income statement، Balance sheet، Cash flow؛ سالانه/فصلی؛ نمودار میله‌ای + جدول؛ Statistics (نسبت‌ها)، Dividends، Earnings (EPS/Revenue تاریخی + estimate آتی، surprise)، Revenue breakdown بر اساس بخش/جغرافیا.
- **Fundamental graphs**: رسم هر متریک بنیادی (مثلاً P/E، Revenue، FCF) به‌صورت سری زمانی و مقایسه‌ی چند نماد؛ همچنین «Financials» به‌عنوان اندیکاتور روی چارت.
- **Key stats**: Market cap، P/E، EPS، Div yield، Shares float، Beta، Employees، 52W high/low و…
- **Analyst forecasts**: Price target (min/avg/max) با نمودار مخروطی ۱ ساله، توزیع rating (Strong buy…Strong sell) در طول زمان، EPS/Revenue estimates فصلی/سالانه.
- **Markets overview pages**: صفحات Indices، Futures، World markets، Currencies، Bonds، Crypto، Stocks per country؛ هر صفحه کارت‌های mini-chart + جدول movers + اخبار.

### جدول امکانات

| Feature | What it does | Data source(s) to rebuild | Complexity S/M/L | Priority |
|---|---|---|---|---|
| Screener engine (فیلتر/ستون/مرتب‌سازی/saved screens/CSV) | موتور query روی snapshot همه‌ی نمادها | داخلی: جدول snapshot در DB (Postgres/DuckDB) که دوره‌ای پر می‌شود | L | P0 |
| Crypto coins screener | ستون‌های market cap/supply/category | CoinGecko `/coins/markets` (هر صفحه ۲۵۰ کوین)، CoinMarketCap listings | M | P0 |
| CEX pairs screener | تمام جفت‌های صرافی‌ها | Binance/Bybit/OKX public (`/ticker/24hr` یک‌جا همه‌ی جفت‌ها)، CCXT برای یکسان‌سازی، Nobitex برای جفت‌های ریالی | M | P0 |
| DEX pairs screener | استخرها با liquidity/volume/txns | DexScreener API، GeckoTerminal API، DefiLlama (حجم DEXها) | M | P1 |
| Stock screener (US) | فیلتر بنیادی+تکنیکال | Massive free (EOD + reference)، FMP (stock screener endpoint، محدود)، SEC EDGAR XBRL برای بنیادی، محاسبه‌ی تکنیکال داخلی | L | P1 |
| Stock screener (بورس تهران) | فیلتر نمادهای TSE | TSETMC (market watch، تاریخچه، حقیقی/حقوقی) + codal (صورت‌های مالی) | L | P0 (برای بازار هدف ایرانی) |
| ETF screener | AUM/expense ratio/... | **شکاف**: داده‌ی ETF رایگان کم؛ FMP ETF info (محدود)، Yahoo (غیررسمی)، فایل‌های issuer | L | P2 |
| Bond screener | yield/coupon/maturity | **شکاف** برای اوراق شرکتی؛ اوراق دولتی آمریکا از Treasury/FRED؛ اوراق ایران (اخزا) از TSETMC/فرابورس | L | P2 |
| Forex screener | جفت‌ارزها + تکنیکال | Twelve Data، Alpha Vantage FX، Finnhub forex، ECB reference rates (روزانه) | M | P1 |
| Pine Screener معادل | اجرای اسکریپت کاربر روی watchlist | داخلی: موتور اسکریپت ما + OHLCV | L | P2 |
| Stock heatmap | treemap سکتور/صنعت | همان snapshot اسکرینر + d3-hierarchy treemap | M | P1 |
| Crypto heatmap | treemap کوین‌ها | CoinGecko markets | S | P0 |
| ETF heatmap | treemap ETF | وابسته به داده‌ی ETF (شکاف) | M | P2 |
| Technical Ratings gauge | امتیاز −1..+1 از ۲۶ اندیکاتور | محاسبه‌ی داخلی از OHLCV (بدون API خارجی) | M | P0 |
| Seasonals | خطوط سالانه روی هم | محاسبه‌ی داخلی از OHLCV روزانه | S | P1 |
| Financials (IS/BS/CF) | صورت‌های مالی سالانه/فصلی | SEC EDGAR companyfacts (رایگان، رسمی، US)، FMP (۵ سال در free محدود)، Finnhub financials-as-reported، Alpha Vantage `INCOME_STATEMENT` و…؛ ایران: codal.ir | L | P1 |
| Key stats | نسبت‌ها و آمار کلیدی | Finnhub `/stock/metric` (basic financials، free)، محاسبه از EDGAR + قیمت | M | P1 |
| Fundamental graphs | سری زمانی متریک بنیادی روی چارت | از داده‌ی Financials ذخیره‌شده | M | P2 |
| Analyst forecasts | price target، rating، estimates | Finnhub recommendation trends (free)، price target/estimates (premium — verify)، FMP (بخشی free)، Yahoo (غیررسمی). **شکاف عمده** | L | P2 |
| Earnings (تاریخی + surprise) | EPS واقعی vs برآورد | Finnhub `/stock/earnings` (free، چند فصل اخیر)، Alpha Vantage `EARNINGS` | S | P1 |
| Markets overview (Indices/Futures/World/Currencies/Crypto) | صفحات خلاصه بازار | Yahoo (غیررسمی) یا Stooq (CSV رایگان) برای شاخص‌ها؛ Twelve Data؛ CoinGecko global؛ TSETMC شاخص کل/هم‌وزن؛ tgju برای طلا/ارز ایران | M | P0 |

---

## ۴. سایر امکانات

### رفتار در TradingView
- **Market Movers**: لیست Top gainers، Top losers، Most active، Unusual volume، Most volatile، 52W high/low، Pre-market/After-hours gainers، Largest companies — per کشور و per کلاس دارایی (crypto movers هم دارد).
- **Yield curves**: صفحه‌ی اوراق با نمودار منحنی بازده (سررسیدهای 1M تا 30Y) برای کشورهای اصلی، مقایسه با منحنی قبلی، و spreadهای رایج (2s10s). نمادهای بازده (مثل `US10Y`) روی چارت قابل رسم‌اند.
- **Options** (از 2024): **Options chain** دو طرف Calls/Puts، ستون‌های bid/ask/last/volume/OI/IV/Greeks (Delta، Gamma، Theta، Vega، Rho)، انتخاب expiration؛ **Strategy builder** با استراتژی‌های آماده (فیلتر bullish/bearish/neutral)، ویرایش strike/expiry/تعداد روی چارت، نمودار P&L در انقضا و قبل از آن، max profit/loss/breakeven/احتمال سود، مقایسه‌ی چند استراتژی؛ تب **Volatility** (IV smile/term structure)؛ اتصال به بروکر برای اجرا.
- **Crypto market cap / dominance symbols** (پیشوند `CRYPTOCAP:`): `TOTAL` (کل بازار)، `TOTAL2` (بدون BTC)، `TOTAL3` (بدون BTC و ETH)، `OTHERS` (کل منهای کوین‌هایی که نماد `.D` جدا دارند)، `BTC.D`، `ETH.D`، `USDT.D`، `USDC.D`، `OTHERS.D` و… (درصد سهم). همچنین `TOTALDEFI`، `TOTALES` (stablecoins) و موارد مشابه. این‌ها روی چارت مثل یک نماد عادی رسم می‌شوند (OHLC روزانه/درون‌روزی) و در محاسبات ترکیبی (`TOTAL-TOTAL2`) استفاده می‌شوند.

### جدول امکانات

| Feature | What it does | Data source(s) to rebuild | Complexity S/M/L | Priority |
|---|---|---|---|---|
| Market Movers | gainers/losers/active/unusual volume | محاسبه از snapshot اسکرینر؛ Alpha Vantage `TOP_GAINERS_LOSERS` (US)، Massive snapshot (پلن پولی)، Binance 24hr ticker، TSETMC market watch | S | P0 |
| Pre/after-market movers | حرکت خارج از ساعت | **شکاف** در free tier (Massive/Polygon پولی) | M | P2 |
| Yield curve (US) | منحنی 1M..30Y + مقایسه | US Treasury daily par yield curve (XML/CSV، public domain)، FRED `DGS1MO..DGS30` | S | P1 |
| Yield curve (سایر کشورها) | منحنی بین‌المللی | ECB Data Portal (منحنی یورو)، Bank of England، بانک‌های مرکزی؛ ایران: بازده اخزا از فرابورس | M | P2 |
| Bond yield symbols روی چارت (US10Y…) | سری بازده به‌عنوان نماد | FRED (روزانه) | S | P1 |
| Options chain | زنجیره با IV/Greeks | Tradier sandbox (۱۵ دقیقه تأخیر)، Alpaca indicative options feed، Yahoo options (غیررسمی)؛ Greeks را می‌توان داخلی با Black-Scholes محاسبه کرد. اختیار معامله‌ی بورس تهران از TSETMC | L | P2 |
| Strategy builder (P&L payoff) | منحنی سود/زیان چند leg | داخلی (ریاضی Black-Scholes + payoff) — به داده‌ی زنده نیاز کم دارد | M | P2 |
| Crypto TOTAL/TOTAL2/TOTAL3/OTHERS | سری market cap تجمعی | CoinGecko `/global` (snapshot) + `/global/market_cap_chart` (فقط پلن پولی — verify)؛ جایگزین: محاسبه‌ی داخلی از market cap تاریخی top-N کوین (CoinGecko `/coins/{id}/market_chart`) و ذخیره‌ی snapshot دوره‌ای؛ CoinMarketCap global-metrics historical (پولی) | M | P1 |
| Dominance (BTC.D, ETH.D, USDT.D …) | درصد سهم | همان: mcap کوین ÷ TOTAL؛ snapshot فعلی در CoinGecko `/global` (`market_cap_percentage`) | S | P1 |
| DeFi TVL / stablecoin cap symbols | سری‌های DeFi | DefiLlama (رایگان، بدون کلید): TVL، stablecoins، DEX volume | S | P2 |

---

## ۵. منابع داده (Data sources)

| API | Covers | Free tier & limits | Terms caveat | URL |
|---|---|---|---|---|
| **Finnhub** | US quotes، company/market news، earnings & IPO calendar، basic financials، financials-as-reported، recommendation trends، forex/crypto | رایگان ~60 call/min. economic calendar، price target، splits/dividends تاریخی معمولاً **premium** (verify در docs) | free فقط personal/non-commercial؛ redistribution/نمایش عمومی نیازمند پلن پولی | https://finnhub.io/docs/api |
| **Financial Modeling Prep (FMP)** | financials، calendars (earnings/dividends/IPO/economic)، screener، ratios، analyst | Basic رایگان: 250 call/day، EOD، ~500MB/30 روز bandwidth، بخشی از endpointها؛ Starter از ~$22/ماه | نمایش/redistribution نیازمند توافق جداگانه | https://site.financialmodelingprep.com/developer/docs |
| **Alpha Vantage** | سهام/FX/کریپتو OHLCV، fundamentals (IS/BS/CF)، earnings/IPO calendar CSV، top gainers/losers، news sentiment، economic indicators | 25 request/day، 5/min | free برای استفاده‌ی شخصی؛ برای تجاری پولی (از ~$49.99/ماه) | https://www.alphavantage.co/documentation/ |
| **Twelve Data** | سهام/FX/کریپتو/ETF time series، تکنیکال، برخی بنیادی | Basic: 8 credit/min، 800 credit/day؛ endpointهای بنیادی سنگین (مثلاً income statement = 100 credit) و برخی فقط Grow/Pro | Basic برای personal؛ نمایش عمومی نیازمند پلن تجاری | https://twelvedata.com/docs |
| **Massive (سابقاً Polygon.io)** | سهام US EOD/aggregates، reference، **dividends/splits**، تکنیکال؛ آپشن/فارکس/کریپتو در پلن‌های پولی | Basic: 5 call/min، EOD + ۱۵ دقیقه تأخیر، ~۲ سال تاریخچه؛ api.polygon.io و api.massive.com موازی کار می‌کنند | free غیرتجاری؛ redistribution ممنوع بدون مجوز | https://massive.com/pricing |
| **Yahoo Finance (غیررسمی / yfinance)** | تقریباً همه‌چیز: quote، تاریخچه، financials، options، analyst، events | بدون کلید؛ limit منتشرنشده؛ 429 مکرر به‌ویژه از IP ابری | API رسمی ندارد؛ ToS Yahoo استفاده‌ی خودکار/تجاری را مجاز نمی‌داند → فقط prototype | (unofficial) https://github.com/ranaroussi/yfinance |
| **Stooq** | OHLCV روزانه سهام/شاخص/FX/کامودیتی (CSV) | رایگان بدون کلید؛ limit روزانه‌ی نامشخص | شرایط استفاده‌ی تجاری مبهم | https://stooq.com |
| **FRED (St. Louis Fed)** | +800k سری اقتصادی، release dates (برای تقویم)، بازده اوراق | رایگان با کلید؛ ~120 request/min | برخی سری‌ها copyright منبع اصلی دارند؛ قبل از بازنشر note منبع را چک کنید | https://fred.stlouisfed.org/docs/api/fred/ |
| **US Treasury (Fiscal Data / yield curve)** | منحنی بازده روزانه، نرخ‌ها | رایگان بدون کلید | public domain | https://home.treasury.gov/resource-center/data-chart-center/interest-rates |
| **BLS / BEA** | CPI، اشتغال، GDP (Actual رسمی) + release schedule | BLS v2: با کلید 500 query/day؛ BEA با کلید | public domain | https://www.bls.gov/developers/ , https://apps.bea.gov/api/ |
| **DBnomics / ECB Data Portal / World Bank** | داده‌ی اقتصاد کلان بین‌المللی | رایگان | معمولاً open data (ECB با ذکر منبع) | https://db.nomics.world , https://data.ecb.europa.eu |
| **Trading Economics** | تقویم اقتصادی با forecast، indicators، اخبار | حساب guest:guest برای REST گزارش شده که دیگر کار نمی‌کند (2026)؛ developer key رایگان فقط به datasetهای محدود (World Bank/UN/…) — تقویم و forecast پولی (Standard ~$149/ماه) | داده‌ی proprietary؛ نمایش عمومی فقط با لایسنس | https://docs.tradingeconomics.com |
| **ForexFactory calendar feed** | تقویم هفتگی: title، country، date، impact، forecast، previous (actual متغیر) | رایگان، فایل JSON/XML هفتگی (`nfs.faireconomy.media/ff_calendar_thisweek.json`)؛ چند بار در ساعت به‌روز می‌شود؛ درخواست زیاد → block | غیررسمی، بدون مستندات/مجوز؛ برای محصول عمومی ریسک حقوقی دارد — cache کنید و منبع را ذکر کنید | https://nfs.faireconomy.media/ff_calendar_thisweek.json |
| **Investing.com** | تقویم اقتصادی/درآمد، اخبار، قیمت‌ها | API عمومی ندارد؛ scraping با Cloudflare محافظت می‌شود | ToS صراحتاً scraping را منع می‌کند → **استفاده نکنید** | https://www.investing.com |
| **Nasdaq (api.nasdaq.com)** | earnings/dividends/IPO/splits calendar، screener | بدون کلید، غیرمستند؛ نیاز به header مرورگر | غیررسمی؛ ToS Nasdaq استفاده‌ی خودکار را محدود می‌کند → فقط prototype | https://www.nasdaq.com/market-activity/earnings |
| **SEC EDGAR** | فایلینگ‌ها، XBRL companyfacts/companyconcept/frames (صورت‌های مالی US)، RSS فایلینگ جدید، insider (Form 4) | رایگان بدون کلید؛ حداکثر 10 request/s؛ User-Agent با ایمیل الزامی؛ bulk ZIP روزانه | public domain؛ فقط fair access | https://www.sec.gov/edgar/sec-api-documentation |
| **CoinGecko** | کوین‌ها، markets، categories، global (dominance)، exchanges، تاریخچه | Demo (رایگان با کلید): ~30 call/min، 10,000 call/ماه، تاریخچه ۱ سال | attribution الزامی؛ free برای غیرتجاری/محدود | https://docs.coingecko.com |
| **CoinMarketCap** | listings، quotes، global metrics، categories | Basic رایگان: ~10k–15k credit/ماه (منابع متناقض — verify)، تاریخچه در free نیست | CMC ادعا می‌کند Basic حق استفاده‌ی تجاری دارد (verify)؛ attribution | https://coinmarketcap.com/api/documentation/v1/ |
| **CryptoPanic** | aggregator خبر کریپتو با برچسب کوین و رأی bullish/bearish | پلن Developer (رایگان) با محدودیت؛ برخی پارامترها (search، panic sort) فقط Enterprise — سقف دقیق verify | لینک به منبع و attribution؛ بازنشر متن کامل ممنوع | https://cryptopanic.com/developers/api/ |
| **Binance public API** | تمام جفت‌ها: ticker 24h، klines، depth، trades؛ WebSocket | بدون کلید؛ 6000 weight/min per IP (/api)؛ نقض مکرر → IP ban (۲ دقیقه تا ۳ روز)؛ از برخی کشورها (از جمله ایران و US) geo-block | داده‌ی بازار برای نمایش معمولاً مجاز با ذکر منبع؛ ToS را چک کنید | https://developers.binance.com/docs/binance-spot-api-docs |
| **Bybit public API (v5)** | spot/derivatives/options tickers، klines، OI، funding | 600 request / 5s per IP؛ نقض → ban ~۳۰ دقیقه؛ geo-block مشابه | مشابه Binance | https://bybit-exchange.github.io/docs/v5/intro |
| **CCXT (کتابخانه)** | wrapper یکسان برای +100 صرافی | رایگان (MIT)؛ limit هر صرافی | — | https://github.com/ccxt/ccxt |
| **DexScreener** | DEX pairs در چند chain: price، liquidity، volume، txns، FDV | رایگان بدون کلید؛ گزارش‌های ثانویه: ~300 req/min برای pairs، ~60 req/min برای profile/boost (verify) | ToS استفاده‌ی تجاری/بازنشر انبوه را محدود می‌کند — verify | https://docs.dexscreener.com/api/reference |
| **GeckoTerminal** | DEX pools، OHLCV استخرها، trending pools | Public API رایگان: 30 call/min؛ limit بالاتر با پلن CoinGecko | attribution | https://apiguide.geckoterminal.com |
| **DefiLlama** | TVL، DEX volume، stablecoins، fees، yields | رایگان بدون کلید (Pro پولی برای endpointهای خاص) | open؛ ذکر منبع | https://defillama.com/docs/api |
| **Messari** | متریک‌های کریپتو، research، token unlocks | وضعیت free tier متناقض (برخی منابع: Lite با ~200 req/min، برخی: بدون free) — verify | لایسنس تجاری لازم | https://docs.messari.io |
| **NewsAPI.org** | اخبار عمومی از هزاران منبع | Developer: 100 request/day، تأخیر ۲۴ ساعته، ~۱ ماه تاریخچه | **فقط development** — استفاده در staging/production ممنوع | https://newsapi.org/pricing |
| **Alpaca Market Data** | سهام US (IEX free)، **News API (Benzinga)** REST+WS، options indicative feed | رایگان با حساب (paper)؛ ~200 req/min (verify) | redistribution داده محدود؛ نمایش در اپ شخصی OK | https://docs.alpaca.markets/docs/about-market-data-api |
| **Marketaux** | خبر مالی با برچسب نماد و sentiment | free ~100 request/day (verify) | attribution | https://www.marketaux.com |
| **RSS feeds** | CoinDesk، Cointelegraph، Decrypt، The Block، SEC press، Fed، ECB، BLS releases | رایگان | فقط تیتر + خلاصه + لینک؛ بازنشر متن کامل ممنوع. **Reuters** فیدهای RSS عمومی را در 2020 قطع کرد — جایگزین رایگان ندارد | https://www.coindesk.com/arc/outboundfeeds/rss/ , https://cointelegraph.com/rss |
| **Tradier (sandbox)** | options chain با Greeks/IV، quotes | sandbox رایگان، ۱۵ دقیقه تأخیر | فقط توسعه؛ production نیازمند حساب | https://documentation.tradier.com |
| **TSETMC (بورس تهران)** | market watch، قیمت/حجم، تاریخچه، سابقه‌ی حقیقی/حقوقی، سفارشات، شاخص‌ها، اختیار معامله | بدون کلید؛ endpointهای JSON نیمه‌عمومی (`cdn.tsetmc.com/api/...`)؛ 403 گاه‌به‌گاه و تغییر بدون اطلاع؛ کتابخانه‌ها: `tsetmc-api` (Python)، `tse-client` (Node) | غیررسمی؛ قوانین بازنشر داده‌ی بورس (شرکت مدیریت فناوری بورس تهران) — برای real-time تجاری باید از دیتافید مجاز خرید شود | http://www.tsetmc.com |
| **codal.ir** | اطلاعیه‌ها و صورت‌های مالی ناشران، مجامع، تقسیم سود | جست‌وجوی JSON نیمه‌عمومی (`search.codal.ir/api/search/v2/q`)؛ صورت‌های مالی HTML/Excel — نیازمند parse | غیررسمی؛ نرخ درخواست را پایین نگه دارید | https://codal.ir |
| **tgju.org** | طلا، سکه، دلار و ارزهای بازار آزاد ایران | API عمومی رسمی ندارد؛ کتابخانه‌های scraper (`tgju-api-go`، `tgju_api` Python)؛ جایگزین: brsapi.ir (رایگان، بدون کلید — verify) | scraping؛ برای محصول تجاری با tgju برای لایسنس تماس بگیرید | https://www.tgju.org |
| **Nobitex public API** | بازار کریپتو ریالی/تتری: `/market/stats`، `/v2/orderbook/{symbol}`، `/v2/trades/{symbol}`، `/market/udf/history` (OHLC سازگار با UDF) | endpointهای بازار بدون کلید؛ rate limit per-endpoint در مستندات (verify) | داده‌ی عمومی؛ ذکر منبع | https://apidocs.nobitex.ir |

### بهترین منبع رایگان به تفکیک feature (پیشنهاد)

| Feature | منبع اول (رایگان) | پشتیبان |
|---|---|---|
| Economic calendar | ForexFactory JSON + FRED release dates | FMP (250/day) |
| Earnings calendar | Finnhub | Nasdaq api / Alpha Vantage CSV |
| Dividends/Splits | Massive (Polygon) free | Yahoo / FMP |
| IPO calendar | Finnhub | Nasdaq api |
| News (سهام) | Alpaca News (Benzinga) + Finnhub | SEC EDGAR RSS، RSS عمومی |
| News (کریپتو) | CryptoPanic + RSS (CoinDesk/Cointelegraph) | — |
| Crypto screener/heatmap/dominance | CoinGecko Demo | CoinMarketCap Basic |
| CEX pairs | Binance/Bybit/OKX via CCXT (+ Nobitex) | — |
| DEX pairs | DexScreener | GeckoTerminal |
| Financials US | SEC EDGAR XBRL | FMP / Finnhub as-reported |
| Financials ایران | codal.ir | — |
| Key stats | Finnhub basic financials | محاسبه از EDGAR |
| Technical ratings / Seasonals / Movers | محاسبه‌ی داخلی از OHLCV | — |
| Yield curve | US Treasury + FRED | ECB |
| Options | Tradier sandbox + Black-Scholes داخلی | Alpaca indicative |
| بازار ایران (سهام/طلا/ارز/کریپتو) | TSETMC + codal + tgju + Nobitex | brsapi.ir |

### شکاف‌ها (Gaps)
1. **Consensus forecast** در تقویم اقتصادی — منبع رایگان پایدار و قانونی وجود ندارد (فقط ForexFactory غیررسمی).
2. **Analyst forecasts** (price target، estimates) — تقریباً همه پولی‌اند؛ Finnhub فقط recommendation trends رایگان.
3. **ETF و Bond screener** — داده‌ی رایگان جامع (AUM، expense ratio، holdings، اوراق شرکتی) وجود ندارد.
4. **Real-time سهام US و pre/after-market** — در free tierها نیست (IEX در Alpaca جزئی است).
5. **اخبار premium** (Reuters، Dow Jones) — فقط با قرارداد لایسنس؛ Reuters RSS عمومی ندارد.
6. **تاریخچه‌ی TOTAL/dominance** — باید خودمان snapshot بگیریم یا پلن پولی CoinGecko/CMC بخریم.
7. **Redistribution**: تقریباً همه‌ی free tierها نمایش عمومی/تجاری را منع می‌کنند → برای لانچ عمومی بودجه‌ی داده (یا تمرکز روی منابع public domain: SEC، FRED، Treasury، صرافی‌های کریپتو) لازم است.
8. **بازار ایران**: همه‌ی منابع غیررسمی‌اند و بدون اطلاع قبلی تغییر می‌کنند؛ لایه‌ی adapter با تست سلامت لازم است. Binance/Bybit از IP ایران geo-block هستند → backend باید خارج از ایران یا از طریق proxy مجاز باشد.

### نکات معماری (کوتاه)
- همه‌ی منابع پشت یک **adapter layer** با cache (Redis) و scheduler قرار بگیرند؛ کلاینت هیچ‌وقت مستقیم به API بیرونی وصل نشود (کلیدها و rate limitها سمت سرور).
- اسکرینر/هیت‌مپ/movers از **یک جدول snapshot** مشترک تغذیه شوند (هر ۱ تا ۵ دقیقه برای کریپتو، EOD برای سهام free).
- Technical ratings، seasonals، Greeks، dominance را **داخلی محاسبه** کنید تا وابستگی به داده‌ی پولی کم شود.
- **از endpointهای داخلی TradingView (مثل scanner) استفاده نکنید** — نقض ToS و clean-room است.

---

## Sources
- TradingView Help — Economic Calendar: https://ru.tradingview.com/support/solutions/43000759911/
- TradingView Economic calendar page: https://www.tradingview.com/economic-calendar/
- TradingView Help — News Flow filters: https://in.tradingview.com/support/solutions/43000732560-news-flow-s-filters-overview
- TradingView Blog — Dow Jones Newswires: https://www.tradingview.com/blog/en/dow-jones-newswires-on-tradingview-36656
- TradingView Blog — Real-time news alerts: https://www.tradingview.com/blog/en/real-time-news-alerts-54444/
- TradingView Help — Screener category: https://tradingview.com/support/categories/screener
- TradingView Help — Pine Screener overview: https://www.tradingview.com/support/solutions/43000742435-what-is-pine-screener-quick-overview-of-the-screener-s-functionality
- TradingView Help — Pine Screener limitations: https://cn.tradingview.com/support/solutions/43000742437
- TradingView Help — Technical Ratings: https://tradingview.com/support/solutions/43000614331-technical-ratings
- TradingView Technical Ratings script overview: https://cn.tradingview.com/script/Jdw7wW2g-Technical-Ratings
- TradingView Help — Heatmaps: https://www.tradingview.com/support/solutions/43000766446
- CMC Markets — TradingView heatmaps explained: https://www.cmcmarkets.com/en-gb/trading-platforms/tradingview/tradingview-heatmaps-explained
- TradingView Help — Seasonals: https://in.tradingview.com/support/solutions/43000745201-seasonals/
- TradingView Blog — Seasonality charts: https://www.tradingview.com/blog/en/tradingview-seasonality-charts-49444
- TradingView Blog — TradingView Options: https://www.tradingview.com/blog/en/new-product-tradingview-options-44783
- TradingView — Crypto market cap symbols (community): https://my.tradingview.com/chart/TOTAL/LrVZMyQU-How-to-chart-crypto-market-caps-beyond-TOTAL-TOTAL2-etc
- TradingView Blog — Introducing Minds: https://www.tradingview.com/blog/en/introducing-minds-35320
- TradingView Help — Minds: https://in.tradingview.com/support/solutions/43000690226-how-to-use-minds-and-what-they-are-made-for/
- TradingView — Newsletter: https://in.tradingview.com/ideas/newsletter
- Finnhub free tier (secondary): https://apicostcalc.com/finnhub.html , https://qveris.ai/guides/stock-api-free-comparison/
- FMP free plan: https://site.financialmodelingprep.com/de/education/other/do-you-need-a-credit-card-to-use-financial-modeling-prep , https://multiples.vc/compare/fmp-api-alternatives
- Alpha Vantage limits: https://www.macroption.com/alpha-vantage-api-limits/
- Twelve Data limits: https://support.twelvedata.com/en/articles/5194820-api-credits-limits , https://support.twelvedata.com/en/articles/5615854-credits
- Polygon → Massive: https://apicostcalc.com/blog/polygon-massive-rebrand-api-pricing.html , https://try.qveris.ai/polygon-pricing-optimized/
- Yahoo / yfinance: https://pypi.org/project/yfinance/0.2.16 , https://scrapfly.io/blog/posts/guide-to-yahoo-finance-api
- FRED rate limit (secondary): https://readme.hex.pm/fred_api_client/0.1.2 , https://freeapihub.com/apis/fred-api
- Trading Economics: https://github.com/tradingeconomics/notebooks , https://apis.io/plans/tradingeconomics/tradingeconomics-plans-pricing/
- ForexFactory feed usage: https://www.mql5.com/en/forum/343908/16870225 , https://apify.com/xtracto/forexfactory-calendar
- SEC EDGAR: https://www.sec.gov/os/accessing-edgar-data , https://www.sec.gov/edgar/sec-api-documentation
- CoinGecko: https://docs.coingecko.com/docs/cli , https://docs.coingecko.com/docs/common-errors-rate-limit
- CoinMarketCap: https://coinmarketcap.com/academy/vi/article/understanding-crypto-api-subscription-models-for-traders-in-2026 , https://zuplo.com/learning-center/coinmarketcap-api.md
- CryptoPanic: https://github.com/tigusigalpa/cryptopanic-php
- DexScreener (secondary): https://github.com/opensvm/dexscreener-mcp-server
- GeckoTerminal: https://apiguide.geckoterminal.com/faq , https://support.coingecko.com/hc/en-us/articles/22612838274841-Does-GeckoTerminal-have-an-API
- Binance rate limits: https://developers.binance.com/docs/binance-spot-api-docs/websocket-api/rate-limits
- Bybit rate limits: https://bybit-exchange.github.io/docs/zh-TW/v5/rate-limit , https://bybit-exchange.github.io/doc-v3-offline/spot/rate-limit
- Messari: https://www.spark.money/tools/crypto-api-pricing-comparison , https://costbench.com/software/onchain-analytics/messari/free-plan
- NewsAPI terms: https://newsapi.org/terms , https://apicostcalc.com/newsapi.html
- Options data: https://qveris.ai/guides/free-options-chain-api , https://www.nuget.org/packages/Tradier.Client
- Nasdaq calendar API (unofficial): https://apify.com/gochujang/stock-earnings-tracker
- TSETMC libraries: https://pypi.org/project/tsetmc-api , https://www.npmjs.org/package/tse-client
- tgju: https://pkg.go.dev/github.com/amiranmanesh/tgju-api-go , https://github.com/amirh0ss3in/tgju_api , https://github.com/Hameds/APIs-made-in-Iran/issues/120
- Nobitex (unofficial wrapper): https://glama.ai/mcp/servers/@xmannii/nobitex-mcp-server/blob/bd8d253a1306ed7f09745befc05b0d5dc4550888/services/nobitex.service.ts
