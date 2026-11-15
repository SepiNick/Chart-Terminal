[فارسی](SIGNING.fa.md) · [English](SIGNING.md)

# امضای نصبیِ ویندوز

نصبیِ بدون امضا باعث می‌شود SmartScreen ویندوز هشدار «ناشر ناشناس» بدهد. امضا کردن به گواهی‌ای نیاز دارد که به نام شما یا شرکتتان صادر شده باشد؛ هیچ‌کس نمی‌تواند گواهی‌ای برایتان بسازد که ویندوز به آن اعتماد کند.

## گزینه‌ها

| گزینه | هزینه | SmartScreen |
|---|---|---|
| Azure Trusted Signing (مایکروسافت) | اشتراک ماهانه | سریع مورد اعتماد می‌شود؛ احراز هویت لازم است |
| گواهی امضای کد EV (توکن سخت‌افزاری یا HSM ابری) | سالانه | فوراً مورد اعتماد است |
| گواهی امضای کد OV (فایل .pfx) | سالانه | با اعتبارگرفتنِ برنامه، هشدار کم‌کم از بین می‌رود |
| SignPath Foundation | رایگان، فقط پروژه‌های متن‌باز | به مخزن عمومی نیاز دارد |

## ساختن نصبیِ امضاشده

گواهی OV به‌صورت فایل .pfx (فایل و رمزش را از git دور نگه دارید):

```bash
set CSC_LINK=C:\secure\chart-terminal.pfx
set CSC_KEY_PASSWORD=your-password
npm --prefix desktop run dist:win:signed
```

اگر گواهی‌ای پیکربندی نشده باشد، `dist:win:signed` همان ابتدا متوقف می‌شود (`sign-check.mjs`)، تا نصبیِ بدون امضا هرگز با نصبیِ امضاشده اشتباه گرفته نشود. وقتی `CSC_LINK` تنظیم شده باشد، electron-builder خودکار برنامه، حذف‌کننده (uninstaller) و نصبی را امضا می‌کند.

Azure Trusted Signing: مقادیر `AZURE_TENANT_ID`، `AZURE_CLIENT_ID` و `AZURE_CLIENT_SECRET` را تنظیم کنید و `win.azureSignOptions` (نشانی endpoint، نام حساب، نام پروفایل گواهی) را به `package.json` اضافه کنید.

## بررسی نتیجه

```bash
powershell -c "Get-AuthenticodeSignature 'desktop\release\Chart Terminal Setup 0.1.0.exe' | Format-List Status, SignerCertificate"
```

`Status : Valid` یعنی نصبی امضا شده و مورد اعتماد است.
