# Plan d'exécution — Axe B (teams persistantes)

État : **décisions arrêtées avec Chris le 2026-09-03, prêt à implémenter.** S'appuie sur la
conception produite en amont + les tranches de Chris. Les axes A1/A2/C/A3 sont déjà committés sur
`optim-quotas`.

## Décisions arrêtées (ne pas rouvrir sans Chris)

| # | Sujet | Décision |
|---|---|---|
| D4 | Autorisation quand des features s'empilent sur une team | **Enchaînement sous fenêtre d'autonomie existante** : si une fenêtre d'autonomie est active, la team dépile sa file seule ; sinon chaque feature attend le clic humain (H-61). Réutiliser le mécanisme d'autonomie existant, ne pas en inventer. |
| Rebut | Teams dormantes qui accumulent du disque | **TTL 7 jours d'inactivité → démantèlement auto** (worktree libéré) **+ commande explicite `dissoudre_team`**. |
| D2 | Reprise du contexte au réveil | **Résumé texte structuré** (état/décisions/reste), sauvé à la compaction, réinjecté au réveil. Pas de reprise SDK d'une session dormante (non garantie dans le temps). |
| D1 | Granularité de l'epoch | **Niveau projet** (conservateur) — `prochainEpoch` inchangé, pas de refonte du fencing. Le worktree ≠ worktree garantit déjà qu'aucune team ne partage un worktree. |
| D3 | Qui assigne le domaine d'une feature | **L'orchestrateur (LLM) le choisit à la proposition, validé contre une liste fermée** `ConfigProjet.domainesEquipe` (≤ 3), refus avant écriture si hors liste — même discipline que les modèles (A1). |
| Budget | Rappel A1/finition | **50 $ par ACTIVATION**, jamais un cumul sur la vie d'une team. Chaque réveil = nouvelle session worker = budget frais. Ne créer aucun compteur de budget cumulé par team. |

## Design retenu

### Entité `team` (registre SQLite, Pi)
Nouvelle table `team(id, projet, domaine, worktree, branche, compte_id, etat[dormante|active|demantelee],
resume_contexte, resume_maj_a, derniere_mission_id, cree_a, active_derniere_fois_a)`, index unique
`(projet, domaine)` where `etat != 'demantelee'` → **jamais plus de 3 teams vivantes/projet** (domaine ∈
liste fermée). Colonne `mission.team_id` : chaque mission devient une **activation** d'une team.
`ConfigProjet` gagne `domainesEquipe: readonly string[]` (≤ 3).

### B1 — cycle de vie (fichiers : `dispatch-mandat.ts`, `superviseur/worktree-wiring-workers.ts`, `projets/cycle-vie-worktree.ts`, `superviseur/superviseur-workers.ts`, `control-plane/registre/migrations.ts`)
- `dispatcherMandat` gagne une étape amont `resoudreTeamPourFeature(projet, domaine)` : dormante → **réveil**
  (réutilise id/worktree/branche, `etat=active`) ; active → cas file (B2) ; inexistante → **création**.
- Le worktree n'est **plus libéré** en fin de mission normale — seulement au démantèlement de team.
  `worktree-wiring-workers.ts` distingue « fin de mission, team vivante → conserver » de « fin de team →
  libérer ». La revendication du worktree passe de la clé `missionId` à la clé `teamId` (sinon collision
  `WorktreeDejaRevendiquee` au réveil).
- Réveil = **pas de re-exploration** : `composerPromptReveil(p, team)` injecte `team.resume_contexte` au lieu
  du prompt initial générique. Nouveau worker + nouveau `sessionId` + ancien worktree (pas de resume SDK).
- **TTL + dissolution** : une passe (ou une garde à la résolution) démantèle une team `dormante` inactive
  depuis 7 j (libère le worktree, `etat=demantelee`) ; commande MCP `dissoudre_team` pour le faire à la main.
- Fencing epoch : **niveau projet, inchangé** (D1).

### B2 — file de features (fichiers : `mcp-controle/outils-cycle-vie.ts`, `dispatch-mandat.ts`, `superviseur-workers.ts`)
- Table `feature_queue(id, projet, domaine, objectif, proposition_id, etat[en_attente|assignee|en_cours|terminee|annulee], team_id, cree_a, prise_en_charge_a)`.
- `domaine` validé à la proposition (`proposerCreationEquipe`) contre `ConfigProjet.domainesEquipe`, refus
  actionnable sinon (D3).
- Team ciblée déjà `active` → la proposition **entre en file** au lieu d'échouer. À la fin réelle de
  l'activation (constatée par `#surveillerResultats`), reprise de la file : **automatique sous fenêtre
  d'autonomie** (D4), sinon attend un clic. Le dépilage passe par le **même chemin `dispatcherMandat`**.
- Plafond de parallélisme : compter les **teams actives** (≤ 3/projet), pas les missions. Garder
  `ErreurPlafondEquipesProjetAtteint` en défense (ne devrait plus se déclencher en régime nominal).

### B3 — compaction préservant l'état (fichiers : `discipline-contexte/sentinelle-contexte.ts` + nouveau `discipline-contexte/resumeur-compaction.ts`, canal de remontée PC→Pi)
- Hook `PreCompact` **actif** (aujourd'hui seulement observé) : produit un résumé structuré (mêmes rubriques
  que `BLOC_RAPPORT` — critère d'arrêt / changements fichier par fichier / vérifications / reste ouvert),
  **avant** la troncature native.
- Écriture dans `team.resume_contexte` (append borné, garder N derniers) via le canal transportable PC→Pi
  existant (jamais un import direct control-plane ↔ superviseur). Réinjecté par `composerPromptReveil` (B1).
- Se combine avec A2 (compaction plus fréquente) : c'est B3 qui rend ces compactions **non destructives**.

## Risques à garder en tête (de la conception)
- Résumé B3 auto-déclaré par le worker = même risque que `BLOC_RAPPORT` (peut mentir) — mais ici il devient
  une **entrée** du tour suivant, plus grave. Garder le format opposable.
- `domaine` fourni par un LLM = entrée non fiable → validation dure obligatoire (D3).
- Frontière A↔B : `team`/`feature_queue` vivent sur le **Pi** (registre), le hook `PreCompact` se déclenche
  côté **worker/PC** et remonte par le canal transportable. Le worktree est une ressource **PC**.

## Ordre d'implémentation
1. **Lot B-a** : migration registre (`team`, `feature_queue`, `mission.team_id`, `ConfigProjet.domainesEquipe`)
   + B1 cycle de vie (avec résumé encore statique/absent) + TTL/`dissoudre_team`. Testable seul.
2. **Lot B-b** : B2 file + B3 compaction préservant l'état (branche le vrai résumé dans `composerPromptReveil`).

Validation à chaque lot : `tsc` + tests unitaires opposables (au parent), jamais sur récit. E2E réel = parent.
