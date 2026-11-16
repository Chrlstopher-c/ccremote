"""Responsabilité : maquette fidèle d'un compartiment de la station, À L'ÉCHELLE EXACTE DU JEU (case = 20 px d'art,
affichée ×2), pour la comparer côte à côte à l'image de référence validée par Chris (`chatgpt-9.webp`) avant de porter
le même dessin dans le moteur. Structure dessinée par code avec les couleurs mesurées dans la référence ; objets et
personnages pris dans `kit/` (prélevés dans les images de Chris).
Sortie : `kit/maquette.png` (×2, taille jeu) et `kit/comparaison.png` (référence | maquette).
"""
from __future__ import annotations

import random
from pathlib import Path

from PIL import Image, ImageDraw

ICI = Path(__file__).resolve().parent
KIT = ICI / 'kit'
CASE = 20
R = random.Random(7)

C = {
    'sol': (0x4e, 0x4f, 0x5e), 'sol_clair': (0x5c, 0x5d, 0x6c), 'sol_joint': (0x3b, 0x3c, 0x4a), 'rivet': (0x36, 0x37, 0x44),
    'rivet_clair': (0x70, 0x71, 0x80), 'fissure': (0x42, 0x43, 0x51),
    'contour': (0x2b, 0x2c, 0x38), 'metal_tres_clair': (0xd8, 0xd2, 0xd4), 'metal_clair': (0xc4, 0xbc, 0xc0),
    'metal': (0xa9, 0xa1, 0xa7), 'metal_sombre': (0x84, 0x7e, 0x89), 'metal_ombre': (0x5f, 0x5b, 0x68),
    'creme': (0xbe, 0xa6, 0x8d), 'creme_ombre': (0xa6, 0x8e, 0x76), 'creme_clair': (0xcd, 0xb8, 0x9f),
    'plinthe': (0x66, 0x68, 0x7c), 'plinthe_clair': (0x7e, 0x80, 0x95), 'bleu': (0x41, 0x79, 0xc5),
    'bleu_clair': (0x6c, 0x9d, 0xe0), 'coque': (0x56, 0x4f, 0x60), 'coque_sombre': (0x3a, 0x35, 0x44),
    'ambre': (0xc9, 0x8a, 0x3a), 'espace': (0x03, 0x05, 0x10),
}

Toile = Image.Image
D = ImageDraw.ImageDraw


def rect(d: D, x0: int, y0: int, x1: int, y1: int, c: tuple[int, int, int]) -> None:
    if x1 >= x0 and y1 >= y0:
        d.rectangle([x0, y0, x1, y1], fill=c)


def plaque(d: D, x: int, y: int) -> None:
    """Plaque de sol (une case) : biseau clair en haut à gauche, joint sombre, 4 rivets, parfois une fissure."""
    rect(d, x, y, x + CASE - 1, y + CASE - 1, C['sol'])
    rect(d, x, y, x + CASE - 1, y, C['sol_clair'])
    rect(d, x, y, x, y + CASE - 1, C['sol_clair'])
    rect(d, x, y + CASE - 1, x + CASE - 1, y + CASE - 1, C['sol_joint'])
    rect(d, x + CASE - 1, y, x + CASE - 1, y + CASE - 1, C['sol_joint'])
    for rx, ry in ((3, 3), (CASE - 4, 3), (3, CASE - 4), (CASE - 4, CASE - 4)):
        d.point((x + rx, y + ry), fill=C['rivet'])
        d.point((x + rx - 1, y + ry - 1), fill=C['rivet_clair'])
    for _ in range(10):
        d.point((x + R.randrange(2, CASE - 2), y + R.randrange(2, CASE - 2)), fill=C['sol_clair'] if R.random() < .5 else C['fissure'])
    if R.random() < 0.18:
        px, py = x + R.randrange(5, 14), y + R.randrange(5, 14)
        for _ in range(R.randrange(3, 6)):
            d.point((px, py), fill=C['fissure'])
            px += R.choice((-1, 0, 1))
            py += 1


def bandeau(d: D, x0: int, x1: int, y: int) -> int:
    """Bandeau de métal en haut d'un mur (le dessus arrondi vu de face). Renvoie le rang sous lui."""
    rangs = ['contour', 'metal_tres_clair', 'metal_clair', 'metal', 'metal', 'metal', 'metal_sombre', 'metal_sombre',
             'contour']
    for k, c in enumerate(rangs):
        rect(d, x0, y + k, x1, y + k, C[c])
    return y + len(rangs)


def panneau_creme(d: D, x0: int, x1: int, y0: int, y1: int, pas: int) -> None:
    rect(d, x0, y0, x1, y1, C['creme'])
    rect(d, x0, y0, x1, y0 + 1, C['creme_ombre'])
    for x in range(x0 + pas, x1, pas):
        rect(d, x, y0, x, y1, C['creme_ombre'])
        rect(d, x + 1, y0, x + 1, y1, C['creme_clair'])
    for _ in range((x1 - x0) * (y1 - y0) // 160):
        d.point((R.randrange(x0, x1), R.randrange(y0 + 2, y1)), fill=C['creme_ombre'])


def plinthe(d: D, x0: int, x1: int, y: int, h: int = 6) -> int:
    rect(d, x0, y, x1, y, C['contour'])
    rect(d, x0, y + 1, x1, y + 1, C['plinthe_clair'])
    rect(d, x0, y + 2, x1, y + h - 1, C['plinthe'])
    rect(d, x0, y + h, x1, y + h, C['contour'])
    return y + h + 1


def mur_fond(d: D, x0: int, x1: int, y: int, hauteur: int) -> int:
    """Mur du fond d'une pièce, haut (≈ 1,8 fois Chris) : bandeau, grand panneau crème, plinthe. Renvoie son pied."""
    y = bandeau(d, x0, x1, y)
    bas = y + hauteur - 8
    panneau_creme(d, x0, x1, y, bas, 46)
    return plinthe(d, x0, x1, bas + 1)


def mur_bas(d: D, x0: int, x1: int, y: int) -> int:
    """Mur avant, côté coursive (≈ la taille de Chris) : bandeau épais à deux tons, crème, plinthe bleutée."""
    y = bandeau(d, x0, x1, y)
    rect(d, x0, y, x1, y + 3, C['metal_sombre'])
    rect(d, x0, y + 4, x1, y + 4, C['contour'])
    y += 5
    panneau_creme(d, x0, x1, y, y + 16, 62)
    return plinthe(d, x0, x1, y + 17, 7)


def montant(d: D, x: int, y0: int, y1: int, w: int = 6) -> None:
    rect(d, x, y0, x + w - 1, y1, C['contour'])
    rect(d, x + 1, y0 + 1, x + w - 2, y1 - 1, C['metal'])
    rect(d, x + 1, y0 + 1, x + 1, y1 - 1, C['metal_tres_clair'])
    rect(d, x + w - 2, y0 + 1, x + w - 2, y1 - 1, C['metal_sombre'])


def mur_lateral(d: D, x: int, y0: int, y1: int) -> None:
    """Mur vu du dessus (côté d'une pièce) : une coiffe de métal de 6 px."""
    montant(d, x, y0, y1, 6)


def ombre_pied(img: Toile, x0: int, x1: int, y: int) -> None:
    calque = Image.new('RGBA', img.size, (0, 0, 0, 0))
    dc = ImageDraw.Draw(calque)
    for k, a in enumerate((90, 60, 35, 15)):
        dc.rectangle([x0, y + k, x1, y + k], fill=(10, 8, 20, a))
    img.alpha_composite(calque)


def espace(img: Toile) -> None:
    d = ImageDraw.Draw(img)
    rect(d, 0, 0, img.width, img.height, C['espace'])
    calque = Image.new('RGBA', img.size, (0, 0, 0, 0))
    dc = ImageDraw.Draw(calque)
    for _ in range(14):
        cx, cy, r = R.randrange(img.width), R.randrange(img.height), R.randrange(20, 70)
        dc.ellipse([cx - r, cy - r // 2, cx + r, cy + r // 2], fill=(70, 40, 110, 22))
    img.alpha_composite(calque)
    for _ in range(img.width * img.height // 260):
        c = R.choice([(255, 255, 255), (200, 220, 255), (255, 230, 190)])
        d.point((R.randrange(img.width), R.randrange(img.height)), fill=c)


def bord_station(d: D, x0: int, x1: int, y: int) -> None:
    """Le bord de la coursive au-dessus du vide : bande bleue, lèvre de métal, tranche de la coque."""
    rect(d, x0, y - 5, x1, y - 4, C['bleu'])
    rect(d, x0, y - 5, x1, y - 5, C['bleu_clair'])
    rect(d, x0, y, x1, y, C['contour'])
    rect(d, x0, y + 1, x1, y + 2, C['metal_clair'])
    rect(d, x0, y + 3, x1, y + 4, C['metal_sombre'])
    rect(d, x0, y + 5, x1, y + 5, C['ambre'])
    rect(d, x0, y + 6, x1, y + 15, C['coque'])
    for x in range(x0 + 12, x1, 30):
        rect(d, x, y + 7, x + 14, y + 13, C['coque_sombre'])
    rect(d, x0, y + 16, x1, y + 16, C['contour'])


def coller(img: Toile, nom: str, x: int, bas: int, cx: bool = True) -> None:
    o = Image.open(KIT / f'{nom}.png').convert('RGBA')
    img.alpha_composite(o, (x - (o.width // 2 if cx else 0), bas - o.height))


def scene() -> Toile:
    W, H = 22 * CASE, 15 * CASE
    img = Image.new('RGBA', (W, H))
    espace(img)
    d = ImageDraw.Draw(img)
    x0, x1 = 20, 300  # compartiment
    haut = 22
    pied_fond = mur_fond(d, x0, x1, haut, 66)
    for y in range(pied_fond, 200, CASE):
        for x in range(x0, x1, CASE):
            plaque(d, x, y)
    ombre_pied(img, x0, x1, pied_fond)
    mur_lateral(d, x0 - 6, haut, 236)
    mur_lateral(d, x1, haut, 236)
    y_bas = 200
    for y in range(y_bas, 270, CASE):
        for x in range(0, W, CASE):
            plaque(d, x, y)
    pied_bas = mur_bas(d, x0 - 6, x1 + 5, y_bas - 36)
    ombre_pied(img, x0 - 6, x1 + 5, pied_bas)
    for xm in (x0 - 6, 72, 108, 250, x1):
        montant(d, xm, y_bas - 38, pied_bas)
    bord_station(d, 0, W, 272)
    return img


def meubler(img: Toile) -> None:
    coller(img, 'obj-baie', 52, 128)
    coller(img, 'obj-bureaux', 130, 138)
    coller(img, 'obj-cryo', 250, 132)
    coller(img, 'obj-tableau', 128, 82)
    coller(img, 'obj-clawd-question', 196, 138)
    coller(img, 'porte-bois', 90, 197)
    coller(img, 'sas', 280, 199)


def main() -> None:
    img = scene()
    meubler(img)
    jeu = img.resize((img.width * 2, img.height * 2), Image.Resampling.NEAREST)
    jeu.save(KIT / 'maquette.png')
    ref = Image.open(ICI.parent / 'conception' / 'references' / 'chatgpt-9.webp').convert('RGBA')
    ref = ref.resize((round(ref.width * jeu.height / ref.height), jeu.height))
    comp = Image.new('RGBA', (ref.width + jeu.width + 20, jeu.height), (20, 20, 30, 255))
    comp.alpha_composite(ref, (0, 0))
    comp.alpha_composite(jeu, (ref.width + 20, 0))
    comp.save(KIT / 'comparaison.png')
    print('maquette', jeu.size)


if __name__ == '__main__':
    main()
