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
export function decouper(ref: string, corps: string, taille = TAILLE_MORCEAU_CARACTERES): Morceau[] {
  return decoupeCorps(corps, taille).map((morceau, rang) => ({ t: 'morceau', ref, rang, corps: morceau }));
}

// Un couple de substituts ne se coupe pas : un morceau sans son second substitut ne serait pas du JSON valide.
function decoupeCorps(corps: string, taille: number): string[] {
  const morceaux: string[] = [];
  let debut = 0;
  while (debut < corps.length) {
    let fin = Math.min(debut + taille, corps.length);
    const dernier = corps.charCodeAt(fin - 1);
    if (fin < corps.length && dernier >= 0xd800 && dernier <= 0xdbff) fin -= 1;
    morceaux.push(corps.slice(debut, fin));
    debut = fin;
  }
  return morceaux;
}

/**
 * Un corps à envoyer sous une référence : un seul message s'il tient dans une trame, sinon ses morceaux puis le
 * message final (corps vide) qui annonce leur nombre. `construire` rend le message porteur du corps.
 */
export function messagesAvecCorps(
  ref: string,
  corps: string,
  construire: (corps: string, morceaux?: number) => MessageChiffre,
  taille = TAILLE_MORCEAU_CARACTERES,
): MessageChiffre[] {
  if (corps.length <= taille) return [construire(corps)];
  return [...decouper(ref, corps, taille), construire('', nombreDeMorceaux(corps, taille))];
}

/** Nombre de morceaux d'un corps (0 : il tient dans une trame, aucun morceau). */
export function nombreDeMorceaux(corps: string, taille = TAILLE_MORCEAU_CARACTERES): number {
  return decoupeCorps(corps, taille).length;
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
