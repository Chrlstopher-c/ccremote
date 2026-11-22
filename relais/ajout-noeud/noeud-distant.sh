# Responsabilité : installer et relier le nœud Lanterne d'une machine, exécuté sur elle par SSH (entrée standard).
# Précédé d'un en-tête généré (variables citées) : SHA MACHINE NOM_NOEUD AIGUILLEUR CODE PAIR.
# Idempotent : relancé, il ne change ni le jeton, ni les ports, ni l'identité, et ne réappaire pas un pair connu.
# Bascule : un poste Lanterne existant (lanterne-poste.service) est arrêté et désactivé, ses données copiées dans le
# nœud (même identifiant de machine, mêmes sessions) ; retour-arriere.sh le rétablit.
# Lignes « @… » : lues par le relais.
set -euo pipefail
umask 077
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=$XDG_RUNTIME_DIR/bus}"
BASE="$HOME/.local/share/lanterne-noeud"
CONF="$HOME/.config/lanterne-noeud"
ENV="$CONF/noeud.env"
UNITES="$HOME/.config/systemd/user"
UNITE="$UNITES/lanterne-noeud.service"
NOM_UNITE=lanterne-noeud.service
POSTE=lanterne-poste.service
UNITE_POSTE="$UNITES/$POSTE"
DONNEES="$BASE/donnees"
BASCULE="$BASE/bascule.env"
SOCKET=lanterne

verifier() {
  echo '@etape verification'
  local o
  for o in curl ss tmux gzip sha256sum; do
    command -v "$o" > /dev/null || { echo "outil absent sur la machine : $o" >&2; exit 4; }
  done
  [ -x "$HOME/.local/bin/claude" ] || command -v claude > /dev/null || echo 'avertissement : claude introuvable' >&2
  systemctl --user show-environment > /dev/null 2>&1 \
    || { echo 'bus systemd utilisateur injoignable (loginctl enable-linger requis)' >&2; exit 5; }
  [ -f "$BASE/versions/$SHA/lanterne-moteur" ] && [ -f "$BASE/versions/$SHA/poste-code.tgz" ] \
    || { echo "versions/$SHA incomplet" >&2; exit 2; }
  mkdir -p "$DONNEES/poste" "$CONF" "$UNITES"
  chmod 700 "$BASE" "$DONNEES" "$CONF"
}

# Valeur d'une clé JSON simple ("cle": "valeur") dans un fichier ; vide si absente.
valeur_json() {
  [ -f "$2" ] || return 0
  sed -n "s/.*\"$1\": *\"\\([^\"]*\\)\".*/\\1/p" "$2" | head -1 || true
}

# L'identifiant de machine du nœud est celui de la machine du parc : jamais changé en silence.
fixer_identite() {
  local config="$DONNEES/config.json" actuelle
  actuelle="$(valeur_json machine "$config")"
  if [ -n "$actuelle" ] && [ "$actuelle" != "$MACHINE" ]; then
    echo "le nœud de cette machine s'appelle déjà « $actuelle », pas « $MACHINE » : refus" >&2
    exit 8
  fi
  printf '{\n  "machine": "%s",\n  "description": "%s"\n}\n' "$MACHINE" "$NOM_NOEUD" > "$config.tmp"
  mv -f "$config.tmp" "$config"
}

# Le poste actuel, s'il existe : état, socket tmux, dossier de données ; refus s'il porte un autre identifiant.
lire_poste() {
  POSTE_PRESENT=0; POSTE_ACTIF=0; POSTE_ACTIVE=0; SOURCE=""
  [ -f "$UNITE_POSTE" ] || return 0
  local s cfg d pm
  s="$(sed -n 's/^Environment=CCREMOTE_TMUX_SOCKET=//p' "$UNITE_POSTE" | head -1)"
  [ -z "$s" ] || SOCKET="$s"
  if [ -f "$BASCULE" ]; then
    # Bascule déjà faite : l'état d'origine (pour le retour arrière) est celui d'avant la première.
    . "$BASCULE"
    return 0
  fi
  POSTE_PRESENT=1
  if systemctl --user is-active --quiet "$POSTE"; then POSTE_ACTIF=1; fi
  if systemctl --user is-enabled --quiet "$POSTE" 2> /dev/null; then POSTE_ACTIVE=1; fi
  SOURCE="$HOME/.local/share/lanterne-poste/donnees"
  cfg="$(sed -n 's/^Environment=CCREMOTE_CONFIG_POSTE=//p' "$UNITE_POSTE" | head -1)"
  if [ -n "$cfg" ] && [ -f "$cfg" ]; then
    d="$(valeur_json donnees "$cfg")"
    [ -z "$d" ] || SOURCE="${d/#\~/$HOME}"
    pm="$(valeur_json machine "$cfg")"
    if [ -n "$pm" ] && [ "$pm" != "$MACHINE" ]; then
      echo "le poste actuel s'appelle « $pm », pas « $MACHINE » : refus (ses sessions changeraient de machine)" >&2
      exit 8
    fi
  fi
}

ecrire_env() {
  if [ -e "$ENV" ]; then
    grep -qx "LANTERNE_MOTEUR_TMUX_SOCKET=$SOCKET" "$ENV" \
      || { echo "$ENV utilise une autre socket tmux que le poste ($SOCKET) : refus" >&2; exit 7; }
    return 0
  fi
  local pw pp jeton
  pw="$(port_libre 0)"; pp="$(port_libre "$pw")"
  jeton="$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')"
  {
    echo "# Nœud Lanterne (service utilisateur). Hors dépôt : jeton web et ports propres à cette machine."
    echo "LANTERNE_MOTEUR_DONNEES=$DONNEES"
    echo "LANTERNE_MOTEUR_PORT_WEB=$pw"
    echo "LANTERNE_MOTEUR_PORT_POSTES=$pp"
    echo "LANTERNE_MOTEUR_JETON=$jeton"
    echo "LANTERNE_MOTEUR_CODE_POSTE=$BASE/current/poste-code.tgz"
    echo "LANTERNE_MOTEUR_AUTONOME=1"
    echo "LANTERNE_MOTEUR_TMUX_SOCKET=$SOCKET"
  } > "$ENV"
  chmod 600 "$ENV"
}

port_libre() {
  local p
  for p in $(shuf -i 47100-47999 -n 80); do
    [ "$p" = "$1" ] && continue
    if ! ss -ltnH | awk '{print $4}' | grep -q ":$p\$"; then echo "$p"; return 0; fi
  done
  echo "aucun port libre entre 47100 et 47999" >&2
  return 1
}

# Lignes reprises de l'unité du poste : jetons Claude, PATH, bornes. Sans poste : PATH et bornes par défaut.
reprises_unite() {
  local lignes=""
  if [ -f "$UNITE_POSTE" ]; then
    lignes="$(grep -E '^(EnvironmentFile=|Environment=PATH=|MemoryMax=|MemorySwapMax=|CPUQuota=|Nice=)' "$UNITE_POSTE" \
      | grep -v 'poste\.env' || true)"
  elif [ -f "$BASE/reprises-unite.txt" ]; then
    lignes="$(cat "$BASE/reprises-unite.txt")"
  fi
  printf '%s\n' "$lignes" | grep -q '^Environment=PATH=' \
    || lignes="$(printf '%s\n%s' "$lignes" 'Environment=PATH=%h/.local/bin:/usr/local/bin:/usr/bin:/bin')"
  printf '%s\n' "$lignes" | grep -q '^MemoryMax=' \
    || lignes="$(printf '%s\n%s\n%s\n%s' "$lignes" 'MemoryHigh=4G' 'MemoryMax=6G' 'MemorySwapMax=0')"
  printf '%s\n' "$lignes" | grep -q '^Nice=' || lignes="$(printf '%s\n%s' "$lignes" 'Nice=5')"
  printf '%s\n' "$lignes" | sed '/^$/d'
}

ecrire_unite() {
  echo '@etape unité'
  local reprises
  reprises="$(reprises_unite)"
  # Les lignes reprises du poste sont gardées à part : la relance après bascule (poste retiré) les retrouve.
  printf '%s\n' "$reprises" > "$BASE/reprises-unite.txt"
  {
    echo '[Unit]'
    echo 'Description=Nœud Lanterne : relais et poste, sans fenêtre'
    echo 'After=network-online.target'
    echo
    echo '[Service]'
    echo 'Type=simple'
    echo "WorkingDirectory=$DONNEES"
    echo "EnvironmentFile=$ENV"
    echo 'Environment=LANG=C.UTF-8'
    printf '%s\n' "$reprises"
    echo "ExecStart=$BASE/current/lanterne-moteur"
    echo 'Restart=on-failure'
    echo 'RestartSec=5'
    echo 'KillMode=process'
    echo 'TimeoutStopSec=30'
    echo 'OOMPolicy=continue'
    echo
    echo '[Install]'
    echo 'WantedBy=default.target'
  } > "$UNITE.tmp"
  if [ -e "$UNITE" ] && ! cmp -s "$UNITE" "$UNITE.tmp"; then cp "$UNITE" "$UNITE.bak-$(date -u +%Y%m%dT%H%M%SZ)"; fi
  mv -f "$UNITE.tmp" "$UNITE"
  systemctl --user daemon-reload
}

ecrire_retour_arriere() {
  cat > "$BASE/retour-arriere.sh.tmp" << FIN
#!/usr/bin/env bash
# Retour arrière du nœud : arrêté et désactivé ; le poste d'origine, s'il existait, est réactivé et redémarré.
# Données du nœud conservées dans $DONNEES.
set -euo pipefail
export XDG_RUNTIME_DIR="\${XDG_RUNTIME_DIR:-/run/user/\$(id -u)}"
export DBUS_SESSION_BUS_ADDRESS="\${DBUS_SESSION_BUS_ADDRESS:-unix:path=\$XDG_RUNTIME_DIR/bus}"
systemctl --user disable --now $NOM_UNITE || true
POSTE_PRESENT=0; POSTE_ACTIF=0; POSTE_ACTIVE=0
[ ! -f "$BASCULE" ] || . "$BASCULE"
if [ "\$POSTE_ACTIVE" = 1 ]; then systemctl --user enable $POSTE > /dev/null || true; fi
if [ "\$POSTE_ACTIF" = 1 ]; then
  systemctl --user start $POSTE || echo "poste d'origine : à redémarrer à la main" >&2
fi
rm -f "$BASCULE"
echo "@retour nœud arrêté et désactivé, poste d'origine rétabli (\$POSTE_ACTIF) ; données conservées dans $DONNEES"
FIN
  chmod 700 "$BASE/retour-arriere.sh.tmp"
  mv -f "$BASE/retour-arriere.sh.tmp" "$BASE/retour-arriere.sh"
}

# La bascule : le poste s'arrête (KillMode=process : ses sessions tmux survivent), ses données passent au nœud.
basculer() {
  [ "$POSTE_PRESENT" = 1 ] || return 0
  echo '@etape bascule'
  if [ ! -f "$BASCULE" ]; then
    local km
    km="$(systemctl --user show -p KillMode --value "$POSTE" 2> /dev/null || true)"
    if [ "$POSTE_ACTIF" = 1 ] && [ "$km" != process ]; then
      echo "le poste actuel a KillMode=$km : l'arrêter tuerait ses sessions tmux, refus" >&2
      exit 9
    fi
    printf 'POSTE_PRESENT=1\nPOSTE_ACTIF=%s\nPOSTE_ACTIVE=%s\nSOURCE=%q\n' "$POSTE_ACTIF" "$POSTE_ACTIVE" "$SOURCE" \
      > "$BASCULE"
  fi
  systemctl --user stop "$POSTE" || true
  systemctl --user disable "$POSTE" > /dev/null 2>&1 || true
  reprendre_donnees
}

# Une seule reprise : les données du poste remplacent celles du nœud (gardées à côté si le nœud en avait).
reprendre_donnees() {
  [ ! -f "$DONNEES/poste/.repris" ] || return 0
  [ -d "$SOURCE" ] || { echo "dossier de données du poste introuvable : $SOURCE" >&2; exit 10; }
  if [ -n "$(ls -A "$DONNEES/poste" 2> /dev/null)" ]; then
    mv "$DONNEES/poste" "$DONNEES/poste.avant-reprise-$(date -u +%Y%m%dT%H%M%SZ)"
    mkdir -p "$DONNEES/poste"
  fi
  cp -a "$SOURCE"/. "$DONNEES/poste/"
  find "$DONNEES/poste" -maxdepth 1 -type s -delete
  date -u +%Y-%m-%dT%H:%M:%SZ > "$DONNEES/poste/.repris"
  echo "@repris $(find "$DONNEES/poste" -maxdepth 1 -type f | wc -l) fichier(s)"
}

demarrer() {
  echo '@etape démarrage'
  local avant
  avant="$(readlink "$BASE/current" 2> /dev/null || true)"
  if [ -n "$avant" ] && [ "$avant" != "versions/$SHA" ]; then echo "$avant" > "$BASE/precedent"; fi
  ln -sfn "versions/$SHA" "$BASE/current.tmp" && mv -T "$BASE/current.tmp" "$BASE/current"
  systemctl --user enable "$NOM_UNITE" > /dev/null
  if [ "$avant" = "versions/$SHA" ] && systemctl --user is-active --quiet "$NOM_UNITE"; then
    echo "nœud déjà à jour et en marche"
  else
    systemctl --user restart "$NOM_UNITE"
  fi
  PW="$(sed -n 's/^LANTERNE_MOTEUR_PORT_WEB=//p' "$ENV")"
  JETON="$(sed -n 's/^LANTERNE_MOTEUR_JETON=//p' "$ENV")"
  API="http://127.0.0.1:$PW"
  local code=000 i
  for i in $(seq 1 120); do
    code="$(curl -s -o /dev/null -w '%{http_code}' "$API/api/etat" || true)"
    [ "$code" = 401 ] && break
    sleep 0.5
  done
  [ "$code" = 401 ] && [ "$(appel GET /api/etat -o /dev/null -w '%{http_code}')" = 200 ] \
    || { echo "le nœud ne répond pas (journalctl --user -u $NOM_UNITE -n 40)" >&2; exit 5; }
  if ! loginctl show-user "$(id -un)" -p Linger 2> /dev/null | grep -q 'Linger=yes'; then
    echo 'avertissement : linger désactivé, le nœud s’arrête sans session (loginctl enable-linger)' >&2
  fi
}

# Appel de l'API locale du nœud, jeton par l'en-tête (jamais sur la ligne de commande : lu sur l'entrée standard).
appel() {
  local methode="$1" chemin="$2"
  shift 2
  printf 'header = "Authorization: Bearer %s"\n' "$JETON" \
    | curl -s -K - -X "$methode" -H 'Content-Type: application/json' "$@" "$API$chemin"
}

federation() {
  appel GET /api/federation | tr -d '\n'
}

attendre() {
  local motif="$1" n="$2" i
  for i in $(seq 1 "$n"); do
    if federation | grep -q -- "$motif"; then return 0; fi
    sleep 0.5
  done
  return 1
}

relier() {
  echo '@etape aiguilleur'
  if ! federation | grep -q '"aiguilleur":{'; then
    [ -n "$CODE" ] || { echo "le nœud n'est pas relié et aucun code n'a été fourni" >&2; exit 11; }
    printf '{"url":"%s","code":"%s","nom":"%s"}' "$AIGUILLEUR" "$CODE" "$NOM_NOEUD" > "$BASE/tmp-corps.json"
    local r
    r="$(appel POST /api/federation/aiguilleur --data-binary @"$BASE/tmp-corps.json" -w ' %{http_code}' || true)"
    rm -f "$BASE/tmp-corps.json"
    case "$r" in *' 200') ;; *) echo "rattachement à l'aiguilleur refusé : $r" >&2; exit 12 ;; esac
  fi
  attendre '"relie":true' 60 || { echo "le nœud ne joint pas l'aiguilleur" >&2; exit 12; }
  echo "@membre $(federation | sed -n 's/.*"aiguilleur":{[^}]*"id":"\([a-f0-9]*\)".*/\1/p')"
  echo "@empreinte $(federation | sed -n 's/.*"empreinteLocale":"\([^"]*\)".*/\1/p')"
}

appairer() {
  echo '@etape appairage'
  if federation | grep -q "\"noeuds\":\[[^]]*\"id\":\"$PAIR\""; then
    echo '@deja-appaire'
    return 0
  fi
  attendre "{\"id\":\"$PAIR\",\"enLigne\":true" 60 \
    || { echo "cette machine ne voit pas le nœud demandeur en ligne" >&2; exit 13; }
  local r
  r="$(appel POST /api/federation/appairer --data-binary "{\"membre\":\"$PAIR\"}" -w ' %{http_code}' || true)"
  case "$r" in *' 200') ;; *) echo "demande d'appairage refusée : $r" >&2; exit 13 ;; esac
  attendre "{\"membre\":\"$PAIR\",\"phase\":\"[a-z-]*\",\"nom\":\"[^\"]*\",\"empreinte\":\"[0-9A-F]" 60 \
    || { echo "le nœud demandeur ne s'est pas présenté" >&2; exit 13; }
  local motif
  motif="s/.*{\"membre\":\"$PAIR\",\"phase\":\"[a-z-]*\",\"nom\":\"[^\"]*\","
  motif="$motif\"empreinte\":\"\\([^\"]*\\)\".*/\\1/p"
  echo "@empreinte-pair $(federation | sed -n "$motif")"
}

verifier
fixer_identite
lire_poste
ecrire_env
ecrire_unite
ecrire_retour_arriere
basculer
demarrer
relier
appairer
echo '@fin'
