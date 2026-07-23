// ============ HARNESS — vue Parc (missions du parc, arbre d'équipes, jauges) ============

function hMissionCounts(missions) {
  const c = { requires_action: 0, running: 0, idle: 0, paused: 0, echec: 0, terminee: 0, landing: 0 };
  missions.forEach((m) => { c[m.state]++; if (m.landing && m.landing.active) c.landing++; });
  return c;
}

function hMcardTemplate(m) {
  const isLanding = m.landing && m.landing.active;
  const isAct = m.state === 'requires_action' && !isLanding;
  const cls = ['card', 'mcard', 'lift', 'msg-in'];
  if (isLanding) cls.push('landing');
  else if (isAct) cls.push('act');
  else if (m.state === 'echec') cls.push('dead');
  else if (m.state === 'terminee') cls.push('done');
  else if (m.state === 'paused') cls.push('paused');
  if (m.freshlyDispatched) cls.push('new');

  const dotColor = isLanding ? 'var(--warn)' : isAct ? 'var(--accent)' : m.state === 'running' ? 'var(--ok)'
    : m.state === 'paused' ? 'var(--warn)' : m.state === 'echec' ? 'var(--err)' : m.state === 'terminee' ? 'var(--ok)' : 'var(--ink-3)';
  const dotLive = (m.state === 'running' || isLanding) ? 'dot-live' : '';

  let actStrip = '';
  if (isLanding) actStrip = `<div class="land-strip"><span class="ripple" style="width:6px;height:6px;border-radius:50%;background:#fff;"></span>atterrissage · compte #${m.landing.account} proche saturation</div>`;
  else if (isAct) actStrip = `<div class="act-strip"><span class="ripple" style="width:6px;height:6px;border-radius:50%;background:#fff;"></span>requires_action · bloquée depuis ${m.blockedSince}</div>`;

  const last = m.feed[m.feed.length - 1];
  const lastText = last ? (last.text.length > 140 ? last.text.slice(0, 140) + '…' : last.text) : '';

  let footExtra;
  if (isLanding) footExtra = `<span>ctx ${m.ctx} %</span><span class="divider-dot"></span><span>consignation en cours</span><span class="divider-dot"></span><span>reset ${m.landing.resetLabel}</span>`;
  else if (isAct || m.state === 'running') footExtra = `<span>ctx ${m.ctx} %</span><span class="divider-dot"></span><span>${hMoney(m.cost)} consommés</span><span class="divider-dot"></span><span>${m.team}</span>`;
  else if (m.state === 'paused') footExtra = `<span>ctx ${m.ctx} %</span><span class="divider-dot"></span><span>pausée il y a ${m.pausedAgo}</span>`;
  else if (m.state === 'idle') footExtra = `<span>ctx ${m.ctx} %</span><span class="divider-dot"></span><span>dernier tour il y a ${m.idleAgo || '—'}</span>`;
  else if (m.state === 'echec') footExtra = `<span>${hMoney(m.cost)} — arrêtée par le juge : boucle détectée</span>`;
  else footExtra = `<span>${hMoney(m.cost)}</span><span class="divider-dot"></span><span>terminée il y a ${m.doneAgo || '—'}</span>`;

  return `<button class="${cls.join(' ')}" onclick="hOpenMission('${m.id}')">
    ${actStrip}
    <div class="row1">
      <span class="sdot ${dotLive}" style="background:${dotColor};"></span>
      <div style="min-width:0;flex:1;">
        <div class="title">${escapeHtml(m.title)}</div>
        <div class="proj"><span>${m.project}</span><span class="divider-dot"></span><span>${m.worktree}</span><span class="divider-dot"></span><span>compte #${m.account}</span></div>
      </div>
      ${(!isAct && !isLanding) ? `<span class="badge" style="${HARNESS_STATE_BADGE[m.state]}">${HARNESS_STATE_LABEL[m.state]}</span>` : ''}
    </div>
    <div class="last">${escapeHtml(lastText)}</div>
    <div class="foot">${footExtra}</div>
  </button>`;
}

async function hRenderParc() {
  const res = await HarnessAPI.getMissions();
  const missions = res.data || [];
  const escRes = await HarnessAPI.getEscalades();
  const escalades = escRes.data || [];
  const c = hMissionCounts(missions);

  document.getElementById('hParcSub').textContent = `${missions.length} missions · ${new Set(missions.map((m) => m.project)).size} projets · 1 mission active par projet (H-56)`;
  document.getElementById('hNavCountParc').textContent = missions.length;
  document.getElementById('hNavCountEsc').textContent = escalades.length;
  document.getElementById('hNavCountEsc').classList.toggle('alert', escalades.length > 0);

  const landingM = missions.filter((m) => m.landing && m.landing.active);
  const actM = missions.filter((m) => m.state === 'requires_action' && !(m.landing && m.landing.active));
  const runM = missions.filter((m) => m.state === 'running' && !(m.landing && m.landing.active));
  const restM = missions.filter((m) => ['paused', 'idle', 'echec', 'terminee'].includes(m.state) && !(m.landing && m.landing.active));

  let html = hPcAbsentBanner('le Parc');
  html += `<div class="parc-strip">
    <div class="stat ${c.requires_action > 0 ? 'alert' : ''}"><div class="k">Requires action</div><div class="v">${c.requires_action}</div></div>
    <div class="stat"><div class="k">Running</div><div class="v" style="color:var(--ok);">${c.running}</div></div>
    <div class="stat ${c.landing > 0 ? 'land' : ''}"><div class="k">Atterrissage</div><div class="v">${c.landing}</div></div>
    <div class="stat"><div class="k">Idle</div><div class="v">${c.idle}</div></div>
    <div class="stat"><div class="k">En pause</div><div class="v" style="color:var(--warn);">${c.paused}</div></div>
    <div class="stat"><div class="k">Échec déf.</div><div class="v" style="color:var(--err);">${c.echec}</div></div>
  </div>`;

  if (landingM.length) { html += `<div class="sec-title">En atterrissage <span class="badge" style="background:var(--warn);color:#fff;">${landingM.length}</span></div>`; html += landingM.map(hMcardTemplate).join(''); }
  if (actM.length) { html += `<div class="sec-title" style="margin-top:22px;">Demande votre arbitrage <span class="badge" style="background:var(--accent);color:#fff;">${actM.length}</span></div>`; html += actM.map(hMcardTemplate).join(''); }
  else if (!landingM.length) html += `<div class="empty-state card" style="margin-bottom:16px;"><div class="t">Rien n'attend ton arbitrage</div><div class="s">Le lead de chaque équipe arbitre seul tant que ça reste dans son plancher de permissions.</div></div>`;

  html += `<div class="sec-title" style="margin-top:22px;">En cours</div>`;
  html += runM.length ? runM.map(hMcardTemplate).join('') : `<div class="empty-state card"><div class="t">Aucune mission en cours</div></div>`;
  html += `<div class="sec-title" style="margin-top:22px;">Au repos et arrêtées</div>`;
  html += restM.length ? restM.map(hMcardTemplate).join('') : `<div class="empty-state card"><div class="t">Rien au repos</div></div>`;

  // ☠ N'écrire QUE si le rendu diffère. Réassigner un innerHTML identique
  // détruit et recrée tous les nœuds — invisible sur un clic, très visible sur
  // une boucle de 4 s (clignotement, sélection de texte perdue).
  const corps = document.getElementById('hParcBody');
  if (corps.innerHTML !== html) corps.innerHTML = html;
  hRenderTeamTree(missions);
  hRenderQuotaStrip();
}

/** ☠ Écrit seulement si le contenu change — voir hRenderParc : un innerHTML
 *  identique réassigné recrée quand même tous les nœuds, et ça se voit en boucle. */
function hEcrireSiDifferent(el, html) {
  if (el && el.innerHTML !== html) el.innerHTML = html;
}

async function hRenderTeamTree(missionsMaybe) {
  const el = document.getElementById('hTeamTree');
  if (!el) return;
  const missions = missionsMaybe || (await HarnessAPI.getMissions()).data || [];
  const teams = missions.filter((m) => ['running', 'requires_action'].includes(m.state));
  if (!teams.length) { hEcrireSiDifferent(el, `<div class="team-tree-empty">Aucune équipe active</div>`); return; }
  hEcrireSiDifferent(el, teams.map((m) => {
    const isLanding = m.landing && m.landing.active;
    const color = isLanding ? 'var(--warn)' : m.state === 'requires_action' ? 'var(--accent)' : 'var(--ok)';
    const active = HarnessState.selectedMissionId === m.id;
    return `<button class="team-node ${active ? 'active' : ''}" onclick="hGoToMission('${m.id}')">
      <span class="team-dot" style="background:${color};"></span>
      <span class="tname">${escapeHtml(m.project)}</span>
      <span class="tmeta">${isLanding ? 'atterrit' : m.state === 'requires_action' ? 'bloquée' : 'ok'}</span>
    </button>`;
  }).join(''));
}

function hAccGaugeMini(a) {
  // Un compte sans relevé de quota est normal (jamais interrogé encore) :
  // on affiche 0, on ne plante pas.
  a = { five_hour: { util: 0, resetLabel: '—' }, seven_day: { util: 0, resetLabel: '—' }, ...a };
  const fiveColor = a.five_hour.util >= 90 ? 'var(--err)' : a.five_hour.util >= 65 ? 'var(--warn)' : 'var(--ok)';
  const sevenColor = a.seven_day.util >= 90 ? 'var(--err)' : a.seven_day.util >= 65 ? 'var(--warn)' : 'var(--ok)';
  return `<div class="mg-acc">
    <div class="mgl">${a.label}<span class="badge" style="${a.status === 'allowed' ? 'background:var(--ok-soft);color:var(--ok);' : 'background:var(--err-soft);color:var(--err);'}">${a.status}</span>${a.isUsingOverage ? '<span class="badge" style="background:var(--warn-soft);color:#8A6A12;margin-left:4px;">dépassement (crédits)</span>' : ''}</div>
    <div class="mg-row"><span class="lbl">5h</span><div class="usage-track"><div class="usage-fill" style="width:${a.five_hour.util}%;background:${fiveColor};"></div></div><span class="pct">${a.five_hour.util}%</span></div>
    <div class="mg-reset">reset ${a.five_hour.resetLabel}</div>
    <div class="mg-row" style="margin-top:6px;"><span class="lbl">7j</span><div class="usage-track"><div class="usage-fill" style="width:${a.seven_day.util}%;background:${sevenColor};"></div></div><span class="pct">${a.seven_day.util}%</span></div>
    <div class="mg-reset">reset ${a.seven_day.resetLabel}</div>
  </div>`;
}
async function hRenderMiniGauges() {
  const el = document.getElementById('hMiniGauges');
  if (!el) return;
  const res = await HarnessAPI.getAccounts();
  // ☠ Le serveur réel rend une LISTE d'identifiants texte (compte-a…), pas un
  // objet indexé 1/2 comme la maquette. Indexer en dur produisait un `undefined`
  // et une page blanche — un écran vide ne dit RIEN, alors que « aucun compte
  // enregistré » dit exactement quoi faire.
  const accounts = hListeComptes(res);
  if (accounts === null) { hEcrireSiDifferent(el, `<div class="mgh">Quotas — PC absent</div>`); return; }
  if (accounts.length === 0) { hEcrireSiDifferent(el, `<div class="mgh">Quotas</div><div class="mg-reset">Aucun compte enregistré dans le registre.</div>`); return; }
  hEcrireSiDifferent(el, `<div class="mgh">Quotas — par compte (H-72)</div>${accounts.map(hAccGaugeMini).join('')}`);
}

/**
 * Normalise la réponse `getAccounts()` en tableau.
 * `null` = PC absent (état normal, H-75) · `[]` = aucun compte connu.
 * Tolère l'ancienne forme objet indexée pour ne pas casser si un écran de
 * démonstration la fournit encore.
 */
function hListeComptes(res) {
  if (!res || !res.data) return null;
  const d = res.data;
  return Array.isArray(d) ? d : Object.values(d).filter(Boolean);
}
async function hRenderQuotaStrip() {
  const el = document.getElementById('hQuotaStripParc');
  if (!el) return;
  const accounts = hListeComptes(await HarnessAPI.getAccounts());
  if (accounts === null) { hEcrireSiDifferent(el, `<span style="color:var(--ink-3);">PC absent — quotas indisponibles</span>`); return; }
  if (accounts.length === 0) { hEcrireSiDifferent(el, `<span style="color:var(--ink-3);">Aucun compte enregistré</span>`); return; }
  const v = (a, w) => (a[w].util >= 90 ? `<b class="warnv">${a[w].util}%</b>` : `<b>${a[w].util}%</b>`);
  el.innerHTML = `${accounts.map((a) => `<button>${a.label} 5h ${v(a, 'five_hour')} · 7j ${v(a, 'seven_day')}${a.isUsingOverage ? ' <b class="warnv">· crédits</b>' : ''}</button>`).join('')}
    <span style="color:var(--ink-3);">— fenêtres non synchronisées, tap pour le détail</span>`;
}

function hOpenMission(id) {
  HarnessState.selectedMissionId = id;
  HarnessState.feedFilter = 'tout';
  hGoto('harness-mission');
  document.getElementById('hMissionBody').innerHTML = `<div class="skeleton" style="height:70px;margin-bottom:14px;"></div><div class="skeleton" style="height:120px;margin-bottom:14px;"></div><div class="skeleton" style="height:220px;"></div>`;
  setTimeout(() => hRenderMissionDetail(id), 200);
}
function hGoToMission(id) {
  HarnessState.selectedMissionId = id;
  HarnessState.feedFilter = 'tout';
  hGoto('harness-mission');
  hRenderMissionDetail(id);
}

// ============ RAFRAÎCHISSEMENT AUTOMATIQUE DES VUES DU PARC ============
/**
 * ☠ Aucune de ces vues ne se rafraîchissait : rendues une fois, puis figées.
 * L'opérateur devait recharger la page pour voir avancer une mission, et une
 * équipe qui se terminait restait affichée « en cours » indéfiniment (23/07).
 * L'orchestrateur avait sa boucle ; le parc n'en a jamais eu.
 *
 * ☠ UNE seule minuterie, toujours liée à la vue VISIBLE : une boucle par vue
 * continuerait d'interroger l'API pour des écrans que personne ne regarde.
 */
const HVUE_POLL_MS = 4000;
let hVueTimer = null;
let hVueEnCours = false;

const HVUES_RAFRAICHIES = {
  'harness-parc': () => hRenderParc(),
  'harness-escalades': () => hRenderEscalades(),
  'harness-comptes': () => hRenderComptes(),
  // ☠ Mise à jour CIBLÉE, jamais un rendu complet : la saisie en cours, les blocs
  // dépliés et la position de lecture doivent survivre. Repli sur un rendu franc
  // seulement si la page n'est pas encore montée (retour de `false`).
  'harness-mission': async () => {
    const id = HarnessState.selectedMissionId;
    if (!id) return;
    if (!(await hMajMissionDetail(id))) await hRenderMissionDetail(id);
  },
};

function hVueActive() {
  const el = document.querySelector('.view.active');
  return el ? el.dataset.view : null;
}

async function hRafraichirVue() {
  // ☠ Jamais deux rendus concurrents : un rendu lent (mission + fil) chevaucherait
  // le suivant et ferait clignoter la page — le défaut qu'on a mis des heures à tuer.
  if (hVueEnCours) return;
  if (document.hidden) return;
  const rendre = HVUES_RAFRAICHIES[hVueActive()];
  if (!rendre) return;
  hVueEnCours = true;
  try {
    await rendre();
  } catch (e) {
    // Un rafraîchissement raté n'interrompt jamais la boucle : le Pi peut être
    // momentanément injoignable, la vue reprendra au tour suivant.
  } finally {
    hVueEnCours = false;
  }
}

function hDemarrerRafraichissement() {
  if (hVueTimer !== null) return;
  hVueTimer = setInterval(hRafraichirVue, HVUE_POLL_MS);
  // Revenir sur l'onglet doit montrer l'état RÉEL tout de suite, pas dans 4 s.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) hRafraichirVue(); });
}
