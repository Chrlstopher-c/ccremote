#!/bin/bash
# Déploiement du control plane du harness sur le Pi (H-75 : le Pi héberge).
#
# ☠ Le secret du lien N'EST PAS généré ici et n'est JAMAIS dans le dépôt : il
# est lu depuis l'environnement, et doit être le MÊME des deux côtés (Pi et PC).
# Un secret régénéré à chaque déploiement couperait le PC en silence.
#
# Usage :
#   CCREMOTE_LIEN_SECRET=... ./deploy-harness-pi.sh [pi-user@pi-ip]
set -e

TARGET=${1:-"pi@pi.exemple"}
REMOTE_DIR="/home/pi/ccremote-harness"
SSH_KEY="${CCREMOTE_SSH_KEY:-$HOME/.ssh/id_ed25519_ccremote}"
SSH_OPTS="-o BatchMode=yes -i $SSH_KEY"

if [ -z "$CCREMOTE_LIEN_SECRET" ]; then
  echo "✗ CCREMOTE_LIEN_SECRET absent." >&2
  echo "  Générer une fois :  openssl rand -hex 32" >&2
  echo "  Puis le conserver — il doit être identique sur le Pi et sur le PC." >&2
  exit 78
fi

echo "→ Envoi des sources du harness"
ssh $SSH_OPTS "$TARGET" "mkdir -p $REMOTE_DIR"
rsync -az --delete \
  --exclude node_modules --exclude '*.db' --exclude '.env' --exclude 'logs' \
  -e "ssh $SSH_OPTS" \
  /mnt/projects/ccremote/harness/ "$TARGET:$REMOTE_DIR/"

echo "→ Installation des dépendances (Bun)"
ssh $SSH_OPTS "$TARGET" "cd $REMOTE_DIR && ~/.bun/bin/bun install --silent"

echo "→ Écriture de l'environnement (umask 077, jamais lisible par les autres)"
# ☠ Le secret passe par stdin, jamais en argument de commande : les arguments
# sont visibles dans `ps` par tout utilisateur de la machine.
ssh $SSH_OPTS "$TARGET" "umask 077 && cat > $REMOTE_DIR/.env" <<EOF
CCREMOTE_PI_REGISTRE_DB=$REMOTE_DIR/registre.db
CCREMOTE_PI_REPERTOIRE_PROJETS=/home/pi/projets
CCREMOTE_PI_CWD_ORCHESTRATEUR=$REMOTE_DIR
CCREMOTE_LIEN_SECRET=$CCREMOTE_LIEN_SECRET
# Le tunnel Cloudflare relaie vers ces ports en local — jamais exposés au LAN.
CCREMOTE_LIEN_HOST=127.0.0.1
CCREMOTE_LIEN_PORT=8721
CCREMOTE_API_WEB_PORT=8722
# ☠ Session orchestrateur maître : opt-in. Exige des credentials Claude valides
# sur le Pi (un \`/login\` humain) et consomme du quota en continu. Le parc, les
# escalades et le pilotage fonctionnent sans elle.
# CCREMOTE_PI_ORCHESTRATEUR=1
EOF

echo "→ Service systemd"
scp $SSH_OPTS /mnt/projects/ccremote/harness/composition/deploiement/ccremote-harness.service "$TARGET:/tmp/"
ssh $SSH_OPTS "$TARGET" "sudo mv /tmp/ccremote-harness.service /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable ccremote-harness && sudo systemctl restart ccremote-harness"

echo "→ Vérification"
sleep 4
ssh $SSH_OPTS "$TARGET" "systemctl is-active ccremote-harness && curl -sf -m 5 http://127.0.0.1:8722/api/harness/health && echo"

echo ""
echo "✓ Control plane déployé."
echo "  Le PC doit utiliser LE MÊME CCREMOTE_LIEN_SECRET."
