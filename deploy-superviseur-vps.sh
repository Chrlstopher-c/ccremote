#!/bin/bash
# Déploiement du SUPERVISEUR (moitié « PC » du harness, H-75) sur le VPS OVH.
#
# Pourquoi ce script existe : le PC de Chris doit être allumé pour qu'une seule
# équipe tourne. Le VPS l'est en permanence — c'est tout l'objet du portage.
#
# ☠ Le VPS n'est PAS sur le réseau du Pi. Le lien passe donc par Cloudflare
# Tunnel (`lien.exemple.com`), premier et seul chemin hors LAN, et
# l'URL est en `wss://` — pas `ws://`. Le secret est le MÊME que celui du Pi :
# régénéré, il couperait le lien en silence.
#
# ☠ NE JAMAIS laisser deux superviseurs connectés en même temps. La tempête
# d'évictions (dette n°6, 1268 évictions mesurées au banc du 22/07) n'est pas
# corrigée : deux clients se chassent en boucle. Ce script REFUSE de démarrer le
# service si le superviseur du PC tourne encore — voir plus bas.
#
# Usage :
#   CCREMOTE_LIEN_SECRET=... ./deploy-superviseur-vps.sh [--demarrer]
#
#   Sans `--demarrer` : déploie les fichiers, n'active RIEN. C'est le défaut,
#   pour qu'un déploiement de routine ne puisse pas provoquer d'éviction.
set -e

CIBLE="${CCREMOTE_VPS_CIBLE:-vps}"
DISTANT="/home/ubuntu/ccremote"
URL_PI="${CCREMOTE_LIEN_URL_PI:-wss://lien.exemple.com/}"
DEMARRER=0
[ "${1:-}" = "--demarrer" ] && DEMARRER=1

if [ -z "$CCREMOTE_LIEN_SECRET" ]; then
  echo "✗ CCREMOTE_LIEN_SECRET absent — il doit être IDENTIQUE à celui du Pi." >&2
  exit 78
fi

echo "→ Vérification du compte Claude sur le VPS"
if ! ssh "$CIBLE" "test -f \$HOME/.claude-comptes/compte-a/.credentials.json"; then
  echo "✗ compte-a non authentifié sur le VPS." >&2
  echo "  ssh $CIBLE puis : CLAUDE_CONFIG_DIR=~/.claude-comptes/compte-a ~/.bun/bin/claude → /login" >&2
  exit 78
fi
COMPTES=$(ssh "$CIBLE" "ls -d \$HOME/.claude-comptes/*/ 2>/dev/null | xargs -n1 basename | paste -sd,")
echo "  comptes présents : $COMPTES"

echo "→ Envoi des sources du harness"
ssh "$CIBLE" "mkdir -p $DISTANT/harness"
# ☠ Même exclusion que pour le Pi : le registre est en WAL, et `--delete`
# effacerait `-wal`/`-shm` (perte de données réelle payée le 23/07).
rsync -az --delete \
  --exclude node_modules --exclude '*.db' --exclude '*.db-wal' --exclude '*.db-shm' \
  --exclude '.env' --exclude 'logs' \
  /mnt/projects/ccremote/harness/ "$CIBLE:$DISTANT/harness/"

echo "→ Dépendances (Bun)"
ssh "$CIBLE" "cd $DISTANT/harness && \$HOME/.bun/bin/bun install --silent"

# ── Config du poste, portée sur le VPS ──────────────────────────────────────
#
# ☠ Sans elle, les workers du VPS repartent NUS : ni standards, ni skills, ni
# règles. C'est exactement le défaut mesuré le 01/08 sur les comptes du PC — il
# reviendrait ici par la porte du portage. `installer-config-compte.sh` lie vers
# `~/.claude/…` : ces répertoires doivent donc exister côté VPS.
echo "→ Portage de la configuration du poste (skills, règles, référence)"
ssh "$CIBLE" "mkdir -p \$HOME/.claude"
for d in skills rules commands reference; do
  if [ -d "$HOME/.claude/$d" ]; then
    rsync -az --delete "$HOME/.claude/$d/" "$CIBLE:.claude/$d/"
    echo "  $d porté"
  fi
done

# ☠ `settings.json` est FILTRÉ, jamais copié tel quel : les hooks du poste
# lancent `bun run /mnt/projects/claude-arcade/...`, un chemin qui n'existe pas
# sur le VPS. Un hook `SessionStart` qui échoue s'exécute à CHAQUE démarrage de
# worker — au mieux du bruit, au pire un démarrage plus lent pour rien. On garde
# les réglages, on retire ce qui pointe vers des chemins du poste.
echo "→ Réglages (hooks du poste retirés — chemins inexistants sur le VPS)"
python3 - "$CIBLE" <<'PY'
import json, subprocess, sys
cible = sys.argv[1]
with open('/home/trinity/.claude/settings.json') as f:
    s = json.load(f)
s.pop('hooks', None)
s.pop('statusLine', None)
s.pop('enabledPlugins', None)
subprocess.run(['ssh', cible, 'umask 077 && cat > $HOME/.claude/settings.json'],
               input=json.dumps(s, indent=2), text=True, check=True)
print('  settings.json porté (sans hooks ni plugins du poste)')
PY

echo "→ Configuration des comptes d'équipe"
# ☠ Sans ça, les workers du VPS repartent NUS : ni CLAUDE.md, ni skills, ni
# règles — exactement le défaut mesuré le 01/08 sur les comptes du PC. Le script
# est idempotent et signale ce qui manque.
ssh "$CIBLE" "cd $DISTANT/harness/config-equipe && chmod +x installer-config-compte.sh && \
  for c in \$(ls \$HOME/.claude-comptes); do ./installer-config-compte.sh \$c || true; done" || true

echo "→ Environnement (umask 077)"
# ☠ Le secret passe par stdin, jamais en argument : `ps` est lisible par tous.
LISTE_COMPTES=$(ssh "$CIBLE" "ls -d \$HOME/.claude-comptes/*/ 2>/dev/null | while read d; do printf '%s=%s,' \"\$(basename \$d)\" \"\${d%/}\"; done | sed 's/,\$//'")
ssh "$CIBLE" "mkdir -p \$HOME/.config/ccremote && umask 077 && cat > \$HOME/.config/ccremote/pc.env" <<EOF
PATH=/home/ubuntu/.bun/bin:/usr/local/bin:/usr/bin:/bin
CCREMOTE_PC_REGISTRE_DB=/home/ubuntu/.local/share/ccremote/registre-pc.db
CCREMOTE_LIEN_URL_PI=$URL_PI
CCREMOTE_LIEN_SECRET=$CCREMOTE_LIEN_SECRET
CCREMOTE_PC_COMPTES=$LISTE_COMPTES
EOF
ssh "$CIBLE" "mkdir -p \$HOME/.local/share/ccremote"

echo "→ Unité systemd (utilisateur)"
ssh "$CIBLE" "mkdir -p \$HOME/.config/systemd/user"
scp -q /mnt/projects/ccremote/harness/composition/deploiement/ccremote-pc.service "$CIBLE:/tmp/ccremote-pc.service"
# `%h/ccremote/harness` côté VPS, contre `%h/ccremote` côté PC : le chemin
# diffère, l'unité versionnée reste la même.
ssh "$CIBLE" "sed -i 's#%h/ccremote/harness/composition#%h/ccremote/harness/composition#' /tmp/ccremote-pc.service && \
  mv /tmp/ccremote-pc.service \$HOME/.config/systemd/user/ && systemctl --user daemon-reload"
ssh "$CIBLE" "loginctl enable-linger ubuntu 2>/dev/null || true"

if [ "$DEMARRER" -eq 0 ]; then
  echo ""
  echo "✓ Superviseur déployé sur le VPS — NON démarré (défaut volontaire)."
  echo "  ⚠ Un second superviseur connecté déclenche la tempête d'évictions (dette n°6)."
  echo "  Pour basculer :  systemctl --user stop ccremote-pc   (sur le PC)"
  echo "                   ./deploy-superviseur-vps.sh --demarrer"
  exit 0
fi

# ── Bascule ────────────────────────────────────────────────────────────────
# ☠ Garde-fou NON contournable : on refuse de démarrer tant que l'autre
# superviseur vit. Deux clients simultanés produisent une éviction en boucle
# (1268 observées), et le symptôme — des workers qui meurent sans raison — ne
# ressemble PAS à sa cause.
echo "→ Vérification qu'aucun autre superviseur ne tourne"
if systemctl --user is-active ccremote-pc >/dev/null 2>&1; then
  echo "✗ le superviseur du PC tourne encore — démarrage refusé." >&2
  echo "  systemctl --user stop ccremote-pc   puis relancer ce script." >&2
  exit 75
fi

echo "→ Démarrage du superviseur sur le VPS"
ssh "$CIBLE" "systemctl --user enable --now ccremote-pc && sleep 6 && systemctl --user is-active ccremote-pc"
echo ""
echo "✓ Superviseur actif sur le VPS."
echo "  Vérifier le rattachement :  bun harness/pilotage/pilote.ts sante"
