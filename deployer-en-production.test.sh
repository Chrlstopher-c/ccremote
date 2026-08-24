#!/bin/bash
# deployer-en-production.test.sh — vérifie MÉCANIQUEMENT, sans jamais toucher
# au vrai dépôt ccremote ni au Pi :
#
#   1. il retrouve seul la racine du dépôt quel que soit le répertoire ou le
#      chemin (relatif/absolu) depuis lequel on l'appelle ;
#   2. avant de toucher au dépôt, il se recopie dans un emplacement HORS du
#      dépôt et s'y relance — cette copie est ensuite immunisée contre toute
#      réorganisation du dépôt qui suivrait (stash / reset / merge) ;
#   3. la branche cible est un paramètre explicite et obligatoire : sans elle,
#      refus (code 79) ; si elle ne descend pas directement de master, refus
#      aussi (code 81, avance rapide impossible).
#
# Chaque cas construit un dépôt git JETABLE dans /tmp (jamais ccremote), lance
# le script avec CCREMOTE_LIEN_SECRET volontairement ABSENT (cas 1) ou une
# branche cible volontairement absente/orpheline (cas 5 et 6) — l'exécution
# s'arrête donc juste après le garde-fou concerné, sans jamais lancer
# bun/tsc/ssh.
#
# Usage : bash deployer-en-production.test.sh
set -e

SCRIPT_SOURCE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/deployer-en-production.sh"
BRANCHE_CIBLE_TEST="cible"
ECHECS=0

verifier() {
  if [ "$1" = "$2" ]; then
    echo "  ✓ $3"
  else
    echo "  ✗ $3 — attendu « $2 », obtenu « $1 »" >&2
    ECHECS=$((ECHECS + 1))
  fi
}

# ── Construit un dépôt git jetable minimal, avec sa propre copie du script
#    et un `deploy-harness-pi.sh` factice (jamais atteint : l'exécution
#    s'arrête à l'étape 0, avant l'étape 4). ─────────────────────────────
construire_depot_jetable() {
  local depot
  depot="$(mktemp -d -t deployer-test-depot.XXXXXX)"
  git -C "$depot" init --quiet -b master
  git -C "$depot" -c user.email=test@test -c user.name=test commit --quiet --allow-empty -m init
  cp "$SCRIPT_SOURCE" "$depot/deployer-en-production.sh"
  chmod +x "$depot/deployer-en-production.sh"
  printf '#!/bin/bash\necho "ne doit jamais tourner dans ce test"\nexit 1\n' > "$depot/deploy-harness-pi.sh"
  chmod +x "$depot/deploy-harness-pi.sh"
  # `harness/` vide, sans package.json : `bun install` y échoue vite et
  # proprement (testé manuellement — pas d'attente). Ce qui compte n'est pas
  # que l'étape 3 réussisse (elle ne peut pas, ce n'est pas un vrai projet
  # bun), mais qu'on l'ATTEIGNE — preuve que RACINE/HARNESS ont été
  # correctement résolus, quel que soit l'endroit d'où le script fut appelé.
  mkdir -p "$depot/harness"

  # Branche cible VALIDE (descend directement de master, un commit d'avance) —
  # sert aux cas 1 à 4, qui exercent l'auto-protection / la résolution de
  # racine, pas la validation de la branche elle-même.
  git -C "$depot" checkout --quiet -b "$BRANCHE_CIBLE_TEST"
  git -C "$depot" -c user.email=test@test -c user.name=test commit --quiet --allow-empty -m "avance sur $BRANCHE_CIBLE_TEST"
  git -C "$depot" checkout --quiet master

  # Branche ORPHELINE — ne descend PAS de master — sert au cas 6 (refus
  # attendu : avance rapide impossible).
  git -C "$depot" checkout --quiet --orphan orpheline
  git -C "$depot" -c user.email=test@test -c user.name=test commit --quiet --allow-empty -m "branche sans lien avec master"
  git -C "$depot" checkout --quiet master

  echo "$depot"
}

# ── Lance le script avec le secret FOURNI (contrairement à
#    lancer_jusquau_refus) et affirme qu'il a bien atteint l'étape 3 —
#    discriminant réel d'une racine correctement résolue : une racine fausse
#    (ex. /tmp au lieu du dépôt) ferait échouer `cd "$HARNESS"` bien AVANT
#    l'étape 3, avec un message d'erreur bash générique, pas le nôtre. ─────
lancer_et_verifier_racine() {
  local sortie
  sortie="$(env CCREMOTE_LIEN_SECRET=peu-importe bash "$@" 2>&1 || true)"
  case "$sortie" in
    *'→ Étape 3/5'*) echo "OK" ;;
    *) echo "RACINE_FAUSSE: $sortie" ;;
  esac
}

# ── Lance le script (secret absent -> refus attendu au code 78, PREUVE que
#    le garde-fou d'auto-protection s'est déroulé sans erreur avant lui) et
#    retourne son code de sortie. ─────────────────────────────────────────
lancer_jusquau_refus() {
  local sortie code
  set +e
  sortie="$(env -u CCREMOTE_LIEN_SECRET bash "$@" 2>&1)"
  code=$?
  set -e
  echo "$code"
}

echo "═══ Cas 1 — appel normal, depuis l'intérieur du dépôt jetable ═══"
DEPOT1="$(construire_depot_jetable)"
AVANT="$(ls /tmp/deployer-en-production.*.sh 2>/dev/null || true)"
CODE="$(cd "$DEPOT1" && lancer_jusquau_refus ./deployer-en-production.sh "$BRANCHE_CIBLE_TEST")"
verifier "$CODE" "78" "refus normal à l'étape 0 (secret absent) — le garde-fou n'a pas fait dérailler l'exécution"

APRES="$(ls /tmp/deployer-en-production.*.sh 2>/dev/null || true)"
NOUVELLE_COPIE="$(comm -13 <(echo "$AVANT" | sort) <(echo "$APRES" | sort) | head -1)"
if [ -n "$NOUVELLE_COPIE" ] && [ -f "$NOUVELLE_COPIE" ]; then
  echo "  ✓ une copie protégée est apparue hors du dépôt : $NOUVELLE_COPIE"
  case "$NOUVELLE_COPIE" in
    "$DEPOT1"/*) echo "  ✗ la copie est SOUS le dépôt jetable — pas protégée" >&2; ECHECS=$((ECHECS + 1)) ;;
    *) echo "  ✓ la copie n'est PAS sous le dépôt ($DEPOT1)" ;;
  esac
  if git -C "$(dirname "$NOUVELLE_COPIE")" rev-parse --show-toplevel >/dev/null 2>&1; then
    echo "  ✗ le dossier de la copie appartient encore à un dépôt git" >&2
    ECHECS=$((ECHECS + 1))
  else
    echo "  ✓ le dossier de la copie n'appartient à AUCUN dépôt git"
  fi
else
  echo "  ✗ aucune copie protégée détectée dans /tmp" >&2
  ECHECS=$((ECHECS + 1))
fi

echo ""
echo "═══ Cas 2 — appel par chemin RELATIF depuis un sous-répertoire ═══"
DEPOT2="$(construire_depot_jetable)"
mkdir -p "$DEPOT2/un/sous/dossier"
RESULTAT="$(cd "$DEPOT2/un/sous/dossier" && lancer_et_verifier_racine ../../../deployer-en-production.sh "$BRANCHE_CIBLE_TEST")"
verifier "$RESULTAT" "OK" "racine retrouvée malgré un appel relatif profond"

echo ""
echo "═══ Cas 3 — appel par chemin ABSOLU depuis un répertoire hors dépôt ═══"
DEPOT3="$(construire_depot_jetable)"
RESULTAT="$(cd /tmp && lancer_et_verifier_racine "$DEPOT3/deployer-en-production.sh" "$BRANCHE_CIBLE_TEST")"
verifier "$RESULTAT" "OK" "racine retrouvée malgré un cwd totalement étranger au dépôt"

echo ""
echo "═══ Cas 4 — script déjà HORS du dépôt (bootstrap via mktemp), cwd DANS le dépôt ═══"
DEPOT4="$(construire_depot_jetable)"
COPIE_EXTERNE="$(mktemp -t deployer-bootstrap.XXXXXX.sh)"
cp "$SCRIPT_SOURCE" "$COPIE_EXTERNE"
chmod +x "$COPIE_EXTERNE"
RESULTAT="$(cd "$DEPOT4" && lancer_et_verifier_racine "$COPIE_EXTERNE" "$BRANCHE_CIBLE_TEST")"
verifier "$RESULTAT" "OK" "racine retrouvée depuis le cwd quand la source est déjà hors dépôt (cas du bootstrap)"

echo ""
echo "═══ Cas 5 — secret présent mais AUCUNE branche cible ═══"
DEPOT5="$(construire_depot_jetable)"
set +e
SORTIE5="$(cd "$DEPOT5" && env CCREMOTE_LIEN_SECRET=peu-importe bash ./deployer-en-production.sh 2>&1)"
CODE5=$?
set -e
verifier "$CODE5" "79" "refus au bon code de sortie quand la branche cible est absente"
case "$SORTIE5" in
  *"aucune branche cible n'a été passée en paramètre"*)
    echo "  ✓ message de refus explicite (branche absente)" ;;
  *)
    echo "  ✗ message de refus attendu absent de la sortie — obtenu : $SORTIE5" >&2
    ECHECS=$((ECHECS + 1)) ;;
esac

echo ""
echo "═══ Cas 6 — branche cible qui ne descend PAS de master (avance rapide impossible) ═══"
DEPOT6="$(construire_depot_jetable)"
set +e
SORTIE6="$(cd "$DEPOT6" && env CCREMOTE_LIEN_SECRET=peu-importe bash ./deployer-en-production.sh orpheline 2>&1)"
CODE6=$?
set -e
verifier "$CODE6" "81" "refus au bon code de sortie quand la branche cible ne descend pas de master"
case "$SORTIE6" in
  *"ne descend pas directement de master"*)
    echo "  ✓ message de refus explicite (branche non descendante de master)" ;;
  *)
    echo "  ✗ message de refus attendu absent de la sortie — obtenu : $SORTIE6" >&2
    ECHECS=$((ECHECS + 1)) ;;
esac

# ── Dépôt jetable avec un VRAI mini-harness (bun install/tsc/test passent) —
#    nécessaire pour ATTEINDRE la garde équipes (étape 3bis, entre l'étape 3
#    et l'étape 4), que les dépôts jetables ci-dessus n'atteignent jamais
#    (leur `harness/` vide fait échouer `bun install` avant). Le
#    `deploy-harness-pi.sh` factice pose un fichier marqueur au lieu d'un
#    simple `exit 1` : on peut ainsi prouver mécaniquement si l'étape 4 a été
#    ATTEINTE ou non, ce qui distingue « bloqué par la garde » de « passé au
#    travers ». ──────────────────────────────────────────────────────────
construire_depot_jetable_avec_harness() {
  local depot
  depot="$(mktemp -d -t deployer-test-depot-garde.XXXXXX)"
  git -C "$depot" init --quiet -b master
  git -C "$depot" -c user.email=test@test -c user.name=test commit --quiet --allow-empty -m init
  cp "$SCRIPT_SOURCE" "$depot/deployer-en-production.sh"
  chmod +x "$depot/deployer-en-production.sh"
  printf '#!/bin/bash\ntouch "$(dirname "$0")/DEPLOY_HARNESS_PI_APPELE"\necho "deploy-harness-pi.sh (factice) appelé"\nexit 0\n' \
    > "$depot/deploy-harness-pi.sh"
  chmod +x "$depot/deploy-harness-pi.sh"

  mkdir -p "$depot/harness"
  echo '{"name":"harness-jetable-test","version":"0.0.0"}' > "$depot/harness/package.json"
  echo '{"compilerOptions":{"strict":true,"skipLibCheck":true}}' > "$depot/harness/tsconfig.json"
  printf '// @ts-nocheck\nimport {test,expect} from "bun:test";\ntest("ok", () => expect(1).toBe(1));\n' \
    > "$depot/harness/trivial.test.ts"
  # `☠` COMMIS, jamais laissé untracked : l'étape 1 du script (copie de
  # travail cohérente avec master) fait un `git stash --include-untracked`
  # dès qu'il voit quoi que ce soit de non suivi — ce mini-harness
  # disparaîtrait avant même d'atteindre l'étape 3 s'il restait untracked.
  git -C "$depot" add -A
  git -C "$depot" -c user.email=test@test -c user.name=test commit --quiet -m "mini-harness jetable (fixture de test)"

  git -C "$depot" checkout --quiet -b "$BRANCHE_CIBLE_TEST"
  git -C "$depot" -c user.email=test@test -c user.name=test commit --quiet --allow-empty -m "avance sur $BRANCHE_CIBLE_TEST"
  git -C "$depot" checkout --quiet master

  echo "$depot"
}

echo ""
echo "═══ Cas 7 — garde équipes : une équipe active AUTRE que soi ⇒ refus, nommée ═══"
DEPOT7="$(construire_depot_jetable_avec_harness)"
set +e
SORTIE7="$(cd "$DEPOT7" && env CCREMOTE_LIEN_SECRET=peu-importe CCREMOTE_UI_PASSWORD=peu-importe \
  CLAUDE_CODE_SESSION_ID=session-test-7 \
  CCREMOTE_GARDE_EQUIPES_CMD="echo '{\"autres\":[{\"project\":\"stockiop\",\"title\":\"Mission de nuit\",\"state\":\"en_cours\"}],\"exclueSoiMeme\":true}'" \
  bash ./deployer-en-production.sh "$BRANCHE_CIBLE_TEST" 2>&1)"
CODE7=$?
set -e
verifier "$CODE7" "78" "refus au bon code de sortie quand une équipe autre est active"
case "$SORTIE7" in
  *"stockiop"*"Mission de nuit"*) echo "  ✓ l'équipe active est NOMMÉE dans le refus (projet et titre)" ;;
  *) echo "  ✗ l'équipe active n'est pas nommée dans le refus — obtenu : $SORTIE7" >&2; ECHECS=$((ECHECS + 1)) ;;
esac
if [ -f "$DEPOT7/DEPLOY_HARNESS_PI_APPELE" ]; then
  echo "  ✗ l'étape 4 (déploiement) a quand même été atteinte — la garde n'a pas bloqué" >&2
  ECHECS=$((ECHECS + 1))
else
  echo "  ✓ l'étape 4 n'a PAS été atteinte — la garde a bien bloqué avant"
fi

echo ""
echo "═══ Cas 8 — garde équipes : aucune équipe active ⇒ le déploiement continue ═══"
DEPOT8="$(construire_depot_jetable_avec_harness)"
set +e
SORTIE8="$(cd "$DEPOT8" && env CCREMOTE_LIEN_SECRET=peu-importe CCREMOTE_UI_PASSWORD=peu-importe \
  CLAUDE_CODE_SESSION_ID=session-test-8 \
  CCREMOTE_GARDE_EQUIPES_CMD="echo '{\"autres\":[],\"exclueSoiMeme\":false}'" \
  bash ./deployer-en-production.sh "$BRANCHE_CIBLE_TEST" 2>&1)"
CODE8=$?
set -e
verifier "$CODE8" "0" "le script se termine avec succès quand aucune équipe n'est active"
if [ -f "$DEPOT8/DEPLOY_HARNESS_PI_APPELE" ]; then
  echo "  ✓ l'étape 4 a bien été atteinte (fichier marqueur posé par le déploiement factice)"
else
  echo "  ✗ l'étape 4 n'a PAS été atteinte alors qu'aucune équipe n'est active" >&2
  ECHECS=$((ECHECS + 1))
fi
case "$SORTIE8" in
  *"MISE EN PRODUCTION TERMINÉE"*) echo "  ✓ le script va jusqu'au bout (MISE EN PRODUCTION TERMINÉE)" ;;
  *) echo "  ✗ le script ne s'est pas terminé normalement — obtenu : $SORTIE8" >&2; ECHECS=$((ECHECS + 1)) ;;
esac

echo ""
echo "═══ Cas 9 — garde équipes : équipe active + --malgre-equipes-actives ⇒ passage en force ═══"
DEPOT9="$(construire_depot_jetable_avec_harness)"
set +e
SORTIE9="$(cd "$DEPOT9" && env CCREMOTE_LIEN_SECRET=peu-importe CCREMOTE_UI_PASSWORD=peu-importe \
  CLAUDE_CODE_SESSION_ID=session-test-9 \
  CCREMOTE_GARDE_EQUIPES_CMD="echo '{\"autres\":[{\"project\":\"stockiop\",\"title\":\"Mission de nuit\",\"state\":\"en_cours\"}],\"exclueSoiMeme\":true}'" \
  bash ./deployer-en-production.sh "$BRANCHE_CIBLE_TEST" --malgre-equipes-actives 2>&1)"
CODE9=$?
set -e
verifier "$CODE9" "0" "le passage en force explicite laisse le déploiement continuer"
if [ -f "$DEPOT9/DEPLOY_HARNESS_PI_APPELE" ]; then
  echo "  ✓ l'étape 4 a été atteinte malgré l'équipe active (passage en force assumé)"
else
  echo "  ✗ l'étape 4 n'a pas été atteinte alors que --malgre-equipes-actives était passé" >&2
  ECHECS=$((ECHECS + 1))
fi
case "$SORTIE9" in
  *"passage en force"*) echo "  ✓ le passage en force est annoncé en clair" ;;
  *) echo "  ✗ aucune annonce de passage en force dans la sortie — obtenu : $SORTIE9" >&2; ECHECS=$((ECHECS + 1)) ;;
esac

echo ""
if [ "$ECHECS" -eq 0 ]; then
  echo "✓ TOUS LES CAS PASSENT (0 échec)"
  exit 0
else
  echo "✗ $ECHECS cas en échec" >&2
  exit 1
fi
