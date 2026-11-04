#!/bin/sh
# Chart Terminal lite - per-user install on Linux (no root). Run from the extracted folder:
#   sh ./install.sh [--service] [--download-node]
#   --service        also install + start a systemd --user service (always-on / headless mode)
#   --download-node  if no Node >= 24 is installed, download the official tarball from nodejs.org into the install dir
# Upgrade = run it again from the newer folder (user data is never touched).
# Test overrides: CT_INSTALL_DIR, CT_BIN_DIR, CT_APPS_DIR, CT_SYSTEMD_DIR.
set -eu

SRC=$(cd "$(dirname "$0")" && pwd)
DEST=${CT_INSTALL_DIR:-$HOME/.local/opt/chart-terminal}
BIN=${CT_BIN_DIR:-$HOME/.local/bin}
APPS=${CT_APPS_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/applications}
UNITS=${CT_SYSTEMD_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user}
SERVICE=0 DLNODE=0
for a in "$@"; do
  case $a in
    --service) SERVICE=1 ;;
    --download-node) DLNODE=1 ;;
    -h|--help) sed -n '2,7p' "$0"; exit 0 ;;
    *) echo "Unknown option: $a" >&2; exit 2 ;;
  esac
done

node_major() { "$1" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }

[ "$SRC" != "$DEST" ] || { echo "Run install.sh from the extracted folder, not from the install dir." >&2; exit 1; }

# Stop a running copy first so replacing its files is safe.
[ -x "$BIN/chart-terminal" ] && "$BIN/chart-terminal" --stop >/dev/null 2>&1 || true

# Keep a previously downloaded private Node across upgrades.
KEEP=
if [ -d "$DEST/node" ]; then KEEP=$(mktemp -d); mv "$DEST/node" "$KEEP/node"; fi
mkdir -p "$DEST"
rm -rf "${DEST:?}"/*
cp -R "$SRC"/. "$DEST"/
rm -f "$DEST/chart-terminal"
if [ -n "$KEEP" ]; then mv "$KEEP/node" "$DEST/node"; rmdir "$KEEP"; fi

# Which node? A private one in $DEST/node wins, then the system one.
NODE=
if [ -x "$DEST/node/bin/node" ] && [ "$(node_major "$DEST/node/bin/node")" -ge 24 ]; then NODE=$DEST/node/bin/node
elif command -v node >/dev/null 2>&1 && [ "$(node_major node)" -ge 24 ]; then NODE=$(command -v node)
fi

if [ -z "$NODE" ]; then
  if [ "$DLNODE" = 1 ]; then
    case $(uname -m) in
      x86_64|amd64) ARCH=x64 ;;
      aarch64|arm64) ARCH=arm64 ;;
      *) echo "Unsupported CPU: $(uname -m). Install Node 24+ yourself." >&2; exit 1 ;;
    esac
    command -v xz >/dev/null 2>&1 || { echo "xz is needed to unpack Node (apt install xz-utils)." >&2; exit 1; }
    BASE=https://nodejs.org/dist/latest-v24.x
    TMP=$(mktemp -d)
    fetch() { if command -v curl >/dev/null 2>&1; then curl -fsSL -o "$2" "$1"; else wget -q -O "$2" "$1"; fi; }
    fetch "$BASE/SHASUMS256.txt" "$TMP/SHASUMS256.txt"
    FILE=$(grep "linux-$ARCH.tar.xz\$" "$TMP/SHASUMS256.txt" | awk '{print $2}' | head -n 1)
    [ -n "$FILE" ] || { echo "Could not find a linux-$ARCH tarball on nodejs.org." >&2; exit 1; }
    echo "Downloading $BASE/$FILE ..."
    fetch "$BASE/$FILE" "$TMP/$FILE"
    WANT=$(grep " $FILE\$" "$TMP/SHASUMS256.txt" | awk '{print $1}')
    GOT=$(sha256sum "$TMP/$FILE" | awk '{print $1}')
    [ "$WANT" = "$GOT" ] || { echo "Checksum mismatch for $FILE - aborting." >&2; rm -rf "$TMP"; exit 1; }
    mkdir -p "$DEST/node"
    tar -xJf "$TMP/$FILE" -C "$DEST/node" --strip-components=1
    rm -rf "$TMP"
    NODE=$DEST/node/bin/node
  else
    cat >&2 <<MSG
Node.js 24 or newer is required and was not found. Pick one:
  1. Re-run with:  sh ./install.sh --download-node   (downloads the official tarball from nodejs.org into $DEST/node)
  2. Install it yourself, e.g. with nvm:
       curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
       . ~/.nvm/nvm.sh && nvm install 24
     then re-run:  sh ./install.sh
  3. Or from https://nodejs.org/en/download (Linux binaries) and put it on PATH.
MSG
    exit 1
  fi
fi

# The command. It runs the private node if there is one, else whatever node is on PATH at run time.
mkdir -p "$BIN"
cat > "$BIN/chart-terminal" <<WRAP
#!/bin/sh
if [ -x "$DEST/node/bin/node" ]; then exec "$DEST/node/bin/node" "$DEST/launcher.mjs" "\$@"; fi
exec node "$DEST/launcher.mjs" "\$@"
WRAP
chmod 755 "$BIN/chart-terminal"

mkdir -p "$APPS"
cat > "$APPS/chart-terminal.desktop" <<DESK
[Desktop Entry]
Type=Application
Name=Chart Terminal
Comment=Trading charts, alerts and forward tests
Exec=$BIN/chart-terminal
Icon=$DEST/icon.png
Terminal=false
Categories=Office;Finance;
DESK
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$APPS" 2>/dev/null || true

if [ "$SERVICE" = 1 ]; then
  mkdir -p "$UNITS"
  cat > "$UNITS/chart-terminal.service" <<UNIT
[Unit]
Description=Chart Terminal server (lite)

[Service]
Type=simple
ExecStart=$NODE $DEST/launcher.mjs --foreground
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
UNIT
  if command -v systemctl >/dev/null 2>&1; then
    systemctl --user daemon-reload
    systemctl --user enable --now chart-terminal.service
    echo "Service enabled. For it to run without logging in: sudo loginctl enable-linger $(id -un)"
  else
    echo "systemctl not found; the unit file was written to $UNITS/chart-terminal.service" >&2
  fi
fi

echo "Installed to $DEST (node: $NODE)"
echo "Run: chart-terminal   (make sure $BIN is on PATH)   Options: --no-window --status --stop"
