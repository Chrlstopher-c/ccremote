// Responsabilité : décider QUAND compacter une session. Règle pure, sans I/O.
// Compacter coûte un rechargement : on ne le fait qu'à une fin d'étape déjà lourde, ou quand le contexte
// devient cher à relire à chaque tour. Jamais « pour rien ».

export interface Seuils {
  readonly etape: number; // à une fin d'étape, compacter au-delà de ce contexte
  readonly dur: number; // en fin de tour, compacter au-delà de ce contexte, étape finie ou non
}

export type DecisionCompaction = { readonly agir: false } | { readonly agir: true; readonly raison: 'etape' | 'seuil' };

export function seuilsPour(maxTokens: number): Seuils {
  return {
    etape: Math.min(120_000, Math.round(maxTokens * 0.4)),
    dur: Math.min(350_000, Math.round(maxTokens * 0.7)),
  };
}

export function deciderCompaction(contexte: number, maxTokens: number, etapeTerminee: boolean): DecisionCompaction {
  const seuils = seuilsPour(maxTokens);
  if (contexte >= seuils.dur) return { agir: true, raison: 'seuil' };
  if (etapeTerminee && contexte >= seuils.etape) return { agir: true, raison: 'etape' };
  return { agir: false };
}

export const CONSIGNE_COMPACTION =
  '/compact Conserve : l’objectif, l’étape en cours et les suivantes, les décisions prises et pourquoi, ' +
  'les fichiers modifiés, les commandes de build/test qui marchent, l’état git, les pièges rencontrés. ' +
  'Jette : les sorties d’outils, les explorations closes, le code déjà écrit (il est sur disque).';
