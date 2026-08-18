#!/bin/bash
# Une seule commande pour déployer le control plane du Pi (H-75). APPELLE
# deploy-harness-pi.sh, puis deploy-web-pi.sh SI l'interface web a changé —
# même idiome de contrôle de fraîcheur que deployer-tout.sh (étapes 3-4) :
# n'invente rien qu'ils ne fassent déjà, ne réécrit aucun rsync.
#
# Résout CCREMOTE_LIEN_SECRET tout seul (environnement de l'appelant, sinon le
# fichier d'environnement du service ccremote-pc) : rien à exporter, aucun
# script à enchaîner à la main.
#
# Ne fait PAS : ne touche ni le PC (deploy-superviseur-pc.sh) ni le VPS
# (deploy-superviseur-vps.sh, deploy-mcp-vps.sh) — uniquement le Pi.
#
# Usage :
#   ./deployer-pi.sh                # déploiement réel
#   ./deployer-pi.sh --simulation   # affiche le plan, n'exécute rien
set -e

RACINE="$(cd "$(dirname "$0")" && pwd)"
PI_TARGET="${CCREMOTE_PI_CIBLE:-pi@pi.exemple}"
SSH_KEY="${CCREMOTE_SSH_KEY:-$HOME/.ssh/id_ed25519_ccremote}"
SSH_OPTS_PI="-o BatchMode=yes -i $SSH_KEY"
# ☠ Fichier d'environnement RÉEL du service ccremote-pc (voir
# ccremote-pc.service, EnvironmentFile=%h/.config/ccremote/pc.env) : le PC
# porte déjà le même secret que le Pi pour parler au lien, pas besoin d'en
# demander un second à Chris.
SECRET_ENV_PC="${CCREMOTE_PC_ENV_FICHIER:-$HOME/.config/ccremote/pc.env}"

SIMULATION=0
for arg in "$@"; do
  case "$arg" in
    --simulation) SIMULATION=1 ;;
    -h|--aide|--help)
      cat <<'AIDE'
deployer-pi.sh — une seule commande, le control plane du Pi

  ./deployer-pi.sh               déploiement réel
  ./deployer-pi.sh --simulation  affiche le plan, n'exécute rien

Résout CCREMOTE_LIEN_SECRET seul (environnement de l'appelant, sinon le
fichier d'environnement du service ccremote-pc) — rien à exporter à la main.
Refuse si l'arbre de travail est sale. Ne touche ni le PC ni le VPS.
AIDE
      exit 0
      ;;
    *)
      echo "✗ argument inconnu : '$arg'" >&2
      echo "  usage : ./deployer-pi.sh [--simulation]" >&2
      exit 64
      ;;
  esac
done

# ── Arbre de travail propre ──────────────────────────────────────────────────
sale="$(git -C "$RACINE" status --porcelain)"
if [ -n "$sale" ]; then
  echo "✗ arbre de travail sale — commit ou stash avant de déployer :" >&2
  echo "$sale" >&2
  exit 1
fi

# ── Résolution du secret du lien (tout l'enjeu de la commande unique) ────────
# ☠ Jamais de valeur vide ni régénérée : un secret différent des deux côtés
# coupe le lien PC↔Pi en silence (voir deploy-harness-pi.sh). On lit ce qui
# existe déjà, on n'en invente jamais.
resoudre_secret() {
  if [ -n "${CCREMOTE_LIEN_SECRET:-}" ]; then
    echo "  ✓ CCREMOTE_LIEN_SECRET déjà présent dans l'environnement de l'appelant"
    return 0
  fi
  if [ -f "$SECRET_ENV_PC" ]; then
    local valeur
    valeur="$(grep -E '^CCREMOTE_LIEN_SECRET=' "$SECRET_ENV_PC" | tail -1 | cut -d= -f2-)"
    if [ -n "$valeur" ]; then
      CCREMOTE_LIEN_SECRET="$valeur"
      export CCREMOTE_LIEN_SECRET
      echo "  ✓ CCREMOTE_LIEN_SECRET lu depuis $SECRET_ENV_PC (env du service ccremote-pc)"
      return 0
    fi
  fi
  echo "✗ CCREMOTE_LIEN_SECRET introuvable — absent de l'environnement ET de" >&2
  echo "  $SECRET_ENV_PC : pose-le dans ce fichier avec la MÊME valeur que sur" >&2
  echo "  le Pi (jamais une valeur régénérée) avant de relancer." >&2
  exit 78
}

echo "→ Résolution de CCREMOTE_LIEN_SECRET"
if [ "$SIMULATION" = "1" ]; then
  if [ -n "${CCREMOTE_LIEN_SECRET:-}" ] || grep -qE '^CCREMOTE_LIEN_SECRET=.+' "$SECRET_ENV_PC" 2>/dev/null; then
    echo "  [simulation] secret résoluble"
  else
    echo "  [simulation] ✗ secret NON résoluble — l'exécution réelle refuserait ici"
  fi
else
  resoudre_secret
fi

# ── 1. Control plane du Pi ────────────────────────────────────────────────────
echo "→ Control plane du Pi (deploy-harness-pi.sh)"
if [ "$SIMULATION" = "1" ]; then
  echo "  [simulation] appellerait : ./deploy-harness-pi.sh $PI_TARGET"
else
  if ! "$RACINE/deploy-harness-pi.sh" "$PI_TARGET"; then
    echo "✗ deploy-harness-pi.sh a échoué" >&2
    exit 1
  fi
fi

# ── 2. Interface web du Pi, SI elle a changé ─────────────────────────────────
# ☠ Même idiome de contrôle de fraîcheur que deployer-tout.sh (étape 4, jamais
# réécrit ici) : heure de démarrage du service distant comparée au mtime des
# sources locales — jamais une supposition.
web_pi_a_change() {
  local demarre epoch perimes
  demarre="$(ssh $SSH_OPTS_PI "$PI_TARGET" "systemctl show ccremote-web -p ExecMainStartTimestamp --value" 2>/dev/null)"
  epoch="$(date -d "$demarre" +%s 2>/dev/null || echo 0)"
  if [ "$epoch" = "0" ]; then
    echo "1"  # illisible : on redéploie plutôt que de supposer « à jour »
    return
  fi
  perimes="$(find "$RACINE/pi-web" -newermt "@$epoch" -not -path '*/__pycache__/*' 2>/dev/null | head -1)"
  [ -n "$perimes" ] && echo "1" || echo "0"
}

echo "→ Interface web du Pi — contrôle de fraîcheur"
if [ "$SIMULATION" = "1" ]; then
  echo "  [simulation] appellerait ./deploy-web-pi.sh $PI_TARGET SI pi-web/ a changé (non évalué ici)"
else
  if [ "$(web_pi_a_change)" = "1" ]; then
    echo "  changement détecté (ou fraîcheur illisible) → redéploiement"
    if ! "$RACINE/deploy-web-pi.sh" "$PI_TARGET"; then
      echo "✗ deploy-web-pi.sh a échoué" >&2
      exit 1
    fi
  else
    echo "  ✓ déjà à jour — non redéployée"
  fi
fi

echo ""
if [ "$SIMULATION" = "1" ]; then
  echo "[simulation] rien n'a été exécuté."
else
  echo "✓ Pi déployé : control plane actif, redémarré, postérieur à ses sources."
fi
