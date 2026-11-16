"""Responsabilité : meubles de la station pour les planches de travail, faits avec le moteur de boîtes du jeu
(`hq/art/oblique.py`, lu sans être modifié) : même projection, même pixel. Chaque recette rend une image ×2 (monde).
"""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'art'))
from oblique import Boite, Objet, Rect, assombrir, eclaircir, rendre  # noqa: E402

from da_palette import Rgb, couleur  # noqa: E402

COQUE = couleur('Metal, verre, lumiere', 'metal clair')
GRIS = couleur('Metal, verre, lumiere', 'metal')
SOMBRE = (52, 56, 68)
ECRAN = couleur('Metal, verre, lumiere', 'ecran')


def _ecran(c: Rgb, lignes: bool = True) -> object:
    def f(d: ImageDraw.ImageDraw, av: Rect, _t: Rect) -> None:
        x0, y0, x1, y1 = av[0] + 1, av[1] + 1, av[2] - 1, av[3] - 1
        d.rectangle([x0, y0, x1, y1], fill=assombrir(c, 0.55))
        if lignes:
            for k, y in enumerate(range(y0 + 1, y1, 2)):
                d.line([(x0 + 1, y), (x0 + 1 + (k * 5) % max(2, x1 - x0 - 2), y)], fill=c)
        d.point((x1 - 1, y0 + 1), fill=eclaircir(c, 0.5))
    return f


def poste(accent: Rgb) -> Image.Image:
    """Poste d'agent : plan de travail en composite, caisson à droite, deux écrans, bande d'accent de l'anneau."""
    def bande(d: ImageDraw.ImageDraw, av: Rect, _t: Rect) -> None:
        d.line([(av[0], av[1] + 1), (av[2], av[1] + 1)], fill=accent)
    return rendre(Objet([
        Boite(0, 2, 0, 4, 10, 15, GRIS), Boite(34, 2, 0, 12, 11, 15, GRIS, bande),
        Boite(0, 0, 15, 46, 13, 2, COQUE),
        Boite(8, 1, 17, 14, 2, 11, SOMBRE, _ecran(ECRAN)),
        Boite(24, 1, 17, 14, 2, 11, SOMBRE, _ecran((150, 230, 170))),
        Boite(14, 8, 17, 14, 3, 1, (210, 214, 222)),
    ]))[0]


def console_fil(accent: Rgb) -> Image.Image:
    """Console du fil de discussion : pupitre incliné, grand écran où défilent les messages (bulles alternées)."""
    def fil(d: ImageDraw.ImageDraw, av: Rect, _t: Rect) -> None:
        x0, y0, x1, y1 = av[0] + 2, av[1] + 2, av[2] - 2, av[3] - 2
        d.rectangle([x0, y0, x1, y1], fill=(18, 24, 36))
        y, k = y0 + 1, 0
        while y + 2 <= y1:
            gauche = k % 2 == 0
            w = 10 + (k * 7) % 12
            xa = x0 + 1 if gauche else x1 - w
            d.rectangle([xa, y, xa + w, y + 1], 
                        fill=(238, 240, 246) if gauche else couleur('Etats et persos (reserves)', 'clawd'))
            y, k = y + 4, k + 1
    return rendre(Objet([
        Boite(4, 4, 0, 32, 8, 12, SOMBRE),
        Boite(0, 0, 12, 40, 3, 22, (60, 66, 82), fil),
        Boite(0, 3, 12, 40, 9, 2, accent),
    ]))[0]


def bibliotheque() -> Image.Image:
    """Bibliothèque du projet : casier d'archives, cartouches de données lumineuses + quelques reliures papier."""
    def casiers(d: ImageDraw.ImageDraw, av: Rect, _t: Rect) -> None:
        teintes = [(120, 210, 250), (160, 230, 170), (240, 200, 110), (238, 240, 246), (190, 150, 240)]
        for e, y in enumerate(range(av[1] + 2, av[3] - 2, 7)):
            d.line([(av[0] + 1, y + 6), (av[2] - 1, y + 6)], fill=(30, 32, 40))
            for k, x in enumerate(range(av[0] + 2, av[2] - 2, 3)):
                c = teintes[(k * 3 + e) % len(teintes)]
                d.rectangle([x, y + 1 + (k + e) % 2, x + 1, y + 5], fill=c if (k + e) % 4 else assombrir(c, 0.5))
    return rendre(Objet([Boite(0, 0, 0, 28, 7, 34, (70, 76, 92), casiers)]))[0]


def terminal() -> Image.Image:
    """Terminal du projet : baie basse + moniteur cathodique au phosphore vert (le shell du projet)."""
    def crt(d: ImageDraw.ImageDraw, av: Rect, _t: Rect) -> None:
        x0, y0, x1, y1 = av[0] + 2, av[1] + 2, av[2] - 2, av[3] - 2
        d.rectangle([x0, y0, x1, y1], fill=(16, 44, 24))
        for k, y in enumerate(range(y0 + 1, y1, 2)):
            d.line([(x0 + 1, y), (x0 + 2 + (k * 4) % (x1 - x0 - 2), y)], fill=(90, 240, 130))
    def baie(d: ImageDraw.ImageDraw, av: Rect, _t: Rect) -> None:
        for k, y in enumerate(range(av[1] + 2, av[3] - 1, 3)):
            d.point((av[0] + 2, y), fill=(90, 230, 120) if k % 3 else (240, 160, 48))
            d.line([(av[0] + 4, y), (av[2] - 2, y)], fill=(34, 36, 44))
    return rendre(Objet([
        Boite(0, 2, 0, 20, 10, 14, SOMBRE, baie),
        Boite(2, 3, 14, 16, 8, 14, (200, 196, 180), crt),
    ]))[0]


def pod_sous_agents(accent: Rgb) -> Image.Image:
    """Baie de lancement des sous-agents : socle lumineux + arceau ; c'est d'ici qu'ils apparaissent."""
    def socle(d: ImageDraw.ImageDraw, av: Rect, t: Rect) -> None:
        d.rectangle([t[0] + 2, t[1] + 1, t[2] - 2, t[3] - 1], fill=eclaircir(accent, 0.3))
        d.line([(av[0], av[1]), (av[2], av[1])], fill=eclaircir(accent, 0.6))
    return rendre(Objet([
        Boite(0, 0, 0, 30, 18, 3, (60, 66, 82), socle),
        Boite(0, 0, 3, 3, 3, 28, GRIS), Boite(27, 0, 3, 3, 3, 28, GRIS),
        Boite(0, 0, 31, 30, 3, 3, GRIS, lambda d, av, t: d.line([(av[0] + 2, av[1] + 1), (av[2] - 2, av[1] + 1)],
                                                                  fill=accent)),
    ]))[0]


def poubelle() -> Image.Image:
    return rendre(Objet([Boite(0, 0, 0, 8, 7, 10, (80, 120, 100),
                               lambda d, av, t: d.line([(av[0] + 2, av[1] + 2), (av[2] - 2, av[1] + 2)],
                                                       fill=(220, 220, 210)))]))[0]


def plante() -> Image.Image:
    """Bac hydroponique : cuve métal + touffe de feuilles en losanges (dessinées, pas en boîtes)."""
    feuilles = [(70, 128, 76), (96, 160, 92), (130, 190, 110)]

    def touffe(d: ImageDraw.ImageDraw, ecran: object) -> None:
        x0, y0 = ecran(0, 4, 8)  # type: ignore[operator]
        for k, (dx, dy, c) in enumerate([(2, -2, 0), (9, -3, 0), (5, -6, 1), (1, -8, 1), (10, -9, 1), (6, -11, 2),
                                         (3, -13, 2), (8, -14, 2)]):
            cx, cy = x0 + dx + 1, y0 + dy
            d.polygon([(cx, cy - 3), (cx + 2, cy), (cx, cy + 2), (cx - 2, cy)], fill=feuilles[c])
            d.point((cx, cy - 2), fill=(170, 220, 140))
    return rendre(Objet([Boite(0, 0, 0, 14, 8, 8, GRIS)], extra=[touffe], marge_haut=16))[0]


def cendrier_pied() -> Image.Image:
    """Cendrier sur pied du coin fumeur : colonne fine, coupelle de sable clair."""
    return rendre(Objet([Boite(2, 2, 0, 4, 4, 14, GRIS), Boite(0, 0, 14, 8, 8, 2, (200, 196, 180))]))[0]


def banc() -> Image.Image:
    return rendre(Objet([Boite(1, 4, 0, 3, 3, 7, SOMBRE), Boite(26, 4, 0, 3, 3, 7, SOMBRE),
                         Boite(0, 0, 7, 30, 10, 2, (150, 120, 84))]))[0]


def chaise() -> Image.Image:
    return rendre(Objet([Boite(2, 6, 0, 2, 2, 7, SOMBRE), Boite(0, 2, 7, 14, 10, 2, (62, 66, 80)),
                         Boite(0, 0, 9, 14, 3, 10, (62, 66, 80))]))[0]
