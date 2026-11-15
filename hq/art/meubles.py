"""Responsabilité : les recettes des meubles et objets du monde d'Agent HQ, toutes dans la projection unique du moteur
de boîtes (`oblique.py`). Sortie : `public/objets/<nom>.png` + `public/objets.json` (taille, emprise au sol).
Voir DIRECTION.md. Dimensions en pixels d'art (16 par case), × 2 à l'écran.
"""
from __future__ import annotations

import json
import random
from pathlib import Path

from PIL import ImageDraw

from oblique import Boite, Objet, Rect, assombrir, eclaircir, ecran_lumineux, rendre, tiroirs

SORTIE = Path(__file__).resolve().parent.parent / 'public'

BOIS = (158, 104, 62)
BOIS_CLAIR = (190, 136, 86)
NOIR = (46, 42, 52)
GRIS = (150, 150, 158)
METAL = (176, 180, 188)
BEIGE = (214, 200, 168)
VERT_TISSU = (92, 132, 76)
TERRE_CUITE = (184, 98, 62)


def bureau() -> Objet:
    def clavier(d: ImageDraw.ImageDraw, _a: Rect, t: Rect) -> None:
        for x in range(t[0] + 1, t[2], 2):
            d.point((x, t[1] + 1), fill=(120, 124, 132))
            d.point((x, t[3] - 1), fill=(120, 124, 132))
    return Objet([
        Boite(0, 2, 0, 12, 12, 15, BOIS, tiroirs(3)),
        Boite(36, 2, 0, 12, 12, 15, BOIS, tiroirs(3)),
        Boite(12, 1, 2, 24, 2, 13, assombrir(BOIS, 0.25)),
        Boite(0, 0, 15, 48, 14, 2, BOIS_CLAIR),
        Boite(20, 2, 17, 6, 3, 3, NOIR),
        Boite(13, 1, 20, 20, 2, 13, NOIR, ecran_lumineux()),
        Boite(14, 8, 17, 16, 4, 1, (210, 212, 218), clavier),
        Boite(34, 9, 17, 3, 3, 1, (220, 222, 228)),
        Boite(5, 3, 17, 5, 4, 5, (236, 236, 228)),
    ])


def etagere() -> Objet:
    rng = random.Random(4)

    def livres(d: ImageDraw.ImageDraw, av: Rect, _t: Rect) -> None:
        etages = 4
        h = (av[3] - av[1] - 2) // etages
        for k in range(etages):
            y_bas = av[1] + 2 + (k + 1) * h - 1
            x = av[0] + 2
            while x < av[2] - 2:
                lw = rng.choice((2, 2, 3))
                lh = rng.randint(h - 4, h - 2)
                c = rng.choice([(176, 64, 60), (60, 96, 160), (70, 140, 90), (220, 180, 80), (130, 80, 150),
                                (230, 220, 200)])
                d.rectangle([x, y_bas - lh, min(x + lw - 1, av[2] - 2), y_bas - 1], fill=c)
                x += lw + (1 if rng.random() < 0.15 else 0)
            d.line([(av[0] + 1, y_bas), (av[2] - 1, y_bas)], fill=assombrir(BOIS, 0.35))
    return Objet([Boite(0, 0, 0, 24, 7, 42, BOIS, livres)])


def baie_serveur(phase: int = 0) -> Objet:
    def baie(d: ImageDraw.ImageDraw, av: Rect, _t: Rect) -> None:
        for k, y in enumerate(range(av[1] + 2, av[3] - 2, 4)):
            d.line([(av[0] + 2, y + 3), (av[2] - 2, y + 3)], fill=(30, 28, 34))
            allume = (k + phase) % 3 != 0
            d.point((av[0] + 3, y + 1), fill=(90, 230, 120) if allume else (40, 80, 50))
            d.point((av[0] + 5, y + 1), fill=(90, 170, 250) if (k + phase) % 2 else (40, 60, 90))
            d.line([(av[2] - 6, y + 1), (av[2] - 3, y + 1)], fill=(70, 66, 78))
    return Objet([Boite(0, 0, 0, 16, 10, 36, (52, 50, 60), baie)])


def terminal() -> Objet:
    def crt(d: ImageDraw.ImageDraw, av: Rect, _t: Rect) -> None:
        x0, y0, x1, y1 = av[0] + 2, av[1] + 2, av[2] - 3, av[3] - 3
        d.rectangle([x0, y0, x1, y1], fill=(24, 60, 32))
        for y in range(y0 + 1, y1, 2):
            d.line([(x0 + 1, y), (x0 + 1 + (y * 7) % (x1 - x0 - 2), y)], fill=(110, 230, 120))
    return Objet([
        Boite(0, 2, 0, 24, 10, 11, BOIS, tiroirs(1)),
        Boite(0, 1, 11, 24, 12, 1, BOIS_CLAIR),
        Boite(5, 2, 12, 14, 9, 12, BEIGE, crt),
        Boite(4, 9, 12, 16, 3, 1, (200, 192, 168)),
    ])


def machine_cafe() -> Objet:
    def tasses(d: ImageDraw.ImageDraw, ecran) -> None:
        for x in (17, 21):
            px, py = ecran(x, 9, 16)
            d.rectangle([px, py - 3, px + 2, py], fill=(240, 240, 236))
            d.point((px + 1, py - 4), fill=(200, 200, 200))
    return Objet([
        Boite(0, 2, 0, 26, 10, 14, BOIS, tiroirs(2)),
        Boite(0, 1, 14, 26, 11, 2, (90, 86, 92)),
        Boite(3, 2, 16, 12, 7, 13, METAL, ecran_lumineux((60, 60, 70))),
        Boite(5, 7, 16, 6, 2, 4, (60, 58, 64)),
    ], [tasses])


def distributeur() -> Objet:
    def vitrine(d: ImageDraw.ImageDraw, av: Rect, _t: Rect) -> None:
        x0, y0, x1, y1 = av[0] + 2, av[1] + 2, av[2] - 6, av[3] - 8
        d.rectangle([x0, y0, x1, y1], fill=(200, 226, 236))
        rng = random.Random(9)
        for y in range(y0 + 2, y1 - 1, 4):
            d.line([(x0, y + 2), (x1, y + 2)], fill=(150, 170, 180))
            for x in range(x0 + 1, x1 - 1, 3):
                d.rectangle([x, y, x + 1, y + 1], fill=rng.choice([(220, 70, 60), (240, 190, 60), (70, 130, 220),
                                                                   (90, 190, 100)]))
        d.rectangle([av[2] - 4, y0 + 3, av[2] - 2, y0 + 8], fill=(60, 60, 64))
        d.rectangle([x0, av[3] - 6, x1, av[3] - 3], fill=(40, 40, 44))
    return Objet([Boite(0, 0, 0, 20, 10, 38, (200, 70, 64), vitrine)])


def canape() -> Objet:
    return Objet([
        Boite(0, 0, 4, 44, 5, 13, VERT_TISSU),
        Boite(0, 0, 0, 44, 16, 6, assombrir(VERT_TISSU, 0.15)),
        Boite(4, 5, 6, 18, 11, 3, eclaircir(VERT_TISSU, 0.08)),
        Boite(22, 5, 6, 18, 11, 3, eclaircir(VERT_TISSU, 0.08)),
        Boite(0, 2, 0, 5, 14, 10, VERT_TISSU),
        Boite(39, 2, 0, 5, 14, 10, VERT_TISSU),
    ])


def table_ronde() -> Objet:
    def plateau(d: ImageDraw.ImageDraw, ecran) -> None:
        x0, y0 = ecran(0, 0, 16)
        x1, y1 = ecran(56, 30, 16)
        for k in (4, 0):
            d.ellipse([x0, y0 + k, x1, y1 + k], fill=assombrir(BOIS, 0.2) if k else BOIS_CLAIR)
        d.ellipse([x0 + 6, y0 + 4, x1 - 6, y1 - 4], outline=eclaircir(BOIS_CLAIR, 0.12))
    return Objet([
        Boite(8, 18, 0, 3, 3, 16, assombrir(BOIS, 0.3)),
        Boite(45, 18, 0, 3, 3, 16, assombrir(BOIS, 0.3)),
        Boite(26, 26, 0, 4, 3, 14, assombrir(BOIS, 0.3)),
        Boite(0, 0, 16, 56, 30, 0, BOIS, visible=False),
    ], [plateau])


def plante() -> Objet:
    def feuilles(d: ImageDraw.ImageDraw, ecran) -> None:
        rng = random.Random(3)
        cx, cy = ecran(6, 5, 16)
        for _ in range(14):
            dx, dy = rng.randint(-6, 6), rng.randint(-9, 1)
            c = rng.choice([(64, 128, 60), (84, 156, 70), (110, 180, 84)])
            d.ellipse([cx + dx - 3, cy + dy - 2, cx + dx + 3, cy + dy + 2], fill=c)
    return Objet([Boite(2, 2, 0, 9, 8, 9, TERRE_CUITE)], [feuilles], marge_haut=14, marge_cote=4)


def tableau_blanc() -> Objet:
    def notes(d: ImageDraw.ImageDraw, av: Rect, _t: Rect) -> None:
        d.rectangle([av[0] + 1, av[1] + 1, av[2] - 1, av[3] - 2], fill=(246, 246, 242))
        rng = random.Random(2)
        for _ in range(9):
            x, y = rng.randint(av[0] + 2, av[2] - 4), rng.randint(av[1] + 2, av[3] - 5)
            d.rectangle([x, y, x + 2, y + 2], fill=rng.choice([(250, 220, 90), (250, 150, 160), (130, 210, 240),
                                                              (160, 230, 140)]))
    return Objet([
        Boite(1, 3, 0, 2, 2, 8, GRIS), Boite(25, 3, 0, 2, 2, 8, GRIS),
        Boite(0, 3, 8, 28, 2, 18, METAL, notes),
    ])


# Les deux pièces de la chaise partagent la même toile (non rognée) pour se superposer exactement.
CADRE_CHAISE = Boite(0, 0, 0, 16, 14, 21, NOIR, visible=False)


def chaise_assise() -> Objet:
    def pied(d: ImageDraw.ImageDraw, ecran) -> None:
        x, y = ecran(8, 7, 0)
        for dx in (-6, 0, 6):
            d.line([(x, y - 1), (x + dx, y + 1)], fill=NOIR, width=1)
            d.point((x + dx, y + 2), fill=(20, 18, 24))
    return Objet([CADRE_CHAISE, Boite(7, 6, 0, 2, 2, 7, NOIR), Boite(1, 1, 7, 14, 12, 3, (62, 58, 70))], [pied])


def chaise_dossier() -> Objet:
    return Objet([CADRE_CHAISE, Boite(2, 11, 9, 12, 2, 11, (62, 58, 70)), Boite(7, 10, 7, 2, 2, 3, NOIR)])


def lampadaire() -> Objet:
    def lumiere(d: ImageDraw.ImageDraw, av: Rect, _t: Rect) -> None:
        d.rectangle([av[0] + 1, av[1] + 1, av[2] - 1, av[3] - 2], fill=(255, 222, 140))
    return Objet([Boite(5, 4, 0, 6, 4, 3, NOIR), Boite(7, 5, 3, 2, 2, 38, NOIR),
                  Boite(4, 3, 41, 8, 6, 8, NOIR, lumiere), Boite(3, 2, 49, 10, 8, 2, NOIR)])


def banc() -> Objet:
    def lattes(d: ImageDraw.ImageDraw, av: Rect, t: Rect) -> None:
        for y in range(t[1] + 2, t[3], 3):
            d.line([(t[0] + 1, y), (t[2] - 1, y)], fill=assombrir(BOIS, 0.2))
    return Objet([Boite(1, 6, 0, 2, 2, 7, NOIR), Boite(29, 6, 0, 2, 2, 7, NOIR),
                  Boite(0, 2, 7, 32, 7, 2, BOIS_CLAIR, lattes), Boite(0, 0, 9, 32, 2, 8, BOIS)])


def cendrier() -> Objet:
    return Objet([Boite(0, 0, 0, 8, 7, 14, GRIS), Boite(1, 1, 14, 6, 5, 1, (70, 70, 74))])


def arbre() -> Objet:
    def feuillage(d: ImageDraw.ImageDraw, ecran) -> None:
        rng = random.Random(5)
        cx, cy = ecran(20, 8, 34)
        for r, c in ((19, (56, 112, 52)), (16, (72, 138, 62)), (11, (96, 164, 76))):
            for _ in range(10):
                dx, dy = rng.randint(-r + 6, r - 6), rng.randint(-r + 8, r - 10)
                d.ellipse([cx + dx - 7, cy + dy - 6, cx + dx + 7, cy + dy + 6], fill=c)
    return Objet([Boite(16, 4, 0, 8, 7, 22, (110, 72, 44))], [feuillage], marge_haut=34, marge_cote=10)


def buisson() -> Objet:
    def boules(d: ImageDraw.ImageDraw, ecran) -> None:
        rng = random.Random(8)
        cx, cy = ecran(9, 6, 7)
        for c in ((60, 120, 56), (80, 146, 64), (104, 170, 80)):
            for _ in range(5):
                dx, dy = rng.randint(-6, 6), rng.randint(-4, 2)
                d.ellipse([cx + dx - 5, cy + dy - 4, cx + dx + 5, cy + dy + 4], fill=c)
        for _ in range(4):
            d.point((cx + rng.randint(-7, 7), cy + rng.randint(-5, 3)), fill=(240, 220, 120))
    return Objet([Boite(4, 3, 0, 10, 6, 2, (60, 110, 54))], [boules], marge_haut=12, marge_cote=6)


RECETTES = {
    'bureau': bureau, 'etagere': etagere, 'serveur': baie_serveur, 'crt': terminal, 'cafe': machine_cafe,
    'distributeur': distributeur, 'canape': canape, 'table': table_ronde, 'plante': plante, 'tableau': tableau_blanc,
    'lampadaire': lampadaire, 'banc': banc, 'cendrier': cendrier, 'arbre': arbre, 'buisson': buisson,
    'chaise-assise': chaise_assise, 'chaise-dossier': chaise_dossier,
}


def main() -> None:
    (SORTIE / 'objets').mkdir(parents=True, exist_ok=True)
    index = {}
    for nom, recette in RECETTES.items():
        img, emprise = rendre(recette(), rogner=not nom.startswith('chaise'))
        img.save(SORTIE / f'objets/{nom}.png')
        index[nom] = {'w': img.width, 'h': img.height, 'emprise': emprise}
    (SORTIE / 'objets.json').write_text(json.dumps(index, indent=1))
    print(', '.join(f"{k} {v['w']}×{v['h']}" for k, v in index.items()))


if __name__ == '__main__':
    main()
