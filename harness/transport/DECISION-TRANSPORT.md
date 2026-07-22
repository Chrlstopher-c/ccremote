# Décision de transport — D.1.2

**Retenu : WebSocket.** SSH et TCP brut écartés. Décision déléguée à l'agent d'exécution (16, `⊣ DÉLÉGUÉ`).

## Ce qui a réellement été mesuré, et ce qui ne l'a pas été

Le périmètre de cette mission interdit tout process réseau réel vers le PC (« le subagent produit, le
parent valide »). **Aucune mesure de latence de reconnexion réelle n'a donc été faite** — ce serait le
premier test à exécuter avant mise en production, pas une mesure qu'un agent en sandbox peut fournir
honnêtement. Ce qui suit est un raisonnement sur des propriétés structurelles et le code existant du
dépôt, pas une mesure empirique. Voir « Ce qui reste à vérifier en réel » en fin de document.

## Les faits qui ont pesé

1. **Bun expose `WebSocket` nativement**, côté client comme côté serveur (`Bun.serve({ websocket })`).
   Aucune dépendance à ajouter à `package.json`. SSH, lui, exige soit de shell-out vers le binaire
   `ssh` système (gestion de process fragile, multiplexage stdin/stdout par session délicat à faire
   proprement), soit une librairie (`ssh2`, binding natif) — une dépendance nouvelle, à l'encontre du
   biais de sobriété du projet (CLAUDE.md, sovereignty : minimiser les dépendances imposées).

2. **Le dépôt a déjà un précédent WebSocket pour ce lien exact** : `server/server.py` fait tourner un
   serveur `websockets` (Python) sur le PC, piloté par le Pi, pour le contrôle historique de
   ccremote (tmux). Ce n'est pas le protocole qu'on réutilise — le M-10 ne parle pas au serveur Python,
   qui appartient à l'ancienne architecture tmux — mais c'est la preuve que le canal WebSocket
   Pi→PC est déjà un choix opérationnel accepté sur ce réseau (port ouvert, pas de nouvelle surface
   réseau à faire accepter par l'opérateur).

3. **La reconnexion doit de toute façon être construite à la main**, quel que soit le tunnel choisi :
   D.2 (numéro de séquence, epoch, distinction transitoire/terminal) n'est fourni ni par SSH ni par
   WebSocket ni par TCP brut. Le tunnel ne fait que transporter des octets ; toute la sémantique de
   reprise est écrite dans `canal-donnees.ts` et `lien-websocket.ts`, indépendamment du support. Ce qui
   reste alors comme différenciant réel entre les trois options n'est **pas** la reprise (égale pour
   les trois), mais le coût d'implémentation et de dépendance du support lui-même.

4. **Framing gratuit.** WebSocket est orienté message : un `send()` correspond à un `message` reçu
   entier côté récepteur, sans réassemblage de flux à écrire. TCP brut demanderait un framing maison
   (longueur-préfixée) pour la même garantie — du code en plus, une source d'erreur en plus, exactement
   le genre de bug qui produit la panne #27 (perte silencieuse ressemblant à une corruption du SDK).

5. **Codes de fermeture applicatifs gratuits.** WebSocket réserve la plage `4000-4999` aux codes de
   fermeture applicatifs (RFC 6455). La taxonomie D.2.1 (`401 | 403 | 404 | 4090 | 4091 | 4092`) s'y
   loge directement — `4090`/`4091`/`4092` sont réutilisés tels quels comme codes de fermeture WS réels,
   `401`/`403`/`404` sont remappés sur `4401`/`4403`/`4404` (hors plage HTTP, dans la plage applicative).
   Aucun protocole à inventer par-dessus pour transporter la raison de fermeture : le code de fermeture
   WS **est** la trame de contrôle.

## Ce qui a été écarté, et pourquoi

- **SSH (`ChannelExec`)** : rien à écrire côté PC si `sshd` tourne déjà, mais la reconnexion,
  l'epoch, le multiplexage stdin/stdout/stderr/kill sur un seul canal restent entièrement à construire
  par-dessus — le gain « rien à écrire » ne concerne que l'authentification initiale, qui sur LAN de
  confiance (H-03) n'était de toute façon pas le problème. Ajoute une dépendance de configuration
  (config sshd, clés) que WebSocket n'a pas.
- **TCP brut + framing** : minimal en théorie, mais tout est à écrire, y compris ce que WebSocket donne
  gratuitement (framing par message, codes de fermeture applicatifs, gestion des pings/pongs pour
  détecter une coupure silencieuse). Aucun avantage mesuré face à WebSocket sur ce projet précis.

## Conséquence sur le code livré

- `LienWebSocket` (`lien-websocket.ts`) attend un `ConnecteurWebSocket` injecté — en production,
  `() => Promise.resolve(new WebSocket(url))` (Bun natif) ; en test, une doublure en mémoire. Aucun
  test de ce lot n'ouvre de socket réelle.
- Multiplexage par tag de trame (`trame.ts`) sur une seule connexion physique : STDIN/STDOUT (canal
  principal, H-12, jamais interprété), STDERR/KILL/EXIT/ERREUR_SPAWN (voie de contrôle, B.2.3),
  ACK (fiabilité interne, D.2.2 local au canal principal — pas le high-water mark de l'observation,
  qui reste hors périmètre M-10).

## Ce qui reste à vérifier en réel (hors périmètre de cette mission)

- Latence effective de reconnexion sur le LAN réel (Wi-Fi du téléphone d'observation, pas du transport
  lui-même — le transport Pi↔PC est filaire/LAN par H-03).
- Comportement du binaire `Bun.serve({ websocket })` sous charge réelle (nombre de workers simultanés,
  H-31 encore ouverte).
- Détection de coupure silencieuse (ni `close` ni `error`, juste plus rien) : nécessite un ping/pong
  applicatif avec délai d'expiration, **non implémenté dans ce lot** — `⚠ HYP` à vérifier : sans lui,
  une coupure qui ne déclenche aucun événement WS reste indétectée jusqu'à la prochaine écriture
  avortée. À couvrir en même temps que le canal d'observation (branche E) si le risque se confirme.
