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
    return `<button class="h-fil" onclick="hOuvrirFil('${c.id}')">
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
  document.getElementById('newChatBtn')?.click();
}

/** Après création d'un fil, on entre dedans : créer sans ouvrir n'a pas de sens. */
function hApresNouveauFil() {
  hGoto('harness-orchestrateur');
}
