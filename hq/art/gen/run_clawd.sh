#!/bin/bash
# Vidéos de marche de Clawd (MiniMax H3, fond vert) pour ses planches d'animation. Argument : front | dos | profil.
G=$(dirname "$(readlink -f "$0")")
vue=$1
case $vue in
  front) ref=front; sens="seen exactly from the front, facing the camera, walking toward the camera but staying in place";;
  dos) ref=dos; sens="seen exactly from behind, back to the camera, walking away but staying in place";;
  profil) ref=front; sens="turned to the right, seen exactly from the side in profile, walking to the right but staying in place";;
esac
cd /mnt/projects/minimax-h3-studio
.venv/bin/python scripts/tester.py workflows/api_video_reference.json --image "$G/ref-clawd-$ref.png" --mp 0.4 \
  --secondes 3 --seed 7 --prompt "Create a clean 2D pixel-art animation video with flat colors, like a high quality video game sprite animation.
The small orange cube robot from <Picture 1> walks in place, $sens, with a cute bouncy walking cycle: its two little legs stepping one after the other, its two small arms swinging, slight up and down bounce of the cube body.
Keep exactly its look from <Picture 1>: orange cube body with soft shading, two black square eyes, two small arms, two short legs, same proportions, same pixel-art style.
The camera is perfectly static, the robot stays in the center of the frame and never leaves it, full body always visible.
The background stays a perfectly plain flat pure green color for the whole video, no floor, no shadow, no scenery, no text." 2>&1 | grep -E 'Sortie|rreur' | tail -1
