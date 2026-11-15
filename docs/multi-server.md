[English](multi-server.en.md) · [فارسی](multi-server.md)

# اتصال کلاینت از origin دیگر (توکن دستگاه + CORS)

برای کلاینتی که از جایی غیر از خودِ سرور بالا آمده (APK اندروید، پنجره‌ی Electron/lite که به سرور راه‌دور وصل می‌شود، PWA روی دامنه‌ی دیگر). برنامه‌ی وب هم‌مبدأ (same-origin) همچنان فقط با کوکی کار می‌کند و چیزی برایش عوض نشده است.

## قرارداد (هر دو حالت private و public)

1. **ورود با توکن.** `POST /api/auth/login`، `/api/auth/register` و `/api/auth/recover` فیلد اختیاری `"device": "<برچسب تا ۶۰ نویسه>"` را می‌پذیرند. اگر باشد پاسخ `{ok:true, token, user:{name,role}}` است و **هیچ کوکی** ست نمی‌شود (register و recover همچنان `recoveryCodes` را هم برمی‌گردانند). توکن ۲۵۶ بیت تصادفی است و فقط به‌صورت sha256 به‌همراه برچسب، زمان ساخت، آخرین استفاده و IP ذخیره می‌شود. هر کاربر حداکثر **۱۰** توکن دارد؛ بعد از آن خطای `409` با `code: "device_limit"`.
2. **استفاده.** هر مسیر، هدر `Authorization: Bearer <token>` را به‌جای کوکی می‌پذیرد. درخواست‌های توکن‌دار از بررسی Origin / Sec-Fetch-Site معاف‌اند (فرم cross-site نمی‌تواند هدر Authorization بفرستد) ولی **هدر `x-ct-client` (۸ تا ۶۴ نویسه‌ی `[\w-]`) الزامی است** و همان throttle و سهمیه‌ی نشست‌ها را دارند. اگر هدر Bearer نامعتبر باشد، کوکی جایگزینش نمی‌شود (۴۰۱). توکن دستگاه به‌عنوان کوکی و کوکی نشست به‌عنوان Bearer پذیرفته نمی‌شود. توکن هرگز در URL خوانده نمی‌شود.
3. **WebSocket.** subprotocol به شکل `ct.<token>` در `Sec-WebSocket-Protocol` (هرگز query string). سرور همان را echo می‌کند. بررسی Origin فقط برای احراز با کوکی می‌ماند؛ با توکن رد نمی‌شود. لغو توکن سوکت باز را با کد `4001` می‌بندد.
4. **مدیریت.** `GET /api/auth/devices` ← `[{id,label,created,lastUsed,ip,current}]` (هرگز خود توکن). `DELETE /api/auth/devices/:id` ← `204`؛ شناسه‌ی ناشناس یا متعلق به دیگری `404`. تغییر گذرواژه، بازیابی (recover) و غیرفعال‌شدن حساب همه‌ی توکن‌ها را باطل می‌کنند؛ `logout` با Bearer همان توکن را باطل می‌کند. توکن‌ها در `GET /api/auth/sessions` نمی‌آیند. عمر و عدم‌استفاده‌ی توکن مثل نشست‌هاست (public: ۳۰ روز / ۱۴ روز بی‌استفاده؛ private: ۶۰ روز).
5. **status.** `GET /api/auth/status` علاوه بر فیلدهای قبلی برمی‌گرداند: `registration` (`invite|open|closed`؛ در private همیشه `closed`)، `version`، `mode`، `serverName` (از `CT_SERVER_NAME`، حداکثر ۶۰ نویسه) و `features:{trading,ai,ml,forward,scripts,python}` (private همه `true`، public همه `false`؛ `python:true` یعنی ماژول وجود دارد، نه اینکه روشن است: روشن‌بودن را `GET /api/py/status` می‌گوید) تا کلاینت پانل‌هایی را که سرور ندارد پنهان کند.

ورود/ثبت‌نام/بازیابی از origin دیگر **فقط با `device`** پذیرفته می‌شود (بدون آن `403`) و فقط وقتی Origin در `CT_CORS_ORIGINS` باشد (یا کلاینت غیرمرورگری که Origin و Sec-Fetch-Site ندارد).

## CORS

به‌طور پیش‌فرض **خاموش** است. متغیر `CT_CORS_ORIGINS` فهرست origin‌های دقیق است، با کاما جدا شده، مثلاً:

```
CT_CORS_ORIGINS=https://app.example.com,http://localhost:5173
```

- فقط مقایسه‌ی دقیق رشته‌ای؛ `*`، `null`، مسیر، اسلش آخر و هر چیزی که origin خالص نیست هنگام شروع سرور خطا می‌دهد و سرور بالا نمی‌آید.
- برای origin فهرست‌شده: `Access-Control-Allow-Origin: <همان origin>`، `Vary: Origin`، و در preflight (`OPTIONS`) هم `Allow-Headers: authorization, content-type, x-ct-client`، `Allow-Methods: GET, POST, PUT, DELETE, OPTIONS`، `Max-Age: 600`. `Access-Control-Expose-Headers: retry-after` برای خواندن زمان انتظار 429.
- **هرگز `Access-Control-Allow-Credentials`** نمی‌فرستد: کوکی از origin دیگر رد نمی‌شود، فقط Bearer.
- origin ناشناس هیچ هدر CORS نمی‌گیرد (preflight آن‌ها مثل قبل ۴۰۴ می‌شود). گارد Host (`CT_ALLOWED_HOSTS` و غیره) سر جایش است.

## اندروید و origin‌های مبهم

APK فعلی (`android/app/.../MainActivity.java`) صفحه را با `web.loadUrl(origin)` مستقیم از خودِ سرور بارگذاری می‌کند؛ پس **هم‌مبدأ** است و به CORS یا توکن نیاز ندارد. اگر روزی APK دارایی‌های برنامه را محلی سرو کند: `file://` در WebView هدر `Origin: null` می‌فرستد و **پذیرفته نمی‌شود**. راه درست `WebViewAssetLoader` است که صفحه را از `https://appassets.androidplatform.net` سرو می‌کند؛ همان origin را (به‌علاوه‌ی origin واقعی Capacitor/Electron اگر استفاده شود، مثلاً `https://localhost` یا `app://...` که باید با مقدار واقعی `location.origin` چک شود) صراحتاً در `CT_CORS_ORIGINS` بنویسید.

## mixed content و گواهی self-signed

- صفحه‌ی https نمی‌تواند به `http://` یا `ws://` وصل شود (mixed content). برای سرور راه‌دور از `https://`/`wss://` استفاده کنید (Caddy/nginx با گواهی معتبر).
- روی LAN با گواهی self-signed، مرورگر/WebView باید CA را بپذیرد: `/ca.crt` (و `/ca.mobileconfig` برای iOS) را نصب کنید؛ جزئیات در `docs/lan-setup.md` و `docs/android-apk.md`. APK گواهی ناشناس را عمداً رد می‌کند.
- این‌ها مسئله‌ی راه‌اندازی‌اند و کدی در سرور برایشان نیست.

## متغیرهای محیطی

| متغیر | معنا |
|---|---|
| `CT_CORS_ORIGINS` | origin‌های دقیق مجاز، با کاما. خالی = CORS خاموش |
| `CT_SERVER_NAME` | نام نمایشی در `/api/auth/status` (حداکثر ۶۰ نویسه) |

## ملاحظات امنیتی

- توکن مثل رمز است: فقط در حافظه/ذخیره‌ی امن کلاینت نگه دارید؛ XSS در origin کلاینت = سرقت توکن (برخلاف کوکی HttpOnly). برای همین هر دستگاه برچسب جدا دارد و از `DELETE /api/auth/devices/:id` قابل لغو است.
- توکن در لاگ سرور نمی‌آید (فقط مسیر لاگ می‌شود، و رشته‌های بلند ماسک می‌شوند).
- تست‌ها: `server/devices.test.ts`، `devicesprivate.test.ts`، `cors.test.ts`، `corsoff.test.ts` و دسته‌بندی مسیرها در `isolation.test.ts`.
