# ARBORESCENCE — ccremote v2

Un fichier par ligne, avec sa responsabilité (tirée de son en-tête).

```
.env.example                                         variables du relais et du poste (sans valeurs)
.gitignore                                           fichiers non suivis
.prettierrc                                          format du code (120 colonnes)
ARBORESCENCE.md                                      cet index
ARCHITECTURE.md                                      domaines, définitions, frontières
LICENSE                                              AGPL-3.0-or-later
README.md                                            présentation, stack, ports, lancement
STATE.md                                             état courant, décisions, contexte non évident
TODO.md                                              tâches en cours et à venir
bureau/.gitignore                                    fichiers non suivis de l'app
bureau/construire.sh                                 Construit l'app de bureau en release (à lancer sur la tour : les builds lourds n'ont pas l
bureau/index.html                                    page d'entrée du webview
bureau/installer.sh                                  Installe l'app de bureau ccremote sur cette machine (binaire, entrée .desktop, icônes). Id
bureau/package.json                                  paquet de l'app
bureau/src-tauri/Cargo.toml                          dépendances Rust de la coquille
bureau/src-tauri/build.rs                            build Tauri
bureau/src-tauri/capabilities/default.json           permissions du webview
bureau/src-tauri/src/lib.rs                          ccremote — coquille native : l'interface vit dans le webview ; ici seulement ce qu'un navi
bureau/src-tauri/src/main.rs                         point d'entrée natif
bureau/src-tauri/src/terminal.rs                     Ouvrir un kitty attaché à une session Claude (serveur `tmux -L claude`), sur cette machine
bureau/src-tauri/tauri.conf.json                     fenêtre, identifiant, bundle
bureau/src/app/App.tsx                               l'assemblage de l'app — connexion, magasin, navigation entre les vues.
bureau/src/app/BarreLaterale.tsx                     la barre latérale night — marque, navigation, état du lien et des machines.
bureau/src/connexion/EcranConnexion.tsx              l'écran de connexion au relais (adresse + mot de passe).
bureau/src/connexion/acces.ts                        l'accès mémorisé de l'appareil (adresse du relais + jeton), gardé localement.
bureau/src/index.css                                 charte Echo Agency : tokens, thèmes clair/night, utilitaires
bureau/src/main.tsx                                  point d'entrée du webview — monte l'app.
bureau/src/notifications/VueNotifications.tsx        ce qui mérite l'attention de Chris — objectifs atteints, questions, erreurs, étapes.
bureau/src/parc/VueParc.tsx                          le parc — chaque machine, son état mesuré, ses sessions, et son alimentation (réveil, exti
bureau/src/sessions/Composeur.tsx                    écrire à une session — Entrée envoie, Maj+Entrée va à la ligne ; reprend une session fermé
bureau/src/sessions/EspaceSessions.tsx               l'espace de travail des sessions — liste, session choisie, ouverture d'une nouvelle.
bureau/src/sessions/ListeSessions.tsx                la colonne des sessions du parc, regroupées par machine, filtrables (actives / toutes).
bureau/src/sessions/NouvelleSession.tsx              ouvrir une session — où elle tourne, sur quel projet (de n'importe quelle machine joignabl
bureau/src/sessions/VueSession.tsx                   une session ouverte — en-tête (état, contexte, actions), fil, compositeur.
bureau/src/sessions/fil/ElementSimple.tsx            le rendu des événements simples du fil — messages, texte de Claude, jalons, signaux.
bureau/src/sessions/fil/Fil.tsx                      le fil d'une session — chargé à l'ouverture, prolongé en direct, collé en bas tant qu'on y
bureau/src/sessions/fil/cartes-outils.tsx            le rendu d'un appel d'outil et d'un sous-agent dans le fil, dépliables pour tout voir.
bureau/src/sessions/fil/structure.test.ts            tests de structure.ts
bureau/src/sessions/fil/structure.ts                 structurer le fil brut d'une session — chaque résultat rejoint son outil, chaque sous-agen
bureau/src/sessions/statut.ts                        comment se dit et se montre le statut d'une session.
bureau/src/sessions/useActionsSession.ts             les actions de Chris sur une session, avec l'erreur éventuelle à afficher.
bureau/src/sessions/useNouvelleSession.ts            l'état du formulaire d'ouverture — machine, projet joignable depuis elle, envoi au relais.
bureau/src/shared/api/client.ts                      parler à l'API du relais (HTTP) avec le jeton de l'appareil.
bureau/src/shared/api/flux.ts                        le flux temps réel du relais (WebSocket), reconnecté tout seul, jeton en sous-protocole.
bureau/src/shared/etat/contexte.tsx                  exposer le magasin aux composants (contexte React + sélecteur abonné).
bureau/src/shared/etat/magasin.ts                    l'état de l'app (parc, sessions, fils, notifications), tenu à jour par le flux du relais.
bureau/src/shared/format.ts                          mise en forme des nombres et des durées pour l'interface (français, espaces insécables).
bureau/src/shared/journal.ts                         le journal de l'app (pino, sortie console du webview).
bureau/src/shared/natif.ts                           ce que seule l'app de bureau sait faire — ouvrir un terminal attaché, notifier le système.
bureau/src/shared/ui/Bouton.tsx                      les boutons de l'app — plein à relief (action principale), fantôme, discret (icône).
bureau/src/shared/ui/Dialogue.tsx                    la fenêtre modale de l'app (ouverture de session, confirmations).
bureau/src/shared/ui/elements.tsx                    petites primitives visuelles — jauge, bascule, point d'état, tag, champ.
bureau/tsconfig.json                                 TypeScript de l'app
bureau/vite.config.ts                                Vite + React + Tailwind
commun/api-clients.ts                                le contrat de l'API des clients (app de bureau, iPhone, web) — ce que le relais rend et po
commun/journal.ts                                    le logger unique (pino), lisible en terminal, JSON quand la sortie est un fichier.
commun/protocole-poste.ts                            les messages échangés entre un poste (machine de travail) et le relais du Pi.
commun/session.ts                                    le vocabulaire d'une session Claude Code persistante, partagé par le poste, le relais et l
deploiement/deployer.sh                              Déploie ccremote v2 depuis le portable : le relais sur le Pi, un poste par machine.
package.json                                         paquet racine : relais, poste, commun
poste/bin.ts                                         point d'entrée du poste — assemble config, sessions tmux, socket local, sonde et lien au r
poste/config.ts                                      la configuration d'un poste — fichier JSON local + secret en variable d'environnement.
poste/parc/alimentation.ts                           éteindre la machine du poste à la demande de Chris.
poste/parc/etat-machine.ts                           mesurer l'état de la machine (CPU, mémoire, disque, charge) pour le tableau de bord.
poste/parc/lien-relais.ts                            le lien sortant du poste vers le relais — connexion authentifiée, reconnexion, file d'atte
poste/projets/decouverte.ts                          lister les projets présents sur la machine (sous-dossiers des racines qui ressemblent à un
poste/session/confiance.ts                           approuver un dossier dans la config Claude avant d'y lancer une session à distance.
poste/session/consignes.test.ts                      tests de consignes.ts
poste/session/consignes.ts                           le texte ajouté au prompt système Claude Code d'une session (append, jamais remplacé).
poste/session/crochet.ts                             script lancé par les hooks de Claude Code — relaie l'événement au poste et rend sa décisio
poste/session/garde-sous-agents.test.ts              tests de garde-sous-agents.ts
poste/session/garde-sous-agents.ts                   borner les sous-agents d'une session — Sonnet imposé, pas de fork, au plus N par étape.
poste/session/gestionnaire.ts                        les sessions Claude du poste — découverte dans tmux, ouverture, commandes du relais, croch
poste/session/lanceur.ts                             la ligne de commande `claude` d'une session pilotée par ccremote (lancement ou reprise).
poste/session/mcp-rythme.ts                          serveur MCP stdio des trois outils de rythme d'une session pilotée (étape, fin, question).
poste/session/persistance.ts                         garder sur disque ce que tmux ne sait pas — objectif, autonomie, consignes, position de le
poste/session/politique-compaction.test.ts           tests de politique-compaction.ts
poste/session/politique-compaction.ts                décider QUAND compacter une session. Règle pure, sans I/O.
poste/session/serveur-local.ts                       le socket Unix local par lequel les crochets et le MCP de rythme des sessions joignent le
poste/session/session-tmux.ts                        UNE session Claude Code dans tmux — son fil (lu dans le transcript), ses commandes (via tm
poste/session/sous-agents.ts                         suivre les sous-agents d'une session — chacun a son transcript dans `<session>/subagents/`
poste/session/suite-du-tour.test.ts                  tests de suite-du-tour.ts
poste/session/suite-du-tour.ts                       décider ce qui suit la fin d'un tour — attendre Chris, compacter, relancer l'agent ou s'ar
poste/session/tmux.conf                              config du serveur tmux dédié aux Claude
poste/session/tmux.ts                                parler au serveur tmux dédié aux Claude (`tmux -L claude`), le même que relais et Atrium :
poste/session/traduction.test.ts                     tests de traduction.ts
poste/session/traduction.ts                          traduire une ligne du transcript JSONL de Claude Code en événements du fil. Pur, sans I/O.
poste/session/transcript.ts                          lire un transcript JSONL de Claude Code au fil de l'eau, et retrouver celui d'une session
relais/acces/acces.ts                                qui a le droit de parler au relais — mot de passe, jetons révocables, limite de tentatives
relais/bin.ts                                        point d'entrée du relais — deux serveurs : clients (web, iPhone) et postes (machines de tr
relais/clients/api-sessions.ts                       les routes des sessions — ouvrir, lire le fil, parler, piloter (interrompre, compacter, fe
relais/clients/api.ts                                la table des routes de l'API des clients (web, iPhone), toutes protégées sauf la connexion
relais/clients/cors.ts                               autoriser l'app de bureau (origine Tauri) et le serveur de dev à appeler l'API du relais.
relais/clients/diffusion.ts                          pousser en direct ce qui change vers les clients (web en WebSocket, iPhone en long-poll).
relais/clients/http.ts                               les petites briques HTTP communes aux routes (réponses JSON, lecture validée du corps).
relais/config.ts                                     la configuration du relais, lue exclusivement dans l'environnement (aucune valeur réelle d
relais/notifications/regles.ts                       quels événements méritent une notification, et laquelle. Pur.
relais/parc/postes.ts                                les postes connectés au relais — authentification, comptes rendus reçus, commandes envoyée
relais/parc/reveil.test.ts                           tests de reveil.ts
relais/parc/reveil.ts                                réveiller une machine éteinte par Wake-on-LAN (paquet magique en diffusion UDP).
relais/registre/base.ts                              la base SQLite du relais et ses migrations (numérotées, jamais réécrites).
relais/registre/registre.ts                          lire et écrire l'état du relais — machines, sessions, fil d'événements, notifications, jet
relais/sessions/composition-parc.test.ts             tests de composition-parc.ts
relais/sessions/composition-parc.ts                  ce qu'une session a le droit de joindre depuis sa machine. Pur.
restart.sh                                           arrête puis relance le mode dev
start.sh                                             Mode dev : relais local (variables de .env) + interface de l'app (Vite, http://localhost:1
stop.sh                                              Arrête le relais local et l'interface de dev lancés par start.sh.
tsconfig.json                                        TypeScript strict (relais, poste, commun)
bureau/src-tauri/icons/                              icônes de l'app (générées depuis le symbole Echo Agency)
bureau/public/                                       wordmark et symboles Echo Agency
```
