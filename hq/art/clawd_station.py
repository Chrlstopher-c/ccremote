"""Responsabilité : les planches d'animation de Clawd au style de la station, tirées de la planche rendue par le modèle
local à partir de celle de Chris (`gen/station/clawd-32.png` : vue de face et vue de dos, pleine résolution, ramenées
à la taille du jeu avec un lissage propre). On en dérive la marche (corps qui rebondit), la position assise (jambes
cachées par la chaise) et la frappe (bras qui montent). Même format que `public/sprites/persos/persos.json`.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ICI = Path(__file__).resolve().parent
SORTIE = ICI.parent / 'public' / 'sprites' / 'persos'
CADRE = (64, 60)  # pixels du monde par image
PIED = 56  # rang où posent les pieds dans le cadre
HAUTEUR = 40  # hauteur du corps dans le monde (≈ 0,6 fois Chris, comme dans les images de référence)
JAMBES = 31  # premier rang des jambes dans le corps réduit
SOURCE = ICI / 'gen' / 'station' / 'clawd-32.png'
FACE = (177, 136, 307, 254)
DOS = (955, 401, 1086, 520)


def vue(boite: tuple[int, int, int, int]) -> np.ndarray:
    """Une vue de la planche, fond retiré (restes détachés écartés), réduite à la taille du jeu."""
    im = Image.open(SOURCE).convert('RGBA').crop(boite)
    a = np.array(im).astype(int)
    fond = np.median(np.concatenate([a[0], a[-1]])[:, :3], axis=0)
    plein = np.abs(a[..., :3] - fond).max(axis=2) > 40
    etiquettes, n = ndimage.label(ndimage.binary_dilation(plein, iterations=3))
    if n > 1:  # le robot (corps, bras, jambes rapprochés par la dilatation) est le plus grand morceau
        tailles = ndimage.sum(np.ones(etiquettes.shape), etiquettes, range(1, n + 1))
        plein &= etiquettes == int(np.argmax(tailles)) + 1
    a[..., 3] = np.where(plein, 255, 0)
    img = Image.fromarray(a.astype(np.uint8)).crop(Image.fromarray(plein.astype(np.uint8) * 255).getbbox())
    w = round(img.width * HAUTEUR / img.height)
    return np.array(img.resize((w, HAUTEUR), Image.Resampling.LANCZOS))


def cadre(a: np.ndarray, dy: int = 0, sans_jambes: bool = False, bras: int = 0) -> Image.Image:
    b = a.copy()
    if sans_jambes:
        b[JAMBES:] = 0
    if bras:
        h, w = b.shape[:2]
        for x0, x1 in ((0, 8), (w - 8, w)):
            zone = b[:, x0:x1].copy()
            b[:, x0:x1] = np.roll(zone, -bras, axis=0)
    img = Image.new('RGBA', CADRE, (0, 0, 0, 0))
    pied = PIED + (8 if sans_jambes else 0)
    img.alpha_composite(Image.fromarray(b), ((CADRE[0] - b.shape[1]) // 2, pied - b.shape[0] + dy))
    return img


def planche(images: list[Image.Image], ms: list[int]) -> tuple[Image.Image, dict]:
    w, h = CADRE
    p = Image.new('RGBA', (w * len(images), h))
    for k, im in enumerate(images):
        p.alpha_composite(im, (k * w, 0))
    meta = {'w': w, 'h': h, 'n': len(images), 'seq': [[k, t] for k, t in enumerate(ms)], 'ancre': [w // 2, PIED]}
    return p, meta


def animations(f: np.ndarray, d: np.ndarray) -> dict[str, tuple[list[Image.Image], list[int]]]:
    marche = lambda a: ([cadre(a), cadre(a, -1)], [180, 180])  # noqa: E731
    return {
        'clawd-repos': ([cadre(f), cadre(f, 0), cadre(f, -1)], [900, 700, 300]),
        'clawd-marche-bas': marche(f),
        'clawd-marche-haut': marche(d),
        'clawd-marche-droite': marche(f),
        'clawd-marche-gauche': marche(f),
        'clawd-repos-dos': ([cadre(d)], [1000]),
        'clawd-frappe': ([cadre(f, bras=1), cadre(f), cadre(f, bras=1)], [160, 160, 160]),
        'clawd-content': ([cadre(f, -2), cadre(f)], [220, 220]),
        'clawd-assis-frappe': ([cadre(d, sans_jambes=True, bras=k % 2) for k in range(6)], [140] * 6),
        'clawd-assis-dos': ([cadre(d, sans_jambes=True)], [1000]),
        'clawd-assis-face': ([cadre(f, sans_jambes=True), cadre(f, sans_jambes=True), cadre(f, -1, True)], [900, 600, 300]),
        'clawd-assis-question': ([cadre(f, sans_jambes=True), cadre(f, -1, True)], [500, 500]),
        'clawd-question': ([cadre(f), cadre(f, -1)], [500, 500]),
    }


def main() -> None:
    f = vue(FACE)
    d = vue(DOS)
    index = json.loads((SORTIE / 'persos.json').read_text())
    for nom, (images, ms) in animations(f, d).items():
        img, meta = planche(images, ms)
        img.save(SORTIE / f'{nom}.png')
        index[nom] = meta
        print(nom, meta['n'], 'images')
    (SORTIE / 'persos.json').write_text(json.dumps(index, indent=1))


if __name__ == '__main__':
    main()
