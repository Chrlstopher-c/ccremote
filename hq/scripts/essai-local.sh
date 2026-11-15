#!/bin/bash
# Responsabilité : monter un banc d'essai LOCAL et ISOLÉ d'Agent HQ — un relais (base, ports dédiés) et un poste
# « essai » (son propre serveur tmux, ses propres projets) — puis servir le build de production sous /hq/.
# Rien ne touche la prod ni les vraies sessions. Usage : hq/scripts/essai-local.sh [arreter]
set -u
ICI=$(cd "$(dirname "$0")/../.." && pwd)
BANC=${BANC:-/tmp/agent-hq-essai}
PORT_WEB=${PORT_WEB:-8790}
PORT_POSTES=${PORT_POSTES:-8791}
MDP=${MDP:-essai-local}

arreter() {
  for f in relais poste; do
    [ -f "$BANC/$f.pid" ] && kill "$(cat "$BANC/$f.pid")" 2>/dev/null && echo "$f arrêté"
    rm -f "$BANC/$f.pid"
  done
}
[ "${1:-}" = arreter ] && { arreter; exit 0; }

mkdir -p "$BANC/projets/demo/.git" "$BANC/poste"
[ -f "$BANC/projets/demo/README.md" ] || printf '# Projet de démonstration\n' > "$BANC/projets/demo/README.md"
cat > "$BANC/poste.json" <<JSON
{ "machine": "essai", "relais": "ws://127.0.0.1:$PORT_POSTES/poste", "description": "Poste d'essai local",
  "racines": ["$BANC/projets"], "comptes": {"principal": null}, "donnees": "$BANC/poste" }
JSON
arreter >/dev/null
(cd "$ICI/hq" && VITE_SOURCE=relais bun run build >/dev/null) || { echo 'build de hq en échec'; exit 1; }
EMPREINTE=$(bun -e "console.log(await Bun.password.hash('$MDP'))")
cd "$ICI"
CCREMOTE_BASE="$BANC/relais.db" CCREMOTE_EMPREINTE_MOT_DE_PASSE="$EMPREINTE" CCREMOTE_SECRETS_POSTES='essai=secret-essai' \
  CCREMOTE_PORT_WEB=$PORT_WEB CCREMOTE_PORT_POSTES=$PORT_POSTES \
  nohup bun run relais/bin.ts > "$BANC/relais.log" 2>&1 &
echo $! > "$BANC/relais.pid"
sleep 2
CCREMOTE_CONFIG_POSTE="$BANC/poste.json" CCREMOTE_SECRET_POSTE=secret-essai CCREMOTE_TMUX_SOCKET=agent-hq-essai \
  nohup bun run poste/bin.ts > "$BANC/poste.log" 2>&1 &
echo $! > "$BANC/poste.pid"
echo "Agent HQ d'essai : http://127.0.0.1:$PORT_WEB/hq/  (mot de passe : $MDP) — journaux dans $BANC"
