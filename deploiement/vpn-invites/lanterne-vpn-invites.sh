#!/usr/bin/env bash
# Responsabilité : le geste root de l'accès VPN des invités. Traite les demandes déposées par l'aiguilleur
# (`<id>.demande.json`, une clé publique) : attribue la première adresse libre de la plage, ajoute le pair WireGuard
# (à chaud, puis dans la configuration pour la persistance), l'autorise dans l'ensemble nftables, puis écrit la réponse
# (`<id>.reponse.json`) lue par l'aiguilleur. `retirer <clé>` défait un pair. Aucune clé privée ne passe par ici.
# Configuration : /etc/lanterne/vpn-invites.conf (voir README). Variables de test : LANTERNE_VPN_SIMULATION=1 (ni wg
# ni nft), LANTERNE_VPN_INVITES_CONF, LANTERNE_VPN_WG_CONF, LANTERNE_VPN_VERROU.
set -euo pipefail

CONF="${LANTERNE_VPN_INVITES_CONF:-/etc/lanterne/vpn-invites.conf}"
SIMULATION="${LANTERNE_VPN_SIMULATION:-0}"
VERROU="${LANTERNE_VPN_VERROU:-/run/lanterne-vpn-invites.lock}"
MOTIF_IPV4='^[0-9]{1,3}(\.[0-9]{1,3}){3}$'
MOTIF_CLE='^[A-Za-z0-9+/]{43}=$'
MOTIF_ENSEMBLE='^[A-Za-z0-9_. -]+$'

journal() { printf 'lanterne-vpn-invites : %s\n' "$*" >&2; }

valeur() { sed -n "s/^$1=//p" "$CONF" | tail -n 1; }

ipv4_valide() {
  local a b c d
  IFS=. read -r a b c d <<< "$1"
  [[ "$1" =~ $MOTIF_IPV4 ]] && (( a <= 255 && b <= 255 && c <= 255 && d <= 255 ))
}

ip_vers_entier() {
  local a b c d
  IFS=. read -r a b c d <<< "$1"
  echo $(( (a << 24) | (b << 16) | (c << 8) | d ))
}

entier_vers_ip() {
  printf '%d.%d.%d.%d\n' $(( ($1 >> 24) & 255 )) $(( ($1 >> 16) & 255 )) $(( ($1 >> 8) & 255 )) $(( $1 & 255 ))
}

cle_valide() {
  [[ "$1" =~ $MOTIF_CLE ]] || return 1
  [[ "$(printf '%s' "$1" | base64 -d 2>/dev/null | wc -c)" -eq 32 ]]
}

valider_conf() {
  [[ "$INTERFACE" =~ ^[A-Za-z0-9_=+.-]{1,15}$ ]] || { journal "INTERFACE invalide"; exit 1; }
  ipv4_valide "$PLAGE_DEBUT" && ipv4_valide "$PLAGE_FIN" || { journal "PLAGE_DEBUT ou PLAGE_FIN invalide"; exit 1; }
  (( $(ip_vers_entier "$PLAGE_DEBUT") <= $(ip_vers_entier "$PLAGE_FIN") )) || { journal "plage vide"; exit 1; }
  [[ "$NFT_ENSEMBLE" =~ $MOTIF_ENSEMBLE ]] || { journal "NFT_ENSEMBLE invalide (famille table ensemble)"; exit 1; }
  [[ "$DOSSIER" == /* ]] || { journal "DOSSIER : chemin absolu attendu"; exit 1; }
}

charger_conf() {
  [[ -r "$CONF" ]] || { journal "configuration illisible : $CONF"; exit 1; }
  INTERFACE="$(valeur INTERFACE)"
  PLAGE_DEBUT="$(valeur PLAGE_DEBUT)"
  PLAGE_FIN="$(valeur PLAGE_FIN)"
  NFT_ENSEMBLE="$(valeur NFT_ENSEMBLE)"
  DOSSIER="$(valeur DOSSIER)"
  valider_conf
  WG_CONF="${LANTERNE_VPN_WG_CONF:-/etc/wireguard/${INTERFACE}.conf}"
  read -r -a NFT_ARGS <<< "$NFT_ENSEMBLE"
}

# Adresses déjà attribuées à un pair, une par ligne. En simulation : celles du fichier de configuration.
ips_utilisees() {
  if [[ "$SIMULATION" == 1 ]]; then
    [[ -f "$WG_CONF" ]] || return 0
    sed -n 's#^AllowedIPs = \([0-9.]*\)/32$#\1#p' "$WG_CONF"
    return 0
  fi
  local sortie
  sortie="$(wg show "$INTERFACE" allowed-ips)" || return 1
  printf '%s\n' "$sortie" | awk '{ for (i = 2; i <= NF; i++) print $i }' | sed 's#/32$##'
}

choisir_ip() {
  local i candidat
  for (( i = $(ip_vers_entier "$PLAGE_DEBUT"); i <= $(ip_vers_entier "$PLAGE_FIN"); i++ )); do
    candidat="$(entier_vers_ip "$i")"
    if ! grep -qxF -- "$candidat" <<< "$1"; then
      printf '%s\n' "$candidat"
      return 0
    fi
  done
  return 1
}

# Écriture atomique de la réponse, lisible par l'utilisateur de l'aiguilleur (propriétaire du dossier).
ecrire_reponse() {
  local temporaire="$DOSSIER/.$1.reponse.tmp"
  printf '%s\n' "$2" > "$temporaire" || return 1
  chmod 600 "$temporaire" || return 1
  if [[ "$SIMULATION" != 1 ]]; then
    chown --reference="$DOSSIER" "$temporaire" || return 1
  fi
  mv -f -- "$temporaire" "$DOSSIER/$1.reponse.json" || return 1
}

defaire() {
  if [[ "$SIMULATION" == 1 ]]; then return 0; fi
  wg set "$INTERFACE" peer "$1" remove || journal "annulation : pair $1 à retirer à la main"
  nft delete element "${NFT_ARGS[@]}" "{ $2 }" || journal "annulation : $2 à retirer de l’ensemble à la main"
}

ajouter_bloc() {
  local temporaire
  temporaire="$(mktemp "$(dirname -- "$WG_CONF")/.vpn-invites.XXXXXX")" || return 1
  if [[ -f "$WG_CONF" ]]; then cat -- "$WG_CONF" > "$temporaire" || return 1; fi
  printf '\n[Peer]\nPublicKey = %s\nAllowedIPs = %s/32\n' "$1" "$2" >> "$temporaire" || return 1
  chmod 600 "$temporaire" || return 1
  mv -f -- "$temporaire" "$WG_CONF"
}

# Nftables puis WireGuard puis configuration ; un échec annule ce qui a déjà été fait pour ce pair.
attacher() {
  if [[ "$SIMULATION" != 1 ]]; then
    nft add element "${NFT_ARGS[@]}" "{ $2 }" || { journal "nft : ajout de $2 refusé"; return 1; }
    wg set "$INTERFACE" peer "$1" allowed-ips "$2/32" || { journal "wg : pair non ajouté"; defaire "$1" "$2"; return 1; }
  fi
  ajouter_bloc "$1" "$2" || { journal "configuration WireGuard non écrite"; defaire "$1" "$2"; return 1; }
}

traiter_demande() {
  local fichier="$1" id cle utilisees adresse
  id="$(basename -- "$fichier" .demande.json)"
  if [[ ! "$id" =~ ^[a-f0-9]{16}$ ]]; then
    journal "demande ignorée : identifiant invalide"
    rm -f -- "$fichier"
    return 0
  fi
  cle="$(sed -n 's/.*"cle":"\([^"]*\)".*/\1/p' "$fichier")"
  if ! cle_valide "$cle"; then
    journal "demande $id refusée : clé publique invalide"
    ecrire_reponse "$id" '{"ok":false,"raison":"clé publique invalide"}' || return 1
    rm -f -- "$fichier"
    return 0
  fi
  if ! utilisees="$(ips_utilisees)"; then journal "wg : état des pairs illisible"; return 1; fi
  if ! adresse="$(choisir_ip "$utilisees")"; then
    journal "demande $id refusée : plage épuisée"
    ecrire_reponse "$id" '{"ok":false,"raison":"plage d’adresses épuisée"}' || return 1
    rm -f -- "$fichier"
    return 0
  fi
  if ! attacher "$cle" "$adresse"; then
    ecrire_reponse "$id" '{"ok":false,"raison":"échec du service VPN"}' || return 1
    rm -f -- "$fichier"
    return 0
  fi
  ecrire_reponse "$id" "{\"ok\":true,\"adresse\":\"$adresse\"}" || return 1
  rm -f -- "$fichier"
  journal "demande $id : adresse $adresse attribuée"
}

adresse_du_pair() {
  awk -v k="$1" 'BEGIN { RS = "" }
    index($0, "PublicKey = " k) && $0 ~ /\[Peer\]/ {
      if (match($0, /AllowedIPs = [0-9.]+\/32/)) print substr($0, RSTART + 13, RLENGTH - 16)
    }' "$WG_CONF"
}

retirer_bloc() {
  local temporaire
  temporaire="$(mktemp "$(dirname -- "$WG_CONF")/.vpn-invites.XXXXXX")" || return 1
  awk -v k="$1" 'BEGIN { RS = ""; ORS = "\n\n" }
    !(index($0, "PublicKey = " k) && $0 ~ /\[Peer\]/) { print }' "$WG_CONF" > "$temporaire" || return 1
  chmod 600 "$temporaire" || return 1
  mv -f -- "$temporaire" "$WG_CONF"
}

retirer_pair() {
  local adresse
  if ! cle_valide "$1"; then journal "clé publique invalide"; return 1; fi
  if ! adresse="$(adresse_du_pair "$1")" || [[ -z "$adresse" ]]; then
    journal "aucun pair $1 dans $WG_CONF"
    return 1
  fi
  if [[ "$SIMULATION" != 1 ]]; then
    wg set "$INTERFACE" peer "$1" remove || { journal "wg : retrait refusé"; return 1; }
    nft delete element "${NFT_ARGS[@]}" "{ $adresse }" || { journal "nft : retrait de $adresse refusé"; return 1; }
  fi
  retirer_bloc "$1" || return 1
  journal "pair retiré (adresse $adresse)"
}

nettoyer_anciennes_reponses() {
  find "$DOSSIER" -maxdepth 1 -name '*.reponse.json' -mmin +60 -delete || journal "nettoyage des réponses anciennes en échec"
}

main() {
  charger_conf
  exec 9>"$VERROU"
  flock 9
  if [[ "${1:-}" == retirer ]]; then
    [[ $# -eq 2 ]] || { journal "usage : retirer <clé publique>"; exit 2; }
    retirer_pair "$2"
    return
  fi
  nettoyer_anciennes_reponses
  shopt -s nullglob
  local fichier
  for fichier in "$DOSSIER"/*.demande.json; do
    traiter_demande "$fichier" || journal "demande $fichier en échec, nouvel essai à la prochaine activité"
  done
}

main "$@"
