# ۰۱ — هسته‌ی چارت (Charting Core) در TradingView

> هدف: مستندسازیِ **رفتار** قابلیت‌ها برای بازسازی clean-room. هیچ کد یا متن طولانی از TradingView کپی نشده؛ همه‌چیز بازنویسی شده است.
> نسخه‌ی مرجع: وب/دسکتاپ Supercharts، ۲۰۲۵–۲۰۲۶. تاریخ تحقیق: 2026-10-13.
>
> راهنمای ستون‌ها:
> - **Complexity**: S = کوچک (چند روز)، M = متوسط (۱–۳ هفته)، L = بزرگ (نیاز به داده/موتور جدا یا ماه‌ها کار)
> - **Priority**: Core = بدون آن محصول معنا ندارد / High / Medium / Low
> - علامت ⚠️ = از منبع رسمی تأیید نشد (بر اساس دانش عمومی/منبع ثانویه)

---

## ۱. انواع چارت (Chart types)

TradingView آن‌ها را در دو دسته قرار می‌دهد: **Time-based** (هر کندل = یک بازه‌ی زمانی) و **Price-based** (کندل جدید فقط وقتی قیمت به اندازه‌ی مشخص حرکت کند؛ محور زمان غیرخطی).

### ۱.۱ چارت‌های زمان‌محور

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Bars | میله‌ی OHLC؛ تیک چپ = Open، تیک راست = Close؛ رنگ بر اساس صعودی/نزولی (اختیاری: رنگ بر اساس کندل قبلی) | S | Core |
| Candles | کندل ژاپنی؛ تنظیم جدا برای Body / Border / Wick و رنگ up/down | S | Core |
| Hollow candles | کندل‌هایی که close>open توخالی‌اند؛ رنگ بر اساس مقایسه با close قبلی | S | High |
| Volume candles | عرض هر کندل متناسب با حجم آن نسبت به سایر کندل‌های قابل‌مشاهده | M | Medium |
| Line | خط وصل‌کننده‌ی close‌ها (منبع قابل‌انتخاب: close/open/high/low/hl2/…) | S | Core |
| Line with markers | مثل Line ولی با دایره روی هر نقطه‌ی داده | S | Medium |
| Step line | خط پله‌ای (افقی سپس عمودی) به‌جای قطری | S | Medium |
| Area | خط با پرشدگی گرادیانی زیر آن | S | High |
| HLC area | ناحیه‌ی بین High و Low با خط Close وسط آن (دو رنگ بالا/پایین close) | M | Low |
| Baseline | دو رنگ نسبت به یک سطح پایه (Base level به درصد ارتفاع یا مقدار)؛ پرشدگی بالا/پایین | M | High |
| Columns | ستون‌های عمودی از صفر تا مقدار (مناسب داده‌ی اقتصادی؛ سبز/قرمز نسبت به قبلی) | S | Medium |
| High-low | فقط میله‌ی بازه‌ی High–Low با برچسب اختیاری بالا/پایین | S | Low |
| Heikin Ashi | کندل‌های هموارشده از میانگین OHLC کندل قبل؛ قیمت‌های واقعی در status line اختیاری | S | High |
| Volume footprint | داخل هر کندل، حجم خرید (راست) و فروش (چپ) در هر سطح قیمت؛ Delta و Total زیر کندل؛ ردیف Imbalance/POC/Value area؛ نیاز به داده‌ی تیک (پلن Premium+) | L | Medium |
| TPO (Time Price Opportunity / Market Profile) | پروفایل حروف‌دار (هر حرف = یک بلاک زمانی مثلاً ۳۰ دقیقه) برای دوره‌ی روزانه/هفتگی/ماهانه؛ POC، Value Area، Initial Balance، Single prints | L | Medium |
| Session volume profile (SVP) | هیستوگرام حجم-در-قیمت برای هر سشن/زیرسشن روی خود چارت (به‌عنوان نوع چارت) | L | Medium |

### ۱.۲ چارت‌های قیمت‌محور (محور زمان غیرخطی)

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Renko | آجر جدید وقتی قیمت به اندازه‌ی Box size حرکت کند؛ Box size: Traditional یا ATR؛ منبع Close یا OHLC؛ Reversal amount؛ اختیاری Wicks | M | Medium |
| Line break | خط/بلوک جدید فقط وقتی close از بازه‌ی N خط قبلی (پیش‌فرض ۳) عبور کند | M | Low |
| Kagi | خط عمودی که با تغییر به اندازه‌ی Reversal (درصد/ATR/ثابت) تغییر جهت می‌دهد؛ ضخامت Yang/Yin | M | Low |
| Point & Figure | ستون‌های X (صعود) و O (نزول)؛ Box size و Reversal amount؛ منبع Close یا High/Low | M | Low |
| Range | کندل جدید وقتی بازه‌ی قیمت به Range مشخص برسد؛ گزینه‌ی Phantom bars | M | Medium |

**نکات رفتاری مشترک:** تعویض نوع چارت از دکمه‌ی toolbar بالا یا Alt+ میانبرها؛ نوع چارت‌های قیمت‌محور در Bar Replay پشتیبانی نمی‌شوند؛ هر نوع چارت تب Symbol مخصوص خودش را در Settings دارد؛ امکان «Favorite» کردن نوع چارت برای دسترسی سریع در toolbar.

---

## ۲. ابزارهای ترسیم (Drawing tools) — گروه‌بندی نوار ابزار چپ

TradingView ابزارها را در **۷ گروه** (شامل Cursors) در نوار چپ قرار می‌دهد. هر دکمه‌ی گروه آخرین ابزار استفاده‌شده را نشان می‌دهد و فلش کنارش زیرمنوی کامل را باز می‌کند؛ هر ابزار ستاره (Favorite) دارد.

### ۲.۱ Cursors

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Cross | نشانگر صلیبی با crosshair کامل | S | Core |
| Dot | نشانگر نقطه‌ای (crosshair مینیمال) | S | Medium |
| Arrow | نشانگر فلش معمولی، بدون crosshair | S | Medium |
| Demonstration | نشانگر نمایشی (دایره‌ی برجسته برای ضبط ویدیو/ارائه) | S | Low |
| Magic | ⚠️ نشانگری که با کلیک روی کندل خودکار لیبل/ابزار مرتبط پیشنهاد می‌دهد (جدید) | M | Low |
| Eraser | کلیک روی هر ترسیم = حذف؛ با Ctrl پاک‌کردن بخشی از Brush | S | High |

### ۲.۲ Trend line tools (Lines + Channels + Pitchforks)

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Trend line | پاره‌خط دونقطه‌ای؛ اختیاری extend چپ/راست، نمایش price range/bars/angle/ % | S | Core |
| Ray | خط از نقطه‌ی اول، بی‌نهایت در جهت نقطه‌ی دوم | S | Core |
| Info line | trend line با باکس اطلاعات (تغییر قیمت، %، تعداد کندل، زمان، زاویه) | S | High |
| Extended line | خط بی‌نهایت در هر دو جهت | S | High |
| Trend angle | trend line با نمایش زاویه و قوس | S | Medium |
| Horizontal line | خط افقی کامل با لیبل قیمت روی محور | S | Core |
| Horizontal ray | خط افقی از نقطه به راست | S | Core |
| Vertical line | خط عمودی در یک زمان، با لیبل زمان | S | Core |
| Cross line | ترکیب خط افقی + عمودی در یک نقطه | S | Medium |
| Parallel channel | کانال سه‌نقطه‌ای با خط میانی و پرشدگی | S | High |
| Regression trend | کانال رگرسیون خطی بین دو زمان با انحراف معیار بالا/پایین و Pearson's R | M | Medium |
| Flat top/bottom | کانال با یک ضلع کاملاً افقی | S | Low |
| Disjoint channel | دو خط غیرموازی (کانال واگرا/همگرا) | S | Low |
| Pitchfork (Andrews) | چنگال سه‌نقطه‌ای با میانه و سطوح موازی قابل‌تنظیم | M | Medium |
| Schiff pitchfork | پیچفورک با نقطه‌ی شروع منتقل‌شده به نیمه‌ی ارتفاع | M | Low |
| Modified Schiff pitchfork | نسخه‌ی اصلاح‌شده با جابه‌جایی زمان و قیمت نقطه‌ی شروع | M | Low |
| Inside pitchfork | پیچفورک با میانه‌ی داخلی | M | Low |

### ۲.۳ Gann & Fibonacci

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Fib retracement | سطوح بازگشتی (0, .236, .382, .5, .618, .786, 1 + اکستنشن‌ها) بین دو نقطه؛ سطوح/رنگ‌ها قابل‌ویرایش؛ log scale؛ reverse | M | Core |
| Trend-based fib extension | سه‌نقطه‌ای؛ اکستنشن از موج اول روی نقطه‌ی سوم | M | High |
| Fib channel | کانال موازی با سطوح فیبوناچی | M | Medium |
| Fib time zone | خطوط عمودی در فواصل فیبوناچی زمانی | S | Medium |
| Fib speed resistance fan | بادبزن سرعت با شبکه‌ی فیبوناچی در قیمت و زمان | M | Low |
| Trend-based fib time | زمان‌های فیبوناچی بر اساس سه نقطه | M | Low |
| Fib circles | دایره‌های هم‌مرکز با شعاع فیبوناچی | M | Low |
| Fib spiral | مارپیچ طلایی | M | Low |
| Fib speed resistance arcs | کمان‌های فیبوناچی از یک نقطه | M | Low |
| Fib wedge | گوه با کمان‌های فیبوناچی | M | Low |
| Pitchfan | بادبزن خطوط از نقطه‌ی پیچفورک | M | Low |
| Gann box | مستطیل با تقسیم‌بندی زمان/قیمت گن (سطوح قابل‌تنظیم، Shift = گام‌های ثابت) | M | Medium |
| Gann square fixed | مربع گن با نسبت ثابت | M | Low |
| Gann square | مربع گن آزاد با بادبزن‌ها و قوس‌ها | M | Low |
| Gann fan | بادبزن زوایای گن (1x1، 1x2، 2x1، …) | M | Medium |

### ۲.۴ Patterns (+ Elliott + Cycles)

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| XABCD pattern | پنج‌نقطه‌ای هارمونیک با نمایش نسبت‌های فیبوناچی هر ساق | M | Medium |
| Cypher pattern | الگوی هارمونیک Cypher با نسبت‌ها | M | Low |
| Head and shoulders | ۷ نقطه با خط گردن | M | Medium |
| ABCD pattern | چهار نقطه با نسبت‌ها | S | Medium |
| Triangle pattern | چهار نقطه‌ی مثلث با پرشدگی | S | Low |
| Three drives pattern | الگوی سه رانش (۷ نقطه) | M | Low |
| Elliott impulse wave (12345) | پنج موج ضربه‌ای با برچسب درجه‌ی موج (Degree) قابل‌انتخاب | M | Medium |
| Elliott correction wave (ABC) | موج اصلاحی سه‌تایی | S | Medium |
| Elliott triangle wave (ABCDE) | مثلث الیوت | S | Low |
| Elliott double combo (WXY) | ترکیبی دوگانه | S | Low |
| Elliott triple combo (WXYXZ) | ترکیبی سه‌گانه | S | Low |
| Cyclic lines | خطوط عمودی با فاصله‌ی برابر تکرارشونده | S | Low |
| Time cycles | نیم‌دایره‌های تکرارشونده در محور زمان | S | Low |
| Sine line | موج سینوسی با دوره/دامنه‌ی تعیین‌شده توسط دو نقطه | S | Low |

### ۲.۵ Forecasting & measurement (+ Volume-based)

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Long position | باکس سود/زیان با Entry/TP/SL؛ محاسبه‌ی R:R، اندازه‌ی پوزیشن بر اساس Account size و Risk %؛ وقتی قیمت به TP/SL برسد وضعیت را نشان می‌دهد | M | Core |
| Short position | همان برای فروش | M | Core |
| Position forecast / Forecast | پیش‌بینی قیمت از نقطه‌ی منبع به هدف؛ پس از رسیدن زمان، نتیجه (Success/Failure) را نشان می‌دهد | M | Medium |
| Bars pattern | کپی کندل‌های یک بازه و چسباندن به‌عنوان الگو (حالت‌ها: HL bars، Line close/open/high/low، Mirror/Flip) | M | Low |
| Ghost feed | کشیدن کندل‌های فرضی آینده با کلیک‌های متوالی | M | Low |
| Projection | پروجکشن سه‌نقطه‌ای (کمان‌های اکستنشن) | M | Low |
| Sector | ⚠️ ابزار قطاع/زاویه‌ی سه‌نقطه‌ای (جدید در لیست رسمی) | S | Low |
| Anchored VWAP | VWAP از نقطه‌ی لنگر انتخابی تا الان با باندهای انحراف معیار | M | High |
| Fixed range volume profile | پروفایل حجم بین دو زمان: POC، Value Area (70%)، Up/Down volume، تعداد ردیف | L | High |
| Anchored volume profile | پروفایل حجم از یک لنگر تا آخرین کندل (رشد با داده‌ی جدید) | L | Medium |
| Price range | اندازه‌گیری فاصله‌ی قیمت (مطلق، %، تیک) | S | High |
| Date range | اندازه‌گیری تعداد کندل، مدت زمان، حجم | S | High |
| Date and price range | ترکیب هر دو در یک باکس | S | High |

### ۲.۶ Geometric shapes + Brushes + Arrows

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Brush | ترسیم آزاد با دست؛ smoothing، فلش ابتدا/انتها، پرشدگی شکل بسته | M | Medium |
| Highlighter | قلم نیمه‌شفاف ضخیم برای هایلایت | S | Low |
| Arrow | پاره‌خط با سر فلش | S | High |
| Arrow marker | فلش بزرگ توپُر با متن | S | Medium |
| Arrow mark up / down / left / right | علامت فلش کوچک لنگرشده به نقطه | S | Medium |
| Rectangle | مستطیل با پرشدگی، متن داخلی، extend چپ/راست، خط میانی | S | Core |
| Rotated rectangle | مستطیل قابل‌چرخش سه‌نقطه‌ای | S | Low |
| Path | خط شکسته‌ی باز با فلش انتها | S | Low |
| Circle | دایره (مرکز + شعاع) | S | Medium |
| Ellipse | بیضی | S | Medium |
| Polyline | چندضلعی بسته با پرشدگی | S | Low |
| Triangle | مثلث سه‌نقطه‌ای | S | Low |
| Arc | کمان سه‌نقطه‌ای | S | Low |
| Curve | منحنی بزیه‌ی تک | S | Low |
| Double curve | منحنی S شکل | S | Low |

### ۲.۷ Annotation tools (Text, Notes, Content)

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Text | متن آزاد روی چارت (فونت، اندازه، bold/italic، پس‌زمینه، border، wrap) | S | Core |
| Anchored text | متنی که به موقعیت صفحه (نه زمان/قیمت) لنگر است | S | Medium |
| Note / Anchored note | پین کوچکی که با hover متن کامل یادداشت را نشان می‌دهد | S | Medium |
| Price note | لیبل قیمت + یادداشت متصل به یک سطح | S | Medium |
| Pin | سنجاق با یادداشت | S | Low |
| Table | جدول قابل‌ویرایش (ردیف/ستون) روی چارت | M | Low |
| Callout | حباب متن با اشاره‌گر به نقطه | S | Medium |
| Comment | حباب گفت‌وگو | S | Low |
| Price label | برچسب قیمت روی یک کندل | S | Medium |
| Signpost | تابلو عمودی با متن/ایموجی روی کندل | S | Low |
| Flag mark | پرچم روی یک کندل | S | Low |
| Image | آپلود و قرار دادن تصویر روی چارت | M | Low |
| X posts / Ideas | جاسازی پست X یا ایده‌ی TradingView روی چارت | M | Low |
| Icons / Emojis / Stickers | کتابخانه‌ی آیکون (FontAwesome-like)، ایموجی (Twemoji) و استیکرهای گرافیکی، قابل‌تغییر اندازه/رنگ/چرخش | M | Low |

### ۲.۸ ابزارهای کمکی نوار چپ (Toolbar utilities)

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Measure | ابزار سریع اندازه‌گیری (همچنین Shift+Click در هر جای چارت) | S | Core |
| Zoom in / Zoom out | کشیدن مستطیل برای زوم ناحیه؛ دکمه‌ی بازگشت زوم | S | High |
| Weak magnet | نقاط ترسیم وقتی نزدیک OHLC باشند به آن می‌چسبند | S | High |
| Strong magnet | همیشه به نزدیک‌ترین OHLC می‌چسبد؛ Ctrl موقتاً magnet را برعکس می‌کند | S | High |
| Snap to indicators | ⚠️ چسبیدن نقاط به مقادیر اندیکاتورها | M | Low |
| Stay in drawing mode (Keep drawing) | بعد از اتمام یک ترسیم، ابزار فعال می‌ماند | S | High |
| Lock all drawings | قفل همه‌ی ترسیم‌ها (غیرقابل جابه‌جایی) | S | High |
| Hide all | منو: پنهان کردن Drawings / Indicators / Positions & orders / All (Ctrl+Alt+H) | S | High |
| Remove | منو: حذف drawings، indicators، یا هر دو (با تأیید) | S | High |
| Sync drawings | منو: همگام‌سازی ترسیم‌ها: فقط این چارت / در layout / سراسری (Global) | M | High |
| Object tree | (در پنل راست) درخت همه‌ی اشیا؛ گروه‌بندی، تغییر ترتیب Z، قفل/مخفی، تغییر نام | M | High |
| Favorites toolbar | نوار شناور جداگانه از ابزارهای ستاره‌دار؛ قابل جابه‌جایی؛ ترتیب قابل‌ویرایش | S | Medium |
| Drawing templates | ذخیره‌ی استایل یک ابزار به‌عنوان قالب (Save as / Apply / Apply default) | S | High |
| Hide/show left toolbar | جمع کردن نوار ابزار | S | Medium |

---

## ۳. ویژگی‌های ترسیم (Drawing properties & behaviors)

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Floating drawing toolbar | با انتخاب ترسیم، نوار شناور: template، رنگ خط، رنگ پر، ضخامت، سبک خط، تنظیمات، قفل، حذف، … | M | Core |
| Settings › Style tab | رنگ/ضخامت/سبک خط (solid/dashed/dotted)، سر خط (arrow/normal)، extend، پرشدگی، سطوح (برای Fib/Gann)، نمایش قیمت/آمار | M | Core |
| Settings › Text tab | متن همراه ترسیم، فونت، رنگ، تراز افقی/عمودی، جهت | S | High |
| Settings › Coordinates tab | ویرایش عددی Price و Bar/Time هر نقطه‌ی لنگر | S | High |
| Settings › Visibility tab | نمایش ترسیم فقط در اینتروال‌های انتخابی (Ticks، Seconds، Minutes، Hours، Days، Weeks، Months، Ranges با بازه‌ی min–max) | M | High |
| Quick interval visibility | منوی راست‌کلیک: «فقط اینتروال فعلی»، «فعلی و بالاتر»، «فعلی و پایین‌تر»، «همه» | S | Medium |
| Multi-select | Ctrl+Click یا انتخاب در Object tree؛ ویرایش گروهی استایل/visibility | M | High |
| Clone | Ctrl+Drag یا منوی Clone؛ Copy/Paste با Ctrl+C/V (حتی بین چارت‌ها) | S | High |
| Move constraints | Shift+Drag = حرکت فقط افقی/عمودی؛ کلیدهای جهت = جابه‌جایی جزئی؛ Shift هنگام ترسیم = زاویه‌ی ۴۵°/افقی، مربع، دایره | S | Medium |
| Lock / Hide per object | قفل و مخفی‌کردن تک‌شیء | S | High |
| Z-order | Bring to front / Send to back / Bring forward / Send backward | S | Medium |
| Move to pane / scale | انتقال ترسیم به پین دیگر یا pin به scale دیگر (چپ/راست/بدون scale) | M | Low |
| Groups (Object tree) | گروه‌بندی اشیا با یک نام؛ عملیات گروهی | M | Medium |
| Drawing sync | ترسیم‌ها بین چارت‌هایی با یک symbol همگام می‌شوند (در layout یا Global — در همه‌ی layoutها) | L | High |
| Drawings bound to symbol | ترسیم‌ها به symbol وابسته‌اند؛ تعویض symbol آن‌ها را پنهان و بازگشت آن‌ها را نشان می‌دهد | M | Core |
| Alerts on drawings | ⚠️ ساخت alert روی trend line/کانال/horizontal line از منوی ترسیم (جزئیات در سند Alerts) | M | High |
| Undo/Redo for drawings | هر ایجاد/ویرایش/حذف در تاریخچه‌ی Undo | M | Core |

---

## ۴. پنجره‌ی Chart settings (همه‌ی تب‌ها)

دسترسی: آیکون چرخ‌دنده، راست‌کلیک › Settings، یا دابل‌کلیک روی سری. پایین پنجره: **Template** (ذخیره/اعمال/Apply defaults)، Cancel، Ok.

### ۴.۱ Symbol

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Style per chart type | رنگ up/down، body/border/wick، ضخامت/سبک خط، منبع قیمت (برای Line/Area/…) | M | Core |
| Color bars based on previous close | رنگ‌دهی بر اساس close قبلی به‌جای open | S | Medium |
| Session | Regular trading hours / Extended trading hours (برای سهام) | M | High |
| Contract change adjustment | Back-adjustment برای Continuous futures | M | Low |
| Settlement as close | استفاده از قیمت تسویه برای کندل روزانه‌ی فیوچرز | S | Low |
| Dividends adjustment | تعدیل داده با سود سهام | M | Low |
| Precision | تعداد اعشار نمایش قیمت (Default، 1/10 … یا کسری مثل 1/32) | S | High |
| Timezone | منطقه‌ی زمانی چارت یا «Exchange» | M | Core |

### ۴.۲ Status line

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Logo | نمایش لوگوی symbol | S | Low |
| Title | Description / Ticker / Ticker and description | S | High |
| Chart values (OHLC) | نمایش O H L C زیر cursor | S | Core |
| Bar change values | تغییر مطلق و درصدی کندل | S | High |
| Volume | حجم در status line | S | High |
| Last day change | ⚠️ تغییر روز آخر | S | Low |
| Indicator titles / arguments / values | نمایش نام، ورودی‌ها و مقدار اندیکاتورها | S | High |
| Market status / Open market status | وضعیت باز/بسته بودن بازار | S | Medium |
| Background | پس‌زمینه‌ی نیمه‌شفاف پشت status line | S | Low |

### ۴.۳ Scales and lines

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Currency and Unit labels | نمایش ارز/واحد روی price scale (و تبدیل ارز) | M | Medium |
| Scale modes | Regular / Percent / Indexed to 100 / Logarithmic (و Auto) | M | Core |
| Lock price to bar ratio | ثابت ماندن نسبت قیمت به تعداد کندل هنگام زوم | M | Medium |
| Scales placement | Auto / Left / Right برای scaleها | M | Medium |
| No overlapping labels | جلوگیری از هم‌پوشانی لیبل‌ها روی محور | M | Medium |
| Plus button | دکمه‌ی + روی price scale برای ساخت سریع alert/order | S | Medium |
| Countdown to bar close | شمارش معکوس بسته‌شدن کندل زیر لیبل قیمت | S | High |
| Symbol last price label/line | لیبل و خط آخرین قیمت (value/line، رنگ) | S | Core |
| Previous day close label/line | خط close روز قبل | S | Medium |
| Pre/Post market price label | قیمت پیش/پس از بازار | S | Low |
| High and low price label/line | خط/لیبل بالاترین و پایین‌ترین قیمت ناحیه‌ی قابل‌مشاهده | S | Medium |
| Average close price line | ⚠️ خط میانگین close محدوده‌ی قابل‌مشاهده | S | Low |
| Bid and ask labels/lines | نمایش bid/ask | S | Medium |
| Indicators & financials name/value labels | لیبل نام/مقدار اندیکاتورها روی scale | S | High |
| Time scale: Day of week on labels | نمایش روز هفته | S | Low |
| Date format / Time hours format | فرمت تاریخ و ۱۲/۲۴ ساعته | S | Medium |
| Save chart left edge position when changing interval | قفل لبه‌ی چپ هنگام تعویض اینتروال | S | Low |

### ۴.۴ Canvas

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Background | رنگ ثابت یا گرادیان | S | High |
| Grid lines | Vertical / Horizontal / Both / None با رنگ و شفافیت | S | Core |
| Pane separators | رنگ جداکننده‌ی پین‌ها | S | Low |
| Crosshair | رنگ، ضخامت، سبک خط | S | High |
| Watermark | نمایش symbol/interval بزرگ در پس‌زمینه | S | Low |
| Scales text/lines | اندازه‌ی فونت، رنگ متن، رنگ خط محورها | S | Medium |
| Navigation buttons | visibility دکمه‌های zoom/scroll/reset (Always / on hover / hidden) | S | Medium |
| Pane buttons | visibility دکمه‌های پین (move up/down، collapse، maximize، remove) | S | Medium |
| Margins | فاصله‌ی سری از بالا/پایین (%) و فاصله‌ی راست (تعداد کندل) | S | Medium |

### ۴.۵ Trading

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Buy/Sell buttons | دکمه‌های خرید/فروش سریع روی چارت | M | Medium |
| Instant order placement | ارسال سفارش بدون پنجره‌ی تأیید | S | Medium |
| Execution sound / Notifications | صدای اجرا؛ اعلان فقط برای رد شدن یا همه‌ی رویدادها | S | Low |
| Positions P&L display | نمایش سود/زیان به پول/تیک/درصد | S | Medium |
| Reverse button | دکمه‌ی معکوس کردن پوزیشن روی hover | S | Low |
| Orders / Brackets P&L | نمایش سفارش‌های باز و سود/زیان TP/SL | M | Medium |
| Executions arrows | فلش‌های اجرای معاملات روی کندل‌ها | S | Medium |
| Extended price lines | امتداد خط سفارش/پوزیشن در کل عرض | S | Low |
| Label alignment | تراز لیبل‌های سفارش: چپ/وسط/راست | S | Low |
| Show on screenshots | شامل کردن سفارش‌ها/پوزیشن‌ها در اسکرین‌شات | S | Low |

### ۴.۶ Alerts

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Alert lines | نمایش خطوط alert روی چارت + رنگ | S | High |
| Only active alerts | فقط alertهای فعال نمایش داده شوند | S | Medium |
| Alert volume | بلندی صدای alert | S | Low |
| Auto-hide toasts | پنهان شدن خودکار پاپ‌آپ بعد از ۲۰ ثانیه | S | Low |

### ۴.۷ Events

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Ideas | نمایش ایده‌های کامیونیتی روی چارت (رنگ بر اساس جهت) | M | Low |
| Dividends / Splits | آیکون رویدادهای سود سهام و تقسیم سهام روی محور زمان | M | Medium |
| Earnings | تاریخ گزارش سود، EPS/Revenue تخمینی و واقعی، خطوط Earnings break | M | Medium |
| Economic events | ⚠️ رویدادهای تقویم اقتصادی روی محور زمان | M | Medium |
| Latest news / news notifications | نشانگر آخرین خبر و اعلان خبر | M | Low |

---

## ۵. Layouts و قابلیت‌های سطح‌بالای چارت

### ۵.۱ Multi-chart layouts

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Multi-chart grid | تا ۱۶ چارت در یک layout (محدودیت پلن: 1/2/4/8/10/16)؛ ده‌ها آرایش (ردیفی، ستونی، شبکه 2x2، 3x3، 1+3، …) | L | High |
| Resizable splitters | تغییر اندازه‌ی چارت‌ها با کشیدن مرز | M | High |
| Active chart / maximize | چارت فعال با کادر آبی؛ Alt+Enter = تمام‌صفحه کردن یک چارت؛ Tab بین چارت‌ها | S | High |
| Sync: Symbol | تعویض symbol در همه‌ی چارت‌ها | S | High |
| Sync: Interval | تعویض اینتروال در همه | S | High |
| Sync: Crosshair | نمایش crosshair هم‌زمان در همه | M | High |
| Sync: Time | اسکرول به یک زمان مشترک در همه (go-to-date همگام) | M | Medium |
| Sync: Date range | همگام‌سازی بازه‌ی تاریخ (Range selector) | M | Medium |
| Sync groups (linking) | گروه‌های رنگی برای همگام‌سازی جزئی symbol بین چارت‌ها و ویجت‌ها | M | Medium |
| Multiple tabs / windows | ⚠️ layoutها در تب‌های مختلف/پنجره‌های دسکتاپ؛ دسکتاپ چند مانیتور | M | Low |

### ۵.۲ Layout saving, templates, sharing

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Save / autosave layout | ذخیره‌ی کامل وضعیت (symbolها، اینتروال، اندیکاتورها، ترسیم‌ها، تنظیمات) در cloud؛ autosave اختیاری | M | Core |
| Layout manager | Save as / Rename / Make a copy / Load (.)؛ لیست layoutها با جستجو و ستاره | M | High |
| Share layout | لینک عمومی read-only به layout (Sharing on/off) | M | Medium |
| Chart templates | ذخیره‌ی اندیکاتورها + استایل (اختیاری با symbol/interval) و اعمال روی هر چارت | M | High |
| Indicator templates | ذخیره‌ی مجموعه‌ای از اندیکاتورها | S | High |
| Default settings templates | Template در پایین هر پنجره‌ی Settings (Save as default) | S | Medium |
| Export chart data | ⚠️ دانلود CSV داده‌ی چارت (OHLC + اندیکاتورها) — پلن پولی | S | Medium |
| Import/export settings | ⚠️ نیست (cloud-based) | — | Low |

### ۵.۳ Compare / Overlay / Symbol math

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Compare symbol | اضافه کردن symbol دیگر روی چارت؛ scale خودکار به Percent | M | High |
| Overlay on new price scale / same scale | قرار دادن symbol روی scale جدید یا همان scale یا پین جدید | M | Medium |
| Spread / Symbol math | عبارت در جستجو مثل `BTCUSDT/ETHUSDT`، `ES1!-NQ1!`، `2*AAPL+MSFT`؛ عملگرهای + − * / و ثابت‌ها، توان؛ چارت سنتتیک | L | Medium |
| Price scale per series | هر سری/اندیکاتور: Pin to right/left scale، New scale، No scale (overlay) | M | High |

### ۵.۴ Price scale modes & actions

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Auto (fits data to screen) | فیت خودکار عمودی بر اساس داده‌ی قابل‌مشاهده؛ کشیدن scale = خاموش‌شدن auto؛ دکمه‌ی A | M | Core |
| Logarithmic (Alt+L) | scale لگاریتمی | M | Core |
| Percent (Alt+P) | نمایش درصد تغییر نسبت به اولین کندل قابل‌مشاهده | M | High |
| Indexed to 100 | نرمال‌سازی به ۱۰۰ از اولین کندل قابل‌مشاهده | M | Medium |
| Invert scale (Alt+I) | وارونه کردن محور قیمت | S | Medium |
| Lock price to bar ratio | ثابت نگه‌داشتن نسبت | M | Low |
| Scale price chart only | auto-scale فقط بر اساس سری اصلی (اندیکاتورها نادیده) | S | Medium |
| Scale placement / Merge scales | انتقال scale به چپ/راست؛ Merge all scales into one | M | Medium |
| Drag to zoom price / time | کشیدن روی محور قیمت = فشرده/کشیده کردن؛ روی محور زمان = زوم افقی؛ دابل‌کلیک = reset | M | Core |
| Reset chart (Alt+R) | بازگرداندن زوم و scale به پیش‌فرض | S | Core |

### ۵.۵ Sessions & timezone

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Extended hours (ETH) | نمایش pre/post market؛ پس‌زمینه‌ی متفاوت برای سشن‌های خارج از بازار | M | High |
| Session breaks | خطوط عمودی جداکننده‌ی سشن‌ها | S | Medium |
| Timezone selector | انتخاب منطقه‌ی زمانی (UTC، Exchange، شهرهای مختلف) از پایین چارت | M | Core |
| Bottom toolbar | Date range presets (1D, 5D, 1M, 3M, 6M, YTD, 1Y, 5Y, All)، Go to date، ساعت+timezone، دکمه‌های %/log/auto | M | High |

### ۵.۶ Bar Replay

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Select bar | خط عمودی آبی با قیچی؛ کلیک = نقطه‌ی شروع (کندل‌های بعدی پنهان) | M | High |
| Select date | انتخاب تاریخ شروع از تقویم | S | High |
| First available date | پرش به اولین کندل موجود | S | Medium |
| Random bar | شروع از کندل تصادفی (برای تمرین بدون سوگیری) | S | Medium |
| Play / Pause (Shift+↓) | پخش خودکار | M | High |
| Forward (Shift+→) | یک قدم جلو | S | High |
| Speed | سرعت پخش (حدوداً ۱۰ ثانیه تا ۰.۱ ثانیه برای هر کندل — ⚠️ مقادیر دقیق تأیید نشد) | S | High |
| Update interval (replay interval) | پخش با اینتروال پایین‌تر از اینتروال چارت (مثلاً کندل ۱ساعته که با داده‌ی ۱ دقیقه‌ای ساخته می‌شود) | L | Medium |
| Jump to real-time | خروج از replay و بازگشت به live | S | High |
| Replay for all charts | حالت فقط این چارت یا همه‌ی چارت‌های layout، همگام در زمان | L | Medium |
| Session save/resume | ذخیره‌ی خودکار وضعیت replay و ادامه از همان نقطه | M | Medium |
| Replay trading | ⚠️ معامله‌ی شبیه‌سازی‌شده روی داده‌ی replay (پنل buy/sell، P&L) — طبق مستند فعلی سفارش‌ها روی داده‌ی real-time اجرا می‌شوند؛ نیاز به بررسی بیشتر | L | Medium |
| Indicators in replay | اندیکاتورها با داده‌ی replay محاسبه می‌شوند؛ Regression trend و FRVP غیرفعال‌اند | M | High |
| Limitations | پشتیبانی نمی‌شود: Renko, Kagi, PnF, Range, Line break, Footprint, TPO، spread و tick charts | — | — |

### ۵.۷ Intervals

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Standard intervals | 1m, 3m, 5m, 15m, 30m, 45m, 1h, 2h, 3h, 4h, 1D, 1W, 1M, 3M, 6M, 12M | M | Core |
| Seconds | 1s, 5s, 10s, 15s, 30s (پلن پولی) | M | Medium |
| Ticks | 1T, 10T, 100T, 1000T (پلن Expert+؛ فقط اگر داده موجود باشد) | L | Low |
| Ranges | 1R, 10R, 100R, 1000R (کندل range) | M | Low |
| Custom interval | افزودن اینتروال دلخواه: عدد + واحد (minutes/hours/days/weeks/months/ranges/seconds) | S | High |
| Favorite intervals | ستاره‌دار کردن اینتروال‌ها برای نمایش در toolbar بالا | S | High |
| Type-to-change interval | تایپ عدد (مثلاً 15، 4h، 1D) یا «,» روی چارت = پنجره‌ی تغییر اینتروال | S | High |

### ۵.۸ Symbol search

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Symbol search dialog | جستجوی ticker/نام با فیلتر نوع (All، Stocks، Funds، Futures، Forex، Crypto، Indices، Bonds، Economy، Options) | M | Core |
| Exchange / Source filter | فیلتر بر اساس صرافی/کشور | S | High |
| Type-to-search | شروع تایپ روی چارت = باز شدن جستجو | S | High |
| Recent searches | لیست جستجوهای اخیر | S | Medium |
| Futures contracts expansion | نمایش قراردادهای فیوچرز و continuous (1!, 2!) | M | Low |
| Spread input | تایپ عبارت ریاضی در همان فیلد | M | Medium |
| Logos / badges | لوگو و نوع/صرافی کنار هر نتیجه | S | Medium |

### ۵.۹ Undo/Redo, Object tree, Data window

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Undo / Redo | Ctrl+Z / Ctrl+Y برای ترسیم‌ها، اندیکاتورها، تنظیمات، تغییر symbol؛ دکمه‌ها در toolbar بالا | M | Core |
| Object tree | لیست سلسله‌مراتبی پین‌ها > سری‌ها/اندیکاتورها/ترسیم‌ها؛ drag برای ترتیب؛ قفل/مخفی/حذف/گروه | M | High |
| Data window | مقادیر OHLCV و همه‌ی اندیکاتورها زیر crosshair برای همه‌ی پین‌ها (تب کنار Object tree) | S | High |

### ۵.۱۰ Screenshots, sharing, publish

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Download image | ذخیره‌ی PNG چارت (Ctrl+Alt+S) | M | High |
| Copy image | کپی تصویر به clipboard (Ctrl+Shift+S) | S | High |
| Copy link to chart image | آپلود snapshot و کپی لینک (Alt+S) | M | Medium |
| Open in new tab / Tweet image | باز کردن snapshot یا اشتراک در X | S | Low |
| Publish idea | انتشار چارت همراه متن به‌عنوان Idea (عمومی/خصوصی) — بیرون از هسته | L | Low |
| Share layout link | لینک layout (نسخه‌ی live) | M | Medium |

### ۵.۱۱ میانبرهای مهم صفحه‌کلید (Keyboard shortcuts)

| Shortcut | Action |
|---|---|
| تایپ حروف / Ctrl+K | تعویض symbol / Quick search |
| تایپ عدد یا `,` | تعویض اینتروال |
| `/` | پنجره‌ی Indicators |
| `.` / Ctrl+S | Load layout / Save layout |
| Ctrl+Z / Ctrl+Y | Undo / Redo |
| ← / → ، Ctrl+← / Ctrl+→ | حرکت یک کندل / حرکت بیشتر |
| Ctrl+↑ / Ctrl+↓ ، Ctrl+Wheel | Zoom in/out |
| Shift+Wheel | اسکرول افقی |
| Alt+G | Go to date |
| Alt+R | Reset chart |
| Alt+I / Alt+L / Alt+P | Invert / Log / Percent scale |
| Alt+S | Snapshot + کپی URL |
| Alt+T / H / V / C / F | Trend line / Horizontal / Vertical / Cross line / Fib retracement |
| Alt+Shift+R | Rectangle |
| Ctrl+Alt+H | Hide all drawings |
| Ctrl+C / Ctrl+V ، Ctrl+Drag | کپی/پیست / clone ترسیم |
| Shift+Click | Measure سریع |
| Del / Backspace | حذف ترسیم انتخاب‌شده |
| Alt+Enter ، Tab / Shift+Tab | Maximize چارت فعال / جابه‌جایی بین چارت‌ها |
| Alt+W | افزودن به watchlist |
| Alt+A | ⚠️ ساخت alert |
| Shift+↓ / Shift+→ | Replay: play-pause / step |
| Dbl-click on pane / Ctrl+Dbl-click | Maximize / Collapse پین |
| Ctrl+? (یا Cmd+?) | ⚠️ نمایش لیست میانبرها |

### ۵.۱۲ تعاملات پایه‌ی چارت (موارد ضمنی که باید ساخته شوند)

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Pan / zoom (mouse, touch, wheel) | کشیدن، اسکرول، pinch؛ kinetic scroll | M | Core |
| Crosshair + axis labels | crosshair با لیبل قیمت و زمان روی محورها | S | Core |
| Lazy loading history | بارگذاری کندل‌های قدیمی‌تر هنگام اسکرول به چپ | M | Core |
| Real-time bar updates | به‌روزرسانی آخرین کندل با تیک‌های زنده | M | Core |
| Panes (multi-pane) | پین‌های مجزا برای اندیکاتورها با splitter، maximize، collapse، move up/down | M | Core |
| Context menu | راست‌کلیک: Reset, Copy price, Add alert, Settings, Remove, Visual order, … | M | High |
| Scroll to realtime button | دکمه‌ی »» برای پرش به آخرین کندل | S | High |
| Volume overlay | حجم به‌صورت هیستوگرام در پایین پین اصلی | S | Core |
| Light / Dark theme | تم روشن و تاریک | S | High |

---

## Sources

- https://in.tradingview.com/support/solutions/43000703407 — Chart types available on TradingView
- https://tradingview.com/support/solutions/43000703396-drawing-tools — Drawing tools (۷ گروه + utilities)
- https://www.tradingview.com/charting-library-docs/v27/ui_elements/drawings/Drawings-List/ — Drawings list (Charting Library)
- https://tradingview.com/support/solutions/43000748166-how-to-configure-your-supercharts — Chart settings tabs
- https://tradingview.com/support/solutions/43000746464 — Supercharts: all you need to know
- https://www.tradingview.com/support/solutions/43000712747-bar-replay-how-and-why-to-test-a-strategy-in-the-past/ — Bar Replay
- https://in.tradingview.com/support/solutions/43000474024 — How do I turn Bar Replay on?
- https://www.tradingview.com/blog/en/intervals-in-bar-replay-50381 — Replay intervals
- https://www.tradingview.com/charting-library-docs/v29/getting_started/Shortcuts — Keyboard shortcuts
- https://in.tradingview.com/support/solutions/43000629992 — How to sync the charts of my layout
- https://tradingview.com/support/solutions/43000694474-why-chart-connections-are-limited — Charts per layout by plan
- https://www.tradingview.com/blog/en/new-chart-layout-patterns-45487 — New chart layout patterns
- https://www.tradingview.com/blog/en/new-chart-type-volume-footprint-44399 — Volume footprint
- https://www.tradingview.com/blog/en/expanded-tick-chart-support-52342 — Tick charts
- https://in.tradingview.com/support/solutions/43000660419-i-want-to-customize-the-visibility-for-several-objects/ — Visibility for several objects
- https://in.tradingview.com/support/solutions/43000686263-how-to-quickly-adjust-visibility-of-a-drawing-or-indicator/ — Quick visibility
- https://www.tradingview.com/blog/en/faster-setup-of-visibility-on-intervals-34613 — Visibility on intervals
- https://www.tradingview.com/blog/en/brand-new-drawing-tool-highlighter-21947 — Highlighter
- https://www.tradingview.com/blog/en/new-settings-for-drawing-tools-on-tradingview-17920 — Drawing text settings
- https://br.tradingview.com/charting-library-docs/latest/ui_elements/Price-Scale — Price scale (Charting Library)
- https://fxnewsgroup.com/forex-news/platforms/tradingview-adds-session-volume-profile-to-lineup-of-chart-types/ — SVP (ثانویه)
- https://fxnewsgroup.com/forex-news/platforms/tradingview-introduces-time-price-opportunity-chart-type/ — TPO (ثانویه)
- https://nexusfi.com/a/platforms/tradingview-spread-charts — Spread charts (ثانویه)
