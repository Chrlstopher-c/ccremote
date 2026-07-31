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

function hOuvrirOptionsOrch() {
  const nRappels = document.getElementById('hRappelsCount');
  const compte = nRappels && nRappels.textContent ? nRappels.textContent : '';
  const auto = document.getElementById('hAutonomieLabel');
  const etatAuto = auto && auto.textContent !== 'Autonomie' ? auto.textContent : 'aucune plage';
  const html = `
    <div class="h-grp"><div class="gh">Automatisation</div>
      ${hOrchRow('Autonomie — plage déléguée', 'hSheetAutonomie()', etatAuto)}
      ${hOrchRow('Rappels programmés', 'hSheetRappels()', compte)}
    </div>
    <div class="h-grp"><div class="gh">Conversation</div>
      ${hOrchRow('Statistiques de session', 'hSheetStats()')}
      ${hOrchRow('Compacter le contexte maintenant', 'HSheets.fermer();hCompacterMaintenant()')}
      ${hOrchRow('Nouvelle conversation', 'HSheets.fermer();hNewConversation()')}
    </div>
    <div class="h-grp">
      ${hOrchRow('Notifications du parc', "HSheets.fermer();hGoto('harness-notifications')")}
      ${hOrchRow('Comptes et quotas', "HSheets.fermer();hGoto('harness-comptes')")}
    </div>
    <div class="h-grp">
      <button class="h-row danger" onclick="hArchiverDepuisFeuille()">Archiver cette conversation</button>
    </div>`;
  HSheets.ouvrir({ titre: 'Options', html });
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
 * Liste latérale : les fils de l'orchestrateur quand on est dans sa vue, les
 * conversations du chat cloud sinon.
 */
function hMajListeLaterale() {
  const vue = document.querySelector('.view.active')?.dataset.view || '';
  const orchestrateur = vue.startsWith('harness-');
  const listeChat = document.getElementById('convList');
  const listeOrch = document.getElementById('hOrchConvList');
  const titre = document.getElementById('convListTitre');
  if (!listeChat || !listeOrch || !titre) return;
  listeChat.style.display = orchestrateur ? 'none' : '';
  listeOrch.style.display = orchestrateur ? '' : 'none';
  titre.textContent = orchestrateur ? 'Fils de l’orchestrateur' : 'Conversations';
  if (!orchestrateur) return;

  const items = hOrch.list || [];
  // ☠ Signature avant écriture : cette fonction est appelée à chaque sondage
  // (400 ms) et réécrire une liste identique casse toute sélection en cours —
  // le défaut déjà payé sur la barre d'onglets.
  const sig = JSON.stringify([hOrch.convId, items.map((c) => [c.id, c.titre, c.active])]);
  if (listeOrch.dataset.sig === sig) return;
  listeOrch.dataset.sig = sig;
  listeOrch.innerHTML = items.length === 0
    ? '<div class="text-[11px] px-2 py-1" style="color:var(--ink-3);">Aucun fil ouvert.</div>'
    : items.map((c) => `
      <button class="hist-item w-full text-left px-2 py-1.5 rounded-md text-[12.5px] flex items-center gap-2 ${c.id === hOrch.convId ? 'actif' : ''}"
              onclick="hOpenConversation('${c.id}')" style="color: var(--ink-2);">
        <span class="sb-fil-dot" style="background:${c.active ? 'var(--ok)' : 'var(--line-2)'}"></span>
        <span class="truncate flex-1">${escapeHtml(c.titre)}</span>
      </button>`).join('');
}
