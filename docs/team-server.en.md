[English](team-server.en.md) · [فارسی](team-server.md)

# Team server: accounts, two-factor sign-in (2FA) and discovery

For a trading team that shares one server (a PC, a Pi or a VPS) and signs in from the Windows app, the browser and the Android app. This page is for the **server owner**. How a member pairs a phone is in [pairing.en.md](pairing.en.md).

## 1. Accounts (public server)

A team server is a **public-mode server** (`CT_MODE=public`, see [docker.en.md](docker.en.md)): every person has a username and password, and their settings, drawings, watchlists and alerts belong to that account only.

```bash
CT_MODE=public CT_PUBLIC_URL=https://charts.example.com CT_ADMIN=boss node index.ts   # the first start prints a one-time admin password
node cli.ts invite 5 7 "trading team"      # 5 uses, valid 7 days: send the code to your members
```

Members register with the invite code (`CT_REGISTRATION=invite`, the default). A private server (one password, no usernames) can use 2FA too, see section 3.

## 2. Requiring 2FA

2FA is a 6-digit code from an authenticator app (Google Authenticator, Aegis, 1Password, ...): TOTP, RFC 6238, SHA-1, 30 seconds.

| Setting | Effect |
|---|---|
| (default) | **Administrators always** use 2FA; members choose for themselves |
| `CT_REQUIRE_2FA=1` | **Everyone** must use 2FA |
| `CT_REQUIRE_2FA=0` | Nobody is required (only for a closed lab) |

An account that is required to use 2FA but has none yet is taken to a setup step **right after the correct password**: scan the QR code, type the first code, save the 8 recovery codes. No session is created before that. Members who are not required can switch it on in Settings -> Security (password and a code are needed).

Rules worth knowing:

- A code can be used **once**: a stolen, already-used code is useless. The server accepts the current step and one step either side (clock drift).
- Wrong codes lock the account for 15 minutes after 10 failures (and the address after 10), even for the right code. A sign-in ticket (valid 3 minutes, one use, tied to the address) dies after 5 wrong codes.
- The secret is stored **encrypted** (AES-256-GCM; on a public server with its own key file `data/totp.key`, which you must back up with the data). Recovery codes are stored only as hashes.
- Lost phone: use one of the 8 recovery codes (one use each). With none left, the server owner runs `node cli.ts reset-2fa <name>` (the account then signs in with its password and, if the server requires 2FA, enrols again).
- While the server requires 2FA, a member cannot switch it off.
- Every sign-in, failure, recovery-code use and change appears in the audit log.

## 3. Private server

A private server (one password) supports 2FA too: Settings -> Security on the PC. After that every device that signs in, the phone included, needs password and code. It is not required by `CT_REQUIRE_2FA` (that is for public servers).

## 4. Discovery on the local network

A private server with Home network access on sends a small broadcast message (UDP port **41771**, every 2 seconds) so the Android app and the Windows app list it under "Servers on this network". The message holds only the server id, name, addresses, version, mode and whether 2FA is on: no account names, no secrets.

- Turn it off with `CT_DISCOVERY=0`, or with the switch in Settings -> Server & notifications.
- It works only on the **same subnet**: routers do not forward broadcasts, and guest Wi-Fi with client isolation drops them. Then type the address (or scan a pairing QR code).
- It is never sent by a server that listens on this computer only, and a public server does not send it at all.
- If a phone cannot reach the PC at all, check the PC's VPN and the Windows firewall rule in [lan-setup.en.md](lan-setup.en.md).

## 5. What the server answers (for developers)

```
POST /api/auth/login        -> { twofa: true, ticket }   (password right, 2FA on; no session, no token yet)
                            -> { enroll: true, ticket }  (server requires 2FA, account has none)
POST /api/auth/login/2fa    { ticket, code | recovery, device? }  -> { ok, user, token? }
POST /api/auth/login/2fa/setup  { ticket }                        -> { secret, otpauth, qrSvg }
POST /api/auth/login/2fa/enroll { ticket, code, device? }         -> { ok, user, token?, recoveryCodes }
GET  /api/auth/2fa/status   -> { enabled, required, recoveryLeft }
POST /api/auth/2fa/setup    { password } -> { secret, otpauth, qrSvg }
POST /api/auth/2fa/enable   { code }     -> { ok, recoveryCodes }
POST /api/auth/2fa/disable  { password, code | recovery code }
```

Beacon datagram: `{"ct":1,"id":"<16 hex>","name":"...","urls":["https://192.168.1.20:8443","http://192.168.1.20:8787"],"v":"<version>","mode":"private","twofa":false}`.
