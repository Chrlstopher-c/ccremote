// Responsabilité : la relecture du transcript dans le fil d'une session — lots fusionnés sans doublon, relecture
// complète demandée au poste quand l'ancre du fil manque, recalage (fil nettoyé, archivage Desktop appliqué une fois).
import type { Logger } from 'pino';
import type { EvenementDate } from '../../commun/api-clients.ts';
import type { Diffusion } from '../clients/diffusion.ts';
import type { LignesTranscript } from '../registre/nettoyage-fil.ts';
import type { Registre } from '../registre/registre.ts';
import type { DesktopDesPostes } from './desktop-postes.ts';
import {
  avancerRelecture,
  cleEvenement,
  type EtatRelecture,
  type EvenementHorodate,
  queueSansAncre,
} from './fusion-historique.ts';

// Événements qui changent l'état d'une session quand ils arrivent en direct (voir `diffuserLot`).
const ETATS_RELUS: ReadonlySet<string> = new Set(['tour_fini', 'erreur']);

export interface DependancesRelectures {
  readonly registre: Registre;
  readonly diffusion: Diffusion;
  readonly journal: Logger;
  readonly desktop: () => DesktopDesPostes; // remplacé à chaud (bin.ts) : lu à chaque usage
  readonly envoyerHistorique: (machine: string, sessionId: string) => void;
  readonly diffuserSession: (sessionId: string) => void;
}

export class RelecturesFil {
  // Session → où en est la relecture de son transcript (voir fusion-historique.ts).
  private readonly relectures = new Map<string, EtatRelecture>();
  // Sessions dont une relecture complète a été demandée au poste (queue sans l'ancre du fil) : une fois par session.
  private readonly relecturesCompletesDemandees = new Set<string>();
  // Relecture complète demandée et pas encore reçue : son premier lot la consomme (fusion chronologique).
  private readonly completesAttendues = new Set<string>();

  constructor(private readonly d: DependancesRelectures) {}

  // Relecture du transcript d'une session découverte, adoptée ou suivie hors de Lanterne : un lot ne s'ajoute au fil
  // que s'il contient sa suite (voir fusion-historique.ts), sans doublon. Une relecture complète demandée par le relais
  // (queue sans l'ancre) comble les trous, chaque événement à sa place chronologique. Une relecture n'est pas une fin de
  // tour observée : une fin de tour ou une erreur relue ne passe pas la session en « terminée » ni non lue (voir
  // `diffuserLot`). Une suite écrite en direct (`direct`) garde son effet.
  historique(
    machine: string,
    sessionId: string,
    replay: string,
    lot: readonly EvenementHorodate[],
    direct: boolean,
  ): void {
    const precedent = this.relectures.get(sessionId);
    const premier = precedent?.replay !== replay;
    const complet = premier ? this.completesAttendues.delete(sessionId) : precedent?.complet === true;
    if (complet) return this.historiqueComplet(sessionId, replay, lot, premier, direct);
    const { etat, ajout } = avancerRelecture(precedent, replay, () => this.ancreDuFil(sessionId), lot);
    this.relectures.set(sessionId, etat);
    if (ajout.length === 0) {
      this.d.journal.debug({ sessionId, lot: lot.length }, 'relecture : rien à ajouter au fil');
      const desaccorde = queueSansAncre(etat.ancre, lot) || !this.d.registre.lotRaccorde(sessionId, lot);
      if (desaccorde && !this.relecturesCompletesDemandees.has(sessionId)) {
        this.relecturesCompletesDemandees.add(sessionId);
        this.completesAttendues.add(sessionId);
        this.d.journal.info({ sessionId }, 'relecture : ancre du fil absente de la queue, relecture complète demandée');
        this.d.envoyerHistorique(machine, sessionId);
      }
      return;
    }
    const fusion = this.d.registre.fusionnerHistorique(sessionId, ajout, { complet: false, premier: false });
    if (etat.fusion && !fusion.reecrit) {
      if (this.diffuserLot(fusion.ajoutes, direct)) this.signalerFilModifie(sessionId);
    } else if (fusion.reecrit || fusion.ajoutes.length > 0) this.signalerFilModifie(sessionId);
    this.d.diffuserSession(sessionId);
    this.d.journal.info(
      { sessionId, ajoutes: fusion.ajoutes.length, reecrit: fusion.reecrit, fusion: etat.fusion },
      'historique relu : suite ajoutée au fil',
    );
  }

  private historiqueComplet(
    sessionId: string,
    replay: string,
    lot: readonly EvenementHorodate[],
    premier: boolean,
    direct: boolean,
  ): void {
    this.relectures.set(sessionId, { replay, ancre: null, fusion: true, complet: true });
    const fusion = this.d.registre.fusionnerHistorique(sessionId, lot, { complet: true, premier });
    const relu = !fusion.reecrit && this.diffuserLot(fusion.ajoutes, direct);
    if (fusion.reecrit || fusion.remplace || relu) this.signalerFilModifie(sessionId);
    this.d.diffuserSession(sessionId);
    this.d.journal.info(
      {
        sessionId,
        lot: lot.length,
        ajoutes: fusion.ajoutes.length,
        reecrit: fusion.reecrit,
        remplace: fusion.remplace,
      },
      'relecture complète : fil comblé',
    );
  }

  // Recalage d'une session par son poste : fil nettoyé, archivage Desktop appliqué (une fois) ; la relecture qui suit
  // est complète.
  recaler(sessionId: string, archiver: boolean, transcript?: LignesTranscript): void {
    const conversation = this.d.registre.session(sessionId)?.claudeSessionId ?? sessionId;
    if (archiver && !this.d.desktop().dejaArchivee(conversation)) {
      this.d.desktop().archivee(conversation);
      this.d.registre.definirArchivee(sessionId, true);
    }
    const retires = this.d.registre.nettoyerFil(sessionId, transcript);
    this.relectures.delete(sessionId);
    this.relecturesCompletesDemandees.add(sessionId);
    this.completesAttendues.add(sessionId);
    this.d.journal.info({ sessionId, retires, archiver }, 'recalage : fil nettoyé, relecture complète attendue');
    if (retires > 0) this.signalerFilModifie(sessionId);
    this.d.diffuserSession(sessionId);
  }

  private ancreDuFil(sessionId: string): string | null {
    const dernier = this.d.registre.derniersEvenements(sessionId, 1)[0];
    return dernier ? cleEvenement(dernier) : null;
  }

  private diffuserFil(evenement: EvenementDate): void {
    this.d.diffusion.diffuser({ type: 'evenement', evenement });
  }

  // Événements relus diffusés un à un, sauf ceux qui changent l'état d'une session (fin de tour, erreur) quand ils ne
  // sont pas une suite en direct : ceux-là ne sont pas diffusés, et rendent `true` pour qu'un signal fasse relire le fil.
  private diffuserLot(lot: readonly EvenementDate[], direct: boolean): boolean {
    let relu = false;
    for (const evenement of lot) {
      if (!direct && ETATS_RELUS.has(evenement.evt.type)) {
        relu = true;
        continue;
      }
      this.diffuserFil(evenement);
    }
    return relu;
  }

  // Le fil a changé sans qu'un événement en queue le montre : le client qui l'affiche le relit (une fois par rafale).
  private signalerFilModifie(sessionId: string): void {
    this.d.diffusion.diffuser({ type: 'fil_modifie', sessionId });
  }
}
