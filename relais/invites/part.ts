// Responsabilité : la part des limites d'un invité — relevé du compte au départ et à la fin de chaque tour, écart
// compté dans la fenêtre. Un compte sans relevé donne null (inconnu : permis, comme la charte le dit).
import type { EtatCompte, FenetreUsage } from '../../commun/comptes.ts';
import type { FenetreCompteur } from './compteurs.ts';

export interface Releve {
  readonly session: FenetreUsage | null;
  readonly semaine: FenetreUsage | null;
}

/** Relevé du compte choisi (`null` = le compte par défaut de la machine), ou null si ce compte n'est pas connecté. */
export function releveDuCompte(comptes: readonly EtatCompte[], compte: string | null): Releve | null {
  const trouve = compte === null ? comptes.find((c) => c.defaut) : comptes.find((c) => c.id === compte);
  if (trouve === undefined || !trouve.connecte) return null;
  return { session: trouve.session, semaine: trouve.semaine };
}

/** Consommation d'une fenêtre dans son état courant : 0 si la fenêtre a été remise à zéro depuis, null si inconnue. */
export function consommeCourant(fenetre: FenetreCompteur, actuelle: FenetreUsage | null | undefined): number | null {
  if (actuelle === null || actuelle === undefined) return null;
  return fenetre.cle === actuelle.reinitialiseLe ? fenetre.consomme : 0;
}

/** Ajoute à une fenêtre l'écart du tour : après − avant, borné à 0 ; une remise à zéro entre-temps repart de 0. */
export function ajouterEcart(
  fenetre: FenetreCompteur,
  avant: FenetreUsage | null,
  apres: FenetreUsage | null,
): FenetreCompteur {
  if (apres === null) return fenetre;
  const cle = apres.reinitialiseLe;
  const base = fenetre.cle === cle ? fenetre.consomme : 0;
  // Avant inconnu ou d'une autre fenêtre : on compte le total connu (côté prudent).
  const depart = avant !== null && avant.reinitialiseLe === cle ? avant.pourcent : 0;
  return { cle, consomme: base + Math.max(0, apres.pourcent - depart) };
}

export interface TourSuivi {
  readonly membre: string;
  readonly compte: string | null;
  readonly avant: Releve | null;
  readonly jetonsAvant: number;
}

/** Tours d'invité en cours, par session : posés au départ, repris à la fin. */
export class SuiviTours {
  private readonly ouverts = new Map<string, TourSuivi>();

  debut(session: string, tour: TourSuivi): void {
    this.ouverts.set(session, tour);
  }

  fin(session: string): TourSuivi | null {
    const tour = this.ouverts.get(session) ?? null;
    this.ouverts.delete(session);
    return tour;
  }

  enCours(session: string): boolean {
    return this.ouverts.has(session);
  }
}
