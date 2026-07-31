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
import { ACCES_MANDAT } from '../../../shared/acces-mandat.ts';
import type { Registre } from '../../registre/index.ts';
import { applique, differe, echecInattendu, refuse } from './contrat.ts';
import {
  etatEquipe,
  historiqueEquipe,
  listerEquipes,
  rapportEquipe,
  suivreEquipe,
  autonomieDuFil,
  carburantParc,
  listerProjets,
} from './outils-inspection.ts';
import {
  arreterEquipe,
  envoyerAEquipe,
  interrompreEquipe,
  proposerCreationEquipe,
  relancerEquipe,
} from './outils-cycle-vie.ts';
import { definirBudget } from './outils-budget.ts';
import { mcpControleLogger as journal } from './logger.ts';
import type {
  ArreteurMission,
  ConfigPlafondParc,
  ContratRetour,
  DefinisseurBudget,
  LecteurUtilisationParc,
  EnregistreurProposition,
  ChercheurProjets,
  ExplorateurProjets,
  LecteurFichierProjet,
  RelanceurMission,
  RepertoireCibles,
} from './types.ts';

export interface DependancesServeurControle {
  readonly registre: Registre;
  readonly repertoireProjets: string;
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
  /**
   * Lecture du contenu des fichiers DU PC. `☠` Sans elle, l'orchestrateur voit
   * l'arborescence mais aucune ligne de code, et rend malgré tout des synthèses
   * « d'après le code » entièrement aveugles (constaté en prod). Absent ⇒
   * l'outil n'est pas exposé DU TOUT — même règle que `compacteurContexte` :
   * mieux vaut un outil que le modèle ne voit pas qu'un outil qui rend du vide.
   */
  readonly lecteurFichier?: LecteurFichierProjet;
  /**
   * Recherche de contenu DANS les projets du PC. Absent ⇒ l'outil n'est pas
   * exposé du tout — même règle que les deux précédents : mieux vaut un outil
   * que le modèle ne voit pas qu'un outil qui rend systématiquement du vide,
   * qu'il lirait comme « rien ne correspond ».
   */
  readonly chercheurProjets?: ChercheurProjets;
  /**
   * Conversation dont ce serveur est la surface (migration 15). `☠` Un serveur
   * de contrôle est construit PAR conversation — sans cet identifiant,
   * `mon_autonomie` ne saurait pas de quel fil il parle et rendrait l'état d'un
   * autre, ou rien.
   */
  readonly conversationId?: string;
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
    tool(
      'rapport_equipe',
      "Le dernier message du team leader, ENTIER : sa synthèse de fin. À utiliser dès qu'on demande le RÉSULTAT d'une équipe, et pas seulement son état.",
      { equipe: z.string().describe("Identifiant, nom ou projet de l'équipe.") },
      async ({ equipe }) => protege('rapport_equipe', () => rapportEquipe(deps.registre, equipe)),
      { annotations: { readOnlyHint: true } },
    ),
    tool(
      'suivre_equipe',
      "Ce qu'une équipe fait EN CE MOMENT : ses dernières lignes de fil (outils lancés, " +
        'réflexions, texte du lead). À utiliser pendant qu’elle travaille — `rapport_equipe` ' +
        "ne sert qu'une fois qu'elle a fini. Par défaut 10 lignes ; monte jusqu'à 200 seulement " +
        'si tu soupçonnes un dérapage : lire un transcript entier sature ton propre contexte. ' +
        "Si tu vois qu'elle va conclure en oubliant quelque chose, `envoyer_a_equipe` corrige " +
        "le tir sans interrompre son tour — inutile d'un nouveau mandat pour un détail.",
      {
        equipe: z.string().describe("Identifiant, nom ou projet de l'équipe."),
        lignes: z.number().int().positive().optional().describe('Défaut 10, maximum 200.'),
      },
      async ({ equipe, lignes }) => protege('suivre_equipe', () => suivreEquipe(deps.registre, equipe, lignes)),
      { annotations: { readOnlyHint: true } },
    ),
    tool(
      'mon_autonomie',
      "Ce que tu as le droit de lancer sans demander, et jusqu'à quand. À consulter " +
        "quand tu hésites à proposer un mandat, et au réveil d'une notification : tu ne " +
        "peux pas le deviner autrement. Si une fenêtre est ouverte, son échéance est une " +
        'contrainte réelle — arbitre entre lancer une équipe de plus et consolider.',
      {},
      async () => protege('mon_autonomie', () => autonomieDuFil(deps.registre, deps.conversationId ?? null)),
      { annotations: { readOnlyHint: true } },
    ),
    tool(
      'carburant_parc',
      "Où en est le quota de chaque compte, et ce que ça implique pour ta prochaine " +
        'décision. À consulter AVANT de proposer un mandat quand tu travailles en ' +
        "autonomie, et dès qu'une équipe se termine. Une équipe lancée à 95 % de la " +
        'fenêtre 5 h sera coupée en route, et une équipe coupée a coûté tout ce ' +
        "qu'elle a consommé pour rien. L'outil te rend un conseil explicite : suis-le.",
      {},
      async () => protege('carburant_parc', () => carburantParc(deps.registre)),
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
  ];
}

function outilsCycleVie(deps: DependancesServeurControle) {
  return [
    tool(
      'creer_equipe',
      "Propose une nouvelle équipe sur un projet, avec un mandat. NE CRÉE RIEN : " +
        "H-61 — la création exige une autorisation humaine explicite, présentée par l'UI. " +
        "`acces` est un DROIT RÉEL, pas une consigne rédigée : `lecture` fait refuser Write, " +
        "Edit et NotebookEdit par le harness lui-même — Bash reste ouvert, explorer au shell " +
        "est légitime. Choisis `lecture` pour une équipe qui explore, audite ou rend un rapport ; " +
        "`ecriture` dès qu'elle doit modifier le projet. `perimetre` reste la description en " +
        'clair du cadre, il ne donne aucun droit. ' +
        "`modele` et `effort` : ne les renseigne QUE si l'opérateur a précisé lesquels. " +
        'Laissés vides, le lead démarre sur les défauts du harness (Opus 5, effort high).',
      {
        projet: z.string(),
        objectif: z.string(),
        critereArret: z.string().nullable(),
        perimetre: z.string(),
        acces: z.enum(ACCES_MANDAT),
        modele: z.string().nullable().optional(),
        effort: z.enum(['low', 'medium', 'high', 'xhigh']).nullable().optional(),
      },
      async ({ projet, objectif, critereArret, perimetre, acces, modele, effort }) =>
        protege('creer_equipe', () =>
          proposerCreationEquipe(
            projet,
            objectif,
            critereArret,
            perimetre,
            acces,
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

function outilsBudget(deps: DependancesServeurControle) {
  return [
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

/**
 * Recherche de contenu — présente SEULEMENT si la composition a câblé un
 * chercheur vers le PC (voir `DependancesServeurControle.chercheurProjets`).
 */
function outilsRecherche(deps: DependancesServeurControle) {
  const chercheur = deps.chercheurProjets;
  if (chercheur === undefined) return [];
  return [
    tool(
      'rechercher_projets',
      "Cherche un motif dans le CONTENU des fichiers, sur le PC (racine /mnt/projects). " +
        "C'est l'outil du CADRAGE : avant de proposer un mandat sur un projet que tu ne " +
        'connais pas, cherche plutôt que de lire des fichiers au hasard. `motif` est une ' +
        'expression régulière (ripgrep), casse ignorée si tu écris en minuscules. ' +
        '`chemin` est OBLIGATOIRE : on cherche dans UN projet, la racine entière est trop ' +
        "vaste (mesuré : plus de deux minutes). Si tu ne sais pas encore lequel, appelle " +
        "d'abord `explorer_projets`. Résultats bornés à 40 : si la note dit que c'est " +
        "tronqué, affine le motif — n'essaie pas d'en obtenir plus.",
      {
        motif: z.string().describe('Expression régulière recherchée dans le contenu.'),
        chemin: z.string().describe('Projet où chercher — obligatoire. Ex. « ccremote » ou un chemin absolu.'),
        max: z.number().int().positive().optional().describe('Occurrences voulues, 40 au maximum.'),
      },
      async ({ motif, chemin, max }) =>
        protege('rechercher_projets', async () => {
          const r = await chercheur.rechercherProjets(motif, chemin, max);
          return applique('chercher dans les projets', JSON.stringify(r), r.chemin);
        }),
      { annotations: { readOnlyHint: true } },
    ),
  ];
}

/**
 * Outil de lecture de fichier — présent SEULEMENT si la composition a câblé un
 * lecteur vers le PC (voir `DependancesServeurControle.lecteurFichier`).
 */
function outilsLectureFichier(deps: DependancesServeurControle) {
  const lecteur = deps.lecteurFichier;
  if (lecteur === undefined) return [];
  return [
    tool(
      'lire_fichier',
      "Lit le CONTENU d'un fichier sur le PC de l'opérateur (racine /mnt/projects uniquement). " +
        '`chemin` : absolu, ou relatif à la racine — tel que rendu par explorer_projets. ' +
        "Lecture seule, plafonnée à 200 Ko : au-delà le début du fichier est rendu et `tronque` vaut true. " +
        "Un fichier binaire, absent, ou hors de la racine est refusé avec `note` — lis-la, ne conclus jamais " +
        'sur un contenu vide comme si le fichier était vide.',
      { chemin: z.string() },
      async ({ chemin }) =>
        protege('lire_fichier', async () => {
          const r = await lecteur.lireFichier(chemin);
          // `☠` Un refus de lecture DOIT ressortir en `refuse`, jamais en
          // `applique` avec un contenu vide : c'est exactement la confusion qui
          // faisait synthétiser à l'aveugle.
          if (!r.ok) return refuse('lire un fichier', r.note ?? 'lecture refusée');
          return applique('lire un fichier', JSON.stringify(r), r.chemin);
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
  return [
    ...outilsInspection(deps),
    ...outilsCycleVie(deps),
    ...outilsBudget(deps),
    ...outilsContexte(deps),
    ...outilsExploration(deps),
    ...outilsRecherche(deps),
    ...outilsLectureFichier(deps),
  ];
}

/** Assemble le serveur MCP de contrôle complet (A.2.1, A.2.2). */
export function creerServeurMcpControle(deps: DependancesServeurControle): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: 'ccremote-controle',
    version: '0.1.0',
    tools: construireOutilsControle(deps),
  });
}
