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

# ── Racine des projets ──────────────────────────────────────────────────────
#
# ☠ `/mnt/projects` est la racine EN DUR du superviseur
# (`superviseur-workers.ts` : `deps.racineProjets ?? '/mnt/projects'`), et les
# mandats portent des chemins ABSOLUS (`/mnt/projects/stockiop`). Elle doit donc
# porter le même nom sur toutes les machines de travail : la rendre configurable
# casserait tout mandat déjà émis. Absente, `explorer_projets` répond « chemin
# inexistant » — mesuré en production juste après la bascule.
#
# ☠ Sur le VPS c'est un LIEN vers `~/dev`, jamais un dossier à part : les
# projets y sont des clones git sur lesquels on travaille, à CÔTÉ de `~/prod`
# qui sert le trafic réel. Deux copies d'un même projet au même endroit finiraient
# par se confondre, et une équipe autonome écrirait dans la production.
#
# ☠ Le lien ne casse pas le confinement : `explorerProjets` compare des chemins
# résolus lexicalement (les cibles restent sous `/mnt/projects/`), et
# `lecture-fichier.ts` applique `realpathSync` à la racine ET à la cible — les
# deux se résolvent alors vers `~/dev`. Vérifié en réel après la bascule.
# ── Outillage de la machine de travail ──────────────────────────────────────
#
# ☠ `rg` EST UNE DÉPENDANCE DURE, PAS UN CONFORT. `rechercher_projets` le
# `Bun.spawn` directement : absent, l'outil rendait `occurrences: []` avec une
# note en fin de charge utile — c'est-à-dire la FORME EXACTE d'une recherche
# fructueuse mais vide. Deux fois en production (01/08 sur `stockiop/security`,
# 02/08 sur `bac-a-sable`), l'orchestrateur a reçu « rien trouvé » sur des dépôts
# qui contenaient la réponse ; il l'a relevé lui-même au test des 23 outils. Le
# code a désormais un repli `grep` et un drapeau d'échec, mais le vrai correctif
# est ici : la machine part avec ses outils, et le déploiement le DIT.
#
# ☠ Ni `node` ni `npm` : la doctrine est Bun, et l'installer ici ferait diverger
# les machines de travail de la règle du poste. Une équipe qui en a besoin le
# demande dans son rapport.
OUTILS_REQUIS="ripgrep tree jq unzip"
echo "→ Outillage de la machine (rg est une dépendance de rechercher_projets)"
ssh "$CIBLE" "manquants=''; \
  for paire in 'rg:ripgrep' 'tree:tree' 'jq:jq' 'unzip:unzip'; do \
    bin=\${paire%%:*}; paquet=\${paire##*:}; \
    command -v \$bin >/dev/null 2>&1 || manquants=\"\$manquants \$paquet\"; \
  done; \
  if [ -n \"\$manquants\" ]; then \
    echo \"  installation :\$manquants\"; \
    sudo -n apt-get install -y \$manquants >/dev/null 2>&1 || echo '  ⚠ installation impossible (sudo ?)'; \
  fi; \
  for bin in rg tree jq unzip; do \
    command -v \$bin >/dev/null 2>&1 || echo \"  ✗ \$bin TOUJOURS ABSENT\"; \
  done; \
  command -v rg >/dev/null 2>&1 && echo '  ✓ rg présent — rechercher_projets opérationnel' \
    || echo '  ✗ rg ABSENT — rechercher_projets tombera sur son repli grep'"

RACINE_DEV="${CCREMOTE_VPS_RACINE_DEV:-/home/ubuntu/dev}"
echo "→ Racine des projets (/mnt/projects → $RACINE_DEV)"
ssh "$CIBLE" "mkdir -p '$RACINE_DEV'; \
  if [ -L /mnt/projects ]; then :; \
  elif [ -d /mnt/projects ]; then sudo rmdir /mnt/projects 2>/dev/null || { echo '  ⚠ /mnt/projects est un dossier NON vide — laissé tel quel'; exit 0; }; fi; \
  [ -e /mnt/projects ] || sudo ln -s '$RACINE_DEV' /mnt/projects" 2>/dev/null \
  || echo "  ⚠ lien non posé (sudo requis) — les équipes ne trouveront aucun projet"
echo "  $(ssh "$CIBLE" 'ls -ld /mnt/projects 2>/dev/null | sed "s/.*ubuntu //" || echo ABSENTE')"

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
# ☠ `CCREMOTE_PC_COMPTES` N'EST PLUS ÉCRITE, et c'est le correctif. Elle figeait
# la liste des comptes AU MOMENT DU DÉPLOIEMENT : un compte authentifié plus tard
# restait inconnu du superviseur — sonde de quotas aveugle, et surtout repertoire
# non résolu (H-44), donc equipe refusee au pre-vol. Mesure le 01/08 sur
# compte-b du VPS, connecte et pourtant inutilisable. Le superviseur decouvre
# desormais ses comptes sur le disque a chaque demarrage
# (`composition/pc/decouverte-comptes.ts`) ; la variable reste une surcharge
# manuelle pour une installation atypique.
# ☠ Normalisée comme côté code (`identite-machine.ts`) : minuscules, et
# uniquement ce que le motif accepte. Une identité refusée par le Pi produirait
# une fermeture 4403 terminale, donc un service qui redémarre en boucle.
# ☠ Le hostname est capturé AVANT la transformation : `$(...)` ne retire le saut
# de ligne final qu'à la fin de la substitution — appliqué dans le pipe, `tr -c`
# le convertissait d'abord en « - » et produisait `vps-e411b5c7-` (mesuré).
HOSTNAME_DISTANT="$(ssh "$CIBLE" hostname)"
MACHINE_ID="${CCREMOTE_VPS_MACHINE_ID:-$(printf '%s' "$HOSTNAME_DISTANT" | tr 'A-Z' 'a-z' | tr -c 'a-z0-9._-' '-' | cut -c1-63)}"
echo "  identité de machine : $MACHINE_ID"
MEMOIRE_URL_LECTURE="${CCREMOTE_MEMOIRE_URL_LECTURE:-https://memoire.exemple.com/lecture/mcp}"
MEMOIRE_JETON_LECTURE="${CCREMOTE_MEMOIRE_JETON_LECTURE:-$(cat "$HOME/.config/semantic-memory/token-lecture" 2>/dev/null)}"
[ -n "$MEMOIRE_JETON_LECTURE" ] || echo "  ⚠ jeton de lecture de la mémoire absent — les équipes du VPS n'auront PAS la mémoire" 
# ☠ Le secret passe par stdin, jamais en argument : `ps` est lisible par tous.
ssh "$CIBLE" "mkdir -p \$HOME/.config/ccremote && umask 077 && cat > \$HOME/.config/ccremote/pc.env" <<EOF
PATH=/home/ubuntu/.bun/bin:/usr/local/bin:/usr/bin:/bin
CCREMOTE_PC_REGISTRE_DB=/home/ubuntu/.local/share/ccremote/registre-pc.db
CCREMOTE_LIEN_URL_PI=$URL_PI
CCREMOTE_LIEN_SECRET=$CCREMOTE_LIEN_SECRET
# Identite de cette machine sur le lien (V2 du 01/08). Le defaut cote code est
# le hostname, deja distinct partout — elle est FIXEE ici pour qu'un changement
# de hostname ne fasse pas apparaitre une nouvelle machine, laissant les
# missions en cours pointer vers une identite que plus personne ne porte.
# (Sans accents ni antiquotes : ce bloc part dans un heredoc NON quote, ou une
#  antiquote serait executee — defaut mesure le 01/08, hostname() evalue.)
CCREMOTE_MACHINE_ID=$MACHINE_ID
# Memoire semantique : point d'acces en LECTURE SEULE pour les equipes.
# Regle posee par Chris le 01/08 : tout le travail depuis ccremote lit la
# memoire, seules ses sessions personnelles l'ecrivent (H-66). Absent, la
# memoire est RETIREE de la boite a outils des equipes plutot que passee en
# ecriture (voir harness/workers/mcp-du-poste.ts).
CCREMOTE_MEMOIRE_URL_LECTURE=$MEMOIRE_URL_LECTURE
CCREMOTE_MEMOIRE_JETON_LECTURE=$MEMOIRE_JETON_LECTURE
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
  echo "  Depuis la V2 (01/08), il peut tourner EN MÊME TEMPS que celui du PC."
  echo "  Pour l'activer :  ./deploy-superviseur-vps.sh --demarrer"
  exit 0
fi

# ── Bascule ────────────────────────────────────────────────────────────────
# ☠ Garde-fou NON contournable : on refuse de démarrer tant que l'autre
# superviseur vit. Deux clients simultanés produisent une éviction en boucle
# (1268 observées), et le symptôme — des workers qui meurent sans raison — ne
# ressemble PAS à sa cause.
# ☠ GARDE-FOU LEVÉ le 2026-08-01, et c'était l'objet du chantier multi-machines.
# Il interdisait deux superviseurs simultanés parce que le Pi ne tenait QU'UN
# emplacement de connexion : la seconde évinçait la première, en boucle (dette
# n°6, 1268 évictions mesurées le 22/07). Depuis la V2, chaque machine s'annonce
# avec une identité et possède son propre lien — le supersede ne joue plus qu'à
# identité ÉGALE, c'est-à-dire deux process d'une même machine.
#
# ☠ Ce qui RESTE vrai, et qui ne doit pas être perdu : deux process sur LA MÊME
# machine s'évincent toujours. C'est voulu (reprise après crash), mais ça veut
# dire qu'on ne lance pas deux fois `ccremote-pc` sur un même hôte.
echo "→ Cohabitation : le Pi accepte plusieurs machines identifiées (V2, 01/08)"

# ☠ `restart`, JAMAIS `enable --now` (correctif du 03/08). `--now` ne fait que
# DÉMARRER un service arrêté : sur un service déjà actif il ne fait rien, et le
# process continue d'exécuter le code d'avant le rsync. Mesuré : le superviseur du
# VPS tournait depuis le 01/08 16:25 UTC (NRestarts=0) alors que le correctif
# « tâches de fond » était sur son disque depuis le 02/08 18:38. L'équipe de test
# du lendemain matin a donc tourné sous l'ancien code et échoué exactement comme
# le bug d'origine — un test qui n'a rien testé, et deux heures pour le voir.
echo "→ Redémarrage du superviseur sur le VPS (restart, pas enable --now)"
ssh "$CIBLE" "export XDG_RUNTIME_DIR=/run/user/\$(id -u); systemctl --user enable ccremote-pc >/dev/null 2>&1; \
  systemctl --user restart ccremote-pc && sleep 6 && systemctl --user is-active ccremote-pc"

# ☠ LE CONTRÔLE QUI REND LE MENSONGE IMPOSSIBLE. Un déploiement « réussi » ne
# prouve rien tant que le process qui SERT n'est pas plus récent que le code
# déployé. On compare donc les deux faits, sur la machine, après coup : s'il
# existe une seule source plus récente que le démarrage du process, le
# déploiement ÉCHOUE bruyamment plutôt que d'annoncer une livraison imaginaire.
echo "→ Contrôle de fraîcheur : le process est-il plus récent que le code ?"
ssh "$CIBLE" "export XDG_RUNTIME_DIR=/run/user/\$(id -u); \
  demarre=\$(systemctl --user show ccremote-pc -p ExecMainStartTimestamp --value); \
  epoch=\$(date -d \"\$demarre\" +%s 2>/dev/null || echo 0); \
  perimes=\$(find $DISTANT/harness -name '*.ts' -newermt \"@\$epoch\" -not -path '*/node_modules/*' | head -5); \
  if [ -z \"\$demarre\" ] || [ \"\$epoch\" = 0 ]; then echo '  ⚠ heure de démarrage illisible — contrôle impossible'; exit 1; fi; \
  if [ -n \"\$perimes\" ]; then echo '  ✗ PROCESS PÉRIMÉ — sources plus récentes que le process :'; echo \"\$perimes\"; exit 1; fi; \
  echo \"  ✓ process démarré le \$demarre, postérieur à toutes les sources\""
echo ""
echo "✓ Superviseur actif sur le VPS, et il exécute bien le code qu'on vient d'envoyer."
echo "  Vérifier le rattachement :  bun harness/pilotage/pilote.ts sante"
