// ============ Valises dépliables en place ============
//
// ☠ Première version : la valise ouvrait une FEUILLE modale. C'est le motif du
// chat mobile de Claude, pas celui de la vue Claude Code — qui déplie en cascade
// dans le fil lui-même : la valise s'ouvre sur des cartes, et chaque carte
// s'ouvre sur sa commande et sa sortie, sans jamais quitter la lecture.
// Les feuilles restent pour les RÉGLAGES (détails, mandat, options) : ce sont
// des panneaux, pas du contenu de conversation.
//
// ☠ Le corps est rempli à la PREMIÈRE ouverture, jamais au rendu : une mission
// réelle porte ~90 appels d'outils, et construire leurs cartes d'avance ferait
// payer à chaque rafraîchissement un DOM que personne ne regarde.

const HValise = (() => {
  const remplisseurs = new Map();
  let sequence = 0;

  /**
   * Enregistre le contenu d'une valise et rend l'identifiant à poser dessus.
   *
   * ☠ `cleStable` n'est pas un confort : sans elle, chaque rendu produit `v1`,
   * `v2`, `v3`… donc un HTML DIFFÉRENT pour un contenu identique. Un fil qui se
   * compare à lui-même pour ne remplacer que ce qui a changé (voir
   * `hMajSegments`) croyait alors tout changé, remplaçait tout, et refermait
   * chaque valise dépliée — le défaut qu'on corrige. Elle supprime aussi une
   * fuite : la Map grossissait d'une entrée par valise ET par rafraîchissement,
   * indéfiniment, sur une page qu'on laisse ouverte des heures.
   */
  function enregistrer(remplir, cleStable) {
    const cle = cleStable === undefined ? `v${(sequence += 1)}` : cleStable;
    remplisseurs.set(cle, remplir);
    return cle;
  }

  const CHEVRON =
    '<svg class="cv" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>';

  /**
   * HTML d'une valise. `icone` est optionnelle (la réflexion porte une horloge).
   * ☠ Le chevron est COLLÉ au libellé, pas repoussé au bout de la ligne : une
   * valise n'est pas une ligne de tableau, et l'étirer sur 1 900 px de large
   * cassait la lecture sur grand écran.
   */
  function html(libelle, cle, icone = '') {
    return `<div class="h-case-wrap">
      <button class="h-case" data-valise="${cle}">${icone}<span class="lb">${escapeHtml(libelle)}</span>${CHEVRON}</button>
      <div class="h-case-body" hidden></div>
    </div>`;
  }

  /** Même chose en nœud, pour le fil de l'orchestrateur qui construit du DOM. */
  function noeud(libelle, cle, icone = '') {
    const d = document.createElement('div');
    d.innerHTML = html(libelle, cle, icone);
    return d.firstElementChild;
  }

  /** Une carte d'étape : titre cliquable, détail déplié dessous. */
  function carte(titre, cle, mono = false) {
    return `<div class="h-card">
      <button class="h-card-hd" data-valise="${cle}"><span class="ct${mono ? ' mono' : ''}">${escapeHtml(titre)}</span>${CHEVRON}</button>
      <div class="h-case-body" hidden></div>
    </div>`;
  }

  function basculer(bouton) {
    const corps = bouton.parentElement.querySelector(':scope > .h-case-body');
    if (!corps) return;
    const ouvert = !corps.hidden;
    if (ouvert) {
      corps.hidden = true;
      bouton.classList.remove('ouvert');
      return;
    }
    if (!corps.dataset.rempli) {
      const remplir = remplisseurs.get(bouton.dataset.valise);
      corps.innerHTML = typeof remplir === 'function' ? remplir() : '';
      corps.dataset.rempli = '1';
    }
    corps.hidden = false;
    bouton.classList.add('ouvert');
  }

  // ☠ Délégation unique sur le document : les valises sont recréées à chaque
  // rendu du fil, et rebrancher un écouteur par nœud fuirait à chaque passage.
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-valise]');
    if (b) basculer(b);
  });

  return { enregistrer, html, noeud, carte, CHEVRON };
})();
