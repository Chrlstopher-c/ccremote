// ============ Segmentation du fil — du brut vers des « valises » ============
//
// ☠ Le fil brut d'une mission réelle, c'est ~90 évènements dont l'écrasante
// majorité sont des appels d'outils. Les rendre un par un noyait la seule chose
// qu'on vient lire — ce que le lead DIT. Ce module regroupe les rafales
// consécutives en un segment unique, résumé par une ligne (« Ran 7 commands,
// read 2 files ») qui ouvre le détail dans une feuille.

/**
 * Décompose le résumé d'entrée d'outil produit par le PC
 * (`collecteur-telemetrie.ts` : `champ=valeur · champ=valeur`).
 * ☠ Découpe sur le PREMIER `=` seulement : une commande shell en contient.
 */
function hParseOutil(texte) {
  const champs = {};
  for (const part of String(texte || '').split(' · ')) {
    const i = part.indexOf('=');
    if (i > 0) champs[part.slice(0, i)] = part.slice(i + 1);
  }
  return champs;
}

/** Ce qu'on montre d'un appel d'outil sur une seule ligne. */
function hResumeOutil(ev) {
  const c = hParseOutil(ev.text);
  const chemin = c.file_path || c.path || c.notebook_path;
  return c.description || (chemin ? chemin.split('/').pop() : '') || c.pattern || c.query || c.url || c.command || ev.tool || 'action';
}

/** Verbe et unité pour composer le libellé d'une valise, façon Claude Code. */
const HVERBES = {
  Bash: ['exécuté', 'commande', 'commandes'],
  BashOutput: ['exécuté', 'commande', 'commandes'],
  Read: ['lu', 'fichier', 'fichiers'],
  NotebookRead: ['lu', 'fichier', 'fichiers'],
  Write: ['écrit', 'fichier', 'fichiers'],
  Edit: ['modifié', 'fichier', 'fichiers'],
  NotebookEdit: ['modifié', 'fichier', 'fichiers'],
  Grep: ['cherché', 'motif', 'motifs'],
  Glob: ['cherché', 'motif', 'motifs'],
  WebFetch: ['consulté', 'page', 'pages'],
  WebSearch: ['cherché sur le web', '', ''],
  Task: ['délégué à', 'sous-agent', 'sous-agents'],
  TodoWrite: ['mis à jour le plan', '', ''],
  ToolSearch: ['cherché un outil', '', ''],
  Skill: ['chargé', 'compétence', 'compétences'],
};

/** Outils dont l'argument est un chemin — nommé plutôt que compté quand il est seul. */
const H_OUTILS_FICHIER = new Set(['Read', 'NotebookRead', 'Write', 'Edit', 'NotebookEdit']);

/**
 * Un appel `Task` : le moment où le lead confie du travail à un sous-agent.
 * C'est le seul évènement du fil qui ouvre sur le travail d'un AUTRE agent.
 */
function hEstDelegation(ev) {
  return !!ev && ev.type === 'activity' && ev.nature === 'outil' && ev.tool === 'Task';
}

/**
 * Le nom parlant d'une délégation.
 *
 * ☠ C'est la SEULE clef de rapprochement disponible entre un appel `Task` du fil
 * et le sous-agent connu du registre : `subagent_type` n'est pas relevé par le PC
 * (`CHAMPS_OUTIL` de `collecteur-telemetrie.ts`), et l'`agentId` écrit par le CLI
 * n'existe pas encore à l'instant de l'appel. Côté API, `SubagentApi.name` vaut
 * `description ?? type ?? agentId` — donc l'égalité ne tient QUE si la
 * description a été relevée. Quand elle manque, on ne rapproche rien.
 */
function hNomDelegation(ev) {
  return (hParseOutil(ev.text).description || '').trim();
}

function hNomCourtOutil(outil) {
  const m = /^mcp__[^_]+(?:_[^_]+)*__(.+)$/.exec(String(outil || ''));
  return m ? m[1] : String(outil || 'outil');
}

function hVerbe(outil) {
  if (HVERBES[outil]) return HVERBES[outil];
  if (/^mcp__/.test(String(outil || ''))) {
    const nom = hNomCourtOutil(outil);
    return ['appelé', nom, nom];
  }
  return ['utilisé', 'outil', 'outils'];
}

/**
 * « Ran 7 commands, read 2 files ». ☠ Groupé par VERBE et non par outil : « ran 3
 * commands, ran 4 commands » n'apprend rien de plus et rallonge la ligne.
 */
function hLibelleValise(outils) {
  const parGroupe = new Map();
  for (const ev of outils) {
    const [verbe, un, plusieurs] = hVerbe(ev.tool);
    // ☠ La clé porte le verbe ET l'unité : deux outils MCP distincts partagent
    // le verbe « appelé » et se seraient fondus en un seul décompte faux.
    const cle = `${verbe}|${un}`;
    const acc = parGroupe.get(cle) || { verbe, un, plusieurs, n: 0, exemples: [] };
    acc.n += 1;
    if (H_OUTILS_FICHIER.has(ev.tool)) {
      const c = hParseOutil(ev.text);
      const chemin = c.file_path || c.path || c.notebook_path;
      if (chemin) acc.exemples.push(chemin.split('/').pop());
    } else if (hEstDelegation(ev)) {
      // Une délégation seule est NOMMÉE comme un fichier seul : « délégué à
      // Refonte du header » dit à qui, « délégué à 1 sous-agent » ne dit rien.
      const nom = hNomDelegation(ev);
      if (nom) acc.exemples.push(nom);
    }
    parGroupe.set(cle, acc);
  }
  const morceaux = [...parGroupe.values()].map(({ verbe, un, plusieurs, n, exemples }) => {
    // ☠ Un fichier seul est NOMMÉ, pas compté : « lu TODO.md » dit ce qui a été
    // lu, « lu 1 fichier » ne dit rien de plus qu'un compteur à un.
    if (n === 1 && exemples.length === 1) return `${verbe} ${exemples[0]}`;
    if (un === '') return n === 1 ? verbe : `${verbe} ×${n}`;
    if (un === plusieurs) return n === 1 ? `${verbe} ${un}` : `${verbe} ${un} ×${n}`;
    return `${verbe} ${n} ${n === 1 ? un : plusieurs}`;
  });
  const phrase = morceaux.join(', ');
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}

// ============ Transitions d'état — du jargon vers du français ============
//
// ☠ Le fil montrait les identifiants du registre tels quels : « planifiee →
// en_cours », « running », « en_cours → terminee ». Ce sont des valeurs de
// colonne SQL (`EtatHarness` et `EtatSdk`, `control-plane/registre/types.ts`),
// affichées à quelqu'un qui ne lit jamais de code — et il y en avait trois sur
// un seul écran de la capture du 07/08.
//
// ☠ On traduit ICI, jamais côté serveur : `texteTransition` (`vue-feed.ts`) est
// aussi ce que lit l'orchestrateur par `outils-inspection.ts`, qui a besoin des
// identifiants exacts. Deux publics, deux vocabulaires.

/** État d'arrivée → ce qui vient d'arriver, du point de vue de l'opérateur. */
const H_ETATS_LISIBLES = {
  planifiee: 'équipe planifiée',
  en_cours: 'équipe démarrée',
  en_pause: 'équipe mise en pause',
  attente_machine: 'en attente de la machine',
  echec_definitif: 'équipe en échec',
  terminee: 'équipe terminée',
  annulee: 'équipe annulée',
  idle: 'le lead a rendu la main',
  running: 'le lead travaille',
  requires_action: 'le lead attend une autorisation',
};

/**
 * Passages dont l'état d'arrivée seul dirait faux : arriver sur `en_cours`
 * depuis `en_pause` est une reprise, pas un démarrage.
 */
const H_PASSAGES_LISIBLES = {
  'en_pause>en_cours': 'équipe reprise',
  'attente_machine>en_cours': 'machine retrouvée, équipe repartie',
};

/**
 * Décompose une ligne de transition telle que le Pi l'écrit :
 * `[origine] avant → après — motif` (`vue-feed.ts`, `texteTransition`).
 * ☠ Le motif est cherché sur ` — ` et pas sur `—` seul : un motif libre peut
 * contenir un tiret cadratin collé, la séquence espacée est celle du format.
 */
function hAnalyserTransition(texte) {
  const brut = String(texte || '').trim();
  const entete = /^\[(\w+)\]\s*/.exec(brut);
  const origine = entete ? entete[1] : '';
  const reste = entete ? brut.slice(entete[0].length) : brut;
  const sep = reste.indexOf(' — ');
  const passage = sep === -1 ? reste : reste.slice(0, sep);
  const motif = sep === -1 ? '' : reste.slice(sep + 3).trim();
  const bornes = passage.split(' → ').map((s) => s.trim());
  return {
    origine,
    passage,
    avant: bornes.length > 1 ? bornes[0] : '',
    apres: bornes[bornes.length - 1],
    motif,
  };
}

/** ☠ Repli sur le PASSAGE brut si l'état est inconnu — un vocabulaire qui
 * s'enrichit côté serveur ne doit jamais faire DISPARAÎTRE une ligne du fil.
 * Sur le passage, pas sur le texte entier : celui-ci porte déjà le motif, qu'on
 * recolle juste après (mesuré ici même — « … — motif — motif »). */
function hPhraseTransition(t) {
  const libelle = H_PASSAGES_LISIBLES[`${t.avant}>${t.apres}`]
    || H_ETATS_LISIBLES[t.apres]
    || t.passage;
  const phrase = t.motif ? `${libelle} — ${t.motif}` : libelle;
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}

/**
 * La phrase à montrer pour une RAFALE de transitions consécutives.
 *
 * ☠ « running → idle » puis « en_cours → terminee » à une seconde d'écart
 * disent la même chose à l'opérateur : le lead a fini. On garde la dernière
 * transition du Pi quand il y en a une — c'est lui l'autorité sur le cycle de
 * vie de l'équipe, le SDK ne fait qu'osciller à chaque tour (`types.ts` :
 * « `en_cours` ≠ `running` »). Rien n'est perdu : l'heure du groupe et sa
 * conclusion restent à l'écran, seul le doublon disparaît.
 */
function hTransitionLisible(items) {
  const analyses = (items || []).filter(Boolean).map((e) => hAnalyserTransition(e.text));
  if (analyses.length === 0) return '';
  const duPi = analyses.filter((t) => t.origine === 'harness');
  const retenue = duPi.length > 0 ? duPi[duPi.length - 1] : analyses[analyses.length - 1];
  return hPhraseTransition(retenue);
}

/**
 * Regroupe le fil en segments affichables.
 *
 * ☠ Les rafales ne sont groupées que si elles sont CONSÉCUTIVES : une parole du
 * lead au milieu coupe le groupe, sinon l'ordre réel du travail serait perdu.
 *
 * ☠ Une DÉLÉGATION ne se fond jamais dans la rafale d'outils voisine, même
 * consécutive. Fondue, elle disparaît derrière « exécuté 7 commandes » : le seul
 * endroit du fil où l'équipe grandit devient introuvable, et le sous-agent
 * redevient un nom au fond d'une feuille. Isolée, elle porte sa propre ligne
 * (« Délégué à 3 sous-agents ») qui ouvre directement sur leurs fils.
 */
function hSegmenterFeed(feed) {
  const segments = [];
  let courant = null;
  const pousser = () => {
    if (courant) {
      // ☠ `ev` conservé sur un groupe de transitions : `harness-mission-sheets.js`
      // rend un fil de sous-agent par `hSystemeTemplate(seg.ev)`. Sans lui, ce
      // chemin recevrait `undefined` et la ligne disparaîtrait du fil sans la
      // moindre erreur pour le dire.
      if (courant.genre === 'systeme') courant.ev = courant.items[courant.items.length - 1];
      segments.push(courant);
    }
    courant = null;
  };
  for (const ev of feed) {
    const estOutil = ev.type === 'activity' && ev.nature === 'outil';
    const estPensee = ev.type === 'activity' && ev.nature === 'reflexion';
    const estSysteme = ev.type === 'system';
    if (estOutil || estPensee || estSysteme) {
      const genre = estOutil ? 'outils' : estPensee ? 'pensees' : 'systeme';
      const delegation = estOutil && hEstDelegation(ev);
      if (courant && courant.genre === genre && courant.delegation === delegation) courant.items.push(ev);
      else {
        pousser();
        courant = { genre, delegation, items: [ev], ts: ev.ts };
      }
      continue;
    }
    pousser();
    if (ev.type === 'instruction') segments.push({ genre: 'operateur', ev });
    else if (ev.type === 'permission') segments.push({ genre: 'permission', ev });
    else segments.push({ genre: 'parole', ev });
  }
  pousser();
  return segments;
}

/**
 * ☠ Un message du HARNESS n'est ni une parole du lead, ni une instruction de
 * Chris — l'attribuer à l'un des deux est le mode de panne H-66. Il est marqué
 * en clair à la source, on le reconnaît ici pour lui donner sa propre voix.
 */
function hEstMessageHarness(texte) {
  return /^\[HARNESS\]/.test(String(texte || '').trim());
}

/**
 * Le bloc que le lead est EN TRAIN d'écrire, toujours en dernier dans le fil.
 *
 * ☠ Le champ `partial` n'existe que depuis le 07/08 : le raisonnement d'une
 * équipe ne quittait pas la machine de travail, et l'observateur qui savait le
 * capter n'était instancié nulle part. Il vaut `null` dès que le lead ne produit
 * rien, et RESTE `null` si la machine est éteinte — ce n'est jamais une erreur,
 * juste une absence, et rien d'autre à l'écran ne doit s'en trouver dégradé.
 *
 * ☠ Ce nœud n'est PAS un segment : il vit hors de `[data-seg]`. Le compter parmi
 * les segments existants décalerait tout le fil d'un cran à chaque sondage, et
 * chaque bloc serait réécrit sur la position de son voisin — un fil qui clignote
 * en entier au lieu d'une ligne qui s'allonge.
 *
 * ☠ Un sondage de retard, assumé : la route rend l'état courant et lance le
 * relevé suivant en tâche de fond, elle n'attend jamais la machine pendant qu'un
 * navigateur patiente.
 */
function hMajPartielMission(corps, partiel) {
  const existant = corps.querySelector(':scope > [data-partiel]');
  const contenu = partiel && typeof partiel.contenu === 'string' ? partiel.contenu.trim() : '';
  if (!contenu) { if (existant) { existant.remove(); return true; } return false; }

  const reflexion = partiel.type === 'reflexion';
  if (existant) {
    // Repeindre à l'identique casserait une sélection en cours pour rien.
    if (existant.dataset.partiel === contenu) return false;
    existant.dataset.partiel = contenu;
    existant.querySelector('.hp-corps').textContent = contenu;
    return true;
  }
  const n = document.createElement('div');
  n.dataset.partiel = contenu;
  n.className = `h-partiel${reflexion ? ' est-pensee' : ''}`;
  n.innerHTML = '<div class="hp-tete"><i></i><span></span></div><div class="hp-corps"></div>';
  n.querySelector('.hp-tete span').textContent = reflexion ? 'Réflexion' : 'Rédaction';
  n.querySelector('.hp-corps').textContent = contenu;
  corps.appendChild(n);
  return true;
}
