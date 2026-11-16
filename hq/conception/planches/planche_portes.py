"""Responsabilité : planche « catalogue des portes » — chaque type de porte dans un mur droit, en trois états
(fermée, à mi-course, ouverte), plus la porte de mur vertical. Usage : python planche_portes.py <sortie.png>
"""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw

import da_compo as cp
import da_persos as ps
from da_palette import couleur, hexa
from da_portes import porte, porte_verticale
from da_station import Mur, Station, sol

import numpy as np

COL, RANG, MARGE = 96, 84, 8
TYPES = [
    ('coulissante', 32, 'resine', couleur('Anneaux (accents)', 'clients'),
     'COULISSANTE · 2 cases (32×36)\ncompartiment projet ↔ coursive\n6 images, 60 ms ; voyant d\'accent'),
    ('vitree', 48, 'moquette', couleur('Anneaux (accents)', 'salle centrale'),
     'DOUBLE VITRÉE · 3 cases (48×36)\nsalle centrale, salles de réunion\n6 images ; on voit la pièce au travers'),
    ('bois', 32, 'bambou', couleur('Ilots', 'cafe'),
     'BATTANTE BOIS · 2 cases (32×36)\ncafé, coin fumeur, détente\n4 images + rebond 2 images'),
    ('sas', 48, 'technique', couleur('Metal, verre, lumiere', 'danger jaune'),
     'SAS · 3 cases (48×36), cadre 4 px\nentre anneaux, vers le quai\n10 images : ambre, déverrouillage, glisse'),
    ('rideau', 32, 'caillebotis', couleur('Ilots', 'maintenance'),
     'RIDEAU DE SERVICE · 2 cases\nmaintenance, serveurs, nettoyage\n8 images, s\'enroule dans le linteau'),
]


def _cellule(st: Station, rang: int, col: int, sorte: str, largeur: int, sol_sorte: str, ouv: float,
             accent: tuple[int, int, int]) -> None:
    x, y = col * COL + MARGE, rang * RANG + 14
    m = np.zeros((st.h, st.w), bool)
    m[y + 3:y + RANG - 6, x:x + COL - 2 * MARGE] = True
    sol(st, m, sol_sorte)
    st.mur(Mur('h', x, y, COL - 2 * MARGE))
    st.rangees.append((sorte, x + (COL - 2 * MARGE - largeur) // 2 // 8 * 8, largeur, y + 3, ouv, accent))


def construire() -> Station:
    st = Station(COL * 3, RANG * (len(TYPES) + 1))
    st.img[:, :] = (*hexa('#0b0e1c'), 255)
    st.rangees = []  # type: ignore[attr-defined]  # portes à poser après les faces
    for r, (sorte, larg, sol_sorte, accent, _t) in enumerate(TYPES):
        for c, ouv in enumerate((0.0, 0.5, 1.0)):
            _cellule(st, r, c, sorte, larg, sol_sorte, ouv, accent)
    yv = len(TYPES) * RANG + 4
    for c in range(3):
        m = np.zeros((st.h, st.w), bool)
        m[yv:yv + RANG - 6, c * COL + MARGE:(c + 1) * COL - MARGE] = True
        sol(st, m, 'technique')
        cx = c * COL + COL // 2
        st.mur(Mur('v', cx, yv, 18, sans_face=True))
        st.mur(Mur('v', cx, yv + 50, RANG - 56))
    st.peindre_murs()
    for sorte, x0, larg, yf, ouv, accent in st.rangees:  # type: ignore[attr-defined]
        porte(st, sorte, x0, larg, yf, ouv, accent)
    for c, ouv in enumerate((0.0, 0.5, 1.0)):
        porte_verticale(st, c * COL + COL // 2, yv + 18, 32, ouv, couleur('Anneaux (accents)', 'outils-infra'))
    return st


def main(sortie: Path) -> None:
    st = construire()
    m = cp.monde(st.image())
    cp.poser(m, ps.sprite('chris-repos-haut'), (COL // 2 - 26, 14 + 3 + 52))
    cp.poser(m, ps.sprite('clawd-marche-haut'), (2 * COL + COL // 2 + 4, 14 + 3 + 52))
    cp.poser(m, ps.sprite('clawd-marche-droite'), (2 * COL + COL // 2 + 2, len(TYPES) * RANG + 4 + 40))
    p = cp.planche(m)
    fond = Image.new('RGBA', (p.width + 380, p.height), hexa('#070912') + (255,))
    fond.alpha_composite(p, (380, 0))
    d = ImageDraw.Draw(fond)
    for r, (*_x, texte) in enumerate(TYPES):
        cp.etiquette(d, 12, r * RANG * 4 + 60, texte, None, '#9cc6f0', 12)
    cp.etiquette(d, 12, len(TYPES) * RANG * 4 + 60,
                 'PORTE DE MUR VERTICAL · 2 cases\nvue de dessus : seuil, deux montants,\n'
                 'vantail fin ; pas de face au montant',
                 None, '#9ee0c4', 12)
    for c, t in enumerate(('fermée', 'à mi-course', 'ouverte')):
        d.text((380 + c * COL * 4 + 150, 4), t, font=ps.police(14), fill=(230, 232, 240))
    cp.titre(fond, 'Agent HQ - station : catalogue des portes (à l\'échelle de Chris et de Clawd)',
             'Ouverture : rangs 5 à 40 de la face (36 px d\'art). Linteau continu : jamais de bout de mur résiduel.'
             ).convert('RGB').save(sortie)


if __name__ == '__main__':
    main(Path(sys.argv[1]) if len(sys.argv) > 1 else Path('planche-portes.png'))
