#!/bin/bash
# Recharge le superviseur du portable (`trinity-portable`) sur le code du dépôt.
#
# ☠ CE QUI DIFFÈRE DU PC FIXE, et pourquoi ce script existe à part :
#
#  1. Le dépôt vit dans `~/ccremote`, PAS dans `/mnt/projects/ccremote`. L'unité
#     systemd versionnée s'installe donc TELLE QUELLE ici — le `sed` obligatoire
#     sur le PC fixe serait au contraire une erreur sur cette machine.
#  2. La racine des projets est `/home/trinity` (`CCREMOTE_PC_RACINE_PROJETS`),
#     pas `/mnt/projects` : les dépôts du portable sont directement sous le home.
#     Le Pi la DEMANDE à la machine au dispatch, il ne la suppose pas.
#  3. Le registre vit sous `~/.local/share/ccremote/pc/`, pas `/var/lib` : un
#     portable n'a pas à réclamer root pour rejoindre le parc.
#  4. PAS DE WAKE-ON-LAN, décision de Chris du 2026-08-18. Cette machine se
#     rattache quand elle est allumée, et rien ne la réveille — elle n'a que du
#     WiFi, et `reveil-wol.ts` ne connaît qu'une MAC, celle du PC fixe.
#
# Le contrôle est le même que sur les trois autres machines : le process doit
# être POSTÉRIEUR à toutes les sources. Sinon on sort en erreur, bruyamment.
#
# Usage :  ./deploy-superviseur-portable.sh
set -e

HARNESS="$(cd "$(dirname "$0")" && pwd)/harness"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"

echo "→ Contrôle de la configuration avant de toucher au service"
ENV_FILE="$HOME/.config/ccremote/pc.env"
[ -f "$ENV_FILE" ] || { echo "  ✗ $ENV_FILE absent" >&2; exit 1; }
grep -q '^CCREMOTE_LIEN_SECRET=.\+' "$ENV_FILE" || {
  echo "  ✗ CCREMOTE_LIEN_SECRET vide dans $ENV_FILE" >&2
  echo "    Le process sortirait en code 78 (EX_CONFIG) et systemd le relancerait" >&2
  echo "    toutes les 60 s. Renseigner le secret du Pi avant de déployer." >&2
  exit 1
}
[ -d "$HARNESS/node_modules" ] || { echo "  ✗ dépendances absentes — lancer : (cd $HARNESS && bun install)" >&2; exit 1; }
echo "  ✓ secret présent, dépendances installées"

echo "→ Redémarrage de ccremote-pc (service utilisateur)"
systemctl --user restart ccremote-pc
sleep 6
etat="$(systemctl --user show ccremote-pc -p ActiveState --value)"
[ "$etat" = "active" ] || {
  echo "  ✗ service $etat" >&2
  echo "    Code 78 = configuration fausse (secret refusé, variable manquante)." >&2
  echo "    Code 1  = plantage. Voir : journalctl --user -u ccremote-pc -n 50" >&2
  exit 1
}

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
echo "✓ Superviseur du portable actif, et il exécute bien le code du dépôt."
echo "  Vérifier le rattachement :  bun harness/pilotage/pilote.ts machines"
echo "  ⚠ Sans compte Claude authentifié sous ~/.claude-comptes, cette machine"
echo "    répond à l'inventaire mais AUCUNE équipe ne peut y démarrer."
