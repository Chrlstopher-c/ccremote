# Direction artistique du monde d'Agent HQ

Référence : **The Escapists 2** (intérieurs, murs, ombres, lumière), un peu moins vu de dessus. Écartés par Chris : le
style « murs baissés » des Sims (16/11) et les murs hauts à deux rangs façon Stardew (16/11, raccords faux).

## Règles (non négociables)

1. **Une seule projection** : vue de dessus avec un léger relief vers le bas. Un objet montre surtout son **dessus** et
   une face avant écrasée : `Y écran = profondeur − hauteur × 0,55` (`HAUTEUR` dans `oblique.py`).
2. **Une seule taille de pixel** : 16 px d'art par case, affichés ×2 (case de 32 px dans le monde).
3. **Murs calculés, jamais posés en tuiles** : un mur occupe une case. Il se dessine depuis le plan
   (`src/monde/carte/peinture/murs.ts`) :
   - un **dessus** clair et fin qui suit le mur et se raccorde à ses voisins (angles, T, croix, bouts) ;
   - sous tout mur horizontal (et au bout bas d'un mur vertical), une **face** courte en briques, la même partout ;
   - le dessus et la face couvrent toute la case : on ne voit jamais d'herbe ou de sol « dans » un mur.
4. **Ombres** : tout (murs, meubles, personnages) projette une ombre douce vers le bas à droite ; le pied des faces
   est assombri. Elles donnent le relief, pas les volumes.
5. **Lumière** : soleil par les fenêtres (taches obliques), voile du soir, halos des lampes et écrans.
6. **Placement** : un meuble a toute son emprise sur du sol, jamais sur une case de mur ; un meuble haut s'adosse au
   mur du fond (son dessin monte devant la face). Ce qui est accroché au mur (tableau) se dessine sur la face.
7. **Personnages** : Clawd en blocs (même moteur de boîtes) ; le perso de Chris à résolution native (vidéos MiniMax H3,
   `marche_video.py`) ; ombre portée ovale décalée vers le bas à droite.

## Plan du bâtiment

Un couloir central. Au nord, **une pièce par projet** (ses agents y travaillent ensemble, largeur selon leur nombre).
Au sud, les pièces communes : bibliothèque (fichiers), réunion, hall d'entrée avec café, salle serveurs (terminal).
Dehors : pelouse, allée vers l'entrée, quelques arbres.

## Outils

`art/oblique.py` : moteur de boîtes → pixel art dans la projection. `art/meubles.py` : recettes des meubles (sortie
`public/objets/`, emprise au sol exacte). Sols, murs, ombres et lumière : dessinés à l'exécution depuis le plan
(`src/monde/carte/peinture/`), ce qui garantit des raccords justes quel que soit le nombre de pièces.
