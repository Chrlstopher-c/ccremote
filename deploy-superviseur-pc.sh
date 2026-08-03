#!/bin/bash
# Recharge le superviseur du PC (`trinityarch`) sur le code du dépôt.
#
# ☠ POURQUOI CE SCRIPT EXISTE (03/08). Le PC n'a jamais eu de déploiement : il
# lit `/mnt/projects/ccremote/harness` directement, donc « déployer » se réduit à
# redémarrer son service. C'est exactement ce qui le rendait dangereux — il n'y
# avait aucun geste, donc aucun contrôle, et le process pouvait servir du code
# vieux de plusieurs heures sans que rien ne le dise. Mesuré ce jour-là sur les
# DEUX machines : le VPS tournait le code du 1er août, le PC celui d'avant les
# correctifs de la matinée.
#
# Le contrôle est le même que côté VPS et Pi : le process doit être POSTÉRIEUR à
# toutes les sources. Sinon on sort en erreur, bruyamment.
#
# Usage :  ./deploy-superviseur-pc.sh
set -e

HARNESS="$(cd "$(dirname "$0")" && pwd)/harness"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"

echo "→ Redémarrage de ccremote-pc (service utilisateur)"
systemctl --user restart ccremote-pc
sleep 6
etat="$(systemctl --user show ccremote-pc -p ActiveState --value)"
[ "$etat" = "active" ] || { echo "  ✗ service $etat" >&2; exit 1; }

echo "→ Contrôle de fraîcheur : le process est-il plus récent que le code ?"
demarre="$(systemctl --user show ccremote-pc -p ExecMainStartTimestamp --value)"
epoch="$(date -d "$demarre" +%s 2>/dev/null || echo 0)"
[ "$epoch" != "0" ] || { echo "  ⚠ heure de démarrage illisible — contrôle impossible" >&2; exit 1; }

perimes="$(find "$HARNESS" -name '*.ts' -newermt "@$epoch" -not -path '*/node_modules/*' | head -5)"
if [ -n "$perimes" ]; then
  echo "  ✗ PROCESS PÉRIMÉ — sources plus récentes que le process :" >&2
  echo "$perimes" >&2
  exit 1
fi
echo "  ✓ process démarré le $demarre, postérieur à toutes les sources"

echo ""
echo "✓ Superviseur du PC actif, et il exécute bien le code du dépôt."
echo "  Vérifier le rattachement :  bun harness/pilotage/pilote.ts machines"
