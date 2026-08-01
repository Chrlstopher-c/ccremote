#!/bin/bash
# Porte les serveurs MCP des équipes sur le VPS.
#
# ☠ Sans eux, une équipe du VPS travaille SANS navigateur ni surveillance de
# processus — exactement le défaut mesuré le 01/08 sur les comptes du PC
# (`mcpServers: []` depuis l'origine du harness), qui reviendrait ici par la
# porte du portage. Le pré-vol le signale, mais un signalement n'est pas un
# correctif.
#
# ☠ VERSIONS ÉPINGLÉES, et c'est le cœur du script. Le premier portage a
# installé `mcp` sans contrainte : pip a pris la 2.0.0, dont l'API a changé
# (`'Server' object has no attribute 'list_tools'`). Les trois serveurs
# plantaient au démarrage — et côté worker, le symptôme n'était PAS « le serveur
# a planté » mais « l'outil est introuvable ». Une absence silencieuse de plus.
# Le poste tourne en 1.27.1 : on épingle sur ce qui est mesuré, jamais sur
# « la dernière ».
#
# ☠ NE PORTE PAS `semantic-memory` (5,3 Go) : c'est la mémoire personnelle de
# Chris, et une seconde copie divergerait de la première sans que rien ne le
# dise. À trancher explicitement, pas à dupliquer par commodité.
# ☠ NE PORTE PAS `codeindex` : il embarque CUDA/torch et le VPS n'a pas de GPU.
# Faisable en CPU, mais c'est un chantier à part — et son utilité dépend de la
# présence des projets sur le VPS, qui n'est pas tranchée.
#
# Usage : ./deploy-mcp-vps.sh
set -e

CIBLE="${CCREMOTE_VPS_CIBLE:-vps}"
VERSION_MCP="1.27.1"
SERVEURS="playwright-mcp log-watcher-mcp pty-mcp"

echo "→ Prérequis système"
ssh "${CIBLE%%:*}" true
ssh "$CIBLE" "command -v python3 >/dev/null" || { echo "✗ python3 absent du VPS" >&2; exit 78; }

echo "→ Envoi des sources"
ssh "$CIBLE" "mkdir -p ~/mcp"
for p in $SERVEURS; do
  [ -d "/mnt/projects/$p" ] || { echo "  ⚠ /mnt/projects/$p absent du poste — ignoré"; continue; }
  # `.venv` exclu : un venv est lié à sa machine, il se reconstruit sur place.
  rsync -az --delete --exclude .venv --exclude __pycache__ --exclude logs --exclude .git \
    "/mnt/projects/$p/" "$CIBLE:mcp/$p/"
  echo "  $p envoyé"
done

echo "→ Environnements Python (mcp==$VERSION_MCP)"
for p in $SERVEURS; do
  ssh "$CIBLE" "cd ~/mcp/$p && python3 -m venv .venv 2>/dev/null; \
    .venv/bin/pip install -q 'mcp==$VERSION_MCP' loguru pydantic-settings >/dev/null 2>&1; \
    [ -f requirements.txt ] && .venv/bin/pip install -q -r requirements.txt >/dev/null 2>&1; \
    .venv/bin/pip install -q 'mcp==$VERSION_MCP' >/dev/null 2>&1"
  echo "  $p installé"
done

# Playwright a besoin de son navigateur, sinon il échoue à la première page.
echo "→ Navigateur Chromium (playwright)"
ssh "$CIBLE" "cd ~/mcp/playwright-mcp && .venv/bin/pip install -q playwright >/dev/null 2>&1 && \
  .venv/bin/playwright install chromium >/dev/null 2>&1 && echo '  chromium prêt'"

# ☠ Chaque serveur est LANCÉ pour de vrai. Une installation « réussie » ne prouve
# rien : c'est exactement ce que la version 2.0.0 a démontré — pip content,
# serveurs morts, et le worker qui rapporte « outil introuvable ».
echo "→ Vérification : chaque serveur démarre-t-il RÉELLEMENT ?"
ECHECS=0
for p in $SERVEURS; do
  if ssh "$CIBLE" "cd ~/mcp/$p && timeout 10 .venv/bin/python mcp_server.py </dev/null 2>&1 | head -3 | grep -qiE 'traceback|error'"; then
    echo "  ✗ $p PLANTE au démarrage"
    ECHECS=$((ECHECS + 1))
  else
    echo "  ✓ $p démarre"
  fi
done

echo "→ Déclaration dans la config du VPS"
ssh "$CIBLE" "python3 - <<'PY'
import json, os
H = os.path.expanduser('~')
noms = {'playwright': 'playwright-mcp', 'log-watcher': 'log-watcher-mcp', 'pty-mcp': 'pty-mcp'}
chemin = os.path.join(H, '.claude.json')
try:
    cfg = json.load(open(chemin))
except Exception:
    cfg = {}
# Chemins du VPS, jamais recopiés du poste : un chemin du PC produirait un
# serveur qui ne démarre pas, rapporté 'pending' sans jamais lever.
cfg.setdefault('mcpServers', {}).update({
    n: {'type': 'stdio',
        'command': f'{H}/mcp/{d}/.venv/bin/python',
        'args': [f'{H}/mcp/{d}/mcp_server.py'],
        'env': {}}
    for n, d in noms.items()
})
os.umask(0o077)
json.dump(cfg, open(chemin, 'w'), indent=2)
print('  déclarés : ' + ', '.join(noms))
PY"

echo ""
if [ "$ECHECS" -gt 0 ]; then
  echo "✗ $ECHECS serveur(s) en échec — les équipes du VPS seront dégradées." >&2
  exit 1
fi
echo "✓ MCP portés sur le VPS."
echo "  Manquent volontairement : semantic-memory (5,3 Go, à trancher), codeindex (CUDA)."
