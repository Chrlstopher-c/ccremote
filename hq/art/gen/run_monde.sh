#!/bin/bash
# Bâtiment d'Agent HQ vu en plongée trois-quarts façon Stardew/Smallville, sans personnage. Arguments : LxH:graine...
G=$(dirname "$(readlink -f "$0")")
PROMPT="Stardew Valley style pixel art, top-down three-quarter view of the inside of a cozy tech company building with the roof removed, like a Sims house cross-section seen from above. The building fills the whole image. In the center a meeting room with a large round wooden table and many chairs. Around it, six small separate offices divided by walls with open doorways, each office has one wooden desk against its back wall with a glowing computer monitor, an office chair, a small plant, a little whiteboard covered with sticky notes. One room is a library with tall bookshelves. One room is a server room with blinking server racks and an old CRT terminal. Wooden plank floors, light walls, a corridor with rugs linking the rooms, a coffee corner with an espresso machine. No people, no characters, no text, crisp clean pixels, warm muted palette, consistent 16-bit tiles."
cd /mnt/projects/minimax-h3-studio
for job in "$@"; do
  size=${job%%:*}; seed=${job##*:}; w=${size%x*}; h=${size#*x}
  python3 -I "$G/t2i.py" "$G/wfm-$size-$seed.json" "hq-monde-$size-$seed" "$w" "$h"
  .venv/bin/python scripts/tester.py "$G/wfm-$size-$seed.json" --prompt "$PROMPT" --seed "$seed" 2>&1 | grep -E 'Sortie|rreur' | tail -1
done
