// Persian interface. English strings in the markup and in the panels are replaced by exact-match lookup in `FA`, in
// text and in title / placeholder / aria-label attributes, and again for everything rendered later (a MutationObserver
// watches the page). Strings that carry numbers or names (e.g. "Order · BTCUSDT") are left in English unless the static
// part is its own text node. Anything missing from `FA` simply stays English: add the exact English string and its
// translation to extend coverage. The chart canvas, the code editors and form values are never touched.
import { store } from './store.ts';

export type Lang = 'en' | 'fa';

export const FA: Record<string, string> = {
  // top bar
  'ƒx Indicators': 'ƒx اندیکاتورها', '⏰ Alert': '⏰ هشدار', '⏪ Replay': '⏪ بازپخش', '▦ Order flow': '▦ اردرفلو', 'Unnamed': 'بدون‌نام',
  'Symbol search (start typing on the chart)': 'جستجوی نماد (روی نمودار شروع به تایپ کنید)', 'Compare or add symbol': 'مقایسه یا افزودن نماد', 'All intervals': 'همه‌ی بازه‌ها',
  'Chart type': 'نوع نمودار', 'Indicators (/)': 'اندیکاتورها (/)', 'Indicator & chart templates': 'قالب اندیکاتور و نمودار', 'Create alert (Alt+A)': 'ساخت هشدار (Alt+A)',
  'Bar replay': 'بازپخش کندل', 'Footprint, order flow and liquidity heatmap': 'فوت‌پرینت، اردرفلو و نقشه‌ی نقدینگی', 'Undo (Ctrl+Z)': 'بازگشت (Ctrl+Z)', 'Redo (Ctrl+Y)': 'جلو (Ctrl+Y)',
  'Chart layout': 'چیدمان نمودار', 'Sync across charts': 'همگام‌سازی نمودارها', 'Save / load layouts': 'ذخیره / بارگذاری چیدمان', 'Server & notifications': 'سرور و اعلان‌ها', 'Diagnostics': 'عیب‌یابی', 'Collect report': 'جمع‌آوری گزارش', 'Copy': 'کپی',
  'Server and notifications': 'سرور و اعلان‌ها', 'Chart settings': 'تنظیمات نمودار', 'Fullscreen': 'تمام‌صفحه', 'Snapshot': 'عکس از نمودار', 'Theme': 'پوسته',
  // replay
  '✂ Select bar': '✂ انتخاب کندل', 'Select bar': 'انتخاب کندل', 'Start from date': 'شروع از تاریخ', 'Random bar': 'کندل تصادفی', 'First available date': 'اولین تاریخ موجود',
  'Step back': 'یک قدم عقب', 'Play / pause (Shift+↓)': 'پخش / توقف (Shift+↓)', 'Step forward (Shift+→)': 'یک قدم جلو (Shift+→)', 'Speed': 'سرعت', 'All charts': 'همه‌ی نمودارها',
  'Jump to real-time ✕': 'بازگشت به زمان واقعی ✕', 'Every chart in the layout replays to the same time (always on while time sync is on)': 'همه‌ی نمودارهای چیدمان تا یک زمان بازپخش می‌شوند (با همگام‌سازی زمان همیشه روشن است)',
  // bottom bar and tabs
  'Go to date (Alt+G)': 'رفتن به تاریخ (Alt+G)', 'Timezone (change in Chart settings › Symbol)': 'منطقه‌ی زمانی (در تنظیمات نمودار › نماد)', 'Percent scale (Alt+P)': 'مقیاس درصدی (Alt+P)',
  'Log scale (Alt+L)': 'مقیاس لگاریتمی (Alt+L)', 'Auto scale': 'مقیاس خودکار', 'log': 'لگاریتمی', 'auto': 'خودکار', 'Drag to resize': 'برای تغییر اندازه بکشید', 'Collapse': 'جمع کردن',
  'Repaint check': 'بررسی ریپینت', 'Run the script with and without the data after each bar: a value that changes was using the future (lookahead)': 'اسکریپت را یک بار با داده‌ی بعد از هر کندل و یک بار بدون آن اجرا می‌کند: مقداری که عوض شود از آینده استفاده کرده است (lookahead)',
  'Pine Editor': 'ویرایشگر Pine', 'Strategy Tester': 'تستر استراتژی', 'Positions': 'پوزیشن‌ها', 'Orders': 'سفارش‌ها', 'History': 'تاریخچه',
  'Untitled': 'بدون‌عنوان', '⤓ Install': '⤓ نصب', '⤒ Export': '⤒ خروجی', 'Save': 'ذخیره', 'Add to chart': 'افزودن به نمودار', 'Save (Ctrl+S)': 'ذخیره (Ctrl+S)',
  'Open, create or install scripts': 'باز کردن، ساختن یا نصب اسکریپت', 'Download as .pine': 'دانلود به‌صورت .pine',
  'No strategy on the chart': 'استراتژی‌ای روی نمودار نیست', 'Overview': 'نمای کلی', 'Performance': 'عملکرد', 'List of trades': 'فهرست معاملات', 'Properties': 'ویژگی‌ها',
  'Optimize': 'بهینه‌سازی', 'Walk-forward': 'Walk-forward', 'Monte Carlo': 'مونت‌کارلو', 'Portfolio': 'پورتفو', 'Forward test': 'فوروارد تست', '＋ No-code': '＋ بدون کد', '⤒ CSV': '⤒ CSV',
  'Build a strategy without code': 'ساخت استراتژی بدون کدنویسی', 'Download the report and trade list as CSV': 'دانلود گزارش و فهرست معاملات به‌صورت CSV',
  // side panels
  // multiple watchlists
  'Watchlists': 'فهرست‌های دیده‌بان', 'New watchlist': 'فهرست دیده‌بان جدید', 'Show several lists at once': 'نمایش چند فهرست در یک نما',
  'Import symbols into this list (plain text, one per line, or a TradingView export)': 'ورود نمادها به این فهرست (متن ساده، هر خط یک نماد، یا خروجی TradingView)',
  'Sections, columns, flags, list options': 'بخش‌ها، ستون‌ها، پرچم‌ها، گزینه‌های فهرست',
  'Move, copy or remove': 'انتقال، کپی یا حذف', 'Rename list…': 'تغییر نام فهرست…', 'List colour': 'رنگ فهرست', 'List icon': 'نماد فهرست', 'Custom…': 'دلخواه…', 'No icon': 'بدون نماد',
  'Duplicate list': 'تکثیر فهرست', 'Move left': 'انتقال به چپ', 'Move right': 'انتقال به راست', 'Export as text file': 'خروجی به‌صورت فایل متنی', 'Delete list…': 'حذف فهرست…',
  'Move to list': 'انتقال به فهرست', 'Copy to list': 'کپی در فهرست', 'New list…': 'فهرست جدید…', 'Import as new list…': 'ورود به‌صورت فهرست جدید…',
  'All lists': 'همه‌ی فهرست‌ها', 'Single list': 'یک فهرست', 'Undo': 'بازگشت', 'Add section…': 'افزودن بخش…',
  'You can have at most 50 watchlists': 'حداکثر ۵۰ فهرست دیده‌بان می‌توانید داشته باشید',
  'A watchlist can hold at most 500 symbols': 'هر فهرست دیده‌بان حداکثر ۵۰۰ نماد دارد',
  'Your watchlists are too large to sync; remove some symbols or lists': 'فهرست‌های شما برای همگام‌سازی بیش از حد بزرگ‌اند؛ چند نماد یا فهرست را حذف کنید',
  'Keep at least one watchlist': 'دست‌کم یک فهرست دیده‌بان باید بماند', 'Enter a name for the watchlist': 'برای فهرست یک نام وارد کنید',
  'Watchlist name': 'نام فهرست', 'No symbols found in that file': 'نمادی در این فایل پیدا نشد', 'No new symbols in that file': 'نماد تازه‌ای در این فایل نیست',
  'Watchlist': 'دیده‌بان', 'Alerts': 'هشدارها', 'Trade': 'معامله', 'Journal': 'ژورنال', '＋ Create': '＋ ساخت', 'Add': 'افزودن', 'Log': 'گزارش', 'Import': 'ورود', 'Clear': 'پاک کردن',
  'Add current symbol (Alt+W)': 'افزودن نماد فعلی (Alt+W)', 'Sections, columns, flags': 'بخش‌ها، ستون‌ها، پرچم‌ها', 'Price': 'قیمت', 'Alert price': 'قیمت هشدار',
  'Clear the alert log': 'پاک کردن گزارش هشدار', 'Object tree': 'درخت اشیاء', 'Data window': 'پنجره‌ی داده', 'Object tree and Data window': 'درخت اشیاء و پنجره‌ی داده',
  'Market: screener, DEX, heatmap, movers, calendar, news': 'بازار: اسکرینر، DEX، نقشه‌ی حرارتی، پرنوسان‌ها، تقویم، اخبار', 'DOM / Level 2 and Time & Sales': 'DOM / سطح ۲ و ریز معاملات',
  'Liquidations (live)': 'لیکوئید شدن‌ها (زنده)', 'Trading journal': 'ژورنال معاملاتی', 'Accounts: paper and exchange testnets': 'حساب‌ها: تمرینی و testnet صرافی‌ها',
  'Skills: sizing, risk, regime, screeners (rules, no AI)': 'اسکیل‌ها: حجم پوزیشن، ریسک، رژیم بازار، اسکنرها (قاعده‌محور، بدون هوش مصنوعی)',
  'AI assistant (local model): explain the chart, write Pine, review trades': 'دستیار هوش مصنوعی (مدل محلی): توضیح نمودار، نوشتن Pine، مرور معاملات',
  'Keyboard shortcuts (Ctrl+/)': 'میانبرهای صفحه‌کلید (Ctrl+/)', 'Keyboard shortcuts': 'میانبرهای صفحه‌کلید',
  // trade ticket
  'Account': 'حساب', 'Buy': 'خرید', 'Sell': 'فروش', 'Market': 'بازار', 'Limit': 'لیمیت', 'Stop': 'استاپ', 'Stop‑limit': 'استاپ‌لیمیت', 'Trailing': 'تریلینگ',
  'Stop price': 'قیمت استاپ', 'Limit price': 'قیمت لیمیت', 'Trail by': 'فاصله‌ی تریل', 'Size': 'حجم', 'Quantity': 'مقدار', 'Take profit': 'حد سود', 'Stop loss': 'حد ضرر',
  'Reduce-only': 'فقط کاهشی', 'Exit plan': 'برنامه‌ی خروج', 'OCO with a second order': 'OCO با سفارش دوم', 'Reset paper account': 'بازنشانی حساب تمرینی', 'units (qty)': 'واحد (مقدار)', 'quote amount': 'مبلغ',
  '% of available': 'درصد از موجودی', '% equity risked to SL': 'درصد سرمایه در ریسک تا حد ضرر', '% of price': 'درصد قیمت', 'price units': 'واحد قیمت',
  // DOM
  'Time & Sales': 'ریز معاملات', 'merge': 'ادغام',
  // journal
  '⤢ Open': '⤢ باز کردن', 'Trades': 'معاملات', 'Stats': 'آمار', 'Calendar': 'تقویم', 'Setups': 'ستاپ‌ها', '📓 Journal': '📓 ژورنال', '＋ New entry': '＋ ثبت جدید',
  'Journal sections': 'بخش‌های ژورنال', 'Close (Esc)': 'بستن (Esc)', 'Show on chart': 'نمایش روی نمودار', 'Delete': 'حذف', 'Skip': 'رد شدن', 'Skip all': 'رد شدن از همه',
  'Backup (.json)': 'پشتیبان (.json)', 'Restore…': 'بازیابی…', 'Clear journal': 'پاک کردن ژورنال', 'Done': 'تمام',
  'Open the full journal: dashboard, journals, analyses and tools': 'باز کردن ژورنال کامل: داشبورد، ژورنال‌ها، تحلیل‌ها و ابزارها', 'Export the filtered trades as CSV': 'خروجی CSV از معاملات فیلترشده',
  'Journal settings, backup and restore': 'تنظیمات ژورنال، پشتیبان و بازیابی',
  // dialogs
  'Reset to defaults': 'بازگشت به پیش‌فرض', 'Ok': 'تأیید', 'Style': 'سبک', 'Text': 'متن', 'Coordinates': 'مختصات', 'Visibility': 'نمایش', 'Template ▾': 'قالب ▾', 'Cancel': 'انصراف',
  'Symbol search': 'جستجوی نماد', 'Change interval': 'تغییر بازه‌ی زمانی', 'Go to': 'رفتن به', 'Chart layouts': 'چیدمان‌های نمودار', 'Save as…': 'ذخیره با نام…', 'New': 'جدید',
  'Export': 'خروجی', 'Share link': 'لینک اشتراک', 'Autosave': 'ذخیره‌ی خودکار', 'Close': 'بستن', 'No-code strategy builder': 'سازنده‌ی استراتژی بدون کد', 'Reset': 'بازنشانی',
  'Create & add to chart': 'ساخت و افزودن به نمودار', 'Create alert': 'ساخت هشدار', 'Symbol': 'نماد', 'Interval': 'بازه', 'Source': 'منبع', 'Condition': 'شرط', 'Value': 'مقدار',
  'Trigger': 'فعال‌سازی', 'Expiration': 'انقضا', 'Never': 'هرگز', 'Alert name': 'نام هشدار', 'Message': 'پیام', 'Notify': 'اطلاع‌رسانی', 'Pop-up': 'پنجره‌ی اعلان', 'Push': 'نوتیفیکیشن',
  'Telegram': 'تلگرام', 'Email': 'ایمیل', 'Webhook': 'وب‌هوک', 'Create': 'ساخت', 'Inputs': 'ورودی‌ها', 'Defaults': 'پیش‌فرض‌ها',
  'Symbol, or an expression like BTCUSDT/ETHUSDT': 'نماد، یا عبارتی مثل BTCUSDT/ETHUSDT', 'Exchange / data source': 'صرافی / منبع داده', 'Forex, metals, indices & stocks': 'فارکس، فلزات، شاخص‌ها و سهام',
  'Binance (direct)': 'بایننس (مستقیم)', 'Loading markets…': 'در حال بارگیری بازارها…', 'No matches': 'موردی پیدا نشد', 'e.g. 15, 4h, 1D, 2W, 1M': 'مثلاً 15، 4h، 1D، 2W، 1M',
  // server panel
  'Bot token': 'توکن ربات', 'Remove': 'حذف', 'Chat id': 'شناسه‌ی چت', 'Pick chat': 'انتخاب چت', 'Send test': 'ارسال آزمایشی', 'Email (SMTP)': 'ایمیل (SMTP)', 'Password': 'رمز عبور',
  'Notifications on this device': 'اعلان‌ها روی این دستگاه', 'Desktop pop-ups': 'اعلان دسکتاپ', 'Allow': 'اجازه', 'Trade recording': 'ضبط معاملات', 'Symbols': 'نمادها',
  'Home network access': 'دسترسی از شبکه‌ی خانه', 'Enabled': 'فعال', 'Addresses': 'نشانی‌ها', 'Certificate': 'گواهی',
  // symbol types (search tabs, market lists)
  'all': 'همه', 'stock': 'سهام', 'etf': 'صندوق', 'bond': 'اوراق', 'right': 'حق تقدم', 'futures': 'آتی', 'option': 'اختیار', 'commodity': 'کالا', 'index': 'شاخص',
  'currency': 'ارز', 'gold': 'طلا', 'coin': 'سکه', 'spot': 'اسپات', 'perpetual': 'پرپچوال', 'future': 'سررسیددار', 'forex': 'فارکس', 'metal': 'فلز', 'energy': 'انرژی',
  // calendar names in settings
  'gregorian': 'میلادی', 'jalali': 'شمسی',
  // chart settings dialog
  'Trading': 'معامله', 'Status line': 'نوار وضعیت', 'Scales and lines': 'مقیاس و خطوط', 'Canvas': 'بوم',
  'Candles': 'کندل‌ها', 'Up color': 'رنگ صعودی', 'Down color': 'رنگ نزولی', 'Body': 'بدنه', 'Borders': 'حاشیه‌ها', 'Wick': 'سایه', 'Color bars based on previous close': 'رنگ کندل بر اساس پایانی قبلی',
  'Data modification': 'تغییر داده', 'Precision': 'دقت اعشار', 'Timezone': 'منطقه‌ی زمانی', 'Price-based charts': 'نمودارهای قیمت‌محور', 'Renko/PnF box size (atr or a price)': 'اندازه‌ی جعبه‌ی Renko/PnF (atr یا یک قیمت)',
  'ATR length': 'طول ATR', 'Reversal (boxes)': 'برگشت (جعبه)', 'Line break: number of lines': 'Line break: تعداد خط', 'Range size (0 = auto)': 'اندازه‌ی Range (۰ = خودکار)',
  'Chart values (OHLC)': 'مقادیر نمودار (OHLC)', 'Title': 'عنوان', 'Bar change values': 'تغییر کندل', 'Volume': 'حجم', 'Indicator titles': 'عنوان اندیکاتورها', 'Indicator arguments': 'پارامترهای اندیکاتور', 'Indicator values': 'مقدار اندیکاتورها', 'Background': 'پس‌زمینه',
  'Price scale': 'مقیاس قیمت', 'Scale mode': 'حالت مقیاس', 'Invert scale': 'مقیاس معکوس', 'Scale placement': 'جای مقیاس', 'Top margin %': 'حاشیه‌ی بالا ٪', 'Bottom margin %': 'حاشیه‌ی پایین ٪', 'Lines': 'خط‌ها',
  'Symbol last price label': 'برچسب آخرین قیمت', 'Symbol last price line': 'خط آخرین قیمت', 'Countdown to bar close': 'شمارش معکوس تا بسته شدن کندل', 'Previous day close line': 'خط پایانی روز قبل', 'High and low price lines': 'خط بالاترین و پایین‌ترین قیمت',
  'Average close price line': 'خط میانگین قیمت پایانی', 'Indicator value labels': 'برچسب مقدار اندیکاتور', 'Time scale': 'مقیاس زمان', 'Right margin (bars)': 'حاشیه‌ی راست (کندل)', 'Day of week on labels': 'روز هفته روی برچسب‌ها',
  'Date format (Gregorian)': 'قالب تاریخ (میلادی)', '12-hour time': 'ساعت ۱۲ ساعته', 'Chart basic styles': 'سبک پایه‌ی نمودار', 'Background color': 'رنگ پس‌زمینه', 'Gradient bottom color': 'رنگ پایین گرادیان',
  'Vertical grid lines': 'شبکه‌ی عمودی', 'Horizontal grid lines': 'شبکه‌ی افقی', 'Grid color': 'رنگ شبکه', 'Pane separators': 'جداکننده‌ی پنل‌ها', 'Crosshair mode': 'حالت crosshair', 'Crosshair color': 'رنگ crosshair',
  'Crosshair width': 'ضخامت crosshair', 'Crosshair style': 'سبک crosshair', 'Watermark': 'واترمارک', 'Scales': 'مقیاس‌ها', 'Text color': 'رنگ متن', 'Font size': 'اندازه‌ی قلم', 'Positions and orders': 'پوزیشن‌ها و سفارش‌ها',
  'Execution arrows': 'فلش اجرا', 'Order labels alignment': 'چینش برچسب سفارش', 'Buy/Sell buttons': 'دکمه‌های خرید/فروش', 'Instant order placement': 'ثبت فوری سفارش', 'Alert lines': 'خط هشدار', 'Alert line color': 'رنگ خط هشدار',
  'Only active alerts': 'فقط هشدارهای فعال', 'Alert volume': 'صدای هشدار', 'Auto-hide notifications after 20s': 'پنهان شدن خودکار اعلان بعد از ۲۰ ثانیه',
  // market panel, journal workspace, skills
  'Screener': 'اسکرینر', 'Heatmap': 'نقشه‌ی حرارتی', 'Movers': 'پرنوسان‌ها', 'News': 'اخبار',
  '▦ Dashboard': '▦ داشبورد', '☰ Journals': '☰ ژورنال‌ها', '☑ Checklists': '☑ چک‌لیست‌ها', '🔥 Discipline path': '🔥 مسیر انضباط', 'Daily': 'روزانه', 'Psychology & behaviour': 'روانشناسی و رفتار', 'Time & efficiency': 'زمان و بازدهی',
  'Execution quality': 'کیفیت اجرا', 'Professional': 'حرفه‌ای', 'Analyses': 'تحلیل‌ها', 'Tools': 'ابزارها', 'Prop challenges': 'چالش‌های پراپ', 'Economic calendar': 'تقویم اقتصادی', 'Forex sessions clock': 'ساعت سشن‌های فارکس',
  'Trading resume': 'رزومه‌ی معاملاتی', 'Compare accounts': 'مقایسه‌ی حساب‌ها', 'Portfolio risk': 'ریسک پورتفو', '✎ Notes': '✎ یادداشت‌ها', '⚙ Accounts & settings': '⚙ حساب‌ها و تنظیمات',
  'Risk & sizing': 'ریسک و حجم پوزیشن', 'Journal & review': 'ژورنال و مرور', 'Market regime': 'رژیم بازار', 'Screeners': 'اسکنرها', 'Fundamentals': 'بنیادی', 'Options & futures': 'آپشن و آتی', 'Iran market': 'بازار ایران',
  // alert dialog, server panel and the rest of the markup
  'Order ·': 'سفارش ·', 'Other leg (same side and size; one fill cancels the other)': 'پای دیگر (هم‌جهت و هم‌حجم؛ پر شدن یکی دیگری را لغو می‌کند)', '📷 Snapshot': '📷 عکس',
  'Ask why when a trade opens': 'هنگام باز شدن معامله دلیلش را بپرس', 'Ask how it went when a trade closes': 'هنگام بسته شدن معامله بپرس چطور بود', 'Upper bound': 'کران بالا', 'Within bars': 'در طول چند کندل',
  'Webhook URL': 'نشانی وب‌هوک', '(empty = the default URL in 🔔 settings)': '(خالی = نشانی پیش‌فرض در تنظیمات 🔔)', 'Webhook body': 'بدنه‌ی وب‌هوک', '(empty = the message; valid JSON is sent as application/json)': '(خالی = خود پیام؛ JSON معتبر با نوع application/json فرستاده می‌شود)',
  'Set up channels in 🔔 Server & notifications': 'کانال‌ها را در 🔔 سرور و اعلان‌ها تنظیم کنید', 'Make a bot with @BotFather and paste its token. Then send any message to your bot and press “Pick chat”.': 'با @BotFather یک ربات بسازید و توکنش را بچسبانید. بعد یک پیام به ربات بفرستید و «انتخاب چت» را بزنید.',
  'SMTP host': 'سرور SMTP', 'Port': 'پورت', 'User': 'کاربر', 'From': 'از', 'To': 'به', 'Default URL': 'نشانی پیش‌فرض', 'HTTPS on Wi-Fi': 'HTTPS روی Wi-Fi', 'CA fingerprint': 'اثر انگشت CA', 'CA certificate (Android, Windows)': 'گواهی CA (اندروید، ویندوز)', 'iPhone / iPad profile': 'پروفایل iPhone / iPad',
  'Install .pine / .mq4 / .mq5 / .mqh / .cs (NinjaScript) files — several at once': 'نصب فایل‌های .pine / .mq4 / .mq5 / .mqh / .cs (NinjaScript)، چند فایل هم‌زمان',
  'Import a TradingView alerts log (CSV)': 'ورود گزارش هشدار تریدینگ‌ویو (CSV)', 'Stop-limit: a limit order placed when the stop price trades': 'استاپ‌لیمیت: وقتی قیمت استاپ معامله شود یک سفارش لیمیت ثبت می‌شود',
  'Trailing stop: follows the best price by a distance, fills at market': 'تریلینگ استاپ: با فاصله‌ای از بهترین قیمت دنبال می‌کند و در بازار پر می‌شود', 'Sizing mode': 'روش تعیین حجم', 'Other leg type': 'نوع پای دیگر', 'Group price levels': 'گروه‌بندی سطوح قیمت',
  'Re-centre on the market (scroll the ladder to move it)': 'برگرداندن به مرکز بازار (برای جابه‌جایی نردبان اسکرول کنید)', 'min value': 'حداقل مقدار', 'Hide trades below this value (quote currency)': 'پنهان کردن معاملات زیر این مقدار (ارز مقابل)',
  'Attach a snapshot of the active chart': 'پیوست عکس نمودار فعال', 'Insert placeholder': 'درج جایگزین', 'Notification channels': 'کانال‌های اعلان', 'In-app pop-up and sound on every open device': 'پنجره‌ی اعلان و صدا روی هر دستگاه باز',
  'When a chart stays empty or something breaks: collect a report with your browser, the server, a quick check of every data source and the latest errors. Keys, tokens, passwords, e-mail and IP addresses are removed. Nothing is sent anywhere; copy the text to where you ask for help.': 'وقتی نمودار خالی می‌ماند یا چیزی خراب می‌شود: گزارشی از مرورگر، سرور، بررسی سریع هر منبع داده و آخرین خطاها جمع کنید. کلید، توکن، رمز، ایمیل و آدرس IP حذف می‌شوند. چیزی جایی فرستاده نمی‌شود؛ متن را هر جا کمک می‌خواهید کپی کنید.',
  'A stop and a ladder of targets that manage themselves: sl 98 or sl 2% · tp 1R 50%, 3R 50% (price, R multiple or %, then its share) · be 1 (stop to breakeven after target 1) · trail 1% 2 (trail after target 2). Paper account only.': 'یک حد ضرر و نردبان اهداف که خودشان مدیریت می‌شوند: sl 98 یا sl 2% · tp 1R 50%, 3R 50% (قیمت، مضرب R یا درصد، بعد سهم آن) · be 1 (حد ضرر بعد از هدف ۱ به سر‌به‌سر) · trail 1% 2 (تریل بعد از هدف ۲). فقط حساب تمرینی.',

};

const SKIP = 'canvas, #grid, #pnEditor, #pnConsole, textarea, code, pre, script, style, .cm-editor, [data-i18n="off"]';
const ATTRS = ['title', 'placeholder', 'aria-label'];
const textOrig = new WeakMap<Text, string>(), attrOrig = new WeakMap<Element, Record<string, string>>();
let current: Lang = 'en', observer: MutationObserver | null = null;

export const lang = (): Lang => current;
/** Translate one English string (for code that builds text itself). */
export const t = (en: string): string => (current === 'fa' ? FA[en] ?? en : en);

function xText(n: Text) {
  const raw = n.data, core = raw.trim();
  if (!core) return;
  const par = n.parentElement;
  if (par?.tagName === 'OPTION' && !par.hasAttribute('value')) return;   // its text IS its value: translating would change what the form reads
  const orig = textOrig.get(n);
  if (current === 'en') { if (orig !== undefined && FA[orig.trim()] === core) n.data = orig; return }
  const fa = FA[core];
  if (fa) { if (orig === undefined) textOrig.set(n, raw); n.data = raw.replace(core, fa) }
}
function xAttrs(el: Element) {
  for (const a of ATTRS) {
    const v = el.getAttribute(a); if (!v) continue;
    const saved = attrOrig.get(el)?.[a];
    if (current === 'en') { if (saved !== undefined && FA[saved] === v) el.setAttribute(a, saved); continue }
    const fa = FA[v];
    if (fa) { const m = attrOrig.get(el) ?? {}; m[a] ??= v; attrOrig.set(el, m); el.setAttribute(a, fa) }
  }
}
export function translateTree(root: Node) {
  if (root.nodeType === 3) { if (!(root.parentElement?.closest(SKIP))) xText(root as Text); return }
  if (root.nodeType !== 1) return;
  const el = root as Element;
  if (el.closest(SKIP)) return;
  xAttrs(el);
  const w = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    if (n.nodeType === 3) { if (!n.parentElement?.closest(SKIP)) xText(n as Text) }
    else if (!(n as Element).closest(SKIP)) xAttrs(n as Element);
  }
}

export function setLang(l: Lang) {
  current = l;
  store.set('lang', l);
  const h = document.documentElement;
  h.lang = l; h.classList.toggle('fa', l === 'fa'); h.dir = 'ltr';   // the page frame stays left-to-right; panels switch below via CSS
  translateTree(document.body);
  const b = document.getElementById('langBtn');
  if (b) { b.textContent = l === 'fa' ? 'EN' : 'فا'; b.title = l === 'fa' ? 'Switch to English' : 'تغییر به فارسی' }
  if (!observer) {
    observer = new MutationObserver(ms => {
      if (current !== 'fa') return;
      for (const m of ms) {
        if (m.type === 'childList') m.addedNodes.forEach(translateTree);
        else if (m.type === 'attributes') xAttrs(m.target as Element);
        else if (m.type === 'characterData' && m.target.nodeType === 3 && !textOrig.has(m.target as Text)) xText(m.target as Text);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ATTRS, characterData: true });
  }
}

/** First run: the saved choice, else Persian when the browser is set to Persian. */
export function initI18n() {
  const saved = store.get<Lang | null>('lang', null);
  setLang(saved ?? (typeof navigator !== 'undefined' && /^fa\b/i.test(navigator.language) ? 'fa' : 'en'));
  document.getElementById('langBtn')?.addEventListener('click', () => setLang(current === 'fa' ? 'en' : 'fa'));
}
