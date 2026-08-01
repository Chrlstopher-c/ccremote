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
const H_ICO_HORLOGE =
  '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2" stroke-linecap="round"/></svg>';

function hValiseOutilsTemplate(seg, index) {
  const cle = HValise.enregistrer(() => hCorpsValiseOutils(index));
  return HValise.html(hLibelleValise(seg.items), cle);
}

/**
 * ☠ Le résumé montré est le DÉBUT de la réflexion, pas un libellé générique :
 * « Réfléchi » ne dit rien, alors que la première phrase dit si ça vaut la peine
 * d'ouvrir. C'est exactement ce que fait Claude Code.
 */
function hValisePenseesTemplate(seg, index) {
  const apercu = seg.items[0].text.replace(/\s+/g, ' ').trim();
  const cle = HValise.enregistrer(() => `<div class="h-think">${seg.items.map((e) => hMarkdown(e.text)).join('')}</div>`);
  return HValise.html(apercu, cle, H_ICO_HORLOGE);
}

/**
 * ☠ La SEULE valise qui a le droit d'être visible : une autorisation en attente
 * bloque le travail, et la manquer coûte une équipe arrêtée sans que personne ne
 * le sache. Une fois résolue, elle redevient une ligne grise comme les autres.
 */
function hPermissionTemplate(ev) {
  const c = hParseOutil(ev.text);
  const commande = c.command || c.file_path || c.path || ev.text;
  if (!ev.pending) {
    const issue = ev.resolved || (ev.auto ? 'résolue par le lead' : 'traitée');
    const cle = HValise.enregistrer(() => `<div class="h-blk">${escapeHtml(commande)}</div>`);
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

function hSystemeTemplate(ev) {
  // Le préfixe d'origine (`[sdk]`, `[harness]`) est du bruit à l'écran : la
  // transition elle-même suffit, l'origine reste dans le registre.
  return `<div class="h-sys">${escapeHtml(ev.text.replace(/^\[\w+\]\s*/, ''))}</div>`;
}

function hSegmentTemplate(seg, index) {
  if (seg.genre === 'outils') return hValiseOutilsTemplate(seg, index);
  if (seg.genre === 'pensees') return hValisePenseesTemplate(seg, index);
  if (seg.genre === 'operateur') return hOperateurTemplate(seg.ev);
  if (seg.genre === 'permission') return hPermissionTemplate(seg.ev);
  if (seg.genre === 'systeme') return hSystemeTemplate(seg.ev);
  return hParoleTemplate(seg.ev);
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

  corps.innerHTML = (HarnessAPI._isPcOnline() ? '' : hPcAbsentBanner('cette mission')) + hCorpsFil(m);

  const dock = document.getElementById('hMissionDock');
  const actif = HarnessAPI._isPcOnline() && !['echec', 'terminee'].includes(m.state);
  dock.classList.toggle('h-dock-off', !actif);
  dock.querySelector('textarea').disabled = !actif;

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

function hDefilerEnBas() {
  const vue = document.querySelector('[data-view="harness-mission"]');
  if (vue) vue.scrollTop = vue.scrollHeight;
}

// ------------------------------------------------------------------ actions

let hMissionCourante = null;

async function hSendInstruction() {
  const el = document.getElementById('hInstrInput');
  const texte = (el.value || '').trim();
  if (!texte || !hMissionCourante) return;
  await HarnessAPI.sendMissionInstruction(hMissionCourante.id, texte);
  el.value = '';
  el.style.height = 'auto';
  hRenderMissionDetail(hMissionCourante.id);
  showToast('Instruction transmise à la mission', 'accent');
}

async function hPauseOneMission(id) {
  const res = await HarnessAPI.getMission(id);
  const m = res.data;
  if (!m) return;
  if (m.state === 'paused') await HarnessAPI.resumeMission(id);
  else await HarnessAPI.pauseMission(id);
  HSheets.fermer();
  hRenderParc();
  hRenderMissionDetail(id);
}

async function hTerminateMission(id) {
  await HarnessAPI.terminateMission(id);
  HSheets.fermer();
  hRenderParc();
  hRenderMissionDetail(id);
  showToast('Mission terminée — worktree conservé', 'warn');
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
    hMissionRendue.empreinte = empreinte;
  }

  if (m.feed.length !== hMissionRendue.feedLen) {
    const vue = document.querySelector('[data-view="harness-mission"]');
    // « Collé en bas » à 80 px près : ne rattraper le défilement que si on suivait.
    const suivait = vue ? vue.scrollHeight - vue.scrollTop - vue.clientHeight < 80 : true;
    corps.innerHTML = hCorpsFil(m);
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
