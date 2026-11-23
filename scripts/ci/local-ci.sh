#!/usr/bin/env bash
# Rejoue .github/workflows/ci.yml dans un conteneur Docker (repli quand GitHub Actions est indisponible).
# Le dépôt est monté en lecture seule et copié sans node_modules : l'hôte n'est jamais modifié.
#   scripts/ci/local-ci.sh            tous les jobs
#   BUN_IMAGE=oven/bun:1.2 scripts/ci/local-ci.sh
set -euo pipefail

RACINE=$(cd "$(dirname "$0")/../.." && pwd)
BUN_IMAGE=${BUN_IMAGE:-oven/bun:1}

ETAPES=$(cat <<'SCRIPT'
set -euo pipefail
# Le runner ubuntu de GitHub a git et pgrep ; l'image oven/bun non : certains tests les appellent.
command -v git >/dev/null && command -v pgrep >/dev/null || { apt-get update -qq && apt-get install -y -qq git procps >/dev/null; }
mkdir -p /work && cd /src && tar --exclude=./node_modules --exclude=.git -cf - . | tar -C /work -xf -
cd /work
echo "== check : racine"
bun install --frozen-lockfile
bun run typecheck
bun test commun poste relais mcp
echo "== check : bureau"
cd /work/bureau
bun install --frozen-lockfile
bun test src
bunx tsc --noEmit
echo "== hq"
cd /work/hq
bun install --frozen-lockfile
bun run typecheck
bun test src
bun run build
echo "CI locale : verte"
SCRIPT
)

if ! command -v docker >/dev/null 2>&1; then
  echo "docker introuvable : CI locale impossible" >&2
  exit 1
fi

docker run --rm -v "$RACINE:/src:ro" "$BUN_IMAGE" bash -c "$ETAPES"
