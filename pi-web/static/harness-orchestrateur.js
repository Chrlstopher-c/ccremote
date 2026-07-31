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
  const sig = JSON.stringify([hOrch.convId, list.map((c) => [c.id, c.titre, c.active])]);
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
    hSyncSelecteursModele();
  }
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
  const a = document.createElement('div'); a.className = 'bubble-a msg-wrap';
  // Copie tout le texte rendu du groupe (hors réflexion repliée et outils).
  // ☠ `.h-say` depuis le passage au vocabulaire de la page mission : le sélecteur
  // `.md` seul ne trouvait plus rien et le bouton copiait une chaîne vide.
  a.appendChild(hBoutonCopier(() => [...a.querySelectorAll('.h-say, .md')].map((n) => n.innerText).join('\n\n').trim()));
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

/**
 * Construit le nœud d'un bloc. `live` = bloc encore en cours de frappe.
 * `☠` Réutilise les classes du chat (`.think`, `.tool`, `.md`, `.codeblock`) —
 * même ADN visuel, une seule définition à maintenir.
 */
function hBlocNode(type, contenu, live) {
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
  if (type === 'outil') {
    // ☠ Une carte par appel noyait le fil : sur un tour d'orchestrateur les
    // outils sont l'essentiel du volume et l'accessoire du sens.
    const cle = HValise.enregistrer(() =>
      `<div class="h-lbl">Outil appelé</div><div class="h-blk">${escapeHtml(contenu)}</div>`
      + '<div class="h-note">Le harness journalise l’appel, pas son résultat (H-45).</div>');
    return HValise.noeud(`Called ${hToolLabel(contenu)}`, cle);
  }
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
function hBulleOperateur(texte) {
  const u = document.createElement('div');
  u.className = 'bubble-u msg-wrap';
  const t = document.createElement('span');
  t.textContent = texte;
  u.append(t, hBoutonCopier(() => texte));
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
    const u = hBulleOperateur(ev.contenu);
    if (ev.seq !== undefined) u.dataset.seq = ev.seq;
    chat.appendChild(u); hOrch.cur = null; return;
  }
  if (ev.type === 'resultat') { hOrch.cur = null; return; } // fin de tour : le prochain bloc ouvre un groupe

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

  const noeud = hBlocNode(ev.type, ev.contenu, false);
  if (!noeud) return;
  if (ev.seq !== undefined) noeud.dataset.seq = ev.seq;
  const groupe = hEnsureAssistant(chat);
  // ☠ L'attribution est portée par l'ÉVÈNEMENT, pas par l'état courant du
  // sélecteur : relire un fil où l'on a changé de modèle doit montrer ce qui a
  // réellement produit CHAQUE réponse, pas le dernier réglage en date.
  hMarquerAttribution(groupe, ev);
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
  hEnsureAssistant(chat).appendChild(noeud);
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
  const u = hBulleOperateur(text);
  u.dataset.optimiste = '1';
  chat.appendChild(u); hOrch.cur = null;
  hOrch.generating = true; btn.disabled = true;
  hShowTyping(true);
  hScrollChat();

  const r = await HarnessAPI.sendConversationMessage(hOrch.convId, text, {
    model: HarnessState.orchModel.model,
    effort: HarnessState.orchModel.effort,
  });
  btn.disabled = false;
  // ☠ Un échec est AFFICHÉ (session inactive, PC/Pi injoignable), jamais avalé.
  if (!r.ok) {
    hOrch.generating = false; hShowTyping(false);
    hAppendEvent({ type: 'erreur', contenu: r.erreur || 'Message non transmis' });
    hScrollChat(); return;
  }
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
