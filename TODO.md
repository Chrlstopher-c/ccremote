# TODO — ccremote
*Dernière mise à jour : 2026-08-08*
*Synthèse ajoutée le 2026-08-18 — voir section suivante. Rien n'a été retiré du fichier d'origine :
tout ce qui suit `## ⚡ Harness d'orchestration — chantier actif` (ligne ~150) est le TODO.md tel
qu'il existait avant cette passe, inchangé. Décompte fait ce jour-là : le fichier d'origine contient
67 cases `- [ ]`, dont une (« Rien d'ouvert sur le harness ») n'est pas un point actionnable et trois
sont des doublons exacts d'un autre point du même fichier (l'écart de ~4 061 tokens cité deux fois,
« créer/supprimer un projet » et son corollaire « élévation hors périmètre » comptés séparément dans
le fichier d'origine mais un seul et même arbitrage, le résumé/la fluidité de timeline comptés en deux
lignes pour un seul chantier) — soit **63 points ouverts distincts préexistants**. Plus les **5
défauts neufs** diagnostiqués aujourd'hui (A-E) = **68 points ouverts au total**. Nettement plus que
les ~23 estimés — l'écart tient au fait qu'une bonne partie du fichier d'origine liste des sous-tâches
d'un même chantier une par une plutôt qu'un point par chantier (ex. les 5 cases du chantier « présenter
un fichier », comptées séparément ci-dessous par fidélité au fichier d'origine).*

## 🚨 URGENT 21/08/2026 — suite directe de l'audit du parc (393 mandats), à traiter avant tout le reste

*Chris a mesuré le parc le 21/08 (393 mandats) et a explicitement choisi de NE PAS lancer les équipes
de réparation aujourd'hui : cette section est le seul endroit où les constats de cette passe
survivront. Chaque pointeur ci-dessous a été revérifié dans le dépôt le jour même, pas recopié tel
quel. `☠` Pendant cette vérification, une équipe travaillait EN PARALLÈLE sur du code touchant
plusieurs de ces mêmes points, sur la branche `equipe/5cfebe27-c8b2-46ee-b0ee-e51836c8f668`
(commits `936e65a`..`4ed34e1`, non fusionnée à `master` au moment de cette passe). Deux points prévus
dans cette liste se sont révélés déjà clos par ce travail (7 et une partie du 4/5c) — c'est noté sous
chacun, pas caché. Si cette branche est fusionnée sans incident avant la reprise, revérifier que ces
points tiennent toujours ; si elle ne l'est jamais, ils redeviennent des chantiers à part entière.*

1. **CLOISONNER L'INSPECTION PAR CONVERSATION** — le plus urgent, demande explicite de Chris le 21/08.
   Aujourd'hui, les outils d'inspection de l'orchestrateur rendent le contenu de N'IMPORTE QUELLE
   mission du parc, y compris lancée depuis une autre conversation sur un projet qui ne la regarde
   pas. **Vérifié dans le dépôt** : `lister_equipes` a déjà résolu ce problème pour lui-même
   (`harness/control-plane/orchestrateur/mcp-controle/outils-inspection.ts:44-118`) — un type
   `PorteeListe = 'fil' | 'parc'` et un `conversationId` filtrent les équipes TERMINÉES au fil
   courant. Exception à préserver, déjà en place et documentée dans le code (lignes 54-68) : les
   équipes ACTIVES restent globales, car le parc est une ressource partagée (plafond, quota) et
   qu'elles ne rendent que noms/projets/états, jamais de contenu. Mais `resoudreMission()` (même
   fichier, ligne 135) — utilisée par `etat_equipe`, `rapport_equipe`, `suivre_equipe`,
   `suivre_equipes`, `historique_equipe`, et par le tout nouveau `transcript_equipe` (livré ce jour
   même par l'équipe en parallèle, commit `bd547b1`, toujours SANS cloisonnement) — cherche sur TOUT
   le registre sans jamais recevoir de `conversationId`. Confirmé côté câblage serveur
   (`harness/control-plane/orchestrateur/mcp-controle/serveur.ts`) : `deps.conversationId` existe déjà
   en closure (lignes 168/445/692) et alimente `lister_equipes` (243) et `retirer_mandat` (399), mais
   PAS `etat_equipe` (255), `rapport_equipe` (262), `suivre_equipe` (277), `suivre_equipes` (293),
   `historique_equipe` (336), ni `transcript_equipe`.
   **Piège à noter** : la notion de fil existe déjà (`PorteeListe`/`conversationId` de
   `listerEquipes`) — la réutiliser, ne pas en inventer une seconde.
   **Correction** : faire passer `conversationId` dans `resoudreMission` (ou un wrapper qui l'entoure)
   et refuser/filtrer par fil sur toute mission non active, avec un refus explicite qui ne confirme ni
   n'infirme l'existence d'une mission hors fil (« aucune équipe ne correspond à cette désignation »,
   jamais « elle existe mais tu n'y as pas accès »). **Effort : M** — six points d'appel dans deux
   fichiers, sur un patron déjà écrit une fois dans le même fichier.

2. **REFUSER À LA CRÉATION UN CRITÈRE D'ARRÊT NON VÉRIFIABLE.** Mesuré sur 393 mandats : 34 portent
   encore un critère que l'équipe ne peut pas contrôler elle-même (« rapport rendu », « conforme à la
   densité »). **Vérifié** : `proposerCreationEquipe`
   (`harness/control-plane/orchestrateur/mcp-controle/outils-cycle-vie.ts:72-100`) valide déjà
   `budgetMaxUsd` avant toute écriture et refuse avec un message qui nomme la valeur attendue (lignes
   87-97) — c'est exactement le patron à reproduire pour `critereArret` : refuser tout critère qui ne
   contient ni commande, ni chemin de fichier, ni valeur numérique attendue, avec un refus actionnable
   qui dit ce qui manque et donne un exemple acceptable (même doctrine que
   `shared/acces-mandat.ts::messageAccesInconnu` — un refus s'adresse à un modèle, pas à un humain).
   **Effort : S**.

3. **AJOUTER UN CHAMP `latitude` AU MANDAT.** Constat contre-intuitif de l'audit : la dérive de
   périmètre n'existe presque pas (1 cas sur 393), mais 12 équipes ont vu un défaut, s'en sont
   abstenues parce qu'il était hors périmètre, et ce défaut est devenu le mandat du lendemain — la
   discipline de périmètre alimente le gaspillage. Le champ nommerait ce que l'équipe a le droit de
   corriger si elle le rencontre ; le périmètre l'emporte en cas de recouvrement. **Trois points
   d'ancrage vérifiés** : le type du mandat (`harness/control-plane/registre/types.ts:428`, juste à
   côté de `perimetre`), la composition du texte envoyé au lead
   (`harness/control-plane/orchestrateur/mcp-controle/mandat.ts:15,91-97`, fonction
   `construireMandatPropose`), le schéma zod de l'outil `creer_equipe`
   (`harness/control-plane/orchestrateur/mcp-controle/serveur.ts:367`). **Effort : M** — champ
   optionnel à faire traverser type → texte du mandat → schéma d'outil → UI d'approbation (UI hors
   périmètre de cette vérification, non contrôlée).

4. **METTRE À JOUR LE TEXTE DE CAPACITÉS DE L'ORCHESTRATEUR sur les droits d'accès.**
   `harness/control-plane/orchestrateur/processus/mandat.ts` (section « LES DROITS D'UNE ÉQUIPE »,
   lignes 159-161) décrit encore l'accès d'une équipe comme n'ayant que deux valeurs
   (`lecture`/`ecriture`) — **vérifié dans le dépôt ce jour, toujours vrai sur `master`**. `☠` Ne pas
   confondre avec `harness/control-plane/orchestrateur/mcp-controle/mandat.ts` (nom presque identique,
   fichier différent) : CELUI-LÀ a déjà été mis à jour aujourd'hui par l'équipe en parallèle (commit
   `c3868ff`, branche `equipe/5cfebe27-...`, pas encore fusionnée) pour décrire le troisième accès
   `rapport` — lecture sur le projet, écriture confinée au worktree de l'équipe — livré le même jour
   avec son verrou réel (voir point 6). Mais `processus/mandat.ts` — le texte qui apprend à
   L'ORCHESTRATEUR LUI-MÊME ce qu'il a le droit de proposer, pas ce que le lead reçoit — n'a pas
   bougé. Tant qu'il ne connaît que deux valeurs, l'orchestrateur ne proposera jamais `rapport` : un
   verrou déjà payé et inutilisable. **Effort : XS** — un paragraphe à réécrire dans un fichier de
   prose déjà établie, une fois que `rapport` a atterri sur `master`.

5. **LE SCRIPT DE MISE EN PRODUCTION NE VÉRIFIE PAS MÉCANIQUEMENT QU'AUCUNE ÉQUIPE NE TOURNE.**
   Signalé par l'orchestrateur en cours de journée. `deployer-en-production.sh`, livré aujourd'hui à
   la racine du dépôt (commit `9412472`, branche `equipe/5cfebe27-...`, non fusionnée) redémarre le
   service du harness sur le Pi (son étape 4) et coupe donc net toute équipe en cours de travail
   là-bas. **Vérifié dans le script lui-même** : il AVERTIT en clair (en-tête, « ☠ CE SCRIPT REDÉMARRE
   LE SERVICE DU HARNESS SUR LE PI… Toute équipe ou session en cours là-bas est coupée au même
   instant, sans reprise automatique »), mais ne le VÉRIFIE nulle part mécaniquement — aucun appel au
   parc, aucun comptage. Le garde-fou existe déjà ailleurs dans le même dépôt, à la racine :
   `deployer-tout.sh::verifier_equipes_actives()` (~ligne 146) interroge les équipes actives et
   **s'exclut lui-même de son propre comptage** (sinon la garde se refuserait toujours à elle-même),
   avec un échappatoire explicite et nommé (`--malgre-equipes-actives`, destructeur, à utiliser en
   connaissance de cause).
   **Correction** : décider si `deployer-en-production.sh` doit reprendre ce filet plutôt que le
   réécrire — une logique de self-exclusion improvisée serait un bug non testé sur le chemin le plus
   sensible du dépôt (celui qui coupe des équipes en vol). Si la réponse est oui, brancher l'appel à
   `verifier_equipes_actives()` (ou l'extraire en fonction partagée entre les deux scripts) avant
   l'étape 4. **Effort : S** — la fonction existe déjà et fonctionne, il s'agit de la brancher, pas de
   la concevoir.

6. **QUATRE CORRECTIONS DE CONDUITE NON PORTÉES**, dans `harness/composition/deploiement/config-orchestrateur/`
   (chemin vérifié — `CLAUDE.md` + `skills/*/SKILL.md`) :
   - **(a)** Fixer le plafond de dépense d'une mission à environ 1,6× l'estimation — 30 missions
     terminent au-delà de 90 % de leur plafond et sacrifient alors leur vérification finale. Rien de
     chiffré aujourd'hui : `skills/mandate-framing/SKILL.md:50` dit seulement « sized to the work »,
     aucun multiplicateur. **Effort : XS**.
   - **(b)** Interdire les commandes shell adressées à Chris (24 en un mois) au profit d'un script qui
     s'exécute en une seule ligne — ce qu'il a lui-même demandé le 18/08. Aucune règle de ce type
     trouvée dans `CLAUDE.md` (recherché). Le patron à citer en exemple existe déjà dans le dépôt :
     `deployer-pi.sh` (« une seule commande… résout seule le secret », voir plus bas « Fait le soir du
     18/08 »). **Effort : S**.
   - **(c)** Documenter dans la conduite les deux capacités livrées aujourd'hui par l'équipe en
     parallèle (branche non fusionnée `equipe/5cfebe27-...`) : lire le transcript d'une équipe morte
     AVANT d'envisager de la relancer (`transcript_equipe`, commit `bd547b1`) et le troisième droit
     d'accès `rapport` (commit `c3868ff`, voir point 4) — sans quoi l'orchestrateur relance à l'aveugle
     et paie deux fois. **Effort : XS**, mais seulement une fois les points 1 et 4 posés (rien à
     documenter tant que le cloisonnement par fil n'existe pas sur `transcript_equipe`).
   - **(d)** Reformuler la règle interdisant d'ouvrir par « tu as raison » (`CLAUDE.md:54`, texte
     exact : « Never open with `Absolument`, `Excellente question`, `Tu as raison`, `Bien sûr` »),
     violée 6 fois après sa mise en place contre 4 avant. La règle dit aujourd'hui seulement
     l'interdiction — rien sur quoi faire à la place quand Chris a effectivement raison. **Effort :
     XS**.

7. **ÉPROUVER POUR DE VRAI LE VERROU D'ÉCRITURE CONFINÉE.** Le troisième accès `rapport` (points 4 et
   5c) repose sur `harness/workers/confinement-ecriture.ts` — hook `PreToolUse` réel, testé
   unitairement (5 tests, commit `c3868ff`, branche `equipe/5cfebe27-...` non fusionnée), mais
   l'équipe qui l'a écrit le signale explicitement dans le fichier lui-même : « AUCUN banc
   `acceptation/*-reel.ts` de ce dépôt n'exerce ce chemin contre le vrai binaire CLI ». Le patron à
   répliquer existe déjà pour d'autres refus d'outils, cité par le fichier lui-même :
   `harness/acceptation/bypass-denis-reel.ts` et `harness/acceptation/plancher-moteur-reel.ts`. Tant
   que ce banc n'existe pas, ce verrou est une promesse, pas une garantie. **Effort : S** — sur un
   patron déjà écrit deux fois, plus la mise en place d'un mandat de test dont l'écriture hors-worktree
   doit être tentée et refusée en vrai.

8. **LES DEUX SILENCES DU CYCLE DE VIE — DÉJÀ FERMÉS, à ne pas réinscrire tels quels.** Vérifié dans le
   dépôt : le préavis à 80 % du plafond ET l'événement visible sur un mandat mort au démarrage sont
   tous deux livrés aujourd'hui par l'équipe en parallèle (commit `4ed34e1`, branche
   `equipe/5cfebe27-...`, non fusionnée à `master`). Préavis câblé dans
   `harness/composition/pi/balayage-telemetrie.ts` (nouvelle option `avertirBudget80`, idempotente) et
   branché sur le même canal que `envoyer_a_equipe` ; démarrage refusé notifié via une nouvelle option
   `signalerEchecDemarrage` sur `dispatch-mandat.ts`, câblée sur le type `equipe_echouee` déjà prévu.
   Les deux validés dans les deux sens selon le message de commit (git diff temporaire du
   déclenchement, rouge constaté, restauré), 1854 tests verts, `tsc --noEmit` propre. **Rien à faire
   ici tant que cette branche n'a pas révélé un défaut après fusion** — si elle n'est jamais fusionnée,
   ce point redevient un chantier à part entière.

9. **HUIT MISSIONS RÉELLEMENT DÉMARRÉES N'ONT LAISSÉ AUCUNE TRACE de télémétrie** (~2 % du parc).
   Piste déjà posée dans le dépôt : le balayage qui persiste l'activité tourne toutes les 5 s
   (`harness/composition/pi/balayage-telemetrie.ts:27`, `PERIODE_BALAYAGE_MS`). Rapprochement à
   noter : la mesure faite aujourd'hui par l'équipe en parallèle pour livrer `transcript_equipe`
   (commit `bd547b1`) trouve, sur les ~129 missions sans rapport (sur 395 mandats mesurés côté
   telemetrie), que 85 % ont quand même leur activité dans `activite_mission` — soit ~15 % (~19) qui
   n'en ont aucune, plus large que les huit mesurées ici mais dans la même direction. Le « chantier 4 »
   de cette même mission — creuser précisément pourquoi — a été explicitement SACRIFIÉ faute de budget
   (dit dans le message de commit `bd547b1`) : c'est bien le seul angle mort qui reste sur la lecture
   des transcripts. **Effort : S** pour la mesure, indéterminé pour le correctif selon ce qu'elle
   trouve.

10. **QUESTION TRANCHÉE AUJOURD'HUI PAR L'ÉQUIPE EN PARALLÈLE — à documenter, pas à réinvestiguer.**
   Vérifié : le choix décrit ici est déjà fait (commit `bd547b1`, branche `equipe/5cfebe27-...`, non
   fusionnée). `DepotMissions.aRapportFinal()` (`harness/control-plane/registre/missions.ts`) rend vrai
   si le dernier acte est un texte postérieur au dernier appel d'outil ; câblé aux deux points qui
   écrivaient `'terminee'` (`reconciliation.ts`, `service-cloture.ts`) — sans rapport qualifiant,
   l'état devient `echec_definitif` (existant), jamais un état dédié. Le message de commit donne
   exactement la raison attendue : un nouvel état aurait exigé de recréer la table `mission` sous
   contrainte FK, « vérifié dangereux par expérience directe sur SQLite avant d'écarter cette voie ».
   Le choix est honnête, documenté, et évite une migration risquée — mais il fusionne deux sémantiques
   différentes (« a tourné sans rien restituer » vs « échec réel »). **Question qui reste ouverte** :
   si ce besoin de distinction se fait sentir plus tard, la migration délicate décrite ici (renommer la
   table mission casse les tables filles même FK désactivées, mesuré) reste entière — à trancher par
   Chris le jour où l'ambiguïté coûte réellement quelque chose, pas avant.

11. **TROIS POINTS OUVERTS SUR LA LECTURE DES FILS — déjà inscrits plus tôt aujourd'hui, non
    dupliqués ici.** Vérifié : ils sont déjà dans ce fichier, juste en dessous, sous
    « 🆕 Trois points laissés ouverts par cette passe, non traités (21/08) » (index absent sur les
    événements de conversation, recherche insensible aux accents faite en mémoire faute de voie
    indexée en lecture seule, fils sans message soumis au filtre de plage de dates). Rien à ajouter.

12. **LA COPIE DE TRAVAIL PRINCIPALE DU DÉPÔT (`/mnt/projects/ccremote`) EST DÉSYNCHRONISÉE.** Vérifié
    en direct ce jour : `HEAD` est sur `master` (`6a484b7`), mais `git status` y montre des
    suppressions STAGÉES sur des fichiers que `master` contient bel et bien
    (`ARBORESCENCE.md`, `STATE.md`, `TODO.md`,
    `harness/control-plane/orchestrateur/mcp-controle/outils-historique-fils.ts` + son test,
    `harness/control-plane/registre/fils-historique.ts`, plus des modifications sur `serveur.ts` /
    `serveur.test.ts` / `processus/mandat.ts` / `registre/index.ts`) — les fichiers sur disque sont
    restés à un état antérieur aux commits `5240965`/`78b2c7e`/`6a484b7`. **Aucun script de réparation
    livré** : recherché dans les scripts racine (`*.sh`) et dans les commits de l'équipe en parallèle
    (`936e65a`..`4ed34e1`) — rien n'y touche ce problème. Déployer dans cet état enverrait l'ancien code
    sur le Pi sans la moindre erreur. **Correction** : sur cette copie, vérifier d'abord qu'aucun
    travail non commité ne s'y cache (`git stash` par précaution), puis `git restore --staged .` suivi
    d'un `git checkout -- .` (ou `git reset --hard HEAD` si la copie ne sert qu'au déploiement).
    **Effort : XS** pour la remise en état — mais un geste d'opérateur, à faire AVANT le prochain
    déploiement Pi, pas une tâche de code.

## ✅ Fait le 21/08 — deux outils MCP de relecture des fils, fusionnés dans `master`

- [x] **`lister_fils`/`lire_fil`** — outils lecture seule de relecture de l'historique des fils
      (`mcp-controle/outils-historique-fils.ts` + dépôt `registre/fils-historique.ts`), fusionnés
      depuis `equipe/c86e5a2c-a7e0-42fe-9c6e-88f0b2ffcb4f` (fast-forward pur). Détail complet,
      bornes et défauts déjà corrigés dans cette même passe : voir `STATE.md`.

### 🆕 Trois points laissés ouverts par cette passe, non traités (21/08)

- [ ] **Index sur les événements de conversation, non ajouté.** `lister()` balaie
      `conversation_evenement` sans filtre d'index dédié — inutile au volume actuel du registre
      (un parc personnel, pas un historique de production à grande échelle : mesuré 108 fils,
      7 864 événements, 42 ms sans index). L'index qui conviendrait si le volume grossit est décrit
      en tête de `harness/control-plane/registre/fils-historique.ts`. **Effort : XS** le jour où le
      volume le justifie.
- [ ] **Recherche insensible aux accents faite en mémoire, pas en base.** `lire_fil` normalise
      (NFD + retrait des diacritiques) côté code JS plutôt qu'en SQL, faute d'une voie purement en
      lecture côté base : `bun:sqlite` n'expose ni fonction SQL custom (`Database.function`) ni
      collation utilisable par `LIKE`. Une solution indexée (FTS5 avec tokenizer
      `unicode61 remove_diacritics 2`, ou une colonne normalisée + index dessus) exigerait une
      écriture de schéma — décision de coût qui revient à Chris. **Effort : S** (FTS5) à **M**
      (colonne + migration), au jugement de Chris.
- [ ] **Fils sans message, toujours soumis au filtre de plage via `maj_a` du fil.** `lister_fils`
      rend désormais les fils sans aucun événement (correctif LEFT JOIN ci-dessus), mais un fil vide
      n'apparaît que si sa date de mise à jour tombe dans la plage demandée. S'il faut qu'un fil vide
      apparaisse TOUJOURS, quelle que soit la plage, c'est un changement d'une ligne dans
      `DepotFilsHistorique.lister()` (retirer la borne sur `c.maj_a` de la clause `OR`). **Effort :
      XS**, arbitrage de Chris à trancher avant de la faire.

## ✅ Fait le soir du 18/08 — voir `STATE.md` pour le détail vérifié

- [x] **`deployer-pi.sh`** — une seule commande pour le control plane du Pi, résout seule le secret
      du lien, n'appelle l'interface web que si elle a changé.
- [x] **`CCREMOTE_VPS_LIEN_URL_PI`** ferme l'héritage silencieux de `CCREMOTE_LIEN_URL_PI` sur le
      déploiement VPS — panne réelle de 45 min ce jour-là, piège fermé (`deploy-superviseur-vps.sh`).
- [x] **Point 14 ci-dessous (« trou résiduel » de persistance du registre PC), FERMÉ** — trois
      défauts corrigés dans `harness/superviseur/` : verdict de mort désormais persisté sur disque
      (pas seulement calculé en mémoire), extinction propre du superviseur marquant morts les
      workers gérés, `pid`/`pidStarttime` enregistrés au spawn (revalidation opérante après un
      simple redémarrage de service). Validé dans les deux sens (git stash).
- [x] **`H-76` — défaut neuf, diagnostiqué et fermé le jour même** : un objet MCP non sérialisable
      placé dans la fiche du worker faisait échouer silencieusement TOUTE écriture au registre PC
      depuis 20h19 (`JSON.stringify` levait, catché sans effet). Corrigé (`projeterSpecPersistee()`
      exclut réellement `mcpServers` désormais) et vérifié en production le soir même.
- [x] **Page de nouveautés opérateur** — `pi-web/static/nouveautes-2026-08-18.html`, déployée sur le Pi.

### 🆕 Défaut de documentation découvert en documentant (18/08, non corrigé — hors périmètre de cette passe)

- [ ] **`harness/ARCHITECTURE.md` et `harness/ARBORESCENCE.md` datent du 2026-08-07** et n'ont pas
      suivi la création du domaine `harness/apprentissage/` (44 fichiers, créé le 08/08 — extraction
      de leçons entre missions), ni `harness/shared/` (9 fichiers) ni `harness/config-equipe/`
      (2 fichiers), absents de leur carte des domaines. **Correction** : mettre à jour les deux
      fichiers (hors périmètre d'une mission de documentation racine — ce sont des fichiers sous
      `harness/`, pas à la racine du dépôt). **Effort : S**.

## 🗂️ SYNTHÈSE — problèmes récurrents rencontrés avec les équipes, et correction en face

*Regroupement par NATURE du problème, pas par ordre chronologique. Chaque point porte : le problème
en une phrase, la correction envisagée, un effort grossier (XS = config/quelques lignes · S = < 1
jour · M = 1-3 jours · L = chantier dédié · XL = chantier structurant), et sa provenance (référence
de ligne dans le détail plus bas, ou « NOUVEAU » pour les cinq défauts diagnostiqués aujourd'hui).
Un point sans piste de correction crédible est marqué `SANS CORRECTIF CONNU` plutôt que maquillé.*

### Groupe A — Ce qu'une équipe (ou l'orchestrateur) ignore d'elle-même

Une équipe autonome qui ne sait pas ce qu'elle a dépensé, ce qu'il lui reste, ou ce qu'elle a le
droit de faire construit ses décisions sur des suppositions — et une décision de diagnostic bâtie sur
une supposition fausse coûte une deuxième équipe pour la corriger.

1. **NOUVEAU B — une équipe ne connaît pas sa propre consommation.** Aucun outil de consultation
   temps réel de son propre coût (dollars dépensés, plafond, %, contexte consommé). Constaté : une
   équipe de diagnostic a bâti son hypothèse principale sur un dépassement de budget supposé, à 15 %
   de son plafond réel — hypothèse fausse, réfutée par une seconde équipe.
   **Correction** : exposer un outil MCP de consultation temps réel à l'équipe elle-même (dollars
   dépensés, plafond, %, contexte). **Effort : M** — le relevé existe déjà côté télémétrie
   (`#telemetrie`), il s'agit de l'exposer en lecture à l'équipe plutôt qu'au seul superviseur.
2. **NOUVEAU C — le plafond de dépense n'est pas annoncé à l'équipe.** Corollaire direct de B : le
   montant décidé au mandat n'apparaît nulle part dans le briefing du lead. Une équipe qui ignore son
   plafond ne peut ni le respecter ni raisonner dessus.
   **Correction** : inscrire le plafond dans le texte du briefing de départ (`mandate`/`systemPrompt`),
   en plus de l'outil de consultation du point 1. **Effort : XS** — un champ à interpoler dans un
   gabarit de texte déjà existant.
3. **H-63 — pas de jauge dollars par fenêtre de rate limit, par compte** (détail L997). Le point 1
   couvre le coût de la MISSION ; celui-ci couvre le quota du COMPTE, partagé entre plusieurs
   missions. Les deux sont distincts et les deux manquent. **Correction** : jauge par compte, remise
   à zéro sur `resetsAt` uniquement. **Effort : M**.
4. **Crédits `extra_usage` non affichés dans une jauge** (détail L826). Des crédits offerts restent
   finis ; un parc autonome les consomme sans que ça se voie. **Correction** : afficher la
   consommation dans la jauge H-63 ci-dessus (visibilité, pas blocage). **Effort : XS**, une fois H-63
   posée.
5. **H-71 — pas de choix de modèle/raisonnement dans le fil de l'orchestrateur** (détail L958). Backlog
   acté par Chris, pas prioritaire. **Correction** : sélecteur dans le fil, modèles éligibles déjà
   identifiés (`opus-4-8`, `sonnet-5`, `fable-5`, `opus-4-7`). **Effort : M**.

### Groupe B — Ce qui se perd entre le PC et le Pi (les deux moitiés du système divergent)

Le PC ingère, le Pi écrit en base par balayage périodique. Chaque fois que ces deux moitiés ne sont
pas synchronisées par construction, quelque chose se perd ou se déforme silencieusement.

6. **NOUVEAU A — PRIORITÉ HAUTE — le rapport final d'une équipe est détruit avant d'être enregistré.**
   `#enfilerApprentissageSiConfigure` (`superviseur-workers.ts` ~813) invoque `#telemetrie.tous()`
   (~862), DRAINANTE : elle vide `activitesEnAttente` de toutes les missions du process pour ne garder
   que `coutUsd`/`contexteTokensUtilises`, et jette le reste — dont le message final du lead tout
   juste ingéré. Le balayage du Pi (toutes les 5 s, seul à écrire en base) perd systématiquement la
   course. Actif seulement si `CCREMOTE_APPRENTISSAGE_ACTIF=1` (posé par `deployer-apprentissage.sh`).
   Mesuré aujourd'hui : 2 missions sur 5 ont perdu leur rapport, dont une relance à 2,26 $ pour refaire
   un travail déjà payé 0,99 $.
   **Correction** : ajouter au collecteur de télémétrie une lecture NON drainante (ex. `lire(missionId)`)
   qui rend coût et contexte sans vider les files, et l'utiliser dans `#enfilerApprentissageSiConfigure`
   à la place de `tous()`. **Vérification** : apprentissage actif, dernier message à texte distinctif
   présent en base avant le premier balayage ; annuler le correctif doit faire réapparaître la perte.
   **Effort : S** — un ajout de méthode au collecteur + un point d'appel changé.
7. **NOUVEAU D — le message de clôture automatique est enregistré comme s'il venait du lead.**
   `service-cloture.ts` (~43-49) appelle `ajouterActivite()` avec 3 arguments seulement : le type
   retombe sur sa valeur par défaut `'texte'`. Le bandeau « [HARNESS] Équipe close automatiquement... »
   devient indiscernable de la parole de l'équipe, et `dernierTexte()` peut le restituer comme rapport.
   Recoupe directement **H-66 — attribution de l'émetteur** (détail L989, encore ouvert) : c'est un cas
   particulier du manque général « rien ne dit qui a réellement parlé ».
   **Correction** : passer explicitement un type distinct de `'texte'` à l'appel. **Effort : XS**, une
   ligne. Traiter en même temps que H-66 si ce chantier est repris, sinon corriger isolément.
8. **NOUVEAU E — deux horloges alimentent le même horodatage.** `activite_mission.survenu_a` reçoit
   tantôt l'heure du PC (chemin normal, à l'ingestion), tantôt celle du Pi (clôture automatique).
   `dernierTexte()` trie dessus. Une dérive PC/Pi peut inverser l'ordre des textes. Défaut latent,
   jamais observé.
   **Correction** : une seule source d'horloge pour cette colonne, ou un ordre de tri qui ne dépende
   pas de l'horodatage (ex. compteur/séquence). **Effort : S**.
9. **Remontée `subagents`/`inspection` du PC vers le Pi incomplète** (détail L604-606, ancien — la
   partie `subagents` semble résolue depuis par un chantier ultérieur, `inspection` — les verdicts du
   juge H-68 — reste non confirmé remonté). **Correction : SANS CORRECTIF CONNU à ce stade** — d'abord
   revérifier sur artefact réel si `inspection` est toujours manquante avant de concevoir un correctif.
   **Effort : S** pour la vérification, indéterminé pour le correctif.
10. **`semantic-memory`/`codeindex` absents du VPS** (détail L402, recoupe L386 marqué obsolète/à
    vérifier). `semantic-memory` résolu en lecture distante ; `codeindex` reste absent (CUDA, pas de
    GPU sur le VPS). **Correction** : version CPU de `codeindex`, chantier à part. **Effort : L**.
11. **Aucune surveillance du service de mémoire sémantique** (détail L405). S'il tombe, les équipes
    perdent l'outil sans qu'aucune jauge ne le dise. **Correction** : sonde de santé + alerte, même
    patron que les autres services surveillés. **Effort : S**.
12. **Bun désaligné entre PC (1.3.13) et VPS (1.3.14)** (détail L400). Sans conséquence connue à ce
    jour. **Correction** : aligner les deux sur la même version au prochain déploiement. **Effort : XS**.
13. **Timeline : résumé de séquence en tête manquant** (détail L397) et **fluidité limitée aux pages
    Mission/Agent** (détail L399) — la timeline riche ne couvre que la vue Orchestrateur.
    **Correction** : porter le même rendu aux deux autres vues. **Effort : M**.
14. ~~**Persistance du registre de workers côté PC : trou résiduel**~~ (détail L905) — **FERMÉ le
    2026-08-18** : trois défauts corrigés (`harness/superviseur/`) — verdict de mort désormais
    persisté sur disque au moment où il est tranché (pas seulement calculé en mémoire), extinction
    propre du superviseur marquant morts les workers qu'il gérait, `pid`/`pidStarttime` enregistrés
    au démarrage d'un worker (revalidation opérante après un simple redémarrage de SERVICE, même
    boot machine). Validé dans les deux sens (git stash des fichiers de production). Voir `STATE.md`.

### Groupe C — Ce qui échappe au contrôle de l'orchestrateur (gouvernance, permissions, hiérarchie)

15. **Étage manquant : le lead ne peut pas interpeller l'orchestrateur** (détail L491). Hiérarchie
    voulue « sous-agents → lead → orchestrateur → humain » ; les deux premiers étages sont natifs du
    SDK, le troisième (le lead a une question et attend une réponse) n'existe pas.
    **Correction** : canal de conversation remontante dédié, distinct du bus de permissions (déjà
    retiré). **Effort : L** — nouveau canal de bout en bout (port, table, UI).
16. **Créer/supprimer un projet depuis l'orchestrateur, non fait volontairement** (détail L282/L287).
    Création jugée sans risque ; suppression en autonomie nocturne = mode de panne déjà payé
    (`rm -rf sessions/*`, agora, irrécupérable).
    **Correction** : création libre, suppression réservée à un clic humain explicite, jamais
    auto-approuvable. **Effort : M**, arbitrage déjà tranché, reste l'implémentation.
17. **`reponse-reinitialize.ts` rend toujours `[]`, code mort dangereux** (détail L678) — pire qu'une
    erreur : la réconciliation en conclut « rien en attente » et se croit à jour.
    **Correction** : supprimer le module ou le réorienter vers une source réelle. **Effort : S**.
18. **Devenir des demandes rejouées en `permissionMode: 'auto'` inconnu** (détail L681) — la
    redélivrance passe par `canUseTool`, mesuré comme jamais appelé dans ce mode. Trou le plus
    sérieux de la dette n°3 du registre. **Correction : SANS CORRECTIF CONNU sans mesure préalable** —
    à trancher par banc réel avant tout code. **Effort : M** pour la mesure seule.
19. **`pending_user_dialog_requests` totalement ignoré** (détail L685), famille jumelle du point 18.
    **Correction : SANS CORRECTIF CONNU** tant que 18 n'est pas mesuré. **Effort : indéterminé**.
20. **Arbitrages maquette v3 restants** (détail L717/L719) : Sonnet 4.6 grisé/masqué, jauge de contexte
    dans la vue Orchestrateur, et l'atterrissage par mission qui contredit H-70 (la décision doit
    revenir au superviseur, jamais au lead isolément — fenêtre de quota partagée par compte).
    **Correction** : trancher les deux premiers points UI ; retirer le déclencheur par mission dès que
    l'atterrissage superviseur (H-70, point 26) devient réel. **Effort : M**.
21. **Parler à une mission en cours, absent de l'UI** (détail L924) — `envoyer_a_equipe` existe côté
    outil, la maquette v2 ne l'expose nulle part. **Correction** : bouton d'intervention sur la carte
    mission en cours. **Effort : S**.
22. **Composer un mandat depuis l'UI, bouton mort** (détail L928) — pièce centrale du système (but /
    critère d'arrêt / périmètre), rien ne le compose à l'écran. **Correction** : formulaire réel
    câblé sur la route de dispatch existante. **Effort : M**.
23. **Barre de sûreté absente de 2 vues sur 6** (détail L931) — Orchestrateur et Paramètres. H-57
    exige qu'elle reste joignable partout. **Correction** : la porter aux deux vues manquantes.
    **Effort : S**.
24. **Règles de notification non réglables/visibles** (détail L945) — groupement, seuil de rappel,
    silence sur ce que le lead a résolu seul : aujourd'hui un simple interrupteur Discord.
    **Correction** : panneau de réglage dédié. **Effort : M**.
25. **H-61 — autorisation humaine au dispatch, backlog acté** (détail L986) — dernier garde-fou humain
    du système, décision de Chris de le garder pour après le MVP. **Correction** : proposition +
    clic déjà spécifiée. **Effort : M**. *(Backlog explicite, pas prioritaire.)*
26. **H-66 — attribution de l'émetteur, backlog acté** (détail L989) — préfixe structurel
    `orchestrateur`/`operateur` sur tout message entrant. Recoupe directement le défaut NOUVEAU D
    ci-dessus (point 7), qui en est une instance concrète déjà mesurée. **Correction** : traiter les
    deux ensemble — D est le cas le plus visible et le moins cher à corriger de ce chantier plus
    large. **Effort : M** pour H-66 complet, **XS** pour la seule instance D.
27. **H-52 complété — hiérarchie non enseignée au lead** (détail L992) : il doit savoir qu'il est une
    équipe parmi d'autres, que ses instructions viennent normalement de l'orchestrateur, et que
    l'opérateur peut lui parler directement (identifié comme tel). **Correction** : ajout au system
    prompt du lead. **Effort : XS**. *(Ce point recoupe très directement ce que `CLAUDE-equipe.md`
    couvre déjà en partie — à vérifier avant de dupliquer.)*
28. **H-70 — atterrissage propre avant saturation de quota, backlog acté** (détail L952) : décision
    prise par le SUPERVISEUR (jamais le lead seul), fenêtre partagée par compte. **Effort : L**.
29. **H-72 — jauges de quota + navigation par agent, backlog acté** (détail L965). **Effort : L**.
30. **H-72.1 — cloisonnement à trois niveaux, à MESURER avant de concevoir** (détail L970) : établir
    d'abord si `forwardSubagentText`/`agentProgressSummaries` alimentent le flux lu par le programme
    ou le contexte du modèle parent. **Correction : mesure d'abord (banc réel), design ensuite.**
    **Effort : S** pour la mesure.
31. **H-64 — permissions dans le fil de la mission, backlog acté** (détail L1002). **Effort : M**.
32. **H-67 — sidebar arborescente + messages en file, backlog acté** (détail L995). **Effort : L**.
33. **H-62 — orchestrateur maître : autocompaction + bouton manuel, backlog acté** (détail L1000).
    **Effort : M**.
34. **Métriques machine supprimées de la maquette v2** (détail L942) — alors que les process enfants
    survivent à la pause et s'accumulent (H-57). **Correction** : une ligne de charge dans la carte
    lien (compromis déjà proposé). **Effort : S**.
35. **M-41 — alarme réelle manquante sur `surFermetureImprevue`** (détail L1006, H-60). L'instrumentation
    existe, ne sert à rien sans alarme branchée. **Effort : S**.
36. **Manifeste PWA + service worker pour Web Push absents** (détail L1008, H-59). **Effort : M**.

### Groupe J — Fiabilité du SDK/transport : mesures et câblages jamais terminés

Une famille de points où l'implémentation existe mais où le chemin réel de production n'a jamais été
mesuré ou câblé bout en bout — distincte du groupe C (gouvernance) parce qu'il s'agit ici de fiabilité
technique du transport et du cycle de vie, pas de qui décide quoi.

65. **Contexte du parent à cinq sous-agents, jamais mesuré** (H-72.3, détail L693) — vérifié sur UN
    sous-agent (inchangé), la lecture à cinq a échoué sur le piège `getContextUsage()` dans la boucle.
    **Correction** : refaire la mesure en lisant le contexte hors de la boucle. **Effort : S**.
66. **Flux de sous-agents non déterministe, aggravé** (H-72.4, détail L703) — deux exécutions d'un
    banc à cinq sous-agents, session saine, ont donné 0 ligne là où trois exécutions antérieures en
    donnaient 3 à 4 ; `forwardSubagentText` n'offre aucun plancher garanti. **Correction : SANS
    CORRECTIF CONNU** — la divergence flux/store n'est pas un cas limite mais peut-être le cas
    nominal ; nécessite un design distinct (H-72.1, point 30) avant tout correctif. **Effort :
    indéterminé, dépend du point 30**.
67. **M-10 — pas de ping/pong applicatif** (détail L755) — une coupure silencieuse (ni `close` ni
    `error`) n'est pas détectée : le lien paraît vivant, ne transporte plus rien.
    **Correction** : ping/pong au niveau transport, indépendant du process Claude Code.
    **Effort : M**.
68. **M-10 — latence de reconnexion jamais mesurée en réel** (détail L758) — le critère « coupure de
    30 s, zéro octet perdu ou dupliqué » n'est prouvé que sur doublures. **Correction** : banc réel
    avec coupure réseau simulée, mesuré par le parent (interdiction de réseau réel en sous-agent).
    **Effort : S**.
69. **`deciderRelance()` écrit et testé en isolation, jamais câblé** (M-34/M-30, détail L811 et L919 —
    même sujet cité deux fois dans le fichier d'origine). Le point de câblage est le gestionnaire du
    flux live côté superviseur de workers, jamais construit. **Correction** : brancher sur
    `SDKResultMessage.terminal_reason` réel. **Effort : M**.
70. **Ports `InventairePc`/`ReinitialisateurSession` sans implémentation réelle** (M-30, détail L910)
    — la réconciliation ne tourne donc pas de bout en bout. **Correction** : implémenter les deux
    ports contre le vrai superviseur PC. **Effort : M**.

### Groupe D — Ce qui coûte de l'argent pour rien

37. **NOUVEAU A (rappel, voir point 6)** — le défaut le plus cher mesuré : relance à 2,26 $ pour un
    travail déjà payé 0,99 $, sur seulement 5 missions observées le même jour.
38. **NOUVEAU B/C (rappel, voir points 1-2)** — une équipe qui ne connaît pas son coût peut soit se
    croire à l'abri et déraper, soit conclure à tort à un dépassement (coût d'une deuxième équipe pour
    réfuter une fausse piste).
39. **Fenêtre de grâce de l'arrêt d'urgence non alignée** (détail L657) — `GRACE_ARRET_URGENCE_MS_DEFAUT
    = 5000` choisi par défaut, jamais vérifié contre `05-arbre-B`. Trop court : coupe une écriture en
    cours. Trop long : l'urgence n'est plus urgente. **Correction** : trancher sur mesure réelle, pas
    au jugé. **Effort : S** pour la mesure.

### Groupe E — Dette de code et de qualité (fichiers hors standard, code non exercé)

40. **`serveur.ts` — 781 lignes** (détail L64, standard : 500 max). Touche le câblage de tous les
    outils de contrôle de l'orchestrateur. **Correction** : scinder par famille d'outils (inspection,
    mandat, rappels, fil, machine, service…). **Effort : M**, mérite son propre mandat.
41. **`superviseur-workers.ts` — 801 lignes** (détail L503, remonté de 710 malgré des extractions déjà
    faites). **Correction** : nouvelle extraction ciblée. **Effort : M**.
42. **Index de rotation du master en mémoire + `harness-orchestrateur.js` ~796 lignes** (détail L569).
    **Correction** : persister l'index de rotation (repart sur le compte A même saturé après un
    redémarrage — un vrai bug fonctionnel, pas seulement une dette) ; scinder le fichier JS.
    **Effort : S** pour l'index, **M** pour le découpage.
43. **App v1 — reasoning fusionné en un seul bloc par échange** (détail L1040), simplification assumée.
    **Effort : L** si on veut la granularité par round de tool-calling.
44. **App v1 — tailles de contexte Cerebras non confirmées** (détail L1042, `zai-glm-4.7`/`gpt-oss-120b`
    /`gemma-4-31b`). **Correction : SANS CORRECTIF CONNU sans documentation Cerebras publique.**
    **Effort : XS** si Cerebras publie un jour la donnée, sinon rester sur l'estimation prudente.

### Groupe F — Outillage et infrastructure à finir (gestes opérateur, pas du code)

45. **Règle sudoers à poser sur le Pi pour `piloter_service`** (détail L45) — geste opérateur, jamais
    automatisé par ce harness. Sans elle, l'outil échoue en `refuse` explicite. **Effort : XS**, un
    fichier à déposer en root sur le Pi, ligne exacte déjà fournie dans le détail plus bas.
46. **Revalidation de la liste blanche des services** (`outils-service.ts`, détail L57) contre l'état
    réel du Pi — dernier inventaire du 17/07, complété le 01/08, jamais revérifié en direct
    (`stockiop-api` a par exemple migré vers le VPS). **Correction** : passage `systemctl list-units`
    comparé aux trois seaux. **Effort : S**.

### Groupe G — Chantier « présenter un fichier » (demandé par Chris le 08/08, non commencé)

Cinq sous-tâches d'un seul chantier — comptées séparément dans le décompte car ce sont des cases
distinctes du fichier d'origine, mais à traiter comme un tout cohérent.

47. **Outil MCP de présentation** (détail L21) — remettre un contenu nommé/typé à Chris SANS que ce
    soit un fichier écrit sur disque (ne pas rendre `Write` par la bande). **Effort : M**.
48. **Persistance de l'artéfact** (détail L27) — examiner le mécanisme de pièces jointes existant
    (migration 24, sens Chris → orchestrateur) avant d'en construire un second. **Effort : S**
    d'investigation, **M** pour l'implémentation qui en découle.
49. **Composant d'affichage dans la conversation** (détail L31) — réutiliser `HValise`. **Effort : S**.
50. **Bascule code source / rendu pour le cas HTML** (détail L35) — seul point à risque réel : `iframe
    sandbox` sans `allow-same-origin`, jamais d'injection directe dans le DOM de l'app. **Effort : M**,
    la décision de sûreté doit être prise avant la première ligne.
51. **Annoncer l'outil dans le mandat le jour de la livraison** (détail L40) — sinon il n'existe pas
    pour le modèle. **Effort : XS**, mais à ne pas oublier (quatre occurrences passées du même oubli).

### Groupe H — Validations manuelles restantes (à faire par Chris ou en conditions réelles, pas du code)

52. **Inspection à la demande sur une équipe VIVANTE, jamais exercée en vrai** (détail L266) — livrée
    et déployée, mais seul le chemin d'une équipe close a été vérifié. **Effort : S**, un test réel.
53. **Anti-boucle qui n'inspecte que sur `SDKResultMessage`** (détail L270) — une équipe qui travaille
    15 min sur une seule instruction n'est pas inspectée pendant ce temps. **Correction** : brancher
    sur le coût live (déjà relevé en continu), chemin de contrôle à changer sur mesure réelle, jamais
    par déduction. **Effort : M**.
54. **Test bout en bout complet par Chris, jamais rejoué depuis** (détail L276) — fil neuf obligatoire
    (le prompt système a changé). **Effort : néant côté code**, juste à faire.
55. **Choix `acces` (lecture/écriture) par l'orchestrateur seul, jamais confirmé en conditions
    réelles récentes** (détail L488). **Effort : néant côté code**, juste à faire.
56. **Mode rapide et ultracode — probablement résolus depuis, à confirmer.** Le TODO d'origine (détail
    L496) les marque « jamais exercés », daté du 31/07. Un commit plus récent trouvé sur la branche
    (`91130f9`, « ultracode était réglable et ne partait nulle part ») corrige explicitement ce
    défaut pour `ultracode`, et `STATE.md` du 07/08 documente `fastMode` câblé de bout en bout
    (migration 28). **Aucune des deux corrections n'a été observée en conditions réelles par Chris**,
    et le point n'a jamais été retiré du TODO — probablement un oubli de mise à jour plutôt qu'un
    défaut persistant. **Effort : XS**, une vérification en conditions réelles pour confirmer et
    cocher.
57. **(E-bis) Revoir les autres opt-in de `deploy-harness-pi.sh`** (détail L498) — seul
    `CCREMOTE_PI_ORCHESTRATEUR` a été vérifié après réécriture complète de `.env`. **Effort : S**.
58. **(D) Écart de ~4 061 tokens entre `totalTokens` et la somme des postes chargés** (détail L501,
    dupliqué en L565 dans le fichier d'origine — même point, cité deux fois). Le total reste la
    référence en attendant. **Correction : SANS CORRECTIF CONNU sans mesure supplémentaire** — deux
    relevés successifs d'une même session vivante. **Effort : S** pour la mesure.
59. **Confirmer que le refresh token s'écrit dans le bon dossier isolé** (détail L844), à la première
    bascule de compte réelle. **Effort : néant côté code**, observation à faire.
60. **Purger les deux snapshots périmés `credentials_account{1,2}.json`** (détail L846). **Effort : XS**.
61. **App v1 — bouton extinction PC jamais re-testé en réel** (détail L1014) après le fix polkit,
    action irréversible. **Effort : néant côté code**, à faire par Chris.
62. **App v1 — reset des quotas à zéro jamais observé sur un vrai cycle** (détail L1016). **Effort :
    néant côté code**, à observer.

### Groupe I — Repoussé explicitement, à ne pas insérer dans une prochaine vague sans décision de Chris

63. **Interface « table de jeu » (AI Town / AgentVerse ?)** (détail L289) — purement visuel, ne
    contraint rien en amont.
64. **`⚠` doublon/obsolescence probable** (détail L386) — l'entrée « les serveurs MCP n'existent pas
    sur le VPS » est barrée dans le texte d'origine mais la case n'est pas cochée ; son contenu réel
    (porter `codeindex`/`semantic-memory`) est déjà couvert par le point 10 ci-dessus. **Probablement
    une entrée à fusionner/retirer par Chris — laissée intacte dans le détail plus bas.**

*Décompte final : 70 points numérotés ci-dessus, moins 2 qui sont des rappels explicites d'un point
déjà compté ailleurs (37 renvoie à 6, 38 renvoie à 1-2, tous deux marqués « rappel » plutôt que
numérotés comme neufs) = **68 points ouverts distincts**, dont 5 nouveaux (A-E) et 63 préexistants.*

---

## ⚡ Harness d'orchestration — chantier actif

**Contexte complet : `harness/REPRISE.md`.**

### 🆕 18/08 — `trinity-portable` rejoint le parc comme machine de travail

Décidé par Chris : le portable est une machine de travail « quasi autant que le
PC fixe ». Sa racine de projets est `/home/trinity` (les dépôts sont directement
sous le home), et il n'a **pas** de Wake-on-LAN.

Fait dans ce dépôt :

- `CCREMOTE_PC_RACINE_PROJETS` (optionnel) lu par `bin-pc.ts`, passé à
  `assemblerSuperviseurPc`. Défaut inchangé `/mnt/projects` : `trinityarch` et
  `vps-e411b5c7` n'ont **rien à redéployer**. Le Pi demandait déjà la racine à la
  machine (`resoudreRacineProjets`, correctif du 07/08) — c'est le superviseur
  qui la figeait.
- `deploy-superviseur-portable.sh` : même contrôle de fraîcheur que les autres,
  plus un contrôle de configuration AVANT de toucher au service.
- `☠` L'unité systemd versionnée s'installe **telle quelle** sur le portable
  (le dépôt est en `~/ccremote`) : le `sed` obligatoire sur le PC fixe serait
  ici une erreur.

Posé sur la machine : `~/.config/ccremote/pc.env` (600),
`~/.config/systemd/user/ccremote-pc.service`, `loginctl enable-linger`,
`bun install`. Essai à blanc : le process s'arrête bien en `EnvManquantError` sur
le seul champ vide, donc tout le reste du câblage est bon.

**Deux trous, tous deux hors de portée depuis le portable :**

- [ ] **`CCREMOTE_LIEN_SECRET`** à recopier depuis le Pi dans
      `~/.config/ccremote/pc.env`. `☠` Le Pi est injoignable en SSH depuis le
      portable (il est en partage de connexion 4G, `pi.exemple` sans route) —
      seul le tunnel public répond. À faire depuis le PC fixe ou en collant la
      valeur à la main.
- [ ] **Un compte Claude sous `~/.claude-comptes/<id>/`** (`claude login`,
      interactif). Sans lui la machine répond à l'inventaire et explore les
      projets, mais **aucune équipe ne peut y démarrer** — c'est journalisé en
      `error` au démarrage.
      `☠` **L'identifiant doit être distinct de ceux du PC fixe** (ex.
      `portable-a`, pas `compte-a`) : `DepotComptes.enregistrer` fait un upsert
      sur `id` et **écrase `config_dir`**. Un id partagé entre deux machines
      ferait dispatcher le PC fixe sur un chemin du portable — le bug H-44,
      repayé.
      `☠` Et si c'est le **même compte Anthropic** que sur une autre machine, le
      parc croira avoir deux quotas là où il n'y en a qu'un : les jauges 5 h/7 j
      mentiront et une équipe partira sur un compte déjà saturé.

- [ ] Vérifier après coup : `bun harness/pilotage/pilote.ts machines` doit lister
      **trois** machines, et `GET /machines` doit rendre `trinity-portable`.

### 🎯 DEMANDÉ PAR CHRIS LE 08/08 — l'orchestrateur doit pouvoir présenter un fichier

Aujourd'hui l'orchestrateur ne peut RIEN montrer. Il n'a ni `Write` ni `Bash` (et ce n'est pas
une restriction temporaire, c'est sa définition) : pour faire lire un script ou une page à Chris,
il n'a que le corps de son message. Un script de 80 lignes collé dans une bulle de conversation
est illisible sur un téléphone, impossible à enregistrer, et se perd dès que le fil est compacté.

**Ce que Chris demande, mot pour mot :** « dans une session avec l'orchestrateur faut qu'il ait à
dispo un tool pour nous présenter que ce soit un fichier sh, py, lua etc. ainsi que html, et que
nous on puisse l'avoir sous forme d'artéfact, pouvoir download avec un bouton, et lors du clic sur
le composant qu'il s'affiche ; et dans le cas d'un html avoir un bouton toggle entre le code
source et la visualisation. »

- [ ] **Un outil MCP de présentation** — l'orchestrateur remet un contenu nommé et typé. Le nom
      de l'outil et sa forme restent à trancher ; ce qui est acquis, c'est qu'il ne s'agit PAS
      d'écrire sur un disque : c'est un artéfact attaché au fil, pas un fichier de projet.
      `☠` Ne pas lui rendre `Write` par la bande. Un contenu remis à Chris et un fichier écrit
      dans un dépôt sont deux gestes différents ; les confondre rouvrirait la surface d'écriture
      que le harness lui refuse depuis l'origine (acceptation (a), `options-orchestrateur.ts`).
- [ ] **Persistance de l'artéfact.** Le mécanisme des pièces jointes existe déjà dans l'autre sens
      (migration 24, `control-plane/pieces-jointes/`, Chris → orchestrateur) : à examiner en
      premier avant d'en construire un second. `☠` Le contenu doit survivre à une compaction du
      fil — un artéfact qui disparaît avec l'historique ne vaut rien.
- [ ] **Composant d'affichage dans la conversation** — replié par défaut comme les autres valises,
      déplié au clic, avec un bouton de téléchargement. Réutiliser `HValise` plutôt qu'un
      troisième vocabulaire, et le vocabulaire de coloration syntaxique déjà présent (`hMarkdown`,
      `.codeblock`).
- [ ] **Cas du HTML : bascule code source / rendu.** `☠` Le rendu d'un HTML produit par un modèle
      est du contenu non fiable exécuté dans la page qui porte la session de Chris — `iframe`
      `sandbox` sans `allow-same-origin`, jamais une injection directe dans le DOM de
      l'application. Le point mérite d'être tranché avant d'écrire la première ligne : c'est la
      seule partie de cette demande qui porte un risque réel.
- [ ] **Annoncer l'outil dans le mandat** le jour où il est livré — un outil non annoncé n'existe
      pas pour le modèle (quatre occurrences, un test le vérifie désormais).

### 06/08 — quatre outils machine ajoutés (`c1f6e8f`, `ac7ffa1`) — voir `STATE.md`

- [ ] **Poser la règle sudoers sur le Pi** pour que `piloter_service` fonctionne réellement — geste
      opérateur, jamais automatisé par ce harness (établi factuellement par grep au dépôt de la
      mission `ac7ffa1` : aucune règle sudoers pour `pi` n'existe). Sans elle, l'outil échoue
      systématiquement en `refuse` explicite (motif `permission`), jamais en erreur brute. À poser
      sur le Pi, en root, **une ligne par unité du seau 3, jamais un glob** :
      ```
      # /etc/sudoers.d/ccremote-piloter-service
      pi ALL=(root) NOPASSWD: /usr/bin/systemctl restart portfolio.service
      pi ALL=(root) NOPASSWD: /usr/bin/systemctl restart nullnode-relay.service
      ```
      `⚠` Chemin `/usr/bin/systemctl` à confirmer sur le Pi (`which systemctl`) avant écriture — pas
      vérifié en direct pour ce mandat, purement documentaire.
- [ ] **Revalidation de la liste blanche des services (`outils-service.ts`) contre l'état réel du
      Pi.** Vient d'un inventaire du 17/07, complété le 01/08 — **jamais revérifiée en direct**.
      `stockiop-api` a par exemple migré vers le VPS depuis et n'apparaît déjà plus dans la liste
      actuelle ; d'autres unités des trois seaux ont pu être renommées, désactivées ou supprimées
      sans que ce module ait aucun moyen de le savoir (il produit un `refuse` propre sur une unité
      absente, mais ne peut pas détecter une unité qui existe encore sous un autre nom). À faire :
      un passage sur le Pi (`systemctl list-units`) comparé aux trois seaux, un par un.
- [ ] **Dette — `serveur.ts` fait 781 lignes**, au-dessus de la limite de 500 lignes du standard du
      projet (710 lignes avant les missions `c1f6e8f`/`ac7ffa1` — dette préexistante, aggravée mais
      pas créée par elles). Candidat à un refactor dédié : scinder ce fichier touche au câblage de
      **tous** les outils de contrôle de l'orchestrateur (inspection, mandat, rappels, fil, machine,
      service…), pas seulement les quatre outils récents — mérite son propre mandat plutôt qu'un
      correctif de passage.

### ✅ FAIT LE 03/08 — le test est passé, et huit défauts sont fermés

- [x] **Le test des sous-agents en arrière-plan est VERT**, deux fois, sur `bac-a-sable`. Quatre
      mesures conformes : tous les mots cités, UNE notification à la vraie fin, jamais « au repos »
      pendant l'attente, coût sous plafond. Détail chiffré dans `STATE.md`.
- [x] **Cause de l'échec du matin trouvée : le process du VPS tournait le code du 1er août.**
      `enable --now` ne redémarre pas un service actif. Le déploiement fait maintenant un `restart`
      et VÉRIFIE que le process est postérieur aux sources — il échoue sinon.
- [x] **Les sous-agents étaient invisibles sur le VPS depuis le 01/08** (clé de projet calculée sur
      le chemin du mandat, le CLI écrit sous le realpath — `/mnt/projects` est un lien vers `~/dev`).
- [x] `creer_equipe` accepte `budgetMaxUsd` · `retirer_mandat` (23ᵉ outil) · `arreter_equipe` ne
      requalifie plus une équipe terminée en `annulee` · `rechercher_projets` a un repli `grep` et
      un drapeau d'échec · `lister_projets` dit quel registre est vide · `etat_equipe` compte les
      sous-agents.

- [x] **Outillage de la machine de travail garanti par le déploiement** — `rg` manquait sur le VPS
      et c'est ce qui rendait `rechercher_projets` muet (« Executable not found in $PATH », 01/08 et
      02/08 : deux recherches rendues vides sur des dépôts qui contenaient la réponse). ripgrep,
      tree, jq et unzip sont installés et vérifiés à chaque déploiement. Éprouvé en production :
      2352 occurrences sur stockiop, et un motif impossible rend « aucune occurrence (recherche
      réellement effectuée, moteur rg) » — l'ambiguïté est levée. Ni `node` ni `npm` : la doctrine
      reste Bun.
- [x] **Le PC avait le même défaut que le VPS, en pire : aucun script de déploiement.**
      `deploy-superviseur-pc.sh` créé, avec le même contrôle de fraîcheur. Les trois machines sont
      couvertes.
- [x] **Modèle des sous-agents : héritage voulu, pas subi.** Sur les 45 sous-agents lancés depuis le
      1er août, ceux des vraies missions sont en `sonnet` ou `opus` — le modèle de leur lead — et
      les seuls `haiku` sont ceux des deux tests d'attente, où le lead l'a choisi pour une tâche
      mécanique. C'est l'arbitrage correct, et il appartient au lead : lui seul connaît la
      granularité de ses sous-tâches. Rien à corriger.
- [x] **`logs/` ajouté au `.gitignore` du bac à sable** — il déclenchait l'avertissement « fichiers
      non commités » à chaque fin d'équipe sur ce projet.

- [x] **Les deux contraintes d'attente sont dans le system prompt de toute équipe** — `sleep` nu
      refusé, coupure Bash à 120 s, boucle `until` et paramètre `timeout`. Posées dans `BLOC_OUTILS`
      (`composerMandatSysteme`), donc elles survivent à la compaction du lead.
      `☠` Écrites d'abord dans `CLAUSES_FIXES` : le test d'assemblage les a refusées, et il avait
      raison — ces clauses composent la CARTE D'AUTORISATION que Chris lit, pas le prompt du worker.
      Le défaut du 01/08 à l'identique, rattrapé avant déploiement.
      **Vérifié en production sur un mandat MUET** (ni `sleep`, ni `until`, ni `timeout` : 0
      occurrence dans le texte envoyé) : le lead a produit la bonne forme et l'a recopiée dans le
      brief de ses deux sous-agents, qui l'ont appliquée du premier coup. Attente de 150 s — au-delà
      de la coupure — passée en **un seul appel Bash, sans relance ni exit 143**. Les deux mots
      cités, une notification à la vraie fin, 0,45 $ sur 3 $. À comparer au test du matin : trois
      sous-agents sur cinq dévoyés, deux relances.

- [x] **Le sous-agent non prévenu s'en sort seul — point fermé sur deux mesures.** Un mandat
      interdisant au lead de souffler quoi que ce soit : (1) serveur HTTP à démarrer et vérifier —
      le sous-agent produit `nohup`, `curl`, `pgrep`, aucun blocage ; (2) script de 150 s lancé au
      premier plan sans aucune précaution — passé en 157 s, sans coupure ni relance.
      `☠` **Au passage, ma première conclusion était fausse et l'orchestrateur l'a refusée** : le
      `sleep 1` qui passait cumulait deux propriétés (court ET accompagné). Quatre mesures isolent
      la variable — `sleep 1` seul PASSE · `sleep 35` seul BLOQUÉ · `echo; sleep 35; echo` PASSE ·
      `echo; sleep 170; echo` PASSE. Et le plafond de 120 s n'est **pas systématique** : il a coupé
      le matin, pas l'après-midi. Le prompt dit désormais ce qui a été mesuré, au mot près.
- [x] **Piège ajouté au prompt du lead, plus courant que le cas `sleep`** : après `nohup cmd &`,
      `$!` désigne souvent le wrapper bash et non le process. Mesuré sur un transcript — le `kill`
      a réussi, le serveur répondait toujours. Relevé par l'orchestrateur en relisant le fil.

### 🎯 À LA REPRISE

- [ ] Rien d'ouvert sur le harness. Prochain chantier au choix de Chris.

### ✅ LIVRÉ ET DÉPLOYÉ LE 02/08 (soir) — l'`init` qui tuait les équipes en plein travail

- [x] **Un `init` de reprise de tour effaçait les tâches de fond d'une équipe.** Le collecteur le
      prenait pour un (re)démarrage de process CLI et vidait la liste ; le SDK en émet un à CHAQUE
      reprise, notamment après la notification d'un sous-agent terminé. Mission `ab7183f0`, 7,72 $ :
      quatre agents lancés, garde tenue au premier `result` (16:34:14), notification à 16:37:48,
      `init` de reprise, `result` de 16:37:51 pris pour une fin de mission — et à 16:37:53 les trois
      derniers sous-agents rendaient leur travail dans une session close. Deux équipes sur six
      touchées ce jour-là (l'orchestrateur en annonçait trois : décompte faux, comme son diagnostic).
      La remise à zéro est désormais DITE par le superviseur (`ouvrir`, `reinitialiserTachesFond`
      appelé par `relancer`), jamais déduite du flux.
- [x] **`etatSdk` dérivé au lieu d'être posé** — « tour rendu » n'est plus « au repos ». Éteint
      d'un coup trois symptômes qu'on croyait distincts : notification de fin envoyée à
      l'orchestrateur pendant que l'équipe travaillait, affichage « au repos » dans le Parc, et
      clôture automatique à 15 min qui fermait le projet en plein travail.
- [x] **Borne de patience de 20 min sur les tâches de fond** — sans elle, un `bun run dev` détaché
      rendait une équipe immortelle et verrouillait son projet à vie : la panne inversée.
- [x] **Banc réel `acceptation/taches-fond-sousagents-reel.ts`** — fait tourner le VRAI collecteur
      sur un VRAI flux en maintenant en parallèle la réplique de la règle d'avant : le même run
      montre les deux verdicts côte à côte. Dernier passage : deux `result` où l'ancienne règle
      tuait l'équipe, gardée par la nouvelle.
- [x] **Clause d'interdiction retirée des mandats de l'orchestrateur.** Il avait conclu que le
      piège était la délégation en arrière-plan et l'interdisait depuis trois mandats. Le mécanisme
      n'était pas fautif — interdire aurait coûté le parallélisme réel sur les missions de recherche.
      Il garde l'interdiction de l'attente passive, ce qui est le bon arbitrage.
- [x] **Bac à sable créé sur le VPS** (`/mnt/projects/bac-a-sable`, dépôt git, arbre propre) : il
      n'existait aucun projet jetable, et le harness refuse d'ancrer une équipe sur un chemin
      inexistant — l'orchestrateur avait dû se rabattre sur stockiop en lecture seule.

### ✅ LIVRÉ ET DÉPLOYÉ LE 02/08 — les six défauts d'outillage relevés par l'orchestrateur

L'orchestrateur a dressé lui-même la liste après une session où il n'a pas pu piloter ses équipes.
Chacun est corrigé, chacun a son test, et chaque test a été validé DANS LES DEUX SENS (rouge sans le
correctif, vert avec). **Déployé le 02/08 au soir**, Pi et les deux machines de travail.

- [x] **`envoyer_a_equipe` refusait TOUTES les équipes, vivantes comprises.** Le serveur MCP
      consommait `RepertoireCibles` (un `SDKUserMessage`, un `query.interrupt()`) — inatteignable
      depuis le Pi, donc satisfait par `CIBLES_NON_CABLEES` qui rendait `null` en permanence, et
      l'outil traduisait ce `null` en « équipe introuvable ou plus vivante ». Preuve : six warns
      « RepertoireCibles non câblé » dans `journalctl` du Pi. Nouveau port `EmetteurEquipe` branché
      sur `pilotage.envoyerInstruction` — le chemin qui sert l'interface depuis le 01/08. Nouvelle
      opération de canal `interrompre_worker` (couper un tour sans mettre en pause). Les deux outils
      acceptent désormais une désignation libre (id, nom, projet), comme `suivre_equipe`.
      `☠` Leçon : un refus honnête ne suffit pas, il doit NOMMER la bonne cause — celui-là a fait
      conclure à l'orchestrateur que ses équipes étaient mortes, et relancer des sessions vivantes.
- [x] **Un fil ouvert avec une seule machine en ligne devenait irroutable à l'allumage de la
      seconde.** L'UI ne posait pas la question (à raison) mais renvoyait `''` : `conversation.machine`
      restait `NULL`, le routage tranchait « sans ambiguïté »… jusqu'à ce que le PC démarre. Mesuré
      sur `af847b10` : deux dispatchs auto perdus à 09:31 et 09:33. Trois verrous — l'UI renvoie
      l'id de l'unique machine ; `pourConversation` ADOPTE et persiste le choix implicite dès la
      première opération ; `POST /conversations/:id/machine` rattache un fil existant (refusé tant
      que le fil porte une équipe vivante, l'arbitrage du 01/08 tient là et nulle part ailleurs).
- [x] **`creer_equipe` annonçait un démarrage qui n'avait pas eu lieu.** Le dispatch partait en
      `void` et l'outil répondait `applique` sur la seule foi de l'auto-approbation. Les deux échecs
      de routage du 02/08 ne sont donc JAMAIS remontés au modèle, qui a construit tout son tour sur
      une équipe inexistante. `EnregistreurProposition` est asynchrone, l'attente est bornée à 20 s :
      `applique` (avec l'id de mission réel) · `accepte` (« en vol, vérifie avec lister_equipes »)
      · `refuse` (avec la raison telle que le dispatch l'a donnée).
- [x] **`definir_budget` était inopérant.** `budgetMaxUsd` était écrit, affiché… et comparé à rien :
      le seul plafond réel était celui posé au SDK au démarrage, figé pour la vie de la session. Le
      plafond du harness est désormais évalué à chaque relevé de télémétrie et COUPE l'équipe au
      dépassement. La distinction est dite au modèle : baisser est pleinement effectif, monter ne
      repousse pas la coupure du SDK.
- [x] **`relancer_equipe` acceptait sans effet sur une équipe `idle`.** `relancer()` ignorait
      silencieusement un worker vivant. Le verdict `dejaVivant` remonte jusqu'au modèle, et le refus
      l'oriente vers `envoyer_a_equipe`.
- [x] **`arreter_equipe` ne disait jamais quand le projet redevenait libre.** Toujours « libération
      en cours », même après confirmation de la machine : l'orchestrateur attendait ou redispatchait
      en aveugle (H-56). Désormais `applique` quand la machine a confirmé, `accepte` sinon.
- [x] **Une équipe pouvait rendre la main sans avoir commité, et passait pour terminée.**
      Nouveau relevé `etat_git` côté machine (branche, fichiers non commités, dernier commit),
      opération de canal dédiée, migration 23, affichage dans `etat_equipe`, dans le Parc et dans la
      notification de fin. `☠` Trois valeurs distinctes, jamais deux : non commité · propre ·
      **jamais relevé** — replier la troisième sur la deuxième serait le défaut d'origine.
- [x] **La notification de fin d'équipe citait `envoyer_message_equipe`, un outil qui n'existe pas.**
      Le vrai nom est `envoyer_a_equipe` : à chaque fin d'équipe, le harness donnait à l'orchestrateur
      une consigne inapplicable.
- [x] **`ports-non-cables.ts` a disparu** — ses deux ports fantômes sont câblés.

### ✅ DÉFAUT DE SÛRETÉ — trouvé ET fermé le 01/08 au soir

- [x] **La PAUSE GLOBALE était une maquette, elle est SUPPRIMÉE** (décision de Chris, 01/08).
      `pauseGlobal()` marquait un champ sur la base de démonstration et rendait `{ paused: true }` ;
      aucune route serveur n'a jamais existé. Le bouton s'allumait, la modale décrivait ce que la
      pause faisait et ne faisait pas, et les workers continuaient. **Un contrôle de sûreté qui
      ment est pire que son absence** : on croit le parc arrêté, donc on ne fait pas le geste qui
      l'arrêterait vraiment. Supprimée plutôt que grisée — grisée, elle aurait gardé sa promesse à
      l'écran. Reste l'arrêt d'urgence, réel, désormais seul et en pleine largeur. La pause par
      MISSION, elle, a toujours été réelle et ne bouge pas.

### ✅ LIVRÉ LE 01/08 — session « coût & outillage des équipes »

- [x] **Aucune équipe n'avait UN SEUL serveur MCP** — depuis l'origine du harness.
      `mcpServers: []` dans le config dir de chaque compte, alors que le mandat leur ordonnait
      d'utiliser Playwright pour valider. 11ᵉ « écrit, testé, branché sur rien », la plus longue.
      Corrigé + banc réel : l'équipe appelle `mcp__codeindex__…`, le témoin répond « aucun
      serveur monté ici ». `☠` Piège de mesure payé : la 1ʳᵉ version du banc a déclaré ROUGE une
      correction qui marchait — à l'init les serveurs sont tous `pending`, leurs outils NE PEUVENT
      PAS être dans `capabilities.tools`.
- [x] **Dimensionnement des modèles** — le prompt INTERDISAIT à l'orchestrateur d'arbitrer
      (« laisse `modele` vide », « ne choisis JAMAIS un modèle inférieur »). Il obéissait, et l'a
      confirmé mot pour mot au banc. Le lead ignorait que `AgentInput.model` omis fait HÉRITER du
      parent : un lead Opus lançait trois sous-agents Opus. Mesures : 6,40 $/équipe Opus contre
      0,67 $/équipe Sonnet, lumen = 52,93 $ en six vagues.
- [x] **Résultats des appels d'outils** (migration 21) + **timeline** à la Claude Code
      (une étape = une ligne de 32 px, « Terminé » à la reprise de parole).
      `☠` H-45 était mal invoquée : elle protège le CONTEXTE de l'orchestrateur des sous-agents,
      pas l'affichage de ses propres appels.
- [x] **Valise qui ne se repliait pas** — `.h-case-body[hidden]` et `.h-case-wrap > .h-case-body`
      à spécificité ÉGALE (0,2,0), seul l'ordre tranchait. Même famille que le bouton d'envoi.
- [x] **Config des comptes symétrique et vérifiable** — `reference/` manquait sur les DEUX comptes,
      `settings.json` (donc les hooks) sur compte-b seulement : une équipe n'avait pas les mêmes
      capacités selon le compte tiré par la rotation. Script idempotent + contrôle au pré-vol.
- [x] **`CLAUDE-equipe.md`** — le lead chargeait le CLAUDE.md du poste, qui s'adresse à un agent
      conversant avec Chris. Dérivé : standards et réflexes gardés, relation retirée.
- [x] **Banc de pilotage** (`harness/pilotage/`) — conduire la prod depuis une session de code,
      par les MÊMES routes que l'interface. C'est lui qui a permis toutes les mesures ci-dessus.
- [x] **`suivre_equipes`** (22ᵉ outil) + **planification préalable** au prompt.

### 🎯 À LA REPRISE — priorités données par Chris le 01/08 au soir

1. **Ton test bout en bout** (ci-dessous) — c'est le seul qui manque, et il n'appartient qu'à toi.
   Fil NEUF obligatoire : le prompt système a changé, une conversation reprise ne le charge pas.
2. **L'anti-boucle sur le coût live** — `verifierEtJuger` ne se déclenche que sur `SDKResultMessage`.
   Une équipe qui travaille 15 min sur une instruction n'est pas inspectée PENDANT. Le coût est
   pourtant relevé en continu. Chemin de contrôle ⇒ mesurer sur une vraie équipe longue d'abord.
3. **Arbitrage attendu** : créer/supprimer un projet depuis l'orchestrateur. Proposition —
   création libre, suppression réservée à un clic humain, jamais auto-approuvable (mode de panne
   du `rm -rf sessions/*` d'agora, irrécupérable).

### 🎯 À LA REPRISE (01/08)

- [ ] **Inspection à la demande sur une équipe VIVANTE** — livrée et déployée le 01/08, mais le
      seul chemin jamais exercé est celui d'une équipe close (verdict « incertain, rien à
      inspecter »). Restent à voir en vrai : un verdict rendu sur de vrais tours, le bandeau rouge
      du Parc, et la boîte confirmer / décliner sur une `boucle`.
- [ ] **L'anti-boucle n'inspecte toujours QUE sur `result`.** Le coût est désormais relevé en
      continu (mesuré : 1,02 → 1,82 $ pendant un tour `running`), mais `verifierEtJuger` reste
      déclenché par un `SDKResultMessage`. Une équipe qui travaille 15 min sur une seule
      instruction n'est donc pas inspectée PENDANT ce temps — seulement à la fin, en rattrapant
      d'un coup tous les paliers franchis. Le brancher sur le coût live est un changement de
      chemin de contrôle : à faire sur mesure réelle, jamais sur déduction.
- [ ] **Test bout en bout par Chris** — nouvelle conversation orchestrateur (PAS un resume : le
      prompt système a changé six fois le 01/08, seule une session neuve le charge). Scénario :
      brainstorm → mandat autorisé → `suivre_equipe` pendant le travail → fin d'équipe → il réagit
      seul → 2ᵉ mandat qui part SANS clic. Protocole détaillé dans la conversation du 01/08.
      **Le piège à guetter** : s'il annonce « en attente de ton autorisation » alors que l'équipe
      tourne, prompt et harness ont divergé — c'est un bug, pas un malentendu.
- [ ] **Créer / supprimer un projet depuis l'orchestrateur** — demandé le 01/08, NON fait, et
      volontairement. La création ne pose pas de problème. La SUPPRESSION en autonomie, la nuit,
      sans clic, est exactement le mode de panne de `rm -rf sessions/*` (agora, 29/07,
      irrécupérable). Proposition à trancher avec Chris : création libre, suppression réservée à
      un clic humain explicite, jamais auto-approuvable.
- [ ] **Élévation hors périmètre projets** — sans objet tant que la ligne ci-dessus n'est pas
      tranchée.
- [ ] **Interface « table de jeu »** (AI Town / AgentVerse ?) — repoussé explicitement. Purement
      visuel, branché sur le vrai back, ne contraint rien en amont.
### ✅ Fausse saturation de compte — corrigée le 01/08

Chris demande « où en est StockIOP ? », obtient une bonne réponse, et voit
« **Compte saturé — bascule sur le compte de repli. Renvoie ton message.** »
avec un compte à **35 %** de sa fenêtre de 5 h. Le compte maître a réellement
tourné, la session a été fermée.

`☠` Cause, relue en base (conversation `aa66c851`, bloc de 2003 caractères) :
l'orchestrateur décrivait StockIOP — « *Production readiness bouclée (**rate
limiting**, security headers, structlog…)* ». Le détecteur de saturation lit le
texte que le modèle produit LUI-MÊME comme un signal de contrôle. Sur un projet
dont le sujet est justement les quotas d'API, il se déclenche tout seul.

- [x] **`/rate limit/i` retiré** — motif SPÉCULATIF, jamais vu dans une annonce
      réelle du CLI, et la tournure la plus banale du métier. C'est exactement ce
      que l'en-tête de `shared/saturation-compte.ts` interdisait déjà.
- [x] **Portée bornée** — une annonce du CLI est un bloc COURT et autonome (les
      deux vraies faisaient 102 caractères, message entier). Au-delà de 400, on
      est dans de la prose QUI PARLE de limites. Un bloc persisté est un bloc
      complet : le streaming n'écrit qu'à `content_block_stop`.
- [x] **Signature machine** `cc_cli_limit_message` — relevée sur les deux vraies
      saturations (23/07, 27/07). Émise par le CLI, jamais écrite par un modèle :
      elle court-circuite toutes les autres règles, quelle que soit la longueur.
- [x] Reproduit en production APRÈS correctif, même tournure, réponse plus
      longue encore : zéro saturation.

`☠` Asymétrie des coûts, qui fixe le sens du filtre : une détection manquée coûte
un message à renvoyer, avec l'annonce du CLI sous les yeux. Un faux positif TUE la
session, fait tourner le compte maître et fait réécrire l'opérateur.

### ✅ DEUX machines de travail simultanées (PC + VPS) — LIVRÉ le 01/08

Demandé par Chris le 01/08 : faire cohabiter le PC et le VPS pour départager les
tâches (StockIOP sur le VPS, le reste sur le PC), avec choix de la machine à la
création d'une conversation. Contexte et méthode : `harness/CHANTIER-MULTI-MACHINES.md`.

**En production.** Le PC et le VPS travaillent désormais EN
MÊME TEMPS. Preuve mesurée sur le registre du Pi, pas déduite :
`2272d6f2` (trinityarch · vitrail) et `41e06128` (vps-e411b5c7 · stockiop) ont
**3 s d'exécution en parallèle**, de 13:09:15 à 13:09:18, chacune sur son dépôt.

Décisions arbitrées, tenues : la conversation choisit la machine, le projet
vérifie · machine fixée à la création, non modifiable · H-56 reste global.

- [x] **Identité de machine sur le lien** — en-tête `x-ccremote-machine`, jamais dans l'URL (même
      raison que le secret : les access logs de Cloudflare). Identité absente ou malformée ⇒ **4403
      terminal**, jamais un nom de repli — un repli partagé ramènerait la tempête sans qu'on la voie.
      `☠` Ordre de déploiement : les MACHINES d'abord, le Pi ensuite. L'inverse refuse tous les
      clients anciens jusqu'à leur mise à jour.
- [x] **Un lien et un `ClientSuperviseurPc` par machine** (`parc-liens-machines.ts`,
      `parc-superviseurs.ts`). Trois familles de routage, à ne pas confondre : par MISSION (arrêt,
      relance, instruction, inspection) · par CONVERSATION (exploration, lecture, dispatch) ·
      GLOBAL agrégé (télémétrie, jetons).
- [x] **Réconciliation PAR MACHINE, avec périmètre** (`DependancesReconciliation.concerne`).
      `☠` LE garde-fou du chantier : l'inventaire d'une machine ne rapporte QUE ses workers. Sans
      périmètre, l'équipe du VPS est « absente du PC » — donc marquée fantôme et terminée — au
      premier rattachement du PC, en plein travail, sans un mot. Test validé dans les deux sens.
- [x] **Migration 22** — `conversation.machine`, `mission.machine`. Écrite AU DISPATCH, jamais
      déduite après coup. Aucun rattrapage rétroactif : zéro mission active mesurée au moment de
      migrer (36 missions, toutes terminales).
- [x] **Refus au dispatch d'un projet absent de la machine visée**, AVANT la première écriture.
      Vérifié en réel : `/mnt/projects/lumen` depuis un fil VPS ⇒ 409 avec la raison, **aucune
      mission créée**, projet libre.
      `☠` Le critère n'est PAS « aucune note » : `explorerProjets` en pose une aussi sur une
      TRONCATURE, donc un gros dépôt aurait été déclaré absent.
- [x] **Sélecteur de machine à la création d'un fil** — dialogue à la charte, machines hors ligne
      listées mais non sélectionnables, aucune question posée quand il n'y a rien à trancher.
      Machine affichée sur la carte du Parc et en infobulle de la pastille de fil.
- [x] **H-44 rendue effective** — `☠` défaut trouvé PAR le banc, pas par lecture. Le Pi ne tient
      qu'UNE liste de comptes (`CCREMOTE_PI_COMPTES`, les chemins du PC) : routé vers le VPS, un
      mandat portait `/home/trinity/.claude-comptes/compte-a`, inexistant là-bas. Le VPS était
      **structurellement incapable de lancer une équipe**. Seule l'IDENTITÉ du compte traverse
      désormais ; la machine réécrit le chemin avec le sien.
- [x] **Trois refus métier remontaient en 500 « erreur interne »** — projet absent, machine hors
      ligne. Le mécanisme du refus marchait, sa TRANSMISSION n'existait pas : le message actionnable
      restait dans le journal du Pi. Troisième fois sur cette même frontière (après H-56 le 23/07).
- [x] **Bug du banc de pilotage** — `autoriser` tapait `/orchestrator/mandates/`, la route est
      `/orchestrator/propositions/`. Jamais exercée depuis sa création, donc jamais démentie.

### ⚡ CHANTIER VPS — le verrou technique est levé (01/08)

- [x] **Le lien traverse Cloudflare Tunnel** — `lien.exemple.com` → `localhost:8721`.
      Première traversée hors LAN de toute la vie du projet. Mesuré depuis le VPS : refus 4401
      côté Pi sur mauvais secret, PC légitime resté connecté. L'ingress est dans
      `deploy-harness-pi.sh`, donc reproductible.
      `☠` Router un hostname exige `TUNNEL_ORIGIN_CERT=~/.cloudflared/cert.pem.old-account` :
      le tunnel actif (`388bc072`, « portfolio ») appartient à l'ANCIEN compte Cloudflare.
- [x] **Bun 1.3.14 + Claude Code 2.1.220** installés sur le VPS (`unzip` était absent, ajouté).
      Version identique à celle qu'épingle le SDK — à ne pas laisser diverger.
- [x] **Login Claude sur le VPS** — fait par Chris le 01/08 (`compte-a`). `compte-b` reste non
      authentifié là-bas : **aucune rotation possible sur le VPS**, une saturation y est terminale.
- [x] **Serveurs MCP portés sur le VPS** (`deploy-mcp-vps.sh`) — playwright, log-watcher, pty.
      `☠` `mcp==1.27.1` ÉPINGLÉ : pip avait pris la 2.0.0, dont l'API a changé — les trois serveurs
      plantaient au démarrage et le worker rapportait « outil introuvable », pas « serveur mort ».
      Manquent volontairement : `semantic-memory` (5,3 Go, à trancher), `codeindex` (CUDA).
- [ ] ~~**Les serveurs MCP n'existent pas sur le VPS.**~~ `resoudreMcpEquipe()` lit la config du
      poste : sur le VPS elle sera vide, et les équipes y repartiraient SANS outils — le défaut
      corrigé aujourd'hui, revenu par la porte du portage. Le pré-vol le signalera (warn), mais
      il faut porter playwright / codeindex / semantic-memory / log-watcher / pty-mcp.
- [x] **Racine des projets du VPS** — `/mnt/projects` est un LIEN vers `~/dev` (clones git de
      travail), à côté de `~/prod` qui sert le trafic réel. `stockiop` cloné. Reste à décider quels
      autres projets y cloner.
- [x] ~~`⚠` **Ne JAMAIS laisser deux superviseurs connectés en même temps**~~ — **levé le 01/08**,
      c'était l'objet du chantier. Le garde-fou de `deploy-superviseur-vps.sh --demarrer` est retiré.
      `☠` Ce qui RESTE vrai : deux process sur la MÊME machine s'évincent toujours (voulu). On ne
      lance pas deux fois `ccremote-pc` sur un même hôte.
- [ ] **Résumé de séquence en tête de timeline** (« Fichier créé, lu un fichier ») — vu sur la
      capture de Chris, pas encore fait. Les étapes et le « Terminé » le sont.
- [ ] **Fluidité des pages Mission / Agent** — la timeline ne couvre que la vue Orchestrateur.
- [ ] **Aligner Bun** : 1.3.13 sur le PC contre 1.3.14 sur le VPS. Sans conséquence connue, mais
      deux runtimes qui divergent finissent par produire un bug qui n'existe que d'un côté.
- [ ] **`semantic-memory` et `codeindex` absents du VPS** — `semantic-memory` est désormais résolu
      par le harness (point d'accès distant en lecture), donc réglé. `codeindex` reste absent :
      CUDA, pas de GPU sur le VPS. Faisable en CPU, chantier à part.
- [ ] **Aucune surveillance du service de mémoire** — s'il tombe, les équipes perdent l'outil sans
      qu'aucune jauge ne le dise.

### ✅ LIVRÉ LE 01/08 — session du soir

- [x] **Clic droit dans toute l'app** — menu contextuel délégué, appui long sur mobile, dialogues
      à la charte. Six genres : fil, conversation, mission, notification, session, message. Le
      menu natif reste intact partout où aucune cible n'est reconnue.
- [x] **Rechargement silencieux** (`hPatcher`) — le Parc réécrivait tout son corps dès qu'un « il
      y a 4 min » bougeait, rejouant 26 animations toutes les 4 s. Mesuré : 26 cartes sur 26
      survivent maintenant à 3-4 cycles.
- [x] **Recherche web de l'orchestrateur** — le mandat annonçait `WebSearch`/`WebFetch`, absents
      de l'allowlist `tools`. Capacité promise, jamais branchée. Test qui relit le prompt et exige
      que chaque outil nommé existe. Validé par Chris.
- [x] **Nommage automatique des fils** (migration 19) — au 2ᵉ message, verrouillé pour la session,
      renommable à la main ou sur demande explicite dans la conversation. Validé bout en bout.
- [x] **Plafond d'équipe 12 → 250 $, DÉRIVÉ de l'échelle anti-boucle.** Le plafond valait la
      valeur du premier palier : l'équipe mourait à l'instant précis où le juge devait la
      regarder, et les huit paliers suivants étaient inatteignables.
- [x] **Coût relevé en cours de tour** — il ne se lisait que sur `result` (fin de tour) : une
      équipe de 15 min affichait 0,00 $ tout du long. Validé par Chris (0,66 $ en direct).
- [x] **Inspection à la demande** (migration 20) — le bouton tapait dans la maquette et tirait son
      verdict avec `Math.random()`. Chemin réel de bout en bout + arbitrage confirmer / décliner.
- [x] **Page sous-agent blanche** — `hFeedItemTemplate` disparu à la refonte ; passe par
      `hCorpsFil`, le rendu du lead.
- [x] **Mandat déjà tranché → 409** au lieu de 500 « échec interne », carte qui se retire ses
      boutons quand la décision n'existe plus.
- [x] Bouton d'envoi invisible (spécificité CSS), bouton « Nouvelle conversation » retiré.
- [x] **Formulaire de mandat manuel SUPPRIMÉ** (`59d3a89`) — `proposeMandate` / `approveProposal` /
      `rejectProposal` écrivaient dans la base de démonstration, aucune route serveur n'a jamais
      existé. Le bouton d'entrée est parti avec : un bouton qui n'ouvre plus rien est le même
      mensonge sous une autre forme. `☠` Ne pas confondre avec `approveMandat` / `rejectMandat`,
      qui sont RÉELS et servent aux cartes du fil — noms voisins, chemins opposés.
- [x] **`compactOrchestratorContext` supprimée** — maquette. La compaction réelle par fil
      (`compactConversation`) existe et fonctionne. Les `simulate*` restent, ils sont volontaires.

### ✅ LIVRÉ LE 01/08

- [x] **Audit des prompts côté équipe** — `mandate` ne portait que l'objectif alors qu'il devient
      le `systemPrompt` (seul survivant de la compaction du lead) ; les CLAUSES_FIXES (H-52, H-66)
      ne partaient qu'à l'affichage de la carte, jamais au worker. Corrigé, 25 tests neufs sur une
      surface qui n'en avait aucun.

- [x] Canal asynchrone : fin d'équipe → notification → orchestrateur (migration 14)
- [x] Page Notifications + badge temps réel, clic → fil d'origine
- [x] Autonomie de fil : 1er mandat autorisé, suivants automatiques (migration 15)
- [x] Fenêtre d'autonomie datée (début / fin / objectif) + interface
- [x] `suivre_equipe` — 10 lignes par défaut, 200 max
- [x] `mon_autonomie` — il sait ce qu'il a le droit de lancer et jusqu'à quand
- [x] `carburant_parc` — quotas + conseil actionnable, plus d'autonomie aveugle
- [x] `rechercher_projets` — cadrage sur un projet inconnu (chemin OBLIGATOIRE)
- [x] Prompt système : autonomie, surveillance, carburant, recherche web, cadrage


## ⚡ Harness d'orchestration — chantier actif

**Contexte complet : `harness/REPRISE.md`, section « SESSION DU 31/07 » en FIN de fichier.**

### 🎯 EN COURS — priorités à la reprise (31/07)

- [x] ~~**Observer la croissance de l'epoch 1 → 2.**~~ Établi le 31/07 sans attendre un dispatch,
      en vérifiant la SOURCE plutôt que l'effet : un seul chemin crée les missions
      (`dispatch-mandat.ts:211`), `epoch=1` est écrit en base, `MAX(epoch)` sur la prod rend 1 pour
      agora — le prochain dispatch calculera 2. Au passage, `707931c` a fermé la version longue
      durée du même défaut : le maximum se lisait sur `listerRecentes()` (fenêtre de 200, tous
      projets), donc l'epoch d'un projet peu actif serait REDESCENDU passé 200 missions au total,
      rouvrant la collision M-11. Requête dédiée non bornée, test validé dans les deux sens.
- [x] ~~**Surveiller la sonde de quotas.**~~ Clos le 31/07 : relevé prod à 09:19 → compte-a observé
      à 09:19:26, compte-b à 09:18:26, **60 s d'écart exact**. La rotation tourne à la période
      nominale, le 429 chronique est résorbé, pas de backoff nécessaire.
- [x] ~~**Dette : `deniedToolPatterns: []` au dispatch**~~ — corrigé le 31/07 (`ef2524f`). Le plancher
      de déni est désormais INCONDITIONNEL, et l'accès du mandat (`lecture` | `ecriture`) refuse
      réellement Write/Edit/NotebookEdit/Bash à une équipe de lecture. `perimetre` reste descriptif.
- [x] ~~**Bus d'escalade**~~ — RETIRÉ le 31/07 (`df0e351`), décision de Chris. Il était câblé de bout
      en bout et n'a jamais rien porté : `canUseTool` n'est jamais appelé en `permissionMode: 'auto'`.
      Surface MCP 13 → 11 outils, routes `/escalades` et vue UI supprimées.
- [x] ~~**31 tests rouges permanents**~~ — corrigés le 31/07 (`0383baa`). Ils dépendaient du
      scratchpad d'une session Claude Code disparue. Suite complète : **1037 pass, 0 fail**.
- [x] ~~**Autonomie totale : plus aucune autorisation manuelle**~~ — livré le 31/07 (`b60b371`).
      Workers en `bypassPermissions` + `AskUserQuestion` refusé à toute équipe. MESURÉ sur un
      worker réel (`acceptation/bypass-denis-reel.ts`) : Write/Edit/NotebookEdit retirés de la
      liste d'outils, Read/Bash conservés, règle scopée du plancher toujours refusée.
      `☠` Renversement assumé de H-40/H-42 — ne pas « rétablir » `auto` en croyant à une erreur.
- [ ] **À TESTER par Chris (prochaine session)** : ouvrir une **nouvelle** conversation
      orchestrateur, lui demander une équipe d'exploration puis une équipe de modification, et
      vérifier qu'il choisit `acces` de lui-même et l'annonce. Le prompt n'a jamais été exercé.
- [ ] **L'étage manquant : le lead ne peut pas interpeller l'orchestrateur.** L'organisation voulue
      par Chris est « sous-agents → lead → orchestrateur → humain ». Les deux premiers étages
      existent (natifs du SDK). Le troisième n'existe pas, et ce n'est PAS du bus de permissions :
      c'est un canal de conversation remontante (le lead a une QUESTION et attend). Aujourd'hui
      l'orchestrateur peut lire une équipe et lui pousser un message ; l'inverse n'existe pas.
- [ ] **Mode rapide et ultracode : jamais exercés.** `fastMode` est exposé par `/modeles` (seul
      Opus 5 le déclare) et les cases existent à l'écran — leur effet réel n'a jamais été vérifié.
- [ ] **(E-bis) Revoir les AUTRES opt-in de `deploy-harness-pi.sh`** — le script réécrit `.env` en
      entier ; `CCREMOTE_PI_ORCHESTRATEUR` est corrigé (relu sur le Pi), les autres variables n'ont
      PAS été passées en revue. Même défaut possible : un déploiement de routine qui éteint un réglage.
- [ ] **(D) Élucider l'écart de ~4 061 tokens** entre `totalTokens` et la somme des postes chargés.
      Le total reste la référence ; la ventilation sert à voir *où* ça part, pas à refaire l'addition.
- [ ] **Dette : `superviseur-workers.ts` à 801 lignes** (limite 500) — remonté de 710 le 01/08 avec
      la sonde de coût et `inspecter()`. `harness-orchestrateur.js` à 796 (était ~640).
      Deux fichiers qui grossissent à chaque chantier : la découpe n'attendra plus longtemps.

### ⚠️ À SAVOIR AVANT DE TOUCHER AU HARNESS (31/07)

- **Le déploiement a DEUX moitiés.** `deploy-harness-pi.sh` ne déploie que le Pi. Après toute
  modification du canal de contrôle ou du SDK : `systemctl --user restart ccremote-pc`, sinon le PC
  répond « opération de contrôle non gérée » avec des fichiers pourtant à jour sur disque.
- **SDK épinglé 0.3.220** (CLI embarqué 2.1.220). La liste de `supportedModels()` dépend de CETTE
  version, pas du compte. Tout changement de SDK ⇒ repasser `acceptation/modeles-effort-reel.ts` et
  réaligner `shared/modeles-claude.ts`.
- **La suite est VERTE : 1037 tests, 0 échec.** Les 31 rouges « préexistants » ne l'étaient pas :
  ils dépendaient du scratchpad d'une session Claude Code disparue (corrigé le 31/07, `0383baa`).
  Tout rouge est désormais un vrai signal — un test crée ce qu'il valide, sous `os.tmpdir()`.
- **Le bus d'escalade n'existe plus** (31/07). Ne pas rouvrir le sujet en croyant à un oubli de
  câblage : c'est une décision, motivée par une mesure. Voir `pi-web/CONTRAT-API-HARNESS.md`.
- **Les workers tournent en `bypassPermissions`** (31/07), avec `allowDangerouslySkipPermissions`.
  Un invariant de composition refuse le couple dépareillé. Ce qui borne une équipe ne dépend PAS
  du mode : `disallowedTools` retire l'outil du contexte du modèle — mesuré, pas déduit.
- **`acces` est OBLIGATOIRE dans `creer_equipe`** et le prompt de l'orchestrateur l'explique.
  `☠` Toute capacité ajoutée/retirée à la surface MCP se répercute le MÊME JOUR dans
  `control-plane/orchestrateur/processus/mandat.ts` : l'orchestrateur ne lit pas ce dépôt.
- **Le banc `acceptation/bypass-denis-reel.ts` est à repasser à tout changement de SDK** — il
  vérifie un contrat tiers dont dépend tout l'accès `lecture`.

### ✅ TERMINÉ — session du 31/07 (matin)

- [x] **(F) `lire_fichier` à travers le lien Pi↔PC** — plafond 200 Ko avec troncature annoncée,
      test d'assemblage des 4 couches. **Validé E2E en prod** : l'orchestrateur a lu le vrai
      `package.json` du PC. `☠` A révélé au passage que le contrôle de racine d'`explorer_projets`
      était LEXICAL — un lien symbolique dans `/mnt/projects` vers `~/.claude/.credentials.json`
      passait ; corrigé par `realpathSync` sur la cible ET la racine.
- [x] **Une saturation ne survit plus à sa fenêtre** (`58f0045`) — un `rejected` dont le `reset_a`
      est passé n'écarte plus le compte. Le compte A était écarté depuis le 26/07 ; il est à 3 % hebdo.
- [x] **Sonde de quotas : plus de perdant systématique** (`55d49a5`) — `Promise.all` affamait
      toujours le même compte (429). Un compte par passe + sonde séquentielle + `/profile` seulement
      si l'identité manque + période 20 s → 60 s.
- [x] **Validation du modèle** (`fd66e80`) — « sonnet 5 » tuait une équipe en 2 s.
      `shared/modeles-claude.ts` normalise, préserve `[1m]`, refuse avant écriture.
- [x] **Route `/modeles` réelle + SDK 0.3.220** — le sélecteur lisait encore la maquette.
      Opus 5 et Sonnet 5 sélectionnables avec leurs cinq niveaux.
- [x] **Epoch de fencing persisté** (`bb80c8f`) — 8ᵉ « écrit, testé, branché sur rien ».

### ✅ TERMINÉ — session du 23/07 (soirée) → 24/07

- [x] **(B) Sous-agents à l'écran** (`c482742`) — lus sur le TRANSCRIT (migration 10),
      `agent-<id>.meta.json` porte `toolUseId` = `parent_tool_use_id`. 5/5 sur la session H-72.4.
- [x] **(B-suite) Clic sur un sous-agent → vrai fil** (`bd3a0e7`) — route réelle
      `GET /missions/{id}/agents/{agentId}`, fil par agent persisté (migration 11), doublure de démo
      supprimée. Un agent sans fil sort `feedUnavailable`, jamais omis.
- [x] **(B-suite) Validé sur équipe VIVANTE** — mission Vela réelle : lead Sonnet + 3-4 sous-agents
      Haiku, fil complet, attribution modèle/effort affichée. Le système agentique tourne bout en bout.
- [x] **Quotas temps réel sans token ni PC** (`b6aa6fc`, migration 9) — sonde OAuth côté Pi.
- [x] **`result` ne tue plus la session** (`1dc52f2` + rollback `ad2795a`) — `background_tasks_changed`.
- [x] **Modèle/effort appliqués + attribués + mémorisés** (`56bf2aa`, `7a6fc05`, migration 12).
- [x] **Cache-busting des assets** (`7a6fc05`) — empreinte mtime, règle remontée en global.
- [x] **Déploiement n'éteint plus l'orchestrateur** (`8a102d2`).
- [x] **`explorer_projets` câblé** (`bd3a0e7`) — 7ᵉ « écrit, testé, branché sur rien ».
- [x] **Rotation de compte + « weekly limit »** (`d56634b`) — `shared/saturation-compte.ts`, choix
      sur quota mesuré.
- [x] **Réconciliation ne ressuscite plus une équipe arrêtée** (`046ecce`) + H-56 en 409.
- [ ] **(D) Élucider l'écart de ~4 061 tokens** entre `totalTokens` et la somme des postes chargés
      sur une mission réelle — alors qu'elle tombait au token près en mesure locale. À mesurer sur
      deux relevés successifs d'une même session vivante. **Le total reste la référence** en
      attendant ; la ventilation sert à voir *où* ça part, pas à refaire l'addition.
- [ ] **(E) Dettes ouvertes** — index de rotation du master **en mémoire** (repart sur le compte A
      même saturé après un redémarrage) · `harness-orchestrateur.js` ~640 lignes.
      *(`deniedToolPatterns: []` : corrigé le 31/07, voir plus haut.)*

### ✅ TERMINÉ — session du 23/07 (journée)

- [x] **(A) Fil de la mission** — rendu VIDE alors que transitions d'état et permissions étaient
      déjà persistées. Puis enrichi : le collecteur ne lisait que les blocs `text` et **jetait**
      `thinking` et `tool_use`. Migrations 7 et 8.
- [x] **(A bis) Équipe terminée introuvable par le master** — `listerEquipes` n'appelait que
      `listerActives()`. Désignation par id / nom / projet / fragment, ambiguïté refusée avec ses
      candidats, identifiant copiable dans la vue Mission.
- [x] **(C) % de contexte suspect** — la ventilation rendue par le SDK était jetée (migration 6).
      *Hypothèse d'origine invalidée par la mesure : le socle ne pèse que ~24 K, pas 100 K.*
- [x] **`rapport_equipe`** — le dernier TEXTE du lead, entier, jamais tronqué.
- [x] **Mort d'un worker en cours de route** — `reconcilier()` ne tournait qu'au démarrage et au
      rattachement ; le balayage télémétrie le déclenche désormais.
- [x] **État d'affichage honnête** — `en_cours` + `etatSdk=idle` s'affichait « running ».
- [x] **Jauges de rate limit réellement mesurées** — `releverQuota()` n'était appelé QUE pour
      marquer une saturation. Sonde côté PC, cache 10 min, unité `reset_a` unifiée en ms,
      heure de reset en AM/PM (+ jour pour la fenêtre hebdomadaire).
- [x] **Fin du « Max · oauth » écrit en dur** dans le HTML — les comptes sont en « Claude Pro ».
- [x] **Rafraîchissement temps réel des vues** — aucune ne se rafraîchissait. Diff ciblé + append,
      sans jamais reconstruire le DOM (règle posée en doc, skill et mémoire).
- [x] **Sidebar scrollable** en vue mobile.

## 🎯 OBJECTIF COURANT (priorités données par Chris, 2026-07-22 au soir)

1. ~~Communication PC↔Pi (H-75)~~ — **livrée et revue** (`6b91242`), 3 défauts corrigés.
2. ~~Câblage de l'interface~~ — **livré en LECTURE** (`9c695d2`, `b8d542f`) : parc, escalades et
   comptes viennent du vrai registre, à travers `pi-web` qui porte l'authentification.
3. ~~Le chemin d'ÉCRITURE~~ — **livré** (`3467ead`). Instruction, pause, reprise, terminaison et
   résolution d'escalade vont de l'écran jusqu'au superviseur. `ControleurPause` a enfin son
   premier appelant réel (6ᵉ occurrence du défaut « écrit, testé, branché sur rien »).
   `⚠` Reste : `arret_urgence` n'a pas de méthode sur `ClientSuperviseurPc` ⇒ la route répond 501.
4. **Remonter `subagents` / `inspection` du PC vers le Pi** — `feed` est **livré le 23/07** (fil réel :
   transitions, permissions, réflexions, outils, textes). Restent `subagents` (voir « EN COURS » en
   tête de fichier) et `inspection` (verdicts du juge H-68, rendus côté PC, jamais remontés).
4ter. ~~**Vue Orchestrateur entièrement en démo**~~ — **résolu** : la conversation est réelle depuis
   le 23/07 (nuit), et les jauges de quota sont **réellement mesurées** depuis le 23/07 (journée).
   `☠` La leçon reste : un chiffre faux non signalé est pire qu'un chiffre absent. C'est ce qui a
   fait retirer le « Max · oauth » écrit en dur dans le HTML des comptes.
4bis. ~~**Session orchestrateur sur le Pi**~~ — **active en production** (`CCREMOTE_PI_ORCHESTRATEUR=1`),
   avec deux comptes de repli locaux (`CCREMOTE_PI_CONFIG_DIRS_ORCHESTRATEUR`) et rotation vérifiée.
5. ~~Exercer le lien entre deux vraies machines~~ — **fait le 2026-07-22**, 2 défauts trouvés et
   corrigés (`3ff794c`). Restent non éprouvés : le passage par **Cloudflare Tunnel** (banc en LAN
   direct) et un **vrai redémarrage machine** (le `boot_id` n'a jamais changé pendant le banc).
6. ~~`⚠` **Tempête d'évictions à deux clients PC**~~ — **FERMÉE le 2026-08-01**. Cause : le serveur
   du lien ne tenait QU'UN emplacement, donc toute connexion authentifiée évinçait la précédente,
   d'où qu'elle vienne (1268 évictions au banc du 22/07). Chaque machine s'annonce maintenant avec
   une IDENTITÉ (`composition/lien-pc-pi/identite-machine.ts`) et possède son propre lien
   (`parc-liens-machines.ts`) : le `supersede` ne joue plus qu'à identité **égale** — c'est-à-dire
   deux process d'une même machine, ce qui reste voulu (reprise après crash).
   Mesuré en production : deux machines connectées en continu, **0 supersede**.
7. Puis le reste des dettes ci-dessous.

## 🚀 EN PRODUCTION depuis le 2026-07-22

| Machine | Service | État |
|---|---|---|
| Pi | `ccremote-harness` | registre + API web (loopback) + serveur du lien (LAN) |
| Pi | `ccremote-web` | interface sur `ccremote.exemple.com` |
| PC | `ccremote-pc` (`--user`, linger) | client du lien, reconnexion automatique |

Cycle éteindre/rallumer vérifié en prod : `pcOnline` suit, sans intervention.

`⚠` **Ce qui serait encore faux de croire** : que tout est éprouvé. Les vues Mission et Agent
n'ont pas de source réelle (sous-agents et flux vivent sur le PC), la vue conversation attend un
`/login` sur le Pi, et le lien passe par le LAN — le tunnel Cloudflare n'a toujours jamais été
traversé, donc le pilotage hors du réseau local n'est pas prouvé.

## 📋 REGISTRE DES DETTES — état au 2026-07-22

*Classées par gravité réelle. Une dette n'est pas une tâche oubliée : c'est un endroit où le code
passe les tests sans faire le travail. Rien de ce qui suit n'apparaît dans le compte de tests verts.*

### ✅ DETTE N°1 — FERMÉE le 2026-07-22 (était la priorité explicite de Chris)
- [x] ~~Persistance du registre de workers côté PC~~ — le registre survit au redémarrage du
      superviseur (SQLite local, frontière A↔B respectée), chaque worker restauré est revalidé, et
      les concurrents restaurés participent au fencing.
      `☠` **Trois pièges payés pour la fermer, à ne pas réintroduire** :
      (1) le **pid seul ne prouve rien** (recyclage noyau) — c'est le couple `(pid, starttime)` ;
      (2) ce couple **ne survit pas à un redémarrage** (`starttime` compte depuis le boot) — d'où
      `boot_id`, voir **H-75** ; (3) le mécanisme était branché sur un `pid` que `WorkerHandle`
      n'exposait pas : correct, et inerte. Biais non négociable conservé : `indetermine` ne libère
      **jamais** un worktree.

### 🟠 DETTE N°2 — un garde-fou qui pourrait ne pas se déclencher
- [ ] **Fenêtre de grâce de l'arrêt d'urgence non alignée.** `GRACE_ARRET_URGENCE_MS_DEFAUT = 5000`
      a été choisi par défaut raisonnable, **sans vérification** contre `05-arbre-B` (hors périmètre
      de M-52). Trop court : on tue avant la fin d'une écriture. Trop long : le bouton d'urgence
      n'est plus urgent. À trancher sur mesure, pas au jugé.
- [x] ~~**Le drill d'arrêt d'urgence n'est branché sur aucun canari réel.**~~ — **FERMÉE le
      2026-07-22** : `arret-urgence/canari-process.ts` démarre un **vrai process**, le cible **par PID
      exact** (jamais par motif de commande), applique SIGTERM → grâce → SIGKILL, et **constate la mort
      par `/proc`** — jamais en se fiant au code de retour du kill. Un canari survivant fait échouer le
      drill (`sequence_incomplete`), il ne produit pas un faux succès. Isolation structurelle : le
      module n'importe rien de `superviseur/`, et tout `missionId` autre que le canari retourne
      `cible_absente` — un vrai `missionId` ne peut pas être atteint.
      `⚠` **Ce que le canari n'exerce pas** : la vraie séquence de production
      (`ControleurPause`, `interrupt()` SDK, `RegistreWorkers`, `abort()`) exige une session réelle et
      reste couverte par des doublures uniquement. La dette n'est pas fermée de ce côté-là.

### 🟡 DETTE N°3 — hypothèses non vérifiées sur le comportement réel du SDK
- [x] ~~**`pending_permission_requests` absent des types publics** (M-13)~~ — **TRANCHÉE le
      2026-07-22** sur le code du SDK lui-même (`sdk.mjs`), voir **H-73**. Verdict : **l'HYP était
      fausse**. Le SDK **consomme** ces demandes lui-même (`processPendingPermissionRequests`) et les
      **rejoue par le chemin `canUseTool`** — il ne les remonte jamais par la valeur de retour.
      ⇒ **Deux conséquences ouvertes, à traiter** :
- [ ] **`superviseur/reponse-reinitialize.ts` est du code mort à supprimer ou à réorienter.** Il rend
      toujours `[]`, ce qui est pire qu'une erreur : la réconciliation en conclut « rien en attente »
      et se croit à jour.
- [ ] `☠` **Que deviennent les demandes rejouées en `permissionMode: 'auto'` ?** La redélivrance passe
      par `canUseTool`, dont il est **mesuré** (H-64) qu'il n'est **jamais appelé** dans ce mode — celui
      que le harness utilise en production. Tant que ce n'est pas mesuré, la propriété « reprise » de la
      couche 1 reste conditionnelle. **C'est désormais le trou le plus sérieux de la dette n°3.**
- [ ] `⚠` **`pending_user_dialog_requests` totalement ignoré par le projet** — seconde famille de
      demandes en vol, frère documenté de la première.
- [x] ~~**Messages d'usage jamais vus en vrai** (M-51)~~ — **FERMÉE le 2026-07-22** par
      `acceptation/observabilite-5-sousagents-reel.ts`. `☠` Le message réel est un type à part
      entière, **`rate_limit_event`**, absent des types publics : il n'arrive **ni** par
      `SDKInformationalMessage.content` **ni** par `SDKNotificationMessage.text`, les deux canaux sur
      lesquels M-51 avait bâti sa classification. ⇒ **M-51 doit être recâblée sur ce type** :
      aujourd'hui elle ne verrait jamais passer une vraie limite. Forme exacte en H-63.1.
- [ ] **Contexte du parent à cinq sous-agents : non mesuré** (H-72.3). Vérifié sur **un** sous-agent
      (inchangé) ; à cinq, la lecture a échoué à cause du piège `getContextUsage()` dans la boucle.
      À refaire avec un protocole qui lit le contexte **hors** de la boucle.
- [x] ~~**Niveaux d'effort réels d'`opus-4-7` et `sonnet-4-6` inconnus**~~ — **FERMÉE le 2026-07-22**
      par `acceptation/modeles-effort-reel.ts`. `opus-4-8` / `sonnet-5` / `fable-5` déclarent bien les
      cinq niveaux + pensée adaptative ; `opus-4-7` est **absent** de `supportedModels()` et ne doit
      donc pas figurer au sélecteur ; Haiku n'a ni effort ni adaptatif (exclusion H-71 confirmée
      mécaniquement). Le mode « ultra » existe : c'est `ultracode` (Settings). Détail en **H-71.1**.
      `☠` L'identité d'un modèle est `value`/`resolvedModel`, **jamais `model`** — piège rencontré.

- [ ] `⚠` **AGGRAVÉ le 2026-07-22 — le flux de sous-agents est non déterministe** (H-72.4). Deux
      exécutions supplémentaires du banc à cinq sous-agents, session parfaitement saine, ont donné
      **0 ligne** là où trois exécutions antérieures en donnaient 3 à 4. `forwardSubagentText` n'offre
      **aucun plancher garanti** : la divergence flux/store que M-50 chiffre n'est pas un cas limite,
      c'est le cas **nominal**, et elle peut valoir 100 %. Le contexte du parent à cinq sous-agents
      reste, lui, non mesuré — `getContextUsage()` n'est pas lisible après `result`.

### 🟢 DETTE N°4 — qualité de code et arbitrages
- [x] ~~`superviseur/superviseur-workers.ts` dépasse 500 lignes~~ — **FERMÉE** : extractions
      successives (`budgets-workers.ts`, `fencing-restauration.ts`, `fencing-arbitrage-workers.ts`,
      `anti-boucle-workers.ts`, `superviseur-workers-types.ts`), fichier revenu sous la limite.
      `⚠` `superviseur/superviseur-workers.test.ts` dépasse toujours 500 lignes (fichier de test).
- [x] ~~Trois arbitrages M-32~~ — **TRANCHÉS le 2026-07-22**, détail plus bas. Dont un plafond qui
      **marchait à l'envers** : il rejetait les configurations *plus* restrictives.
- [ ] **Arbitrages maquette v3 restants** : Sonnet 4.6 grisé ou masqué ; jauge dans la vue
      Orchestrateur. `☠` **Le déclencheur d'atterrissage par mission contredit H-70** — la décision
      appartient au **superviseur**, jamais au lead seul, parce que la fenêtre de quota est partagée
      par compte : trois leads qui atterrissent ensemble la saturent pendant l'atterrissage. Conservé
      pour l'instant afin de rendre la maquette testable, **à retirer quand le comportement devient
      réel**.

### ✅ Dettes fermées le 2026-07-22 (suite)
**Cinq garde-fous étaient branchés sur rien** — tous corrigés, motif consigné en **H-74** : plafond
de parc jamais appelé · `canUseTool` jamais fourni (cassait la reprise) · juge anti-boucle H-68
jamais câblé · identité de process jamais capturée · hooks d'audit M-22 raccordés à aucun worker.
`☠` Sixième forme du même défaut, trouvée par un test rouge : la `WorkerSpec` est persistée en JSON,
donc **ses ports disparaissent au redémarrage** — une spec restaurée relancerait un worker sans audit
ni arbitrage. Le type le dit désormais (`WorkerSpecPersistee`).

Ports `InventairePc`/`ReinitialisateurSession` implémentés (M-13) · `deciderRelance()` câblé (M-13) ·
git réel exercé sur un vrai dépôt + **bug critique de perte de données corrigé** (banc worktree) ·
fencing par epoch arbitré (M-11) · config multi-comptes réparée par liens symboliques (banc worker).

### Lot 0 — TERMINÉ (180 tests verts, typecheck propre)
- [x] **M-01** squelette worker · **M-02** générateur d'entrée · **M-03** registre SQLite
- [x] **M-04** harnais de pannes — 87 tests, README avec table de couverture, défaut de fencing
      corrigé (le rejet ne portait que sur les epochs strictement inférieurs : deux workers de même
      epoch coexistaient sans trace, soit la panne #2 **avec** le fencing activé)
- [x] **`design-v2/`** — maquette + `COMPARAISON.md`

### Point de synchronisation vague 1 — ✅ PASSÉ le 2026-07-22 (par le parent)
- [x] **Test d'acceptation réel de M-02** — 10 min de silence réel, flux survivant, aucun
      `Stream closed`. Script rejouable : `harness/acceptation/m02-flux-entree.ts`.
      **Découverte** : en `permissionMode: 'auto'`, `canUseTool` n'est jamais appelé (le classifieur
      tranche seul, même sur `rm -rf`). Le critère d'origine était donc inatteignable en production.
      ⇒ **l'audit doit passer par `PreToolUse`** — à répercuter sur M-22.

### Vague 2 (dépend du Lot 0)
- [x] **M-10** tunnel Pi↔PC — livré 2026-07-22, `harness/transport/`. **WebSocket retenu** (natif à
      Bun, zéro dépendance ; framing et codes de fermeture 4000-4999 gratuits pour la taxonomie
      D.2.1 ; la reprise devant de toute façon être écrite à la main quel que soit le support).
      Raisonnement complet : `harness/transport/DECISION-TRANSPORT.md`.
- [ ] **M-10 — reste à faire, signalé par l'agent lui-même** : pas de ping/pong applicatif, donc une
      coupure **silencieuse** (ni `close` ni `error`) n'est pas détectée. Le lien paraît vivant et ne
      transporte plus rien. `☠` À couvrir avant toute exécution non surveillée.
- [ ] **M-10 — à mesurer en réel par le parent** : aucune latence de reconnexion réelle n'a pu être
      mesurée (interdiction de réseau réel en subagent). Le critère (a) — coupure de 30 s, zéro octet
      perdu ou dupliqué — est prouvé sur doublures, pas sur socket.
- [x] **M-20** plancher de déni — livré 2026-07-22, `harness/plancher-deni/`. 16 motifs scopés
      (plafond porté de 15 à 16 pour loger `pkill -f`, incident réel du 2026-07-08 sur le Pi).
- [x] **M-20 — moteur réel vérifié** (2026-07-22, `harness/acceptation/plancher-moteur-reel.ts`).
      Les 3 formes de wildcard du plancher (`préfixe*`, `*encadrant*`, `médian* -f*`) refusent bien
      sur le vrai binaire, et le déni n'est **pas** global : les 2 témoins s'exécutent, dont celui
      qui prouve l'absence de faux positif sur `-f` sans espace. `simulerArbitrage` est donc un
      modèle **fidèle**. `☠` Testé par **motifs sondes** sur des `echo` inoffensifs — jamais en
      demandant au modèle une action dangereuse.
      `⚠` Piège de détection payé : chercher « refus »/« denied » dans le JSON entier des messages
      fait passer les témoins pour refusés (le résumé final du modèle cite tous les verdicts). Le
      verdict se lit sur les blocs `tool_result` appariés à leur `tool_use`.
- [x] **M-21** machine à états des demandes — livré 2026-07-22,
      `harness/control-plane/bus-permissions/`. 5 invariants testés. Ne suppose **aucune source
      unique** : conséquence directe de `canUseTool` jamais appelé en `auto`. Deux entrées
      symétriques — `resoudreAuto()` (le lead tranche seul) et `escalader()` (humain).
- [x] **Ping/pong transport** — dette de M-10 comblée, `harness/transport/lien-websocket.ts`.
      Le `PONG` est généré par la **couche transport**, jamais par le processus Claude Code : c'est
      ce qui rend « agent lent » et « tunnel mort » structurellement discernables. Seuil 3 tics de
      silence total (~45 s), reprise par le même chemin que les coupures signalées.
- [x] **M-22** arbitrage délégué + trace d'audit — livré 2026-07-22,
      `harness/control-plane/audit-permissions/`. Audit branché sur `PreToolUse` (exhaustivité
      vérifiée : 100 % des tentatives vues en `auto`), **jamais** sur `canUseTool`.
- [x] **M-22 — validé et corrigé par banc réel** (`harness/acceptation/audit-permissions-reel.ts`).
      Le banc a infirmé une hypothèse : `SDKPermissionDeniedMessage` **n'est jamais émis** sur un
      refus par règle scopée en `auto`, et le hook `PermissionDenied` ne se déclenche pas non plus.
      Le collecteur comptait alors `refusees: 0` alors qu'un refus avait eu lieu. Corrigé : le
      signal réel est le **`tool_result` avec `is_error: true`**, apparié par `tool_use_id`.
      Après correctif : `{tentativesVues:3, autorisees:2, refusees:1, nonResolues:0}`.

`⚠` **Limite de ce que H-40 peut garantir**, à retenir avant de s'appuyer dessus : sur le chemin
réel (refus par règle scopée), la trace affirme **quoi** a été refusé et **avec quel texte**, mais
**pas par quel mécanisme** (`auteur: 'inconnu'`). Les autorisations, elles, ne sont jamais affirmées
par le SDK — seulement inférées (`classifieur_probable`). Une tentative sans `PostToolUse` ni
`tool_result` de refus reste `indetermine` et n'est **jamais** requalifiée en refus.
- [x] **M-31** adaptateur `SessionStore` — livré 2026-07-22, `harness/control-plane/session-store/`.
      Miroir best-effort, mais la divergence est **détectable** : table `session_defaillance`
      indépendante du flux SDK (un consommateur qui n'écoute pas `mirror_error` le raterait sinon)
      + `etatMiroir().divergent`. Colonne `emetteur` posée pour H-66 sans être peuplée.
- [x] **M-31 — validé sur le vrai SDK** (`harness/acceptation/session-store-reel.ts`) : le SDK
      sollicite réellement l'adaptateur (`append` ×2, cadence ~480-530 ms), la `projectKey` est le
      **cwd sanitisé** (`-mnt-projects-ccremote-harness`), 10 entrées relues, `divergent: false`,
      aucun `mirror_error`. `⚠` Seul `append` a été observé sur une session courte : `load`,
      `delete`, `listSubkeys` restent non exercés par le SDK réel (à revoir sur une reprise).
- [x] **M-34** relance et classification — livré 2026-07-22, `harness/relance/`. Mapping pris dans
      `05-arbre-B § B.3.2` (pas dans `01`, qui n'en donne qu'une énumération partielle) et croisé
      avec `sdk.d.ts`. Seul le groupe `transitoire` est relançable ; structurel ⇒ `echec_definitif`
      **immédiat, sans consommer de tentative** ; `budget_exhausted` jamais relancé.
      `⚠` **Trouvaille : la table de la spec ne couvre que 16 des 19 `TerminalReason` du SDK.**
      `image_error`, `tool_deferred`, `tool_deferred_unavailable` sont classées `non_couverte` —
      journalisées telles quelles, jamais relancées, toujours remontées. Aucun groupe inventé.
- [ ] **M-34 — pas encore branché** : `deciderRelance()` est écrit et testé en isolation, mais
      n'est câblé sur aucun `SDKResultMessage.terminal_reason` réel. La relance ne fonctionne donc
      **pas** de bout en bout — le câblage revient à M-30 (réconciliation / cycle de vie).

`⚠` **Ne pas lancer d'exécution non surveillée avant M-20 et M-51** (plancher de déni + budgets).

### H-69 — `extra_usage` laissé actif (tranché par Chris, 2026-07-22)
`extra_usage.is_enabled = true` sur les deux comptes. **Décision : on le laisse actif** — les crédits
sont offerts sur le compte, donc utilisables librement pour le développement et les tests réels.

`⇒` La contrainte de parcimonie sur les **tests réels** est levée : un banc d'essai en vraie session
est désormais le moyen normal de lever un doute, pas un luxe à rationner. C'est cohérent avec tout ce
qui précède : chaque fois qu'on a testé en réel (M-02, moteur de règles, multi-comptes), on a trouvé
quelque chose que le raisonnement seul avait manqué.

- [ ] Afficher quand même les crédits consommés dans la jauge H-63 (visibilité, **pas** blocage).
      Des crédits offerts restent finis, et un parc autonome les consomme sans le dire.

`☠` Ceci reste distinct de H-68 : une dépense n'est **pas** un détecteur de boucle. Ne pas
ressusciter le plafond en dollars sous prétexte que le budget existe.
`☠` Ceci n'autorise **pas** l'exécution non surveillée : les garde-fous (M-20, M-51, ping/pong) sont
une question de sûreté, pas de budget.

### Action de Chris requise — rotation multi-comptes à moitié en place
Conception retenue : **un `CLAUDE_CONFIG_DIR` persistant par compte** sous `~/.claude-comptes/`,
authentifié une fois et laissé se rafraîchir. Ne jamais recopier un snapshot au moment de la bascule
(les refresh tokens tournent : un snapshot copié se périme seul et en silence — constaté le 22/07 sur
les deux anciens `.credentials_account*.json`).

- [x] `compte-a` (`compte-a@exemple.fr`) et `compte-b` (`compte-b@exemple.fr`) en place,
      **vérifiés en parallèle le 2026-07-22** : deux sessions simultanées, identités distinctes lues
      via `accountInfo()`, quotas lus par compte, aucun fichier d'identifiants écrasé par l'autre.
      Banc rejouable : `harness/acceptation/multi-comptes-reel.ts`.
- [ ] À confirmer à la première bascule réelle : que le rafraîchissement du jeton s'écrit bien
      **dans** le dossier isolé (non forçable, ne s'observe qu'à l'expiration).
- [ ] Purger les deux snapshots périmés `~/.claude/.credentials_account{1,2}.json` — ils ne servent
      plus qu'à induire en erreur (garder jusqu'à la première bascule réussie, par prudence).

### Lot 3 — livré 2026-07-22 (461 tests verts)
- [x] **M-30** réconciliation — `harness/control-plane/reconciliation/`. « Le PC gagne » garanti
      **mécaniquement** : l'état ne suit que le booléen `vivant` rapporté par le PC, aucun chemin ne
      laisse survivre une conviction du Pi qui le contredit. `reinitialize()` appelé sur toute
      mission confirmée vivante (`demarrage`/`reconnexion`, jamais `periodique`).
      `⚠` Correction du parent : un flag `simulerPanneOrphelinIgnore` avait été introduit dans le
      module de production pour tester la panne #11. Retiré — **un interrupteur capable de produire
      la panne est la panne**. L'invariant se teste sur le seul chemin qui existe.
- [x] **M-32** modèle de projets — `harness/projets/`. Déclaration = un fichier JSON déposé, aucun
      cache, donc F.4.1 vrai mécaniquement. `☠` Point (d) : `supprimer()` a **un seul site d'appel**,
      dans la branche `!sale`, et un échec de la vérification git suppose le **pire cas sûr** (sale,
      donc pas de suppression) — « un faux positif retarde une libération, un faux négatif détruit
      du travail ».
- [x] **M-33** pause et reprise — `harness/pause/`. La garantie « ni perdue ni dupliquée » ne dépend
      **d'aucune information tirée du reçu** : elle tient à ce que le contrôleur ne touche jamais aux
      messages déjà transmis et ne retransmette jamais les siens. Le mode dégradé est traité comme
      **chemin nominal** (`capabilities` revient vide en réel), et une capacité annoncée mais dont
      `interrupt()` résout `undefined` bascule aussi en dégradé — on ne fait pas confiance à un
      drapeau qui ment.

### ✅ Arbitrages M-32 — TRANCHÉS le 2026-07-22 (choix d'implémentation, rendus par le parent)
- [x] **« commits en attente » (F.2.3) = non intégrés dans la branche parente** — **confirmé**.
      La lecture « non poussés vers un remote » est écartée : le harness travaille en worktrees
      locaux, un remote peut ne pas exister, et le coût d'erreur est asymétrique — se tromper ici
      revient à supprimer un worktree portant du travail. C'est exactement le bug de perte de
      données déjà payé sur ce module. La lecture la plus conservatrice est la bonne.
- [x] **Plafond de 8 motifs supplémentaires : supprimé, remplacé par un seuil d'alerte** aligné sur
      `MAX_MOTIFS_PLANCHER`. Le chiffre était inventé, et surtout **à l'envers** : des motifs
      supplémentaires **renforcent** le plancher de déni. Rejeter au-delà d'un seuil faisait échouer
      le chargement d'un projet parce qu'il était **trop prudent**. Le rejet reste réservé aux
      configs qui affaiblissent le plancher ou se contredisent, jamais à celles qui sur-restreignent.
- [x] **Projet non-git fixant `brancheDefaut` : rejet maintenu** — une configuration qui se
      contredit doit être refusée, pas silencieusement ignorée. Même principe que **H-74** : une
      extinction silencieuse est toujours pire qu'un échec visible.

### Bancs réels passés par le parent — 2026-07-22
- [x] **`acceptation/worker-reel.ts`** — `startWorker` (M-01) exercé contre le vrai SDK pour la
      première fois : worker démarré, mandat mené à terme (`RESULTAT.md` = `TERMINE`), **plancher de
      déni réellement appliqué** (sonde refusée), capacités lues depuis `init`, `SessionStore`
      alimenté. Valide M-01 + M-20 + M-31 ensemble, en conditions réelles.
      `☠` **Découverte** : isoler le compte via `CLAUDE_CONFIG_DIR` isole **aussi toute la config** —
      pas de `CLAUDE.md`, pas de `settings.json`, pas de `skills/`, **pas de serveurs MCP**. Le
      worker perdait Playwright/CodeIndex, que H-52 lui demande d'utiliser pour ses tests E2E.
      Le pré-vol de M-01 l'a détecté et a refusé de spawner — le garde-fou a joué son rôle.
      Corrigé par liens symboliques (voir `harness/REPRISE.md`, section multi-comptes).
      `⚠` **À refaire pour tout nouveau compte ajouté** — sinon ses workers repartiront nus.

### M-11 fencing par epoch — LIVRÉ 2026-07-22 (dernière panne muette connue, fermée)
- [x] `superviseur/fencing-epoch.ts` (arbitre pur) + câblage dans `superviseur-workers.ts`,
      + garde complémentaire dans `projets/cycle-vie-worktree.ts` (`EpochNonCroissantError`).
      **Clé = le worktree**, pas le `missionId` : ce qu'on protège est le répertoire où deux process
      pourraient écrire. `☠` **Égalité d'epoch traitée explicitement** — une reprise légitime porte
      toujours un epoch strictement supérieur (le Pi l'incrémente à chaque rattachement), donc une
      égalité est forcément une collision. Le **candidat entrant** perd (règle symétrique = non
      déterministe). Un worker évincé **meurt réellement** : `abortController.signal.aborted`
      vérifié en test, sur l'AbortController propre au worker.
- [ ] `⚠` **Limite signalée, hors périmètre M-11** : si **le superviseur PC** redémarre (et pas
      seulement le Pi), il perd son `RegistreWorkers` en mémoire et ne sait plus quels workers
      vivent — aucun fencing ne peut y remédier. Axe distinct : **persistance du registre côté PC**.

### Dettes ouvertes du lot 3
- [ ] **Ports non implémentés** : `InventairePc` et `ReinitialisateurSession` (M-30) sont des
      contrats sans implémentation réelle — la réconciliation ne tourne donc **pas** de bout en bout.
- [x] **`InterrogateurGitReel` / `GestionnaireWorktreeGitReel` exercés sur un vrai dépôt** —
      `harness/acceptation/worktree-git-reel.ts`, 4/4 sur des dépôts jetables créés par le banc.
      `☠` **Bug critique trouvé et corrigé** : `executer()` n'ayant jamais levé (il avale l'échec de
      `git` et rend `stdout: ''`), le « pire cas sûr » posé dans le `catch` de `aTravailNonCommite`
      était **du code mort**. Un git en échec devenait indiscernable d'un worktree propre ⇒
      suppression. Seul `git worktree remove` (qui refuse un `.git` manquant) a évité la perte de
      données. Corrigé : le **code de sortie** est vérifié, pas seulement l'exception.
- [ ] **`deciderRelance()` toujours non câblé** : M-30 a argumenté (à raison) que la réconciliation
      n'observe jamais de `terminal_reason`. Le point de câblage est le gestionnaire du flux live,
      côté superviseur de workers — pas encore construit.

### Design v2 — arbitrages à trancher par Chris (source : `design-v2/COMPARAISON.md`)
- [ ] **Parler à une mission en cours** — trou le plus concret. Chris avait posé l'exigence
      explicitement (« on pourra en discussion en même temps »), et l'outil `envoyer_a_equipe` existe
      bien en A.2.2 — mais **la maquette ne l'expose nulle part**. Corriger un lead qui dérive sans
      arrêter la mission n'a donc aucun chemin dans l'UI. Trou de maquette, pas de spec.
- [ ] **Composer un mandat** — le bouton « Nouvelle mission » n'ouvre rien. Or le mandat (but /
      critère d'arrêt testable / périmètre + obligations H-52) est la pièce centrale du système.
      Rien dans l'UI ne le compose ni ne l'affiche.
- [ ] **Barre de sûreté absente de la vue Orchestrateur et de Paramètres** (présente sur 4 vues / 6)
      — or H-57 exige que le bouton reste joignable partout. Coût : hauteur du composer sur mobile.
- [x] **Wake-on-LAN retiré sans remplaçant** — la v2 sait afficher « lien coupé » mais n'offre plus
      le geste qui corrige. Trois options : réveil dans la carte lien · réveil auto au dispatch · PC
      allumé en permanence (choix implicite actuel de la maquette).
      **RÉSOLU 06/08** : le geste existe désormais comme outil de l'orchestrateur —
      `reveiller_machine({machine:'pc'})` (`c1f6e8f`, voir `STATE.md`). `☠` La réserve d'origine
      reste partiellement vraie côté **maquette v2** : le geste est joignable en conversation avec
      l'orchestrateur, mais aucune des trois options UI listées ci-dessus (carte lien, auto-dispatch,
      PC permanent) n'est câblée dans l'interface elle-même — à trancher séparément si un bouton
      dédié dans l'UI reste désiré en plus du canal conversationnel.
- [ ] **Métriques machine supprimées** — alors que H-57 acte que les processus enfants survivent à la
      pause et s'accumulent. La v2 retire le seul endroit où ça se serait vu. Compromis proposé : une
      ligne de charge dans la carte lien.
- [ ] Règles de notification C.4.4 (groupement, seuil de rappel, silence sur ce que le lead a résolu
      seul) ni réglables ni visibles — le filet Discord est un simple interrupteur.

### H-70 / H-71 / H-72 — actées le 2026-07-22, à faire APRÈS le MVP
*Décision de Chris : « dès qu'on a le MVP, on s'attaquera directement à l'ajout de tout ça ».*
*Spécification complète dans `Upgrade/16-decisions-operateur.md`.*

- [ ] **H-70 — atterrissage propre avant saturation de quota.** Au seuil (80-85 %, à caler sur une
      mesure du coût réel d'un atterrissage), le lead consigne son état en doc + mémoire sémantique
      et clôture ; la mission est relancée après réinitialisation de la fenêtre.
      `☠` Décision prise par le **superviseur**, jamais par le lead isolément : la fenêtre est
      partagée par compte, et trois leads qui atterrissent ensemble saturent le quota pendant
      l'atterrissage.
- [ ] **H-71 — choix du modèle et du raisonnement dans le fil de l'orchestrateur.**
      Modèles éligibles : `claude-opus-4-8`, `claude-sonnet-5`, `claude-fable-5`, `claude-opus-4-7`
      (tous vérifiés accessibles). `claude-sonnet-4-6` accessible mais jugé insuffisant pour ce rôle.
      `☠` **Haiku exclu** — il ne supporte ni `effort` ni `thinking` adaptatif, fait technique
      concordant avec la décision.
      `⚠` Les niveaux d'effort proposés viennent de `supportedModels()[].supportedEffortLevels`,
      jamais d'une constante en dur. `setModel()` permet le changement **à chaud**.
- [ ] **H-72 — jauges de quota + navigation par agent.** Fenêtre 5 h **et** 7 jours, en pourcentage,
      avec `resets_at`, **par compte**. Une discussion par équipe (lead, messages, actions), et les
      sous-agents **cliquables** pour voir leur travail en temps réel.
      `☠` Le flux détaillé va de la source **directement à l'UI** — jamais par le contexte de
      l'orchestrateur (H-45, panne #17). Chaînage par `parent_tool_use_id` / `parent_agent_id`.
- [ ] **H-72.1 — cloisonnement à TROIS niveaux** (précision de Chris, 2026-07-22). Un sous-agent ne
      transmet **pas son contexte** à son lead : il lui rend un **compte-rendu**. L'UI est un
      **observateur externe** en lecture seule — de l'observabilité, pas de la transmission.
      Besoin concret : quand 5 sous-agents travaillent, le feed du lead est **vide** ; l'opérateur est
      aveugle au pic d'activité. D'où le clic vers la ligne de travail de chaque sous-agent.
      `⚠` **À MESURER avant de concevoir M-50** : `forwardSubagentText` / `agentProgressSummaries`
      alimentent-elles seulement le **flux lu par le programme**, ou aussi le **contexte du modèle
      parent** ? Si c'est le flux seul ⇒ c'est l'outil idéal pour l'UI. Si c'est le contexte ⇒ elles
      violent la règle, et il faut lire les transcripts à la source (JSONL / `SessionStore`).
      Ne pas trancher au raisonnement : banc réel.

### Features actées, à implémenter — MAIS PAS PRIORITAIRES
*Décision explicite de Chris (2026-07-22) : « il va évidemment falloir les mettre en place, mais pour
l'instant ce n'est pas le plus important. C'est ultra important de les garder en doc et en mémoire. »*
*⇒ Consignées, pas planifiées. Ne pas les laisser s'insérer dans la vague 2.*

- [ ] **H-61 — autorisation humaine au dispatch.** `creer_equipe` ne crée rien : retourne
      `effet: 'differe'` + une proposition de mandat que l'opérateur autorise d'un clic. C'est le
      dernier garde-fou humain du système (H-40 + H-41 délèguent tout le reste au lead).
- [ ] **H-66 — attribution de l'émetteur.** Préfixe structurel `orchestrateur` / `operateur` sur tout
      message entrant dans une session d'équipe, + champ au registre et au transcript. `☠` Un lead ne
      doit **jamais** attribuer à Chris une instruction venue de l'orchestrateur.
- [ ] **H-52 complété** — le system prompt du lead doit lui apprendre : il est une équipe parmi
      d'autres · ses instructions viennent normalement de l'orchestrateur · l'opérateur peut lui
      parler directement, et c'est identifié.
- [ ] **H-67 — sidebar arborescente** (chat principal + sessions d'équipes en sous-niveau) et
      **messages en file** façon Claude Code : écrire à une équipe occupée ne l'interrompt pas.
- [ ] **H-63 — jauge dollars par fenêtre de rate limit**, agrégée **par compte** (la fenêtre est
      partagée par toutes les missions d'un même compte). `☠` Remise à zéro sur `resetsAt`
      uniquement, jamais au redémarrage d'un process.
- [ ] **H-62 — orchestrateur maître** : autocompaction autonome + bouton de compaction manuelle
      disponible sans être nécessaire.
- [ ] **H-64 — permissions dans le fil** de la mission (avec filtre), pas dans une vue dédiée. La
      vue escalade ne garde que ce que le classifieur a refusé.

### À répercuter
- [ ] **M-41** doit brancher `surFermetureImprevue` du générateur d'entrée sur une **alarme réelle**
      (H-60). Sans ça, l'instrumentation existe mais ne sert à rien.
- [ ] Manifeste PWA + service worker pour Web Push (H-59) — absents de la SPA actuelle. Chris devra
      ajouter l'app à son écran d'accueil iOS une fois.

---

## App v1 (production) — à faire (priorité)
- [ ] Confirmer depuis l'app que le bouton extinction PC fonctionne réellement (fix polkit déployé,
      non re-testé en réel — irréversible, à valider par Chris)
- [ ] Confirmer que les quotas repassent bien à zéro après une fenêtre pleine sans nouvel appel
      (fix déployé, heuristique non observée sur un vrai cycle prod)

## Backlog
- [x] **Démarrer le PC depuis la conversation avec l'orchestrateur master** (demandé par Chris,
      2026-07-22). L'agent doit en être **capable**, mais **toujours demander et faire confirmer par
      l'utilisateur** — jamais de réveil automatique.
      Le moyen existe déjà : Wake-on-LAN, `PC_MAC` dans `client/config.py`, utilisé par
      `client/ccremote.py`. Il s'agit donc d'exposer un outil de contrôle à l'orchestrateur, pas
      d'inventer un mécanisme.
      `☠` Trois points à ne pas rater à l'implémentation : (1) la confirmation humaine est un
      **arbitrage**, il passe par le bus de permissions (M-21) et son escalade (H-61), jamais par une
      question posée dans le fil ; (2) réveiller le PC est une action **sortante et physique** — elle
      relève du seuil de confirmation obligatoire, au même titre qu'une extinction ; (3) le réveil
      n'a de sens qu'articulé avec la reconnexion automatique (le PC réveillé doit se rattacher
      seul) — donc à faire **après** que la reprise automatique soit prouvée, pas avant.
      **RÉSOLU 06/08** : l'outil existe — `reveiller_machine({machine:'pc'})` (`c1f6e8f`, voir
      `STATE.md`), MAC surchargeable via `CCREMOTE_PC_MAC` (successeur de `PC_MAC`/`client/config.py`).
      `⚠` Point (1) **non revérifié dans ce mandat documentaire** : `outils-machine.ts` n'appelle
      aucun bus de permissions/escalade visible autour de `reveillerMachine` — seul le wrapper
      générique `protege()` entoure l'appel. Si la confirmation humaine passe par un mécanisme
      générique du client MCP en amont, ce point est couvert ; si elle devait être un arbitrage
      explicite câblé dans ce fichier, ce n'est pas visible dans le diff des deux commits lus. À
      vérifier avant de considérer H-61/M-21 pleinement honorés ici.
- [ ] Reasoning par round de tool-calling en streaming (actuellement fusionné en un seul bloc
      pour tout l'échange, simplification assumée)
- [ ] Décider si `zai-glm-4.7`/`gpt-oss-120b`/`gemma-4-31b` ont vraiment les tailles de contexte
      posées dans `MODEL_CONTEXT_TOKENS` (estimations faute de doc publique Cerebras)

## Terminé (session du 2026-07-06, soir)
- [x] Fix bouton extinction PC : ajout règle polkit `/etc/polkit-1/rules.d/49-ccremote-poweroff.rules`
      (le service `ccremote-server`, hors session logind, n'était pas couvert par le `CanPowerOff` de
      session) — vérifié via `pkcheck`, non testé en réel (irréversible)
- [x] Fix quotas pas "temps réel" : `agent/usage.py::_effective_quotas()` resynthétise `remaining =
      limit` quand la fenêtre (minute/heure/jour) est dépassée depuis le dernier appel réel, au lieu
      de garder le snapshot figé — déployé sur le Pi

## Terminé (session du 2026-07-06)
- [x] Quotas combinés (somme des clés configurées) affichés en priorité dans Paramètres, avec
      détail par clé toujours visible en dessous — le fallback étant réel, le total combiné
      est honnête, pas cosmétique
- [x] Fix : le snapshot de quotas se videait à chaque restart serveur (trompeur — le vrai quota
      Cerebras n'est jamais affecté) — warm-up au démarrage (`lifespan` FastAPI) qui repeuple le
      snapshot avant toute requête utilisateur
- [x] Rotation automatique vers une 2e clé Cerebras (`CEREBRAS_API_KEY_2`) sur 429 — quotas suivis
      séparément par clé, toast + historique quand la bascule a lieu
- [x] Retrait du sous-titre "Agent local" sous le logo ccremote (sidebar)
- [x] Déployé en prod via `~/.ssh/id_ed25519_ccremote` (accès direct au Pi, `pi@pi.exemple`) —
      confirmé fonctionnel : sidebar corrigée, pill de contexte visible, zéro erreur console
- [x] Suivi d'usage API Cerebras : quotas requêtes/tokens par minute/heure/jour (headers `x-ratelimit-*`
      réels capturés à chaque appel), + contexte de la conversation active (tokens utilisés/limite du
      modèle) — visible en pill dans le header agent et en détail dans Paramètres
- [x] Fix `deploy-web-pi.sh` : ne synchronisait que app.py/config.py/requirements.txt/index.html,
      jamais `agent/`, `static/`, `pc_client.py` (bug pré-existant, découvert en voulant déployer)
- [x] `gemma-4-31b` confirmé utilisé et fonctionnel par Chris — commentaire de doute retiré
- [x] Conformité standards projet : `README.md`, `ARCHITECTURE.md`, `start.sh`/`stop.sh`/`restart.sh`,
      `.env.example` racine
- [x] Fix responsive carte "PC distant" dans Paramètres (grid-cols-2 illisible sur mobile → stack vertical)
- [x] Fix hauteur mobile Safari (`100vh` → `100dvh`) sur index.html et login.html
- [x] Fix header mobile dupliqué (topbar + header de vue → un seul header, hamburger intégré)
- [x] Fix bug stopPropagation empêchant l'ouverture de la sidebar mobile
- [x] Streaming SSE des réponses de l'agent IA
- [x] Rendu markdown stylisé (marked + DOMPurify)
- [x] Conversations persistantes et reprenables (sidebar)
- [x] Compactage automatique du contexte selon le modèle actif
- [x] Fix crash prod : `send_keys` (texte + Enter séparés, délai) — bracketed-paste de Claude Code
- [x] Timeout sur `ws.recv()` + interception propre des erreurs Cerebras dans le stream
- [x] Switch de compte Claude Code (UI Paramètres + tool agent) avec restart tmux automatique
- [x] Bouton extinction PC (`poweroff` sans sudo, confirmé autorisé par polkit)
- [x] STATE.md / TODO.md / ARBORESCENCE.md créés pour le projet (n'existaient pas avant)
