# Relier ses machines

Aide livrée avec l'appli : un agent de Lanterne la lit (`reseau_aide`) pour expliquer comment relier ses machines, ou
pour faire les réglages à la demande. Chaque geste qui change le réseau attend la confirmation de Chris dans l'appli.
Pour les liaisons directes, les réglages se font pour l'instant par un agent (outils `reseau_*` indiqués ci-dessous) ;
l'écran dédié viendra.

## Les trois façons de relier deux machines

1. **Par un aiguilleur** : un Raspberry Pi ou un serveur toujours allumé relie les machines. Chaque machine ouvre
   elle-même un lien sortant vers lui : aucun port à ouvrir sur les machines. Le téléphone passe par lui de partout.
   C'est la façon la plus simple dès qu'une machine est souvent éteinte ou hors de chez soi.
2. **Adresse directe** : une machine joint l'autre à une adresse donnée. Trois cas :
   - sur le même réseau local (ex. `192.0.2.20:47500`) ;
   - par un VPN (WireGuard, par exemple) qui donne une adresse privée à chaque machine ;
   - par un **tunnel ssh** : Lanterne monte `ssh -L` vers la machine distante, et son port local devient l'adresse.
   Rien ne passe par un intermédiaire. Il faut seulement que l'adresse soit joignable depuis la machine qui se connecte.
3. **Réseau local seul** : pas encore de découverte automatique. L'adresse se saisit à la main (voir 2).

On peut mélanger : une machine peut joindre un pair en direct et un autre par l'aiguilleur. Si la liaison directe tombe,
l'aiguilleur prend le relais s'il est configuré. Changer de façon ne recrée pas le réseau.

## Quand choisir laquelle

- Deux machines chez soi, sans rien exposer : **adresse directe** sur le réseau local.
- Hors de chez soi, ou avec le téléphone : **aiguilleur** (ou un VPN, puis adresse directe).
- Une machine distante qu'on n'atteint qu'en ssh : **tunnel ssh**, monté par Lanterne.
- Aucune machine toujours allumée : pas d'aiguilleur ; une machine doit être allumée pour être jointe.

## Ce que voit l'intermédiaire

- **Aiguilleur** : seulement l'annuaire (quelles machines existent, leurs empreintes) et des trames chiffrées. Il ne lit ni
  les sessions, ni les messages, ni les réglages. Il voit qui parle à qui et quand.
- **Adresse directe ou tunnel** : aucun intermédiaire de Lanterne. Le réseau traversé voit les adresses et la taille des
  échanges, pas leur contenu.
- Dans les deux cas, la confiance vient de la **comparaison des empreintes** : les deux machines affichent les mêmes deux
  empreintes ; Chris les compare à voix haute ou par message, puis accepte. Sans cette comparaison, rien ne garantit qu'un
  intermédiaire n'a pas été accepté à la place de la bonne machine.

## Relier deux machines sans aiguilleur

1. Sur la machine visée : `reseau_directe_configurer { ecoute: "192.0.2.10:47500" }` (l'adresse de sa carte réseau
   locale, ou de son VPN). Son propriétaire (`proprietaire`) doit être le même que celui de l'autre machine.
2. Sur la machine qui se connecte : `reseau_ajouter_direct { adresse: "192.0.2.10:47500" }`.
3. Les deux empreintes s'affichent des deux côtés : les faire comparer à Chris, qui accepte sur la machine visée.
4. Les sessions de l'autre apparaissent dans la liste ; leur fil se lit à la demande.

## Un tunnel ssh vers une machine distante

Quand la machine distante n'a pas de port ouvert mais accepte ssh, Lanterne monte le tunnel lui-même :
- la clé ssh est **dédiée** à Lanterne (pas la clé personnelle) ;
- l'identité de l'hôte est vérifiée contre un `known_hosts` de Lanterne : son empreinte est comparée **une fois**, à
  l'installation ;
- sur la machine distante, Lanterne écoute sur `127.0.0.1` (son écoute directe, réglée par `reseau_directe_configurer`
  avec `ecoute: "127.0.0.1:<portDistant>"`) ;
- le tunnel est relancé s'il tombe, et coupé à l'arrêt.

Outil d'agent : `reseau_directe_configurer { tunnels: [{ hote, port, utilisateur, cle, portLocal, portDistant }] }`,
puis `reseau_ajouter_direct { adresse: "127.0.0.1:<portLocal>" }`.

## Faire la même installation que Chris

Chris relie son parc ainsi : un **aiguilleur** sur un petit serveur ou un Raspberry Pi, toujours allumé ; un **VPN
WireGuard** entre ses machines et l'aiguilleur ; un **tunnel** HTTPS vers l'aiguilleur pour le téléphone. Les étapes
génériques (remplacer les valeurs d'exemple) :

1. **Choisir la machine-aiguilleur** : toujours allumée, avec une adresse privée stable sur le VPN (ex. `10.0.0.1`).
2. **VPN** : installer WireGuard sur l'aiguilleur et sur chaque machine ; donner à chacune une adresse privée
   (ex. `10.0.0.2`, `10.0.0.3`) et une paire de clés. Vérifier le ping entre elles.
3. **Démarrer l'aiguilleur** : le service de Lanterne sur la machine-aiguilleur écoute sur son adresse privée
   (variable `LANTERNE_RELAIS_ECOUTE`, forme `hôte:port`, ex. `10.0.0.1:8450`).
4. **Obtenir un code** : sur l'aiguilleur, la commande d'appairage affiche un code valable 10 minutes, à usage unique.
5. **Relier chaque machine** : dans Paramètres › Réseau › **Relier**, adresse `http://10.0.0.1:8450`, le code, le nom.
   Pour une machine distante qu'on installe par SSH, un agent peut le faire : `reseau_ajouter_machine`.
6. **Comparer les empreintes**, accepter ; les machines se voient et partagent leurs sessions.
7. **Téléphone** : un tunnel HTTPS (ex. `https://relais.example.com`) vers l'aiguilleur, puis l'appairage du téléphone
   comme appareil.

Valeurs d'exemple : `example.com`, `10.0.0.x`, `192.0.2.x`. Ne jamais écrire d'adresse réelle, de mot de passe ni de clé
dans une conversation : les clés restent sur les machines.

## Limites connues

- Pas de découverte automatique sur le réseau local : l'adresse se saisit.
- Une liaison directe se rétablit par la machine qui connaît l'adresse du pair ; l'autre attend son appel.
- Rattacher ensuite un aiguilleur donne au nœud un nouvel identifiant : les pairs directs doivent être appairés de nouveau.
- Le contenu est chiffré de bout en bout dans les deux cas ; l'authenticité repose sur la comparaison des empreintes.
