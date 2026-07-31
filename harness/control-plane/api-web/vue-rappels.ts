/**
 * Responsabilité : forme des rappels servie à l'interface.
 *
 * `☠` `nextAt` est rendu en horodatage ABSOLU, jamais en « dans X min » calculé
 * ici. Le serveur et le navigateur n'ont pas la même horloge, et un délai figé à
 * l'instant de la réponse vieillit dès qu'il s'affiche — la page se rafraîchit
 * toutes les 8 s, le compte à rebours serait faux entre deux passages. Le front
 * calcule le relatif au moment du rendu.
 */

import type { Rappel } from '../registre/index.ts';

export interface RappelApi {
  readonly id: string;
  readonly label: string;
  readonly instruction: string;
  readonly state: 'actif' | 'en_pause' | 'termine';
  /** Échéance absolue en ms epoch. `null` quand le rappel est terminé. */
  readonly nextAt: number | null;
  /** Cadence en minutes, `null` pour un rappel unique. */
  readonly everyMinutes: number | null;
  readonly fired: number;
  readonly maxFires: number | null;
  readonly lastFiredAt: number | null;
  /** Dernier report ou échec, en clair. Affiché tel quel. */
  readonly lastError: string | null;
}

export function versRappelApi(r: Rappel): RappelApi {
  return {
    id: r.id,
    label: r.libelle,
    // `☠` La consigne ENTIÈRE : c'est ce que l'orchestrateur recevra mot pour
    // mot. Chris doit pouvoir la lire pour juger si le rappel fait ce qu'il
    // croit — un libellé seul ne dit rien de ce qui sera réellement injecté.
    instruction: r.consigne,
    state: r.etat,
    nextAt: r.etat === 'termine' ? null : r.prochaineA,
    everyMinutes: r.periodeMs === null ? null : Math.round(r.periodeMs / 60_000),
    fired: r.declenchements,
    maxFires: r.maxDeclenchements,
    lastFiredAt: r.dernierDeclenchementA,
    lastError: r.derniereErreur,
  };
}
