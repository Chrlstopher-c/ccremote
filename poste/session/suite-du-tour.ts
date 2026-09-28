// Responsabilité : décider ce qui suit la fin d'un tour — attendre Chris, compacter, relancer l'agent ou s'arrêter.
// Pur : toute la politique d'autonomie de la session tient ici.
import { deciderCompaction } from './politique-compaction.ts';

export const MAX_RELANCES_SANS_PROGRES = 2;

export interface EtatFinDeTour {
  readonly sortDeCompaction: boolean;
  readonly messagesChrisEnVol: number;
  readonly objectifAtteint: boolean;
  readonly questionPosee: boolean;
  readonly autonomie: boolean;
  readonly aUnObjectif: boolean;
  readonly outilsCeTour: number;
  readonly relancesSansProgres: number;
  readonly contexte: number;
  readonly maxTokens: number;
  readonly etapeTerminee: boolean;
  readonly compactionDemandee: boolean;
  readonly sousAgentsActifs: number;
}

export type Suite =
  | { readonly action: 'laisser' } // un message de Chris est déjà en file : c'est lui qui ouvre le tour suivant
  | { readonly action: 'patienter' } // un sous-agent tourne en arrière-plan : sa fin réveillera la session
  | { readonly action: 'compacter'; readonly raison: string }
  | { readonly action: 'relancer'; readonly texte: string; readonly raison: string }
  | { readonly action: 'arreter'; readonly statut: 'terminee' | 'question' | 'attente'; readonly note?: string };

export function deciderSuite(e: EtatFinDeTour): Suite {
  if (e.messagesChrisEnVol > 0) return { action: 'laisser' };
  if (e.objectifAtteint) return { action: 'arreter', statut: 'terminee' };
  if (e.questionPosee) return { action: 'arreter', statut: 'question' };
  if (!e.sortDeCompaction) {
    const compaction = deciderCompaction(e.contexte, e.maxTokens, e.etapeTerminee);
    if (e.compactionDemandee) return { action: 'compacter', raison: 'demandée par Chris' };
    if (compaction.agir)
      return { action: 'compacter', raison: compaction.raison === 'etape' ? 'fin d’étape' : 'seuil de contexte' };
  }
  if (!e.autonomie || !e.aUnObjectif) return { action: 'arreter', statut: 'attente' };
  if (e.sousAgentsActifs > 0 && !e.sortDeCompaction) return { action: 'patienter' };
  return relanceAutonome(e);
}

function relanceAutonome(e: EtatFinDeTour): Suite {
  if (e.sortDeCompaction) {
    return {
      action: 'relancer',
      raison: 'reprise après compaction',
      texte:
        'Session compactée. Reprends l’objectif là où tu en étais (STATE.md / TODO.md font foi), ' +
        'sans refaire le travail livré.',
    };
  }
  const sansProgres = e.outilsCeTour === 0 ? e.relancesSansProgres + 1 : 0;
  if (sansProgres > MAX_RELANCES_SANS_PROGRES) {
    return {
      action: 'arreter',
      statut: 'attente',
      note: `autonomie en pause : ${sansProgres} tours sans aucune action`,
    };
  }
  return {
    action: 'relancer',
    raison: 'objectif non déclaré atteint',
    texte:
      'Continue vers l’objectif. Bloqué par une décision de Chris → poser_question. ' +
      'Fini et vérifié → objectif_atteint.',
  };
}
