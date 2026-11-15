// Responsabilité : la bibliothèque d'une session — ce que le fil a touché (fichiers créés ou modifiés, mis en avant ;
// fichiers seulement lus, en rayon secondaire ; URL ; recherches ; commandes) et la frise chronologique de ces touches.
// Pur : le fil vient du magasin, dans l'ordre des événements, et rien n'est rendu ici.
import type { EvenementDate } from './contrat';
import { journaliser } from './journal';

export type GenreTouche = 'lecture' | 'ecriture' | 'modification' | 'suppression' | 'recherche' | 'commande' | 'web';
export type GenreRessource = 'fichier' | 'url' | 'recherche' | 'commande';

export interface Ressource {
  readonly genre: GenreRessource;
  readonly cible: string;
  readonly touches: number;
  readonly premierTs: string;
  readonly dernierTs: string;
  /** Vrai si le fil a créé, modifié ou supprimé le fichier. */
  readonly ecrite: boolean;
}

export interface Bibliotheque {
  readonly enAvant: readonly Ressource[];
  readonly lues: readonly Ressource[];
  readonly web: readonly Ressource[];
  readonly recherches: readonly Ressource[];
  readonly commandes: readonly Ressource[];
}

export interface Touche {
  readonly type: GenreTouche;
  readonly ts: string;
  readonly cible: string;
}

interface TouchePrecise extends Touche {
  readonly genre: GenreRessource;
  readonly ecrite: boolean;
}

interface Classe {
  readonly type: GenreTouche;
  readonly genre: GenreRessource;
  readonly ecrite: boolean;
  /** Champ de l'entrée de l'outil qui désigne la cible (voir traduction.ts, resumerEntree). */
  readonly champ: string;
}

const CLASSES = new Map<string, Classe>([
  ['Read', { type: 'lecture', genre: 'fichier', ecrite: false, champ: 'file_path' }],
  ['Write', { type: 'ecriture', genre: 'fichier', ecrite: true, champ: 'file_path' }],
  ['Edit', { type: 'modification', genre: 'fichier', ecrite: true, champ: 'file_path' }],
  ['MultiEdit', { type: 'modification', genre: 'fichier', ecrite: true, champ: 'file_path' }],
  ['NotebookEdit', { type: 'modification', genre: 'fichier', ecrite: true, champ: 'notebook_path' }],
  ['Grep', { type: 'recherche', genre: 'recherche', ecrite: false, champ: 'pattern' }],
  ['Glob', { type: 'recherche', genre: 'recherche', ecrite: false, champ: 'pattern' }],
  ['WebSearch', { type: 'recherche', genre: 'recherche', ecrite: false, champ: 'query' }],
  ['WebFetch', { type: 'web', genre: 'url', ecrite: false, champ: 'url' }],
  ['Bash', { type: 'commande', genre: 'commande', ecrite: false, champ: 'command' }],
]);

const SEPARATEURS_COMMANDE = /&&|\|\||;|\|/;

/** Frise chronologique : une touche par action du fil, dans l'ordre du fil. */
export function fileEvenements(fil: readonly EvenementDate[]): Touche[] {
  return fil.flatMap(touchesDe).map(({ type, ts, cible }) => ({ type, ts, cible }));
}

/** Index des ressources touchées par le fil. Le fil est pris dans l'ordre chronologique (seq croissant). */
export function indexerBibliotheque(fil: readonly EvenementDate[]): Bibliotheque {
  const accus = new Map<string, Ressource>();
  for (const touche of fil.flatMap(touchesDe)) cumuler(accus, touche);
  const toutes = [...accus.values()].sort((a, b) => b.dernierTs.localeCompare(a.dernierTs));
  return {
    enAvant: toutes.filter((r) => r.genre === 'fichier' && r.ecrite),
    lues: toutes.filter((r) => r.genre === 'fichier' && !r.ecrite),
    web: toutes.filter((r) => r.genre === 'url'),
    recherches: toutes.filter((r) => r.genre === 'recherche'),
    commandes: toutes.filter((r) => r.genre === 'commande'),
  };
}

function touchesDe(evenement: EvenementDate): TouchePrecise[] {
  const { evt, ts } = evenement;
  if (evt.type !== 'outil') return [];
  const classe = CLASSES.get(evt.nom);
  if (!classe) return [];
  const cible = cibleDe(evt.detail, evt.resume, classe.champ);
  const principale: TouchePrecise = { type: classe.type, genre: classe.genre, ecrite: classe.ecrite, cible, ts };
  if (evt.nom !== 'Bash') return [principale];
  return [principale, ...cibleRm(cible).map((fichier): TouchePrecise => ({
    type: 'suppression',
    genre: 'fichier',
    ecrite: true,
    cible: fichier,
    ts,
  }))];
}

/** Les fichiers effacés par `rm` dans une commande Bash (les options sont ignorées). */
export function cibleRm(commande: string): string[] {
  return commande.split(SEPARATEURS_COMMANDE).flatMap((segment) => {
    const [outil = '', ...args] = segment.trim().split(/\s+/);
    if (outil !== 'rm') return [];
    return args.filter((arg) => arg !== '' && !arg.startsWith('-'));
  });
}

function cibleDe(detail: string, resume: string, champ: string): string {
  const valeur = champDuDetail(detail, champ);
  return valeur !== '' ? valeur : resume;
}

// L'entrée JSON de l'outil. Tronquée au-delà de sa taille maximale : elle ne se lit plus, on prend alors le résumé.
function champDuDetail(detail: string, champ: string): string {
  let entree: unknown;
  try {
    entree = JSON.parse(detail);
  } catch {
    journaliser('debug', 'détail d’outil non JSON (tronqué), résumé utilisé', { champ });
    return '';
  }
  if (typeof entree !== 'object' || entree === null) return '';
  const valeur: unknown = Reflect.get(entree, champ);
  return typeof valeur === 'string' ? valeur : '';
}

function cumuler(accus: Map<string, Ressource>, touche: TouchePrecise): void {
  const cle = `${touche.genre}\u0000${touche.cible}`;
  const existante = accus.get(cle);
  if (!existante) {
    accus.set(cle, {
      genre: touche.genre,
      cible: touche.cible,
      touches: 1,
      premierTs: touche.ts,
      dernierTs: touche.ts,
      ecrite: touche.ecrite,
    });
    return;
  }
  accus.set(cle, {
    ...existante,
    touches: existante.touches + 1,
    dernierTs: touche.ts,
    ecrite: existante.ecrite || touche.ecrite,
  });
}
