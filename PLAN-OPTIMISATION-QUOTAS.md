# Plan d'optimisation ccremote — quotas, rate-limit, qualité

État : **proposé, non validé, rien implémenté.** Base sur les rapports `AUDIT-ORCHESTRATION.md`
et `AUDIT-QUOTAS-QUALITE.md` (2026-09-03). Chaque item cible une cause racine identifiée.

**Décision Chris (2026-09-03) : on ne touche PAS à la délégation de comptes** (pas de « 1 compte
par team », pas de refonte de la rotation). Conséquence assumée, écrite noir sur blanc : la
**cause 2** (concentration sur un seul compte) reste en place. Ce plan **réduit la consommation**
(on tape le plafond plus tard) mais **n'élimine pas le rate-limit précoce** dû à la concentration.
On baisse la pression, on ne supprime pas la source côté comptes.

---

## Axe A — Réduire la consommation (causes 1 et 3)

### A1. Hiérarchie des modèles — 3 niveaux, verrous durs (décision Chris 2026-09-03)
- **Master orchestrateur** : modèle **choisi par l'utilisateur**, non verrouillé, configurable.
  Où : `MODELE_ORCHESTRATEUR` (`options-orchestrateur.ts`) → devient un paramètre user.
- **Lead de team** (orchestrateur de la team) : **verrouillé `claude-opus-4-8`, effort high**.
  C'est le cerveau de la team : découpe, coordonne, ET **corrige lui-même** le travail d'un
  exécuteur raté (garde Write/Edit + la latitude de reprendre). Où : `MODELE_LEAD_DEFAUT`
  (`dispatch-mandat.ts` l.128) → verrou opus-4-8 (aujourd'hui `claude-opus-5`).
- **Sous-agents exécuteurs** : **verrouillés `claude-sonnet-5`, effort high**, non contournable
  (supprimer l'héritage du modèle du lead). Où : `BLOC_DIMENSIONNEMENT` / dispatch des `Task`.
- **Verrous durs, pas consignes** : aujourd'hui le modèle est suggéré au LLM et hérité (entrée
  non fiable) — le remplacer par une valeur imposée côté dispatch, non overridable.
- **Prérequis** : vérifier que `claude-opus-4-8` est au catalogue `shared/modeles-claude.ts`
  (+ validation), et que l'effort `high` est réglable par modèle.
- **Pourquoi** : cause 3 — Opus hérité partout (6,40 $/équipe vs 0,67 $ Sonnet). Ici Opus reste
  là où il pense (lead), Sonnet fait l'exécution, l'user pilote le master.
- **Impact/effort** : fort / moyen. **À faire en premier.**

### A1b. Refonte prompts / skills / tools (chantier associé à A1)
- **Leads** : prompt intégrant le rôle correctif — reprendre/corriger un exécuteur raté plutôt
  que re-dispatcher en boucle ; confirmer qu'ils ont les outils d'édition pour le faire.
- **Exécuteurs** : briefs ciblés (périmètre + contexte pré-digéré) pour minimiser les ratés.
- **Garde-fou** : si le lead corrige *souvent*, c'est le signe d'un mauvais brief/découpage, pas
  une fatalité. La correction par le lead est un **filet**, pas le mode normal — sinon on paie de
  l'Opus pour rattraper du Sonnet en boucle, et le gain de A1 s'évapore.

### A2. Activer l'autocompact orchestrateur + workers
- **Où** : `mandat.ts` l.282-287 (`compacter_mon_contexte` jamais auto),
  `harness/control-plane/orchestrateur/gestionnaire-conversations.ts`.
- **Quoi** : déclencher la compaction automatiquement à un seuil (tokens ou tours), au lieu de
  jamais. Plafonner le coût par tour côté orchestrateur.
- **Pourquoi** : cause 1 — transcript rejoué en entier à chaque tour, sans plafond.

### A3. Prompt caching sur le contexte stable
- **Où** : `dispatch-mandat.ts::composerMandatSysteme` (le systemPrompt).
- **Quoi** : mettre tout le contexte stable (mandat, contexte projet) dans un `systemPrompt`
  cacheable, pour que les tours rapprochés touchent le cache. Attention TTL (5 min / 1 h) :
  gain réel sur tours rapprochés, nul sur team dormante.
- **Pourquoi** : cause 1 — coût des tokens stables rejoués.

---

## Axe B — Amortir le contexte : teams persistantes (idée Chris)

### B1. Max 3 teams PERSISTANTES par projet, réutilisées
- **Où** : cycle de vie dans `dispatch-mandat.ts::dispatcherMandat` +
  `superviseur/superviseur-workers.ts`.
- **Quoi** : passer de teams jetables (recréées par mission) à **3 teams gardées**, réutilisées
  d'une feature à l'autre. Elles conservent leur contexte compacté → pas de re-exploration.
- **Pourquoi** : coupe le re-audit à chaque mission + borne le parc. Se combine avec A2 (sans
  compaction, une team persistante voit son contexte exploser — cf. cause 1).

### B2. Ordre de features — file assignée aux 3 teams
- **Quoi** : une file de features ; l'orchestrateur assigne chaque feature à l'une des 3 teams
  selon le domaine ; la team traite, compacte, garde l'état pour la feature suivante du même
  domaine. Une team = un domaine stable dans le temps.

### B3. Compaction qui préserve l'état (atténue cause 4)
- **Quoi** : la compaction garde décisions + état de la feature, elle ne tronque pas au dernier
  bloc. Un résumé opposable, pas un dump coupé.
- **Pourquoi** : la compaction agressive est déjà une cause de la qualité moindre (cause 4).
  Compacter le bruit, préserver le signal.

---

## Axe C — Stopper l'amplification (cause 5)

### C1. Borner le retry watchdog
- **Où** : `garde-retry-watchdog.ts` l.6-10.
- **Quoi** : max N tentatives + backoff, au lieu d'une relance infinie sur saturation (seule
  borne actuelle = un budget de 250 $, trop lâche).

### C2. Échec propre sur compte saturé
- **Où** : `mandat.ts` l.260-261.
- **Quoi** : sur compte saturé, mettre en pause / échouer proprement plutôt que basculer en
  surcoût payant silencieux.

---

## Axe D — Qualité des handoffs (cause 4) — à valider si dans le scope maintenant

### D1. Rapport d'équipe structuré
- **Où** : `options-composition.ts` l.164-171 (`display: omitted`), `BLOC_RAPPORT` l.184-202.
- **Quoi** : `rapport_equipe` renvoie un résumé structuré (état + décisions + reste), pas
  seulement le dernier bloc de texte du lead.

---

## Ordre d'exécution suggéré

1. **A1** (verrou Sonnet) — gros gain, faible effort.
2. **A2** (autocompact) + **C1/C2** (watchdog borné) — stoppe les fuites.
3. **A3** (caching).
4. **B1/B2/B3** (teams persistantes + ordre de features) — plus gros chantier.
5. **D1** (qualité handoffs) — si retenu.

Hors scope (Chris) : rotation / 1 compte par team (cause 2). À rouvrir plus tard si le rate-limit
reste gênant une fois la conso baissée.

## Prochaine étape (arrêtée avec Chris 2026-09-03)

Deux points à traiter au démarrage de l'implémentation :
1. **Trancher l'axe D** (qualité des handoffs) : dans ce chantier maintenant, ou reporté ?
   Décision à prendre en ouvrant la session d'implémentation.
2. **Lancer l'implémentation** dans une **nouvelle session Claude Code** dédiée (pas la session
   de conception), qui orchestre les agents un par axe. Prompt de lancement : `PROMPT-LANCEMENT.md`.

## Exécution

Implémentation déléguée à des agents (un par axe), après validation de ce plan par Chris. La
validation E2E (le système tourne, la conso baisse réellement) reste au parent, mesurée sur un
artefact réel (conso avant/après), jamais sur un récit.
