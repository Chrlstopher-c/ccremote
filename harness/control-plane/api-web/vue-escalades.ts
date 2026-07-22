/**
 * Responsabilité : traduire les demandes de permission ESCALADÉES du bus
 * (C.3) vers la forme d'affichage du contrat.
 *
 * `☠` Seules les demandes réellement escaladées sortent ici. Le contrat est
 * explicite : « ne contient que ce qui a franchi le plancher de déni générique
 * (H-40/M-20) ». Une permission résolue seule par le lead n'a rien à faire
 * dans la file d'escalades — l'y mettre transformerait un écran d'action
 * humaine en flux d'activité, et il cesserait d'être regardé.
 */

import type { DemandePermission } from '../bus-permissions/index.ts';
import { ageLisible } from './duree.ts';

export interface EscaladeApi {
  readonly id: string;
  readonly missionId: string;
  readonly title: string;
  readonly sub: string;
  readonly age: string;
  readonly old: boolean;
  readonly tool: string;
  readonly phrase: string;
  readonly why: string;
  readonly path?: string;
  readonly suggestions: readonly string[];
}

/** Au-delà, l'interface signale l'attente comme ancienne. Indicateur d'AFFICHAGE seulement. */
const SEUIL_ANCIENNETE_MS = 15 * 60 * 1000;

/**
 * `☠` Une demande n'expire JAMAIS côté données (contrat, H-64) : `old` ne fait
 * que colorer l'affichage. Expirer une demande côté serveur relâcherait un
 * agent bloqué sans qu'aucun humain ait tranché — exactement ce que le bus
 * d'escalade existe pour empêcher.
 */
export function versEscaladeApi(demande: DemandePermission, maintenant: number): EscaladeApi {
  const depuis = demande.enAttenteDepuisA ?? demande.recueA;
  const attenteMs = Math.max(0, maintenant - depuis);
  return {
    id: demande.requestId,
    missionId: demande.idWorker,
    title: demande.outil,
    sub: demande.agentId ?? 'lead',
    // `depuis` est toujours défini ici (`recueA` en dernier recours), donc
    // jamais `null` — le `??` n'est qu'un filet de typage.
    age: ageLisible(depuis, maintenant) ?? "à l'instant",
    old: attenteMs >= SEUIL_ANCIENNETE_MS,
    tool: demande.outil,
    // `☠` Ce que l'agent voulait faire. Sans le `decisionReason` du plancher de
    // déni, un arbitre humain ne voit qu'un nom d'outil : « Bash » n'est pas une
    // demande arbitrable (même piège que `DemandeCanUseTool.input`, H-73.1).
    phrase: demande.decisionReason ?? `${demande.outil} — motif non transmis`,
    why: demande.decisionReason ?? '',
    ...(demande.blockedPath === undefined ? {} : { path: demande.blockedPath }),
    // Le SDK peut fournir des suggestions ; le bus ne les transporte pas encore.
    // Tableau vide plutôt qu'inventé — voir `vue-missions.ts`, même règle.
    suggestions: [],
  };
}
