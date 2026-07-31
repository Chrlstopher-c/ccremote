/**
 * Responsabilité : faire tirer les rappels échus, à intervalle régulier, depuis
 * le Pi.
 *
 * `☠` Boucle SÉPARÉE de la télémétrie et des quotas, pour la même raison qu'eux :
 * elle ne dépend ni du PC ni d'une session vivante. Un rappel doit tirer alors
 * que le PC est éteint et que personne ne regarde — c'est exactement son objet.
 *
 * `☠` Période de balayage COURTE devant la période minimale d'un rappel (5 min) :
 * un balayage plus lent que la cadence la plus fine rendrait la borne mensongère.
 * Une minute laisse une erreur maximale d'une minute sur l'échéance, ce qui est
 * sans conséquence pour un rappel et négligeable en coût — la requête ne touche
 * qu'un index et ne rend presque toujours rien.
 */

import type { Registre } from '../../control-plane/registre/index.ts';
import { ServiceRappels, type EtatCarburant, type PortReveilFil } from '../../control-plane/rappels/index.ts';
import { compositionLogger } from '../logger.ts';

const log = compositionLogger.child({ composant: 'balayage-rappels' });

export const PERIODE_BALAYAGE_RAPPELS_MS = 60_000;

export interface OptionsBalayageRappels {
  readonly registre: Registre;
  readonly reveil: PortReveilFil;
  readonly periodeMs?: number;
}

export interface BalayageRappels {
  arreter(): void;
  /** Exposé pour être déclenché à la demande (tests, banc réel). */
  passer(): Promise<void>;
}

/**
 * Lit le carburant depuis le registre.
 *
 * `☠` Le pire compte DISPONIBLE, pas la moyenne : c'est lui qui décidera du sort
 * d'une session réveillée maintenant. Une moyenne masquerait un compte saturé
 * derrière un compte frais et ferait tirer quand même.
 */
function lireCarburant(registre: Registre): EtatCarburant {
  const disponibles = registre.comptes.listerDisponibles();
  if (disponibles.length === 0) return { pireUtilisation: null, aucunCompteDisponible: true };
  let pire: number | null = null;
  for (const compte of disponibles) {
    const cinqH = registre.comptes.listerQuotas(compte.id).find((q) => q.typeFenetre === 'five_hour');
    const util = cinqH?.utilisation ?? null;
    if (util !== null && (pire === null || util > pire)) pire = util;
  }
  return { pireUtilisation: pire, aucunCompteDisponible: false };
}

export function demarrerBalayageRappels(options: OptionsBalayageRappels): BalayageRappels {
  const periode = options.periodeMs ?? PERIODE_BALAYAGE_RAPPELS_MS;
  const service = new ServiceRappels(options.registre, options.reveil, () => lireCarburant(options.registre));

  const passer = async (): Promise<void> => {
    try {
      const tires = await service.passer();
      if (tires > 0) log.info({ tires }, 'rappels déclenchés');
    } catch (erreur) {
      // Le service ne lève pas ; ce filet couvre une panne du registre lui-même.
      log.error({ err: erreur }, 'balayage des rappels en échec — la boucle continue');
    }
  };

  const minuterie = setInterval(() => void passer(), periode);
  if (typeof minuterie.unref === 'function') minuterie.unref();

  return { arreter: (): void => clearInterval(minuterie), passer };
}
