/**
 * Responsabilité : formes de données du banc de drill récurrent de l'arrêt
 * d'urgence (G.4.3, mission M-52).
 *
 * ☠ (d) « testé régulièrement, pas une fois à l'installation » — mécaniquement,
 * ça veut dire : un déclenchement PROGRAMMÉ, à intervalle, qui exerce la VRAIE
 * séquence de production (`SuperviseurWorkers.arreterMissionEnUrgence`, jamais
 * une réimplémentation ni une simulation) contre une cible canari dédiée, et qui
 * ALERTE en direct (pas seulement en CI) si le résultat ne contient pas la
 * preuve que le forçage a réellement eu lieu, ou si aucun drill n'a réussi
 * depuis trop longtemps — ce second cas couvre le mode de panne le plus sournois :
 * le scheduler lui-même s'est arrêté sans bruit.
 *
 * Interdiction de la mission : aucune vraie session Claude Code ici. La cible
 * canari est fournie par l'appelant (le superviseur en production, un double en
 * test) — ce module ne sait pas ce qu'elle est, seulement qu'elle satisfait ce
 * port.
 */

/** Ce que le drill a besoin de déclencher — satisfait structurellement par `SuperviseurWorkers`. */
export interface PortDrillArretUrgence {
  arreterMissionEnUrgence(
    missionId: string,
    graceMs?: number,
  ): Promise<{ readonly missionId: string; readonly sessionId: string; readonly etapes: readonly string[] } | null>;
}

/** Étape dont la présence prouve qu'un drill a réellement exercé tout le chemin. */
export const ETAPE_PREUVE_COMPLETE = 'forcage';

export interface EtatDrill {
  readonly executions: number;
  readonly dernierSuccesA: number | null;
  readonly dernierEchec: { readonly a: number; readonly motif: string } | null;
}

export type MotifAlerte = 'drill_echoue' | 'cible_absente' | 'sequence_incomplete' | 'drill_perime';

export interface AlerteDrill {
  readonly motif: MotifAlerte;
  readonly detail: string;
  readonly depuisDernierSuccesMs: number | null;
}
