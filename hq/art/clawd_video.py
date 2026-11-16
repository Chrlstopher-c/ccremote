"""Responsabilité : transformer une vidéo de marche de Clawd (MiniMax H3, fond vert, à partir de sa planche rendue par
le modèle) en planche d'animation du jeu : images extraites, fond vert retiré (corps, bras et jambes gardés ensemble),
boucle de marche détectée, réduite à la taille de Clawd dans le monde (lissage propre), ancrée aux pieds.
`--sans-yeux` donne la vue de dos (Clawd est un cube : de dos, c'est la même marche sans les yeux).
Usage : python clawd_video.py <video.mp4> <nom> [--miroir <nom_miroir>] [--sans-yeux]
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

from marche_video import images, periode, silhouette

SORTIE = Path(__file__).resolve().parent.parent / 'public/sprites/persos'
CADRE = (64, 60)
PIED = 56
HAUTEUR = 40  # même taille que les autres poses de Clawd (clawd_station.py)
IPS = 12


def detourer(im: Image.Image) -> Image.Image:
    a = np.array(im).astype(int)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    vert = (g > 110) & (g > r * 1.3) & (g > b * 1.3)
    plein = ~ndimage.binary_dilation(vert, iterations=1)
    lab, n = ndimage.label(ndimage.binary_dilation(plein, iterations=6))
    if n > 1:  # le robot (bras et jambes rapprochés du corps par la dilatation) est le plus grand morceau
        tailles = ndimage.sum(np.ones(lab.shape), lab, range(1, n + 1))
        plein &= lab == int(np.argmax(tailles)) + 1
    return Image.fromarray(np.dstack([a.astype(np.uint8), np.where(plein, 255, 0).astype(np.uint8)]))


def sans_yeux(im: Image.Image) -> Image.Image:
    a = np.array(im)
    interieur = ndimage.binary_erosion(a[..., 3] > 0, iterations=4)  # loin du contour : seuls les yeux sont sombres
    sombre = interieur & (a[..., :3].astype(int).sum(axis=2) < 300)
    corps = (a[..., 3] > 0) & ~sombre
    h = a.shape[0]
    yeux = ndimage.binary_dilation(sombre, iterations=2) & interieur & (np.arange(h)[:, None] < h * 0.6)
    ys, xs = np.nonzero(yeux)
    for y, x in zip(ys, xs):  # chaque pixel d'œil prend la couleur du corps juste au-dessus
        k = y
        while k > 0 and not corps[k, x]:
            k -= 1
        a[y, x] = a[k, x]
    return Image.fromarray(a)


def reduire(im: Image.Image, boite: tuple[int, int, int, int]) -> Image.Image:
    im = im.crop(boite)
    w = max(1, round(im.width * HAUTEUR / im.height))
    a = np.array(im.resize((w, HAUTEUR), Image.Resampling.LANCZOS))
    a[..., 3] = np.where(a[..., 3] > 128, 255, 0)
    toile = Image.new('RGBA', CADRE, (0, 0, 0, 0))
    toile.alpha_composite(Image.fromarray(a), ((CADRE[0] - w) // 2, PIED - HAUTEUR))
    return toile


def planche(boucle: list[Image.Image], nom: str) -> dict:
    w, h = CADRE
    p = Image.new('RGBA', (w * len(boucle), h), (0, 0, 0, 0))
    for i, im in enumerate(boucle):
        p.alpha_composite(im, (i * w, 0))
    p.save(SORTIE / f'{nom}.png')
    return {'w': w, 'h': h, 'n': len(boucle), 'seq': [[i, round(1000 / IPS)] for i in range(len(boucle))],
            'ancre': [w // 2, PIED]}


def main() -> None:
    video, nom = Path(sys.argv[1]), sys.argv[2]
    args = sys.argv[3:]
    miroir = args[args.index('--miroir') + 1] if '--miroir' in args else None
    detourees = [detourer(im) for im in images(video)]
    debut, n = periode([silhouette(im) for im in detourees])
    boucle = detourees[debut:debut + n]
    if '--sans-yeux' in args:
        boucle = [sans_yeux(im) for im in boucle]
    boites = [im.getbbox() or (0, 0, 1, 1) for im in boucle]
    commune = (min(b[0] for b in boites), min(b[1] for b in boites), max(b[2] for b in boites), max(b[3] for b in boites))
    reduites = [reduire(im, commune) for im in boucle]
    index_chemin = SORTIE / 'persos.json'
    index = json.loads(index_chemin.read_text())
    index[nom] = planche(reduites, nom)
    if miroir:
        index[miroir] = planche([im.transpose(Image.Transpose.FLIP_LEFT_RIGHT) for im in reduites], miroir)
    index_chemin.write_text(json.dumps(index, indent=1))
    print(f'{nom} : boucle de {n} images à partir de {debut}')


if __name__ == '__main__':
    main()
