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
 * `☠ HONNÊTETÉ DES CHAMPS` — `subagents` et `landing` n'ont toujours aucune
 * source réelle côté Pi (observabilité D.1 côté PC ; atterrissage H-70 pas
 * encore réel) : ils restent VIDES, jamais fabriqués. Une donnée inventée qui a
 * l'air vraie coûte bien plus cher qu'un tableau vide.
 *
 * `☠` `feed` en revanche EST désormais alimenté, à partir des transitions d'état
 * et des demandes de permission — deux sources persistées et vérifiables. Le
 * laisser vide « par honnêteté » alors que la matière existait produisait un
 * « 0 évènements » sur des équipes qui travaillaient (23/07) : c'est aussi
 * trompeur qu'une donnée inventée, dans l'autre sens.
 */

import type { EtatHarness, Mission } from '../registre/index.ts';
import { ageLisible } from './duree.ts';
import type { FeedEventApi } from './vue-feed.ts';

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
  readonly inspection: { readonly lastVerdict: null; readonly lastAt: null };
  /** Libellés d'ancienneté — dérivés de la VRAIE date de transition, pas inventés. */
  readonly blockedSince: string | null;
  readonly pausedAgo: string | null;
  readonly idleAgo: string | null;
  readonly doneAgo: string | null;
  readonly freshlyDispatched: boolean;
  readonly ultracode: boolean;
  readonly subagents: readonly never[];
  readonly feed: readonly FeedEventApi[];
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

/**
 * Un seul libellé d'ancienneté est renseigné à la fois : celui qui correspond à
 * l'état courant. `etatHarnessMajA` est la date de la dernière transition —
 * donc, par construction, depuis quand la mission est dans cet état.
 */
function anciennete(etat: EtatMissionApi, majA: number, maintenant: number): Pick<MissionApi, 'blockedSince' | 'pausedAgo' | 'idleAgo' | 'doneAgo'> {
  const age = ageLisible(majA, maintenant);
  return {
    blockedSince: etat === 'requires_action' ? age : null,
    pausedAgo: etat === 'paused' ? age : null,
    idleAgo: etat === 'idle' ? age : null,
    doneAgo: etat === 'terminee' || etat === 'echec' ? age : null,
  };
}

/**
 * `feed` est passé par l'appelant plutôt que construit ici : la liste du parc
 * n'en a pas besoin, et le construire pour chaque mission de la liste ferait N
 * requêtes d'historique pour un écran qui ne les affiche pas.
 */
export function versMissionApi(
  mission: Mission,
  plafondRelances: number,
  maintenant: number = Date.now(),
  feed: readonly FeedEventApi[] = [],
): MissionApi {
  const state = ETATS[mission.etatHarness];
  return {
    ...anciennete(state, mission.etatHarnessMajA, maintenant),
    id: mission.id,
    title: mission.nom,
    project: mission.projet,
    worktree: mission.worktree ?? '',
    branch: mission.branche ?? '',
    account: mission.compteId,
    state,
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
    // Les verdicts du juge H-68 sont rendus côté PC et ne sont pas encore
    // remontés au registre : `null` plutôt qu'un « progrès » réconfortant et faux.
    inspection: { lastVerdict: null, lastAt: null },
    // Transitoires d'interface, sans source côté serveur — jamais devinés.
    freshlyDispatched: false,
    ultracode: false,
    subagents: [],
    feed,
    landing: null,
  };
}
