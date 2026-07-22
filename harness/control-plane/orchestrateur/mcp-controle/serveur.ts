/**
 * Responsabilité : assembler le serveur MCP de contrôle (A.2, mission M-40) —
 * en-process (`createSdkMcpServer`), dans le processus de l'orchestrateur. Ni
 * réseau, ni sous-processus (A.2, préambule).
 *
 * Chaque `handler` ci-dessous :
 *  - ne fait AUCUNE logique métier — il ne fait que convertir un `ContratRetour`
 *    (déjà produit par `outils-*.ts`) en `CallToolResult` ;
 *  - est enveloppé dans un `try/catch` supplémentaire, défense en profondeur :
 *    même si un bug futur faisait fuir une exception d'un `outils-*.ts` (qui ne
 *    devrait jamais arriver, chacun a son propre filet), elle s'arrêterait ici,
 *    jamais vers le modèle (A.2.4, acceptation (d)).
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { createSdkMcpServer, tool, type McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { Registre } from '../../registre/index.ts';
import { echecInattendu } from './contrat.ts';
import {
  etatEquipe,
  historiqueEquipe,
  listerEquipes,
  listerProjets,
  permissionsEnAttente,
} from './outils-inspection.ts';
import {
  arreterEquipe,
  envoyerAEquipe,
  interrompreEquipe,
  proposerCreationEquipe,
  relancerEquipe,
} from './outils-cycle-vie.ts';
import { definirBudget, repondrePermission } from './outils-arbitrage.ts';
import { mcpControleLogger as journal } from './logger.ts';
import type {
  ArbitreEscalade,
  ArreteurMission,
  ContratRetour,
  DefinisseurBudget,
  LecteurEscalades,
  RelanceurMission,
  RepertoireCibles,
} from './types.ts';

export interface DependancesServeurControle {
  readonly registre: Registre;
  readonly repertoireProjets: string;
  readonly escalades: LecteurEscalades & ArbitreEscalade;
  readonly cibles: RepertoireCibles;
  readonly arreteur: ArreteurMission;
  readonly relanceur: RelanceurMission;
  readonly budget: DefinisseurBudget;
}

/** Convertit le contrat uniforme (A.2.3) en `CallToolResult` MCP. Jamais `isError`. */
function rendre(retour: ContratRetour): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(retour) }] };
}

/**
 * Filet ultime (A.2.4) : encapsule tout handler, synchrone ou async, sans jamais
 * relancer. Exporté pour être testable directement (défense en profondeur —
 * chaque `outils-*.ts` a déjà son propre filet, celui-ci n'est censé jouer que
 * si un bug futur en perce un).
 */
export async function protege(nom: string, action: () => Promise<ContratRetour> | ContratRetour): Promise<CallToolResult> {
  try {
    return rendre(await action());
  } catch (erreur) {
    journal.error({ err: erreur, outil: nom }, 'un handler a laissé fuir une exception — filet de dernier recours');
    return rendre(echecInattendu(nom, erreur));
  }
}

function outilsInspection(deps: DependancesServeurControle) {
  return [
    tool('lister_equipes', 'Liste les équipes actives et leurs états.', {}, async () =>
      protege('lister_equipes', () => listerEquipes(deps.registre)),
    { annotations: { readOnlyHint: true } }),
    tool(
      'etat_equipe',
      "Détail d'une équipe : tâche, coût, contexte, capacités manquantes.",
      { missionId: z.string() },
      async ({ missionId }) => protege('etat_equipe', () => etatEquipe(deps.registre, missionId)),
      { annotations: { readOnlyHint: true } },
    ),
    tool('lister_projets', 'Projets connus et leur worktree.', {}, async () =>
      protege('lister_projets', () => listerProjets(deps.repertoireProjets)),
    { annotations: { readOnlyHint: true } }),
    tool(
      'historique_equipe',
      "Dernières transitions d'état d'une équipe, résumées.",
      { missionId: z.string(), limite: z.number().int().positive().optional() },
      async ({ missionId, limite }) =>
        protege('historique_equipe', () => historiqueEquipe(deps.registre, missionId, limite)),
      { annotations: { readOnlyHint: true } },
    ),
    tool('permissions_en_attente', 'Ce qui bloque en escalade, et depuis quand.', {}, async () =>
      protege('permissions_en_attente', () => permissionsEnAttente(deps.escalades)),
    { annotations: { readOnlyHint: true } }),
  ];
}

function outilsCycleVie(deps: DependancesServeurControle) {
  return [
    tool(
      'creer_equipe',
      "Propose une nouvelle équipe sur un projet, avec un mandat. NE CRÉE RIEN : " +
        "H-61 — la création exige une autorisation humaine explicite, présentée par l'UI.",
      {
        projet: z.string(),
        objectif: z.string(),
        critereArret: z.string().nullable(),
        perimetre: z.string(),
      },
      async ({ projet, objectif, critereArret, perimetre }) =>
        protege('creer_equipe', () => proposerCreationEquipe(projet, objectif, critereArret, perimetre)),
    ),
    tool(
      'envoyer_a_equipe',
      "Transmet une instruction à une équipe. Mise en file (H-67) — n'interrompt jamais le tour en cours.",
      { missionId: z.string(), message: z.string() },
      async ({ missionId, message }) =>
        protege('envoyer_a_equipe', () => envoyerAEquipe(deps.cibles, missionId, message)),
    ),
    tool(
      'interrompre_equipe',
      'Stoppe le tour en cours de cette équipe.',
      { missionId: z.string() },
      async ({ missionId }) => protege('interrompre_equipe', () => interrompreEquipe(deps.cibles, missionId)),
    ),
    tool(
      'arreter_equipe',
      'Fin de vie de cette équipe — libération du worktree.',
      { missionId: z.string() },
      async ({ missionId }) => protege('arreter_equipe', () => arreterEquipe(deps.arreteur, deps.registre, missionId)),
    ),
    tool(
      'relancer_equipe',
      "Reprend une équipe après un crash, avec resume (contexte préservé).",
      { missionId: z.string() },
      async ({ missionId }) => protege('relancer_equipe', () => relancerEquipe(deps.relanceur, deps.registre, missionId)),
    ),
  ];
}

function outilsArbitrage(deps: DependancesServeurControle) {
  return [
    tool(
      'repondre_permission',
      "Verdict humain sur une demande ESCALADÉE (H-47). N'arbitre jamais le régime nominal " +
        "(permissionMode: 'auto', H-40) — seulement ce que le classifieur a refusé.",
      {
        requestId: z.string(),
        behavior: z.enum(['allow', 'deny']),
        message: z.string().optional(),
      },
      async ({ requestId, behavior, message }) =>
        protege('repondre_permission', () =>
          repondrePermission(
            deps.escalades,
            requestId,
            behavior === 'allow' ? { behavior: 'allow' } : { behavior: 'deny', message: message ?? 'refusé' },
          ),
        ),
    ),
    tool(
      'definir_budget',
      "Plafond `maxBudgetUsd` d'une équipe — filet de dernier recours (H-68), pas l'anti-boucle.",
      { missionId: z.string(), maxUsd: z.number() },
      async ({ missionId, maxUsd }) =>
        protege('definir_budget', () => definirBudget(deps.budget, missionId, maxUsd)),
    ),
    // ☠ `arret_urgence` est DÉLIBÉRÉMENT ABSENT — H-57 (16-decisions-operateur.md,
    // FAIT AUTORITÉ) interdit qu'il passe par l'orchestrateur. Voir index.ts.
  ];
}

/**
 * Assemble la liste complète des définitions d'outils (A.2.2). Exporté séparément
 * de `creerServeurMcpControle` pour rester testable sans passer par le protocole
 * MCP complet — chaque définition expose directement son `handler`.
 */
export function construireOutilsControle(deps: DependancesServeurControle) {
  return [...outilsInspection(deps), ...outilsCycleVie(deps), ...outilsArbitrage(deps)];
}

/** Assemble le serveur MCP de contrôle complet (A.2.1, A.2.2). */
export function creerServeurMcpControle(deps: DependancesServeurControle): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: 'ccremote-controle',
    version: '0.1.0',
    tools: construireOutilsControle(deps),
  });
}
