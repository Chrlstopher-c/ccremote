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
  suivreEquipes,
  transcriptEquipe,
  TRANSCRIPT_LIGNES_DEFAUT,
  TRANSCRIPT_LIGNES_MAX,
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
  retirerMandat,
} from './outils-cycle-vie.ts';
import { definirBudget } from './outils-budget.ts';
import {
  listerRappels,
  mettreRappelEnPause,
  modifierRappel,
  programmerRappel,
  reprendreRappel,
  supprimerRappel,
} from './outils-rappels.ts';
import { nommerFil } from './outils-fil.ts';
import { listerFils, lireFil } from './outils-historique-fils.ts';
import { creerArtefact } from './outils-artefact.ts';
import { demanderRallongeAutonomie } from './outils-rallonge.ts';
import { ajusterAutonomie, demanderFenetreAutonomie, terminerAutonomie } from './outils-autonomie.ts';
import { AUTO_APPROBATIONS_MAX } from '../../autonomie/index.ts';
import { etatMachine, reveillerMachine, type EmetteurReveil } from './outils-machine.ts';
import { etatService, piloterService, SERVICES_ETAT_SERVICE, SERVICES_PILOTER_SERVICE } from './outils-service.ts';
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
  LecteurMetriquesHote,
  LecteurServiceSysteme,
  PiloteServiceSysteme,
  RelanceurMission,
  EmetteurEquipe,
} from './types.ts';

export interface DependancesServeurControle {
  readonly registre: Registre;
  readonly repertoireProjets: string;
  /** Parole vers une équipe vivante — traverse le lien (voir `EmetteurEquipe`). */
  readonly emetteur: EmetteurEquipe;
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
   * Métriques matérielles du PC (`etat_machine`) — branche le port `metriques_hote`
   * déjà câblé de bout en bout (canal D.3), ne le duplique pas. Absent ⇒ l'outil
   * n'est pas exposé DU TOUT, même règle que les ports projets ci-dessus.
   */
  readonly lecteurMetriquesHote?: LecteurMetriquesHote;
  /**
   * Réveil Wake-on-LAN du PC (`reveiller_machine`). `☠` HORS canal D.3 (H-75) :
   * le PC éteint n'a aucun lien à emprunter — voir `composition/pi/reveil-wol.ts`.
   * Absent ⇒ l'outil n'est pas exposé DU TOUT.
   */
  readonly emetteurReveilPc?: EmetteurReveil;
  /**
   * Lecture d'état des services systemd du Pi (`etat_service`). `☠` HORS canal
   * D.3 — LOCAL au Pi (H-75, voir `outils-service.ts`), même statut que
   * `emetteurReveilPc` : absent ⇒ l'outil n'est pas exposé DU TOUT.
   */
  readonly lecteurServiceSysteme?: LecteurServiceSysteme;
  /**
   * Redémarrage des services systemd du Pi (`piloter_service`), SEAU 3
   * seulement (voir `outils-service.ts`). `☠` Peut échouer par `refuse`
   * explicite si la règle sudoers de l'opérateur manque — voir
   * `composition/pi/service-systeme.ts`. Absent ⇒ l'outil n'est pas exposé DU TOUT.
   */
  readonly piloteServiceSysteme?: PiloteServiceSysteme;
  /**
   * Conversation dont ce serveur est la surface (migration 15). `☠` Un serveur
   * de contrôle est construit PAR conversation — sans cet identifiant,
   * `mon_autonomie` ne saurait pas de quel fil il parle et rendrait l'état d'un
   * autre, ou rien.
   */
  readonly conversationId?: string;
  /**
   * Défaut de PARC du plafond d'autonomie, tel que la composition l'a résolu —
   * `null` ⇒ parc affranchi. Sert à `ajuster_autonomie` pour savoir ce qui
   * s'applique RÉELLEMENT au fil avant de dire si une valeur le baisse.
   *
   * `☠` Optionnel, mais l'oubli ne DÉSACTIVE rien (contrairement à
   * `utilisationParc`, H-74) : absent ⇒ `AUTO_APPROBATIONS_MAX`, ce qui rend la
   * garde plus STRICTE, jamais plus permissive. Le seul risque est un refus
   * excessif sur un parc affranchi, et le message de refus dit contre quelle
   * valeur la comparaison a été faite.
   */
  readonly plafondAutonomieParc?: number | null;
  /**
   * Racine de stockage des artefacts (`creer_artefact`) — la MÊME que celle des
   * pièces jointes du navigateur (`CCREMOTE_PI_PIECES_JOINTES`), même route de
   * lecture. Absent ⇒ l'outil n'est pas exposé DU TOUT, même règle que les
   * ports optionnels ci-dessus : mieux vaut un outil que le modèle ne voit pas
   * qu'un outil qui refuserait systématiquement.
   */
  readonly racinePiecesJointes?: string;
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
    tool(
      'lister_equipes',
      'Les équipes du parc. Par défaut : toutes les actives (du parc ENTIER — le parc est ' +
        'partagé entre les fils, une seule équipe peut travailler sur un projet à la fois) et ' +
        'les terminées DE CE FIL uniquement. `portee: "parc"` pour voir aussi l’historique des ' +
        'autres fils, `etat: "actives"` quand tu veux seulement savoir ce qui tourne — c’est le ' +
        'cas le plus fréquent et le moins coûteux en contexte.',
      {
        etat: z.enum(['actives', 'terminees', 'toutes']).optional().describe('Défaut : toutes.'),
        portee: z
          .enum(['fil', 'parc'])
          .optional()
          .describe('Défaut : fil. Ne concerne QUE les terminées — les actives sont toujours celles du parc entier.'),
        limite: z.number().int().positive().optional().describe('Nombre de terminées. Défaut 15, maximum 50.'),
      },
      async ({ etat, portee, limite }) =>
        protege('lister_equipes', () =>
          listerEquipes(deps.registre, { etat, portee, limite, conversationId: deps.conversationId ?? null }),
        ),
      { annotations: { readOnlyHint: true } },
    ),
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
      'suivre_equipes',
      'Comme `suivre_equipe`, mais sur PLUSIEURS équipes en un seul appel — ' +
        'préfère-le dès que tu en surveilles deux ou plus : un appel au lieu de trois, ' +
        'et une vue comparable au même instant. Le budget de lignes est RÉPARTI entre ' +
        'les équipes demandées, jamais multiplié : quatre transcrits entiers satureraient ' +
        'ton contexte. Une équipe introuvable est signalée sans faire échouer les autres. ' +
        'Tu n’as pas besoin de te poser un rappel pour surveiller : appelle cet outil ' +
        'quand tu veux savoir, et enchaîne.',
      {
        equipes: z.array(z.string()).min(1).describe('Identifiants, noms ou projets des équipes.'),
        lignes: z.number().int().positive().optional().describe('Budget TOTAL réparti entre elles. Défaut 10, maximum 200.'),
      },
      async ({ equipes, lignes }) => protege('suivre_equipes', () => suivreEquipes(deps.registre, equipes, lignes)),
      { annotations: { readOnlyHint: true } },
    ),
    tool(
      'transcript_equipe',
      "Le transcript ENTIER d'une équipe (texte, réflexions, appels d'outils), paginé, filtrable " +
        "par type. Fonctionne aussi bien sur une équipe vivante que terminée, COUPÉE ou PLANTÉE — " +
        "c'est la seule façon de savoir ce qu'une équipe a dit en dernier quand elle n'a jamais " +
        "rendu de rapport (`rapport_equipe` reste vide dans ce cas précis, faute de texte final). " +
        "Par défaut, rend déjà la FIN du transcript (les dernières lignes, dans l'ordre " +
        "chronologique) : c'est le geste utile, aucune pagination manuelle depuis le début n'est " +
        "nécessaire. Pour remonter plus loin dans le passé, augmente `decalage` (compté depuis la " +
        "fin, pas depuis le début) — pas `suivre_equipe` pour ça, qui résume et ne va jamais plus " +
        "loin que ses dernières lignes. Lecture seule.",
      {
        equipe: z.string().describe("Identifiant, nom ou projet de l'équipe."),
        type: z
          .enum(['texte', 'reflexion', 'outil'])
          .optional()
          .describe("Ne garder qu'un type d'activité. Défaut : tous."),
        decalage: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe('Lignes à sauter, comptées depuis la FIN. Défaut 0 (les plus récentes).'),
        limite: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(`Nombre de lignes. Défaut ${TRANSCRIPT_LIGNES_DEFAUT}, maximum ${TRANSCRIPT_LIGNES_MAX}.`),
      },
      async ({ equipe, type, decalage, limite }) =>
        protege('transcript_equipe', () => transcriptEquipe(deps.registre, equipe, { type, decalage, limite })),
      { annotations: { readOnlyHint: true } },
    ),
    tool(
      'mon_autonomie',
      "Ce que tu as le droit de lancer sans demander, et jusqu'à quand. À consulter " +
        "quand tu hésites à proposer un mandat, et au réveil d'une notification : tu ne " +
        "peux pas le deviner autrement. Si une fenêtre est ouverte, son échéance est une " +
        'contrainte réelle — arbitre entre lancer une équipe de plus et consolider.',
      {},
      async () =>
        protege('mon_autonomie', () =>
          autonomieDuFil(
            deps.registre,
            deps.conversationId ?? null,
            Date.now(),
            deps.plafondAutonomieParc === undefined ? AUTO_APPROBATIONS_MAX : deps.plafondAutonomieParc,
          ),
        ),
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
        '`modele` : TU ARBITRES, ce n’est pas à l’opérateur de le dire. `claude-sonnet-5` ' +
        'pour un mandat d’EXÉCUTION (cadrage posé : écrire, corriger, tester, explorer, ' +
        'documenter) — le cas le plus fréquent. `claude-opus-5` pour un mandat de CONCEPTION ' +
        '(direction artistique, motion design, architecture non triviale, défaut qui résiste). ' +
        'Mesuré le 01/08 : 6,40 $ par équipe Opus contre 0,67 $ par équipe Sonnet. Laissé vide, ' +
        'le harness retombe sur Opus 5 — un défaut prudent, pas un choix : annonce le tien. ' +
        '`budgetMaxUsd` : le plafond de dépense de CETTE équipe, posé dès maintenant. ' +
        'Le seul moment où tu peux le fixer avant qu’elle ne dépense — `definir_budget` ' +
        'n’opère que sur une équipe déjà démarrée, et une mission courte finit avant tout ' +
        'réveil. Laissé vide, elle court sous le plafond de parc (250 $). ' +
        'DEUX GARDES REFUSENT L’APPEL AVANT TOUTE ÉCRITURE : (1) carburant du parc non ' +
        'consulté depuis plus de 30 min — appelle carburant_parc d’abord ; (2) ce projet a ' +
        'déjà reçu une mission dans les dernières 24h ET `campagne` est vide — soit tu ' +
        'regroupes ce travail dans l’équipe existante, soit tu renvoies cet appel en ' +
        'nommant la campagne.',
      {
        projet: z.string(),
        objectif: z.string(),
        critereArret: z.string().nullable(),
        perimetre: z.string(),
        acces: z.enum(ACCES_MANDAT),
        modele: z.string().nullable().optional(),
        effort: z.enum(['low', 'medium', 'high', 'xhigh']).nullable().optional(),
        budgetMaxUsd: z.number().nullable().optional().describe('Plafond de dépense en dollars, ex. 5.'),
        campagne: z
          .string()
          .nullable()
          .optional()
          .describe(
            "Libellé libre nommant le chantier d'ensemble. Absent + projet déjà mandaté dans les " +
              "dernières 24h ⇒ REFUS (garde 1, une vague de trop). Renseigne-le pour assumer " +
              'explicitement une nouvelle vague sur ce projet plutôt que de regrouper.',
          ),
      },
      async ({ projet, objectif, critereArret, perimetre, acces, modele, effort, budgetMaxUsd, campagne }) =>
        protege('creer_equipe', () =>
          proposerCreationEquipe(
            projet,
            objectif,
            critereArret,
            perimetre,
            acces,
            deps.registre,
            deps.utilisationParc,
            deps.configPlafondParc,
            deps.propositions,
            modele,
            effort,
            budgetMaxUsd,
            campagne,
          ),
        ),
    ),
    tool(
      'retirer_mandat',
      'Retire un mandat que tu as proposé et qui attend encore son autorisation — quand tu ' +
        'le remplaces, ou qu’il n’a plus lieu d’être. `☠` Sans lui, un mandat caduc reste ' +
        'autorisable indéfiniment : le 03/08, une proposition abandonnée la veille a été ' +
        'autorisée le lendemain matin sur le mauvais projet. Ne concerne QUE les mandats en ' +
        'attente : une équipe déjà partie se coupe avec arreter_equipe.',
      { mandatId: z.string().describe('Identifiant du mandat proposé (la ref rendue par creer_equipe).') },
      async ({ mandatId }) =>
        protege('retirer_mandat', async () => retirerMandat(deps.registre, deps.conversationId ?? null, mandatId)),
    ),
    tool(
      'envoyer_a_equipe',
      "Transmet une instruction à une équipe VIVANTE — y compris quand elle est `idle` " +
        "(elle a rendu la main et attend : c'est le moment où elle lit le plus vite). " +
        "Mise en file (H-67), n'interrompt jamais le tour en cours. Équipe en pause : le " +
        'message est retenu et transmis à la reprise, ce qui est dit dans la réponse.',
      {
        missionId: z.string().describe("Identifiant, nom ou projet de l'équipe."),
        message: z.string(),
      },
      async ({ missionId, message }) =>
        protege('envoyer_a_equipe', () => envoyerAEquipe(deps.emetteur, deps.registre, missionId, message)),
    ),
    tool(
      'interrompre_equipe',
      'Stoppe le tour en cours de cette équipe — elle reprend la main aussitôt et lit ' +
        "ce qui l'attend. Ne la met PAS en pause.",
      { missionId: z.string().describe("Identifiant, nom ou projet de l'équipe.") },
      async ({ missionId }) =>
        protege('interrompre_equipe', () => interrompreEquipe(deps.emetteur, deps.registre, missionId)),
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

/**
 * Groupe « rappels » — l'orchestrateur agit sur le temps (migration 16).
 *
 * `☠` `deps.conversationId` vient de la CLOSURE du serveur, jamais d'un
 * paramètre du modèle : il ne peut donc pas viser le rappel d'un autre fil, même
 * en devinant son identifiant.
 */
function outilsRappels(deps: DependancesServeurControle) {
  const fil = (): string | null => deps.conversationId ?? null;
  const idRappel = z.string().describe('Identifiant du rappel, tel que rendu par `mes_rappels`.');
  return [
    tool(
      'programmer_rappel',
      "Programme un rappel sur CETTE conversation : à l'échéance, la consigne t'est réinjectée " +
        'et tu reprends la main tout seul. C’est le seul moyen dont tu disposes d’agir dans le ' +
        'temps — sans rappel, tu ne peux réagir qu’à un message de Chris ou à la fin d’une ' +
        "équipe. Tu peux en poser plusieurs, ils sont indépendants. La consigne est injectée " +
        'TELLE QUELLE : écris-la comme une instruction que tu te donnes à toi-même, pas comme ' +
        'un titre. Période minimum 5 min — chaque tir réveille une session et coûte du quota.',
      {
        libelle: z.string().describe('Nom court, pour t’y retrouver et pour l’écran de Chris.'),
        consigne: z.string().describe('Ce qui te sera réinjecté au déclenchement, mot pour mot.'),
        periodeMinutes: z
          .number()
          .positive()
          .nullable()
          .describe('Récurrence en minutes (min. 5). `null` pour un rappel unique.'),
        premierTirDansMinutes: z
          .number()
          .positive()
          .nullable()
          .optional()
          .describe('Délai avant le premier tir. Absent ⇒ une période complète.'),
        maxDeclenchements: z.number().int().positive().nullable().optional().describe('Plafond de tirs.'),
      },
      async ({ libelle, consigne, periodeMinutes, premierTirDansMinutes, maxDeclenchements }) =>
        protege('programmer_rappel', () =>
          programmerRappel(deps.registre, fil(), {
            libelle,
            consigne,
            periodeMinutes,
            premierTirDansMinutes,
            maxDeclenchements,
          }),
        ),
    ),
    tool(
      'mes_rappels',
      'Tes rappels sur cette conversation : cadence, prochain tir, nombre de tirs, incidents. ' +
        'Consulte-les avant d’en poser un nouveau — tu en as peut-être déjà un qui couvre le sujet.',
      {},
      async () => protege('mes_rappels', () => listerRappels(deps.registre, fil())),
      { annotations: { readOnlyHint: true } },
    ),
    tool(
      'mettre_rappel_en_pause',
      'Suspend un rappel sans le perdre : consigne, cadence et historique sont conservés, et ' +
        '`reprendre_rappel` le relance. À préférer à la suppression dès que la consigne pourrait ' +
        'resservir.',
      { id: idRappel },
      async ({ id }) => protege('mettre_rappel_en_pause', () => mettreRappelEnPause(deps.registre, fil(), id)),
    ),
    tool(
      'reprendre_rappel',
      'Relance un rappel en pause. Le cycle repart de maintenant : les tirs manqués pendant la ' +
        'pause ne sont pas rattrapés. Un rappel terminé ne se reprend jamais.',
      { id: idRappel },
      async ({ id }) => protege('reprendre_rappel', () => reprendreRappel(deps.registre, fil(), id)),
    ),
    tool(
      'modifier_rappel',
      'Change le libellé, la consigne ou la cadence d’un rappel. Les champs omis ne bougent pas, ' +
        'et le compteur de tirs comme la prochaine échéance sont conservés — corriger une phrase ' +
        'ne relance pas le cycle.',
      {
        id: idRappel,
        libelle: z.string().optional(),
        consigne: z.string().optional(),
        periodeMinutes: z.number().positive().nullable().optional().describe('Nouvelle cadence (min. 5).'),
      },
      async ({ id, libelle, consigne, periodeMinutes }) =>
        protege('modifier_rappel', () =>
          modifierRappel(deps.registre, fil(), id, { libelle, consigne, periodeMinutes }),
        ),
    ),
    tool(
      'supprimer_rappel',
      'Supprime définitivement un rappel. Irréversible — préfère `mettre_rappel_en_pause` si la ' +
        'consigne pourrait resservir.',
      { id: idRappel },
      async ({ id }) => protege('supprimer_rappel', () => supprimerRappel(deps.registre, fil(), id)),
    ),
  ];
}

/**
 * Groupe « fil » — l'orchestrateur nomme la conversation où il parle (migration 19).
 *
 * `☠` La garde n'est PAS dans la description de l'outil : elle est dans
 * `titre-fil.ts`, et l'outil refuse. Une consigne de prompt tient trente tours,
 * pas trois cents — et le jour où elle lâche, le fil que Chris cherchait dans sa
 * liste a changé de nom sans que personne l'ait décidé.
 */
function outilsFil(deps: DependancesServeurControle) {
  return [
    tool(
      'nommer_fil',
      'Donne son titre à CETTE conversation. À appeler une seule fois, quand tu réponds au ' +
        'deuxième message de Chris : le sujet est alors établi. Ce titre reste celui du fil pour ' +
        'toute la session — tu ne le changes plus de ton propre chef, même si tu en trouves un ' +
        'meilleur. Si Chris te demande explicitement de renommer le fil, rappelle cet outil avec ' +
        '`demande_par_chris: true` : sa demande passe toujours.',
      {
        titre: z
          .string()
          .describe('Trois à six mots qui disent le sujet du fil. Pas de guillemets, pas de phrase.'),
        demande_par_chris: z
          .boolean()
          .optional()
          .describe('true UNIQUEMENT si Chris vient de demander ce renommage. Jamais de ta propre initiative.'),
      },
      async ({ titre, demande_par_chris }) =>
        protege('nommer_fil', () =>
          nommerFil(deps.registre, deps.conversationId ?? null, titre, demande_par_chris === true),
        ),
    ),
  ];
}

/**
 * Groupe « historique des fils » — l'orchestrateur relit des conversations
 * déjà enregistrées au registre, lecture SEULE (A.2.2). `☠` Aucun paramètre ne
 * vient de la closure ici (contrairement à `outilsFil` ci-dessus) : relire le
 * fil d'une AUTRE conversation, ou une conversation archivée, est le but même
 * de ces deux outils.
 */
function outilsHistoriqueFils(deps: DependancesServeurControle) {
  const instant =
    'Formats acceptés : « maintenant », un décalage relatif (« +8h », « +90min », « +3j »), ' +
    'ou un instant ISO 8601 avec l’heure (« 2026-08-09T02:00 »). Une date sans heure est refusée.';
  return [
    tool(
      'lister_fils',
      'Les fils de discussion déjà enregistrés au registre — celui-ci comme les autres, sur tout ' +
        'l’historique. Pour chaque fil : identifiant, titre, dates de premier et de dernier ' +
        'message, nombre de messages. `depuis`/`jusqua` filtrent QUELS fils apparaissent (au moins ' +
        'un message dans la plage) — les dates et le compte rendus restent ceux du fil ENTIER, pas ' +
        'de la plage. Trié par activité la plus récente. Lecture seule.',
      {
        depuis: z.string().optional().describe(`Début de la plage. Défaut : depuis toujours. ${instant}`),
        jusqua: z.string().optional().describe(`Fin de la plage. Défaut : maintenant. ${instant}`),
        limite: z.number().int().positive().optional().describe('Nombre de fils. Défaut 20, maximum 100.'),
      },
      async ({ depuis, jusqua, limite }) =>
        protege('lister_fils', () => listerFils(deps.registre, depuis, jusqua, limite)),
      { annotations: { readOnlyHint: true } },
    ),
    tool(
      'lire_fil',
      "Le contenu d'un fil enregistré au registre : ses messages dans l'ordre chronologique, avec " +
        "leur émetteur (Chris, orchestrateur, notification) et leur horodatage. Filtrable par plage " +
        'de dates, paginé (`decalage`/`limite`, bornés à 200), et cherchable par un motif texte ' +
        '(`recherche`, insensible à la casse). Utilise `lister_fils` pour trouver l’identifiant ' +
        '`fil`. Un fil inexistant est refusé explicitement, jamais rendu comme une page vide. ' +
        'Lecture seule.',
      {
        fil: z.string().describe('Identifiant du fil, tel que rendu par `lister_fils`.'),
        depuis: z.string().optional().describe(`Début de la plage. Défaut : depuis toujours. ${instant}`),
        jusqua: z.string().optional().describe(`Fin de la plage. Défaut : maintenant. ${instant}`),
        recherche: z.string().optional().describe('Motif recherché dans le contenu des messages.'),
        decalage: z.number().int().nonnegative().optional().describe('Messages à sauter. Défaut 0.'),
        limite: z.number().int().positive().optional().describe('Nombre de messages. Défaut 50, maximum 200.'),
      },
      async ({ fil, depuis, jusqua, recherche, decalage, limite }) =>
        protege('lire_fil', () => lireFil(deps.registre, fil, { depuis, jusqua, recherche, decalage, limite })),
      { annotations: { readOnlyHint: true } },
    ),
  ];
}

/**
 * Groupe « artefact » — l'orchestrateur présente à Chris un contenu qu'il
 * produit lui-même, affiché dans le fil plutôt que noyé dans un bloc de texte
 * (mandat « artefacts »). Absent si la racine des pièces jointes n'est pas
 * câblée (voir `DependancesServeurControle.racinePiecesJointes`).
 */
function outilsArtefact(deps: DependancesServeurControle) {
  if (deps.racinePiecesJointes === undefined) return [];
  return [
    tool(
      'creer_artefact',
      'Présente à Chris un contenu que TU produis — un script (shell, Python, Lua) ou une page HTML — ' +
        'comme un ARTEFACT affiché dans le fil : code lisible, bouton de téléchargement, et pour le HTML ' +
        'une bascule code / rendu (le rendu tourne dans un cadre isolé, sans accès à la session de Chris). ' +
        'Préfère cet outil à un bloc de code collé dans ta réponse dès que Chris doit pouvoir le lire au ' +
        'propre, le télécharger, ou l’exécuter tel quel — un extrait de quelques lignes en discussion ' +
        "reste plus simple en texte. `nom_fichier` porte l'extension qui décide du rendu — .html, .sh, " +
        '.py ou .lua, aucune autre n’est acceptée. Chaque appel crée un nouvel artefact : pas de version, ' +
        'pas d’édition — pour corriger, rappelle l’outil avec le contenu corrigé.',
      {
        nom_fichier: z
          .string()
          .describe("Nom avec extension : .html, .sh, .py ou .lua — décide comment l'artefact s'affiche."),
        contenu: z.string().describe('Le contenu complet du fichier, tel qu’il doit être écrit — sans troncature.'),
      },
      async ({ nom_fichier, contenu }) =>
        protege('creer_artefact', () =>
          creerArtefact(deps.registre, deps.racinePiecesJointes, deps.conversationId ?? null, nom_fichier, contenu),
        ),
    ),
  ];
}

/**
 * Groupe « rallonge » — l'orchestrateur DEMANDE un relèvement de son plafond
 * d'autonomie (migration 27). Jamais un octroi : voir `outils-rallonge.ts`.
 */
function outilsRallonge(deps: DependancesServeurControle) {
  return [
    tool(
      'demander_rallonge_autonomie',
      "Demande à Chris de relever le plafond d'autonomie de CE fil — une DEMANDE, jamais un " +
        "octroi : seul un clic humain sur l'écran accorde quoi que ce soit. À utiliser quand ton " +
        'plafond (`mon_autonomie`) est atteint ou proche ET que le chantier en cours le justifie ' +
        '— pas par prudence anticipée. `plafondDemande` : un entier positif en texte (nombre ' +
        "d'équipes lançables sans clic), ou `illimite`. `motif` : le besoin CHIFFRÉ — ce qui " +
        "reste à faire, combien d'équipes ça prendra. `☠` CET OUTIL N'ACCORDE RIEN : il ne " +
        'relance pas ton compteur, il ne débloque pas le mandat en cours, et il ne touche pas au ' +
        "plafond de DÉPENSE du parc (H-58), qui reste inchangé et reste le seul garde-fou " +
        'vraiment contraignant. Une demande sans motif chiffré est un clic de plus demandé à ' +
        'Chris pour rien. Une demande déjà en attente sur ce fil fait REFUSER la suivante — ' +
        "n'insiste pas, attends sa décision plutôt que d'en empiler dix.",
      {
        plafondDemande: z
          .string()
          .describe('Un entier positif en texte (équipes lançables sans clic), ou « illimite ».'),
        motif: z.string().describe('Pourquoi, chiffré : ce qui reste à faire et combien d’équipes ça demande.'),
      },
      async ({ plafondDemande, motif }) =>
        protege('demander_rallonge_autonomie', () =>
          demanderRallongeAutonomie(deps.registre, deps.conversationId ?? null, plafondDemande, motif),
        ),
    ),
  ];
}

/**
 * Groupe « autonomie » — l'orchestrateur pilote la fenêtre datée de SON fil
 * (migration 15). `☠` Deux régimes, arbitrés sur la VALEUR et non sur le nom de
 * l'outil : resserrer et terminer partent seuls, ouvrir et prolonger passent par
 * une demande que Chris tranche. Toute la garde vit dans `outils-autonomie.ts`,
 * jamais dans ces descriptions : une consigne de prompt tient trente tours, pas
 * trois cents.
 */
function outilsAutonomie(deps: DependancesServeurControle) {
  const fil = (): string | null => deps.conversationId ?? null;
  const plafondParc = deps.plafondAutonomieParc === undefined ? AUTO_APPROBATIONS_MAX : deps.plafondAutonomieParc;
  const instant =
    'Formats acceptés : « maintenant », un décalage relatif (« +8h », « +90min », « +3j »), ' +
    'ou un instant ISO 8601 avec l’heure (« 2026-08-09T02:00 »). Une date sans heure est refusée.';
  return [
    tool(
      'demander_fenetre_autonomie',
      "Demande à Chris d'ouvrir une fenêtre d'autonomie sur CE fil, ou de repousser celle en " +
        'cours. Une fenêtre est une plage datée pendant laquelle tes mandats démarrent sans clic. ' +
        "C'est une DEMANDE : rien n'est ouvert tant que Chris n'a pas cliqué, et ton autonomie " +
        "actuelle reste celle en vigueur en attendant. Utilise-le quand il annonce qu'il s'absente " +
        "ou te confie un chantier long. `objectif` est la consigne qui tiendra pendant la plage : " +
        "c'est aussi le seul texte que Chris lit pour décider, écris-le pour être compris sans " +
        'contexte. Une seule demande en attente par fil. Pour RACCOURCIR une fenêtre existante, ' +
        "c'est `ajuster_autonomie`, qui n'a besoin d'aucun clic.",
      {
        fin: z.string().describe(`Échéance de la plage. ${instant}`),
        objectif: z.string().describe('La consigne qui tient pendant la plage, et le motif que Chris lit.'),
        debut: z.string().optional().describe(`Début de la plage. Défaut : maintenant. ${instant}`),
      },
      async ({ fin, objectif, debut }) =>
        protege('demander_fenetre_autonomie', () =>
          demanderFenetreAutonomie(deps.registre, fil(), fin, objectif, debut),
        ),
    ),
    tool(
      'ajuster_autonomie',
      "Resserre l'autonomie de CE fil, sans passer par Chris. Trois champs, tous facultatifs, " +
        'mais au moins un requis : `fin` avance l’échéance de la fenêtre en cours, `objectif` ' +
        'remplace la consigne de la plage, `plafond` baisse le nombre d’équipes lançables sans ' +
        'clic. Ces gestes te retirent du pouvoir, donc ils partent seuls. Toute valeur qui ' +
        "ÉLARGIT est refusée, quel que soit le champ : le refus te dit alors quelle valeur serait " +
        'acceptable et quel outil demande le reste. Utilise-le quand le travail se termine plus ' +
        'tôt que prévu, ou quand Chris précise sa consigne en cours de plage.',
      {
        fin: z.string().optional().describe(`Nouvelle échéance, plus proche que l’actuelle. ${instant}`),
        objectif: z.string().optional().describe('Nouvelle consigne pour la plage en cours.'),
        plafond: z
          .string()
          .optional()
          .describe('Nouveau plafond : un entier strictement inférieur à celui en vigueur.'),
      },
      async ({ fin, objectif, plafond }) =>
        protege('ajuster_autonomie', () =>
          ajusterAutonomie(deps.registre, fil(), plafondParc, { fin, objectif, plafond }),
        ),
    ),
    tool(
      'terminer_autonomie',
      "Ferme la fenêtre d'autonomie de CE fil tout de suite, sans passer par Chris. Les mandats " +
        'suivants repassent par la règle du premier clic, sauf si un mandat a déjà été autorisé ' +
        'ici. Appelle-le quand le chantier confié pour la plage est terminé, ou quand tu constates ' +
        "que continuer sans supervision n'est plus raisonnable. Il ne touche ni au plafond, ni aux " +
        'équipes déjà lancées. Réouvrir demandera un clic de Chris.',
      {},
      async () => protege('terminer_autonomie', () => terminerAutonomie(deps.registre, fil())),
    ),
  ];
}

function outilsBudget(deps: DependancesServeurControle) {
  return [
    tool(
      'definir_budget',
      "Plafond de dépense d'une équipe — filet de dernier recours (H-68), pas l'anti-boucle. " +
        'Le BAISSER coupe une équipe déjà lancée dès le dépassement ; le MONTER ne repousse pas ' +
        'la coupure du SDK, posée au démarrage de la session — la réponse le précise.',
      { missionId: z.string().describe("Identifiant, nom ou projet de l'équipe."), maxUsd: z.number() },
      async ({ missionId, maxUsd }) =>
        protege('definir_budget', () => definirBudget(deps.budget, deps.registre, missionId, maxUsd)),
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
        "vaste (mesuré : 22 minutes sur 248 Go). Si tu ne sais pas encore lequel, appelle " +
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

/**
 * Groupe « machine » (A.2.2) — `etat_machine` et `reveiller_machine`, chacun
 * présent SEULEMENT si la composition a câblé son port (voir
 * `DependancesServeurControle.lecteurMetriquesHote` / `.emetteurReveilPc`).
 */
function outilsMachine(deps: DependancesServeurControle) {
  const lecteur = deps.lecteurMetriquesHote;
  const outilEtatMachine =
    lecteur === undefined
      ? []
      : [
          tool(
            'etat_machine',
            "État matériel du PC : CPU, RAM, disque, températures, GPU, réseau, uptime. " +
              "Lecture seule — mêmes données que la page « État du système » de l'interface.",
            { machine: z.enum(['pc']).describe('Seule machine pilotable par ces outils : le PC.') },
            async ({ machine }) => protege('etat_machine', () => etatMachine(lecteur, machine)),
            { annotations: { readOnlyHint: true } },
          ),
        ];

  const emetteurReveil = deps.emetteurReveilPc;
  const outilReveillerMachine =
    emetteurReveil === undefined
      ? []
      : [
          tool(
            'reveiller_machine',
            "Envoie un magic packet Wake-on-LAN au PC, en diffusion locale depuis le Pi — " +
              "AUCUN lien n'est requis, c'est justement ce qui permet de réveiller un PC éteint " +
              "(H-75 : le PC initie le lien, jamais le Pi ; éteint, il n'y en a aucun à emprunter). " +
              "`☠` Ne confirme JAMAIS l'allumage : le paquet est émis, rien de plus — reviens avec " +
              "`etat_machine` après quelques minutes pour vérifier que la machine a répondu.",
            { machine: z.enum(['pc']).describe('Seule machine pilotable par ces outils : le PC.') },
            async ({ machine }) => protege('reveiller_machine', () => reveillerMachine(emetteurReveil, machine)),
          ),
        ];

  return [...outilEtatMachine, ...outilReveillerMachine];
}

/**
 * Groupe « service » (A.2.2) — `etat_service` et `piloter_service`, LOCAUX au
 * Pi (H-75, voir `outils-service.ts`), chacun présent SEULEMENT si la
 * composition a câblé son port (`lecteurServiceSysteme` / `piloteServiceSysteme`).
 *
 * `☠` Les enums `service` sont fermés côté SEAUX (`outils-service.ts`) :
 * `etat_service` expose SEAU 2 + SEAU 3, `piloter_service` expose SEAU 3 SEUL —
 * jamais une chaîne libre, jamais le même enum pour les deux outils.
 */
function outilsService(deps: DependancesServeurControle) {
  const lecteur = deps.lecteurServiceSysteme;
  const outilEtatService =
    lecteur === undefined
      ? []
      : [
          tool(
            'etat_service',
            "État d'un service systemd du Pi : actif/inactif/en échec, et depuis quand si connu. " +
              "Lecture seule — les services ici listés sont ceux dont l'opérateur a validé la lecture " +
              "(production comprise). Une unité absente de systemd est rendue en `refuse` explicite : " +
              "l'inventaire de cette liste date du 17/07 (complété 01/08), pas d'une mesure en direct.",
            {
              machine: z.enum(['pi']).describe('Seule machine pilotable par ces outils : le Pi.'),
              service: z.enum(SERVICES_ETAT_SERVICE).describe('Unité systemd, liste blanche fermée.'),
            },
            async ({ machine, service }) => protege('etat_service', () => etatService(lecteur, machine, service)),
            { annotations: { readOnlyHint: true } },
          ),
        ];

  const piloteur = deps.piloteServiceSysteme;
  const outilPiloterService =
    piloteur === undefined
      ? []
      : [
          tool(
            'piloter_service',
            "Redémarre un service systemd du Pi — `restart` UNIQUEMENT (pas de `start`/`stop` : un `stop` " +
              "sans relance laisse un service de prod éteint sans garde-fou). N'accepte que des services à " +
              "impact faible et panne visible (voir la liste blanche). `☠` Peut échouer par `refuse` si " +
              "l'opérateur n'a pas encore posé la règle sudoers requise sur le Pi — le message dit alors " +
              "exactement laquelle ajouter, ce n'est jamais à cet outil de la poser.",
            {
              machine: z.enum(['pi']).describe('Seule machine pilotable par ces outils : le Pi.'),
              service: z.enum(SERVICES_PILOTER_SERVICE).describe('Unité systemd, liste blanche fermée (sous-ensemble de etat_service).'),
              action: z.enum(['restart']).describe('Seule action disponible au premier déploiement.'),
            },
            async ({ machine, service, action }) =>
              protege('piloter_service', () => piloterService(piloteur, machine, service, action)),
          ),
        ];

  return [...outilEtatService, ...outilPiloterService];
}

export function construireOutilsControle(deps: DependancesServeurControle) {
  return [
    ...outilsInspection(deps),
    ...outilsCycleVie(deps),
    ...outilsBudget(deps),
    ...outilsRappels(deps),
    ...outilsFil(deps),
    ...outilsHistoriqueFils(deps),
    ...outilsArtefact(deps),
    ...outilsRallonge(deps),
    ...outilsAutonomie(deps),
    ...outilsContexte(deps),
    ...outilsExploration(deps),
    ...outilsRecherche(deps),
    ...outilsLectureFichier(deps),
    ...outilsMachine(deps),
    ...outilsService(deps),
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
