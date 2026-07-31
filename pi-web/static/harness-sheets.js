// ============ Feuilles modales — le motif « valise » de Claude Code ============
//
// Une valise est une LIGNE dans le fil (« Ran 7 commands ») ; la feuille est ce
// qu'elle ouvre. ☠ Le fil ne porte donc jamais le détail : sur les 90 activités
// d'une mission réelle, la grande majorité sont des appels d'outils, et les
// afficher en clair noyait le seul contenu qu'on vient lire — ce que le lead dit.
//
// ☠ Une seule feuille ouverte à la fois, et l'empilement se fait par REMPLACEMENT
// avec un bouton « Back » explicite : deux feuilles superposées sur un écran de
// téléphone ne laissent plus rien voir, et le geste de retour devient ambigu.

const HSheets = (() => {
  let racine = null;

  function assurerRacine() {
    if (racine) return racine;
    racine = document.createElement('div');
    racine.className = 'hsheet-root';
    racine.innerHTML =
      '<div class="hsheet-scrim" data-fermer></div>' +
      '<div class="hsheet" role="dialog" aria-modal="true">' +
      '<div class="hsheet-grab"></div>' +
      '<div class="hsheet-hd">' +
      '<button class="hsheet-lead" data-lead></button>' +
      '<div class="hsheet-t" data-titre></div>' +
      '<div class="hsheet-pad"></div>' +
      '</div><div class="hsheet-bd" data-corps></div></div>';
    document.body.appendChild(racine);
    racine.querySelector('[data-fermer]').addEventListener('click', fermer);
    return racine;
  }

  const ICONE_X =
    '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M5 5l14 14M19 5L5 19"/></svg>';
  const ICONE_RETOUR =
    '<svg width="11" height="18" viewBox="0 0 12 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2 2 10l8 8"/></svg>';

  /**
   * Ouvre une feuille. `retour` — quand il est fourni — remplace la croix par un
   * « Back » qui rappelle cette fonction : c'est ce qui permet valise → détail
   * d'un outil sans jamais empiler deux surfaces.
   */
  function ouvrir({ titre, html, retour }) {
    const r = assurerRacine();
    const lead = r.querySelector('[data-lead]');
    lead.innerHTML = retour ? `${ICONE_RETOUR}<span>Back</span>` : ICONE_X;
    lead.className = retour ? 'hsheet-lead back' : 'hsheet-lead';
    lead.onclick = retour || fermer;
    r.querySelector('[data-titre]').textContent = titre;
    const corps = r.querySelector('[data-corps]');
    corps.innerHTML = html;
    corps.scrollTop = 0;
    // Deux images successives pour que la transition parte de l'état fermé.
    requestAnimationFrame(() => r.classList.add('on'));
    document.addEventListener('keydown', surEchap);
  }

  function fermer() {
    if (!racine) return;
    racine.classList.remove('on');
    document.removeEventListener('keydown', surEchap);
  }

  function surEchap(e) {
    if (e.key === 'Escape') fermer();
  }

  return { ouvrir, fermer };
})();
