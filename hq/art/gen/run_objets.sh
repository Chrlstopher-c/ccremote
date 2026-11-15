#!/bin/bash
# Objets isolés façon Stardew pour le monde d'Agent HQ (fond uni, découpés ensuite). Argument : graine.
G=$(dirname "$(readlink -f "$0")")
seed=${1:-1}
cd /mnt/projects/minimax-h3-studio
while IFS=$'\t' read -r nom desc; do
  P="Stardew Valley style pixel art game asset, $desc, isolated object centered on a plain flat pure white background, nothing else in the image, no floor, no shadow on the background, no text, crisp clean pixels, warm muted palette, 16-bit RPG sprite."
  python3 -I "$G/t2i.py" "$G/wfo-$nom-$seed.json" "objet-$nom-$seed" 1024 1024
  .venv/bin/python scripts/tester.py "$G/wfo-$nom-$seed.json" --prompt "$P" --seed "$seed" 2>&1 | grep -E 'Sortie|rreur' | tail -1
done < "$G/objets.tsv"
