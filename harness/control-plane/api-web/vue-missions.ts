/**
 * Responsabilité : traduire une `Mission` du registre (vocabulaire du domaine,
 * français, `03-couche-1.md`) vers la forme attendue par l'interface
 * (`pi-web/CONTRAT-API-HARNESS.md`, anglais, orientée affichage).
 *
 * `☠` Cette traduction est délibérément un fichier à part, et non un `SELECT`
 * qui produirait directement la forme de l'interface : le registre est
 * l'autorité du domaine et ne doit rien savoir de l'UI. Le jour où l'interface
 * change de vocabulaire, ce fichier change, le registre non.
 *
 * `☠ HONNÊTETÉ DES CHAMPS` — le contrat décrit des champs dont AUCUNE source
 * réelle n'existe encore côté Pi : `subagents` et `feed` vivent sur le PC
 * (observabilité, D.1), `landing` dépend d'un comportement d'atterrissage qui
 * n'est pas encore réel (H-70). Ils sont retournés VIDES, jamais fabriqués.
 * Une donnée inventée qui a l'air vraie coûte bien plus cher qu'un tableau
 * vide : elle se propage dans les décisions avant qu'on découvre qu'elle ment.
 */

import type { EtatHarness, Mission } from '../registre/index.ts';

/** États d'affichage du contrat — vocabulaire de l'interface, pas du domaine. */
export type EtatMissionApi = 'requires_action' | 'running' | 'idle' | 'paused' | 'echec' | 'terminee';

export interface MissionApi {
  readonly id: string;
  readonly title: string;
  readonly project: string;
  readonly worktree: string;
  readonly branch: string;
  readonly account: string;
  readonly state: EtatMissionApi;
  readonly ctx: number;
  readonly cost: number;
  readonly team: string;
  readonly model: string;
  readonly epoch: number;
  readonly retries: string;
  readonly sessionId: string | null;
  readonly mandate: { readonly but: string; readonly critere: string };
  readonly subagents: readonly never[];
  readonly feed: readonly never[];
  readonly landing: null;
}

/**
 * `attente_machine` ⇒ `requires_action` : c'est l'état où la mission attend un
 * geste humain, et le seul que l'interface doit faire remonter en tête.
 * `planifiee` ⇒ `idle` : rien ne tourne encore, l'afficher « running » ferait
 * croire à une consommation qui n'a pas lieu.
 */
const ETATS: Readonly<Record<EtatHarness, EtatMissionApi>> = {
  planifiee: 'idle',
  en_cours: 'running',
  en_pause: 'paused',
  attente_machine: 'requires_action',
  echec_definitif: 'echec',
  terminee: 'terminee',
  annulee: 'terminee',
};

/**
 * Pourcentage de contexte consommé. `☠` MESURÉ, jamais estimé (H-54) : si le
 * registre n'a pas encore reçu de relevé, on retourne 0 plutôt qu'une
 * extrapolation — une jauge fausse est pire qu'une jauge à zéro, parce qu'on
 * prend des décisions d'atterrissage dessus.
 */
function pourcentageContexte(mission: Mission): number {
  const { contexteTokensUtilises: utilises, contexteTokensMax: max } = mission;
  if (utilises === null || max === null || max <= 0) return 0;
  return Math.min(100, Math.round((utilises / max) * 100));
}

export function versMissionApi(mission: Mission, plafondRelances: number): MissionApi {
  return {
    id: mission.id,
    title: mission.nom,
    project: mission.projet,
    worktree: mission.worktree ?? '',
    branch: mission.branche ?? '',
    account: mission.compteId,
    state: ETATS[mission.etatHarness],
    ctx: pourcentageContexte(mission),
    cost: mission.budgetConsommeUsd,
    // Aucune source réelle côté Pi tant que l'observabilité des sous-agents
    // n'est pas rapatriée du PC — voir l'en-tête. Libellé neutre, jamais un
    // effectif inventé.
    team: 'lead',
    model: mission.modeleResolu ?? mission.modeleDemande ?? '(non résolu)',
    epoch: mission.epoch,
    retries: `${mission.compteurRelances} / ${plafondRelances}`,
    sessionId: mission.sessionId,
    mandate: { but: mission.mandat ?? '', critere: mission.critereArret ?? '' },
    subagents: [],
    feed: [],
    landing: null,
  };
}
