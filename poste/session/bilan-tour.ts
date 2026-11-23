// Responsabilité : le bilan d'UN tour d'une session SDK — outils, étape, compaction, drapeaux posés par le rythme,
// messages de Chris en vol, interruption — et la suite à en tirer à sa fin, par la politique pure suite-du-tour.ts.
// Remplace le hook Stop que les sessions tmux reçoivent du CLI.
import type { Evenement } from '../../commun/session.ts';
import { deciderSuite, type Suite } from './suite-du-tour.ts';

export interface ContexteFinTour {
  readonly autonomie: boolean;
  readonly aUnObjectif: boolean;
  readonly contexte: number;
  readonly maxTokens: number;
  readonly sousAgentsEnCours: number;
  readonly erreur: boolean;
}

export class BilanTour {
  private outils = 0;
  private etapeTerminee = false;
  private compactionDuTour = false;
  private interrompu = false;
  private objectifAtteint = false;
  private questionPosee = false;
  private compactionDemandee = false;
  private relancesSansProgres = 0;
  private messagesEnVol = 0;

  /** Messages poussés au SDK et pas encore conclus par un `result` : tant qu'il en reste, un tour suit déjà. */
  get enVol(): number {
    return this.messagesEnVol;
  }

  envoye(): void {
    this.messagesEnVol += 1;
  }

  /** Aucun tour n'a suivi : les messages comptés en vol ont été traités ensemble par le tour fini. */
  oublierEnVol(): void {
    this.messagesEnVol = 0;
  }

  /** Chris parle : ses drapeaux et son compte de tours à vide repartent de zéro. */
  messageDeChris(): void {
    this.objectifAtteint = false;
    this.questionPosee = false;
    this.relancesSansProgres = 0;
  }

  reinitialiserRelances(): void {
    this.relancesSansProgres = 0;
  }

  /** Chris a interrompu le tour : il n'est pas relancé. */
  interrompre(): void {
    this.interrompu = true;
  }

  etapeFaite(): void {
    this.etapeTerminee = true;
  }

  marquerObjectif(): void {
    this.objectifAtteint = true;
  }

  marquerQuestion(): void {
    this.questionPosee = true;
  }

  demanderCompaction(): void {
    this.compactionDemandee = true;
  }

  compactionLancee(): void {
    this.compactionDemandee = false;
  }

  /** Ce qui s'est passé dans le tour, avant sa conclusion : outils et sous-agents, compaction. */
  observer(evenements: readonly Evenement[], compaction: boolean): void {
    this.outils += evenements.filter((e) => e.type === 'outil' || e.type === 'sous_agent').length;
    if (compaction) this.compactionDuTour = true;
  }

  /** Fin de tour : décide la suite selon la politique, puis le tour suivant repart à zéro. */
  conclure(c: ContexteFinTour): Suite {
    this.messagesEnVol = Math.max(0, this.messagesEnVol - 1);
    const suite = deciderSuite({
      sortDeCompaction: this.compactionDuTour,
      messagesChrisEnVol: this.messagesEnVol,
      objectifAtteint: this.objectifAtteint,
      questionPosee: this.questionPosee,
      autonomie: c.autonomie && !this.interrompu,
      aUnObjectif: c.aUnObjectif,
      outilsCeTour: this.outils,
      relancesSansProgres: this.relancesSansProgres,
      contexte: c.contexte,
      maxTokens: c.maxTokens,
      etapeTerminee: this.etapeTerminee,
      compactionDemandee: this.compactionDemandee,
      sousAgentsActifs: 0, // le SDK ne patiente pas sur ses sous-agents de fond
      sousAgentsEnCours: c.sousAgentsEnCours,
      erreurTour: c.erreur,
    });
    if (suite.action === 'relancer') this.relancesSansProgres = this.outils === 0 ? this.relancesSansProgres + 1 : 0;
    this.outils = 0;
    this.etapeTerminee = false;
    this.compactionDuTour = false;
    this.interrompu = false;
    return suite;
  }
}
