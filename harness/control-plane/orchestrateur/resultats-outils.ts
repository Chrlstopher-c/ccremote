/**
 * Responsabilité : lire, dans le flux SDK, ce qu'un appel d'outil a DEMANDÉ et
 * ce qu'il a RENDU — puis rendre les deux affichables sans noyer le fil.
 *
 * `☠` Pourquoi ce module existe. Le fil de l'orchestrateur affichait « Outil
 * appelé : lire_fichier » et, dessous, « Le harness journalise l'appel, pas son
 * résultat (H-45) ». Constat de Chris le 01/08 : ça ne sert à rien. Il a raison.
 * Savoir qu'un outil a été appelé sans savoir ce qu'il a répondu n'apprend rien
 * — on ne peut ni suivre le raisonnement, ni voir qu'un outil a échoué, ni
 * comprendre pourquoi l'orchestrateur a conclu ce qu'il a conclu.
 *
 * `☠` Et H-45 était mal invoquée. Elle interdit au flux détaillé des SOUS-AGENTS
 * de traverser le CONTEXTE de l'orchestrateur (panne #17). Ici il s'agit de ses
 * PROPRES appels : leur résultat est déjà dans son contexte, puisque c'est lui
 * qui les a lancés. L'afficher à l'écran ne lui ajoute rien. Une règle appliquée
 * hors de son domaine coûte, ici, la lisibilité de tout le fil.
 *
 * `☠` L'appariement se fait par `tool_use_id`, jamais par ordre d'arrivée : un
 * tour peut lancer plusieurs outils en parallèle, et les résultats reviennent
 * dans l'ordre où ils finissent. Apparier par position produirait des couples
 * faux — pire qu'une absence, parce que crédibles.
 */

/** Au-delà, on tronque : un `lire_fichier` peut rendre 200 Ko. */
export const MAX_RESULTAT = 4_000;
/** Les paramètres d'appel sont courts par nature ; on borne quand même. */
export const MAX_DETAIL = 2_000;

export interface AppelOutil {
  /**
   * `☠` Peut être `null`. Un `tool_use` sans identifiant reste AFFICHÉ, il est
   * seulement non appariable : son résultat ne le rejoindra pas. Exiger l'id
   * ferait disparaître l'appel du fil — on perdrait l'information certaine
   * (« cet outil a été lancé ») pour protéger l'information incertaine.
   */
  readonly toolUseId: string | null;
  readonly nom: string;
  /** Paramètres de l'appel, en JSON lisible. Vide si l'outil n'en prend pas. */
  readonly detail: string;
}

export interface ResultatOutil {
  readonly toolUseId: string;
  readonly contenu: string;
  readonly erreur: boolean;
}

/**
 * `☠` Tronque en le DISANT. Un contenu coupé en silence se lit comme un contenu
 * complet, et c'est ainsi qu'on conclut « le fichier s'arrête là » sur une
 * troncature d'affichage. La marque porte la taille réelle.
 */
export function borner(texte: string, max: number): string {
  if (texte.length <= max) return texte;
  return `${texte.slice(0, max)}\n\n[… tronqué à l’affichage — ${texte.length} caractères au total]`;
}

/** Sérialise les paramètres d'un appel. Une chaîne vide vaut « aucun paramètre ». */
function detailDe(entree: unknown): string {
  if (entree === null || entree === undefined) return '';
  if (typeof entree === 'object' && Object.keys(entree as object).length === 0) return '';
  try {
    return borner(JSON.stringify(entree, null, 2), MAX_DETAIL);
  } catch {
    // Entrée non sérialisable (cycle, valeur exotique) : on ne perd pas l'appel
    // pour autant — seul son détail devient indisponible.
    return '[paramètres illisibles]';
  }
}

/**
 * Aplatit le contenu d'un `tool_result`. Le SDK le rend soit en chaîne, soit en
 * tableau de blocs — les deux formes existent en réel selon l'outil.
 */
function contenuResultat(brut: unknown): string {
  if (typeof brut === 'string') return brut;
  if (!Array.isArray(brut)) return brut === undefined ? '' : JSON.stringify(brut);
  const morceaux: string[] = [];
  for (const bloc of brut as { type?: string; text?: string }[]) {
    if (typeof bloc?.text === 'string') morceaux.push(bloc.text);
    else if (bloc?.type === 'image') morceaux.push('[image]');
  }
  return morceaux.join('\n');
}

/** Extrait les appels d'outils d'un message assistant. */
export function appelsDe(message: unknown): readonly AppelOutil[] {
  const contenu = (message as { message?: { content?: unknown } })?.message?.content;
  if (!Array.isArray(contenu)) return [];
  const sortie: AppelOutil[] = [];
  for (const bloc of contenu as { type?: string; id?: string; name?: string; input?: unknown }[]) {
    if (bloc?.type !== 'tool_use' || typeof bloc.name !== 'string') continue;
    sortie.push({
      toolUseId: typeof bloc.id === 'string' && bloc.id.length > 0 ? bloc.id : null,
      nom: bloc.name,
      detail: detailDe(bloc.input),
    });
  }
  return sortie;
}

/**
 * Extrait les résultats d'outils d'un message utilisateur.
 *
 * `☠` Les `tool_result` arrivent dans des messages de type `user` — c'est ainsi
 * que l'API modélise le retour d'un outil. Un collecteur qui ne regarde que les
 * messages `assistant` ne peut structurellement pas les voir : c'est exactement
 * pourquoi ils n'ont jamais été captés.
 */
export function resultatsDe(message: unknown): readonly ResultatOutil[] {
  if ((message as { type?: string })?.type !== 'user') return [];
  const contenu = (message as { message?: { content?: unknown } })?.message?.content;
  if (!Array.isArray(contenu)) return [];
  const sortie: ResultatOutil[] = [];
  for (const bloc of contenu as { type?: string; tool_use_id?: string; content?: unknown; is_error?: boolean }[]) {
    if (bloc?.type !== 'tool_result' || typeof bloc.tool_use_id !== 'string') continue;
    sortie.push({
      toolUseId: bloc.tool_use_id,
      contenu: borner(contenuResultat(bloc.content), MAX_RESULTAT),
      erreur: bloc.is_error === true,
    });
  }
  return sortie;
}
