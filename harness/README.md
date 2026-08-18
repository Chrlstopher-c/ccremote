# ccremote — harness d'orchestration

Gestionnaire de sessions Claude Code distantes avec un canal d'approbation humaine asynchrone
(`Upgrade/03-couche-1.md`). Deux process distincts, deux machines :

- **Pi — control plane** : autorité unique (registre, notifications, autonomie, projets,
  garde-fous, session orchestrateur maître — celle avec qui Chris discute depuis l'app).
- **PC — plan d'exécution** : superviseur de workers (spawn/vie/mort des sessions Claude Code),
  ne décide rien, exécute des ordres du Pi et rapporte des faits.

## Stack

- Runtime : **Bun** (jamais npm/node directement).
- TypeScript strict, `noUncheckedIndexedAccess`, zéro `any`.
- `@anthropic-ai/claude-agent-sdk` épinglé à `0.3.217` — ne pas mettre à jour sans revérifier
  `Upgrade/01-verification-sdk.md`.
- SQLite (`bun:sqlite`) pour le registre du Pi, le miroir de sessions, et la persistance du
  registre de workers du PC — trois bases distinctes, aucune connexion partagée entre process.
- Logging : `pino` + `pino-pretty` hors production.
- Transport D.1 (données) et D.3 (contrôle) : WebSocket natif Bun, sans dépendance ajoutée.

## Lancement manuel

```bash
bun install
cp .env.example .env   # renseigner les chemins et adresses réels, voir ci-dessous
```

**Ordre de démarrage : le PC d'abord, le Pi ensuite** — le Pi se connecte au canal de contrôle du
PC au démarrage de sa réconciliation.

```bash
# Sur le PC (poste de travail avec Claude Code installé) :
bun run start:pc     # composition/pc/bin-pc.ts

# Sur le Pi (control plane) :
bun run start:pi      # composition/pi/bin-pi.ts
```

Vérifications avant tout lancement réel :

```bash
bun run typecheck     # doit être silencieux
bun test              # doit être vert (chiffre non retenu ici : évolue à chaque mission, voir REPRISE.md)
```

## Ports / réseau

| Canal | Sens | Protocole | Variable |
|---|---|---|---|
| D.3 — contrôle | Pi → PC (jamais l'inverse) | WebSocket JSON | `CCREMOTE_PC_CONTROLE_HOST`/`PORT` |
| D.1 — données | par worker, bidirectionnel | WebSocket, trames binaires | non composé par cette mission (voir ARCHITECTURE.md) |

Aucun port HTTP/UI n'est exposé par ce dépôt : l'app cliente (téléphone) et son backend sont hors
périmètre du harness lui-même (`03-couche-1.md`).

## Scripts

| Script | Rôle |
|---|---|
| `bun run typecheck` | `tsc --noEmit` |
| `bun test` | suite complète (unitaires + assemblage) |
| `bun run start:pc` | démarre le process PC (superviseur de workers) |
| `bun run start:pi` | démarre le process Pi (control plane + orchestrateur) |

Pas de `start.sh`/`stop.sh`/`restart.sh` dans `harness/` : les scripts Bun ci-dessus suffisent pour
deux process qui, en développement, se lancent et s'arrêtent chacun par `Ctrl-C` (`SIGINT`/`SIGTERM`
gérés par les deux `bin-*.ts`). Les scripts shell à la racine du dépôt (`/mnt/projects/ccremote/`)
gèrent l'app cliente — hors zone de cette mission, non touchés.

## Ce que ce dépôt n'est pas encore

Voir `REPRISE.md` (dans ce dossier, `harness/REPRISE.md`) pour l'état détaillé et `TODO.md`
(racine du dépôt) pour le registre des dettes. Résumé le plus important, toujours vrai : **le
canal D.1 par worker (transport des données d'une session) n'a pas de client composé depuis le
Pi** — un client D.1 par mission active reste un sous-système à part entière, non construit.
