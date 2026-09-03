# Prompt de lancement — implémentation du plan d'optimisation ccremote

À coller dans une **nouvelle session Claude Code**, ouverte dans `/mnt/projects/ccremote`.

---

Tu ouvres une session dédiée à l'implémentation du plan d'optimisation de ccremote. Ne code rien
avant d'avoir lu et confirmé le cadre.

**Lis d'abord** : `PLAN-OPTIMISATION-QUOTAS.md`, `AUDIT-ORCHESTRATION.md`, `AUDIT-QUOTAS-QUALITE.md`.

**Objectif** : réduire la consommation de quotas et le rate-limit, améliorer la qualité — sans
toucher à la délégation/rotation de comptes (décision ferme, hors scope).

**Hiérarchie des modèles à imposer en VERROUS DURS** (aujourd'hui suggérée au LLM et héritée) :
- master orchestrateur = modèle **choisi par l'utilisateur** (non verrouillé) ;
- lead de team = `claude-opus-4-8` effort **high**, verrouillé, garde ses outils d'édition pour
  **corriger lui-même** un exécuteur raté (filet, pas mode normal) ;
- sous-agents exécuteurs = `claude-sonnet-5` effort **high**, verrouillé, sans héritage du lead.
- **Prérequis à vérifier en premier** : `claude-opus-4-8` présent au catalogue
  `shared/modeles-claude.ts` (+ validation) et effort `high` réglable par modèle.

**Ordre** : A1 (hiérarchie modèles + refonte prompts/skills/tools) → A2 (autocompact) + C
(watchdog borné, échec propre sur compte saturé) → A3 (prompt caching sur systemPrompt) → B
(3 teams persistantes + ordre de features + compaction préservant l'état) → D (qualité des
handoffs — **à trancher au démarrage : dans le scope ou reporté**).

**Méthode** :
- Les axes se recoupent sur les mêmes fichiers (`dispatch-mandat.ts`, `mandat.ts`,
  `options-*.ts`) → **traite-les en séquence**, un agent délégué par axe l'un après l'autre.
  Pas de worktrees parallèles ici (ils se disputeraient ces fichiers).
- Tu orchestres et tu intègres ; chaque axe va à un agent à contexte borné avec brief ciblé.
- **Valide chaque changement sur artefact réel** (tokens/conso avant-après, comportement observé),
  jamais sur un récit d'agent. La baisse de conso doit être mesurée, pas affirmée.
- Ne touche pas aux comptes. Conséquence connue : le rate-limit précoce dû à la concentration
  sur un compte subsistera — c'est attendu, ce n'est pas un échec du chantier.

**Premier pas** : lis les 3 docs, confirme le prérequis `claude-opus-4-8`, tranche l'axe D, puis
propose-moi le découpage en agents **avant** d'exécuter.
