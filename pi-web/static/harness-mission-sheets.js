// ============ Feuilles de la page mission ============
//
// Tout ce qui n'est pas « ce que l'équipe dit » vit ici : le détail des outils,
// les réflexions, l'identité, le mandat, les sous-agents, les commandes de fin
// de vie. ☠ Rien de tout ça ne remonte dans le fil — c'est la règle qui rend la
// page lisible, et c'est exactement ce que fait Claude Code.
//
// Deux exceptions assumées, toutes deux au service des sous-agents : la valise
// de DÉLÉGATION ouvre en place sur la liste des agents lancés, et leur fil
// s'ouvre dans une feuille rendue avec le MÊME vocabulaire que celui du lead
// (valises d'outils, réflexions dépliables, parole en serif).

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

/**
 * Un identifiant qui part dans un `onclick`.
 *
 * ☠ La valeur traverse DEUX analyseurs — le décodeur HTML de l'attribut, puis
 * l'analyseur JavaScript. `escapeHtml` seul rend `&#39;`, que le navigateur
 * redonne en apostrophe NUE au moment d'évaluer le code : la chaîne se referme,
 * l'appel devient invalide, et le bouton meurt en silence — aucune erreur
 * visible, juste une ligne qui ne répond plus.
 */
function hArgJs(v) {
  return escapeHtml(String(v === undefined || v === null ? '' : v).replace(/\\/g, '\\\\').replace(/'/g, "\\'"));
}

// ------------------------------------------------------- valises d'outils

/**
 * Corps déplié d'une valise d'outils du fil de l'ÉQUIPE. ☠ En place dans le
 * fil, jamais en feuille — c'est ce que fait la vue Claude Code, et ça garde la
 * lecture continue.
 */
function hCorpsValiseOutils(index) {
  const seg = hSegmentsCourants[index];
  if (!seg) return '';
  return hCorpsOutils(seg.items, `outils-${index}`, {});
}

/**
 * Une carte par appel, chacune ouvrant sa commande et ses arguments.
 *
 * ☠ `prefixe` n'est pas décoratif : le fil de l'équipe et celui d'un sous-agent
 * coexistent à l'écran (la feuille par-dessus la page). `HValise.enregistrer`
 * écrase par clé — deux corps enregistrés sous la même clé se remplacent, et la
 * valise de l'équipe ouvre alors sur le travail du sous-agent.
 */
function hCorpsOutils(items, prefixe, options = {}) {
  if (hEstDelegation(items[0])) return hCorpsDelegations(items);
  return items.map((ev, i) => {
    const c = hParseOutil(ev.text);
    const chemin = c.file_path || c.path || c.notebook_path;
    const titre = `${hVerbeAffiche(ev.tool)} ${chemin ? chemin.split('/').pop() : hResumeOutil(ev)}`;
    const cle = HValise.enregistrer(() => hCorpsOutil(ev, options), `${prefixe}-c${i}`);
    return HValise.carte(titre, cle, !!chemin);
  }).join('');
}

/**
 * ☠ On ne rend que les champs RÉELLEMENT relevés par le PC (`CHAMPS_OUTIL` de
 * `collecteur-telemetrie.ts`). Le résultat de l'outil n'est pas capté : afficher
 * une section « Output » vide serait un mensonge poli.
 */
function hCorpsOutil(ev, options = {}) {
  const c = hParseOutil(ev.text);
  const bloc = (titre, valeur) => (valeur
    ? `<div class="h-lbl">${titre}</div><div class="h-blk">${escapeHtml(valeur)}</div>` : '');
  return (c.description && c.command ? `<div class="h-step-desc">${escapeHtml(c.description)}</div>` : '')
    + bloc('Command', c.command)
    + bloc('File', c.file_path || c.path || c.notebook_path)
    + bloc('Pattern', c.pattern) + bloc('Query', c.query)
    + bloc('URL', c.url) + bloc('Prompt', c.prompt)
    + hSortieOutil(ev, options);
}

/**
 * ☠ La sortie DISTINGUE TROIS cas, et un seul mot les sépare. Revenue : on la
 * montre. Pas encore là chez un LEAD : l'appel est en vol, ou le worker est
 * mort entre l'appel et sa réponse — l'absence dit quelque chose. Pas là chez un
 * SOUS-AGENT : elle n'est jamais relevée (`versSubagentDetailApi` ne porte que
 * `texte / survenuA / type / outil`), donc l'absence ne dit RIEN de l'appel.
 * Servir la phrase du lead à un sous-agent ferait soupçonner un worker mort à
 * chaque ligne d'un agent parfaitement sain.
 */
function hSortieOutil(ev, options) {
  if (ev.result) {
    return `<div class="h-lbl">Output${ev.resultError ? ' <span class="h-err">erreur</span>' : ''}</div>`
      + `<div class="h-blk${ev.resultError ? ' err' : ''}">${escapeHtml(ev.result)}</div>`;
  }
  if (options.sansResultat) {
    return '<div class="h-note">Sortie non relevée — le relevé d’un sous-agent porte ses appels,'
      + ' pas leurs résultats. Ce vide ne dit rien de l’appel lui-même.</div>';
  }
  return '<div class="h-note">Sortie non revenue — appel encore en vol, ou worker arrêté entre l’appel et sa réponse.</div>';
}

// ------------------------------------------------------------ délégations

/**
 * Corps d'une valise de DÉLÉGATION : les sous-agents lancés là, chacun ouvrant
 * directement son fil. Deux appuis depuis le fil de l'équipe, au point exact du
 * travail où la délégation a eu lieu.
 *
 * ☠ Le rapprochement appel `Task` ⟷ sous-agent se fait par la DESCRIPTION (voir
 * `hNomDelegation`). Quand il échoue, on rend l'appel SANS bouton plutôt qu'un
 * bouton qui ouvrirait le fil d'un autre agent : une mauvaise correspondance ne
 * se voit pas, on lit le travail de quelqu'un d'autre en croyant le sien.
 */
function hCorpsDelegations(items) {
  const m = hMissionCourante || {};
  const agents = m.subagents || [];
  const lignes = items.map((ev) => {
    const nom = hNomDelegation(ev) || hResumeOutil(ev);
    const agent = agents.find((a) => (a.name || '').trim() === nom);
    if (agent) return hBoutonAgent(m.id, agent, '');
    return `<div class="h-deleg-orphe"><b>${escapeHtml(nom)}</b>
      <i>Lancé, mais aucun sous-agent du registre ne porte ce nom — son fil n’est pas rattachable.</i></div>`;
  }).join('');
  return `<div class="h-deleg">${lignes}</div>`;
}

/**
 * Une ligne de sous-agent, cliquable, partout où on en montre un.
 *
 * ☠ La couleur de la pastille ne dit QUE l'état de travail : vert il tourne,
 * ambre il attend, gris il a rendu. Rien d'autre n'est encodé dedans — un point
 * qui voudrait aussi dire « en erreur » ferait deux affirmations avec un pixel.
 */
function hBoutonAgent(missionId, a, origine) {
  const couleur = a.status === 'actif' ? 'var(--ok)' : a.status === 'attente' ? 'var(--warn)' : 'var(--ink-3)';
  // `|| ''` et pas seulement `a.action` : un champ absent rendrait le mot
  // « undefined » à l'écran, que l'opérateur lirait comme une action réelle.
  const sous = a.feedUnavailable ? 'aucune action lisible relevée' : (a.action || '');
  const args = `'${hArgJs(missionId)}','${hArgJs(a.id)}','${hArgJs(a.name)}','${hArgJs(origine)}'`;
  // `void` : l'ouverture est asynchrone et personne n'attend son résultat — une
  // promesse flottante dans un `onclick` avale toute erreur de chargement.
  return `<button class="h-agent" onclick="void hOuvrirFilAgent(${args})">
    <span class="ad${a.status === 'actif' ? ' dot-live' : ''}" style="background:${couleur}"></span>
    <span class="an">${escapeHtml(a.name)}<i>${escapeHtml(sous)}</i></span>
    <span class="as">${escapeHtml(a.status)} ›</span>
  </button>`;
}

// --------------------------------------------------- fil d'un sous-agent

/** Jeton du fil en cours de chargement — voir la garde de `hOuvrirFilAgent`. */
let hJetonFilAgent = 0;

/**
 * Le fil d'un sous-agent, dans une feuille, rendu comme celui de l'équipe.
 *
 * ☠ La feuille s'ouvre AVANT la réponse (le PC peut être absent des heures,
 * H-75 : un écran figé sans retour serait pris pour un bouton mort), donc elle
 * peut être fermée ou remplacée pendant l'appel. Le jeton est ce qui empêche de
 * déposer le fil d'un agent dans le panneau d'un autre — panne silencieuse
 * parfaite : le titre reste juste, le contenu ment.
 */
async function hOuvrirFilAgent(missionId, agentId, nom, origine) {
  const jeton = `${agentId}#${(hJetonFilAgent += 1)}`;
  HSheets.ouvrir({
    titre: nom || 'Sous-agent',
    html: `<div class="h-fil-agent" id="hFilAgentCorps" data-jeton="${escapeHtml(jeton)}">
      <div class="h-note">Chargement du fil…</div></div>`,
    retour: origine === 'details' ? hOuvrirDetails : undefined,
  });
  const res = await HarnessAPI.getAgent(missionId, agentId);
  const hote = document.getElementById('hFilAgentCorps');
  if (!hote || hote.dataset.jeton !== jeton) return;
  if (!res.data) {
    hote.innerHTML = res.pcOnline === false
      ? hPcAbsentBanner('ce sous-agent')
      : '<div class="h-note">Sous-agent introuvable dans le registre.</div>';
    return;
  }
  hote.innerHTML = hFilAgentHtml(res.data, missionId);
}

/** En-tête du fil : ce qu'il fait, son état, et l'accès à sa page pleine. */
function hEnteteAgent(a, missionId) {
  const couleur = a.status === 'actif' ? 'var(--ok)' : a.status === 'attente' ? 'var(--warn)' : 'var(--ink-3)';
  return `<div class="h-fa-hd">
      <span class="ad${a.status === 'actif' ? ' dot-live' : ''}" style="background:${couleur}"></span>
      <span class="fr">${escapeHtml(a.role || 'sous-agent')}</span><span class="fs">${escapeHtml(a.status)}</span></div>
    <div class="h-fa-act">${escapeHtml(a.action || 'aucune action lisible relevée')}</div>
    <button class="h-row h-fa-page" onclick="HSheets.fermer();hOpenAgent('${hArgJs(missionId)}','${hArgJs(a.id)}')">
      Ouvrir la page du sous-agent<span class="rv">›</span></button>`;
}

function hFilAgentHtml(a, missionId) {
  const entete = hEnteteAgent(a, missionId);
  const feed = a.feed || [];
  if (feed.length === 0) {
    // ☠ Le vide a DEUX causes qui n'appellent pas la même réaction, et l'API les
    // distingue : `feedUnavailable` = le relevé best-effort n'a rien livré
    // (mesuré H-72.4 : 0 à 4 lignes sur 5 agents lancés, même sur session
    // saine) — l'agent travaille, c'est son détail qui manque, pas lui.
    const vide = a.feedUnavailable
      ? 'Aucune activité relevée pour ce sous-agent. Le relevé se fait sur le transcript du PC,'
        + ' en best-effort : l’agent existe et travaille, c’est son détail qui manque — pas lui.'
      : 'Fil vide pour l’instant.';
    return `${entete}<div class="h-note">${vide}</div>`;
  }
  // ☠ L'identifiant sert de CLÉ de valise, donc d'attribut HTML : on le réduit
  // aux caractères sûrs. Un `"` dedans refermerait `data-valise="…"` et la
  // valise ne s'ouvrirait plus — sans la moindre erreur pour le dire.
  const slug = `ag-${String(a.id).replace(/[^\w-]/g, '')}`;
  return entete + hSegmenterFeed(feed)
    .map((seg, i) => hSegmentAgentHtml(seg, `${slug}-${i}`))
    .join('');
}

/** Un segment du fil d'un agent, avec le même pied « quand · combien de temps ». */
function hSegmentAgentHtml(seg, cle) {
  const items = seg.items || (seg.ev ? [seg.ev] : []);
  const etendue = window.HTemps ? window.HTemps.etendue(items) : { fin: null, duree: null };
  const pied = window.HTemps ? window.HTemps.piedHtml(etendue.fin, etendue.duree) : '';
  return `<div class="seg">${hCorpsSegmentAgent(seg, cle)}${pied}</div>`;
}

/**
 * ☠ On NE passe PAS par `hCorpsSegment` de la page mission, et c'est la raison
 * d'être de ces quinze lignes. Ses valises s'enregistrent sous `outils-${i}` /
 * `pensees-${i}` et son corps d'outils LIT `hSegmentsCourants`, le tableau de
 * segments de l'ÉQUIPE. Rendre un fil de sous-agent par ce chemin écraserait,
 * clé par clé, les corps du fil qui vit sous la feuille : après fermeture, la
 * valise « exécuté 7 commandes » de l'équipe ouvrirait sur le travail du
 * sous-agent, sans que rien n'échoue nulle part. Ici tout est capturé par
 * CLÔTURE et les clés sont préfixées par l'identifiant de l'agent.
 *
 * Un fil de sous-agent ne porte que des `activity` (`versSubagentDetailApi`) :
 * outils, réflexions, texte. Les autres genres restent traités par sécurité.
 */
function hCorpsSegmentAgent(seg, cle) {
  if (seg.genre === 'outils') {
    const remplir = () => hCorpsOutils(seg.items, cle, { sansResultat: true });
    return HValise.html(hLibelleValise(seg.items), HValise.enregistrer(remplir, cle));
  }
  if (seg.genre === 'pensees') {
    // Même bloc dépliable que le lead, même aperçu : le début de la réflexion,
    // qui dit s'il vaut la peine de l'ouvrir.
    const apercu = seg.items[0].text.replace(/\s+/g, ' ').trim();
    const remplir = () => `<div class="h-think">${seg.items.map((e) => hMarkdown(e.text)).join('')}</div>`;
    return HValise.html(apercu, HValise.enregistrer(remplir, cle), H_ICO_HORLOGE);
  }
  if (seg.genre === 'systeme') return hSystemeTemplate(seg.ev);
  if (seg.genre === 'operateur') return hOperateurTemplate(seg.ev);
  return hParoleTemplate(seg.ev);
}

// ------------------------------------------------------------------ détails

function hLigneKv(k, v, mono = true) {
  return `<div><span class="k">${escapeHtml(k)}</span><span class="v${mono ? '' : ' texte'}">${escapeHtml(v)}</span></div>`;
}

function hTokens(n) {
  return n >= 1000 ? `${Math.round(n / 100) / 10} K` : `${n}`;
}

/**
 * Seuils de contexte → ton d'alerte, définis UNE fois.
 *
 * ☠ La jauge et la tuile lisent le même chiffre : deux seuils divergents
 * feraient dire deux choses au même pourcentage, et l'écran perdrait le droit
 * d'être cru. ≥ 75 % l'atterrissage est urgent, ≥ 50 % il se prépare, en
 * dessous il n'y a rien à signaler — donc aucune couleur.
 */
function hTonContexte(pct) {
  return pct >= 75 ? 'alerte' : pct >= 50 ? 'veille' : '';
}

const H_TON_COULEUR = { alerte: 'var(--err)', veille: 'var(--warn)', attente: 'var(--accent)' };

function hJaugeContexte(m) {
  const couleur = H_TON_COULEUR[hTonContexte(m.ctx)] || 'var(--ok)';
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

// ------------------------------------------------------- bandeau de décision

function hTuile(k, v, s, ton) {
  return `<div class="h-tuile${ton ? ` t-${ton}` : ''}"><span class="k">${escapeHtml(k)}</span>
    <span class="v">${escapeHtml(v)}</span><span class="s">${escapeHtml(s || '')}</span></div>`;
}

/**
 * ☠ Le ton d'un état dit s'il APPELLE UN GESTE, jamais s'il est « bon » :
 * `requires_action` attend Chris, `echec` est terminal, `paused` est un travail
 * suspendu qui ne repartira pas seul. `running`, `idle` et `terminee`
 * n'appellent rien — ils restent sans couleur, et c'est ce qui rend les trois
 * autres lisibles d'un coup d'œil.
 */
const H_TON_ETAT = { requires_action: 'attente', echec: 'alerte', paused: 'veille' };

/** La tuile Dépôt. ☠ `git === null` n'est PAS « propre » : c'est « jamais
 *  mesuré ». Un « 0 » à cet endroit ferait fermer un worktree en croyant ne
 *  rien perdre. Des fichiers non commités, eux, sont du travail PERDABLE — la
 *  seule chose que l'état du dépôt change à la décision de continuer. */
function hTuileDepot(m) {
  const g = m.git;
  if (!g) return hTuile('Dépôt', 'non relevé', 'aucune mesure reçue', '');
  const propre = g.uncommitted === 0;
  return hTuile('Dépôt', propre ? 'propre' : `${g.uncommitted} non commités`,
    g.branch || '—', propre ? '' : 'veille');
}

/**
 * Quatre tuiles, et pas une de plus : ce qu'on lit pour trancher « est-ce que je
 * la laisse continuer ». Le coût n'est JAMAIS coloré — aucun montant n'est
 * mauvais en soi, et le seuil d'inspection qui l'accompagne est une échéance,
 * pas une alerte. Tout le reste (identité, ventilation, dépôt détaillé) descend
 * dans les groupes : un mur de chiffres ne se lit pas mieux qu'un écran vide.
 */
function hBandeauDecision(m) {
  const seuil = hNextThreshold(m.cost);
  const t = m.ctxTokens || {};
  // ☠ Sans relevé, `ctx` vaut 0 côté serveur (`pourcentageContexte` refuse
  // d'extrapoler). Afficher « 0 % » ferait lire « il reste tout le contexte »
  // là où la vérité est « on ne sait pas » — et c'est là-dessus qu'on décide
  // d'un atterrissage. Le mot remplace donc le chiffre.
  const mesure = t.utilises !== null && t.utilises !== undefined;
  const brut = mesure ? `${hTokens(t.utilises)}${t.max ? ` / ${hTokens(t.max)}` : ''}` : 'aucun relevé reçu';
  const age = m.blockedSince || m.pausedAgo || m.idleAgo || m.doneAgo;
  return `<div class="h-tuiles">
    ${hTuile('Consommé', hMoney(m.cost), seuil === null ? 'dernier seuil passé' : `inspection à ${hMoney(seuil)}`, '')}
    ${hTuile('Contexte', mesure ? `${m.ctx} %` : 'non mesuré', brut, mesure ? hTonContexte(m.ctx) : '')}
    ${hTuile('État', HARNESS_STATE_LABEL[m.state] || m.state, age ? `depuis ${age}` : '', H_TON_ETAT[m.state] || '')}
    ${hTuileDepot(m)}
  </div>`;
}

// ------------------------------------------------------------------ groupes

function hGroupeContexte(m) {
  return `<div class="h-grp"><div class="gh">Contexte</div>${hJaugeContexte(m)}${hDetailContexte(m)}</div>`;
}

/**
 * L'équipe, dépliée directement ici. ☠ Les sous-agents étaient derrière une
 * ligne « Sous-agents N › » qui ouvrait une seconde feuille : trois appuis pour
 * atteindre un agent, et une liste qu'on ne consulte donc jamais. Ils sont
 * maintenant à un appui du bouton « ··· », et leur fil à deux.
 */
function hGroupeEquipe(m) {
  const agents = m.subagents || [];
  const lignes = agents.length === 0
    ? '<div class="h-note">Le lead travaille seul — aucun sous-agent relevé sur le transcript.</div>'
    : agents.map((a) => hBoutonAgent(m.id, a, 'details')).join('');
  return `<div class="h-grp"><div class="gh">Équipe — ${escapeHtml(m.team || '')}</div>
    ${lignes}
    <button class="h-row" onclick="hOuvrirMandat()">Mandat<span class="rv">›</span></button></div>`;
}

/** Où et comment ça tourne — ce qu'on regarde quand le comportement surprend. */
function hGroupeExecution(m) {
  return `<div class="h-grp"><div class="gh">Exécution</div>
    <div class="h-kv">
      ${hLigneKv('Modèle', m.model)}
      ${hLigneKv('Machine', m.machine || 'non renseignée')}
      ${hLigneKv('Compte', `compte #${m.account}`)}
      ${hLigneKv('Epoch', String(m.epoch))}
      ${hLigneKv('Relances', m.retries)}
    </div></div>`;
}

function hGroupeEmplacement(m) {
  return `<div class="h-grp"><div class="gh">Emplacement</div>
    <div class="h-kv">
      ${hLigneKv('Projet', m.project)}
      ${hLigneKv('Worktree', m.worktree || '—')}
      ${hLigneKv('Branche', m.branch || '—')}
      ${hLigneKv('Mission', m.id)}
      ${hLigneKv('Session', m.sessionId || '—')}
    </div>
    <button class="h-row" onclick="hCopierId('${hArgJs(m.id)}')">Copier l’identifiant<span class="rv">⧉</span></button></div>`;
}

/** ☠ L'heure du relevé est affichée avec l'état : un dépôt « propre » mesuré il
 *  y a quarante minutes ne dit rien du dépôt maintenant. */
function hGroupeDepot(m) {
  const g = m.git;
  if (!g) {
    return `<div class="h-grp"><div class="gh">Dépôt</div><div class="h-kv">
      ${hLigneKv('État', 'jamais relevé — pas « propre »', false)}</div></div>`;
  }
  // Le décompte est déjà dans la tuile juste au-dessus : on ne le répète pas,
  // on donne ce qu'elle ne peut pas tenir.
  const ecoule = window.HTemps ? window.HTemps.duree(Date.now() - g.at) : '';
  return `<div class="h-grp"><div class="gh">Dépôt</div><div class="h-kv">
      ${hLigneKv('Branche', g.branch || '—')}
      ${hLigneKv('Dernier commit', g.lastCommit || '—', false)}
      ${hLigneKv('Relevé', ecoule ? `il y a ${ecoule}` : '—', false)}
    </div></div>`;
}

function hGroupeActions(m) {
  const actif = HarnessAPI._isPcOnline() && !['echec', 'terminee'].includes(m.state);
  const id = hArgJs(m.id);
  return `<div class="h-grp">
    <button class="h-row" ${actif ? '' : 'disabled'} onclick="hRunInspection('${id}')">Lancer une inspection${hRvInspection(m)}</button>
    <button class="h-row" ${actif ? '' : 'disabled'} onclick="hPauseOneMission('${id}')">${m.state === 'paused' ? 'Reprendre' : 'Mettre en pause'}</button>
    <button class="h-row danger" ${actif ? '' : 'disabled'} onclick="hTerminateMission('${id}')">Terminer l’équipe</button>
  </div>`;
}

function hOuvrirDetails() {
  const m = hMissionCourante;
  if (!m) return;
  const html = hBandeauDecision(m) + hGroupeContexte(m) + hGroupeEquipe(m)
    + hGroupeExecution(m) + hGroupeEmplacement(m) + hGroupeDepot(m) + hGroupeActions(m);
  HSheets.ouvrir({ titre: 'Détails de la mission', html });
}

/**
 * Le dernier verdict, à droite du bouton. ☠ Sans lui, rien ne dit qu'une
 * inspection a DÉJÀ eu lieu : on la relance pour rien, et on paie un appel au
 * juge pour réapprendre ce qu'on savait.
 */
function hRvInspection(m) {
  const i = m.inspection || {};
  if (!i.libelle) return '';
  return `<span class="rv">${escapeHtml(i.libelle)}</span>`;
}

function hOuvrirMandat() {
  const m = hMissionCourante;
  if (!m) return;
  const html = `<div class="h-mand">${hMarkdown(m.mandate.but)}
    <h4>Critère d’arrêt</h4>${hMarkdown(m.mandate.critere)}</div>`;
  HSheets.ouvrir({ titre: 'Mandat', html, retour: hOuvrirDetails });
}
