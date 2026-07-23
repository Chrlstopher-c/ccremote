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
import { applique, differe, echecInattendu, refuse } from './contrat.ts';
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
  ConfigPlafondParc,
  ContratRetour,
  DefinisseurBudget,
  LecteurEscalades,
  LecteurUtilisationParc,
  EnregistreurProposition,
  ExplorateurProjets,
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
  /**
   * G.1.3 — plafond de parc, consommé par `creer_equipe` (voir `outils-cycle-vie.ts`).
   *
   * `☠` **Obligatoires, jamais optionnels (H-74).** L'optionalité était le défaut
   * lui-même : un plafond dont la source d'utilisation peut manquer se désactive en
   * silence, passe tous ses tests et ne borne rien. Cette dépendance-ci figure
   * nommément dans H-74 comme la deuxième des cinq occurrences trouvées le
   * 2026-07-22. Un assembleur qui ne peut pas fournir de vraie source doit passer
   * `UTILISATION_PARC_DESACTIVEE` **explicitement** — la désactivation reste
   * possible, mais elle devient un choix écrit, jamais un oubli.
   */
  readonly utilisationParc: LecteurUtilisationParc;
  readonly configPlafondParc: ConfigPlafondParc;
  /**
   * Compaction du contexte de LA session appelante (H-62). Fourni par la
   * composition, qui capture l'identité de la conversation — un serveur de
   * contrôle est donc construit par conversation.
   *
   * `☠` Absent ⇒ l'outil n'est pas exposé DU TOUT. C'est voulu : mieux vaut un
   * outil que le modèle ne voit pas qu'un outil présent qui échouerait ou, pire,
   * répondrait « compacté » sans rien compacter.
   *
   * `☠` La règle « ne compacte jamais de ta propre initiative, propose d'abord »
   * vit dans le MANDAT (`mandat.ts`), pas ici : c'est une contrainte de conduite,
   * PAS un verrou mécanique. Le harness ne peut pas constater qu'une demande
   * humaine a précédé l'appel — ne jamais présenter cette règle comme mécanique.
   */
  readonly compacteurContexte?: CompacteurContexte;
  /**
   * Enregistre les mandats proposés (H-61). Absent ⇒ `creer_equipe` REFUSE au
   * lieu de rendre une proposition que personne ne pourrait autoriser.
   */
  readonly propositions?: EnregistreurProposition;
  /**
   * Exploration des projets DU PC. `☠` Sans elle, `lister_projets` lit le
   * répertoire local du Pi et rend une liste vide : l'orchestrateur en conclut
   * qu'aucun projet n'existe, alors qu'ils sont tous sur le PC (23/07).
   */
  readonly explorateurProjets?: ExplorateurProjets;
}

/** Port de compaction du contexte de la session appelante. */
export interface CompacteurContexte {
  /** Arme la compaction pour la fin du tour courant (jamais pendant). */
  demander(): { readonly arme: boolean; readonly detail: string };
}

/**
 * Désactivation **explicite** du plafond de parc (H-58 « désactivé par défaut »).
 * Exporté pour qu'un assembleur sans source d'utilisation réelle le dise dans son
 * code plutôt que d'omettre un champ — voir `DependancesServeurControle`.
 */
export const UTILISATION_PARC_DESACTIVEE: LecteurUtilisationParc = { comptesConnus: () => [], releves: () => [] };

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
    tool('lister_equipes', 'Liste les équipes actives ET les équipes récemment terminées, avec leurs états.', {}, async () =>
      protege('lister_equipes', () => listerEquipes(deps.registre)),
    { annotations: { readOnlyHint: true } }),
    tool(
      'etat_equipe',
      "Détail d'une équipe : tâche, coût, contexte, capacités manquantes. Fonctionne aussi sur une équipe terminée.",
      {
        equipe: z
          .string()
          .describe("Identifiant, nom ou projet de l'équipe — le nom suffit si aucune autre ne lui ressemble."),
      },
      async ({ equipe }) => protege('etat_equipe', () => etatEquipe(deps.registre, equipe)),
      { annotations: { readOnlyHint: true } },
    ),
    tool('lister_projets', 'Projets connus et leur worktree.', {}, async () =>
      protege('lister_projets', () => listerProjets(deps.repertoireProjets)),
    { annotations: { readOnlyHint: true } }),
    tool(
      'historique_equipe',
      "Dernières transitions d'état d'une équipe, résumées.",
      {
        equipe: z.string().describe("Identifiant, nom ou projet de l'équipe."),
        limite: z.number().int().positive().optional(),
      },
      async ({ equipe, limite }) =>
        protege('historique_equipe', () => historiqueEquipe(deps.registre, equipe, limite)),
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
        "H-61 — la création exige une autorisation humaine explicite, présentée par l'UI. " +
        "`modele` et `effort` : ne les renseigne QUE si l'opérateur a précisé lesquels. " +
        'Laissés vides, le lead démarre sur les défauts du harness (Opus 4.8, effort high).',
      {
        projet: z.string(),
        objectif: z.string(),
        critereArret: z.string().nullable(),
        perimetre: z.string(),
        modele: z.string().nullable().optional(),
        effort: z.enum(['low', 'medium', 'high', 'xhigh']).nullable().optional(),
      },
      async ({ projet, objectif, critereArret, perimetre, modele, effort }) =>
        protege('creer_equipe', () =>
          proposerCreationEquipe(
            projet,
            objectif,
            critereArret,
            perimetre,
            deps.utilisationParc,
            deps.configPlafondParc,
            deps.propositions,
            modele,
            effort,
          ),
        ),
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
/**
 * Outil de compaction — présent SEULEMENT si la composition a fourni un
 * compacteur (voir `DependancesServeurControle.compacteurContexte`).
 */
function outilsExploration(deps: DependancesServeurControle) {
  const explorateur = deps.explorateurProjets;
  if (explorateur === undefined) return [];
  return [
    tool(
      'explorer_projets',
      "Parcourt l'arborescence des projets sur le PC de l'opérateur (/mnt/projects). " +
        'Sans argument : la racine. Avec `chemin` : ce sous-dossier. ' +
        "Rend pour chaque entrée son chemin ABSOLU — c'est celui à donner comme `projet` à creer_equipe.",
      { chemin: z.string().optional() },
      async ({ chemin }) =>
        protege('explorer_projets', async () => {
          const r = await explorateur.explorerProjets(chemin);
          return applique('explorer les projets', JSON.stringify(r), r.chemin);
        }),
      { annotations: { readOnlyHint: true } },
    ),
  ];
}

function outilsContexte(deps: DependancesServeurControle) {
  const compacteur = deps.compacteurContexte;
  if (compacteur === undefined) return [];
  return [
    tool(
      'compacter_mon_contexte',
      "Compacte ton propre contexte : un résumé dense remplace l'historique, et la suite repart dessus. " +
        "À n'utiliser QUE si l'opérateur te le demande, ou s'il a accepté ta proposition de le faire — " +
        'jamais de ta seule initiative. La compaction prend effet à la fin de cette réponse.',
      {},
      async () =>
        protege('compacter_mon_contexte', () => {
          const r = compacteur.demander();
          // `☠` Rien à compacter n'est pas un échec technique : on le DIT au
          // modèle plutôt que de lui laisser croire que c'est fait.
          return r.arme ? differe('compacter_mon_contexte', 'contexte', r.detail) : refuse('compacter_mon_contexte', r.detail);
        }),
    ),
  ];
}

export function construireOutilsControle(deps: DependancesServeurControle) {
  return [...outilsInspection(deps), ...outilsCycleVie(deps), ...outilsArbitrage(deps), ...outilsContexte(deps), ...outilsExploration(deps)];
}

/** Assemble le serveur MCP de contrôle complet (A.2.1, A.2.2). */
export function creerServeurMcpControle(deps: DependancesServeurControle): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: 'ccremote-controle',
    version: '0.1.0',
    tools: construireOutilsControle(deps),
  });
}
