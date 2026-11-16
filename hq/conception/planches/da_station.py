"""Responsabilité : rendu de travail des murs de la station (droits, verticaux, à 45°), de leurs faces, des sols, des
hublots et de l'espace, dans la projection unique d'Agent HQ (16 px d'art par case, face de 41 rangs sous le dessus).
Prototype pour les planches de direction artistique ; le jeu garde son propre code (`hq/src/monde/carte/peinture`).
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from PIL import Image

from da_palette import Rgb, couleur

CASE = 16
HAUT_FACE = 41        # rangs d'art de la face, sous le dessus du mur
DEMI_DIAG = 3         # un rang de dessus diagonal = 7 px (2×3+1) → épaisseur perpendiculaire ≈ 5 px
PAS_PANNEAU = {'h': 16, 'v': 16, 'd\\': 11, 'd/': 11}   # 16/√2 ≈ 11 : un panneau garde sa largeur réelle
NUANCE = {'h': 1.0, 'v': 1.0, 'd\\': 1.06, 'd/': 0.88}  # lumière en haut à gauche : face SO plus claire, SE plus sombre


def hasard(x: int, y: int, k: int = 0) -> float:
    h = (x * 374761393 + y * 668265263 + k * 2246822519) & 0xFFFFFFFF
    h = ((h ^ (h >> 13)) * 1274126177) & 0xFFFFFFFF
    return ((h ^ (h >> 16)) & 0xFFFFFFFF) / 4294967296


def nuancer(c: Rgb, f: float) -> Rgb:
    return tuple(max(0, min(255, round(int(v) * f))) for v in c)  # type: ignore[return-value]


def melanger(c: Rgb, d: Rgb, t: float) -> Rgb:
    return tuple(round(int(a) + (int(b) - int(a)) * t) for a, b in zip(c, d))  # type: ignore[return-value]


@dataclass
class Mur:
    """Ligne médiane du dessus, en pixels d'art. sorte : h (→), v (↓), d\\ (↘), d/ (↗). n = longueur en px."""
    sorte: str
    x: int
    y: int
    n: int
    style: str = 'dedans'   # dedans | dehors (coque vue de l'espace)
    hublots: int = 0        # pas entre hublots en px (0 = aucun) ; jamais sur un mur à 45°
    sans_face: bool = False  # bout de mur vertical qui borde une porte : chapeau de chambranle, pas de face


class Station:
    """Toile d'art : sol, puis faces, puis dessus. `seg[y, x]` = indice du mur dont le dessus couvre le pixel."""

    def __init__(self, w: int, h: int) -> None:
        self.w, self.h = w, h
        self.img = np.zeros((h, w, 4), np.uint8)
        self.seg = np.full((h, w), -1, np.int32)
        self.face = np.full((h, w), -1, np.int32)      # rang de face (0..40)
        self.face_seg = np.full((h, w), -1, np.int32)
        self.murs: list[Mur] = []
        self.trous: list[tuple[int, int, int, int]] = []  # x0, x1, y0, y1 : ouvertures de portes dans les faces

    def px(self, x: int, y: int, c: Rgb, a: int = 255) -> None:
        if 0 <= x < self.w and 0 <= y < self.h:
            self.img[y, x] = (*c, a)

    def rect(self, x0: int, y0: int, x1: int, y1: int, c: Rgb) -> None:
        x0, y0, x1, y1 = max(0, x0), max(0, y0), min(self.w - 1, x1), min(self.h - 1, y1)
        if x1 >= x0 and y1 >= y0:
            self.img[y0:y1 + 1, x0:x1 + 1] = (*c, 255)

    # ── murs ──────────────────────────────────────────────────────────────────────────────────────────────────
    def mur(self, m: Mur) -> None:
        i = len(self.murs)
        self.murs.append(m)
        for y, xa, xb in _rangs(m):
            for x in range(xa, xb + 1):
                if 0 <= x < self.w and 0 <= y < self.h and self.seg[y, x] < 0:
                    self.seg[y, x] = i

    def calculer_faces(self) -> None:
        """Sous chaque colonne de dessus, la face pend de 41 rangs (un mur vertical ne la montre qu'à son bout bas)."""
        for x in range(self.w):
            y = 0
            while y < self.h:
                if self.seg[y, x] < 0:
                    y += 1
                    continue
                while y + 1 < self.h and self.seg[y + 1, x] >= 0:
                    y += 1
                s = int(self.seg[y, x])
                for r in range(0 if self.murs[s].sans_face else HAUT_FACE):
                    yy = y + 1 + r
                    if yy >= self.h or self.seg[yy, x] >= 0:
                        break
                    self.face[yy, x], self.face_seg[yy, x] = r, s
                y += 1

    def peindre_murs(self) -> None:
        self.calculer_faces()
        for y in range(self.h):
            for x in range(self.w):
                if self.face[y, x] >= 0:
                    self.px(x, y, self._teinte_face(x, y))
        self._contours_faces()
        self._ombre_pieds()
        self._peindre_dessus()

    def _teinte_face(self, x: int, y: int) -> Rgb:
        r, m = int(self.face[y, x]), self.murs[int(self.face_seg[y, x])]
        k = 'h' if m.sorte == 'v' else m.sorte
        if m.style == 'dehors':
            return nuancer(_teinte_coque(r, x - m.x, y - r), NUANCE[k])
        c = _teinte_dedans(r)
        dx = (x - m.x) % PAS_PANNEAU[k]
        if 3 <= r <= 24 and dx == 0:
            c = couleur('Murs interieurs', 'joint panneau')
        if 27 <= r <= 37 and dx == 0:
            c = couleur('Murs interieurs', 'joint soub.')
        if 29 <= r <= 34 and (x - m.x) % 48 in range(20, 28) and r % 2 == 1:
            c = couleur('Murs interieurs', 'grille')
        return nuancer(c, NUANCE[k])

    def _contours_faces(self) -> None:
        trait = couleur('Murs interieurs', 'contour')
        for y in range(self.h):
            for x in range(self.w):
                r = self.face[y, x]
                if r < 0:
                    continue
                bord = any(not self._face_proche(xx, y) for xx in (x - 1, x + 1))
                s0, s1 = self.face_seg[y, x], self.face_seg[y, x - 1] if x > 0 else -1
                arete = s1 >= 0 and self.murs[int(s0)].sorte != self.murs[int(s1)].sorte and r > 0
                if r == HAUT_FACE - 1 or r == 0 or bord:
                    self.px(x, y, trait)
                elif arete:
                    self.px(x, y, nuancer(tuple(self.img[y, x, :3]), 0.72))  # type: ignore[arg-type]

    def _face_proche(self, x: int, y: int) -> bool:
        if not 0 <= x < self.w:
            return False
        return any(0 <= yy < self.h and (self.face[yy, x] >= 0 or self.seg[yy, x] >= 0) for yy in (y - 1, y, y + 1))

    def _ombre_pieds(self) -> None:
        for x in range(self.w):
            for y in range(self.h):
                if self.face[y, x] == HAUT_FACE - 1:
                    for d, a in ((1, 0.30), (2, 0.20), (3, 0.12), (4, 0.06)):
                        yy = y + d
                        if yy < self.h and self.face[yy, x] < 0 and self.seg[yy, x] < 0:
                            c = tuple(self.img[yy, x, :3])
                            ombre = couleur('Metal, verre, lumiere', 'ombre portee')
                            self.px(x, yy, melanger(c, ombre, a))  # type: ignore[arg-type]

    def _peindre_dessus(self) -> None:
        trait, base = couleur('Murs interieurs', 'contour'), couleur('Murs interieurs', 'dessus')
        clair = couleur('Murs interieurs', 'dessus clair')
        plein = self.seg >= 0
        for y in range(self.h):
            for x in range(self.w):
                if not plein[y, x]:
                    continue
                voisins = [(x + dx, y + dy) for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))]
                expose = any(not (0 <= a < self.w and 0 <= b < self.h and plein[b, a]) for a, b in voisins)
                haut_expose = y > 0 and plein[y - 1, x] and _expose(plein, x, y - 1)
                self.px(x, y, trait if expose else clair if haut_expose else base)

    def image(self) -> Image.Image:
        return Image.fromarray(self.img, 'RGBA')


def _expose(plein: np.ndarray, x: int, y: int) -> bool:
    h, w = plein.shape
    return any(not (0 <= x + dx < w and 0 <= y + dy < h and plein[y + dy, x + dx])
               for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))


def _rangs(m: Mur) -> list[tuple[int, int, int]]:
    """(y, x0, x1) des pixels du dessus d'un mur."""
    if m.sorte == 'h':
        return [(m.y + dy, m.x, m.x + m.n - 1) for dy in range(-2, 3)]
    if m.sorte == 'v':
        return [(m.y + i, m.x - 2, m.x + 3) for i in range(m.n)]
    sens = 1 if m.sorte == 'd\\' else -1
    return [(m.y + sens * i, m.x + i - DEMI_DIAG, m.x + i + DEMI_DIAG) for i in range(m.n)]


def _teinte_dedans(r: int) -> Rgb:
    g = 'Murs interieurs'
    if r == 0:
        return couleur(g, 'corniche')
    if r <= 2:
        return couleur(g, 'corniche metal') if r == 1 else nuancer(couleur(g, 'corniche metal'), 0.78)
    if r <= 24:
        return couleur(g, 'panneau ombre') if r == 3 else couleur(g, 'panneau')
    if r <= 26:
        return couleur(g, 'rail clair') if r == 25 else couleur(g, 'rail')
    if r <= 37:
        return couleur(g, 'soubassement')
    return couleur(g, 'plinthe') if r <= 39 else couleur(g, 'plinthe ombre')


def _teinte_coque(r: int, x: int, y0: int) -> Rgb:
    g = 'Coque exterieure'
    if r >= 37:
        return couleur(g, 'pied') if r >= 39 else couleur(g, 'joint')
    plaque_x, plaque_y = x // 16, (r - 1) // 9
    if (r - 1) % 9 == 0 or x % 16 == 0:
        return couleur(g, 'joint')
    if hasard(plaque_x, plaque_y, y0) < 0.3:
        return couleur(g, 'isolant reflet') if (x + r) % 7 == 0 else couleur(g, 'isolant or')
    return couleur(g, 'plaque') if r % 9 < 6 else couleur(g, 'plaque ombre')


# ── sols et espace ────────────────────────────────────────────────────────────────────────────────────────────

def _bruit(x: int, y: int, graine: int, pas: int = 28) -> float:
    """Bruit de valeur lissé (interpolation bilinéaire d'une grille au hasard) : pour la nébuleuse."""
    gx, gy, fx, fy = x // pas, y // pas, (x % pas) / pas, (y % pas) / pas
    a, b = hasard(gx, gy, graine), hasard(gx + 1, gy, graine)
    c, d = hasard(gx, gy + 1, graine), hasard(gx + 1, gy + 1, graine)
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy


def espace(st: Station, graine: int = 0) -> None:
    """Fond d'espace : nébuleuse tramée en 2 paliers (damier 50 % puis plein), étoiles de 3 teintes, 1 px."""
    st.img[:, :] = (*couleur('Espace', 'fond'), 255)
    for y in range(st.h):
        for x in range(st.w):
            n = _bruit(x, y, graine + 7)
            if n > 0.72:
                st.px(x, y, couleur('Espace', 'nebuleuse claire' if n > 0.8 and (x + y) % 2 else 'nebuleuse'))
            elif n > 0.62 and (x + y) % 2 == 0:
                st.px(x, y, couleur('Espace', 'nebuleuse'))
            v = hasard(x, y, graine)
            if v < 0.006:
                st.px(x, y, couleur('Espace', 'etoile'))
            elif v < 0.012:
                st.px(x, y, couleur('Espace', 'etoile froide' if v < 0.010 else 'etoile chaude'))


def sol(st: Station, masque: np.ndarray, sorte: str) -> None:
    """Remplit les pixels du masque avec un sol procédural déterministe, calé sur la grille des cases."""
    ys, xs = np.nonzero(masque)
    for x, y in zip(xs.tolist(), ys.tolist()):
        st.px(x, y, _sol_px(sorte, x, y))


def _sol_px(sorte: str, x: int, y: int) -> Rgb:
    g = 'Sols'
    cx, cy, lx, ly = x // CASE, y // CASE, x % CASE, y % CASE
    if sorte == 'technique':
        if lx == 0 or ly == 0:
            return couleur(g, 'joint tech.')
        if lx in (2, 13) and ly in (2, 13):
            return couleur(g, 'rivet')
        return couleur(g, 'technique' if (cx + cy) % 2 else 'technique 2')
    if sorte == 'moquette':
        motif = (lx + ly) % 8 == 0 or (lx - ly) % 8 == 0
        return couleur(g, 'moquette motif' if motif and hasard(cx, cy) < 0.9 else 'moquette nuit')
    if sorte == 'bambou':
        rang = y // 4
        fin = (x + int(hasard(rang, x // 24) * 24)) % 24 == 0
        return couleur(g, 'bambou joint' if y % 4 == 3 or fin else 'bambou')
    if sorte == 'caillebotis':
        return couleur(g, 'caillebotis vide' if lx % 4 == 3 or ly % 4 == 3 else 'caillebotis')
    return couleur(g, 'resine joint' if lx == 0 or ly == 0 else 'resine')


def hublot(st: Station, cx: int, y_face0: int, rayon: int = 7) -> None:
    """Hublot rond sur une face droite (élévation frontale, pas d'écrasement) : l'espace se voit au travers."""
    cy = y_face0 + 14
    for y in range(cy - rayon - 2, cy + rayon + 3):
        for x in range(cx - rayon - 2, cx + rayon + 3):
            d = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5
            if d <= rayon:
                c = couleur('Espace', 'fond')
                if hasard(x, y, 3) < 0.05:
                    c = couleur('Espace', 'etoile')
                if y > cy + rayon - 4 and x < cx:
                    c = couleur('Espace', 'planete')
                if x - cx == -(y - cy) - 3 or x - cx == -(y - cy) - 4:
                    c = couleur('Metal, verre, lumiere', 'vitre reflet')
                st.px(x, y, c)
            elif d <= rayon + 2:
                st.px(x, y, couleur('Metal, verre, lumiere', 'metal clair' if y < cy else 'metal ombre'))
            elif d <= rayon + 2.6:
                st.px(x, y, couleur('Murs interieurs', 'contour'))
