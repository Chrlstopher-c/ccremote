# Synthèse chantier — 68 points ouverts du harness ccremote
*Base : TODO.md sur master, commit 70f498a. Menu de décision, pas un audit.*

## 1. Les groupes
- **A — Autoconnaissance de l'équipe** (5) : une équipe qui ignore son coût ou ses droits décide sur des suppositions, parfois fausses et coûteuses à réfuter.
- **B — Divergence PC/Pi** (9) : les deux moitiés du système désynchronisent silencieusement rapports, horodatages, outillage.
- **C — Gouvernance & pilotage orchestrateur** (22) : boutons morts, canaux manquants, arbitrages non tranchés — l'humain pilote moins qu'il ne le croit.
- **D — Coût financier direct** (1) : un réglage jamais mesuré qui peut casser une écriture en cours ou retarder un arrêt d'urgence.
- **E — Dette de code** (5) : fichiers hors standard et un bug de rotation de compte.
- **F — Outillage opérateur / Pi** (2) : deux gestes manuels jamais posés ou revérifiés.
- **G — Présenter un fichier** (5) : demande explicite de Chris, chantier pas commencé.
- **H — Validations manuelles restantes** (11) : pas du code, des vérifications en réel jamais faites ou jamais rejouées.
- **I — Repoussé explicitement** (2) : backlog assumé, à ne pas insérer sans arbitrage.
- **J — Fiabilité SDK/transport** (6) : chemins codés, jamais mesurés ni câblés bout en bout.

## 2. Les points

### A — Autoconnaissance
- Pas d'outil de coût temps réel pour l'équipe — décisions bâties sur des suppositions fausses. [HAUT] M
- Plafond de dépense jamais annoncé au lead — impossible à respecter s'il est inconnu. [HAUT] S
- Pas de jauge de quota par compte partagé entre missions — dépassement invisible. [MOYEN] M
- Crédits offerts non affichés dans une jauge — consommés sans que personne le voie. [BAS] S
- Pas de sélecteur de modèle dans le fil — confort différé, pas prioritaire. [BAS] M

### B — Divergence PC/Pi
- Rapport final d'une équipe parfois détruit avant écriture en base — relance payée deux fois. [HAUT] S
- Message de clôture automatique confondu avec la parole du lead — rapport faussé. [MOYEN] S
- Deux horloges différentes datent le même événement — peut inverser l'ordre affiché des messages. [BAS] S
- Remontée des verdicts d'inspection PC→Pi non confirmée — visibilité incertaine sur le contrôle qualité. [MOYEN] S
- Outils de recherche absents sur le serveur distant faute de GPU — équipe distante moins capable. [MOYEN] L
- Aucune surveillance de la mémoire sémantique — panne silencieuse, outil perdu sans alerte. [MOYEN] S
- Version d'outil légèrement désynchronisée PC/serveur — sans conséquence connue à ce jour. [BAS] S
- Timeline enrichie absente de deux vues sur trois — confort de lecture incomplet. [BAS] M
- Registre des équipes perdu si le PC redémarre — aucune solution connue à ce jour. [HAUT] L

### C — Gouvernance & pilotage
- Le lead ne peut pas interpeller l'orchestrateur en cours de mission — aucun canal de remontée. [MOYEN] L
- Suppression de projet volontairement non automatisée — évite un risque déjà payé ailleurs. [BAS] M
- Un module de réconciliation ment « rien en attente » — le système se croit à jour à tort. [HAUT] S
- Devenir des permissions rejouées en mode automatique inconnu — trou de fiabilité non mesuré. [MOYEN] M
- Demandes de dialogue utilisateur totalement ignorées — même famille que le point précédent. [MOYEN] L
- Arbitrages d'interface restants (modèle grisé, jauge de contexte, atterrissage) — finitions en attente. [BAS] M
- Impossible d'intervenir sur une mission en cours depuis l'interface — l'outil existe, pas le bouton. [MOYEN] S
- Bouton pour composer un mandat depuis l'interface, mort — passage obligé encore au clavier. [MOYEN] M
- Barre de sûreté absente sur deux écrans — accès à l'arrêt d'urgence incomplet. [MOYEN] S
- Réglages de notification non visibles/réglables — un simple interrupteur, aucune finesse. [BAS] M
- Autorisation humaine avant dispatch reportée après le MVP — décision déjà prise, backlog. [BAS] M
- Aucun message entrant ne dit qui parle réellement — confusion humain/orchestrateur/automate. [MOYEN] M
- Le lead ignore sa place dans la hiérarchie — ne sait pas qui l'a mandaté. [BAS] S
- Décision d'atterrissage de quota prise par le lead seul, pas le superviseur — backlog assumé. [MOYEN] L
- Jauges de quota et navigation par agent absentes — backlog assumé. [BAS] L
- Cloisonnement à trois niveaux jamais mesuré avant conception — risque de concevoir sur une fausse piste. [MOYEN] S
- Permissions non visibles dans le fil de la mission — backlog assumé. [BAS] M
- Navigation en arborescence et messages en file absents — backlog assumé. [BAS] L
- Autocompaction et bouton manuel pour l'orchestrateur maître absents — backlog assumé. [BAS] M
- Métriques machine retirées de l'interface alors que des process survivent et s'accumulent. [MOYEN] S
- Alarme réelle manquante sur une fermeture imprévue — instrumentation posée mais inutilisée. [MOYEN] S
- Notifications push web absentes — fonctionnalité annoncée, jamais branchée. [BAS] M

### D — Coût financier direct
- Délai de grâce de l'arrêt d'urgence choisi au jugé, jamais vérifié — coupe trop tôt ou trop tard. [MOYEN] S

### E — Dette de code
- Fichier central de l'orchestrateur bien au-dessus du standard — touche tous les outils de contrôle. [BAS] M
- Fichier du superviseur d'équipes trop long, malgré des découpes déjà faites. [BAS] M
- Index de rotation de compte perdu au redémarrage — vrai bug, repart sur un compte déjà saturé. [MOYEN] S
- Détail du raisonnement fusionné en un bloc dans une ancienne version — simplification assumée. [BAS] L
- Tailles de contexte d'un fournisseur tiers non confirmées officiellement — estimation prudente en attendant. [BAS] S

### F — Outillage opérateur / Pi
- Règle système à poser à la main sur le serveur distant — sans elle, l'outil refuse toujours. [MOYEN] S
- Liste des services pilotables non revérifiée contre la réalité — un service a déjà migré ailleurs. [MOYEN] S

### G — Présenter un fichier (demande Chris, non commencée)
- Aucun outil pour montrer un fichier à l'humain sans l'écrire sur disque — demande non traitée. [MOYEN] M
- Persistance du contenu affiché non tranchée — pourrait disparaître si la conversation est résumée. [MOYEN] S
- Composant d'affichage dans la conversation à construire — réutilisation d'un composant existant prévue. [BAS] S
- Bascule code source/visuel pour le HTML — seul point du chantier avec un vrai risque de sécurité. [MOYEN] M
- Penser à annoncer le nouvel outil dans le mandat — sinon il n'existe pas pour le modèle. [BAS] S

### H — Validations manuelles restantes (pas du code)
- Inspection d'une équipe vivante jamais testée en conditions réelles. [MOYEN] S
- Équipe qui travaille longtemps sur une seule instruction, échappe à la surveillance anti-boucle. [MOYEN] M
- Test de bout en bout complet jamais rejoué depuis un changement du prompt système. [MOYEN] S
- Choix d'accès lecture/écriture par l'orchestrateur seul, jamais reconfirmé récemment. [BAS] S
- Deux correctifs de mode probablement déjà résolus, jamais confirmés en conditions réelles. [BAS] S
- Autres réglages optionnels du déploiement distant non revérifiés après une réécriture complète. [BAS] S
- Écart de jetons inexpliqué entre deux compteurs, cause non mesurée. [BAS] S
- Dossier d'écriture du jeton de rafraîchissement, jamais confirmé sur un vrai changement de compte. [BAS] S
- Deux anciens instantanés de connexion périmés à purger. [BAS] S
- Bouton d'extinction physique de la machine jamais retesté depuis un correctif, action irréversible. [MOYEN] S
- Remise à zéro des quotas jamais observée sur un cycle complet. [BAS] S

### I — Repoussé explicitement
- Interface visuelle façon « plateau de jeu » — pur confort, ne contraint rien en amont. [BAS] L
- Entrée en double ou obsolète dans le TODO, à fusionner par arbitrage humain. [BAS] S

### J — Fiabilité SDK/transport
- Contexte à cinq sous-agents jamais mesuré correctement — piège dans la mesure elle-même. [MOYEN] S
- Flux de sous-agents non fiable, aucun plancher garanti — des messages disparaissent sans trace connue. [HAUT] L
- Pas de vérification de vie du lien réseau — une coupure silencieuse paraît un lien vivant. [MOYEN] M
- Latence de reconnexion jamais mesurée en conditions réelles — fiabilité de reprise non prouvée. [MOYEN] S
- Décision de relance écrite et testée, jamais branchée en production — code mort utile inutilisé. [MOYEN] M
- Deux composants de réconciliation sans implémentation réelle — le mécanisme ne tourne pas bout en bout. [MOYEN] M

## 3. Ce qui se tient ensemble
- **Jauge de coût** : les 4 points budget du groupe A → un seul livrable (jauge + champ de briefing).
- **Intégrité du rapport final** : les 3 défauts NOUVEAU (rapport détruit, message mal typé, double horloge) touchent la même ingestion PC→Pi, à corriger en une passe.
- **Permissions rejouées** : « devenir des demandes en mode auto » + « dialogue utilisateur ignoré » = même famille, à mesurer ensemble avant tout code.
- **Backlog UI acté par Chris** : 6 points de gouvernance (atterrissage quota, jauges de quota, permissions dans le fil, sidebar, autocompaction, autorisation au dispatch) déjà tranchés non prioritaires — à sortir d'un lot immédiat.
- **Chantier « présenter un fichier »** : les 5 points du groupe G sont un seul chantier déjà scindé, à traiter comme un tout.
- **Fiabilité du transport** : les 6 points du groupe J partagent une même cause — rien n'a été mesuré sur banc réel avant d'écrire le code.
- **Gestes Pi** : les 2 points du groupe F sont un seul aller sur la machine distante.
- **Recette manuelle groupée** : 10 des 11 points du groupe H se vérifient en une seule session de recette par Chris, sans code préalable.

## 4. Top 5 — par où je commencerais
1. **Rapport final détruit avant écriture** (B) — seul défaut à coût déjà mesuré (relance 2,26 $ pour un travail payé 0,99 $) ; correctif d'une méthode, effort S.
2. **Jauge de coût + plafond annoncé** (A) — évite la prochaine fausse hypothèse de diagnostic ; peu coûteux, protège toutes les missions futures.
3. **Module de réconciliation qui ment** (C) — un code qui renvoie toujours « rien en attente » est plus dangereux qu'une erreur franche ; à couper ou rediriger, effort S.
4. **Index de rotation de compte perdu au redémarrage** (E) — vrai bug fonctionnel derrière une dette de code : redémarrer repart sur un compte déjà saturé.
5. **Les deux gestes Pi** (F) — sans eux, un outil de pilotage de service échoue systématiquement ; 30 minutes débloquent une fonctionnalité entière.

## 5. Points douteux (à arbitrer, rien supprimé du TODO)
- Remontée des verdicts d'inspection PC→Pi (B) — le TODO dit lui-même qu'il faut d'abord revérifier sur artefact réel avant de corriger.
- Deux correctifs de mode probablement déjà résolus (H) — commits et doc plus récents semblent avoir traité le sujet, juste jamais coché.
- Entrée en double/obsolète sur le portage d'outils (I) — le TODO d'origine la marque déjà comme probablement à fusionner.
- Flux de sous-agents non fiable (J) — « sans correctif connu », la divergence observée pourrait être le comportement normal, pas un bug.
- Devenir des permissions rejouées en mode automatique (C) — aucune piste tant qu'une mesure sur banc réel n'a pas été faite.
- Cloisonnement à trois niveaux (C) — à mesurer avant de concevoir quoi que ce soit, risque de bâtir sur une hypothèse fausse.

## 6. Branches non fusionnées
- **equipe/5673ecba** (41 commits, 08/08 matin) — construit un sous-système d'apprentissage du harness (observation de transcripts, file d'attente, clôture, injection de leçons). Abouti : derniers commits polissent (garde anti-fuite, mesures propres 9/9). Ancêtre direct de la branche suivante.
- **equipe/0e3a7a4b** (46 commits, 08/08 après-midi) — contient tous les commits de `5673ecba` + 5 de plus sur le même sous-système. Version la plus avancée du même chantier, abouti. Touche exactement le sujet des défauts NOUVEAU A-D de ce TODO : à examiner avant tout correctif, conflit probable sinon.
- **equipe/1863fd26** (1 commit, 08/08) — corrige un bug d'encodage isolé sur la résolution de transcript. Petit, ciblé, testé, abouti.
- **equipe/674d22d7** (1 commit, 08/08) — corrige un faux négatif du contrôle de redémarrage détaché dans le script de déploiement. Petit, ciblé, abouti.

*Les 4 branches datent du 08/08 et touchent le sous-système « apprentissage » déjà partiellement présent sur master via d'autres commits — à trier avant d'ouvrir un chantier sur les défauts NOUVEAU A-E, risque de conflit ou de double travail réel.*
