# ARBORESCENCE — Quart (dépôt ccremote)

Un fichier par ligne, avec sa responsabilité (tirée de son en-tête). Icônes en glob.

```
.env.example                                         variables du relais et du poste (sans valeurs)
.github/workflows/ci.yml                             CI : types (racine et app), tests
.gitignore                                           fichiers non suivis
.prettierrc                                          format du code (120 colonnes)
ARBORESCENCE.md                                      cet index
ARCHITECTURE.md                                      domaines, définitions, frontières
LICENSE                                              AGPL-3.0-or-later
PROJET.md                                            cadrage d'Agent HQ — pourquoi, pour qui, référence, voie, plan par épiques
README.md                                            présentation, stack, ports, lancement
STATE.md                                             état courant, décisions, contexte non évident
TODO.md                                              tâches en cours et à venir
bun.lock                                             verrou du paquet racine
bureau/.gitignore                                    fichiers non suivis de l'app
bureau/bun.lock                                      verrou de l'app de bureau
bureau/construire.sh                                 Construit l'app de bureau en release (à lancer sur la tour : les buil…
bureau/index.html                                    page d'entrée du webview
bureau/installer.sh                                  Installe l'app de bureau Quart sur cette machine (binaire, entrée .de…
bureau/package.json                                  paquet de l'app
bureau/public/favicon.svg                            icône de l’onglet (symbole Echo Agency)
bureau/public/symbol-black.svg                       symbole Echo Agency, version noire
bureau/public/symbol-white.svg                       symbole Echo Agency, version blanche
bureau/public/wordmark.svg                           wordmark Echo Agency (signature discrète)
bureau/src-tauri/Cargo.lock                          verrou Rust de la coquille native
bureau/src-tauri/Cargo.toml                          dépendances Rust de la coquille
bureau/src-tauri/build.rs                            build Tauri
bureau/src-tauri/capabilities/default.json           permissions du webview
bureau/src-tauri/icons/*                             icônes de l'app de bureau (toutes tailles, .icns, .ico)
bureau/src-tauri/src/fichier.rs                      fichiers présentés (images, PDF) enregistrés dans Téléchargements/Quart et ouverts
bureau/src-tauri/src/lib.rs                          Quart — coquille native : l'interface vit dans le webview ; ici seule…
bureau/src-tauri/src/lien.rs                         Ouvrir une page de connexion Claude dans le navigateur de l'utilisate…
bureau/src-tauri/src/main.rs                         point d'entrée natif
bureau/src-tauri/src/terminal.rs                     Ouvrir un kitty attaché à une session Claude (serveur `tmux -L claude…
bureau/src-tauri/tauri.conf.json                     fenêtre, identifiant, bundle
bureau/src/acces/BlocCopie.tsx                       un texte à recopier tel quel (URL, commande) avec son bouton « Copier »
bureau/src/acces/DialogueNouvelAcces.tsx             créer un accès pour Claude (claude.ai ou Claude Code), puis la marche à suivre
bureau/src/acces/Marche.tsx                          la marche à suivre pour brancher Claude sur Quart, avec le jeton montré une fois
bureau/src/acces/VueAcces.tsx                        l'écran « Accès » — appareils et connecteurs Claude, brancher, révoquer
bureau/src/acces/branchement.test.ts                 tests de branchement.ts
bureau/src/acces/branchement.ts                      URL du connecteur, commande Claude Code, libellés et regroupement des accès. Pur
bureau/src/acces/useAcces.ts                         la liste des accès au relais — recharger, créer un connecteur, révoquer
bureau/src/app/App.tsx                               l'assemblage de l'app — connexion, magasin (flux du relais), cadre à…
bureau/src/app/BarreLaterale.tsx                     la barre latérale — sources (sessions, machines, alertes), état du li…
bureau/src/app/Cadre.tsx                             le cadre à trois panneaux — sources, liste, détail — et ce qui les re…
bureau/src/app/ColonneListe.tsx                      la colonne du milieu — la liste de la source choisie (sessions ou ale…
bureau/src/app/PaletteCommandes.tsx                  la palette de commandes (Ctrl+K) — aller à une session, une machine,…
bureau/src/app/navigation.ts                         où l'on est dans l'app — la source choisie dans la barre latérale et…
bureau/src/app/useRaccourcis.ts                      les raccourcis clavier de l'app — palette, nouvelle session, parcours…
bureau/src/appareils/AppareilsOuverts.tsx            appareils ouverts dans l'app — un appareil visité reste monté (caché)
bureau/src/appareils/OngletSessions.tsx              sessions Claude d'un appareil — les voir, en lancer une, s'y attacher
bureau/src/appareils/VueAppareil.tsx                 accès complet à un appareil du parc — fichiers, terminaux, sessions
bureau/src/appareils/api-appareil.ts                 fichiers et terminaux d'un appareil, par l'API du relais
bureau/src/appareils/fichiers/Apercu.tsx             aperçu d'un fichier de l'appareil (image, vidéo, son, PDF, texte)
bureau/src/appareils/fichiers/Editeur.tsx            éditeur de fichiers texte de l'appareil (CodeMirror, Ctrl+S)
bureau/src/appareils/fichiers/Explorateur.tsx        explorateur de fichiers d'un appareil (fil d'Ariane, liste triée)
bureau/src/appareils/fichiers/genre.test.ts          tests de genre.ts
bureau/src/appareils/fichiers/genre.ts               ce qu'on fait d'un fichier selon son nom (afficher, éditer). Pur
bureau/src/appareils/fichiers/useExplorateur.ts      état de l'explorateur (dossier courant, fichier ouvert)
bureau/src/appareils/terminal/TerminalDistant.tsx    terminal à distance — xterm.js relié par WebSocket à un PTY
bureau/src/appareils/terminal/Terminaux.tsx          onglets de terminaux d'un appareil (shells, sessions attachées)
bureau/src/comptes/CarteCompte.tsx                   un compte Claude Code — son usage (fenêtre de 5 h, semaine, plafonds…
bureau/src/comptes/DialogueAjoutCompte.tsx           connecter un compte Claude Code sur une machine — choisir la machine…
bureau/src/comptes/VueComptes.tsx                    la vue d'ensemble des comptes Claude Code du parc — usage de chacun,…
bureau/src/comptes/regroupement.test.ts              tests de regroupement.ts
bureau/src/comptes/regroupement.ts                   la vue d'ensemble des comptes Claude Code — un compte (email) et ses…
bureau/src/comptes/useConnexionCompte.ts             ajouter un compte Claude Code à une machine — lancer la connexion (la…
bureau/src/connexion/EcranConnexion.tsx              l'écran de connexion au relais (adresse + mot de passe) — un petit pa…
bureau/src/connexion/acces.ts                        l'accès mémorisé de l'appareil (adresse du relais + jeton), gardé loc…
bureau/src/echo/BandeauReveil.tsx                    bandeau « sens injoignables » — Chris décide du réveil de la tour
bureau/src/echo/BarreEcho.tsx                        barre du mode Echo — micro, voix, discussion écrite
bureau/src/echo/Contexte.tsx                         contexte de la session d'Echo — jauge, compactions
bureau/src/echo/Discussion.tsx                       tiroir de discussion écrite du mode Echo
bureau/src/echo/Enrolement.tsx                       enregistrement de la voix de Chris (consigne, progression)
bureau/src/echo/Orbe.tsx                             l'orbe d'Echo, objet héros du mode Echo
bureau/src/echo/PanneauOutils.tsx                    outils d'Echo — MCP par machine, état et relance
bureau/src/echo/PastilleVoix.tsx                     empreinte vocale dans la barre du mode Echo
bureau/src/echo/SousTitres.tsx                       sous l'orbe, ce qu'Echo entend et ce qu'elle dit
bureau/src/echo/VueEcho.tsx                          le mode Echo — orbe, cadres, discussion
bureau/src/echo/cadres/Cadres.tsx                    zone des cadres d'Echo — cartes retirables en grille
bureau/src/echo/cadres/rendus.tsx                    rendu d'un cadre d'Echo selon son genre, sans rien exécuter
bureau/src/echo/useEcho.ts                           état du mode Echo — historique, réponse en cours, cadres, réglages
bureau/src/index.css                                 charte Echo Agency : tokens, thèmes clair/night, utilitaires
bureau/src/main.tsx                                  point d'entrée du webview — monte l'app.
bureau/src/parc/VueMachine.tsx                       une machine du parc — état mesuré (tableau), projets, alimentation (r…
bureau/src/sessions/CarteDialogue.tsx                un dialogue du TUI en attente (AskUserQuestion, permission, plan) — l…
bureau/src/sessions/Composeur.tsx                    écrire à une session — Entrée envoie, Maj+Entrée va à la ligne ; repr…
bureau/src/sessions/LectureSeule.tsx                 à la place du compositeur, dire pourquoi on ne peut pas écrire à cett…
bureau/src/sessions/NouvelleSession.tsx              ouvrir une session — où elle tourne, sur quel projet (de n'importe qu…
bureau/src/sessions/VueSession.tsx                   une session choisie — barre d'outils (actions), ligne d'état (context…
bureau/src/sessions/emplacement.ts                   où s'ouvre une session sans projet (~ par défaut). Pur
bureau/src/sessions/fil/ApercuFichiers.tsx           fichiers présentés par un appel d'outil, montrés dans le fil
bureau/src/sessions/fil/ElementSimple.tsx            les événements simples du fil — message de Chris, texte de Claude, ja…
bureau/src/sessions/fil/Fil.tsx                      le fil d'une session — chargé à l'ouverture, prolongé en direct, coll…
bureau/src/sessions/fil/Visionneuse.tsx              image du fil en grand — agrandir, enregistrer, agir
bureau/src/sessions/fil/cartes-outils.tsx            un appel d'outil et un sous-agent dans le fil — une rangée compacte q…
bureau/src/sessions/fil/fichiers-presentes.test.ts   tests de fichiers-presentes.ts
bureau/src/sessions/fil/fichiers-presentes.ts        fichiers qu'un appel d'outil présente à Chris. Pur
bureau/src/sessions/fil/structure.test.ts            tests de structure.ts
bureau/src/sessions/fil/structure.ts                 structurer le fil brut d'une session — chaque résultat rejoint son ou…
bureau/src/sessions/nouvelle-session.test.ts         tests du formulaire d'ouverture de session
bureau/src/sessions/statut.ts                        comment se dit et se montre le statut d'une session.
bureau/src/sessions/useActionsSession.ts             les actions de Chris sur une session, avec l'erreur éventuelle à affi…
bureau/src/sessions/useNouvelleSession.ts            l'état du formulaire d'ouverture — machine, projet joignable depuis e…
bureau/src/shared/api/client.ts                      parler à l'API du relais (HTTP) avec le jeton de l'appareil.
bureau/src/shared/api/flux.ts                        le flux temps réel du relais (WebSocket), reconnecté tout seul, jeton…
bureau/src/shared/etat/contexte.tsx                  exposer le magasin aux composants (contexte React + sélecteur abonné).
bureau/src/shared/etat/magasin.ts                    l'état de l'app (parc, sessions, fils, notifications), tenu à jour pa…
bureau/src/shared/format.ts                          mise en forme des nombres et des durées pour l'interface (français, e…
bureau/src/shared/journal.ts                         le journal de l'app (pino, sortie console du webview).
bureau/src/shared/natif.ts                           ce que seule l'app de bureau sait faire — ouvrir un terminal attaché,…
bureau/src/shared/theme.ts                           le thème de l'app — suivre le système, ou forcer clair / sombre. Mémo…
bureau/src/shared/ui/Bouton.tsx                      les boutons d'outil — icône seule avec bulle d'aide, ou compact avec…
bureau/src/shared/ui/Dialogue.tsx                    le panneau modal de l'app (ouverture de session, confirmations) — sob…
bureau/src/shared/ui/elements.tsx                    petites primitives d'outil — point d'état, jauge fine, bascule, champ…
bureau/src/shared/ui/useDemande.tsx                  nom ou confirmation dans un dialogue de l'app (remplace prompt/confirm)
bureau/tsconfig.json                                 TypeScript de l'app
bureau/vite.config.ts                                Vite + React + Tailwind
commun/api-clients.ts                                le contrat de l'API des clients (app de bureau, iPhone, web) — ce que…
commun/appareil.ts                                   le vocabulaire de l'accès à un appareil du parc — fichiers et terminaux
commun/comptes.ts                                    le vocabulaire des comptes Claude Code d'une machine — identité, usag…
commun/echo.ts                                       ce que Quart relaie d'Echo — copie des seuls champs affichés
commun/journal.ts                                    le logger unique (pino), lisible en terminal, JSON quand la sortie es…
commun/protocole-poste.ts                            les messages échangés entre un poste (machine de travail) et le relai…
commun/reunion.ts                                    vocabulaire de la salle de réunion (HQ) — réunion, messages, participants
commun/session.ts                                    le vocabulaire d'une session Claude Code persistante, partagé par le…
deploiement/deployer.sh                              Déploie ccremote v2 depuis le portable : le relais sur le Pi, un post…
essais/sdk/.gitignore                                fichiers non suivis de l'essai SDK
essais/sdk/RAPPORT.md                                essai : le Claude Agent SDK reproduit-il la config de Claude Code ?
essais/sdk/bun.lock                                  verrou de l'essai SDK
essais/sdk/claudemd.ts                               essai : prise en compte du CLAUDE.md par le SDK
essais/sdk/init.ts                                   essai : requête sans fin, lecture du message d'init
essais/sdk/lib.ts                                    options de base et outils communs aux essais SDK
essais/sdk/multitour.ts                              essai : plusieurs tours dans une même requête
essais/sdk/package.json                              paquet de l'essai SDK
essais/sdk/pilote.ts                                 essai : variables d'environnement épurées, requête simple
essais/sdk/resume.ts                                 essai : reprise d'une session SDK (identifiant, mode de permission)
essais/sdk/session-reelle.ts                         essai réel unique de SessionSdk : un message, un tour, fermeture
essais/sdk/status.ts                                 essai : compteurs d'événements pendant une requête
essais/sdk/tsconfig.json                             configuration TypeScript de l'essai SDK
hq/.env.example                                      source du monde (démo ou relais) et adresse du relais, sans valeurs réelles
hq/.env.production                                   build de production — servi par le relais, se branche sur son origine
hq/.gitignore                                        fichiers non suivis d'Agent HQ
hq/README.md                                         lancement, stack et ports d'Agent HQ
hq/art/DIRECTION.md                                  règles de rendu du monde (direction artistique)
hq/art/gen/objets.tsv                                liste des objets du décor (nom, description) pour la génération
hq/art/gen/ref-marche-dos.png                        référence de marche, vue de dos
hq/art/gen/ref-marche-front.png                      référence de marche, vue de face
hq/art/gen/ref-marche-profil.png                     référence de marche, vue de profil
hq/art/gen/run_marche.sh                             vidéos de marche de Chris (MiniMax H3, fond vert) — argument front | dos
hq/art/gen/run_monde.sh                              génère le bâtiment d'Agent HQ vu en plongée (sans personnage)
hq/art/gen/run_objets.sh                             lance la génération des objets isolés (graine en argument)
hq/art/gen/t2i.py                                    génération texte → image locale d'un objet du décor
hq/art/marche_video.py                               vidéo de marche de Chris → planche de sprites
hq/art/meubles.py                                    recettes des meubles et objets, dans la projection unique du moteur
hq/art/objets.py                                     objets générés en local, découpés et ramenés à la tuile 32 px
hq/art/oblique.py                                    moteur de boîtes — objets faits de boîtes dans LA projection du jeu
hq/art/personnages.py                                planches de Clawd et du perso de Chris (direction, marche, frappe)
hq/art/tuiles.py                                     jeu de tuiles procédural (parquet, herbe, murs, pavés…) → `public/tuiles.png`
hq/bun.lock                                          verrou de l'app Agent HQ
hq/index.html                                        page d'entrée d'Agent HQ (police pixel)
hq/package.json                                      paquet d'Agent HQ (Phaser, Vite, TypeScript)
hq/public/objets.json                                taille et emprise au sol des objets (collisions)
hq/public/objets/*.png                               objets du décor (une image par objet)
hq/public/sprites/persos/*                           planches et `persos.json` de Clawd et du perso de Chris
hq/public/tuiles.json                                nom → index des tuiles
hq/public/tuiles.png                                 une rangée de tuiles du monde
hq/scripts/essai-local.sh                            banc d'essai local isolé d'Agent HQ — relais (base, ports dédiés) et poste
hq/src/donnees/actions.test.ts                       tests des actions : chaque action passe par la bonne route
hq/src/donnees/actions.ts                            actions de Chris sur une session (envoyer, répondre, interrompre, compacter, éteindre, reprendre, archiver)
hq/src/donnees/arbre-demo.ts                         arborescence fictive de la démo (données seules)
hq/src/donnees/bibliotheque.test.ts                  tests de bibliotheque.ts
hq/src/donnees/bibliotheque.ts                       bibliothèque d'une session — fichiers touchés par le fil, frise
hq/src/donnees/chemins.ts                            chemins POSIX absolus d'un poste (fonctions pures)
hq/src/donnees/config.test.ts                        tests du choix de la source (repli sur la démo)
hq/src/donnees/config.ts                             source du monde selon VITE_SOURCE et jeton stocké dans le navigateur
hq/src/donnees/contrat.ts                            miroir typé des contrats de commun/ lus par Agent HQ
hq/src/donnees/demarrage-monde.test.ts               tests du branchement source → magasin
hq/src/donnees/demarrage-monde.ts                    branche une source sur le magasin, resynchronise après coupure
hq/src/donnees/demo-scenario.ts                      scénario de la démo : deux machines, quatre projets, cinq sessions en boucle
hq/src/donnees/demo-simulation.ts                    état des sessions de la démo à un instant (pur)
hq/src/donnees/demo-vivante-plan.ts                  plan de la réponse simulée de la démo vivante (étapes temporisées)
hq/src/donnees/demo-vivante.test.ts                  tests de demo-vivante.ts, horloge et planificateur injectés
hq/src/donnees/demo-vivante.ts                       démo vivante — les sessions touchées par Chris sortent du scénario
hq/src/donnees/demo.test.ts                          tests de la démo : évolution déterministe sur horloge injectée
hq/src/donnees/demo.ts                               source de démonstration : mêmes contrats que le relais, sans réseau
hq/src/donnees/etat-agent.test.ts                    tests de la lecture de l'état d'un agent
hq/src/donnees/etat-agent.ts                         ce que le monde montre d'une session : bloquée, en travail, finie, inactive (pur)
hq/src/donnees/fichiers-demo.ts                      service de fichiers de la démo — copie en mémoire de arbre-demo
hq/src/donnees/fichiers.test.ts                      tests de fichiers.ts (faux fetch, service de démo)
hq/src/donnees/fichiers.ts                           fichiers d'un poste côté monde — lister, lire, écrire, renommer
hq/src/donnees/index.ts                              surface publique du dossier donnees
hq/src/donnees/journal.ts                            journal d'Agent HQ — seul point de sortie console du dossier
hq/src/donnees/monde-etat.test.ts                    tests du magasin : abonnements, fil borné, dédoublonnage
hq/src/donnees/monde-etat.ts                         magasin observable de l'état du monde (machines, sessions, fils, notifications)
hq/src/donnees/monde-selecteurs.ts                   vues dérivées (sessions actives, projets) — pures
hq/src/donnees/ouverture.test.ts                     tests de ouverture.ts
hq/src/donnees/ouverture.ts                          ouvrir une session (embaucher un agent) — validation, appel du relais
hq/src/donnees/reunion.test.ts                       tests de reunion.ts (démo et client du relais)
hq/src/donnees/reunion.ts                            salle de réunion côté HQ — lister, ouvrir, envoyer une demande de Chris
hq/src/donnees/shell-demo.ts                         interpréteur du faux shell de la démo (pur)
hq/src/donnees/source-monde.ts                       contrat de la source de données du monde (relais ou démo)
hq/src/donnees/terminal-demo.test.ts                 tests de terminal-demo.ts et shell-demo.ts
hq/src/donnees/terminal-demo.ts                      terminal de la démo — session interactive simulée
hq/src/donnees/terminal.test.ts                      tests de terminal.ts (faux WebSocket)
hq/src/donnees/terminal.ts                           terminal à distance du monde — shell ou tmux sur un poste
hq/src/donnees/transport-flux.ts                     flux temps réel du relais (WebSocket, sous-protocole, reconnexion)
hq/src/donnees/transport-http.ts                     client HTTP du relais — appels authentifiés, erreurs typées
hq/src/donnees/transport.test.ts                     tests du transport avec faux fetch et faux WebSocket
hq/src/donnees/transport.ts                          source « relais » : assemble le client HTTP et le flux temps réel
hq/src/donnees/vite-env.d.ts                         typage de import.meta.env pour la configuration de la source
hq/src/main.ts                                       démarre le monde dans la page, une fois la police chargée
hq/src/monde/ambiance.ts                             ambiance lumineuse selon l'heure réelle (voile de nuit, halos)
hq/src/monde/carte/chemin.ts                         cases marchables et plus court chemin (A*, pur)
hq/src/monde/carte/plan.ts                           construit la carte depuis les projets (campus, bâtiment, murs, meubles) — pur
hq/src/monde/carte/rendu-carte.ts                    dessine la carte dans Phaser (sol, murs, meubles triés par profondeur)
hq/src/monde/lien-donnees.ts                         relie le monde au modèle — sessions avec bureau, état affiché
hq/src/monde/persos/agent.ts                         un agent (session) incarné par un Clawd selon son état
hq/src/monde/persos/marcheur.ts                      personnage qui marche sur un chemin (Clawd ou Chris)
hq/src/monde/scene-monde.ts                          scène principale : carte, un Clawd par session, Chris jouable, caméra
hq/src/monde/sprites.ts                              charge les ressources exportées par art/ et crée les animations Phaser
hq/src/ui/Panneau.tsx                                cadre commun des panneaux (écran, papier, écran cathodique)
hq/src/ui/Racine.tsx                                 racine de l'interface par-dessus le monde — HUD et panneau ouvert
hq/src/ui/agent/CarteDialogue.tsx                    question en attente d'un agent (question, permission, plan)
hq/src/ui/agent/Composeur.tsx                        champ d'envoi de l'écran d'agent (Entrée envoie, Maj+Entrée saut de ligne)
hq/src/ui/agent/EcranAgent.tsx                       écran d'un agent, ouvert en cliquant sur son Clawd
hq/src/ui/agent/Fil.tsx                              fil d'une session dans l'écran d'agent
hq/src/ui/agent/Touches.tsx                          colonne « ce que l'agent a touché » — fichiers créés ou modifiés
hq/src/ui/agent/agent.css                            styles de l'écran d'agent
hq/src/ui/agent/fil-structure.ts                     fil brut → blocs lisibles pour l'écran d'agent. Pur
hq/src/ui/bus.ts                                     lien monde (Phaser) ↔ interface (React) — quel panneau est ouvert
hq/src/ui/config-relais.ts                           configuration de connexion au relais pour toute l'app (source, adresse, jeton)
hq/src/ui/connexion/Connexion.tsx                    écran de connexion d'Agent HQ — mot de passe du relais
hq/src/ui/connexion/connexion.css                    styles de l'écran de connexion
hq/src/ui/contexte.tsx                               accès de l'interface au modèle de données (magasin, source, actions)
hq/src/ui/fichiers/Arborescence.tsx                  colonne arborescence de la bibliothèque
hq/src/ui/fichiers/EcranFichiers.tsx                 panneau bibliothèque (fichiers d'un poste), sur papier
hq/src/ui/fichiers/Editeur.tsx                       colonne éditeur de la bibliothèque — nom, état, enregistrer
hq/src/ui/fichiers/LigneEntree.tsx                   une ligne de l'arborescence — icône, nom, taille, actions
hq/src/ui/fichiers/SaisieNom.tsx                     saisies en ligne de la bibliothèque — nom, renommage, confirmation
hq/src/ui/fichiers/chemins.ts                        opérations de chemin POSIX du panneau fichiers
hq/src/ui/fichiers/fichiers.css                      styles du panneau bibliothèque
hq/src/ui/fichiers/journal.ts                        journal des incidents du panneau fichiers
hq/src/ui/fichiers/langages.ts                       coloration CodeMirror selon l'extension
hq/src/ui/fichiers/theme-papier.ts                   thème CodeMirror « papier » de la bibliothèque
hq/src/ui/fichiers/use-dossier.ts                    état d'un dossier affiché dans la bibliothèque
hq/src/ui/fichiers/use-editeur.ts                    éditeur CodeMirror d'un fichier — lecture, fichiers illisibles
hq/src/ui/fichiers/use-selection.ts                  fichier ouvert dans l'éditeur, garde des modifications non enregistrées
hq/src/ui/hud/Hud.tsx                                HUD toujours visible au-dessus du monde — lien, agents qui attendent Chris
hq/src/ui/hud/hud.css                                styles du HUD
hq/src/ui/nouvelle/Choix.tsx                         choix du formulaire d'embauche — machine, projet, modèle
hq/src/ui/nouvelle/NouvelleSession.tsx               accueil du bâtiment — embaucher un agent (nouvelle session)
hq/src/ui/nouvelle/nouvelle.css                      styles de l'embauche
hq/src/ui/nouvelle/use-embauche.ts                   état et envoi du formulaire d'embauche
hq/src/ui/panneau.css                                styles du cadre commun des panneaux
hq/src/ui/reunion/FilReunion.tsx                     fil de la réunion courante — demandes de Chris, réponses des agents
hq/src/ui/reunion/Participants.tsx                   participants de la salle de réunion — sessions à cocher
hq/src/ui/reunion/ReunionsPassees.tsx                réunions passées — reprendre ou en commencer une
hq/src/ui/reunion/SalleReunion.tsx                   salle de réunion — Chris parle à plusieurs agents à la fois
hq/src/ui/reunion/reunion.css                        styles de la salle de réunion
hq/src/ui/reunion/use-salle.ts                       état de la salle de réunion — réunions passées, réunion courante
hq/src/ui/terminal/EcranTerminal.tsx                 panneau terminal — poste cathodique, shell à distance
hq/src/ui/terminal/TouchesMobiles.tsx                touches absentes d'un téléphone (Tab, Ctrl+C, Échap, flèches)
hq/src/ui/terminal/journal.ts                        journal des incidents du panneau terminal
hq/src/ui/terminal/terminal.css                      styles du panneau terminal
hq/src/ui/terminal/use-terminal.ts                   xterm.js branché sur une session de terminal (démo ou relais)
hq/src/ui/terminal/xterm-theme.ts                    apparence de xterm.js (phosphore vert)
hq/src/ui/theme.css                                  tokens de couleurs et de typographie d'Agent HQ
hq/tsconfig.json                                     configuration TypeScript d'Agent HQ
hq/vite.config.ts                                    base `/hq/` au build ; proxy de dev vers le relais (côté serveur seulement)
mcp/bin.ts                                           point d'entrée du MCP Quart (stdio) — lit l'adresse du relais et le jeton, branche les outils
mcp/client-relais.ts                                 parler à l'API du relais Quart avec un jeton porteur — le seul point de contact réseau du MCP
mcp/emettre-jeton.ts                                 émettre un jeton d'accès au relais pour le MCP, sans mot de passe — à lancer SUR le Pi
mcp/format.ts                                        rendre l'état du parc et le fil d'une session en texte court, lisible par un agent (pur, testé)
mcp/installer.sh                                     installe le MCP Quart sur une machine et l'enregistre dans Claude Code (niveau utilisateur)
mcp/mcp.test.ts                                      tests du MCP (résolution de projet, format, config, client HTTP)
mcp/outils.ts                                        les outils MCP « quart_* » — ouvrir et piloter des sessions Claude Code sur n'importe quelle machine
package.json                                         paquet racine : relais, poste, commun
poste/bin.ts                                         point d'entrée du poste — assemble config, sessions tmux, socket loca…
poste/comptes/comptes.ts                             les comptes Claude Code du poste — relevé périodique (identité, usage…
poste/comptes/connexion.ts                           connecter un compte Claude Code sur cette machine par OAuth, en deux…
poste/comptes/releve.ts                              relever un compte Claude Code de la machine — identité (`claude auth…
poste/comptes/usage.test.ts                          tests de usage.ts
poste/comptes/usage.ts                               lire la réponse de l'API d'usage OAuth (`/api/oauth/usage`) en fenêtr…
poste/config.ts                                      la configuration d'un poste — fichier JSON local + secret en variable…
poste/fichiers/explorateur.test.ts                   tests de explorateur.ts
poste/fichiers/explorateur.ts                        fichiers de la machine vus depuis Quart — lister, lire/écrire par morceaux, renommer, supprimer
poste/parc/alimentation.ts                           éteindre la machine du poste à la demande de Chris.
poste/parc/etat-machine.ts                           mesurer l'état de la machine (CPU, mémoire, disque, charge) pour le t…
poste/parc/lien-relais.ts                            le lien sortant du poste vers le relais — connexion authentifiée, rec…
poste/projets/decouverte.ts                          lister les projets présents sur la machine (sous-dossiers des racines…
poste/session/adoption.ts                            la fiche d'une session adoptée — lancée hors ccremote, dans tmux ou d…
poste/session/bilan-tour.ts                          bilan d'UN tour d'une session SDK, puis la suite à en tirer (suite-du-tour.ts)
poste/session/claude-tmux.zsh                        lancer chaque `claude` interactif dans `tmux -L claude` (le serveur d…
poste/session/confiance.ts                           approuver un dossier dans la config Claude avant d'y lancer une sessi…
poste/session/consignes.test.ts                      tests de consignes.ts
poste/session/consignes.ts                           le texte ajouté au prompt système Claude Code d'une session (append,…
poste/session/crochet.ts                             script lancé par les hooks de Claude Code — relaie l'événement au pos…
poste/session/dialogue.test.ts                       tests de dialogue.ts
poste/session/dialogue.ts                            les dialogues du TUI qui bloquent une session (AskUserQuestion, permi…
poste/session/faux-sdk.ts                            faux SDK des tests de session-sdk — requête rejouée par un scénario
poste/session/file-messages-sdk.ts                   file asynchrone des messages de Chris pour la requête SDK
poste/session/garde-sous-agents.test.ts              tests de garde-sous-agents.ts
poste/session/garde-sous-agents.ts                   borner les sous-agents d'une session — Sonnet imposé, pas de fork, au…
poste/session/gestionnaire.test.ts                   tests de gestionnaire.ts
poste/session/gestionnaire.ts                        les sessions Claude du poste — découverte dans tmux, ouverture, comma…
poste/session/lanceur.test.ts                        tests de lanceur.ts
poste/session/lanceur.ts                             la ligne de commande `claude` d'une session pilotée par ccremote (lan…
poste/session/mcp-rythme.ts                          serveur MCP stdio des trois outils de rythme d'une session pilotée (é…
poste/session/nuit.test.ts                           politique de réveil du mode nuit, lecture de l'état, fin réussie
poste/session/nuit.ts                                mode nuit vu du poste : état écrit par la config Claude, politique de réveil, bascule
poste/session/options-sdk.test.ts                    tests de options-sdk.ts
poste/session/options-sdk.ts                         options du Claude Agent SDK d'une session (pur)
poste/session/persistance.test.ts                    tests de persistance.ts
poste/session/persistance.ts                         garder sur disque ce que tmux ne sait pas — objectif, autonomie, cons…
poste/session/politique-compaction.test.ts           tests de politique-compaction.ts
poste/session/politique-compaction.ts                décider QUAND compacter une session. Règle pure, sans I/O.
poste/session/processus.ts                           les processus Claude Code vivants de la machine, tels que Claude les…
poste/session/questions-sdk.ts                       AskUserQuestion et ExitPlanMode du SDK rendus en dialogues du poste (pur)
poste/session/reprise.test.ts                        tests de reprise.ts
poste/session/reprise.ts                             au démarrage du poste, reprendre les sessions SDK qui tournaient (jamais les fermées)
poste/session/rythme.test.ts                         tests de rythme.ts
poste/session/rythme.ts                              les trois outils de rythme vus du poste — événement au fil et texte rendu (pur)
poste/session/serveur-local.ts                       le socket Unix local par lequel les crochets et le MCP de rythme des…
poste/session/session-poste.ts                       contrat commun aux deux moteurs (tmux, sdk) vu du gestionnaire
poste/session/session-sdk-reprise.test.ts            tests de la reprise d'une session SDK au démarrage du poste
poste/session/session-sdk.test.ts                    tests de session-sdk.ts
poste/session/session-sdk.ts                         UNE session Claude Code pilotée par le Claude Agent SDK
poste/session/session-tmux.ts                        UNE session Claude Code dans tmux — son fil (lu dans le transcript),…
poste/session/sous-agents.ts                         suivre les sous-agents d'une session — chacun a son transcript dans `…
poste/session/suite-du-tour.test.ts                  tests de suite-du-tour.ts
poste/session/suite-du-tour.ts                       décider ce qui suit la fin d'un tour — attendre Chris, compacter, rel…
poste/session/suivi-dialogue.ts                      le dialogue en attente d'UNE session, relevé à l'écran de son pane, e…
poste/session/suivi-nuit.test.ts                     suivi nuit : publication, réveil, abandon, session au travail
poste/session/suivi-nuit.ts                          le suivi du mode nuit d'UNE session : publier, réveiller, prévenir de la fin
poste/session/tmux.conf                              config du serveur tmux dédié aux Claude
poste/session/tmux.ts                                parler au serveur tmux dédié aux Claude (`tmux -L claude`, socket via CCREMOTE_TMUX_SOCKET)
poste/session/traduction-sdk.test.ts                 tests de traduction-sdk.ts
poste/session/traduction-sdk.ts                      message du SDK → événements du fil et fin de tour (pur)
poste/session/traduction.test.ts                     tests de traduction.ts
poste/session/traduction.ts                          traduire une ligne du transcript JSONL de Claude Code en événements d…
poste/session/transcript.ts                          lire un transcript JSONL de Claude Code au fil de l'eau, et retrouver…
poste/terminal/terminaux.test.ts                     tests de terminaux.ts
poste/terminal/terminaux.ts                          terminaux à distance : un PTY par terminal, sortie vers le relais
relais/acces/acces.test.ts                           tests de acces.ts (échecs par IP et global, plafond persistant)
relais/acces/acces.ts                                qui a le droit de parler au relais — mot de passe, jetons révocables,…
relais/acces/api-acces.ts                            routes de gestion des accès (lister, créer, révoquer), réservées aux appareils
relais/acces/plafond.ts                              plafond global d'échecs de connexion, conservé sur disque
relais/appareils/api-fichiers.ts                     fichiers d'un appareil par l'API des clients — transmis au poste
relais/appareils/route-terminal.ts                   ouverture d'un terminal à distance — authentifier, valider, WebSocket
relais/appareils/terminaux.ts                        terminaux à distance côté relais — WebSocket client relié à un PTY de poste
relais/bin.ts                                        point d'entrée du relais — deux serveurs : clients (web, iPhone) et p…
relais/clients/api-comptes.ts                        les routes des comptes Claude Code d'une machine — connexion OAuth en…
relais/clients/api-sessions.ts                       les routes des sessions — ouvrir, lire le fil, parler, piloter (inter…
relais/clients/api.ts                                la table des routes de l'API des clients (web, iPhone), toutes protég…
relais/clients/cors.ts                               autoriser l'app de bureau (origine Tauri) et le serveur de dev à appe…
relais/clients/diffusion.ts                          pousser en direct ce qui change vers les clients (web en WebSocket, i…
relais/clients/hq.ts                                 routes d'Agent HQ servies sous /hq/ — publiques, l'API reste protégée
relais/clients/http.ts                               les petites briques HTTP communes aux routes (réponses JSON, lecture…
relais/clients/statique.test.ts                      tests de statique.ts
relais/clients/statique.ts                           servir un dossier statique (bureau, Agent HQ) — jamais un chemin hors du dossier
relais/config.ts                                     la configuration du relais, lue exclusivement dans l'environnement (a…
relais/connecteurs/mcp-http.test.ts                  tests de mcp-http.ts et des routes d'accès
relais/connecteurs/mcp-http.ts                       le MCP « quart » servi en HTTP pour claude.ai (/mcp/<jeton>) et Claude Code (/mcp + Bearer)
relais/echo/api-echo.ts                              routes Echo des clients — parler, interrompre, relire, savoir si Echo répond
relais/echo/lien-echo.ts                             lien du relais vers Echo, relayé dans le flux des clients
relais/notifications/regles.ts                       quels événements méritent une notification, et laquelle. Pur.
relais/parc/postes.ts                                les postes connectés au relais — authentification, comptes rendus reç…
relais/parc/reveil.test.ts                           tests de reveil.ts
relais/parc/reveil.ts                                réveiller une machine éteinte par Wake-on-LAN (paquet magique en diff…
relais/registre/archivage.test.ts                    tests de l'archivage : archiver ferme d'abord, désarchiver sans poste
relais/registre/base.ts                              la base SQLite du relais et ses migrations (numérotées, jamais réécri…
relais/registre/registre.ts                          lire et écrire l'état du relais — machines, sessions, fil d'événement…
relais/registre/retention.test.ts                    tests de retention.ts
relais/registre/retention.ts                         rétention du fil — purger les événements des sessions fermées depuis…
relais/reunion/api-reunions.test.ts                  tests de api-reunions.ts
relais/reunion/api-reunions.ts                       routes de la salle de réunion — créer ou poursuivre, lister, lire
relais/reunion/destinataires.test.ts                 tests de destinataires.ts
relais/reunion/destinataires.ts                      qui reçoit une demande de Chris (routage « auto » v1, sans modèle)
relais/reunion/messages.test.ts                      tests de messages.ts
relais/reunion/messages.ts                           textes purs de la salle — sujet, enveloppe des demandes
relais/reunion/registre-reunions.ts                  persistance des réunions dans la base SQLite du relais
relais/reunion/salle.test.ts                         tests de salle.ts
relais/reunion/salle.ts                              salle du relais — crée ou poursuit, choisit les destinataires, relaie
relais/sessions/composition-parc.test.ts             tests de composition-parc.ts
relais/sessions/composition-parc.ts                  ce qu'une session a le droit de joindre depuis sa machine. Pur.
relais/sessions/inactivite.test.ts                   tests de inactivite.ts
relais/sessions/inactivite.ts                        règle d'inactivité d'une session (pure) — tour fini et silence depuis le seuil
relais/sessions/recalcul-inactivite.test.ts          tests de recalcul-inactivite.ts
relais/sessions/recalcul-inactivite.ts               recalcul périodique de l'inactivité (1 min), diffusion des seuls changements
restart.sh                                           arrête puis relance le mode dev
scripts/ci/local-ci.sh                               rejoue ci.yml dans Docker (repli quand GitHub Actions est indisponible)
start.sh                                             Mode dev : relais local (variables de .env) + interface de l'app (Vit…
stop.sh                                              Arrête le relais local et l'interface de dev lancés par start.sh.
tsconfig.json                                        TypeScript strict (relais, poste, commun)
```
