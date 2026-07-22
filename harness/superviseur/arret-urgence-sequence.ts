/**
 * Responsabilité : la séquence mécanique de l'arrêt d'urgence (G.4, mission M-52),
 * extraite de `superviseur-workers.ts` pour respecter la limite de 500 lignes —
 * ce fichier n'est PAS un nouveau domaine, c'est la même responsabilité que
 * `SuperviseurWorkers.arretUrgence()`/`arreterMissionEnUrgence()`, qui restent le
 * seul point d'entrée public ; ces fonctions ne sont appelées que par elles.
 *
 * ☠ (a) Ne passe jamais par l'orchestrateur : ce module n'importe rien de
 * `control-plane/orchestrateur/`, et n'est accessible depuis l'extérieur que
 * via `CanalControle` (D.3) → `SuperviseurWorkers`. La frontière A↔B
 * inexistante (03-couche-1.md) garantit ce point mécaniquement.
 *
 * ☠ (b) Ne détruit jamais de travail non commité : aucun import, ici ni dans
 * `superviseur-workers.ts`, de `projets/cycle-vie-worktree.ts`. L'arrêt
 * d'urgence agit uniquement sur le cycle de vie du PROCESS (interrupt / close /
 * abort), jamais sur le worktree — l'absence totale de chemin de code vers sa
 * suppression est la garantie, pas une vérification a posteriori.
 *
 * (c) Grâce respectée avant kill : chaque cible traverse TOUJOURS pause globale
 * (réutilise `ControleurPause`, M-33, jamais réimplémentée) → fermeture propre
 * → attente de la fenêtre de grâce → forçage. Le forçage est inconditionnel et
 * idempotent (H-57 : « appuyer deux fois n'aggrave rien ») : même si tout s'est
 * bien passé avant, il est quand même tenté — c'est le filet, pas une punition.
 */

import { ControleurPause } from '../pause/index.ts';
import type { FileEntreeCiblee } from '../pause/index.ts';
import type { WorkerCapabilities } from '../workers/index.ts';
import type { EnregistrementWorker, EtapeArretUrgence, RapportArretUrgence, ResultatArretUnitaireUrgence } from './types.ts';
import { missionLogger, superviseurLogger } from './logger.ts';

/** Ce qu'une mission vivante expose au minimum pour être arrêtée en urgence. */
export interface CibleArretUrgence {
  readonly missionId: string;
  readonly sessionId: string;
  readonly interrupt: () => Promise<{ still_queued: string[] } | undefined>;
  readonly cible: FileEntreeCiblee;
  readonly capacites: WorkerCapabilities;
}

/** Projette un enregistrement vivant du registre vers la forme minimale requise ci-dessus. */
export function construireCibleArretUrgence(e: EnregistrementWorker): CibleArretUrgence {
  return {
    missionId: e.missionId,
    sessionId: e.sessionId,
    interrupt: () => e.handle.query.interrupt(),
    cible: e.entree,
    capacites: e.handle.capabilities,
  };
}

/** Ports fournis par `SuperviseurWorkers` — jamais réimplémentés ici. */
export interface DependancesArretUrgence {
  readonly fermerProprement: (missionId: string) => Promise<void>;
  readonly forcer: (sessionId: string) => void;
  readonly attendreGrace: (graceMs: number) => Promise<void>;
  readonly graceMs: number;
}

/**
 * Séquence complète pour UNE cible (H-57, G.4.2). Chaque étape est protégée :
 * l'échec d'une étape ne bloque jamais la suivante (isolation des pannes à
 * l'intérieur même d'une mission, pas seulement entre missions).
 */
/** Étape 1 (H-57) : réutilise `ControleurPause` de M-33, jamais réimplémentée. */
async function tenterPauseGlobale(cible: CibleArretUrgence, log: ReturnType<typeof missionLogger>): Promise<boolean> {
  try {
    const controleur = new ControleurPause({
      sessionId: cible.sessionId,
      source: { interrupt: cible.interrupt },
      cible: cible.cible,
      capacites: cible.capacites,
      journal: log,
    });
    await controleur.mettreEnPause();
    return true;
  } catch (erreur) {
    log.error({ err: erreur }, "arrêt d'urgence : la pause globale a levé — on poursuit vers la fermeture propre");
    return false;
  }
}

export async function executerArretUrgenceMission(
  cible: CibleArretUrgence,
  deps: DependancesArretUrgence,
): Promise<ResultatArretUnitaireUrgence> {
  const log = missionLogger(cible.missionId);
  const etapes: EtapeArretUrgence[] = [];

  if (await tenterPauseGlobale(cible, log)) etapes.push('pause_globale');

  try {
    await deps.fermerProprement(cible.missionId);
    etapes.push('fermeture_propre');
  } catch (erreur) {
    log.error({ err: erreur }, "arrêt d'urgence : la fermeture propre a levé — on poursuit vers le forçage");
  }

  await deps.attendreGrace(deps.graceMs);

  // Filet de dernier recours, inconditionnel : toujours tenté, même si tout
  // s'est bien passé avant (idempotent côté `forcer`, voir superviseur-workers.ts).
  deps.forcer(cible.sessionId);
  etapes.push('forcage');

  log.warn({ etapes }, "arrêt d'urgence appliqué à cette mission (G.4)");
  return { missionId: cible.missionId, sessionId: cible.sessionId, etapes };
}

/**
 * Séquence appliquée à TOUT le parc vivant, en parallèle (`Promise.allSettled`) :
 * une mission qui bloque dans son `interrupt()` ne retarde jamais l'arrêt des
 * autres — c'est le critère « isolation » de `03-couche-1.md`.
 */
export async function executerArretUrgenceParc(
  cibles: readonly CibleArretUrgence[],
  deps: DependancesArretUrgence,
): Promise<RapportArretUrgence> {
  superviseurLogger.warn(
    { nombreMissions: cibles.length, graceMs: deps.graceMs },
    "ARRÊT D'URGENCE déclenché (G.4) — toutes les missions vivantes du PC",
  );
  const resultats = await Promise.allSettled(cibles.map((cible) => executerArretUrgenceMission(cible, deps)));
  const missions = resultats.map((resultat, index) => {
    if (resultat.status === 'fulfilled') return resultat.value;
    const cible = cibles[index]!;
    superviseurLogger.error(
      { missionId: cible.missionId, err: resultat.reason },
      "arrêt d'urgence : séquence en échec inattendu pour cette mission (ne bloque pas les autres)",
    );
    return { missionId: cible.missionId, sessionId: cible.sessionId, etapes: [] as EtapeArretUrgence[] };
  });
  return { declencheA: Date.now(), missions };
}
