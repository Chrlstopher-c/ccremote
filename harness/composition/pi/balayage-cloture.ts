/**
 * Responsabilité : clore périodiquement, depuis le Pi, les équipes au repos qui
 * verrouillent leur projet.
 *
 * `☠` Boucle SÉPARÉE de la télémétrie, et c'est le point important : la
 * télémétrie ne voit que ce que le PC rapporte. Un PC éteint arrête donc les
 * relevés — mais pas le verrou H-56, qui vit dans le registre du Pi. Adosser la
 * clôture à la télémétrie aurait laissé un projet verrouillé exactement dans le
 * cas où plus personne ne peut le libérer.
 *
 * `☠` Période GROSSIÈRE devant le délai (15 min) : rien ne presse à la seconde,
 * et la requête balaie tout le parc. Deux minutes bornent le retard à 2 min sur
 * une attente de quinze.
 */

import { ServiceCloture } from '../../control-plane/cloture/index.ts';
import type { Registre } from '../../control-plane/registre/index.ts';
import type { ArreteurMission } from '../../control-plane/orchestrateur/mcp-controle/types.ts';
import { compositionLogger } from '../logger.ts';

const log = compositionLogger.child({ composant: 'balayage-cloture' });

export const PERIODE_BALAYAGE_CLOTURE_MS = 120_000;

export interface OptionsBalayageCloture {
  readonly registre: Registre;
  readonly arreteur: ArreteurMission;
  readonly periodeMs?: number;
  readonly delaiMs?: number;
}

export interface BalayageCloture {
  arreter(): void;
  /** Exposé pour être déclenché à la demande (tests, banc réel). */
  passer(): Promise<void>;
}

export function demarrerBalayageCloture(options: OptionsBalayageCloture): BalayageCloture {
  const periode = options.periodeMs ?? PERIODE_BALAYAGE_CLOTURE_MS;
  const service = new ServiceCloture(options.registre, options.arreteur, options.delaiMs);

  const passer = async (): Promise<void> => {
    try {
      const closes = await service.passer();
      if (closes > 0) log.info({ closes }, 'équipes au repos closes — projets libérés');
    } catch (erreur) {
      // Le service ne lève pas ; ce filet couvre une panne du registre lui-même.
      log.error({ err: erreur }, 'balayage de clôture en échec — la boucle continue');
    }
  };

  const minuterie = setInterval(() => void passer(), periode);
  if (typeof minuterie.unref === 'function') minuterie.unref();

  return { arreter: (): void => clearInterval(minuterie), passer };
}
