"""Responsabilité : ramener un morceau d'image de référence (illustration « façon pixel art » générée par ChatGPT,
floue et à pixels irréguliers) en VRAI pixel art du jeu : fond retiré, une seule taille de pixel (grille de 16 px par
case, affichée ×2), palette réduite, bords francs. Utilisé pour bâtir le kit de textures et de sprites de la station.

Usage en module : `pixeliser(image, boite, echelle)` ; en ligne de commande : voir `main`.
"""
from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

Boite = tuple[int, int, int, int]


def retirer_fond(im: Image.Image, tolerance: int = 26) -> Image.Image:
    """Fond uni relié aux bords (couleur prise dans les coins) rendu transparent."""
    a = np.array(im.convert('RGBA')).astype(int)
    coins = np.array([a[0, 0, :3], a[0, -1, :3], a[-1, 0, :3], a[-1, -1, :3]])
    fond = np.median(coins, axis=0)
    proche = np.abs(a[..., :3] - fond).max(axis=2) < tolerance
    etiquettes, _ = ndimage.label(proche)
    bord = set(np.unique(np.concatenate([etiquettes[0], etiquettes[-1], etiquettes[:, 0], etiquettes[:, -1]]))) - {0}
    masque = np.isin(etiquettes, list(bord))
    a[masque, 3] = 0
    return Image.fromarray(a.astype(np.uint8))


def reduire(im: Image.Image, echelle: float) -> Image.Image:
    """Une case de `echelle` px de l'image source devient un pixel d'art (moyenne, alpha tranché net)."""
    w = max(1, round(im.width / echelle))
    h = max(1, round(im.height / echelle))
    a = np.array(im.convert('RGBA')).astype(float)
    a[..., :3] *= a[..., 3:4] / 255
    pre = Image.fromarray(a.astype(np.uint8)).resize((w, h), Image.Resampling.BOX)
    alpha = im.getchannel('A').resize((w, h), Image.Resampling.BOX)
    b = np.array(pre).astype(float)
    al = np.array(alpha).astype(float)
    b[..., :3] = np.where(al[..., None] > 0, b[..., :3] * 255 / np.maximum(al[..., None], 1), 0)
    b[..., 3] = np.where(al > 110, 255, 0)
    return Image.fromarray(b.clip(0, 255).astype(np.uint8))


def palette(im: Image.Image, couleurs: int) -> Image.Image:
    """Palette réduite (médiane), transparence conservée : des aplats nets au lieu du flou de l'illustration."""
    rgb = im.convert('RGB').quantize(colors=couleurs, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    out = rgb.convert('RGBA')
    out.putalpha(im.getchannel('A'))
    return out


def pixeliser(source: Image.Image, boite: Boite, echelle: float, couleurs: int = 20, fond: bool = True) -> Image.Image:
    morceau = source.crop(boite)
    if fond:
        morceau = retirer_fond(morceau)
    else:
        morceau = morceau.convert('RGBA')
    return palette(reduire(morceau, echelle), couleurs)


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('source', type=Path)
    p.add_argument('sortie', type=Path)
    p.add_argument('--boite', type=int, nargs=4, required=True, metavar=('X0', 'Y0', 'X1', 'Y1'))
    p.add_argument('--echelle', type=float, required=True)
    p.add_argument('--couleurs', type=int, default=20)
    p.add_argument('--garder-fond', action='store_true')
    a = p.parse_args()
    img = pixeliser(Image.open(a.source), tuple(a.boite), a.echelle, a.couleurs, not a.garder_fond)
    img.save(a.sortie)
    print(f'{a.sortie} {img.width}×{img.height}')


if __name__ == '__main__':
    main()
