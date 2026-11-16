"""Responsabilité : prélever le kit de la station dans l'image de référence validée par Chris (compartiment StockIOP,
`conception/references/chatgpt-9.webp`, et planche `chatgpt-7.webp`) et le remettre au propre en vrai pixel art,
à l'échelle commune du jeu : 4 px de l'image = 1 px d'art, une case = 20 px d'art (une plaque de sol).
Sortie : `art/kit/*.png` (pièces sources du rendu) + `art/kit/planche.png` (contrôle visuel).
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image

from pixeliser import palette, pixeliser, reduire

ICI = Path(__file__).resolve().parent
REF = ICI.parent / 'conception' / 'references'
KIT = ICI / 'kit'
ECHELLE = 4.0
CASE = 20

# nom → (image, boîte x0 y0 x1 y1 dans l'image source, fond à retirer)
PIECES: dict[str, tuple[str, tuple[int, int, int, int], bool]] = {
    'sol-plaque': ('chatgpt-9.webp', (428, 625, 508, 695), False),
    'mur-bas': ('chatgpt-9.webp', (650, 432, 898, 574), False),
    'mur-fond-haut': ('chatgpt-9.webp', (560, 68, 760, 112), False),
    'creme': ('chatgpt-9.webp', (520, 150, 600, 230), False),
    'porte-bois': ('chatgpt-9.webp', (436, 448, 562, 576), False),
    'sas': ('chatgpt-9.webp', (968, 428, 1128, 592), False),
    'hublot': ('chatgpt-9.webp', (792, 118, 916, 230), False),
    'bord-coursive': ('chatgpt-9.webp', (430, 700, 830, 800), False),
}


def piece(nom: str) -> Image.Image:
    fichier, boite, fond = PIECES[nom]
    img = pixeliser(Image.open(REF / fichier), boite, ECHELLE, couleurs=24, fond=fond)
    if nom == 'sol-plaque':  # plaque vue un peu écrasée dans l'image : ramenée à une case carrée
        img = img.resize((CASE, CASE), Image.Resampling.NEAREST)
    return img


def planche(pieces: dict[str, Image.Image]) -> Image.Image:
    z = 5
    largeur = sum(p.width * z + 24 for p in pieces.values()) + 24
    hauteur = max(p.height * z for p in pieces.values()) + 48
    f = Image.new('RGBA', (largeur, hauteur), (11, 14, 28, 255))
    x = 24
    for p in pieces.values():
        f.alpha_composite(p.resize((p.width * z, p.height * z), Image.Resampling.NEAREST), (x, 24))
        x += p.width * z + 24
    return f


def main() -> None:
    KIT.mkdir(exist_ok=True)
    pieces = {nom: piece(nom) for nom in PIECES}
    for nom, img in pieces.items():
        img.save(KIT / f'{nom}.png')
        print(f'{nom:15s} {img.width}×{img.height}')
    planche(pieces).save(KIT / 'planche.png')


if __name__ == '__main__':
    main()
