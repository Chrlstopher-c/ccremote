// ============ HARNESS — détail de mission (mandat, équipe, fil, consommation) ============

/**
 * ☠ Une réflexion et un rapport ne se lisent pas pareil. Le fil montre désormais
 * les phases du lead (réflexions, outils, textes) — sans distinction visuelle,
 * une réflexion exploratoire se lirait comme une conclusion.
 */
function hFeedItemTemplate(ev) {
  let cls = 'fitem ' + ev.type;
  if (ev.type === 'permission') cls += ev.pending ? ' pending' : (ev.resolved ? ' pending' : ' auto');
  if (ev.nature) cls += ' n-' + ev.nature;
  const tagLabel = ev.type === 'permission' ? (ev.pending ? (ev.tool + ' · en attente') : ev.resolved ? (ev.tool + ' · ' + ev.resolved) : (ev.tool + ' · auto'))
    : ev.type === 'instruction' ? 'instruction opérateur'
    : ev.type === 'system' ? (ev.tool || 'système')
    : ev.nature === 'reflexion' ? 'réflexion'
    : ev.nature === 'outil' ? (ev.tool || 'outil')
    : 'réponse';
  // Une réflexion longue est repliée : elle sert à voir que ça avance, pas à être lue en entier.
  const corps = ev.nature === 'reflexion' && ev.text.length > 320
    ? `<details><summary style="cursor:pointer;">${escapeHtml(ev.text.slice(0, 320))}…</summary><div style="margin-top:4px;">${escapeHtml(ev.text)}</div></details>`
    : escapeHtml(ev.text);
  return `<div class="${cls}">
    <span class="ts">${ev.ts || ''}</span>
    <div class="body"><span class="tool-tag">${escapeHtml(tagLabel)}</span>${corps}
      ${ev.path ? `<div class="mono" style="font-size:10px;color:var(--err);margin-top:3px;">${escapeHtml(ev.path)}</div>` : ''}
    </div>
  </div>`;
}
function hFilteredFeed(m) {
  if (HarnessState.feedFilter === 'activite') return m.feed.filter((e) => e.type === 'activity' || e.type === 'system' || e.type === 'instruction');
  if (HarnessState.feedFilter === 'autorisations') return m.feed.filter((e) => e.type === 'permission');
  return m.feed;
}
function hSetFeedFilter(f) { HarnessState.feedFilter = f; hRenderMissionDetail(HarnessState.selectedMissionId); }

function hTeamSectionTemplate(m) {
  if (!m.subagents || !m.subagents.length) {
    const lastText = (m.feed[m.feed.length - 1] || {}).text || '';
    return `<div class="card" style="padding:14px;margin-bottom:14px;">
      <div class="sec-title">Équipe</div>
      <div class="lead-card" style="margin-bottom:0;">
        <div class="lh"><div class="ln"><span class="sdot" style="background:var(--ok);width:7px;height:7px;"></span>Team leader</div><span class="badge" style="background:var(--bg-2);color:var(--ink-3);">${m.team || 'lead seul'}</span></div>
        <div class="la">${escapeHtml(lastText)}</div>
      </div>
    </div>`;
  }
  const last = m.feed.filter((e) => e.type === 'activity').slice(-1)[0];
  const cards = m.subagents.map((a) => {
    const color = a.status === 'actif' ? 'var(--ok)' : a.status === 'attente' ? 'var(--warn)' : 'var(--ink-3)';
    // H-72.4 : un sous-agent connu mais dont le flux n'a rien livré se montre quand même,
    // sans prétendre avoir du détail — jamais masqué.
    const unavailableNote = a.feedUnavailable ? `<div style="font-size:9.5px;color:var(--ink-3);margin-top:5px;">détail temps réel indisponible pour cet agent</div>` : '';
    return `<button class="subagent-card lift" onclick="hOpenAgent('${m.id}','${a.id}')">
      <div class="san"><span class="sa-dot ${a.status === 'actif' ? 'dot-live' : ''}" style="background:${color};"></span>${escapeHtml(a.name)}</div>
      <div class="sar">${a.status}</div>
      <div class="saa">${escapeHtml(a.action)}</div>
      ${unavailableNote}
    </button>`;
  }).join('');
  return `<div class="card" style="padding:14px;margin-bottom:14px;">
    <div class="sec-title">Équipe — une décomposition navigable (H-72)</div>
    <div class="lead-card">
      <div class="lh"><div class="ln"><span class="sdot dot-live" style="background:var(--ok);width:7px;height:7px;"></span>Team leader</div><span class="badge" style="background:var(--bg-2);color:var(--ink-3);">${m.team}</span></div>
      <div class="la">${last ? escapeHtml(last.text) : "Coordonne l'équipe, aucune action récente journalisée."}</div>
    </div>
    <div style="font-size:10.5px;color:var(--ink-3);margin-bottom:8px;">Sous-agents actifs — clique pour voir son travail en temps réel</div>
    <div class="subagents-row">${cards}</div>
  </div>`;
}

async function hRenderMissionDetail(id) {
  const res = await HarnessAPI.getMission(id);
  const m = res.data;
  if (!m) {
    document.getElementById('hMissionBody').innerHTML = res.pcOnline === false
      ? hPcAbsentBanner('cette mission')
      : `<div class="empty-state"><div class="t">Mission introuvable</div></div>`;
    return;
  }
  document.getElementById('hMissionTitle').textContent = m.title;
  document.getElementById('hMissionSub').textContent = `${m.project} · ${m.id.toUpperCase()}`;
  const isLanding = m.landing && m.landing.active;
  document.getElementById('hMissionBadge').style.cssText = isLanding ? 'background:var(--warn);color:#fff;' : HARNESS_STATE_BADGE[m.state];
  document.getElementById('hMissionBadge').textContent = isLanding ? 'atterrissage' : HARNESS_STATE_LABEL[m.state];

  let bandeau = hPcAbsentBanner('cette mission');
  if (isLanding) {
    const stepText = m.landing.step >= 1 ? 'Consignation en cours — état écrit dans STATE.md et mémoire sémantique.' : 'Atterrissage engagé — la mission va consigner son état avant que le quota ne coupe net.';
    bandeau += `<div class="card msg-in land-banner">
      <div style="font-size:12px;font-weight:600;color:#8A6A12;text-transform:uppercase;letter-spacing:.04em;">Atterrissage en cours (H-70)</div>
      <div style="font-size:13px;line-height:1.5;margin-top:7px;">${stepText}</div>
      <div style="font-size:11px;color:var(--ink-3);margin-top:8px;">Cause : fenêtre du compte #${m.landing.account} proche de la saturation (reset ${m.landing.resetLabel}). Relance automatique après le reset.</div>
    </div>`;
  } else if (m.state === 'requires_action') {
    bandeau += `<div class="card msg-in" style="border-color:var(--accent);background:var(--accent-soft);padding:13px 14px;margin-bottom:16px;">
      <div style="font-size:12px;font-weight:600;color:var(--accent-2);text-transform:uppercase;letter-spacing:.04em;">Bloquée depuis ${m.blockedSince}</div>
    </div>`;
  }

  const canAct = HarnessAPI._isPcOnline() && !['echec', 'terminee'].includes(m.state);
  const disabledAttr = canAct ? '' : 'disabled';
  const canLand = HarnessAPI._isPcOnline() && ['running', 'requires_action'].includes(m.state) && !isLanding;

  document.getElementById('hMissionBody').innerHTML = `
    ${bandeau}
    <div class="card" style="padding:14px;margin-bottom:14px;">
      <div class="sec-title">Mandat</div>
      <p style="font-size:13px;line-height:1.55;margin:0 0 10px;">${escapeHtml(m.mandate.but)}</p>
      <div style="font-size:11.5px;color:var(--ink-3);"><strong style="color:var(--ink-2);">Critère d'arrêt</strong> — ${escapeHtml(m.mandate.critere)}</div>
    </div>
    ${hTeamSectionTemplate(m)}
    <div class="card" style="padding:14px;margin-bottom:14px;">
      <div class="sec-title">Identité et bornes</div>
      <div class="kv">
        <!-- ☠ L'identifiant est ce que l'orchestrateur comprend le plus sûrement.
             Ne pas l'afficher obligeait à le deviner ou à désigner l'équipe par
             un nom que l'outil n'acceptait pas — constaté le 23/07. -->
        <div><span class="k">Identifiant</span><span class="v mono" style="cursor:pointer;" title="Copier l'identifiant" onclick="hCopierId('${m.id}')">${escapeHtml(m.id)}</span></div>
        <div><span class="k">Projet</span><span class="v">${m.project}</span></div>
        <div><span class="k">Worktree</span><span class="v">${escapeHtml(m.worktree || '—')}</span></div>
        <div><span class="k">sessionId</span><span class="v">${m.sessionId || '—'}</span></div>
        <div><span class="k">Compte Claude Code</span><span class="v">compte #${m.account}</span></div>
        <div><span class="k">Modèle résolu</span><span class="v" data-maj="model">${m.model}</span></div>
        <div><span class="k">Epoch</span><span class="v">${m.epoch}</span></div>
      </div>
      <div style="margin-top:11px;">
        <div style="display:flex;justify-content:space-between;font-size:11.5px;margin-bottom:4px;"><span class="muted">Usage de contexte</span><span class="mono" data-maj="ctx">${m.ctx} %${hCtxTokens(m)}</span></div>
        <div class="usage-track"><div class="usage-fill" data-maj="ctxbar" style="width:${m.ctx}%;background:${m.ctx >= 75 ? 'var(--err)' : m.ctx >= 50 ? 'var(--warn)' : 'var(--ok)'};"></div></div>
        ${hCtxDetail(m)}
      </div>
      ${canLand ? `<div style="margin-top:11px;"><button class="btn btn-ghost btn-sm" onclick="hSimulateLanding('${m.id}')">Simuler un atterrissage (démo)</button></div>` : ''}
    </div>
    <div class="card" style="padding:14px;margin-bottom:14px;">
      <div class="sec-title">Consommation &amp; inspection <span class="badge" data-maj="cost" style="background:var(--bg-2);color:var(--ink-3);">${hMoney(m.cost)} consommés</span></div>
      <p style="font-size:11px;color:var(--ink-3);line-height:1.5;margin:0 0 11px;">Sur abonnement, le dollar ne borne rien (H-68) — c'est un déclencheur d'inspection, jamais un plafond.</p>
      <div class="kv" style="grid-template-columns: 1fr !important;">
        <div><span class="k">Prochain point d'inspection</span><span class="v">${hNextThreshold(m.cost) !== null ? hMoney(hNextThreshold(m.cost)) : '— mission arrêtée'}</span></div>
        <div><span class="k">Dernière inspection</span><span class="v">${m.inspection.lastVerdict ? escapeHtml(m.inspection.lastAt) : 'aucune encore'}</span></div>
      </div>
      <div style="margin-top:11px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        ${hVerdictBadge(m.inspection.lastVerdict)}
        <button class="btn btn-ghost btn-sm" onclick="hRunInspection('${m.id}')" ${disabledAttr}>Lancer une inspection maintenant</button>
      </div>
    </div>
    <div class="card" style="padding:14px;margin-bottom:14px;">
      <div class="sec-title">Fil de la mission <span class="badge" data-maj="feedcount" style="background:var(--bg-2);color:var(--ink-3);">${m.feed.length} évènements</span></div>
      <div class="feed-filter">
        <button class="fchip ${HarnessState.feedFilter === 'tout' ? 'active' : ''}" onclick="hSetFeedFilter('tout')">Tout</button>
        <button class="fchip ${HarnessState.feedFilter === 'activite' ? 'active' : ''}" onclick="hSetFeedFilter('activite')">Activité</button>
        <button class="fchip ${HarnessState.feedFilter === 'autorisations' ? 'active' : ''}" onclick="hSetFeedFilter('autorisations')">Autorisations</button>
      </div>
      <div class="feed-scroll" id="hFeedScroll">${hFilteredFeed(m).map(hFeedItemTemplate).join('') || '<div class="empty-state"><div class="s">Aucun évènement pour ce filtre.</div></div>'}</div>
      <div style="font-size:10px;color:var(--ink-3);margin-top:8px;line-height:1.5;">Toutes les autorisations sont journalisées ici, y compris celles résolues seules par le lead (H-64).</div>
      <div class="instr-row">
        <div class="input-wrap"><textarea id="hInstrInput" rows="1" placeholder="Parler à cette mission — une instruction, pas une interruption du tour en cours." ${disabledAttr}></textarea></div>
        <button class="btn btn-primary" onclick="hSendInstruction('${m.id}')" ${disabledAttr}>Envoyer</button>
      </div>
      ${!HarnessAPI._isPcOnline() ? `<div class="hint" style="color:var(--err);margin-top:6px;">PC absent — le message serait mis en file côté Pi, à confirmer au retour du PC.</div>` : ''}
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;">
      <button class="btn btn-ghost" style="flex:1;" onclick="hPauseOneMission('${m.id}')" ${disabledAttr}>${m.state === 'paused' ? 'Reprendre' : 'Mettre en pause'}</button>
      <button class="btn btn-ghost" style="flex:1;color:var(--err);border-color:var(--err-soft);" onclick="hTerminateMission('${m.id}')" ${disabledAttr}>Terminer</button>
    </div>
  `;
  const scroll = document.getElementById('hFeedScroll');
  if (scroll) scroll.scrollTop = scroll.scrollHeight;
  hMissionRendue = { id: m.id, empreinte: hEmpreinteMission(m), feedLen: m.feed.length };
  hRenderTeamTree();
}

function hTokens(n) {
  return n >= 1000 ? `${Math.round(n / 100) / 10} K` : `${n}`;
}

function hCtxTokens(m) {
  const t = m.ctxTokens;
  if (!t || t.utilises === null || t.utilises === undefined) return '';
  return ` <span class="muted">· ${hTokens(t.utilises)}${t.max ? ` / ${hTokens(t.max)}` : ''}</span>`;
}

/**
 * ☠ Le pourcentage seul ne dit pas ce qu'il contient. Mesuré le 23/07 : sur une
 * mission à 10 %, ~24 K sont du socle présent dès le premier token (prompt
 * système, outils, CLAUDE.md, skills) et le reste est du travail réel. C'est sur
 * cette distinction qu'on décide d'un atterrissage — l'afficher, c'est éviter de
 * conclure « le lead sature » quand il n'a encore rien fait.
 *
 * Les postes DIFFÉRÉS sont annoncés mais pas chargés : ils ne comptent pas dans
 * le total, et sont donc rendus à part plutôt que mêlés aux autres.
 */
function hCtxDetail(m) {
  const postes = (m.ctxDetail || []).filter((p) => p.tokens > 0 && p.nom !== 'Free space');
  if (postes.length === 0) return '';
  const charges = postes.filter((p) => !p.differe);
  const differes = postes.filter((p) => p.differe);
  const ligne = (p) =>
    `<div style="display:flex;justify-content:space-between;gap:10px;"><span>${escapeHtml(p.nom)}</span><span class="mono">${hTokens(p.tokens)}</span></div>`;
  return `
    <details style="margin-top:8px;">
      <summary style="font-size:11px;color:var(--ink-3);cursor:pointer;">Détail du contexte</summary>
      <div style="font-size:11px;color:var(--ink-2);margin-top:6px;display:grid;gap:3px;">
        ${charges.map(ligne).join('')}
        ${differes.length > 0 ? `<div style="margin-top:5px;padding-top:5px;border-top:1px solid var(--bg-2);color:var(--ink-3);">Annoncés mais non chargés — hors total</div>${differes.map(ligne).join('')}` : ''}
      </div>
    </details>`;
}

async function hCopierId(id) {
  try {
    await navigator.clipboard.writeText(id);
    showToast('Identifiant copié — utilisable tel quel avec le master', 'accent');
  } catch {
    showToast('Copie refusée par le navigateur', 'warn');
  }
}

async function hSendInstruction(missionId) {
  const el = document.getElementById('hInstrInput');
  const text = (el.value || '').trim();
  if (!text) return;
  await HarnessAPI.sendMissionInstruction(missionId, text);
  el.value = '';
  hRenderMissionDetail(missionId);
  showToast('Instruction transmise à la mission', 'accent');
}
async function hPauseOneMission(id) {
  const res = await HarnessAPI.getMission(id);
  const m = res.data;
  if (!m) return;
  if (m.state === 'paused') await HarnessAPI.resumeMission(id); else await HarnessAPI.pauseMission(id);
  hRenderParc(); hRenderMissionDetail(id);
}
async function hTerminateMission(id) {
  await HarnessAPI.terminateMission(id);
  hRenderParc(); hRenderMissionDetail(id);
  showToast('Mission terminée — worktree conservé', 'warn');
}
async function hRunInspection(id) {
  const res = await HarnessAPI.runInspection(id);
  if (!res.data) return;
  hRenderParc(); hRenderMissionDetail(id);
  const v = res.data.inspection.lastVerdict;
  showToast(v === 'boucle' ? "Juge d'inspection : boucle — mission arrêtée" : `Juge d'inspection : ${v}`, v === 'boucle' ? 'err' : 'ok');
}
async function hSimulateLanding(missionId) {
  await HarnessAPI.simulateLanding(missionId);
  hRenderParc(); hRenderMissionDetail(missionId);
  showToast('Atterrissage engagé (démo)', 'warn');
}


// ============ MISE À JOUR CIBLÉE (jamais de re-rendu complet en boucle) ============
/**
 * ☠ Réécrire `innerHTML` toutes les 4 s EST le clignotement — c'est le défaut
 * qu'on a mis des heures à traquer le 23/07. La boucle ne reconstruit donc
 * jamais la page : elle compare, puis ne touche QUE ce qui a changé. Un rendu
 * complet reste possible, mais seulement sur changement de mission ou de filtre.
 */
let hMissionRendue = null;

/** Ce qui, en changeant, justifie de toucher au DOM. Le fil est compté à part. */
function hEmpreinteMission(m) {
  return [m.state, m.model, m.ctx, m.cost, m.sessionId, m.worktree, m.epoch, m.retries,
    m.blockedSince, m.pausedAgo, m.idleAgo, m.doneAgo, (m.subagents || []).length].join('|');
}

function hMajChamp(nom, html) {
  const el = document.querySelector(`#hMissionBody [data-maj="${nom}"]`);
  // ☠ Ne réécrire que si la valeur DIFFÈRE : réassigner un innerHTML identique
  // recrée quand même les nœuds, et c'est visible à l'œil sur une boucle courte.
  if (el && el.innerHTML !== html) el.innerHTML = html;
}

/**
 * Rafraîchit la vue mission SANS la reconstruire. Rend `false` si un rendu
 * complet est nécessaire (autre mission, page pas encore montée).
 */
async function hMajMissionDetail(id) {
  if (!hMissionRendue || hMissionRendue.id !== id) return false;
  if (!document.querySelector('#hMissionBody [data-maj="ctx"]')) return false;
  const res = await HarnessAPI.getMission(id);
  const m = res.data;
  if (!m) return false;

  const empreinte = hEmpreinteMission(m);
  if (empreinte !== hMissionRendue.empreinte) {
    document.getElementById('hMissionBadge').style.cssText = HARNESS_STATE_BADGE[m.state];
    document.getElementById('hMissionBadge').textContent = HARNESS_STATE_LABEL[m.state];
    hMajChamp('model', m.model);
    hMajChamp('ctx', `${m.ctx} %${hCtxTokens(m)}`);
    hMajChamp('cost', `${hMoney(m.cost)} consommés`);
    const barre = document.querySelector('#hMissionBody [data-maj="ctxbar"]');
    if (barre) {
      barre.style.width = `${m.ctx}%`;
      barre.style.background = m.ctx >= 75 ? 'var(--err)' : m.ctx >= 50 ? 'var(--warn)' : 'var(--ok)';
    }
    hMissionRendue.empreinte = empreinte;
  }

  hMajFil(m);
  return true;
}

/**
 * Ajoute au fil les évènements manquants, sans toucher aux précédents.
 *
 * ☠ Append seulement : réécrire tout le fil refermerait les réflexions dépliées
 * et casserait la sélection de texte en cours. Le fil est trié et ne réordonne
 * jamais son passé — le nombre d'éléments suffit donc à savoir ce qui est neuf.
 */
function hMajFil(m) {
  const filtre = hFilteredFeed(m);
  const scroll = document.getElementById('hFeedScroll');
  if (!scroll) return;
  hMajChamp('feedcount', `${m.feed.length} évènements`);
  const dejaLa = scroll.querySelectorAll('.fitem').length;
  if (filtre.length === dejaLa) return;
  if (filtre.length < dejaLa) {
    // Le fil a rétréci (changement de filtre) : là, un rendu franc est correct.
    scroll.innerHTML = filtre.map(hFeedItemTemplate).join('');
    return;
  }
  // « Collé en bas » à 40 px près : ne rattraper le défilement que si on suivait déjà.
  const suivait = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 60;
  const vide = scroll.querySelector('.empty-state');
  if (vide) vide.remove();
  scroll.insertAdjacentHTML('beforeend', filtre.slice(dejaLa).map(hFeedItemTemplate).join(''));
  if (suivait) scroll.scrollTop = scroll.scrollHeight;
}
