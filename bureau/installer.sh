#!/usr/bin/env bash
# Installe l'app de bureau Quart sur cette machine (binaire, entrée .desktop pour la recherche d'apps, icônes).
# Idempotent ; retire l'ancienne installation « ccremote ».
# Binaire : construit sur la tour (bureau/construire.sh) puis récupéré, ou passé en argument.
#   ./bureau/installer.sh                 récupère le binaire depuis la tour (ssh tour)
#   ./bureau/installer.sh <binaire>       installe ce binaire
set -euo pipefail
ICI=$(cd "$(dirname "$0")" && pwd)
BIN=${1:-}
if [ -z "$BIN" ]; then
  BIN=$(mktemp); trap 'rm -f "$BIN"' EXIT
  scp -q tour:/mnt/projects/ccremote-dev/bureau/src-tauri/target/release/quart "$BIN"
fi
PARTAGE="$HOME/.local/share"
install -Dm755 "$BIN" "$HOME/.local/bin/quart"
for t in 32x32 128x128; do install -Dm644 "$ICI/src-tauri/icons/$t.png" "$PARTAGE/icons/hicolor/$t/apps/quart.png"; done
install -Dm644 "$ICI/src-tauri/icons/icon.png" "$PARTAGE/icons/hicolor/512x512/apps/quart.png"
# Exec en chemin absolu : un lanceur graphique n'a pas forcément ~/.local/bin dans son PATH.
install -Dm644 /dev/stdin "$PARTAGE/applications/quart.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Quart
GenericName=Sessions Claude Code
Comment=Toutes les sessions Claude Code du parc, depuis un seul endroit
Exec=$HOME/.local/bin/quart
Icon=quart
Terminal=false
Categories=Development;
Keywords=claude;sessions;tmux;parc;ccremote;quart;
StartupWMClass=quart
DESKTOP
rm -f "$HOME/.local/bin/ccremote" "$PARTAGE/applications/ccremote.desktop" \
  "$PARTAGE"/icons/hicolor/{32x32,128x128,512x512}/apps/ccremote.png
update-desktop-database -q "$PARTAGE/applications" 2>/dev/null || true
gtk-update-icon-cache -q -t "$PARTAGE/icons/hicolor" 2>/dev/null || true
echo "Quart installé : $HOME/.local/bin/quart"
