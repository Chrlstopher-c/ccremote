/**
 * Responsabilité : rapatrier périodiquement, du PC vers le registre du Pi, ce que
 * seul le PC observe — modèle résolu, état SDK, coût, usage de contexte.
 *
 * `☠` C'est le Pi qui INTERROGE (D.3.2) : le PC ne pousse jamais rien de sa
 * propre initiative. Un balayage périodique est donc la seule forme possible ;
 * il tolère par construction un PC éteint ou un relevé manqué.
 *
 * `☠` Les valeurs écrites sont ABSOLUES, jamais des deltas. `ajouterCout` étant
 * cumulatif côté registre, on n'écrit que l'ÉCART avec ce qui est déjà connu :
 * réappliquer un total à chaque passage multiplierait le coût affiché à chaque
 * tour de balayage.
 */

import type { Registre } from '../../control-plane/registre/index.ts';
import type { TelemetrieWorker } from '../../superviseur/index.ts';
import { compositionLogger } from '../logger.ts';

const log = compositionLogger.child({ composant: 'balayage-telemetrie' });

/** Assez fréquent pour que l'écran vive, assez rare pour ne rien saturer. */
export const PERIODE_BALAYAGE_MS = 5_000;

export interface SourceTelemetrie {
  telemetrie(): Promise<readonly TelemetrieWorker[]>;
}

export interface OptionsBalayage {
  readonly registre: Registre;
  readonly source: SourceTelemetrie;
  readonly periodeMs?: number;
}

export interface BalayageTelemetrie {
  arreter(): void;
  /** Exposé pour être déclenché à la demande (tests, banc réel). */
  passer(): Promise<void>;
}

/**
 * Marque le compte d'une mission comme saturé. `☠` C'est ce qui rend la rotation
 * possible : `listerDisponibles()` exclut les comptes `rejected`, donc le
 * prochain dispatch part sur un autre compte. Sans ce relevé, aucun compte n'est
 * jamais marqué et le harness réessaie indéfiniment sur celui qui refuse — c'est
 * ce qui a laissé une équipe « en cours » sans une seule réponse (23/07).
 */
function marquerCompteSature(registre: Registre, compteId: string, motif: string | null): void {
  const dejaRejete = registre.comptes.listerQuotas(compteId).some((q) => q.statut === 'rejected');
  if (dejaRejete) return;
  registre.comptes.releverQuota({
    compteId,
    typeFenetre: 'spend_limit',
    statut: 'rejected',
    seuilDepasse: motif ?? 'limite annoncée par le CLI',
  });
  log.warn({ compteId, motif }, 'compte saturé — écarté des prochains dispatchs (rotation H-53)');
}

/** Applique un relevé à une mission. Ne lève jamais : un mauvais relevé n'arrête pas les autres. */
function appliquer(registre: Registre, t: TelemetrieWorker): void {
  const mission = registre.missions.lire(t.missionId);
  if (mission === null) return; // mission inconnue du Pi : la réconciliation s'en charge, pas nous.

  if (t.quotaSature) marquerCompteSature(registre, mission.compteId, t.motifQuota);

  if (t.modeleResolu !== null && mission.modeleResolu !== t.modeleResolu) {
    registre.missions.definirModeleResolu(t.missionId, t.modeleResolu);
  }
  if (t.etatSdk !== null && mission.etatSdk !== t.etatSdk) {
    registre.etats.appliquerEtatSdk(t.missionId, t.etatSdk);
  }
  // Écart seulement : `ajouterCout` accumule côté registre.
  const ecart = t.coutUsd - mission.budgetConsommeUsd;
  if (ecart > 0) registre.missions.ajouterCout(t.missionId, ecart);

  if (t.contexteTokensUtilises !== null && mission.contexteTokensUtilises !== t.contexteTokensUtilises) {
    registre.missions.definirUsageContexte(t.missionId, t.contexteTokensUtilises, t.contexteTokensMax);
  }
}

export function demarrerBalayageTelemetrie(options: OptionsBalayage): BalayageTelemetrie {
  const periode = options.periodeMs ?? PERIODE_BALAYAGE_MS;

  const passer = async (): Promise<void> => {
    try {
      const releves = await options.source.telemetrie();
      for (const t of releves) {
        try {
          appliquer(options.registre, t);
        } catch (erreur) {
          log.error({ err: erreur, missionId: t.missionId }, 'relevé de télémétrie inapplicable — les autres sont traités');
        }
      }
    } catch (erreur) {
      // `☠` PC éteint = régime nominal (H-75), jamais une alarme. On garde les
      // dernières valeurs connues plutôt que de les remettre à zéro.
      log.debug({ err: erreur }, 'télémétrie indisponible — dernières valeurs conservées');
    }
  };

  const minuterie = setInterval(() => void passer(), periode);
  // Ne retient pas le process en vie : le lien et l'API font ça (Bun/Node).
  if (typeof minuterie.unref === 'function') minuterie.unref();

  return {
    arreter: (): void => clearInterval(minuterie),
    passer,
  };
}
