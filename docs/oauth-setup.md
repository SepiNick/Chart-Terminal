# راه‌اندازی ورود با Google و Apple (راهنمای مالک سرور)

این سند فقط برای **سرور عمومی** (`CT_MODE=public`) است. سرور خصوصی همان رمز تکی خودش را نگه می‌دارد و دکمه‌ی ورود با Google/Apple ندارد.
طراحی کامل: `docs/research/oauth-sync-design.md`. تا وقتی متغیرهای محیطی یک ارائه‌دهنده را نگذاشته‌اید، آن ارائه‌دهنده **خاموش** است و دکمه‌اش در برنامه نمایش داده نمی‌شود.

## پیش‌نیازها

- دامنه‌ی واقعی با HTTPS (برای Apple الزامی؛ برای Google هم در محیط واقعی).
- `CT_PUBLIC_URL` درست، مثلاً `https://charts.example.com` (بدون اسلش آخر). آدرس‌های برگشتی (redirect) از همین مقدار ساخته می‌شوند.
- `CT_ALLOWED_HOSTS`، `CT_TRUST_PROXY=1` و در صورت اجرای پروکسی روی شبکه‌ی Docker: `CT_PROXY_IPS` (آدرس پروکسی). اگر `CT_TRUST_PROXY=1` باشد و `CT_HOST` روی آدرس غیر loopback باشد ولی `CT_PROXY_IPS` فقط loopback داشته باشد، سرور **عمداً بالا نمی‌آید**، چون وگرنه همه‌ی کاربران یک IP دیده می‌شوند و محدودیت‌های هر کاربر از کار می‌افتد.
- سرور باید به `oauth2.googleapis.com`، `www.googleapis.com` و `appleid.apple.com` دسترسی خروجی داشته باشد (VPS خارج از ایران).

آدرس‌هایی که باید **دقیقاً** (بایت به بایت) در کنسول‌ها ثبت کنید:

```
${CT_PUBLIC_URL}/api/auth/oauth/callback/google
${CT_PUBLIC_URL}/api/auth/oauth/callback/apple
```

## الف) Google Cloud Console (قدم اول؛ رایگان)

1. با VPN وارد `console.cloud.google.com` شوید.
2. یک Project جدید بسازید (مثلاً `chart-terminal`).
3. **APIs & Services -> OAuth consent screen**: نوع کاربر **External**؛ نام برنامه، ایمیل پشتیبانی، آدرس صفحه‌ی اصلی (همان `CT_PUBLIC_URL`) و آدرس سیاست حریم خصوصی (یک صفحه‌ی ساده روی همان دامنه) را پر کنید. دامنه‌ی سرور را در **Authorized domains** بنویسید.
4. **Scopes**: فقط `openid` و `email`. (غیرحساس‌اند و نیازی به بررسی امنیتی گوگل نیست.)
5. **Publishing status** را روی **In production** بگذارید. اگر روی Testing بماند فقط حداکثر ۱۰۰ کاربر آزمایشی می‌توانند وارد شوند.
6. **Credentials -> Create credentials -> OAuth client ID -> Application type: Web application**.
7. در **Authorized redirect URIs** دقیقاً بنویسید: `https://دامنه‌ی-شما/api/auth/oauth/callback/google` (بدون اسلش آخر). **Authorized JavaScript origins** را خالی بگذارید.
8. Client ID و Client secret را کپی کنید و در محیط سرور بگذارید:
   ```
   CT_GOOGLE_CLIENT_ID=...apps.googleusercontent.com
   CT_GOOGLE_CLIENT_SECRET=...
   ```
9. سرور را ری‌استارت کنید. `GET /api/auth/status` باید `"oauth":{"google":true,"apple":false}` نشان بدهد و دکمه‌ی Google در صفحه‌ی ورود ظاهر شود.
10. برای آزمایش محلی می‌توانید یک کلاینت جداگانه با redirect برابر `http://localhost:PORT/api/auth/oauth/callback/google` بسازید (گوگل `localhost` با http را مجاز می‌داند).

هر دو متغیر Google باید با هم تنظیم شوند؛ اگر فقط یکی را بگذارید، سرور با پیامی که اسم متغیر کم‌شده را می‌گوید بالا نمی‌آید (برای گرفتن غلط تایپی).

## ب) Apple Developer (قدم دوم؛ ممکن است از ایران عملی نباشد)

**صادقانه:** Sign in with Apple به عضویت **Apple Developer Program (حدود ۹۹ دلار در سال)**، یک دامنه‌ی واقعی با HTTPS (نه IP و نه localhost) و تأیید مالکیت دامنه نیاز دارد. به‌خاطر تحریم‌ها، ثبت‌نام و پرداخت از ایران معمولاً ممکن نیست، مگر با حساب و روش پرداخت قانونی خارج از ایران. اگر این شرایط را ندارید، **فقط Google را راه بیندازید؛ این یک نتیجه‌ی کاملاً معتبر است.** کد Apple بدون این تنظیمات خاموش می‌ماند و دکمه‌اش پنهان است.

1. عضویت Apple Developer Program را فعال کنید.
2. **Certificates, Identifiers & Profiles -> Identifiers**: یک **App ID** بسازید و قابلیت *Sign in with Apple* را روشن کنید.
3. یک **Services ID** بسازید (مثل `com.example.chartterminal.web`). همین مقدار `CT_APPLE_SERVICE_ID` است. Sign in with Apple را روشن و **Configure** را بزنید: Primary App ID را انتخاب کنید، **Domains** = دامنه‌ی سرور، **Return URLs** = `https://دامنه‌ی-شما/api/auth/oauth/callback/apple`.
4. فایل تأیید دامنه‌ای که Apple می‌دهد (`apple-developer-domain-association.txt`) باید از `https://دامنه/.well-known/apple-developer-domain-association.txt` در دسترس باشد (سرور پسوند `.txt` را با نوع `text/plain` سرو می‌کند؛ فایل را در `public/.well-known/` قرار دهید و بیلد را دوباره بگیرید). سپس **Verify** بزنید.
5. **Keys -> New key**: *Sign in with Apple* را تیک بزنید، Primary App ID را انتخاب کنید و فایل `.p8` را **فقط یک بار** دانلود کنید. Key ID همان `CT_APPLE_KEY_ID` است.
6. **Team ID** (۱۰ نویسه) را از صفحه‌ی Membership بردارید: `CT_APPLE_TEAM_ID`.
7. فایل `.p8` را روی سرور و **بیرون از `CT_DATA_DIR`** بگذارید (دسترسی فقط‌خواندنی برای کاربر سرویس، مثلاً `chmod 400`؛ در Docker به‌صورت read-only mount کنید). سرور اگر مسیر کلید داخل پوشه‌ی داده باشد، بالا نمی‌آید.
8. متغیرها:
   ```
   CT_APPLE_SERVICE_ID=com.example.chartterminal.web
   CT_APPLE_TEAM_ID=ABCDE12345
   CT_APPLE_KEY_ID=KEYID12345
   CT_APPLE_PRIVATE_KEY_FILE=/run/secrets/AuthKey_KEYID12345.p8
   ```
9. ری‌استارت و آزمایش. نکته‌ها: ایمیل کاربر ممکن است مخفی باشد (`privaterelay.appleid.com`)؛ نام کاربر فقط بار اول از Apple می‌آید و **سرور آن را عمداً نادیده می‌گیرد** (کاربر خودش نام کاربری انتخاب می‌کند). اگر فایل کلید خوانده نشود یا کلید EC معتبر نباشد، Apple با یک هشدار در لاگ خاموش می‌ماند (سرور از کار نمی‌افتد).

هر چهار متغیر Apple باید با هم تنظیم شوند؛ ناقص بودن باعث توقف راه‌اندازی با پیام مشخص می‌شود.

## ج) تنظیمات سرور

| متغیر | معنی |
|---|---|
| `CT_GOOGLE_CLIENT_ID`, `CT_GOOGLE_CLIENT_SECRET` | کلاینت Web در Google |
| `CT_APPLE_SERVICE_ID`, `CT_APPLE_TEAM_ID`, `CT_APPLE_KEY_ID`, `CT_APPLE_PRIVATE_KEY_FILE` | Sign in with Apple |
| `CT_REGISTRATION` | `invite` (پیش‌فرض: بعد از ورود با Google کاربر «نام کاربری» و «کد دعوت» می‌دهد)، `open`، یا `closed` (ورود برای حساب‌های موجود کار می‌کند؛ حساب جدید ساخته نمی‌شود) |
| `CT_PUBLIC_URL` | پایه‌ی آدرس‌های redirect |
| `CT_OAUTH_START_MAX`, `CT_OAUTH_CB_MAX` | (اختیاری) سقف شروع ورود و callback در هر ۱۰ دقیقه برای هر آدرس؛ پیش‌فرض ۲۰ و ۳۰ |

قواعد حساب (خلاصه):
- ایمیل **هرگز** برای پیدا کردن یا اتصال حساب استفاده نمی‌شود. اتصال Google به حساب موجود فقط از داخل یک نشست ورود‌کرده و با تأیید دوباره (رمز، یا ورود/تأیید مجدد با ارائه‌دهنده در ۱۰ دقیقه‌ی اخیر) انجام می‌شود.
- حذف آخرین روش ورود ممکن نیست (۴۰۹ `last_method`). کاربر فقط-OAuth با ۸ کد بازیابی ساخته می‌شود و می‌تواند بعداً رمز تعیین کند.
- ادمین باید رمز داشته باشد (ابزارهای ادمین رمز را دوباره می‌خواهند)؛ `CT_ADMIN` هیچ‌وقت از مسیر OAuth ساخته نمی‌شود.

## د) لاگ پروکسی

callback گوگل `code` و `state` را در query دارد (هر دو یک‌بارمصرف‌اند). بهتر است ثبتشان را خاموش کنید:

- Caddy: برای مسیر `/api/auth/oauth/callback/*` در بخش `log` فیلتر `delete` روی `request>uri` بگذارید، یا فقط مسیر را ثبت کنید.
- nginx: در `log_format` به‌جای `$request` از `$request_method $uri` استفاده کنید (بدون `$args`).

خود سرور query را هیچ‌وقت لاگ نمی‌کند، و `code` برگشت به برنامه در **fragment** آدرس (`#...`) می‌آید که به هیچ سرور و هیچ `Referer` نمی‌رود.

## هـ) عیب‌یابی

- دکمه نمایش داده نمی‌شود: `GET /api/auth/status` را ببینید؛ `oauth.google` باید `true` باشد.
- `redirect_uri_mismatch` در Google: آدرس ثبت‌شده با `${CT_PUBLIC_URL}/api/auth/oauth/callback/google` یکی نیست (http/https، اسلش آخر، پورت).
- بعد از ورود پیام «Sign-in failed»: علت دقیق در جدول `audit` به شکل `oauth fail:<کد>` ثبت می‌شود (`nonce`, `aud`, `iss`, `exp`, `signature`, `token`, `network` ...). متن توکن هیچ‌وقت ثبت نمی‌شود.
- سرور به Google/Apple نمی‌رسد (`network`): خروجی VPS را بررسی کنید؛ ورود با رمز همیشه در دسترس می‌ماند.
