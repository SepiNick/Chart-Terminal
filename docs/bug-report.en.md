[English](bug-report.en.md) · [فارسی](bug-report.md)

# Bug reports inside the app

Menu ☰ → "Report a bug…". The user writes a description, adds up to 3 screenshots (optional) and a way to be reached (optional). Diagnostic information is attached automatically (version, OS, screen size, chart symbols and settings, recent app errors) and can be removed with a tick box. It contains no keys, passwords, tokens, e-mail addresses or IPs (`src/diagnostics.ts`). Screenshots are shrunk to at most 1600 px and small JPEGs before sending.

## Where the report goes

1. **Public receiver (recommended):** a Cloudflare Worker (`bugreport-worker/`, set-up in [its README](../bugreport-worker/README.en.md)). The app first solves a proof-of-work puzzle (the captcha) and then posts the report to the Worker; the Worker delivers the text, the diagnostics file and the screenshots to your Telegram and optionally creates a GitHub Issue. You put the address into the app at build time with `VITE_BUG_REPORT_URL=https://…`. Works for every version (even standalone).
2. **The app is connected to your own server and the address above is not set:** `POST /api/bugreport`; the report and screenshots are stored in `<server data>/bugreports/<id>/` and, if the Telegram bot is set up under "Server & notifications", go to that chat (`server/bugreport.ts`).
3. **Whenever sending fails or nothing is set up:** the report is saved as a `.json` file and the user sends it to you by hand.

## Automatic crash logs

When the app hits an uncaught error or an unhandled promise rejection (or the desktop window's renderer process dies), it builds the same redacted diagnostics text and sends it **without asking**. The user sees a notice straight away ("a crash log was captured and is being sent") and another when it was sent.

- Guard rails: at most 3 per session, a minute apart, the same bug once a day.
- Can be switched off: menu ☰ → "Send crash logs automatically".
- If it cannot be sent, the last 5 are kept on the device and retried at the next start.
- Where it goes: the same places as a manual report (list above).
