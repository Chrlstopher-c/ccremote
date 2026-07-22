/**
 * Responsabilité : partitionner `still_queued` en UUID connus / inconnus (acceptation c).
 *
 * Fonction pure, sans dépendance au SDK ni à l'horloge — le caveat vérifié est explicite :
 * « the list may include internally-enqueued uuids the client never sent (cron triggers,
 * auto-resume continuations) — ignore unknown uuids rather than treating them as an error. »
 * `☠` Ne jamais lever sur un inconnu : cette fonction ne peut pas échouer par construction,
 * c'est la garantie testable de l'acceptation (c).
 */

import type { PartitionStillQueued } from './types.ts';

export function partitionnerStillQueued(
  stillQueued: readonly string[],
  uuidsEnvoyes: ReadonlySet<string>,
): PartitionStillQueued {
  const connus: string[] = [];
  const inconnus: string[] = [];
  for (const uuid of stillQueued) {
    (uuidsEnvoyes.has(uuid) ? connus : inconnus).push(uuid);
  }
  return { connus, inconnus };
}
