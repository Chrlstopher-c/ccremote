// ============ HARNESS — vue Orchestrateur (multi-conversations + streaming) ============
// Chaque conversation est une session Agent SDK indépendante (type ChatGPT,
// décidé le 23/07). La persistance vit côté serveur : un rechargement dur relit
// le fil, rien n'est perdu. Le « streaming » = sondage de /events?since=curseur ;
// chaque bloc SDK (réflexion, outil, texte) arrive comme un événement distinct.
// H-61 : l'orchestrateur ne crée jamais une équipe seul — il propose un mandat.

let hModelsCache = [];

// État de la vue conversation. Un seul fil ouvert à la fois ; le polling ne tourne
// que pendant une génération.
// ☠ `barreSig` : la barre n'est réécrite que si son contenu change RÉELLEMENT.
// Réécrire innerHTML à chaque sondage faisait re-jouer les animations d'entrée —
// c'est ce qui donnait l'impression que tout clignotait pendant l'auto-refresh.
const hOrch = { convId: null, cursor: 0, generating: false, timer: null, cur: null, list: [], barreSig: '', partielEl: null, mandats: {} };
const HORCH_KEY = 'ccremote.orch.conv';
const HORCH_POLL_MS = 400;
// ☠ LE FIL NE DORT PLUS. Le sondage ne tournait QUE pendant une génération :
// tout ce que le harness pousse de son propre chef — fin d'équipe, notification
// remise dans le fil, réveil d'autonomie — n'apparaissait qu'après un
// rafraîchissement manuel de la page. C'est le défaut le plus visible au
// quotidien : on regarde un fil qui ne bouge plus alors que l'équipe a rendu.
// Deux cadences, parce qu'un fil qu'on ne regarde pas n'a pas besoin de la même
// fraîcheur qu'un fil ouvert sous les yeux.
const HORCH_VEILLE_MS = 4000;
const HORCH_VEILLE_CACHEE_MS = 15000;

// ---- cycle de vie de la vue -------------------------------------------------
async function hInitOrchestrateur() {
  await hRenderModelSelector();
  await hLoadConvList();
  const saved = localStorage.getItem(HORCH_KEY);
  const cible = (hOrch.list.find((c) => c.id === saved) ? saved : (hOrch.list[0] && hOrch.list[0].id)) || null;
  if (cible) await hOpenConversation(cible);
  else await hNewConversation();
}

/**
 * Le fil demandé est-il DÉJÀ à l'écran, avec son contenu ?
 *
 * ☠ `switchView` rappelle `hInitOrchestrateur()` à chaque entrée dans la vue.
 * Sans cette garde, revenir du Parc vidait le chat et le reconstruisait
 * intégralement : toutes les balises dépliées se refermaient, et le fil rejouait
 * ses animations d'entrée. Mesuré le 02/08 — un aller-retour Parc → conversation
 * suffisait à perdre ce qu'on venait d'ouvrir.
 */
function hFilDejaAffiche(id) {
  if (hOrch.convId !== id) return false;
  const chat = document.getElementById('hChatBody');
  return !!chat && chat.querySelector('[data-seq]') !== null;
}

// ☠ Compat : core.js appelait hRenderGauges. On garde le nom mais il route
// désormais vers l'init multi-conversations (les jauges globales ont disparu au
// profit du contexte par fil).
function hRenderGauges() { hInitOrchestrateur(); }

// ---- liste des conversations ------------------------------------------------
async function hLoadConvList() {
  const r = await HarnessAPI.getConversations();
  if (r.erreur) { hRenderConvBar([], r.erreur); return; }
  hOrch.list = r.data || [];
  hRenderConvBar(hOrch.list);
}

function hRenderConvBar(list, erreur) {
  // ☠ AVANT toute sortie anticipée : la barre d'onglets a été supprimée, donc
  // `hConvBar` n'existe plus et la fonction sortait aussitôt — emportant avec
  // elle la mise à jour du titre et de la liste latérale, qui étaient en fin de
  // corps. Le titre serait resté figé sur le premier fil ouvert, sans erreur.
  if (typeof hMajBarreOrch === 'function') hMajBarreOrch();
  if (typeof hRenderFils === 'function') hRenderFils();
  const bar = document.getElementById('hConvBar');
  if (!bar) return;
  if (erreur) {
    bar.innerHTML = `<span style="font-size:11px;color:var(--err);">${escapeHtml(erreur)}</span>`;
    hOrch.barreSig = 'err:' + erreur;
    return;
  }
  // ☠ Signature de l'état affiché : sans ce garde, chaque sondage réécrivait la
  // barre à l'identique et faisait clignoter les pastilles.
  // ☠ `contextPct` est VOLONTAIREMENT hors signature : il bouge à chaque mesure,
  // et l'inclure faisait réécrire la barre en boucle — donc clignoter les
  // pastilles et casser toute sélection de texte en cours.
  const sig = JSON.stringify([hOrch.convId, list.map((c) => [c.id, c.titre, c.active, c.machine])]);
  if (sig === hOrch.barreSig) return;
  hOrch.barreSig = sig;
  const chips = list.map((c) => {
    const active = c.id === hOrch.convId;
    const ctx = (typeof c.contextPct === 'number') ? ` · contexte ${c.contextPct} %` : '';
    // ☠ La machine apparaît dans l'infobulle plutôt que sur la pastille : elle
    // ne change jamais, et l'écrire en clair mangerait la largeur du titre.
    const mach = c.machine ? ` · machine ${c.machine}` : '';
    return `<div class="conv-chip ${active ? 'active' : ''}" onclick="hOpenConversation('${c.id}')" title="${escapeHtml(c.titre)}${ctx}${escapeHtml(mach)}">
      ${c.active ? '<span class="dot"></span>' : ''}
      <span class="lbl">${escapeHtml(c.titre)}</span>
      ${active ? `<span class="x" onclick="event.stopPropagation();hArchiveConversation('${c.id}')">×</span>` : ''}
    </div>`;
  }).join('');
  bar.innerHTML = chips + `<button class="conv-new" onclick="hNewConversation()">+ Nouveau</button>`;
}

async function hNewConversation() {
  // ☠ La machine est demandée AVANT la création : elle est fixée à la création du
  // fil et ne bouge plus tant qu'il porte une équipe vivante (arbitré le 01/08).
  // La question n'est POSÉE que si plusieurs machines sont en ligne, mais
  // `hChoisirMachine` rend quand même l'identifiant de l'unique machine quand il
  // n'y en a qu'une : un fil créé sans machine devient irroutable dès que la
  // seconde s'allume (prod, 02/08).
  let machine = '';
  try {
    const rm = await HarnessAPI.getMachines();
    machine = await hChoisirMachine((rm && rm.data) || []);
  } catch (e) {
    // Une liste de machines indisponible ne doit pas empêcher d'ouvrir un fil :
    // le routage tranchera, ou refusera en le disant.
    machine = '';
  }
  if (machine === null) return; // annulé
  const r = await HarnessAPI.createConversation(undefined, machine);
  if (!r.ok || !r.conversation) { showToast(r.erreur || 'Création impossible', 'warn'); return; }
  await hLoadConvList();
  await hOpenConversation(r.conversation.id);
  const el = document.getElementById('hOrchInput'); if (el) el.focus();
  // ☠ Créer sans ouvrir laisserait l'opérateur sur la liste, devant un fil vide
  // qu'il doit re-cliquer. On entre dedans.
  if (typeof hApresNouveauFil === 'function') hApresNouveauFil();
}

/** Confirmation obligatoire : une conversation supprimée ne se retrouve pas dans l'interface. */
function hArchiveConversation(id) {
  const conv = hOrch.list.find((c) => c.id === id);
  const titre = conv ? conv.titre : 'cette conversation';
  confirmAction(
    'Supprimer la conversation',
    `« ${titre} » sera retirée de la liste et sa session fermée. L'historique reste en base, mais tu ne pourras plus y revenir depuis l'interface. Continuer ?`,
    () => hArchiveConversationConfirme(id),
    { danger: true },
  );
}

async function hArchiveConversationConfirme(id) {
  const r = await HarnessAPI.archiveConversation(id);
  if (!r.ok) { showToast(r.erreur || 'Suppression impossible', 'warn'); return; }
  if (hOrch.convId === id) { hStopPoll(); hOrch.convId = null; }
  hOrch.barreSig = ''; // force le redessin : la liste a changé
  await hLoadConvList();
  const suivant = hOrch.list[0] && hOrch.list[0].id;
  if (suivant) await hOpenConversation(suivant); else await hNewConversation();
  showToast('Conversation supprimée', 'ok');
}

// ---- indicateurs de tête : contexte + compactions ---------------------------
function hRenderStats(d) {
  const el = document.getElementById('hOrchStats');
  if (!el) return;
  const pct = (d && typeof d.contextPct === 'number') ? d.contextPct : null;
  const nb = (d && typeof d.compactions === 'number') ? d.compactions : 0;

  // ☠ La structure n'est construite QU'UNE FOIS. Ensuite on ne touche que les
  // valeurs qui changent réellement. Réécrire innerHTML à chaque sondage faisait
  // clignoter l'en-tête et, pire, effondrait la sélection de texte en cours :
  // modifier un nœud pendant un glisser-sélectionner fait sauter la sélection
  // sur toute la page.
  if (!el.firstElementChild) {
    el.innerHTML = `
      <div class="ostat" id="hStatCtx">
        <span class="ok">Contexte</span>
        <span class="ov">—</span>
        <span class="obar"><i style="width:0%"></i></span>
      </div>
      <div class="ostat">
        <span class="ok">Compactages</span>
        <span class="ov">0</span>
        <button onclick="hCompacterMaintenant()" title="Compacter le contexte de ce fil">Compacter</button>
      </div>`;
  }

  const boite = el.firstElementChild;
  const valeurCtx = pct === null ? '—' : pct + ' %';
  const champCtx = boite.querySelector('.ov');
  if (champCtx.textContent !== valeurCtx) champCtx.textContent = valeurCtx;
  const barre = boite.querySelector('.obar i');
  const largeur = (pct === null ? 0 : pct) + '%';
  if (barre.style.width !== largeur) barre.style.width = largeur;
  const classe = 'ostat' + (pct === null ? '' : pct >= 75 ? ' crit' : pct >= 50 ? ' warn' : '');
  if (boite.className !== classe) boite.className = classe;

  const bloc2 = el.lastElementChild;
  const champNb = bloc2.querySelector('.ov');
  if (champNb.textContent !== String(nb)) champNb.textContent = String(nb);
  const bouton = bloc2.querySelector('button');
  if (bouton.disabled !== hOrch.generating) bouton.disabled = hOrch.generating;
}

/**
 * Commandes traitées localement par le harness. Rend `true` si le texte en était
 * une (auquel cas il n'est PAS envoyé au modèle).
 */
function hCommandeLocale(texte) {
  const cmd = texte.toLowerCase();
  if (cmd === '/compact' || cmd === '/compacter') { hCompacterMaintenant(); return true; }
  if (cmd === '/help' || cmd === '/aide') {
    showToast('Commandes : /compact — compacte le contexte de ce fil.', 'accent');
    return true;
  }
  return false;
}

/** Compaction manuelle — bouton, ou commande /compact dans le champ de saisie. */
async function hCompacterMaintenant() {
  if (!hOrch.convId) return;
  showToast('Compaction en cours — résumé du fil…', 'accent');
  const r = await HarnessAPI.compactConversation(hOrch.convId);
  if (!r.ok) { showToast(r.erreur || 'Compaction impossible', 'warn'); return; }
  // ☠ `compacted:false` n'est pas une erreur (rien à compacter, tour en cours) :
  // on affiche le motif réel plutôt qu'un succès de façade.
  showToast(r.effet || 'Compaction terminée', r.compacted ? 'ok' : 'warn');
  if (r.compacted) await hOpenConversation(hOrch.convId);
}

async function hApprouverMandat(id) {
  const carte = document.getElementById('hMandate_' + id);
  if (carte) carte.classList.add('resolved');
  showToast('Autorisation transmise — création de l\'équipe…', 'accent');
  const r = await HarnessAPI.approveMandat(id);
  if (!r.ok) {
    // ☠ Ne PAS réarmer les boutons quand le mandat a déjà été tranché : le
    // clic suivant échouerait exactement pareil. Mesuré le 01/08 — mandat
    // auto-approuvé, carte restée vivante, clic 16 s trop tard. On tamponne
    // ce qui s'est réellement passé au lieu de proposer de recommencer.
    if (hMandatDejaTranche(r.erreur)) {
      hTamponMandat(id, 'Déjà autorisée — équipe lancée', 'var(--ok)');
      showToast(r.erreur, 'warn');
      if (typeof hRenderParc === 'function') hRenderParc();
      return;
    }
    if (carte) carte.classList.remove('resolved');
    showToast(r.erreur || 'Dispatch impossible', 'warn');
    return;
  }
  hTamponMandat(id, 'Autorisée — équipe lancée', 'var(--ok)');
  // Un identifiant de session brut n'apprend rien à l'opérateur : on annonce
  // l'effet, le détail technique reste dans les logs.
  showToast('Équipe lancée — visible dans le Parc', 'ok');
  if (typeof hRenderParc === 'function') hRenderParc();
}

/**
 * Retire ses boutons à toute carte de mandat qui n'est plus en attente.
 *
 * ☠ La carte était un instantané figé. `hOrch.mandats` n'était rechargé que
 * lorsqu'un NOUVEAU mandat apparaissait dans le fil — jamais quand un mandat
 * existant changeait d'état. Or le harness auto-approuve : mesuré le 01/08, une
 * fenêtre d'1,5 s entre la création et l'approbation automatique, le sondage est
 * tombé dedans, et l'écran a gardé pendant seize secondes un bouton « Autoriser
 * et lancer » sur une équipe déjà partie. Un bouton doit disparaître quand la
 * décision qu'il propose n'existe plus.
 */
const HMANDAT_RELANCES_MAX = 5;
const HMANDAT_RELANCE_MS = 4000;

async function hRafraichirMandats(restantes = HMANDAT_RELANCES_MAX) {
  const cartes = [...document.querySelectorAll('[id^="hMandate_"]')].filter((c) => !c.classList.contains('resolved'));
  if (cartes.length === 0) return;
  const props = await HarnessAPI.getPropositions();
  if (props.erreur) return; // control plane muet : on ne tranche rien sur une absence
  const enAttente = new Set((props.data || []).map((p) => p.id));
  hOrch.mandats = {};
  for (const p of (props.data || [])) hOrch.mandats[p.id] = p;
  let vivantes = 0;
  for (const carte of cartes) {
    const id = carte.id.slice('hMandate_'.length);
    if (enAttente.has(id)) { vivantes += 1; continue; }
    hTamponMandat(id, 'Déjà tranchée — voir le Parc', 'var(--ink-3)');
  }
  // ☠ Relance BORNÉE : l'auto-approbation peut tomber après la fin du tour, et
  // le sondage du fil, lui, s'arrête là. Sans ces quelques passages la carte
  // resterait vivante pour toujours. Bornée, parce qu'une carte légitimement en
  // attente du clic de Chris ne doit pas faire tourner une boucle sans fin.
  if (vivantes > 0 && restantes > 1) {
    setTimeout(() => { void hRafraichirMandats(restantes - 1); }, HMANDAT_RELANCE_MS);
  }
}

/** Le refus du serveur dit-il « c'était déjà tranché » ? (409 côté control plane) */
function hMandatDejaTranche(message) {
  return /déjà (été )?(autorisé|approuv|refus|tranché)/i.test(String(message || ''));
}

async function hRefuserMandat(id) {
  const r = await HarnessAPI.rejectMandat(id);
  if (!r.ok) { showToast(r.erreur || 'Refus impossible', 'warn'); return; }
  hTamponMandat(id, 'Refusée — aucune équipe créée', 'var(--err)');
  showToast('Mandat refusé', 'warn');
}

function hTamponMandat(id, libelle, couleur) {
  const carte = document.getElementById('hMandate_' + id);
  if (!carte) return;
  carte.classList.add('resolved');
  const t = document.createElement('div');
  t.className = 'verdict-stamp';
  t.style.color = couleur;
  t.textContent = libelle + ' à ' + new Date().toTimeString().slice(0, 8);
  carte.appendChild(t);
  delete hOrch.mandats[id];
}

// ---- ouverture + rendu complet d'un fil ------------------------------------
async function hOpenConversation(id) {
  // ☠ Reprise, pas reconstruction : on reprend le sondage là où il en était.
  if (hFilDejaAffiche(id)) {
    hStopPoll();
    hMajBarreOrch();
    void hPollNow();
    return;
  }
  hStopPoll();
  hOrch.convId = id; hOrch.cursor = 0; hOrch.cur = null; hOrch.partielEl = null;
  localStorage.setItem(HORCH_KEY, id);
  hRenderConvBar(hOrch.list);
  const chat = document.getElementById('hChatBody');
  chat.innerHTML = '';
  // ☠ Les mandats en attente sont chargés AVANT le rendu : une carte rendue sans
  // sa proposition n'afficherait aucun bouton, et l'opérateur ne pourrait rien
  // autoriser — exactement le blocage qu'on corrige.
  const props = await HarnessAPI.getPropositions();
  hOrch.mandats = {};
  for (const p of (props.data || [])) hOrch.mandats[p.id] = p;
  const r = await HarnessAPI.getConversation(id);
  if (id !== hOrch.convId) return; // l'utilisateur a changé de fil pendant l'attente
  if (r.erreur) { chat.innerHTML = `<div class="conv-empty">${escapeHtml(r.erreur)}</div>`; return; }
  const d = r.data || {};
  (d.events || []).forEach(hAppendEvent);
  hOrch.cursor = d.cursor || 0;
  hOrch.generating = !!d.generating;
  // ☠ On ROUVRE sur ce que ce fil utilisait, pas sur les défauts. L'interface
  // retombait sur Opus 4.8 / high à chaque rafraîchissement, en contradiction
  // avec le message affiché juste au-dessus — et il fallait re-régler à chaque
  // fois (friction remontée le 23/07). Un fil VIERGE n'a pas de mémoire : c'est
  // alors, et alors seulement, que les défauts s'appliquent.
  if (d.model) {
    HarnessState.orchModel.model = d.model;
    if (d.effort) HarnessState.orchModel.effort = d.effort;
    // ☠ `!== null` et JAMAIS un test de véracité : `false` est un choix explicite
    // du fil (« mode rapide coupé »), et un `if (d.fastMode)` le perdrait à
    // chaque réouverture pour le confondre avec « jamais tranché ».
    if (d.fastMode !== null && d.fastMode !== undefined) HarnessState.orchModel.fastMode = d.fastMode;
    hSyncSelecteursModele();
  }
  if (!d.events || d.events.length === 0) {
    chat.innerHTML = `<div class="conv-empty"><div class="ce-t">Nouvelle conversation</div>Écris à l'orchestrateur — sa session démarre au premier message.</div>`;
  }
  hRenderPartiel(d.partial || null);
  hShowTyping(hOrch.generating && !(d.partial && d.partial.contenu));
  // ☠ Le bouton suit l'état de génération À CHAQUE rafraîchissement, jamais
  // seulement à l'envoi : un tour peut se terminer, être coupé, ou repartir sur
  // une notification du harness sans que l'opérateur ait rien fait.
  hMajBoutonEnvoi();
  hRenderStats(d);
  // ☠ `hBrancherFilBas` et pas seulement `hScrollChat` : à l'ouverture d'un fil
  // ancien, il faut à la fois arriver EN BAS et disposer de la flèche pour y
  // revenir. Le calage est fait après le rendu complet, sinon la hauteur totale
  // n'est pas encore connue et le fil s'arrête au milieu.
  hBrancherFilBas();
  // ☠ Le sondage démarre TOUJOURS, generation ou pas : c'est lui qui apporte ce
  // que le harness pousse de lui-même (fin d'équipe, rappel, réveil). Il choisit
  // sa cadence tout seul — rapide pendant un tour, en veille sinon.
  hStartPoll();
  void hRattacherFilSansMachine(id);
}

/**
 * Fil sans machine + plusieurs machines en ligne ⇒ on POSE la question ici,
 * plutôt que de laisser le fil échouer sur chaque action.
 *
 * ☠ Ce cas n'est pas théorique : un fil ouvert la veille, quand seul le VPS
 * tournait, s'est retrouvé irroutable dès l'allumage du PC — l'orchestrateur
 * refusait tout dispatch avec « aucune machine précisée et plusieurs sont en
 * ligne », sans le moindre geste offert pour en sortir (prod, 02/08). La
 * question est posée UNE fois, à l'ouverture, avant que l'opérateur écrive.
 */
async function hRattacherFilSansMachine(id) {
  const fil = (hOrch.list || []).find((c) => c.id === id);
  if (!fil || fil.machine) return;
  let machines = [];
  try {
    const rm = await HarnessAPI.getMachines();
    machines = (rm && rm.data) || [];
  } catch (e) { return; }
  if (machines.filter((m) => m.enLigne).length < 2) return; // le routage tranche seul, et l'adoption écrit son choix
  const choix = await hChoisirMachine(machines);
  if (!choix || id !== hOrch.convId) return;
  const r = await HarnessAPI.setConversationMachine(id, choix);
  if (!r.ok) { showToast(r.erreur || 'Rattachement impossible', 'warn'); return; }
  await hLoadConvList();
  showToast(`Fil rattaché à ${choix}`, 'ok');
}

// ---- rendu incrémental d'un événement (le cœur du streaming) ---------------
// ☠ Aucun nœud n'est jamais recréé ni réécrit : chaque événement est posé une
// fois, identifié par son `seq`. C'est ce qui supprime le clignotement — et ce
// qui permet au bloc partiel de grandir en place, token après token.
function hEnsureAssistant(chat) {
  if (hOrch.cur && hOrch.cur.isConnected) return hOrch.cur;
  const a = document.createElement('div'); a.className = 'bubble-a msg-wrap'; a.dataset.menu = 'parole';
  // Copie tout le texte rendu du groupe (hors réflexion repliée et outils).
  // ☠ `.h-say` depuis le passage au vocabulaire de la page mission : le sélecteur
  // `.md` seul ne trouvait plus rien et le bouton copiait une chaîne vide.
  a.appendChild(hBoutonCopier(() => [...a.querySelectorAll('.h-say, .md')].map((n) => n.innerText).join('\n\n').trim()));
  // ☠ L'instant de DÉPART du tour est retenu dès l'ouverture du groupe : la
  // durée affichée est le temps de réponse vu par l'opérateur — de sa question
  // au dernier mot rendu. La calculer entre le premier et le dernier bloc de la
  // réponse cacherait précisément l'attente qu'on veut mesurer.
  a.dataset.debut = String(hOrch.dernierEnvoiAt || Date.now());
  chat.appendChild(a); hOrch.cur = a; return a;
}

/**
 * Pose ou met à jour le pied d'un groupe de réponse : heure de fin + durée du
 * tour. Rappelé à chaque évènement — le pied suit la réponse qui s'allonge.
 */
function hMajPiedGroupe(groupe, at) {
  if (!groupe || !window.HTemps) return;
  const debut = Number(groupe.dataset.debut);
  const fin = Number.isFinite(at) ? at : Date.now();
  groupe.dataset.fin = String(fin);
  const pied = window.HTemps.pied(fin, Number.isFinite(debut) && fin > debut ? fin - debut : null);
  if (!pied) return;
  groupe.querySelector(':scope > .msg-pied')?.remove();
  groupe.appendChild(pied);
}
function hToolLabel(name) { const p = String(name).split('__'); return p[p.length - 1] || String(name); }

/**
 * Rend le Markdown d'une réponse. Réutilise `renderMarkdown` (chat.js) —
 * marked + DOMPurify, déjà chargés par l'app — plutôt qu'un second moteur.
 * `☠` Le repli de `renderMarkdown` échappe le texte si les libs manquent : le
 * contenu du modèle n'atteint donc JAMAIS le DOM sans passer par un assainissement.
 */
function hMd(texte) {
  // Garde d'indépendance : si chat.js n'était pas chargé, on affiche du texte
  // échappé plutôt que de casser toute la vue.
  if (typeof renderMarkdown !== 'function') return escapeHtml(texte || '');
  return renderMarkdown(texte || '');
}

/** Écrit le Markdown dans un nœud, en gardant le curseur de frappe à la fin. */
function hPeindreTexte(noeud, contenu, live) {
  noeud.innerHTML = hMd(contenu);
  if (!live) return;
  const c = document.createElement('span'); c.className = 'orch-cursor';
  // Collé à la fin du dernier bloc pour que le curseur suive le texte, pas la marge.
  (noeud.lastElementChild || noeud).appendChild(c);
}

/**
 * Construit le nœud d'un bloc. `live` = bloc encore en cours de frappe.
 * `☠` Réutilise les classes du chat (`.think`, `.tool`, `.md`, `.codeblock`) —
 * même ADN visuel, une seule définition à maintenir.
 */
// ── Groupe d'appels d'outils ────────────────────────────────────────────────
// ☠ Troisième rendu en un jour, et seul celui-ci tient. D'abord des blocs pleine
// largeur empilant du JSON brut — illisibles. Puis une timeline à filet vertical
// — compacte, mais une ligne de bruit par appel quand même. Le rendu retenu
// (celui de Claude) traite le vrai problème : les appels CONSÉCUTIFS sont
// regroupés sous un seul résumé, et la carte ne s'ouvre que si on veut le
// détail. Sur un tour à huit outils, on lit une ligne au lieu de huit.

/**
 * Libellé humain d'un appel. `☠` `mcp__ccremote-controle__lister_equipes` ne dit
 * rien à la lecture : on garde le verbe, et le nom technique reste dans le
 * détail pour qui le cherche.
 */
function hOutilLisible(nom, detail) {
  const court = hToolLabel(nom).replace(/_/g, ' ');
  const titre = court.charAt(0).toUpperCase() + court.slice(1);
  if (!detail) return titre;
  // Un premier paramètre parlant vaut mieux qu'un JSON tronqué au hasard.
  try {
    const o = JSON.parse(detail);
    const cle = ['projet', 'chemin', 'missionId', 'equipe', 'query', 'titre'].find((k) => typeof o[k] === 'string');
    return cle ? `${titre} · ${String(o[cle]).split('/').pop()}` : titre;
  } catch { return titre; }
}

/**
 * Familles d'outils, pour résumer un groupe en langage naturel.
 * ☠ L'ordre compte : le premier motif qui matche gagne. `suivre_equipe` doit
 * donc être testé avant le motif générique `equipe`, sinon un suivi se lirait
 * comme une action sur le parc.
 */
const H_FAMILLES = [
  { re: /^(lister_equipes|etat_equipe|rapport_equipe|suivre_equipes?|carburant_parc|historique_equipe|mon_autonomie)$/, verbe: 'Consulté', quoi: 'le parc' },
  { re: /^(lister_projets|explorer_projets|rechercher_projets|lire_fichier)$/, verbe: 'Exploré', quoi: 'les projets' },
  { re: /^creer_equipe$/, verbe: 'Proposé', quoi: 'un mandat' },
  { re: /^(envoyer_a_equipe|interrompre_equipe|arreter_equipe|relancer_equipe|definir_budget)$/, verbe: 'Agi', quoi: 'sur une équipe' },
  { re: /^(programmer_rappel|mes_rappels|modifier_rappel|supprimer_rappel|mettre_rappel_en_pause|reprendre_rappel)$/, verbe: 'Géré', quoi: 'les rappels' },
  { re: /^nommer_fil$/, verbe: 'Nommé', quoi: 'ce fil' },
  { re: /^(WebSearch|WebFetch)$/, verbe: 'Cherché', quoi: 'sur le web' },
  { re: /^(Read|Grep|Glob)$/, verbe: 'Lu', quoi: 'des fichiers' },
];

/** Accord du complément quand une famille est appelée plusieurs fois. */
function hFamilleDe(nom) {
  const court = hToolLabel(nom);
  return H_FAMILLES.find((f) => f.re.test(court)) ?? { verbe: 'Utilisé', quoi: 'un outil' };
}

/**
 * Résumé d'un groupe — la seule ligne visible au repos.
 *
 * ☠ Résumé SÉMANTIQUE, pas un compteur : « 5 appels d'outils » n'apprend rien.
 * On dit ce qui a été fait, par famille — « Consulté le parc, proposé un
 * mandat » — avec le verbe en avant et le complément en retrait, comme dans le
 * rendu de Claude. Le détail exact reste à un clic.
 *
 * ☠ Les échecs sont comptés à part et signalés : un échec doit se voir AVANT
 * d'ouvrir la carte, sinon il se lit comme un appel réussi.
 */
function hResumeGroupe(carte) {
  const lignes = [...carte.querySelectorAll('.tc-ligne')];
  const echecs = lignes.filter((l) => l.classList.contains('err')).length;
  // Regroupe par famille en PRÉSERVANT l'ordre d'appel : c'est l'ordre dans
  // lequel l'orchestrateur a travaillé, et il raconte quelque chose.
  const parFamille = [];
  for (const ligne of lignes) {
    const f = hFamilleDe(ligne.dataset.outil || '');
    const vu = parFamille.find((x) => x.verbe === f.verbe && x.quoi === f.quoi);
    if (vu) vu.n += 1;
    else parFamille.push({ ...f, n: 1 });
  }
  const morceaux = parFamille.map((f) => {
    const comp = f.n > 1 ? `${f.quoi} <span class="tc-n">(${f.n}×)</span>` : f.quoi;
    return `<span class="tc-v">${escapeHtml(f.verbe)}</span> <span class="tc-n">${comp}</span>`;
  });
  const err = echecs > 0 ? ` <span style="color:var(--err);">· ${echecs} en échec</span>` : '';
  return morceaux.join('<span class="tc-n">, </span>') + err;
}

/** Réécrit le résumé du groupe qui contient cette ligne. */
function hMajResumeGroupe(ligne) {
  const groupe = ligne.closest('.tc');
  const carte = groupe && groupe.querySelector('.tc-carte');
  const res = groupe && groupe.querySelector('.tc-res');
  if (carte && res) res.innerHTML = hResumeGroupe(carte);
}

/**
 * Range sur la ligne ce que l'appel a demandé et ce qu'il a rendu, puis repeint.
 * ☠ Rappelé à chaque rafraîchissement : c'est le SEUL chemin par lequel un
 * résultat arrivé APRÈS l'appel rejoint sa ligne — la garde d'idempotence de
 * `hAppendEvent` interdit de reposer le nœud.
 */
function hMajOutil(ligne, ev) {
  if (!ligne || !ev) return;
  if (ev.detail) ligne.dataset.detail = ev.detail;
  if (ev.resultat !== null && ev.resultat !== undefined) ligne.dataset.resultat = ev.resultat;
  ligne.classList.toggle('err', (ligne.dataset.resultat || '').startsWith('[ÉCHEC DE L’OUTIL]'));
  const lbl = ligne.querySelector('.tc-lbl');
  if (lbl) lbl.textContent = hOutilLisible(ligne.dataset.outil || '', ligne.dataset.detail);
  const corps = ligne.querySelector('.tc-corps');
  if (corps && corps.classList.contains('ouvert')) {
    corps.querySelector('.tc-in').innerHTML = hCorpsOutilOrch(ligne);
  }
  hMajResumeGroupe(ligne);
}

/**
 * Détail d'une ligne : les paramètres en « commande », puis la sortie.
 * ☠ `resultat` absent veut dire « pas encore revenu », jamais « vide » : on le
 * DIT. Un outil présenté comme ayant répondu du vide est un mensonge plus
 * coûteux que l'absence d'information.
 */
function hCorpsOutilOrch(ligne) {
  const d = ligne.dataset || {};
  const parts = [
    `<div class="tc-cmd"><span class="tc-inv">$</span><pre>${escapeHtml(d.outil || '')}`
    + (d.detail ? ` ${escapeHtml(d.detail)}` : '') + '</pre></div>',
  ];
  if (d.resultat === undefined) {
    parts.push('<div class="tc-attente">Résultat en attente — l’outil n’a pas encore répondu.</div>');
  } else {
    const echec = d.resultat.startsWith('[ÉCHEC DE L’OUTIL]');
    parts.push(`<div class="tc-sortie${echec ? ' err' : ''}" tabindex="0" role="group" aria-label="Sortie de l’outil">${escapeHtml(d.resultat)}</div>`);
  }
  return parts.join('');
}

/**
 * Le groupe ouvert en fin de `groupeAssistant`, ou `null`.
 * ☠ Un groupe se ferme dès que l'orchestrateur reprend la parole : les appels
 * d'APRÈS la réponse appartiennent à une autre séquence et ne doivent pas
 * rejoindre la carte précédente.
 */
function hGroupeOutilsOuvert(groupeAssistant) {
  const dernier = groupeAssistant.lastElementChild;
  return dernier && dernier.classList.contains('tc') && dernier.dataset.clos !== '1' ? dernier : null;
}

/** Ferme le groupe d'outils courant — appelé dès que l'agent reprend la parole. */
function hCloreGroupeOutils(groupeAssistant) {
  if (!groupeAssistant) return;
  const ouvert = hGroupeOutilsOuvert(groupeAssistant);
  if (ouvert) ouvert.dataset.clos = '1';
}

/** Crée la coquille d'un groupe : le résumé cliquable et sa carte repliée. */
function hCreerGroupeOutils() {
  const g = document.createElement('div');
  g.className = 'tc';
  // ☠ `.tc-in` n'est pas décoratif : la grille anime `grid-template-rows`, et
  // c'est l'enfant qui porte `overflow: hidden` et la bordure. Sans lui, le
  // contenu déborde pendant la transition et le cadre reste visible fermé.
  g.innerHTML = `<button class="tc-tete"><span class="tc-res"></span>${HValise.CHEVRON}</button>`
    + '<div class="tc-carte"><div class="tc-in"></div></div>';
  return g;
}

/**
 * Ajoute une ligne d'outil au groupe courant, en en ouvrant un si besoin.
 * Rend la ligne créée, pour que l'appelant y pose son `data-seq`.
 */
function hAjouterLigneOutil(groupeAssistant, contenu, ev) {
  const groupe = hGroupeOutilsOuvert(groupeAssistant)
    || groupeAssistant.appendChild(hCreerGroupeOutils());
  const ligne = document.createElement('div');
  ligne.className = 'tc-ligne';
  ligne.dataset.outil = contenu;
  ligne.innerHTML = `<button class="tc-btn"><span class="tc-lbl"></span>${HValise.CHEVRON}</button>`
    + '<div class="tc-corps"><div class="tc-in"></div></div>';
  groupe.querySelector('.tc-carte > .tc-in').appendChild(ligne);
  hMajOutil(ligne, ev || {});
  return ligne;
}

// ☠ Délégation unique sur le document : les cartes sont recréées à chaque rendu
// du fil, et rebrancher un écouteur par nœud fuirait à chaque passage.
document.addEventListener('click', (e) => {
  const tete = e.target.closest('.tc-tete');
  if (tete) {
    const carte = tete.parentElement.querySelector('.tc-carte');
    if (carte) {
      const ouvrir = !carte.classList.contains('ouvert');
      carte.classList.toggle('ouvert', ouvrir);
      tete.classList.toggle('ouvert', ouvrir);
    }
    return;
  }
  const btn = e.target.closest('.tc-btn');
  if (!btn) return;
  const ligne = btn.closest('.tc-ligne');
  const corps = ligne && ligne.querySelector('.tc-corps');
  if (!corps) return;
  const ouvrir = !corps.classList.contains('ouvert');
  // Rempli à l'OUVERTURE, jamais figé à la création : le résultat peut arriver
  // après, et un contenu construit d'avance afficherait « en attente » à jamais.
  if (ouvrir) corps.querySelector('.tc-in').innerHTML = hCorpsOutilOrch(ligne);
  corps.classList.toggle('ouvert', ouvrir);
  btn.classList.toggle('ouvert', ouvrir);
});

function hBlocNode(type, contenu, live, extra) {
  if (type === 'texte') {
    // ☠ Même corps que la page mission : serif, pleine largeur, aucun fond.
    // C'est ce que l'orchestrateur DIT — la seule chose qu'on vient lire.
    const d = document.createElement('div');
    d.className = 'h-say';
    hPeindreTexte(d, contenu, live);
    return d;
  }
  if (type === 'reflexion') {
    // ☠ Pendant la frappe, la réflexion reste DÉPLIÉE : c'est le seul signe
    // visible que le modèle travaille, et `hRenderPartiel` écrit dans
    // `.think-body > div`. Une fois le tour fini, `hClearPartiel` retire ce
    // nœud et l'évènement définitif repasse ici avec `live` faux — on rend
    // alors une valise, comme dans la page mission.
    if (live) {
      const d = document.createElement('div');
      d.className = 'think rounded-lg';
      d.innerHTML = `
        <div class="w-full flex items-center gap-2 px-3.5 py-2.5 text-left">
          <span class="text-[11.5px] font-medium uppercase tracking-wider" style="color: var(--ink-3);">Réflexion en cours</span>
        </div>
        <div class="think-body px-3.5 pb-3.5 pt-0"><div class="pl-5 border-l-2 text-[13px] italic leading-relaxed serif" style="border-color: var(--line-2); color: var(--ink-2);"></div></div>`;
      d.querySelector('.think-body > div').textContent = contenu;
      return d;
    }
    const cle = HValise.enregistrer(() => `<div class="h-think">${hMarkdown(contenu)}</div>`);
    return HValise.noeud(String(contenu).replace(/\s+/g, ' ').trim(), cle,
      '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2" stroke-linecap="round"/></svg>');
  }
  // ☠ `outil` n'a PAS de cas ici : une ligne d'outil n'est pas un bloc autonome,
  // elle rejoint la carte du groupe courant (`hAjouterLigneOutil`). Le rendre
  // ici produirait un nœud isolé, hors carte — c'est la différence entre huit
  // lignes en vrac et un groupe qui se replie d'un clic.
  if (type === 'erreur') {
    const e = document.createElement('div'); e.className = 'orch-err'; e.textContent = contenu;
    return e;
  }
  if (type === 'mandat') {
    const p = hOrch.mandats[contenu];
    const d = document.createElement('div');
    d.className = 'mandate-card';
    d.id = 'hMandate_' + contenu;
    if (!p) {
      // La proposition n'est plus en attente : on le dit, plutôt que d'afficher
      // des boutons qui ne feraient rien.
      d.innerHTML = `<div class="mh2">Proposition de mandat</div>
        <div class="mb"><div style="font-size:12px;color:var(--ink-3);">Déjà tranchée — voir le Parc pour l'équipe correspondante.</div></div>`;
      return d;
    }
    d.innerHTML = `<div class="mh2">Proposition de mandat — ton autorisation est requise (H-61)</div>
      <div class="mb">
        <div class="mrow"><div class="k">Projet</div><div class="v mono"></div></div>
        <div class="mrow"><div class="k">Objectif</div><div class="v"></div></div>
        <div class="mrow"><div class="k">Critère d'arrêt</div><div class="v"></div></div>
        <div class="mrow"><div class="k">Périmètre</div><div class="v mono"></div></div>
        <div class="mrow"><div class="k">Accès</div><div class="v"></div></div>
        <div class="mrow"><div class="k">Budget</div><div class="v mono">${hMoney(p.budgetMaxUsd)}</div></div>
      </div>
      <div class="macts">
        <button class="btn btn-accent" onclick="hApprouverMandat('${contenu}')">Autoriser et lancer</button>
        <button class="btn btn-ghost" style="color:var(--err);border-color:var(--err-soft);" onclick="hRefuserMandat('${contenu}')">Refuser</button>
      </div>`;
    const v = d.querySelectorAll('.mrow .v');
    v[0].textContent = p.projet;
    v[1].textContent = p.objectif;
    v[2].textContent = p.critereArret || '— non fixé';
    v[3].textContent = p.perimetre;
    // Le droit réel, pas la phrase : c'est ce qui change le plus la portée de ce
    // qu'on autorise d'un clic. Écriture = signalé, jamais discret.
    const ecrit = p.acces === 'ecriture';
    v[4].textContent = ecrit ? 'Lecture et écriture' : 'Lecture seule';
    v[4].style.color = ecrit ? 'var(--warn, #d89b3c)' : 'var(--ok, #6ba368)';
    return d;
  }
  if (type === 'compaction') {
    const d = document.createElement('details');
    d.className = 'orch-compact';
    const s2 = document.createElement('summary'); s2.textContent = 'Contexte compacté — voir le résumé retenu';
    const b = document.createElement('div'); b.className = 'think-body'; b.textContent = contenu;
    d.append(s2, b);
    return d;
  }
  // ☠ Un fait du harness, JAMAIS une bulle d'opérateur (H-66). Le rendre comme
  // un message de Chris ferait croire, en relisant le fil, qu'il a demandé ce
  // que le harness a annoncé tout seul. Repliable : c'est un prompt complet,
  // utile à consulter, encombrant à laisser ouvert.
  //
  // ☠ Ce bloc n'est pas cosmétique — sans lui, `hBlocNode` rend `null` sur un
  // type qu'il ne connaît pas et `hAppendEvent` jette l'évènement en silence.
  // La notification serait remise à l'orchestrateur, agirait sur lui, et
  // n'apparaîtrait nulle part à l'écran.
  if (type === 'notification') {
    const d = document.createElement('div');
    d.className = 'h-harness';
    d.innerHTML = hMarkdown(String(contenu).replace(/^\[HARNESS\]\s*/, ''));
    return d;
  }
  return null;
}

/** Bulle d'un message opérateur, avec son bouton de copie. */
function hBulleOperateur(texte, pieces, at) {
  const u = document.createElement('div');
  u.className = 'bubble-u msg-wrap';
  u.dataset.menu = 'parole';
  // ☠ Le texte est aussi porté en `dataset` : l'adoption de la bulle optimiste
  // le compare, et depuis que la bulle peut contenir des vignettes, son
  // `textContent` inclut les noms de fichiers — la comparaison échouait donc et
  // le message s'affichait EN DOUBLE.
  u.dataset.texte = texte;
  const t = document.createElement('span');
  t.textContent = texte;
  u.append(t, hBoutonCopier(() => texte));
  const jointes = window.HPieces?.rendrePieces(pieces);
  if (jointes) u.appendChild(jointes);
  // ☠ Pas de durée sur un message d'opérateur : il est instantané. Afficher
  // « 0 s » sous chaque question laisserait croire à une mesure.
  const pied = window.HTemps?.pied(at ?? Date.now(), null);
  if (pied) u.appendChild(pied);
  return u;
}

/** Bouton « copier » révélé au survol d'un message. */
function hBoutonCopier(getTexte) {
  const b = document.createElement('button');
  b.className = 'msg-copy';
  b.title = 'Copier';
  b.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
  b.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(getTexte());
      b.classList.add('ok');
      setTimeout(() => b.classList.remove('ok'), 1200);
    } catch {
      showToast('Copie refusée par le navigateur', 'warn');
    }
  });
  return b;
}

function hAppendEvent(ev) {
  const chat = document.getElementById('hChatBody');
  const vide = chat.querySelector('.conv-empty'); if (vide) vide.remove();
  // Garde d'idempotence : un événement déjà posé n'est jamais reposé.
  // ☠ SAUF pour un outil : son résultat arrive au message SUIVANT l'appel, donc
  // le même `seq` revient enrichi. Sortir sec ici, c'était n'afficher jamais
  // aucun résultat — le défaut qu'on vient précisément de corriger côté serveur.
  const dejaPose = ev.seq !== undefined ? chat.querySelector(`[data-seq="${ev.seq}"]`) : null;
  if (dejaPose) {
    if (ev.type === 'outil') hMajOutil(dejaPose, ev);
    return;
  }

  if (ev.type === 'operateur') {
    // ☠ La bulle a pu être posée en optimiste à l'envoi : on l'ADOPTE (on lui
    // donne son `seq`) au lieu d'en créer une seconde identique juste en dessous.
    const optimiste = [...chat.querySelectorAll('.bubble-u[data-optimiste]')]
      .find((n) => n.dataset.texte === ev.contenu);
    if (optimiste) {
      delete optimiste.dataset.optimiste;
      if (ev.seq !== undefined) optimiste.dataset.seq = ev.seq;
      // ☠ Les vignettes locales (objectURL) sont remplacées par celles servies
      // par le Pi : les premières meurent avec l'onglet, les secondes survivent
      // au rechargement. Sans ce remplacement, rouvrir le fil montrerait des
      // images cassées sur le dernier message.
      const piedReel = window.HTemps?.pied(ev.at, null);
      if (piedReel) optimiste.querySelector(':scope > .msg-pied')?.replaceWith(piedReel);
      // Le tour qui suit se mesure depuis CE message, pas depuis le clic.
      hOrch.dernierEnvoiAt = ev.at;
      const ancien = optimiste.querySelector('.pj-jointes');
      const servies = window.HPieces?.rendrePieces(ev.pieces);
      if (ancien && servies) optimiste.replaceChild(servies, ancien);
      hOrch.cur = null; return;
    }
    hOrch.dernierEnvoiAt = ev.at;
    const u = hBulleOperateur(ev.contenu, ev.pieces, ev.at);
    if (ev.seq !== undefined) u.dataset.seq = ev.seq;
    chat.appendChild(u); hOrch.cur = null; return;
  }
  if (ev.type === 'resultat') {
    // Fin de tour : on clôt une séquence encore ouverte (cas d'un tour qui se
    // termine sur un outil, sans reprise de parole).
    hCloreGroupeOutils(hOrch.cur);
    hOrch.cur = null; return; // le prochain bloc ouvre un nouveau groupe
  }

  // La compaction est une césure du fil, pas une parole de l'orchestrateur :
  // posée au niveau de la conversation, elle referme le groupe en cours.
  if (ev.type === 'mandat') {
    const noeud = hBlocNode('mandat', ev.contenu, false);
    if (ev.seq !== undefined) noeud.dataset.seq = ev.seq;
    chat.appendChild(noeud); hOrch.cur = null; return;
  }
  if (ev.type === 'compaction') {
    const noeud = hBlocNode('compaction', ev.contenu, false);
    if (ev.seq !== undefined) noeud.dataset.seq = ev.seq;
    chat.appendChild(noeud); hOrch.cur = null; return;
  }

  const groupe = hEnsureAssistant(chat);
  // ☠ L'attribution est portée par l'ÉVÈNEMENT, pas par l'état courant du
  // sélecteur : relire un fil où l'on a changé de modèle doit montrer ce qui a
  // réellement produit CHAQUE réponse, pas le dernier réglage en date.
  hMarquerAttribution(groupe, ev);

  // ☠ Un outil n'est pas un bloc autonome : il rejoint la CARTE du groupe
  // courant, qui se replie d'un clic. C'est ce qui fait qu'un tour à huit appels
  // se lit sur une ligne au lieu de huit.
  if (ev.type === 'outil') {
    const ligne = hAjouterLigneOutil(groupe, ev.contenu, ev);
    if (ev.seq !== undefined) ligne.dataset.seq = ev.seq;
    // Un appel d'outil fait avancer le tour : le pied doit le suivre, sinon la
    // durée se figerait sur le dernier texte alors que l'équipe travaille encore.
    hMajPiedGroupe(groupe, ev.at);
    return;
  }

  const noeud = hBlocNode(ev.type, ev.contenu, false, ev);
  if (!noeud) return;
  if (ev.seq !== undefined) noeud.dataset.seq = ev.seq;
  if (Number.isFinite(ev.at)) noeud.dataset.at = String(ev.at);
  // ☠ L'agent reprend la parole ⇒ la séquence d'outils est FINIE : le groupe se
  // ferme, et les appels d'APRÈS ouvriront leur propre carte. Sans ça, tout un
  // tour finirait dans une carte unique et le résumé ne voudrait plus rien dire.
  // Une réflexion, elle, ne clôt rien — penser entre deux outils est le cours
  // normal d'une séquence.
  if (ev.type === 'texte') hCloreGroupeOutils(groupe);
  hInsererDansGroupe(groupe, noeud);
}

/** Nom lisible d'un modèle — l'identifiant technique ne dit rien à l'œil. */
function hLibelleModele(id) {
  const connu = (typeof hModelsCache !== 'undefined' && hModelsCache || []).find((m) => m.id === id);
  return connu ? connu.label : id;
}

/**
 * Pose, une seule fois par groupe, l'étiquette « quel modèle · quel
 * raisonnement ». Sans elle, une conversation où l'on change de modèle en cours
 * de route devient illisible après coup : rien ne dit qui a répondu quoi.
 */
function hMarquerAttribution(groupe, ev) {
  if (!ev.model || groupe.querySelector('.attrib')) return;
  const eff = ev.effort ? ` · ${(typeof HARNESS_EFFORT_LABEL !== 'undefined' && HARNESS_EFFORT_LABEL[ev.effort]) || ev.effort}` : '';
  const tag = document.createElement('div');
  tag.className = 'attrib mono';
  tag.style.cssText = 'font-size:9.5px;color:var(--ink-3);margin-bottom:6px;letter-spacing:.02em;';
  tag.textContent = `${hLibelleModele(ev.model)}${eff}`;
  groupe.insertBefore(tag, groupe.firstChild);
}

/**
 * Pose un bloc finalisé dans le groupe, en le glissant AVANT le bloc encore en
 * cours de frappe s'il y en a un — sinon le fil se lirait à l'envers. Ne touche
 * jamais au bloc en cours : c'est ce qui évite de le recréer à chaque cycle.
 */
function hInsererDansGroupe(groupe, noeud) {
  const enCours = hOrch.partielEl;
  const ancre = enCours && enCours.parentNode === groupe ? enCours : null;
  groupe.insertBefore(noeud, ancre);
  // Le pied suit la réponse qui s'allonge : il est reposé à chaque bloc, et
  // reste donc juste même quand un tour dure plusieurs minutes.
  hMajPiedGroupe(groupe, Number(noeud.dataset.at) || undefined);
}

/**
 * Reflète le bloc en cours de frappe. Mis à jour EN PLACE tant qu'il est du même
 * type : c'est ce qui donne le texte qui s'écrit, sans reconstruire le DOM.
 */
function hRenderPartiel(partiel) {
  const chat = document.getElementById('hChatBody');
  // ☠ Mesuré sur Opus : le bloc de réflexion s'ouvre jusqu'à ~8 s AVANT de porter
  // le moindre texte (souvent aucun — la réflexion peut rester masquée). Afficher
  // un bloc « Réflexion » vide pendant ce temps donnerait un cadre creux : on
  // laisse la pastille d'activité jusqu'au premier caractère réel.
  if (!partiel || !partiel.contenu) { hClearPartiel(); return; }
  const vide = chat.querySelector('.conv-empty'); if (vide) vide.remove();

  if (hOrch.partielEl && hOrch.partielEl.isConnected && hOrch.partielEl.dataset.ptype === partiel.type) {
    // Mise à jour en place du MÊME nœud : le fil ne se reconstruit pas, donc rien
    // ne clignote même si le Markdown est repeint à chaque sondage.
    // Rien de neuf : on ne touche pas au DOM. Repeindre à l'identique suffirait
    // à casser une sélection en cours.
    if (hOrch.partielEl.dataset.pcontenu === partiel.contenu) return;
    // ☠ Une sélection en cours a une extrémité dans ce nœud : le prochain sondage
    // (400 ms) réessaiera. Repeindre maintenant couperait la sélection — parfois
    // jusqu'à « sélectionner toute la page » quand le Range perd son ancre.
    if (hSelectionDansNoeud(hOrch.partielEl)) return;
    hOrch.partielEl.dataset.pcontenu = partiel.contenu;
    // ☠ La réflexion est structurée `.think-body > div` (le div porte le style
    // italique/bordure). Écrire le texte sur `.think-body` lui-même détruisait ce
    // div à chaque token et le remplaçait par un nœud texte nu — la réflexion
    // perdait sa mise en forme en boucle pendant tout le streaming.
    if (partiel.type === 'reflexion') hOrch.partielEl.querySelector('.think-body > div').textContent = partiel.contenu;
    else hPeindreTexte(hOrch.partielEl, partiel.contenu, true);
    return;
  }
  hClearPartiel();
  const noeud = hBlocNode(partiel.type, partiel.contenu, true);
  if (!noeud) return;
  noeud.dataset.ptype = partiel.type;
  noeud.dataset.pcontenu = partiel.contenu;
  const groupe = hEnsureAssistant(chat);
  // ☠ EN DIRECT aussi : dès le premier caractère de la réponse, la séquence
  // d'outils qui précède est finie. Sans ça, « Terminé » n'apparaîtrait qu'à la
  // fin du tour et on lirait la réponse avec un filet encore ouvert au-dessus —
  // exactement l'ambiguïté que cette ligne existe pour lever.
  if (partiel.type === 'texte') hCloreGroupeOutils(groupe);
  groupe.appendChild(noeud);
  hOrch.partielEl = noeud;
}

function hClearPartiel() {
  if (hOrch.partielEl && hOrch.partielEl.isConnected) hOrch.partielEl.remove();
  hOrch.partielEl = null;
}

/**
 * Vrai si la sélection en cours a au moins une extrémité dans `noeud`. Sert de
 * garde avant toute repeinture destructive : couper une sélection en place fait
 * parfois « sauter » le navigateur vers une sélection de toute la page (le Range
 * perd son ancre quand le nœud qui la portait est détruit puis recréé).
 */
function hSelectionDansNoeud(noeud) {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed) return false;
  return noeud.contains(sel.anchorNode) || noeud.contains(sel.focusNode);
}

/**
 * Marque d'activité entre l'envoi et le premier token.
 *
 * ☠ Les trois points animés ont sauté le 07/08 : « relou » — trois pastilles qui
 * sautillent attirent l'œil en continu sans rien apprendre. Remplacées par une
 * ligne calme qui NOMME ce qui se passe, et dont le seul mouvement est une
 * respiration lente sur un point unique.
 */
function hShowTyping(actif, libelle) {
  const chat = document.getElementById('hChatBody');
  const existant = chat.querySelector('.orch-work');
  if (!actif) { if (existant) existant.remove(); return; }
  const texte = libelle || 'Réflexion';
  if (existant) {
    // Repeindre à l'identique casserait une sélection en cours pour rien.
    const cible = existant.querySelector('span');
    if (cible && cible.textContent !== texte) cible.textContent = texte;
    return;
  }
  if (hOrch.partielEl) return;
  const t = document.createElement('div'); t.className = 'orch-work';
  t.innerHTML = `<i></i><span>${texte}</span>`;
  t.querySelector('span').textContent = texte;
  hEnsureAssistant(chat).appendChild(t);
}

/**
 * Le bouton du composeur porte DEUX rôles selon l'état du fil : envoyer au repos,
 * couper pendant la génération.
 *
 * ☠ Il n'est jamais désactivé. Avant le 07/08 il l'était pendant toute la
 * génération — donc aucun moyen de couper un tour parti de travers, et aucun
 * moyen d'écrire la précision qui aurait suffi à le corriger.
 */
function hMajBoutonEnvoi() {
  const btn = document.getElementById('hBtnOrchSend');
  if (!btn) return;
  const stop = !!hOrch.generating;
  if (btn.dataset.mode === (stop ? 'stop' : 'send')) return;
  btn.dataset.mode = stop ? 'stop' : 'send';
  btn.disabled = false;
  btn.classList.toggle('is-stop', stop);
  btn.title = stop ? 'Interrompre la réponse' : 'Envoyer';
  btn.innerHTML = stop
    ? '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2.5"/></svg>'
    : '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>';
}

/** Clic sur le bouton du composeur : couper si ça génère, envoyer sinon. */
async function hActionComposeur() {
  if (hOrch.generating) return hInterrompreOrch();
  return hSendOrchMessage();
}

/**
 * Coupe le tour en cours. ☠ Ne vide PAS le champ de saisie et ne touche pas aux
 * messages déjà mis en file par le harness : couper une réponse n'annule pas ce
 * que l'opérateur a écrit pendant qu'elle arrivait.
 */
async function hInterrompreOrch() {
  const id = hOrch.convId; if (!id) return;
  const r = await HarnessAPI.interruptConversation(id);
  if (!r.ok) { showToast('Interruption impossible'); return; }
  // ☠ On ne force pas `generating` à faux ici : c'est le sondage qui fait foi.
  // Le forcer rendrait la main à l'écran avant que le tour soit réellement coupé,
  // et un token arrivé entre-temps rouvrirait un bloc qu'on croyait fermé.
  hClearPartiel();
  hPollNow();
}

// ---- polling de génération --------------------------------------------------
function hStartPoll() { hStopPoll(); hPollNow(); }
function hStopPoll() { if (hOrch.timer) { clearTimeout(hOrch.timer); hOrch.timer = null; } }

async function hPollNow() {
  const id = hOrch.convId; if (!id) return;
  const r = await HarnessAPI.getConversationEvents(id, hOrch.cursor);
  if (id !== hOrch.convId) return; // changement de fil pendant l'attente
  // ☠ Une erreur ne TUE plus la veille : le Pi peut être injoignable trois
  // secondes (redéploiement, réseau) — s'arrêter là condamnait le fil au
  // rafraîchissement manuel jusqu'au prochain message envoyé. On réessaie, à
  // cadence lente, en silence.
  if (r.erreur) {
    hOrch.timer = setTimeout(hPollNow, HORCH_VEILLE_CACHEE_MS);
    return;
  }
  const d = r.data || {};
  const auBas = hEstEnBas();
  // ☠ Le bloc en cours n'est PLUS détruit à chaque arrivée d'événements : les
  // blocs finalisés s'insèrent AVANT lui (voir `hInsererDansGroupe`). L'ancienne
  // version le supprimait puis le recréait à chaque cycle — un nœud recréé
  // rejoue son animation d'entrée (clignotement) et casse la sélection en cours.
  // Un mandat proposé EN COURS de génération arriverait sans ses données : on
  // recharge les propositions avant de poser la carte, sinon elle serait vide.
  const nouveauMandat = (d.events || []).some((ev) => ev.type === 'mandat' && !hOrch.mandats[ev.contenu]);
  if (nouveauMandat) {
    const props = await HarnessAPI.getPropositions();
    for (const p of (props.data || [])) hOrch.mandats[p.id] = p;
    if (id !== hOrch.convId) return;
  }
  const generaitAvant = hOrch.generating;
  const nouveauxEvenements = (d.events || []).length;
  (d.events || []).forEach((ev) => { hAppendEvent(ev); hOrch.cursor = ev.seq; });
  hOrch.generating = !!d.generating;
  hRenderPartiel(d.partial || null);
  hShowTyping(hOrch.generating && !(d.partial && d.partial.contenu));
  // ☠ Le bouton suit l'état de génération À CHAQUE rafraîchissement, jamais
  // seulement à l'envoi : un tour peut se terminer, être coupé, ou repartir sur
  // une notification du harness sans que l'opérateur ait rien fait.
  hMajBoutonEnvoi();
  hRenderStats(d);
  if (auBas) hScrollChat();
  // ☠ Compté seulement quand on lit AILLEURS : la pastille dit « il s'est passé
  // ceci pendant que tu remontais », pas « des messages existent ».
  else if (nouveauxEvenements > 0) window.HFilBas?.de('hChatScroll')?.signalerMessage();
  if (hOrch.generating) {
    hOrch.timer = setTimeout(hPollNow, HORCH_POLL_MS);
    return;
  }
  hShowTyping(false);
  hOrch.cur = null;
  // ☠ Les effets de FIN DE TOUR ne se déclenchent qu'à la transition, jamais à
  // chaque battement de veille : rappeler la liste des fils et les mandats
  // toutes les 4 s ferait clignoter la barre et rejouerait les cartes.
  if (generaitAvant) {
    hLoadConvList(); // fin de tour : titres/ordre/contexte à jour
    // ☠ Après le tour, pas pendant : c'est APRÈS que le harness a eu le temps
    // d'auto-approuver. Pendant la génération, une proposition tout juste posée
    // apparaîtrait comme « déjà tranchée » entre deux sondages.
    void hRafraichirMandats();
  } else if (nouveauxEvenements > 0) {
    // Le harness a parlé tout seul (fin d'équipe, rappel, notification remise) :
    // la liste porte le contexte et l'ordre des fils, elle doit suivre.
    hLoadConvList();
  }
  // ☠ La veille CONTINUE, y compris quand la vue n'est pas active : c'est ce qui
  // fait qu'on retrouve un fil à jour en y revenant, sans rien rafraîchir.
  hOrch.timer = setTimeout(hPollNow, hVueOrchVisible() ? HORCH_VEILLE_MS : HORCH_VEILLE_CACHEE_MS);
}

/** La conversation est-elle sous les yeux de l'opérateur en ce moment ? */
function hVueOrchVisible() {
  if (document.hidden) return false;
  const vue = document.querySelector('.view.active');
  return !!vue && vue.dataset.view === 'harness-orchestrateur';
}

/** Ne recolle en bas que si l'opérateur y était déjà — sinon on lui vole sa lecture. */
function hEstEnBas() {
  const s = document.getElementById('hChatScroll');
  if (!s) return true;
  return s.scrollHeight - s.scrollTop - s.clientHeight < 80;
}

function hScrollChat() {
  const s = document.getElementById('hChatScroll'); if (s) s.scrollTop = s.scrollHeight;
  window.HFilBas?.de('hChatScroll')?.majuster();
}

/**
 * Branche la flèche de retour au présent, et cale le fil EN BAS.
 *
 * ☠ Rouvrir une conversation de plusieurs heures atterrissait en haut : il
 * fallait faire défiler des minutes pour revenir au dernier message. Un fil se
 * lit par la fin — c'est le point de départ, pas une préférence.
 */
function hBrancherFilBas() {
  window.HFilBas?.attacher('hChatScroll');
  window.HFilBas?.de('hChatScroll')?.caler();
}

// ---- envoi ------------------------------------------------------------------
async function hSendOrchMessage() {
  const el = document.getElementById('hOrchInput');
  const btn = document.getElementById('hBtnOrchSend');
  const text = (el.value || '').trim();
  // ☠ Un message sans texte MAIS avec une capture est légitime — coller une
  // image et n'écrire aucun mot est le geste le plus naturel du composeur.
  const pieces = window.HPieces?.pourEnvoi() ?? [];
  // ☠ Plus de blocage sur `hOrch.generating` (07/08) : le harness met les
  // messages en FILE d'attente depuis toujours (`GenerateurEntree`, capacité
  // bornée, « ne perd jamais le message »). Le seul verrou était ici, à l'écran —
  // écrire pendant que l'orchestrateur répond était impossible alors que rien,
  // en dessous, ne l'interdisait.
  if (!text && pieces.length === 0) return;
  if (!hOrch.convId) { await hNewConversation(); if (!hOrch.convId) return; }
  // ☠ `/compact` est traité PAR LE HARNESS, jamais envoyé au modèle : mesuré, le
  // SDK ne connaît pas les commandes slash dans le flux — le modèle y répondrait
  // en texte (« je n'ai pas d'outil pour ça ») au lieu de compacter.
  if (hCommandeLocale(text)) { el.value = ''; el.style.height = 'auto'; return; }
  el.value = ''; el.style.height = 'auto';
  // Affichage optimiste : le message part à l'écran tout de suite. Il portera son
  // `seq` au prochain sondage, la garde d'idempotence évitera le doublon.
  const chat = document.getElementById('hChatBody');
  const vide = chat.querySelector('.conv-empty'); if (vide) vide.remove();
  // Vignettes locales le temps de l'aller-retour — remplacées par celles du Pi
  // dès que l'évènement revient avec ses URL.
  hOrch.dernierEnvoiAt = Date.now();
  const u = hBulleOperateur(text, window.HPieces?.file().map((p) => ({ ...p, url: p.apercu })), hOrch.dernierEnvoiAt);
  u.dataset.optimiste = '1';
  chat.appendChild(u); hOrch.cur = null;
  // ☠ Le bouton n'est plus DÉSACTIVÉ pendant la génération : il devient le bouton
  // d'interruption. Le désactiver était le corollaire du verrou d'envoi qu'on
  // vient de retirer, et laissait l'opérateur sans aucun moyen de couper un tour.
  hOrch.generating = true;
  hMajBoutonEnvoi();
  hShowTyping(true);
  hScrollChat();

  const r = await HarnessAPI.sendConversationMessage(hOrch.convId, text, {
    model: HarnessState.orchModel.model,
    effort: HarnessState.orchModel.effort,
    fastMode: HarnessState.orchModel.fastMode,
  }, pieces);
  // ☠ Un échec est AFFICHÉ (session inactive, PC/Pi injoignable), jamais avalé.
  if (!r.ok) {
    hOrch.generating = false; hShowTyping(false); hMajBoutonEnvoi();
    hAppendEvent({ type: 'erreur', contenu: r.erreur || 'Message non transmis' });
    // ☠ La file N'EST PAS vidée sur échec : les pièces restent attachées pour
    // le renvoi. Les jeter obligerait à re-sélectionner des fichiers que
    // l'opérateur vient de choisir, pour une panne qui n'est pas la sienne.
    hScrollChat(); return;
  }
  window.HPieces?.vider();
  hStartPoll();
}

/**
 * Réaligne les deux listes déroulantes sur `HarnessState.orchModel`. Appelé à
 * l'ouverture d'un fil : sans ça, l'état interne serait juste, mais l'écran
 * continuerait d'afficher le modèle précédent — pire qu'un simple défaut.
 */
function hSyncSelecteursModele() {
  const selModel = document.getElementById('hSelModel');
  if (!selModel || !hModelsCache) return;
  selModel.value = HarnessState.orchModel.model;
  hRefreshEffortOptions();
  const selEffort = document.getElementById('hSelEffort');
  if (selEffort && !selEffort.disabled) selEffort.value = HarnessState.orchModel.effort;
  hRefreshModelToggles();
  hUpdateModelHint();
}

// ============ Sélecteur de modèle / raisonnement ============
async function hRenderModelSelector() {
  hModelsCache = (await HarnessAPI.getModels());
  const selModel = document.getElementById('hSelModel');
  selModel.innerHTML = hModelsCache.map((mo) => `<option value="${mo.id}" ${mo.enabled ? '' : 'disabled'} ${mo.id === HarnessState.orchModel.model ? 'selected' : ''}>${mo.label}</option>`).join('');
  hRefreshEffortOptions(); hRefreshModelToggles(); hUpdateModelHint();
}
function hRefreshEffortOptions() {
  const selEffort = document.getElementById('hSelEffort');
  const mo = hModelsCache.find((x) => x.id === HarnessState.orchModel.model) || hModelsCache[0];
  if (!mo || !mo.effort.length) { selEffort.innerHTML = `<option value="">— pas de raisonnement réglable —</option>`; selEffort.disabled = true; return; }
  selEffort.disabled = false;
  if (!mo.effort.includes(HarnessState.orchModel.effort)) HarnessState.orchModel.effort = mo.effort.includes('high') ? 'high' : mo.effort[0];
  selEffort.innerHTML = mo.effort.map((e) => `<option value="${e}" ${e === HarnessState.orchModel.effort ? 'selected' : ''}>${HARNESS_EFFORT_LABEL[e]}</option>`).join('');
}
function hRefreshModelToggles() {
  const mo = hModelsCache.find((x) => x.id === HarnessState.orchModel.model) || hModelsCache[0];
  const chkFast = document.getElementById('hChkFastMode');
  const chkUltra = document.getElementById('hChkUltracode');
  if (!mo || !mo.fastMode) HarnessState.orchModel.fastMode = false;
  chkFast.checked = HarnessState.orchModel.fastMode;
  chkFast.disabled = !(mo && mo.fastMode);
  const ultraOk = hSupportsUltracode(hModelsCache, mo && mo.id);
  if (!ultraOk) HarnessState.orchModel.ultracode = false;
  chkUltra.checked = HarnessState.orchModel.ultracode;
  chkUltra.disabled = !ultraOk;
}
function hUpdateModelHint() {
  const mo = hModelsCache.find((x) => x.id === HarnessState.orchModel.model) || hModelsCache[0];
  const hint = document.getElementById('hModelHint');
  if (!mo) return;
  if (!mo.enabled) hint.innerHTML = `<strong>Déconseillé par Chris pour ce rôle</strong> — jugé insuffisant (H-71), affiché pour transparence mais non sélectionnable.`;
  else if (!mo.effort.length) hint.textContent = `${mo.label} ne supporte ni effort ni raisonnement adaptatif.`;
  else if (HarnessState.orchModel.ultracode) hint.innerHTML = `<strong>ultracode actif</strong> — xhigh + orchestration de workflows permanente. Portée <strong>session</strong> seulement, jamais persisté.`;
  else if (HarnessState.orchModel.fastMode) hint.textContent = `Mode rapide actif sur ${mo.label} — seul ce modèle le déclare (supportsFastMode).`;
  else hint.textContent = `Niveaux de raisonnement pour ${mo.label} : ${mo.effort.map((e) => HARNESS_EFFORT_LABEL[e]).join(' · ')}. Change à chaud, sans redémarrer la session.`;
}

// ☠ Le formulaire de mandat MANUEL a été supprimé le 01/08. Il écrivait dans la
// base de démonstration : aucune route serveur, aucune équipe jamais créée par
// ce chemin. Le seul chemin réel est la conversation avec l'orchestrateur — il
// propose, l'humain autorise (H-61). Les cartes de mandat du fil, elles, sont
// réelles : voir `hApprouverMandat` / `hRefuserMandat`, à ne pas confondre.

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('hSelModel').addEventListener('change', (e) => {
    const mo = hModelsCache.find((x) => x.id === e.target.value);
    if (!mo || !mo.enabled) { e.target.value = HarnessState.orchModel.model; return; }
    HarnessState.orchModel.model = mo.id;
    hRefreshEffortOptions(); hRefreshModelToggles(); hUpdateModelHint();
    showToast(`Orchestrateur → ${mo.label}`, 'accent');
  });
  document.getElementById('hSelEffort').addEventListener('change', (e) => { HarnessState.orchModel.effort = e.target.value; hUpdateModelHint(); });
  document.getElementById('hChkFastMode').addEventListener('change', (e) => { HarnessState.orchModel.fastMode = e.target.checked; hUpdateModelHint(); });
  document.getElementById('hChkUltracode').addEventListener('change', (e) => { HarnessState.orchModel.ultracode = e.target.checked; hUpdateModelHint(); });
  document.getElementById('hBtnOrchSend').addEventListener('click', hActionComposeur);
  const zone = document.getElementById('hOrchInput');
  zone.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); hSendOrchMessage(); } });
  // Le champ grandit avec le texte, jusqu'au plafond fixé en CSS (max-height).
  zone.addEventListener('input', () => { zone.style.height = 'auto'; zone.style.height = zone.scrollHeight + 'px'; });

  // Pièces jointes : trombone, collage (⌘/Ctrl+V) et glisser-déposer.
  // ☠ Un refus est MONTRÉ. Un fichier écarté en silence se lit comme un fichier
  // joint — l'opérateur croirait sa capture partie.
  window.HPieces?.brancher({
    zoneSaisie: zone,
    coque: document.getElementById('hComposerShell'),
    bouton: document.getElementById('hBtnPieceJointe'),
    input: document.getElementById('hInputPieceJointe'),
    surRefus: (refus) => showToast(refus.join(' · '), 'err'),
  });
});
