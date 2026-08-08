// ============ Appels d'outils dans le fil de l'orchestrateur ============
//
// Responsabilité : la carte repliable qui regroupe les appels d'outils CONSÉCUTIFS
// d'un tour — son résumé sémantique, ses lignes, leur détail, et le clic qui les
// ouvre. Rien d'autre : ni fil, ni sondage, ni composeur.
// Sorti de `harness-orchestrateur.js` le 08/08 (1546 lignes pour une limite de
// 500). Sortir les rallonges seules ramenait à 1386 — ce bloc est le second plus
// gros ensemble à responsabilité unique du fichier, et le plus indépendant : il
// ne touche ni `hOrch`, ni le réseau, ni le sondage. Il ne reçoit que des nœuds.
//
// ☠ IDIOME : fonctions `h*` au niveau du module (donc globales, comme
// `harness-horodatage.js`), plus une façade `window.HAppelsOutils` pour les trois
// points par lesquels le fil entre ici. La délégation de clic est posée au
// chargement, sur `document` — elle ne dépend d'aucun autre module.

/** Dernier segment d'un nom d'outil MCP : `a__b__lister` → `lister`. */
function hToolLabel(name) { const p = String(name).split('__'); return p[p.length - 1] || String(name); }

// ── Groupe d'appels d'outils ────────────────────────────────────────────────
// ☠ Troisième rendu en un jour, et seul celui-ci tient. D'abord des blocs pleine
// largeur empilant du JSON brut — illisibles. Puis une timeline à filet vertical
// — compacte, mais une ligne de bruit par appel quand même. Le rendu retenu
// (celui de Claude) traite le vrai problème : les appels CONSÉCUTIFS sont
// regroupés sous un seul résumé, et la carte ne s'ouvre que si on veut le
// détail. Sur un tour à huit outils, on lit une ligne au lieu de huit.

/**
 * Libellé humain d'un appel. `☠` `mcp__ccremote-controle__lister_equipes` ne dit
 * rien à la lecture : on garde le verbe, et le nom technique reste dans le
 * détail pour qui le cherche.
 */
function hOutilLisible(nom, detail) {
  const court = hToolLabel(nom).replace(/_/g, ' ');
  const titre = court.charAt(0).toUpperCase() + court.slice(1);
  if (!detail) return titre;
  // Un premier paramètre parlant vaut mieux qu'un JSON tronqué au hasard.
  try {
    const o = JSON.parse(detail);
    const cle = ['projet', 'chemin', 'missionId', 'equipe', 'query', 'titre'].find((k) => typeof o[k] === 'string');
    return cle ? `${titre} · ${String(o[cle]).split('/').pop()}` : titre;
  } catch { return titre; }
}

/**
 * Familles d'outils, pour résumer un groupe en langage naturel.
 * ☠ L'ordre compte : le premier motif qui matche gagne. `suivre_equipe` doit
 * donc être testé avant le motif générique `equipe`, sinon un suivi se lirait
 * comme une action sur le parc.
 */
const H_FAMILLES = [
  { re: /^(lister_equipes|etat_equipe|rapport_equipe|suivre_equipes?|carburant_parc|historique_equipe|mon_autonomie)$/, verbe: 'Consulté', quoi: 'le parc' },
  { re: /^(lister_projets|explorer_projets|rechercher_projets|lire_fichier)$/, verbe: 'Exploré', quoi: 'les projets' },
  { re: /^creer_equipe$/, verbe: 'Proposé', quoi: 'un mandat' },
  { re: /^(envoyer_a_equipe|interrompre_equipe|arreter_equipe|relancer_equipe|definir_budget)$/, verbe: 'Agi', quoi: 'sur une équipe' },
  { re: /^(programmer_rappel|mes_rappels|modifier_rappel|supprimer_rappel|mettre_rappel_en_pause|reprendre_rappel)$/, verbe: 'Géré', quoi: 'les rappels' },
  { re: /^nommer_fil$/, verbe: 'Nommé', quoi: 'ce fil' },
  { re: /^(WebSearch|WebFetch)$/, verbe: 'Cherché', quoi: 'sur le web' },
  { re: /^(Read|Grep|Glob)$/, verbe: 'Lu', quoi: 'des fichiers' },
];

/** Accord du complément quand une famille est appelée plusieurs fois. */
function hFamilleDe(nom) {
  const court = hToolLabel(nom);
  return H_FAMILLES.find((f) => f.re.test(court)) ?? { verbe: 'Utilisé', quoi: 'un outil' };
}

/**
 * Résumé d'un groupe — la seule ligne visible au repos.
 *
 * ☠ Résumé SÉMANTIQUE, pas un compteur : « 5 appels d'outils » n'apprend rien.
 * On dit ce qui a été fait, par famille — « Consulté le parc, proposé un
 * mandat » — avec le verbe en avant et le complément en retrait, comme dans le
 * rendu de Claude. Le détail exact reste à un clic.
 *
 * ☠ Les échecs sont comptés à part et signalés : un échec doit se voir AVANT
 * d'ouvrir la carte, sinon il se lit comme un appel réussi.
 */
function hResumeGroupe(carte) {
  const lignes = [...carte.querySelectorAll('.tc-ligne')];
  const echecs = lignes.filter((l) => l.classList.contains('err')).length;
  // Regroupe par famille en PRÉSERVANT l'ordre d'appel : c'est l'ordre dans
  // lequel l'orchestrateur a travaillé, et il raconte quelque chose.
  const parFamille = [];
  for (const ligne of lignes) {
    const f = hFamilleDe(ligne.dataset.outil || '');
    const vu = parFamille.find((x) => x.verbe === f.verbe && x.quoi === f.quoi);
    if (vu) vu.n += 1;
    else parFamille.push({ ...f, n: 1 });
  }
  const morceaux = parFamille.map((f) => {
    const comp = f.n > 1 ? `${f.quoi} <span class="tc-n">(${f.n}×)</span>` : f.quoi;
    return `<span class="tc-v">${escapeHtml(f.verbe)}</span> <span class="tc-n">${comp}</span>`;
  });
  const err = echecs > 0 ? ` <span style="color:var(--err);">· ${echecs} en échec</span>` : '';
  return morceaux.join('<span class="tc-n">, </span>') + err;
}

/** Réécrit le résumé du groupe qui contient cette ligne. */
function hMajResumeGroupe(ligne) {
  const groupe = ligne.closest('.tc');
  const carte = groupe && groupe.querySelector('.tc-carte');
  const res = groupe && groupe.querySelector('.tc-res');
  if (carte && res) res.innerHTML = hResumeGroupe(carte);
}

/**
 * Range sur la ligne ce que l'appel a demandé et ce qu'il a rendu, puis repeint.
 * ☠ Rappelé à chaque rafraîchissement : c'est le SEUL chemin par lequel un
 * résultat arrivé APRÈS l'appel rejoint sa ligne — la garde d'idempotence de
 * `hAppendEvent` interdit de reposer le nœud.
 */
function hMajOutil(ligne, ev) {
  if (!ligne || !ev) return;
  if (ev.detail) ligne.dataset.detail = ev.detail;
  if (ev.resultat !== null && ev.resultat !== undefined) ligne.dataset.resultat = ev.resultat;
  ligne.classList.toggle('err', (ligne.dataset.resultat || '').startsWith('[ÉCHEC DE L’OUTIL]'));
  const lbl = ligne.querySelector('.tc-lbl');
  if (lbl) lbl.textContent = hOutilLisible(ligne.dataset.outil || '', ligne.dataset.detail);
  const corps = ligne.querySelector('.tc-corps');
  if (corps && corps.classList.contains('ouvert')) {
    corps.querySelector('.tc-in').innerHTML = hCorpsOutilOrch(ligne);
  }
  hMajResumeGroupe(ligne);
}

/**
 * Détail d'une ligne : les paramètres en « commande », puis la sortie.
 * ☠ `resultat` absent veut dire « pas encore revenu », jamais « vide » : on le
 * DIT. Un outil présenté comme ayant répondu du vide est un mensonge plus
 * coûteux que l'absence d'information.
 */
function hCorpsOutilOrch(ligne) {
  const d = ligne.dataset || {};
  const parts = [
    `<div class="tc-cmd"><span class="tc-inv">$</span><pre>${escapeHtml(d.outil || '')}`
    + (d.detail ? ` ${escapeHtml(d.detail)}` : '') + '</pre></div>',
  ];
  if (d.resultat === undefined) {
    parts.push('<div class="tc-attente">Résultat en attente — l’outil n’a pas encore répondu.</div>');
  } else {
    const echec = d.resultat.startsWith('[ÉCHEC DE L’OUTIL]');
    parts.push(`<div class="tc-sortie${echec ? ' err' : ''}" tabindex="0" role="group" aria-label="Sortie de l’outil">${escapeHtml(d.resultat)}</div>`);
  }
  return parts.join('');
}

/**
 * Le groupe ouvert en fin de `groupeAssistant`, ou `null`.
 * ☠ Un groupe se ferme dès que l'orchestrateur reprend la parole : les appels
 * d'APRÈS la réponse appartiennent à une autre séquence et ne doivent pas
 * rejoindre la carte précédente.
 */
function hGroupeOutilsOuvert(groupeAssistant) {
  const dernier = groupeAssistant.lastElementChild;
  return dernier && dernier.classList.contains('tc') && dernier.dataset.clos !== '1' ? dernier : null;
}

/** Ferme le groupe d'outils courant — appelé dès que l'agent reprend la parole. */
function hCloreGroupeOutils(groupeAssistant) {
  if (!groupeAssistant) return;
  const ouvert = hGroupeOutilsOuvert(groupeAssistant);
  if (ouvert) ouvert.dataset.clos = '1';
}

/** Crée la coquille d'un groupe : le résumé cliquable et sa carte repliée. */
function hCreerGroupeOutils() {
  const g = document.createElement('div');
  g.className = 'tc';
  // ☠ `.tc-in` n'est pas décoratif : la grille anime `grid-template-rows`, et
  // c'est l'enfant qui porte `overflow: hidden` et la bordure. Sans lui, le
  // contenu déborde pendant la transition et le cadre reste visible fermé.
  g.innerHTML = `<button class="tc-tete"><span class="tc-res"></span>${HValise.CHEVRON}</button>`
    + '<div class="tc-carte"><div class="tc-in"></div></div>';
  return g;
}

/**
 * Ajoute une ligne d'outil au groupe courant, en en ouvrant un si besoin.
 * Rend la ligne créée, pour que l'appelant y pose son `data-seq`.
 */
function hAjouterLigneOutil(groupeAssistant, contenu, ev) {
  const groupe = hGroupeOutilsOuvert(groupeAssistant)
    || groupeAssistant.appendChild(hCreerGroupeOutils());
  const ligne = document.createElement('div');
  ligne.className = 'tc-ligne';
  ligne.dataset.outil = contenu;
  ligne.innerHTML = `<button class="tc-btn"><span class="tc-lbl"></span>${HValise.CHEVRON}</button>`
    + '<div class="tc-corps"><div class="tc-in"></div></div>';
  groupe.querySelector('.tc-carte > .tc-in').appendChild(ligne);
  hMajOutil(ligne, ev || {});
  return ligne;
}

// ☠ Délégation unique sur le document : les cartes sont recréées à chaque rendu
// du fil, et rebrancher un écouteur par nœud fuirait à chaque passage.
document.addEventListener('click', (e) => {
  const tete = e.target.closest('.tc-tete');
  if (tete) {
    const carte = tete.parentElement.querySelector('.tc-carte');
    if (carte) {
      const ouvrir = !carte.classList.contains('ouvert');
      carte.classList.toggle('ouvert', ouvrir);
      tete.classList.toggle('ouvert', ouvrir);
    }
    return;
  }
  const btn = e.target.closest('.tc-btn');
  if (!btn) return;
  const ligne = btn.closest('.tc-ligne');
  const corps = ligne && ligne.querySelector('.tc-corps');
  if (!corps) return;
  const ouvrir = !corps.classList.contains('ouvert');
  // Rempli à l'OUVERTURE, jamais figé à la création : le résultat peut arriver
  // après, et un contenu construit d'avance afficherait « en attente » à jamais.
  if (ouvrir) corps.querySelector('.tc-in').innerHTML = hCorpsOutilOrch(ligne);
  corps.classList.toggle('ouvert', ouvrir);
  btn.classList.toggle('ouvert', ouvrir);
});
// ☠ Façade explicite : le fil n'appelle QUE ces trois entrées. Sans `?.` — un
// module absent n'est pas une option dégradée, c'est un fil qui perd
// silencieusement tous ses appels d'outils. On veut l'exception, tout de suite.
window.HAppelsOutils = {
  ajouterLigne: hAjouterLigneOutil,
  majLigne: hMajOutil,
  clore: hCloreGroupeOutils,
};
