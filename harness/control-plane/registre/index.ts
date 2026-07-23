/**
 * Interface publique du module « registre » (branche E.1, mission M-03).
 * Aucun autre module ne doit importer les fichiers internes de ce dossier.
 *
 * Périmètre : schéma et accès. La réconciliation (E.1.4, M-30) et l'adaptateur
 * SessionStore (E.3, M-31) sont hors de ce module.
 */

import type { Database } from 'bun:sqlite';
import { fermerBase, ouvrirBase, type OptionsConnexion } from './connexion.ts';
import { DepotCapacites } from './capacites.ts';
import { DepotComptes } from './comptes.ts';
import { DepotConversations } from './conversations.ts';
import { DepotPropositions } from './propositions.ts';
import { DepotEtats } from './etats.ts';
import { DepotLots } from './lots.ts';
import { DepotMissions } from './missions.ts';
import { executer } from './journal.ts';
import { versionSchema } from './migrations.ts';
import { ETATS_HARNESS_TERMINAUX, type AvancementLot } from './types.ts';

export type {
  AvancementLot,
  Capacite,
  Compte,
  Conversation,
  CreationCompte,
  CreationLot,
  CreationMission,
  EtatHarness,
  EtatSdk,
  EvenementConversation,
  Lot,
  Mission,
  OrigineTransition,
  Proposition,
  StatutProposition,
  Quota,
  RelevéQuota,
  StatutConversation,
  StatutQuota,
  Transition,
  TypeEvenementConversation,
  TypeFenetreQuota,
} from './types.ts';
export { DepotConversations } from './conversations.ts';
export { DepotPropositions } from './propositions.ts';
export type { CreationProposition } from './propositions.ts';
export type { AjoutEvenement, CreationConversation } from './conversations.ts';
export { ETATS_HARNESS_ACTIFS, ETATS_HARNESS_TERMINAUX } from './types.ts';
export { CAPACITES_SURVEILLEES } from './capacites.ts';
export { ErreurRegistre } from './journal.ts';
export { VERSION_SCHEMA_CIBLE } from './migrations.ts';
export type { OptionsConnexion } from './connexion.ts';
export type { CompteurEtat } from './missions.ts';
export type { OptionsTransitionHarness } from './etats.ts';

/**
 * Point d'entrée unique du registre. Un seul écrivain par processus (H-21) ;
 * ouvrir en `lectureSeule` pour les consommateurs concurrents.
 */
export class Registre {
  public readonly lots: DepotLots;
  public readonly missions: DepotMissions;
  public readonly etats: DepotEtats;
  public readonly comptes: DepotComptes;
  public readonly capacites: DepotCapacites;
  public readonly conversations: DepotConversations;
  public readonly propositions: DepotPropositions;

  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
    this.lots = new DepotLots(db);
    this.missions = new DepotMissions(db);
    this.etats = new DepotEtats(db);
    this.comptes = new DepotComptes(db);
    this.capacites = new DepotCapacites(db);
    this.conversations = new DepotConversations(db);
    this.propositions = new DepotPropositions(db);
  }

  public get version(): number {
    return versionSchema(this.db);
  }

  /**
   * « Où en est ce que j'ai demandé hier soir ? » — l'intention utilisateur,
   * pas la liste des missions qui tournent.
   */
  public avancementLot(lotId: string): AvancementLot | null {
    return executer(
      'registre.avancementLot',
      () => {
        const lot = this.lots.lire(lotId);
        if (!lot) return null;
        const missions = this.missions.listerParLot(lotId);
        const terminees = missions.filter((m) => m.etatHarness === 'terminee').length;
        const echecs = missions.filter((m) => m.etatHarness === 'echec_definitif').length;
        const actives = missions.filter(
          (m) => !ETATS_HARNESS_TERMINAUX.includes(m.etatHarness),
        ).length;
        return { lot, missions, total: missions.length, actives, terminees, echecs };
      },
      { lotId },
    );
  }

  public fermer(): void {
    fermerBase(this.db);
  }
}

/** Ouvre (et migre si nécessaire) le registre. */
export function ouvrirRegistre(options: OptionsConnexion): Registre {
  return new Registre(ouvrirBase(options));
}
