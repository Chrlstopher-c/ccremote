"""Responsabilité : personnages et UI dans le monde pour les planches de travail — sprites du jeu (Clawd, perso de
Chris, lus dans `hq/public`), sous-agent (Clawd à l'unité 1 px d'art), signes d'état (casque, antenne, anneau),
bulles et liens. Images à l'échelle du monde (1 px d'art = 2 px) ; bulles et liens à l'échelle de la planche.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage

from da_palette import Rgb, couleur, hexa

PERSOS = Path(__file__).resolve().parents[2] / 'public/sprites/persos'
E = 'Etats et persos (reserves)'
CLAWD, CLAWD_O = couleur(E, 'clawd'), couleur(E, 'clawd ombre')


def sprite(nom: str, image: int = 0) -> Image.Image:
    meta = json.loads((PERSOS / 'persos.json').read_text())[nom]
    planche = Image.open(PERSOS / f'{nom}.png').convert('RGBA')
    par_rang = max(1, planche.width // meta['w'])
    x, y = (image % par_rang) * meta['w'], (image // par_rang) * meta['h']
    return planche.crop((x, y, x + meta['w'], y + meta['h']))


def _contour(img: Image.Image, c: Rgb = (40, 30, 34)) -> Image.Image:
    a = np.array(img)
    plein = a[..., 3] > 0
    autour = ndimage.binary_dilation(plein) & ~plein
    a[autour] = (*c, 255)
    return Image.fromarray(a)


def sous_agent(casque: Rgb, porte: bool = False, pas: int = 0) -> Image.Image:
    """Sous-agent : même Clawd, unité = 1 px d'art (moitié de l'agent), casque de chantier couleur du modèle."""
    img = Image.new('RGBA', (16, 15), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    for i, x in enumerate((4, 6, 9, 11)):
        d.rectangle([x, 11, x, 12 - (1 if (i in (0, 3)) == (pas == 1) and pas else 0)], fill=CLAWD_O)
    bras_y = 7 if porte else 6
    d.rectangle([2, bras_y, 13, bras_y + 1], fill=CLAWD)
    d.rectangle([4, 5, 11, 10], fill=CLAWD)
    d.line([(11, 5), (11, 10)], fill=CLAWD_O)
    d.line([(4, 10), (11, 10)], fill=CLAWD_O)
    d.line([(4, 4), (11, 4)], fill=(236, 152, 120))
    d.point((5, 6), fill=(20, 16, 14))
    d.point((10, 6), fill=(20, 16, 14))
    d.rectangle([5, 1, 10, 3], fill=casque)
    d.line([(3, 3), (12, 3)], fill=tuple(round(v * 0.75) for v in casque))
    d.point((6, 1), fill=(255, 255, 240))
    if porte:
        d.rectangle([5, 8, 10, 11], fill=(238, 240, 246))
        d.line([(6, 9), (9, 9)], fill=(120, 130, 150))
    img = _contour(img)
    return img.resize((img.width * 2, img.height * 2), Image.Resampling.NEAREST)


def casque_micro(img: Image.Image) -> Image.Image:
    """Session interactive (Chris est dessus) : casque-micro clair sur un Clawd 64×48 du jeu."""
    out = img.copy()
    d = ImageDraw.Draw(out)
    clair, trait = couleur(E, 'interactif (casque)'), (40, 30, 34)
    d.rectangle([14, 2, 49, 5], fill=trait)
    d.rectangle([16, 2, 47, 3], fill=clair)
    for x0 in (10, 48):
        d.rectangle([x0, 4, x0 + 5, 15], fill=trait)
        d.rectangle([x0 + 2, 6, x0 + 3, 13], fill=clair)
    d.rectangle([14, 14, 21, 15], fill=trait)
    d.rectangle([20, 14, 23, 17], fill=couleur(E, 'bloque (rouge)'))
    return out


def antenne(img: Image.Image, allumee: bool = True) -> Image.Image:
    """Session autonome : antenne fine avec voyant turquoise qui clignote (1 s), personne au casque."""
    out = Image.new('RGBA', (img.width, img.height + 8), (0, 0, 0, 0))
    out.alpha_composite(img, (0, 8))
    d = ImageDraw.Draw(out)
    d.rectangle([40, 4, 41, 14], fill=(40, 30, 34))
    d.rectangle([37, 0, 44, 6], fill=(40, 30, 34))
    d.rectangle([38, 1, 43, 5], fill=couleur(E, 'autonome (antenne)') if allumee else (60, 70, 70))
    d.rectangle([38, 1, 39, 2], fill=(220, 255, 250))
    return out


def anneau(w: int, c: Rgb, epais: int = 2) -> Image.Image:
    """Anneau d'état au sol (ellipse 2:1, en pixels d'art) : rouge = bloqué, ambre = question, blanc = sélection."""
    img = Image.new('RGBA', (w + 4, w // 2 + 4), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.ellipse([0, 0, w + 3, w // 2 + 3], outline=(*c, 255), width=epais)
    return img


def police(taille: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype('/usr/share/fonts/TTF/DejaVuSansMono-Bold.ttf', taille)


def bulle(d: ImageDraw.ImageDraw, x: int, y: int, lignes: list[str], bord: Rgb, taille: int = 13,
          pastille: Rgb | None = None) -> None:
    """Bulle de parole façon Escapists 2 : fond clair, bord sombre de 2 px, queue vers le bas (x, y) = pointe."""
    f = police(taille)
    w = max(d.textlength(t, font=f) for t in lignes) + 16 + (14 if pastille else 0)
    h = len(lignes) * (taille + 3) + 10
    x0, y0 = int(x - w // 2), int(y - h - 8)
    d.rounded_rectangle([x0, y0, x0 + w, y0 + h], radius=6, fill=couleur(E, 'bulle'), outline=bord, width=2)
    d.polygon([(x - 6, y0 + h - 1), (x + 6, y0 + h - 1), (x, y)], fill=couleur(E, 'bulle'))
    d.line([(x - 6, y0 + h), (x, y), (x + 6, y0 + h)], fill=bord, width=2)
    if pastille:
        d.rectangle([x0 + 7, y0 + 7, x0 + 15, y0 + 15], fill=pastille, outline=bord)
    for i, t in enumerate(lignes):
        d.text((x0 + 8 + (14 if pastille else 0), y0 + 5 + i * (taille + 3)), t, font=f, fill=hexa('#262a36'))


def lien(d: ImageDraw.ImageDraw, a: tuple[int, int], b: tuple[int, int], c: Rgb, phase: int = 0) -> None:
    """Lien entre sessions : arc pointillé au-dessus du monde (calque UI), tirets de 6 px qui avancent de a vers b."""
    mx, my = (a[0] + b[0]) / 2, min(a[1], b[1]) - 40
    pts = []
    for k in range(61):
        t = k / 60
        pts.append(((1 - t) ** 2 * a[0] + 2 * (1 - t) * t * mx + t ** 2 * b[0],
                    (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * my + t ** 2 * b[1]))
    for k in range(len(pts) - 1):
        if (k + phase) % 4 < 2:
            d.line([pts[k], pts[k + 1]], fill=c, width=3)
    d.rectangle([b[0] - 3, b[1] - 3, b[0] + 3, b[1] + 3], fill=c)
