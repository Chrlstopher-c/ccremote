# Prompts ChatGPT — direction artistique de la station

Joindre à chaque conversation les deux références : `ref-clawd.png` (la mascotte) et `ref-chris.png` (le perso de
Chris). Envoyer d'abord le bloc STYLE, puis les prompts un par un dans la même conversation (le style reste en
mémoire). Garder l'image qui plaît et itérer avec des retouches courtes (« same image, but… »).

## STYLE (à coller en premier)

```
You are the art director of a cozy 2D pixel-art management game. Every image you make for me must follow this style bible exactly:

- Camera: top-down 3/4 view, exactly like The Escapists 2 and Stardew Valley interiors. We see mostly the TOP of floors and objects plus a short front face. NOT isometric, NOT side view, no vanishing perspective. One single camera angle for everything.
- Walls: thin light top edge + a tall front face that is about 1.2× the height of a human character (real scale, not 10 cm walls). Furniture always stands on the floor in front of walls and never overlaps the top of a wall.
- Pixels: crisp pixel art on a 16 px tile grid, one pixel size for everything, no blur, no painterly shading, no gradients except soft drop shadows.
- Light: from top-left; soft drop shadows to the bottom-right; warm lamps and cool screens; portholes show deep space with stars.
- World: a cozy, lived-in, retro-futuristic SPACE STATION used as an office. Light grey/white hull panels, beige interior panels, dark technical floors with rivets, amber lamps, blue screens, small details everywhere (cables, mugs, plants, posters, stickers, trash bins).
- Palette: deep space #070912, nebula #2a1f45, hull panels #d9dde2, interior panels #e2dccb, wall top #c3c8d0, wainscot #4a5262, technical floor #5d6573, metal #9aa3b0, screens #78d2fa, warm lamps #ffe2b0, danger yellow #f2c94c. Ring accent colors: clients blue #4a8fd9, tools green #4fb08a, local-AI teal #3fd0c0, desktop apps grey-violet #8f8fb8, games purple #a070d8, central room cyan #5fe0ff.
- Characters: the workers are "Clawd", a small orange blocky crab-like mascot (#d97757, see attached reference: square body, two black eyes, little arms, four legs). The player is a young man in a black hoodie and black cargo pants with glasses (see attached reference). Characters are about 1.5 tiles (Clawd) and 2.2 tiles (human) tall.
- Mood: The Escapists 2 density and charm, FTL / Space Haven space-station logic, cozy and readable. Never cluttered to the point of being unreadable.
Reply only "OK" and wait for my image requests.
```

## 1 — Vue d'ensemble de la station

```
Image 1: full overview of the station, seen from above in the same 3/4 pixel-art style, floating in deep space with a faint nebula.
Layout: an octagonal command room in the center (round table, screens on its walls), surrounded by 3 complete concentric OCTAGONAL rings separated by a thin gap of empty space. Each ring is a full loop (never cut by a cross of corridors). Rings are connected only by a few short glass airlock tubes placed IRREGULARLY (not symmetric, not aligned, some with a small bend).
Each ring has a walkway on its inner side and project compartments on its outer side; each ring has its own accent color (inner ring blue, middle ring green, outer ring purple), shown on floor stripes and door frames.
Between compartments, some non-project islands placed irregularly: a small café, a smoking corner with a porthole, a cleaning closet, a server room, a greenhouse module, tanks and antennas on the outer hull.
Tiny Clawd workers visible in some compartments, warm lights inside, portholes on the outer walls.
Wide 16:9 image. Readable at a glance, asymmetric, alive.
```

## 2 — La salle centrale (commandement)

```
Image 2: the central command room, closer game view (about 20×12 tiles visible).
An octagonal room with a big round wooden-and-metal table in the middle (8 seats). On every wall, a large screen showing simple readable dashboards: a list of red/amber alerts ("waiting for you"), agents at work, machine status (4 small server icons), energy gauges like fuel tanks, a night mode screen with a moon.
The player character stands at a console, calling agents: two Clawd mascots are walking in from a glass airlock door to sit at the table, speech bubbles above them.
Floor: dark technical tiles with a cyan ring inlaid around the table. Cyan accent lighting #5fe0ff, warm lamps, a plant, cables on the floor, coffee mugs on the table.
Same 3/4 pixel-art style, real wall height, furniture never overlaps the top of walls.
```

## 3 — Un compartiment de projet (vue de jeu)

```
Image 3: one project compartment of the BLUE "clients" ring, game view (about 18×10 tiles).
Back wall: tall beige panel wall with a portholes showing stars, a project sign on the door ("StockIOP"), a whiteboard with sticky notes and a progress list.
Inside: 3 desks against the back wall with monitors, two Clawd agents seated typing (back view), one Clawd standing next to his desk with a red "?" speech bubble (he is waiting for the player). A console terminal near the door, a small bookshelf with glowing new documents on the side wall, a server rack terminal on the other side wall, 2 cryo-sleep capsules for sleeping agents (one occupied, frosted glass), a trash bin, a plant, cables.
The door at the bottom opens on the ring walkway with blue floor stripes.
On the outer wall, a docked pod connected by a short tube.
Same 3/4 pixel-art style, real wall height, objects never overlap the top of walls, soft drop shadows to bottom-right.
```

## 4 — Les sous-agents (nacelle de l'orchestrateur)

```
Image 4: close view of a sub-agent pod docked outside a project compartment.
Inside the main compartment, an "orchestrator" Clawd wearing a small headset stands at a big console showing "12 · 7 ✓ · 1 ✗".
Through a short glass tube, a pod full of tiny mini-Clawds (half size, slightly lighter orange) working at small benches: some typing, some carrying boxes, one with a red ✗ sign, several with green ✓ checkmarks going back to the orchestrator. A rack on the wall with a row of small LEDs (one per sub-agent, green/amber/red) labeled "+5".
Thin glowing cyan lines link the orchestrator to the active mini-Clawds.
Same 3/4 pixel-art style and palette.
```

## 5 — Vie de la station : café, coin fumeur, ménage

```
Image 5: a corner of a ring with life, game view (about 18×10 tiles).
A small café island: coffee machine, a counter, stools, a Clawd drinking from a mug. Next to it a smoking corner in front of a big porthole with stars: a bench, a standing ashtray, ashes on the floor, a Clawd smoking a tiny cigarette with a little smoke curl.
A cleaning closet with its door open: brooms, a mop bucket, a cleaning cart. One idle Clawd sweeping the floor, a full trash bin with papers, a coffee cup left on the floor.
The ring walkway passes in front with green accent floor stripes; a glass airlock tube leaves at an angle toward the next ring.
Same 3/4 pixel-art style, cozy, lived-in, readable.
```

## 6 — Planche de murs et de portes (pour le jeu)

```
Image 6: a clean asset sheet on a plain dark background #0b0e1c, organized in a grid with small labels, same 3/4 pixel-art style and the same scale as the human character (show the human reference standing next to the walls for scale).
Row 1 — walls: straight back wall (top edge + tall face), wall seen from the side (top edge only), outer corner, inner corner, T junction, a 45° diagonal wall for the octagon, wall with porthole, wall with screen.
Row 2 — doors, each closed and open: wooden hinged door (project rooms), sliding metal door with a status light (server room), double glass door (command room), round airlock hatch with yellow-black hazard frame (between rings), open archway (café).
Row 3 — floors as seamless tiles: technical floor with rivets, beige resin floor, blue carpet, bamboo deck (café), metal grating.
Pixel-perfect, no blur, consistent lighting from top-left.
```

## 7 — Planche des personnages et de leurs états

```
Image 7: character sheet on plain dark background #0b0e1c, same pixel-art style, using the attached Clawd reference.
Show Clawd in these states, each labeled: working (seated, back view, typing), waiting for the player (standing, red "?" bubble), finished (amber "✓" bubble, stretching), error (orange "!" bubble, smoke from keyboard), autonomous mode (small cyan antenna + "AUTO" badge), night mode (moon badge), on break with coffee, smoking, sweeping with a broom, asleep in a cryo capsule (frosted glass), walking in 4 directions.
Sub-agents: mini-Clawds at half size, lighter orange, three model variants marked by a tiny hat or badge color: Haiku yellow #f2c94c, Sonnet blue #6fb3e0, Opus purple #b58ce0.
Also the player character (attached reference) walking in 4 directions and sweeping.
Speech bubble styles: white rounded pixel bubble #eef0f6 with dark border #262a36.
```
