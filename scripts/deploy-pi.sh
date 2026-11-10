#!/usr/bin/env bash
# Puts the private Chart Terminal server on a Raspberry Pi (or any Linux box with SSH) and starts it with Docker.
# Run from the project folder on your PC (Git Bash or WSL):   scripts/deploy-pi.sh pi@192.168.1.50
# Re-run it to update: it copies the current source again, rebuilds, and keeps the data volume.
# Needs: ssh access to the Pi (key or password) and sudo on it. Nothing is installed on this PC.
set -euo pipefail
HOST="${1:?usage: scripts/deploy-pi.sh user@pi-address}"
DIR=chart-terminal

echo "==> copying the source to $HOST:~/$DIR"
tar czf - --exclude=node_modules --exclude=.git --exclude=.claude --exclude=dist --exclude=dist-lite --exclude=desktop \
  --exclude=android --exclude=graphify-out --exclude='*.db' --exclude=.env --exclude=.env.* . \
  | ssh "$HOST" "mkdir -p ~/$DIR && tar xzf - -C ~/$DIR"

echo "==> installing Docker if needed, then building and starting (the first build takes several minutes on a Pi)"
ssh -t "$HOST" "set -e; cd ~/$DIR
  if ! command -v docker >/dev/null; then curl -fsSL https://get.docker.com | sudo sh; sudo usermod -aG docker \$USER; fi
  sudo docker compose up -d --build
  sleep 8; sudo docker compose ps
  echo; echo 'LAN addresses:'; hostname -I"

cat <<'MSG'

Done. Set the first password once, on the Pi itself (the server refuses to do it over the network):
  ssh -t HOST 'read -rsp "New password: " p; echo; curl -s -X POST http://127.0.0.1:8787/api/auth/setup -H "content-type: application/json" -d "{\"password\":\"$p\"}"'
Then follow docs/raspberry-pi.md to add the server in the apps and connect Telegram.
MSG
