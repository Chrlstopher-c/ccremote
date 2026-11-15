"""Responsabilité : jeu de tuiles du monde d'Agent HQ (32 px, façon Stardew), dessiné par procédure pour rester net
et tuilable : parquet, moquette, carrelage, murs (dessus et face), herbe, terre, pavés, trottoir.
Sortie : `public/tuiles.png` (une rangée de tuiles) + `public/tuiles.json` (nom → index).
"""
from __future__ import annotations

import json
import random
from pathlib import Path

from PIL import Image, ImageDraw

T = 32
SORTIE = Path(__file__).resolve().parent.parent / 'public'
Couleur = tuple[int, int, int]


def varie(c: Couleur, r: random.Random, amp: int = 8) -> Couleur:
    d = r.randint(-amp, amp)
    return tuple(max(0, min(255, v + d)) for v in c)  # type: ignore[return-value]


def parquet(graine: int, base: Couleur = (190, 136, 84)) -> Image.Image:
    r = random.Random(graine)
    im = Image.new('RGB', (T, T), base)
    d = ImageDraw.Draw(im)
    for rang in range(4):
        y = rang * 8
        decal = (rang % 2) * 16 + r.randint(-3, 3)
        teinte = varie(base, r, 10)
        d.rectangle([0, y, T - 1, y + 7], fill=teinte)
        for k in range(6):
            x = r.randint(0, T - 1)
            d.point((x, y + r.randint(2, 5)), fill=varie(teinte, r, 14))
        d.line([(0, y + 7), (T - 1, y + 7)], fill=tuple(v - 26 for v in base))
        d.line([(0, y), (T - 1, y)], fill=tuple(min(255, v + 14) for v in teinte))
        x = decal % T
        d.line([(x, y), (x, y + 7)], fill=tuple(v - 22 for v in base))
    return im


def moquette(graine: int, base: Couleur) -> Image.Image:
    r = random.Random(graine)
    im = Image.new('RGB', (T, T), base)
    for _ in range(90):
        im.putpixel((r.randrange(T), r.randrange(T)), varie(base, r, 9))
    return im


def carrelage(base: Couleur = (214, 210, 198)) -> Image.Image:
    im = Image.new('RGB', (T, T), base)
    d = ImageDraw.Draw(im)
    joint = tuple(v - 40 for v in base)
    for k in (0, 16):
        d.line([(k, 0), (k, T - 1)], fill=joint)
        d.line([(0, k), (T - 1, k)], fill=joint)
    d.line([(1, 1), (14, 1)], fill=tuple(min(255, v + 18) for v in base))
    d.line([(17, 17), (30, 17)], fill=tuple(min(255, v + 18) for v in base))
    return im


def mur_face(base: Couleur = (232, 214, 182)) -> Image.Image:
    """Face d'un mur vue de trois-quarts : enduit clair, plinthe de bois en bas."""
    r = random.Random(3)
    im = Image.new('RGB', (T, T), base)
    d = ImageDraw.Draw(im)
    for _ in range(25):
        im.putpixel((r.randrange(T), r.randrange(22)), varie(base, r, 6))
    d.rectangle([0, 24, T - 1, T - 1], fill=(122, 78, 44))
    d.line([(0, 24), (T - 1, 24)], fill=(160, 108, 64))
    d.line([(0, T - 1), (T - 1, T - 1)], fill=(84, 52, 30))
    return im


def mur_face_haut(base: Couleur = (232, 214, 182)) -> Image.Image:
    """Haut de la face d'un mur : enduit, corniche sombre en haut (sous le dessus du mur)."""
    r = random.Random(4)
    im = Image.new('RGB', (T, T), base)
    d = ImageDraw.Draw(im)
    for _ in range(25):
        im.putpixel((r.randrange(T), r.randrange(4, T)), varie(base, r, 6))
    d.rectangle([0, 0, T - 1, 3], fill=tuple(v - 46 for v in base))
    d.line([(0, 4), (T - 1, 4)], fill=tuple(v - 20 for v in base))
    return im


def mur_dessus() -> Image.Image:
    """Dessus d'un mur (épaisseur vue d'en haut) : sombre, liseré clair."""
    im = Image.new('RGB', (T, T), (62, 52, 60))
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, T - 1, T - 1], fill=(84, 70, 78))
    d.line([(0, 0), (T - 1, 0)], fill=(112, 96, 102))
    d.line([(0, T - 1), (T - 1, T - 1)], fill=(44, 36, 42))
    return im


def mur_fin(masque: int) -> Image.Image:
    """Mur fin vu d'en haut (autotuile) : un noyau de 12 px et un bras vers chaque voisin mur (bits N=1 E=2 S=4 O=8).
    Transparent ailleurs : le sol est dessiné dessous."""
    im = Image.new('RGBA', (T, T), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    a, b = 10, 21
    rects = [(a, a, b, b)]
    if masque & 1:
        rects.append((a, 0, b, b))
    if masque & 2:
        rects.append((a, a, T - 1, b))
    if masque & 4:
        rects.append((a, a, b, T - 1))
    if masque & 8:
        rects.append((0, a, b, b))
    for r in rects:
        d.rectangle(r, fill=(70, 56, 62))
    for r in rects:
        d.rectangle((r[0] + 2, r[1] + 2, r[2] - 2, r[3] - 2), fill=(104, 86, 92))
    return im


def mur_fin_levre(masque: int) -> Image.Image:
    """Cloison coupée (façon Les Sims, murs baissés) : le mur fin + sa tranche visible au sud quand il est horizontal."""
    im = mur_fin(masque)
    if masque & 10 or not masque & 5:
        d = ImageDraw.Draw(im)
        x0 = 0 if masque & 8 else 10
        x1 = T - 1 if masque & 2 else 21
        d.rectangle([x0, 22, x1, 27], fill=(196, 176, 150))
        d.line([(x0, 27), (x1, 27)], fill=(120, 96, 76))
    return im


def facade(fenetre: bool, haut: bool) -> Image.Image:
    """Façade extérieure en briques vue du sud (deux rangs), fenêtre éclairée possible."""
    r = random.Random(7 + fenetre + 2 * haut)
    im = Image.new('RGB', (T, T), (150, 86, 66))
    d = ImageDraw.Draw(im)
    for rang in range(8):
        y = rang * 4
        decal = (rang % 2) * 4
        for col in range(-1, 5):
            x = col * 8 + decal
            d.rectangle([x, y, x + 6, y + 2], fill=varie((164, 96, 72), r, 10))
    if haut:
        d.rectangle([0, 0, T - 1, 3], fill=(92, 64, 58))
    else:
        d.rectangle([0, T - 4, T - 1, T - 1], fill=(108, 100, 98))
    if fenetre:
        y0, y1 = (12, T - 1) if haut else (0, 18)
        d.rectangle([6, y0, 25, y1], fill=(70, 52, 44))
        d.rectangle([8, y0 + 2, 23, y1 - (0 if haut else 2)], fill=(250, 214, 132))
        d.line([(15, y0 + 2), (15, y1)], fill=(70, 52, 44))
        if not haut:
            d.rectangle([5, y1 - 1, 26, y1 + 1], fill=(200, 190, 180))
    return im


def mur_fenetre(haut: bool) -> Image.Image:
    """Face intérieure du mur du fond avec une fenêtre (nuit dehors, reflet)."""
    im = (mur_face_haut() if haut else mur_face()).convert('RGB')
    d = ImageDraw.Draw(im)
    y0, y1 = (10, T - 1) if haut else (0, 16)
    d.rectangle([5, y0, 26, y1], fill=(122, 82, 50))
    d.rectangle([7, y0 + 2, 24, y1 - (0 if haut else 2)], fill=(44, 52, 92))
    d.line([(9, y0 + 4), (13, y0 + 8)] if haut else [(9, 2), (12, 5)], fill=(120, 140, 200))
    d.line([(15, y0 + 2), (15, y1)], fill=(122, 82, 50))
    if not haut:
        d.rectangle([4, y1 - 1, 27, y1 + 1], fill=(160, 112, 70))
    return im


def seuil() -> Image.Image:
    im = parquet(11)
    d = ImageDraw.Draw(im)
    d.rectangle([0, 12, T - 1, 19], fill=(140, 96, 58))
    d.line([(0, 12), (T - 1, 12)], fill=(176, 128, 84))
    return im


def herbe(graine: int) -> Image.Image:
    r = random.Random(graine)
    base = (104, 160, 72)
    im = Image.new('RGB', (T, T), base)
    d = ImageDraw.Draw(im)
    for _ in range(70):
        im.putpixel((r.randrange(T), r.randrange(T)), varie(base, r, 12))
    for _ in range(5):
        x, y = r.randrange(2, T - 2), r.randrange(3, T - 1)
        d.line([(x, y), (x - 1, y - 2)], fill=(72, 128, 52))
        d.line([(x + 1, y), (x + 2, y - 3)], fill=(72, 128, 52))
    if graine % 3 == 0:
        x, y = r.randrange(4, T - 4), r.randrange(4, T - 4)
        d.point((x, y), fill=(240, 220, 90))
        d.point((x + 5, y + 3), fill=(236, 236, 236))
    return im


def terre(graine: int) -> Image.Image:
    r = random.Random(graine)
    base = (178, 140, 96)
    im = Image.new('RGB', (T, T), base)
    for _ in range(80):
        im.putpixel((r.randrange(T), r.randrange(T)), varie(base, r, 12))
    return im


def paves(graine: int) -> Image.Image:
    r = random.Random(graine)
    im = Image.new('RGB', (T, T), (96, 92, 100))
    d = ImageDraw.Draw(im)
    for rang in range(4):
        decal = (rang % 2) * 4
        for col in range(-1, 4):
            x, y = col * 8 + decal, rang * 8
            c = varie((150, 146, 152), r, 12)
            d.rectangle([x + 1, y + 1, x + 7, y + 6], fill=c)
            d.line([(x + 1, y + 1), (x + 6, y + 1)], fill=tuple(min(255, v + 20) for v in c))
    return im


def trottoir() -> Image.Image:
    base = (196, 190, 178)
    im = Image.new('RGB', (T, T), base)
    d = ImageDraw.Draw(im)
    d.line([(0, 0), (T - 1, 0)], fill=(150, 144, 134))
    d.line([(0, 16), (T - 1, 16)], fill=(170, 164, 152))
    d.line([(16, 0), (16, T - 1)], fill=(170, 164, 152))
    return im


def tuiles() -> dict[str, Image.Image]:
    t: dict[str, Image.Image] = {}
    for i in range(3):
        t[f'parquet-{i}'] = parquet(10 + i)
        t[f'herbe-{i}'] = herbe(20 + i)
        t[f'terre-{i}'] = terre(30 + i)
        t[f'paves-{i}'] = paves(40 + i)
    t['parquet-sombre'] = parquet(13, (128, 84, 52))
    t['moquette-rouge'] = moquette(5, (156, 58, 52))
    t['moquette-bleue'] = moquette(6, (64, 86, 128))
    t['moquette-verte'] = moquette(7, (78, 112, 82))
    t['carrelage'] = carrelage()
    t['carrelage-sombre'] = carrelage((70, 74, 86))
    t['mur-face'] = mur_face()
    t['mur-face-haut'] = mur_face_haut()
    t['mur-face-gris-haut'] = mur_face_haut((176, 178, 186))
    t['mur-face-gris'] = mur_face((176, 178, 186))
    t['mur-dessus'] = mur_dessus()
    t['trottoir'] = trottoir()
    for m in range(16):
        t[f'mur-{m}'] = mur_fin(m)
        t[f'cloison-{m}'] = mur_fin_levre(m)
    for f in (False, True):
        t[f'facade-haut{"-fenetre" if f else ""}'] = facade(f, True)
        t[f'facade-bas{"-fenetre" if f else ""}'] = facade(f, False)
    t['fenetre-haut'] = mur_fenetre(True)
    t['fenetre-bas'] = mur_fenetre(False)
    t['seuil'] = seuil()
    return t


def main() -> None:
    t = tuiles()
    planche = Image.new('RGBA', (T * len(t), T))
    index = {}
    for i, (nom, im) in enumerate(t.items()):
        planche.paste(im, (i * T, 0))
        index[nom] = i
    planche.save(SORTIE / 'tuiles.png')
    (SORTIE / 'tuiles.json').write_text(json.dumps(index, indent=1))
    print(len(index), 'tuiles')


if __name__ == '__main__':
    main()
