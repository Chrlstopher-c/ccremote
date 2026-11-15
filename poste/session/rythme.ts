// Responsabilité : les trois outils de rythme vus du poste (étape, objectif atteint, question) — l'événement qu'ils
// ajoutent au fil et le texte rendu au modèle. Pur : chaque session applique ensuite ses propres drapeaux
// (tmux ou SDK).
import type { Evenement } from '../../commun/session.ts';
import { deciderCompaction } from './politique-compaction.ts';

export interface ContexteRythme {
  readonly tokens: number;
  readonly max: number;
}

export interface EffetRythme {
  readonly evenement: Evenement;
  readonly reponse: string;
}

/** L'effet d'un appel d'outil de rythme, ou null pour un outil inconnu. */
export function effetRythme(
  outil: string,
  args: Record<string, unknown>,
  contexte: ContexteRythme,
): EffetRythme | null {
  const champ = (k: string): string => String(args[k] ?? '');
  switch (outil) {
    case 'etape_terminee':
      return {
        evenement: { type: 'etape', resume: champ('resume'), suite: champ('suite') },
        reponse: reponseEtape(contexte),
      };
    case 'objectif_atteint':
      return {
        evenement: { type: 'objectif_atteint', bilan: champ('bilan') },
        reponse: 'Chris est notifié. Termine ton tour.',
      };
    case 'poser_question':
      return {
        evenement: { type: 'question', question: champ('question') },
        reponse:
          'Question transmise à Chris. Termine ton tour : sa réponse arrivera comme prochain message.',
      };
    default:
      return null;
  }
}

function reponseEtape(contexte: ContexteRythme): string {
  const k = Math.round(contexte.tokens / 1000);
  if (!deciderCompaction(contexte.tokens, contexte.max, true).agir) {
    return `Étape enregistrée. Contexte léger (${k}k) : pas de compaction, enchaîne directement sur la suite.`;
  }
  return (
    `Étape enregistrée. Contexte lourd (${k}k) : termine ton tour par une phrase de bilan ; le harness compacte ` +
    'puis te relance sur la suite.'
  );
}
