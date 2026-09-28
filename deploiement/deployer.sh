#!/usr/bin/env bash
# Déploie ccremote v2 depuis le portable : le relais sur le Pi, un poste par machine.
#   ./deploiement/deployer.sh relais            relais (Pi) + interface web servie par lui
#   ./deploiement/deployer.sh poste <machine>   poste d'une machine (pi, tour, portable, vps)
#   ./deploiement/deployer.sh tout              postes d'abord, relais ensuite
# Les valeurs réelles (adresses, MAC, secrets) viennent de ~/.config/ccremote/deploiement.env, jamais du dépôt.
# Idempotent : relançable pour mettre à jour. Le code vient de la branche dev sur GitHub.
set -euo pipefail

ICI=$(cd "$(dirname "$0")/.." && pwd)
ENV_LOCAL=${CCREMOTE_DEPLOIEMENT:-$HOME/.config/ccremote/deploiement.env}
# shellcheck source=/dev/null
source "$ENV_LOCAL"
DEPOT=https://github.com/Chrlstopher-c/ccremote.git
BRANCHE=dev
log() { printf '\033[1;35m▸ %s\033[0m\n' "$*"; }

# --- exécution distante, sous le bon utilisateur ---------------------------------------------------------------
executer() { # machine, script (stdin)
  case $1 in
    pi) ssh "$PI_SSH" 'sudo -u pi -H bash -s' ;;
    portable) bash -s ;;
    *) ssh "$1" 'bash -s' ;;
  esac
}
executer_root() { # machine, script (stdin) — pour les unités système
  case $1 in
    pi) ssh "$PI_SSH" 'sudo bash -s' ;;
    *) ssh "$1" 'sudo bash -s' ;;
  esac
}

# --- description de chaque poste (rien de secret) -------------------------------------------------------------
fiche() { # machine → variables DESCRIPTION RACINES COMPTES URL UNITE
  case $1 in
    tour) DESCRIPTION="PC fixe (Arch, GPU NVIDIA, 12 cœurs) : le lieu des builds lourds"
      RACINES='["/mnt/projects"]'; COMPTES='{"principal": null}'; URL="ws://$PI_LAN:8721/poste"; UNITE=utilisateur ;;
    portable) DESCRIPTION="Portable de Chris (Arch, 8 cœurs, 7 Go) : builds légers seulement"
      RACINES='["~", "~/projects"]'; COMPTES='{"principal": null}'; URL="$LIEN_PUBLIC"; UNITE=utilisateur ;;
    pi) DESCRIPTION="Raspberry Pi, production (sites, relais) : exploitation seulement, aucun build"
      RACINES='["/mnt/projects"]'; COMPTES='{"principal": null}'; URL="ws://127.0.0.1:8721/poste"; UNITE=systeme ;;
    vps) DESCRIPTION="VPS OVH, production StockIOP : exploitation seulement, aucun build"
      RACINES='["~/dev", "~"]'; URL="$LIEN_PUBLIC"; UNITE=systeme
      COMPTES='{"compte-a": "~/.claude-comptes/compte-a", "compte-b": "~/.claude-comptes/compte-b"}' ;;
    *) echo "machine inconnue : $1" >&2; exit 1 ;;
  esac
}

secret_de() { local v="SECRET_${1^^}"; printf '%s' "${!v}"; }

code_a_jour() { # sur la machine cible : clone ou mise à jour du code, dépendances de production
  cat <<EOF
set -e
export PATH=\$HOME/.bun/bin:\$PATH
mkdir -p \$HOME/.local/share/ccremote
cd \$HOME/.local/share/ccremote
if [ -d code/.git ]; then git -C code fetch -q origin $BRANCHE && git -C code reset -q --hard origin/$BRANCHE
else git clone -q -b $BRANCHE $DEPOT code; fi
cd code && bun install --production --frozen-lockfile >/dev/null
echo "code : \$(git log -1 --format='%h %s' | cut -c1-70)"
EOF
}

# --- poste ------------------------------------------------------------------------------------------------------
deployer_poste() {
  local m=$1; fiche "$m"
  log "poste $m : code"
  code_a_jour | executer "$m"
  log "poste $m : configuration"
  executer "$m" <<EOF
set -e
command -v tmux >/dev/null || { echo "tmux manquant sur $m"; exit 1; }
mkdir -p \$HOME/.config/ccremote && chmod 700 \$HOME/.config/ccremote
cat > \$HOME/.config/ccremote/poste.json <<JSON
{ "machine": "$m", "relais": "$URL", "description": "$DESCRIPTION", "racines": $RACINES, "comptes": $COMPTES }
JSON
umask 077; printf 'CCREMOTE_SECRET_POSTE=%s\n' '$(secret_de "$m")' > \$HOME/.config/ccremote/poste.env
EOF
  installer_unite "$m"
}

unite_poste() { # home, bun, cible (default.target | multi-user.target), user (vide pour une unité utilisateur)
  cat <<EOF
[Unit]
Description=ccremote — poste (sessions Claude Code de cette machine)
After=network-online.target

[Service]
${4:+User=$4}
WorkingDirectory=$1/.local/share/ccremote/code
EnvironmentFile=$1/.config/ccremote/poste.env
Environment=PATH=$1/.bun/bin:$1/.local/bin:$1/.cargo/bin:/usr/local/bin:/usr/bin:/bin
Environment=LANG=C.UTF-8
ExecStart=$2 run poste/bin.ts
Restart=always
RestartSec=5
# Les Claude vivent dans le serveur tmux lancé par le poste : redémarrer le poste ne doit jamais les tuer.
KillMode=process

[Install]
WantedBy=$3
EOF
}

installer_unite() {
  local m=$1 user home unite
  if [ "$UNITE" = utilisateur ]; then
    home=$(echo 'echo $HOME' | executer "$m")
    installer_unite_utilisateur "$m" "$home"
    return
  fi
  user=$([ "$m" = pi ] && echo pi || echo ubuntu)
  home=/home/$user
  unite=$(unite_poste "$home" "$home/.bun/bin/bun" multi-user.target "$user")
  executer_root "$m" <<EOF
cat > /etc/systemd/system/ccremote-poste.service <<'UNITE'
$unite
UNITE
command -v tmux >/dev/null || apt-get install -y -qq tmux >/dev/null
sudo -u $user XDG_RUNTIME_DIR=/run/user/\$(id -u $user) systemctl --user disable --now ccremote-pc.service 2>/dev/null || true
systemctl daemon-reload && systemctl enable -q ccremote-poste.service
systemctl restart ccremote-poste.service && sleep 3 && systemctl is-active ccremote-poste.service
EOF
}

installer_unite_utilisateur() { # machine, home — écrit l'unité puis (re)démarre le poste
  local m=$1 home=$2 unite
  unite=$(unite_poste "$home" "$home/.bun/bin/bun" default.target "")
  executer "$m" <<EOF
mkdir -p \$HOME/.config/systemd/user
cat > \$HOME/.config/systemd/user/ccremote-poste.service <<'UNITE'
$unite
UNITE
systemctl --user disable --now ccremote-pc.service 2>/dev/null || true
systemctl --user daemon-reload && systemctl --user enable -q ccremote-poste.service
systemctl --user restart ccremote-poste.service && sleep 3 && systemctl --user is-active ccremote-poste.service
EOF
}

# --- relais -----------------------------------------------------------------------------------------------------
deployer_relais() {
  log "relais : interface web (build léger, ici)"
  (cd "$ICI/bureau" && bun install --frozen-lockfile >/dev/null && bun run build >/dev/null)
  log "relais : code sur le Pi"
  executer pi <<EOF
set -e
export PATH=\$HOME/.bun/bin:\$PATH
cd /mnt/projects
if [ -d ccremote-relais/.git ]; then git -C ccremote-relais fetch -q origin $BRANCHE && git -C ccremote-relais reset -q --hard origin/$BRANCHE
else git clone -q -b $BRANCHE $DEPOT ccremote-relais; fi
cd ccremote-relais && bun install --production --frozen-lockfile >/dev/null && mkdir -p bureau/dist
echo "code : \$(git log -1 --format='%h %s' | cut -c1-70)"
EOF
  tar -C "$ICI/bureau/dist" -cf - . | ssh "$PI_SSH" 'sudo -u pi tar -C /mnt/projects/ccremote-relais/bureau/dist -xf -'
  log "relais : environnement (mot de passe inchangé : celui de l'ancienne interface)"
  executer_root pi <<EOF
set -e
mkdir -p /mnt/hdd/ccremote && chown pi:pi /mnt/hdd/ccremote && chmod 700 /mnt/hdd/ccremote
if [ ! -f /mnt/hdd/ccremote/relais.env ]; then
  MDP=\$(grep -m1 '^UI_PASSWORD=' /mnt/projects/ccremote-web/.env | cut -d= -f2- | tr -d "\\"'")
  EMPREINTE=\$(sudo -u pi MDP="\$MDP" /home/pi/.bun/bin/bun -e 'console.log(await Bun.password.hash(process.env.MDP))')
  printf "CCREMOTE_EMPREINTE_MOT_DE_PASSE='%s'\n" "\$EMPREINTE" > /mnt/hdd/ccremote/relais.env
fi
sed -i '/^CCREMOTE_\(SECRETS_POSTES\|MACHINES_ISOLEES\|WOL\|DIFFUSION_WOL\|BASE\|WEB\)=/d' /mnt/hdd/ccremote/relais.env
cat >> /mnt/hdd/ccremote/relais.env <<ENV
CCREMOTE_SECRETS_POSTES=pi=$SECRET_PI,tour=$SECRET_TOUR,portable=$SECRET_PORTABLE,vps=$SECRET_VPS
CCREMOTE_MACHINES_ISOLEES=$MACHINES_ISOLEES
CCREMOTE_WOL=$WOL
CCREMOTE_DIFFUSION_WOL=$DIFFUSION_WOL
CCREMOTE_BASE=/mnt/hdd/ccremote/relais.db
CCREMOTE_WEB=/mnt/projects/ccremote-relais/bureau/dist
ENV
chown pi:pi /mnt/hdd/ccremote/relais.env && chmod 600 /mnt/hdd/ccremote/relais.env
cat > /etc/systemd/system/ccremote-relais.service <<'UNITE'
[Unit]
Description=ccremote — relais (API, flux, lien des postes ; aucun LLM)
After=network-online.target

[Service]
User=pi
WorkingDirectory=/mnt/projects/ccremote-relais
EnvironmentFile=/mnt/hdd/ccremote/relais.env
ExecStart=/home/pi/.bun/bin/bun run relais/bin.ts
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNITE
systemctl disable --now ccremote-harness.service ccremote-web.service 2>/dev/null || true
systemctl daemon-reload && systemctl enable -q ccremote-relais.service && systemctl restart ccremote-relais.service
sleep 3 && systemctl is-active ccremote-relais.service
EOF
}

case ${1:-} in
  relais) deployer_relais ;;
  poste) deployer_poste "${2:?machine attendue}" ;;
  tout) for m in tour portable vps pi; do deployer_poste "$m"; done; deployer_relais ;;
  *) sed -n '2,7p' "$0"; exit 1 ;;
esac
