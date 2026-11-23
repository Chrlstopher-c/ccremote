# Inviter quelqu'un sur son réseau Lanterne

Aide livrée avec l'appli : un agent de Lanterne la lit (`reseau_invites_aide`) pour guider le chef ou faire les
réglages à sa demande. Tout réglage passe par la confirmation du chef dans l'appli.

## Ce qu'est un invité
Un ami qui a Lanterne sur son propre PC, relié au réseau, et qui utilise Claude **par l'abonnement du chef** :
- ses conversations tournent **sur son PC**, dans ses dossiers et son propre espace de discussions ; rien ne tourne
  chez le chef ;
- Claude Code, chez lui, n'a aucun identifiant : il passe par un **relais d'API** servi par une machine du chef. Le
  relais vérifie que la demande vient bien de l'invité, applique ses limites, puis la transmet avec l'abonnement du
  chef. Le jeton du chef ne quitte jamais ses machines ;
- l'invité n'a accès à **aucune** machine du chef : ni sessions, ni fichiers, ni terminaux, ni « voir / piloter ». La
  charte ne lui donne que le relais. Le retirer coupe le relais aussitôt ;
- le relais compte son activité (requêtes, jetons, part consommée), jamais le contenu de ses conversations.

Attention (décision du chef) : les conditions d'Anthropic réservent un abonnement à son titulaire ; faire utiliser son
compte par quelqu'un d'autre fait porter le risque sur ce compte.

## Inviter (le chef)
1. Paramètres › Réseau › Mon réseau › **Ajouter… › Invité** : une **invitation** se crée. Elle réunit un code à usage
   unique (10 minutes) et, si l'aiguilleur propose un VPN d'invités, un accès WireGuard limité à l'aiguilleur.
   **Copier l'invitation** et l'envoyer à l'invité (un seul texte).
2. Sur son PC, l'invité installe Lanterne, ouvre Paramètres › Réseau › **Relier**, garde « Invitation », colle le
   texte et valide. Lanterne installe WireGuard si besoin, pose le tunnel (Windows demande une autorisation), puis se
   relie à l'aiguilleur. Paramètres › Réseau › **Composants** montre l'état de WireGuard et de Claude Code, avec
   **Installer** ou **Réparer**.
3. Chez le chef, sa machine apparaît dans **Machines et appareils** : **Inviter** (et non Appairer).
4. Les deux machines affichent les mêmes deux empreintes : les comparer à voix haute ou par message, puis accepter.
   La machine de l'invité adopte la charte du chef (elle ne fonde jamais son propre réseau).
5. L'invité entre au réseau avec les réglages par défaut : Haiku et Sonnet (effort jusqu'à élevé), 25 % de la limite
   de 5 h et de la semaine, 2 conversations à la fois ; le relais est la machine qui l'a invité.

Un pair déjà membre peut aussi devenir invité : outil `reseau_inviter` avec son identifiant de membre.
Pour le geste root qui crée les accès VPN sur l'aiguilleur : `deploiement/vpn-invites/README.md`.

## Régler ses limites (le chef)
Paramètres › Réseau › Machines et appareils › ligne de l'invité › **Régler** :
- **Modèles** : chaque famille (Haiku, Sonnet, Opus, Fable) permise ou non, avec l'effort maximal.
- **Part de la limite de 5 h** et **hebdomadaire** : ce qu'il peut consommer des limites du compte. Atteinte, ses
  nouveaux messages sont refusés jusqu'à la réinitialisation.
- **Sessions simultanées** : conversations qui travaillent en même temps.
- **Machines** : les machines du chef qui lui servent de relais d'API (la première en ligne sert).
- **Prompt système imposé** : ajouté en dernier à chacune de ses conversations ; il ne peut pas le retirer.
- **Accès** (non par défaut) : voir les autres sessions (lecture seule), lire hors de son espace (dossiers de projets,
  jamais les réglages ni les identifiants). Toujours refusés : terminaux, Remote Control, modules.
- **Télémétrie** : actif aujourd'hui, sessions, jetons, part consommée — jamais le contenu. Vue **Activité** juste
  en dessous.
- **Retirer** : il perd tout accès sur toutes les machines du réseau.

Outils d'agent : `reseau_invite_regler { membre, … }` change seulement les champs donnés (la route
`POST /api/reseau/charte/membres/:membre/invite` accepte des réglages partiels, fusionnés avec les actuels) (ex. « donne-lui Opus jusqu'à
moyen » → `modeles` avec `opus: ['low','medium']` en plus des familles déjà permises) ; `reseau_invite_activite
{ membre }` lit son activité.

## Ce que voit l'invité
- Paramètres › Réseau : « Tu es invité par … », ses modèles, ses limites ; ses conversations tournent sur son PC.
- Une nouvelle conversation s'ouvre chez lui comme les siennes ; Claude passe par le relais du chef. Un refus (modèle,
  effort, part atteinte, trop de conversations, relais injoignable) s'affiche avec sa raison.
- Il ne voit ni les sessions du chef, ni ses fichiers, ni ses machines.

## Comment c'est protégé (pour répondre aux questions)
- Les limites sont appliquées par le relais, sur la machine du chef, jamais par l'appli de l'invité : modèle et effort
  lus dans chaque requête, part de 5 h et de la semaine, conversations simultanées.
- Claude Code chez l'invité ne connaît qu'un jeton local propre à son moteur ; le relais remplace l'authentification
  par l'abonnement du chef. Retirer l'invité de la charte lui ferme le relais.
- Ses conversations tournent dans un dossier à lui, avec une configuration Claude dédiée et sans identifiants ; elles
  n'ont ni terminal (Bash), ni sous-agents, ni serveurs MCP.
- Limites connues : la part consommée se mesure par l'écart d'utilisation du compte pendant ses requêtes (un usage
  simultané du chef lui est compté) ; si le compte du chef doit se reconnecter, ses requêtes échouent avec ce motif.
