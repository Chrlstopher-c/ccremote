// ============ Menu contextuel — le clic droit, partout dans l'app ============
//
// Un seul écouteur délégué sur `document`. Un élément devient cliquable-droit en
// portant `data-menu="<genre>"` plus ce dont son menu a besoin (`data-id`, etc.) ;
// les entrées viennent d'une fabrique déclarée par genre dans `harness-menus.js`.
// Aucune liste ne s'abonne, aucune ne se désabonne : les rendus se réécrivent en
// boucle, un écouteur posé par ligne serait perdu au premier rafraîchissement.
//
// ☠ On ne confisque le menu natif QUE si une cible est reconnue. Ailleurs — et
// surtout dans une zone de saisie — le menu du navigateur reste le bon outil :
// coller, corriger l'orthographe, inspecter. Une app qui supprime le clic droit
// partout « pour être cohérente » retire plus qu'elle n'apporte.

const H_MENUS = {};
const H_MENU_ID = 'hCtxMenu';
const H_APPUI_LONG_MS = 480;
const H_APPUI_TOLERANCE_PX = 10;

/** Déclare le menu d'un genre. `fabrique(ctx)` rend un tableau d'entrées. */
function hMenuDeclarer(genre, fabrique) { H_MENUS[genre] = fabrique; }

/** Entrée de menu. `action` peut être asynchrone — le menu se ferme avant. */
function hMenuItem(libelle, action, options = {}) {
  return { libelle, action, danger: options.danger === true, desactive: options.desactive === true };
}

const H_SEPARATEUR = { separateur: true };

function hFermerMenuContextuel() {
  document.getElementById(H_MENU_ID)?.remove();
}

function hMenuOuvert() { return document.getElementById(H_MENU_ID) !== null; }

/**
 * Place le menu au curseur sans jamais le laisser déborder.
 * ☠ Mesuré après insertion : la hauteur dépend du nombre d'entrées, la deviner
 * décale le menu d'un cran sur les listes longues, exactement là où ça gêne.
 */
function hPlacerMenu(menu, x, y) {
  const marge = 8;
  const { width, height } = menu.getBoundingClientRect();
  const gauche = Math.min(x, window.innerWidth - width - marge);
  const haut = Math.min(y, window.innerHeight - height - marge);
  menu.style.left = `${Math.max(marge, gauche)}px`;
  menu.style.top = `${Math.max(marge, haut)}px`;
}

function hOuvrirMenuContextuel(entrees, x, y) {
  hFermerMenuContextuel();
  const menu = document.createElement('div');
  menu.id = H_MENU_ID;
  menu.className = 'h-ctx';
  menu.setAttribute('role', 'menu');
  menu.innerHTML = entrees.map((e, i) => (e.separateur
    ? '<div class="h-ctx-sep"></div>'
    : `<button class="h-ctx-item${e.danger ? ' danger' : ''}" data-i="${i}" role="menuitem"${e.desactive ? ' disabled' : ''}>${hEchappe(e.libelle)}</button>`
  )).join('');
  document.body.appendChild(menu);
  hPlacerMenu(menu, x, y);

  menu.addEventListener('click', (ev) => {
    const bouton = ev.target.closest('.h-ctx-item');
    if (!bouton || bouton.disabled) return;
    const entree = entrees[Number(bouton.dataset.i)];
    // ☠ Fermer AVANT d'agir : l'action ouvre souvent un dialogue ou change de
    // vue, et un menu resté ouvert par-dessus se retrouve orphelin, au mauvais
    // endroit, sur un élément qui n'existe plus.
    hFermerMenuContextuel();
    Promise.resolve(entree?.action?.()).catch((err) => showToast(`Action impossible — ${err}`, 'err'));
  });
  menu.querySelector('.h-ctx-item:not([disabled])')?.focus();
}

/** Le descripteur porté par l'élément survolé, ou null si aucun n'en porte. */
function hCibleMenu(element) {
  const noeud = element?.closest?.('[data-menu]');
  if (!noeud) return null;
  const fabrique = H_MENUS[noeud.dataset.menu];
  if (!fabrique) return null;
  const entrees = fabrique(noeud.dataset, noeud) || [];
  return entrees.length ? entrees : null;
}

document.addEventListener('contextmenu', (e) => {
  const entrees = hCibleMenu(e.target);
  if (!entrees) { hFermerMenuContextuel(); return; }
  e.preventDefault();
  hOuvrirMenuContextuel(entrees, e.clientX, e.clientY);
});

// Fermeture — tout ce qui déplace ou remplace le contexte referme le menu.
document.addEventListener('mousedown', (e) => {
  if (hMenuOuvert() && !e.target.closest(`#${H_MENU_ID}`)) hFermerMenuContextuel();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hFermerMenuContextuel(); });
window.addEventListener('resize', hFermerMenuContextuel);
window.addEventListener('scroll', hFermerMenuContextuel, true);

// ---- Appui long : le même menu au doigt ----
// ☠ Sans ça, la moitié de l'app n'a aucun accès à ces actions : sur mobile il
// n'y a pas de clic droit, et c'est justement la vue que Chris utilise le plus.
let hAppui = null;

function hAnnulerAppui() {
  if (hAppui?.minuteur) clearTimeout(hAppui.minuteur);
  hAppui = null;
}

document.addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'touch') return;
  if (!hCibleMenu(e.target)) return;
  const x = e.clientX;
  const y = e.clientY;
  hAppui = {
    x, y, cible: e.target, declenche: false,
    minuteur: setTimeout(() => {
      const entrees = hCibleMenu(e.target);
      if (!entrees) return;
      if (hAppui) hAppui.declenche = true;
      if (navigator.vibrate) navigator.vibrate(12);
      hOuvrirMenuContextuel(entrees, x, y);
    }, H_APPUI_LONG_MS),
  };
});

document.addEventListener('pointermove', (e) => {
  if (!hAppui) return;
  if (Math.abs(e.clientX - hAppui.x) > H_APPUI_TOLERANCE_PX || Math.abs(e.clientY - hAppui.y) > H_APPUI_TOLERANCE_PX) {
    hAnnulerAppui();
  }
}, { passive: true });

document.addEventListener('pointerup', () => {
  // ☠ L'appui long doit AVALER le clic qui suit, sinon la ligne s'ouvre derrière
  // le menu : le doigt aurait ouvert le menu ET la conversation.
  if (hAppui?.declenche) {
    const avaler = (ev) => { ev.preventDefault(); ev.stopPropagation(); };
    document.addEventListener('click', avaler, { capture: true, once: true });
    setTimeout(() => document.removeEventListener('click', avaler, { capture: true }), 400);
  }
  hAnnulerAppui();
});

document.addEventListener('pointercancel', hAnnulerAppui);
