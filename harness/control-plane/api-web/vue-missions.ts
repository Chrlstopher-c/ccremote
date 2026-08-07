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
 * `☠ HONNÊTETÉ DES CHAMPS` — `landing` n'a toujours aucune source réelle côté Pi
 * (atterrissage H-70 pas encore réel) : il reste VIDE, jamais fabriqué. Une
 * donnée inventée qui a l'air vraie coûte bien plus cher qu'un tableau vide.
 *
 * `☠` `subagents` EST alimenté depuis le 23/07 — par le TRANSCRIT du PC, jamais
 * par le flux temps réel (mesuré non déterministe, H-72.4 : 0 à 4 lignes sur 5
 * sous-agents lancés). Un agent connu du disque dont aucun texte n'a été relevé
 * sort avec `feedUnavailable: true` et `feed: []`, JAMAIS omis : l'écran doit
 * montrer une équipe de cinq même quand il ne sait dire ce que font les cinq.
 *
 * `☠` `feed` en revanche EST désormais alimenté, à partir des transitions d'état
 * et des demandes de permission — deux sources persistées et vérifiables. Le
 * laisser vide « par honnêteté » alors que la matière existait produisait un
 * « 0 évènements » sur des équipes qui travaillaient (23/07) : c'est aussi
 * trompeur qu'une donnée inventée, dans l'autre sens.
 */

import type { ActiviteSousAgentMission, EtatHarness, Mission, SousAgentMission } from '../registre/index.ts';
import { ageLisible } from './duree.ts';
import type { FeedEventApi } from './vue-feed.ts';
import { versInspectionApi, type InspectionApi } from '../inspection/etat-inspection.ts';

/** États d'affichage du contrat — vocabulaire de l'interface, pas du domaine. */
export type EtatMissionApi = 'requires_action' | 'running' | 'idle' | 'paused' | 'echec' | 'terminee';

/** Forme d'affichage d'un sous-agent — `pi-web/CONTRAT-API-HARNESS.md`. */
export interface SubagentApi {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly status: 'actif' | 'attente' | 'termine';
  readonly action: string;
  readonly feed: readonly FeedEventApi[];
  /** `true` quand l'agent est connu mais qu'aucun détail n'a pu être relevé (H-72.4). */
  readonly feedUnavailable: boolean;
}

export interface MissionApi {
  readonly id: string;
  readonly title: string;
  readonly project: string;
  readonly worktree: string;
  readonly branch: string;
  readonly account: string;
  /** Machine de travail où l'équipe tourne (migration 22). `null` avant la V2. */
  readonly machine: string | null;
  /**
   * État du dépôt au dernier relevé (migration 23). `null` = JAMAIS mesuré, ce
   * qui n'est pas « propre » : l'interface doit pouvoir dire la différence.
   */
  readonly git: {
    readonly uncommitted: number;
    readonly branch: string | null;
    readonly lastCommit: string | null;
    readonly at: number;
  } | null;
  readonly state: EtatMissionApi;
  readonly ctx: number;
  /**
   * Détail de ce que contient `ctx`. `☠` MESURÉ le 23/07 : sur une mission à
   * 10 %, ~24 K sont du socle incompressible (prompt système, outils, CLAUDE.md,
   * skills) présent dès le premier token, et ~79 K du travail réel. Le
   * pourcentage seul ne permet pas de trancher — et c'est sur cette distinction
   * qu'on décide d'un atterrissage.
   */
  readonly ctxDetail: readonly { readonly nom: string; readonly tokens: number; readonly differe: boolean }[];
  /** Tokens bruts, pour lire autre chose qu'un pourcentage arrondi. */
  readonly ctxTokens: { readonly utilises: number | null; readonly max: number | null };
  readonly cost: number;
  readonly team: string;
  readonly model: string;
  readonly epoch: number;
  readonly retries: string;
  readonly sessionId: string | null;
  readonly mandate: { readonly but: string; readonly critere: string };
  /**
   * Dernier verdict d'inspection (H-68) et sa décision. `☠` Longtemps `null` en
   * dur « plutôt qu'un progrès réconfortant et faux » — c'était honnête, mais ça
   * rendait le verdict invisible dès le rafraîchissement suivant. Il est
   * désormais persisté (migration 20) et lu ici.
   */
  readonly inspection: InspectionApi;
  /** Libellés d'ancienneté — dérivés de la VRAIE date de transition, pas inventés. */
  readonly blockedSince: string | null;
  readonly pausedAgo: string | null;
  readonly idleAgo: string | null;
  readonly doneAgo: string | null;
  readonly freshlyDispatched: boolean;
  readonly ultracode: boolean;
  readonly subagents: readonly SubagentApi[];
  readonly feed: readonly FeedEventApi[];
  readonly landing: null;
  /**
   * Le bloc que le lead est en train de frapper — MÊME forme que le `partial`
   * d'une conversation orchestrateur, délibérément : l'écran l'affiche avec le
   * même composant.
   *
   * `☠` `null` sur la LISTE des missions, toujours : ce relevé traverse le lien
   * vers la machine, et le faire pour chaque carte du parc ferait payer un écran
   * de synthèse par toutes les équipes qui tournent. Il n'est renseigné que sur
   * le détail d'UNE mission — celle qui est réellement regardée.
   */
  readonly partial: { readonly type: 'texte' | 'reflexion'; readonly contenu: string } | null;
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
 * État d'affichage réel : croise l'état HARNESS (la mission est-elle ouverte ?)
 * et l'état SDK (le lead travaille-t-il en ce moment ?).
 *
 * `☠` Ce sont deux choses différentes, et les confondre trompe l'opérateur.
 * Constaté le 23/07 : une mission `en_cours` dont le lead avait fini son tour
 * (`etatSdk = idle`) s'affichait « running ». Rien ne tournait, rien ne
 * consommait, et l'écran laissait croire l'inverse — on attend alors un résultat
 * qui ne viendra jamais sans instruction. Une mission ouverte dont le lead se
 * repose est `idle`, pas `running`.
 */
function etatAffiche(mission: Mission): EtatMissionApi {
  const base = ETATS[mission.etatHarness];
  if (base !== 'running') return base;
  return mission.etatSdk === 'idle' ? 'idle' : base;
}

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
function anciennete(
  etat: EtatMissionApi,
  mission: Mission,
  maintenant: number,
): Pick<MissionApi, 'blockedSince' | 'pausedAgo' | 'idleAgo' | 'doneAgo'> {
  // `☠` Quand le repos vient du SDK et non du harness, l'ancienneté pertinente
  // est celle de la transition SDK : `etatHarnessMajA` daterait du dispatch et
  // annoncerait « au repos depuis 12 min » un lead qui vient de finir son tour.
  const repereSdk = etat === 'idle' && mission.etatHarness === 'en_cours' && mission.etatSdkMajA !== null;
  const age = ageLisible(repereSdk ? (mission.etatSdkMajA as number) : mission.etatHarnessMajA, maintenant);
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
/**
 * Traduit un sous-agent du registre vers la forme d'affichage.
 *
 * `☠` `feedUnavailable` dit la VÉRITÉ sur ce qu'on sait : l'agent existe (le
 * disque le prouve), mais rien de lisible n'a encore été relevé de lui. L'écran
 * l'affiche alors sans détail — jamais masqué, jamais rempli d'un texte inventé.
 */
function versSubagentApi(a: SousAgentMission): SubagentApi {
  return {
    id: a.agentId,
    // Le nom parlant est la description du dispatch (« Paragraphe sur la mer ») :
    // c'est ce que l'opérateur a demandé, pas un identifiant hexadécimal.
    name: a.description ?? a.type ?? a.agentId,
    role: a.type ?? 'sous-agent',
    status: a.statut === 'actif' ? 'actif' : 'termine',
    action: a.derniereAction ?? 'aucune action lisible relevée',
    feed: [],
    feedUnavailable: a.derniereAction === null,
  };
}

/**
 * Le détail d'UN sous-agent, avec son fil (H-72.1, « même niveau de détail que
 * le lead »). `☠` `feedUnavailable` reste vrai quand rien n'a pu être relevé :
 * l'agent existe, on le montre, on ne prétend pas savoir ce qu'il fait.
 */
export function versSubagentDetailApi(
  agent: SousAgentMission,
  activites: readonly ActiviteSousAgentMission[],
): SubagentApi {
  return {
    ...versSubagentApi(agent),
    feed: activites.map((a) => ({
      ts: new Date(a.survenuA).toTimeString().slice(0, 8),
      // `☠` L'instant absolu accompagne toujours l'heure murale : sans lui, une
      // durée entre deux évènements est fausse dès que le fil passe minuit.
      at: a.survenuA,
      type: 'activity' as const,
      text: a.texte,
      ...(a.type === 'texte' ? {} : { nature: a.type }),
      ...(a.outil === null ? {} : { tool: a.outil }),
    })),
    feedUnavailable: activites.length === 0,
  };
}

export function versMissionApi(
  mission: Mission,
  plafondRelances: number,
  maintenant: number = Date.now(),
  feed: readonly FeedEventApi[] = [],
  sousAgents: readonly SousAgentMission[] = [],
  partiel: MissionApi['partial'] = null,
): MissionApi {
  const state = etatAffiche(mission);
  return {
    ...anciennete(state, mission, maintenant),
    id: mission.id,
    title: mission.nom,
    project: mission.projet,
    worktree: mission.worktree ?? '',
    branch: mission.branche ?? '',
    account: mission.compteId,
    machine: mission.machine,
    git:
      mission.constatGit === null
        ? null
        : {
            uncommitted: mission.constatGit.fichiersModifies,
            branch: mission.constatGit.branche,
            lastCommit: mission.constatGit.dernierCommit,
            at: mission.constatGit.releveA,
          },
    state,
    ctx: pourcentageContexte(mission),
    ctxDetail: mission.contexteVentilation ?? [],
    ctxTokens: { utilises: mission.contexteTokensUtilises, max: mission.contexteTokensMax },
    cost: mission.budgetConsommeUsd,
    // Effectif RÉEL, compté sur le transcript. « lead seul » n'est plus une
    // valeur par défaut faute de source : c'est désormais une observation.
    team: sousAgents.length === 0 ? 'lead seul' : `lead + ${sousAgents.length} sous-agents`,
    model: mission.modeleResolu ?? mission.modeleDemande ?? '(non résolu)',
    epoch: mission.epoch,
    retries: `${mission.compteurRelances} / ${plafondRelances}`,
    sessionId: mission.sessionId,
    mandate: { but: mission.mandat ?? '', critere: mission.critereArret ?? '' },
    inspection: versInspectionApi(mission.inspection),
    // Transitoires d'interface, sans source côté serveur — jamais devinés.
    freshlyDispatched: false,
    ultracode: false,
    subagents: sousAgents.map(versSubagentApi),
    feed,
    landing: null,
    partial: partiel,
  };
}
