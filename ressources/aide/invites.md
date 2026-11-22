# Inviter quelqu'un sur son réseau Lanterne

Aide livrée avec l'appli : un agent de Lanterne la lit (`reseau_invites_aide`) pour guider le chef ou faire les
réglages à sa demande. Tout réglage passe par la confirmation du chef dans l'appli.

## Ce qu'est un invité
Un ami qui a Lanterne sur sa propre machine, relié au réseau, et qui utilise Claude **par le compte du chef, à travers
Lanterne seulement** :
- ses conversations tournent sur une machine du chef (la tour par exemple), jamais sur la sienne ; il n'envoie que des
  messages et reçoit les réponses ;
- aucun jeton, aucune clé, aucun fichier d'identifiants Claude ne va sur sa machine ;
- ses conversations sont à lui : chez le chef elles apparaissent dans « Invités › son nom », avec un titre générique et
  sans contenu lisible ; seule son activité se voit (si la télémétrie est active).

Attention (décision du chef) : les conditions d'Anthropic réservent un abonnement à son titulaire ; faire utiliser son
compte par quelqu'un d'autre fait porter le risque sur ce compte.

## Inviter (le chef)
1. Paramètres › Réseau › Mon réseau › **Ajouter… › Invité** : un code à usage unique s'affiche (10 minutes).
2. Sur sa machine, l'invité installe Lanterne, ouvre Paramètres › Réseau › **Relier** et saisit ce code.
3. Chez le chef, sa machine apparaît dans **Machines et appareils** : **Inviter** (et non Appairer).
4. Les deux machines affichent les mêmes deux empreintes : les comparer à voix haute ou par message, puis accepter.
5. L'invité entre au réseau avec les réglages par défaut : Haiku et Sonnet (effort jusqu'à élevé), 25 % de la limite
   de 5 h et de la semaine, 2 conversations à la fois, sur la machine qui l'a invité.

Un pair déjà membre peut aussi devenir invité : outil `reseau_inviter` avec son identifiant de membre.

## Régler ses limites (le chef)
Paramètres › Réseau › Machines et appareils › ligne de l'invité › **Régler** :
- **Modèles** : chaque famille (Haiku, Sonnet, Opus, Fable) permise ou non, avec l'effort maximal.
- **Part de la limite de 5 h** et **hebdomadaire** : ce qu'il peut consommer des limites du compte. Atteinte, ses
  nouveaux messages sont refusés jusqu'à la réinitialisation.
- **Sessions simultanées** : conversations qui travaillent en même temps.
- **Machines** : où ses conversations tournent (machines du chef). « Sur sa machine » n'est possible que si sa machine
  a son propre compte Claude.
- **Prompt système imposé** : ajouté en dernier à chacune de ses conversations ; il ne peut pas le retirer.
- **Accès** (non par défaut) : voir les autres sessions (lecture seule), lire hors de son espace (dossiers de projets,
  jamais les réglages ni les identifiants). Toujours refusés : terminaux, Remote Control, modules.
- **Télémétrie** : actif aujourd'hui, sessions, jetons, part consommée — jamais le contenu. Vue **Activité** juste
  en dessous.
- **Retirer** : il perd tout accès sur toutes les machines du réseau.

Outils d'agent : `reseau_invite_regler { membre, … }` change seulement les champs donnés (ex. « donne-lui Opus jusqu'à
moyen » → `modeles` avec `opus: ['low','medium']` en plus des familles déjà permises) ; `reseau_invite_activite
{ membre }` lit son activité.

## Ce que voit l'invité
- Paramètres › Réseau : « Tu es invité par … », où tournent ses conversations, ses modèles, ses limites.
- Une nouvelle conversation part d'elle-même sur la machine du chef permise ; ses conversations s'affichent comme les
  siennes. Un refus (modèle, effort, part atteinte, trop de conversations) s'affiche avec sa raison.
- Il ne voit ni les sessions du chef, ni ses fichiers, ni ses machines au-delà de celles qui lui sont permises.

## Comment c'est protégé (pour répondre aux questions)
- Les limites sont appliquées par le nœud qui fait tourner ses conversations, jamais par l'appli de l'invité.
- Sa conversation tourne dans un dossier à lui, avec une configuration Claude dédiée sans identifiants ; elle n'a ni
  terminal (Bash), ni sous-agents, ni serveurs MCP ; lecture et écriture confinées à son dossier ; pas d'accès aux
  adresses locales par WebFetch ; aucun réglage ni mémoire du chef chargés.
- Limites connues : même utilisateur système que le chef (la barrière est l'ensemble des outils permis, pas le noyau) ;
  la part consommée se mesure par l'écart d'utilisation du compte pendant ses tours (un usage simultané du chef lui est
  compté) ; si le compte du chef doit se reconnecter, ses conversations attendent.
