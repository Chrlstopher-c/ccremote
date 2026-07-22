# validation-proprietes — M-53, validation des cinq propriétés de couche 1

Mission **M-53**, la seule autorisée à déclarer le harness terminé (`Upgrade/11-missions.md`).
Périmètre : les cinq propriétés du critère de réussite de `Upgrade/03-couche-1.md` —
non-blocage, isolation, reprise, modularité, bornage.

Ces tests valident le harness **assemblé** : chaque fichier combine au moins deux modules
de production réels (jamais une doublure du composant sous test lui-même), conformément à
la contrainte de la mission. Aucune session Claude Code réelle, aucun test E2E, aucun `git
stash`/`checkout`/`reset` n'a été exécuté pour produire ces tests.

## Verdict par propriété

| Propriété | Verdict | Condition |
|---|---|---|
| Non-blocage | **Tenue** | Mécanique (`avecPlafond`), prouvée sur les 4 outils mutatifs + en parallèle. Tient tant qu'un port futur continue de passer par `avecPlafond` — un appel direct au port qui le contournerait romprait la garantie sans qu'aucun typecheck ne le voie. |
| Isolation | **Tenue sous condition** | Tenue entre projets (F.4.3) et entre worktrees distincts (fencing). **Cesse de tenir** si le superviseur PC redémarre : `RegistreWorkers` est une `Map` en mémoire (dette n°1, `TODO.md`) — voir `isolation.test.ts`, dernier bloc, qui le démontre mécaniquement. |
| Reprise | **Tenue sous condition** | Tenue sur le bus de permissions (C) assemblé au vrai `reconcilier()` (E.1.4/D.2.4). Dépend de deux `⚠ HYP` non vérifiées par banc réel : (1) que `reinitialize()` du SDK retourne effectivement les demandes en attente (dette n°3), (2) que la capacité `reinitialize` ait été enregistrée avant la coupure. Ne couvre pas la perte d'octets bruts au niveau transport (D, hors périmètre C/E). |
| Modularité | **Tenue** | Prouvée sur fs réel + git réel (`InterrogateurGitReel`), à l'unité et à la surface MCP (`lister_projets`). Ne couvre pas F2.2/F2.3 (création/modification de projet, hors v1). |
| Bornage | **Tenue partiellement — à ne pas arrondir** | Les bornes mécaniques existantes (retry watchdog, non-relance de `budget_exhausted`/structurel, plafond de tentatives) sont réelles et testées. Le mécanisme conçu pour arrêter une boucle qui ne lève ni `max_turns` ni `budget_exhausted` (H-68 : paliers + juge Haiku) **n'existe dans aucun module de production**. Le plafond de parc (G.1.3) existe mais n'est appelé par aucun site réel. |

## Ce que ces tests ne prouvent PAS

- Aucun processus Claude Code réel, aucune session SDK réelle : les cinq propriétés sont
  vérifiées sur l'assemblage des modules du **Pi** (registre, réconciliation, bus,
  fencing, projets, budgets), jamais sur un banc `acceptation/*.ts` en conditions réelles.
- Le transport D (perte d'octets, D.1.3) n'est pas dans ce périmètre — voir M-10/M-12 et
  leurs propres bancs.
- La qualité du jugement du lead (H-40, H-41) et la trace d'audit (C.5) ne sont pas
  revalidées ici — voir `control-plane/audit-permissions/` et `acceptation/audit-permissions-reel.ts`.
- Aucune de ces cinq propriétés n'a été exercée sur une nuit complète d'exécution non
  surveillée (question 2 de `15-grille-revue.md`, jamais faite à ce jour).

## Lancer

```bash
cd /mnt/projects/ccremote/harness
bun test validation-proprietes
bun run typecheck
```
