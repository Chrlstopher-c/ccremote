# Agent HQ — direction artistique « station spatiale »

Statut : **proposition à valider par Chris** (16/11/2026). Une fois validée, elle remplace les parties « matériaux » et
« plan du bâtiment » de `hq/art/DIRECTION.md` ; les règles de projection de ce fichier restent valables telles
quelles. Le gameplay, la génération de la station et les comportements sont dans `univers.md` (écrit en parallèle) :
ce document ne dit que comment ça se **voit**.

Planches de travail (discussion, pas des assets du jeu), dans ce dossier :

| Planche | Ce qu'elle montre |
|---|---|
| `planche-palette.png` | toutes les teintes, en hex, par matériau et par catégorie |
| `planche-murs.png` | haut d'un compartiment octogonal : mur droit, deux murs à 45°, murs verticaux, coque vue de l'espace, 3 portes, Chris / Clawd / sous-agent à l'échelle |
| `planche-portes.png` | catalogue des portes en 3 états (fermée, mi-course, ouverte) |
| `vignette-compartiment.png` | un compartiment de projet type, son îlot voisin (coin fumeur sous un pan à 45°), la coursive |

Elles sont produites par code (`planches/*.py`, Python Pillow, venv `hq/art/.venv`) ; les meubles passent par le moteur
de boîtes du jeu (`hq/art/oblique.py`, importé sans être modifié). Relancer : `cd planches && ../../art/.venv/bin/python
planche_murs.py ../planche-murs.png` (idem pour les trois autres). La palette a une seule source : `planches/da_palette.py`.

---

## 1. Ce qui ne change pas, ce qui change

**Ne change pas** (règles non négociables de `hq/art/DIRECTION.md`) : une seule projection (`Y écran = profondeur −
hauteur × 0,55`), une seule taille de pixel (16 px d'art par case, affichés ×2 : case = 32 px monde), murs
**calculés** depuis le plan (jamais posés en tuiles), lumière en haut à gauche, ombres en bas à droite, Clawd en blocs,
perso de Chris en résolution native.

**Change** : le décor passe du bureau-village (parquet, plâtre, briques, pelouse) à une **station habitée** : coque
blanche et isolant doré dehors, panneaux crème et soubassement technique dedans, sols techniques à rivets, hublots
sur l'espace. On garde la **chaleur** de ce que Chris a aimé (mur haut crème + soubassement, cadres, lampes chaudes) :
c'est un bureau confortable dans l'espace, pas un vaisseau froid. Les murs gagnent une troisième orientation : **45°**.

## 2. Références et ce qu'on leur prend

| Référence | Ce qu'on prend | Ce qu'on ne prend pas |
|---|---|---|
| **The Escapists 2** (réf. principale, `references/escapists-*`) | dessus de mur clair et fin + face, densité de petits objets au sol (papiers, plantes, caisses), ombres portées marquées, bulles claires à bord sombre, lisibilité des portes à voyant (vert/rouge) | faces courtes d'une case (Chris veut l'échelle réelle), palette prison verdâtre |
| **Stardew Valley** (intérieurs) | mur du fond haut comme une pièce réelle, objets accrochés au mur dessinés en élévation frontale, lumière chaude des fenêtres | rien d'autre : pas de mur de deux rangs |
| **Mod mascotte** (validé par Chris) | l'échelle : mur du fond un peu plus haut que le perso ; plâtre + soubassement + cadres | le bois partout : il devient un habillage parmi d'autres |
| **FTL: Faster Than Light** | vue de dessus d'un vaisseau en pièces et couloirs, portes comme éléments vivants (s'ouvrent au passage, sas qui vident l'air), état de chaque pièce lisible d'un coup d'œil | pièces vues sans murs ; tout est rectangle |
| **Space Haven** | logique de coque construite sur grille, coque distincte des cloisons intérieures, l'intérieur d'un vaisseau comme un lieu de vie (lits, cuisine, déchets) | vue strictement zénithale sans face |
| **ISS (photos réelles)** | modules blancs, couvertures d'isolant doré (MLI), panneaux solaires bleu nuit à cellules, radiateurs blancs, treillis gris : c'est ce qui fait « station » au premier coup d'œil | l'encombrement réaliste des câbles partout |
| **SIGNALIS** | intérieurs de station en pixel art vus d'en haut, écrans cathodiques, sobriété des matériaux | l'ambiance horrifique, le rouge dominant |
| **Eastward** | intérieurs 3/4 très détaillés et chaleureux, lumière en flaques | — |
| Technique : *RPG Maker, « make your own diagonal walls »* ; *Slynyrd Pixelblog 35 (top down interiors)* | la face d'un mur diagonal ne s'étire pas : on redessine le motif à la largeur réelle (×√2) ; la face qui regarde la lumière est plus claire, l'autre plus sombre ; tuiles de 16 px | l'isométrique 2:1 (autre projection) |

Sources : rpgmakerweb.com/blog/make-your-own-diagonal-walls · slynyrd.com/blog/2021/11/30/pixelblog-35-top-down-interiors
· slynyrd.com/blog/2018/3/14/pixelblog-3-graphical-projections-1 · fiches FTL (mobygames, tcrf) · wiki Space Haven
(bugbyte.fi). Je n'ai pas trouvé de source qui confirme des murs diagonaux dans Space Haven ou FTL : je ne m'en sers
pas comme argument.

## 3. Géométrie : pourquoi l'octogone, et lequel

### 3.1 Ce qui se passe en 3/4 selon la forme du mur

Dans notre projection, **tout mur non vertical montre une face qui pend tout droit sous son dessus, sur 41 px**. Le
mur vertical (nord-sud) ne montre que son dessus (6 px) et sa face au bout bas.

| Forme | Face | Meubles adossés | Pixel | Verdict |
|---|---|---|---|---|
| Cercle vrai | croissant dont la hauteur apparente varie ; chaque colonne de face a un raccord différent ; motifs (panneaux, plinthe) à recalculer en courbe | impossible proprement : un meuble rectangulaire laisse un vide ou mord le mur | arcs pleins de paliers irréguliers, illisibles à 16 px | **non** |
| Octogone (0°, 90°, 45°) | 3 cas seulement : face droite, face à 45° (parallélogramme), pas de face (vertical) | normal contre les murs droits ; aucun contre les pans | la diagonale 1:1 est **la** ligne propre du pixel art (un pas à droite, un pas en bas) | **oui** |
| 16 côtés (ajoute 26,6° et 63,4°, lignes 2:1) | 5 cas de face, raccords ×2 | encore moins de place adossable | les lignes 2:1 sont propres mais se lisent « isométrique » : deux projections à l'œil | non pour v1 |
| Carré pur | 2 cas | partout | parfait | lisible mais ce n'est plus une station circulaire |

### 3.2 Recommandation : octogone **à pans inégaux**

- Les 4 côtés droits sont longs, les 4 pans à 45° courts (2 à 8 cases) et **de longueurs différentes d'un coin à
  l'autre** : première asymétrie gratuite, et la station ne ressemble pas à un panneau STOP.
- Les pans à 45° portent les **coins** (`univers.md` y met déjà sas, îlots et modules techniques) : ce sont des
  trapèzes, donc des pièces qui ont du caractère (voir le coin fumeur de la vignette).
- **La rondeur est portée par l'extérieur**, qui n'est pas marchable : une grande couronne de treillis et de panneaux
  solaires autour de l'anneau extérieur, dessinée en cercle (c'est du décor de fond, sans contrainte de face ni de
  meuble). Au dézoom, l'œil lit « roue » ; de près, on a des murs droits propres.
- Pas de porte ni de hublot sur un pan à 45° (voir 5.3).

### 3.3 Contraintes chiffrées que la génération doit respecter (à reporter dans `univers.md`)

1. **Une face mange 2,5 cases de plan.** Le dessus d'un mur horizontal est dans sa case ; sa face couvre les rangs 7
   à 15 de cette case et les 2 cases dessous. Ce qui est sous la face est physiquement **derrière** le mur (le pied du
   mur est en bas de la face). Donc : rien de cliquable, aucun meuble, aucun point d'arrêt d'agent dans ces 2 rangs.
2. **Profondeur utile = depuis le pied de la face**, pas depuis le dessus du mur. Pièce ou coursive au sud d'un mur
   horizontal : ajouter 3 cases (dessus + face) à la profondeur voulue. Dans les côtés est/ouest (murs verticaux),
   rien à ajouter. ⚠ `univers.md` prévoit une coursive de 3 cases et des compartiments de 7 : sur les côtés nord et
   sud, cela laisse ~0,5 case de coursive visible et 4,5 cases de compartiment. Il faut soit compter 3 cases de plus
   sur ces côtés (l'anneau est plus épais au nord et au sud qu'à l'est et l'ouest, ce qui est une asymétrie de plus),
   soit passer les murs avant des compartiments en **verrière** (5.5).
3. **Vide entre deux anneaux ≥ 3 cases** (dessus à dessus ≥ 48 px). Avec 2 cases (`univers.md`), la face extérieure
   d'un anneau (41 px + 5 px de dessus) recouvre le dessus de l'anneau voisin au nord et au sud.
4. **Pièce ≥ 7 cases de profondeur** (4 visibles), 8 recommandées ; **mur entre deux ouvertures ≥ 2 cases** ;
   **pan à 45° ≥ 2 cases** ; porte à ≥ 1 case d'un angle.
5. Les cases traversées par un pan à 45° ne sont **pas marchables** (les deux demi-triangles) ; le sol se peint
   jusqu'au dessus du pan du côté pièce, l'extérieur se peint de l'autre.

## 4. Échelle (px d'art ; ×2 pour le monde)

| Élément | Mesure | Remarque |
|---|---|---|
| Case | 16 × 16 | 32 px monde |
| Dessus de mur droit | 5 rangs (rangs 2 à 6 de la case) | contour 1 px, rang clair sous le contour du haut |
| Dessus de mur vertical | 6 colonnes (5 à 10) | — |
| Dessus de mur à 45° | 7 px par rang (épaisseur perpendiculaire ≈ 5) | escalier 1:1, contour 1 px de chaque côté |
| Face de mur | **41 rangs** | ≈ 1,28 × Chris : « un peu plus haut que le perso » |
| Chris | 32 de haut, 12 de large (sprite 44 × 70 monde) | résolution native, seule exception |
| Clawd | 20 de haut, corps 16 de large, 25 bras compris | unité = 2 px d'art |
| Sous-agent | 11 de haut (casque compris), corps 8, 12 bras compris | unité = 1 px d'art : moitié de Clawd |
| Ouverture de porte | 36 de haut (rangs 5 à 40), 32 ou 48 de large | Chris passe avec 4 px de marge |
| Meuble le plus haut | ≤ 36 (baie, bibliothèque) | toujours < face − 5 : un meuble ne dépasse jamais le dessus d'un mur |
| Bureau | plateau à 15–17 de hauteur | — |
| Hublot rond | Ø 14 + cerclage 2 | centré au rang 14 de la face |

**Élévation frontale** : la face d'un mur et les personnages sont dessinés de face, **sans écrasement** (un hublot
rond est rond, un cadre est rectangle). Seuls les sols et les dessus sont vus d'en haut. C'est la convention de
Stardew et d'Escapists ; elle est cohérente tant que tout ce qui est sur une face suit la même règle.

## 5. Murs

### 5.1 Règle générale (déjà dans le code du jeu, généralisée)

- Le dessus suit la ligne médiane du mur et se raccorde à ses voisins par **union de pixels** : on rastérise tous les
  dessus dans un même masque, puis contour = pixel du masque qui touche un pixel hors masque (4-voisinage), intérieur
  clair, rang éclairé sous le contour du haut. Angles, T, croix et jonctions droit/45° sont justes par construction.
- **Faces** : pour chaque colonne, sous le dernier pixel de dessus d'une suite, la face pend sur 41 rangs, sauf si
  elle rencontre un autre dessus (le mur du sud passe devant). Un mur vertical ne montre donc sa face qu'à son bout bas.
- **Ordre** : sols → faces → ombres de pied → dessus → objets triés par leurs pieds → lumières → UI.
- **Ombre de pied** : 4 rangs sous la face, opacité 0,30 / 0,20 / 0,12 / 0,06 de `#140c1e`.

### 5.2 Face intérieure (rangs de la face)

| Rangs | Bande | Teinte |
|---|---|---|
| 0 | corniche (trait) | `#2e3240` |
| 1–2 | corniche métal | `#8a919e`, puis −22 % |
| 3 | ombre sous corniche | `#cbc3ad` |
| 4–24 | panneau composite | `#e2dccb`, joint vertical `#b9b09a` tous les 16 px |
| 25–26 | main courante | `#a9b2c0` / `#7d8696` |
| 27–37 | soubassement technique | `#4a5262`, joint `#3a4150` ; grille d'aération `#2b313c` (rangs 29–34, 8 px) une fois sur 3 panneaux |
| 38–40 | plinthe | `#2a2f3a`, `#1e222b` |

Les rangs sont **les mêmes que la face actuelle du jeu** (plâtre 3–24, rail 25, soubassement 26–37, plinthe 38–40) :
le passage à la station ne change que les teintes et les motifs de `faces.ts`, pas la géométrie.

**Habillage par projet** (variable, choisi par le manifeste) : le soubassement peut être bois (`#a06b43`, l'ancien),
moquette murale, métal brossé ou carrelage ; le panneau peut recevoir une couleur d'accent sur 2 rangs (21–22).
Maximum : 1 habillage de soubassement + 1 de sol par compartiment.

### 5.3 Murs à 45°

- **Deux sens** : `↘` (de haut-gauche à bas-droite, coin nord-est d'une pièce) et `↗` (coin nord-ouest). Les deux
  montrent une face qui pend sous le pan : un **parallélogramme** dont les bandes (corniche, rail, plinthe) suivent
  la pente 1:1 et dont les joints restent **verticaux**.
- **Joints tous les 11 px** au lieu de 16 (16/√2) : un panneau garde sa largeur réelle. On ne cisaille jamais le
  motif d'une face droite (règle RPG Maker).
- **Lumière** (en haut à gauche) : face sous un pan `↘` (orientée sud-ouest) **+6 %** ; face sous un pan `↗` (orientée
  sud-est) **−12 %**. À la jonction avec une face droite, une **arête** verticale assombrie de 28 %.
- **Sur un pan** : ni hublot rond, ni porte, ni meuble rectangulaire adossé. Permis : objets **plats** dessinés en
  parallélogramme (écran mural, affiche, grille, panneau de commande), tuyaux et chemins de câbles qui suivent la
  pente, bacs d'angle triangulaires dessinés exprès.
- **Côté extérieur** (pan de coque vu de l'espace) : mêmes règles, matériau de coque.

### 5.4 Coque extérieure (face vue depuis l'espace)

Plaques `#d9dde2` / `#a9b0ba` de 16 × 9, joints `#7d8592`, pied `#7d8592` puis `#4f5560` (rangs 37–40). Isolant doré
`#c9a24a` / reflet `#f0d68a` / ombre `#8f6f2a` sur ~30 % des plaques. ⚠ Sur la planche, l'isolant tombe en damier
régulier : à corriger en **couvertures irrégulières** de 2 à 5 plaques, avec 1 à 2 plis (rangs de reflet) par
couverture.

### 5.5 Variantes de mur

| Variante | Où | Rendu |
|---|---|---|
| Plein (défaut) | partout | 5.2 |
| **Verrière** | mur avant d'un compartiment côté coursive (recommandé au nord et au sud), salle centrale vers la coursive | rangs 4–24 en verre (`#9fd8e8` à 35 %, ce qui est derrière reste visible), montants métal tous les 16 px, 2 reflets à 45° par vitre ; soubassement plein |
| Cloison basse | séparation dans un îlot (café/fumeur) | face de 20 rangs seulement (rangs 21–40), dessus à 20 rangs plus bas |
| Hublot de dessus | mur **vertical** de coque (côtés est/ouest, où la face ne se voit pas) | fente vitrée de 4 × 10 dans le dessus + tache de lumière froide sur le sol à côté |

## 6. Portes (catalogue)

Toutes dans un mur droit horizontal, dessinées **dans la face** (élévation frontale). Le dessus du mur continue
au-dessus (linteau) : **jamais de bout de mur résiduel**. Ouverture : rangs 5 à 40. Chambranle 2 px (4 px pour le
sas) en métal `#6b7380` avec un rang d'accent en haut ; voyant 4 × 2 au-dessus du chambranle ; seuil 2 rangs.

| Type | Pièces | Ouverture (px) | États / images | Signe |
|---|---|---|---|---|
| **Coulissante** | compartiment ↔ coursive, compartiment ↔ voisin | 32 × 36 | 2 vantaux métal clair + bande d'accent rang 14–16 + vitre haute ; 6 images × 60 ms (0, 20, 45, 70, 90, 100 %) | voyant à la couleur d'état de la pièce |
| **Double vitrée** | salle centrale, salles de réunion | 48 × 36 | 2 vantaux de verre à 55 %, montant 1 px ; 6 images × 60 ms | on voit la pièce au travers |
| **Battante bois** | café, coin fumeur, détente | 32 × 36 | 2 vantaux à lames de 4 px qui pivotent vers l'intérieur et se réduisent à leur tranche ; 4 images × 70 ms + rebond 2 images | poignée crème |
| **Sas** | entre anneaux, vers le quai, nacelle | 48 × 36, cadre 4 px | 2 vantaux lourds, hublot rond partagé en deux moitiés, chevrons jaune/noir rangs 34–40, seuil jaune ; **10 images** : voyant ambre 3 × 120 ms, déverrouillage (vantaux montent de 1 px) 1 × 80 ms, glisse 6 × 60 ms | voyant ambre pendant le cycle, vert ouvert, rouge verrouillé |
| **Rideau de service** | maintenance, salle serveurs, nettoyage | 32 × 36 | lames de 3 px qui s'enroulent dans un caisson de 3 rangs ; 8 images × 50 ms | poignée sombre au bas des lames |
| **Porte de mur vertical** | couloirs est/ouest, coursive des côtés est et ouest | 32 de long, vue de dessus | seuil technique, 2 montants (8 × 3), vantail fin 2 px qui rentre dans les montants ; 6 images | le **bout nord ne montre pas de face** : il reçoit un chapeau de chambranle à rang d'accent (sinon un pilier de 6 × 41 cache la porte) |

**Voyants** : vert `#3fe0c8` = ouvert, ambre `#f0a030` = en mouvement / cycle de sas, rouge éteint `#be6246` = fermé ;
**rouge vif `#ff4d6a` clignotant 360 ms** = un agent de la pièce t'attend (visible depuis la coursive, avec la
plaque du projet). Plaque du projet : 36 × 8 px dans la face, à gauche de la porte, fond couleur d'anneau, nom en
Pixelify Sans sur le calque UI.

## 7. Matériaux et palette

Source unique : `planches/da_palette.py` (planche `planche-palette.png`). Extraits :

| Groupe | Teintes |
|---|---|
| Espace | vide `#070912`, fond `#0b0e1c`, nébuleuse `#2a1f45` / `#3d2a5c`, étoiles `#ffffff` `#cfe0ff` `#ffe7b0`, planète `#12223a` → `#2f5d8a` → `#4f8fc0`, atmosphère `#bfe6ff` |
| Coque | plaque `#d9dde2` / `#a9b0ba`, joint `#7d8592`, isolant `#c9a24a` / `#8f6f2a` / `#f0d68a`, solaire `#1f3a6b` cellules `#2e5a9e` reflet `#8fb4e8`, treillis `#8a9099` / `#5c626b` |
| Murs dedans | contour `#262a36`, dessus `#c3c8d0` / `#e6e9ee`, voir 5.2 |
| Sols | technique `#5d6573` / `#535a68` joint `#3d434f` rivet `#7c8494` (plaques 16 × 16, rivets aux coins) ; résine `#c7c9c2` ; moquette `#2f3d5c` motif losange `#3a4a6e` ; bambou `#b89462` lames de 4 px ; caillebotis `#3b414c` vide `#1d2128` (maille 4 px) |
| Métal, verre, lumière | métal `#9aa3b0` / `#c4cad3` / `#6b7380`, vitre `#9fd8e8` reflet `#e8fbff`, néon froid `#bfe8ff`, lampe chaude `#ffe2b0`, écran `#78d2fa`, ombre `#140c1e`, danger `#f2c94c` / `#262830` |

**Accents d'anneau** (cadres de porte, bande au sol de la coursive, plaques, néon de coursive) : Clients `#4a8fd9`
(`#2c5a8f` / `#9cc6f0`), Outils & infra `#4fb08a` (`#2e6e55` / `#9ee0c4`), Jeux & créa `#a070d8` (`#63408f` /
`#d1b5f2`), salle centrale `#5fe0ff` (`#2a8fb0`). Une nouvelle catégorie prend une teinte **à ≥ 40° de teinte** de
toutes les autres et des couleurs réservées. L'accent ne teint **jamais** une pièce entière : au plus 3 % de ses
pixels.

**Couleurs réservées** (jamais dans le décor) : orange Clawd `#d97757`, rouge bloqué `#ff4d6a`, ambre question
`#f0a030`, turquoise autonome `#3fe0c8`. Elles doivent sauter aux yeux : rien d'autre ne leur ressemble.

## 8. Lumière

- **Toujours en paliers** : 3 ellipses concentriques (rayon 100 / 70 / 40 %), opacités ~10 / 9 / 7 %, alignées sur la
  grille d'art. Aucun dégradé lisse, aucun flou.
- **Plafonniers** chauds `#ffe2b0` dans les pièces (1 flaque pour ~60 cases de sol), **néons** froids `#bfe8ff` dans
  les coursives (bande allongée), **écrans** : petite flaque `#78d2fa` devant chaque poste allumé.
- **Hublots** : tache froide en parallélogramme sur le sol (la lumière vient d'en haut à gauche), 2 paliers. Elle
  **glisse lentement** (cycle orbital de 10 min, décalage max 1 case) : la station tourne. Hublots de dessus (côtés
  est/ouest) : tache le long du mur.
- **Nuit réelle** (`univers.md` 6.5) : voile `#0b0e1c` à 35 % sur les pièces sans session active, coursives en néon
  de veille (bleu à 50 %), postes actifs éclairés : on voit d'en haut qui travaille.
- **Voyants** : 1 à 2 px, jamais plus de 4 par mur ; clignotements à 360 ms (urgent), 1 s (autonome), fixes sinon.
- **Ombres portées** : objets et personnages, ellipse `#140c1e` à ~30 % décalée (+2, +2) px d'art.

## 9. Extérieur

- **Fond** en 3 calques de parallaxe : nébuleuse tramée (bruit lissé, 2 paliers : damier à 50 % puis plein) ×0,05 ;
  étoiles 1 px de 3 teintes (~1 % des pixels) ×0,1 ; étoiles rares 2 px qui scintillent (2 images, 3–7 s) ×0,2.
- **Planète** en bas à gauche, partielle, tramée en 4 tons + liseré d'atmosphère : elle « éclaire » la station
  (justifie la lumière en haut à gauche par le soleil derrière la caméra, la planète renvoie un peu de bleu).
- **Structure** : couronne de treillis circulaire autour de l'anneau extérieur, 4 à 6 ailes de panneaux solaires
  (inégales), radiateurs blancs, 2 antennes, réservoirs dans les coins vides ; le **quai** avec une navette amarrée
  (Chris arrive par là). Les **tubes** entre anneaux traversent le vide : murs verticaux (côtés nord/sud) = dessus seul
  en verre ; tubes horizontaux (côtés est/ouest) = faces en verrière (5.5), sinon on ne voit pas qui passe dedans.
- La **nacelle des sous-agents** (`univers.md` 4.2) : module à coque blanche amarré par un sas, vu en coupe comme le
  reste (sol et établis visibles), 2 s d'animation d'amarrage (glisse + 3 images de verrouillage).

## 10. Identité de chaque type de pièce

| Pièce | Sol | Porte | Accent | Objets signature | Ambiance animée |
|---|---|---|---|---|---|
| **Compartiment projet** | selon manifeste (moquette, résine, bambou, technique) | coulissante | anneau | postes contre le mur du fond, console du fil, bibliothèque (cartouches lumineuses qui s'allument quand il y a du nouveau), terminal (CRT vert ou baie), tableau d'objectifs sur la face, capsules de stase, poubelle, 1 objet propre au projet | écrans qui défilent, papiers non lus sur les bureaux |
| **Salle centrale** | moquette nuit à motif, cercle `#5fe0ff` au centre | double vitrée ; sas principal au sud | `#5fe0ff` | table ronde (ellipse 2:1, 8 places) avec **hologramme de la station** au centre (cyan, tramé, tourne en 8 images) ; 3 grands écrans muraux sur les murs **nord, nord-est, nord-ouest** (les seuls dont on voit la face intérieure ; écrans des pans en parallélogramme) ; 4 **pupitres** à écran incliné (écran sur le dessus, lisible d'en haut) devant les murs est, ouest, sud-est, sud-ouest ; console d'appel où Chris se place | hologramme, lignes d'écran qui défilent, agents qui arrivent |
| **Café** | bambou | battante bois | `#9a6440` | machine à café, distributeur, comptoir, tabourets, tasses | vapeur 3 images, gobelets jetés |
| **Coin fumeur** | résine | battante bois | `#8f8a6a` | bancs, cendriers sur pied, extracteur sur la face | fumée (palette mod mascotte), cendres au sol |
| **Maintenance** | technique + chevrons | rideau | `#f2c94c` | établi, caisses, pièces, chariot, drone de nettoyage au repos | étincelle 2 images de temps en temps |
| **Salle serveurs** | caillebotis | rideau | `#3fd0c0` | baies (voyants qui clignent), câbles au sol, climatiseur | voyants, souffle froid (tache bleue) |
| **Réglages** | résine | coulissante | `#8f8fb8` | grand pupitre à curseurs, armoire électrique, panneau des machines | aiguilles qui bougent |
| **Nettoyage** | carrelage résine bleuté | rideau | `#7fd6e0` | balais, seaux, chariot, bac à déchets | aucune (pièce calme) |
| **Futur** (infirmerie = débogage, serre, hangar…) | à choisir | selon l'usage | teinte libre (règle 7) | — | — |

**Maturité** (calculée par l'app) : un projet neuf = 1 poste, sol nu, pas de plante ; à maturité, postes complets,
plante, objet propre au projet, cadres. On ajoute, on ne change pas la structure : un compartiment se reconnaît à sa
place et à sa plaque.

## 11. Personnages et états

| Qui / état | Signe visuel (cumulables) |
|---|---|
| Session principale (orchestrateur) | Clawd taille 1 (unité 2 px) ; étiquette de nom au survol ; anneau au sol à sa couleur d'orchestrateur quand il a des sous-agents |
| **Sous-agent** | mini-Clawd **taille ½** (unité 1 px d'art), **casque de chantier** couleur du modèle (Haiku `#f2c94c`, Sonnet `#6fb3e0`, Opus `#b58ce0`), numéro sur la coque (`univers.md`), anneau au sol couleur de l'orchestrateur, porte des fiches blanches (aller) ou vertes/rouges (retour) |
| **Interactif** (Chris est dessus) | casque-micro clair `#f4f1ea` avec petite diode rouge de micro |
| **Autonome** (nuit, boucle, tâche planifiée) | antenne fine + voyant turquoise `#3fe0c8` qui clignote à 1 s ; jamais de casque |
| Au travail | assis de dos, frappe (planche existante), écran animé |
| **En attente de Chris** (bloqué) | se lève, face caméra, bras levé ; anneau rouge `#ff4d6a` au sol qui pulse à 360 ms ; bulle à bord rouge ; voyant rouge de la porte |
| Question non bloquante | bulle à bord ambre, « ? » ambre ; reste assis |
| Inactif | assis, écran en veille (bleu sombre), « z » ; après 30 min : routines de `univers.md` (balai, café) |
| **Pause** | va au café ou au coin fumeur ; bulle « pause · 4 min » à bord olive |
| Éteint (power off) | dans une **capsule de stase** du compartiment, Clawd désaturé `#6b6f7a`, couvercle givré |
| Archivé | absent du monde ; carton étiqueté dans la bibliothèque |
| Compactage en veille | bulle info avec icône « presse » (cube qui se tasse en 3 images) |
| **Chris** | sprite natif ; pas d'anneau ; quand il est sélectionné, flèche blanche 5 × 3 au-dessus de la tête |

**Sous-agent taille ½ plutôt que 0,7×** (`univers.md` dit 0,7×) : l'unité unique de pixel interdit de réduire le
sprite de Clawd ; on le **redessine**. À ½, la hiérarchie se lit au premier coup d'œil et 8 établis tiennent dans une
nacelle de 6 × 4 cases. Un 0,7× redessiné (corps 11 × 8) reste possible mais se confond avec Clawd au dézoom.
À trancher avec Chris.

## 12. UI dans le monde

- **Bulles** (calque UI, taille fixe à l'écran, indépendante du zoom) : fond `#eef0f6`, bord 2 px `#262a36` (rouge ou
  ambre selon priorité), coins arrondis 6 px, queue triangulaire vers la tête, Pixelify Sans 13 px, 2 lignes de 28
  caractères au plus. Pastille de type à gauche (carré 8 px). Règles de priorité et de durée : `univers.md` 7.
- **Liens entre sessions** : arc pointillé (tirets 6 px, vides 6 px, 3 px d'épaisseur) **au-dessus** du monde, jamais
  une ligne droite à travers les murs ; couleur de la session émettrice ; les tirets avancent de l'émetteur vers le
  récepteur à 30 px/s ; un carré de 6 px au bout. Lien orchestrateur → sous-agent : même arc, couleur d'anneau, fin.
- **Anneau d'état au sol** : ellipse 2:1, 2 px, sous les pieds, dessinée **avant** le personnage.
- **Dézoom** : sous ×0,5, les pièces deviennent des aplats de leur accent avec le nom (comme `references/schema-station.png`)
  et des pastilles d'état ; aucun pixel art n'est lisible à cette taille, inutile de le montrer.

## 13. Vie et propreté (visuel)

Objets de vie dessinés par code, 1 à 6 px : gobelet (3 × 4), papier froissé (4 × 3), mégot (3 × 1), cendre (pixels
`#b5b2a8` épars), tache (ellipse 6 × 3 à 20 %), miettes. **12 au plus par pièce** (`univers.md` 6.3), jamais sur une
balise, un poste ou un objet cliquable. Poubelle en 3 états (vide, pleine, qui déborde). Balai : objet tenu (règle du
mod mascotte : pincé, il prolonge le geste), 4 images de balayage, petit nuage de poussière 3 images.

## 14. Règles anti-« assemblé »

1. **Un seul pixel** : aucun sprite mis à l'échelle autrement que ×2 entier, aucune rotation, aucun anticrénelage.
2. **Un seul contour** : `#262a36` pour le décor, `#281e22` (contour des boîtes du moteur) pour les objets ; jamais
   de noir pur.
3. **Rien ne passe par-dessus un mur** : l'emprise ET la boîte du sprite d'un meuble sont dans le polygone de sol de
   la pièce, à 1 px des murs ; un meuble ne dépasse jamais 36 px de haut ; rien n'est posé dans les 2,5 cases sous
   une face ; rien contre un pan à 45° sauf les objets plats ou d'angle.
4. **Pas de répétition au pas fixe** : grilles, cadres, hublots, plantes placés au hasard déterministe (graine = case)
   avec un pas minimal ; jamais 3 éléments identiques alignés à intervalle égal. (La planche le montre en défaut : les
   grilles de soubassement reviennent toutes les 3 plaques.)
5. **Chaque objet touche le sol** : ombre de contact obligatoire ; chaque objet mural est sur une face.
6. **Densité** (le défaut le plus visible face à Escapists 2) : ≥ 3 objets de vie et ≥ 1 objet propre par pièce
   habitée ; ≥ 1 détail de coursive tous les 6 cases (extincteur, panneau, caisse, plante, affiche, borne).
7. **Lumière en paliers**, pas de flou ; **au plus 2 matériaux de sol** par pièce.
8. **Comparer avant de montrer** : toute nouvelle vue est mise côte à côte avec `references/escapists-1.webp` à la même
   échelle d'écran ; si elle paraît plus vide ou plus « plate », elle n'est pas finie.

## 15. Catalogue d'assets à produire

Voies : **R** = dessiné à l'exécution par le jeu (peinture du plan, comme les murs actuels) ; **B** = recette du
moteur de boîtes (`oblique.py` → PNG) ; **P** = script Python dédié (sprites animés) ; **L** = modèle local
(Qwen-Image / Qwen-Image-Edit dans ComfyUI, MiniMax H3), puis **réduction au plus proche + quantification sur la
palette + reprise par code**, jamais utilisé tel quel. Aucun asset acheté.

| Asset | Taille (px d'art) | Voie | Priorité |
|---|---|---|---|
| Dessus de murs droits / verticaux / 45°, raccords | calculé | R | 1 |
| Faces intérieure, extérieure (coque), 45°, verrière, cloison basse | 41 rangs | R | 1 |
| Sols : technique, résine, moquette, bambou, caillebotis, chevrons | 16 × 16 procéduraux | R | 1 |
| Hublot rond (face), hublot de dessus | 18 × 18 ; 4 × 10 | R | 1 |
| Portes : coulissante, vitrée, bois, sas, rideau, verticale | 36 × 46 à 56 × 48, 4 à 10 images | P (bandes d'images) | 1 |
| Plaque de projet, voyants | 36 × 8 ; 4 × 2 | R + UI | 1 |
| Poste d'agent (+ variante bureau d'appoint pliant) | 46 × 33, emprise 13 | B | 1 |
| Console du fil | 40 × 36 | B | 1 |
| Bibliothèque (3 niveaux de remplissage, état « nouveau ») | 28 × 38 | B | 1 |
| Terminal CRT / baie | 20 × 30 | B | 1 |
| Tableau d'objectifs, écran mural (droit et parallélogramme) | 46 × 18 ; 32 × 15 | R | 1 |
| Capsule de stase (vide, occupée, givrée) | 16 × 30 | B | 2 |
| Nacelle des sous-agents + établi + rack « +N » à LED | module 96 × 64 ; établi 20 × 16 | R + B | 2 |
| Sous-agent : 4 directions × marche 2 images, frappe 3, porte fiche, apparition 3, départ 3 | 16 × 15 | P | 1 |
| Clawd : casque-micro, antenne, balai, tasse, pause clope (existante) | 32 × 24 | P | 1 |
| Chris : balai, café (existant), sélection | natif 44 × 70 monde | L (Qwen-Image-Edit, pipeline du mod mascotte) | 3 |
| Table ronde + hologramme de station (8 images) | 96 × 56 | B + P | 2 |
| Pupitre à écran incliné | 32 × 24 | B | 2 |
| Café : machine, comptoir, distributeur, tabourets | 16–48 | B | 2 |
| Fumeur : banc, cendrier sur pied, extracteur | 30 × 9 ; 8 × 16 | B | 2 |
| Maintenance, serveurs, réglages, nettoyage : établi, caisses, baies, pupitre à curseurs, chariot, balais | 16–48 | B | 3 |
| Objets de vie : gobelet, papier, mégot, cendre, tache, miettes | 1–6 | R | 2 |
| Fond d'espace (nébuleuse, étoiles, parallaxe) | plein écran | R | 1 |
| Planète | ~160 × 160 | L (Qwen-Image, puis tramage 4 tons) ou R | 3 |
| Treillis, panneaux solaires, radiateurs, antennes, réservoirs | 16–128 | B / R | 2 |
| Navette du quai | ~96 × 48 | B (moodboard L permis) | 3 |
| Bulles, liens, anneaux, pastilles, flèche de sélection | — | R (calque UI) | 1 |

## 16. Risques

1. **Profondeur perdue sous les faces** (3.3) : si la génération compte les cases depuis le dessus des murs, coursives
   et compartiments du nord et du sud seront écrasés. C'est le risque n°1, à régler avant de coder les anneaux.
2. **Tri de profondeur des pans à 45°** : une face de pan doit se trier colonne par colonne (pied de chaque colonne),
   sinon un perso derrière un pan passe devant. Interdire de s'arrêter dans les cases de pan règle 90 % des cas.
3. **Taille de la carte peinte** : une station de 130 à 160 cases fait 4 000 à 5 000 px monde de côté ; il faut
   peindre par blocs (par anneau et par côté) et ne repeindre qu'un bloc quand un compartiment change.
4. **Le contour 1 px monde de Clawd** (`personnages.py` dessine à l'unité 4 px monde, contour 1 px monde) est plus fin
   que le pixel d'art : écart déjà présent, peu visible ; à aligner (contour 2 px) si on revoit les sprites.
5. **Essaim de sous-agents** : au-delà de 8, l'écran devient illisible ; la grappe « +N » de `univers.md` est
   indispensable dès la v1.
6. **Surcharge de couleurs** : 3 accents d'anneau + 4 couleurs réservées + 8 îlots ; tenir la règle des 3 % de pixels
   d'accent par pièce.
7. **Modèles locaux** : leurs sorties ne respectent ni la projection ni la grille ; les cantonner aux moodboards, aux
   textures de fond et aux poses de Chris, toujours repris par code.
8. **Les murs du sud et de l'est/ouest ne montrent pas de face** : le contenu « mural » (écrans, tableaux, hublots)
   n'existe que sur les murs nord des pièces. La génération doit placer le mur du fond (avec le tableau d'objectifs)
   au nord, ou prévoir des pupitres dans les compartiments des côtés est, ouest et sud.

## 17. Questions pour Chris

1. **Octogone à pans inégaux**, coins = îlots et sas, rondeur portée par la couronne extérieure : ça te va, ou tu
   veux voir le cercle même de près ?
2. **Intérieur chaud** (panneaux crème, moquette, bois dans certains projets) façon station habitée, plutôt que métal
   froid façon SIGNALIS ? Je recommande le chaud, dans la continuité de ce que tu as aimé.
3. **Sous-agents à ½ taille avec casque de chantier** (couleur = modèle) : ça te parle, ou tu les veux plus grands ?
4. **Murs avant en verrière** côté coursive (on voit passer les agents derrière), ou murs pleins et coursives plus
   larges au nord et au sud ?
