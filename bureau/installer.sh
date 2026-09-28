#!/usr/bin/env bash
# Installe l'app de bureau ccremote sur cette machine (binaire, entrée .desktop, icônes). Idempotent.
# Binaire : construit sur la tour (bureau/construire.sh) puis récupéré, ou passé en argument.
#   ./bureau/installer.sh                 récupère le binaire depuis la tour (ssh tour)
#   ./bureau/installer.sh <binaire>       installe ce binaire
set -euo pipefail
ICI=$(cd "$(dirname "$0")" && pwd)
BIN=${1:-}
if [ -z "$BIN" ]; then
  BIN=$(mktemp); trap 'rm -f "$BIN"' EXIT
  scp -q tour:/mnt/projects/ccremote-dev/bureau/src-tauri/target/release/ccremote "$BIN"
fi
install -Dm755 "$BIN" "$HOME/.local/bin/ccremote"
for t in 32x32 128x128; do install -Dm644 "$ICI/src-tauri/icons/$t.png" "$HOME/.local/share/icons/hicolor/$t/apps/ccremote.png"; done
install -Dm644 "$ICI/src-tauri/icons/icon.png" "$HOME/.local/share/icons/hicolor/512x512/apps/ccremote.png"
install -Dm644 /dev/stdin "$HOME/.local/share/applications/ccremote.desktop" <<'DESKTOP'
[Desktop Entry]
Type=Application
Name=ccremote
GenericName=Sessions Claude Code
Comment=Toutes les sessions Claude Code du parc, depuis un seul endroit
Exec=ccremote
Icon=ccremote
Terminal=false
Categories=Development;
Keywords=claude;sessions;tmux;parc;
StartupWMClass=ccremote
DESKTOP
update-desktop-database -q "$HOME/.local/share/applications" 2>/dev/null || true
echo "ccremote installé : $HOME/.local/bin/ccremote"
