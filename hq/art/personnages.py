"""Responsabilité : planches des personnages du monde d'Agent HQ, à l'échelle du monde (tuile 32 px).
- Clawd (règles du GIF officiel : blocs rigides, liseré sombre à droite et en bas, image par image) : de face, de dos,
  de profil (images du GIF officiel ramenées à l'unité 4), marche dans les 4 directions, frappe au clavier vu de dos.
- Le perso de Chris (planche de Mathéo) : 4 directions, marche obtenue en décalant ses jambes une à une.
Sortie : `public/sprites/persos/<nom>.png` (planche horizontale) + `persos.json` (taille d'image, images, ancre pieds).
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ICI = Path(__file__).resolve().parent
MASCOTTE = Path.home() / '.claude/local-mods/mascotte/art'
SORTIE = ICI.parent / 'public/sprites/persos'

U = 4                      # pixels par unité de Clawd
ORANGE = (217, 119, 87)
OMBRE = (190, 98, 70)
BORD = (92, 44, 34)
LUMIERE = (240, 160, 128)
NOIR = (20, 16, 14)
CADRE = (16 * U, 12 * U)   # toile d'une image de Clawd ; corps en x 4..12, y 3..9, pattes 9..11
OX, OY = 4, 3


def bloc(d: ImageDraw.ImageDraw, x0: float, y0: float, x1: float, y1: float, dy: float = 0,
         couleur: tuple[int, int, int] = ORANGE) -> None:
    a = (round((OX + x0) * U), round((OY + y0 + dy) * U))
    b = (round((OX + x1) * U) - 1, round((OY + y1 + dy) * U) - 1)
    d.rectangle([a, b], fill=couleur)
    if couleur == ORANGE and b[0] - a[0] > 6:
        # modelé : lumière du haut à gauche, dégradé vers l'ombre en bas, comme les meubles du décor
        hauteur = b[1] - a[1]
        for k in range(hauteur // 2, hauteur):
            t = (k - hauteur // 2) / max(1, hauteur)
            teinte = tuple(round(c * (1 - 0.18 * t)) for c in ORANGE)
            d.line([(a[0], a[1] + k), (b[0], a[1] + k)], fill=teinte)
        d.line([(a[0] + 1, a[1] + 1), (b[0] - 2, a[1] + 1)], fill=LUMIERE)
        d.line([(a[0] + 1, a[1] + 1), (a[0] + 1, b[1] - 2)], fill=LUMIERE)
    d.line([(b[0], a[1]), b], fill=OMBRE)
    d.line([(a[0], b[1]), b], fill=OMBRE)


DESSUS = (236, 152, 120)


def dessus(d: ImageDraw.ImageDraw, x0: float, x1: float, dy: float) -> None:
    """Dessus du corps vu en trois-quarts (même projection que les meubles) : bande claire au-dessus de la face."""
    a = (round((OX + x0) * U), round((OY - 1.5 + dy) * U))
    b = (round((OX + x1) * U) - 1, round((OY + dy) * U) - 1)
    d.rectangle([a, b], fill=DESSUS)
    d.line([(a[0], a[1]), (b[0], a[1])], fill=(246, 178, 150))
    d.line([(a[0], b[1]), (b[0], b[1])], fill=ORANGE)


def contour(img: Image.Image) -> Image.Image:
    """Liseré sombre d'un pixel autour de la silhouette, pour détacher le perso du décor."""
    a = np.array(img)
    plein = a[..., 3] > 0
    autour = np.zeros_like(plein)
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        autour |= np.roll(np.roll(plein, dx, 1), dy, 0)
    bord = autour & ~plein
    a[bord] = (*BORD, 255)
    return Image.fromarray(a)


def clawd(sens: str, pas: int = -1, bras: tuple[str, str] = ('repos', 'repos'), yeux: str = 'ouverts',
          dy: float = 0, assis: bool = False) -> Image.Image:
    """sens : face | dos. pas : -1 immobile, 0/1 = paire de pattes levée. bras : repos | haut | bas | avant.
    assis : de dos, les pattes sont cachées par l'assise ; de face, elles pendent, raccourcies (genoux pliés)."""
    img = Image.new('RGBA', CADRE, (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    for i, col in enumerate((0, 2, 5, 7)):
        if assis and sens == 'dos':
            break
        levee = pas >= 0 and (i in (0, 3)) == (pas == 0)
        bas = 7 if assis else (7.5 if levee else 8)
        bloc(d, col, 6, col + 1, bas, dy * 0.5)
    bras_y = {'repos': (2, 4), 'haut': (1, 3), 'bas': (3, 5), 'avant': (2.5, 4), 'dresse': (-1, 1.5)}
    for cote, pose in zip((-1, 1), bras):
        y0, y1 = bras_y[pose]
        x0, x1 = (-2, 0) if cote < 0 else (8, 10)
        if pose in ('avant', 'dresse'):
            x0, x1 = (-1.5, 0) if cote < 0 else (8, 9.5)
        bloc(d, x0, y0, x1, y1, dy)
    bloc(d, 0, 0, 8, 6, dy)
    dessus(d, 0, 8, dy)
    if sens == 'face':
        haut = {'ouverts': 1, 'bas': 1.5, 'cligne': 1.75}[yeux]
        for x in (1, 6):
            d.rectangle([((OX + x) * U, round((OY + haut + dy) * U)),
                         ((OX + x + 1) * U - 1, round((OY + 2 + dy) * U) - 1)], fill=NOIR)
    else:
        d.rectangle([(OX * U, round((OY + dy) * U)), ((OX + 8) * U - 1, round((OY + dy) * U) + U // 2)], fill=OMBRE)
    return contour(img)


def clawd_profil(vers: int, pas: int) -> Image.Image:
    """Profil (vers = 1 droite, -1 gauche) : corps vu de côté (6 de large) avec la bande d'ombre du côté arrière,
    un œil à l'avant, le bras avant, deux paires de pattes qui alternent."""
    img = Image.new('RGBA', CADRE, (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    for i, col in enumerate((1.5, 5)):
        levee = pas >= 0 and (i == 0) == (pas == 0)
        avance = 0.5 * vers if levee else 0
        bloc(d, col + avance, 6, col + 1.5 + avance, 7.5 if levee else 8, 0.25 * (pas == 0))
    dy = 0.25 * (pas == 0)
    bloc(d, 1, 0, 7, 6, dy)
    dessus(d, 1, 7, dy)
    arriere = (1, 2) if vers > 0 else (6, 7)
    bloc(d, arriere[0], 0, arriere[1], 6, dy, OMBRE)
    oeil = 5.5 if vers > 0 else 1.5
    d.rectangle([(round((OX + oeil) * U), round((OY + 1 + dy) * U)),
                 (round((OX + oeil + 1) * U) - 1, round((OY + 2 + dy) * U) - 1)], fill=NOIR)
    bras = (6.5, 8) if vers > 0 else (0, 1.5)
    bloc(d, bras[0], 2.5 + (0.5 if pas == 1 else 0), bras[1], 4 + (0.5 if pas == 1 else 0), dy)
    return contour(img)


def profil_gif(nom: str) -> list[Image.Image]:
    gif = Image.open(MASCOTTE / f'sprites/clawd/{nom}.gif')
    images = []
    for i in range(gif.n_frames):
        gif.seek(i)
        im = gif.convert('RGBA')
        im = im.resize((im.width * 2 // 3, im.height * 2 // 3), Image.Resampling.NEAREST)
        boite = im.getbbox() or (0, 0, 1, 1)
        im = im.crop(boite)
        toile = Image.new('RGBA', CADRE, (0, 0, 0, 0))
        toile.alpha_composite(im, ((CADRE[0] - im.width) // 2, CADRE[1] - 4 - im.height))
        images.append(contour(toile) if np.array(toile)[..., 3].any() else toile)
    return images


def assis_frappe() -> list[tuple[Image.Image, int]]:
    """Assis de dos : rafales de frappe, une pause, et de temps en temps il s'étire (bras en l'air, corps qui monte)."""
    seq: list[tuple[Image.Image, int]] = []
    for rafale in range(3):
        for k in range(6 + rafale * 2):
            g, d_ = ('haut', 'avant') if k % 2 else ('avant', 'haut')
            seq.append((clawd('dos', bras=(g, d_), dy=0.25 * (k % 2), assis=True), 100))
        seq.append((clawd('dos', bras=('avant', 'avant'), assis=True), 600 + 300 * rafale))
    seq += [(clawd('dos', bras=('haut', 'haut'), dy=-0.5, assis=True), 220),
            (clawd('dos', bras=('dresse', 'dresse'), dy=-0.75, assis=True), 700),
            (clawd('dos', bras=('haut', 'haut'), dy=-0.5, assis=True), 200),
            (clawd('dos', assis=True), 500)]
    return seq


def clawd_planches() -> dict[str, list[tuple[Image.Image, int]]]:
    face = [(clawd('face', yeux='ouverts'), 1800), (clawd('face', yeux='cligne'), 110),
            (clawd('face', yeux='ouverts'), 1200), (clawd('face', yeux='bas'), 900)]
    marche = {s: [(clawd(s, p, dy=0.25 * (p == 0)), 130) for p in (0, 1)] for s in ('face', 'dos')}
    frappe = []
    for k in range(8):
        g, d_ = ('haut', 'avant') if k % 2 else ('avant', 'haut')
        frappe.append((clawd('dos', bras=(g, d_), dy=0.25 * (k % 2)), 110))
    frappe += [(clawd('dos', bras=('avant', 'avant')), 700)]
    droite = [(clawd_profil(1, p), 130) for p in (0, 1)]
    gauche = [(clawd_profil(-1, p), 130) for p in (0, 1)]
    return {
        'clawd-repos': face,
        'clawd-marche-bas': marche['face'],
        'clawd-marche-haut': marche['dos'],
        'clawd-marche-droite': droite,
        'clawd-marche-gauche': gauche,
        'clawd-repos-dos': [(clawd('dos'), 1000)],
        'clawd-frappe': frappe,
        'clawd-content': [(clawd('face', bras=('haut', 'haut'), dy=-0.5), 150), (clawd('face'), 150)],
        'clawd-assis-frappe': assis_frappe(),
        'clawd-assis-dos': [(clawd('dos', assis=True), 1000)],
        'clawd-assis-face': [(clawd('face', assis=True), 1700), (clawd('face', assis=True, yeux='cligne'), 110),
                             (clawd('face', assis=True, yeux='bas'), 900)],
        'clawd-assis-question': [(clawd('face', bras=('repos', 'haut'), assis=True), 700),
                                 (clawd('face', bras=('repos', 'dresse'), assis=True, dy=-0.25), 260)],
        'clawd-question': [(clawd('face', bras=('repos', 'haut')), 700), (clawd('face', bras=('repos', 'haut'),
                                                                                yeux='cligne'), 110)],
    }


NOIR_CHAISE = (38, 34, 44)
GRIS_CHAISE = (62, 58, 70)
REFLET_CHAISE = (96, 92, 108)
CHAISE = (40, 48)   # toile commune aux deux pièces ; pied au centre bas


def chaise_dossier() -> Image.Image:
    """Dossier vu de dos : coque arrondie 30 × 20 sur sa tige, posé au-dessus de l'assise."""
    im = Image.new('RGBA', CHAISE, (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([7, 15, 32, 30], radius=5, fill=NOIR_CHAISE)
    d.rounded_rectangle([9, 17, 30, 27], radius=4, fill=GRIS_CHAISE)
    d.line([(12, 18), (26, 18)], fill=REFLET_CHAISE)
    d.line([(10, 20), (10, 25)], fill=REFLET_CHAISE)
    d.rectangle([18, 30, 21, 33], fill=NOIR_CHAISE)
    return contour(im)


def chaise_assise() -> Image.Image:
    """Assise, vérin et piètement en étoile à roulettes."""
    im = Image.new('RGBA', CHAISE, (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([4, 28, 35, 36], radius=3, fill=NOIR_CHAISE)
    d.rounded_rectangle([6, 29, 33, 34], radius=2, fill=GRIS_CHAISE)
    d.line([(8, 29), (30, 29)], fill=REFLET_CHAISE)
    d.rectangle([18, 37, 21, 41], fill=NOIR_CHAISE)
    for x0, x1 in ((6, 18), (21, 33)):
        d.line([(x0, 44), (x1, 42)] if x0 < 18 else [(x0, 42), (x1, 44)], fill=NOIR_CHAISE, width=2)
    d.line([(19, 42), (19, 46)], fill=NOIR_CHAISE, width=2)
    for x in (5, 19, 33):
        d.ellipse([x - 2, 44, x + 2, 47], fill=(20, 18, 24))
    return contour(im)


CHRIS_H = 64
CHRIS_CADRE = (40, 68)


def chris(vue: str) -> Image.Image:
    img = Image.open(MASCOTTE / f'sprites/perso/{vue}.png').convert('RGBA')
    img = img.resize((round(img.width * CHRIS_H / img.height), CHRIS_H), Image.Resampling.LANCZOS)
    a = np.array(img)
    a[..., 3] = np.where(a[..., 3] > 110, 255, 0)
    toile = Image.new('RGBA', CHRIS_CADRE, (0, 0, 0, 0))
    toile.alpha_composite(Image.fromarray(a), ((CHRIS_CADRE[0] - img.width) // 2, CHRIS_CADRE[1] - 2 - CHRIS_H))
    return toile


def monter(a: np.ndarray, n: int) -> np.ndarray:
    """Décale vers le haut de n pixels sans reboucler (le bas se vide)."""
    out = np.zeros_like(a)
    if n:
        out[:-n] = a[n:]
    else:
        out[:] = a
    return out


def chris_pas(vue: str, pas: int) -> Image.Image:
    """Marche : la jambe d'un côté remonte de 2 px (vue de face/dos) ou avance (profil) ; le haut du corps rebondit."""
    base = np.array(chris(vue))
    h = CHRIS_CADRE[1]
    hanche = h - 2 - CHRIS_H * 30 // 100
    out = np.zeros_like(base)
    out[:hanche] = monter(base[:hanche + 1], 1 if pas else 0)[:hanche]
    jambes = base[hanche:]
    milieu = CHRIS_CADRE[0] // 2
    gauche, droite = jambes[:, :milieu], jambes[:, milieu:]
    if pas == 0:
        gauche = monter(gauche, 2)
    else:
        droite = monter(droite, 2)
    out[hanche:, :milieu] = gauche
    out[hanche:, milieu:] = droite
    return Image.fromarray(out)


def chris_planches() -> dict[str, list[tuple[Image.Image, int]]]:
    # bas, droite, gauche : marches tirées des vidéos (marche_video.py) ; la vidéo de dos a échoué, d'où cette vue.
    vues = {'haut': 'dos'}
    planches: dict[str, list[tuple[Image.Image, int]]] = {}
    for sens, vue in vues.items():
        planches[f'chris-repos-{sens}'] = [(chris(vue), 1000)]
        planches[f'chris-marche-{sens}'] = [(chris_pas(vue, 0), 150), (chris(vue), 110), (chris_pas(vue, 1), 150),
                                            (chris(vue), 110)]
    planches['chris-cafe'] = [(chris('cafe'), 2600), (chris('r315'), 1400)]
    return planches


def ecrire(nom: str, images: list[tuple[Image.Image, int]], ancre: tuple[int, int]) -> dict:
    uniques: list[bytes] = []
    planche_imgs: list[Image.Image] = []
    seq = []
    for im, ms in images:
        cle = im.tobytes()
        if cle not in uniques:
            uniques.append(cle)
            planche_imgs.append(im)
        seq.append([uniques.index(cle), ms])
    w, h = planche_imgs[0].size
    planche = Image.new('RGBA', (w * len(planche_imgs), h), (0, 0, 0, 0))
    for i, im in enumerate(planche_imgs):
        planche.alpha_composite(im, (i * w, 0))
    planche.save(SORTIE / f'{nom}.png')
    return {'w': w, 'h': h, 'n': len(planche_imgs), 'seq': seq, 'ancre': list(ancre)}


def main() -> None:
    SORTIE.mkdir(parents=True, exist_ok=True)
    index = {}
    for nom, imgs in clawd_planches().items():
        index[nom] = ecrire(nom, imgs, (CADRE[0] // 2, CADRE[1] - 4))
    for nom, imgs in chris_planches().items():
        index[nom] = ecrire(nom, imgs, (CHRIS_CADRE[0] // 2, CHRIS_CADRE[1] - 2))
    chemin = SORTIE / 'persos.json'
    # garder les planches produites ailleurs (marche_video.py : marche de Chris tirée des vidéos)
    anciennes = json.loads(chemin.read_text()) if chemin.exists() else {}
    for nom, planche in anciennes.items():
        if nom not in index and (SORTIE / f'{nom}.png').exists():
            index[nom] = planche
    chemin.write_text(json.dumps(index, indent=1))
    print(', '.join(f"{k}:{v['n']}" for k, v in index.items()))


if __name__ == '__main__':
    main()
