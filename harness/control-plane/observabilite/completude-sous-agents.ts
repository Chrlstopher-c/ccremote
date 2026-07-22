/**
 * Responsabilité : détecter et CHIFFRER l'écart flux/store (H-72.3, mission
 * M-50). Jamais lissé en silence — c'est l'exigence explicite de la mission :
 * « un agent connu du store mais absent du flux doit apparaître comme
 * "présent, flux incomplet", jamais être omis ».
 *
 * ☠ Ce module ne CORRÈLE PAS le `toolUseId` (identité côté flux, `Agent`
 * dispatché depuis la racine) avec l'`agentId` (identité côté store, nom du
 * sous-chemin `subagents/agent-<agentId>`) — aucun champ commun n'est exposé
 * par les types publics du SDK 0.3.217 pour le faire mécaniquement (voir
 * `types.ts`). Une fausse corrélation serait pire qu'aucune : elle laisserait
 * croire à une identité prouvée là où il n'y a qu'une coïncidence de rang.
 * ⇒ La détection reste AGRÉGÉE (comptages), honnête sur ses limites, et
 * accompagnée de la liste des `agentId` connus du store pour que l'appelant
 * puisse charger CHACUN d'eux via `getSubagentMessages` (E.2.2, `ligne-agent.ts`)
 * sans jamais prétendre savoir lequel correspond à quelle ligne de flux.
 */

import { observabiliteLogger as journal } from './logger.ts';
import type { ArbreFluxTempsReel } from './arbre-flux.ts';
import type { LecteurSousAgents, RapportCompletude } from './types.ts';

/**
 * Compare le flux (best-effort) au store (autorité disque, H.3.1) pour une
 * équipe donnée. `null` sur `sousAgentsConnusStore` si le store n'a pas pu
 * être interrogé — distinct de `0`, pour ne jamais confondre « aucun
 * sous-agent » et « je ne sais pas ».
 */
export async function evaluerCompletude(
  arbre: ArbreFluxTempsReel,
  lecteurStore: LecteurSousAgents | null,
  sessionId: string,
): Promise<RapportCompletude> {
  const sousAgentsDispatches = arbre.sousAgentsDispatches();
  const sousAgentsAvecContenuFlux = arbre.sousAgentsAvecContenu();
  const sousAgentsConnusStore = await interrogerStore(lecteurStore, sessionId);
  const referenceCompletude = Math.max(sousAgentsDispatches, sousAgentsConnusStore ?? 0);
  const divergenceDetectee =
    (sousAgentsConnusStore !== null && sousAgentsConnusStore > sousAgentsAvecContenuFlux) ||
    sousAgentsDispatches > sousAgentsAvecContenuFlux;
  return {
    sousAgentsDispatches,
    sousAgentsAvecContenuFlux,
    sousAgentsConnusStore,
    divergenceDetectee,
    sousAgentsSansDetailTempsReel: Math.max(0, referenceCompletude - sousAgentsAvecContenuFlux),
  };
}

async function interrogerStore(lecteur: LecteurSousAgents | null, sessionId: string): Promise<number | null> {
  if (lecteur === null) return null;
  try {
    const agentIds = await lecteur.listerSousAgents(sessionId);
    return agentIds.length;
  } catch (erreur) {
    journal.error({ erreur, sessionId }, 'interrogation_store_completude_echouee');
    return null;
  }
}
