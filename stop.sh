#!/usr/bin/env bash
# Arrête le relais local et l'interface de dev lancés par start.sh.
cd "$(dirname "$0")"
for nom in relais interface; do
  if [ -f "logs/$nom.pid" ]; then kill "$(cat "logs/$nom.pid")" 2>/dev/null && echo "$nom arrêté"; rm -f "logs/$nom.pid"; fi
done
