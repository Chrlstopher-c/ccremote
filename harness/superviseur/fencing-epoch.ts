/**
 * Responsabilité : arbitrage du fencing par epoch sur un worktree (D.2.3 — mission
 * M-11, panne #2 de `15-grille-revue.md`).
 *
 * Fonction pure, sans I/O : c'est la SEULE règle de décision. `superviseur-workers.ts`
 * l'applique et exécute la terminaison réelle qui en découle (jamais l'inverse — cette
 * fonction ne tue rien elle-même, elle dit qui doit l'être).
 *
 * Le problème qu'elle résout (D.2.3) : le Pi redémarre, croit l'ancien worker mort,
 * relance un worker sur le MÊME worktree avec un epoch supérieur — pendant que
 * l'ancien tourne toujours sur le PC. Sans arbitrage, deux processus écrivent dans
 * le même répertoire. Aucune erreur ne le signale : juste du code incohérent,
 * découvert des jours plus tard.
 *
 * `☠ CASSE` déjà payé (voir `REPRISE.md`) : un fencing qui ne rejette que les epochs
 * STRICTEMENT inférieurs laisse deux workers du MÊME epoch coexister sans trace. La
 * branche d'égalité ci-dessous est donc un cas de première classe, jamais un repli
 * du cas « inférieur ».
 *
 * Décision retenue sur l'égalité (à trancher, argumentée) : deux candidats au MÊME
 * epoch pour le MÊME worktree ne sont jamais une reprise légitime — une reprise
 * légitime PORTE un epoch strictement supérieur (H-56/D.2.3 : « à chaque attachement,
 * le Pi incrémente l'epoch »). Une égalité ne peut donc venir que d'une double
 * décision de dispatch (split-brain, requête rejouée hors du canal idempotent de
 * D.3.2, bug de l'appelant) — c'est une COLLISION, pas une continuité. Le candidat
 * ENTRANT perd systématiquement : le détenteur en place a acquis cet epoch en
 * premier, et le préférer évite qu'une simple relecture arrive à des verdicts
 * différents selon l'ordre d'arrivée des deux requêtes (une règle symétrique sur
 * l'égalité serait non déterministe si les deux arrivent au même instant logique).
 */

/** Ce que l'arbitre connaît d'un détenteur de worktree : sa session et son epoch. */
export interface DetenteurEpoch {
  readonly sessionId: string;
  readonly epoch: number;
}

export type MotifRejetFencing = 'epoch_perime' | 'collision_meme_epoch';

export type DecisionFencing =
  | { readonly type: 'accepte' }
  | {
      readonly type: 'accepte_evince';
      /** Sessions dont l'epoch est strictement dépassé — à terminer réellement (D.2.3). */
      readonly sessionsAEvincer: readonly string[];
    }
  | { readonly type: 'rejete'; readonly motif: MotifRejetFencing; readonly epochCourant: number };

/**
 * Arbitre une revendication de worktree. `concurrentsVivants` exclut déjà le
 * candidat lui-même (un rattachement de la session à elle-même n'est jamais un
 * concurrent — c'est à l'appelant de filtrer par `sessionId`, voir
 * `superviseur-workers.ts`).
 */
export function arbitrerFencing(
  concurrentsVivants: readonly DetenteurEpoch[],
  candidat: DetenteurEpoch,
): DecisionFencing {
  if (concurrentsVivants.length === 0) return { type: 'accepte' };

  const epochCourant = Math.max(candidat.epoch, ...concurrentsVivants.map((c) => c.epoch));

  if (candidat.epoch < epochCourant) {
    return { type: 'rejete', motif: 'epoch_perime', epochCourant };
  }

  // ☠ Égalité explicite : le candidat entrant ne coexiste jamais avec un
  // détenteur déjà vivant au même epoch. Toujours le candidat qui perd.
  if (concurrentsVivants.some((c) => c.epoch === candidat.epoch)) {
    return { type: 'rejete', motif: 'collision_meme_epoch', epochCourant };
  }

  // Ici : candidat.epoch === epochCourant et strictement supérieur à tous les
  // concurrents (sinon l'une des deux branches précédentes aurait déjà tranché).
  const sessionsAEvincer = concurrentsVivants.filter((c) => c.epoch < candidat.epoch).map((c) => c.sessionId);
  return sessionsAEvincer.length > 0 ? { type: 'accepte_evince', sessionsAEvincer } : { type: 'accepte' };
}
