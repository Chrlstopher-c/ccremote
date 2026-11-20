// Responsabilité : fusion d'une relecture de transcript dans le fil d'une session. Seule la suite du dernier événement
// connu du fil s'ajoute, dans l'ordre, sans doublon. Clé d'un événement : son horodatage et son contenu canonique ; le
// contenu porte l'uuid de la ligne du transcript pour les messages, textes et tours (repère fiable).
import type { Evenement } from '../../commun/session.ts';

export interface EvenementHorodate {
  readonly ts: string;
  readonly evt: Evenement;
}

/** État d'une relecture en cours : `ancre` = clé du dernier événement du fil, à retrouver dans les lots qui suivent. */
export interface EtatRelecture {
  readonly replay: string;
  readonly ancre: string | null; // null : tout ce qui suit s'ajoute au fil
  readonly fusion: boolean; // la relecture s'ajoute à un fil déjà rempli (ses ajouts sont diffusés en direct)
}

export function cleEvenement(e: EvenementHorodate): string {
  return `${e.ts}\u0000${JSON.stringify(e.evt)}`;
}

function rangDe(lot: readonly EvenementHorodate[], ancre: string): number {
  for (let i = lot.length - 1; i >= 0; i--) {
    const e = lot[i];
    if (e && cleEvenement(e) === ancre) return i;
  }
  return -1;
}

/** Ce qui s'ajoute au fil pour un lot. Ancre absente de ce lot → rien, on attend le lot suivant. */
export function suiteAjoutee(
  ancre: string | null,
  lot: readonly EvenementHorodate[],
): { readonly ancre: string | null; readonly ajout: readonly EvenementHorodate[] } {
  if (ancre === null) return { ancre: null, ajout: lot };
  const rang = rangDe(lot, ancre);
  if (rang >= 0) return { ancre: null, ajout: lot.slice(rang + 1) };
  // Ancre introuvable par son contenu (fil importé par une version qui n'écrivait pas l'uuid de la ligne) : si le lot
  // couvre son heure, la suite est ce qui est strictement postérieur.
  const heure = heureDe(ancre);
  const premier = lot[0];
  const suite = lot.filter((e) => e.ts > heure);
  if (premier === undefined || premier.ts > heure || suite.length === 0) return { ancre, ajout: [] };
  return { ancre: null, ajout: suite };
}

function heureDe(cle: string): string {
  return cle.slice(0, cle.indexOf('\u0000'));
}

/** Un lot de la relecture `replay` : une nouvelle relecture part de l'ancre du fil (lue seulement à ce moment). */
export function avancerRelecture(
  precedent: EtatRelecture | undefined,
  replay: string,
  ancreDuFil: () => string | null,
  lot: readonly EvenementHorodate[],
): { readonly etat: EtatRelecture; readonly ajout: readonly EvenementHorodate[] } {
  if (precedent !== undefined && precedent.replay === replay) {
    const suite = suiteAjoutee(precedent.ancre, lot);
    return { etat: { replay, ancre: suite.ancre, fusion: precedent.fusion }, ajout: suite.ajout };
  }
  const ancre = ancreDuFil();
  const suite = suiteAjoutee(ancre, lot);
  return { etat: { replay, ancre: suite.ancre, fusion: ancre !== null }, ajout: suite.ajout };
}
