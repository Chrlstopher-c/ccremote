"""Responsabilité : réaligner une variante de pièce rendue par le modèle (qui recadre souvent légèrement : zoom et
décalage) sur la pièce de référence, pour que chaises, portes et murs tombent exactement aux mêmes coordonnées.
Points caractéristiques (ORB) appariés, transformation similitude estimée (échelle + translation, sans rotation), puis
la variante est rééchantillonnée dans le cadrage de la référence. Aucun redessin : seulement un recadrage.
Usage : python aligner.py <reference.png> <variante.png> <sortie.png>
"""
from __future__ import annotations

import sys

import cv2
import numpy as np


def aligner(ref_chemin: str, var_chemin: str, sortie: str) -> float:
    ref = cv2.imread(ref_chemin)
    var = cv2.imread(var_chemin)
    orb = cv2.ORB_create(6000)
    kr, dr = orb.detectAndCompute(cv2.cvtColor(ref, cv2.COLOR_BGR2GRAY), None)
    kv, dv = orb.detectAndCompute(cv2.cvtColor(var, cv2.COLOR_BGR2GRAY), None)
    paires = sorted(cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True).match(dv, dr), key=lambda m: m.distance)[:800]
    src = np.float32([kv[m.queryIdx].pt for m in paires])
    dst = np.float32([kr[m.trainIdx].pt for m in paires])
    m, inliers = cv2.estimateAffinePartial2D(src, dst, method=cv2.RANSAC, ransacReprojThreshold=3.0)
    alignee = cv2.warpAffine(var, m, (ref.shape[1], ref.shape[0]), flags=cv2.INTER_LANCZOS4,
                             borderMode=cv2.BORDER_REPLICATE)
    cv2.imwrite(sortie, alignee)
    echelle = float(np.hypot(m[0, 0], m[1, 0]))
    print(f'{var_chemin} : échelle {echelle:.3f}, décalage ({m[0, 2]:.0f}, {m[1, 2]:.0f}), '
          f'{int(inliers.sum())}/{len(paires)} points concordants')
    return echelle


if __name__ == '__main__':
    aligner(sys.argv[1], sys.argv[2], sys.argv[3])
