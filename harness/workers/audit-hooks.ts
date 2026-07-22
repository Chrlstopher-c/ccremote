/**
 * Responsabilité : brancher `spec.portAuditPermissions` (C.5, M-22) sur
 * `Options.hooks` d'un worker, en garantissant la propriété n°1 du harness :
 * un hook ne bloque jamais un tour, ne le fait jamais échouer (mission de ce
 * fichier, complète `options-composition.ts`).
 *
 * ☠ CASSE couvert ici, par construction :
 *  - le port lui-même peut lever à l'invocation (`portAuditPermissions()`
 *    synchrone) ⇒ capturé, audit inactif pour ce worker, jamais propagé au
 *    spawn (`buildAuditHooks` ne lève jamais).
 *  - chaque callback de hook retourné par le port peut lever ou rejeter (le
 *    collecteur d'audit de `control-plane/` n'est lu qu'à travers ce point
 *    d'entrée, pas maîtrisé ici) ⇒ chaque callback est enveloppé
 *    individuellement, retombe sur une observation vide (`{}`) — jamais un
 *    `deny`, jamais une exception qui remonterait au SDK.
 *
 * Ce fichier n'arbitre rien : il ne renvoie jamais autre chose qu'une
 * observation vide, y compris en cas de panne. L'audit **observe**, il ne
 * bloque pas — voir C.1.1 / C.5.3.
 */

import type { HookCallback, HookCallbackMatcher, HookEvent } from '@anthropic-ai/claude-agent-sdk';
import { sessionLogger } from './logger.ts';
import type { WorkerSpec } from './types.ts';

const OBSERVATION_VIDE_SUR_PANNE = {} as const;

/**
 * Enveloppe un callback de hook individuel : toute levée synchrone ou rejet de
 * promesse est capturée, journalisée, et remplacée par une observation vide.
 * Jamais de `deny`, jamais de blocage — une panne d'audit coûte de la trace,
 * jamais un tour.
 */
function protegerCallback(callback: HookCallback, log: ReturnType<typeof sessionLogger>): HookCallback {
  return async (input, toolUseID, options) => {
    try {
      return await callback(input, toolUseID, options);
    } catch (error) {
      log.error({ err: error }, 'hook_audit_a_leve — observation perdue, tour non affecté');
      return OBSERVATION_VIDE_SUR_PANNE;
    }
  };
}

function protegerMatchers(
  matchers: readonly HookCallbackMatcher[],
  log: ReturnType<typeof sessionLogger>,
): HookCallbackMatcher[] {
  return matchers.map((matcher) => ({
    ...matcher,
    hooks: matcher.hooks.map((callback) => protegerCallback(callback, log)),
  }));
}

/**
 * Construit les `Options.hooks` d'un worker à partir du port injecté (H-74) :
 * appelle l'usine une seule fois, à la composition, et enveloppe chaque
 * callback rendu pour garantir la non-régression sur un tour même si l'audit
 * lui-même est en panne.
 *
 * Ne lève jamais : une panne de `spec.portAuditPermissions()` désactive
 * l'audit pour ce worker (log `error`, nommant explicitement l'audit
 * inactif) plutôt que d'empêcher le spawn — un garde-fou d'observation ne
 * doit jamais devenir un garde-fou qui empêche de travailler.
 */
export function buildAuditHooks(spec: WorkerSpec): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
  const log = sessionLogger(spec.sessionId);
  let brut: Partial<Record<HookEvent, HookCallbackMatcher[]>>;
  try {
    brut = spec.portAuditPermissions();
  } catch (error) {
    log.error(
      { err: error },
      'portAuditPermissions_a_leve_a_la_composition — audit des permissions inactif pour ce worker',
    );
    return {};
  }
  const protege: Partial<Record<HookEvent, HookCallbackMatcher[]>> = {};
  for (const [evenement, matchers] of Object.entries(brut) as [HookEvent, HookCallbackMatcher[] | undefined][]) {
    if (matchers === undefined) continue;
    protege[evenement] = protegerMatchers(matchers, log);
  }
  return protege;
}
