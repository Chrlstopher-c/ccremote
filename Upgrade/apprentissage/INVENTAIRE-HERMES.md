# INVENTAIRE — la boucle d'apprentissage de Hermes Agent

**Source lue** : `/mnt/projects/hermes-agent`, dépôt Python de Nous Research, **licence MIT**
(`LICENSE`, racine du dépôt). Lecture seule, aucun fichier modifié. Version lue le 2026-08-08,
arbre daté du 12/06 sur ce disque.

**Objet du document** : relever, mécanisme par mécanisme, ce que Hermes appelle sa
*self-improvement loop*. Ce n'est pas un résumé du dépôt : c'est le relevé de ce qui APPREND —
ce qui observe une session, en tire un artefact durable, et le remet dans le contexte d'une
session suivante.

**Format imposé, cinq champs par mécanisme, aucun mécanisme relevé sans les cinq** :

| Champ | Question |
|---|---|
| (a) | fichier source et lignes |
| (b) | ce qu'il CONSOMME |
| (c) | ce qu'il PRODUIT et où c'est stocké |
| (d) | QUAND il se déclenche |
| (e) | COMMENT le produit revient dans le contexte de l'agent |

**Vocabulaire Hermes** (à connaître pour lire la suite) :

- `AIAgent` — la classe de la boucle agentique (`run_agent.py`, 5400 lignes). Une instance = une
  session. `run_conversation()` = un tour utilisateur complet (n itérations d'outils incluses).
- *fork* — une **seconde instance** `AIAgent` construite dans un thread, qui hérite du runtime de
  la première (fournisseur, modèle, credentials, system prompt en cache) mais a sa propre
  whitelist d'outils et son propre cycle de vie. Ce n'est pas un `fork(2)` Unix.
- `~/.hermes/` — le *hermes home*, résolu dynamiquement (`hermes_constants.get_hermes_home()`),
  scopé par profil. Tout le stockage durable de la boucle y vit.
- *skill* — un dossier `<nom>/SKILL.md` + éventuels `references/`, `templates/`, `scripts/`.
  Frontmatter YAML (`name`, `description`, `platforms`, `metadata.hermes.tags`).

---

## Vue d'ensemble — la boucle en une page

```
                 ┌───────────────────────── session utilisateur ─────────────────────────┐
                 │  run_conversation()  ──►  n itérations d'outils  ──►  réponse finale   │
                 └───────────┬────────────────────────────────────────────┬──────────────┘
     compteurs de tours (H-1a)│                                            │ fin de tour
                              ▼                                            ▼
                   ┌──────────────────────┐                    ┌────────────────────────┐
                   │  déclencheur nudge   │───────────────────►│  H-1 revue en fork     │
                   │ turns_since_memory   │                    │  (thread daemon)       │
                   │ iters_since_skill    │                    │  outils: memory+skills │
                   └──────────────────────┘                    └────┬──────────────┬────┘
                                                                    │              │
                                        ┌───────────────────────────┘              └──────────┐
                                        ▼                                                     ▼
                        ┌───────────────────────────┐                       ┌─────────────────────────────┐
                        │ H-2  MEMORY.md / USER.md  │                       │ H-4  ~/.hermes/skills/      │
                        │ (entrées bornées en char) │                       │ SKILL.md + references/      │
                        └───────────┬───────────────┘                       └──────┬──────────────┬───────┘
                                    │ snapshot GELÉ au démarrage                   │ index compact│ contenu
                                    ▼                                              ▼              ▼ complet
                        ┌──────────────────────────────── system prompt ──────────────────────────────────┐
                        │  <memory>…</memory>  <user>…</user>   +   index des skills (nom + description)   │
                        └─────────────────────────────────────────────────────────────────────────────────┘
                                                                                          ▲
                                                    H-5 chargement à la demande (/skill, skill_view)
                                                                                          │
   inactivité ≥ 7 j ──► H-8 CURATOR (fork auxiliaire) ──► consolide, archive, patche ──────┘
                              ▲            │
                   H-7 .usage.json         └──► H-9 snapshot tar.gz avant mutation (rollback)
```

Deux boucles de temporalités différentes : **la revue de fin de tour** (minutes, H-1) qui ÉCRIT,
et **le curator** (jours, H-8) qui RÉORGANISE ce que la première a écrit. Le reste est le
stockage, la réinjection, la télémétrie et les garde-fous de ces deux-là.

---

## H-1 — Revue mémoire/skills en arrière-plan (le cœur de la boucle)

**(a) Source**
- `agent/background_review.py` — 700 lignes. Prompts : `_MEMORY_REVIEW_PROMPT` (34-43),
  `_SKILL_REVIEW_PROMPT` (45-149), `_COMBINED_REVIEW_PROMPT` (150-235). Exécution :
  `_run_review_in_thread` (327-568). Constructeur du thread : `spawn_background_review_thread`
  (573-597). Résumé des actions : `summarize_background_review_actions` (237-298).
- `run_agent.py:1419-1440` — `AIAgent._spawn_background_review()`, qui construit le
  `threading.Thread(target=…, daemon=True, name="bg-review")` et le démarre.
- `agent/turn_finalizer.py:375-401` — le site qui décide et appelle.
- `agent/turn_context.py:205-218` — le compteur de tours côté mémoire.
- `agent/conversation_loop.py:517-520` — le compteur d'itérations côté skills.
- `agent/agent_init.py:1110-1118` et `1230-1233` — valeurs par défaut des intervalles.

**(b) Consomme**
- `messages_snapshot` : **copie de la liste de messages du tour qui vient de finir**
  (`list(messages)` dans `turn_finalizer`), passée au fork en `conversation_history`. C'est le
  transcript en mémoire vive, pas un fichier.
- Le runtime vivant du parent : `agent._current_main_runtime()` → provider, model, `base_url`,
  `api_key`, `api_mode`, pool de credentials. `codex_app_server` est rétrogradé en
  `codex_responses` (`background_review.py:395-401`) parce que le premier court-circuite le
  dispatch d'outils de Hermes.
- Le system prompt **déjà en cache** du parent (`_cached_system_prompt`), plus `session_start` et
  `session_id` épinglés, pour que la requête sortante tape le même préfixe de cache
  (`background_review.py:428-448` ; commentaire : ~26 % de coût en moins mesuré sur Sonnet 4.5).

**(c) Produit et où**
- Le fork n'écrit rien lui-même : il **appelle des outils**. Whitelist stricte construite depuis
  `get_tool_definitions(enabled_toolsets=["memory","skills"])` et posée en thread-local par
  `set_thread_tool_whitelist` (`background_review.py:470-495`). Tout autre outil est refusé au
  dispatch avec le message « Background review denied non-whitelisted tool ».
- Les écritures atterrissent donc dans **H-2** (`~/.hermes/memories/MEMORY.md`, `USER.md`) et
  **H-4** (`~/.hermes/skills/**`).
- Sortie propre du mécanisme : une **ligne de résumé utilisateur**
  (`💾 Self-improvement review: Memory updated · …`) reconstruite par
  `summarize_background_review_actions` à partir des messages de rôle `tool` du fork, en excluant
  ceux déjà présents dans le snapshot hérité (issue #14944 citée dans le code).
- Provenance : `build_memory_write_metadata` (300-324) estampille chaque écriture externe avec
  `write_origin="background_review"`, `execution_context="background_review"`, `session_id`,
  `parent_session_id`, `platform`.

**(d) Déclencheur**
Après la réponse finale, jamais pendant. Condition exacte
(`turn_finalizer.py:393`) : `final_response and not interrupted and (review_memory or review_skills)`.
- `review_memory` — `turn_context.py:210-217` : `_memory_nudge_interval > 0` (**défaut 10**,
  `agent_init.py:1110`), l'outil `memory` disponible, un `_memory_store` présent ; le compteur
  `_turns_since_memory` s'incrémente **par tour utilisateur** et déclenche à 10, puis est remis à 0.
- `review_skills` — `turn_finalizer.py:376-381` : `_skill_nudge_interval > 0` (**défaut 10**,
  `agent_init.py:1230`), `skill_manage` disponible, et `_iters_since_skill ≥ 10` où le compteur
  s'incrémente **par itération d'outil** (`conversation_loop.py:517-520`), pas par tour. Un tour
  bavard en outils peut donc armer le déclencheur à lui seul.
- Les deux armés ⇒ `_COMBINED_REVIEW_PROMPT`, un seul fork.

**(e) Réinjection**
Indirecte, et c'est le point structurant : le fork n'injecte rien dans la session courante. Ce
qu'il écrit entre dans le contexte **au démarrage de la session suivante** — via le snapshot gelé
de H-2 et l'index de skills de H-4. Le fork est explicitement empêché de perturber la session
vivante : `compression_enabled = False` (il partage le `session_id` du parent et gagnerait une
course de compression, issue #38727 citée), `skip_memory=True` (aucun fournisseur externe
reconstruit), `suppress_status_output = True`, stdout/stderr redirigés vers `/dev/null`, et le
callback d'approbation des commandes dangereuses est forcé à `deny` (`_bg_review_auto_deny`,
337-350) pour ne pas dead-locker contre la TUI du parent (issue #15216).

---

## H-2 — Mémoire curée bornée : `MEMORY.md` / `USER.md`

**(a) Source** — `tools/memory_tool.py` : docstring de tête 1-24, `get_memory_dir()` 55-58,
`ENTRY_DELIMITER` 59, `_scan_memory_content` 77-80, classe de store et
`load_from_disk()` 133-172, `_sanitize_entries_for_snapshot()` 175-210, choix du fichier cible
247-250, écriture 272+.

**(b) Consomme** — les appels de l'outil `memory` (`action ∈ {add, replace, remove, read}`), qu'ils
viennent du tour principal ou du fork de revue H-1. `replace`/`remove` matchent sur une **courte
sous-chaîne unique**, pas sur un identifiant ni le texte complet.

**(c) Produit et où** — deux fichiers Markdown dans `~/.hermes/memories/` :
`MEMORY.md` (ce que l'agent a appris de l'environnement : conventions de projet, particularités
d'outils) et `USER.md` (ce qu'il sait de l'utilisateur : préférences, style, attentes). Entrées
séparées par le délimiteur `\n§\n`, multilignes autorisées. **Bornage en caractères, pas en
tokens** — défauts `memory_char_limit=2200`, `user_char_limit=1375` — justifié dans le code par
l'indépendance au modèle. Écriture atomique (`utils.atomic_replace`) sous verrou de fichier
(`fcntl`, `msvcrt` sur Windows).

**(d) Déclencheur** — à l'appel de l'outil, immédiat et durable sur disque. Le chargement, lui,
est au **démarrage de session** (`load_from_disk`). Le nudge de H-1 est ce qui provoque la
majorité des appels non sollicités.

**(e) Réinjection** — snapshot **gelé** : `load_from_disk()` construit une fois, au démarrage, le
bloc rendu qui entre dans le system prompt. Les écritures en cours de session **modifient le
disque mais pas le system prompt** — c'est délibéré, pour préserver le préfixe de cache pendant
toute la session ; le nouvel état n'est visible qu'à la session suivante (ou via
`memory(action=read)`, qui lit l'état vivant). Deux gardes à la frontière : tout contenu écrit est
scanné (`threat_patterns`, scope `strict`) et refusé s'il matche ; et à la **relecture**, une
entrée empoisonnée sur disque est remplacée dans le snapshot par
`[BLOCKED: MEMORY.md entry contained threat pattern(s): …]` tout en restant visible en état vivant
pour que l'utilisateur puisse la supprimer.

---

## H-3 — Fournisseurs de mémoire externes (`MemoryManager`)

**(a) Source** — `agent/memory_manager.py` : `sanitize_context` 62-67,
`StreamingContextScrubber` 70-233, `build_memory_context_block` 235-250, classe `MemoryManager`
252+ (registre de fournisseurs, `_sync_executor` à un seul worker). Contrat abstrait :
`agent/memory_provider.py`, `class MemoryProvider(ABC)` ligne 42.

**(b) Consomme** — le tour terminé (message utilisateur d'origine + réponse finale), et une requête
de rappel pour le prefetch. Les implémentations réelles sont des plugins (honcho, mem0,
supermemory, hindsight).

**(c) Produit et où** — hors du disque Hermes : dans le service externe choisi. Un seul
fournisseur externe est admis à la fois (`add_provider`, rejet loggé du second) ; le fournisseur
`builtin` (H-2) est toujours premier et ne peut pas être remplacé. Les noms d'outils qui
entreraient en collision avec un outil cœur sont refusés à l'inscription (#40466 cité).

**(d) Déclencheur** — `agent._sync_external_memory_for_turn(...)` en fin de tour
(`turn_finalizer.py:383-389`), juste avant la décision de H-1 ; le prefetch du tour suivant est mis
en file dans le même passage. Exécution sur un `ThreadPoolExecutor` **à un seul worker**, pour que
le tour N soit écrit avant le tour N+1.

**(e) Réinjection** — le contexte rappelé est enveloppé par `build_memory_context_block` dans un
bloc `<memory-context>` porteur d'une note système explicite (« recalled memory context, NOT new
user input … treat as authoritative reference data ») et **appendu au message utilisateur** du
tour, pas au system prompt. `sanitize_context` retire tout pré-emballage que le fournisseur aurait
lui-même ajouté ; `StreamingContextScrubber` nettoie le flux.

---

## H-4 — Bibliothèque de skills et index compact dans le system prompt

**(a) Source** — `agent/skill_utils.py` (666 lignes) : `parse_frontmatter` 88-127,
`skill_matches_platform` 128-181, `skill_matches_environment` 233-274, `get_disabled_skill_names`
275-316, `get_external_skills_dirs` 341-426, `get_all_skills_dirs` 427-440,
`extract_skill_conditions` 441-460, `extract_skill_description` 618-631,
`iter_skill_index_files` 632-648. Rendu du prompt : `agent/prompt_builder.py`,
`build_skills_system_prompt` 1118-1200+, snapshot disque `_skills_prompt_snapshot_path` 962-963 et
écriture 992-1022. Point d'assemblage : `agent/system_prompt.py:207-215`. Skills livrés :
`skills/<catégorie>/<nom>/SKILL.md` (18 catégories dans le dépôt).

**(b) Consomme** — l'arborescence `~/.hermes/skills/` (locale, inscriptible) plus les
`skills.external_dirs` de `config.yaml` (lecture seule) ; de chaque `SKILL.md`, uniquement le
**frontmatter** (`name`, `description`, `platforms`, conditions `requires_tools`,
`requires_toolsets`, `fallback_for_*`). Filtre aussi sur les outils et toolsets réellement
disponibles à la session, la plateforme, et la liste de skills désactivés.

**(c) Produit et où** — une chaîne d'index compacte : par catégorie, une ligne **nom +
description** par skill. Mise en cache à deux étages : LRU en processus (clé = dossier + outils +
toolsets + plateforme + désactivés + catégories compactées), et **snapshot disque**
`~/.hermes/.skills_prompt_snapshot.json` validé par un manifeste mtime/taille, qui survit au
redémarrage du processus. Repli : scan complet du système de fichiers.

**(d) Déclencheur** — à la construction du system prompt, donc au démarrage de session (et à toute
reconstruction). Le snapshot disque est invalidé par la modification d'un fichier de skill —
c'est-à-dire par toute écriture de H-1 ou H-8.

**(e) Réinjection** — directement dans le system prompt, dans les `stable_parts`
(`system_prompt.py:214-215`), donc dans la zone couverte par le cache de préfixe. **Aucun corps de
skill n'y entre** : l'index ne porte que noms et descriptions, le contenu complet est chargé à la
demande (H-5). Une catégorie « compactée » (posture de codage, `agent/coding_context.py`) perd ses
descriptions mais **jamais ses noms** — rien n'est caché, tout reste `skill_view`-able.

---

## H-5 — Chargement d'une skill à la demande et préprocessing

**(a) Source** — `agent/skill_commands.py` : `_load_skill_payload` 53-120, `_inject_skill_config`
121-159, `_build_skill_message` 160-262, `scan_skill_commands` 263-332, `get_skill_commands`
333-347, `reload_skills` 348-412, `resolve_skill_command_key` 413-431,
`build_skill_invocation_message` 432-478, `build_preloaded_skills_prompt` 479-527.
Préprocessing : `agent/skill_preprocessing.py` (140 lignes) — `substitute_template_vars` 37-60,
`run_inline_shell` 63-101, `expand_inline_shell` 104-121, `preprocess_skill_content` 124-140.

**(b) Consomme** — un identifiant de skill (commande slash `/<nom>` de l'utilisateur, ou appel
`skill_view` du modèle), le `SKILL.md` correspondant, la configuration `skills.*` de `config.yaml`,
et le `session_id` courant.

**(c) Produit et où** — un **message** injecté dans la conversation (pas un fichier). Le contenu
est préprocessé : `${HERMES_SKILL_DIR}` et `${HERMES_SESSION_ID}` substitués si résolvables
(sinon laissés tels quels, pour être débogables) ; les extraits shell inline ``!`cmd` `` exécutés
via `bash -c` avec le dossier de la skill en cwd, sortie plafonnée à 4000 caractères et timeout
configurable — **désactivé par défaut** (`inline_shell: false`), les échecs rendent un marqueur
`[inline-shell error: …]` au lieu de lever.

**(d) Déclencheur** — à l'invocation : commande slash, `skill_view`, ou préchargement
(`build_preloaded_skills_prompt`) pour les skills configurées comme toujours présentes.

**(e) Réinjection** — dans le fil de conversation, comme un message, donc **hors du préfixe caché**
et pour cette session seulement. C'est le complément exact de H-4 : l'index est permanent et
bon marché, le corps est ponctuel et cher.

---

## H-6 — Bundles de skills

**(a) Source** — `agent/skill_bundles.py` (410 lignes) : `_bundles_dir` 66-77, `_load_bundle_file`
116-167, `scan_bundles` 168-194, `get_skill_bundles` 195-207, `resolve_bundle_command_key`
208-220, `reload_bundles` 221-246, `build_bundle_invocation_message` 253-347, `save_bundle`
356-393, `delete_bundle` 394-406.

**(b) Consomme** — des fichiers de bundle (`~/.hermes/skills/.bundles/`, résolu par `_bundles_dir`)
qui nomment plusieurs skills à charger ensemble, avec un cache invalidé au `mtime` maximal des
fichiers.

**(c) Produit et où** — un message d'invocation qui concatène les skills du bundle, et, côté
écriture, un fichier de bundle persistant créé par `save_bundle`.

**(d) Déclencheur** — invocation d'une commande de bundle par l'utilisateur. Aucun déclenchement
automatique, aucune écriture par le fork de revue.

**(e) Réinjection** — comme H-5 : un message de conversation, pas de system prompt.

---

## H-7 — Télémétrie d'usage des skills (`.usage.json`)

**(a) Source** — `tools/skill_usage.py` : `_usage_file()` 85-86 et son verrou 90-124,
`latest_activity_at` 146-165, `activity_count` 166-180, lecture des skills livrés/hub 181-241,
liste des suppressions 263-329, `list_agent_created_skill_names` 330-380,
`list_archived_skill_names` 381-393, gabarit d'enregistrement 463-466, `bump_view` 587-598,
`bump_use` 599-610, `bump_patch` 611+, `mark_agent_created` 622+.

**(b) Consomme** — les événements d'usage d'une skill : vue (`skill_view`), utilisation effective,
patch. Et, pour le classement, le manifeste des skills livrés (`.bundled_manifest`) et le verrou
du hub (`.hub/lock.json`) — ce qui permet de distinguer *agent-created* de *livré* / *installé*.

**(c) Produit et où** — un sidecar JSON `~/.hermes/skills/.usage.json`, un enregistrement par
skill : `use_count`, `view_count`, `patch_count`, `last_used_at`, `last_viewed_at`,
`last_patched_at`, `created_at`, état de cycle de vie, `pinned`. Cycle lire-modifier-écrire
sérialisé entre processus par un fichier de verrou `.usage.json.lock`.

**(d) Déclencheur** — à chaque événement, en ligne.

**(e) Réinjection** — **jamais dans le contexte du modèle**, et c'est explicite : le prompt du
curator (règle 4, `curator.py:377-380`) interdit d'utiliser les compteurs comme motif de décision
(« use=0 is not evidence a skill is valuable; it's absence of evidence either way »). Le produit
sert exclusivement aux **transitions automatiques** de H-8, qui lisent `latest_activity_at`.

---

## H-8 — Curator : consolidation périodique de la bibliothèque

**(a) Source** — `agent/curator.py` (1900+ lignes). Constantes 56-59
(`DEFAULT_INTERVAL_HOURS = 24*7`, `DEFAULT_MIN_IDLE_HOURS = 2`, `DEFAULT_STALE_AFTER_DAYS = 30`,
`DEFAULT_ARCHIVE_AFTER_DAYS = 90`). État 66-118, config 119-188, `should_run_now` 198-249,
`apply_automatic_transitions` 255-315, `CURATOR_DRY_RUN_BANNER` 317-343, `CURATOR_REVIEW_PROMPT`
344-489, `_reports_root` 490-510, classification des skills retirées 530-651, parsing du résumé
structuré 652-732, réconciliation 787-917, `_write_run_report` 1008-1199, `_render_report_markdown`
1200-1386, `_render_candidate_list` 1387-1406, `run_curator_review` 1407-1610, résolution du
runtime auxiliaire 1611-1675, `_run_llm_review` 1676-1816, `maybe_run_curator` 1817-1836.
Appelants hors tests : `cli.py` et `gateway/run.py` (tick d'arrière-plan).

**(b) Consomme** — deux entrées de natures différentes :
1. *Sans modèle* : les enregistrements de H-7 (`agent_created_report()`), pour les transitions
   d'état par horloge.
2. *Avec modèle* : la **liste de candidats** rendue par `_render_candidate_list()` — uniquement des
   skills créées par l'agent, non épinglées, hors livrées/hub/protégées — plus le prompt de revue.

**(c) Produit et où**
- Mutations directes de `~/.hermes/skills/` : consolidation (fusion dans une skill parapluie,
  création d'un parapluie, rétrogradation en `references/`/`templates/`/`scripts/`), patch,
  **archivage** vers `~/.hermes/skills/.archive/` — jamais de suppression (règle 2 du prompt).
- Un **rapport de passe** Markdown/JSON sous `~/.hermes/logs/curator/` (`_reports_root`), qui porte
  la classification des skills retirées, les renommages, et ce qui a été absorbé où.
- L'état `~/.hermes/skills/.curator_state` : `last_run_at`, `paused`, `last_run_summary`.
- Réécriture des références de skills dans les tâches cron (`cron.jobs.rewrite_skill_refs()`),
  puisqu'une consolidation change les noms.

**(d) Déclencheur** — **inactivité, pas de démon cron**. `maybe_run_curator()` est appelé sur un
tick d'arrière-plan (CLI, gateway) et passe trois portes : `curator.enabled`, non `paused`, et
`last_run_at` plus vieux que `interval_hours` (**7 jours** par défaut) ; puis, si l'appelant a
fourni la mesure, `idle_for_seconds ≥ min_idle_hours` (**2 h**). Comportement de première
exécution explicite : sans `last_run_at`, on **ne tourne pas** — on sème l'horodatage à maintenant
et on diffère d'un intervalle complet. `hermes curator run [--dry-run]` court-circuite ces portes.
Les transitions automatiques utilisent une horloge distincte : *stale* à 30 jours d'inactivité,
*archived* à 90 ; une skill réutilisée après avoir été marquée *stale* redevient *active* ; une
skill épinglée n'est jamais touchée ; une skill nouvellement éligible est **semée** à maintenant
plutôt que jugée sur un compteur vide.

**(e) Réinjection** — indirecte, par H-4 : moins d'entrées dans l'index, chacune plus large. La
revue tourne sur le **client auxiliaire** (`_resolve_review_runtime`, `_run_llm_review`) — modèle
et fournisseur configurables séparément — de sorte que **le cache de prompt de la session
principale n'est jamais touché** (invariant énoncé en tête de fichier). Le rapport de passe n'entre
pas dans le contexte du modèle : il est destiné à l'exploitation.

---

## H-9 — Snapshot et rollback du curator

**(a) Source** — `agent/curator_backup.py` : docstring 1-40, `DEFAULT_KEEP = 5` 57,
`_EXCLUDE_TOP_LEVEL` 62, `_backup_cron_jobs_into` 86-131, `_write_manifest` 186-210,
`snapshot_skills` 211-283, `_prune_old` 284-324, `list_backups` 335-363, `_resolve_backup` 364-385,
`_restore_cron_skill_links` 386-528, `rollback` 529-673, `summarize_backups` 682+.

**(b) Consomme** — l'arborescence `~/.hermes/skills/` **avant** toute passe mutante du curator,
plus `~/.hermes/cron/jobs.json` s'il existe.

**(c) Produit et où** — `~/.hermes/skills/.curator_backups/<utc-iso>/` contenant une archive
`tar.gz` de l'arbre des skills, un `manifest.json` (motif, date, taille, nombre de fichiers de
skill) et une copie `cron-jobs.json`. Inclus dans l'archive : les `SKILL.md` et leurs dossiers,
`.usage.json`, `.archive/`, `.curator_state`, `.bundled_manifest`, `.curator_suppressed`. Exclus :
`.curator_backups/` (récursion) et `.hub/`. Rétention : 5 snapshots.

**(d) Déclencheur** — avant chaque passe mutante du curator (jamais en dry-run). Le rollback est
manuel (`hermes curator rollback`).

**(e) Réinjection** — aucune vers le modèle. C'est un **garde-fou d'opération** : le rollback
déplace d'abord l'arbre courant dans un nouveau snapshot (le rollback lui-même est annulable), puis
restaure. Le `.curator_state` est inclus délibérément — sans lui, un rollback ferait re-déclencher
le curator au tick suivant.

---

## H-10 — Insights de session (analytique d'usage)

**(a) Source** — `agent/insights.py` (38 kB) : docstring 1-18, `_estimate_cost` 35-75,
`_bar_chart` 76-83, `class InsightsEngine` 84+, `generate(days, source)` 102-120+ qui agrège
`_get_sessions`, `_get_tool_usage`, `_get_skill_usage`, `_get_message_stats`. Tarification :
`agent/usage_pricing.py`.

**(b) Consomme** — la base SQLite d'état des sessions (`hermes_state.py`, `SessionDB`), lue
directement en SQL sur une fenêtre de N jours et un filtre de plateforme optionnel.

**(c) Produit et où** — un dictionnaire de rapport (tokens consommés, coût estimé, usage d'outils
et de skills, tendances d'activité, ventilation par modèle et plateforme) et un rendu terminal
(`format_terminal`). **Rien n'est persisté** : c'est calculé à la demande.

**(d) Déclencheur** — invocation explicite par l'humain (`/insights`, inspiré du `/insights` de
Claude Code d'après la docstring).

**(e) Réinjection** — **aucune**. Le rapport est affiché à l'humain ; aucun chemin ne le remet dans
le contexte de l'agent ni ne l'écrit dans une skill ou une mémoire. C'est un instrument
d'observation, pas un maillon de la boucle — le relevé le note pour que la spec puisse l'écarter en
connaissance de cause (voir `SPEC-APPRENTISSAGE.md`, mécanismes écartés).

---

## H-11 — Trajectoires et compresseur de trajectoires (chaîne d'entraînement)

**(a) Source** — `agent/trajectory.py` (56 lignes) : `convert_scratchpad_to_think` 16-20,
`has_incomplete_scratchpad` 23-27, `save_trajectory` 30-56. Et `trajectory_compressor.py` à la
racine (1579 lignes) : docstring de stratégie 1-31, `_effective_temperature_for_model` 59-82,
`CompressionConfig` 83-182, `TrajectoryMetrics` 183-227, `AggregateMetrics` 228-331,
`TrajectoryCompressor` 332-1360, CLI `main` 1361+. Consommateurs : `mini_swe_runner.py`,
`scripts/sample_and_compress.py`, `batch_runner.py` (via
`AIAgent._convert_to_trajectory_format`).

**(b) Consomme** — la conversation complète d'une exécution, convertie au **format ShareGPT** ; puis,
pour le compresseur, des fichiers `.jsonl` de trajectoires (un fichier ou un dossier, avec option
d'échantillonnage en pourcentage).

**(c) Produit et où** — `trajectory_samples.jsonl` (exécution réussie) ou
`failed_trajectories.jsonl` (échec), en **append**, dans le répertoire courant ; chaque entrée
porte `conversations`, `timestamp`, `model`, `completed`. Le compresseur écrit un JSONL compressé :
tours de tête protégés (système, humain, premier gpt, premier outil), N derniers tours protégés,
tours du MILIEU condensés en **un seul message humain de résumé** juste ce qu'il faut pour tenir
sous un budget de tokens cible.

**(d) Déclencheur** — hors ligne. `save_trajectory` est appelé en fin d'exécution par les runners
de batch/benchmark ; le compresseur est une **CLI** (`python trajectory_compressor.py --input=…`).

**(e) Réinjection** — **aucune vers l'agent en ligne**. Le produit alimente le fine-tuning (données
d'entraînement de Nous Research). Relevé ici parce qu'il porte, dans sa stratégie de compression,
une heuristique réutilisable — protéger les extrémités, condenser le milieu — mais il n'appartient
pas à la boucle d'apprentissage en ligne.

---

## Ce que l'inventaire établit

1. **Un seul mécanisme écrit vraiment de la connaissance** : H-1. Tout le reste est du stockage
   (H-2, H-4), de la lecture (H-5, H-6), de la télémétrie (H-7), de l'hygiène (H-8, H-9), ou hors
   boucle (H-10, H-11).
2. **La séparation mémoire/skill est une séparation de nature**, pas de format. Les trois prompts
   de H-1 la répètent : la mémoire dit *qui est l'utilisateur et où en sont les opérations*, la
   skill dit *comment faire cette classe de tâche pour cet utilisateur*.
3. **Le coût est le contrainte de conception dominante.** Fork qui hérite du prompt caché,
   whitelist de deux toolsets, index compact plutôt que corps de skills, client auxiliaire pour le
   curator, snapshot disque de l'index : chaque décision porte sa justification de coût dans le
   code.
4. **Trois listes négatives explicites**, toutes dans les prompts de H-1, toutes issues de dégâts
   réels : ne pas capturer les pannes d'environnement, ne pas capturer d'affirmation négative sur
   un outil (« X ne marche pas » se durcit en refus que l'agent s'oppose à lui-même des mois
   après), ne pas capturer les erreurs transitoires résolues ni les narrations de tâche unique.
5. **Rien n'est jamais supprimé automatiquement.** Archivage seulement, snapshot avant mutation,
   rollback lui-même annulable.
