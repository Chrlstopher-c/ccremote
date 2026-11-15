"""Responsabilité : transformer une vidéo de marche du perso de Chris (MiniMax H3, fond vert) en planche de sprites pour
le monde — images extraites, fond vert retiré, boucle de marche détectée (la période qui raccorde le mieux), réduite à
la grille de pixels du jeu (32 px d'art de haut, ×2), ancrée aux pieds.
Usage : python marche_video.py <video.mp4> <nom> [--miroir <nom_miroir>]
"""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

SORTIE = Path(__file__).resolve().parent.parent / 'public/sprites/persos'
# Exception assumée à la règle du pixel ×2 (DIRECTION.md) : Chris reste reconnaissable (visage, lunettes, logo)
# seulement à la résolution native du monde ; 64 px de haut = 2 cases, comme un perso de Stardew.
HAUT_ART = 64
CADRE = (44, 70)
ECHELLE_PERSO = 1
IPS = 12


def images(video: Path) -> list[Image.Image]:
    with tempfile.TemporaryDirectory() as d:
        subprocess.run(['ffmpeg', '-loglevel', 'error', '-i', str(video), '-vf', f'fps={IPS}', f'{d}/f%03d.png'],
                       check=True)
        return [Image.open(p).convert('RGB').copy() for p in sorted(Path(d).glob('f*.png'))]


def detourer(im: Image.Image) -> Image.Image:
    a = np.array(im).astype(int)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    vert = (g > 120) & (g > r * 1.35) & (g > b * 1.35)
    vert = ndimage.binary_dilation(vert, iterations=1)
    rgba = np.dstack([a.astype(np.uint8), np.where(vert, 0, 255).astype(np.uint8)])
    plein = rgba[..., 3] > 0
    lab, n = ndimage.label(plein)
    if n > 1:  # ne garder que la silhouette principale
        tailles = ndimage.sum(plein, lab, range(1, n + 1))
        plein = lab == (int(np.argmax(tailles)) + 1)
        rgba[..., 3] = np.where(plein, 255, 0)
    return Image.fromarray(rgba)


def silhouette(im: Image.Image) -> np.ndarray:
    return np.array(im.resize((48, 72)))[..., 3] > 0


def periode(sils: list[np.ndarray]) -> tuple[int, int]:
    """(début, longueur) de la boucle : deux images à `longueur` d'écart doivent se ressembler le plus."""
    meilleur = (0, 8, 1e9)
    for debut in range(2, min(10, len(sils) - 16)):
        for n in range(6, 15):
            if debut + n >= len(sils):
                break
            ecart = float(np.mean(sils[debut] ^ sils[debut + n]))
            if ecart < meilleur[2]:
                meilleur = (debut, n, ecart)
    return meilleur[0], meilleur[1]


def contour(a: np.ndarray) -> np.ndarray:
    plein = a[..., 3] > 0
    autour = ndimage.binary_dilation(plein) & ~plein
    a[autour] = (24, 18, 26, 255)
    return a


def reduire(im: Image.Image, boite: tuple[int, int, int, int]) -> Image.Image:
    im = im.crop(boite)
    w = max(1, round(im.width * HAUT_ART / im.height))
    petit = im.resize((w, HAUT_ART), Image.Resampling.LANCZOS)
    a = np.array(petit)
    a[..., 3] = np.where(a[..., 3] > 128, 255, 0)
    a = contour(a)
    toile = Image.new('RGBA', CADRE, (0, 0, 0, 0))
    toile.alpha_composite(Image.fromarray(a), ((CADRE[0] - w) // 2, CADRE[1] - 1 - HAUT_ART))
    return toile.resize((CADRE[0] * ECHELLE_PERSO, CADRE[1] * ECHELLE_PERSO), Image.Resampling.NEAREST)


def planche(boucle: list[Image.Image], nom: str) -> dict:
    w, h = boucle[0].size
    p = Image.new('RGBA', (w * len(boucle), h), (0, 0, 0, 0))
    for i, im in enumerate(boucle):
        p.alpha_composite(im, (i * w, 0))
    p.save(SORTIE / f'{nom}.png')
    return {'w': w, 'h': h, 'n': len(boucle), 'seq': [[i, round(1000 / IPS)] for i in range(len(boucle))],
            'ancre': [w // 2, h - 2]}


def main() -> None:
    video, nom = Path(sys.argv[1]), sys.argv[2]
    options = dict(zip(sys.argv[3::2], sys.argv[4::2]))
    miroir = options.get('--miroir')
    repos = options.get('--repos')  # pose immobile = première image de la boucle (même échelle que la marche)
    detourees = [detourer(im) for im in images(video)]
    debut, n = periode([silhouette(im) for im in detourees])
    boucle = detourees[debut:debut + n]
    boites = [im.getbbox() or (0, 0, 1, 1) for im in boucle]
    commune = (min(b[0] for b in boites), min(b[1] for b in boites), max(b[2] for b in boites),
               max(b[3] for b in boites))
    reduites = [reduire(im, commune) for im in boucle]
    index_chemin = SORTIE / 'persos.json'
    index = json.loads(index_chemin.read_text())
    index[nom] = planche(reduites, nom)
    if miroir:
        index[miroir] = planche([im.transpose(Image.Transpose.FLIP_LEFT_RIGHT) for im in reduites], miroir)
    if repos:
        index[repos] = planche(reduites[:1], repos)
        index[repos]['seq'] = [[0, 1000]]
    index_chemin.write_text(json.dumps(index, indent=1))
    print(f'{nom} : boucle de {n} images à partir de {debut}')


if __name__ == '__main__':
    main()
