"""Responsabilité : les planches d'animation de Clawd au style de la station, tirées du Clawd de la planche ChatGPT
validée par Chris (`kit/clawd/corps-fini.png`, vue de face, remis en pixel art par `pixeliser.py`). On dérive la vue
de dos (yeux effacés), la marche (corps qui rebondit), la position assise (jambes cachées par la chaise) et la frappe
(bras qui montent). Même format que l'ancien (`public/sprites/persos/persos.json`) : le moteur n'a rien à changer.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ICI = Path(__file__).resolve().parent
SORTIE = ICI.parent / 'public' / 'sprites' / 'persos'
CADRE = (32, 30)  # pixels d'art par image (×2 dans le monde)
PIED = 27  # rang d'art où posent les pieds dans le cadre
JAMBES = 17  # premier rang des jambes dans le corps


def corps() -> np.ndarray:
    a = np.array(Image.open(ICI / 'kit' / 'clawd' / 'corps-fini.png').convert('RGBA'))
    etiquettes, n = ndimage.label(a[..., 3] > 0)
    if n > 1:  # reste de la bulle au-dessus de la tête : on ne garde que le plus grand morceau (le corps)
        tailles = ndimage.sum(np.ones(etiquettes.shape), etiquettes, range(1, n + 1))
        a[etiquettes != int(np.argmax(tailles)) + 1] = 0
    return a


def dos(a: np.ndarray) -> np.ndarray:
    b = a.copy()
    lum = b[..., :3].astype(int).sum(axis=2)
    plein = b[..., 3] > 0
    mediane = np.median(lum[plein])
    zone = np.arange(b.shape[0])[:, None] < JAMBES - 3
    yeux = plein & zone & (lum < mediane * 0.8) & (np.arange(b.shape[1])[None, :] > 4) & \
        (np.arange(b.shape[1])[None, :] < b.shape[1] - 5)
    for y, x in zip(*np.nonzero(yeux)):
        b[y, x] = b[y, 6] if x > b.shape[1] // 2 else b[y, b.shape[1] - 7]
    return b


def cadre(a: np.ndarray, dy: int = 0, sans_jambes: bool = False, bras: int = 0) -> Image.Image:
    b = a.copy()
    if sans_jambes:
        b[JAMBES:] = 0
    if bras:
        h, w = b.shape[:2]
        for x0, x1 in ((0, 4), (w - 4, w)):
            zone = b[:, x0:x1].copy()
            b[:, x0:x1] = np.roll(zone, -bras, axis=0)
    img = Image.new('RGBA', CADRE, (0, 0, 0, 0))
    pied = PIED + (4 if sans_jambes else 0)
    img.alpha_composite(Image.fromarray(b), ((CADRE[0] - b.shape[1]) // 2, pied - b.shape[0] + dy))
    return img


def planche(images: list[Image.Image], ms: list[int]) -> tuple[Image.Image, dict]:
    w, h = CADRE
    p = Image.new('RGBA', (w * len(images), h))
    for k, im in enumerate(images):
        p.alpha_composite(im, (k * w, 0))
    p = p.resize((p.width * 2, p.height * 2), Image.Resampling.NEAREST)
    meta = {'w': w * 2, 'h': h * 2, 'n': len(images), 'seq': [[k, t] for k, t in enumerate(ms)], 'ancre': [w, PIED * 2]}
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
    f = corps()
    d = dos(f)
    index = json.loads((SORTIE / 'persos.json').read_text())
    for nom, (images, ms) in animations(f, d).items():
        img, meta = planche(images, ms)
        img.save(SORTIE / f'{nom}.png')
        index[nom] = meta
        print(nom, meta['n'], 'images')
    (SORTIE / 'persos.json').write_text(json.dumps(index, indent=1))


if __name__ == '__main__':
    main()
