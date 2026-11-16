# Agent HQ — univers « station spatiale »

*Vision et règles du monde, v2. Rédigé le 16/11/2026. Le visuel (murs, palette, échelle, sprites) est dans
`direction-artistique.md` ; ce document dit ce que le monde montre, pourquoi, et d'où vient chaque information.*

Trois lois, qui priment sur tout le reste :

1. **Le monde ne ment jamais.** Un Clawd qui bouge correspond à une session vivante, et son geste dit son état réel.
   Tout ce qui est décoratif (vie, saleté, drones) ne peut pas être pris pour un état.
2. **Chaque geste rend Chris plus rapide que Desktop.** Toute information utile se lit sans clic, et toute action
   courante se fait en un ou deux gestes. Le jeu ne fait jamais attendre : aucune marche ne retarde l'ouverture
   d'un panneau.
3. **La carte ne bouge pas toute seule.** Un compartiment garde sa place, son anneau et ses voisins. Seul Chris
   réaménage.

---

## 1. Principe et boucle de jeu

**Le principe.** Une station spatiale octogonale vue de dessus. Au centre, la salle de commandement : une table
ronde et des écrans. Autour, des anneaux complets : un anneau par catégorie de projets. Chaque anneau est découpé en
compartiments : un compartiment par projet, avec tout ce qu'il faut pour y travailler (postes des agents, console,
bibliothèque, terminal, tableau d'objectifs). Chaque session Claude Code vivante est un Clawd assis à un poste de
son projet. Les sous-agents travaillent dans une nacelle amarrée au compartiment de leur orchestrateur.

**En 10 secondes** (ouverture de l'app, souvent au téléphone) :
- La station s'affiche en vue d'ensemble. Les compartiments ont des balises : rouge (une session t'attend,
  bloquée), ambre (une session a fini et attend la suite), vert qui pulse (au travail). La mini-carte montre la même
  chose.
- Le bouton **« À toi (3) »** (touche `Espace` sur PC) ouvre directement la plus ancienne session qui t'attend. La
  caméra file vers son compartiment (400 ms) pendant que le panneau s'ouvre. Tu réponds (choix du dialogue en un
  tap), puis `Espace` passe à la suivante.
- Pour une question simple, tu peux répondre sans ouvrir le panneau : au zoom compartiment, les options du dialogue
  sont des boutons sous la bulle du Clawd.

**En 2 minutes** :
- Tu passes dans un compartiment : le tableau montre l'objectif et les dernières étapes, la nacelle montre où en
  sont les sous-agents (« 12 lancés · 7 ✓ · 1 ✗ »), les papiers sur les bureaux montrent les conclusions que tu
  n'as pas encore lues.
- Tu embauches un agent (poste libre → mission → modèle → autonomie), ou tu en rallumes un depuis sa capsule.
- Tu vas à la salle centrale, tu sélectionnes trois sessions et tu leur envoies un message groupé. Elles viennent
  à la table et répondent dans des bulles.

**Sur une journée** :
- Le matin, le bilan de la nuit (scénario 8.1). Dans la journée, la boucle « À toi » et quelques visites de
  compartiments. Le soir, tu lances les sessions de nuit depuis la salle centrale (écran Nuit) et tu éteins les
  inactives (capsules).
- La station garde des traces de la journée : poubelles pleines là où ça a beaucoup travaillé, cendres au coin
  fumeur, tasses au café. Les agents désœuvrés nettoient. Tu lis l'activité d'un coup d'œil sans ouvrir un seul
  fil.

---

## 2. Géométrie et génération de la station

### 2.1 Unités

- Case = 16 px d'art affichés ×2 = 32 px (règle de `hq/art/DIRECTION.md`). Toutes les mesures ci-dessous sont en
  cases.
- Clawd marche à 70 px/s, soit environ 2,2 cases/s (`Marcheur`). Une station de 130 cases de large ne se traverse
  donc pas à pied : voir les tubes (2.6).

### 2.2 Forme : octogones concentriques

- **Salle centrale** : octogone d'apothème 8 (16 cases de large). Table ronde au centre (8 places assises), un écran
  sur chacun des 8 murs, dont un est remplacé par le sas principal.
- **Vide** de 2 cases entre deux anneaux. On y voit les étoiles et les sas, qui le traversent comme des tubes. C'est
  ce vide qui rend la station lisible : on voit bien où finit chaque anneau.
- **Anneau à une rangée** (12 cases d'épaisseur) : mur, **coursive** de 3 cases côté intérieur (c'est par là qu'on
  marche), compartiments de 7 cases de profondeur, mur extérieur avec hublots.
- **Anneau à deux rangées** (20 cases) : compartiments, coursive au milieu, compartiments. Réservé aux catégories de
  plus de 8 projets actifs. C'est la « largeur variable » : l'épaisseur d'un anneau dit le poids de sa catégorie.
- **Côtés** : 4 côtés droits (horizontaux et verticaux) et 4 côtés diagonaux à 45°. Sur un côté diagonal, le mur
  extérieur est en escalier (une case par case), mais le sol et les meubles restent sur la grille. Le traitement
  graphique des diagonales revient à la DA.
- **Coins** : les 8 coins de chaque anneau ne reçoivent jamais de compartiment de projet. Ils accueillent les sas,
  les îlots ou des modules techniques (réservoirs, antennes, serre). C'est la première source d'asymétrie.

Capacité indicative (anneau à une rangée, coins réservés, unité de placement = 5 cases d'arc) :

| Anneau | Apothème intérieur | Longueur d'un côté (ligne médiane) | Compartiments max |
|---|---|---|---|
| 1 | 10 | ~14 | 8 (un par côté) |
| 2 | 24 | ~26 | 16 |
| 3 | 38 | ~38 | 24 |
| 4 | 52 | ~49 | 32 |
| 5 | 66 | ~61 | 40 |

Cinq anneaux à une rangée donnent environ 120 compartiments, sur un diamètre d'environ 160 cases (5 100 px).
25 projets actifs n'en occupent qu'un cinquième.

### 2.3 Compartiments

- **Trois tailles**, fixées au moment de l'amarrage d'après l'historique du projet (nombre maximal de sessions
  simultanées sur 30 jours) :
  S = 2 unités (9 cases utiles, 3 postes) ; M = 3 unités (14 cases, 5 postes) ; L = 4 unités (19 cases, 8 postes).
- **Contenu fixe d'un compartiment** (toujours au même endroit, dans le repère local du compartiment, porte en
  bas, côté coursive) :
  - postes des agents alignés contre le mur du fond ;
  - **console du projet** près de la porte : liste des sessions du projet, bouton Embaucher, fil du projet ;
  - **bibliothèque** sur un mur latéral : artefacts créés et modifiés (la v1 `bibliotheque.ts`) ; elle s'allume
    quand il y a du nouveau ;
  - **terminal** (baie ou vieux cathodique) sur l'autre mur latéral : xterm dans le dossier du projet, sur la
    machine choisie ;
  - **tableau d'objectifs** au mur : objectif de la session principale, dernières étapes, cases de `TODO.md` ;
  - **capsules** (1 à 3 couchettes cryogéniques) : les sessions éteintes récentes du projet (voir 3) ;
  - **sas de nacelle** sur le mur extérieur : la nacelle des sous-agents s'y amarre quand il y en a ;
  - une poubelle, une plante ou un objet propre au projet (manette pour un jeu, carton pour un client).
- **Plus de sessions que de postes** : un bureau d'appoint pliant se déplie dans l'espace réservé (2 au plus).
  Au-delà, les Clawds en trop travaillent debout à la console. Le compartiment ne s'agrandit jamais tout seul.
- **Agrandissement** : si un projet a dépassé ses postes trois jours différents, le tableau affiche « à agrandir ».
  Chris accepte en un tap ; le compartiment absorbe alors l'emplacement libre voisin s'il existe (sinon on lui
  propose de déménager). Rien d'autre ne bouge.

### 2.4 Placement asymétrique et stable

Tout placement est **calculé une fois, puis enregistré** dans le relais. Le monde ne le recalcule jamais à partir
des sessions vivantes (aujourd'hui, `scene-monde.ts` reconstruit la carte dès que la liste des sessions change : c'est
précisément ce qui disparaît).

- **Graine** : chaque anneau a une graine (hash de l'id de sa catégorie). Les tirages de sas, d'îlots et de modules
  techniques en dépendent : même station, même tirage, sur tous les appareils.
- **Sas entre deux anneaux** (y compris entre la salle centrale et l'anneau 1) : 2 + ⌊k/2⌋ sas sur la frontière de
  l'anneau k (2, 3, 3, 4, 4). Contraintes du tirage :
  - au moins 70° entre deux sas d'une même frontière ;
  - au moins 30° entre un sas et tout sas de la frontière voisine, pour qu'aucun chemin ne file droit au centre
    (pas de croix de couloirs) ;
  - un sas sur deux est placé dans un coin, les autres en milieu de côté ;
  - le tube d'un sas peut faire un coude d'une case : les chemins se baladent.
- **Îlots non-projet** (sur les coins et les emplacements libres) :

  | Îlot | Nombre | Rôle réel | Règle de placement |
  |---|---|---|---|
  | Salle des machines | 1 | baies tour / portable / VPS / Pi : en ligne, CPU, réveil (`reveilPossible`) | anneau 1 ou 2, coin |
  | Réglages | 1 | comptes Claude, accès, apparence | anneau 1, coin |
  | Cale (archives) | 1 | sessions éteintes depuis plus de 24 h et archivées : chercher, rallumer | anneau extérieur, coin |
  | Quai d'arrivée | 1 | projets pas encore rangés, navette de Chris | bout du sas principal, hors anneaux |
  | Café | 1 par anneau de 4 projets et plus | lieu de pause des inactifs | coin tiré au sort |
  | Coin fumeur | 2 à 3 dans la station | lieu de pause, cendres | à côté d'un sas avec hublot |
  | Local de nettoyage | 1 par anneau | balais, chariot, poubelles de tri | emplacement libre |
  | Modules techniques | le reste | réservoirs, serre, antenne : pur décor | coins et emplacements libres |

  Un anneau sans café ni fumoir est volontaire : ses inactifs vont au plus proche, ce qui fait circuler du monde.
- **Amarrage d'un compartiment** : parmi les emplacements libres de son anneau, celui qui minimise la distance au
  sas le plus proche, avec départage par la graine. Un nouveau projet arrive donc près des passages, et la
  périphérie se remplit ensuite.

### 2.5 Stabilité : la règle complète

- **Stabilité = même anneau, même secteur angulaire, mêmes voisins.** C'est ce que la mémoire spatiale retient.
- Une session qui démarre, s'arrête ou se ferme ne change que l'occupation d'un poste, jamais le plan.
- Un projet sans session depuis 45 jours passe **en veille** : lumières éteintes, porte fermée, toujours à sa place.
- **Désamarrer** (action de Chris) libère l'emplacement, qui reste vide (module « libre », échafaudage) jusqu'au
  prochain amarrage. Le vide ne se tasse jamais.
- **Nouvelle catégorie** : toujours un nouvel anneau à l'extérieur. On n'insère jamais d'anneau entre deux autres.
- **Anneau plein** : si une catégorie à une rangée n'a plus de place, elle passe à deux rangées au prochain
  réaménagement validé par Chris. Les anneaux extérieurs s'éloignent alors de 8 cases, mais chaque compartiment garde
  son angle et ses voisins : la carte mentale tient.
- Réordonner les anneaux ou renommer une catégorie : seulement depuis l'îlot Réglages, avec aperçu avant/après.

### 2.6 Croissance et circulation

- **Nouveau projet** (première session sur un dossier inconnu) : la session démarre tout de suite dans un **conteneur
  temporaire** amarré au Quai, avec son Clawd. Chris n'attend jamais le rangement. Le conteneur affiche la catégorie
  suggérée. Un tap pour accepter, ou un glisser vers un autre anneau, et le compartiment s'amarre. Sans décision
  après 24 h, il reste au Quai (pas de rangement automatique : c'est le choix de Chris qui structure la station).
- **Tubes** : chaque sas contient une navette pneumatique. Une règle pour toute la station : **aucun trajet affiché ne
  dure plus de 6 s**. Au-delà, le personnage marche jusqu'au sas le plus proche, entre dans le tube (fondu de 0,5 s)
  et ressort au sas le plus proche de sa destination. Cette règle vaut pour Chris et pour les Clawds.

### 2.7 Limites (25 projets et plus)

- **Rendu** : vue d'ensemble = une texture précalculée de toute la station au quart de l'échelle, refaite seulement
  quand le plan change, avec les balises d'état en surimpression dynamique. Aux zooms supérieurs, on ne dessine que
  ce qui est dans la caméra. On n'anime que les personnages visibles ; hors champ, seul leur état logique est tenu à
  jour.
- **Plafond des Clawds simultanés à l'écran** : pas de plafond logique. Au-delà de 40 sessions vivantes, la vue
  d'ensemble les montre en points ; le détail apparaît au zoom anneau. Le plafond actuel de 40 sessions
  (`SESSIONS_MAX`) disparaît, puisque les éteintes ne prennent plus de poste.
- **Projets du disque** : `/mnt/projects` compte environ 200 dossiers (forks, essais, `tetris-v2`…`v14`). Seuls ont un
  compartiment les projets amarrés par Chris. Le premier remplissage propose ceux qui ont eu une session ces 30
  derniers jours (environ 25).

### 2.8 Navigation rapide (PC et téléphone)

| Geste | PC | Téléphone |
|---|---|---|
| Se déplacer | glisser (clic gauche sur le vide, ou espace maintenu) | glisser un doigt |
| Zoomer | molette, ou `+`/`-` | pincer ; double tap = zoom sur ce point |
| Trois paliers aimantés | vue d'ensemble (×0,15) / anneau (×0,5) / compartiment (×1) | idem |
| Aller à un compartiment | clic dessus (zoom) | tap dessus |
| Ouvrir une session | clic sur son Clawd | tap sur son Clawd (panneau plein écran) |
| Aller n'importe où | `Ctrl+K` : palette sessions / projets / îlots, la caméra file en 600 ms | loupe en haut |
| Prochaine session qui t'attend | `Espace` | gros bouton flottant « À toi (n) » |
| Salle centrale | `Origine` ou `C` | bouton « Centre » |
| Mini-carte | coin bas droit, 160 px, toujours visible | bouton qui l'affiche ou la masque |
| Actions d'un compartiment | clic droit | appui long |

- **La caméra est libre.** Le personnage de Chris n'est pas une manette obligatoire : il montre où Chris est
  présent (la session dont le panneau est ouvert, ou la salle centrale). Il s'y téléporte par tube si c'est loin. On
  peut aussi le promener au clavier (ZQSD ou flèches) pour le plaisir ou pour balayer.
- **Mini-carte** : octogones concentriques, une pastille par compartiment, couleur du pire état présent (rouge >
  erreur > ambre > travail > inactif > veille), un point blanc pour Chris. Tap = la caméra y va.

---

## 3. Table des états et des comportements

### 3.1 Règle de vérité (préalable à tout le reste)

Une session n'a de Clawd animé que si elle est **vivante**, c'est-à-dire si les trois conditions suivantes sont
vraies :
- sa machine est en ligne (`VueMachine.enLigne`, déjà présent dans `EtatRelais` mais ignoré par HQ aujourd'hui) ;
- son statut n'est pas `fermee` ;
- le poste l'a confirmée depuis sa dernière connexion.

**Pourquoi des sessions mortes depuis des jours paraissent aujourd'hui « en attente » ou fument dehors** (vérifié dans
le code) :
1. `relais/parc/postes.ts` → `bonjour()` enregistre les sessions que le poste annonce, mais **ne ferme jamais celles
   qu'il n'annonce plus**. Si un poste redémarre ou si la machine s'éteint pendant qu'une session était `attente`,
   celle-ci reste `attente` pour toujours dans la base.
2. `ferme()` (poste déconnecté) ne touche pas aux sessions, et HQ ne croise pas leur statut avec `enLigne`.
3. `etatAgent()` transforme toute session `attente` de plus de 30 min en `inactive`, et `Agent.changerEtat` envoie
   les inactives fumer. Une session fantôme devient donc un fumeur éternel.
4. Une session adoptée hors tmux (`terminal: true`) naît en `attente` (`ficheAdoptee`), et rien ne garantit qu'elle
   repasse en `fermee` quand son terminal disparaît.

**Correctifs à faire côté données (étape A, avant tout visuel)** :
- relais : à chaque `bonjour`, passer en `fermee` toute session de cette machine absente de la liste annoncée
  (réconciliation), avec un événement `relance`/`erreur` explicatif dans le fil ;
- HQ : dérivé `joignable = machine.enLigne`. Une session non joignable n'est jamais montrée active ;
- poste : vérifier que les sessions `terminal` passent en `fermee` à la disparition de leur processus.

### 3.2 Sessions principales

« Où » est relatif au compartiment du projet. Bulles : voir la section 7.

| État réel | Donnée source | Où | Ce que fait le Clawd | Bulle | Signe permanent | Manque |
|---|---|---|---|---|---|---|
| Démarrage | `statut: demarrage` | du sas/Quai à son poste | arrive avec un carton, l'installe | « … » | — | rien |
| Travail (interactif) | `travail`, `autonomie: false` | son poste | assis de dos, tape | ligne en cours (flux) | balise verte qui pulse | flux absent en tmux (texte entier seulement) |
| Outil en cours | `outil` sans `resultat_outil` | son poste | icône d'outil au-dessus de la tête (fichier, terminal, web, recherche) | icône seule | — | rien |
| Travail autonome | `travail` + `autonomie: true` | son poste | idem, casque d'antenne allumé (bleu) | idem | badge **AUTO** sur le poste | rien |
| Travail de nuit | `nuit` non nul | son poste | idem, lampe de bureau, lune | idem + « cases : 4 » | badge **lune** + compteur `casesOuvertes` | `nuit` n'est pas dans le miroir `hq/src/donnees/contrat.ts` |
| Relance auto | `relance` | son poste | petit sursaut, se remet à taper | « relancé : raison » (3 s) | — | rien |
| Compaction | `compaction` (statut) puis évt `compaction` | son poste | presse ses papiers en un cube | « 180k → 42k » | — | rien |
| Question / dialogue | `question` ou `dialogue` non nul | debout à son poste, face à la pièce | main levée, s'agite | **« ? » rouge clignotant** + titre + options cliquables | balise rouge sur la porte, mini-carte rouge | rien |
| Fini, attend la suite | `attente` < 30 min | assis, tourné vers la pièce | attend, regarde vers la porte | **« ✓ »** + 1re ligne de la conclusion | balise ambre | rien (dernier `texte` avant `tour_fini`) |
| Objectif atteint | `terminee`, évt `objectif_atteint` | va au tableau puis revient | plante un fanion sur le tableau | « 🏁 » + bilan | fanion au tableau jusqu'à lecture | rien |
| Erreur API / rate limit | `erreur` + texte | son poste | l'écran fume, il tape dessus | « ✗ » orange + message court | balise orange | cause structurée (`limite`, `connexion`, `api`) : à ajouter à l'évt `erreur` |
| Compte déconnecté | `erreur` « Login expired » | son poste | tient une clé, regarde l'îlot Réglages | « clé » | balise orange | même manque ; aujourd'hui seul le texte le dit |
| Inactive | `attente`/`terminee` + `inactiveDepuis` | **libre** : café, fumoir, balai, hublot | routine de pause (section 6) | « z » discret | poste vide, chaise tirée, tasse posée | rien |
| Inactive longue (≥ 4 h) | `inactiveDepuis` | couchette du compartiment | dort | « zZ » | bouton Éteindre sur le poste | rien |
| Lecture seule | `terminal: true` | son poste | travaille derrière une vitre | normale | badge **œil** : on lit, on ne peut pas écrire | rien |
| Chris est au clavier | `attachee: true` | son poste | normal | normale | hologramme de Chris penché sur son épaule | rien |
| Machine hors ligne | `machine.enLigne = false` | son poste | figé, gris, grésille (hologramme) | « signal perdu · 12 min » | balise grise | rien côté données, HQ doit le lire |
| Éteinte (< 24 h) | `fermee` | **capsule** du compartiment | dort dans une capsule givrée, immobile | aucune | étiquette titre + « éteinte il y a 3 h » | rien |
| Éteinte (> 24 h) | `fermee` + `majLe` | **Cale** (îlot archives) | capsule rangée en rayon | aucune | — | rien |
| Archivée | `archivee: true` | Cale, rayon « archivées », sur demande | — | — | — | rien |

Distinctions importantes :
- **L'erreur n'est plus confondue avec la question** : aujourd'hui `etatDansLeMonde` mappe `erreur → bloque`. Elle
  devient orange, avec un geste différent. Rouge = Chris doit décider, orange = quelque chose est cassé.
- **Autonome et interactif** se distinguent au premier regard : le badge AUTO (casque bleu) dit « il continue sans
  toi », sa fin de tour est une relance et non une attente. Un Clawd interactif qui finit se tourne vers la pièce ;
  un autonome ne se tourne que s'il a vraiment fini (`terminee`) ou s'il pose une question.
- **Une capsule n'est jamais animée.** C'est la seule représentation d'une session éteinte. Tap sur une capsule :
  « Rallumer » (route `reprendre`) ou « Archiver ».

### 3.3 Machines (multi-postes)

- Une session sur le portable ou le VPS pour un projet de la tour va dans **le même compartiment** : c'est le projet
  qui compte, pas la machine. Son poste porte une petite plaque de machine (T, P, V, Pi).
- **Donnée manquante** : HQ identifie un projet par `machine|chemin` (`monde-selecteurs.ts`), donc le même dépôt sur
  deux machines donne deux projets. Il faut une **clé de projet** commune : voir 9, étape B.

---

## 4. Sous-agents

### 4.1 Ce qui remonte aujourd'hui (vérifié)

- **Moteur SDK** (`traduction-sdk.ts`) : un appel `Agent`/`Task` donne un événement `sous_agent` (id = id de l'appel,
  description, modèle, genre). Les appels d'outils des sous-agents remontent marqués `agent: <id>` (le SDK les émet
  par défaut, ce qui suffit pour un battement de cœur). La fin d'un sous-agent au premier plan se déduit du
  `resultat_outil` dont `outilId` = id du sous-agent.
- **Pas remonté** : leur texte et leurs réflexions (option SDK `forwardSubagentText` non activée), leurs résumés de
  progression (`agentProgressSummaries` non activée), et les messages système `task_started`, `task_progress`,
  `task_notification` et `task_updated`, ignorés par `traduireSysteme`. Ces messages portent pourtant tout ce qu'il
  faut : `is_backgrounded`, `spawn_depth`, `parent_task_id` (imbrication), `usage` (tokens, outils, durée),
  `summary` et le statut final `completed | failed | stopped`.
- **Conséquence** : un sous-agent **en arrière-plan** paraît fini dès son lancement, puisque son `resultat_outil`
  revient tout de suite. Le monde mentirait.
- **Moteur tmux** : `SuiviSousAgents` lit les transcripts `subagents/*.jsonl`, avec leur texte. Pour les sessions
  pilotées, `GardeSousAgents` **plafonne à 3 sous-agents par étape et impose Sonnet**, ce qui contredit le besoin
  d'un orchestrateur comme « StockIOP v1 » qui en lance des dizaines. Les sessions SDK n'ont pas cette garde.

**À ajouter (étape C)** : traduire `task_*` en événements `sous_agent_debut` (parent, profondeur, arrière-plan),
`sous_agent_progres` (résumé, dernier outil, tokens, toutes les 10 s au plus) et `sous_agent_fin` (statut,
résumé) ; activer `agentProgressSummaries` (le résumé d'une ligne est exactement ce que veut une bulle) ;
`forwardSubagentText` seulement pour le fil détaillé, s'il ne coûte pas trop en volume.

### 4.2 Représentation

- **La nacelle** : un module amarré au mur extérieur du compartiment par un petit sas. Elle n'existe que pendant
  qu'il y a des sous-agents actifs ou finis non relus, puis se désamarre (animation de 2 s). Elle contient 8 établis.
- **Un sous-agent = un mini-Clawd** (environ 0,7× la taille), combinaison de la couleur de son orchestrateur
  (anneau coloré au sol sous lui, même teinte que l'étiquette de l'orchestrateur). Sa forme ne peut pas être
  confondue avec une session : il n'a pas de poste, pas de chaise, et il porte un numéro.
- **Cycle visible** :
  1. lancement : l'orchestrateur tend une fiche, le mini-Clawd sort du sas de la nacelle, la prend et s'installe à
     un établi (2 s au plus) ;
  2. travail : il tape ; icône de son dernier outil ; au zoom compartiment, une bulle d'une ligne tirée de son
     résumé de progression ;
  3. fin réussie : il rapporte une fiche verte sur le bureau de l'orchestrateur, puis repart par le sas ;
  4. échec ou arrêt : fiche rouge, même trajet ;
  5. arrière-plan : il ne revient qu'au `task_notification`. Entre-temps, l'orchestrateur peut finir son tour et
     se tourner vers Chris, et le compteur de la nacelle reste allumé : « 3 travaillent encore ».
  6. imbrication (`spawn_depth` 2 et plus) : le sous-sous-agent apparaît à l'établi voisin de son parent, relié
     par un fil fin. Au-delà de la profondeur 2, on ne montre qu'un compteur sur le parent.
- **L'orchestrateur** qui a 3 sous-agents actifs ou plus se lève et se met devant un **tableau de dispatch** dans la
  nacelle. Sa bulle : « 12 agents · 7 ✓ · 1 ✗ · 4 en cours ».

### 4.3 Combien on en montre

| Sous-agents actifs | Représentation |
|---|---|
| 1 à 8 | un mini-Clawd par sous-agent, un établi chacun |
| 9 à 30 | 7 établis individuels (les plus récents ou ceux qui ont un résumé neuf) + une **grappe** : rack lumineux « +N », une LED par agent (verte qui clignote = en cours, verte fixe = fini, rouge = échec) |
| plus de 30 | la nacelle s'agrandit d'un module (16 établis) ; au-delà, la grappe seule, et un tableau « 42 lancés / 30 finis / 2 échecs / 10 en cours » |
| plusieurs orchestrateurs dans le même projet | la nacelle est partagée, avec un établi de couleur par orchestrateur ; on ouvre une 2e nacelle sur l'autre face au-delà de 2 orchestrateurs |

- Tap sur un mini-Clawd ou une LED : le fil de l'orchestrateur s'ouvre, filtré sur ce sous-agent (le fil sait
  déjà regrouper par `agent`).
- **Aucun sous-agent n'a de bulle de texte en vue d'ensemble ou au zoom anneau.** Seul le compteur de la nacelle y
  est lisible.

---

## 5. Salle centrale

### 5.1 Ce qu'il y a

La salle de commandement : la table ronde (8 sièges, avec un cercle debout derrière), et un écran par mur.
Chaque écran est utile ; aucun n'est décoratif.

| Écran | Contenu | Donnée |
|---|---|---|
| À toi | sessions bloquées (rouge) puis finies (ambre), les plus anciennes en haut, avec l'âge de l'attente | statuts, `dialogue`, `majLe` |
| En cours | sessions au travail : projet, dernière bulle, sous-agents | statuts, fil |
| Fil des conclusions | les dernières fins de tour et objectifs atteints de toute la station, une ligne chacun | `texte` final, `objectif_atteint`, `etape` |
| Machines | tour, portable, VPS, Pi : en ligne, CPU, réveil | `machines`, `reveilPossible` |
| Énergie | quotas des comptes Claude (fenêtre 5 h, semaine), en jauges de réservoir | `EtatCompte.session/semaine` |
| Nuit | sessions en mode nuit : cases ouvertes, relances, réveils ; bouton « Lancer la nuit » | `nuit` |
| Réunions | réunions en cours et passées | `reunions` |

Chaque ligne d'écran est cliquable : elle ouvre la session ou fait filer la caméra. Le gros panneau React s'ouvre
par-dessus le monde, comme aujourd'hui.

### 5.2 Appeler une session (« viens, on doit parler »)

1. Chris appuie sur `C` (ou tape la salle) : la caméra file vers le centre, son personnage va à la console
   (2 s au plus, sans bloquer).
2. Il choisit une session (écran En cours ou À toi, palette, ou appui long sur un Clawd → « Appeler »).
3. **Côté app, immédiatement** : le panneau de conversation de la session s'ouvre, ancré à la table. Rien n'est
   envoyé tant que Chris n'écrit pas ; envoyer = la commande `envoyer` ordinaire.
4. **Côté monde** : le Clawd quitte son poste, prend le tube et vient s'asseoir à la table (6 s au plus). S'il était
   au travail, il continue de taper sur une tablette : l'animation d'état reste vraie, seul le lieu change (il dit
   « je suis en conversation avec Chris »).
5. Fermer le panneau : il repart à son poste.

Si le Clawd est en capsule (session éteinte), l'appel propose « Rallumer et appeler ». Il faut d'abord rallumer
(`reprendre`) ; on ne fait jamais semblant.

### 5.3 Message groupé et réunion

1. Chris appuie sur **Réunion** à la console. Mode sélection : il tape des Clawds dans le monde, des lignes
   d'écran, ou choisit « Auto » (routage du relais, `destinataires: 'auto'`).
2. Il écrit la demande. Envoi = `POST` réunion (`DemandeReunion`) : le relais l'envoie à chaque session par
   `envoyer`, entourée de l'en-tête « [Réunion — de Chris] » (déjà fait).
3. Les Clawds sélectionnés viennent à la table : 8 assis, puis un cercle debout. Au-delà de 12, les suivants restent
   à leur poste avec une **antenne de visio**, ce qui évite d'encombrer la salle. Les sous-agents ne viennent jamais
   (règle déjà dans `commun/reunion.ts`).
4. Chaque réponse recopiée par le relais (`MessageReunion`, auteur = session) s'affiche dans la bulle de son auteur.
   Un **lien** lumineux part de l'auteur vers le centre de la table (section 7).
5. Garde-fous existants : limite de messages par réunion ; toute action offensive passe par Chris.
6. « Lever la séance » : tout le monde repart. La réunion reste dans l'écran Réunions.

**Manque** : une réunion n'a pas d'état « close » (`Reunion` n'a pas ce champ). Pour la v2, c'est un état local au
client ; plus tard, ce sera un champ du relais, pour que la séance se lève sur tous les appareils.

---

## 6. Vie de la station

### 6.1 Règles d'honnêteté de la vie

- **Seules les sessions inactives** (tour fini depuis 30 min ou plus) ont une vie libre. Une session qui travaille,
  qui pose une question ou qui vient de finir (moins de 30 min) reste à son poste, sinon Chris ne la retrouverait
  pas.
- **Aucun personnage en forme de Clawd n'est décoratif.** La vie de fond passe par des **drones de service** :
  petits robots ronds gris, sans visage, qui vident les poubelles et lavent les sols. On ne peut pas les prendre
  pour des sessions.
- **Toute trace est une mesure** : la saleté et les déchets sont proportionnels à l'activité réelle (voir 6.3).
  Une station propre a peu travaillé, ou elle a été nettoyée.
- La vie ne cache jamais une balise d'état : les balises et les bulles se dessinent au-dessus de tout.

### 6.2 Routines des inactifs

Chaque inactif tire une routine toutes les 3 à 8 min, avec une graine tirée de son id (deux appareils montrent à peu
près la même chose) :

| Routine | Poids | Lieu | Trace laissée |
|---|---|---|---|
| Café | 35 % | café de son anneau, sinon le plus proche | gobelet à la poubelle, ou oublié sur la table (1 fois sur 4) |
| Cigarette | 20 % | coin fumeur le plus proche | cendres (+1 par pause) |
| Balai | 20 % si son compartiment est sale, sinon 5 % | son compartiment, puis la coursive | saleté retirée |
| Hublot | 15 % | hublot le plus proche | — |
| Discuter | 10 % si un autre inactif est au même café | café | deux bulles « … » (sans texte : ils ne se parlent pas vraiment) |

- Au-delà de 4 h d'inactivité, il ne sort plus : il dort à la couchette de son compartiment, et son poste propose
  « Éteindre » (la règle des notes de cadrage : jamais d'extinction automatique).
- Dès que la session redevient active (message de Chris, relance, réponse de réunion), il revient **en tube**
  jusqu'à son poste. L'état est montré tout de suite par une balise, sans attendre son arrivée.

### 6.3 Déchets, cendres et nettoyage

- **Papiers froissés** : chaque `tour_fini` en jette un dans la poubelle du compartiment ; une poubelle pleine
  (20 papiers) déborde au sol. **Copeaux et miettes au sol** : +1 tache pour 25 appels d'outils. Une compaction pose
  un cube de papier pressé à côté du poste.
- **Cendres** : +1 par pause cigarette, au coin fumeur ; un cendrier déborde au-delà de 10.
- **Nettoyage** : les inactifs balaient (6.2), les drones vident les poubelles pleines toutes les 30 min environ,
  et Chris peut balayer : il prend le balai au local de nettoyage (ou appui long sur une tache), et 3 s de balai
  retirent une tache. C'est du jeu pur, sans effet sur les données.
- **Plafond de lisibilité** : 12 taches au plus par compartiment, jamais sur une balise, un poste ou un objet
  cliquable. Le sol reste lisible même au pire.
- **Persistance** : les compteurs de saleté sont un état du client, recalculé à partir du fil (nombre de `tour_fini`
  et d'`outil` depuis le dernier nettoyage). Ils sont gardés en local en v2, puis dans le relais pour qu'ils soient
  partagés entre appareils.

### 6.4 Papiers sur le bureau = non lu (utile)

Chaque conclusion que Chris n'a pas lue (dernier `texte` d'un tour fini, `objectif_atteint`, `etape`) est un
**papier posé sur le bureau** du poste (3 au plus, puis une pile). Ouvrir la session les ramasse. C'est le seul objet
de vie qui porte une information, et il est utile : on voit d'un coup d'œil où il y a du nouveau. **Manque** : une
marque « lu jusqu'à seq » par session. Locale en v2, dans le relais ensuite (pour qu'une lecture au téléphone vide
aussi les bureaux sur PC).

### 6.5 Cycle jour/nuit

Il garde l'heure réelle (comme aujourd'hui). La nuit, les hublots s'assombrissent, les coursives passent en éclairage
de veille, et seuls les postes actifs restent éclairés. On voit d'en haut qui travaille la nuit.

---

## 7. Bulles et liens

### 7.1 Priorités

`question` > `erreur` > `objectif_atteint` > `fini` > `etape` > `relance` / `compaction` > `texte` (message
intermédiaire) > `outil`.

Une bulle de rang supérieur remplace aussitôt celle en cours. Une bulle de rang inférieur attend que la bulle en
cours ait tenu sa durée minimale.

### 7.2 Quoi, combien, combien de temps

| Type | Contenu | Durée | Persistance |
|---|---|---|---|
| Question | « ? » + titre du dialogue (60 car.) + options en boutons (zoom compartiment) | jusqu'à la réponse | clignote (cadence actuelle de 360 ms) |
| Erreur | « ✗ » + message (50 car.) | jusqu'au prochain tour | fixe |
| Objectif atteint | « 🏁 » + bilan (60 car.) | 12 s, puis fanion au tableau | fanion jusqu'à lecture |
| Fini | « ✓ » + 1re phrase de la conclusion (60 car.) | jusqu'au prochain tour, réduite à « ✓ » après 20 s | — |
| Étape | « ▸ » + résumé d'étape | 8 s | — |
| Texte intermédiaire | dernière phrase complète du flux (`flux`, SDK) ou du `texte` | 4 à 8 s, mise à jour au plus toutes les 1,5 s | — |
| Outil | icône seule (fichier, édition, terminal, web, recherche, sous-agent) | durée de l'outil | — |
| Sous-agent | résumé de progression, 1 ligne | 6 s, au plus une toutes les 10 s par sous-agent | — |

- **Longueur** : 2 lignes de 28 caractères au plus sur PC, 1 ligne de 32 sur téléphone, coupées au mot avec « … ».
  Tap sur la bulle = le fil, ouvert sur cet événement.
- **Selon le zoom** : en vue d'ensemble, seulement les balises (pas de texte). Au zoom anneau, des icônes (« ? »,
  « ✗ », « ✓ », « 12↓ »). Au zoom compartiment, le texte complet.
- **Anti-bruit** : 6 bulles de texte au plus en même temps à l'écran, choisies par priorité puis par récence (les
  autres passent en icône) ; une seule bulle par personnage ; pas de bulle de texte pour un appel d'outil ; une
  session qui enchaîne 20 messages en 10 s n'en affiche que le dernier.

### 7.3 Liens entre sessions

- **Réunion** (la donnée existe : `MessageReunion.auteur` et `destinataires`) : quand une session répond dans une
  réunion, un **paquet lumineux** part de son Clawd, longe les coursives et les tubes jusqu'à la table, puis
  rayonne vers les autres participants. En vue d'ensemble, c'est un arc pointillé entre compartiments, qui reste
  2 s.
- **Session qui pilote une autre session** (une session Echo, ou un orchestrateur qui ouvre ou écrit à une autre
  session par le MCP Quart : `quart_ouvrir`, `quart_envoyer`) : un **câble** relie les deux postes tant que le lien est
  actif (dernier échange il y a moins de 10 min). **Manque** : le relais ne sait pas quelle session est à l'origine
  d'un appel MCP Quart (le jeton est par machine). Il faudrait un en-tête d'origine (id de session Claude, transmis
  par l'environnement du MCP), puis un champ `origine` sur le message envoyé.
- **Question à Chris** : pas de lien. La balise rouge sur la porte et la mini-carte suffisent ; un fil vers la salle
  centrale ajouterait du bruit.

---

## 8. Cinq scénarios

### 8.1 Le matin : Chris arrive, la nuit a travaillé

7 h 40, au téléphone. La station s'ouvre en vue d'ensemble, éclairage de veille. Deux compartiments brillent encore :
Agent HQ (anneau 2) et StockIOP (anneau 1). Les autres postes sont sombres.
- Agent HQ : le Clawd de nuit a fini. Il est tourné vers la pièce, fanion 🏁 planté au tableau, trois papiers sur
  son bureau. Bulle : « 🏁 v2 station : 11/11 cases, CI verte ». La lune de son badge est éteinte (`nuit` repassé à
  nul).
- StockIOP : balise **rouge**. Le Clawd est debout, main levée : « ? Pousser sur la branche principale ? » avec deux
  boutons. Il attend depuis 3 h 12. L'écran À toi de la salle centrale le met en tête.
- Au coin fumeur de l'anneau 2, un tas de cendres (14) et deux gobelets : l'autre session de nuit a fait des pauses
  après sa fin de tour, puis s'est endormie à sa couchette (« zZ », bouton Éteindre).
- Une capsule givrée dans Hippocampe : session éteinte hier soir par Chris. Rien ne bouge.

Chris appuie sur « À toi (2) » : StockIOP s'ouvre, il répond « Non, ouvre une PR » d'un tap. Le Clawd se rassoit de
dos et tape. `Espace` : Agent HQ s'ouvre sur le bilan, les papiers disparaissent du bureau. En 40 s, il a tout vu.
Le portable était éteint toute la nuit : ses deux sessions de la veille sont en capsules, pas en « attente ».

### 8.2 L'orchestrateur « StockIOP v1 » et ses 12 sous-agents

Chris lance l'orchestrateur, en autonomie. Badge AUTO, casque bleu. Il lit le plan, puis lance 4 sous-agents.
Une nacelle s'amarre au compartiment StockIOP (2 s), et 4 mini-Clawds à anneau vert y entrent avec leur fiche.
L'orchestrateur se lève et va au tableau de dispatch. Bulle : « 4 agents · 0 ✓ ».

Il en lance 8 de plus, en arrière-plan. La nacelle montre 7 établis occupés et un rack « +5 » (LED vertes qui
clignotent). Au zoom compartiment, les bulles des sous-agents défilent, une toutes les 10 s au plus :
« migration table lots : 3/5 tests verts ». L'orchestrateur finit son tour et se rassoit face à la pièce, balise
ambre, mais la nacelle reste allumée : « 8 travaillent encore ». On ne croit pas que c'est fini.

Un sous-agent échoue : LED rouge, puis un mini-Clawd rapporte une fiche **rouge** sur le bureau de l'orchestrateur.
Les autres reviennent un à un avec des fiches vertes. Quand le dernier est rentré, la nacelle se désamarre ;
il reste « 12 · 11 ✓ · 1 ✗ » au tableau. Chris tape la fiche rouge : le fil de l'orchestrateur s'ouvre, filtré sur
ce sous-agent.

### 8.3 Une session bloquée sur une question

Dans Roblox élevage (anneau 5, loin du centre), une session interactive demande quel modèle de monétisation
choisir. Elle passe en `question` avec un dialogue à 3 options. Aussitôt : balise rouge sur la porte, pastille
rouge sur la mini-carte, première ligne de l'écran À toi, notification navigateur. Le Clawd se lève, se tourne,
lève la main : « ? Monétisation : pass, cosmétiques, ou les deux ? ».

Chris est sur PC, dans un autre compartiment. Il appuie sur `Espace` : la caméra file (400 ms) et le panneau
s'ouvre. Son personnage passe par le tube et réapparaît à côté du poste. Il coche « les deux », ajoute une note,
envoie. La session repasse en `travail` : le Clawd se rassoit de dos, la balise devient verte.

Variante téléphone : depuis la mini-carte, il zoome sur le compartiment et tape l'option directement sous la bulle.
Une confirmation d'un tap protège des erreurs de doigt.

### 8.4 Réunion de deux sessions

Chris veut que la session Agent HQ et la session Hippocampe se mettent d'accord sur un format d'événement. Il va
au centre (`C`), appuie sur Réunion, tape les deux Clawds dans le monde, puis écrit : « Agent HQ a besoin des
événements sémantiques d'Hippocampe ; mettez-vous d'accord sur le format, 3 échanges max. »

Les deux Clawds quittent leur poste et arrivent à la table par les tubes, en 5 s. Celui d'Hippocampe tapait encore :
il continue sur une tablette. Sa réponse arrive : un paquet lumineux part de son siège vers le centre de la table,
puis vers Agent HQ, et sa bulle affiche « Je propose {type, projet, poids}… ». Agent HQ répond. Au troisième
échange, la limite de la réunion est atteinte et l'écran Réunions l'affiche. Chris lit le fil complet dans le
panneau, valide, puis lève la séance. Les deux Clawds repartent.

### 8.5 Sessions de nuit autonomes vues au réveil

La veille au soir, Chris a lancé trois sessions de nuit depuis l'écran Nuit (route `nuit`). La nuit, la station est
sombre, sauf trois postes éclairés avec badge lune et compteur de cases (« 7 », « 4 », « 12 »). À 2 h, l'une d'elles
s'arrête sans finir. Le poste la relance (suivi-nuit) et la bulle « relancé : 6 min sans réponse » s'affiche 3 s. À
4 h, après 4 réveils sans effet, elle passe en **alerte** : balise orange, notification « nuit interrompue ».

Au réveil, l'écran Nuit résume : deux 🏁 (cases 0) et une interrompue (cases 5, raison). Les deux finies sont
inactives depuis des heures : elles dorment à leur couchette, avec le bouton Éteindre. L'interrompue est à son
poste, avec un écran fumant orange. Chris éteint les deux premières d'un geste (« Éteindre les inactives » sur
l'écran Nuit) : elles passent en capsules. Puis il ouvre la troisième.

---

## 9. Utile ou décoratif, et découpage en étapes

### 9.1 Ce qui sert, ce qui décore

| Élément | Utile | Décoratif | Remarque |
|---|---|---|---|
| Balises de porte, mini-carte, bouton « À toi » | ✔ | | le cœur de la productivité |
| Bulles (question avec réponse rapide, fini, erreur) | ✔ | | |
| Écrans de la salle centrale | ✔ | | chacun remplace un écran de Desktop ou en ajoute un |
| Nacelle et compteurs de sous-agents | ✔ | | la vue que Desktop n'a pas |
| Capsules et Cale (sessions éteintes, rallumer) | ✔ | | rendent l'état honnête |
| Papiers sur le bureau = non lu | ✔ | | |
| Badges AUTO, lune, œil, plaque machine | ✔ | | |
| Saleté et poubelles proportionnelles à l'activité | ✔ (faible) | ✔ | lecture de l'activité au coup d'œil |
| Café, cigarette, hublot, discussions | | ✔ | seulement pour les inactifs |
| Balai (agents, Chris), drones | | ✔ | |
| Modules techniques, serre, étoiles | | ✔ | |

### 9.2 Étapes livrables

Chaque étape est utilisable seule. La A passe avant tout visuel.

**A. Vérité des données** (petit, urgent ; rend la v1 actuelle déjà honnête)
- Relais : réconciliation au `bonjour` (sessions absentes → `fermee`).
- HQ : lire `machines[].enLigne`, ajouter l'état « hors ligne », séparer `erreur` de `bloque`.
- HQ : reporter `nuit` et `lanceur` dans le miroir `contrat.ts`.
- Poste : `terminal: true` passe en `fermee` à la disparition du processus.
- Tests : une session `attente` d'un poste qui revient sans elle passe en `fermee` ; une machine hors ligne ne montre
  aucun Clawd animé.

**B. Station v2 minimale jouable**
- Données : **clé de projet** calculée par le poste (racine du worktree principal, ou dépôt distant ;
  `stockiop-wt-*` → `stockiop`), ajoutée à `Projet` ; tables du relais `categories`, `compartiments` (clé, catégorie,
  anneau, emplacement, taille, veille), `alias_projets` ; API `GET /api/station`, `PUT /api/station/compartiments/:cle`.
- Monde : salle centrale (écrans À toi, En cours, Machines), anneaux octogonaux avec placement enregistré, sas
  tirés, compartiments (postes, console, terminal, bibliothèque, tableau), capsules et Cale, Quai et rangement par
  glisser, mini-carte, trois paliers de zoom, palette, `Espace` / « À toi », tubes.
- États : toute la table 3.2 sauf sous-agents.

**C. Sous-agents**
- Données : traduction `task_*` → `sous_agent_debut`, `sous_agent_progres`, `sous_agent_fin` ; activer
  `agentProgressSummaries` ; décision sur `GardeSousAgents` (question 4).
- Monde : nacelle, mini-Clawds, grappe et rack, tableau de dispatch, filtre du fil par sous-agent.

**D. Bulles, réponse rapide, réunions dans le monde**
- Données : `cause` structurée sur l'événement `erreur` ; état « séance levée » (client) ; marque « lu jusqu'à »
  (client).
- Monde : moteur de bulles (priorités, cadence, zoom, plafond de 6), options de dialogue sous la bulle, appel d'une
  session à la table, message groupé, liens de réunion, papiers non lus.

**E. Vie**
- Données : aucune nouvelle, tout est dérivé du fil.
- Monde : routines des inactifs, café et fumoir, cendres, poubelles, taches proportionnelles, drones, balai, couchettes,
  jour et nuit.

**F. Suites**
- Agrandissement de compartiment, veille à 45 j, passage à deux rangées.
- Origine des appels MCP Quart (liens entre sessions hors réunion).
- « Lu » et saleté synchronisés par le relais.
- Manifeste de projet (catégorie suggérée, scores) et maturité calculée (habillage du compartiment).
- MCP d'événements sémantiques (tableau d'objectifs alimenté par les agents).
- Routage Haiku des réunions.
- Écran Énergie si ce n'est pas déjà fait en B.

Point de vigilance hors périmètre, relevé en lisant le code : en SDK, chaque delta `flux` est un `evenement`
ordinaire, et `Registre.ajouterEvenement` l'insère en base (une ligne par fragment de texte). À vérifier avant
d'afficher le flux en direct dans les bulles, sinon la base gonfle vite.

### 9.3 Catégories : mécanisme et première liste

**Mécanisme**
- **Qui range** : Chris, en un geste (accepter la suggestion au Quai, ou glisser le compartiment vers un autre
  anneau). La suggestion vient d'abord de mots-clés du README ou du `PROJET.md` (« client », « boutique », « SaaS » →
  Clients ; « MCP », « Claude », « agent » → Agents ; « Godot », « jeu », « Roblox » → Jeux…), et plus tard d'un champ
  `categorie` du manifeste de projet, puis d'un routage Haiku sur un poste.
- **Où c'est stocké** : dans la base du relais (Pi), seule source partagée par la tour, le portable et le
  téléphone. Le manifeste dans le dépôt n'est qu'une suggestion : la décision de Chris dans l'app l'emporte.
- **Identité d'un projet** : la clé de projet (étape B). Deux dossiers d'un même dépôt (worktrees, autre machine) =
  un seul compartiment. Les doublons que la clé ne détecte pas (`tetris-v2`…`v14`) se fusionnent en glissant un
  compartiment sur un autre, ce qui crée un alias.

**Première liste** (tirée de `/mnt/projects`, ordre du centre vers l'extérieur ; * = activité git ces 30 derniers
jours)

1. **Clients & business** (anneau 1 : ce qui engage de l'argent ou un client, au plus près du centre)
   StockIOP* (+ `stockiop-ops`, worktrees), Leadar (+ LeadNexus), Ploof, Comptoir, site Echo Agency (lumen,
   `echo-agency-site`, `ea-mail-pro`), Studio LinkedIn* (+ `linkedin-mcp`*), Copywriting lab*, Portfolio carnet,
   APEX Nutrition, Movix, Projet Insight.
2. **Agents & poste** (outils Claude et infra du parc, l'usage quotidien)
   Agent HQ / Quart* (`ccremote-dev`, `ccremote`, `relais`), Hippocampe*, Echo (`echo`, `robot-echo`), Echo OS
   (`echo-desk`), Atrium*, Bureau virtuel*, echo-vault, pty-mcp, log-watcher-mcp, playwright-mcp, Claude Arcade,
   echo-atelier, How it works*, Iris*, Duplex, Pigment.
3. **IA locale & labos**
   agent-forge, EchoHub v2*, Accroche, Scalpel, JevK5 lab* et jev-harness*, doom-agent, Reflet*, Ma voix*, Dictée
   (`whisper`, `dictee-live`), MiniMax H3 studio*, ACE-Step, Épreuve, Anamnese, Mentor, Agora.
4. **Apps du bureau** (logiciels Linux et outils perso)
   Cordelle*, Plume, Vela, echo-browser, Clarion, Timbre, Echo OS next, Halcyon* et KytyPS5*, DiskLens, Vitrail,
   smart-oomd, Saily, Planche*, Mue, Cadence, Prisme, Aegis, Aurum, EmploiSearch.
5. **Jeux & créa** (anneau extérieur, le plus grand)
   Roblox élevage*, Rixe, Horde*, Tellus*, Pression*, Tetris*, Tessera, Voxelith, Roque, Chambre studio*, studio
   anime, LoFi Engine.

Ne sont pas proposés (forks et références, sauf si une session s'y ouvre) : aseprite, twenty, freetube, scrapling,
hermes-agent, generative_agents, Claw3D, claude-code / echocode, kytyps5-upstream, sharpemu.

---

## 10. Questions pour Chris

1. **Catégories** : tu valides ces 5 anneaux et cet ordre (Clients au centre, Jeux à l'extérieur) ? Ou tu préfères
   moins d'anneaux, en fusionnant « IA locale » et « Apps du bureau » ?
2. **Quels projets ont un compartiment** : seulement ceux que tu amarres (premier remplissage = les environ 25
   projets qui ont eu une session ces 30 derniers jours), ou tu veux voir aussi les projets dormants, en veille ?
3. **Caméra libre et personnage-présence** (ton perso se téléporte là où tu travailles, la marche est optionnelle),
   ou ton perso doit-il vraiment se déplacer pour que tu ailles quelque part ?
4. **Sous-agents** : on lève pour les orchestrateurs le plafond actuel de 3 sous-agents par étape avec Sonnet imposé
   (`GardeSousAgents`, sessions tmux pilotées), et on active les résumés de progression du SDK (quelques tokens
   par sous-agent) ?
5. **Réponse rapide dans le monde** : tu veux pouvoir répondre à une question directement sous la bulle du Clawd
   (plus rapide, mais un tap de trop part tout de suite, d'où la confirmation), ou toujours passer par le panneau ?
