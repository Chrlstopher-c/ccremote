#!/bin/bash
# deployer-en-production.sh — LA commande unique de mise en production du
# harness ccremote vers le Pi. Écrite pour Chris, qui la lance depuis son
# téléphone sans lire ce qu'elle exécute : chaque étape s'annonce en une
# ligne, un doute se traduit par un refus explicite plutôt qu'un
# demi-déploiement, et rien n'est jamais écrasé sans sauvegarde préalable
# horodatée.
#
# Ce script N'INVENTE AUCUNE LOGIQUE DE DÉPLOIEMENT : il prépare le dépôt
# (copie de travail cohérente avec `master`, branches d'équipe fusionnées,
# suite de tests verte) puis APPELLE `deploy-harness-pi.sh`, qui seul sait
# parler au Pi — il ne le réécrit pas.
#
# Usage :
#   CCREMOTE_LIEN_SECRET=... ./deployer-en-production.sh [pi-user@pi-ip]
#
# Ce que tu verras si tout se passe bien : cinq étapes numérotées, chacune
# suivie d'un « ✓ », puis « ✓ MISE EN PRODUCTION TERMINÉE » à la toute fin.
# N'importe quelle ligne commençant par « ✗ » veut dire : RIEN n'a été
# déployé, et le message qui la précède explique pourquoi.
#
# ☠ CE SCRIPT REDÉMARRE LE SERVICE DU HARNESS SUR LE PI (étape 4). Toute
# équipe ou session en cours là-bas est coupée au même instant, sans reprise
# automatique — lance-le seulement quand tu es prêt à ce que ça arrive.
#
# Idempotent : relancé deux fois de suite, la deuxième fois ne trouve plus
# rien à corriger ni à fusionner et se contente de revérifier puis
# redéployer — jamais de double dégât.
#
# Fonctionne depuis N'IMPORTE QUEL répertoire d'appel, et même si ce fichier
# n'existe pas encore sur le disque : voir le mode d'emploi dans le dépôt
# pour la ligne à taper dans ce cas (le script se retrouve lui-même une fois
# posé n'importe où, y compris hors du dépôt).
set -e

# ── Auto-protection : ce script s'apprête à réorganiser le dépôt sous ses
#    propres pieds (étapes 1 et 2 : mise de côté, alignement sur master,
#    fusions). Un shell lit un script AU FIL de son exécution — si le
#    fichier qu'il est en train de lire est déplacé ou modifié en cours de
#    route (ce que `git stash`/`git reset --hard`/`git merge` peuvent tous
#    faire à ce fichier lui-même, puisqu'il est suivi par git), l'exécution
#    peut dérailler en plein milieu, sur le chemin le plus sensible du
#    dépôt. Avant de toucher à quoi que ce soit, on se recopie donc dans un
#    répertoire HORS du dépôt et on s'y relance — cette copie ne peut plus
#    être atteinte par aucune opération git qui suit.
#
#    `_DEPLOYER_RACINE` porte la racine du dépôt déjà trouvée d'un relais à
#    l'autre : une fois relancé depuis /tmp, `dirname "$0"` ne pointerait
#    plus vers rien d'utile pour la retrouver.
if [ -z "${_DEPLOYER_RACINE:-}" ]; then
  if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "${BASH_SOURCE[0]}" ]; then
    DIR_SOURCE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  else
    # Invoqué via un pipe (`... | bash`) : pas de fichier source à localiser,
    # on retrouve la racine depuis le répertoire d'où on nous a appelés.
    DIR_SOURCE="$(pwd)"
  fi

  # DIR_SOURCE est-il LUI-MÊME dans un dépôt git ? Si oui, c'est depuis là
  # que la racine doit être déterminée (cas normal : script lancé depuis le
  # dépôt). Si non (DIR_SOURCE est déjà hors dépôt, ex. /tmp), la racine se
  # retrouve plutôt depuis le répertoire d'appel courant.
  if RACINE_DETECTEE="$(git -C "$DIR_SOURCE" rev-parse --show-toplevel 2>/dev/null)"; then
    DEPUIS_LE_DEPOT=1
  else
    RACINE_DETECTEE="$(git rev-parse --show-toplevel 2>/dev/null)" || RACINE_DETECTEE=""
    DEPUIS_LE_DEPOT=0
  fi

  if [ -z "$RACINE_DETECTEE" ]; then
    echo "" >&2
    echo "✗ impossible de retrouver la racine du dépôt ccremote — ni depuis $DIR_SOURCE, ni depuis $(pwd)." >&2
    echo "  RIEN n'a été déployé." >&2
    echo "  Relance depuis un répertoire à l'intérieur du dépôt ccremote." >&2
    exit 77
  fi

  if [ "$DEPUIS_LE_DEPOT" = "1" ]; then
    # On est encore DANS le dépôt : se recopier hors du dépôt puis s'y
    # relancer, avant que la moindre commande git mutante ne s'exécute.
    if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "${BASH_SOURCE[0]}" ]; then
      COPIE_PROTEGEE="$(mktemp -t deployer-en-production.XXXXXX.sh)"
      cat "${BASH_SOURCE[0]}" > "$COPIE_PROTEGEE"
      chmod +x "$COPIE_PROTEGEE"
      exec env _DEPLOYER_RACINE="$RACINE_DETECTEE" bash "$COPIE_PROTEGEE" "$@"
    fi
    # Invoqué via un pipe alors qu'on est DANS le dépôt (`git show ... | bash`
    # exécuté depuis l'intérieur du dépôt) : bash a déjà consommé toute notre
    # source depuis stdin, impossible de la relire pour la recopier. La
    # protection vient alors d'ailleurs : tout le script est déjà chargé en
    # mémoire par CE processus bash avant que la première commande ne
    # s'exécute — aucune étape suivante ne peut donc altérer ce que ce
    # processus a déjà lu. On continue directement.
  fi
  # Sinon : notre source vit déjà hors du dépôt (copie temporaire, ou script
  # extrait via `git show` dans /tmp) — déjà à l'abri, pas de second saut.

  RACINE="$RACINE_DETECTEE"
else
  RACINE="$_DEPLOYER_RACINE"
fi

HARNESS="$RACINE/harness"
TARGET="${1:-pi@pi.exemple}"

annoncer() { echo ""; echo "→ Étape $1/5 — $2"; }
refuser() {
  echo "" >&2
  echo "✗ $1" >&2
  echo "  RIEN n'a été déployé." >&2
  exit "${2:-1}"
}

echo "════════════════════════════════════════════════════════════════════"
echo " Mise en production du harness ccremote → $TARGET"
echo "════════════════════════════════════════════════════════════════════"

# ── 0. Le secret du lien doit exister AVANT de préparer quoi que ce soit —
#      inutile de fusionner des branches et de faire tourner 1800+ tests pour
#      un déploiement qui refusera de toute façon à la toute dernière étape. ─
if [ -z "$CCREMOTE_LIEN_SECRET" ]; then
  refuser "CCREMOTE_LIEN_SECRET absent. Générer une fois : openssl rand -hex 32 — puis le conserver, il doit être identique sur le Pi et sur le PC." 78
fi

cd "$RACINE"

# ── 1. Copie de travail COHÉRENTE avec master ────────────────────────────
annoncer 1 "copie de travail cohérente avec master"

BRANCHE_ACTUELLE="$(git rev-parse --abbrev-ref HEAD)"
if [ "$BRANCHE_ACTUELLE" != "master" ]; then
  refuser "la copie de travail n'est pas sur master (actuellement : $BRANCHE_ACTUELLE). Ce script ne bascule jamais de branche à ta place — reviens sur master (git checkout master) puis relance."
fi

HEAD_ACTUEL="$(git rev-parse HEAD)"
if [ -n "$(git status --porcelain)" ]; then
  HORODATAGE="$(date +%Y%m%d-%H%M%S)"
  echo "  ⚠ la copie de travail diverge de master ($HEAD_ACTUEL) — sauvegarde AVANT toute correction."
  # `☠` `git stash` est LA sauvegarde horodatée demandée : elle capture tout
  # ce qui diffère (fichiers modifiés, supprimés, non suivis) dans un commit
  # récupérable (`git stash pop`), jamais écrasé par la suite de ce script.
  # On ne tranche jamais ici « c'est juste l'artefact d'une désynchronisation »
  # — cette distinction reste impossible à faire à l'aveugle, donc on
  # sauvegarde toujours, que ce soit du travail réel ou non.
  git stash push --include-untracked --message "avant-prod-$HORODATAGE" >/dev/null
  echo "  ✓ mise de côté horodatée : « avant-prod-$HORODATAGE » (visible avec : git stash list)"
  echo "  → remise en cohérence avec master ($HEAD_ACTUEL)"
  git reset --hard HEAD >/dev/null
  if [ -n "$(git status --porcelain)" ]; then
    refuser "la copie de travail reste incohérente après remise en cohérence — la sauvegarde reste disponible (git stash list), rien n'a été perdu, mais quelque chose échappe à ce script. Inspection manuelle requise."
  fi
  echo "  ✓ copie de travail alignée sur master ($HEAD_ACTUEL)"
else
  echo "  ✓ déjà cohérente avec master ($HEAD_ACTUEL) — rien à corriger"
fi

# ── 2. Fusion des branches d'équipe restantes, EN LOCAL ──────────────────
annoncer 2 "fusion des branches d'équipe restantes"

# `☠` Découverte À L'EXÉCUTION, jamais une liste écrite en dur : le nombre de
# branches d'équipe en attente le jour où Chris lance ce script est inconnu
# aujourd'hui — une liste figée serait fausse dès la première équipe
# supplémentaire. On ne garde que celles qui ne sont PAS déjà des ancêtres de
# master (donc déjà fusionnées), triées par la date de leur DERNIER commit —
# c'est cet ordre chronologique qui rend une fusion suivante d'un conflit
# éventuel imputable à la bonne branche, jamais à celle d'avant.
BRANCHES_A_FUSIONNER=()
while IFS= read -r branche; do
  [ -z "$branche" ] && continue
  git merge-base --is-ancestor "$branche" HEAD 2>/dev/null && continue
  BRANCHES_A_FUSIONNER+=("$branche")
done < <(git for-each-ref --sort=committerdate --format='%(refname:short)' 'refs/heads/equipe/*')

if [ ${#BRANCHES_A_FUSIONNER[@]} -eq 0 ]; then
  echo "  ✓ aucune branche d'équipe en attente — master est déjà à jour"
else
  echo "  ${#BRANCHES_A_FUSIONNER[@]} branche(s) candidate(s), dans l'ordre chronologique :"
  for b in "${BRANCHES_A_FUSIONNER[@]}"; do echo "    · $b"; done

  # `☠` Deux équipes lancées puis arrêtées par Chris quelques secondes après
  # leur démarrage n'ont produit aucun travail exploitable — leurs branches ne
  # doivent SURTOUT PAS être fusionnées : au mieux vides, au pire un état
  # jamais testé. Deux filtres MÉCANIQUES avant toute fusion, jamais une
  # supposition :
  #   1. AUCUNE différence de fichier avec master ⇒ rien à fusionner, écartée
  #      en silence (pas une erreur : une branche créée puis jamais avancée).
  #   2. Un message de commit qui SENT l'état intermédiaire (WIP, checkpoint,
  #      brouillon, « ne pas fusionner »…) ⇒ impossible de garantir qu'elle a
  #      été testée et validée : le script s'ARRÊTE et la NOMME, plutôt que de
  #      deviner. `todo:` volontairement ABSENT de cette liste — une branche
  #      qui modifie légitimement TODO.md ne doit jamais être accusée à tort.
  MOTIFS_INTERMEDIAIRES='(^|[^a-zA-Z])(wip|checkpoint|draft|brouillon|en[ _-]?cours|\btmp\b|\btemp\b|fixup!|squash!|ne pas (fusionner|merger)|do not merge|incomplet|intermédiaire)([^a-zA-Z]|$)'

  BRANCHES_RETENUES=()
  for b in "${BRANCHES_A_FUSIONNER[@]}"; do
    if [ -z "$(git diff master.."$b" --stat)" ]; then
      echo "  = $b écartée : aucune différence avec master (créée puis jamais avancée) — rien à fusionner"
      continue
    fi
    MESSAGES="$(git log --format=%s master.."$b")"
    if echo "$MESSAGES" | grep -qiE "$MOTIFS_INTERMEDIAIRES"; then
      refuser "la branche « $b » porte au moins un commit à message d'état intermédiaire (WIP / checkpoint / brouillon / « ne pas fusionner »…) — impossible de garantir mécaniquement qu'elle a été testée. Elle n'est PAS fusionnée. Inspecte-la à la main (git log master..$b), et si elle est bonne : fusionne-la toi-même (git merge $b) avant de relancer ce script."
    fi
    BRANCHES_RETENUES+=("$b")
  done

  if [ ${#BRANCHES_RETENUES[@]} -eq 0 ]; then
    echo "  ✓ aucune branche retenue après filtrage — master est déjà à jour"
  else
    for b in "${BRANCHES_RETENUES[@]}"; do
      echo "  → fusion de $b"
      if ! git merge --no-edit "$b" >/tmp/deployer-en-production-merge.log 2>&1; then
        git merge --abort 2>/dev/null || true
        echo "" >&2
        cat /tmp/deployer-en-production-merge.log >&2
        refuser "CONFLIT en fusionnant « $b » dans master — la fusion a été annulée (git merge --abort), master reste exactement comme avant cette étape. Résous le conflit à la main (git merge $b), commit, puis relance ce script."
      fi
      echo "    ✓ $b fusionnée"
    done
  fi
fi

# ── 3. Suite de tests — REFUS si elle n'est pas verte ────────────────────
annoncer 3 "suite de tests du harness (bun test)"

cd "$HARNESS"
echo "  installation des dépendances (bun install)…"
if ! bun install --silent >/tmp/deployer-en-production-install.log 2>&1; then
  cat /tmp/deployer-en-production-install.log >&2
  refuser "bun install a échoué dans harness/ — voir le détail ci-dessus."
fi

echo "  vérification des types (bunx tsc --noEmit)…"
if ! SORTIE_TSC="$(bunx tsc --noEmit 2>&1)"; then
  echo "$SORTIE_TSC" >&2
  refuser "des erreurs de typage subsistent (tsc --noEmit) — voir le détail ci-dessus."
fi
echo "    ✓ aucune erreur de typage"

echo "  exécution de la suite de tests…"
if ! SORTIE_TESTS="$(bun test 2>&1)"; then
  echo "$SORTIE_TESTS" | tail -60 >&2
  refuser "la suite de tests n'est PAS verte — voir le détail ci-dessus (60 dernières lignes)."
fi
if echo "$SORTIE_TESTS" | grep -qE '^ *[1-9][0-9]* skip$'; then
  echo "$SORTIE_TESTS" | tail -10 >&2
  refuser "des tests sont ignorés (skip) — le critère est une suite verte SANS test ignoré."
fi
echo "$SORTIE_TESTS" | tail -4
echo "    ✓ suite de tests verte, aucun test ignoré"

cd "$RACINE"

# ── 4. Déploiement du control plane du harness vers le Pi ────────────────
annoncer 4 "déploiement vers le Pi (deploy-harness-pi.sh — script existant, inchangé)"
echo "  ☠ ceci redémarre le service sur le Pi — toute équipe qui y tourne est coupée."

if ! ./deploy-harness-pi.sh "$TARGET"; then
  refuser "deploy-harness-pi.sh a échoué — voir le détail ci-dessus. Le Pi peut être dans un état intermédiaire ; relancer ce script est sûr (idempotent)."
fi

# ── 5. Vérification finale ────────────────────────────────────────────────
annoncer 5 "vérification finale"
# `☠` `deploy-harness-pi.sh` a DÉJÀ vérifié, avant de rendre la main : le
# service est actif (systemctl is-active), répond (curl /api/harness/health)
# et son heure de démarrage est POSTÉRIEURE à toutes les sources (contrôle de
# fraîcheur, en fin de ce script — voir son code). S'il avait échoué sur l'un
# de ces trois points, `set -e` de ce script-ci se serait déjà arrêté à
# l'étape 4, avant d'arriver ici. Cette étape est donc la confirmation écrite
# de ce qui vient d'être établi, pas une nouvelle mesure redondante.
echo "  ✓ service actif sur le Pi (vérifié par deploy-harness-pi.sh)"
echo "  ✓ endpoint de santé a répondu (vérifié par deploy-harness-pi.sh)"
echo "  ✓ le service tourne un code POSTÉRIEUR à toutes les sources déployées"

echo ""
echo "════════════════════════════════════════════════════════════════════"
echo "✓ MISE EN PRODUCTION TERMINÉE"
echo "════════════════════════════════════════════════════════════════════"
