#!/bin/bash
# deployer-en-production.test.sh — vérifie MÉCANIQUEMENT, sans jamais toucher
# au vrai dépôt ccremote ni au Pi, les deux défauts de livraison corrigés
# dans deployer-en-production.sh :
#
#   1. il retrouve seul la racine du dépôt quel que soit le répertoire ou le
#      chemin (relatif/absolu) depuis lequel on l'appelle ;
#   2. avant de toucher au dépôt, il se recopie dans un emplacement HORS du
#      dépôt et s'y relance — cette copie est ensuite immunisée contre toute
#      réorganisation du dépôt qui suivrait (stash / reset / merge).
#
# Chaque cas construit un dépôt git JETABLE dans /tmp (jamais ccremote), lance
# le script avec CCREMOTE_LIEN_SECRET volontairement ABSENT — l'exécution
# s'arrête donc juste après le garde-fou d'auto-protection, au refus normal
# de l'étape 0 (code 78). Ce point d'arrêt est ce qui permet de tester le
# garde-fou seul, sans jamais lancer bun/tsc/ssh.
#
# Usage : bash deployer-en-production.test.sh
set -e

SCRIPT_SOURCE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/deployer-en-production.sh"
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
CODE="$(cd "$DEPOT1" && lancer_jusquau_refus ./deployer-en-production.sh)"
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
RESULTAT="$(cd "$DEPOT2/un/sous/dossier" && lancer_et_verifier_racine ../../../deployer-en-production.sh)"
verifier "$RESULTAT" "OK" "racine retrouvée malgré un appel relatif profond"

echo ""
echo "═══ Cas 3 — appel par chemin ABSOLU depuis un répertoire hors dépôt ═══"
DEPOT3="$(construire_depot_jetable)"
RESULTAT="$(cd /tmp && lancer_et_verifier_racine "$DEPOT3/deployer-en-production.sh")"
verifier "$RESULTAT" "OK" "racine retrouvée malgré un cwd totalement étranger au dépôt"

echo ""
echo "═══ Cas 4 — script déjà HORS du dépôt (bootstrap via mktemp), cwd DANS le dépôt ═══"
DEPOT4="$(construire_depot_jetable)"
COPIE_EXTERNE="$(mktemp -t deployer-bootstrap.XXXXXX.sh)"
cp "$SCRIPT_SOURCE" "$COPIE_EXTERNE"
chmod +x "$COPIE_EXTERNE"
RESULTAT="$(cd "$DEPOT4" && lancer_et_verifier_racine "$COPIE_EXTERNE")"
verifier "$RESULTAT" "OK" "racine retrouvée depuis le cwd quand la source est déjà hors dépôt (cas du bootstrap)"

echo ""
if [ "$ECHECS" -eq 0 ]; then
  echo "✓ TOUS LES CAS PASSENT (0 échec)"
  exit 0
else
  echo "✗ $ECHECS cas en échec" >&2
  exit 1
fi
