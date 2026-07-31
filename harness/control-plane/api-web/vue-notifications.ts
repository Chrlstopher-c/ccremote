/**
 * Responsabilité : forme des notifications servie à l'interface.
 *
 * `☠` Les deux marqueurs sont exposés SÉPARÉMENT (`read` / `delivered`), et ce
 * n'est pas de la redondance : « Chris a lu » et « l'orchestrateur a reçu » sont
 * deux faits indépendants. La nuit, le second arrive sans le premier ; en
 * session, l'inverse est courant. Les fondre en un seul booléen effacerait
 * précisément ce que Chris regarde pour savoir si son orchestrateur est au
 * courant de ce qu'il vient de lire.
 */

import type { Notification } from '../registre/index.ts';

export interface NotificationApi {
  readonly id: string;
  readonly type: string;
  readonly title: string;
  readonly body: string;
  readonly missionId: string | null;
  /** Fil vers lequel rediriger au clic. `null` ⇒ carte non cliquable. */
  readonly conversationId: string | null;
  readonly createdAt: number;
  readonly read: boolean;
  /** Le fait est entré dans le contexte de l'orchestrateur. */
  readonly delivered: boolean;
  /** Dernière raison d'échec de remise, à afficher telle quelle si présente. */
  readonly deliveryError: string | null;
}

export function versNotificationApi(n: Notification): NotificationApi {
  return {
    id: n.id,
    type: n.type,
    title: n.titre,
    body: n.corps,
    missionId: n.missionId,
    conversationId: n.conversationId,
    createdAt: n.creeA,
    read: n.luA !== null,
    delivered: n.remisA !== null,
    deliveryError: n.echecRemise,
  };
}
