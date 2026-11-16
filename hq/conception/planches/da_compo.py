"""Responsabilité : assemblage des planches — passage art → monde (×2) → planche (×2), pose des sprites par leurs pieds,
lumières en paliers (jamais de dégradé lisse), ombres portées et étiquettes d'annotation.
"""
from __future__ import annotations

from PIL import Image, ImageDraw

from da_palette import Rgb, hexa
from da_persos import police

X2 = Image.Resampling.NEAREST


def monde(art: Image.Image) -> Image.Image:
    return art.resize((art.width * 2, art.height * 2), X2)


def planche(m: Image.Image) -> Image.Image:
    return m.resize((m.width * 2, m.height * 2), X2)


def poser(m: Image.Image, spr: Image.Image, pied_art: tuple[int, int], ombre: bool = True) -> None:
    """Pose un sprite (échelle monde) centré sur ses pieds, donnés en pixels d'art ; ombre ovale décalée bas-droite."""
    x = pied_art[0] * 2 - spr.width // 2
    y = pied_art[1] * 2 - spr.height
    if ombre:
        calque = Image.new('RGBA', m.size, (0, 0, 0, 0))
        d = ImageDraw.Draw(calque)
        w = max(8, spr.width * 2 // 3)
        cx, cy = pied_art[0] * 2 + 4, pied_art[1] * 2 + 2
        d.ellipse([cx - w // 2, cy - w // 6, cx + w // 2, cy + w // 6], fill=(20, 12, 30, 80))
        m.alpha_composite(calque)
    m.alpha_composite(spr, (x, y))


def lumiere(m: Image.Image, cx: int, cy: int, rx: int, ry: int, c: Rgb, force: float = 1.0) -> None:
    """Flaque de lumière en 3 paliers concentriques, en coordonnées d'art, alignée sur la grille d'art."""
    calque = Image.new('RGBA', m.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(calque)
    for k, a in enumerate((26, 22, 18)):
        f = 1 - k * 0.3
        box = [2 * round(cx - rx * f), 2 * round(cy - ry * f), 2 * round(cx + rx * f), 2 * round(cy + ry * f)]
        d.ellipse(box, fill=(*c, round(a * force)))
    m.alpha_composite(calque)


def tache_hublot(m: Image.Image, x0: int, y0: int, w: int, h: int, c: Rgb) -> None:
    """Lumière d'un hublot sur le sol : parallélogramme oblique (la lumière vient d'en haut à gauche), 2 paliers."""
    calque = Image.new('RGBA', m.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(calque)
    for k, a in enumerate((30, 26)):
        r = k * 2
        pts = [(x0 + r, y0), (x0 + w - r, y0), (x0 + w - r + h // 2, y0 + h - r), (x0 + r + h // 2, y0 + h - r)]
        d.polygon([(2 * px, 2 * py) for px, py in pts], fill=(*c, a))
    m.alpha_composite(calque)


def etiquette(d: ImageDraw.ImageDraw, x: int, y: int, texte: str, cible: tuple[int, int] | None = None,
              c: str = '#ffe2b0', taille: int = 13) -> None:
    """Annotation de planche : texte sur fond sombre, trait fin vers la cible (coordonnées de planche)."""
    f = police(taille)
    lignes = texte.split('\n')
    w = max(d.textlength(t, font=f) for t in lignes) + 10
    h = len(lignes) * (taille + 3) + 6
    if cible:
        d.line([(x + w / 2, y + h / 2), cible], fill=hexa(c), width=2)
        d.ellipse([cible[0] - 3, cible[1] - 3, cible[0] + 3, cible[1] + 3], fill=hexa(c))
    d.rectangle([x, y, x + w, y + h], fill=(11, 14, 28), outline=hexa(c))
    for i, t in enumerate(lignes):
        d.text((x + 5, y + 3 + i * (taille + 3)), t, font=f, fill=hexa(c))


def titre(img: Image.Image, texte: str, sous_titre: str) -> Image.Image:
    out = Image.new('RGBA', (img.width, img.height + 64), hexa('#070912') + (255,))
    out.alpha_composite(img, (0, 64))
    d = ImageDraw.Draw(out)
    d.text((16, 10), texte, font=police(22), fill=(230, 232, 240))
    d.text((16, 38), sous_titre, font=police(13), fill=(150, 160, 185))
    return out
