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
  Bash: ['ran', 'command', 'commands'],
  BashOutput: ['ran', 'command', 'commands'],
  Read: ['read', 'file', 'files'],
  NotebookRead: ['read', 'file', 'files'],
  Write: ['wrote', 'file', 'files'],
  Edit: ['edited', 'file', 'files'],
  NotebookEdit: ['edited', 'file', 'files'],
  Grep: ['searched', 'pattern', 'patterns'],
  Glob: ['searched', 'pattern', 'patterns'],
  WebFetch: ['fetched', 'page', 'pages'],
  WebSearch: ['searched', 'the web', 'the web'],
  Task: ['delegated to', 'subagent', 'subagents'],
  TodoWrite: ['updated', 'the plan', 'the plan'],
  ToolSearch: ['searched', 'the tool index', 'the tool index'],
  Skill: ['loaded', 'a skill', 'skills'],
};

/**
 * ☠ Un outil MCP s'appelle `mcp__serveur__action` : sans traitement il tombait
 * dans le fourre-tout « used 2 tools », qui n'apprend rien. Mesuré sur une
 * mission réelle où deux appels Hugging Face étaient rendus ainsi.
 */
function hNomCourtOutil(outil) {
  const m = /^mcp__[^_]+(?:_[^_]+)*__(.+)$/.exec(String(outil || ''));
  return m ? m[1] : String(outil || 'outil');
}

function hVerbe(outil) {
  if (HVERBES[outil]) return HVERBES[outil];
  if (/^mcp__/.test(String(outil || ''))) {
    const nom = hNomCourtOutil(outil);
    return ['called', nom, nom];
  }
  return ['used', 'tool', 'tools'];
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
    // le verbe « called » et se seraient fondus en un seul décompte faux.
    const cle = `${verbe}|${un}`;
    const acc = parGroupe.get(cle) || { verbe, un, plusieurs, n: 0 };
    acc.n += 1;
    parGroupe.set(cle, acc);
  }
  const morceaux = [...parGroupe.values()].map(({ verbe, un, plusieurs, n }) => {
    if (un === plusieurs) return n === 1 ? `${verbe} ${un}` : `${verbe} ${un} ×${n}`;
    return n === 1 ? `${verbe} a ${un}` : `${verbe} ${n} ${plusieurs}`;
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
