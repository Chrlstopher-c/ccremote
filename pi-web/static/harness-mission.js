// ============ HARNESS — page mission, calquée sur Claude Code mobile ============
//
// ☠ La page était un TABLEAU DE BORD : cinq cartes de même poids (mandat, équipe,
// identité, consommation, fil), le fil en cinquième position, le markdown rendu
// brut. Or une mission EST une conversation avec un agent qui utilise des outils.
// Le fil est donc le contenu principal — pleine largeur, en serif, sans carte —
// et tout le reste vit derrière des valises et une feuille « Détails ».

/** Une parole du lead : markdown rendu, serif, pleine largeur. */
function hParoleTemplate(ev) {
  if (hEstMessageHarness(ev.text)) {
    return `<div class="h-harness">${hMarkdown(ev.text.replace(/^\[HARNESS\]\s*/, ''))}</div>`;
  }
  // ☠ Enveloppé : les actions ne se révèlent qu'au survol du message (comme la
  // référence), et il leur faut donc un parent commun pour porter le `:hover`.
  return `<div class="h-say-wrap" data-menu="parole"><div class="h-say">${hMarkdown(ev.text)}</div>
    <div class="h-acts"><button onclick="hCopierParole(this)" title="Copier">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="9" y="9" width="12" height="12" rx="2.5"/><path d="M6 15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V6"/></svg>
    </button></div></div>`;
}

function hOperateurTemplate(ev) {
  return `<div class="h-op"><div class="b">${escapeHtml(ev.text)}</div></div>`;
}

const H_ICO_CHEVRON = '<span class="cv">›</span>';

/**
 * Marqueur d'une valise de RÉFLEXION.
 *
 * ☠ Une horloge, c'était le temps passé — pas ce que fait le lead. Repliée, la
 * valise ressemblait trait pour trait à une ligne d'outil. La classe
 * `ic-pensee` est le SEUL accroche-style disponible : `HValise.html` accepte une
 * icône mais pas de classe sur le bouton, et le CSS l'attrape par `:has()`.
 */
const H_ICO_PENSEE =
  '<svg class="ic-pensee" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
  + 'stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">'
  + '<path d="M12 3l1.7 4.6L18.3 9.3 13.7 11 12 15.6 10.3 11 5.7 9.3 10.3 7.6z"/>'
  + '<path d="M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/></svg>';

/** ☠ Alias conservé : `harness-mission-sheets.js` (hors périmètre de cette
 * passe) référence encore ce nom pour la même valise de réflexion. */
const H_ICO_HORLOGE = H_ICO_PENSEE;

function hValiseOutilsTemplate(seg, index) {
  // ☠ Clé DÉTERMINISTE : le même segment produit le même HTML d'un rendu à
  // l'autre, sans quoi la comparaison par signature déclare tout modifié.
  const cle = HValise.enregistrer(() => hCorpsValiseOutils(index), `outils-${index}`);
  return HValise.html(hLibelleValise(seg.items), cle);
}

/**
 * ☠ Le résumé montré est le DÉBUT de la réflexion, pas un libellé générique :
 * « Réfléchi » ne dit rien, alors que la première phrase dit si ça vaut la peine
 * d'ouvrir. C'est exactement ce que fait Claude Code.
 *
 * ☠ Ce template n'est atteint que si le serveur marque l'évènement
 * `nature: 'reflexion'` (`vue-feed.ts`) — le chemin client, lui, n'a jamais
 * changé. Une équipe sans aucune réflexion à l'écran n'est donc PAS un écran en
 * panne : sur une tâche triviale, un modèle en raisonnement adaptatif n'en
 * produit simplement pas. Rien n'est affiché dans ce cas, et c'est voulu.
 */
function hValisePenseesTemplate(seg, index) {
  const apercu = seg.items[0].text.replace(/\s+/g, ' ').trim();
  const cle = HValise.enregistrer(
    () => `<div class="h-think">${seg.items.map((e) => hMarkdown(e.text)).join('')}</div>`,
    `pensees-${index}`,
  );
  return HValise.html(apercu, cle, H_ICO_PENSEE);
}

/**
 * ☠ La SEULE valise qui a le droit d'être visible : une autorisation en attente
 * bloque le travail, et la manquer coûte une équipe arrêtée sans que personne ne
 * le sache. Une fois résolue, elle redevient une ligne grise comme les autres.
 */
function hPermissionTemplate(ev, index) {
  const c = hParseOutil(ev.text);
  const commande = c.command || c.file_path || c.path || ev.text;
  if (!ev.pending) {
    const issue = ev.resolved || (ev.auto ? 'résolue par le lead' : 'traitée');
    const cle = HValise.enregistrer(() => `<div class="h-blk">${escapeHtml(commande)}</div>`, `perm-${index}`);
    return HValise.html(`${ev.tool || 'Outil'} · ${issue}`, cle);
  }
  return `<div class="h-perm">
    <div class="ph"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 8v5M12 17h.01"/><circle cx="12" cy="12" r="9.5"/></svg>
      ${escapeHtml(ev.tool || 'Un outil')} attend ton autorisation</div>
    <div class="pc">${escapeHtml(commande)}</div>
    <div class="pr"><button class="pb" onclick="hRepondrePermission(true)">Autoriser</button>
      <button class="pg" onclick="hRepondrePermission(false)">Refuser</button></div>
  </div>`;
}

/**
 * Une transition d'état, en français.
 *
 * ☠ Accepte un SEGMENT (rafale groupée) ou un évènement seul :
 * `harness-mission-sheets.js` appelle encore avec `seg.ev`, et le fil d'un
 * sous-agent passe par là. Les deux formes doivent rendre la même phrase.
 */
function hSystemeTemplate(source) {
  const items = source && Array.isArray(source.items) ? source.items : [source];
  const phrase = hTransitionLisible(items);
  if (!phrase) return '';
  return `<div class="h-sys">${escapeHtml(phrase)}</div>`;
}

function hCorpsSegment(seg, index) {
  if (seg.genre === 'outils') return hValiseOutilsTemplate(seg, index);
  if (seg.genre === 'pensees') return hValisePenseesTemplate(seg, index);
  if (seg.genre === 'operateur') return hOperateurTemplate(seg.ev);
  if (seg.genre === 'permission') return hPermissionTemplate(seg.ev, index);
  if (seg.genre === 'systeme') return hSystemeTemplate(seg);
  return hParoleTemplate(seg.ev);
}

/**
 * Un segment = son contenu + son pied « quand · combien de temps ».
 *
 * ☠ Le pied est DANS l'enveloppe du segment, jamais un frère : le rendu
 * incrémental identifie un segment par SON nœud racine (`hNoeudSegment` prend
 * `firstElementChild`). Un second nœud racine sortirait du comptage et se
 * dupliquerait à chaque mise à jour.
 *
 * ☠ Le même code sert le fil d'une équipe ET celui d'un sous-agent (H-72.1,
 * « même niveau de détail que le lead ») : `harness-agent.js` appelle
 * `hCorpsFil`. Une durée ajoutée ici l'est donc aux deux, par construction.
 */
function hSegmentTemplate(seg, index) {
  const corps = hCorpsSegment(seg, index);
  // ☠ Une rafale de transitions n'a pas de DURÉE : entre « le lead a rendu la
  // main » et « équipe terminée » il s'écoule une seconde de plomberie, et
  // l'afficher (« 21:43 · 1 s ») donne à lire une mesure qui ne mesure rien.
  // Seul l'instant d'arrivée compte, donc seul le dernier évènement du groupe.
  const items = seg.genre === 'systeme' && seg.ev
    ? [seg.ev]
    : seg.items || (seg.ev ? [seg.ev] : []);
  const etendue = window.HTemps ? window.HTemps.etendue(items) : { fin: null, duree: null };
  const pied = window.HTemps ? window.HTemps.piedHtml(etendue.fin, etendue.duree) : '';
  if (!pied) return `<div class="seg">${corps}</div>`;
  return `<div class="seg">${corps}${pied}</div>`;
}

/** Segments du dernier rendu — les feuilles y puisent leur contenu. */
let hSegmentsCourants = [];

function hCorpsFil(m) {
  hSegmentsCourants = hSegmenterFeed(m.feed);
  if (hSegmentsCourants.length === 0) {
    return '<div class="h-vide">Rien à afficher pour l’instant — cette équipe n’a encore rien produit.</div>';
  }
  return hSegmentsCourants.map(hSegmentTemplate).join('');
}

// ============ Rendu INCRÉMENTAL du fil d'une équipe ============
//
// ☠ CE QUE CECI REMPLACE — `corps.innerHTML = hCorpsFil(m)` à chaque nouvel
// événement. Tout le fil était reconstruit : les valises dépliées se refermaient
// sous les yeux de l'opérateur, et chaque bloc rejouait son animation d'entrée.
// Sur une équipe bavarde (un événement toutes les quelques secondes), lire un
// résultat d'outil devenait une course contre le rafraîchissement — mesuré le
// 02/08 sur la page d'une mission réelle.
//
// ☠ La difficulté qui avait fait renoncer à l'incrémental est REELLE et traitée
// ici : un outil de plus change le libellé de la DERNIÈRE valise (« 6 commandes »
// → « 7 commandes »). On ne peut donc pas se contenter d'ajouter à la fin. La
// réponse n'est pas de tout réécrire, c'est de comparer SEGMENT PAR SEGMENT et
// de ne remplacer que ceux dont le HTML a réellement changé — en pratique le
// dernier, pendant qu'une équipe travaille.

/** Un segment = un nœud racine, marqué de son index et de sa signature. */
function hNoeudSegment(html, index) {
  const hote = document.createElement('div');
  hote.innerHTML = html;
  const noeud = hote.firstElementChild;
  if (!noeud) return null;
  noeud.dataset.seg = String(index);
  noeud.dataset.sig = html;
  return noeud;
}

/**
 * Rouvre, sur le nœud neuf, ce qui était déplié sur l'ancien.
 *
 * ☠ Ne concerne QUE le segment réellement modifié — typiquement la valise en
 * cours, celle que l'opérateur vient d'ouvrir pour suivre le travail. La laisser
 * se refermer parce qu'un outil s'est ajouté dedans est exactement le défaut
 * qu'on corrige : elle se referme au pire moment, celui où il regarde.
 */
function hReprendreOuvertures(ancien, neuf) {
  const boutonsAnciens = [...ancien.querySelectorAll('[data-valise]')];
  const boutonsNeufs = [...neuf.querySelectorAll('[data-valise]')];
  boutonsAnciens.forEach((b, i) => {
    const corps = b.parentElement && b.parentElement.querySelector(':scope > .h-case-body');
    if (!corps || corps.hidden) return;
    const cible = boutonsNeufs[i];
    if (cible) cible.dataset.rouvrir = '1';
  });
}

/**
 * Met le corps du fil à jour sans jamais toucher aux segments inchangés.
 * Rend `true` si quelque chose a bougé.
 */
function hMajSegments(corps, m) {
  const segments = hSegmenterFeed(m.feed);
  hSegmentsCourants = segments;
  const existants = [...corps.querySelectorAll(':scope > [data-seg]')];
  let modifie = false;

  segments.forEach((seg, i) => {
    const html = hSegmentTemplate(seg, i);
    const ancien = existants[i];
    // Inchangé : on n'y touche PAS. C'est toute la valeur de cette fonction —
    // un nœud qu'on ne réécrit pas garde son état déplié et n'anime rien.
    if (ancien && ancien.dataset.sig === html) return;
    const neuf = hNoeudSegment(html, i);
    if (!neuf) return;
    modifie = true;
    if (ancien) {
      hReprendreOuvertures(ancien, neuf);
      ancien.replaceWith(neuf);
      neuf.querySelectorAll('[data-valise][data-rouvrir]').forEach((b) => {
        delete b.dataset.rouvrir;
        b.click();
      });
    } else {
      corps.appendChild(neuf);
    }
  });

  // Segments disparus (compaction du feed côté serveur) : on retire le surplus.
  existants.slice(segments.length).forEach((n) => {
    n.remove();
    modifie = true;
  });
  // ☠ APRÈS le retrait du surplus, jamais avant : le bloc en cours de frappe vit
  // hors de `[data-seg]`, mais il est bien dans `corps` — le placer plus haut le
  // ferait balayer par la ligne ci-dessus dès que le fil raccourcit.
  // ☠ Son mouvement compte dans `modifie` : sans ça, une réflexion qui s'allonge
  // ne ferait pas suivre le défilement, et le texte pousserait sous le bord de
  // l'écran pendant qu'on le lit.
  if (hMajPartielMission(corps, m.partial)) modifie = true;
  return modifie;
}

// ------------------------------------------------------------------ rendu

async function hRenderMissionDetail(id) {
  const res = await HarnessAPI.getMission(id);
  const m = res.data;
  const corps = document.getElementById('hMissionBody');
  if (!m) {
    corps.innerHTML = res.pcOnline === false
      ? hPcAbsentBanner('cette mission')
      : '<div class="empty-state"><div class="t">Mission introuvable</div></div>';
    return;
  }
  hMissionCourante = m;

  document.getElementById('hMissionTitle').textContent = m.title;
  document.getElementById('hMissionSub').innerHTML = hSousTitre(m);

  // ☠ La bannière « PC absent » est posée à part, SANS `data-seg` : le rendu
  // incrémental ne compte que les segments, et l'y mêler décalerait tous les
  // index d'un cran dès qu'une machine tombe.
  corps.innerHTML = HarnessAPI._isPcOnline() ? '' : hPcAbsentBanner('cette mission');
  if (m.feed.length === 0) {
    corps.insertAdjacentHTML('beforeend', hCorpsFil(m));
    // ☠ Le fil vide est PRÉCISÉMENT le cas où le bloc en cours compte le plus :
    // une équipe qui vient de partir réfléchit avant de produire son premier
    // évènement. Passer par la seule branche `hMajSegments` laisserait l'écran
    // vide pendant tout ce temps, et c'est ce moment-là qu'on veut voir.
    hMajPartielMission(corps, m.partial);
  } else {
    hMajSegments(corps, m);
  }

  const dock = document.getElementById('hMissionDock');
  const actif = HarnessAPI._isPcOnline() && !['echec', 'terminee'].includes(m.state);
  dock.classList.toggle('h-dock-off', !actif);
  dock.querySelector('textarea').disabled = !actif;
  hMajDockActes(m);

  hDefilerEnBas();
  hMissionRendue = { id: m.id, empreinte: hEmpreinteMission(m), feedLen: m.feed.length };
  hRenderTeamTree();
}

/** ☠ Le point d'état vit dans le sous-titre, pas dans une bande : une barre de
 * métriques sous le header faisait « outil de monitoring » et n'a aucun
 * équivalent chez Anthropic. Ce qui compte en permanence tient en une ligne. */
function hSousTitre(m) {
  const projet = escapeHtml((m.project || '').split('/').filter(Boolean).pop() || m.project);
  const couleur = m.state === 'running' ? 'var(--ok)'
    : m.state === 'requires_action' ? 'var(--accent)'
    : m.state === 'paused' ? 'var(--warn)'
    : m.state === 'echec' ? 'var(--err)' : 'var(--ink-3)';
  const vif = m.state === 'running' ? ' dot-live' : '';
  // ☠ Une PILULE d'une ligne, pas une bande de métriques : le reste (contexte,
  // durée, identité) vit derrière « ··· ». Le point d'état porte la couleur.
  return `<span class="h-sd${vif}" style="background:${couleur}"></span>` +
    `${projet} · ${escapeHtml(m.model || '—')} · ${hMoney(m.cost)}`;
}

/**
 * ☠ La zone défilante est `#hMissionScroll`, plus la vue entière : depuis que
 * le dock est son FRÈRE et non son voisin de flux, défiler la vue ne défile
 * plus rien. Les trois endroits qui parlaient de défilement de cette page
 * doivent viser la même zone, sans quoi « suivre le fil » cesse silencieusement
 * de fonctionner — aucune erreur, juste un fil qui n'avance plus.
 */
function hZoneFilMission() {
  return document.getElementById('hMissionScroll');
}

function hDefilerEnBas() {
  const zone = hZoneFilMission();
  if (!zone) return;
  zone.scrollTop = zone.scrollHeight;
  zone.dataset.filBasCle = 'mission';
  window.HFilBas?.attacher(zone, { calerMaintenant: false });
  window.HFilBas?.de('mission')?.majuster();
}

/**
 * Publie la hauteur RÉELLE du dock en variable CSS.
 *
 * ☠ Elle change en cours de session : la barre de commandes n'existe que sur
 * une équipe pilotable, l'indice passe sur deux lignes quand l'équipe est en
 * pause, et le champ de saisie grandit jusqu'à 120 px sous la frappe. Une seule
 * chose en dépend encore — la flèche « revenir au dernier message », posée dans
 * la vue et non dans la zone défilante — mais une valeur en dur s'y
 * désynchroniserait au premier de ces changements, exactement comme le
 * `padding-bottom: 170px` qu'on vient de retirer.
 */
function hObserverDock() {
  const dock = document.getElementById('hMissionDock');
  const vue = document.querySelector('[data-view="harness-mission"]');
  if (!dock || !vue || typeof ResizeObserver !== 'function') return;
  // ☠ Jamais `0px` : la vue est `display:none` au chargement, et publier zéro
  // écraserait le repli du CSS par une valeur fausse jusqu'au premier affichage.
  // On garde la dernière hauteur connue tant que le dock n'est pas mesurable.
  const publier = () => {
    const hauteur = Math.round(dock.offsetHeight);
    if (hauteur > 0) vue.style.setProperty('--h-dock-h', `${hauteur}px`);
  };
  const observateur = new ResizeObserver(publier);
  observateur.observe(dock);
  publier();
}

// ------------------------------------------- commandes rapides du composer
//
// ☠ CE QUE CECI CORRIGE — la vue d'une équipe n'offrait aucun contrôle direct :
// tout vivait derrière « ··· » puis un défilement dans la feuille Détails, et
// « couper le tour » n'avait même AUCUNE fonction cliente alors que la route
// existe côté serveur. Or on s'aperçoit qu'un lead part de travers en lisant son
// fil, le pouce déjà sur le composer — pas en fouillant une feuille.
//
// ☠ « Arrêter l'équipe » n'est PAS ici et n'y sera pas. Il reste au fond de la
// feuille Détails, derrière une confirmation et en couleur de danger. Couper un
// tour se rattrape en une phrase ; tuer une session emporte son contexte. Deux
// gestes voisins sous le même pouce, c'est fabriquer l'accident.

const H_ICO_COUPER =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>';
const H_ICO_PAUSE =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="6" width="3.4" height="12" rx="1.2"/><rect x="13.6" y="6" width="3.4" height="12" rx="1.2"/></svg>';
const H_ICO_REPRENDRE =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.6v12.8a1 1 0 0 0 1.53.85l10-6.4a1 1 0 0 0 0-1.7l-10-6.4A1 1 0 0 0 8 5.6z"/></svg>';

const H_DOCK_ACTES_ID = 'hMissionActes';

/**
 * ☠ Un bouton ÉTEINT plutôt que retiré quand le geste n'a pas de sens : une
 * commande qui disparaît déplace ses voisines sous un pouce déjà en descente,
 * entre deux sondages. La barre garde toujours la même géométrie.
 */
function hDockActesHtml(m, actif) {
  const enPause = m.state === 'paused';
  // Couper un tour n'a de sens que s'il y en a un en vol. `requires_action` en
  // fait partie : le SDK pose cet état SUR UNE DEMANDE D'AUTORISATION, le tour
  // n'est pas fini (« requires_action on permission prompt, idle on turn end »,
  // `claude-agent-sdk/bridge.d.ts`). C'est même le cas où reprendre la main
  // presse le plus — un lead figé sur une permission qu'on ne veut pas donner.
  const coupable = actif && ['running', 'requires_action'].includes(m.state);
  return `<button class="h-acte" ${coupable ? '' : 'disabled'} onclick="hInterruptMission('${m.id}')"
      aria-label="Couper le tour en cours sans arrêter l’équipe">${H_ICO_COUPER}<span>Couper le tour</span></button>
    <button class="h-acte" ${actif ? '' : 'disabled'} onclick="hPauseOneMission('${m.id}')"
      aria-label="${enPause ? 'Reprendre l’équipe' : 'Mettre l’équipe en pause'}">${enPause ? H_ICO_REPRENDRE : H_ICO_PAUSE}<span>${enPause ? 'Reprendre' : 'Mettre en pause'}</span></button>`;
}

/**
 * Pose (une seule fois) et met à jour la barre de commandes sous le composer.
 *
 * ☠ Même règle que le fil : on ne réécrit QUE si le HTML a changé. Réécrire à
 * chaque sondage annulerait l'appui en cours — le bouton meurt sous le doigt
 * pendant que le geste se termine, et il ne se passe rien.
 */
function hMajDockActes(m) {
  const dock = document.getElementById('hMissionDock');
  if (!dock) return;
  let barre = document.getElementById(H_DOCK_ACTES_ID);
  if (!barre) {
    barre = document.createElement('div');
    barre.id = H_DOCK_ACTES_ID;
    barre.className = 'h-actes';
    // Sous la rangée de réglages, HORS de la boîte de saisie : une commande
    // n'est pas du texte, elle n'a rien à faire dans le cadre du composer.
    // ☠ Dans `.h-dock-in`, jamais dans `.h-dock` : le dock porte le fond pleine
    // largeur, la colonne de lecture est à l'intérieur. Posée sur le dock, la
    // barre s'étirait sur toute la largeur de l'écran pendant que le composer
    // restait centré à 760 px.
    (dock.querySelector('.h-dock-in') || dock).appendChild(barre);
  }
  const actif = HarnessAPI._isPcOnline() && !['echec', 'terminee'].includes(m.state);
  const html = hDockActesHtml(m, actif);
  if (barre.dataset.sig !== html) {
    barre.dataset.sig = html;
    barre.innerHTML = html;
  }
  // ☠ L'indice dit ce qui va RÉELLEMENT arriver au message, AVANT l'envoi : sur
  // une équipe en pause le serveur le retient, et l'apprendre seulement dans le
  // toast d'après-coup, c'est l'apprendre trop tard.
  const indice = dock.querySelector('.h-hint');
  if (indice) {
    indice.textContent = m.state === 'paused'
      ? 'Équipe en pause — le message sera retenu jusqu’à la reprise.'
      : 'Lue au prochain tour disponible.';
  }
}

// ------------------------------------------------------------------ actions

let hMissionCourante = null;

/**
 * ☠ Le résultat de l'envoi était JETÉ : le toast annonçait « Instruction
 * transmise » quoi qu'il arrive, y compris sur un 501 ou un PC absent, et
 * surtout y compris quand le serveur avait RETENU le message parce que l'équipe
 * est en pause. Chris attendait alors une réaction qui ne viendrait qu'à la
 * reprise. On montre désormais `effet` tel quel — c'est ce pour quoi il existe.
 */
async function hSendInstruction() {
  const el = document.getElementById('hInstrInput');
  const texte = (el.value || '').trim();
  if (!texte || !hMissionCourante) return;
  const id = hMissionCourante.id;
  const res = await HarnessAPI.sendMissionInstruction(id, texte);
  // ☠ Le champ n'est vidé qu'APRÈS un accusé : un ordre refusé effaçait quand
  // même ce que Chris venait d'écrire au pouce, sans moyen de le récupérer.
  if (res.erreur) { showToast(res.erreur, 'err'); return; }
  el.value = '';
  el.style.height = 'auto';
  await hRenderMissionDetail(id);
  showToast(res.effet || 'Instruction transmise à l’équipe', 'accent');
}

async function hPauseOneMission(id) {
  const res = await HarnessAPI.getMission(id);
  const m = res.data;
  if (!m) return;
  const enPause = m.state === 'paused';
  const r = enPause ? await HarnessAPI.resumeMission(id) : await HarnessAPI.pauseMission(id);
  HSheets.fermer();
  // Un ordre non transmis cru transmis est le pire cas : il s'affiche, et rien
  // n'est rafraîchi derrière — l'écran ne doit pas suggérer un changement d'état.
  if (r.erreur) { showToast(r.erreur, 'err'); return; }
  if (typeof hRenderParc === 'function') await hRenderParc();
  await hRenderMissionDetail(id);
  showToast(r.effet || (enPause ? 'Équipe reprise' : 'Équipe mise en pause'), enPause ? 'ok' : 'warn');
}

/**
 * ☠ SEUL geste irréversible de cette page : la session meurt avec tout son
 * contexte. Il passe donc par une confirmation, alors que couper le tour n'en
 * demande aucune — c'est précisément ce qui doit les distinguer sous le pouce.
 *
 * ☠ La feuille est fermée AVANT le dialogue : `.hsheet-root` est en z-index 90
 * et le dialogue en 50, une confirmation ouverte par-dessus une feuille se
 * serait affichée DERRIÈRE elle. Même ordre que `hRunInspection`.
 */
async function hTerminateMission(id) {
  HSheets.fermer();
  // Le libellé reprend MOT POUR MOT celui du bouton qu'on vient de toucher :
  // une confirmation qui renomme l'action fait douter de ce qu'on confirme.
  const ok = await hConfirmer(
    'Terminer cette équipe ?',
    'La session est tuée et son contexte perdu — le worktree et le travail sur disque restent intacts. '
    + 'Pour seulement reprendre la main sur un lead parti de travers, coupe le tour depuis le composer.',
    'Terminer l’équipe',
  );
  if (!ok) return;
  const r = await HarnessAPI.terminateMission(id);
  if (r.erreur) { showToast(r.erreur, 'err'); return; }
  if (typeof hRenderParc === 'function') await hRenderParc();
  await hRenderMissionDetail(id);
  showToast('Équipe terminée — worktree conservé', 'warn');
}

/**
 * Coupe le TOUR en cours du lead sans toucher à l'équipe.
 *
 * ☠ AUCUNE confirmation, et c'est délibéré : rien n'est détruit, la session
 * garde son contexte et se relance sur la prochaine instruction. Demander à
 * confirmer l'aurait mis au même rang que l'arrêt d'équipe, qui, lui, ne se
 * rattrape pas — deux gestes qui se ressemblent finissent par se confondre.
 */
async function hInterruptMission(id) {
  const r = await HarnessAPI.interruptMission(id);
  if (r.erreur) { showToast(r.erreur, 'err'); return; }
  await hRenderMissionDetail(id);
  showToast(r.effet || 'Tour interrompu — la session reste vivante', 'warn');
}

/**
 * Lance une inspection réelle et, sur un verdict de boucle, DEMANDE quoi faire.
 *
 * ☠ L'inspection ne coupe jamais d'elle-même : on clique ce bouton quand on
 * doute, pas quand on veut tuer. Décliner est un choix légitime, et il s'écrit —
 * « j'ai vu et j'assume » ne doit pas se lire comme « je n'ai pas regardé ».
 */
async function hRunInspection(id) {
  HSheets.fermer();
  showToast('Inspection en cours — le juge examine les derniers tours…', 'accent');
  const res = await HarnessAPI.runInspection(id);
  if (!res.ok) { showToast(res.erreur || 'Inspection impossible', 'err'); return; }
  const insp = res.inspection || {};
  const v = insp.lastVerdict;

  // ☠ On se fie à `attendArbitrage`, dérivé côté serveur, jamais à une
  // comparaison locale sur le verdict : lui seul sait si la décision est encore
  // ouverte. Recalculer ici ferait redemander l'arbitrage d'une boucle déjà
  // tranchée.
  if (!insp.attendArbitrage) {
    showToast(`Juge d'inspection : ${v} — ${insp.motif || 'sans détail'}`, v === 'progres' ? 'ok' : 'warn');
    void hRafraichirApresInspection(id);
    return;
  }

  const arreter = await hConfirmer(
    'Boucle détectée',
    `${insp.motif || 'Le juge conclut à une boucle.'}\n\nArrêter l’équipe ? Tu peux aussi la laisser continuer — ton choix sera enregistré.`,
    'Arrêter l’équipe',
  );
  const r = await HarnessAPI.decideInspection(id, arreter ? 'confirme' : 'decline');
  if (!r.ok) { showToast(r.erreur || 'Décision non enregistrée', 'err'); return; }
  showToast(arreter ? 'Équipe arrêtée sur verdict de boucle' : 'Poursuite assumée — le verdict reste consigné', arreter ? 'err' : 'warn');
  void hRafraichirApresInspection(id);
}

/** Les deux vues qui portent l'état d'inspection, remises à jour ensemble. */
async function hRafraichirApresInspection(id) {
  if (typeof hRenderParc === 'function') await hRenderParc();
  await hRenderMissionDetail(id);
}

async function hCopierId(id) {
  try {
    await navigator.clipboard.writeText(id);
    showToast('Identifiant copié — utilisable tel quel avec le master', 'accent');
  } catch {
    showToast('Copie refusée par le navigateur', 'warn');
  }
}

function hRepondrePermission() {
  // Le harness résout les autorisations par son propre canal (H-64) ; l'écran
  // ne fait que les montrer. Ne rien prétendre plutôt que faire semblant.
  showToast('Les autorisations se répondent depuis la vue Autorisations', 'warn');
}

// ------------------------------------------------ mise à jour sans clignotement
//
// ☠ Réécrire toute la page toutes les 4 s EST le clignotement traqué le 23/07.
// La boucle compare d'abord et ne touche au DOM que si quelque chose a bougé.
// Le fil, lui, est reconstruit d'un bloc quand il change — mais SEULEMENT alors :
// le regroupement en valises rend l'ajout incrémental faux, puisqu'un outil de
// plus change le libellé de la dernière valise (« Ran 6 » → « Ran 7 »).

let hMissionRendue = null;

function hEmpreinteMission(m) {
  return [m.state, m.model, m.ctx, m.cost, m.sessionId, m.worktree, m.epoch, m.retries,
    m.blockedSince, m.pausedAgo, m.idleAgo, m.doneAgo, (m.subagents || []).length].join('|');
}

async function hMajMissionDetail(id) {
  if (!hMissionRendue || hMissionRendue.id !== id) return false;
  const corps = document.getElementById('hMissionBody');
  if (!corps || !corps.firstChild) return false;
  const res = await HarnessAPI.getMission(id);
  const m = res.data;
  if (!m) return false;
  hMissionCourante = m;

  const empreinte = hEmpreinteMission(m);
  if (empreinte !== hMissionRendue.empreinte) {
    document.getElementById('hMissionSub').innerHTML = hSousTitre(m);
    // `m.state` fait partie de l'empreinte : la barre suit donc la pause, la
    // reprise et la fin d'équipe sans sondage supplémentaire.
    hMajDockActes(m);
    hMissionRendue.empreinte = empreinte;
  }

  // ☠ Comparé SEGMENT PAR SEGMENT, jamais par la longueur du feed : deux
  // événements peuvent enrichir une valise existante sans en créer de nouvelle
  // (un résultat d'outil qui rejoint son appel), et le contraire est vrai aussi.
  const zone = hZoneFilMission();
  // « Collé en bas » à 80 px près : ne rattraper le défilement que si on suivait.
  const suivait = zone ? zone.scrollHeight - zone.scrollTop - zone.clientHeight < 80 : true;
  if (hMajSegments(corps, m)) {
    hMissionRendue.feedLen = m.feed.length;
    if (suivait) hDefilerEnBas();
  }
  return true;
}

// ------------------------------------------------------------------ saisie
//
// ☠ Câblé une seule fois au chargement, sur un élément qui n'est jamais recréé :
// le brancher dans le rendu ajouterait un écouteur à chaque rafraîchissement.
document.addEventListener('DOMContentLoaded', () => {
  hObserverDock();
  const el = document.getElementById('hInstrInput');
  if (!el) return;
  el.addEventListener('input', () => {
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  });
  el.addEventListener('keydown', (e) => {
    // Entrée envoie, Maj+Entrée passe à la ligne — la convention de l'app.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      hSendInstruction();
    }
  });
});


/** Copie le texte rendu de la parole survolée. */
async function hCopierParole(bouton) {
  const say = bouton.closest('.h-say-wrap')?.querySelector('.h-say');
  if (!say) return;
  try {
    await navigator.clipboard.writeText(say.innerText.trim());
    showToast('Copié', 'ok');
  } catch {
    showToast('Copie refusée par le navigateur', 'warn');
  }
}
