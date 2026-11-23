#!/usr/bin/env bash
# Au démarrage : remet dans l’ensemble nft des invités Lanterne chaque pair WireGuard de la plage des invités
# (le geste lanterne-vpn-invites ne les ajoute qu’à chaud ; le fichier du pare-feu ne les connaît pas).
set -euo pipefail
v(){ sed -n "s/^$1=//p" /etc/lanterne/vpn-invites.conf; }; INTERFACE=$(v INTERFACE); PLAGE_DEBUT=$(v PLAGE_DEBUT); PLAGE_FIN=$(v PLAGE_FIN); NFT_ENSEMBLE=$(v NFT_ENSEMBLE)
read -r -a ENS <<< "$NFT_ENSEMBLE"
ip2n(){ local IFS=.; read -r a b c d <<< "$1"; echo $(( (a<<24)+(b<<16)+(c<<8)+d )); }
DEB=$(ip2n "$PLAGE_DEBUT"); FIN=$(ip2n "$PLAGE_FIN")
grep -E "^AllowedIPs *= *" "/etc/wireguard/$INTERFACE.conf" | sed -E "s/.*= *([0-9.]+)\/32.*/\1/" | while read -r ip; do
  n=$(ip2n "$ip"); if [ "$n" -ge "$DEB" ] && [ "$n" -le "$FIN" ]; then nft add element "${ENS[@]}" "{ $ip }"; echo "remis : $ip"; fi
done
