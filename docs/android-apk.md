# اپ اندروید (APK) برای Chart Terminal

دو نسخه (product flavor) داریم که کنار هم نصب می‌شوند (applicationId جدا) و خروجی‌شان نام جدا دارد:

| flavor | فایل خروجی | چه می‌کند |
|---|---|---|
| `client` | `app-client-release.apk` (حدود ۱۴ کیلوبایت) | کلاینت سبک: آدرس سرور را می‌گیرد (بخش‌های زیر) |
| `standalone` | `app-standalone-release.apk` (حدود ۸۸۰ کیلوبایت) | بدون هیچ سرور؛ `dist/` داخل APK است و همه‌چیز روی همین گوشی می‌ماند |

## نسخه‌ی standalone

- برنامه‌ی ساخته‌شده (`dist/`) در `assets/www` بسته‌بندی می‌شود و با `WebViewClient.shouldInterceptRequest` از آدرس امن `https://appassets.androidplatform.net` سرو می‌شود (مسیرهای ناموجود و `/api/*` پاسخ 404 می‌گیرند؛ `..` و `\` در مسیر رد می‌شود؛ نوع MIME از روی پسوند).
- برنامه در بوت `GET /api/auth/status` را می‌زند؛ 404 یعنی **حالت Standalone**: بدون صفحه‌ی ورود، چارت و داده‌ی زنده مستقیم از Binance (`data-api.binance.vision` و `wss://data-stream.binance.vision`)، اسکریپت‌های Pine/MQL/Ninja، معامله‌ی کاغذی، ژورنال، لایه‌ها، دیده‌بان، replay و استراتژی‌تستر همه داخل خود برنامه. نوار کوچک «Standalone · data stays on this device» پایین صفحه است.
- داده‌ها در `localStorage` و IndexedDB همین WebView ذخیره می‌شوند (با بستن برنامه پاک نمی‌شوند؛ با «پاک کردن داده‌ی برنامه» یا حذف برنامه پاک می‌شوند، `allowBackup` خاموش است). بخش‌هایی که سرور می‌خواهند (هشدار سروری، حساب بروکر، اسکرینر غیر Binance، خبر/تقویم، AI، forward test، ۲۵ مهارتی که از `/api` می‌خوانند) پنهان یا غیرفعال‌اند با پیام «Standalone mode: this needs a server».
- ناوبری فقط به مبدأ برنامه مجاز است؛ لینک‌های دیگر در مرورگر سیستم باز می‌شوند و درخواست به هر میزبانی جز مبدأ برنامه و دو میزبان Binance مسدود است. تنها مجوز برنامه `INTERNET` است. Back به صفحه‌ی قبل برمی‌گردد و در صفحه‌ی اول خارج می‌شود.
- برای استفاده از سرور خودتان نسخه‌ی `client` را نصب کنید (در این نسخه دکمه‌ی «Connect to a server» فقط همین را توضیح می‌دهد).
- محدودیت‌ها: بدون مجوز میکروفون ضبط صدای ژورنال کار نمی‌کند؛ دانلود فایل (Export، پشتیبان) در WebView پشتیبانی نمی‌شود؛ انتخاب فایل (Import) کار می‌کند. روی شبیه‌ساز یا گوشی واقعی تست نشده است.

### ساخت standalone

```
npm run build:android-standalone           # release امضاشده  (npm run build:android-standalone debug برای debug)
# یا دستی: npm run build ، سپس در پوشه‌ی android:
gradlew.bat assembleStandaloneRelease      # app/build/outputs/apk/standalone/release/app-standalone-release.apk
```

تسک Gradle با نام `syncStandaloneAssets` پوشه‌ی `dist/` را پیش از merge assets به `android/app/src/standalone/assets/www` کپی می‌کند (در git نیست). اگر `dist/` نبود ساخت با پیام روشن متوقف می‌شود. هر بار کد وب عوض شد، دوباره `npm run build` لازم است (اسکریپت بالا این را هم می‌زند).

## نسخه‌ی client

این APK یک «کلاینت سبک» است: سرور روی گوشی اجرا **نمی‌شود**. اپ فقط آدرس سرور شما را می‌گیرد و رابط Chart Terminal را تمام‌صفحه در یک WebView نشان می‌دهد.

**چرا WebView ساده و نه Capacitor؟** فقط یک صفحه‌ی وب را باز می‌کنیم، پس Capacitor (به‌همراه Node و پلاگین‌ها) وزن اضافه دارد؛ یک Activity جاوا بدون AndroidX، APK را زیر چند صد کیلوبایت نگه می‌دارد و کنترل کامل روی TLS و HTTP می‌دهد.

## اجرای اول

1. اپ را باز کنید و آدرس سرور را بنویسید، مثلاً `https://192.168.1.20:8443` یا `http://192.168.1.20:8787`.
2. اپ آدرس `/api/auth/status` را می‌خواند. اگر پاسخ معتبر بود، آدرس ذخیره و رابط باز می‌شود.
3. دفعه‌های بعد مستقیم رابط باز می‌شود.

## منو و تغییر سرور

- دکمه‌ی **Back** تا وقتی صفحه‌ای برای برگشتن باشد، عقب می‌رود؛ در صفحه‌ی اول منو را باز می‌کند.
- یا گوشه‌ی بالا-راست صفحه را **نگه دارید** (long-press).
- منو: Reload، Change server، Keep screen on (پیش‌فرض خاموش)، Exit.

## HTTP و HTTPS (امنیت)

- **HTTP ساده** فقط برای آدرس‌های شبکه‌ی خانگی مجاز است: `10/8`، `172.16/12`، `192.168/16` و `localhost`. اپ هم هنگام وارد کردن آدرس و هم برای هر درخواست داخل WebView این را بررسی می‌کند؛ هر `http://` به آدرس عمومی مسدود می‌شود. (قابلیت `network-security-config` اندروید بازه‌ی IP را نمی‌شناسد، به همین دلیل بررسی داخل کد انجام می‌شود.)
- **WebSocket**: `ws://` هم فقط به همین آدرس‌های خصوصی مجاز است؛ یک محافظ جاوااسکریپت در هر صفحه `ws://` به میزبان عمومی را رد می‌کند (`wss://` آزاد است). این محافظ در `onPageStarted` تزریق می‌شود و تضمین مطلق در برابر صفحه‌ی مخرب نیست؛ سرور خودتان تنها مبدأ بارگذاری‌شده است.
- **HTTPS**: اعتبارسنجی گواهی هیچ‌جا خاموش نشده است. نسخه‌ی **release فقط CAهای سیستم** را قبول می‌کند و CA نصب‌شده‌ی کاربر را نه. پس برای release یا از `http://` روی LAN استفاده کنید، یا گواهی معتبر عمومی داشته باشید.
- **CA محلی (فقط نسخه‌ی debug)**: build از نوع debug به CAهای نصب‌شده‌ی کاربر اعتماد می‌کند (`debug-overrides`). فایل CA را طبق `docs/lan-setup.md` روی گوشی ببرید، از تنظیمات اندروید > امنیت > رمزگذاری و اعتبارنامه > **نصب گواهی > گواهی CA** نصبش کنید و `app-client-debug.apk` را به کار ببرید.
- ناوبری به مبدأ دیگر (scheme/host/port متفاوت) داخل WebView انجام نمی‌شود؛ فقط لینک‌های http(s) در مرورگر بیرونی باز می‌شوند.

## ساخت

پیش‌نیاز: JDK 17 و Android SDK (platform 35، build-tools 35.0.0). مسیر SDK را در `android/local.properties` بنویسید (`sdk.dir=C\:\\Users\\<نام>\\Android\\Sdk`).

```
cd android
gradlew.bat assembleClientDebug        # app/build/outputs/apk/client/debug/app-client-debug.apk
gradlew.bat assembleClientRelease      # app/build/outputs/apk/client/release/app-client-release.apk (امضاشده)
```

(`assembleDebug` / `assembleRelease` هر دو flavor را با هم می‌سازند.)

امضای release از `android/keystore.properties` و فایل `android/chartterminal.jks` خوانده می‌شود. هر دو در `.gitignore` هستند، **هرگز commit نکنید** و از آن‌ها نسخه‌ی پشتیبان امن نگه دارید (بدون آن‌ها نمی‌توانید نسخه‌ی به‌روز با همان امضا بسازید). برای ساخت keystore تازه:

```
keytool -genkeypair -v -keystore chartterminal.jks -alias chartterminal -keyalg RSA -keysize 2048 -validity 10000
```

## نصب روی گوشی

1. روی گوشی «نصب از منابع ناشناس» را برای مرورگر/مدیر فایل فعال کنید، فایل APK را منتقل و باز کنید؛ یا
2. با USB debugging: `adb install -r app-client-release.apk`

## محدودیت‌ها

- **Push notification پشتیبانی نمی‌شود.** برای اعلان باید PWA را روی HTTPS نصب کنید (Web Push)؛ APK در عوض بدون دردسر گواهی کار می‌کند.
- نسخه‌ی فعلی روی دستگاه واقعی یا شبیه‌ساز تست نشده است.
