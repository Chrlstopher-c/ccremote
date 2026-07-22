/**
 * Responsabilité : arbitrage du fencing par epoch au démarrage d'un worker (D.2.3, M-11,
 * panne #2). Extrait MÉCANIQUEMENT de `superviseur-workers.ts` (dette n°4a, TODO.md) pour
 * respecter la limite de 500 lignes — aucun changement de comportement, aucun renommage.
 * Même motif que `budgets-workers.ts`/`fencing-restauration.ts` : `SuperviseurWorkers` reste
 * seul à décider QUAND appeler ceci (dans `demarrer()`, avant tout effet de bord).
 */

import type pino from 'pino';
import { arbitrerFencing, type DetenteurEpoch } from './fencing-epoch.ts';
import type { ConcurrentsRestaures } from './fencing-restauration.ts';
import type { RegistreWorkers } from './registre-workers.ts';
import { SuperviseurError } from './superviseur-workers-types.ts';
import type { DemandeDemarrage } from './types.ts';

export interface DependancesArbitrageFencing {
  readonly registre: RegistreWorkers;
  readonly concurrentsRestaures: ConcurrentsRestaures;
  readonly tuerSansPreavis: (sessionId: string) => void;
  readonly terminerConcurrentRestaure: (pid: number, signal: NodeJS.Signals) => void;
}

/** Un worker RÉEL passe par `tuerSansPreavis`. Un concurrent RESTAURÉ (dette n°1) voir `ConcurrentsRestaures.evincer()`. */
function evincerConcurrent(deps: DependancesArbitrageFencing, sessionId: string, worktree: string): void {
  if (deps.registre.parSession(sessionId) !== null) {
    deps.tuerSansPreavis(sessionId);
    return;
  }
  deps.concurrentsRestaures.evincer(sessionId, worktree, deps.terminerConcurrentRestaure);
}

/**
 * Arbitre la revendication du worktree (D.2.3, panne #2). Concurrents = tout
 * enregistrement vivant sur le MÊME `cwd`, hors la session candidate elle-même
 * (un rattachement de la session à elle-même n'est jamais un concurrent).
 *
 * `☠ CASSE` — rejeter n'est PAS suffisant sur une égalité d'epoch : sans le
 * traiter comme un cas de première classe (`fencing-epoch.ts`), deux workers du
 * même epoch coexisteraient silencieusement. Ici, une décision `rejete` lève
 * AVANT tout spawn ; une décision `accepte_evince` termine réellement (pas
 * seulement « marque périmé ») chaque détenteur dépassé via `tuerSansPreavis`,
 * qui aborte l'`AbortController` propre à CE worker — le même mécanisme que
 * l'arrêt d'urgence, pas une nouvelle voie de terminaison à auditer séparément.
 *
 * `☠` dette n°1 (TODO.md) — les concurrents restaurés (`ConcurrentsRestaures`)
 * participent à L'ARBITRAGE comme les workers en mémoire : ferme M-53
 * (`validation-proprietes/isolation.test.ts`), un candidat jusque-là accepté en
 * silence est désormais REJETÉ ou ÉVINCÉ.
 */
export function arbitrerFencingWorktree(deps: DependancesArbitrageFencing, demande: DemandeDemarrage, log: pino.Logger): void {
  const concurrentsReels: DetenteurEpoch[] = deps.registre
    .tous()
    .filter((e) => e.vivant && e.worktree === demande.spec.cwd && e.sessionId !== demande.spec.sessionId)
    .map((e) => ({ sessionId: e.sessionId, epoch: e.epoch }));

  const concurrentsFantomes = deps.concurrentsRestaures.concurrentsSur(demande.spec.cwd, demande.spec.sessionId);

  const decision = arbitrerFencing([...concurrentsReels, ...concurrentsFantomes], { sessionId: demande.spec.sessionId, epoch: demande.epoch });

  if (decision.type === 'rejete') {
    log.warn(
      { worktree: demande.spec.cwd, epochCandidat: demande.epoch, motif: decision.motif, epochCourant: decision.epochCourant },
      'demande de démarrage REJETÉE par le fencing epoch (D.2.3, panne #2) — aucun spawn',
    );
    throw new SuperviseurError(
      `fencing epoch : requête rejetée (${decision.motif}) pour le worktree "${demande.spec.cwd}" ` +
        `— epoch candidat ${demande.epoch}, epoch courant ${decision.epochCourant}`,
    );
  }

  if (decision.type === 'accepte_evince') {
    for (const sessionEvincee of decision.sessionsAEvincer) {
      log.warn(
        { worktree: demande.spec.cwd, sessionEvincee, nouvelEpoch: demande.epoch },
        'epoch strictement supérieur revendiqué — TERMINAISON RÉELLE du worker périmé (D.2.3)',
      );
      evincerConcurrent(deps, sessionEvincee, demande.spec.cwd);
    }
  }
}
