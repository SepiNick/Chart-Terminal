#!/bin/sh
# Chart Terminal lite - removes the program, command, menu entry and systemd service.
# User data (~/.local/share/chart-terminal) is KEPT; delete it by hand to remove everything.
set -eu
DEST=${CT_INSTALL_DIR:-$HOME/.local/opt/chart-terminal}
BIN=${CT_BIN_DIR:-$HOME/.local/bin}
APPS=${CT_APPS_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/applications}
UNITS=${CT_SYSTEMD_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user}

if [ -f "$UNITS/chart-terminal.service" ]; then
  command -v systemctl >/dev/null 2>&1 && systemctl --user disable --now chart-terminal.service 2>/dev/null || true
  rm -f "$UNITS/chart-terminal.service"
  command -v systemctl >/dev/null 2>&1 && systemctl --user daemon-reload 2>/dev/null || true
fi
[ -x "$BIN/chart-terminal" ] && "$BIN/chart-terminal" --stop >/dev/null 2>&1 || true
rm -f "$BIN/chart-terminal" "$APPS/chart-terminal.desktop"
rm -rf "${DEST:?}"
echo "Removed. Your data was kept."
