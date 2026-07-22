/**
 * Responsabilité : injecter de la gigue (jitter) dans le backoff de
 * reconnexion de `LienWebSocket` (H-75, point 3) SANS modifier `transport/`
 * (hors zone d'écriture).
 *
 * `☠` LIMITE MESURÉE sur `transport/lien-websocket.ts` (lecture seule) :
 * `OptionsLienWebSocket.backoffMs` n'accepte qu'un TABLEAU FIXE de délais,
 * indexé par numéro de tentative (`this.#backoff[index]`) — pas une fonction.
 * Un tableau fixe ne peut PAS produire de gigue par construction : la même
 * tentative produit toujours le même délai, pour toute instance construite
 * avec les mêmes options. Impossible d'ajouter un paramètre `gigue` sans
 * toucher `lien-websocket.ts`.
 *
 * Le seam réellement exposé est `OptionsLienWebSocket.horloge`
 * (`HorlogeTransport.planifier(delaiMs, action)`, `transport/horloge-
 * transport.ts`) — appelé pour CHAQUE planification, backoff de reconnexion
 * ET tic de vivacité. Cette classe l'enveloppe et ajoute une gigue uniforme
 * ±`fractionGigue` au délai demandé, à chaque appel — donc à CHAQUE tentative,
 * pas une fois par process. C'est la seule gigue réellement per-attempt
 * atteignable depuis `composition/` sans réécrire le mécanisme de reprise
 * (interdit par le mandat : « ne réécris pas un second mécanisme de reprise »).
 *
 * Pourquoi c'est suffisant pour le scénario redouté (PC et Pi qui redémarrent
 * ensemble) : un seul PC en v1 (H-56 ne change rien à ça — c'est structurel,
 * pas lié au parallélisme de missions). Le risque de « thundering herd » n'est
 * donc pas entre plusieurs PC, mais entre le rythme de reconnexion du PC et le
 * rythme de redémarrage interne du Pi (services, tunnel Cloudflare) — la gigue
 * casse l'alignement de phase entre les deux sans qu'il y ait besoin de
 * plusieurs clients concurrents pour que ce soit utile.
 */

import type { AnnulerMinuterie, HorlogeTransport } from '../../transport/horloge-transport.ts';

const FRACTION_GIGUE_DEFAUT = 0.2; // ±20 % du délai demandé

export interface OptionsHorlogeAvecGigue {
  readonly horlogeBase?: HorlogeTransport;
  /** Fraction de gigue appliquée à chaque délai, ex. `0.2` = ±20 %. */
  readonly fractionGigue?: number;
  /** Injectable en test — jamais `Math.random()` réel dans un banc déterministe. */
  readonly aleatoire?: () => number;
}

const HORLOGE_REELLE_PAR_DEFAUT: HorlogeTransport = {
  planifier(delaiMs, action) {
    const id = setTimeout(action, delaiMs);
    return () => clearTimeout(id);
  },
};

export function creerHorlogeAvecGigue(options: OptionsHorlogeAvecGigue = {}): HorlogeTransport {
  const base = options.horlogeBase ?? HORLOGE_REELLE_PAR_DEFAUT;
  const fraction = options.fractionGigue ?? FRACTION_GIGUE_DEFAUT;
  const aleatoire = options.aleatoire ?? Math.random;

  return {
    planifier(delaiMs: number, action: () => void): AnnulerMinuterie {
      // Gigue uniforme dans [-fraction, +fraction] du délai demandé, plancher à 0.
      const decalage = delaiMs * fraction * (aleatoire() * 2 - 1);
      const delaiAvecGigue = Math.max(0, Math.round(delaiMs + decalage));
      return base.planifier(delaiAvecGigue, action);
    },
  };
}
