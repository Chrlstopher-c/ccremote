#!/bin/bash
# Usage: ./deploy-pi.sh [pi-user@pi-ip]
TARGET=${1:-"pi@pi.exemple"}
REMOTE_DIR="~/ccremote"

echo "→ Déploiement sur $TARGET"

ssh "$TARGET" "mkdir -p $REMOTE_DIR"
scp -r /mnt/projects/ccremote/client/* "$TARGET:$REMOTE_DIR/"

echo "→ Installation des dépendances sur le Pi"
ssh "$TARGET" "cd $REMOTE_DIR && python3 -m venv venv && venv/bin/pip install -q -r requirements.txt"

echo "→ Création de l'alias ccremote"
ssh "$TARGET" "grep -q 'alias ccremote' ~/.bashrc || echo 'alias ccremote=\"$REMOTE_DIR/venv/bin/python $REMOTE_DIR/ccremote.py\"' >> ~/.bashrc"

echo "✓ Déployé. Lance: ssh $TARGET puis: ccremote status"
