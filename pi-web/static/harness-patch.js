// ============ Écriture DOM silencieuse — le rechargement ne doit jamais se voir ============
//
// ☠ Toutes les vues de l'app se rafraîchissent en boucle (4 s). Réassigner
// `innerHTML` recrée TOUS les nœuds : les animations d'entrée rejouent, la
// sélection de texte saute, un menu ouvert se ferme. Le garde
// `if (innerHTML !== html)` ne suffit pas — il suffit qu'un « il y a 3 min »
// devienne « il y a 4 min » sur UNE carte pour que la page entière clignote.
//
// `hPatcher` ne remplace que les enfants dont le rendu a réellement changé, et
// leur retire les classes d'entrée : un contenu qui se met à jour n'est pas un
// contenu qui apparaît.

const H_CLASSES_ENTREE = ['msg-in', 'modal-in', 'card-in', 'fade-in'];

/**
 * Identité d'un enfant, pour savoir si c'est le MÊME nœud d'un tour à l'autre.
 * `data-k` quand le rendu la pose ; sinon la position + la balise, ce qui suffit
 * aux blocs statiques (titres de section, bandeaux).
 */
function hClePatch(noeud, index) {
  return noeud.dataset?.k || `${index}:${noeud.tagName}`;
}

/** Un nœud de remplacement n'entre pas en scène : il corrige ce qui est affiché. */
function hSansAnimation(noeud) {
  noeud.classList?.remove(...H_CLASSES_ENTREE);
  noeud.querySelectorAll?.(H_CLASSES_ENTREE.map((c) => `.${c}`).join(','))
    .forEach((e) => e.classList.remove(...H_CLASSES_ENTREE));
  return noeud;
}

/**
 * Écrit `html` dans `cible` en touchant le moins de nœuds possible.
 *
 * ☠ Repli sur une réécriture complète quand la SÉQUENCE change (une carte
 * apparaît, disparaît ou change de section) : réordonner en place détacherait des
 * nœuds, ce qui rejoue leurs animations — le défaut qu'on corrige. Ce repli
 * dépose lui aussi des nœuds sans classe d'entrée : les animations ne jouent
 * qu'au TOUT premier remplissage d'un conteneur, jamais sur un rafraîchissement.
 */
function hPatcher(cible, html) {
  if (!cible || cible.innerHTML === html) return;
  if (cible.children.length === 0) { cible.innerHTML = html; return; }

  const neuf = document.createElement('div');
  neuf.innerHTML = html;
  const anciens = [...cible.children];
  const nouveaux = [...neuf.children];

  const memeSequence = anciens.length === nouveaux.length
    && anciens.every((n, i) => hClePatch(n, i) === hClePatch(nouveaux[i], i));
  if (!memeSequence) { cible.replaceChildren(...nouveaux.map(hSansAnimation)); return; }

  anciens.forEach((ancien, i) => {
    const nouveau = nouveaux[i];
    if (ancien.outerHTML !== nouveau.outerHTML) ancien.replaceWith(hSansAnimation(nouveau));
  });
}

/** Nom historique, conservé pour les appelants existants. */
function hEcrireSiDifferent(el, html) { hPatcher(el, html); }
