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
const hOrch = { convId: null, cursor: 0, generating: false, timer: null, cur: null, list: [], barreSig: '', partielEl: null };
const HORCH_KEY = 'ccremote.orch.conv';
const HORCH_POLL_MS = 400;

// ---- cycle de vie de la vue -------------------------------------------------
async function hInitOrchestrateur() {
  await hRenderModelSelector();
  await hLoadConvList();
  const saved = localStorage.getItem(HORCH_KEY);
  const cible = (hOrch.list.find((c) => c.id === saved) ? saved : (hOrch.list[0] && hOrch.list[0].id)) || null;
  if (cible) await hOpenConversation(cible);
  else await hNewConversation();
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
  const bar = document.getElementById('hConvBar');
  if (!bar) return;
  if (erreur) {
    bar.innerHTML = `<span style="font-size:11px;color:var(--err);">${escapeHtml(erreur)}</span>`;
    hOrch.barreSig = 'err:' + erreur;
    return;
  }
  // ☠ Signature de l'état affiché : sans ce garde, chaque sondage réécrivait la
  // barre à l'identique et faisait clignoter les pastilles.
  const sig = JSON.stringify([hOrch.convId, list.map((c) => [c.id, c.titre, c.active, c.contextPct])]);
  if (sig === hOrch.barreSig) return;
  hOrch.barreSig = sig;
  const chips = list.map((c) => {
    const active = c.id === hOrch.convId;
    const ctx = (typeof c.contextPct === 'number') ? ` · contexte ${c.contextPct} %` : '';
    return `<div class="conv-chip ${active ? 'active' : ''}" onclick="hOpenConversation('${c.id}')" title="${escapeHtml(c.titre)}${ctx}">
      ${c.active ? '<span class="dot"></span>' : ''}
      <span class="lbl">${escapeHtml(c.titre)}</span>
      ${active ? `<span class="x" onclick="event.stopPropagation();hArchiveConversation('${c.id}')">×</span>` : ''}
    </div>`;
  }).join('');
  bar.innerHTML = chips + `<button class="conv-new" onclick="hNewConversation()">+ Nouveau</button>`;
}

async function hNewConversation() {
  const r = await HarnessAPI.createConversation();
  if (!r.ok || !r.conversation) { showToast(r.erreur || 'Création impossible', 'warn'); return; }
  await hLoadConvList();
  await hOpenConversation(r.conversation.id);
  const el = document.getElementById('hOrchInput'); if (el) el.focus();
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
  // ☠ Pas de mesure = « — », jamais 0 % : un contexte inconnu n'est pas un contexte vide.
  const cls = pct === null ? '' : pct >= 75 ? 'crit' : pct >= 50 ? 'warn' : '';
  const enCours = hOrch.generating;
  el.innerHTML = `
    <div class="ostat ${cls}">
      <span class="ok">Contexte</span>
      <span class="ov">${pct === null ? '—' : pct + ' %'}</span>
      <span class="obar"><i style="width:${pct === null ? 0 : pct}%"></i></span>
    </div>
    <div class="ostat">
      <span class="ok">Compactages</span>
      <span class="ov">${nb}</span>
      <button onclick="hCompacterMaintenant()" ${enCours ? 'disabled' : ''} title="Compacter le contexte de ce fil">Compacter</button>
    </div>`;
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

// ---- ouverture + rendu complet d'un fil ------------------------------------
async function hOpenConversation(id) {
  hStopPoll();
  hOrch.convId = id; hOrch.cursor = 0; hOrch.cur = null; hOrch.partielEl = null;
  localStorage.setItem(HORCH_KEY, id);
  hRenderConvBar(hOrch.list);
  const chat = document.getElementById('hChatBody');
  chat.innerHTML = '';
  const r = await HarnessAPI.getConversation(id);
  if (id !== hOrch.convId) return; // l'utilisateur a changé de fil pendant l'attente
  if (r.erreur) { chat.innerHTML = `<div class="conv-empty">${escapeHtml(r.erreur)}</div>`; return; }
  const d = r.data || {};
  (d.events || []).forEach(hAppendEvent);
  hOrch.cursor = d.cursor || 0;
  hOrch.generating = !!d.generating;
  if (!d.events || d.events.length === 0) {
    chat.innerHTML = `<div class="conv-empty"><div class="ce-t">Nouvelle conversation</div>Écris à l'orchestrateur — sa session démarre au premier message.</div>`;
  }
  hRenderPartiel(d.partial || null);
  hShowTyping(hOrch.generating && !(d.partial && d.partial.contenu));
  hRenderStats(d);
  hScrollChat();
  if (hOrch.generating) hStartPoll();
}

// ---- rendu incrémental d'un événement (le cœur du streaming) ---------------
// ☠ Aucun nœud n'est jamais recréé ni réécrit : chaque événement est posé une
// fois, identifié par son `seq`. C'est ce qui supprime le clignotement — et ce
// qui permet au bloc partiel de grandir en place, token après token.
function hEnsureAssistant(chat) {
  if (hOrch.cur && hOrch.cur.isConnected) return hOrch.cur;
  const a = document.createElement('div'); a.className = 'bubble-a';
  chat.appendChild(a); hOrch.cur = a; return a;
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

/** Construit le nœud d'un bloc. `live` = bloc encore en cours de frappe. */
function hBlocNode(type, contenu, live) {
  if (type === 'texte') {
    const d = document.createElement('div');
    d.className = 'orch-md';
    hPeindreTexte(d, contenu, live);
    return d;
  }
  if (type === 'reflexion') {
    const d = document.createElement('details');
    d.className = 'orch-think' + (live ? ' live' : '');
    if (live) d.open = true; // on voit l'orchestrateur réfléchir, puis ça se replie
    const s = document.createElement('summary'); s.textContent = live ? 'Réflexion en cours…' : 'Réflexion';
    const b = document.createElement('div'); b.className = 'think-body'; b.textContent = contenu;
    d.append(s, b);
    return d;
  }
  if (type === 'outil') {
    const t = document.createElement('div'); t.className = 'orch-tool';
    t.textContent = hToolLabel(contenu);
    return t;
  }
  if (type === 'erreur') {
    const e = document.createElement('div'); e.className = 'orch-err'; e.textContent = contenu;
    return e;
  }
  if (type === 'compaction') {
    // Marqueur visible dans le fil : l'opérateur doit savoir OÙ le contexte a été
    // remplacé, et par quoi — le résumé est consultable, jamais caché.
    const d = document.createElement('details');
    d.className = 'orch-compact';
    const s = document.createElement('summary'); s.textContent = 'Contexte compacté — voir le résumé retenu';
    const b = document.createElement('div'); b.className = 'think-body'; b.textContent = contenu;
    d.append(s, b);
    return d;
  }
  return null;
}

function hAppendEvent(ev) {
  const chat = document.getElementById('hChatBody');
  const vide = chat.querySelector('.conv-empty'); if (vide) vide.remove();
  // Garde d'idempotence : un événement déjà posé n'est jamais reposé.
  if (ev.seq !== undefined && chat.querySelector(`[data-seq="${ev.seq}"]`)) return;

  if (ev.type === 'operateur') {
    // ☠ La bulle a pu être posée en optimiste à l'envoi : on l'ADOPTE (on lui
    // donne son `seq`) au lieu d'en créer une seconde identique juste en dessous.
    const optimiste = [...chat.querySelectorAll('.bubble-u[data-optimiste]')]
      .find((n) => n.textContent === ev.contenu);
    if (optimiste) {
      delete optimiste.dataset.optimiste;
      if (ev.seq !== undefined) optimiste.dataset.seq = ev.seq;
      hOrch.cur = null; return;
    }
    const u = document.createElement('div'); u.className = 'bubble-u'; u.textContent = ev.contenu;
    if (ev.seq !== undefined) u.dataset.seq = ev.seq;
    chat.appendChild(u); hOrch.cur = null; return;
  }
  if (ev.type === 'resultat') { hOrch.cur = null; return; } // fin de tour : le prochain bloc ouvre un groupe

  // La compaction est une césure du fil, pas une parole de l'orchestrateur :
  // posée au niveau de la conversation, elle referme le groupe en cours.
  if (ev.type === 'compaction') {
    const noeud = hBlocNode('compaction', ev.contenu, false);
    if (ev.seq !== undefined) noeud.dataset.seq = ev.seq;
    chat.appendChild(noeud); hOrch.cur = null; return;
  }

  const noeud = hBlocNode(ev.type, ev.contenu, false);
  if (!noeud) return;
  if (ev.seq !== undefined) noeud.dataset.seq = ev.seq;
  hEnsureAssistant(chat).appendChild(noeud);
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
    if (partiel.type === 'reflexion') hOrch.partielEl.querySelector('.think-body').textContent = partiel.contenu;
    else hPeindreTexte(hOrch.partielEl, partiel.contenu, true);
    return;
  }
  hClearPartiel();
  const noeud = hBlocNode(partiel.type, partiel.contenu, true);
  if (!noeud) return;
  noeud.dataset.ptype = partiel.type;
  hEnsureAssistant(chat).appendChild(noeud);
  hOrch.partielEl = noeud;
}

function hClearPartiel() {
  if (hOrch.partielEl && hOrch.partielEl.isConnected) hOrch.partielEl.remove();
  hOrch.partielEl = null;
}

/** Pastille « il travaille » : entre l'envoi et le premier token. */
function hShowTyping(actif) {
  const chat = document.getElementById('hChatBody');
  const existant = chat.querySelector('.orch-typing');
  if (!actif) { if (existant) existant.remove(); return; }
  if (existant || hOrch.partielEl) return;
  const t = document.createElement('div'); t.className = 'orch-typing';
  t.innerHTML = '<i></i><i></i><i></i>';
  hEnsureAssistant(chat).appendChild(t);
}

// ---- polling de génération --------------------------------------------------
function hStartPoll() { hStopPoll(); hPollNow(); }
function hStopPoll() { if (hOrch.timer) { clearTimeout(hOrch.timer); hOrch.timer = null; } }

async function hPollNow() {
  const id = hOrch.convId; if (!id) return;
  const r = await HarnessAPI.getConversationEvents(id, hOrch.cursor);
  if (id !== hOrch.convId) return; // changement de fil pendant l'attente
  if (r.erreur) { hStopPoll(); return; } // silencieux : un prochain envoi relancera
  const d = r.data || {};
  const auBas = hEstEnBas();
  // ☠ Ordre imposé : retirer le bloc en cours AVANT de poser les blocs finalisés,
  // sinon un bloc terminé s'insérerait derrière le texte encore en train de
  // s'écrire et le fil se lirait à l'envers.
  if (d.events && d.events.length) hClearPartiel();
  (d.events || []).forEach((ev) => { hAppendEvent(ev); hOrch.cursor = ev.seq; });
  hOrch.generating = !!d.generating;
  hRenderPartiel(d.partial || null);
  hShowTyping(hOrch.generating && !(d.partial && d.partial.contenu));
  hRenderStats(d);
  if (auBas) hScrollChat();
  if (hOrch.generating) hOrch.timer = setTimeout(hPollNow, HORCH_POLL_MS);
  else {
    hStopPoll(); hShowTyping(false); hOrch.cur = null;
    hLoadConvList(); // fin de tour : titres/ordre/contexte à jour
  }
}

/** Ne recolle en bas que si l'opérateur y était déjà — sinon on lui vole sa lecture. */
function hEstEnBas() {
  const s = document.getElementById('hChatScroll');
  if (!s) return true;
  return s.scrollHeight - s.scrollTop - s.clientHeight < 80;
}

function hScrollChat() {
  const s = document.getElementById('hChatScroll'); if (s) s.scrollTop = s.scrollHeight;
}

// ---- envoi ------------------------------------------------------------------
async function hSendOrchMessage() {
  const el = document.getElementById('hOrchInput');
  const btn = document.getElementById('hBtnOrchSend');
  const text = (el.value || '').trim();
  if (!text || hOrch.generating) return;
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
  const u = document.createElement('div'); u.className = 'bubble-u'; u.textContent = text;
  u.dataset.optimiste = '1';
  chat.appendChild(u); hOrch.cur = null;
  hOrch.generating = true; btn.disabled = true;
  hShowTyping(true);
  hScrollChat();

  const r = await HarnessAPI.sendConversationMessage(hOrch.convId, text);
  btn.disabled = false;
  // ☠ Un échec est AFFICHÉ (session inactive, PC/Pi injoignable), jamais avalé.
  if (!r.ok) {
    hOrch.generating = false; hShowTyping(false);
    hAppendEvent({ type: 'erreur', contenu: r.erreur || 'Message non transmis' });
    hScrollChat(); return;
  }
  hStartPoll();
}

// ============ Sélecteur de modèle / raisonnement (inchangé) ============
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

// ============ Mandat (H-61) — encore mock, DOM du fil courant ============
function hIsTestable(txt) {
  if (!txt) return false;
  const t = txt.trim();
  if (t.length < 20) return false;
  return /(réussit|réussissent|passent|passe|atteint|observ|mesur|zéro|détecte|confirmé|sans erreur|tests? e2e|au moins|identique|contient les mêmes|rejeté|accepté|\d)/i.test(t);
}
async function hSubmitMandate() {
  const projet = document.getElementById('hFProjet').value;
  const but = document.getElementById('hFBut').value.trim();
  const critere = document.getElementById('hFCritere').value.trim();
  const perimetre = document.getElementById('hFPerimetre').value.trim();
  const budget = parseFloat(document.getElementById('hFBudget').value) || 12;
  if (!hIsTestable(critere)) {
    document.getElementById('hFCritereField').classList.add('has-error');
    const err = document.getElementById('hFCritereError');
    err.textContent = "Refusé au dispatch — critère d'arrêt non testable. Formule un état vérifiable, pas une intention.";
    err.classList.add('show');
    return;
  }
  document.getElementById('hFCritereField').classList.remove('has-error');
  document.getElementById('hFCritereError').classList.remove('show');
  closeModal('modalHMandat');
  const res = await HarnessAPI.proposeMandate({ projet, but, critere, perimetre, budget });
  hGoto('harness-orchestrateur');
  hAppendProposalToChat(res.data);
  showToast('Mandat transmis — en attente de ton autorisation', 'accent');
}
function hAppendProposalToChat(p) {
  const chat = document.getElementById('hChatBody');
  const vide = chat.querySelector('.conv-empty'); if (vide) vide.remove();
  const u = document.createElement('div'); u.className = 'bubble-u'; u.textContent = `Lance une mission sur ${p.projet}.`; chat.appendChild(u);
  const a = document.createElement('div'); a.className = 'bubble-a';
  a.innerHTML = `<p style="margin:0 0 4px;">Je ne crée rien seul (H-61). Voici le mandat proposé — ton autorisation dispatche l'équipe.</p>
    <div class="mandate-card" id="hMandate_${p.id}">
      <div class="mh2">Proposition de mandat</div>
      <div class="mb">
        <div class="mrow"><div class="k">Projet</div><div class="v mono">${escapeHtml(p.projet)}</div></div>
        <div class="mrow"><div class="k">But</div><div class="v">${escapeHtml(p.but)}</div></div>
        <div class="mrow"><div class="k">Critère d'arrêt</div><div class="v">${escapeHtml(p.critere)}</div></div>
        <div class="mrow"><div class="k">Budget</div><div class="v mono">${hMoney(p.budget)} (indicatif)</div></div>
      </div>
      <div class="macts">
        <button class="btn btn-accent" onclick="hApproveProposal('${p.id}')">Autoriser</button>
        <button class="btn btn-ghost" style="color:var(--err);border-color:var(--err-soft);" onclick="hRejectProposal('${p.id}')">Refuser</button>
      </div>
    </div>`;
  chat.appendChild(a);
  hScrollChat();
}
function hStampProposal(id, label, color) {
  const card = document.getElementById('hMandate_' + id);
  if (!card) return;
  card.classList.add('resolved');
  const stamp = document.createElement('div');
  stamp.className = 'verdict-stamp'; stamp.style.color = color;
  stamp.textContent = label + ' à ' + new Date().toTimeString().slice(0, 8);
  card.appendChild(stamp);
}
async function hApproveProposal(id) {
  await HarnessAPI.approveProposal(id);
  hStampProposal(id, 'Autorisée', 'var(--ok)');
  hRenderParc();
  showToast('Mission dispatchée — visible dans le Parc', 'ok');
}
async function hRejectProposal(id) {
  await HarnessAPI.rejectProposal(id);
  hStampProposal(id, 'Refusée — aucune équipe créée', 'var(--err)');
  showToast('Proposition refusée', 'warn');
}

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
  document.getElementById('hBtnOrchSend').addEventListener('click', hSendOrchMessage);
  const zone = document.getElementById('hOrchInput');
  zone.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); hSendOrchMessage(); } });
  // Le champ grandit avec le texte, jusqu'au plafond fixé en CSS (max-height).
  zone.addEventListener('input', () => { zone.style.height = 'auto'; zone.style.height = zone.scrollHeight + 'px'; });
  document.getElementById('hBtnNewMission').addEventListener('click', () => {
    if (!HarnessAPI._isPcOnline()) { showToast('PC absent — impossible de dispatcher pour l\'instant', 'warn'); return; }
    document.getElementById('hFCritereField').classList.remove('has-error');
    document.getElementById('hFCritereError').classList.remove('show');
    openModal('modalHMandat');
  });
  document.getElementById('hBtnSubmitMandate').addEventListener('click', hSubmitMandate);
});
