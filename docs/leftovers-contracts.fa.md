[فارسی](leftovers-contracts.fa.md) · [English](leftovers-contracts.md)

# باقی‌مانده‌ها — قراردادها برای کار موازی

همه‌ی مواردی که ROADMAP در فاز‌های ۲ تا ۱۰ با عنوان «not yet»، «مانده» یا «محدودیت» فهرست کرده و به فاز‌های آینده (۶، ۷، ۹، ۱۱ تا ۱۳) تعلق ندارد.
هفت agent همزمان آن را می‌سازند و هرکدام روی شاخه‌ی (branch) خودش در worktree خودش کار می‌کند.
**این فایل تنها مرجع معتبر برای تعیین مالکیت است.** اگر به چیزی بیرون از فایل‌های خودتان نیاز دارید، کوچک‌ترین ویرایش ممکن را انجام دهید،
آن را محلی نگه دارید (چند خط، با علامت‌گذاری روشن) و در گزارش نهایی‌تان بنویسید.

## قواعد پایه (مثل فاز ۵)
- TypeScript که مستقیم با Node 25 اجرا می‌شود: **بدون parameter property، بدون enum، بدون namespace**، و برای نوع‌ها `import type`.
  از سبک موجود پیروی کنید: فشرده، با کامنت‌های کم که *چرا* را توضیح می‌دهند. اول کد اطرافتان را بخوانید و از helperهای موجود استفاده کنید.
- worktree شما `node_modules` ندارد: پیش از هر کار دیگر، `npm ci` را در ریشه‌ی مخزن **و** در `server/` اجرا کنید.
- تست‌ها: فایل‌های `node:test` کنار خود کد. کلاینت: `npm test` در ریشه (اگر تستتان در پوشه‌ی تازه‌ای است، glob آن را به اسکریپت `test` ریشه اضافه کنید).
  سرور: `cd server && npm test`.
- هر رشته‌ی HTML که از داده ساخته می‌شود باید داده را escape کند (`esc` در `src/store.ts`).
- هیچ وابستگی npm تازه‌ای اضافه نشود.
- Clean-room: از روی رفتار و مستندات بسازید، هرگز کد محصولات دیگر را کپی نکنید.
- پیش از پایان: `npx tsc --noEmit` (ریشه) و `npx tsc --noEmit -p server` بدون خطا باشند، همه‌ی تست‌ها بگذرند و روی شاخه‌ی خودتان با پیام روشن commit کنید.
- فایل `ROADMAP.md` را **ویرایش نکنید** (integrator این کار را می‌کند). گزارش نهایی شما: چه ساختید، فایل‌هایی که بیرون از حوزه‌ی خودتان دست زدید،
  چه چیزی را کنار گذاشتید و چرا، و چطور در برنامه امتحانش کنیم.
- فایل‌های داغ مشترک: `src/main.ts`، `src/chart.ts`، `index.html`، `src/style.css`. فقط agent **chart** مالک آن‌هاست؛
  بقیه حداکثر چند خط به آن‌ها اضافه می‌کنند (یک آیتم منو، یک دکمه، یک import، یک فراخوانی hook) و هرگز بازسازی (refactor) نمی‌کنند.

## agentها و حوزه‌ی کارشان
| Agent | مالک | می‌سازد |
|---|---|---|
| **pine** | `src/pine/**` | `request.security` (نماد/تایم‌فریم دیگر)، `table.*`، `type`/`enum`/`import` (UDTها، کتابخانه‌ها از اسکریپت‌های نصب‌شده)، `plotcandle`/`plotbar` کامل، `matrix.*`/`map.*` |
| **mqlnt** | `src/mql/**`، `src/ninja/**` | MQL: ‏`iCustom`، توابع فایل در sandbox، ‏`OnTrade`/`OnTradeTransaction`، ‏`goto`، سربارگذاری عملگر، swap، ‏iAD/iChaikin/iBWMFI/iGator. NinjaScript: ‏LINQ، رویدادها، سفارش‌های unmanaged، ‏`OnRender` (به‌صورت drawing)، قالب‌های سشن، تیک‌به‌تیک تا جایی که داده اجازه دهد |
| **tester** | `src/tester/**`، `src/testerui.ts`، `server/engine.ts`، `server/engineworker.ts` | انتخاب بازه‌ی تاریخ برای گزارش؛ تب‌های تحلیل (بازده ماهانه، توزیع بازده، رشته‌ها یا streak)؛ چند engine worker به‌جای یکی |
| **orderflow** | `src/orderflow/**`، `server/recorder.ts` | TPO و volume profile سشن، footprint/TPO به‌عنوان نوع چارت، تایم‌فریم‌های تیک و Range/Reversal/Delta، ‏Cluster Search، ‏Absorption، ‏Market Replay در سطح تیک از روی ضبط معاملات سرور |
| **derivs** | فایل تازه‌ی `server/derivs.ts`، پوشه‌ی تازه‌ی `src/derivs/**` | ‏Open Interest، ‏funding، نسبت long/short، فید liquidation، ‏CVD اسپات در برابر perp، ‏heatmap نقدشوندگی با برچسب «تخمینی» — از APIهای عمومی رایگان صرافی‌ها از طریق سرور (CCXT هرجا که پشتیبانی کند) |
| **chart** | `src/chart.ts`، `src/main.ts`، `src/drawui.ts`، `src/drawings.ts`، `src/tools/**`، `index.html`، `src/style.css` | ‏Replay همه‌ی چارت‌ها به‌صورت همگام، انتقال drawing به pane دیگر، دکمه‌های pane (بالا/پایین/بزرگ‌کردن/بستن)، مقیاس قیمت جدا برای هر اندیکاتور، ‏Magic cursor، ماشین‌حساب اندازه‌ی پوزیشن روی چارت (کشیدن SL/TP، دیدن اندازه و قیمت liquidation) |
| **journal** | `src/journal/**`، `src/journal.ts`، `src/journalui.ts`، پوشه‌ی تازه‌ی `src/risk/**` | بازپخش یک معامله‌ی ژورنال با Bar Replay، ثبت معاملات انجام‌شده در Replay به‌عنوان معاملات بک‌تست، ریسک پورتفوی: ماتریس همبستگی و اکسپوژر |

نیازهای میان‌حوزه‌ای (از طریق گزارش نهایی هماهنگ کنید، کار را متوقف نکنید):
- **pine** برای `request.security` به بارهای دیگر نیاز دارد: یک گزینه‌ی اختیاری `security?: (symbol, tf) => Bar[] | undefined` به
  گزینه‌های اجرای Pine اضافه کنید و وقتی نبود، na به‌همراه یک هشدار یک‌باره برگردانید؛ اتصال به چارت در `chart.ts` می‌تواند چند خط باشد.
- بازپخش معامله در **journal** از `ChartPane.startReplayAt(time)` موجود استفاده می‌کند؛ ثبت معاملات Replay از hookهای حساب کاغذی
  که از قبل در `main.ts` هست استفاده می‌کند (حداکثر چند خط).
- پنل‌های **derivs** مثل پنل‌های order-flow موجود اضافه می‌شوند (یک دکمه + یک hook برای pane).
