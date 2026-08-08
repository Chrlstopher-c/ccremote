// ============ Décisions de rallonge du plafond d'autonomie ============
//
// Responsabilité : tout ce qui concerne les demandes de rallonge du plafond
// d'autonomie (migration 27) — les relever, les rendre au-dessus du composeur,
// les trancher, et signaler celles qui attendent AILLEURS que dans le fil ouvert.
// Sorti de `harness-orchestrateur.js` le 08/08 : ce fichier passait 1546 lignes
// pour une limite de 500, et les rallonges en formaient un bloc entier sans
// aucune accroche dans le rendu du fil.
//
// ☠ IDIOME : fonctions `h*` au niveau du module (donc globales, comme
// `harness-horodatage.js`), plus une façade `window.HRallonges` pour ce que les
// autres modules appellent. AUCUNE IIFE ici, et ce n'est pas un détail de style :
// `harness-orch-options.js` appelle `hPlafondLisible(...)` par son nom nu pour la
// feuille « ··· ». L'enfermer dans une portée close le casserait à l'exécution,
// sans la moindre erreur au chargement.
//
// ☠ CHARGÉ APRÈS `harness-orchestrateur.js` : ce module lit `hOrch` (`const` de
// portée globale lexicale, donc en zone morte tant que ce script n'a pas tourné)
// et appelle `hLoadConvList`. Rien ne s'exécute ici au chargement, mais l'ordre
// reste la seule chose qui empêchera un futur ajout d'init de tomber dans la ZTD.

// ---- pourquoi ce circuit existe ---------------------------------------------
//
// ☠ CE QUE CECI RÉPARE — le circuit avait une moitié serveur complète et AUCUNE
// moitié cliente : `grep -c rallonge harness-api.js` rendait 0. L'orchestrateur
// pouvait poser une demande, elle était écrite en base, servie par
// `GET /orchestrator/rallonges`, décidable par deux routes… et n'apparaissait
// nulle part. Elle restait donc en attente indéfiniment pendant qu'il croyait
// avoir sollicité une décision — « un écran qui ment, avec Chris qui attend un
// bouton qui ne viendra pas ». Câblé le 08/08, le jour où l'outil
// `demander_rallonge_autonomie` est entré dans son mandat.
//
// ☠ Une rallonge N'EST PAS un mandat : l'accorder n'ouvre aucune équipe, ça
// applique un plafond au fil qui l'a demandée. Les deux circuits gardent leurs
// libellés, leurs verdicts et leurs messages séparés — un geste ne doit jamais
// pouvoir être pris pour l'autre.
//
// ☠ Le bandeau vit HORS du fil (`#hRallongesZone`, entre le fil et le
// composeur) : une demande ne produit aucun évènement de conversation, elle n'a
// donc aucune ancre dans le fil. Collée au composeur, elle reste visible même
// quand Chris a remonté la lecture — c'est ce qui rend vraie la promesse « il la
// verra sans ouvrir un menu ».

const hRallonges = { enAttente: [], tranchees: {}, dernierAppel: 0 };
/** Cadence PROPRE : le sondage du fil bat à 400 ms en génération, pas cette liste. */
const HRALLONGE_INTERVALLE_MS = 5000;
/** Combien de temps un verdict reste lisible sur sa carte avant de disparaître. */
const HRALLONGE_TAMPON_MS = 12000;

async function hRafraichirRallonges(force = false) {
  const t = Date.now();
  if (!force && t - hRallonges.dernierAppel < HRALLONGE_INTERVALLE_MS) return;
  hRallonges.dernierAppel = t;
  const r = await HarnessAPI.getRallonges();
  // ☠ Control plane muet ⇒ on GARDE ce qui est déjà affiché. Vider la zone sur
  // une erreur réseau ferait disparaître une demande en attente : le mode de
  // panne qu'on corrige, repeint en incident transitoire.
  if (r.erreur) return;
  hRallonges.enAttente = Array.isArray(r.data) ? r.data : [];
  hRendreRallonges();
}

/** Nom lisible d'un fil, ou son identifiant tronqué si la liste ne le connaît pas. */
function hNomFil(conversationId) {
  const fil = (hOrch.list || []).find((c) => c.id === conversationId);
  if (fil && fil.titre) return fil.titre;
  return conversationId ? `fil ${String(conversationId).slice(0, 8)}` : 'fil inconnu';
}

/**
 * Le réglage en français, jamais le jeton brut.
 *
 * ☠ Trois états DISTINCTS côté domaine (`autonomie/reglage-plafond.ts`) :
 * `herite` n'est pas `illimite`, et aucun des deux n'est un nombre. `null` est
 * un quatrième cas — « pas relevé » — qui n'est pas une réponse du serveur.
 */
function hPlafondLisible(valeur) {
  if (valeur === null || valeur === undefined || valeur === '') return 'non relevé';
  if (valeur === 'illimite') return 'aucun plafond (illimité)';
  if (valeur === 'herite') return 'défaut du parc';
  const n = Number.parseInt(valeur, 10);
  return Number.isSafeInteger(n) ? `${n} équipe${n > 1 ? 's' : ''} sans clic` : String(valeur);
}

/**
 * Une plage datée, telle qu'on doit la lire d'un coup d'œil à 3 h du matin.
 *
 * ☠ La FIN d'abord, le début seulement s'il n'est pas immédiat : ce que Chris
 * décide en accordant une fenêtre, c'est jusqu'à quand il lâche la main. Un
 * début « maintenant » est le cas normal et n'apprend rien.
 */
function hPlageLisible(debut, fin) {
  if (!fin) return '';
  const t = window.HTemps;
  const lire = (ms) => (t && t.heureFil ? t.heureFil(ms) : new Date(ms).toLocaleString('fr-FR'));
  if (!debut || debut - Date.now() < 120_000) return `jusqu’à ${lire(fin)}`;
  return `de ${lire(debut)} à ${lire(fin)}`;
}

/**
 * ☠ Une demande peut porter sur la PLAGE, sur le PLAFOND, ou sur les deux
 * (migration 29) — `plafondDemande` est nullable depuis. Sans ces deux lignes,
 * une demande de fenêtre s'affichait « Demandé : non relevé » : Chris aurait eu à
 * trancher une demande dont l'écran ne disait pas ce qu'elle demandait.
 */
function hLignesDemande(d) {
  const lignes = [];
  const plage = hPlageLisible(d.fenetreDebut, d.fenetreFin);
  if (plage) lignes.push(`<div class="mrow"><div class="k">Fenêtre</div><div class="v">${escapeHtml(plage)}</div></div>`);
  if (d.fenetreObjectif) {
    lignes.push(`<div class="mrow"><div class="k">Objectif</div><div class="v">${escapeHtml(d.fenetreObjectif)}</div></div>`);
  }
  if (d.plafondDemande) {
    lignes.push(
      `<div class="mrow"><div class="k">Plafond</div><div class="v mono">${escapeHtml(hPlafondLisible(d.plafondDemande))}</div></div>`,
    );
  }
  // Une demande sans aucun volet lisible ne doit pas rendre une carte muette.
  if (lignes.length === 0) {
    lignes.push('<div class="mrow"><div class="k">Demandé</div><div class="v">— illisible, voir le motif</div></div>');
  }
  return lignes.join('');
}

function hCarteRallonge(d) {
  const verdict = hRallonges.tranchees[d.id];
  const cible = d.conversationId === hOrch.convId ? 'ce fil' : hNomFil(d.conversationId);
  const quand = window.HTemps ? window.HTemps.heureFil(d.creeA) : '';
  const bas = verdict
    ? `<div class="verdict-stamp" style="color:${verdict.couleur};">${escapeHtml(verdict.libelle)}</div>`
    : `<div class="macts">
        <button class="btn btn-accent" onclick="hAccorderRallonge('${hArgJs(d.id)}')">Accorder</button>
        <button class="btn btn-ghost" style="color:var(--err);border-color:var(--err-soft);"
          onclick="hRefuserRallonge('${hArgJs(d.id)}')">Refuser</button>
      </div>`;
  // ☠ Le titre nomme ce qui est demandé : accorder une PLAGE (lâcher la main
  // jusqu'à une heure donnée) et relever un PLAFOND (nombre d'équipes sans clic)
  // n'engagent pas la même chose. Un titre unique ferait valider l'un pour l'autre.
  const objet = d.fenetreFin
    ? (d.plafondDemande ? 'Fenêtre d’autonomie et plafond' : 'Fenêtre d’autonomie')
    : 'Rallonge du plafond d’autonomie';
  const titre = verdict ? objet : `${objet} — ta décision est requise`;
  return `<div class="mandate-card${verdict ? ' resolved' : ''}" id="hRallonge_${escapeHtml(d.id)}">
    <div class="mh2">${titre}</div>
    <div class="mb">
      <div class="mrow"><div class="k">Fil</div><div class="v">${escapeHtml(cible)}</div></div>
      ${hLignesDemande(d)}
      <div class="mrow"><div class="k">Motif</div><div class="v">${escapeHtml(d.motif || '— non précisé')}</div></div>
      <div class="mrow"><div class="k">Posée</div><div class="v">${escapeHtml(quand || '—')}</div></div>
    </div>
    ${bas}
  </div>`;
}

/**
 * Les deux surfaces d'une même liste : le bandeau du fil ouvert, et le repère
 * sur la liste des fils.
 *
 * ☠ Le marquage est appelé ICI et pas dans le corps du bandeau : celui-ci sort
 * sec quand `#hRallongesZone` est absente de la page, et le repère de la liste
 * disparaîtrait avec elle — alors que c'est précisément l'écran où Chris ne voit
 * PAS le bandeau qu'on cherche à couvrir.
 */
function hRendreRallonges() {
  hRendreZoneRallonges();
  hMarquerFilsEnAttente();
}

function hRendreZoneRallonges() {
  const zone = document.getElementById('hRallongesZone');
  if (!zone) return;
  const maintenant = Date.now();
  // Purge bornée : un verdict n'est gardé que le temps d'être lu, jamais plus.
  for (const id of Object.keys(hRallonges.tranchees)) {
    if (maintenant - hRallonges.tranchees[id].at > HRALLONGE_TAMPON_MS) delete hRallonges.tranchees[id];
  }
  const vues = [...hRallonges.enAttente];
  for (const id of Object.keys(hRallonges.tranchees)) {
    if (!vues.some((d) => d.id === id)) vues.push(hRallonges.tranchees[id].demande);
  }
  // ☠ Signature avant écriture : cette zone est recalculée à chaque battement du
  // sondage, et réécrire un HTML identique remplacerait les boutons SOUS le
  // doigt de Chris — au moment précis où il vise l'un des deux.
  const sig = JSON.stringify(vues.map((d) => [d.id, d.statut, !!hRallonges.tranchees[d.id]]));
  if (zone.dataset.sig !== sig) {
    zone.dataset.sig = sig;
    zone.innerHTML = vues.map(hCarteRallonge).join('');
  }
  zone.hidden = vues.length === 0;
}

/** Le refus du serveur dit-il « c'était déjà tranché » ? (409 du control plane) */
function hRallongeDejaTranchee(message) {
  return /déjà tranchée|inconnue/i.test(String(message || ''));
}

/**
 * ☠ Une demande tranchée AILLEURS ne redevient jamais cliquable : le clic
 * suivant échouerait exactement pareil. On tamponne ce qui s'est réellement
 * passé au lieu de proposer de recommencer — même règle que les mandats, où une
 * carte périmée a coûté un incident le 01/08.
 */
function hTamponRallonge(id, demande, libelle, couleur) {
  const restant = demande || hRallonges.enAttente.find((d) => d.id === id) || null;
  hRallonges.enAttente = hRallonges.enAttente.filter((d) => d.id !== id);
  if (restant) {
    const heure = new Date().toTimeString().slice(0, 8);
    hRallonges.tranchees[id] = { demande: restant, libelle: `${libelle} à ${heure}`, couleur, at: Date.now() };
  }
  hRendreRallonges();
}

async function hAccorderRallonge(id) {
  const demande = hRallonges.enAttente.find((d) => d.id === id) || null;
  const r = await HarnessAPI.approveRallonge(id);
  if (!r.ok) {
    // Le `detail` du serveur est écrit pour être lu : on le montre tel quel.
    if (hRallongeDejaTranchee(r.erreur)) hTamponRallonge(id, demande, 'Déjà tranchée ailleurs', 'var(--ink-3)');
    showToast(r.erreur || 'Décision non transmise', 'warn');
    return;
  }
  hTamponRallonge(id, demande, 'Accordée — nouveau plafond appliqué', 'var(--ok)');
  showToast(r.effet || 'Rallonge accordée', 'ok');
  // Le plafond du fil vient de changer : la liste le porte, la feuille le lit.
  void hLoadConvList();
}

async function hRefuserRallonge(id) {
  const demande = hRallonges.enAttente.find((d) => d.id === id) || null;
  const r = await HarnessAPI.rejectRallonge(id);
  if (!r.ok) {
    if (hRallongeDejaTranchee(r.erreur)) hTamponRallonge(id, demande, 'Déjà tranchée ailleurs', 'var(--ink-3)');
    showToast(r.erreur || 'Refus non transmis', 'warn');
    return;
  }
  hTamponRallonge(id, demande, 'Refusée — le plafond ne change pas', 'var(--err)');
  showToast(r.effet || 'Rallonge refusée', 'warn');
}
// ---- repère sur la liste des fils -------------------------------------------
//
// ☠ CE QUE CECI RÉPARE — une demande de rallonge ne se voyait QUE depuis une vue
// de conversation (le bandeau `#hRallongesZone` les rend toutes, y compris celles
// des autres fils). Or la page d'atterrissage est la LISTE des fils : on peut
// donc y rester des heures, ou laisser le téléphone posé dessus, pendant que
// l'orchestrateur attend une décision qu'il ne peut pas contourner. Rien, sur
// cette page, ne le disait.
//
// ☠ AUCUN appel réseau supplémentaire : tout est lu dans `hRallonges.enAttente`,
// déjà relevé à la cadence de `HRALLONGE_INTERVALLE_MS` pour le bandeau. Un
// second sondage pour un badge se paierait en latence à chaque tour sur 4G.

/** Les fils qui attendent une décision, d'après la liste déjà relevée. */
function hFilsEnAttenteRallonge() {
  return new Set(hRallonges.enAttente.map((d) => d.conversationId).filter(Boolean));
}

/** Pose (ou retire) le repère sur les deux surfaces de la page « fils ». */
function hMarquerFilsEnAttente() {
  const attendent = hFilsEnAttenteRallonge();
  hMarquerLignesFils(attendent);
  hMajBandeauFils(attendent);
}

/**
 * Repère par ligne : QUEL fil attend.
 *
 * ☠ Diff nœud par nœud, jamais une réécriture : `hRenderFils` refuse déjà de
 * redessiner une liste identique, et repeindre par-dessus ferait clignoter des
 * lignes qu'on est en train de viser au pouce.
 * ☠ Et c'est aussi ce qui rend le repère AUTO-RÉPARANT : quand `hRenderFils`
 * réécrit vraiment la liste (renommage, archivage — voir `hRafraichirFils` dans
 * `harness-menus.js`), les repères partent avec elle. Un garde de signature les
 * croirait posés ; ce parcours les repose au passage suivant.
 */
function hMarquerLignesFils(attendent) {
  const liste = document.getElementById('hFilsListe');
  if (!liste) return;
  for (const ligne of liste.querySelectorAll('.h-fil')) {
    const attend = attendent.has(ligne.dataset.id);
    const marque = ligne.querySelector('.h-fil-decision');
    if (attend && !marque) {
      const p = document.createElement('span');
      p.className = 'h-fil-decision';
      p.innerHTML = '<i></i>décision';
      // `insertBefore(…, null)` ajoute en fin : un chevron absent ne casse rien.
      ligne.insertBefore(p, ligne.querySelector('.h-fil-chev'));
    } else if (!attend && marque) {
      marque.remove();
    }
  }
}

/**
 * Bandeau de tête : QU'IL Y EN A UNE, même si le fil concerné n'est pas à
 * l'écran — liste longue et défilée, ou fil archivé de la vue.
 *
 * ☠ Collé sous la barre de titre plutôt que posé dans la liste : un repère qui
 * exige de faire défiler pour être vu ne répare pas « il peut dormir à côté
 * d'une décision », il le déplace d'un cran.
 */
function hMajBandeauFils(attendent) {
  const el = document.getElementById('hFilsAlerte');
  if (!el) return;
  const nb = attendent.size;
  el.hidden = nb === 0;
  if (nb === 0) return;
  const noms = [...attendent].map(hNomFil);
  const texte = nb === 1
    ? `${noms[0]} attend ta décision — rallonge du plafond d’autonomie`
    : `${nb} fils attendent ta décision — ${noms.join(', ')}`;
  const cible = el.querySelector('.fa-txt');
  if (cible && cible.textContent !== texte) cible.textContent = texte;
}

/**
 * Le bandeau ouvre le fil de la PREMIÈRE demande en attente.
 * ☠ `hOuvrirFil` vit dans `harness-orch-options.js` : garde de typage, parce
 * qu'un repère qui mène à une exception vaut moins qu'un repère qui ne mène
 * nulle part.
 */
function hOuvrirFilEnAttenteRallonge() {
  const demande = hRallonges.enAttente[0];
  if (!demande || !demande.conversationId) return;
  if (typeof hOuvrirFil === 'function') hOuvrirFil(demande.conversationId);
}

window.HRallonges = {
  rafraichir: hRafraichirRallonges,
  marquerFils: hMarquerFilsEnAttente,
  ouvrirFilEnAttente: hOuvrirFilEnAttenteRallonge,
  // ☠ Exposé pour mémoire seulement : `harness-orch-options.js` l'appelle par
  // son nom nu (`hPlafondLisible`), qui reste donc une globale de ce module.
  plafondLisible: hPlafondLisible,
};
