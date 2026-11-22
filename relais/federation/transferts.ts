// Responsabilité : les gros corps entre nœuds. Un corps qui ne tient pas dans une trame part en morceaux numérotés sous
// la référence de sa requête ou réponse ; le message final annonce leur nombre. Le receveur réassemble, sous bornes ;
// un lien perdu efface les morceaux en route : rien n'est écrit à moitié, la demande se relance.
import {
  TAILLE_MAX_TRANSFERT_CARACTERES,
  TAILLE_MORCEAU_CARACTERES,
  type MessageChiffre,
} from '../../commun/federation.ts';

/** Transferts en cours, au plus, par pair : au-delà, le nouveau est refusé. */
const TRANSFERTS_PAR_PAIR = 16;

type Morceau = Extract<MessageChiffre, { t: 'morceau' }>;

interface EnRoute {
  readonly membre: string;
  readonly morceaux: string[];
  octets: number;
}

/** Le corps coupé en morceaux (dans l'ordre), ou rien s'il tient dans une trame. */
export function decouper(ref: string, corps: string): Morceau[] {
  const morceaux: Morceau[] = [];
  for (let debut = 0, rang = 0; debut < corps.length; debut += TAILLE_MORCEAU_CARACTERES, rang += 1) {
    morceaux.push({ t: 'morceau', ref, rang, corps: corps.slice(debut, debut + TAILLE_MORCEAU_CARACTERES) });
  }
  return morceaux;
}

/** Nombre de morceaux d'un corps (0 : il tient dans une trame, aucun morceau). */
export function nombreDeMorceaux(corps: string): number {
  return Math.ceil(corps.length / TAILLE_MORCEAU_CARACTERES);
}

/** Un corps au-delà de la limite de transfert : refusé, sans rien envoyer. */
export function tropGrandPourTransfert(corps: string): boolean {
  return corps.length > TAILLE_MAX_TRANSFERT_CARACTERES;
}

/** Les morceaux reçus d'un pair, par référence, jusqu'au message final qui les réunit. */
export class Reassemblage {
  private readonly en_route = new Map<string, EnRoute>();

  /** Un morceau dans l'ordre et sous la limite ; sinon le transfert est abandonné (false). */
  recevoir(membre: string, m: Morceau): boolean {
    const cle = cleDe(membre, m.ref);
    const courant = this.en_route.get(cle) ?? this.nouveau(membre, m);
    if (!courant) return false;
    const octets = courant.octets + m.corps.length;
    if (m.rang !== courant.morceaux.length || octets > TAILLE_MAX_TRANSFERT_CARACTERES) {
      this.en_route.delete(cle);
      return false;
    }
    courant.morceaux.push(m.corps);
    courant.octets = octets;
    this.en_route.set(cle, courant);
    return true;
  }

  /** Le corps réuni, si tous ses morceaux sont là ; sinon null (et le transfert est effacé). */
  assembler(membre: string, ref: string, nombre: number): string | null {
    const cle = cleDe(membre, ref);
    const transfert = this.en_route.get(cle);
    this.en_route.delete(cle);
    if (!transfert || transfert.morceaux.length !== nombre) return null;
    return transfert.morceaux.join('');
  }

  /** Efface les transferts d'un pair (lien perdu, révocation). */
  oublier(membre: string): void {
    for (const cle of [...this.en_route.keys()]) if (cle.startsWith(`${membre}\u0000`)) this.en_route.delete(cle);
  }

  private nouveau(membre: string, m: Morceau): EnRoute | null {
    const deCePair = [...this.en_route.values()].filter((t) => t.membre === membre).length;
    if (deCePair >= TRANSFERTS_PAR_PAIR || m.rang !== 0) return null;
    const transfert: EnRoute = { membre, morceaux: [], octets: 0 };
    this.en_route.set(cleDe(membre, m.ref), transfert);
    return transfert;
  }
}

function cleDe(membre: string, ref: string): string {
  return `${membre}\u0000${ref}`;
}
