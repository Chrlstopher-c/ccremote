#!/usr/bin/env bash
# Tests du lanceur cc : faux claude, serveur tmux isolé (-L cc-test), registre dans un dossier temporaire, tout nettoyé.
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
CC="$HERE/cc"
TMP="$(mktemp -d)"
ECHECS=0
export CC_SOCKET=cc-test
export CC_CLAUDE="$TMP/bin/claude"
export XDG_STATE_HOME="$TMP/state"
export CC_TEST_TRACE="$TMP/trace"
unset TMUX

nettoyer() {
  tmux -L cc-test kill-server 2> /dev/null
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

attendre() { # commande… : réessaie pendant 5 s
  local i
  for i in $(seq 50); do
    "$@" && return 0
    sleep 0.1
  done
  return 1
}

mkdir -p "$TMP/bin" "$TMP/projet-alpha" "$TMP/depot/sub"
cat > "$TMP/bin/claude" <<'FAUX'
#!/usr/bin/env bash
printf '%s\n' "ENV=${CLAUDE_CODE_CHILD_SESSION-absent}" "TMUX=${TMUX:+oui}" "$@" "---" >> "$CC_TEST_TRACE"
case " $* " in *" -p "*) exit 0 ;; esac
sleep 600
FAUX
chmod +x "$TMP/bin/claude"

registre() { ls "$XDG_STATE_HOME/cc/sessions/"*.json 2> /dev/null | wc -l; }
fiche_de() { grep -l "\"nom\":\"$1\"" "$XDG_STATE_HOME/cc/sessions/"*.json 2> /dev/null | head -1; }
trace_contient() { grep -qx -- "$1" "$CC_TEST_TRACE" 2> /dev/null; }
sessions_tmux() { tmux -L cc-test list-sessions -F '#S' 2> /dev/null | sort | tr '\n' ' '; }

# 1. Impression : claude seul, environnement retiré, aucun registre, aucune session tmux
CLAUDE_CODE_CHILD_SESSION=1 "$CC" -p bonjour > /dev/null 2>&1
verifier "impression : claude exécuté directement sans CLAUDE_CODE_CHILD_SESSION" trace_contient "ENV=absent"
verifier "impression : aucun registre écrit" test ! -e "$XDG_STATE_HOME/cc"

# 2. Lancement hors tmux (sortie non terminal) : session tmux, fiche, arguments
cd "$TMP/projet-alpha" && CLAUDE_CODE_CHILD_SESSION=1 "$CC" --lanceur quart -- --append-system-prompt C bonjour > "$TMP/sortie1" 2>&1
verifier "lancement : nom de session affiché" grep -qx "claude-projet-alpha" "$TMP/sortie1"
verifier "lancement : session tmux claude-projet-alpha créée" tmux -L cc-test has-session -t "=claude-projet-alpha"
verifier "lancement : une fiche de registre" test "$(registre)" -eq 1
FICHE1="$(fiche_de projet-alpha)"
verifier "lancement : fiche avec tmux et lanceur" grep -q '"tmux":"claude-projet-alpha","lanceur":"quart"' "$FICHE1"
attendre trace_contient "--name" || true
verifier "lancement : claude reçoit --session-id et --name" trace_contient "--name"
verifier "lancement : CLAUDE_CODE_CHILD_SESSION retiré dans la session" trace_contient "ENV=absent"
ID1="$(sed -n 's/.*"id":"\([^"]*\)".*/\1/p' "$FICHE1")"

# 3. Même dossier pendant que la première vit : suffixe -2 ; la liste voit les deux
cd "$TMP/projet-alpha" && "$CC" > "$TMP/sortie2" 2>&1 < /dev/null
verifier "collision : suffixe -2 sur la session tmux" tmux -L cc-test has-session -t "=claude-projet-alpha-2"
verifier "collision : la liste montre deux sessions vivantes" test "$("$CC" liste | grep -c vivant)" -eq 2

# 4. Racine git : le nom est celui du dépôt, pas du sous-dossier
git -C "$TMP/depot" init -q 2> /dev/null
cd "$TMP/depot/sub" && "$CC" --detache > /dev/null 2>&1
verifier "racine git : nom du dépôt" test -n "$(fiche_de depot)"

# 5. Dans une session claude : remplacement du processus, pas d'imbrication
AVANT=$(sessions_tmux | wc -w)
tmux -L cc-test new-session -d -s claude-dedans -c "$TMP/projet-beta" -e CC_SOCKET=cc-test \
  -e CC_CLAUDE="$CC_CLAUDE" -e XDG_STATE_HOME="$XDG_STATE_HOME" -e CC_TEST_TRACE="$CC_TEST_TRACE" \
  -- "$CC" --lanceur kitty --nom dedans -- --foo
verifier "ici : session dans le registre avec son nom tmux" attendre fiche_de dedans
verifier "ici : aucune session supplémentaire" test "$(sessions_tmux | wc -w)" -eq "$((AVANT + 1))"

# 6. Fermeture puis reprise par nom et par id
tmux -L cc-test kill-session -t "=claude-projet-alpha"
verifier "reprise : session fermée listée comme fermée" sh -c "'$CC' liste | grep -q 'fermé.*projet-alpha'"
"$CC" reprendre "$ID1" > "$TMP/sortie3" 2>&1
verifier "reprise : session retrouvée par id et relancée" tmux -L cc-test has-session -t "=claude-projet-alpha"
verifier "reprise : claude reçoit --resume avec l'id d'origine" attendre trace_contient "$ID1"
verifier "reprise : registre conserve le nom" grep -q '"nom":"projet-alpha"' "$FICHE1"
verifier "reprise : dossier d origine conservé, pas celui de l appelant" grep -q "\"cwd\":\"$TMP/projet-alpha\"" "$FICHE1"
"$CC" reprendre projet-alpha-2 > "$TMP/sortie4" 2>&1
verifier "reprise : session vivante signalée sans relance" grep -q "vivante" "$TMP/sortie4"

echo "---"
if [ "$ECHECS" -eq 0 ]; then echo "TOUS LES TESTS PASSENT"; else echo "$ECHECS ECHEC(S)"; fi
exit "$ECHECS"
