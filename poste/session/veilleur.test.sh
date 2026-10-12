#!/usr/bin/env bash
# Tests du veilleur : registre natif, transcriptions, processus, faux cc, faux notifieur, horloge injectée.
# Serveur tmux isolé (cc-test), tout dans un dossier temporaire, aucun vrai processus Claude touché.
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
VEILLEUR="$HERE/veilleur"
CC="$HERE/cc"
TMP="$(mktemp -d)"
ECHECS=0
T0=1800000000
export CC_SOCKET=cc-test
export CC_CLAUDE="$TMP/bin/claude"
export CC_TEST_TRACE="$TMP/trace"
export VEILLEUR_CC="$TMP/bin/faux-cc"
export VEILLEUR_NOTIFIER="$TMP/bin/notif"
export VEILLEUR_HORLOGE="cat $TMP/now"
export VEILLEUR_DESKTOP_CMD="test -f $TMP/bureau"
unset TMUX
RACINE="$TMP/racine"
CLAUDE="$RACINE/.claude"
ETAT="$RACINE/etat/cc"
PIDS=()

nettoyer() {
  tmux -L cc-test kill-server 2> /dev/null
  local p
  for p in "${PIDS[@]}"; do kill "$p" 2> /dev/null; done
  rm -rf "$TMP"
}
trap nettoyer EXIT

verifier() { # libellé commande…
  local libelle=$1
  shift
  if "$@"; then
    echo "ok - $libelle"
  else
    echo "KO - $libelle"
    ECHECS=$((ECHECS + 1))
  fi
}

mkdir -p "$TMP/bin" "$TMP/projets/alpha" "$TMP/projets/beta" "$TMP/projets/gamma" "$TMP/projets/delta" \
  "$TMP/projets/eps" "$TMP/projets/zeta" "$TMP/projets/term" "$CLAUDE/sessions" "$CLAUDE/projects"
echo "$T0" > "$TMP/now"

cat > "$TMP/bin/faux-cc" <<'FAUX'
#!/usr/bin/env bash
printf '%s\n' "CWD=$PWD" "$@" "---" >> "$CC_TEST_TRACE"
FAUX
cat > "$TMP/bin/notif" <<'FAUX'
#!/usr/bin/env bash
printf '%s\n' "NOTIF $*" >> "$CC_TEST_TRACE"
FAUX
cat > "$TMP/bin/claude" <<'FAUX'
#!/usr/bin/env bash
case " $* " in *" -p "*) exit 0 ;; esac
sleep 600
FAUX
chmod +x "$TMP/bin/"*

# Fiche du registre natif : pid, id, procStart, cwd, nom, entrypoint, âge de la dernière activité (s)
fiche() {
  jq -n --argjson pid "$1" --arg id "$2" --arg start "$3" --arg cwd "$4" --arg nom "$5" --arg ep "$6" \
    --argjson maj "$(( T0 - $7 ))000" \
    '{pid:$pid, sessionId:$id, procStart:$start, cwd:$cwd, name:$nom, entrypoint:$ep, kind:"interactive",
      startedAt:$maj, updatedAt:$maj}' > "$CLAUDE/sessions/$2.json"
}

# Transcription : travail = outil sans réponse ; attente = message utilisateur sans réponse ; fini = texte final
transcription() { # cwd id travail|attente|fini
  local dossier f
  dossier=$(printf '%s' "$1" | sed 's/[^A-Za-z0-9]/-/g')
  mkdir -p "$CLAUDE/projects/$dossier"
  f="$CLAUDE/projects/$dossier/$2.jsonl"
  echo '{"type":"system","sessionId":"'"$2"'"}' > "$f"
  case "$3" in
    travail) echo '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"t1","name":"Bash"}]}}' >> "$f" ;;
    attente) echo '{"type":"user","message":{"role":"user","content":"Continue la migration"}}' >> "$f" ;;
    fini) echo '{"type":"assistant","message":{"content":[{"type":"text","text":"Terminé."}]}}' >> "$f" ;;
  esac
  echo '{"type":"last-prompt","sessionId":"'"$2"'"}' >> "$f"
}

sleep 600 &
PID_VIVANT=$!
PIDS+=("$PID_VIVANT")
sleep 600 &
PID_MAUVAIS_DEPART=$!
PIDS+=("$PID_MAUVAIS_DEPART")
START_VIVANT=$(awk '{print $22}' "/proc/$PID_VIVANT/stat")

ID_ALPHA=11111111-aaaa-4aaa-8aaa-000000000001
ID_BETA=11111111-aaaa-4aaa-8aaa-000000000002
ID_GAMMA=11111111-aaaa-4aaa-8aaa-000000000003
ID_DELTA=11111111-aaaa-4aaa-8aaa-000000000004
ID_EPS=11111111-aaaa-4aaa-8aaa-000000000005
ID_ZETA=11111111-aaaa-4aaa-8aaa-000000000006
ID_TERM=11111111-aaaa-4aaa-8aaa-000000000007

# alpha : plein travail, pid mort -> à reprendre ; gamma : pid vivant avec un autre procStart -> mort, attente
fiche 999991 "$ID_ALPHA" 1 "$TMP/projets/alpha" "alpha-desk" claude-desktop 60
transcription "$TMP/projets/alpha" "$ID_ALPHA" travail
fiche "$PID_MAUVAIS_DEPART" "$ID_GAMMA" 1 "$TMP/projets/gamma" "gamma-desk" claude-desktop 60
transcription "$TMP/projets/gamma" "$ID_GAMMA" attente
# beta : tour fini -> jamais reprise
fiche 999992 "$ID_BETA" 1 "$TMP/projets/beta" "beta-desk" claude-desktop 60
transcription "$TMP/projets/beta" "$ID_BETA" fini
# delta : pid vivant avec le bon procStart -> pas morte
fiche "$PID_VIVANT" "$ID_DELTA" "$START_VIVANT" "$TMP/projets/delta" "delta-desk" claude-desktop 60
transcription "$TMP/projets/delta" "$ID_DELTA" travail
# eps : travail mais activité vieille de 1 h -> hors fenêtre
fiche 999993 "$ID_EPS" 1 "$TMP/projets/eps" "eps-desk" claude-desktop 3600
transcription "$TMP/projets/eps" "$ID_EPS" travail
# zeta : travail, mort, mais déjà vivante dans tmux -> pas de reprise
fiche 999994 "$ID_ZETA" 1 "$TMP/projets/zeta" "zeta-desk" claude-desktop 60
transcription "$TMP/projets/zeta" "$ID_ZETA" travail
# term : pas Desktop -> ignorée
fiche 999995 "$ID_TERM" 1 "$TMP/projets/term" "term" claude-terminal 60
transcription "$TMP/projets/term" "$ID_TERM" travail

tmux -L cc-test new-session -d -s vivante -- sh -c 'sleep 600' sh --resume "$ID_ZETA"

passer() { # horodatage : une passe du veilleur
  echo "$1" > "$TMP/now"
  "$VEILLEUR" --une-fois --racine "$RACINE" > "$TMP/sortie-$1" 2>&1
}
trace_contient() { grep -qx -- "$1" "$CC_TEST_TRACE" 2> /dev/null; }
reprises_de() { grep -A1 -x -- '--resume' "$CC_TEST_TRACE" 2> /dev/null | grep -cx -- "$1"; }
aucune_reprise() { ! grep -q -- '--resume' "$CC_TEST_TRACE" 2> /dev/null; }
aucun_delai() { test "$(jq '.morts | length' "$ETAT/veilleur.json" 2> /dev/null)" = 0; }
beta_absente() { ! morts_contient "$ID_BETA"; }
morts_contient() { jq -e --arg id "$1" '.morts[$id]' "$ETAT/veilleur.json" > /dev/null 2>&1; }

# 1. Desktop ouvert : aucune reprise, aucun délai de grâce ouvert
touch "$TMP/bureau"
passer "$T0"
verifier "bureau ouvert : aucune reprise" aucune_reprise
verifier "bureau ouvert : aucun délai de grâce ouvert" aucun_delai

# 2. Desktop fermé : première observation, délai de grâce, rien encore
rm -f "$TMP/bureau"
passer "$T0"
verifier "grâce : aucune reprise à l'instant de la mort" aucune_reprise
verifier "grâce : alpha mémorisée comme morte" morts_contient "$ID_ALPHA"
verifier "grâce : gamma mémorisée comme morte" morts_contient "$ID_GAMMA"
verifier "grâce : beta (tour fini) jamais mémorisée" beta_absente

# 3. Dix secondes plus tard : toujours dans le délai de grâce
passer "$((T0 + 10))"
verifier "grâce 10 s : aucune reprise" aucune_reprise

# 4. Cinquante secondes plus tard : reprise, une seule fois par session
passer "$((T0 + 50))"
verifier "après grâce : alpha repris une fois" test "$(reprises_de "$ID_ALPHA")" -eq 1
verifier "après grâce : gamma repris une fois" test "$(reprises_de "$ID_GAMMA")" -eq 1
verifier "après grâce : beta jamais repris" test "$(reprises_de "$ID_BETA")" -eq 0
verifier "après grâce : delta (pid vivant) jamais repris" test "$(reprises_de "$ID_DELTA")" -eq 0
verifier "après grâce : eps (activité ancienne) jamais repris" test "$(reprises_de "$ID_EPS")" -eq 0
verifier "après grâce : zeta (déjà vivante) jamais repris" test "$(reprises_de "$ID_ZETA")" -eq 0
verifier "après grâce : session terminal jamais reprise" test "$(reprises_de "$ID_TERM")" -eq 0
verifier "reprise : lanceur veilleur et id d'origine" trace_contient "veilleur"
verifier "reprise : lancée dans le dossier de la session" grep -qx "CWD=$TMP/projets/alpha" "$CC_TEST_TRACE"
verifier "reprise : message de reprise transmis" grep -q "Reprends exactement où tu t'es arrêté" "$CC_TEST_TRACE"
verifier "reprise : notification envoyée" grep -q "NOTIF .*alpha-desk" "$CC_TEST_TRACE"

# 5. Passes suivantes : pas de nouvelle reprise
passer "$((T0 + 100))"
passer "$((T0 + 160))"
verifier "pas de doublon : alpha toujours repris une fois" test "$(reprises_de "$ID_ALPHA")" -eq 1
verifier "pas de doublon : gamma toujours repris une fois" test "$(reprises_de "$ID_GAMMA")" -eq 1

# 6. Lanceur veilleur accepté par cc (sous-commande -p : claude exécuté directement, sans session)
verifier "cc accepte --lanceur veilleur" sh -c "'$CC' --lanceur veilleur -- -p bonjour > /dev/null 2>&1"

echo "---"
if [ "$ECHECS" -eq 0 ]; then echo "TOUS LES TESTS PASSENT"; else echo "$ECHECS ECHEC(S)"; fi
exit "$ECHECS"
