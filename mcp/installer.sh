#!/usr/bin/env bash
# Installe le MCP Quart sur une machine et l'enregistre dans Claude Code (niveau utilisateur).
#   mcp/installer.sh             → cette machine
#   mcp/installer.sh <hôte-ssh>  → une autre machine (copie du code + du jeton de cette machine-ci)
# Copie autonome dans ~/.local/share/quart-mcp : ne dépend pas de la branche du dépôt.
set -euo pipefail
ICI=$(cd "$(dirname "$0")/.." && pwd)
CIBLE=${1:-}
DEST='$HOME/.local/share/quart-mcp'
FICHIERS=(mcp/bin.ts mcp/client-relais.ts mcp/format.ts mcp/outils.ts commun package.json bun.lock tsconfig.json)

log() { printf '\033[1;34m▸\033[0m %s\n' "$*"; }

installer_local() {
  local dest="$HOME/.local/share/quart-mcp"
  mkdir -p "$dest/mcp"
  (cd "$ICI" && tar -cf - "${FICHIERS[@]}") | tar -C "$dest" -xf -
  (cd "$dest" && bun install --production --frozen-lockfile >/dev/null)
  [ -f "$HOME/.config/quart/mcp.env" ] || { echo "manque ~/.config/quart/mcp.env (jeton : mcp/emettre-jeton.ts)"; exit 1; }
  claude mcp remove -s user quart >/dev/null 2>&1 || true
  claude mcp add -s user quart -- "$(command -v bun)" run "$dest/mcp/bin.ts"
}

if [ -z "$CIBLE" ]; then
  log "installation locale"
  installer_local
else
  log "installation sur $CIBLE"
  ssh "$CIBLE" "mkdir -p $DEST ~/.config/quart && chmod 700 ~/.config/quart"
  (cd "$ICI" && tar -cf - "${FICHIERS[@]}") | ssh "$CIBLE" "tar -C $DEST -xf -"
  [ -n "${QUART_JETON_CIBLE:-}" ] && printf 'QUART_URL=%s\nQUART_JETON=%s\n' "$(grep -m1 ^QUART_URL= ~/.config/quart/mcp.env | cut -d= -f2-)" \
    "$QUART_JETON_CIBLE" | ssh "$CIBLE" 'umask 077; cat > ~/.config/quart/mcp.env'
  ssh "$CIBLE" "export PATH=\$HOME/.bun/bin:\$HOME/.local/bin:\$PATH; cd $DEST && bun install --production --frozen-lockfile >/dev/null \
    && test -f ~/.config/quart/mcp.env && (claude mcp remove -s user quart >/dev/null 2>&1 || true) \
    && claude mcp add -s user quart -- \$(command -v bun) run $DEST/mcp/bin.ts"
fi
log "fait"
