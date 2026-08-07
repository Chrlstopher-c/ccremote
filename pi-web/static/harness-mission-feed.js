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
    if (courant) segments.push(courant);
    courant = null;
  };
  for (const ev of feed) {
    const estOutil = ev.type === 'activity' && ev.nature === 'outil';
    const estPensee = ev.type === 'activity' && ev.nature === 'reflexion';
    if (estOutil || estPensee) {
      const genre = estOutil ? 'outils' : 'pensees';
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
