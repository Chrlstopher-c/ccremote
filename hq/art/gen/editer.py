"""Responsabilité : retoucher une image de référence de la station avec Qwen-Image-Edit en local (ComfyUI :8189), en
gardant exactement son style : vider une pièce, isoler un objet, décliner une salle. Réutilise le client ComfyUI et le
workflow d'édition du studio Kiroshi. Usage : editer.py <image> <sortie_dossier> "<consigne>" [--graine N] [--taille W H]
"""
from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

KIROSHI = Path.home() / 'projects/kiroshi'
sys.path.insert(0, str(KIROSHI / 'pipeline'))
from comfy.client import load_workflow, prune_node, run_workflow, upload_image  # noqa: E402

WORKFLOW = KIROSHI / 'pipeline/ai_image/workflows/qwen_edit_ref.json'
GARDE = ('Keep this pixel-art game screenshot exactly identical in style: same camera angle, same pixel size, same '
         'colors, same lighting, same wall and floor design. Only change: ')


def editer(image: Path, consigne: str, sortie: Path, graine: int, taille: tuple[int, int], nom: str) -> Path:
    wf = load_workflow(WORKFLOW)
    wf['6']['inputs']['image'] = upload_image(image)
    prune_node(wf, '7')
    prune_node(wf, '8')
    wf['9']['inputs']['prompt'] = GARDE + consigne
    wf['11']['inputs'].update({'width': taille[0], 'height': taille[1]})
    wf['12']['inputs']['seed'] = graine
    wf['14']['inputs']['filename_prefix'] = f'agent-hq/{nom}'
    png = next(p for p in run_workflow(wf, sortie) if p.suffix == '.png')
    final = sortie / f'{nom}-{graine}.png'
    shutil.move(png, final)
    return final


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument('image', type=Path)
    p.add_argument('sortie', type=Path)
    p.add_argument('nom')
    p.add_argument('consigne')
    p.add_argument('--graine', type=int, default=7)
    p.add_argument('--taille', type=int, nargs=2, default=(1344, 768))
    a = p.parse_args()
    a.sortie.mkdir(parents=True, exist_ok=True)
    print(editer(a.image, a.consigne, a.sortie, a.graine, tuple(a.taille), a.nom))


if __name__ == '__main__':
    main()
