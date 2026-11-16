"""Responsabilité : planche « murs et échelle » — haut d'un compartiment octogonal (mur droit, deux murs à 45°, murs
verticaux), coque vue de l'espace, trois portes, et les personnages à l'échelle devant la face.
Usage : python planche_murs.py <sortie.png>
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

import da_compo as cp
import da_meubles as mb
import da_persos as ps
from da_palette import couleur
from da_portes import porte, porte_verticale
from da_station import Mur, Station, espace, hublot, sol

ACCENT = couleur('Anneaux (accents)', 'clients')
POLY_PIECE = [(56, 104), (120, 40), (330, 40), (394, 104), (394, 214), (56, 214)]


def masque_poly(w: int, h: int, pts: list[tuple[int, int]]) -> np.ndarray:
    img = Image.new('L', (w, h), 0)
    ImageDraw.Draw(img).polygon(pts, fill=1)
    return np.array(img) > 0


def construire() -> Station:
    st = Station(480, 272)
    espace(st, 5)
    sol(st, masque_poly(st.w, st.h, POLY_PIECE), 'bambou')
    sol(st, masque_poly(st.w, st.h, [(394, 103), (479, 103), (479, 214), (394, 214)]), 'technique')
    for m in (Mur('h', 120, 40, 211), Mur('d\\', 330, 40, 64), Mur('v', 394, 104, 46, sans_face=True),
              Mur('v', 394, 182, 33), Mur('d/', 56, 104, 65), Mur('v', 56, 105, 110),
              Mur('h', 397, 103, 83), Mur('h', 40, 214, 440, style='dehors')):
        st.mur(m)
    st.peindre_murs()
    for x in (150, 190, 300, 340):
        hublot(st, x, 43)
    hublot(st, 440, 106)
    porte(st, 'coulissante', 224, 32, 43, 0.5, ACCENT)
    porte(st, 'sas', 272, 48, 217, 0.0, ACCENT)
    porte_verticale(st, 394, 150, 32, 0.35, ACCENT)
    st.rect(452, 150, 453, 211, ACCENT)  # bande d'anneau au sol de la coursive, sous la face
    st.rect(451, 150, 451, 211, couleur('Anneaux (accents)', 'clients sombre'))
    return st


def peupler(m: Image.Image) -> None:
    for x in (150, 190, 300, 340):
        cp.tache_hublot(m, x - 6, 86, 12, 34, couleur('Metal, verre, lumiere', 'neon froid'))
    cp.lumiere(m, 225, 160, 80, 36, couleur('Metal, verre, lumiere', 'lampe chaude'))
    cp.poser(m, mb.poste(ACCENT), (318, 99))
    cp.poser(m, mb.plante(), (372, 112))
    cp.poser(m, ps.sprite('chris-repos-bas'), (150, 100))
    cp.poser(m, ps.casque_micro(ps.sprite('clawd-repos')), (182, 100))
    cp.poser(m, ps.sous_agent(couleur('Etats et persos (reserves)', 'haiku')), (205, 100))
    cp.poser(m, ps.antenne(ps.sprite('clawd-repos')), (120, 150))
    cp.poser(m, ps.sous_agent(couleur('Etats et persos (reserves)', 'sonnet'), porte=True), (430, 170))


def annoter(p: Image.Image) -> None:
    d = ImageDraw.Draw(p)
    e = cp.etiquette
    e(d, 470, 20, 'mur droit : dessus 5 px + face 41 px\n(82 px monde), hublots ronds', (560, 200))
    e(d, 1440, 20, 'mur à 45° (↘) : rang de dessus 7 px,\nface +6 % (orientée SO), joints / 11 px', (1440, 260))
    e(d, 20, 120, 'mur à 45° (↗) :\nface −12 % (SE)\nni hublot ni porte', (300, 330))
    e(d, 1600, 330, 'mur vertical : dessus 6 px\nseul ; face au bout bas', (1586, 760))
    e(d, 900, 440, 'coulissante 2 cases\nlinteau continu', (960, 300))
    e(d, 1560, 520, 'porte de mur vertical :\nchambranle, pas de face', (1580, 640))
    e(d, 1240, 1000, 'sas 3 cases vers le quai\n(coque vue de l\'espace)', (1180, 940))
    e(d, 20, 900, 'face extérieure : plaques\nblanches + isolant doré', (300, 940))
    e(d, 470, 830, 'Chris 32 · Clawd 20 · sous-agent 11 · porte 36 · face 41 (px d\'art)', None)
    e(d, 360, 640, 'autonome : antenne', (480, 560))
    e(d, 560, 250, 'interactif : casque', (728, 340))


def main(sortie: Path) -> None:
    st = construire()
    m = cp.monde(st.image())
    peupler(m)
    p = cp.planche(m)
    annoter(p)
    cp.titre(p, 'Agent HQ - station : murs droits, murs à 45°, portes, échelle',
             '1 px d\'art = 4 px ici (×2 monde, ×2 planche). Lumière en haut à gauche, ombres en bas à droite.'
             ).convert('RGB').save(sortie)


if __name__ == '__main__':
    main(Path(sys.argv[1]) if len(sys.argv) > 1 else Path('planche-murs.png'))
