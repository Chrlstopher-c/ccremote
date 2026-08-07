/**
 * Responsabilité : traduire les demandes de rallonge du plafond d'autonomie
 * (migration 27, domaine) vers le JSON servi à l'UI, et définir le port dont
 * l'API a besoin — même motif que `vue-conversations.ts` pour les mandats.
 *
 * `☠` Une rallonge ACCORDÉE n'est pas une équipe dispatchée : `approuver` ici
 * n'a rien à voir avec `PortMandats.approuver`, qui lance un worker. Elle
 * applique un réglage déjà décrit au fil qui l'a demandé — voir
 * `composition/pi/assembler-control-plane.ts` pour l'implémentation réelle.
 */

import { ecrireReglagePlafond } from '../autonomie/index.ts';
import type { DemandeRallonge } from '../registre/index.ts';

export interface RallongeApi {
  readonly id: string;
  readonly conversationId: string;
  /** Forme lisible : un entier en texte, ou « illimite ». */
  readonly plafondDemande: string;
  readonly motif: string;
  readonly statut: string;
  readonly detail: string | null;
  readonly creeA: number;
}

export function versRallongeApi(d: DemandeRallonge): RallongeApi {
  return {
    id: d.id,
    conversationId: d.conversationId,
    // `☠` Jamais `herite` en pratique (invariant posé au dépôt, `rallonges.ts`) —
    // `?? 'herite'` n'est qu'un filet défensif, réutilisant l'encodage déjà
    // testé de `conversation.plafond_autonomie` plutôt qu'une seconde version.
    plafondDemande: ecrireReglagePlafond(d.plafondDemande) ?? 'herite',
    motif: d.motif,
    statut: d.statut,
    detail: d.detail,
    creeA: d.creeA,
  };
}

/** Décision humaine sur une demande de rallonge (migration 27), vue de l'API. */
export interface PortRallonges {
  enAttente(): readonly DemandeRallonge[];
  /** `true` : réglage appliqué au fil. `false` : demande déjà tranchée ou inconnue. */
  approuver(id: string): boolean;
  refuser(id: string): boolean;
}
