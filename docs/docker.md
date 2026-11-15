[English](docker.en.md) · [فارسی](docker.md)

# اجرا با Docker (رزبری پای، لینوکس، VPS)

> **وضعیت:** فایل‌ها نوشته شده‌اند ولی روی این کامپیوتر (ویندوز، بدون Docker) ساخته و اجرا نشده‌اند. اولین ساخت روی خود دستگاه را خودت امتحان کن و اگر خطایی داد خطا را بفرست.

سه فایل اصلی: `Dockerfile` (amd64 و ARM64، پس رزبری پای ۴ و ۵ هم کار می‌کند)، `docker-compose.yml` (سرور خصوصی خانگی) و `docker-compose.public.yml` (سرور عمومی با Caddy و HTTPS خودکار).

## سرور خصوصی روی رزبری پای (یا هر لینوکس)

```bash
git clone https://github.com/SepiNick/Chart-Terminal.git
cd Chart-Terminal
docker compose up -d --build
```

- از `network_mode: host` استفاده می‌شود، چون سرور فقط آدرس‌های خصوصی شبکه‌ی خانه را می‌پذیرد. این حالت فقط روی Docker لینوکس کار می‌کند (روی ویندوز و مک نه).
- روی خود پای، مرورگر را روی `http://localhost:8787` باز کن و اولین رمز را همان‌جا بگذار. بعد از آن از گوشی و PC با آدرس `https://<IP پای>:8443` (راهنمای نصب گواهی: `docs/android.md`) وصل شو.
- داده‌ها در volume به نام `chart-terminal-data` می‌مانند: `docker run --rm -v chart-terminal-data:/d -v "$PWD":/b busybox tar czf /b/backup.tgz -C /d .`
- ابزارهای ML پایتون پیش‌فرض نصب نیستند (روی پای سنگین‌اند): `docker compose build --build-arg ML=1`.
- لپ‌تاپ یا پای را همیشه روشن بگذار تا هشدارها و push کار کنند (`restart: unless-stopped`).

## سرور عمومی با دامنه

```bash
DOMAIN=charts.example.com docker compose -f docker-compose.public.yml up -d --build
docker compose -f docker-compose.public.yml exec app node server/cli.ts invite 1 7 "دوست"
```

- دامنه باید به IP سرور اشاره کند و پورت‌های ۸۰ و ۴۴۳ باز باشد. Caddy گواهی را خودش می‌گیرد.
- در این حالت کلید صرافی، معامله، موتور اسکریپت، ML، مدل زبانی و MT5 اصلاً بارگذاری نمی‌شوند.
- اولین بار رمز یک‌بارمصرف ادمین در لاگ چاپ می‌شود: `docker compose -f docker-compose.public.yml logs app`.
- ثبت‌نام پیش‌فرض با کد دعوت است (`CT_REGISTRATION=invite`).
