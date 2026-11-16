"""Responsabilité : palette de la station d'Agent HQ (source unique des planches de travail) et planche de palette.
Planche de discussion, pas un asset du jeu. Usage : python da_palette.py <sortie.png>
"""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

Rgb = tuple[int, int, int]


def hexa(h: str) -> Rgb:
    return int(h[1:3], 16), int(h[3:5], 16), int(h[5:7], 16)


PALETTE: dict[str, dict[str, str]] = {
    'Espace': {'vide': '#070912', 'fond': '#0b0e1c', 'nebuleuse': '#2a1f45', 'nebuleuse claire': '#3d2a5c',
               'etoile': '#ffffff', 'etoile froide': '#cfe0ff', 'etoile chaude': '#ffe7b0',
               'planete nuit': '#12223a', 'planete': '#2f5d8a', 'planete jour': '#4f8fc0', 'atmosphere': '#bfe6ff'},
    'Coque exterieure': {'plaque': '#d9dde2', 'plaque ombre': '#a9b0ba', 'joint': '#7d8592', 'pied': '#4f5560',
                         'isolant or': '#c9a24a', 'isolant ombre': '#8f6f2a', 'isolant reflet': '#f0d68a',
                         'solaire': '#1f3a6b', 'cellule': '#2e5a9e', 'cellule reflet': '#8fb4e8',
                         'treillis': '#8a9099', 'treillis ombre': '#5c626b'},
    'Murs interieurs': {'contour': '#262a36', 'dessus': '#c3c8d0', 'dessus clair': '#e6e9ee',
                        'corniche': '#2e3240', 'corniche metal': '#8a919e', 'panneau': '#e2dccb',
                        'panneau ombre': '#cbc3ad', 'joint panneau': '#b9b09a', 'rail clair': '#a9b2c0',
                        'rail': '#7d8696', 'soubassement': '#4a5262', 'joint soub.': '#3a4150',
                        'grille': '#2b313c', 'plinthe': '#2a2f3a', 'plinthe ombre': '#1e222b'},
    'Sols': {'technique': '#5d6573', 'technique 2': '#535a68', 'joint tech.': '#3d434f', 'rivet': '#7c8494',
             'resine': '#c7c9c2', 'resine joint': '#aeb0a8', 'moquette nuit': '#2f3d5c', 'moquette motif': '#3a4a6e',
             'bambou': '#b89462', 'bambou joint': '#8f6f45', 'caillebotis': '#3b414c', 'caillebotis vide': '#1d2128'},
    'Metal, verre, lumiere': {'metal': '#9aa3b0', 'metal clair': '#c4cad3', 'metal ombre': '#6b7380',
                              'vitre': '#9fd8e8', 'vitre reflet': '#e8fbff', 'neon froid': '#bfe8ff',
                              'lampe chaude': '#ffe2b0', 'ecran': '#78d2fa', 'ombre portee': '#140c1e',
                              'danger jaune': '#f2c94c', 'danger noir': '#262830'},
    'Anneaux (accents)': {'clients': '#4a8fd9', 'clients sombre': '#2c5a8f', 'clients clair': '#9cc6f0',
                          'outils-infra': '#4fb08a', 'infra sombre': '#2e6e55', 'infra clair': '#9ee0c4',
                          'jeux-crea': '#a070d8', 'crea sombre': '#63408f', 'crea clair': '#d1b5f2',
                          'salle centrale': '#5fe0ff', 'centrale sombre': '#2a8fb0'},
    'Ilots': {'cafe': '#9a6440', 'cafe creme': '#e8d6b8', 'fumeur': '#8f8a6a', 'cendre': '#b5b2a8',
              'maintenance': '#f2c94c', 'serveurs': '#3fd0c0', 'nettoyage': '#7fd6e0', 'reglages': '#8f8fb8'},
    'Etats et persos (reserves)': {'clawd': '#d97757', 'clawd ombre': '#be6246', 'clawd bord': '#5c2c22',
                                   'bloque (rouge)': '#ff4d6a', 'question (ambre)': '#f0a030',
                                   'autonome (antenne)': '#3fe0c8', 'interactif (casque)': '#f4f1ea',
                                   'haiku': '#f2c94c', 'sonnet': '#6fb3e0', 'opus': '#b58ce0',
                                   'pause': '#9a6440', 'eteint': '#6b6f7a', 'bulle': '#eef0f6',
                                   'bulle bord': '#262a36', 'lien': '#5fe0ff'},
}


def couleur(groupe: str, nom: str) -> Rgb:
    return hexa(PALETTE[groupe][nom])


def police(taille: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype('/usr/share/fonts/TTF/DejaVuSansMono-Bold.ttf', taille)


def planche(sortie: Path) -> None:
    col_w, sw, pas = 300, 34, 40
    hauteur = 70 + max(len(v) for v in PALETTE.values()) * pas
    img = Image.new('RGB', (col_w * 4 + 40, hauteur * 2 + 60), hexa('#0b0e1c'))
    d = ImageDraw.Draw(img)
    d.text((20, 14), 'Agent HQ - station : palette (hex)', font=police(22), fill=(230, 232, 240))
    for k, (groupe, teintes) in enumerate(PALETTE.items()):
        x0 = 20 + (k % 4) * col_w
        y0 = 60 + (k // 4) * hauteur
        d.text((x0, y0), groupe, font=police(15), fill=(160, 210, 240))
        for i, (nom, h) in enumerate(teintes.items()):
            y = y0 + 26 + i * pas
            d.rectangle([x0, y, x0 + sw, y + sw - 6], fill=hexa(h), outline=(60, 64, 80))
            d.text((x0 + sw + 8, y + 1), nom, font=police(12), fill=(220, 222, 230))
            d.text((x0 + sw + 8, y + 15), h, font=police(11), fill=(140, 146, 165))
    img.save(sortie)


if __name__ == '__main__':
    planche(Path(sys.argv[1]) if len(sys.argv) > 1 else Path('planche-palette.png'))
