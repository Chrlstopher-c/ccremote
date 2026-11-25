// Responsabilité : le contexte commun des outils de présentation (session, dossier, racines, stockage, émission) et leur
// garde : une erreur devient un refus lisible par l'agent et par Chris dans le fil, jamais une exception qui tombe.
import type { Logger } from 'pino';
import type { QuoiRelais, ReponseRelais } from '../../commun/modules.ts';
import type { Evenement } from '../../commun/session.ts';
import type { Stockage } from './stockage.ts';
import type { LireImageChemin } from './images-chemin.ts';

/** Lien au relais pour les outils de modules (sans URL ni jeton) : la réponse revient à l'id de la requête. */
export type RequeteRelais = (quoi: QuoiRelais, args: unknown) => Promise<ReponseRelais>;

export interface ContexteOutils {
  readonly sessionId: string;
  readonly cwd: string;
  readonly racines: readonly string[];
  readonly stockage: Stockage;
  readonly emettre: (evt: Evenement) => void;
  // Renomme la conversation (absent : outil non exposé).
  readonly renommer?: (titre: string) => void;
  // Notifie Chris depuis la session (absent : outil `notifier` refusé).
  readonly notifier?: (message: string, titre: string | null) => void;
  readonly journal: Logger;
  // Relais pour les outils de machines (absent : pas d'outils `machines`).
  readonly api?: { readonly url: string; readonly jeton: string };
  // Lien au relais pour les outils `modules` (absent : refus lisible).
  readonly relais?: RequeteRelais;
  // Lecture des images désignées par chemin dans un résultat d'outil (absent : pas d'images par chemin).
  readonly lireChemin?: LireImageChemin;
}

export interface Resultat {
  readonly texte: string;
  readonly erreur: boolean;
}

export function ok(texte: string): Resultat {
  return { texte, erreur: false };
}

// Un refus reste visible dans le fil (note de relance), pour que Chris sache pourquoi rien n'apparaît.
export function echec(c: ContexteOutils, texte: string): Resultat {
  c.emettre({ type: 'relance', raison: `présentation refusée : ${texte}` });
  return { texte, erreur: true };
}

export function protege(c: ContexteOutils, operation: string, fn: () => Resultat): Resultat {
  try {
    return fn();
  } catch (erreur) {
    c.journal.error({ err: erreur, session: c.sessionId, operation }, 'présentation impossible');
    return echec(c, `${operation} impossible`);
  }
}
