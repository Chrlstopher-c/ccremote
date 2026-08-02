/**
 * Responsabilité : composer les `Options` de LA session orchestrateur (A.1.1).
 *
 * Ce fichier est la preuve mécanique de l'acceptation (a) : « ni Bash, ni Write,
 * ni Edit — l'orchestrateur n'agit que par ses outils MCP. » `tools` énumère
 * explicitement le jeu de base autorisé (jamais la forme `{type:'preset'}`, qui
 * réintroduirait tout) ; `disallowedTools` reprend les mêmes noms en défense en
 * profondeur. Les deux mécanismes sont vérifiés indépendamment par
 * `assertInvariantsOrchestrateur`, appelée à chaque composition — voir
 * `options-orchestrateur.test.ts` pour le test en négatif exigé par la mission.
 *
 * `'Agent'` est exclu au même titre (H-10 : le harness ne possède que N1 — un
 * orchestrateur qui pourrait invoquer l'outil `Agent` ferait du N3 lui-même).
 */

import type { HookCallbackMatcher, HookEvent, McpServerConfig, Options } from '@anthropic-ai/claude-agent-sdk';
import { MANDAT_ORCHESTRATEUR } from './mandat.ts';
import type { DecisionDemarrage } from './identite.ts';

/** Modèle de l'orchestrateur (H-23, H-62) — alias résolu par le CLI, jamais un id de worker. */
export const MODELE_ORCHESTRATEUR = 'opus';

/**
 * Jeu de base des outils intégrés. `AskUserQuestion` y figure explicitement :
 * c'est le mécanisme natif de désambiguïsation (A.3.2), pas une réimplémentation
 * maison. `Read`/`Grep`/`Glob` sont « le jeu minimal de lecture locale » d'A.1.1
 * — utile pour consulter un mandat ou une note, jamais pour agir sur un projet.
 *
 * `☠` `WebSearch`/`WebFetch` manquaient alors que `MANDAT_ORCHESTRATEUR` annonce
 * en toutes lettres « tu as la RECHERCHE WEB ». Une capacité promise dans le
 * prompt et absente de l'allowlist ne produit pas une erreur lisible : le modèle
 * ne voit tout simplement pas l'outil, et rend un « je ne peux pas » que rien
 * n'explique. Le prompt et `tools` décrivent la même chose — ils changent
 * ensemble ou ils mentent. Ces deux outils lisent, ils n'agissent pas :
 * l'acceptation (a) (ni Bash, ni Write, ni Edit) reste entière.
 */
export const OUTILS_ORCHESTRATEUR: readonly string[] =
  ['Read', 'Grep', 'Glob', 'AskUserQuestion', 'WebSearch', 'WebFetch'];

/** Défense en profondeur — mêmes noms qu'absents de `OUTILS_ORCHESTRATEUR`, jamais un motif scopé ici : on VEUT amputer la capacité, pas seulement borner un danger (contrairement à H-41/plancher-deni, qui concerne les équipes). */
export const OUTILS_INTERDITS_ORCHESTRATEUR: readonly string[] = ['Bash', 'Write', 'Edit', 'Agent'];

const SETTING_SOURCES_ORCHESTRATEUR: readonly ('user' | 'project' | 'local')[] = ['user', 'project', 'local'];

export class OptionsOrchestrateurError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OptionsOrchestrateurError';
  }
}

export interface DependancesOptionsOrchestrateur {
  readonly decision: DecisionDemarrage;
  /** Serveur MCP de contrôle déjà assemblé (M-40) — nom de clé libre, une seule entrée attendue. */
  readonly serveurControle: McpServerConfig;
  readonly nomServeurControle?: string;
  readonly hooksContexte?: Partial<Record<HookEvent, HookCallbackMatcher[]>>;
  readonly sessionStore?: Options['sessionStore'];
  readonly cwd?: string;
  readonly configDir?: string;
}

const NOM_SERVEUR_PAR_DEFAUT = 'ccremote-controle';

function construireEnv(configDir: string | undefined): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env };
  if (configDir !== undefined) env['CLAUDE_CONFIG_DIR'] = configDir;
  return env;
}

/** Compose les `Options` de la session orchestrateur. Toujours suivi d'`assertInvariantsOrchestrateur`. */
export function composerOptionsOrchestrateur(deps: DependancesOptionsOrchestrateur): Options {
  const nomServeur = deps.nomServeurControle ?? NOM_SERVEUR_PAR_DEFAUT;
  const identite: Pick<Options, 'sessionId' | 'resume'> =
    deps.decision.mode === 'reprise' ? { resume: deps.decision.sessionId } : { sessionId: deps.decision.sessionId };

  const options: Options = {
    ...identite,
    cwd: deps.cwd,
    model: MODELE_ORCHESTRATEUR,
    // `☠` `bypassPermissions` et NON `auto` (décision Chris, 2026-08-02) — même
    // raison que pour les workers le 31/07, un cran plus haut. MESURÉ le 02/08 à
    // 12h22 : le classifieur du mode `auto` a refusé un `creer_equipe`
    // (« Blocked by classifier ») sur un mandat combinant mise en production,
    // suppression d'un compte en base et déploiement. L'orchestrateur s'est
    // arrêté net, en pleine fenêtre d'autonomie, sur une décision que plus
    // personne n'arbitrait — exactement le mode de panne que le retrait du bus
    // d'escalade rend définitif.
    //
    // `☠` Le refus n'est PAS reproductible hors contexte : trois bancs le 02/08
    // (mandat exact rejoué, écriture distante d'un settings de permissions vers
    // /tmp puis vers la vraie cible) ont tous passé sans refus. Le classifieur
    // juge la session, pas l'action — donc une règle `permissions.allow` ne peut
    // être ni prouvée ni bornée, et seul le mode supprime le mode de panne.
    //
    // `☠` Ce qui borne l'orchestrateur ne dépend PAS du mode : sa capacité est
    // amputée par `tools` (jamais le preset complet) et `disallowedTools` —
    // ni Bash, ni Write, ni Edit, ni Agent. Sa seule surface d'action reste le
    // serveur MCP de contrôle. Acceptation (a) intacte.
    permissionMode: 'bypassPermissions',
    // Exigé par le SDK dès que le mode est `bypassPermissions` : garde-fou
    // volontaire, pour que le contournement soit un choix écrit et jamais un défaut.
    allowDangerouslySkipPermissions: true,
    tools: [...OUTILS_ORCHESTRATEUR],
    disallowedTools: [...OUTILS_INTERDITS_ORCHESTRATEUR],
    mcpServers: { [nomServeur]: deps.serveurControle },
    toolConfig: { askUserQuestion: { previewFormat: 'html' } },
    systemPrompt: { type: 'preset', preset: 'claude_code', append: MANDAT_ORCHESTRATEUR },
    settingSources: [...SETTING_SOURCES_ORCHESTRATEUR],
    // `☠` Posée explicitement, comme pour les workers : l'orchestrateur tourne en
    // continu et sature son contexte plus vite que quiconque.
    settings: { autoCompactEnabled: true },
    includePartialMessages: true,
    env: construireEnv(deps.configDir),
    hooks: deps.hooksContexte,
    ...(deps.sessionStore !== undefined ? { sessionStore: deps.sessionStore } : {}),
  };
  assertInvariantsOrchestrateur(options);
  return options;
}

/**
 * Garde-fou exécutable de l'acceptation (a) + H-44. Appelé à chaque composition
 * (défense en profondeur : un futur appelant qui composerait ses propres
 * `Options` à la main sans passer par cette fonction ne serait pas couvert —
 * documenté, pas un `☠` de ce module puisque `composerOptionsOrchestrateur`
 * est le seul point d'entrée prévu).
 */
export function assertInvariantsOrchestrateur(options: Options): void {
  assertPasDeToolsDangereux(options);
  assertModeAutonomeCoherent(options);
  assertAskUserQuestionDisponible(options);
  assertConfigMachineHonoree(options);
  assertServeurControlePresent(options);
  assertAucunFluxBrutSubagent(options);
}

/**
 * (e) H-45, garde de régression : `forwardSubagentText`/`agentProgressSummaries`
 * sont les deux options SDK qui font entrer de l'activité de sous-agents en
 * texte brut dans LE contexte de la session qui les porte. L'orchestrateur n'a
 * pas de sous-agents (pas d'outil `Agent`, H-10) — les activer ici n'aurait
 * aucun effet utile et serait le premier endroit où un flux brut pourrait
 * s'introduire par erreur de copier-coller depuis `workers/options-composition.ts`.
 */
function assertAucunFluxBrutSubagent(options: Options): void {
  if (options.forwardSubagentText === true || options.agentProgressSummaries === true) {
    throw new OptionsOrchestrateurError(
      "forwardSubagentText/agentProgressSummaries actifs sur l'orchestrateur : violerait H-45 (aucun flux brut dans son contexte).",
    );
  }
}

function assertPasDeToolsDangereux(options: Options): void {
  const tools = options.tools;
  if (!Array.isArray(tools)) {
    throw new OptionsOrchestrateurError(
      "tools doit être un tableau explicite (jamais le preset 'claude_code' complet) — acceptation (a).",
    );
  }
  for (const interdit of OUTILS_INTERDITS_ORCHESTRATEUR) {
    if (tools.includes(interdit)) {
      throw new OptionsOrchestrateurError(`« ${interdit} » présent dans tools : l'orchestrateur ne doit agir que par MCP.`);
    }
    if (options.disallowedTools?.includes(interdit) !== true) {
      throw new OptionsOrchestrateurError(`« ${interdit} » absent de disallowedTools (défense en profondeur manquante).`);
    }
  }
}

/**
 * Le SDK exige `permissionMode: 'bypassPermissions'` et `allowDangerouslySkipPermissions`
 * ENSEMBLE — dépareillés, il refuse de démarrer. Même garde que côté workers
 * (`workers/options-composition.ts`) : le contournement doit être un choix écrit,
 * jamais un défaut hérité.
 */
function assertModeAutonomeCoherent(options: Options): void {
  if (options.permissionMode !== 'bypassPermissions') {
    throw new OptionsOrchestrateurError(
      `permissionMode « ${String(options.permissionMode)} » : l'orchestrateur doit tourner en bypassPermissions — ` +
        "en 'auto' le classifieur peut refuser un dispatch que plus personne n'arbitre (mesuré le 2026-08-02).",
    );
  }
  if (options.allowDangerouslySkipPermissions !== true) {
    throw new OptionsOrchestrateurError(
      'permissionMode et allowDangerouslySkipPermissions dépareillés : le SDK les exige ensemble.',
    );
  }
}

/**
 * A.3.2, `☠` documenté dans 04-arbre-A : `dontAsk` refuse `AskUserQuestion` au lieu
 * de le présenter — une équipe (ou ici l'orchestrateur) dans ce mode ne peut plus
 * désambiguïser.
 *
 * `☠` CETTE ASSERTION NE PROUVE QUE LA DEMANDE, PAS LA LIVRAISON. Mesuré le
 * 2026-08-02 (`acceptation/askuserquestion-bypass-reel.ts`) : `AskUserQuestion`
 * figure bien dans `tools`, l'assertion passe — et le SDK ne le livre PAS. Le
 * message `init` d'une session composée par ce fichier annonce
 * `Glob, Grep, Read, WebFetch, WebSearch, mcp__ccremote-controle__*` et rien
 * d'autre ; le modèle répond « je n'ai pas l'outil AskUserQuestion dans cette
 * session » et bascule en texte libre. Zéro `tool_use` AskUserQuestion dans
 * l'intégralité des transcripts de production de l'orchestrateur.
 *
 * Le comportement est IDENTIQUE en `auto` et en `bypassPermissions` : le passage
 * en mode autonome n'y est pour rien, le défaut lui préexiste. A.3.2 reste donc à
 * rebrancher — piste non explorée : le banc passe un prompt `string`, la
 * production un flux d'entrée en streaming, ce qui pourrait changer la livraison.
 */
function assertAskUserQuestionDisponible(options: Options): void {
  const tools = options.tools;
  if (Array.isArray(tools) && !tools.includes('AskUserQuestion')) {
    throw new OptionsOrchestrateurError('AskUserQuestion absent de tools : la désambiguïsation native (A.3.2) est impossible.');
  }
  if (options.permissionMode === 'dontAsk') {
    throw new OptionsOrchestrateurError(
      "permissionMode 'dontAsk' refuse AskUserQuestion au lieu de le présenter — incompatible avec A.3.2.",
    );
  }
}

function assertConfigMachineHonoree(options: Options): void {
  if (options.settingSources === undefined || options.settingSources.length === 0) {
    throw new OptionsOrchestrateurError('settingSources vide : la config machine serait neutralisée en silence (H-44).');
  }
  if (!options.settingSources.includes('project')) {
    throw new OptionsOrchestrateurError("settingSources sans 'project' : le CLAUDE.md de projet ne serait pas chargé (H-44).");
  }
  const prompt = options.systemPrompt;
  if (typeof prompt !== 'object' || prompt === null || Array.isArray(prompt) || prompt.type !== 'preset') {
    throw new OptionsOrchestrateurError('systemPrompt doit être en forme preset claude_code (H-44).');
  }
}

function assertServeurControlePresent(options: Options): void {
  const serveurs = options.mcpServers;
  if (serveurs === undefined || Object.keys(serveurs).length === 0) {
    throw new OptionsOrchestrateurError("mcpServers vide : l'orchestrateur n'aurait plus aucun moyen d'agir sur le parc.");
  }
}
