"""Responsabilité : moteur de boîtes du monde d'Agent HQ — dessine des objets faits de boîtes dans LA projection du jeu
(vue de dessus trois-quarts : dessus + face avant, `Y écran = profondeur − hauteur`), lumière en haut à gauche, sur
une grille de 16 px par case, puis agrandit ×2. Voir DIRECTION.md.
"""
from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

Couleur = tuple[int, int, int]
Rect = tuple[int, int, int, int]  # x0, y0, x1, y1 inclus, en pixels de la toile
Detail = Callable[[ImageDraw.ImageDraw, Rect, Rect], None]  # (dessin, face avant, dessus)

ECHELLE = 2       # 1 pixel d'art = 2 pixels du monde
CASE = 16         # pixels d'art par case
HAUTEUR = 0.55    # écrasement des hauteurs : vue plus de dessus (The Escapists 2)


def _z(v: int) -> int:
    return round(v * HAUTEUR)


def eclaircir(c: Couleur, f: float) -> Couleur:
    return tuple(min(255, round(v + (255 - v) * f)) for v in c)  # type: ignore[return-value]


def assombrir(c: Couleur, f: float) -> Couleur:
    return tuple(max(0, round(v * (1 - f))) for v in c)  # type: ignore[return-value]


@dataclass
class Boite:
    """Boîte posée dans l'espace de l'objet : x (gauche→droite), y (fond→avant), z (sol→haut), en pixels d'art."""
    x: int
    y: int
    z: int
    w: int
    d: int
    h: int
    couleur: Couleur
    detail: Detail | None = None
    dessus: Couleur | None = None   # couleur du dessus si différente (sinon éclaircie)
    visible: bool = True            # boîte qui ne sert qu'à réserver la place (dessin fait par `extra`)


@dataclass
class Objet:
    boites: list[Boite]
    extra: list[Callable[[ImageDraw.ImageDraw, Callable[[int, int, int], tuple[int, int]]], None]] = field(
        default_factory=list)
    marge_haut: int = 0   # hauteur dessinée au-dessus des boîtes par `extra` (feuillage…)
    marge_cote: int = 0   # débord latéral de `extra`


def _faces(b: Boite, haut: int) -> tuple[Rect, Rect]:
    """Rectangles écran (dessus, face avant) d'une boîte ; `haut` = hauteur max de l'objet (origine verticale)."""
    y_top0 = b.y - _z(b.z + b.h) + haut
    y_top1 = b.y + b.d - _z(b.z + b.h) + haut - 1
    y_av0 = y_top1 + 1
    y_av1 = b.y + b.d - _z(b.z) + haut - 1
    return (b.x, y_top0, b.x + b.w - 1, y_top1), (b.x, y_av0, b.x + b.w - 1, y_av1)


def _peindre(d: ImageDraw.ImageDraw, b: Boite, haut: int) -> None:
    if not b.visible:
        return
    dessus, avant = _faces(b, haut)
    c_dessus = b.dessus or eclaircir(b.couleur, 0.22)
    if b.d > 0 and dessus[3] >= dessus[1]:
        d.rectangle(dessus, fill=c_dessus)
        d.line([(dessus[0], dessus[1]), (dessus[2], dessus[1])], fill=eclaircir(c_dessus, 0.15))
    if _z(b.z + b.h) > _z(b.z) and avant[3] >= avant[1]:
        d.rectangle(avant, fill=b.couleur)
        d.line([(avant[0], avant[1]), (avant[2], avant[1])], fill=eclaircir(b.couleur, 0.12))
        d.line([(avant[0], avant[1]), (avant[0], avant[3])], fill=eclaircir(b.couleur, 0.08))
        d.line([(avant[0], avant[3]), (avant[2], avant[3])], fill=assombrir(b.couleur, 0.3))
        d.line([(avant[2], avant[1]), (avant[2], avant[3])], fill=assombrir(b.couleur, 0.15))
    if b.detail:
        b.detail(d, avant, dessus)


def rendre(obj: Objet, rogner: bool = True) -> tuple[Image.Image, int]:
    """Image ×2 de l'objet (contour extérieur sombre) et son emprise au sol en pixels du monde (profondeur)."""
    largeur = max(b.x + b.w for b in obj.boites) + 2 + 2 * obj.marge_cote
    haut = _z(max(b.z + b.h for b in obj.boites)) + 1 + obj.marge_haut
    for b in obj.boites:
        b.x += obj.marge_cote
    prof = max(b.y + b.d for b in obj.boites)
    img = Image.new('RGBA', (largeur, prof + haut + 2), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # Peintre : d'abord ce qui est bas, puis ce qui est posé dessus ; à hauteur égale, du fond vers l'avant.
    for b in sorted(obj.boites, key=lambda b: (b.z, b.y + b.d)):
        _peindre(d, b, haut)

    def ecran(x: int, y: int, z: int) -> tuple[int, int]:
        return x + obj.marge_cote, y - _z(z) + haut

    for f in obj.extra:
        f(d, ecran)
    img = _contour(img)
    if rogner:
        boite = img.getbbox() or (0, 0, 1, 1)
        img = img.crop((boite[0], boite[1], boite[2], boite[3]))
    emprise = (min(prof, CASE) if prof else 4) * ECHELLE
    return img.resize((img.width * ECHELLE, img.height * ECHELLE), Image.Resampling.NEAREST), emprise


def _contour(img: Image.Image) -> Image.Image:
    a = np.array(img)
    plein = a[..., 3] > 0
    autour = ndimage.binary_dilation(plein) & ~plein
    a[autour] = (40, 30, 34, 255)
    return Image.fromarray(a)


# ── détails réutilisables ─────────────────────────────────────────────────────────────────────────────────────

def tiroirs(n: int, poignee: Couleur = (214, 180, 96)) -> Detail:
    def f(d: ImageDraw.ImageDraw, av: Rect, _t: Rect) -> None:
        h = (av[3] - av[1] + 1) // n
        for k in range(n):
            y0 = av[1] + k * h
            d.rectangle([av[0] + 1, y0 + 1, av[2] - 1, y0 + h - 1], outline=assombrir((150, 100, 60), 0.25))
            cx = (av[0] + av[2]) // 2
            d.line([(cx - 1, y0 + h // 2), (cx + 1, y0 + h // 2)], fill=poignee)
    return f


def ecran_lumineux(couleur: Couleur = (120, 210, 250)) -> Detail:
    def f(d: ImageDraw.ImageDraw, av: Rect, _t: Rect) -> None:
        x0, y0, x1, y1 = av[0] + 1, av[1] + 1, av[2] - 1, av[3] - 2
        d.rectangle([x0, y0, x1, y1], fill=couleur)
        d.rectangle([x0, y0, x1, y0 + (y1 - y0) // 3], fill=eclaircir(couleur, 0.35))
        d.line([(x0 + 1, y1 - 1), (x0 + (x1 - x0) // 2, y1 - 1)], fill=assombrir(couleur, 0.2))
    return f
