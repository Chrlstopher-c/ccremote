# Direction artistique du monde d'Agent HQ

Référence : intérieurs de Stardew Valley / Eastward (le style « murs baissés » des Sims a été écarté par Chris le 16/11).

## Règles (non négociables)

1. **Une seule projection pour tout** : vue de dessus trois-quarts (« 3/4 top-down »). Le sol est une grille carrée ; un
   objet montre son **dessus** et sa **face avant**, jamais ses côtés. Écran : `Y = profondeur − hauteur` (1:1).
   Mélanger des objets vus sous des angles différents (images générées, packs) = l'effet « assemblé » à bannir.
2. **Une seule taille de pixel** : tout est dessiné sur une grille de 16 px par case puis agrandi ×2 (pas de « mixels » :
   aucun asset à 1 px fin à côté d'un asset à gros pixels).
3. **Lumière unique en haut à gauche** : dessus le plus clair, face avant moyenne, arête basse sombre, liseré clair à
   gauche. Pas de contour sombre sur les arêtes intérieures ; contour extérieur seulement pour détacher du sol.
4. **Murs** : tout mur horizontal montre sa face (bande de 2 cases ; fenêtres sur le mur extérieur du nord), les portes
   percent ces faces, les murs verticaux sont fins ; la façade sud se voit depuis la rue.
5. **Placement** : un meuble haut s'adosse à la face du mur du fond de sa pièce. Profondeur = bas de l'emprise (tri en
   Y) ; un tapis est toujours sous les personnages.
6. **Exception** : le perso de Chris est à la résolution native (pas ×2) pour rester reconnaissable (visage, lunettes,
   logo) ; ses marches (4 directions) viennent de vidéos MiniMax H3 sur fond vert (`marche_video.py`).
7. **Personnages** : face avant (Stardew), 2 cases de haut pour un humain, ombre portée elliptique au sol, Clawd en
   blocs (même moteur de boîtes que les meubles).

## Outil

`art/oblique.py` : moteur de boîtes (matériaux bois, métal, tissu, écran, feuillage) → pixel art dans cette projection.
`art/meubles.py` : recettes des meubles (bureau, écran, chaise, étagère, baie serveur, terminal, café, distributeur,
canapé, table, plante, tableau blanc, extérieur). Sortie dans `public/objets/` avec l'emprise au sol exacte.

Sources : Pixelblog 35 (Top Down Interiors) et 3-4 (projections) de Raymond Schlitter (slynyrd.com) ; guide de
conception de pièces RPG (« commit to one tilt across the entire game »).
