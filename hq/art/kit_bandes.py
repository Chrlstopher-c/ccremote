"""Responsabilité : découper dans la pièce vidée par le modèle local (`gen/station/vide-7.png`, tirée de l'image
StockIOP validée par Chris) les BANDES de construction de la station, en vrai pixel art du jeu (3,35 px source = 1 px
d'art ; une plaque de sol = une case de 20 px d'art) : mur du fond, mur bas côté coursive, montant, sol, bord de
coursive et coque, hublot, bouche d'aération, porte, sas. Le moteur les répète et les assemble selon le plan.
Sortie : `public/station/*.png` + `public/station/kit.json` (taille de chaque pièce) + `kit/bandes-test.png`.
"""
from __future__ import annotations

import json
from pathlib import Path

from PIL import Image

from pixeliser import palette, reduire

ICI = Path(__file__).resolve().parent
SOURCE = ICI / 'gen' / 'station' / 'vide-7.png'
SORTIE = ICI.parent / 'public' / 'station'
ECHELLE = 3.35
CASE = 20

# nom → boîte dans l'image source (x0, y0, x1, y1)
BANDES: dict[str, tuple[int, int, int, int]] = {
    'mur-fond': (440, 50, 530, 275),          # coiffe + crème + plinthe : se répète en largeur
    'mur-fond-hublot': (625, 50, 745, 275),
    'mur-fond-bouche': (530, 50, 600, 275),
    'mur-bas': (452, 352, 742, 467),          # mur côté coursive : coiffe épaisse, crème, plinthe bleutée
    'montant': (424, 342, 452, 470),
    'sol': (394, 475, 528, 545),              # deux plaques de sol
    'bord': (440, 560, 740, 700),             # bande lumineuse, lèvre, tranche de la coque
    'porte-bois': (330, 345, 440, 470),
    'sas': (745, 340, 965, 485),
}


def bande(nom: str, source: Image.Image) -> Image.Image:
    morceau = source.crop(BANDES[nom]).convert('RGBA')
    img = palette(reduire(morceau, ECHELLE), 32)
    if nom == 'sol':
        img = img.resize((2 * CASE, CASE), Image.Resampling.NEAREST)
    return img


def essai(b: dict[str, Image.Image]) -> Image.Image:
    """Un pont de trois pièces de largeurs différentes : contrôle des raccords quand les bandes se répètent."""
    largeurs = [96, 140, 120]
    total = sum(largeurs) + 8
    fond, bas, sol, bord = b['mur-fond'], b['mur-bas'], b['sol'], b['bord']
    h = fond.height + 2 * CASE + bas.height + 2 * CASE + bord.height
    img = Image.new('RGBA', (total, h), (3, 5, 16, 255))
    y_sol = fond.height
    for x in range(0, total, sol.width):
        for y in (y_sol, y_sol + CASE, y_sol + 2 * CASE + bas.height - 20, y_sol + 3 * CASE + bas.height - 20):
            img.alpha_composite(sol, (x, y))
    for x in range(0, total, fond.width):
        img.alpha_composite(fond, (x, 0))
    y_bas = y_sol + 2 * CASE - 20
    for x in range(0, total, bas.width):
        img.alpha_composite(bas, (x, y_bas))
    for x in range(0, total, bord.width):
        img.alpha_composite(bord, (x, h - bord.height))
    x = 0
    for w in largeurs:
        img.alpha_composite(b['montant'], (x, y_bas - 3))
        img.alpha_composite(b['porte-bois'], (x + 12, y_bas))
        x += w
    img.alpha_composite(b['montant'], (x, y_bas - 3))
    img.alpha_composite(b['mur-fond-hublot'], (150, 0))
    return img


def main() -> None:
    SORTIE.mkdir(parents=True, exist_ok=True)
    source = Image.open(SOURCE)
    b = {nom: bande(nom, source) for nom in BANDES}
    index = {}
    for nom, img in b.items():
        img.save(SORTIE / f'{nom}.png')
        index[nom] = {'w': img.width, 'h': img.height}
        print(f'{nom:16s} {img.width}×{img.height}')
    (SORTIE / 'kit.json').write_text(json.dumps(index, indent=1))
    t = essai(b)
    t.resize((t.width * 2, t.height * 2), Image.Resampling.NEAREST).save(ICI / 'kit' / 'bandes-test.png')


if __name__ == '__main__':
    main()
