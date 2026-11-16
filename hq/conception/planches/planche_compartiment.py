"""Responsabilité : vignette d'un compartiment de projet type (anneau Clients, coin de l'octogone) avec son îlot
voisin (coin fumeur, trapèze sous le pan à 45°), la coursive et l'anneau suivant. Planche de discussion.
Usage : python planche_compartiment.py <sortie.png>
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

import da_compo as cp
import da_meubles as mb
import da_persos as ps
from da_palette import couleur, hexa
from da_portes import porte, voyant
from da_station import Mur, Station, espace, hasard, hublot, sol

ACCENT = couleur('Anneaux (accents)', 'clients')
E = 'Etats et persos (reserves)'
YF_FOND, YF_AVANT, YF_INT = 27, 235, 313   # premier rang des faces : fond (coque), mur avant, anneau intérieur


def masque(st: Station, pts: list[tuple[int, int]]) -> np.ndarray:
    img = Image.new('L', (st.w, st.h), 0)
    ImageDraw.Draw(img).polygon(pts, fill=1)
    return np.array(img) > 0


def tableau_objectifs(st: Station, x0: int) -> None:
    """Tableau d'objectifs accroché à la face : post-its par colonne (à faire, en cours, fait) + barre d'avancement."""
    st.rect(x0 - 1, YF_FOND + 5, x0 + 45, YF_FOND + 23, hexa('#262a36'))
    st.rect(x0, YF_FOND + 6, x0 + 44, YF_FOND + 22, hexa('#eef0f6'))
    teintes = [hexa('#f2c94c'), hexa('#9cc6f0'), hexa('#9ee0c4')]
    for c, n in enumerate((3, 2, 4)):
        for k in range(n):
            st.rect(x0 + 2 + c * 15, YF_FOND + 8 + k * 3, x0 + 12 + c * 15, YF_FOND + 9 + k * 3, teintes[c])
    st.rect(x0 + 2, YF_FOND + 20, x0 + 42, YF_FOND + 20, hexa('#b9b09a'))
    st.rect(x0 + 2, YF_FOND + 20, x0 + 28, YF_FOND + 20, ACCENT)


def ecran_mural(st: Station, x0: int, yf: int, w: int = 30) -> None:
    st.rect(x0 - 1, yf + 6, x0 + w + 1, yf + 20, hexa('#262a36'))
    st.rect(x0, yf + 7, x0 + w, yf + 19, hexa('#12223a'))
    for k in range(4):
        c = ACCENT if k % 2 else hexa('#9ee0c4')
        st.rect(x0 + 2, yf + 9 + k * 3, x0 + 2 + (k * 9 + 7) % (w - 4), yf + 9 + k * 3, c)


def cendres(st: Station, x0: int, y0: int) -> None:
    for k in range(14):
        st.px(x0 + int(hasard(k, 1) * 26), y0 + int(hasard(k, 2) * 14), couleur('Ilots', 'cendre'))


def murs(st: Station) -> None:
    for m in (Mur('h', 0, 24, 381, hublots=40), Mur('d\\', 380, 24, 96), Mur('v', 476, 120, 191),
              Mur('v', 40, 25, 208), Mur('v', 330, 25, 208), Mur('h', 0, 232, 478),
              Mur('h', 0, 310, 478), Mur('h', 476, 310, 68, style='dehors')):
        st.mur(m)


def construire() -> Station:
    st = Station(544, 352)
    espace(st, 11)
    sol(st, masque(st, [(0, 24), (40, 24), (40, 232), (0, 232)]), 'bambou')
    sol(st, masque(st, [(40, 24), (330, 24), (330, 232), (40, 232)]), 'moquette')
    sol(st, masque(st, [(330, 24), (380, 24), (476, 120), (476, 232), (330, 232)]), 'resine')
    sol(st, masque(st, [(0, 232), (476, 232), (476, 310), (0, 310)]), 'technique')
    murs(st)
    st.peindre_murs()
    for x in (70, 262, 355):
        hublot(st, x, YF_FOND)
    tableau_objectifs(st, 104)
    ecran_mural(st, 190, YF_FOND)
    porte(st, 'coulissante', 208, 32, YF_AVANT, 0.0, ACCENT)
    porte(st, 'bois', 376, 32, YF_AVANT, 0.6, couleur('Ilots', 'fumeur'))
    st.rect(160, YF_AVANT + 8, 196, YF_AVANT + 15, hexa('#262a36'))   # plaque du projet (texte sur la planche)
    st.rect(161, YF_AVANT + 9, 195, YF_AVANT + 14, ACCENT)
    ecran_mural(st, 250, YF_AVANT, 26)
    st.rect(0, 296, 476, 297, ACCENT)                                   # bande d'anneau au sol de la coursive
    voyant(st, 120, YF_AVANT, couleur(E, 'bloque (rouge)'))
    cendres(st, 392, 150)
    return st


def peupler(m: Image.Image) -> None:
    for x in (70, 262):
        cp.tache_hublot(m, x - 6, 70, 12, 40, couleur('Metal, verre, lumiere', 'neon froid'))
    cp.lumiere(m, 185, 150, 120, 50, couleur('Metal, verre, lumiere', 'lampe chaude'))
    cp.lumiere(m, 420, 170, 50, 26, couleur('Ilots', 'cafe creme'), 0.7)
    cp.lumiere(m, 240, 280, 200, 18, couleur('Metal, verre, lumiere', 'neon froid'), 0.8)
    poses = [
        (mb.plante(), (54, 78)), (mb.poste(ACCENT), (128, 84)), (mb.poste(ACCENT), (226, 84)),
        (mb.bibliotheque(), (300, 76)), (mb.console_fil(ACCENT), (82, 150)), (mb.terminal(), (306, 164)),
        (mb.pod_sous_agents(ACCENT), (190, 186)), (mb.poubelle(), (318, 222)), (mb.poubelle(), (462, 226)),
        (mb.banc(), (356, 100)), (mb.cendrier_pied(), (380, 168)), (mb.cendrier_pied(), (452, 200)),
    ]
    for spr, pied in poses:
        cp.poser(m, spr, pied)
    agents = [
        (ps.casque_micro(ps.sprite('clawd-assis-dos')), (128, 104)),
        (ps.antenne(ps.sprite('clawd-assis-frappe', 1)), (226, 104)),
        (ps.sprite('clawd-question'), (300, 186)),
        (ps.sous_agent(couleur(E, 'haiku')), (190, 178)),
        (ps.sous_agent(couleur(E, 'haiku'), porte=True, pas=1), (270, 104)),
        (ps.sous_agent(couleur(E, 'haiku'), porte=True), (150, 200)),
        (ps.sous_agent(couleur(E, 'sonnet')), (232, 200)),
        (ps.sprite('clawd-clope', 40), (405, 160)),
        (ps.sprite('chris-marche-haut', 2), (224, 300)),
    ]
    for spr, pied in agents:
        cp.poser(m, spr, pied)
    rouge = ps.anneau(40, couleur(E, 'bloque (rouge)'))
    m.alpha_composite(rouge, (300 * 2 - 22, 186 * 2 - 10))


def annoter(p: Image.Image) -> None:
    d = ImageDraw.Draw(p)
    for sa in ((190, 178), (270, 104), (150, 200), (232, 200)):
        ps.lien(d, (128 * 4, 104 * 4 - 150), (sa[0] * 4, sa[1] * 4 - 50), ACCENT, sa[0] // 10)
    ps.lien(d, (226 * 4, 104 * 4 - 160), (2150, 300), couleur(E, 'lien'), 1)
    ps.bulle(d, 128 * 4, 104 * 4 - 170, ['Je lance 4 sous-agents :', 'tests, doc, migration…'], hexa('#262a36'))
    ps.bulle(d, 300 * 4, 186 * 4 - 130, ['git push sur main ?'], couleur(E, 'bloque (rouge)'), 13,
             couleur(E, 'bloque (rouge)'))
    ps.bulle(d, 405 * 4 + 20, 160 * 4 - 210, ['pause · 4 min'], couleur('Ilots', 'fumeur'))
    d.text((161 * 4 + 6, (YF_AVANT + 9) * 4 + 2), 'LEADAR', font=ps.police(17), fill=hexa('#0b0e1c'))
    e = cp.etiquette
    e(d, 1600, 60, 'îlot « coin fumeur » : trapèze\nsous le pan à 45°, porte battante bois,\n'
      'cendres au sol, pas de meuble adossé\nau pan', (1640, 420))
    e(d, 20, 1060, 'coursive d\'anneau : sol technique,\nbande d\'accent bleue (anneau Clients),\n'
      'néon froid ; 5 cases dont 3 visibles', (200, 1185))
    e(d, 1600, 760, 'lien vers une autre session\n(arc pointillé, calque UI)', (2120, 330))
    e(d, 440, 1000, 'plaque du projet + voyant rouge\nvisibles depuis la coursive', (560, 975))
    e(d, 20, 120, 'console du fil', (300, 520))
    e(d, 1220, 100, 'bibliothèque', (1200, 230))
    e(d, 1340, 520, 'terminal', (1240, 610))
    e(d, 900, 860, 'baie de lancement\ndes sous-agents', (780, 720))
    e(d, 410, 40, 'tableau d\'objectifs', (520, 150))


def main(sortie: Path) -> None:
    st = construire()
    m = cp.monde(st.image())
    peupler(m)
    p = cp.planche(m)
    annoter(p)
    cp.titre(p, 'Agent HQ - station : compartiment de projet type + îlot voisin',
             'Anneau Clients (accent bleu). Orchestrateur au casque (interactif), agent à l\'antenne (autonome), '
             'sous-agents au casque de chantier, un agent bloqué (anneau rouge).').convert('RGB').save(sortie)


if __name__ == '__main__':
    main(Path(sys.argv[1]) if len(sys.argv) > 1 else Path('vignette-compartiment.png'))
