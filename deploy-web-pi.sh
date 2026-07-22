#!/bin/bash
set -e
TARGET=${1:-"pi@pi.exemple"}
REMOTE_DIR="/home/pi/ccremote-web"
TUNNEL_ID="388bc072-4d8c-4095-88a7-325c840b2656"
SUBDOMAIN="ccremote.exemple.com"
PORT=8766
# ☠ Clé dédiée explicite : sans elle, le script retombait sur ssh-askpass et
# échouait en environnement non interactif (déploiement automatisé compris).
SSH_KEY="${CCREMOTE_SSH_KEY:-$HOME/.ssh/id_ed25519_ccremote}"
SSH_OPTS="-o BatchMode=yes -i $SSH_KEY"

echo "→ Envoi des fichiers"
ssh $SSH_OPTS "$TARGET" "mkdir -p $REMOTE_DIR/templates $REMOTE_DIR/agent $REMOTE_DIR/static"
scp $SSH_OPTS /mnt/projects/ccremote/pi-web/app.py          "$TARGET:$REMOTE_DIR/"
scp $SSH_OPTS /mnt/projects/ccremote/pi-web/config.py        "$TARGET:$REMOTE_DIR/"
scp $SSH_OPTS /mnt/projects/ccremote/pi-web/pc_client.py      "$TARGET:$REMOTE_DIR/"
# ☠ Toute nouvelle dépendance importée par app.py DOIT être ajoutée ici. Cette
# liste est explicite, donc silencieusement incomplète : un module oublié fait
# planter l'app à l'import, en boucle sous `Restart=always`. Déjà failli
# arriver avec harness_proxy.py.
scp $SSH_OPTS /mnt/projects/ccremote/pi-web/harness_proxy.py "$TARGET:$REMOTE_DIR/"
scp $SSH_OPTS /mnt/projects/ccremote/pi-web/requirements.txt "$TARGET:$REMOTE_DIR/"
scp $SSH_OPTS /mnt/projects/ccremote/pi-web/templates/*.html "$TARGET:$REMOTE_DIR/templates/"
scp $SSH_OPTS /mnt/projects/ccremote/pi-web/agent/*.py       "$TARGET:$REMOTE_DIR/agent/"
scp $SSH_OPTS /mnt/projects/ccremote/pi-web/static/*         "$TARGET:$REMOTE_DIR/static/"

echo "→ Installation des dépendances"
ssh $SSH_OPTS "$TARGET" "cd $REMOTE_DIR && python3 -m venv venv && venv/bin/pip install -q -r requirements.txt"

echo "→ Création du service systemd"
ssh $SSH_OPTS "$TARGET" "sudo tee /etc/systemd/system/ccremote-web.service > /dev/null <<'EOF'
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
# ☠ Redémarrer cloudflared coupe TOUS les tunnels du Pi quelques secondes —
# StockIOP, license-server, Twenty CRM compris. On ne le fait donc que si la
# règle d'ingress a réellement changé, jamais à chaque déploiement de ccremote.
REGLE=$(ssh $SSH_OPTS "$TARGET" "sudo python3 -c \"
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
\"")
echo "  $REGLE"

echo "→ Enregistrement DNS"
ssh $SSH_OPTS "$TARGET" "cloudflared tunnel route dns $TUNNEL_ID $SUBDOMAIN 2>&1 || true"

echo "→ Démarrage des services"
ssh $SSH_OPTS "$TARGET" "sudo systemctl daemon-reload && sudo systemctl enable ccremote-web && sudo systemctl restart ccremote-web"
if echo "$REGLE" | grep -q "ajoutée"; then
  echo "  règle d'ingress modifiée → redémarrage de cloudflared"
  ssh $SSH_OPTS "$TARGET" "sudo systemctl restart cloudflared"
else
  echo "  ingress inchangé → cloudflared NON redémarré (les autres tunnels du Pi restent debout)"
fi

echo ""
echo "✓ Déployé sur https://$SUBDOMAIN"
echo "  Login par défaut : chris / changeme  ← à changer dans $REMOTE_DIR/config.py"
