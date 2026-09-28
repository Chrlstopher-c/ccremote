#!/usr/bin/env bash
# Mode dev : relais local (variables de .env) + interface de l'app (Vite, http://localhost:1420). Logs remis à zéro.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p logs
[ -f .env ] || { echo ".env absent : cp .env.example .env puis le remplir"; exit 1; }
for nom in relais interface; do
  if [ -f "logs/$nom.pid" ] && kill -0 "$(cat "logs/$nom.pid")" 2>/dev/null; then echo "$nom tourne déjà"; exit 0; fi
  : > "logs/$nom.log"
done
(set -a; source .env; set +a; exec bun run relais/bin.ts) > logs/relais.log 2>&1 &
echo $! > logs/relais.pid
(cd bureau && exec bunx vite --port 1420) > logs/interface.log 2>&1 &
echo $! > logs/interface.pid
echo "relais : http://localhost:${CCREMOTE_PORT_WEB:-8766} (postes sur ${CCREMOTE_PORT_POSTES:-8721})"
echo "interface : http://localhost:1420 — logs/ remis à zéro"
