"""Responsabilité : découper les objets générés en local (Qwen-Image, fond blanc) et les ramener à l'échelle du monde
(tuile 32 px) : fond relié aux bords retiré, recadrage, réduction, alpha franc, liseré sombre.
Sortie : `public/objets/<nom>.png` + `public/objets.json` (taille, emprise au sol en pixels pour les collisions).
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ICI = Path(__file__).resolve().parent
SOURCES = Path('/mnt/projects/minimax-h3-studio/sorties/agent-hq')
SORTIE = ICI.parent / 'public'

# nom → (largeur dans le monde en px, hauteur de l'emprise au sol en px depuis le bas)
TAILLES: dict[str, tuple[int, int]] = {
    'bureau': (96, 22), 'chaise': (30, 10), 'etagere': (46, 14), 'serveur': (36, 14), 'crt': (60, 18),
    'cafe': (60, 20), 'plante': (28, 10), 'table': (124, 44), 'canape': (92, 22), 'tableau': (60, 8),
    'arbre': (92, 18), 'buisson': (40, 14), 'lampadaire': (28, 8), 'banc': (68, 14), 'cendrier': (18, 6),
    'distributeur': (48, 16),
}


def detourer(im: Image.Image) -> Image.Image:
    a = np.array(im.convert('RGBA'))
    rgb = a[..., :3].astype(int)
    clair = (rgb.min(axis=2) > 228) & ((rgb.max(axis=2) - rgb.min(axis=2)) < 18)
    lab, _ = ndimage.label(clair)
    bords = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    fond = np.isin(lab, list(bords))
    gris = (rgb.max(axis=2) - rgb.min(axis=2) < 14) & (rgb.min(axis=2) > 150)
    fond |= ndimage.binary_dilation(fond, iterations=40) & gris   # ombre portée grise sur le fond
    a[fond, 3] = 0
    return Image.fromarray(a)


def reduire(im: Image.Image, largeur: int) -> Image.Image:
    boite = im.getbbox() or (0, 0, 1, 1)
    im = im.crop(boite)
    h = max(1, round(im.height * largeur / im.width))
    petit = im.resize((largeur, h), Image.Resampling.LANCZOS)
    a = np.array(petit)
    a[..., 3] = np.where(a[..., 3] > 120, 255, 0)
    plein = a[..., 3] > 0
    autour = ndimage.binary_dilation(plein) & ~plein
    a[autour] = (46, 32, 30, 255)
    return Image.fromarray(a)


def main() -> None:
    (SORTIE / 'objets').mkdir(parents=True, exist_ok=True)
    index = {}
    for nom, (largeur, emprise) in TAILLES.items():
        sources = sorted(SOURCES.glob(f'objet-{nom}-*.png'))
        if not sources:
            continue
        im = reduire(detourer(Image.open(sources[0])), largeur)
        im.save(SORTIE / f'objets/{nom}.png')
        index[nom] = {'w': im.width, 'h': im.height, 'emprise': emprise}
    (SORTIE / 'objets.json').write_text(json.dumps(index, indent=1))
    print(', '.join(f"{k} {v['w']}×{v['h']}" for k, v in index.items()))


if __name__ == '__main__':
    main()
