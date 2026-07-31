// ============ Feuilles de la page mission ============
//
// Tout ce qui n'est pas « ce que l'équipe dit » vit ici : le détail des outils,
// les réflexions, l'identité, le mandat, les sous-agents, les commandes de fin
// de vie. ☠ Rien de tout ça ne remonte dans le fil — c'est la règle qui rend la
// page lisible, et c'est exactement ce que fait Claude Code.

const H_ICONES_OUTIL = {
  ran: '<path d="M4 6l5 5-5 5M12 17h8"/>',
  read: '<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="2.6"/>',
  wrote: '<path d="M4 20h16M6 16l9.5-9.5a2 2 0 0 0-3-3L3 13v3h3z"/>',
  searched: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
};

function hIconeOutil(outil) {
  const verbe = hVerbe(outil)[0];
  const cle = verbe === 'edited' ? 'wrote' : (H_ICONES_OUTIL[verbe] ? verbe : 'ran');
  return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${H_ICONES_OUTIL[cle]}</svg>`;
}

/** Verbe affiché dans la liste d'une valise : « Ran », « Read », « Wrote ». */
function hVerbeAffiche(outil) {
  const v = hVerbe(outil)[0];
  return v.charAt(0).toUpperCase() + v.slice(1);
}

function hOuvrirValise(index) {
  const seg = hSegmentsCourants[index];
  if (!seg) return;
  if (seg.genre === 'pensees') {
    const html = `<div class="h-think">${seg.items.map((e) => hMarkdown(e.text)).join('')}</div>`;
    HSheets.ouvrir({ titre: 'Thought process', html });
    return;
  }
  const lignes = seg.items.map((ev, i) => {
    const c = hParseOutil(ev.text);
    const chemin = c.file_path || c.path || c.notebook_path;
    const mono = chemin ? ' mono' : '';
    const arg = escapeHtml(chemin ? chemin.split('/').pop() : hResumeOutil(ev));
    return `<button class="h-step" onclick="hOuvrirOutil(${index},${i})">
      <span class="si">${hIconeOutil(ev.tool)}</span>
      <span class="sv"><b>${escapeHtml(hVerbeAffiche(ev.tool))}</b> <span class="${mono}">${arg}</span></span>
    </button>`;
  }).join('');
  HSheets.ouvrir({ titre: hLibelleValise(seg.items), html: lignes });
}

/**
 * Détail d'un appel. ☠ On ne rend que les champs RÉELLEMENT relevés par le PC
 * (`CHAMPS_OUTIL` de `collecteur-telemetrie.ts`) — le résultat de l'outil n'est
 * pas capté, et fabriquer une section « Output » vide serait un mensonge poli.
 */
function hOuvrirOutil(indexSeg, indexOutil) {
  const seg = hSegmentsCourants[indexSeg];
  const ev = seg && seg.items[indexOutil];
  if (!ev) return;
  const c = hParseOutil(ev.text);
  const bloc = (titre, valeur) => (valeur
    ? `<div class="h-lbl">${titre}</div><div class="h-blk">${escapeHtml(valeur)}</div>` : '');
  const html =
    (c.description ? `<div class="h-step-desc">${escapeHtml(c.description)}</div>` : '') +
    bloc('Command', c.command) +
    bloc('File', c.file_path || c.path || c.notebook_path) +
    bloc('Pattern', c.pattern) +
    bloc('Query', c.query) +
    bloc('URL', c.url) +
    bloc('Prompt', c.prompt) +
    `<div class="h-note">Relevé à ${escapeHtml(ev.ts)}. Le harness journalise l’appel, pas son résultat (H-45).</div>`;
  HSheets.ouvrir({
    titre: ev.tool || 'Outil',
    html,
    retour: () => hOuvrirValise(indexSeg),
  });
}

function hVoirPermission(texte) {
  HSheets.ouvrir({ titre: 'Autorisation', html: `<div class="h-blk">${texte}</div>` });
}

// ------------------------------------------------------------------ détails

function hLigneKv(k, v, mono = true) {
  return `<div><span class="k">${escapeHtml(k)}</span><span class="v${mono ? '' : ' texte'}">${escapeHtml(v)}</span></div>`;
}

function hJaugeContexte(m) {
  const couleur = m.ctx >= 75 ? 'var(--err)' : m.ctx >= 50 ? 'var(--warn)' : 'var(--ok)';
  const t = m.ctxTokens || {};
  const brut = t.utilises === null || t.utilises === undefined ? ''
    : `${hTokens(t.utilises)}${t.max ? ` / ${hTokens(t.max)}` : ''}`;
  return `<div class="h-gauge"><div class="gt"><span>${m.ctx} %</span><span>${brut}</span></div>
    <div class="h-bar"><i style="width:${m.ctx}%;background:${couleur}"></i></div></div>`;
}

/**
 * Ventilation du contexte par poste.
 *
 * ☠ MESURÉ le 23/07 : sur une mission à 10 %, ~24 K sont du socle présent dès le
 * premier token (prompt système, outils, CLAUDE.md, skills) et le reste est du
 * travail réel. C'est sur cette distinction qu'on décide d'un atterrissage —
 * sans elle, on conclut « le lead sature » alors qu'il n'a encore rien fait.
 * Les postes DIFFÉRÉS sont annoncés mais pas chargés : hors total, donc à part.
 */
function hDetailContexte(m) {
  const postes = (m.ctxDetail || []).filter((p) => p.tokens > 0 && p.nom !== 'Free space');
  if (postes.length === 0) return '';
  const ligne = (p) => `<div><span class="k">${escapeHtml(p.nom)}</span><span class="v">${hTokens(p.tokens)}</span></div>`;
  const charges = postes.filter((p) => !p.differe);
  const differes = postes.filter((p) => p.differe);
  return `<details class="h-det"><summary>Détail du contexte</summary><div class="h-kv">
      ${charges.map(ligne).join('')}
      ${differes.length ? `<div class="h-sep">Annoncés mais non chargés — hors total</div>${differes.map(ligne).join('')}` : ''}
    </div></details>`;
}

function hOuvrirDetails() {
  const m = hMissionCourante;
  if (!m) return;
  const actif = HarnessAPI._isPcOnline() && !['echec', 'terminee'].includes(m.state);
  const age = m.blockedSince || m.pausedAgo || m.idleAgo || m.doneAgo;
  const html = `
    <div class="h-grp"><div class="gh">Contexte</div>${hJaugeContexte(m)}${hDetailContexte(m)}
      <div class="h-kv">
        ${hLigneKv('Consommé', hMoney(m.cost))}
        ${hNextThreshold(m.cost) !== null ? hLigneKv("Prochaine inspection", hMoney(hNextThreshold(m.cost))) : ''}
        ${age ? hLigneKv(HARNESS_STATE_LABEL[m.state], age, false) : ''}
      </div></div>
    <div class="h-grp"><div class="gh">Identité</div>
      <div class="h-kv">
        ${hLigneKv('Projet', m.project)}
        ${hLigneKv('Worktree', m.worktree || '—')}
        ${hLigneKv('Mission', m.id)}
        ${hLigneKv('Session', m.sessionId || '—')}
        ${hLigneKv('Compte', `compte #${m.account}`)}
        ${hLigneKv('Modèle', m.model)}
        ${hLigneKv('Epoch', String(m.epoch))}
      </div>
      <button class="h-row" onclick="hCopierId('${m.id}')">Copier l’identifiant<span class="rv">⧉</span></button>
    </div>
    <div class="h-grp">
      <button class="h-row" onclick="hOuvrirMandat()">Mandat<span class="rv">›</span></button>
      <button class="h-row" onclick="hOuvrirAgents()">Sous-agents<span class="rv">${(m.subagents || []).length} ›</span></button>
    </div>
    <div class="h-grp">
      <button class="h-row" ${actif ? '' : 'disabled'} onclick="hRunInspection('${m.id}')">Lancer une inspection</button>
      <button class="h-row" ${actif ? '' : 'disabled'} onclick="hPauseOneMission('${m.id}')">${m.state === 'paused' ? 'Reprendre' : 'Mettre en pause'}</button>
      <button class="h-row danger" ${actif ? '' : 'disabled'} onclick="hTerminateMission('${m.id}')">Terminer l’équipe</button>
    </div>`;
  HSheets.ouvrir({ titre: 'Détails de la mission', html });
}

function hOuvrirMandat() {
  const m = hMissionCourante;
  if (!m) return;
  const html = `<div class="h-mand">${hMarkdown(m.mandate.but)}
    <h4>Critère d’arrêt</h4>${hMarkdown(m.mandate.critere)}</div>`;
  HSheets.ouvrir({ titre: 'Mandat', html, retour: hOuvrirDetails });
}

function hOuvrirAgents() {
  const m = hMissionCourante;
  if (!m) return;
  const agents = m.subagents || [];
  if (agents.length === 0) {
    HSheets.ouvrir({
      titre: 'Sous-agents',
      html: '<div class="h-note">Le lead travaille seul sur cette mission.</div>',
      retour: hOuvrirDetails,
    });
    return;
  }
  const couleur = (s) => (s === 'actif' ? 'var(--ok)' : s === 'attente' ? 'var(--warn)' : 'var(--ink-3)');
  const html = `<div class="h-grp">${agents.map((a) => `
    <button class="h-agent" onclick="HSheets.fermer();hOpenAgent('${m.id}','${a.id}')">
      <span class="ad${a.status === 'actif' ? ' dot-live' : ''}" style="background:${couleur(a.status)}"></span>
      <span class="an">${escapeHtml(a.name)}<i>${escapeHtml(a.feedUnavailable ? 'détail temps réel indisponible' : a.action)}</i></span>
      <span class="as">${escapeHtml(a.status)} ›</span>
    </button>`).join('')}</div>`;
  HSheets.ouvrir({ titre: `${agents.length} sous-agent${agents.length > 1 ? 's' : ''}`, html, retour: hOuvrirDetails });
}

function hTokens(n) {
  return n >= 1000 ? `${Math.round(n / 100) / 10} K` : `${n}`;
}
