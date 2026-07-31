/**
 * Responsabilité : rapatrier périodiquement, du PC vers le registre du Pi, ce que
 * seul le PC observe — modèle résolu, état SDK, coût, usage de contexte.
 *
 * `☠` Les JAUGES DE QUOTA ne passent plus par ici : elles vivaient dans ce
 * balayage, donc elles mouraient avec le PC. Elles ont leur propre boucle,
 * `balayage-quotas.ts`, qui interroge l'API d'usage en HTTP depuis le Pi.
 *
 * `☠` C'est le Pi qui INTERROGE (D.3.2) : le PC ne pousse jamais rien de sa
 * propre initiative. Un balayage périodique est donc la seule forme possible ;
 * il tolère par construction un PC éteint ou un relevé manqué.
 *
 * `☠` Les valeurs écrites sont ABSOLUES, jamais des deltas. `ajouterCout` étant
 * cumulatif côté registre, on n'écrit que l'ÉCART avec ce qui est déjà connu :
 * réappliquer un total à chaque passage multiplierait le coût affiché à chaque
 * tour de balayage.
 */

import { ETATS_HARNESS_ACTIFS, type Registre } from '../../control-plane/registre/index.ts';
import { detecterFinDeTour } from '../../control-plane/notifications/index.ts';
import type { TelemetrieWorker } from '../../superviseur/index.ts';
import { compositionLogger } from '../logger.ts';

const log = compositionLogger.child({ composant: 'balayage-telemetrie' });

/** Assez fréquent pour que l'écran vive, assez rare pour ne rien saturer. */
export const PERIODE_BALAYAGE_MS = 5_000;

export interface SourceTelemetrie {
  telemetrie(): Promise<readonly TelemetrieWorker[]>;
}

export interface OptionsBalayage {
  readonly registre: Registre;
  readonly source: SourceTelemetrie;
  readonly periodeMs?: number;
  /**
   * Réconciliation à déclencher quand un worker MORT est observé sur une mission
   * que le registre croit active.
   *
   * `☠` Sans ce câblage, la mort d'un worker en cours de route n'est jamais vue :
   * `reconcilier()` ne tourne qu'au démarrage du Pi et à la reconnexion du PC.
   * Une équipe morte restait donc `en_cours` indéfiniment — l'orchestrateur lui
   * envoyait des messages qui repartaient en « processus mort », et l'opérateur
   * lisait « running » sur une équipe qui n'existait plus (constaté le 23/07).
   *
   * On DÉLÈGUE à `reconcilier()` plutôt que de marquer nous-mêmes : la décision
   * « fantôme » a des conséquences (libération de worktree, état terminal) et ne
   * doit exister qu'à un seul endroit.
   */
  readonly reconcilier?: () => Promise<unknown>;
  /**
   * Notifie une fin d'équipe (migration 14). Absent ⇒ le balayage garde son
   * comportement d'avant : rien ne remonte, personne n'est prévenu.
   *
   * `☠` Jamais attendu dans la boucle de relevé : notifier peut réveiller une
   * session SDK, c'est-à-dire des secondes. Bloquer le balayage là-dessus
   * retarderait l'état de TOUT le parc pour une seule équipe.
   */
  readonly signalerFinEquipe?: (missionId: string) => Promise<unknown>;
}

/** Ce qu'un relevé apprend au Pi, au-delà de ce qu'il vient d'écrire. */
interface ResultatReleve {
  /** Worker mort observé sur une mission encore tenue pour active. */
  readonly mortEnCoursDeRoute: boolean;
  /** L'équipe vient de rendre sa réponse (`running → idle`). */
  readonly finDeTour: boolean;
}

export interface BalayageTelemetrie {
  arreter(): void;
  /** Exposé pour être déclenché à la demande (tests, banc réel). */
  passer(): Promise<void>;
}

/**
 * Marque le compte d'une mission comme saturé. `☠` C'est ce qui rend la rotation
 * possible : `listerDisponibles()` exclut les comptes `rejected`, donc le
 * prochain dispatch part sur un autre compte. Sans ce relevé, aucun compte n'est
 * jamais marqué et le harness réessaie indéfiniment sur celui qui refuse — c'est
 * ce qui a laissé une équipe « en cours » sans une seule réponse (23/07).
 */
function marquerCompteSature(registre: Registre, compteId: string, motif: string | null): void {
  const dejaRejete = registre.comptes.listerQuotas(compteId).some((q) => q.statut === 'rejected');
  if (dejaRejete) return;
  registre.comptes.releverQuota({
    compteId,
    typeFenetre: 'spend_limit',
    statut: 'rejected',
    seuilDepasse: motif ?? 'limite annoncée par le CLI',
  });
  log.warn({ compteId, motif }, 'compte saturé — écarté des prochains dispatchs (rotation H-53)');
}

/**
 * Applique un relevé à une mission. Ne lève jamais : un mauvais relevé n'arrête
 * pas les autres. Rend `true` si un worker MORT a été vu sur une mission encore
 * tenue pour active — l'appelant en déduit qu'une réconciliation s'impose.
 */
function appliquer(registre: Registre, t: TelemetrieWorker): ResultatReleve {
  const mission = registre.missions.lire(t.missionId);
  // Mission inconnue du Pi : la réconciliation s'en charge, pas nous.
  if (mission === null) return { mortEnCoursDeRoute: false, finDeTour: false };

  // `☠` Relevé AVANT toute écriture : les valeurs d'un worker mort restent
  // celles de son dernier instant, elles ne mentent pas — mais son état, lui,
  // ne doit plus être présenté comme vivant.
  const mortEnCoursDeRoute = !t.vivant && ETATS_HARNESS_ACTIFS.includes(mission.etatHarness);

  if (t.quotaSature) marquerCompteSature(registre, mission.compteId, t.motifQuota);

  // `☠` Ce que l'équipe PRODUIT entre au fil. Le relevé est drainant côté PC :
  // ces entrées ne repasseront pas. Les ignorer, comme c'était le cas jusqu'au
  // 23/07, laissait l'opérateur avec « les états et compteurs » et rien d'autre.
  for (const a of t.activitesEnAttente) {
    registre.missions.ajouterActivite(t.missionId, a.texte, a.survenuA, a.type, a.outil ?? null);
  }

  // `☠` Écrit à CHAQUE passage, même identique : `poserSousAgents` remplace,
  // et le statut d'un agent (actif ⟶ terminé) se déduit du temps qui passe côté
  // PC — ne rien écrire quand la liste « n'a pas changé » figerait ce statut.
  registre.missions.poserSousAgents(t.missionId, t.sousAgents);
  // Le fil de CHAQUE sous-agent, sans quoi cliquer dessus rendait « Sous-agent
  // introuvable » : la vue n'avait que sa dernière action.
  for (const sa of t.sousAgents) {
    registre.missions.poserActivitesSousAgent(t.missionId, sa.agentId, sa.activites);
  }

  if (t.modeleResolu !== null && mission.modeleResolu !== t.modeleResolu) {
    registre.missions.definirModeleResolu(t.missionId, t.modeleResolu);
  }
  // `☠` La transition est lue AVANT l'écriture : après, le « précédent » est
  // perdu et `running → idle` devient indistinguable d'un `idle` stable. C'est
  // le seul instant du harness où la fin d'un travail est observable.
  const finDeTour = detecterFinDeTour(mission.etatSdk, t.etatSdk);
  if (t.etatSdk !== null && mission.etatSdk !== t.etatSdk) {
    registre.etats.appliquerEtatSdk(t.missionId, t.etatSdk);
  }
  // Écart seulement : `ajouterCout` accumule côté registre.
  const ecart = t.coutUsd - mission.budgetConsommeUsd;
  if (ecart > 0) registre.missions.ajouterCout(t.missionId, ecart);

  if (t.contexteTokensUtilises !== null && mission.contexteTokensUtilises !== t.contexteTokensUtilises) {
    registre.missions.definirUsageContexte(
      t.missionId,
      t.contexteTokensUtilises,
      t.contexteTokensMax,
      t.contexteVentilation,
    );
  }
  return { mortEnCoursDeRoute, finDeTour };
}

/**
 * Lance la notification sans l'attendre, et sans jamais laisser une promesse
 * flotter en silence : l'échec est journalisé ici. `☠` `void` explicite plutôt
 * qu'un `await` — le balayage doit rendre la main en millisecondes, alors qu'une
 * remise peut démarrer une session SDK.
 */
function notifierFinEquipe(options: OptionsBalayage, missionId: string): void {
  const signaler = options.signalerFinEquipe;
  if (signaler === undefined) return;
  void signaler(missionId).catch((erreur: unknown) => {
    log.error({ err: erreur, missionId }, 'notification de fin d’équipe en échec — le balayage continue');
  });
}

export function demarrerBalayageTelemetrie(options: OptionsBalayage): BalayageTelemetrie {
  const periode = options.periodeMs ?? PERIODE_BALAYAGE_MS;

  const passer = async (): Promise<void> => {
    try {
      const releves = await options.source.telemetrie();
      let reconciliationRequise = false;
      for (const t of releves) {
        try {
          const resultat = appliquer(options.registre, t);
          if (resultat.mortEnCoursDeRoute) reconciliationRequise = true;
          if (resultat.finDeTour) notifierFinEquipe(options, t.missionId);
        } catch (erreur) {
          log.error({ err: erreur, missionId: t.missionId }, 'relevé de télémétrie inapplicable — les autres sont traités');
        }
      }
      // `☠` UNE seule réconciliation par passe, quel que soit le nombre de morts
      // observés : elle balaie tout le parc, l'appeler par mission ferait N
      // passes redondantes à chaque tour de balayage.
      if (reconciliationRequise && options.reconcilier !== undefined) {
        log.warn({}, 'worker mort observé sur une mission active — réconciliation déclenchée');
        try {
          await options.reconcilier();
        } catch (erreur) {
          log.error({ err: erreur }, 'réconciliation en échec — le balayage continue');
        }
      }
    } catch (erreur) {
      // `☠` PC éteint = régime nominal (H-75), jamais une alarme. On garde les
      // dernières valeurs connues plutôt que de les remettre à zéro.
      log.debug({ err: erreur }, 'télémétrie indisponible — dernières valeurs conservées');
    }
  };

  const minuterie = setInterval(() => void passer(), periode);
  // Ne retient pas le process en vie : le lien et l'API font ça (Bun/Node).
  if (typeof minuterie.unref === 'function') minuterie.unref();

  return {
    arreter: (): void => clearInterval(minuterie),
    passer,
  };
}
