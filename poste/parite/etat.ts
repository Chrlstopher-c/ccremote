// Responsabilité : l'état agrégé d'un transcript de parité — contexte du dernier tour, résultats, tâches en
// arrière-plan, dernières demandes de fusion, outils récents du fil principal. Rempli par `appliquer.ts`.
import type { StatutTacheParite } from '../../commun/parite.ts';

export interface UsageContexte {
  readonly modele: string | null;
  readonly utilises: number;
  readonly sortie: number;
  readonly le: string;
}

export interface ResultatVu {
  readonly origine: 'envoye' | 'cree';
  readonly le: string;
}

export interface TacheVue {
  /** id du tool_use qui l'a lancée (sert aussi de clé aux notifications par tool-use-id). */
  readonly id: string;
  readonly genre: 'agent' | 'commande';
  readonly description: string;
  readonly debutLe: string;
  readonly prompt: string | null;
  statut: StatutTacheParite;
  finLe: string | null;
  modele: string | null;
  /** agentId (agent) ou backgroundTaskId (commande), une fois connu. */
  tacheId: string | null;
  /** Agent relancé par SendMessage après une fin : son ancien méta-fichier « finished » ne vaut plus. */
  reprise?: boolean;
  /** Fichier de sortie d'une commande en arrière-plan. */
  sortie: string | null;
  /** Vrai dès qu'une fin est venue du transcript (notification, attachement, arrêt) : sinon le statut est déduit. */
  notifiee: boolean;
  /** Fin programmée sans notification (durée d'un Monitor), ISO ; null sinon. */
  echeance: string | null;
}

/** Un appel d'outil en attente de son résultat (Agent sans run_in_background, qui peut devenir asynchrone). */
export interface AppelEnAttente {
  readonly nom: string;
  readonly entree: Record<string, unknown>;
  readonly le: string;
}

export interface PrVue {
  readonly numero: number;
  readonly url: string;
  readonly depot: string;
}

export interface EtatTranscript {
  contexte: UsageContexte | null;
  /** Clé = chemin ; l'ordre d'insertion est celui de la dernière occurrence (delete puis set). */
  readonly resultats: Map<string, ResultatVu>;
  readonly taches: Map<string, TacheVue>;
  /** agentId ou backgroundTaskId → id de la tâche. */
  readonly tachesParTacheId: Map<string, string>;
  readonly attentes: Map<string, AppelEnAttente>;
  /** Chemins et dossiers cités par les 80 derniers appels d'outil du fil principal, du plus ancien au plus récent. */
  readonly indices: string[][];
  readonly prs: Map<string, PrVue>;
  dernierePr: PrVue | null;
}

export function etatVide(): EtatTranscript {
  return {
    contexte: null,
    resultats: new Map(),
    taches: new Map(),
    tachesParTacheId: new Map(),
    attentes: new Map(),
    indices: [],
    prs: new Map(),
    dernierePr: null,
  };
}
