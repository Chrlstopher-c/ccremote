# VPN des invités : le geste root

L'aiguilleur tourne sans privilège et ne peut pas créer de pair WireGuard. Pour donner à un invité un accès VPN limité
à l'aiguilleur, il dépose une demande dans un dossier ; ce service root, installé une fois, la traite :

1. valide la clé publique de l'invité ;
2. attribue la première adresse libre de la plage (`wg show`) ;
3. ajoute le pair à WireGuard (à chaud), puis dans `/etc/wireguard/<interface>.conf` (persistance) ;
4. autorise l'adresse dans un ensemble nftables ;
5. écrit la réponse `<id>.reponse.json` pour l'aiguilleur, puis supprime la demande.

La clé privée de l'invité n'est jamais sur le serveur : elle est générée par l'aiguilleur, remise dans la réponse HTTP
au nœud, et ne vit sur disque nulle part.

## Fichiers

| Fichier | Rôle |
|---|---|
| `lanterne-vpn-invites.sh` | le geste (`/usr/local/sbin/`) ; sous-commande `retirer <clé>` |
| `lanterne-vpn-invites.path` | surveille le dossier des demandes |
| `lanterne-vpn-invites.service` | lance le geste (oneshot, root) |
| `lanterne-vpn-invites.test.ts` | essai en simulation, sans root : `bun test deploiement` |

## Installation (une fois, sur le serveur de l'aiguilleur)

Valeurs d'exemple à remplacer : `wg0`, `192.0.2.20`–`192.0.2.60`, `inet filtre invites_vpn`, `/var/lib/lanterne/vpn-invites`,
et `<utilisateur-aiguilleur>` (l'utilisateur qui fait tourner le service de Lanterne).

```bash
# 1. Le dossier des demandes : à l'aiguilleur (il y écrit), fermé aux autres
sudo install -d -m 0700 -o <utilisateur-aiguilleur> /var/lib/lanterne/vpn-invites

# 2. La configuration du geste
sudo install -d -m 0755 /etc/lanterne
sudo tee /etc/lanterne/vpn-invites.conf >/dev/null <<'EOF'
INTERFACE=wg0
PLAGE_DEBUT=192.0.2.20
PLAGE_FIN=192.0.2.60
NFT_ENSEMBLE=inet filtre invites_vpn
DOSSIER=/var/lib/lanterne/vpn-invites
EOF
sudo chmod 0600 /etc/lanterne/vpn-invites.conf

# 3. Le geste et ses unités
sudo install -m 0755 deploiement/vpn-invites/lanterne-vpn-invites.sh /usr/local/sbin/lanterne-vpn-invites.sh
sudo install -m 0644 deploiement/vpn-invites/lanterne-vpn-invites.path deploiement/vpn-invites/lanterne-vpn-invites.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now lanterne-vpn-invites.path

# 4. L'ensemble nftables et la règle : un invité n'atteint que l'aiguilleur, sur son port
sudo nft add table inet filtre 2>/dev/null || true
sudo nft add set inet filtre invites_vpn '{ type ipv4_addr; }'
# dans la chaîne d'entrée de votre pare-feu (à adapter) :
#   iifname "wg0" ip saddr @invites_vpn ip daddr 192.0.2.1 tcp dport 8450 accept
```

Le pair WireGuard de l'aiguilleur (son interface `wg0`) doit exister et être démarré (`wg-quick@wg0`) : le geste ne le crée
pas. Les clés serveur (`LANTERNE_VPN_CLE_SERVEUR`) et l'endpoint public (`LANTERNE_VPN_ENDPOINT`) vont dans
l'environnement de l'aiguilleur, avec `LANTERNE_VPN_INVITES_DOSSIER` (même dossier que `DOSSIER`) et
`LANTERNE_VPN_ADRESSE_AIGUILLEUR`.

## Vérifier à vide

```bash
# Simulation (sans root, sans wg ni nft) : toute la logique du geste
bun test deploiement

# Sur le serveur, sans demande : le service se termine sans rien faire
sudo systemctl start lanterne-vpn-invites.service
journalctl -u lanterne-vpn-invites.service -n 20
```

## Retirer un invité

```bash
sudo /usr/local/sbin/lanterne-vpn-invites.sh retirer <clé publique de l'invité>
```

Retire le pair de WireGuard, de la configuration et de l'ensemble nftables. La clé publique se lit dans
`/etc/wireguard/wg0.conf` (bloc `[Peer]` de l'invité).

## Points à savoir

- Le geste lit la configuration avec `sed` (une valeur par ligne, sans guillemets) : ne pas mettre d'espaces autour du `=`.
- Une réponse orpheline (demande arrivée après le délai de 20 s) est supprimée après une heure.
- Si l'écriture de la réponse échoue après l'ajout du pair, le pair reste actif sans réponse : l'aiguilleur répond 504 ;
  le retirer avec `retirer` si besoin.
- Les durcissements du fichier `.service` (`ProtectSystem=strict`, `ReadWritePaths`) ne sont pas testés sur un vrai
  serveur : en cas d'échec, les retirer une à une pour isoler la cause (`journalctl -u lanterne-vpn-invites`).

## Après un redémarrage du serveur

Le geste n'ajoute les invités à l'ensemble nftables qu'à chaud : au redémarrage, le pare-feu recharge son fichier et
les oublie. `lanterne-vpn-invites-resync.sh` (unité `lanterne-vpn-invites-resync.service`, activée une fois) remet dans
l'ensemble chaque pair de `/etc/wireguard/<interface>.conf` dont l'adresse est dans la plage des invités.

```bash
sudo install -m 0755 deploiement/vpn-invites/lanterne-vpn-invites-resync.sh /usr/local/sbin/
sudo install -m 0644 deploiement/vpn-invites/lanterne-vpn-invites-resync.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now lanterne-vpn-invites-resync.service
```
