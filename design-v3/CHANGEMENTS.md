# v2 validée ↔ v3 — ce qui change et pourquoi

Point de départ : `design-v2/index.html` (DA cream/serif/orange actée par Chris, non retouchée).
v3 = mêmes tokens, même shell, trois ajouts de domaine (H-70, H-71, H-72) + le fil qui les relie.

---

## 1. Repris tel quel de la v2

Tokens, primitives, shell sidebar/vues, `.mcard`/`.esc`/`.acc`, modales (mandat, pause, arrêt d'urgence,
refus), fil de mission avec filtre tout/activité/autorisations, geste armé 1,5 s, simulation de coupure
de lien, juge d'inspection H-68. Rien de tout ça n'a été retouché en substance — seuls quelques points
d'ancrage (`renderParc`, `renderMissionDetail`, `toggleSaturation`, `goto`) ont été étendus pour brancher
les nouveautés.

## 2. Ajouté — H-71 : choix du modèle et du raisonnement

- Deux `<select>` dans le composer de l'Orchestrateur : modèle et raisonnement (`effort`).
- `MODELS[]` porte, par modèle, sa propre liste `effort` — changer de modèle **recalcule réellement**
  la seconde liste (`refreshEffortOptions()`), elle ne se contente jamais d'une constante figée.
- `claude-sonnet-4-6` apparaît dans la liste mais `disabled` : **choix délibéré de ne pas le masquer**.
  Alternative écartée : le retirer purement. Argument retenu — la transparence sur ce qui existe
  vraiment (H-71 le liste comme « accessible ») vaut mieux qu'une omission silencieuse ; un menu
  grisé avec motif affiché (`modelHint`) enseigne la règle au lieu de la cacher.
- Haiku absent de la liste, sans exception ni cas gris — c'est un fait technique (`supportedModels()`
  sans `supportsEffort`), pas une préférence à nuancer.

## 3. Ajouté — H-72 : jauges, arbre d'équipes, navigation par agent

**Jauges permanentes par compte (5h + 7j, %, reset)** : trois couches, pas une seule, par arbitrage de
place à l'écran (voir Tensions) :
1. `#miniGauges` en sidebar — complet, les deux comptes, les deux fenêtres.
2. `.quota-strip` — une ligne compacte sous le `vhead` du Parc, tapable, visible sans ouvrir le tiroir.
3. La vue Comptes — détail complet, inchangée dans son fond, augmentée du libellé « session actuelle »
   / « semaine » demandé par H-72.

**Arbre d'équipes (H-67 appliqué)** : sous « Orchestrateur », `#teamTree` liste les missions
`running`/`requires_action` comme nœuds cliquables — clic = `goToMission()`, navigation instantanée
vers le fil de cette équipe. Pas de niveau supplémentaire pour les sous-agents dans la sidebar
(hypothèse H-67 tenue : ils vivent dans le fil de leur mission, pas dans l'arbre global).

**Sous-agents cliquables, même profondeur que le lead** : nouvelle section « Équipe » dans le détail de
mission (`teamSectionTemplate`) — carte du lead + rangée horizontale de `subagent-card`. Chaque carte
mène à une **nouvelle vue** `agent` (`openAgent` / `renderAgentDetail`) : statut, action en cours, fil
d'évènements propre au sous-agent, mis à jour en direct (`ensureAgentFeedTimer`) si la mission tourne et
que l'agent est actif. Le flux de l'agent ne repasse jamais par le fil de l'orchestrateur — conforme à
H-45/H-72 (« jamais faire remonter au maître pour qu'il affiche »).

## 4. Ajouté — H-70 : atterrissage avant saturation de quota

`m.landing = {active, sinceLabel, account, resetLabel, step}` porté par la mission, pas par un nouvel
état figé — une mission qui atterrit reste `running`/`requires_action` en interne mais son affichage
(carte, badge, bandeau) bascule sur un traitement dédié (`.landing`, bandeau warn, strip « ATTERRISSAGE »).

Séquence simulée (`startLanding`), observable dans le temps comme l'exige H-65 :
1. Déclenchement (bascule visuelle immédiate, évènement dans le fil).
2. + 3,2 s — évènement « consignation en cours » (STATE.md + mémoire sémantique).
3. + 6,2 s — mission passe en `idle`, note « relance après reset de la fenêtre ».

Deux déclencheurs, l'un scénarisé, l'autre manuel pour la testabilité :
- `toggleSaturation()` sur un compte (vue Comptes) fait atterrir **toutes** les missions actives de ce
  compte — cohérent avec la clause H-70 ☠ (« la fenêtre est partagée, la décision appartient au
  superviseur, jamais au lead isolément » — ici simulée comme une action globale par compte, pas
  par mission une à une).
- Bouton « Simuler un atterrissage » dans le détail de chaque mission — permet de déclencher et
  d'observer la séquence sans dépendre de l'état d'un compte.

---

## Tensions arbitrées

**1. Permanence des jauges vs budget d'écran mobile.** H-72 dit « visibles en permanence » ; sur iPhone,
rien n'est réellement permanent hors du viewport actif. Arbitrage : trois couches de détail croissant
(quota-strip → mini-gauges tiroir → vue Comptes complète) plutôt qu'un widget unique surdimensionné qui
aurait mangé l'espace du Parc. Pas ajouté dans la vue Orchestrateur elle-même : elle porte déjà les
jauges H-63 (contexte, fin de fenêtre, $ agrégés) — dupliquer les jauges par compte au même endroit
aurait saturé un écran déjà chargé par le chat et le sélecteur de modèle.

**2. Sonnet 4.6 : griser ou masquer.** Choix documenté au §2. Point où Chris pourrait trancher
autrement : si le grisé avec tooltip est jugé trop bavard sur un écran de téléphone, le retirer
purement de la liste est l'alternative directe (perte : la transparence sur ce qui est techniquement
accessible).

**3. Profondeur de l'arbre de navigation.** H-67 pose l'hypothèse « deux niveaux » (orchestrateur →
équipes ; sous-agents dans le fil, pas dans la sidebar). Tenue telle quelle. Point à trancher si le
parc grossit : au-delà d'une dizaine d'équipes actives, `#teamTree` devient long sur mobile — pas de
pagination/scroll dédié ajouté pour l'instant, juste le scroll naturel de la sidebar.

**4. Qui décide de l'atterrissage.** H-70 est explicite : la décision appartient au superviseur qui
voit l'ensemble du compte, jamais au lead isolément. La maquette simule ça en faisant atterrir toutes
les missions d'un compte d'un coup depuis la vue Comptes — mais elle laisse aussi un déclencheur
manuel par mission, plus pratique à tester en isolation. **Tension non résolue** : ce bouton manuel
contredit un peu l'esprit « décision au niveau du compte, pas de la mission » — à garder en tête si un
jour ce comportement doit devenir réel (le bouton par mission ne devrait probablement pas survivre
au-delà de la maquette).

**5. Effort levels par modèle — données plausibles, pas mesurées pour tous.** Seul Sonnet 5 a des
chiffres réellement mesurés dans `16-decisions-operateur.md` (H-71 : 714/107/141 tokens selon
`effort`/`thinking`). Les listes `effort` de Fable 5 et Opus 4.7 dans `MODELS[]` sont une
**hypothèse de maquette** pour démontrer le recalcul dynamique — à vérifier contre `supportedModels()`
avant tout code réel, exactement comme H-71 l'exige déjà.

---

## Points où Chris devra trancher

- Sonnet 4.6 grisé vs absent de la liste (tension 2).
- Le bouton d'atterrissage manuel par mission doit-il survivre en usage réel, ou seule la décision au
  niveau du compte est légitime (tension 4) ?
- Faut-il remonter une jauge de compte directement dans la vue Orchestrateur malgré la saturation
  visuelle (tension 1), ou les trois couches actuelles suffisent-elles à l'usage réel ?

---

## 2026-07-22, suite — correction sur mesure réelle (H-71.1, H-63.1)

Un banc réel (`harness/acceptation/modeles-effort-reel.ts`) a mesuré ce que `supportedModels()`
déclare vraiment. La v3 initiale **anticipait** — elle prêtait cinq niveaux d'effort à
`claude-opus-4-7` sans preuve. La mesure la contredit : corrections apportées sur la mesure, pas
sur une préférence.

**1. `claude-opus-4-7` retiré du sélecteur `MODELS[]`.** Il répond mais est absent de
`supportedModels()` : un niveau d'effort qui lui est prêté est **silencieusement ignoré** par le
SDK, jamais rejeté — l'UI aurait affiché « max » pendant que le modèle tourne sur autre chose, sans
aucun signal. `☠` Traitement différent de Sonnet 4.6 : Sonnet 4.6 reste **grisé, visible** (choix de
transparence, H-71, accessible mais déconseillé par préférence de Chris) ; Opus 4.7 est **retiré
purement** (fait mécanique, pas une préférence — rien à afficher honnêtement pour lui).

**2. Mode rapide (`supportsFastMode`) représenté** — case à cocher dans le composer, activable
**seulement** quand `claude-opus-4-8` est sélectionné (seul modèle qui le déclare). Se désactive et
se décoche automatiquement sur tout autre modèle (`refreshModelToggles()`).

**3. `ultracode` ajouté comme mode À PART, jamais comme 6ᵉ niveau d'effort.** Case à cocher séparée
de raisonnement, activable uniquement sur les trois modèles capables de `xhigh`
(`claude-opus-4-8`, `claude-sonnet-5`, `claude-fable-5` — `supportsUltracode()`). Le hint explicite
les trois contraintes mesurées (H-71.1) : portée **session** (retombe au rechargement, jamais
persisté — cohérent puisque `state` vit en mémoire JS), exige les workflows activés (simulé :
cocher `ultracode` active `workflowsEnabled` en interne, pas de toggle séparé pour ne pas
surcharger la maquette d'un concept non modélisé ailleurs), exige un modèle `xhigh`-capable.

**4. État `isUsingOverage` (H-63.1) rendu visible, aux trois couches de jauges.** Avant : `status:
'rejected'` déclenchait l'atterrissage sans qu'aucune UI ne dise que la session **continue en
réalité sur les crédits** (`extra_usage`, H-69) — exactement l'état « silencieux » que H-72 demande
de rendre visible. Ajouté : champ `isUsingOverage` par compte, badge « dépassement (crédits) » dans
les mini-jauges sidebar, indicateur `· crédits` dans le `quota-strip`, bandeau explicatif complet
dans la vue Comptes (`accountBlock`). `toggleSaturation()` le pose à `true` en même temps que
`status: 'rejected'`, cohérent avec la mesure réelle de l'événement `rate_limit_event`
(`status:"rejected", isUsingOverage:true` simultanés, H-63.1).

### Ce qui reste en attente d'un arbitrage humain (inchangé, + ajouts)

- Les listes `effort` de Fable 5 sont correctes (mesure H-71.1 confirme les 5 niveaux pour les
  trois modèles xhigh), mais seul Sonnet 5 a des **chiffres de tokens** mesurés (714/107/141) — les
  ordres de grandeur pour Opus 4.8 et Fable 5 restent une hypothèse d'affichage, pas une mesure.
- L'échelle entière d'`effort` (le champ accepte aussi un entier, H-71) n'est pas explorée : la
  maquette ne l'expose toujours pas, à dessein.
- `ultracode` simulé ici active `workflowsEnabled` sans qu'un concept de « workflows » existe
  ailleurs dans la maquette — à concevoir séparément si Chris veut une vraie surface pour ça.
- Le déclenchement de `isUsingOverage` reste couplé au bouton de simulation de saturation existant ;
  en réel, il vient de l'événement `rate_limit_event` poussé, pas d'une bascule manuelle.
