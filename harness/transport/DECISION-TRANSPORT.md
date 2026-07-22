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

## Détection de coupure silencieuse — dette comblée (M-10, H-69)

**Mécanisme retenu** : ping/pong applicatif intégré à `LienWebSocket` (tags `TAG.PING`/`TAG.PONG` de
`trame.ts`), pas un module séparé. Tant que le lien est `ouvert`, un tic de vivacité sonde le pair à
chaque intervalle (`intervalePingMs`, défaut 15 s) ; le pair — qui exécute la même classe,
symétriquement, des deux côtés du tunnel — répond `PONG` **dans `#distribuer`**, avant même d'atteindre
le SDK ou l'agent qu'il transporte.

**Comment un agent lent se distingue d'un tunnel mort** — c'est le cœur du problème, pas un détail :
la réponse au ping est générée par la couche transport elle-même, jamais par le processus Claude Code.
Un agent qui réfléchit dix minutes sans émettre le moindre octet de stdout laisse le transport
répondre au ping en quelques millisecondes, exactement comme un lien inactif mais sain. Seul un lien
réellement mort — où même la couche transport ne répond plus, parce que le socket ne délivre plus rien
dans aucun sens — laisse le ping sans réponse. `#activiteDepuisTick` est mis à vrai par **n'importe
quel** tag reçu (STDOUT, ACK, PONG…), pas seulement PONG : tout octet qui arrive prouve la vie du lien.

**Seuil retenu et sa justification** : `pingsManquesAvantMort = 3` (défaut). Un unique ping sans
réponse ne déclenche rien — le compteur revient à zéro dès le moindre octet reçu, de n'importe quel
tag. Il faut un silence total sur **trois intervalles consécutifs pleins** (~45 s par défaut) pour
conclure à la mort du lien. Argument : un faux positif détruirait une mission valide (exigence
explicite de la mission) — le biais est donc délibérément du côté de la patience, jamais de la
réactivité. `intervalePingMs = 15 s` reste sous les délais usuels de coupure idle des NAT/routeurs
Wi-Fi (souvent 30-60 s), ce qui a un bénéfice secondaire : le ping garde aussi la table de routage NAT
ouverte.

**Même chemin de reprise, pas un second mécanisme** — `#declencherCoupureSilencieuse()` appelle
`#entrerCoupeTransitoire()`, la même fonction privée que la fermeture WS non-terminale. Backoff,
compteur de rattachements, rejeu du non-acquitté (`CanalDonnees.rejouerNonAcquitte`) : identiques,
byte pour byte, à une coupure signalée. `remonteesTransitoires()` reste à 0 dans les deux cas (D.2.1 :
le transitoire — signalé ou silencieux — n'est jamais remonté à l'appelant).

**Coût en messages** : négligeable. Une seule trame vide (`TAILLE_ENTETE` = 9 octets, payload nul) par
intervalle **et par direction inactive** — pendant une mission active, chaque tic ne fait qu'ajouter
une trame de 9 octets à un flux déjà en cours ; pendant un silence complet, c'est le seul trafic sur
le fil.

**Injectable** : `intervalePingMs` et `pingsManquesAvantMort` sont des options du constructeur de
`LienWebSocket`, jamais des constantes — les tests ne dépendent d'aucun délai réel, uniquement de
l'horloge manuelle déjà en place pour le backoff. `intervalePingMs <= 0` désactive le mécanisme
(opt-out explicite, pas un défaut).

**Testé, `test-harness` non concerné** : 8 tests en mémoire dans `lien-websocket.test.ts` contre le
`WebSocketLike` factice existant — réponse automatique au PING, sonde à l'idle, coût nul sous trafic
réel, protection contre le faux positif (agent lent + pair qui répond ⇒ jamais mort), tolérance à un
ping isolé perdu, détection au seuil avec chemin de reprise partagé vérifié bout en bout (backoff,
rattachement, rejeu), seuil configurable, opt-out. Aucun test n'ouvre de socket réelle ni n'importe
`test-harness/` (règle 1 de son README).

**Ce qui reste à vérifier en réel** (hors périmètre, comme le reste de ce document) : le seuil de 45 s
est un raisonnement sur les délais NAT/Wi-Fi usuels, pas une mesure sur le LAN réel de l'opérateur — à
confirmer au premier banc d'essai réel, aux côtés de la latence de reconnexion.
