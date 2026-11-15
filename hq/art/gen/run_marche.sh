#!/bin/bash
# Vidéos de marche du perso de Chris (MiniMax H3, fond vert) pour les planches du jeu. Argument : front | dos.
G=$(dirname "$(readlink -f "$0")")
vue=$1
case $vue in
  front) sens="seen exactly from the front, facing the camera, walking toward the camera but staying in place";;
  dos) sens="seen exactly from behind, back to the camera, walking away but staying in place";;
esac
cd /mnt/projects/minimax-h3-studio
.venv/bin/python scripts/tester.py workflows/api_video_reference.json --image "$G/ref-marche-$vue.png" --mp 0.4 \
  --secondes 3 --seed 7 --prompt "Create a clean 2D illustrated animation video with flat colors, like a high quality video game character animation.
The character from <Picture 1> walks in place, $sens, with a smooth natural walking cycle: legs stepping one after the other, arms swinging gently, slight up and down bounce.
Keep exactly his look from <Picture 1>: black hoodie with the hood up over a black cap, glasses, short beard, orange logo on the chest, black cargo pants, black shoes, same proportions.
The camera is perfectly static, the character stays in the center of the frame and never leaves it, full body always visible from head to feet.
The background stays a perfectly plain flat pure green color for the whole video, no floor, no shadow, no scenery, no text." 2>&1 | grep -E 'Sortie|rreur' | tail -1
