[فارسی](phase5-contracts.fa.md) · [English](phase5-contracts.md)

# فاز ۵ — قراردادها برای کار موازی

فاز ۵ = سرور محلی با SQLite، ورود با رمز و همگام‌سازی چنددستگاهی، هشدارها و اعلان‌های سمت سرور، forward testهای
سمت سرور، ضبط معاملات، HTTPS روی شبکه‌ی خانگی و Web Push. چند عامل (agent) این فاز را به‌صورت موازی می‌سازند و هر
کدام روی شاخه‌ی (branch) خودش کار می‌کند. **این فایل تنها منبع مرجع برای رابط‌های میان آن‌هاست.** اگر به چیزی نیاز
دارید که اینجا نیامده، کوچک‌ترین نسخه‌ی ممکن را داخل فایل‌های خودتان پیاده کنید و در گزارش نهایی بگویید — هرگز
فایلی را که مال شما نیست ویرایش نکنید.

## ۰. تصمیم‌هایی که کاربر از قبل گرفته است (تغییرشان ندهید)
- سرور فعلاً روی همین رایانه‌ی ویندوزی اجرا می‌شود (همیشه پشت VPN است، پس Binance/Bybit/Telegram در دسترس‌اند)؛ بعداً
  باید با همین کد به یک VPS لینوکسی منتقل شود (بدون API مخصوص ویندوز).
- تک‌کاربره، با یک رمز. همه‌ی داده‌های برنامه روی سرور است؛ هر دستگاه همان داده‌ها را می‌بیند.
- دسترسی از گوشی روی Wi-Fi خانگی، از طریق HTTPS با یک CA تولیدشده‌ی محلی (اندروید + آیفون).
- اعلان‌ها: popup درون برنامه + صدا، Web Push (دسکتاپ + گوشی؛ برنامه‌های بومی ممکن است بعداً بیایند)، Telegram، ایمیل،
  Webhook. بله (Bale) نه.
- رازها (توکن ربات، رمز SMTP، کلید خصوصی VAPID و بعداً کلیدهای صرافی) رمزنگاری‌شده در پایگاه داده نگهداری می‌شوند
  (`core/secrets.ts`).
- سمت سرور: forward testها، ضبط معاملات برای فهرست نمادهایی که کاربر انتخاب می‌کند و **۳۰ روز** نگه داشته می‌شود
  (پیش‌فرض BTCUSDT و ETHUSDT)، و هشدارهای اسکریپت (`alertcondition` و `alert()` در Pine و سفارش‌های استراتژی).

## ۱. قواعد پایه
- TypeScript مستقیماً با Node 25 اجرا می‌شود (`--experimental-strip-types` پیش‌فرض است): **بدون parameter property،
  بدون enum، بدون namespace**؛ برای نوع‌ها از `import type` استفاده کنید. از سبک موجود پیروی کنید: فشرده، با کامنت‌های
  کم که *چرا* را توضیح می‌دهند.
- تست‌های سرور: فایل‌های `node:test` کنار کد (`server/**/*.test.ts`) که با `cd server && npm test` اجرا می‌شوند.
  تست‌های کلاینت: `src/**/*.test.ts` که با `npm test` در ریشه‌ی مخزن اجرا می‌شوند (glob خودتان را فقط اگر صاحب
  `package.json` هستید به اسکریپت `test` ریشه اضافه کنید — وگرنه دستور را در گزارشتان بنویسید).
- هر رشته‌ی HTML که از روی داده ساخته می‌شود باید داده را escape کند (`esc` در `src/store.ts`). وضعیت همگام‌شده از
  دستگاه‌های دیگر می‌آید.
- هیچ وابستگی (dependency) جدیدی اضافه نکنید، به‌جز `web-push` و `nodemailer` (+ `@types/nodemailer`) در
  `server/package.json` (فقط عامل notify).
- Clean-room: از روی رفتار و مستندات بسازید، هرگز کد محصولات دیگر را کپی نکنید.
- پیش از پایان: `npx tsc --noEmit` (ریشه) و `npx tsc --noEmit -p server` هر دو باید بگذرند، تست‌هایتان بگذرد و روی
  شاخه‌ی خودتان با پیام روشن commit کنید.

## ۲. هسته (Core) (از قبل نوشته شده — استفاده کنید، تغییر ندهید)
- `server/core/db.ts` — `db` (‏`DatabaseSync` از node:sqlite)، `migration(name, sql)` (فقط یک بار اجرا می‌شود؛ نام را با
  ماژول خودتان شروع کنید، مثلاً `'alerts/1'`)، `configGet(key, fallback)` / `configSet(key, value)` برای تنظیمات کوچک JSON،
  و `DATA_DIR`.
- `server/core/secrets.ts` — `secretSet(name, value)`، `secretGet(name)`، `secretHas`، `secretDel`. هرگز راز را به کلاینت نفرستید.
- `server/core/auth.ts` — نشست‌ها (session)؛ معمولاً به آن نیاز ندارید (مسیرها به‌طور پیش‌فرض محافظت‌شده‌اند).
- `server/core/http.ts` — `route(method, path, handler, { public?, raw?, limit? })` با مسیرهای `:param`؛ handler یک
  `Ctx { req, res, url, params, body, secure, session }` می‌گیرد و JSON / `undefined` (کد 204) / `RAW` برمی‌گرداند.
  `HttpError(status, msg)` یا `bad(msg)` را throw کنید. همه‌ی مسیرها ورود می‌خواهند، مگر `public` باشند. درخواست‌های
  غیر GET از origin دیگر رد می‌شوند. `onWs(op, (client, msg) => …)` برای پیام‌های WebSocket از کلاینت به سرور (از
  `'<module>.<action>'` برای opها استفاده کنید)، `onWsClose`، `broadcast(msg, except?)` برای ارسال به همه‌ی کلاینت‌های
  متصل، و `clients`.
- `server/core/bars.ts` — `fetchBars(sym, tf)`، `streamBars(sym, tf, onBar)` و `watchSeries(sym, tf, (bars, closed) => …)`:
  یک سری مشترکِ غلتان (تاریخچه + زنده) برای هر نماد/تایم‌فریم؛ `closed === true` یعنی تازه یک کندل جدید شروع شده و
  `bars.at(-2)` بسته شده است.
- `server/state.ts` — `stateGet(key)`، `stateSet(key, value, originClient?)` (‏`rev` را بالا می‌برد و
  `{ type: 'state', key, rev, value, updated }` را broadcast می‌کند)، `stateDel`، `stateAll()` و `KEY_RE`.
- `server/notify/index.ts` — `notify(notice)`؛ نسخه‌ی موقت (stub) فقط popup می‌فرستد (بخش ۴ را ببینید).
- `src/sync.ts` — کلاینت: `onServer(type, handler)`، `api(path, { method, body })` و `serverMode`.
- `src/push.ts` — API پوش در کلاینت (stub، بخش ۸ را ببینید). `src/alerttypes.ts` — مدل هشدار (بخش ۵).
- ورودی سرور `server/index.ts` همه‌ی ماژول‌ها را import می‌کند؛ HTTP روی 127.0.0.1:8787 (‏Vite مسیرهای `/api` و `/ws` را proxy می‌کند).

## ۳. همگام‌سازی (عامل **sync**)
مالک: `server/state.ts` (مسیرها و media را اضافه کنید؛ exportهای موجود و رفتارشان را نگه دارید)، `server/media.ts` (جدید)،
`src/boot.ts` (جدید)، `src/login.ts` (جدید)، `src/sync.ts`، `src/store.ts`، `src/journal/media.ts`، بخش‌های ذخیره‌سازی
`src/journalui.ts` (فقط بارگذاری/ذخیره)، خط `<script type="module">` در `index.html`، و تست‌ها.

API سرور:
- `GET /api/state` ← `{ [key]: { value, rev, updated } }`.
- `PUT /api/state/:key` با بدنه‌ی `{ value }` (حداکثر ۸ مگابایت، کلید باید با `KEY_RE` جور باشد) ← `{ rev }`؛ برای
  کلاینت‌های دیگر broadcast شود (وقتی سوکت کلاینت درخواست‌دهنده معلوم است آن را به‌عنوان `origin` بدهید — کلاینت
  شناسه‌ی سوکتش را در هدر `x-ct-client` می‌فرستد و سرور با پیام WS به نام `sync.hello` یک نگاشت id ← WsClient نگه
  می‌دارد). آخرین نوشتن برنده است.
- `DELETE /api/state/:key`.
- `POST /api/media` با بدنه‌ی خام (`image/*` یا `audio/*`، حداکثر ۱۵ مگابایت) ← `{ id }`؛ `GET /api/media/:id` ← بایت‌ها
  با نوع ذخیره‌شده و `cache-control: private, max-age=31536000, immutable`؛ `DELETE /api/media/:id`. جدول به
  انتخاب خودتان.

کلاینت:
- `index.html` به‌جای `/src/main.ts`، فایل `/src/boot.ts` را بارگذاری می‌کند. راه‌اندازی: `GET /api/auth/status`.
  - سرور در دسترس نیست (توسعه بدون سرور / آفلاین) ← **حالت آفلاین**: فقط با localStorage کار کند و یک بنر کوچک
    «آفلاین — تغییرات فقط روی همین دستگاه می‌مانند» نشان دهد. `serverMode = false`.
  - `setup` ← صفحه‌ی رمز اول (فقط از همین رایانه کار می‌کند؛ این را برای دستگاه‌های دیگر توضیح دهید).
  - وارد نشده ← صفحه‌ی ورود (رمز، متن خطا، پیام قفل‌شدن از طرف سرور).
  - وارد شده ← `GET /api/state`. اگر سرور هنوز **هیچ** state ندارد و این مرورگر کلیدهای localStorage با پیشوند `ct.*`
    دارد، یک بار بپرسید «داده‌های این مرورگر روی سرور بارگذاری شود؟» و همه‌ی کلیدها + media از IndexedDB (عکس‌ها/صدای
    ژورنال از پایگاه قدیمی `ct-journal-media`؛ اگر idها عوض شدند بازنویسی شوند) را آپلود کنید. در غیر این صورت هر مقدار
    سرور را در localStorage بنویسید (`ct.<key>`) و کلیدهای همگام‌شده‌ای را که سرور ندارد حذف کنید. سپس
    `await import('./main.ts')`.
- `store.set(key, v)` در localStorage می‌نویسد و در حالت سرور کلید را PUT می‌کند (برای هر کلید حدود ۴۰۰ میلی‌ثانیه
  debounce؛ با backoff دوباره تلاش می‌کند؛ یک نقطه‌ی وضعیت کوچک «همگام / در حال ذخیره / آفلاین» مفید است ولی اختیاری).
- کلیدهای مخصوص هر دستگاه (هرگز همگام نمی‌شوند): `bottomH`، `side`، `jwFormTab`، `tsTab`، `domCfg`، `pineEditing`، `lastTool`، `searchEx`.
- پیام `{ type: 'state' }` ورودی از دستگاه دیگر: localStorage را به‌روز کنید و فقط یک toast نشان دهید
  «در دستگاه دیگری به‌روز شد — بارگذاری مجدد» (با دکمه‌ی بارگذاری مجدد). مستقیم اعمال نکنید (برنامه state را هنگام
  راه‌اندازی می‌خواند).
- `journalui.ts` اکنون `localStorage['ct.journal']` را مستقیم می‌خواند/می‌نویسد — آن را از طریق `store` (با همان کلید
  `journal`) ببرید تا همگام شود؛ toast خطای کمبود فضا (quota) را نگه دارید.
- `src/journal/media.ts` توابع export‌شده و امضاهایشان را نگه می‌دارد، ولی در حالت سرور روی سرور ذخیره می‌کند
  (IndexedDB به‌عنوان جایگزین آفلاین می‌ماند).
- WebSocket رویدادها: یک سوکت به `/ws` که مالک آن `sync.ts` است و دوباره وصل می‌شود؛ هر پیامی که `type` دارد به
  `dispatchServer` می‌رود. هنگام باز شدن `{ op: 'sync.hello', client: <random id> }` را بفرستید.
- منوی حساب جایی کم‌مزاحم (مثلاً یک دکمه در نوار بالا): وضعیت ورود، خروج، تغییر رمز، فهرست دستگاه‌ها/نشست‌ها
  (`/api/auth/*`).

## ۴. اعلان‌ها (عامل **notify**)
مالک: `server/notify/**`، `server/package.json` (افزودن `web-push`، `nodemailer`، `@types/nodemailer`) و تست‌ها.
`notify(n: Notice): Promise<Delivery[]>` و `Notice`، `Delivery`، `Channel` را دقیقاً همان‌طور که export شده‌اند نگه دارید.
- `popup`: ‏`broadcast({ type: 'notify', id, title, body, sound, data, at })`.
- `push`: ‏Web Push با کلیدهای VAPID که در اولین استفاده ساخته می‌شوند (کلید خصوصی در secrets، عمومی در config).
  جدول اشتراک‌ها (endpoint، keys، agent، created، last_ok). payload به‌صورت JSON ‏`{ title, body, tag, data }`
  (‏`data.url` = جایی که کلیک باید ببرد). اشتراک‌ها را هنگام 404/410 حذف کنید.
  مسیرها: `GET /api/notify/push/key` ← `{ publicKey }`؛ `POST /api/notify/push/subscribe` با `{ subscription, agent }`؛
  `POST /api/notify/push/unsubscribe` با `{ endpoint }`.
- `telegram`: توکن در راز `telegram.token`، شناسه‌ی چت در config. `GET /api/notify/telegram/chats` متد `getUpdates` را
  صدا می‌زند و چت‌های اخیر را برمی‌گرداند تا پس از اینکه کاربر به ربات پیام داد، رابط کاربری بتواند «چت خودتان را انتخاب
  کنید» را پیشنهاد دهد.
- `email`: ‏SMTP با nodemailer؛ config به شکل `{ host, port, secure, user, from, to }` و رمز در راز `email.password`.
- `webhook`: ‏`POST` به `notice.webhook.url` (یا نشانی پیش‌فرض در تنظیمات) با بدنه‌ی رندرشده؛ اگر بدنه به‌عنوان JSON
  قابل تجزیه باشد `application/json` وگرنه `text/plain`؛ مهلت ۱۰ ثانیه؛ فقط http/https.
- `GET /api/notify/settings` ← `{ telegram: { chatId, hasToken }, email: { host, port, secure, user, from, to, hasPassword }, webhook: { url }, push: { subscriptions } }`
  (هرگز رازها را برنگردانید). `PUT /api/notify/settings` جزئی؛ فیلدهای `token` / `password`: رشته = تنظیم، `null` = حذف،
  نبودن = بدون تغییر. `POST /api/notify/test` با `{ channel }` ← `Delivery`.
- محدودسازی نرخ/صف‌بندی برای هر کانال (Telegram حدود ۱ پیام در ثانیه برای هر چت)، جدول `notify_log` و `GET /api/notify/log`.
- تابع `render(template, vars)` را export کنید که `{{name}}` را جایگزین می‌کند (نام‌های ناشناخته همان‌طور می‌مانند) —
  موتور هشدارها از آن استفاده می‌کند.

## ۵. موتور هشدارها (عامل **alerts**)
مالک: `server/alerts/**` و تست‌ها. مدل: `src/alerttypes.ts` (بدون ذکر دلیل در گزارش تغییرش ندهید).
- مسیرها: `GET /api/alerts` ← `Alert[]`؛ `POST /api/alerts` با `AlertInput` ← `Alert` (همه‌چیز را اعتبارسنجی کنید؛
  نمادها باید با قواعد ماژول market جور باشند؛ اسکریپت‌ها باید کامپایل شوند)؛ `PUT /api/alerts/:id` جزئی؛
  `DELETE /api/alerts/:id`؛ `GET /api/alerts/log?limit=` ← `AlertLog[]`؛ `DELETE /api/alerts/log`. پس از هر تغییر
  `{ type: 'alerts', alerts }` را broadcast کنید؛ وقتی هشداری فعال شد `{ type: 'alert.fired', log }` را broadcast کنید و
  `notify()` را با کانال‌های همان هشدار صدا بزنید (همیشه `popup` را اضافه کنید)، با عنوان `"<name or sym> alert"`،
  متن = پیام رندرشده، و `data: { alertId, sym, tf, url: '/?symbol=…&tf=…' }`.
- ارزیابی با `watchSeries(sym, tf)`:
  قیمت → close کندل در حال شکل‌گیری در برابر `value`/`value2`/خط (برای عبور از سطح، از قیمت ارزیابی‌شده‌ی قبلی
  استفاده می‌شود؛ `once_per_bar_close` فقط کندلی را که همین الان بسته شده ارزیابی می‌کند)؛ ترسیم → قیمت `LineRef` در
  لحظه‌ی ارزیابی (خط‌های روند به‌صورت خطی در زمان برون‌یابی می‌شوند؛ extendLeft/Right را رعایت کنید)؛ اندیکاتور → سورس
  Pine را اجرا کنید (`src/pine/engine.ts`) و plot شماره‌ی N را بخوانید؛ اسکریپت → `alertcondition[index].fired` /
  فراخوانی‌های `alert()` / fillهای استراتژی روی آخرین کندل (یا آخرین کندل بسته‌شده).
  اجرای اسکریپت/اندیکاتور را throttle کنید (حداکثر یک بار در هر ۲ ثانیه برای هر هشدار تا وقتی کندل در حال شکل‌گیری است؛
  در بسته شدن کندل همیشه اجرا شود).
- فرکانس‌ها مثل TradingView (`once` پس از فعال شدن هشدار را غیرفعال می‌کند). انقضا، توقف خودکار (پیش‌فرض ۱۵ بار فعال شدن
  در ۳ دقیقه)، `stoppedReason`. هشدارها و لاگ در SQLite ذخیره شوند؛ بعد از راه‌اندازی مجدد باید سالم بمانند.

## ۶. forward testها روی سرور (عامل **runner**)
مالک: `server/forward.ts`، `server/recorder.ts`، تست‌ها، و در کلاینت `src/testerui.ts` (فقط تب forward) و
`src/orderflow/feed.ts` (منبع تاریخچه).
- `POST /api/forward` با `{ name, sym, tf, job: Job (src/tester/runner.ts), qtyMult, channels: Channel[] }` ← `{ id }`؛
  `GET /api/forward` ← فهرست با وضعیت، زمان شروع، fillهای بازتاب‌داده‌شده، آخرین خطا؛ `DELETE /api/forward/:id`؛
  `GET /api/forward/:id/log`. هنگام تغییر `{ type: 'forward', list }` را broadcast کنید.
- در هر به‌روزرسانی زنده (با throttle ‏۲ ثانیه) و هر بسته شدن کندل، استراتژی را روی سری اجرا کنید؛ fillهای جدیدتر از زمان
  شروع (مانند `fillKey` در `testerui.ts` حذف تکراری شوند) به سفارش بازار روی حساب کاغذی تبدیل می‌شوند:
  `stateGet('acct')` را بخوانید، `placeOrder` از `src/trading.ts` را در آخرین قیمت close اعمال کنید و
  `stateSet('acct', …)` را بزنید. برای هر fill بازتاب‌داده‌شده اعلان بفرستید.
- تب forward در کلاینت: در حالت سرور، forward testهای سمت سرور را بسازد/متوقف کند/فهرست کند (نسخه‌ی فقط‌مرورگر را برای
  حالت آفلاین نگه دارید).

## ۷. ضبط معاملات (عامل **runner**)
- config با نام `recorder` به شکل `{ symbols: string[] }` (پیش‌فرض `['BTCUSDT', 'ETHUSDT']`)، نگهداری ۳۰ روز.
  printهای زنده را (نمادهای ساده‌ی Binance از طریق استریم aggTrade؛ نمادهای `EXCH:` با `ccxt.watchPrints`) دسته‌ای در
  SQLite ضبط کنید؛ هر روز پاک‌سازی (prune) شود. `GET /api/recorder` ← `{ symbols, retentionDays, stats: [{ sym, from, to, count, approxBytes }] }`؛
  `PUT /api/recorder` با `{ symbols }`؛ `GET /api/recorder/trades?sym=&from=&to=&limit=` ← `Print[]` (بر حسب ثانیه، حداکثر ۲۰۰ هزار).
- `fetchPrints` در `src/orderflow/feed.ts`: در حالت سرور اول از ضبط‌شده‌ها استفاده کند، سپس هر شکافی را از صرافی پر کند.

## ۸. HTTPS روی LAN + کلاینت Web Push + PWA (عامل **lan**)
مالک: `server/lan.ts`، `public/**` (‏manifest، `sw.js`، آیکون‌ها)، `src/push.ts`، تگ‌های PWA در `<head>` فایل `index.html`،
`docs/lan-setup.md` (فارسی، مراحل اندروید + آیفون) و تست‌ها.
- config با نام `lan` به شکل `{ enabled, port: 8443 }`. گواهی‌ها با CLI ‏`openssl` زیر `DATA_DIR/tls`: یک CA محلی
  (۱۰ ساله) و یک گواهی سرور با SANهایی برای `localhost`، `127.0.0.1` و هر IPv4 غیرداخلیِ این رایانه؛ وقتی مجموعه‌ی
  IPها عوض شد دوباره بسازید. `startLan()` ‏`handle(req, res, true)` + `upgrade` را روی HTTPS و روی 0.0.0.0 سرو می‌کند.
- `GET /api/lan` ← `{ enabled, port, urls, caFingerprint }`؛ `POST /api/lan` با `{ enabled }` (فقط از localhost).
  دانلودهای عمومی: `GET /ca.crt` و `GET /ca.mobileconfig` (پروفایل iOS که شامل CA است).
- `public/sw.js`: رویداد `push` ← `showNotification`، رویداد `notificationclick` ← تمرکز روی پنجره یا باز کردن `data.url`.
  Manifest + آیکون‌ها تا برنامه قابل نصب باشد (در iOS برای push باید به Home Screen اضافه شود).
- `src/push.ts`: exportهای stub را بر پایه‌ی `/api/notify/push/*` پیاده کنید.

## ۹. رابط کاربری هشدارها و تنظیمات در کلاینت (عامل **ui**)
مالک: `src/main.ts`، `src/alertsui.ts` (جدید)، `src/settingsui.ts` (جدید)، بقیه‌ی `index.html`، `src/style.css`، `src/chart.ts` (فقط خط‌های هشدار).
- هشدارهای قیمتِ سمت مرورگر را در حالت سرور با هشدارهای سرور جایگزین کنید (رفتار قدیمی در حالت آفلاین بماند). در اولین
  راه‌اندازی در حالت سرور، state قدیمی `alerts` (به شکل `{ sym, price, dir, on, drawingId, note }`) را یک بار با
  `POST /api/alerts` مهاجرت دهید، سپس آن را پاک کنید.
- دیالوگ ساخت هشدار مثل TradingView: منبع (قیمت / اندیکاتور روی چارت / ترسیم / اسکریپت روی چارت)، شرط، مقدار(ها)،
  بازه‌ی زمانی، فرکانس، انقضا، پیام با راهنمای placeholderها، کانال‌ها (+ نشانی webhook). نقاط ورود:
  دکمه‌ی موجود Alert / ‏Alt+A، منوی راست‌کلیک چارت، منوی راست‌کلیک ترسیم، legend اسکریپت.
- پنل کناری هشدارها: فهرست با وضعیت، ویرایش، توقف/ادامه، حذف، و لاگ با نتیجه‌ی ارسال‌ها. خط‌های قیمت روی چارت
  می‌مانند (از فهرست سرور).
- popupها: `onServer('notify')` ← toast + صدا + Notification دسکتاپ در صورت اجازه.
- دیالوگ تنظیمات «سرور و اعلان‌ها»: Telegram (توکن، انتخاب چت، آزمایش)، ایمیل (فیلدهای SMTP، آزمایش)، webhook پیش‌فرض،
  push روی این دستگاه (`src/push.ts`)، نمادهای ضبط معاملات + آمار (`/api/recorder`)، دسترسی از شبکه‌ی خانگی
  (`/api/lan`، نشانی‌ها، لینک‌های دانلود گواهی + لینک به راهنمای نصب).
