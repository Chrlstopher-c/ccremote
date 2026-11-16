#!/bin/bash
# Variantes de la pièce meublée par catégorie (Qwen-Image-Edit local, ComfyUI :8189), à partir de la pièce validée.
# Même cadrage, mêmes murs, mêmes places (deux postes avec chaise vide, coin café) : seule l'ambiance change.
G=$(dirname "$(readlink -f "$0")")
cd "$G"
BASE="station/meublee-finale.png"
GARDE="Keep exactly the same room layout, camera, walls, portholes, door, airlock, corridor, coffee corner, lighting and the two desks with their EMPTY orange chairs at the same places. No characters, no robots, no text on the wall. Only change the decoration of the office to make it a"
gen() { ../.venv/bin/python editer.py "$BASE" station "piece-$1" "$GARDE $2" --taille 1664 928 --graine "$3"; }
gen clients "client agency office: framed client logos on the wall instead of the whiteboard, cardboard shipping boxes stacked near the bookshelf, a small potted tree, warm desk lamps." 61
gen agents "AI agents control room: extra monitors with blue code on the wall, cables along the floor, a small robot charging dock next to the server rack, cool blue lighting accents." 62
gen labos "research lab: a glass lab bench with glowing vials replacing the bookshelf, holographic display above the whiteboard, teal lighting accents." 63
gen apps "software studio: wall-mounted kanban board with colorful sticky notes, a beanbag, an extra standing desk with a laptop, soft violet lighting accents." 64
gen jeux "game studio: arcade cabinet in the corner, game posters on the wall, a gaming controller and figurines on the desks, purple neon lighting accents." 65
