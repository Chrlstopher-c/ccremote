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

/**
 * Regroupe le fil en segments affichables.
 *
 * ☠ Les rafales ne sont groupées que si elles sont CONSÉCUTIVES : une parole du
 * lead au milieu coupe le groupe, sinon l'ordre réel du travail serait perdu.
 */
function hSegmenterFeed(feed) {
  const segments = [];
  let courant = null;
  const pousser = () => {
    if (courant) segments.push(courant);
    courant = null;
  };
  for (const ev of feed) {
    const estOutil = ev.type === 'activity' && ev.nature === 'outil';
    const estPensee = ev.type === 'activity' && ev.nature === 'reflexion';
    if (estOutil || estPensee) {
      const genre = estOutil ? 'outils' : 'pensees';
      if (courant && courant.genre === genre) courant.items.push(ev);
      else {
        pousser();
        courant = { genre, items: [ev], ts: ev.ts };
      }
      continue;
    }
    pousser();
    if (ev.type === 'instruction') segments.push({ genre: 'operateur', ev });
    else if (ev.type === 'permission') segments.push({ genre: 'permission', ev });
    else if (ev.type === 'system') segments.push({ genre: 'systeme', ev });
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
