# Responsabilité : lancer chaque `claude` interactif dans `tmux -L claude` (le serveur des postes), pour que toute
# session ouverte au clavier soit aussi pilotable depuis Quart. À sourcer dans ~/.zshrc AVANT tout autre enrobage de
# `claude` (Palabre enveloppe une fonction existante). Hors tmux seulement : dans tmux, sous-commandes, `-p` et
# `QUART_SANS_TMUX=1`, lancement normal. Au moindre doute, lancement normal : ce lanceur ne doit jamais bloquer Claude.
if [ -z "${_QUART_CLAUDE_TMUX:-}" ]; then
  _QUART_CLAUDE_TMUX=1
  _QUART_TMUX_CONF="${0:A:h}/tmux.conf"

  claude() {
    local bin arg nom base n=2
    bin=$(whence -p claude) || { echo "claude introuvable" >&2; return 127; }
    if [ -n "${TMUX:-}" ] || [ -n "${QUART_SANS_TMUX:-}" ] || ! command -v tmux >/dev/null || [ ! -t 0 ]; then
      "$bin" "$@"; return
    fi
    case "${1:-}" in
      mcp|config|doctor|update|upgrade|install|plugin|plugins|setup-token|migrate-installer|agents|auth|login|logout)
        "$bin" "$@"; return ;;
    esac
    for arg in "$@"; do
      case "$arg" in -p|--print|--version|-v|--help|-h) "$bin" "$@"; return ;; esac
    done
    base="claude-${${PWD:t}//[^A-Za-z0-9_-]/_}"
    [ "$PWD" = "$HOME" ] && base="claude-racine"
    nom=$base
    while tmux -L claude has-session -t "=$nom" 2>/dev/null; do nom="$base-$n"; n=$((n + 1)); done
    # Le serveur tmux a l'environnement du service qui l'a démarré : on transmet celui du shell.
    local -a envs
    for arg in PATH LANG LC_ALL COLORTERM DISPLAY WAYLAND_DISPLAY XDG_RUNTIME_DIR DBUS_SESSION_BUS_ADDRESS \
      SSH_AUTH_SOCK CLAUDE_CONFIG_DIR; do
      [ -n "${(P)arg:-}" ] && envs+=(-e "$arg=${(P)arg}")
    done
    tmux -L claude -f "$_QUART_TMUX_CONF" -u new-session -d -s "$nom" -c "$PWD" "${envs[@]}" -- "$bin" "$@" \
      || { "$bin" "$@"; return; }
    tmux -L claude attach-session -t "=$nom"
  }
fi
