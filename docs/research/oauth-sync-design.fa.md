[فارسی](oauth-sync-design.fa.md) · [English](oauth-sync-design.md)

# ورود با Google / Apple + «تطبیق» داده‌های دستگاه و داده‌های حساب

وضعیت: فقط طراحی (چیزی پیاده‌سازی نشده). دامنه: سرورهای عمومی (`CT_MODE=public`). سرورهای خصوصی همان رمز واحد را نگه می‌دارند.
همه‌ی مطالب زیر به کدِ فعلی تکیه دارند (`server/authroutes.ts`، `server/core/users.ts`، `server/core/http.ts`، `server/state.ts`، `src/sync.ts`، `src/boot.ts`، `android/.../MainActivity.java`).

## 0. یافته‌هایی که طراحی را شکل می‌دهند

1. **حساب‌ها ایمیل ندارند.** جدول `users` به شکل `(id, name UNIQUE, pw NOT NULL, role, …)` است (`users.ts:13`). چیزی برای «تطبیق با ایمیل» وجود ندارد، پس حمله‌ی کلاسیک تصاحب حساب در OAuth (پیوند خودکار با ایمیل) به‌طور اتفاقی هم وارد نمی‌شود: ما هرگز ستون ایمیلی که برای تطبیق به کار برود اضافه نمی‌کنیم.
2. **نام کاربری لازم است** (`checkName`، `users.ts:222`؛ `name NOT NULL UNIQUE`). بنابراین اولین ورود با OAuth به مرحله‌ی «یک نام کاربری انتخاب کنید» نیاز دارد؛ حساب را نمی‌شود داخل callback ارائه‌دهنده ساخت.
3. **`pw NOT NULL`** است و `verifyPassword` وقتی رشته‌ی ذخیره‌شده با `scrypt$…` شروع نشود، `false` را *پیش از* اجرای scrypt برمی‌گرداند. حسابِ فقط‌OAuth که با `pw='oauth$'` ذخیره شده باشد، به ورود با رمز سریع‌تر از یک رمز غلط جواب می‌دهد: یک timing oracle برای «این نام کاربری وجود دارد و فقط OAuth است». تابع `login()` (`users.ts:263`) باید برای چنین ردیف‌هایی در برابر `DUMMY` راستی‌آزمایی کند.
4. **همگام‌سازی فعلیِ هنگام ورود وقتی هر دو طرف داده دارند مخرب است.** `boot.ts:65-67`: اگر سرور حتی یک کلید داشته باشد، `hydrate(state)` اجرا می‌شود؛ `hydrate` هر کلید همگام‌شده‌ی محلی را که سرور ندارد پاک می‌کند و بقیه را بازنویسی می‌کند (`sync.ts:64-73`). تنها پرسش (`offerUpload`، `boot.ts:33`) وقتی ظاهر می‌شود که **سرور خالی** باشد. گوشی داده‌ی محلی دارد + حساب داده دارد = داده‌ی گوشی بی‌صدا جایگزین می‌شود. دقیقاً همین حالتی است که مالک می‌خواهد درست شود و به OAuth ربطی ندارد (ورود با رمز هم همین باگ را دارد).
5. **خروج (logout) کلیدهای `ct.*` را پاک نمی‌کند** (`login.ts:122-129`: flush، خروج از API، `setToken(undefined)`، بارگذاری مجدد). روی مرورگر مشترک، کاربر B وارد می‌شود و منطق «اولین ورود»ِ بعدی داده‌ی کاربر A را «داده‌ی این دستگاه» می‌بیند و پیشنهاد می‌دهد در حساب B ادغام شود. به یک نشانگر مالک نیاز دارد (بخش 4.2).
6. **هسته‌ی احراز هویت از قبل آنچه لازم داریم را دارد**: `issue()` (`authroutes.ts:90`) یک نشست کوکی تازه یا توکن Bearer دستگاه می‌دهد و هرگز توکن فرستاده‌شده‌ی کلاینت را نمی‌پذیرد (بدون fixation)؛ `createDevice` (`auth.ts:52`، حداکثر 10)؛ دروازه‌ی cross-origin به نام `DEVICE_AUTH` (`http.ts:110`، استفاده در `:162`)؛ محدودکننده‌های `reserve/allow` (`users.ts:145,154`)؛ و `audit` (`users.ts:108`).
7. **APK اندروید یک کلاینت نازک است** که origin سرور را در یک WebView بارگذاری می‌کند (`MainActivity.java:187`، `web.loadUrl(origin)`)، هم‌مبدأ و با کوکی. ناوبری‌های خارج از origin همین حالا به مرورگر سیستم فرستاده می‌شوند (`:157-165`). هنوز APK با asset همراه (bundled) وجود ندارد (`docs/multi-server.md` بخش «اندروید» فقط آن را به‌عنوان گزینه‌ی آینده توصیف می‌کند).
8. **مسیرها (routes) با یک تست دسته‌بندی می‌شوند**: `isolation.test.ts` روی مسیر دسته‌بندی‌نشده و روی ورودی کهنه شکست می‌خورد. مسیرهای جدید OAuth باید در حالت public **بی‌قیدوشرط** ثبت شوند (و وقتی ارائه‌دهنده پیکربندی نشده 404 بدهند)، وگرنه جدول مسیرها به متغیرهای محیطی وابسته می‌شود.

## 1. پروتکل (OIDC سمت سرور، بدون SDK)

### 1.1 چرا SDK شخص ثالث نه
`node:crypto` همه‌چیز را دارد: `createPublicKey({key: jwk, format: 'jwk'})`، `crypto.verify('RSA-SHA256', …)` برای توکن‌های ID با RS256، `createSign('SHA256').sign({key, dsaEncoding: 'ieee-p1363'})` برای client secret از نوع ES256 اپل، `randomBytes`، `createHash`، `timingSafeEqual`؛ و `fetch` سراسری برای فراخوانی توکن و JWKS. کل verifier حدود 180 خط است که در یک نشست قابل خواندن است. یک SDK (passport، openid-client، jose) درخت وابستگی‌ای به سروری اضافه می‌کند که داده‌ی همه‌ی کاربران را نگه می‌دارد، رفتار discovery/redirect/cookie خودش را می‌آورد (SSRF از طریق سندهای discovery، `alg` agility، CVEهای کتابخانه) و قانون «بدون وابستگی جدید» پروژه را می‌شکند (`server/package.json`). Endpointها **ثابت‌های داخل کد** هستند؛ هرگز در زمان اجرا کشف نمی‌شوند و هرگز از درخواست گرفته نمی‌شوند.

| | Google | Apple |
|---|---|---|
| authorize | `https://accounts.google.com/o/oauth2/v2/auth` | `https://appleid.apple.com/auth/authorize` |
| token | `https://oauth2.googleapis.com/token` | `https://appleid.apple.com/auth/token` |
| JWKS | `https://www.googleapis.com/oauth2/v3/certs` | `https://appleid.apple.com/auth/keys` |
| `iss` | `https://accounts.google.com` (شکل بدون پروتکل `accounts.google.com` هم پذیرفته می‌شود) | `https://appleid.apple.com` |
| `aud` | `CT_GOOGLE_CLIENT_ID` | `CT_APPLE_SERVICE_ID` |
| scope | `openid email` (بدون `profile`: نام/عکس لازم نداریم) | `email` (افزودن `name` حالت form_post را اجباری می‌کند و فقط یک بار نام می‌دهد؛ ما درخواستش نمی‌کنیم، بخش 1.4 را ببینید) |
| client auth | رشته‌ی `client_secret` | `client_secret` = یک JWT از نوع ES256 که خودمان امضا می‌کنیم |
| response | query (callback با `GET`) | `response_mode=form_post` (callback با **`POST`**) |

از پاسخ توکن فقط `id_token` استفاده می‌شود. `access_token`/`refresh_token` بلافاصله دور ریخته می‌شوند (هرگز ذخیره یا لاگ نمی‌شوند). هیچ فراخوانی userinfo وجود ندارد.

### 1.2 Endpointها (همه در فایل جدید `server/oauth.ts`، import‌شده از شاخه‌ی public در `authroutes.ts:81`)

| مسیر | احراز هویت | هدف |
|---|---|---|
| `GET /api/auth/status` (موجود، `authroutes.ts:92`) | عمومی | فیلد `oauth: { google: boolean, apple: boolean }` را اضافه می‌کند (از روی پیکربندی). وقتی false باشد دکمه‌ها پنهان می‌شوند. |
| `POST /api/auth/oauth/start` | عمومی (نیت link خودش نشست را بررسی می‌کند) | بدنه `{ provider, intent: 'login'\|'link'\|'reauth', challenge, ret, port?, device? }` -> `{ url }`. POST است تا قواعد معمول CSRF و `x-ct-client` اعمال شوند و چیز حساسی در یک URL قابل‌پیمایش نباشد. |
| `GET /api/auth/oauth/callback/google` | عمومی، raw | مقصد redirect گوگل. |
| `POST /api/auth/oauth/callback/apple` | عمومی، raw، **معاف از CSRF** | مقصد `form_post` اپل (`application/x-www-form-urlencoded`: `code, id_token, state, user?, error?`). |
| `POST /api/auth/oauth/exchange` | عمومی (cross-origin از طریق `DEVICE_AUTH` مجاز) | `{ code, verifier, device? }` -> ورود: `{ ok, user, token? }` (کوکی یا توکن دقیقاً مثل `issue()`)؛ هویت جدید: `{ signup: true, ticket, hint }`؛ link: `{ linked: provider }`؛ شکست: خطای یکنواخت. |
| `POST /api/auth/oauth/signup` | عمومی (از طریق `DEVICE_AUTH`) | `{ ticket, verifier, name, invite?, device? }` -> حساب + `recoveryCodes` + نشست/توکن، با همان شکلِ `register` (`authroutes.ts:96`). |
| `GET /api/auth/identities` | نشست | `[{ provider, email, relay, created, lastLogin }]` + `{ hasPassword }`. |
| `DELETE /api/auth/identities/:provider` | نشست + step-up | لغو پیوند (قواعد در 2.4). |
| `POST /api/auth/password/set` | نشست + احراز مجدد تازه با OAuth | به یک حساب فقط‌OAuth رمز می‌دهد (مسیر موجود `/api/auth/password` رمز *فعلی* را می‌خواهد، `authroutes.ts:111`). |

تغییرات جدید `http.ts` (حدود 8 خط): افزودن `/api/auth/oauth/exchange` و `/api/auth/oauth/signup` به `DEVICE_AUTH` (`http.ts:110`)؛ در دروازه‌ی CSRF (`http.ts:159`) رد کردن `csrfOk` و الزام `x-ct-client` دقیقاً برای `POST /api/auth/oauth/callback/apple` (POST مرورگرِ اپل `Origin: https://appleid.apple.com` یا `null` دارد و نمی‌تواند هدر ما را حمل کند؛ callback با `state` احراز هویت می‌شود نه با کوکی، پس CSRF مبتنی بر کوکی صدق نمی‌کند). این مسیر باید `raw: true` با `limit: 8192` باشد، چون در غیر این صورت `handle()` بدنه را `JSON.parse` می‌کند (`http.ts:~186`)؛ ما خودمان `URLSearchParams` را تجزیه می‌کنیم.

### 1.3 state، nonce، PKCE: دو لایه‌ی PKCE

جدول‌ها در `users.db` (مرکزی؛ مهاجرت‌های `users/3..5`، بخش 2.1):

```
oauth_state(state_hash PK, provider, nonce, p_verifier, c_challenge, intent, user_id, ret, port, device, created, expires)   -- 10 min, single use
oauth_code (code_hash  PK, kind, user_id, provider, subject, email, relay, c_challenge, expires)                          -- 60 s, single use
oauth_signup(ticket_hash PK, provider, subject, email, relay, c_challenge, expires)                                       -- 10 min, single use
```

* `state` = 32 بایت تصادفی (base64url)؛ فقط SHA-256 آن ذخیره می‌شود. با `DELETE … WHERE state_hash=? AND expires>? RETURNING *` مصرف می‌شود: یک state هرگز دو بار قابل استفاده نیست، حتی با callbackهای موازی.
* `nonce` = 32 بایت تصادفی که به ارائه‌دهنده فرستاده و ذخیره می‌شود؛ با `nonce` توکن ID با `timingSafeEqual` مقایسه می‌شود.
* **لایه‌ی 1، سرور <-> ارائه‌دهنده**: `p_verifier` (43 تا 128 نویسه) با `code_challenge=S256` به گوگل فرستاده می‌شود. برای اپل، PKCE فقط در صورتی فرستاده شود که endpoint توکن اپل `code_verifier` را بپذیرد (اینجا راستی‌آزمایی نشده؛ پیش از پیاده‌سازی بررسی کنید و به آن تکیه نکنید: برای اپل حفاظت همان `state` + `nonce` + لایه‌ی زیرین است).
* **لایه‌ی 2، صفحه‌ی ما <-> سرور ما** (لایه‌ی مهم): کلاینت خودش یک `verifier` می‌سازد، فقط `challenge = BASE64URL(SHA256(verifier))` را در `/start` می‌فرستد، `verifier` را در storage دستگاه آغازکننده نگه می‌دارد و باید آن را در `/exchange` یا `/signup` ارائه کند. سرور `c_challenge` را همراه state ذخیره می‌کند و در کدِ یک‌بارمصرف کپی می‌کند. همین سازوکار واحد جلوی login-CSRF را می‌گیرد (مهاجم مرورگر قربانی را وادار می‌کند callback مهاجم را تمام کند: کد به challenge مهاجم بسته شده و صفحه‌ی قربانی verifier دیگری دارد)، همچنین ربایش custom-scheme در اندروید و بازپخش کدِ لو رفته. به‌خاطر آن، **به هیچ کوکی اتصال `__Host-` روی callback نیاز نداریم**، که خوب است: کوکی‌های نشست SameSite=Strict (`auth.ts:95`) روی redirect بین‌سایتیِ برگشت فرستاده نمی‌شوند و در غیر این صورت برای POST اپل به کوکی `SameSite=None` نیاز می‌شد.

### 1.4 فهرست مجاز redirect URI
* `redirect_uri` ارائه‌دهنده **هرگز از کلاینت نمی‌آید**. برابر است با `new URL('/api/auth/oauth/callback/<provider>', publicUrl())` (`mode.ts:146`، `CT_PUBLIC_URL`) و بایت‌به‌بایت در Google/Apple ثبت می‌شود. سروری که `CT_PUBLIC_URL` نداشته باشد همین حالا هم هنگام راه‌اندازی رد می‌شود (`mode.ts:188`).
* مقصد نهایی *کاربر* پس از آن `ret` است که یک **کلید** است نه URL: `web` -> `/#oauth=<code>` روی `CT_PUBLIC_URL`؛ `app` -> صفحه‌ی میانی `/oauth-return.html#code=<code>` (که سپس `chartterminal://oauth#code=…` را امتحان می‌کند، بخش 3.3)؛ `loopback` -> `http://127.0.0.1:<port>/ct-oauth?code=<code>` که `port` یک عدد صحیح 1024 تا 65535 است و سمت سرور اعتبارسنجی می‌شود (RFC 8252 loopback). هر چیز دیگر: 400. open redirect وجود ندارد چون هیچ URL‌ای از درخواست نمی‌آید.
* کد در **fragment** حرکت می‌کند برای web/app (به سرورها فرستاده نمی‌شود، در `Referer` و لاگ دسترسی پروکسی نمی‌آید) و فقط برای loopback در query می‌آید (روی 127.0.0.1 می‌ماند).

### 1.5 پردازش callback (Google با GET / Apple با POST)، به ترتیب
1. ارائه‌دهنده پیکربندی شده؟ وگرنه 404. پارامترها را تجزیه کن؛ اگر `error` هست -> redirect با `#error=denied` (هرگز متن ارائه‌دهنده را برنگردان).
2. throttle به‌ازای IP (`allow('oauth-cb:'+ipKey, 30, 600_000)`)؛ سقف سراسری 8 فراخوانی هم‌زمان توکن.
3. `state` را مصرف کن (یک‌بارمصرف، منقضی‌نشده، ارائه‌دهنده با مسیر یکی باشد). ناشناخته/منقضی: redirect به `#error=expired`.
4. POST به URL ثابت توکن: `grant_type=authorization_code`، `code`، `redirect_uri`، `client_id`، `client_secret` (اپل: یک JWT تازه‌ی ES256، 1.6)، `code_verifier` (گوگل). `redirect: 'error'`، timeout پنج‌ثانیه‌ای، پاسخ حداکثر 64 KB، فقط `application/json`، فقط HTTPS.
5. توکن ID را راستی‌آزمایی کن (1.7). هر شکستی: audit با `oauth fail:<reason>` (reason یک کد کوتاه ثابت است، هرگز متن توکن نیست) و redirect به `#error=failed`. همه‌ی شکست‌ها برای کاربر یکسان به نظر می‌رسند.
6. نتیجه را بر اساس intent تعیین کن (بخش 2.2) و یک ردیف `oauth_code` بساز (60 ثانیه، بسته به `c_challenge`). redirect با 303 به `ret` همراه کد.
7. اپل: اگر فیلد فرم `user` وجود داشت (نام، فقط در اولین مجوزدهی) **نادیده گرفته می‌شود**: کاربران ما نام کاربری انتخاب می‌کنند و داده‌ی فرمِ احراز هویت‌نشده نباید روی هویت اثر بگذارد. ایمیل از توکن ID راستی‌آزمایی‌شده می‌آید، هرگز از فرم.

### 1.6 client secret اپل (ES256)
هدر `{alg:'ES256', kid: CT_APPLE_KEY_ID}`، claims `{iss: CT_APPLE_TEAM_ID, iat: now, exp: now+3600, aud: 'https://appleid.apple.com', sub: CT_APPLE_SERVICE_ID}`. با فایل `.p8` (PKCS8 PEM) امضا می‌شود که یک بار از `CT_APPLE_PRIVATE_KEY_FILE` خوانده می‌شود: `createSign('SHA256').update(signingInput).sign({ key: pem, dsaEncoding: 'ieee-p1363' })` و سپس base64url (JOSE به `r||s` خام نیاز دارد، نه DER). برای هر فراخوانی توکن دوباره ساخته می‌شود (ارزان)؛ اپل تا 6 ماه اجازه می‌دهد اما عمر کوتاه هزینه‌ای ندارد. مسیر/محتوای فایل هرگز لاگ نمی‌شود. کلید خراب باعث می‌شود ارائه‌دهنده هنگام راه‌اندازی «پیکربندی‌نشده» شود (هشدار + غیرفعال)، نه اینکه در اولین کاربر کرش کند.

### 1.7 راستی‌آزمایی توکن ID (`core/oidc.ts`، حدود 180 خط، خالص و قابل تست واحد)
1. به 3 بخش تقسیم کن، حداکثر 8 KB، هدر/payload را به‌صورت JSON با base64url رمزگشایی کن (هر شکستی = رد).
2. `alg` باید دقیقاً `RS256` باشد و `typ`/`kid` وجود داشته باشند. `none`، `HS*`، `ES*` رد می‌شوند (حمله‌ی alg-confusion را از بین می‌برد؛ هرگز برای راستی‌آزمایی از shared secret استفاده نمی‌کنیم).
3. کلید: از کش JWKS هر ارائه‌دهنده با `kid`؛ `kty` باید `RSA` باشد، `use` برابر `sig` یا غایب. `createPublicKey({ key: jwk, format: 'jwk' })`؛ `crypto.verify('RSA-SHA256', data, key, sig)`.
4. Claims: `iss` دقیقاً (یا شکل بدون پروتکل گوگل)؛ `aud` برابر client id ما (رشته) یا آرایه‌ای که آن را دارد و `azp` برابر آن است؛ `exp > now - 60 s`؛ `iat <= now + 60 s` و قدیمی‌تر از 10 دقیقه نباشد؛ `nonce` برابر مقدار ذخیره‌شده (زمان ثابت)؛ `sub` رشته‌ی غیرخالی با طول <= 255.
5. `at_hash` اگر وجود داشت: base64url نیمه‌ی چپ SHA-256 از access_token باید مطابقت کند (access token را از همان پاسخ TLS داریم؛ ارزان است و اشتباه‌های endpoint توکن را می‌گیرد).
6. `email`: فقط اگر `email_verified === true || === 'true'` نگه داشته می‌شود (اپل رشته می‌فرستد). ایمیل تأییدنشده حذف می‌شود (هویت همچنان با `sub` معتبر است، اما بخش 2.2 را ببینید: ایمیل را برای هیچ چیزِ مرتبط با امنیت لازم نداریم).
7. **دریافت JWKS**: URL ثابت به‌ازای هر ارائه‌دهنده؛ فقط HTTPS؛ بدون redirect؛ timeout پنج‌ثانیه‌ای؛ <= 64 KB؛ `Cache-Control: max-age` رعایت می‌شود و بین 5 دقیقه تا 24 ساعت محدود می‌شود؛ برای `kid` ناشناخته حداکثر یک بار دریافت مجدد در هر 60 ثانیه به‌ازای هر ارائه‌دهنده (مهاجمی که `kid`های تصادفی می‌فرستد نمی‌تواند ما را وادار به فشار آوردن به Google/Apple کند)؛ در شکست دریافت، تا 24 ساعت از کش کهنه استفاده می‌شود وگرنه fail-closed.

## 2. مدل حساب

### 2.1 شمای پایگاه داده (`users.db` مرکزی، در `users.ts`)
```sql
-- users/3
CREATE TABLE identities (provider TEXT NOT NULL, subject TEXT NOT NULL, user_id INTEGER NOT NULL REFERENCES users ON DELETE CASCADE,
  email TEXT, relay INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL, last_login INTEGER,
  PRIMARY KEY (provider, subject));
CREATE INDEX identities_user ON identities (user_id);
CREATE UNIQUE INDEX identities_one_per_provider ON identities (user_id, provider);   -- one Google + one Apple per account
-- users/4
ALTER TABLE users ADD COLUMN has_pw INTEGER NOT NULL DEFAULT 1;
-- users/5   oauth_state, oauth_code, oauth_signup (section 1.3); swept by the existing 10-minute interval (users.ts:359)
```
`ON DELETE CASCADE` + `removeUser` (`users.ts:339`) از قبل هویت‌ها را همراه حساب پاک می‌کنند. `email` فقط اطلاعات نمایشی/مدیریتی است و **هرگز برای پیدا کردن یا پیوند دادن حساب استفاده نمی‌شود**.

### 2.2 قواعد
| وضعیت | رفتار |
|---|---|
| Callback، هویت `(provider, sub)` وجود دارد، حساب فعال | آن کاربر وارد می‌شود (`issue()`)؛ `last_login` به‌روز می‌شود؛ audit با `oauth login`. |
| همان، حساب غیرفعال/در حال حذف | شکست یکنواخت (`#error=failed`)؛ audit با `oauth disabled`. |
| هویت ناشناخته، intent برابر `login` | **هیچ حسابی ساخته نمی‌شود و هیچ جست‌وجوی ایمیلی انجام نمی‌شود.** `exchange` مقدار `{signup:true, ticket}` را برمی‌گرداند؛ کلاینت «یک نام کاربری انتخاب کنید» را نشان می‌دهد (+ کد دعوت اگر `REGISTRATION==='invite'`). متن همچنین می‌گوید: «قبلاً در اینجا حساب دارید؟ با رمزتان وارد شوید، سپس Google را در حساب -> روش‌های ورود پیوند بدهید.» |
| مرحله‌ی signup | `REGISTRATION==='closed'` -> 403؛ `'invite'` -> دعوت لازم است و دقیقاً مثل `register()` همراه ساخت حساب به‌صورت اتمی مصرف می‌شود (`users.ts:239-246`، همان `BEGIN IMMEDIATE`)؛ `'open'` -> محدودیت‌های `allow('reg:…')` (`users.ts:232-233`). نام کاربری از `checkName` + `reserved` می‌گذرد (`users.ts:222-236`). `pw='oauth$'`، `has_pw=0`، ردیف هویت در همان تراکنش درج می‌شود؛ 8 کد بازیابی ساخته و فقط یک بار نشان داده می‌شود. |
| intent برابر `link` | به نشست واردشده نیاز دارد (در `/start` *و* دوباره در `/exchange` بررسی می‌شود، از طریق `oauth_state.user_id` بسته می‌شود). اول step-up: رمز (`confirmPassword`، `users.ts:273`) اگر `has_pw`، وگرنه ورود OAuth یا احراز مجدد در 10 دقیقه‌ی اخیر. اگر هویت از قبل به **حساب دیگری** تعلق دارد -> رد می‌شود («این حساب Google از قبل به حساب دیگری پیوند خورده است»)؛ هرگز حساب‌ها را خودکار منتقل یا ادغام نمی‌کنیم. |
| intent برابر `reauth` | یک رفت‌وبرگشت با ارائه‌دهنده که فقط ثابت می‌کند فراخواننده هنوز هویتِ پیوندخورده را در اختیار دارد؛ برای step-up حساب‌های فقط‌OAuth (تعیین رمز، لغو پیوند، حذف داده) به کار می‌رود. |
| relay خصوصی اپل (`@privaterelay.appleid.com` یا `is_private_email`) | با `relay=1` ذخیره می‌شود و به‌صورت «ایمیل پنهان (Apple)» نشان داده می‌شود. هرگز با چیزی تطبیق داده نمی‌شود. چون ایمیلی نمی‌فرستیم، تنظیم forward کردن relay در اپل لازم نیست. |
| یک ایمیل در Google و Apple | دو هویت نامرتبط؛ کاربر می‌تواند هر دو را صریحاً به یک حساب پیوند بدهد. |
| نقش admin | OAuth می‌تواند به‌عنوان ورود اضافه شود. ابزارهای admin step-up با رمز را نگه می‌دارند (`authroutes.ts:142-145`)، پس حساب admin باید رمز داشته باشد؛ bootstrap با `CT_ADMIN` (`users.ts:314`) هرگز از OAuth نمی‌گذرد. CLI ارتقا («promote») حساب‌های با `has_pw=0` را رد می‌کند. |

### 2.3 ورود با رمز برای کاربران فقط‌OAuth
`login()`: `if (!row.has_pw) { await verifyPassword(await DUMMY, pw); fail uniformly }` تا زمان‌بندی با کاربر ناشناخته برابر شود (`users.ts:263`). `recover()` (`users.ts:286`) بدون تغییر کار می‌کند و `has_pw=1` را تنظیم می‌کند: کدهای بازیابی همان مسیر «حساب Google خود را گم کرده‌ام» هستند (رمز بگذارید، وارد شوید).

### 2.4 لغو پیوند / آخرین روش
تعداد روش‌های ورود = (`has_pw ? 1 : 0`) + `COUNT(identities)`. اگر تعداد به کمتر از 1 برسد، `DELETE /api/auth/identities/:provider` با 409 و `last_method` رد می‌شود. به step-up نیاز دارد (2.2). لغو پیوند نشست‌ها یا توکن‌های دستگاه را باطل نمی‌کند (بیش از حد غافلگیرکننده است)؛ `oauth unlink` را audit می‌کند و کاربر می‌تواند نشست‌ها را در «دستگاه‌ها و نشست‌ها» پایان دهد. تعیین رمز برای حساب فقط‌OAuth (`/api/auth/password/set`) به احراز مجدد تازه نیاز دارد و `checkNewPassword` را اعمال می‌کند.

### 2.5 دید مدیر
`listUsers` (`users.ts:352`) فیلدهای `has_pw` و `identities: [{provider, email}]` را اضافه می‌کند؛ رابط/CLI مدیر «Google (a***@gmail.com)» را نشان می‌دهد. رویدادهای audit (`users.ts:108`): `oauth start|login|link|unlink|signup|fail:<code>`. مدیر می‌تواند حساب را غیرفعال کند (`setStatus`) که از قبل نشست‌ها را باطل می‌کند؛ «پیوند دادن از طرف کاربر» توسط مدیر وجود ندارد.

## 3. کلاینت‌ها

همه‌ی کلاینت‌ها چهار کار یکسان می‌کنند: (1) `verifier`/`challenge` می‌سازند (`crypto.getRandomValues`، 32 بایت) و `{verifier, server, exp: now+10min}` را در storage ذخیره می‌کنند؛ (2) `POST /start` می‌زنند و `url` برگشتی را باز می‌کنند؛ (3) `code` را دریافت می‌کنند (fragment/scheme/loopback)؛ (4) `POST /exchange {code, verifier, device?}` می‌زنند و مثل یک ورود عادی تمام می‌کنند (`authPost`، `login.ts:60` از قبل برای origin دیگر `device` اضافه می‌کند و توکن Bearer را با `setToken` ذخیره می‌کند). فقط *مسیر انتقال کد* فرق دارد. فایل کلاینتِ جدید `src/oauth.ts` (حدود 150 خط)؛ `boot.ts` پیش از `authStatus()` تابع `resumeOAuth()` را صدا می‌زند.

### 3.1 وب (هم‌مبدأ)
`/start` با `ret:'web'`، سپس `location.assign(url)`. با برگشت به `/#oauth=<code>`: `boot()` hash را می‌خواند، `history.replaceState` فوراً آن را پاک می‌کند، verifier ذخیره‌شده را بارگذاری می‌کند و `/exchange` را صدا می‌زند (هم‌مبدأ، کوکی را `issue()` تنظیم می‌کند، نشست کوکیِ قبلی ابتدا پایان می‌یابد - `start()` در `authroutes.ts:84`). Storage: کلید `localStorage` به نام `ctoauth` (نه `ct.*`، تا هرگز همگام نشود) با انقضای 10 دقیقه؛ مرورگرهای موبایل در رفت‌وبرگشت با ارائه‌دهنده تب‌ها را خارج می‌کنند، پس `sessionStorage` امن نیست.

### 3.2 PWA / Electron / lite
* **PWA نصب‌شده (اندروید)**: مثل وب؛ صفحه‌ی ارائه‌دهنده در یک custom tab داخل برنامه باز می‌شود و برگشت https توسط PWA گرفته می‌شود. **PWA مستقل iOS**: storage از Safari جداست و ممکن است برگشت در Safari باز شود و verifier گم شود. محدودیت صادقانه: در iOS دکمه‌ی OAuth در Safari کار می‌کند؛ در برنامه‌ی صفحه‌ی خانه می‌گوییم: «برای ورود با Apple/Google در Safari باز کنید، یا از رمزتان استفاده کنید.» (با `navigator.standalone` تشخیص داده می‌شود).
* **Electron (`desktop/main.cjs`) و lite**: `shell.openExternal(url)` (مرورگر سیستم، هرگز پنجره‌ی توکار: گوگل آن‌ها را رد می‌کند و کاربران باید مرورگر واقعی خودشان را ببینند). برنامه یک شنونده‌ی HTTP یک‌بارمصرف روی `127.0.0.1:<random port>` راه می‌اندازد که یک صفحه‌ی کوچک «می‌توانید این تب را ببندید» نشان می‌دهد، از `ret:'loopback'&port=…` استفاده می‌کند، `?code=` را می‌خواند، شنونده را می‌بندد، سپس با برچسب دستگاهش `/exchange` را صدا می‌زند -> توکن Bearer. حدود 40 خط در `desktop/main.cjs`، هیچ چیز در سرور جز `port` اعتبارسنجی‌شده.

### 3.3 APK اندروید (کلاینت نازک، WebView از origin سرور)
مسئله: گوگل OAuth را در WebViewهای توکار مسدود می‌کند (`disallowed_useragent`). امروز ناوبری به `accounts.google.com` داخل WebView توسط `shouldOverrideUrlLoading` (`MainActivity.java:157-165`) به مرورگر پیش‌فرض داده می‌شود، بدون راه برگشت به برنامه و بدون verifier ما.

طراحی: صفحه برنامه را با پسوند UA تشخیص می‌دهد (`" CTApp/1"`، با `s.setUserAgentString(s.getUserAgentString() + " CTApp/1")` افزوده می‌شود) و `ret:'app'` می‌فرستد. WebView اجازه می‌دهد صفحه به URL ارائه‌دهنده برود؛ `shouldOverrideUrlLoading` دو میزبان ارائه‌دهنده را می‌شناسد و به‌جای آن یک **Chrome Custom Tab** باز می‌کند. callback سرور با 303 به `https://<server>/oauth-return.html#code=…` می‌رود (یک صفحه‌ی ایستای حدود 30 خطی در `public/`): خودکار `location.replace('chartterminal://oauth#code=' + code)` را اجرا می‌کند و یک دکمه‌ی «Open Chart Terminal» هم نشان می‌دهد (حرکت کاربر، برای نسخه‌های Chrome که اجرای اسکریپتی scheme خارجی را مسدود می‌کنند). اندروید custom scheme را به `MainActivity` می‌رساند که کد را به صفحه‌ی WebView تزریق می‌کند؛ صفحه `/exchange` را با verifierی که در `localStorage` وب‌ویو نگه داشته کامل می‌کند.

چرا custom scheme و نه App Link: APK به **هر** آدرس سروری که کاربر بنویسد وصل می‌شود (`showSetup`، `:90-127`)؛ App Link به `/.well-known/assetlinks.json` روی هر میزبان و یک ورودی manifest به‌ازای هر میزبان نیاز دارد، که برای سرورهای دلخواه ناممکن است. یک custom scheme را برنامه‌ی دیگری هم می‌تواند ادعا کند، پس امنیت به اتصال PKCE تکیه دارد: کدِ یک‌بارمصرف 60 ثانیه‌ای برای هر کس بدون verifier بی‌فایده است و verifier هرگز storage وب‌ویو را ترک نمی‌کند. یک ربایشگر فقط می‌تواند یک کد را *بسوزاند* (کاربر دوباره تلاش می‌کند)؛ نمی‌تواند وارد شود.

`AndroidManifest.xml` (`android/app/src/main/AndroidManifest.xml:11-20`): `<activity>` را با این جایگزین کنید
```xml
<activity android:name=".MainActivity" android:exported="true" android:launchMode="singleTask"
    android:configChanges="orientation|screenSize|keyboardHidden|smallestScreenSize|screenLayout" android:windowSoftInputMode="adjustResize">
  <intent-filter>
    <action android:name="android.intent.action.MAIN" />
    <category android:name="android.intent.category.LAUNCHER" />
  </intent-filter>
  <intent-filter>
    <action android:name="android.intent.action.VIEW" />
    <category android:name="android.intent.category.DEFAULT" />
    <category android:name="android.intent.category.BROWSABLE" />
    <data android:scheme="chartterminal" android:host="oauth" />
  </intent-filter>
</activity>
```
(`singleTask` تا intent برگشتی به WebView موجود برسد و Activity دومی ساخته نشود.) اختیاری ولی توصیه‌شده: `implementation 'androidx.browser:browser:1.8.0'` در `android/app/build.gradle` برای `CustomTabsIntent`. جایگزین بدون وابستگی، `ACTION_VIEW` با extra به نام `android.support.customtabs.extra.SESSION` است که روی null binder تنظیم شود و Chrome آن را custom tab حساب می‌کند؛ بدون هر دو، مرورگر پیش‌فرض باز هم کار می‌کند چون برگشت به نوع تب وابسته نیست.

تغییرات `MainActivity.java` (حدود 70 خط):
1. `showWeb`: `s.setUserAgentString(s.getUserAgentString() + " CTApp/1");`
2. `shouldOverrideUrlLoading` (`:157`): پیش از شاخه‌ی عمومی خارجی،
   `if ("https".equals(sch) && (host.equals("accounts.google.com") || host.equals("appleid.apple.com"))) { new CustomTabsIntent.Builder().build().launchUrl(MainActivity.this, u); return true; }`
3. متد جدید `@Override protected void onNewIntent(Intent i)`: `Uri d = i.getData(); if (d != null && "chartterminal".equals(d.getScheme()) && "oauth".equals(d.getHost())) { String f = d.getFragment(); String code = f != null && f.startsWith("code=") ? f.substring(5) : null; if (code != null && code.matches("[A-Za-z0-9_-]{20,64}") && web != null) web.evaluateJavascript("window.__ctOAuth&&window.__ctOAuth('" + code + "')", null); }`. regex تضمین می‌کند تزریق JS ممکن نیست. اگر `web == null` (Activity دوباره ساخته شده)، `onCreate` هم پس از بارگذاری `showWeb` یک بار `getIntent()` را می‌خواند.
4. صفحه `window.__ctOAuth(code)` را تعریف می‌کند -> `exchange`. اگر verifier رفته باشد (برنامه حین رفت‌وبرگشت کشته شده) صفحه «ورود قطع شد، دوباره تلاش کنید» را نشان می‌دهد.
5. محافظ WS موجود و `MIXED_CONTENT_NEVER_ALLOW` تحت تأثیر نیستند؛ `usesCleartextTraffic` فقط برای سرورهای http شبکه‌ی محلی مهم است که به‌ندرت Google/Apple ارائه می‌دهند (گوگل جز localhost به redirect URI با https نیاز دارد).

### 3.4 APK مستقل با assetهای همراه (آینده، بدون سرور خانگی)
در این حالت origin صفحه سرور نیست (`https://appassets.androidplatform.net`، `docs/multi-server.md`). بنابراین ورود **ابتدا یک سرور انتخاب می‌کند** (انتخابگر سرور موجود، `src/servers.ts`): `redirect_uri`، client id و حساب‌ها همه به آن سرور تعلق دارند. فراخوانی‌ها cross-origin با Bearer هستند: `/start`، `/exchange`، `/signup` به `device` نیاز دارند، origin برنامه باید در `CT_CORS_ORIGINS` باشد و سه مسیر در `DEVICE_AUTH` هستند (بخش 1.2). مسیر برگشت مثل 3.3 است. پیامدی که باید در رابط گفته شود: فقط سرورهایی که Google/Apple را پیکربندی کرده‌اند (وضعیت `oauth.google/apple`) دکمه‌ها را نشان می‌دهند. هر سرور عمومی client جداگانه‌ی Google/Apple لازم دارد (redirect URI برای هر سرور جداست)؛ «auth broker» مشترک هدف نیست.

## 4. همگام‌سازی و تطبیق

### 4.1 فهرست وضعیت همگام‌شده‌ی کلاینت
همگام‌شده = هر `ct.<key>` به‌جز `LOCAL_KEYS` (`sync.ts:41`: `bottomH, side, jwFormTab, tsTab, domCfg, pineEditing, lastTool, searchEx`) و هر چیزی که با `KEY_RE` (`sync.ts:42`) رد شود. ردیف‌های سرور به شکل `{value, rev, updated}` هستند (`state.ts:205`، سهمیه‌ی `stateKeyMb=2`، `journalKeyMb=8`، `stateMb=20`، `stateKeys=200`، `quota.ts:9`). کلیدهایی که در `src/` با `store.get/set` پیدا شده‌اند:

| کلید(ها) | شکل | قاعده‌ی ادغام |
|---|---|---|
| `journal` | `Journal`: `trades: JTrade[]` (`id` رشته‌ای، `fills[]`)، `notes: Record<date,text>`، `setups/entryReasons/exitReasons/motives/questions/tagList: string[]`، `accounts/checklists/docs/fields/props` (بر اساس `id`)، `brokerSeen: Record<acct, fillId[]>`، مقادیر اسکالر (`seen, account, activeDays, calendar, replay*`) (`journal.ts:45`) | به‌ازای هر فیلد: `trades` اجتماع بر اساس `id` (همان id در هر دو طرف: طرفی که `closeTime ?? openTime` دیرتری دارد نگه داشته می‌شود؛ fillها اجتماع بر اساس `id` fill)؛ همچنین معامله‌ی دستگاهی که `(sym, dir, openTime, avgEntry, qty)` آن با معامله‌ی حساب برابر است حذف می‌شود (همان fill صرافی که روی دو دستگاه وارد شده)؛ `notes` اجتماع بر اساس تاریخ، در تعارض هر دو با `\n---\n` به هم متصل نگه داشته می‌شوند؛ آرایه‌های رشته‌ای اجتماع مرتب (ابتدا ترتیب حساب)؛ فهرست‌های id اجتماع بر اساس `id`؛ `brokerSeen` اجتماع به‌ازای هر حساب؛ اسکالرها LWW به‌ازای هر فیلد. تصاویر/یادداشت‌های صوتی: `uploadLocalMedia` (`boot.ts:28`) باید **پیش از** ادغام اجرا شود تا idهای ژورنال ادغام‌شده idهای سرور باشند. ادغام هرگز رسانه را پاک نمی‌کند. |
| `layouts` | `Record<name, Layout>` | اجتماع بر اساس نام؛ همان نام با محتوای متفاوت: حساب `name` را نگه می‌دارد و نسخه‌ی دستگاه به‌صورت `name (this device)` افزوده می‌شود. |
| `layout`، `layoutName`، `autosave` | سند چیدمان فعلی، نام، bool | سند اتمی: LWW کل سند بر اساس stamp (ادغام آرایه‌های pane به‌ازای هر فیلد بی‌معنی است)؛ بدون stamp: حساب برنده است. |
| `drawings` | `Record<symbol, Drawing[]>`، `id = Date.now()` (`drawings.ts:247`) | به‌ازای هر نماد اجتماع بر اساس `id` + tombstone؛ برخورد id با محتوای متفاوت (هم‌میلی‌ثانیه، بسیار نادر): نسخه‌ی دستگاه id جدید می‌گیرد. |
| `scripts` | `Record<id, {id,name,src,updated,lang}>` (`pineui.ts:23,31`) | اجتماع بر اساس `id`؛ اگر هر دو طرف ویرایش شده باشند: `updated` دیرتر برنده است و بازنده به‌صورت `<name> (this device, <date>)` ذخیره می‌شود تا هیچ متن منبعی حذف نشود. |
| `indTemplates`، `chartTemplates`، `drawTemplates`، `drawDefaults` | `Record<name, …>` | اجتماع بر اساس نام؛ تعارض: حساب برنده است و نسخه‌ی دستگاه به `name (this device)` تغییر نام می‌دهد (`drawDefaults` یک شیء واحد است -> قاعده‌ی اسکالر). |
| `watch`، `favTfs`، `customTfs`، `favTools`، `recentSymbols` | آرایه‌های رشته‌ای | اجتماع مجموعه‌ی مرتب (ترتیب حساب، سپس موارد فقط‌دستگاه)؛ `recentSymbols` حداکثر 12 مورد، جدیدترین اول بر اساس ترتیب ادغام‌شده. `watch` به tombstoneها احترام می‌گذارد (نمادِ حذف‌شده باید حذف‌شده بماند). |
| `watchFlags`، `watchCols`، `watchDetail` | رکوردهای کوچک | LWW به‌ازای هر فیلد. |
| `watchLists` | `Record<listId, {name, color, icon?, ord, syms: string[], flags: Record<sym, hex>}>` (`src/watchlists.ts`) | اجتماع بر اساس id پایدار فهرست با tombstone (فهرست حذف‌شده حذف‌شده می‌ماند مگر بعداً ویرایش شود)؛ به‌ازای هر فهرست `syms` = اجتماع مجموعه‌ی مرتب با tombstone (نمادی که روی یک دستگاه حذف شده حذف‌شده می‌ماند؛ ردیف‌های `###Section` هم ورودی هستند)، `flags` = LWW به‌ازای هر نماد، `name/color/icon/ord` = LWW به‌ازای هر فیلد. `watch`/`watchFlags` قدیمی به فهرستی با id برابر `default` تبدیل می‌شوند (`migrate`، در حافظه هنگام راه‌اندازی و در `mergeAll` برای طرفی که هنوز مهاجرت نکرده، تا دو دستگاه ادغام شوند و یک فهرست جایگزین دیگری نشود)؛ کلیدهای قدیمی دست‌نخورده می‌مانند. محلی دستگاه (همگام نمی‌شود): `watchActive` (فهرست فعال) و `watchView` (نمای ترکیبی). محدودیت‌ها: 50 فهرست، 500 نماد در هر فهرست، 1.5 MB برای کلید (کمتر از `stateKeyMb` = 2). |
| `alerts` | `chart.ts:35 Alert {id:number, sym, price, dir, on, drawingId?}` (هشدارهای قیمت؛ هشدارهای موتور در جدول‌های `/api/alerts` خودِ سرور هستند، **نه** در state) | اجتماع بر اساس `id`؛ idهای عددی شمارنده‌ی هر دستگاه‌اند، پس در برخورد، هشدار دستگاه id جدید می‌گیرد و `drawingId` آن بازنویسی می‌شود. |
| `acct` (حساب کاغذی) | `{cash, pos, orders, fills, nextId}` (`trading.ts:17`) و برای forward testها توسط سرور هم نوشته می‌شود (`HOT_KEYS`، `sync.ts:39`) | **هرگز ادغام نمی‌شود** (cash/موقعیت‌ها یک دفتر جاری‌اند). دیالوگ می‌پرسد کدام را نگه دارد؛ پیش‌فرض = طرفی که جدیدترین fill را دارد. دیگری در restore point می‌ماند و قابل export است. |
| `settings`، `journalCfg`، `riskCfg`، `calCfg`، `jwCfg`، `mktScr`، `mktTab`، `mktNewsMine`، `mktDex`، `liqMin`، `nocode`، `favBar`، `skillInputs`، `skillCur`، `tsWfa`، `tsPort`، `tsOpt`، `tsMc`، `tsRange`، `tsFwd`، `mqlSwap`، `aiModel`، `aiLang`، `alertChannels` | اشیاء تخت/اسکالرها (ترجیحات) | LWW به‌ازای هر فیلد با sidecar زمان‌مهر فیلدها (4.3)؛ بدون زمان‌مهر: حساب برنده است و فیلدهای غایب در حساب از دستگاه پر می‌شوند. |

**تغییرات پیشنهادی در آنچه همگام می‌شود** (افزودن به `LOCAL_KEYS`، `sync.ts:41`): `aiUrl` (URLی که می‌تواند اعتبارنامه را در خود جا دهد یا آدرس LAN باشد)، `brokerActive` (به idهای بروکری اشاره دارد که فقط روی یک دستگاه/سرور خصوصی وجود دارند). هرگز همگام نمی‌شوند، به‌عمد: `ctsrv` (سرورهای ذخیره‌شده + **توکن‌های Bearer**، `servers.ts:14`)، verifier مربوط به OAuth یعنی `ctoauth`، توکن‌های دستگاه، کوکی‌های نشست، کلیدهای API صرافی (`CT_MODE=public` از نگه‌داشتنشان امتناع می‌کند، `mode.ts:172-185`)، endpointهای push، توکن‌های Apple/Google. تذکری که باید مستند شود: `alerts[].webhook.url` (شیءهای هشدار در API هشدارهای *سرور* و هر نسخه‌ی آن در state) می‌تواند توکن‌های webhook محرمانه داشته باشد؛ آن‌ها فقط داخل حساب خود کاربر همگام می‌شوند.

### 4.2 تطبیق چه زمانی اجرا می‌شود (جایگزین `boot.ts:65-67`)
دو نشانگر localStorage غیر از `ct.*` (هرگز همگام نمی‌شوند): `ctown = {server, userId, at}` («داده‌ی `ct.*` این مرورگر با آن حساب هم‌گام است»، پس از هر `hydrate` موفق نوشته می‌شود) و `ctsrv` موجود.

```
after login, before hydrate/startSync:
  state = GET /api/state ; local = localSnapshot() ; own = ctown
  deviceEmpty  = every local key absent or equal to its default
  if deviceEmpty:                      hydrate(state)                            # fresh device: silent
  elif own == {server,user.id}:        hydrate(state)                            # already matched: today's behaviour
  elif accountEmpty:                   dialog(upload) -> Merge == upload         # today's offerUpload, now with restore point
  elif own && own.userId != user.id:   foreign-data dialog: "This browser holds data from another account"
                                        [Discard it] [Merge it into this account] [Keep a backup file]  (default Discard)
  else:                                match dialog (4.4)
```
چون `hydrate` مخرب است، هرگز روی شاخه‌های «else» پیش از انتخاب کاربر اجرا نمی‌شود. هنگام خروج روی سرور عمومی، پس از موفقیت `flushNow()` کلاینت کلیدهای `ct.*` همگام‌شده و `ctown` را پاک می‌کند (داده روی سرور است)، که نشت مرورگر مشترک در یافته‌ی 5 را هم برطرف می‌کند؛ اگر flush شکست بخورد، از کاربر خواسته می‌شود ابتدا پشتیبان را دانلود کند (`boot.ts:21`).

### 4.3 موتور ادغام (`src/merge.ts`، خالص، قابل تست در node مثل `sync.test.ts`)
* یک **رجیستری schema** هر کلید را به یک راهبرد نگاشت می‌کند: `set` (آرایه‌ی رشته‌ای)، `byId(idOf)`، `byName`، `recordOfArrays(idOf)` (drawings)، `fields` (شیء تخت)، `doc` (اتمی)، `ledger` (هرگز ادغام نشود، بپرس).
* `merge(key, account, device, meta) -> {value, notes[]}` **قطعی، خودتوان (idempotent) و متقارن است به‌جز قاعده‌ی تساوی ذکرشده (حساب برنده است)**، پس اجراهای مکرر و اجراها روی دو دستگاه همگرا می‌شوند. هیچ شاخه‌ای idای را که tombstone نشده دور نمی‌اندازد.
* **فراداده‌ی sidecar** (یک کلید state همگام‌شده به نام `syncmeta`، حدود ده‌ها KB، توسط `store.set` از طریق یک hook کوچک diff حدود 80 خطی در `store.ts` نوشته می‌شود): `{ items: {key: {id: {u: updatedMs, d?: deletedMs}}}, fields: {key: {field: ms}} }`. `u` هنگام افزودن/ویرایش یک مورد تنظیم می‌شود و `d` یک **tombstone** است که هنگام حذف یک مورد نوشته می‌شود (`delete st.layouts[n]`، `main.ts:781`، حذف drawing، حذف معامله، حذف script ...). tombstoneها 90 روز نگه داشته می‌شوند و حداکثر 5,000 ورودی (قدیمی‌ترین‌ها اول حذف می‌شوند). قاعده: مورد در طرف A هست و در طرف B tombstone دارد -> اگر `d > u` حذف‌شده می‌ماند، وگرنه (بعد از حذف ویرایش شده) زنده می‌شود. موارد بدون stamp ثبت‌شده `u = 0` حساب می‌شوند (tombstone بر آن‌ها غلبه می‌کند؛ تاریخچه‌ی ناشناخته هرگز بر یک حذف صریح غلبه نمی‌کند و هرگز خودش چیزی را حذف نمی‌کند).
* بدون هیچ فراداده‌ای (اولین تطبیق، دستگاه‌هایی که پیش از این قابلیت بوده‌اند): هیچ حذفی استنباط نمی‌شود؛ نتیجه = اجتماع؛ اسکالرها: حساب برنده است، جاهای خالی پر می‌شوند. اطلاعات فقط افزوده می‌شود.

### 4.4 دیالوگ تطبیق (`src/matchui.ts` جدید، حدود 200 خط، از `dialog()` در `login.ts:76` استفاده می‌کند)
```
Match this device with your account
                          This device     Your account
  Journal trades              14              212
  Watchlist symbols            9               23
  Layouts                      3                7
  Scripts                      2                5
  Drawings                    41              120
  Templates                    4                1
  Paper account (cash)    $9,420          $10,000     <- single choice, see below
  (Merged result would have: 221 trades, 27 symbols, 10 layouts, 7 scripts, ...)

  ( Merge (recommended) )   [ Use account data ]   [ Use this device's data ]
  [ Download a backup of this device first ]
  Paper account:  (o) keep account's   ( ) keep this device's
```
* **Merge**: کلاینت `merge()` را برای هر کلید اجرا می‌کند، یک restore point می‌گیرد، همه‌چیز را در یک تراکنش می‌نویسد (4.5)، `ctown` را می‌نویسد، hydrate می‌کند و همگام‌سازی را شروع می‌کند.
* **Use account**: restore point (سمت دستگاه)، سپس `hydrate(state)` مثل امروز؛ داده‌ی فقط‌دستگاه فقط در restore point می‌ماند.
* **Use this device**: تأیید صریح دوم («این N مورد را در حساب شما جایگزین می‌کند»)، restore point (سمت حساب)، سپس PUT برای هر کلید دستگاه (`baseRev` از ردیف‌های حساب)، حذف کلیدهای حسابی که دستگاه ندارد.
* **Restore pointها** («undo برای 30 روز»): جدول جدید به‌ازای هر کاربر `restore(id, at, label, json)` که با `userMigration` ساخته می‌شود (الگوی `state.ts:202`)، مسیرهای `POST /api/restore`، `GET /api/restore` (فهرست، بدون بدنه)، `GET /api/restore/:id`، `DELETE /api/restore/:id`، `POST /api/restore/:id/apply`. دو ردیف به‌ازای هر تطبیق (`account-before`، `device-before`)، با interval پس از 30 روز پاک می‌شوند، حداکثر 5 ردیف و سهمیه‌ی جدید `restoreMb` (پیش‌فرض 30، الگوی `quota.ts:9`؛ در `dbMb` حساب می‌شود). رابط: منوی حساب -> «Restore points…» (منوی `login.ts:102`) -> «Restore» همان جریان را معکوس اجرا می‌کند و یک restore point از وضعیت فعلی می‌سازد، پس خودِ undo هم undo‌پذیر است. بلافاصله پس از ادغام یک toast با «Merged. Undo» نشان داده می‌شود.
* چندتبی: کل تطبیق زیر `navigator.locks.request('ct-match')` اجرا می‌شود؛ تب‌های دیگر منتظر می‌مانند و بعد `ctown` را تنظیم‌شده می‌بینند.

### 4.5 نوشتن اتمی و سازوکار موجود If-Match
امروز هر کلید جداگانه PUT می‌شود (`sync.ts:95`، `state.ts:269`)، پس شکست در میانه حسابِ نیمه‌ادغام‌شده می‌گذارد. مسیر `POST /api/state/batch {writes:[{key, value|null, baseRev}]}` را به `state.ts` اضافه کنید (حدود 50 خط): `BEGIN IMMEDIATE`، اعمال هر نوشتن با همان بررسی rev در `stateSet` (`state.ts:229-232`)، بررسی سهمیه روی مجموع نهایی، `COMMIT`، سپس یک broadcast به‌ازای هر کلید. هر `409` کل batch را لغو می‌کند و `{key, rev, value}` فعلیِ هر کلید متعارض را برمی‌گرداند. کلاینت آن‌گاه **آن کلیدها را دوباره با مقادیر تازه‌ی سرور ادغام می‌کند (ادغام خودتوان است) و حداکثر 3 بار دوباره تلاش می‌کند**، وگرنه «حساب شما هنگام ادغام روی دستگاه دیگری تغییر کرد؛ دوباره تلاش کنید» را نشان می‌دهد و چیزی نوشته نشده است. `413`/سهمیه: چیزی نوشته نمی‌شود، دیالوگ توضیح می‌دهد کدام کلید بزرگ است (مثلاً ژورنال ادغام‌شده > 8 MB) و «ادغام همه‌چیز به‌جز ژورنال» را پیشنهاد می‌کند.
پیگیری (برای v1 لازم نیست، فقط به‌خاطر tombstoneها امن است): `sync.ts conflict()` (`:116`) امروز در 409 ویرایش محلی را دور می‌اندازد و نسخه‌ی سرور را نگه می‌دارد؛ می‌تواند به‌جای آن از `merge()` استفاده کند تا ویرایش‌های هم‌زمان روی دو دستگاه ترکیب شوند نه اینکه یکی دور ریخته شود.

### 4.6 عمداً همگام نمی‌شود
رازها و چیزهای وابسته به دستگاه (فهرست در 4.1)، وضعیت رابط `LOCAL_KEYS`، بایت‌های blob رسانه (از طریق `/api/media` همگام می‌شوند و با id ارجاع داده می‌شوند)، وضعیت موتور هشدار سمت سرور، اشتراک‌های push (`releasePushOnServer`، `login.ts:125`)، کلیدهای API هر صرافی. ادغام هرگز `ctsrv` را نمی‌خواند یا نمی‌نویسد.

## 5. عملیات

### 5.1 متغیرهای محیطی (در `core/mode.ts` خوانده می‌شوند، کنار `REGISTRATION`، `mode.ts:134`)
| متغیر | معنی |
|---|---|
| `CT_GOOGLE_CLIENT_ID`، `CT_GOOGLE_CLIENT_SECRET` | کلاینت OAuth گوگل از نوع «Web application». هر دو یا هیچ‌کدام. |
| `CT_APPLE_SERVICE_ID` | Services ID اپل (مثلاً `com.example.chartterminal.web`)؛ همان `client_id`/`aud` در OAuth است. |
| `CT_APPLE_TEAM_ID`، `CT_APPLE_KEY_ID` | Team ID ده‌نویسه‌ای؛ Key ID کلید Sign in with Apple. |
| `CT_APPLE_PRIVATE_KEY_FILE` | مسیر فایل دانلودشده‌ی `AuthKey_<KEYID>.p8` (بیرون از `CT_DATA_DIR`، با دسترسی 0400، در Docker فقط‌خواندنی mount می‌شود). |
| (موجود) `CT_PUBLIC_URL`، `CT_REGISTRATION`، `CT_CORS_ORIGINS`، `CT_ALLOWED_HOSTS` | پایه‌ی redirect، سیاست ثبت‌نام، origin برنامه‌ی دارای asset همراه، محافظ میزبان. |

redirect URIهایی که باید دقیقاً ثبت شوند: `${CT_PUBLIC_URL}/api/auth/oauth/callback/google` و `${CT_PUBLIC_URL}/api/auth/oauth/callback/apple`.
یک ارائه‌دهنده فقط وقتی **فعال** است که همه‌ی متغیرهایش تنظیم شده باشند و (اپل) فایل کلید قابل تجزیه باشد؛ ارائه‌دهنده‌ی **نیمه**‌تنظیم‌شده سرور را هنگام راه‌اندازی با پیامی که نام متغیر غایب را می‌آورد متوقف می‌کند (اشتباه تایپی را می‌گیرد)؛ هیچ‌چیز تنظیم‌نشده = بی‌صدا غیرفعال. پرچم‌های فعال در `/api/auth/status` به‌صورت `oauth:{google,apple}` می‌آیند؛ `parseStatus` (`servers.ts:59`) آن‌ها را نگاشت می‌کند (پیش‌فرض `false`، پس سرورهای خصوصی و سرورهای قدیمی دکمه‌ای نشان نمی‌دهند)؛ `accountscreens.ts` فقط وقتی پرچمش true باشد دکمه را رندر می‌کند؛ `/start` و callbackها برای ارائه‌دهنده‌ی غیرفعال 404 می‌دهند. پروکسی معکوس: `/api/auth/oauth/callback/*` را به قاعده‌ی «query string را لاگ نکن» اضافه کنید (فیلتر `log` در Caddy / قالب `access_log` در nginx بدون `$args`) چون callback گوگل `code` و `state` را در query دارد (هر دو یک‌بارمصرف، 10 دقیقه / وابسته به ارائه‌دهنده، اما دلیلی برای نگه‌داشتنشان نیست).

### 5.2 چک‌لیست دستی برای مالک (فارسی)

**الف) Google Cloud Console (قدم اول، کافی و بدون هزینه)**
1. با VPN وارد `console.cloud.google.com` شوید (از ایران بدون VPN باز نمی‌شود؛ خودِ سرور باید روی VPS خارج از ایران باشد تا به `oauth2.googleapis.com` برسد).
2. یک Project جدید بسازید، مثلاً `chart-terminal`.
3. APIs & Services -> OAuth consent screen: نوع کاربر **External**، نام برنامه، ایمیل پشتیبانی، آدرس صفحه‌ی اصلی (همان `CT_PUBLIC_URL`) و آدرس سیاست حریم خصوصی (یک صفحه‌ی ساده روی همان دامنه)، دامنه‌ی سرور را در Authorized domains بنویسید.
4. Scopes: فقط `openid` و `email` (غیرحساس‌اند؛ نیازی به بررسی امنیتی گوگل نیست).
5. Publishing status را روی **In production** بگذارید. اگر روی Testing بماند فقط ۱۰۰ کاربر آزمایشی می‌توانند وارد شوند. (گوگل ممکن است برای برندینگ تأیید ساده بخواهد.)
6. Credentials -> Create credentials -> OAuth client ID -> Application type: **Web application**.
7. در Authorized redirect URIs دقیقاً بنویسید: `https://دامنه‌ی-شما/api/auth/oauth/callback/google` (بدون اسلش آخر). بخش Authorized JavaScript origins را خالی بگذارید.
8. Client ID و Client secret را کپی کنید و در محیط سرور بگذارید: `CT_GOOGLE_CLIENT_ID` و `CT_GOOGLE_CLIENT_SECRET`. سرور را ری‌استارت کنید؛ دکمه‌ی Google باید در صفحه‌ی ورود ظاهر شود.
9. برای تست محلی می‌توانید یک کلاینت جدا با redirect `http://localhost:PORT/api/auth/oauth/callback/google` بسازید (گوگل localhost با http را مجاز می‌داند).

**ب) Apple Developer (قدم دوم؛ ممکن است از ایران عملی نباشد)**
*صادقانه:* Sign in with Apple به عضویت **Apple Developer Program (حدود ۹۹ دلار در سال)**، یک دامنه‌ی واقعی با HTTPS (نه IP و نه localhost) و تأیید دامنه نیاز دارد. به‌دلیل تحریم‌ها، ثبت‌نام و پرداخت از ایران معمولاً ممکن نیست مگر با حساب و پرداخت قانونی خارج از ایران. اگر این شرایط را ندارید، **فقط Google را پیاده‌سازی و منتشر کنید؛ این یک milestone کاملاً معتبر است** و کد Apple بدون تنظیمات غیرفعال و دکمه‌اش پنهان می‌ماند.
1. عضویت Apple Developer Program را فعال کنید (developer.apple.com).
2. Certificates, Identifiers & Profiles -> Identifiers -> یک **App ID** بسازید و قابلیت *Sign in with Apple* را روشن کنید.
3. یک **Services ID** بسازید (مثل `com.example.chartterminal.web`)؛ این همان `CT_APPLE_SERVICE_ID` است. Sign in with Apple را روشن و Configure را بزنید: Primary App ID را انتخاب کنید، **Domains** = دامنه‌ی سرور، **Return URLs** = `https://دامنه‌ی-شما/api/auth/oauth/callback/apple`.
4. فایل تأیید دامنه (`apple-developer-domain-association.txt`) را که Apple می‌دهد در `public/.well-known/` بگذارید تا از `https://دامنه/.well-known/apple-developer-domain-association.txt` در دسترس باشد (به `MIME` در `http.ts` پسوند `.txt` را اضافه کنید)، سپس Verify بزنید.
5. Keys -> New key -> *Sign in with Apple* را تیک بزنید، Primary App ID را انتخاب کنید و فایل `.p8` را **فقط یک بار** دانلود کنید. Key ID همان `CT_APPLE_KEY_ID` است.
6. Team ID (۱۰ نویسه) را از صفحه‌ی Membership بردارید: `CT_APPLE_TEAM_ID`.
7. فایل `.p8` را روی سرور (خارج از پوشه‌ی داده، با دسترسی فقط‌خواندنی برای کاربر سرویس) بگذارید و مسیرش را در `CT_APPLE_PRIVATE_KEY_FILE` بنویسید.
8. ری‌استارت و تست؛ ایمیل واقعی کاربر ممکن است مخفی (`privaterelay`) باشد و نام فقط بار اول می‌آید که ما به آن وابسته نیستیم.

**ج) تنظیمات سرور:** `CT_REGISTRATION=invite` (یا `open`) تعیین می‌کند چه کسی می‌تواند با Google حساب **جدید** بسازد؛ در حالت invite کاربر بعد از ورود با Google، «نام کاربری» و «کد دعوت» را وارد می‌کند. لاگ پروکسی را طوری تنظیم کنید که query آدرس `/api/auth/oauth/callback/*` ثبت نشود.

## 6. امنیت

* **CSRF روی callback / login-CSRF**: `state` یک‌بارمصرف نگه‌داشته‌شده در سرور + اتصال PKCE لایه‌ی 2 (1.3)؛ معافیت POST اپل در `http.ts` دقیقاً یک مسیر را پوشش می‌دهد.
* **Open redirect**: هیچ URLی از درخواست پذیرفته نمی‌شود؛ `ret` یک کلید است؛ `port` یک عدد صحیح اعتبارسنجی‌شده است؛ `redirect_uri` ارائه‌دهنده از `CT_PUBLIC_URL` محاسبه می‌شود (1.4).
* **Replay**: `state` با `DELETE … RETURNING` مصرف می‌شود؛ کد 60 ثانیه، یک‌بارمصرف، فقط hash در حالت ذخیره؛ `nonce` + `exp` توکن ID؛ ticket یک‌بارمصرف.
* **نشت توکن**: کد در fragment آدرس (web/app) پس در `Referer` نیست (به‌علاوه `referrer-policy: no-referrer`، `SECURITY_HEADERS` در `http.ts`) و در لاگ‌های دسترسی نیست؛ `replaceState` آن را پاک می‌کند؛ سرور هرگز query string را لاگ نمی‌کند (`http.ts:202` فقط path را لاگ می‌کند)؛ هیچ توکن ارائه‌دهنده‌ای ذخیره یا لاگ نمی‌شود؛ `console.error` شکست‌ها فقط کدهای دلیل ثابت را چاپ می‌کند.
* **محدودسازی نرخ**: `/start` حداکثر 20 بار در 10 دقیقه به‌ازای هر IP (`allow`، `users.ts:154`)؛ callbackها 30 بار در 10 دقیقه به‌ازای هر IP و سقف سراسری 8 درخواست هم‌زمان توکن؛ سطل‌های عمومی ناشناس در `http.ts:~135` (سطل `auth:` با 1 در ثانیه) از قبل اعمال می‌شوند؛ تلاش‌های بد در `/exchange` از بودجه‌ی شکست به‌ازای هر IP کم می‌شوند (10 بار در 10 دقیقه) با همان متن 429 ورود.
* **Enumeration**: شکست‌های callback یک `#error=failed` یکنواخت هستند؛ `/exchange` برای کد ناشناخته/منقضی/استفاده‌شده و verifier غلط یک خطا برمی‌گرداند؛ مسیر رمز همسان‌سازی زمان‌بندی را نگه می‌دارد (یافته‌ی 3)؛ signup فقط «این نام کاربری گرفته شده است» می‌گوید مثل `register`. کاربری که *وارد شده* ممکن است بفهمد یک حساب Google جای دیگری پیوند خورده است (حساب خودش را دارد پیوند می‌دهد).
* **Session fixation**: همیشه `issue()` -> `start()` نشست ارائه‌شده را پایان می‌دهد و توکن تازه تنظیم می‌کند (`authroutes.ts:84-88`)؛ کلاینت Bearer هرگز کوکی نمی‌گیرد.
* **ربایش تبادل کد در اندروید**: کد بسته به challenge در PKCE + یک‌بارمصرف + 60 ثانیه؛ verifier فقط در WebView؛ قالب کد پیش از تزریق JS اعتبارسنجی می‌شود؛ مورد اضافه‌ی اختیاری: اتصال به برچسب دستگاه (`device` در `/start` ثبت می‌شود و در `/exchange` باید مطابقت کند).
* **تله‌های JWT**: فقط RS256، جست‌وجو با `kid`، هیچ `jku`/`x5u`/`jwk` تعبیه‌شده‌ای پذیرفته نمی‌شود، نوع کلید ثابت است، `aud` دقیق، مقایسه‌ها در زمان ثابت، اندازه‌ها محدود، میزبان‌های JWKS ثابت.

**10 ریسک برتر و راه‌حل‌ها**
1. تصاحب حساب از طریق پیوند خودکار با ایمیل -> هرگز با ایمیل پیوند یا جست‌وجو نمی‌کنیم؛ پیوند فقط از نشست واردشده با step-up.
2. Login CSRF / session riding -> state + اتصال PKCE کلاینت؛ نشست تازه در هر ورود.
3. جعل توکن ID (alg none/HS256، `aud`/`iss`/`nonce` غلط) -> verifier سخت‌گیر، تست‌های منفی با ارائه‌دهنده‌ی mock (7).
4. ربایش custom-scheme در اندروید -> کد 60 ثانیه‌ای یک‌بارمصرف بسته به PKCE؛ توکن هرگز در URL نیست.
5. Open redirect / SSRF -> هیچ URLی از درخواست نمی‌آید؛ endpointها و میزبان‌های JWKS ثابت‌اند؛ `redirect: 'error'`.
6. از دست رفتن بی‌صدای داده هنگام ورود (یافته‌ی 4) و نشت داده‌ی بین کاربران روی مرورگر مشترک (یافته‌ی 5) -> دیالوگ تطبیق، نشانگر مالک، پاک‌سازی هنگام خروج، restore pointهای 30 روزه.
7. قفل شدن کاربران فقط‌OAuth -> کدهای بازیابی، آخرین روش را نمی‌شود لغو کرد، رمز را می‌شود بعداً تعیین کرد.
8. سوءاستفاده از signup از طریق OAuth (دور زدن دعوت‌ها) -> مرحله‌ی signup `CT_REGISTRATION` و دعوت را به‌صورت اتمی اعمال می‌کند؛ محدودیت‌های به‌ازای IP و روزانه.
9. افشای راز ارائه‌دهنده (`CT_GOOGLE_CLIENT_SECRET`، `.p8` اپل) -> فقط env/فایل، 0400، بیرون از پوشه‌ی داده، هرگز لاگ یا برگردانده نمی‌شود؛ `assertPublicSafe` گسترش می‌یابد تا `.p8` داخل `CT_DATA_DIR` را رد کند.
10. دسترس‌پذیری: قطعی ارائه‌دهنده یا مسدود بودن از شبکه‌ی کاربر -> ورود با رمز همیشه می‌ماند؛ کش کهنه‌ی JWKS؛ دسترس‌ناپذیر بودن Google/Apple از سرور -> پیام روشن «بعداً تلاش کنید» و دکمه برای دیگری قابل استفاده می‌ماند.

## 7. تست بدون ارائه‌دهنده‌ی واقعی

* `server/oidcmock.ts` (حدود 150 خط، فقط برای تست): یک `node:http` روی `127.0.0.1:0` با جفت‌کلید RSA خودش (`generateKeyPairSync`)، `GET /jwks` (JWK را با یک `kid` export می‌کند)، `POST /token` (`grant_type`، `redirect_uri`، `code_verifier` (حالت گوگل) یا **JWT client secret اپل** را بررسی می‌کند: امضای ES256 آن را با کلید عمومی تست و `iss/sub/aud/kid` را راستی‌آزمایی می‌کند؛ یک `id_token` امضاشده برمی‌گرداند که از یک «مجوز در انتظار» که تست ثبت کرده ساخته شده)، به‌علاوه‌ی کلیدهایی برای خراب کردن یک claim.
* جدول ارائه‌دهنده‌ها در `server/oauth.ts` به‌صورت پیش‌فرض ثابت‌ است؛ یک setter فقط‌تست به نام `_setProvidersForTest()` URLهای mock را جایگزین می‌کند و فقط وقتی کار می‌کند که `process.env.CT_NO_AUTOSTART === '1'` باشد (همان کلیدی که `publictest.ts` تنظیم می‌کند)، پس نمی‌شود محیط production را با یک متغیر env به جای دیگری اشاره داد.
* `server/oauth.test.ts` (از `boot()`/`client()` در `publictest.ts` استفاده می‌کند): تست `/start` را صدا می‌زند، `state`/`nonce` را از URL برگشتی تجزیه می‌کند، به mock می‌گوید «کاربر X، sub برابر S مجاز شد»، سپس خودش callback را اجرا می‌کند (گوگل با `GET`، اپل با `POST` و `Content-Type: application/x-www-form-urlencoded` و `Origin: https://appleid.apple.com`، از جمله فیلد `user` که باید نادیده گرفته شود).
* موارد: ورود موفق (کوکی و توکن `device`)؛ signup در حالت‌های `invite` / `open` / `closed`؛ link / رد link هویتی که مال حساب دیگری است / unlink / رد آخرین روش؛ زمان‌بندی ورود با رمز برای کاربر فقط‌OAuth برابر کاربر ناشناخته است (ترفند `stats.hashes`، `users.ts:33`)؛ عدم تطابق `nonce`؛ `aud` غلط؛ `iss` غلط؛ منقضی؛ `alg: none`؛ HS256 امضاشده با کلید عمومی به‌عنوان secret؛ امضا با کلید دیگر؛ `kid` ناشناخته دقیقاً یک دریافت مجدد را فعال می‌کند و سپس رد می‌شود؛ `email_verified: false` / رشته‌ی `"true"`؛ بازپخش `state`؛ `state` منقضی؛ بازپخش `code`؛ `verifier` غلط؛ کد از start کلاینت دیگر؛ `ret`/`port` غیرمجاز؛ callback اپل بدون مسیر معاف از CSRF هنوز روی مسیرهای دیگر مسدود است؛ ارائه‌دهنده‌ی غیرفعال -> 404 و `status.oauth.apple === false`؛ لاگ ضبط‌شده شامل `code=`/`id_token` نیست.
* `server/isolation.test.ts`: مسیرهای جدید را به `CLASS` اضافه کنید (`AUTH` برای start/callbacks/exchange/signup، `U-list` برای مسیرهای identities و restore).
* کلاینت: `src/merge.test.ts` (تست‌های property: خودتوان، همگرا با جابه‌جایی طرفین، هیچ id‌ای گم نمی‌شود مگر tombstone باشد، tombstone در برابر ویرایش بعدی، `acct` هرگز ادغام نمی‌شود، ژورنال هم‌اندازه‌ی سهمیه)، `src/oauth.test.ts` (جفت PKCE، تجزیه‌ی fragment، انقضا)، گسترش `sync.test.ts` برای محافظ جدید `hydrate`. اندروید: چک‌لیست دستی به‌علاوه‌ی یک بررسی خالص جاوا برای regex کد.

## 8. برنامه‌ی مرحله‌ای

| مرحله | فایل‌ها (خط تقریبی) | وقتی تمام است که |
|---|---|---|
| **1. OIDC سرور + هویت‌ها** (اول Google) | `server/core/oidc.ts` جدید (~180)؛ `server/oauth.ts` جدید (~320)؛ `users.ts` (+~90: مهاجرت‌های 3-5، `createOAuthUser`، کمک‌تابع‌های هویت، اصلاح dummy-verify، `listUsers`)؛ `authroutes.ts` (+~25: mount، `status.oauth`)؛ `http.ts` (+~8)؛ `mode.ts` (+~25)؛ `isolation.test.ts` (+~8)؛ `server/oidcmock.ts` (~150) + `oauth.test.ts` (~400) | ورود/signup/link/unlink گوگل در برابر mock پاس می‌شود؛ مسیر کد اپل هست ولی با env غیرفعال است. |
| **2. دکمه‌های کلاینت + رابط پیوند** | `src/oauth.ts` جدید (~150)؛ `servers.ts` (+~5 `oauth` در `parseStatus`/types)؛ `accountscreens.ts` (+~60: دکمه‌ها، صفحه‌ی نام کاربری/دعوت پس از `signup:true`)؛ `login.ts` (+~70: دیالوگ «روش‌های ورود…»، تعیین رمز)؛ `boot.ts` (+~20 `resumeOAuth`)؛ `public/oauth-return.html` (~30) | ورود وب و PWA سرتاسر کار می‌کند؛ وقتی ارائه‌دهنده خاموش است دکمه‌ها پنهان‌اند. |
| **3. موتور ادغام + دیالوگ تطبیق** (مستقل از OAuth، یافته‌ی 4 را درست می‌کند) | `src/merge.ts` جدید (~350) + `merge.test.ts` (~400)؛ `store.ts`/`sync.ts` (+~80 stamp زدن sidecar، tombstoneها، `LOCAL_KEYS`)؛ `server/state.ts` (+~50 batch)؛ `server/restore.ts` جدید (~120) + `quota.ts` (+2)؛ `src/matchui.ts` جدید (~200)؛ `boot.ts` (بازنویسی `:65-67`، نشانگر مالک، پاک‌سازی هنگام خروج) | ورودی که هر دو طرف داده دارند دیالوگ را نشان می‌دهد؛ چیزی گم نمی‌شود؛ بازیابی کار می‌کند؛ تست‌ها سبزند. |
| **4. Custom Tab اندروید (+ loopback در Electron)** | `AndroidManifest.xml` (+16)؛ `MainActivity.java` (+~70)؛ `android/app/build.gradle` (+1 اختیاری)؛ `desktop/main.cjs` (+~40) | ورود با گوگل روی گوشی از APK کامل می‌شود و به برنامه برمی‌گردد. |
| **5. Apple + مستندات** | فعال‌سازی/راستی‌آزمایی مسیر اپل (راز ES256 در `oidc.ts` از مرحله‌ی 1 هست ولی تا وقتی مالک اعتبارنامه‌ها را نداشته باشد فقط با mock قابل تست است)؛ `public/.well-known/` + MIME برای `.txt`؛ `docs/oauth.md` (فارسی، از 5.2)؛ به‌روزرسانی `docs/multi-server.md`، `multiuser-design.md` §2 و §7.4 جدول env | مستندات ادغام شده؛ اپل فقط اگر مالک بتواند ثبت‌نام کند. |

دلیل ترتیب: مرحله‌ی 3 می‌تواند پیش از 1-2 یا موازی با آن‌ها منتشر شود و باگ فعلیِ از دست رفتن داده را برای کاربران با رمز همین حالا برطرف می‌کند؛ مرحله‌ی 1 پرریسک‌ترین است و بیشترین تست را می‌گیرد؛ اندروید (4) به 1-2 وابسته است؛ اپل (5) آخر است چون شاید از ایران هرگز ممکن نشود.
