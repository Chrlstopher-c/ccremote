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
