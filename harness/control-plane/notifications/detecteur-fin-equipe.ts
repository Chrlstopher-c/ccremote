/**
 * Responsabilité : reconnaître, dans le flot des états SDK, le moment où une
 * équipe vient de rendre sa réponse. Pur, aucune I/O.
 *
 * `☠` La fin d'une équipe n'existait comme événement NULLE PART. `terminee`
 * n'était posé qu'en un seul endroit du dépôt — la réconciliation, quand elle
 * constate qu'un worker a disparu du PC. Autrement dit le harness n'apprenait
 * la fin d'un travail qu'à la mort du processus, plusieurs minutes après, et
 * par un chemin nommé « fantôme ». Il n'y avait rien à quoi s'abonner.
 *
 * Le signal réel est la transition `running → idle` : le worker a fini d'émettre
 * et attend une entrée. Comme personne ne lui parle spontanément (une équipe est
 * autonome), cette transition EST la fin de son travail. Si l'orchestrateur lui
 * réécrit ensuite, elle repartira `running` puis re-`idle` — et ce sera une
 * nouvelle fin, correctement notifiée. L'idempotence est donc portée par la
 * transition elle-même, sans compteur ni marqueur à tenir.
 *
 * `☠` Deux cas qui ressemblent à une fin et n'en sont pas :
 *   · `null → idle` — premier relevé de télémétrie, avant que le worker ait
 *     produit quoi que ce soit. Le notifier ferait annoncer la fin de chaque
 *     équipe à sa naissance.
 *   · `requires_action → idle` — la demande d'autorisation a été tranchée, pas
 *     le mandat. Ce cas ne devrait plus survenir depuis le passage en
 *     `bypassPermissions` (31/07) ; l'exclure coûte une ligne et ferme le
 *     retour de flamme si un chemin le réintroduit.
 */

import type { EtatSdk } from '../registre/index.ts';

/**
 * `true` quand la transition observée signifie « l'équipe a fini de parler ».
 *
 * @param precedent état connu du registre avant ce relevé (`null` = jamais vu)
 * @param nouveau état rapporté par la télémétrie du PC
 */
export function detecterFinDeTour(precedent: EtatSdk | null, nouveau: EtatSdk | null): boolean {
  return precedent === 'running' && nouveau === 'idle';
}
