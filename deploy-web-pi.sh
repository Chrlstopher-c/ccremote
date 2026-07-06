#!/bin/bash
set -e
TARGET=${1:-"pi@pi.exemple"}
REMOTE_DIR="/home/pi/ccremote-web"
TUNNEL_ID="388bc072-4d8c-4095-88a7-325c840b2656"
SUBDOMAIN="ccremote.exemple.com"
PORT=8766

echo "→ Envoi des fichiers"
ssh "$TARGET" "mkdir -p $REMOTE_DIR/templates $REMOTE_DIR/agent $REMOTE_DIR/static"
scp /mnt/projects/ccremote/pi-web/app.py          "$TARGET:$REMOTE_DIR/"
scp /mnt/projects/ccremote/pi-web/config.py        "$TARGET:$REMOTE_DIR/"
scp /mnt/projects/ccremote/pi-web/pc_client.py      "$TARGET:$REMOTE_DIR/"
scp /mnt/projects/ccremote/pi-web/requirements.txt "$TARGET:$REMOTE_DIR/"
scp /mnt/projects/ccremote/pi-web/templates/*.html "$TARGET:$REMOTE_DIR/templates/"
scp /mnt/projects/ccremote/pi-web/agent/*.py       "$TARGET:$REMOTE_DIR/agent/"
scp /mnt/projects/ccremote/pi-web/static/*         "$TARGET:$REMOTE_DIR/static/"

echo "→ Installation des dépendances"
ssh "$TARGET" "cd $REMOTE_DIR && python3 -m venv venv && venv/bin/pip install -q -r requirements.txt"

echo "→ Création du service systemd"
ssh "$TARGET" "sudo tee /etc/systemd/system/ccremote-web.service > /dev/null <<'EOF'
[Unit]
Description=ccremote web UI
After=network.target

[Service]
WorkingDirectory=$REMOTE_DIR
ExecStart=$REMOTE_DIR/venv/bin/python app.py
Restart=always
User=pi

[Install]
WantedBy=multi-user.target
EOF"

echo "→ Mise à jour config cloudflared"
ssh "$TARGET" "sudo python3 -c \"
import re
cfg = open('/etc/cloudflared/config.yml').read()
rule = '''    - hostname: $SUBDOMAIN
      service: http://localhost:$PORT
'''
if '$SUBDOMAIN' not in cfg:
    cfg = cfg.replace('    - hostname: exemple.com\n      service:', rule + '    - hostname: exemple.com\n      service:')
    open('/etc/cloudflared/config.yml', 'w').write(cfg)
    print('ingress rule ajoutée')
else:
    print('ingress rule déjà présente')
\""

echo "→ Enregistrement DNS"
ssh "$TARGET" "cloudflared tunnel route dns $TUNNEL_ID $SUBDOMAIN 2>&1 || true"

echo "→ Démarrage des services"
ssh "$TARGET" "sudo systemctl daemon-reload && sudo systemctl enable --now ccremote-web && sudo systemctl restart cloudflared"

echo ""
echo "✓ Déployé sur https://$SUBDOMAIN"
echo "  Login par défaut : chris / changeme  ← à changer dans $REMOTE_DIR/config.py"
