"""Responsabilité : catalogue des portes de la station (planches de travail) — dessinées dans la face d'un mur droit
horizontal (élévation frontale), ouverture 0..1. Le dessus du mur passe au-dessus de la porte (linteau continu) :
pas de bout de mur résiduel. Ouverture standard : rangs 5 à 40 de la face (36 px de haut).
"""
from __future__ import annotations

from collections.abc import Callable

from da_palette import Rgb, couleur, hexa
from da_station import Station, melanger, nuancer

HAUT_LIBRE = 5        # premier rang ouvert de la face (rangs 1..4 = linteau)
BAS = 40              # dernier rang de la face (seuil)
CADRE = 2             # épaisseur du chambranle
TRAIT = hexa('#262a36')
METAL = couleur('Metal, verre, lumiere', 'metal')
METAL_C = couleur('Metal, verre, lumiere', 'metal clair')
METAL_S = couleur('Metal, verre, lumiere', 'metal ombre')


def _embrasure(st: Station, x0: int, x1: int, y0: int, y1: int) -> None:
    """Ce qu'on voit par la porte ouverte : la pièce d'à côté, sombre en haut, en paliers (pas de dégradé lisse)."""
    paliers = [hexa('#151821'), hexa('#1f2430'), hexa('#2c3240'), hexa('#3c4352')]
    for y in range(y0, y1 + 1):
        t = (y - y0) / max(1, y1 - y0)
        st.rect(x0, y, x1, y, paliers[min(3, int(t * 4))])


def _chambranle(st: Station, x0: int, x1: int, yf: int, accent: Rgb, epais: int = CADRE) -> None:
    y0, y1 = yf + HAUT_LIBRE - epais, yf + BAS
    st.rect(x0 - epais, y0, x1 + epais, y1, METAL_S)
    st.rect(x0 - epais, y0, x1 + epais, y0, METAL_C)
    st.rect(x0 - epais, y0 + 1, x0 - epais, y1, METAL_C)
    st.rect(x0 - epais - 1, y0 - 1, x1 + epais + 1, y0 - 1, TRAIT)
    st.rect(x0 - epais - 1, y0, x0 - epais - 1, y1, TRAIT)
    st.rect(x1 + epais + 1, y0, x1 + epais + 1, y1, TRAIT)
    st.rect(x0 - epais, y0 + 1, x1 + epais, y0 + 1, accent)


def voyant(st: Station, cx: int, yf: int, c: Rgb) -> None:
    st.rect(cx - 2, yf + 1, cx + 1, yf + 2, TRAIT)
    st.rect(cx - 1, yf + 1, cx, yf + 2, c)


def _battants(st: Station, x0: int, x1: int, yf: int, ouv: float,
              battant: Callable[[Station, int, int, int, int, int], None]) -> None:
    """Deux vantaux qui coulissent dans le mur : chacun recule de `ouv` × sa largeur."""
    y0, y1 = yf + HAUT_LIBRE, yf + BAS
    _embrasure(st, x0, x1, y0, y1)
    demi = (x1 - x0 + 1) // 2
    recul = round(ouv * demi)
    if recul < demi:
        battant(st, x0, x0 + demi - 1 - recul, y0, y1, -1)
        battant(st, x0 + demi + recul, x1, y0, y1, 1)


def _vantail_metal(accent: Rgb) -> Callable[[Station, int, int, int, int, int], None]:
    def f(st: Station, xa: int, xb: int, y0: int, y1: int, cote: int) -> None:
        st.rect(xa, y0, xb, y1, METAL_C)
        st.rect(xa, y0 + 14, xb, y0 + 16, accent)
        st.rect(xa, y1 - 3, xb, y1, METAL_S)
        joint = xb if cote < 0 else xa
        st.rect(joint, y0, joint, y1, TRAIT)
        if xb - xa >= 6:
            st.rect(xa + 3, y0 + 4, xb - 3, y0 + 10, couleur('Metal, verre, lumiere', 'vitre'))
            st.rect(xa + 3, y0 + 4, xb - 3, y0 + 4, couleur('Metal, verre, lumiere', 'vitre reflet'))
    return f


def _vantail_verre(st: Station, xa: int, xb: int, y0: int, y1: int, cote: int) -> None:
    for y in range(y0, y1 + 1):
        for x in range(xa, xb + 1):
            fond = tuple(st.img[y, x, :3])
            st.px(x, y, melanger(fond, couleur('Metal, verre, lumiere', 'vitre'), 0.55))  # type: ignore[arg-type]
    st.rect(xa, y0, xb, y0 + 1, METAL)
    st.rect(xa, y1 - 2, xb, y1, METAL)
    st.rect(xa if cote > 0 else xb, y0, xa if cote > 0 else xb, y1, METAL)
    for k in range(4):
        st.px(xa + 2 + k, y0 + 6 + k, couleur('Metal, verre, lumiere', 'vitre reflet'))


def _vantail_sas(st: Station, xa: int, xb: int, y0: int, y1: int, cote: int) -> None:
    st.rect(xa, y0, xb, y1, METAL_S)
    st.rect(xa, y0, xb, y0, METAL)
    for y in range(y1 - 6, y1 + 1):
        for x in range(xa, xb + 1):
            st.px(x, y, couleur('Metal, verre, lumiere', 'danger jaune' if (x + y) % 6 < 3 else 'danger noir'))
    bord = xb if cote < 0 else xa
    cx, cy = bord, y0 + 13
    for y in range(cy - 7, cy + 8):
        for x in range(xa, xb + 1):
            d = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5
            if d <= 5:
                vitre = couleur('Espace', 'fond') if (x + y) % 5 else couleur('Metal, verre, lumiere', 'neon froid')
                st.px(x, y, vitre)
            elif d <= 7:
                st.px(x, y, METAL_C)
    st.rect(bord, y0, bord, y1, TRAIT)


def _bois(st: Station, x0: int, x1: int, yf: int, ouv: float) -> None:
    """Battante en bois : en s'ouvrant, chaque vantail pivote vers l'intérieur et se réduit à sa tranche."""
    y0, y1 = yf + HAUT_LIBRE, yf + BAS
    _embrasure(st, x0, x1, y0, y1)
    demi = (x1 - x0 + 1) // 2
    largeur = max(2, round(demi * (1 - ouv)))
    bois, joint = couleur('Ilots', 'cafe'), nuancer(couleur('Ilots', 'cafe'), 0.7)
    for xa, xb in ((x0, x0 + largeur - 1), (x1 - largeur + 1, x1)):
        st.rect(xa, y0 + 2, xb, y1 - 4, bois if ouv < 0.5 else joint)
        for x in range(xa, xb + 1, 4):
            st.rect(x, y0 + 2, x, y1 - 4, joint)
        st.rect(xa, y0 + 2, xb, y0 + 2, nuancer(bois, 1.2))
    if ouv < 0.3:
        st.rect(x0 + demi - 2, y0 + 18, x0 + demi + 1, y0 + 19, couleur('Ilots', 'cafe creme'))


def _rideau(st: Station, x0: int, x1: int, yf: int, ouv: float) -> None:
    """Rideau métallique de service : les lames s'enroulent dans le caisson du linteau."""
    y0, y1 = yf + HAUT_LIBRE, yf + BAS
    _embrasure(st, x0, x1, y0, y1)
    bas = y0 + round((y1 - y0) * (1 - ouv))
    for y in range(y0, bas + 1):
        st.rect(x0, y, x1, y, METAL_S if (y - y0) % 3 == 2 else METAL)
    st.rect(x0 - 1, y0 - 3, x1 + 1, y0 - 1, METAL_S)
    if bas > y0 + 2:
        st.rect(x0 + (x1 - x0) // 2 - 2, bas - 1, x0 + (x1 - x0) // 2 + 2, bas, TRAIT)


def porte(st: Station, sorte: str, x0: int, largeur: int, yf: int, ouv: float, accent: Rgb) -> None:
    """Dessine une porte de `largeur` px (multiple de 16) dans la face qui commence au rang d'écran `yf`."""
    x1 = x0 + largeur - 1
    epais = 4 if sorte == 'sas' else CADRE
    _chambranle(st, x0, x1, yf, accent, epais)
    if sorte == 'coulissante':
        _battants(st, x0, x1, yf, ouv, _vantail_metal(accent))
    elif sorte == 'vitree':
        _battants(st, x0, x1, yf, ouv, _vantail_verre)
    elif sorte == 'sas':
        _battants(st, x0, x1, yf, ouv, _vantail_sas)
    elif sorte == 'bois':
        _bois(st, x0, x1, yf, ouv)
    elif sorte == 'rideau':
        _rideau(st, x0, x1, yf, ouv)
    etat = 'question (ambre)' if 0 < ouv < 1 else 'autonome (antenne)' if ouv >= 1 else 'clawd ombre'
    voyant(st, x0 + largeur // 2, yf, couleur('Etats et persos (reserves)', etat))
    seuil = yf + BAS + 1
    st.rect(x0, seuil, x1, seuil + 1, METAL_S if sorte != 'sas' else couleur('Metal, verre, lumiere', 'danger jaune'))


def porte_verticale(st: Station, cx: int, y0: int, ouverture: int, ouv: float, accent: Rgb) -> None:
    """Porte dans un mur vertical, vue de dessus : deux montants (le montant nord montre sa face comme un chambranle,
    pas comme un bout de mur), un vantail fin qui rentre dans les montants. `ouverture` en px (multiple de 16)."""
    y1 = y0 + ouverture - 1
    st.rect(cx - 6, y0, cx + 7, y1, couleur('Sols', 'joint tech.'))
    for y in range(y0 + 1, y1, 3):
        st.rect(cx - 5, y, cx + 6, y, couleur('Sols', 'technique 2'))
    st.rect(cx - 3, y0, cx + 4, y0 + 2, METAL_S)
    st.rect(cx - 3, y1 - 2, cx + 4, y1, METAL_S)
    st.rect(cx - 3, y0, cx + 4, y0, accent)
    reste = round((ouverture - 6) * (1 - ouv) / 2)
    if reste > 0:
        st.rect(cx, y0 + 3, cx + 1, y0 + 2 + reste, METAL_C)
        st.rect(cx, y1 - 2 - reste, cx + 1, y1 - 3, METAL_C)
    st.rect(cx - 2, y0 - 1, cx + 3, y0 - 1, TRAIT)
