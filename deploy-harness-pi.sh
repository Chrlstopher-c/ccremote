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

# ☠ RÉGRESSION RÉELLE (2026-07-23) : ce script RÉÉCRIT `.env` en entier à chaque
# passage. Toute variable opt-in absente de l'environnement de l'appelant
# retombait donc à sa valeur par défaut — deux déploiements de routine ont ainsi
# ÉTEINT l'orchestrateur (`CCREMOTE_PI_ORCHESTRATEUR=1` → `0`), sans un mot :
# l'interface répondait « route inconnue » sur une fonctionnalité qui marchait
# cinq minutes plus tôt. Le défaut d'un réglage déjà en place est désormais SA
# PROPRE VALEUR, relue sur le Pi — jamais la valeur d'usine.
lire_reglage_distant() {
  ssh $SSH_OPTS "$TARGET" "grep -E '^$1=' $REMOTE_DIR/.env 2>/dev/null | tail -1 | cut -d= -f2-" 2>/dev/null || true
}
ORCHESTRATEUR_ACTUEL=$(lire_reglage_distant CCREMOTE_PI_ORCHESTRATEUR)

echo "→ Envoi des sources du harness"
ssh $SSH_OPTS "$TARGET" "mkdir -p $REMOTE_DIR"
# ☠ PERTE DE DONNÉES RÉELLE (2026-07-23) : `--exclude '*.db'` ne couvre PAS
# `registre.db-wal` ni `registre.db-shm`. Le registre est en mode WAL — les
# écritures récentes vivent dans le `-wal` (535 Ko observés contre 4 Ko pour le
# `.db` lui-même). `--delete` les effaçait donc à CHAQUE déploiement : une
# conversation créée puis un redéploiement, et elle avait disparu. Le motif doit
# couvrir les fichiers annexes de SQLite, pas seulement l'extension nue.
rsync -az --delete \
  --exclude node_modules --exclude '*.db' --exclude '*.db-wal' --exclude '*.db-shm' \
  --exclude '.env' --exclude 'logs' \
  -e "ssh $SSH_OPTS" \
  /mnt/projects/ccremote/harness/ "$TARGET:$REMOTE_DIR/"

echo "→ Répertoires attendus"
ssh $SSH_OPTS "$TARGET" "mkdir -p /home/pi/projets"

echo "→ Installation des dépendances (Bun)"
ssh $SSH_OPTS "$TARGET" "cd $REMOTE_DIR && ~/.bun/bin/bun install --silent"

echo "→ Écriture de l'environnement (umask 077, jamais lisible par les autres)"
# ☠ Le secret passe par stdin, jamais en argument de commande : les arguments
# sont visibles dans `ps` par tout utilisateur de la machine.
ssh $SSH_OPTS "$TARGET" "umask 077 && cat > $REMOTE_DIR/.env" <<EOF
# ☠ Le CLI claude vit dans ~/.local/bin, qui n'est dans le PATH que d'un shell
# de connexion — un service systemd ne l'y trouve pas. Sans cette ligne, la
# session orchestrateur échoue au spawn avec une erreur peu parlante.
PATH=/home/pi/.local/bin:/home/pi/.bun/bin:/usr/local/bin:/usr/bin:/bin
CCREMOTE_PI_REGISTRE_DB=$REMOTE_DIR/registre.db
CCREMOTE_PI_REPERTOIRE_PROJETS=/home/pi/projets
CCREMOTE_PI_CWD_ORCHESTRATEUR=$REMOTE_DIR
CCREMOTE_PI_IDENTITE_ORCHESTRATEUR=$REMOTE_DIR/identite-orchestrateur.json
CCREMOTE_PI_INCIDENTS_ORCHESTRATEUR=$REMOTE_DIR/incidents-orchestrateur.jsonl
# Compte dédié à la session maître, connecté par un /login humain sur le Pi.
CCREMOTE_PI_CONFIG_DIR_ORCHESTRATEUR=${CCREMOTE_PI_CONFIG_DIR_ORCHESTRATEUR:-/home/pi/.claude-orchestrateur}
# ☠ Comptes de REPLI du master, sur le Pi. Distincts des comptes du registre
# (CCREMOTE_PI_COMPTES), qui vivent sur le PC et sont inutilisables ici. Sans
# repli local, une saturation rend l'orchestrateur définitivement muet (23/07).
CCREMOTE_PI_CONFIG_DIRS_ORCHESTRATEUR=${CCREMOTE_PI_CONFIG_DIRS_ORCHESTRATEUR:-/home/pi/.claude-orchestrateur,/home/pi/.claude-orchestrateur-b}
# ☠ Comptes Claude garantis au démarrage du service (idempotent, dans SA
# connexion) : plus de script séparé qui se faisait effacer par une course WAL.
CCREMOTE_PI_COMPTES=${CCREMOTE_PI_COMPTES:-compte-a=/home/trinity/.claude-comptes/compte-a,compte-b=/home/trinity/.claude-comptes/compte-b}
CCREMOTE_LIEN_SECRET=$CCREMOTE_LIEN_SECRET
# ☠ Le LIEN écoute sur le LAN : le PC est une autre machine du réseau local.
# Protégé par le secret partagé (comparaison à temps constant, refus 4401).
# Le remettre en 127.0.0.1 déconnecterait le PC en silence à chaque déploiement
# — c'est exactement ce qui est arrivé le 22/07/2026.
CCREMOTE_LIEN_HOST=${CCREMOTE_LIEN_HOST:-0.0.0.0}
CCREMOTE_LIEN_PORT=8721
# ☠ L'API web reste STRICTEMENT en loopback : elle n'a aucune authentification
# propre, c'est pi-web qui la lui apporte. Le serveur refuse d'ailleurs de
# démarrer sur une interface publique.
CCREMOTE_API_WEB_PORT=8722
# ☠ Session orchestrateur maître : opt-in, car elle consomme du quota EN
# CONTINU et exige des credentials Claude valides sur le Pi. Activer en passant
# CCREMOTE_PI_ORCHESTRATEUR=1 au script.
CCREMOTE_PI_ORCHESTRATEUR=${CCREMOTE_PI_ORCHESTRATEUR:-${ORCHESTRATEUR_ACTUEL:-0}}
EOF

echo "→ Service systemd"
scp $SSH_OPTS /mnt/projects/ccremote/harness/composition/deploiement/ccremote-harness.service "$TARGET:/tmp/"
ssh $SSH_OPTS "$TARGET" "sudo mv /tmp/ccremote-harness.service /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable ccremote-harness && sudo systemctl restart ccremote-harness"

# ── Exposition du lien par Cloudflare Tunnel ────────────────────────────────
#
# ☠ Le lien Pi↔PC n'avait JAMAIS été traversé hors du LAN : le banc du 22/07
# tournait en réseau local direct. Cette règle est ce qui permet à un superviseur
# hébergé AILLEURS — le VPS OVH, qui n'est pas sur le réseau du Pi — de s'y
# rattacher.
#
# ☠ Exposer un canal de contrôle sur Internet ne se fait QUE parce que son
# authentification a été conçue pour ça : secret partagé en en-tête
# `Authorization: Bearer` — jamais en paramètre d'URL, précisément pour ne pas
# finir dans les access logs de Cloudflare — comparé en temps constant, et
# fermeture terminale 4401 sur échec (`composition/lien-pc-pi/secret.ts`).
# Ne JAMAIS rétrograder ce point sans revoir cette exposition.
#
# ☠ Idempotent, et cloudflared n'est redémarré QUE si la règle change : un
# redémarrage coupe quelques secondes tous les autres tunnels du Pi (StockIOP,
# CRM, license-server…).
# ☠ INCIDENT PAYÉ ICI le 01/08 : ce port était lu depuis `$CCREMOTE_LIEN_PORT`,
# qui n'existe QUE dans le heredoc du `.env` distant — jamais comme variable de
# ce shell. La règle écrite valait donc `service: http://localhost:` sans port,
# YAML invalide, et cloudflared a refusé de démarrer : TOUS les tunnels du Pi
# sont tombés d'un coup (CRM, license-server, le site, ccremote). Une variable
# vide dans un fichier de config ne produit pas une config dégradée, elle
# produit un service mort. D'où la valeur explicite ici, et le garde-fou
# ci-dessous qui refuse d'écrire quoi que ce soit sans port.
LIEN_PORT=8721
if [ -z "$LIEN_PORT" ]; then
  echo "✗ port du lien vide — écriture de l'ingress refusée (cf. incident du 01/08)" >&2
  exit 78
fi
LIEN_SUBDOMAIN="${CCREMOTE_LIEN_SUBDOMAIN:-lien.exemple.com}"
echo "→ Exposition du lien ($LIEN_SUBDOMAIN → localhost:$LIEN_PORT)"
REGLE_LIEN=$(ssh $SSH_OPTS "$TARGET" "sudo python3 -c \"
cfg = open('/etc/cloudflared/config.yml').read()
rule = '''    - hostname: $LIEN_SUBDOMAIN
      service: http://localhost:$LIEN_PORT
'''
if '$LIEN_SUBDOMAIN' not in cfg:
    ancre = '    - hostname: exemple.com\n      service:'
    cfg = cfg.replace(ancre, rule + ancre, 1)
    open('/etc/cloudflared/config.yml', 'w').write(cfg)
    print('ajoutee')
else:
    print('deja-presente')
\"")
echo "  $REGLE_LIEN"
if echo "$REGLE_LIEN" | grep -q "ajoutee"; then
  TUNNEL_ID=$(ssh $SSH_OPTS "$TARGET" "grep -oP '(?<=tunnel: )\S+' /etc/cloudflared/config.yml | head -1")
  ssh $SSH_OPTS "$TARGET" "cloudflared tunnel route dns $TUNNEL_ID $LIEN_SUBDOMAIN 2>&1 || true"
  ssh $SSH_OPTS "$TARGET" "sudo systemctl restart cloudflared"
  echo "  cloudflared redémarré (règle nouvelle)"
fi

echo "→ Vérification"
sleep 4
ssh $SSH_OPTS "$TARGET" "systemctl is-active ccremote-harness && curl -sf -m 5 http://127.0.0.1:8722/api/harness/health && echo"

echo ""
echo "✓ Control plane déployé."
echo "  Le PC doit utiliser LE MÊME CCREMOTE_LIEN_SECRET."
