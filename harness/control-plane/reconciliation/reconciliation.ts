/**
 * Responsabilité : réconciliation registre (Pi) ↔ PC — E.1.4, A.4.2, D.2.4 (mission M-30).
 *
 * Trois cas de E.1.4, traités par une seule règle mécanique : l'état harness d'une mission
 * suit le fait « vivant » rapporté par le PC (B.1.4). Rien ne dépend d'une conviction du Pi
 * qui contredirait ce fait — c'est ce qui garantit (c) « le PC gagne » structurellement,
 * pas par convention documentée.
 *
 *  - Fantôme   : mission active au registre, absente (ou morte) sur le PC ⇒ `terminee`.
 *  - Orphelin  : worker vivant sur le PC, sans mission active au registre ⇒ adopté (si un
 *    historique existe pour cette session) ou tué (sinon). `☠` Jamais ignoré en production
 *    (acceptation b) — aucun interrupteur ne permet de l'ignorer, même en test.
 *  - Divergence : mission `attente_machine` / `planifiee` alors que le PC rapporte un worker
 *    vivant ⇒ corrigée vers `en_cours`. `en_pause` n'est PAS une divergence (H-57 : la pause
 *    garde la session vivante par conception).
 *
 * `☠ CASSE` (panne #3, acceptation d) — `reinitialiser()` est appelé pour TOUTE mission
 * confirmée vivante à l'issue de cette passe (matched-active et orphelin adopté), sur les
 * déclencheurs `demarrage`/`reconnexion`. Sans cet appel, les demandes de permission de la
 * coupure ne redeviennent jamais éligibles à la redélivrance côté bus de permissions —
 * l'équipe reste bloquée en paraissant saine. Voir `tenterReinitialiser`.
 */

import { ETATS_HARNESS_ACTIFS, ETATS_HARNESS_TERMINAUX, type Registre } from '../registre/index.ts';
import { detecterRaisonCoupure, RAISON_CLOTURE_SANS_RAPPORT } from '../cloture/index.ts';
import { reconciliationLogger as logger } from './logger.ts';
import type {
  DeclencheurReconciliation,
  DependancesReconciliation,
  DescripteurWorkerPc,
  RapportReconciliation,
} from './types.ts';

/** Options auxiliaires purement de test — voir `DependancesReconciliation`. */
interface JournalPannesOptionnel {
  enregistrer(type: string, details?: Readonly<Record<string, unknown>>): void;
}

export interface OptionsReconciliation {
  /** Optionnel : le harnais de pannes n'existe qu'en test, jamais en production. */
  readonly journal?: JournalPannesOptionnel;
}

class Compteurs {
  readonly fantomes: string[] = [];
  readonly orphelinsAdoptes: string[] = [];
  readonly orphelinsTues: string[] = [];
  readonly orphelinsIgnores: string[] = [];
  readonly divergencesCorrigees: string[] = [];
  readonly reinitialisationsReussies: string[] = [];
  readonly reinitialisationsEchouees: string[] = [];
  readonly permissionsOrphelines: string[] = [];
  readonly horsPerimetre: string[] = [];

  figer(): RapportReconciliation {
    return {
      fantomes: this.fantomes,
      orphelinsAdoptes: this.orphelinsAdoptes,
      orphelinsTues: this.orphelinsTues,
      orphelinsIgnores: this.orphelinsIgnores,
      divergencesCorrigees: this.divergencesCorrigees,
      reinitialisationsReussies: this.reinitialisationsReussies,
      reinitialisationsEchouees: this.reinitialisationsEchouees,
      permissionsOrphelines: this.permissionsOrphelines,
      horsPerimetre: this.horsPerimetre,
    };
  }
}

/**
 * Point d'entrée unique. Déclencheurs (E.1.4) : `demarrage` du Pi, `reconnexion` après
 * coupure, ou `periodique`. Le rattachement complet (epoch + `reinitialize()`) n'a de sens
 * qu'aux deux premiers — un balayage périodique ne fait que détecter la dérive sans rejouer
 * le rituel de rattachement à chaque tic.
 */
export async function reconcilier(
  registre: Registre,
  deps: DependancesReconciliation,
  declencheur: DeclencheurReconciliation,
  options: OptionsReconciliation = {},
): Promise<RapportReconciliation> {
  const { journal } = options;
  const compteurs = new Compteurs();

  try {
    if (declencheur === 'demarrage') journal?.enregistrer('pi_redemarre', {});
    journal?.enregistrer('inventaire_demande', { declencheur });

    const inventaire = await deps.inventairePc.inventaire();
    const parSession = new Map(inventaire.map((w) => [w.sessionId, w]));

    await traiterMissionsActives(registre, deps, declencheur, parSession, compteurs, journal);
    await traiterOrphelins(registre, deps, declencheur, inventaire, compteurs, journal);

    const rapport = compteurs.figer();
    if (rapport.horsPerimetre.length > 0) {
      logger.warn(
        { missions: rapport.horsPerimetre },
        'missions actives SANS machine connue — aucune passe ne les réconciliera ; elles occupent leur projet (H-56) jusqu’à un arrêt explicite',
      );
    }
    return rapport;
  } catch (cause) {
    logger.error({ declencheur, err: cause }, 'échec de la réconciliation');
    throw cause;
  }
}

async function traiterMissionsActives(
  registre: Registre,
  deps: DependancesReconciliation,
  declencheur: DeclencheurReconciliation,
  parSession: ReadonlyMap<string, DescripteurWorkerPc>,
  compteurs: Compteurs,
  journal: JournalPannesOptionnel | undefined,
): Promise<void> {
  for (const mission of registre.missions.listerActives()) {
    if (mission.sessionId === null) continue; // pas encore spawnée : rien à réconcilier

    // `☠` PÉRIMÈTRE (migration 22). Cet inventaire ne rapporte que les workers
    // d'UNE machine : juger une mission d'ailleurs sur son silence reviendrait à
    // terminer une équipe en plein travail. Une machine éteinte est nominale
    // (H-75) — pas une preuve de mort.
    if (deps.concerne !== undefined && !deps.concerne(mission)) {
      // Une mission sans machine connue n'est réconciliée par PERSONNE : dit ici
      // plutôt que tu, sinon elle occupe son projet (H-56) sans que rien
      // n'explique pourquoi le dispatch suivant est refusé.
      if (mission.machine === null) compteurs.horsPerimetre.push(mission.id);
      continue;
    }

    const worker = parSession.get(mission.sessionId);

    if (worker === undefined || !worker.vivant) {
      // Fantôme (E.1.4) : le registre le croit actif, le PC ne le voit pas.
      //
      // `☠` CHANTIER 2 (21/08) : `terminee` est le cas NOMINAL (F2.0.1) — une
      // mission dont le dernier acte est un appel d'outil, jamais suivi d'un
      // texte, n'a rendu AUCUN rapport. La marquer `terminee` quand même est
      // exactement le défaut mesuré sur la base réelle : 34 % du parc (133/393),
      // 414 $, toutes lues comme des succès alors que leur dernier acte est une
      // phrase coupée en plein milieu. `echec_definitif` dit la vérité : le
      // harness ne peut pas confirmer que cette mission a abouti — le TRAVAIL
      // sous-jacent peut être bon (souvent commité), seule la CLÔTURE a échoué.
      //
      // `☠` CHANTIER 3 : le texte candidat au rapport peut LUI-MÊME être le
      // message de coupure du SDK (« You've hit your session limit… », mesuré :
      // 60 caractères, injecté comme une activité de type 'texte') — ça n'est pas
      // un rapport, quand bien même il suit le dernier appel d'outil. Un texte
      // reconnu comme coupure ne compte donc jamais comme rapport rendu.
      const dernierTexte = registre.missions.dernierTexte(mission.id)?.texte ?? null;
      const raisonCoupure = detecterRaisonCoupure(dernierTexte);
      const rapportRendu = registre.missions.aRapportFinal(mission.id) && raisonCoupure === null;
      const etatFinal = rapportRendu ? 'terminee' : 'echec_definitif';
      // La cause réelle, quand le dernier texte la porte — jamais
      // `fantome_reconciliation` par défaut, qui ne dit rien (mesuré : 365/393).
      const raisonTerminale = rapportRendu ? 'fantome_reconciliation' : (raisonCoupure ?? RAISON_CLOTURE_SANS_RAPPORT);
      registre.etats.appliquerEtatHarness(mission.id, etatFinal, { raisonTerminale });
      journal?.enregistrer('fantome_marque', {
        missionId: mission.id,
        sessionId: mission.sessionId,
        etatFinal,
        raisonTerminale,
      });
      compteurs.fantomes.push(mission.id);
      if (deps.libererWorktree && mission.worktree) {
        await deps.libererWorktree.liberer(mission.id, mission.worktree);
      }
      continue;
    }

    // Divergence (E.1.4, acceptation c) : le PC confirme vivant, une croyance stagnante du
    // Pi ne doit pas survivre. `en_pause` est intentionnel (H-57) : PAS une divergence.
    if (mission.etatHarness === 'attente_machine' || mission.etatHarness === 'planifiee') {
      registre.etats.appliquerEtatHarness(mission.id, 'en_cours', {
        motif: 'divergence_pc_gagne : worker vivant confirmé par le PC',
      });
      journal?.enregistrer('divergence_pc_gagne', { missionId: mission.id, etatPrecedent: mission.etatHarness });
      compteurs.divergencesCorrigees.push(mission.id);
    }

    if (declencheur !== 'periodique') {
      await tenterReinitialiser(registre, deps, mission.id, mission.sessionId, compteurs, journal);
    }
  }
}

async function traiterOrphelins(
  registre: Registre,
  deps: DependancesReconciliation,
  declencheur: DeclencheurReconciliation,
  inventaire: readonly DescripteurWorkerPc[],
  compteurs: Compteurs,
  journal: JournalPannesOptionnel | undefined,
): Promise<void> {
  for (const worker of inventaire) {
    if (!worker.vivant) continue;
    const missionConnue = registre.missions.lireParSession(worker.sessionId);
    // Déjà une mission active pour cette session exacte : traité par
    // `traiterMissionsActives`, ce n'est pas un orphelin.
    if (missionConnue !== null && ETATS_HARNESS_ACTIFS.includes(missionConnue.etatHarness)) continue;

    // ☠ Aucun `continue` conditionnel ici : tout worker vivant non déjà actif est
    // TUÉ (acceptation b). Un interrupteur capable de le laisser filer serait
    // lui-même la panne #11 — on ne le code donc pas, même pour un test.
    // `☠` UNE DÉCISION TERMINALE NE SE DÉFAIT PAS TOUTE SEULE. « Le PC gagne »
    // (E.1.4) arbitre une DIVERGENCE d'observation, jamais un ordre donné : une
    // mission `annulee`/`terminee`/`echec_definitif` l'est parce que quelqu'un
    // l'a décidé. L'adopter, c'est annuler cet ordre sans que personne l'ait
    // demandé — vécu en prod le 23/07 : l'opérateur arrête une équipe à 18:53:29,
    // la réconciliation la rouvre à 18:55:00 (`orphelin_adopte`), et le projet
    // reste bloqué par une équipe qu'il croyait avoir soldée.
    //
    // Le worker survivant est alors un RÉSIDU : on le tue, comme tout worker
    // vivant sans mission qui le réclame. C'est le même geste que pour un
    // orphelin sans trace, pour la même raison — ne rien laisser tourner qui
    // n'apparaisse nulle part.
    if (missionConnue !== null && ETATS_HARNESS_TERMINAUX.includes(missionConnue.etatHarness)) {
      logger.warn(
        { missionId: missionConnue.id, etat: missionConnue.etatHarness, sessionId: worker.sessionId },
        'worker survivant sur une mission déjà terminée — mis à mort, JAMAIS réadopté (la décision tient)',
      );
      await deps.inventairePc.tuerSansPreavis(worker.sessionId);
      journal?.enregistrer('orphelin_tue', { sessionId: worker.sessionId });
      compteurs.orphelinsTues.push(worker.sessionId);
      continue;
    }

    // Orphelin sans aucune trace : pas de mandat, pas de budget, pas de compte à lui
    // attribuer. `☠` Jamais ignoré (acceptation b) — le seul geste sûr par défaut est de
    // le tuer plutôt que de le laisser consommer des ressources sans apparaître nulle part.
    try {
      await deps.inventairePc.tuerSansPreavis(worker.sessionId);
      journal?.enregistrer('orphelin_tue', { sessionId: worker.sessionId });
      compteurs.orphelinsTues.push(worker.sessionId);
    } catch (cause) {
      logger.error({ sessionId: worker.sessionId, err: cause }, 'échec de la mise à mort d un orphelin');
      throw cause;
    }
  }
}

/**
 * Étape D.2.4, acceptation (d). Consulte la capacité `reinitialize` observée (E.5) avant de
 * tenter l'appel : si elle est connue absente, tenter donnerait une fausse impression de
 * remédiation. Toute demande de permission redevenue éligible est redélivrée via le bus ;
 * en son absence (dépendance non câblée par l'appelant), la perte est journalisée bruyamment
 * plutôt que silencieuse — c'est exactement la panne #3 qu'on cherche à ne pas reproduire.
 */
async function tenterReinitialiser(
  registre: Registre,
  deps: DependancesReconciliation,
  missionId: string,
  sessionId: string,
  compteurs: Compteurs,
  journal: JournalPannesOptionnel | undefined,
): Promise<void> {
  const capacitePresente = registre.capacites.estPresente(missionId, 'reinitialize');
  if (capacitePresente === false) {
    journal?.enregistrer('permission_orpheline', {
      missionId,
      sessionId,
      motif: 'capacite_reinitialize_absente',
    });
    compteurs.reinitialisationsEchouees.push(sessionId);
    return;
  }

  try {
    const resultat = await deps.reinitialisateur.reinitialiser(sessionId);
    journal?.enregistrer('reinitialize_appele', {
      missionId,
      sessionId,
      demandesEnAttente: resultat.demandesEnAttente.length,
    });
    compteurs.reinitialisationsReussies.push(sessionId);
    deps.compteurRelances?.reinitialiser(sessionId);

    for (const demande of resultat.demandesEnAttente) {
      if (deps.busPermissions === undefined) {
        journal?.enregistrer('permission_orpheline', {
          missionId,
          sessionId,
          requestId: demande.requestId,
          motif: 'bus_permissions_non_cable',
        });
        compteurs.permissionsOrphelines.push(demande.requestId);
        continue;
      }
      deps.busPermissions.redelivrer({ requestId: demande.requestId, idWorker: sessionId, outil: demande.outil });
    }
  } catch (cause) {
    logger.error({ missionId, sessionId, err: cause }, 'échec de reinitialize() au rattachement');
    journal?.enregistrer('permission_orpheline', {
      missionId,
      sessionId,
      motif: 'reinitialize_a_echoue',
      cause: cause instanceof Error ? cause.message : String(cause),
    });
    compteurs.reinitialisationsEchouees.push(sessionId);
  }
}
