#!/bin/bash
# Déploiement en UNE COMMANDE des trois machines de ccremote : met à jour le
# code du PC, puis enchaîne les cinq scripts de déploiement existants dans
# l'ordre imposé. N'invente rien qu'eux ne fassent déjà — ce script les
# APPELLE, il ne duplique pas leur logique. S'ils échouent, il s'arrête.
#
# Ordre (imposé, le control plane du Pi passe avant les machines de travail —
# les superviseurs s'y reconnectent seuls ensuite) :
#   1. git pull --ff-only sur /mnt/projects/ccremote (PC)          [nouveau]
#   2. garde « aucune équipe active », PC et VPS                   [nouveau]
#   3. deploy-harness-pi.sh        — control plane du Pi
#   4. deploy-web-pi.sh            — interface web du Pi, SI elle a changé
#   5. deploy-superviseur-pc.sh    — superviseur du PC (DÉTACHÉ, voir plus bas)
#   6. deploy-superviseur-vps.sh --demarrer — superviseur du VPS
#   7. deploy-mcp-vps.sh           — MCP du VPS, SI nécessaire
#
# Usage :
#   ./deployer-tout.sh                        # déploiement réel
#   ./deployer-tout.sh --simulation            # affiche le plan, n'exécute rien
#   ./deployer-tout.sh --malgre-equipes-actives  # passe outre la garde équipes
#
# Requiert (selon les étapes atteintes) : CCREMOTE_UI_PASSWORD (garde équipes),
# CCREMOTE_LIEN_SECRET (Pi + VPS), un compte Claude authentifié sur le VPS
# (voir deploy-superviseur-vps.sh), les alias SSH `pi@pi.exemple` et `vps`.
#
# ☠ LA GARDE « ÉQUIPES ACTIVES » EST LE CŒUR DE CE SCRIPT. Les équipes tournent
# dans le même groupe de processus que le service : un redémarrage leur envoie
# le même signal d'arrêt, et rien ne les relance automatiquement. Elle
# INTERROGE LE PARC via `pilotage/pilote.ts` (client réel, API en lecture
# seule) plutôt que d'inventer une détection maison — jamais de ps/pgrep sur
# des process qu'on ne sait pas identifier avec certitude depuis l'extérieur
# du harness.
#
# ☠ LA GARDE S'EXCLUT ELLE-MÊME (corrigé le 18/08, faute bloquante). Ce script
# tourne, la plupart du temps, COMME une équipe ccremote — la garde listait
# alors systématiquement au moins une mission active : la sienne. La seule
# échappatoire (`--malgre-equipes-actives`) revenait donc à s'auto-détruire.
# `CLAUDE_CODE_SESSION_ID` est posé nativement par le SDK Claude Agent au
# lancement de CHAQUE worker (jamais par ce dépôt — vérifié : absent de
# `buildWorkerEnv`, présent quand même dans l'environnement réel de toute
# équipe) et correspond au `sessionId` que le registre attribue à la mission
# (`control-plane/orchestrateur/dispatch-mandat.ts`), exposé tel quel par
# l'API `/missions` (`MissionApi.sessionId`, `control-plane/api-web/
# vue-missions.ts`). La garde l'utilise pour s'exclure du comptage — jamais
# pour relâcher la détection des AUTRES équipes actives. Si la variable est
# absente, refuser plutôt que supposer « personne d'actif » : une équipe qui
# ignore sa propre identité ne peut pas prouver qu'elle est seule.
#
# ☠ REDÉMARRAGE DÉTACHÉ (étape 5). Ce script tourne potentiellement comme
# enfant du service qu'il redémarre (une équipe, lancée par ccremote-pc,
# exécutant ce script). `systemctl --user restart ccremote-pc` en foreground
# tuerait alors CE SCRIPT avant qu'il ait pu enchaîner le VPS et le rapport
# final. La parade, reprise TELLE QUELLE de `deployer-apprentissage.sh`
# (corrigée le 18/08) : à partir de l'étape 5, le script SE RÉINVOQUE
# lui-même (`--continuer-apres-coupure`) dans une unité systemd TRANSITOIRE,
# fire-and-forget (`systemd-run --user --collect`, sans --wait/--pipe) — un
# scope cgroup INDÉPENDANT de celui qui redémarre. La suite (PC, VPS, MCP,
# rapport) tourne entièrement DANS cette unité ; sa sortie part dans le
# journal de l'unité, jamais sur un stdout qui peut mourir avec son lecteur.
# Le processus original tente de le suivre en direct, mais peut mourir avec
# le service qu'il vient de redémarrer — c'est ATTENDU, pas une panne : le
# travail continue ailleurs, et la commande pour le relire est toujours
# affichée AVANT le redémarrage.
set -e

RACINE="$(cd "$(dirname "$0")" && pwd)"
HARNESS="$RACINE/harness"
SCRIPT="$RACINE/$(basename "$0")"

PI_TARGET="${CCREMOTE_PI_CIBLE:-pi@pi.exemple}"
SSH_KEY="${CCREMOTE_SSH_KEY:-$HOME/.ssh/id_ed25519_ccremote}"
SSH_OPTS_PI="-o BatchMode=yes -i $SSH_KEY"
VPS_CIBLE="${CCREMOTE_VPS_CIBLE:-vps}"

SIMULATION=0
MALGRE_EQUIPES=0
CONTINUATION=0
for arg in "$@"; do
  case "$arg" in
    --simulation) SIMULATION=1 ;;
    --malgre-equipes-actives) MALGRE_EQUIPES=1 ;;
    --continuer-apres-coupure) CONTINUATION=1 ;;
    -h|--aide|--help)
      cat <<'AIDE'
deployer-tout.sh — un seul geste, les trois machines de ccremote

  ./deployer-tout.sh                            déploiement réel, dans l'ordre imposé
  ./deployer-tout.sh --simulation                affiche le plan complet, n'exécute rien
  ./deployer-tout.sh --malgre-equipes-actives    passe outre la garde équipes (DESTRUCTEUR)

Refuse par défaut si une équipe AUTRE que celle qui exécute ce script est
active sur le PC ou le VPS : la relance automatique n'existe pas, un
redémarrage de superviseur la tue pour de bon. La mission qui lance ce script
est exclue de son propre comptage (sinon la garde refuserait toujours).
AIDE
      exit 0
      ;;
    *)
      echo "✗ argument inconnu : '$arg'" >&2
      echo "  usage : ./deployer-tout.sh [--simulation|--malgre-equipes-actives]" >&2
      exit 64
      ;;
  esac
done

RAPPORT_PI_CONTROL="—"; RAPPORT_PI_WEB="—"; RAPPORT_PC="—"
RAPPORT_VPS_SUPERVISEUR="—"; RAPPORT_VPS_MCP="—"

# ── 1. Mise à jour du code (PC) ──────────────────────────────────────────────
mettre_a_jour_code() {
  echo "→ Mise à jour du code sur $RACINE"
  local sale
  sale="$(git -C "$RACINE" status --porcelain)"
  if [ -n "$sale" ]; then
    echo "✗ arbre de travail sale — commit ou stash avant de déployer :" >&2
    echo "$sale" >&2
    exit 1
  fi
  local branche avant apres
  branche="$(git -C "$RACINE" rev-parse --abbrev-ref HEAD)"
  avant="$(git -C "$RACINE" rev-parse HEAD)"
  echo "  branche courante : $branche ($avant)"
  if [ "$SIMULATION" = "1" ]; then
    git -C "$RACINE" fetch --quiet 2>/dev/null || echo "  ⚠ fetch impossible depuis cet environnement — non bloquant en simulation"
    local derriere
    derriere="$(git -C "$RACINE" rev-list --count "HEAD..@{u}" 2>/dev/null || echo '?')"
    echo "  [simulation] git pull --ff-only ferait avancer de $derriere commit(s) — non exécuté"
    return 0
  fi
  # ☠ `--ff-only`, jamais `--rebase` ni `-X ours/theirs` : aucun forçage,
  # aucun écrasement de modification locale. Une fusion non triviale est un
  # refus, pas une décision prise à la place de l'opérateur.
  if ! git -C "$RACINE" pull --ff-only; then
    echo "✗ git pull --ff-only a échoué — fusion non triviale, refusé (jamais de forçage)" >&2
    exit 1
  fi
  apres="$(git -C "$RACINE" rev-parse HEAD)"
  if [ "$avant" = "$apres" ]; then
    echo "  ✓ déjà à jour ($apres)"
  else
    echo "  ✓ mis à jour $avant → $apres"
  fi
}

# ── 2. Garde « aucune équipe active (hors soi-même) » ────────────────────────
verifier_equipes_actives() {
  echo "→ Contrôle des équipes actives (PC et VPS, via pilotage/pilote.ts — lecture seule)"
  if [ -z "${CCREMOTE_UI_PASSWORD:-}" ]; then
    echo "  ⚠ CCREMOTE_UI_PASSWORD absent — impossible d'interroger le parc." >&2
    if [ "$SIMULATION" = "1" ]; then
      echo "  [simulation] la suite du plan est affichée quand même ; en exécution réelle" \
           "ce serait un refus (rien de sûr ne peut être affirmé sans ce contrôle)."
      return 0
    fi
    echo "  export CCREMOTE_UI_PASSWORD avant de relancer — refus par prudence." >&2
    exit 78
  fi

  # ☠ La garde doit s'exclure ELLE-MÊME (voir en-tête) : sans ça, ce script,
  # lancé comme équipe, se détecte systématiquement comme « équipe active » et
  # refuse toujours. `CLAUDE_CODE_SESSION_ID` est posé par le SDK, jamais par ce
  # dépôt (absent de `buildWorkerEnv`) — s'il manque, l'identité propre n'est
  # PAS déterminable : refus par prudence, jamais une supposition « personne
  # d'actif ».
  if [ -z "${CLAUDE_CODE_SESSION_ID:-}" ]; then
    echo "  ✗ CLAUDE_CODE_SESSION_ID absent — impossible de déterminer quelle mission" >&2
    echo "    exécute CE script pour l'exclure de son propre comptage. Refus par" >&2
    echo "    prudence : ce script tourne forcément dans une équipe active, une" >&2
    echo "    supposition « personne d'actif » serait fausse par construction." >&2
    exit 78
  fi

  local brut nb exclueSoiMeme
  brut="$(cd "$HARNESS" && CCREMOTE_MON_SESSION_ID="$CLAUDE_CODE_SESSION_ID" bun -e "
import { ClientPilote } from './pilotage/client-pilote.ts';
const mdp = process.env.CCREMOTE_UI_PASSWORD as string;
const monSessionId = process.env.CCREMOTE_MON_SESSION_ID as string;
const c = new ClientPilote(mdp, process.env.CCREMOTE_BASE || undefined);
const { data } = await c.missions();
const TERMINALES = new Set(['terminee', 'echec']);
// Cast justifié : MissionParc (le type du client) est plus étroit que la
// réponse HTTP réelle (machine, idleAgo, pausedAgo, blockedSince, sessionId
// existent côté serveur mais ne sont pas tous déclarés côté client) — on lit
// le JSON réel.
const brutes = data as unknown as Record<string, unknown>[];
const actives = brutes.filter((m) => !TERMINALES.has(String(m['state'])));
// Exclut UNIQUEMENT la mission dont le sessionId est celui de CE script — les
// autres équipes actives continuent de compter, sans exception.
const autres = actives.filter((m) => String(m['sessionId'] ?? '') !== monSessionId);
console.log(JSON.stringify({ autres, exclueSoiMeme: autres.length !== actives.length }));
" 2>&1)"
  if ! echo "$brut" | jq -e . >/dev/null 2>&1; then
    echo "✗ interrogation du parc en échec :" >&2
    echo "$brut" >&2
    exit 1
  fi

  nb="$(echo "$brut" | jq '.autres | length')"
  exclueSoiMeme="$(echo "$brut" | jq -r '.exclueSoiMeme')"
  if [ "$nb" -eq 0 ]; then
    if [ "$exclueSoiMeme" = "true" ]; then
      echo "  ✓ aucune équipe active hormis celle qui exécute ce script (exclue de son propre comptage)"
    else
      echo "  ✓ aucune équipe active, sur aucune des deux machines de travail"
    fi
    return 0
  fi

  echo "  ⚠ $nb équipe(s) active(s) EN PLUS de celle qui exécute ce script — un" >&2
  echo "    redémarrage de superviseur les tuerait :" >&2
  echo "$brut" | jq -r '.autres[] | "    · " + (.project // "?") + " — " + (.title // .id) +
    "  [état=" + (.state // "?") + ", machine=" + (.machine // "inconnue") + ", depuis " +
    ((.idleAgo // .pausedAgo // .blockedSince) // "à l’instant (tour en cours, non horodaté par l’API)") + "]"' >&2

  if [ "$MALGRE_EQUIPES" = "1" ]; then
    echo "" >&2
    echo "  ⚠⚠ --malgre-equipes-actives : passage en force. CECI VA TUER les équipes" >&2
    echo "     listées ci-dessus (hors celle qui exécute ce script) et PERDRE leur" >&2
    echo "     travail en cours (pas de reprise auto)." >&2
    return 0
  fi

  echo "" >&2
  echo "✗ refus d'avancer : équipe(s) active(s) ci-dessus (hors celle qui exécute ce script)." >&2
  echo "  Relance avec --malgre-equipes-actives pour passer outre, en connaissance de cause." >&2
  exit 78
}

# ── 3. Control plane du Pi ───────────────────────────────────────────────────
etape_control_plane_pi() {
  echo "→ Control plane du Pi (deploy-harness-pi.sh)"
  if [ "$SIMULATION" = "1" ]; then
    echo "  [simulation] appellerait : ./deploy-harness-pi.sh $PI_TARGET"
    RAPPORT_PI_CONTROL="(simulation) aurait été envoyé et redémarré"
    return 0
  fi
  if ! "$RACINE/deploy-harness-pi.sh" "$PI_TARGET"; then
    echo "✗ deploy-harness-pi.sh a échoué" >&2
    RAPPORT_PI_CONTROL="✗ échec"
    exit 1
  fi
  RAPPORT_PI_CONTROL="✓ envoyé, redémarré, actif et postérieur aux sources"
}

# ── 4. Interface web du Pi, si elle a changé ─────────────────────────────────
# ☠ Fraîcheur mesurée sur un ARTEFACT RÉEL (heure de démarrage du service
# distant vs mtime des sources locales), jamais sur une supposition — même
# idiome que le contrôle de fraîcheur des cinq scripts existants.
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

etape_web_pi() {
  echo "→ Interface web du Pi — contrôle de fraîcheur"
  if [ "$SIMULATION" = "1" ]; then
    echo "  [simulation] fraîcheur évaluée à l'exécution réelle (comparaison SSH avec" \
         "ccremote-web) — appellerait ./deploy-web-pi.sh $PI_TARGET SI pi-web/ a changé"
    RAPPORT_PI_WEB="(simulation) conditionnel — non évalué ici"
    return 0
  fi
  if [ "$(web_pi_a_change)" = "1" ]; then
    echo "  changement détecté (ou fraîcheur illisible) → redéploiement"
    if ! "$RACINE/deploy-web-pi.sh" "$PI_TARGET"; then
      echo "✗ deploy-web-pi.sh a échoué" >&2
      RAPPORT_PI_WEB="✗ échec"
      exit 1
    fi
    RAPPORT_PI_WEB="✓ changée → redéployée et redémarrée"
  else
    echo "  ✓ déjà à jour — non redéployée"
    RAPPORT_PI_WEB="= inchangée, non redéployée"
  fi
}

# ── 5. Superviseur du PC — DÉTACHÉ (voir en-tête) ────────────────────────────
redemarrer_superviseur_pc() {
  echo ""
  echo "⚠ ÉTAPE SUIVANTE : redémarrage du superviseur du PC."
  echo "  Il coupe la session d'orchestration qui a lancé ce script (même groupe de"
  echo "  processus). Ce script se détache maintenant dans une unité systemd"
  echo "  transitoire pour y survivre — référence : deployer-apprentissage.sh (18/08)."
  if [ "$SIMULATION" = "1" ]; then
    echo "  [simulation] se détacherait puis appellerait : ./deploy-superviseur-pc.sh"
    RAPPORT_PC="(simulation) aurait redémarré, détaché"
    echo "  [simulation] enchaînerait ensuite VPS + MCP + rapport final DANS la même unité détachée"
    return 0
  fi

  local unite journal fin sortie
  unite="ccremote-deploiement-tout-$(date +%s)-$$"
  journal="$(mktemp /tmp/ccremote-deploiement-tout.XXXXXX.log)"
  echo "  unité transitoire : $unite"
  echo "  en cas de coupure, relire :  journalctl --user -u $unite"
  local commande_interne
  commande_interne="cd '$RACINE' && '$SCRIPT' --continuer-apres-coupure; echo EXIT=\$?; echo TERMINE"
  if ! systemd-run --user --unit="$unite" --collect \
    --setenv=CCREMOTE_LIEN_SECRET="${CCREMOTE_LIEN_SECRET:-}" \
    --setenv=CCREMOTE_VPS_CIBLE="$VPS_CIBLE" \
    --description="deployer-tout.sh : suite détachée après redémarrage du superviseur PC" \
    /bin/bash -c "$commande_interne" \
    >"$journal" 2>&1; then
    echo "✗ soumission de l'unité transitoire $unite en échec :" >&2
    cat "$journal" >&2
    exit 1
  fi

  # Borné (JPL) : 10 minutes suffisent large à PC + VPS + MCP. Au-delà, le
  # travail continue quand même — seul CE processus arrête de le suivre.
  fin=$(( $(date +%s) + 600 ))
  sortie=""
  while true; do
    sortie="$(journalctl --user -u "$unite" --no-pager -o cat 2>/dev/null)"
    printf '%s\n' "$sortie" | grep -q '^TERMINE$' && break
    [ "$(date +%s)" -ge "$fin" ] && break
    sleep 3
  done
  printf '%s\n' "$sortie"
  if ! printf '%s\n' "$sortie" | grep -q '^TERMINE$'; then
    echo "" >&2
    echo "⚠ suivi interrompu (session probablement coupée par le redémarrage, ou 10 min" >&2
    echo "  dépassées) — le travail continue dans l'unité détachée. Relire :" >&2
    echo "  journalctl --user -u $unite" >&2
    exit 0
  fi
  printf '%s\n' "$sortie" | grep -q '^EXIT=0$' && exit 0
  exit 1
}

# ── 6. Superviseur du VPS ────────────────────────────────────────────────────
etape_superviseur_vps() {
  echo "→ Superviseur du VPS (deploy-superviseur-vps.sh --demarrer)"
  if [ "$SIMULATION" = "1" ]; then
    echo "  [simulation] appellerait : ./deploy-superviseur-vps.sh --demarrer"
    RAPPORT_VPS_SUPERVISEUR="(simulation) aurait été redémarré"
    return 0
  fi
  if ! CCREMOTE_VPS_CIBLE="$VPS_CIBLE" "$RACINE/deploy-superviseur-vps.sh" --demarrer; then
    echo "✗ deploy-superviseur-vps.sh a échoué" >&2
    RAPPORT_VPS_SUPERVISEUR="✗ échec"
    exit 1
  fi
  RAPPORT_VPS_SUPERVISEUR="✓ redémarré et actif"
}

# ── 7. MCP du VPS, si nécessaire ─────────────────────────────────────────────
mcp_vps_a_change() {
  local p diff
  for p in playwright-mcp log-watcher-mcp pty-mcp; do
    [ -d "/mnt/projects/$p" ] || continue
    if ! ssh "$VPS_CIBLE" "test -d ~/mcp/$p" 2>/dev/null; then
      echo "1"; return  # jamais déployé
    fi
    diff="$(rsync -niaz --delete --exclude .venv --exclude __pycache__ --exclude logs --exclude .git \
      "/mnt/projects/$p/" "$VPS_CIBLE:mcp/$p/" 2>/dev/null)"
    if [ -n "$diff" ]; then echo "1"; return; fi
  done
  echo "0"
}

etape_mcp_vps() {
  echo "→ MCP du VPS — contrôle de fraîcheur (rsync --dry-run)"
  if [ "$SIMULATION" = "1" ]; then
    echo "  [simulation] fraîcheur évaluée à l'exécution réelle (rsync --dry-run vers le VPS)" \
         "— appellerait ./deploy-mcp-vps.sh SI nécessaire"
    RAPPORT_VPS_MCP="(simulation) conditionnel — non évalué ici"
    return 0
  fi
  if [ "$(mcp_vps_a_change)" = "1" ]; then
    echo "  changement détecté → mise à jour"
    if ! "$RACINE/deploy-mcp-vps.sh"; then
      echo "✗ deploy-mcp-vps.sh a échoué" >&2
      RAPPORT_VPS_MCP="✗ échec"
      exit 1
    fi
    RAPPORT_VPS_MCP="✓ changé → mis à jour"
  else
    echo "  ✓ déjà à jour — non redéployé"
    RAPPORT_VPS_MCP="= inchangé, non redéployé"
  fi
}

# ── Rapport consolidé ─────────────────────────────────────────────────────────
rapport_final() {
  echo ""
  echo "════════════════════════════════════════════════════════════════════"
  echo "RAPPORT DE DÉPLOIEMENT"
  echo "  Pi  · control plane : $RAPPORT_PI_CONTROL"
  echo "  Pi  · interface web : $RAPPORT_PI_WEB"
  echo "  PC  · superviseur   : $RAPPORT_PC"
  echo "  VPS · superviseur   : $RAPPORT_VPS_SUPERVISEUR"
  echo "  VPS · MCP           : $RAPPORT_VPS_MCP"
  echo "════════════════════════════════════════════════════════════════════"
}

# ── Suite détachée (invoquée par redemarrer_superviseur_pc, jamais à la main) ─
suite_apres_pc() {
  echo "→ Superviseur du PC (deploy-superviseur-pc.sh, depuis l'unité détachée)"
  if ! "$RACINE/deploy-superviseur-pc.sh"; then
    echo "✗ deploy-superviseur-pc.sh a échoué" >&2
    RAPPORT_PC="✗ échec"
    rapport_final
    exit 1
  fi
  RAPPORT_PC="✓ code à jour, redémarré, actif et postérieur aux sources"
  etape_superviseur_vps
  etape_mcp_vps
  rapport_final
}

# ── Séquence principale ───────────────────────────────────────────────────────
if [ "$CONTINUATION" = "1" ]; then
  # Ni la garde ni les étapes 1-4 ne sont rejouées ici : elles ont déjà
  # tranché avant que ce script se détache. Fenêtre acceptée : une équipe
  # démarrée dans l'intervalle entre la garde et le redémarrage réel ne serait
  # pas revue — un raccourci déjà présent dans deployer-apprentissage.sh.
  suite_apres_pc
  exit 0
fi

mettre_a_jour_code
verifier_equipes_actives
etape_control_plane_pi
etape_web_pi
redemarrer_superviseur_pc
# En simulation seulement : redemarrer_superviseur_pc() ne détache rien et
# rend la main, donc la suite s'affiche ici comme plan.
if [ "$SIMULATION" = "1" ]; then
  etape_superviseur_vps
  etape_mcp_vps
  rapport_final
fi
