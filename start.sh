#!/bin/bash
# Démarre pi-web en local pour le dev (avant déploiement sur le Pi via deploy-web-pi.sh).
# server.py tourne en systemd sur cette même machine (ccremote-server) — pas géré ici.
set -e
cd "$(dirname "$0")"

mkdir -p logs
: > logs/pi-web.log

if [ -f logs/pi-web.pid ] && kill -0 "$(cat logs/pi-web.pid)" 2>/dev/null; then
  echo "pi-web tourne déjà (PID $(cat logs/pi-web.pid)) — ./stop.sh d'abord si besoin"
  exit 0
fi

cd pi-web
if [ ! -d venv ]; then
  python3 -m venv venv
  venv/bin/pip install -q -r requirements.txt
fi

nohup venv/bin/python app.py > ../logs/pi-web.log 2>&1 &
echo $! > ../logs/pi-web.pid
cd ..

echo "pi-web démarré (PID $(cat logs/pi-web.pid)) sur http://127.0.0.1:8766 — logs/pi-web.log"
