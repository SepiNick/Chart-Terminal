[English](docker.en.md) · [فارسی](docker.md)

# Running with Docker (Raspberry Pi, Linux, VPS)

> **Status:** the files are written but have not been built or run on this computer (Windows, no Docker). Try the first build on the device yourself and send the error if it fails.

Three main files: `Dockerfile` (amd64 and ARM64, so Raspberry Pi 4 and 5 work too), `docker-compose.yml` (private home server) and `docker-compose.public.yml` (public server with Caddy and automatic HTTPS).

## Private server on a Raspberry Pi (or any Linux)

```bash
git clone https://github.com/SepiNick/tradingview-clone.git
cd tradingview-clone
docker compose up -d --build
```

- `network_mode: host` is used because the server only accepts private home-network addresses. This mode only works on Linux Docker (not Windows or Mac).
- On the Pi itself, open the browser at `http://localhost:8787` and set the first password there. After that, connect from the phone and PC at `https://<Pi IP>:8443` (certificate install guide: `docs/android.en.md`).
- Data stays in the volume named `chart-terminal-data`: `docker run --rm -v chart-terminal-data:/d -v "$PWD":/b busybox tar czf /b/backup.tgz -C /d .`
- The Python ML tools are not installed by default (heavy on a Pi): `docker compose build --build-arg ML=1`.
- Keep the laptop or Pi always on so alerts and push work (`restart: unless-stopped`).

## Public server with a domain

```bash
DOMAIN=charts.example.com docker compose -f docker-compose.public.yml up -d --build
docker compose -f docker-compose.public.yml exec app node server/cli.ts invite 1 7 "friend"
```

- The domain must point to the server's IP and ports 80 and 443 must be open. Caddy gets the certificate itself.
- In this mode exchange keys, trading, the script engine, ML, the language model and MT5 are not loaded at all.
- The first time, the admin's one-time password is printed in the log: `docker compose -f docker-compose.public.yml logs app`.
- Registration is by invite code by default (`CT_REGISTRATION=invite`).
