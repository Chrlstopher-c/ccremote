#!/bin/bash
# Arrête l'instance de dev local de pi-web démarrée par start.sh.
cd "$(dirname "$0")"

if [ ! -f logs/pi-web.pid ]; then
  echo "Aucun PID enregistré — pi-web n'a probablement pas été démarré via start.sh"
  exit 0
fi

PID=$(cat logs/pi-web.pid)
if kill "$PID" 2>/dev/null; then
  echo "pi-web arrêté (PID $PID)"
else
  echo "Aucun process actif pour le PID $PID"
fi
rm -f logs/pi-web.pid
