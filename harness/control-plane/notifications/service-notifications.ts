/**
 * Responsabilité : journaliser un fait du parc, puis tenter de le remettre à
 * l'orchestrateur concerné.
 *
 * `☠` DEUX effets, dans cet ordre, et le second n'annule jamais le premier.
 * Écrire d'abord garantit que le fait survit à toute panne de remise ; c'est la
 * différence entre une notification et un message en vol, et c'est ce qui
 * permet le rattrapage au réveil.
 *
 * `☠` Le réveil d'une session éteinte est un CHOIX EXPLICITE, jamais le défaut.
 * Une session orchestrateur consomme du quota en continu ; réveiller à chaque
 * fin d'équipe brûlerait la nuit en frais de portage. Règle appliquée ici :
 *   · session déjà vivante  ⇒ on remet tout de suite (coût marginal nul) ;
 *   · session éteinte       ⇒ on journalise, et `reveiller: true` seul décide.
 * En session de jour, le fil de Chris est chaud : l'orchestrateur réagit sans
 * qu'on ait rien à demander. La nuit, c'est au mandat-cadre de vouloir le
 * réveil — lui seul sait qu'il y a une raison de travailler à 3 h.
 */

import { randomUUID } from 'node:crypto';
import type { Mission, Notification, Registre, TypeNotification } from '../registre/index.ts';
import { redigerPour } from './redaction.ts';
import { notificationsLogger } from './logger.ts';

const log = notificationsLogger.child({ composant: 'service' });

/**
 * Ce que le service a besoin de savoir des conversations, et rien de plus.
 * Implémenté par la composition au-dessus de `GestionnaireConversations` —
 * l'inversion évite que le domaine des notifications importe l'orchestrateur.
 */
export interface PortRemiseOrchestrateur {
  /** Une session tourne-t-elle déjà pour ce fil ? Remettre y est alors gratuit. */
  estActive(conversationId: string): boolean;
  /** Injecte le texte dans le fil. Démarre la session si elle dort. */
  remettre(conversationId: string, texte: string): Promise<void>;
}

export interface OptionsSignalement {
  /** Raison consignée pour un échec. Ignorée pour une fin nominale. */
  readonly raison?: string | null;
  /**
   * Autoriser le démarrage d'une session éteinte pour remettre ce fait.
   * `false` par défaut : voir l'en-tête de ce fichier.
   */
  readonly reveiller?: boolean;
}

export class ServiceNotifications {
  constructor(
    private readonly registre: Registre,
    private readonly remise: PortRemiseOrchestrateur | undefined,
  ) {}

  /**
   * Journalise le fait, puis tente la remise selon la politique de réveil.
   * Ne lève jamais : une notification est un effet secondaire du parc, elle ne
   * doit casser ni un balayage de télémétrie ni un dispatch.
   */
  public async signaler(
    type: TypeNotification,
    mission: Mission,
    options: OptionsSignalement = {},
  ): Promise<Notification | null> {
    let notification: Notification;
    try {
      const texte = redigerPour(type, mission, options.raison ?? null);
      notification = this.registre.notifications.creer({
        id: randomUUID(),
        type,
        missionId: mission.id,
        conversationId: mission.conversationId,
        titre: texte.titre,
        corps: texte.corps,
      });
      log.info({ type, missionId: mission.id, conversationId: mission.conversationId }, 'notification journalisée');
    } catch (erreur) {
      log.error({ err: erreur, type, missionId: mission.id }, 'notification NON journalisée');
      return null;
    }

    await this.#tenterRemise(notification, mission, options);
    return notification;
  }

  /**
   * Journalise un fait SANS MISSION — typiquement un mandat proposé qui attend
   * une autorisation humaine — et ne tente JAMAIS la remise à l'orchestrateur.
   *
   * `☠` Chemin distinct de `signaler()`, volontairement : ce fait est écrit au
   * moment même où l'orchestrateur rédige la proposition. Emprunter le chemin
   * de remise l'informerait, dans son propre tour, de ce qu'il vient d'écrire —
   * du bruit, du quota brûlé, au pire une relance. Chris le voit via `luA` dans
   * l'interface ; `remisA` reste NULL, et c'est la marque correcte : rien n'a
   * jamais été proposé à l'orchestrateur par ce chemin, il n'y a pas d'échec à
   * consigner.
   */
  public journaliserSansRemettre(params: {
    readonly type: TypeNotification;
    readonly conversationId: string | null;
    readonly titre: string;
    readonly corps: string;
  }): Notification | null {
    try {
      const notification = this.registre.notifications.creer({
        id: randomUUID(),
        type: params.type,
        missionId: null,
        conversationId: params.conversationId,
        titre: params.titre,
        corps: params.corps,
      });
      log.info({ type: params.type, conversationId: params.conversationId }, 'notification journalisée sans remise');
      return notification;
    } catch (erreur) {
      log.error({ err: erreur, type: params.type }, 'notification NON journalisée');
      return null;
    }
  }

  /**
   * Rattrapage : remet à ce fil tout ce qu'il n'a pas encore reçu. Appelé quand
   * une session s'ouvre — `☠` ce qui s'est produit pendant qu'elle dormait est
   * précisément ce qu'elle ignore, et personne d'autre ne le lui dira.
   */
  public async remettreEnAttente(conversationId: string): Promise<number> {
    if (this.remise === undefined) return 0;
    const attente = this.registre.notifications.nonRemises(conversationId);
    let remises = 0;
    for (const n of attente) {
      // `☠` Sans mission DÈS L'ORIGINE (`journaliserSansRemettre`) — pas une
      // mission purgée : ce fait n'a jamais été destiné à ce chemin, quel que
      // soit l'état du fil. Le marquer « remis » sans rien avoir transmis
      // romprait la distinction que la base porte déjà entre lu et remis.
      if (n.missionId === null) continue;
      const mission = this.registre.missions.lire(n.missionId);
      if (mission === null) {
        // La mission a disparu (purge, cascade) : le fait n'a plus de sujet.
        // On le marque remis pour ne pas le représenter à chaque réveil.
        this.registre.notifications.marquerRemise(n.id);
        continue;
      }
      const texte = redigerPour(n.type, mission, null, n.creeA);
      try {
        await this.remise.remettre(conversationId, texte.pourOrchestrateur);
        this.registre.notifications.marquerRemise(n.id);
        remises += 1;
      } catch (erreur) {
        const raison = erreur instanceof Error ? erreur.message : String(erreur);
        this.registre.notifications.marquerEchecRemise(n.id, raison);
        log.warn({ err: erreur, notificationId: n.id, conversationId }, 'rattrapage interrompu');
        // `☠` On s'arrête au premier échec : la suite échouerait pareil, et
        // insister sur un fil mort produirait N erreurs pour un seul défaut.
        break;
      }
    }
    if (remises > 0) log.info({ conversationId, remises }, 'notifications rattrapées au réveil');
    return remises;
  }

  async #tenterRemise(
    notification: Notification,
    mission: Mission,
    options: OptionsSignalement,
  ): Promise<void> {
    const conversationId = mission.conversationId;
    if (conversationId === null || this.remise === undefined) return;

    const active = this.remise.estActive(conversationId);
    if (!active && options.reveiller !== true) {
      log.debug({ notificationId: notification.id, conversationId }, 'session endormie — remise différée au réveil');
      return;
    }

    try {
      const texte = redigerPour(notification.type, mission, options.raison ?? null, notification.creeA);
      await this.remise.remettre(conversationId, texte.pourOrchestrateur);
      this.registre.notifications.marquerRemise(notification.id);
    } catch (erreur) {
      const raison = erreur instanceof Error ? erreur.message : String(erreur);
      this.registre.notifications.marquerEchecRemise(notification.id, raison);
      log.warn({ err: erreur, notificationId: notification.id, conversationId }, 'remise échouée — retentée au réveil');
    }
  }
}
