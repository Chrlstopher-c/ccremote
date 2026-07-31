/**
 * Responsabilité : faire tirer les rappels échus, ou les reporter.
 *
 * `☠` Un rappel est la seule chose de ce harness qui consomme du quota sans que
 * personne ne l'ait demandé sur le moment : il réveille une session Opus, tout
 * seul, en boucle, potentiellement pendant des jours. Toute la prudence de ce
 * module vient de là — et notamment le fait qu'un tir puisse être REPORTÉ plutôt
 * qu'exécuté quand le carburant est tendu.
 */

import type { Rappel, Registre } from '../registre/index.ts';
import { peutTirer, REPORT_MS, SEUIL_REPORT_PCT } from './politique-rappels.ts';
import { rappelsLogger } from './logger.ts';

const log = rappelsLogger.child({ composant: 'service' });

/** Injecte la consigne dans le fil. Implémenté par la composition. */
export interface PortReveilFil {
  remettre(conversationId: string, texte: string): Promise<void>;
}

/** État du carburant, tel que le balayage le connaît. */
export interface EtatCarburant {
  /** Utilisation du pire compte disponible, ou `null` si non mesurée. */
  readonly pireUtilisation: number | null;
  readonly aucunCompteDisponible: boolean;
}

/**
 * `☠` Le texte injecté est un PROMPT, pas un libellé — même exigence que les
 * notifications. Il dit d'où il vient, ce qui est demandé, et surtout que ce
 * rappel revient : sans ça, l'orchestrateur traite chaque tir comme une demande
 * neuve et refait le travail depuis zéro au lieu de reprendre où il en était.
 */
export function composerTexteRappel(rappel: Rappel): string {
  const recurrence =
    rappel.periodeMs === null
      ? 'Ce rappel était unique : il ne reviendra pas.'
      : `Ce rappel revient toutes les ${Math.round(rappel.periodeMs / 60_000)} min ` +
        `(tir n°${rappel.declenchements + 1}). Tu peux le mettre en pause, le modifier ou le ` +
        'supprimer avec tes outils de rappel si la consigne n’a plus lieu d’être.';
  return (
    `[RAPPEL PROGRAMMÉ — ${rappel.libelle}]\n\n` +
    `${rappel.consigne}\n\n` +
    'Ce message vient du harness, déclenché par une échéance que TU as posée : ' +
    "Chris ne t'a rien demandé à l'instant. " +
    `${recurrence}\n` +
    'Si tu as déjà traité cette consigne récemment, reprends où tu en étais plutôt que de ' +
    'tout refaire — et si tu n’as rien de neuf à dire, une ligne suffit.'
  );
}

export class ServiceRappels {
  constructor(
    private readonly registre: Registre,
    private readonly reveil: PortReveilFil,
    private readonly carburant: () => EtatCarburant,
  ) {}

  /**
   * Traite tous les rappels échus. Ne lève jamais : un rappel qui échoue ne doit
   * ni bloquer les autres, ni arrêter le balayage.
   */
  public async passer(maintenant: number = Date.now()): Promise<number> {
    const echus = this.registre.rappels.echus(maintenant);
    if (echus.length === 0) return 0;

    const etat = this.carburant();
    const verdict = peutTirer(etat.pireUtilisation, etat.aucunCompteDisponible);
    if (!verdict.tire) {
      // `☠` Reporté, pas perdu et pas retenté en boucle. Sans le report, chaque
      // passage du balayage retrouverait les mêmes rappels échus et produirait
      // une tempête de tentatives sur un parc déjà saturé.
      for (const r of echus) {
        this.registre.rappels.reporter(r.id, maintenant + REPORT_MS, verdict.raison);
      }
      log.warn(
        { rappels: echus.length, raison: verdict.raison, seuilPct: SEUIL_REPORT_PCT },
        'tirs reportés — carburant insuffisant',
      );
      return 0;
    }

    let tires = 0;
    for (const rappel of echus) {
      try {
        await this.reveil.remettre(rappel.conversationId, composerTexteRappel(rappel));
        this.registre.rappels.marquerDeclenche(rappel.id, maintenant);
        tires += 1;
        log.info(
          { rappelId: rappel.id, libelle: rappel.libelle, conversationId: rappel.conversationId },
          'rappel déclenché',
        );
      } catch (erreur) {
        // `☠` Reporté ici AUSSI, et c'est important : un fil mort ou saturé ne
        // doit pas faire réessayer toutes les 30 s. Le compteur de
        // déclenchements n'avance pas — le tir n'a pas eu lieu.
        const raison = erreur instanceof Error ? erreur.message : String(erreur);
        this.registre.rappels.reporter(rappel.id, maintenant + REPORT_MS, raison);
        log.error({ err: erreur, rappelId: rappel.id }, 'tir de rappel en échec — reporté');
      }
    }
    return tires;
  }
}
