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
