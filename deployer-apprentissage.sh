#!/bin/bash
# Déploiement en UNE COMMANDE de la boucle d'apprentissage sur le superviseur du
# PC (`ccremote-pc`) — l'interrupteur unique est `CCREMOTE_APPRENTISSAGE_ACTIF`
# (voir `Upgrade/apprentissage/ACTIVATION.md` et `harness/superviseur/
# superviseur-workers.ts`).
#
# Usage :
#   ./deployer-apprentissage.sh              # allume, persistant, redémarre
#   ./deployer-apprentissage.sh --eteindre   # retire l'interrupteur, redémarre
#
# Séquence, dans l'ordre, chacune bloquant la suivante :
#   1. arbre de travail propre (git status)
#   2. suite de tests complète (`bun test`) + `tsc --noEmit`
#   3. activation/désactivation PERSISTANTE — écrite dans le fichier
#      d'environnement `%h/.config/ccremote/pc.env` que l'unité systemd charge
#      via `EnvironmentFile=` : survit à un redémarrage machine, contrairement
#      à un `export` de session.
#   4. redémarrage du superviseur, DÉTACHÉ dans un scope systemd indépendant —
#      voir `#redemarrerDetache` pour pourquoi.
#   5. contrôle après coup : service actif, process postérieur aux sources
#      (même garde que `deploy-superviseur-pc.sh`), interrupteur bien lu dans
#      l'environnement RÉEL du process qui tourne (`/proc/<pid>/environ`, pas
#      seulement le fichier — un fichier correct sur un process non redémarré
#      ne prouve rien).
#
# Idempotent : relancer deux fois de suite ne casse rien (étape 3 ne duplique
# jamais la ligne, étape 4 redémarre un service déjà à jour sans dommage).
set -e

RACINE="$(cd "$(dirname "$0")" && pwd)"
HARNESS="$RACINE/harness"
ENV_FICHIER="$HOME/.config/ccremote/pc.env"
SERVICE="ccremote-pc"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"

MODE="allumer"
case "${1:-}" in
  "") ;;
  --eteindre) MODE="eteindre" ;;
  *)
    echo "✗ argument inconnu : '$1'" >&2
    echo "  usage : ./deployer-apprentissage.sh [--eteindre]" >&2
    exit 64
    ;;
esac

# --- 1. Arbre propre ---------------------------------------------------------
controler_arbre_propre() {
  echo "→ Contrôle de l'arbre de travail"
  local sale
  sale="$(git -C "$RACINE" status --porcelain)"
  if [ -n "$sale" ]; then
    echo "✗ arbre de travail sale — commit ou stash avant de déployer :" >&2
    echo "$sale" >&2
    exit 1
  fi
  echo "  ✓ arbre propre"
}

# --- 2. Tests + typecheck ----------------------------------------------------
controler_tests() {
  echo "→ Suite de tests complète (bun test)"
  (cd "$HARNESS" && bun test) || { echo "✗ suite de tests en échec — arrêt net." >&2; exit 1; }
  echo "→ Vérification des types (tsc --noEmit)"
  (cd "$HARNESS" && bunx tsc --noEmit) || { echo "✗ tsc --noEmit a trouvé des erreurs — arrêt net." >&2; exit 1; }
  echo "  ✓ tests et types au vert"
}

# --- 3. Interrupteur persistant ----------------------------------------------
appliquer_interrupteur() {
  echo "→ Interrupteur persistant : $ENV_FICHIER"
  [ -f "$ENV_FICHIER" ] || { echo "✗ fichier d'environnement absent : $ENV_FICHIER" >&2; exit 1; }
  if [ "$MODE" = "allumer" ]; then
    if grep -qE '^CCREMOTE_APPRENTISSAGE_ACTIF=' "$ENV_FICHIER"; then
      sed -i 's/^CCREMOTE_APPRENTISSAGE_ACTIF=.*/CCREMOTE_APPRENTISSAGE_ACTIF=1/' "$ENV_FICHIER"
    else
      printf 'CCREMOTE_APPRENTISSAGE_ACTIF=1\n' >> "$ENV_FICHIER"
    fi
    echo "  ✓ CCREMOTE_APPRENTISSAGE_ACTIF=1 écrit"
  else
    sed -i '/^CCREMOTE_APPRENTISSAGE_ACTIF=/d' "$ENV_FICHIER"
    echo "  ✓ CCREMOTE_APPRENTISSAGE_ACTIF retiré"
  fi
}

# --- 4. Redémarrage détaché ---------------------------------------------------
# `☠` Ce script peut être lancé depuis une session PILOTÉE PAR ccremote-pc lui-
# même (un agent, enfant du service, exécutant ce script). Un `systemctl --user
# restart ccremote-pc` en foreground tuerait alors tout le cgroup du service —
# CE SCRIPT COMPRIS — avant qu'il ait pu faire le moindre contrôle après coup.
# La parade : soumettre le redémarrage ET son contrôle comme unité systemd
# TRANSITOIRE, fire-and-forget (`systemd-run --unit=... --collect`, sans
# --wait/--pipe) — un scope cgroup INDÉPENDANT du service qu'elle redémarre, la
# sortie écrite sur disque plutôt que sur un stdout qui peut mourir avec son
# lecteur. Prouvé mécaniquement (service jetable, process migré dans son
# cgroup, cgroup stoppé) : le travail fire-and-forget survit, un client attaché
# via --wait ne survit pas.
redemarrer_detache() {
  local unite journal fin
  unite="ccremote-apprentissage-deploiement-$(date +%s)-$$"
  journal="$(mktemp /tmp/ccremote-deploiement-apprentissage.XXXXXX.log)"
  echo "→ Redémarrage de $SERVICE, détaché (unité transitoire $unite)"
  local commande_interne
  commande_interne="systemctl --user restart $SERVICE; sleep 6"
  commande_interne="$commande_interne; echo etat=\$(systemctl --user show $SERVICE -p ActiveState --value)"
  commande_interne="$commande_interne; echo TERMINE"
  systemd-run --user --unit="$unite" --collect \
    --description="deployer-apprentissage.sh : redémarrage détaché de $SERVICE" \
    /bin/bash -c "$commande_interne" \
    >"$journal" 2>&1
  fin=$(( $(date +%s) + 60 ))
  until grep -q '^TERMINE$' "$journal" 2>/dev/null || [ "$(date +%s)" -ge "$fin" ]; do sleep 2; done
  if ! grep -q '^TERMINE$' "$journal"; then
    echo "✗ le redémarrage détaché n'a pas terminé sous 60s — journal : $journal" >&2
    exit 1
  fi
  if ! grep -q '^etat=active$' "$journal"; then
    echo "✗ service $SERVICE pas actif après redémarrage" >&2
    cat "$journal" >&2
    exit 1
  fi
  echo "  ✓ $SERVICE actif (journal : $journal)"
}

# --- 5. Contrôles après coup --------------------------------------------------
controler_fraicheur() {
  echo "→ Contrôle de fraîcheur : le process est-il plus récent que le code ?"
  local demarre epoch perimes
  demarre="$(systemctl --user show "$SERVICE" -p ExecMainStartTimestamp --value)"
  epoch="$(date -d "$demarre" +%s 2>/dev/null || echo 0)"
  [ "$epoch" != "0" ] || { echo "  ✗ heure de démarrage illisible" >&2; exit 1; }
  perimes="$(find "$HARNESS" -name '*.ts' -newermt "@$epoch" -not -path '*/node_modules/*' | head -5)"
  if [ -n "$perimes" ]; then
    echo "  ✗ PROCESS PÉRIMÉ — sources plus récentes que le process :" >&2
    echo "$perimes" >&2
    exit 1
  fi
  echo "  ✓ process démarré le $demarre, postérieur à toutes les sources"
}

controler_interrupteur_reel() {
  echo "→ Contrôle de l'interrupteur dans le process RÉEL (pas seulement le fichier)"
  local pid valeur
  pid="$(systemctl --user show "$SERVICE" -p MainPID --value)"
  [ "$pid" != "0" ] || { echo "  ✗ pas de MainPID pour $SERVICE" >&2; exit 1; }
  valeur="$(tr '\0' '\n' < "/proc/$pid/environ" 2>/dev/null | grep '^CCREMOTE_APPRENTISSAGE_ACTIF=' || true)"
  if [ "$MODE" = "allumer" ]; then
    [ "$valeur" = "CCREMOTE_APPRENTISSAGE_ACTIF=1" ] || { echo "  ✗ interrupteur absent du process réel" >&2; exit 1; }
    echo "  ✓ CCREMOTE_APPRENTISSAGE_ACTIF=1 confirmé dans le process $pid"
  else
    [ -z "$valeur" ] || { echo "  ✗ interrupteur encore présent dans le process réel : $valeur" >&2; exit 1; }
    echo "  ✓ interrupteur absent du process $pid, comme attendu"
  fi
}

controler_arbre_propre
controler_tests
appliquer_interrupteur
redemarrer_detache
controler_fraicheur
controler_interrupteur_reel

echo ""
if [ "$MODE" = "allumer" ]; then
  echo "✓ Apprentissage ACTIF sur $SERVICE, persistant à travers un redémarrage machine."
else
  echo "✓ Apprentissage ÉTEINT sur $SERVICE, persistant à travers un redémarrage machine."
fi
