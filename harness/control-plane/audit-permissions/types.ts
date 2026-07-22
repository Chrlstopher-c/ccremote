/**
 * Responsabilité : formes de données de l'audit des permissions (branche C.5,
 * mission M-22). Aucune I/O ici.
 *
 * Rappel du fait mesuré qui gouverne tout ce module (2026-07-22, vrai binaire) :
 * en `permissionMode: 'auto'`, `canUseTool` n'est **jamais** appelé. Le point
 * d'observation exhaustif est donc le hook `PreToolUse` (C.1.1, panne #23), pas
 * `canUseTool` — ce module ne dépend d'aucune donnée qui transiterait par
 * `canUseTool` pour être exhaustif. `canUseTool` reste une source secondaire,
 * légitime pour les trois exceptions de C.1.2 et pour `permissionMode: 'default'`.
 */

/**
 * Qui a tranché une demande d'outil.
 *
 * `classifieur_probable` existe séparément de `classifieur` et n'est PAS une
 * variante cosmétique : le SDK n'expose aucun signal positif « le classifieur
 * a autorisé ceci » (`⚠ HYP`, voir `collecteur.ts`). Une autorisation observée
 * sans refus ni escalade est une INFÉRENCE (permissionMode courant + absence de
 * signal de refus), jamais une certitude au même titre qu'un refus, dont le
 * discriminant `decision_reason_type` est fourni explicitement par le SDK.
 * Confondre les deux surclasserait la confiance de la trace — exactement ce
 * que la question (c) de la mission interdit de faire silencieusement.
 */
export type AuteurDecision =
  | 'classifieur'
  | 'classifieur_probable'
  | 'regle_scopee'
  | 'mode'
  | 'agent_asynchrone'
  | 'humain'
  | 'inconnu';

export type VerdictAudit = 'autorise' | 'refuse' | 'indetermine';

/** Longueur maximale de l'entrée tronquée conservée dans la trace (C.5.1). */
export const TRONCATURE_MAX_CARACTERES = 500;

/**
 * Fait brut vu par le hook `PreToolUse` — la seule étape qui voit TOUT appel
 * d'outil, y compris auto-résolu (C.1.1). Ancre l'exhaustivité de la trace.
 */
export interface FaitTentative {
  readonly toolUseId: string;
  readonly outil: string;
  readonly entree: unknown;
  readonly sessionId: string | null;
  readonly cwd: string | null;
  readonly agentId: string | null;
  readonly permissionMode: string | null;
}

/** Fait vu par le hook `PostToolUse` — l'outil a réellement été exécuté. */
export interface FaitExecution {
  readonly toolUseId: string;
  readonly outil: string;
}

/**
 * Fait vu par le hook `PermissionDenied` — refus court-circuité avant l'étage
 * d'invite (classifieur, mode, règle). Texte libre uniquement : ce hook ne
 * porte pas de discriminant structuré, contrairement à `SDKPermissionDeniedMessage`.
 */
export interface FaitRefusHook {
  readonly toolUseId: string;
  readonly outil: string;
  readonly motif: string;
}

/**
 * Fait vu sur le flux de messages (`SDKPermissionDeniedMessage`, type
 * `system`/`permission_denied`) — même refus que `FaitRefusHook`, mais avec le
 * discriminant structuré `decision_reason_type`. Source la plus fiable pour
 * l'auteur d'un refus (C.5.1).
 */
export interface FaitRefusMessage {
  readonly toolUseId: string;
  readonly outil: string;
  readonly motif: string | null;
  readonly discriminantAuteur: string | undefined;
  readonly agentId: string | null;
}

/**
 * Fait vu sur le flux de messages — bloc `tool_result` avec `is_error: true`
 * dans un message `user`, dont le texte porte un refus de permission.
 *
 * **Source de premier rang, mesurée en réel le 2026-07-22**
 * (`acceptation/audit-permissions-reel.ts`) : sur un refus par
 * `disallowedTools` en `permissionMode: 'auto'`, ni `PermissionDenied` (hook)
 * ni `SDKPermissionDeniedMessage` (message `system`) ne sont émis. Le SEUL
 * signal observé est ce `tool_result`, apparié par `tool_use_id` à la
 * tentative déjà vue par `PreToolUse`. Ne porte aucun discriminant d'auteur
 * (`decision_reason_type` n'existe pas ici) — contrairement à un refus vu par
 * message `system`, celui-ci ne peut jamais produire `auteur: 'classifieur'`.
 */
export interface FaitRefusToolResult {
  readonly toolUseId: string;
  readonly outil?: string;
  readonly texte: string;
}

/**
 * Fait d'escalade humaine — canal `canUseTool` (mode `default`, ou l'une des
 * trois exceptions de C.1.2 même sous `auto`). Ce module ne réimplémente pas
 * le cycle de vie de la demande (bus-permissions, M-21) : il consomme son
 * verdict final une fois émis, via ce fait.
 */
export interface FaitEscaladeHumaine {
  readonly toolUseId: string;
  readonly outil: string;
  readonly autorise: boolean;
  readonly motif: string | null;
}

/** Vue agrégée d'une demande, exposée par le collecteur (C.5.1). */
export interface EnregistrementAudit {
  readonly toolUseId: string;
  readonly outil: string;
  readonly entreeTronquee: string | null;
  readonly sessionId: string | null;
  readonly cwd: string | null;
  readonly agentId: string | null;
  readonly permissionMode: string | null;
  readonly tentativeVueA: number | null;
  readonly verdict: VerdictAudit;
  readonly auteur: AuteurDecision;
  readonly motif: string | null;
  readonly verdictA: number | null;
}

/** Rapport de couverture — répond à « la trace a-t-elle un angle mort ? ». */
export interface CouvertureAudit {
  readonly tentativesVues: number;
  readonly autorisees: number;
  readonly refusees: number;
  readonly nonResolues: number;
}

/** Occurrence groupée pour la question C.5.2 « quoi mérite une règle permanente ? ». */
export interface DemandeRecurrente {
  readonly signature: string;
  readonly occurrences: number;
  readonly dernierExemple: EnregistrementAudit;
}

/** Port de temps du domaine — même motif que `bus-permissions/types.ts`. */
export interface HorlogeAudit {
  maintenant(): number;
}

export const HORLOGE_REELLE_AUDIT: HorlogeAudit = {
  maintenant: () => Date.now(),
};

/**
 * Les trois exceptions de C.1.2 qui atteignent `canUseTool` même sous une
 * règle d'allow correspondante. Seule `AskUserQuestion` est statiquement
 * connaissable par nom d'outil : les deux autres (outil MCP marqué
 * `requiresUserInteraction`, connecteur réglé `ask` par l'organisation) sont
 * des propriétés dynamiques que ce module n'a pas les moyens d'observer sans
 * le catalogue MCP/organisation. `⚠ HYP` documentée plutôt que devinée.
 */
export const OUTILS_EXCEPTION_C12_CONNUS: readonly string[] = ['AskUserQuestion'];
