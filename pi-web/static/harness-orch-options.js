// ============ Feuille « ··· » de la conversation orchestrateur ============
//
// ☠ Autonomie, rappels et statistiques occupaient le header en boutons, avec
// deux panneaux dépliants qui repoussaient le fil vers le bas. Ils vivent
// désormais ici. Les panneaux ne sont PAS reconstruits : la feuille les EMPRUNTE
// au document et les rend à la fermeture — leur code interroge des identifiants
// (`hAutoDebut`, `hRappelsListe`…) qu'un clone dupliquerait, et `getElementById`
// renverrait alors le mauvais élément sans que rien ne le signale.

function hOrchRow(libelle, action, valeur) {
  const v = valeur ? `<span class="rv">${escapeHtml(valeur)} ›</span>` : '<span class="rv">›</span>';
  return `<button class="h-row" onclick="${action}">${escapeHtml(libelle)}${v}</button>`;
}

// ============ État d'un fil, rassemblé une fois ============
//
// ☠ Cette feuille était une LISTE D'ACTIONS SANS ÉTAT : six lignes qui ouvrent
// six panneaux, et pas un chiffre. On ne pouvait donc pas répondre à la seule
// question qu'on se pose en l'ouvrant — « où en est ce fil ». Elle reprend la
// forme de la feuille d'une équipe (`harness-mission-sheets.js`) : un bandeau de
// tuiles qui tranche, puis des groupes hiérarchisés. Les gabarits sont ceux de
// cette feuille (`hTuile`, `hLigneKv`, `hJaugeContexte`, `hTonContexte`) —
// réécrire un troisième vocabulaire ici les ferait diverger au premier ajustement.

/**
 * Tout ce que l'écran SAIT du fil ouvert, en un objet.
 *
 * ☠ Chaque champ est pris là où il existe RÉELLEMENT — voir le commentaire de
 * `hOrch`. Aucun n'est déduit ni complété : un fil sans machine rend `null`, un
 * fil vierge rend `modele: null`, et c'est l'affichage qui met les mots dessus.
 */
function hEtatFil() {
  const fil = (hOrch.list || []).find((c) => c.id === hOrch.convId) || null;
  const mesure = hOrch.mesure || {};
  const reglage = hOrch.reglage || {};
  // La mesure du sondage prime sur celle de la liste : la seconde ne se
  // rafraîchit qu'en fin de tour, la première à chaque battement.
  const ctxListe = typeof fil?.contextPct === 'number' ? fil.contextPct : null;
  return {
    id: hOrch.convId,
    titre: fil?.titre || '',
    ctx: typeof mesure.contextPct === 'number' ? mesure.contextPct : ctxListe,
    compactions: typeof mesure.compactions === 'number' ? mesure.compactions : (fil?.compactions ?? 0),
    active: !!fil?.active,
    generating: !!hOrch.generating,
    machine: fil?.machine || null,
    modele: reglage.model || null,
    effort: reglage.effort || null,
    rapide: reglage.fastMode === true,
    creeA: Number.isFinite(fil?.creeA) ? fil.creeA : null,
    majA: Number.isFinite(fil?.majA) ? fil.majA : null,
  };
}

/**
 * La fenêtre d'autonomie du fil, lue de l'API — plus du DOM.
 *
 * ☠ Jusqu'au 08/08 AUCUNE route ne la relisait : `POST …/autonomie` l'écrivait
 * dans le registre (migration 15) et rien ne la resservait. Le libellé n'existait
 * donc que si Chris venait de poser la plage depuis cet onglet, et retombait à
 * « Autonomie » au premier rechargement, plage active ou non — l'ancien menu
 * traduisait ce vide par « aucune plage », une AFFIRMATION sur une donnée que
 * personne n'avait lue, et la nuit c'est la plus coûteuse de tout l'écran.
 * `GET /orchestrator/conversations[/:id]` sert désormais les quatre champs.
 *
 * ☠ `connu: false` ne subsiste que pour un fil pas encore chargé ou un
 * déploiement dont l'API ne sert pas ces champs — JAMAIS pour un fil sans plage,
 * qui est une réponse et se dit « aucune plage ».
 */
function hEtatAutonomie() {
  const a = (typeof hOrch !== 'undefined' && hOrch && hOrch.autonomie) || null;
  if (a === null) return { connu: false, valeur: 'non relevée', sous: 'pas encore lue', plafond: null, objectif: null };
  if (a.debut === null || a.fin === null) {
    const sous = 'chaque mandat attend ton clic';
    return { connu: true, valeur: 'aucune plage', sous, plafond: a.plafond, objectif: null };
  }
  return { connu: true, ...hFenetreAutonomie(a.debut, a.fin), plafond: a.plafond, objectif: a.objectif };
}

/**
 * Une plage datée, dite en français. ☠ « expirée » est un état À PART entière :
 * une plage échue et une plage à venir affichaient toutes deux « programmée »,
 * ce qui laissait croire à une délégation encore devant soi alors qu'elle est
 * derrière — l'erreur exactement inverse de celle qu'on veut éviter la nuit.
 */
function hFenetreAutonomie(debut, fin) {
  const t = window.HTemps;
  const quand = (ms) => (t ? t.heureFil(ms) : new Date(ms).toLocaleString('fr-FR'));
  const maintenant = Date.now();
  if (maintenant >= fin) return { valeur: 'expirée', sous: `échue à ${quand(fin)}` };
  if (maintenant >= debut) return { valeur: 'active', sous: `jusqu’à ${quand(fin)}` };
  return { valeur: 'programmée', sous: `à partir de ${quand(debut)}` };
}

/**
 * Quatre tuiles, et pas une de plus — même discipline que la feuille d'une
 * équipe : ce qu'on lit AVANT de décider si on écrit à ce fil ou si on le laisse
 * courir. Tout le reste descend dans les groupes.
 *
 * ☠ Un seul ton coloré, et il porte une règle précise : `veille` sur la machine
 * quand elle est ABSENTE. Un fil sans machine tourne tant qu'une seule est en
 * ligne puis échoue sur tout dispatch dès que la seconde démarre (prod, 02/08) —
 * la panne n'est pas là, elle est certaine, c'est exactement « ça se prépare ».
 * ☠ Le contexte reprend `hTonContexte` de la feuille d'équipe au lieu d'un seuil
 * local : deux barèmes feraient dire deux choses au même pourcentage.
 * ☠ Ni la session ni l'autonomie ne sont colorées : « active » n'appelle aucun
 * geste, et une couleur qui ne demande rien est celle qu'on cesse de lire.
 */
function hTuilesFil(e) {
  const a = hEtatAutonomie();
  const mesure = e.ctx !== null;
  const session = e.generating ? 'répond' : (e.active ? 'vivante' : 'au repos');
  const sousSession = e.active ? 'contexte chargé' : 'démarre au prochain message';
  const compact = `${e.compactions} compaction${e.compactions > 1 ? 's' : ''}`;
  return `<div class="h-tuiles">
    ${hTuile('Contexte', mesure ? `${e.ctx} %` : 'non mesuré', compact, mesure ? hTonContexte(e.ctx) : '')}
    ${hTuile('Session', session, sousSession, '')}
    ${hTuile('Machine', e.machine || 'aucune',
      e.machine ? 'porte ce fil' : 'échoue dès la 2ᵉ en ligne', e.machine ? '' : 'veille')}
    ${hTuile('Autonomie', a.valeur, a.sous, '')}
  </div>`;
}

/**
 * Le contexte du fil, et les deux gestes qui le concernent.
 *
 * ☠ La jauge n'est dessinée QUE sur une mesure réelle. À `ctx` absent elle
 * rendrait une barre à 0 %, qu'on lit « il reste tout le contexte » là où la
 * vérité est « personne n'a mesuré » — c'est le « 23 % » codé en dur de
 * l'ancienne interface, repeint en barre.
 */
function hGroupeContexteFil(e) {
  const jauge = e.ctx === null
    ? '<div class="h-note">Contexte non mesuré — la sentinelle ne relève rien tant que la session dort.</div>'
    : hJaugeContexte({ ctx: e.ctx, ctxTokens: {} });
  return `<div class="h-grp"><div class="gh">Contexte</div>${jauge}
    <div class="h-kv">${hLigneKv('Compactions subies', String(e.compactions))}</div>
    ${hOrchRow('Compacter maintenant', 'HSheets.fermer();hCompacterMaintenant()')}
    ${hOrchRow('Statistiques de session', 'hSheetStats()')}
  </div>`;
}

/**
 * Sur quoi ce fil tourne — ce qu'on regarde quand une réponse surprend.
 *
 * ☠ Ces trois valeurs sont le DERNIER couple réellement utilisé par le fil, lu à
 * son ouverture (`/orchestrator/conversations/:id`), et pas l'état des pilules
 * du composeur : celles-ci peuvent avoir été changées sans qu'aucun message ne
 * soit encore parti. La note le dit, parce que confondre les deux ferait
 * chercher un bug de modèle là où il n'y a qu'un réglage pas encore envoyé.
 */
function hGroupeExecutionFil(e) {
  return `<div class="h-grp"><div class="gh">Exécution</div>
    <div class="h-kv">
      ${hLigneKv('Modèle', e.modele || 'pas encore fixé')}
      ${hLigneKv('Raisonnement', e.effort || '—')}
      ${hLigneKv('Mode rapide', e.rapide ? 'actif' : 'coupé')}
    </div>
    ${hOrchRow('Machine de travail', 'hSheetMachine()', e.machine || '⚠ aucune')}
    <div class="h-note">Dernier couple réellement utilisé par ce fil.
      Le prochain envoi suivra les pilules du composeur.</div>
  </div>`;
}

/**
 * Ce qui peut partir sans Chris : la plage déléguée, le plafond du fil, les
 * rappels posés.
 *
 * ☠ Le plafond est affiché À CÔTÉ de la plage, pas ailleurs : c'est lui qui dit
 * combien d'équipes partent sans clic PENDANT la plage. Séparés, on lisait une
 * délégation ouverte sans savoir jusqu'où elle allait.
 */
function hGroupeAutomatisationFil() {
  const a = hEtatAutonomie();
  const compte = (document.getElementById('hRappelsCount') || {}).textContent || '';
  const objectif = a.objectif ? hLigneKv('Objectif confié', a.objectif, false) : '';
  const note = a.connu
    ? `<div class="h-note">Pendant la plage, les mandats de ce fil démarrent sans ton clic, dans la
       limite du plafond. Une demande de relèvement s’affiche au-dessus du composeur : rien n’est
       accordé tant que tu ne l’as pas tranchée.</div>`
    : `<div class="h-note">Fil pas encore chargé, ou déploiement qui ne ressert pas ces champs :
       l’écran n’en sait rien, et ne l’invente pas.</div>`;
  return `<div class="h-grp"><div class="gh">Automatisation</div>
    ${hOrchRow('Plage d’autonomie', 'hSheetAutonomie()', a.valeur)}
    <div class="h-kv">
      ${hLigneKv('Plafond de ce fil', hPlafondLisible(a.plafond))}
      ${objectif}
    </div>
    ${hOrchRow('Rappels programmés', 'hSheetRappels()', compte)}
    ${note}
  </div>`;
}

/** L'identité du fil : depuis quand il existe, quand il a bougé, qui il est. */
function hGroupeIdentiteFil(e) {
  const t = window.HTemps;
  const quand = (ms) => (ms !== null && t ? t.heureFil(ms) : '—');
  // ☠ Date ABSOLUE et pas un « il y a N h » : un fil ouvert avant-hier rendrait
  // « 51 h 20 », qu'il faut convertir de tête pour situer quoi que ce soit. Et
  // `heureFil` porte le jour dès qu'il n'est plus aujourd'hui — c'est ce que
  // cherche exactement une relecture au réveil.
  return `<div class="h-grp"><div class="gh">Fil</div>
    <div class="h-kv">
      ${hLigneKv('Ouvert', quand(e.creeA))}
      ${hLigneKv('Dernière activité', quand(e.majA))}
      ${hLigneKv('Identifiant', e.id || '—')}
    </div>
    <button class="h-row" onclick="hCopierId('${hArgJs(e.id || '')}')">
      Copier l’identifiant<span class="rv">⧉</span></button>
    ${hOrchRow('Nouvelle conversation', 'HSheets.fermer();hNewConversation()')}
  </div>`;
}

/** Ce qui sort du fil : le parc, les comptes, et la sortie définitive. */
function hGroupeActionsFil() {
  return `<div class="h-grp">
    ${hOrchRow('Notifications du parc', "HSheets.fermer();hGoto('harness-notifications')")}
    ${hOrchRow('Comptes et quotas', "HSheets.fermer();hGoto('harness-comptes')")}
    <button class="h-row danger" onclick="hArchiverDepuisFeuille()">Archiver cette conversation</button>
  </div>`;
}

/**
 * ☠ Instantané, jamais sondé. La feuille d'une équipe se rend une fois elle
 * aussi, et une feuille qui se réécrit sous le doigt casse le défilement en
 * cours — c'est déjà la raison d'être de la garde par signature de
 * `hRenderMachineFil`, la seule qui ait besoin d'être vivante.
 */
function hOuvrirOptionsOrch() {
  const e = hEtatFil();
  if (!e.id) {
    HSheets.ouvrir({ titre: 'Détails du fil', html: '<div class="h-liste-vide">Aucun fil ouvert.</div>' });
    return;
  }
  const html = hTuilesFil(e) + hGroupeContexteFil(e) + hGroupeExecutionFil(e)
    + hGroupeAutomatisationFil() + hGroupeIdentiteFil(e) + hGroupeActionsFil();
  HSheets.ouvrir({ titre: e.titre || 'Détails du fil', html });
}

// ============ Machine de travail du fil ============
//
// ☠ Pourquoi cette feuille existe : la machine d'un fil était fixée à sa
// création, invisible ensuite, et impossible à corriger. Un fil ouvert alors
// qu'une seule machine était en ligne partait SANS machine ; à l'allumage de la
// seconde, il échouait sur chaque dispatch avec « aucune machine précisée et
// plusieurs sont en ligne », sans le moindre geste offert pour en sortir
// (prod, 02/08, conversation af847b10). On voit, et on change.
//
// ☠ Le serveur REFUSE de déplacer un fil qui porte une équipe vivante : ses
// ordres partiraient vers une machine qui n'héberge pas son worker. L'interface
// n'anticipe pas ce refus, elle le RAPPORTE — dupliquer la règle ici la ferait
// diverger le jour où elle change côté serveur.

const H_MACHINE_SONDE_MS = 4000;
/** Borne dure : ~10 min de feuille ouverte. Aucune boucle sans fin (JPL). */
const H_MACHINE_SONDE_MAX = 150;

function hSheetMachine() {
  HSheets.ouvrir({
    titre: 'Machine de travail',
    html: '<div id="hMachineFil"><div class="h-liste-vide">Lecture du parc…</div></div>',
    retour: hOuvrirOptionsOrch,
  });
  void hRenderMachineFil();
  let tours = 0;
  const sonde = setInterval(() => {
    tours += 1;
    // La feuille refermée retire le nœud du document : c'est le signal d'arrêt,
    // et il ne dépend d'aucun rappel de fermeture qu'HSheets n'expose pas.
    if (!document.getElementById('hMachineFil') || tours >= H_MACHINE_SONDE_MAX) {
      clearInterval(sonde);
      return;
    }
    void hRenderMachineFil();
  }, H_MACHINE_SONDE_MS);
}

async function hRenderMachineFil() {
  const hote = document.getElementById('hMachineFil');
  if (!hote) return;
  const convId = hOrch && hOrch.convId;
  if (!convId) { hote.innerHTML = '<div class="h-liste-vide">Aucun fil ouvert.</div>'; return; }

  let machines = [];
  let fil = null;
  try {
    const [rm, rc] = await Promise.all([HarnessAPI.getMachines(), HarnessAPI.getConversations()]);
    machines = (rm && rm.data) || [];
    fil = ((rc && rc.data) || []).find((c) => c.id === convId) || null;
  } catch (e) {
    hote.innerHTML = '<div class="h-liste-vide">Parc injoignable — réessaie dans un instant.</div>';
    return;
  }
  if (!document.getElementById('hMachineFil')) return; // feuille refermée pendant l'attente

  const portee = fil && fil.machine ? fil.machine : null;
  const enLigne = machines.filter((m) => m.enLigne).length;
  // ☠ Signature avant écriture : réécrire un HTML identique à chaque sonde
  // ferait clignoter la feuille sous le doigt.
  const sig = JSON.stringify([portee, machines.map((m) => [m.id, m.enLigne])]);
  if (hote.dataset.sig === sig) return;
  hote.dataset.sig = sig;

  const alerte = portee === null
    ? `<div class="h-grp"><div class="h-liste-vide" style="color: var(--warn, #d08770);">
         Ce fil n'est rattaché à AUCUNE machine. Il fonctionne tant qu'une seule est en ligne,
         et échouera sur chaque dispatch dès qu'une deuxième démarrera
         (${enLigne} en ligne actuellement). Choisis-en une.
       </div></div>`
    : '';

  const lignes = machines.map((m) => {
    const actif = m.id === portee;
    const etat = m.enLigne ? 'en ligne' : 'hors ligne';
    const marque = actif ? '<span class="rv">✓ ce fil</span>' : '<span class="rv">›</span>';
    return `<button class="h-row" ${actif ? 'disabled' : ''} onclick="hDefinirMachineFil('${escapeHtml(m.id)}')">
      <span style="display:flex;align-items:center;gap:8px;min-width:0;">
        <span class="dot" style="background:${m.enLigne ? 'var(--ok)' : 'var(--ink-3, #888)'};"></span>
        <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(m.id)}</span>
        <span class="rv">${etat}</span>
      </span>
      ${marque}
    </button>`;
  }).join('');

  const vide = machines.length === 0
    ? '<div class="h-liste-vide">Aucune machine ne s’est encore connectée au Pi.</div>'
    : '';

  hote.innerHTML = `${alerte}<div class="h-grp"><div class="gh">Parc — état en direct</div>${lignes}${vide}</div>
    <div class="h-grp"><div class="h-liste-vide">
      Une machine HORS LIGNE reste choisissable : le fil l'attendra plutôt que de partir ailleurs.
      Un fil qui porte une équipe vivante ne peut pas être déplacé — le serveur le refuse et le dit.
    </div></div>`;
}

async function hDefinirMachineFil(machineId) {
  const convId = hOrch && hOrch.convId;
  if (!convId) return;
  const r = await HarnessAPI.setConversationMachine(convId, machineId);
  if (!r.ok) { showToast(r.erreur || 'Rattachement refusé', 'warn'); return; }
  showToast(`Fil rattaché à ${machineId}`, 'ok');
  const hote = document.getElementById('hMachineFil');
  if (hote) hote.dataset.sig = '';
  await hLoadConvList();
  void hRenderMachineFil();
}

/** ☠ Emprunte le panneau déjà monté — voir l'en-tête de ce fichier. */
function hSheetPanneau(id, titre, avant) {
  const panneau = document.getElementById(id);
  if (!panneau) return;
  if (typeof avant === 'function') avant();
  HSheets.ouvrir({ titre, noeud: panneau, retour: hOuvrirOptionsOrch });
}

/**
 * ☠ N'appelle PAS `hOuvrirAutonomie()` : cette fonction BASCULE l'affichage du
 * panneau, et depuis une feuille qui vient de le rendre visible elle le
 * refermerait aussitôt. On reprend son seul effet utile ici — pré-remplir deux
 * bornes cohérentes entre elles.
 */
function hSheetAutonomie() {
  hSheetPanneau('hAutonomiePanneau', 'Plage d’autonomie', () => {
    const debut = document.getElementById('hAutoDebut');
    const fin = document.getElementById('hAutoFin');
    if (debut && !debut.value) debut.value = hPourInput(Date.now());
    if (fin && !fin.value) fin.value = hPourInput(Date.now() + 8 * 3600 * 1000);
  });
}

function hSheetRappels() {
  hSheetPanneau('hRappelsPanneau', 'Rappels programmés', () => {
    // Force un rendu : le cache d'empreinte empêcherait de repeindre une liste
    // identique, or elle vient d'être déplacée dans un nœud vide.
    hRappelsDernierRendu = '';
    void hRenderRappels();
  });
}

/**
 * Pastille sur le « ··· » quand quelque chose tourne en tâche de fond — un
 * rappel actif ou une plage d'autonomie ouverte. ☠ Sans elle, déplacer ces deux
 * fonctions dans une feuille les rendait invisibles : on ne peut pas surveiller
 * ce qu'on ne voit jamais.
 */
function hMajPastilleOrch() {
  const el = document.getElementById('hOrchPastille');
  if (!el) return;
  const nb = (document.getElementById('hRappelsCount') || {}).textContent || '';
  const auto = (document.getElementById('hAutonomieLabel') || {}).textContent || 'Autonomie';
  el.style.display = (nb && nb !== '0') || auto !== 'Autonomie' ? '' : 'none';
}
setInterval(hMajPastilleOrch, 3000);

function hSheetStats() {
  hSheetPanneau('hOrchStats', 'Statistiques de session');
}

function hArchiverDepuisFeuille() {
  const id = hOrch && hOrch.convId;
  HSheets.fermer();
  if (id) hArchiveConversation(id);
}

// ============ Barre de titre et liste latérale de l'orchestrateur ============

/**
 * Titre = nom de la conversation OUVERTE, pas le nom du module.
 *
 * ☠ « Orchestrateur » était écrit en dur : avec plusieurs fils ouverts, la barre
 * ne disait jamais lequel on lisait. C'est l'information la plus utile de tout
 * l'écran, et c'était la seule qui manquait.
 */
function hMajBarreOrch() {
  const conv = (hOrch.list || []).find((c) => c.id === hOrch.convId);
  const titre = document.getElementById('hOrchTitre');
  if (titre) {
    const nom = conv?.titre || 'Orchestrateur';
    if (titre.textContent !== nom) titre.textContent = nom;
  }
  const ctx = document.getElementById('hOrchCtx');
  if (ctx) {
    const pct = typeof conv?.contextPct === 'number' ? conv.contextPct : null;
    const texte = pct === null ? 'ctx —' : `ctx ${pct} %`;
    if (ctx.textContent.trim() !== texte) ctx.textContent = texte;
    // Seuils repris de la boîte de stats : au-delà de 75 %, la compaction n'est
    // plus une option de confort.
    ctx.className = 'tb-pilule' + (pct === null ? '' : pct >= 75 ? ' crit' : pct >= 50 ? ' warn' : '');
  }
  const nb = document.getElementById('hOrchCompactionsNb');
  if (nb && typeof conv?.compactions === 'number' && nb.textContent !== String(conv.compactions)) {
    nb.textContent = String(conv.compactions);
  }
}

/**
 * Page « fils de l'orchestrateur ».
 *
 * ☠ Une PAGE, plus une section de barre latérale : là-bas, les fils se
 * disputaient la hauteur avec les équipes actives et les quotas, et le
 * défilement écrasait ses voisins au lieu de glisser. Le problème est supprimé
 * par construction, pas arbitré en CSS.
 */
function hRenderFils() {
  const el = document.getElementById('hFilsListe');
  if (!el) return;
  const items = hOrch.list || [];
  // Signature avant écriture : la fonction est appelée à chaque sondage et
  // réécrire une liste identique casse toute sélection en cours.
  const sig = JSON.stringify([hOrch.convId, items.map((c) => [c.id, c.titre, c.active, c.contextPct])]);
  if (el.dataset.sig === sig) return;
  el.dataset.sig = sig;
  if (items.length === 0) {
    el.innerHTML = '<div class="h-liste-vide">Aucun fil ouvert. Le « + » en haut à droite en démarre un.</div>';
    return;
  }
  el.innerHTML = items.map((c) => {
    const ctx = typeof c.contextPct === 'number' ? `contexte ${c.contextPct} %` : 'contexte non mesuré';
    return `<button class="h-fil" onclick="hOuvrirFil('${c.id}')"
      data-k="fil:${escapeHtml(c.id)}" data-menu="fil" data-id="${escapeHtml(c.id)}" data-titre="${escapeHtml(c.titre)}">
      <span class="h-fil-dot" style="background:${c.active ? 'var(--ok)' : 'var(--line-2)'}"></span>
      <span class="h-fil-txt">
        <span class="h-fil-t">${escapeHtml(c.titre)}</span>
        <span class="h-fil-s">${ctx}${c.active ? ' · session vivante' : ''}</span>
      </span>
      <span class="h-fil-chev">›</span>
    </button>`;
  }).join('');
}

/** Ouvre un fil : on entre dans la conversation depuis la liste. */
function hOuvrirFil(id) {
  hGoto('harness-orchestrateur');
  hOpenConversation(id);
}

/**
 * Nouveau fil — orchestrateur ou chat, selon la liste affichée.
 *
 * ☠ Le bouton vit sur un titre de section qui change de sens avec le module :
 * créer un fil d'orchestrateur alors que la liste montre les conversations du
 * chat ajouterait une entrée invisible, dans une liste qu'on ne regarde pas.
 */
function hNouveauFil() {
  const vue = document.querySelector('.view.active')?.dataset.view || '';
  if (vue.startsWith('harness-')) {
    hNewConversation();
    return;
  }
  hNouveauChat();
}

/** Après création d'un fil, on entre dedans : créer sans ouvrir n'a pas de sens. */
function hApresNouveauFil() {
  hGoto('harness-orchestrateur');
}
