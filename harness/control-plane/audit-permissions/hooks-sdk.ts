/**
 * Responsabilité : adapter le collecteur d'audit à la surface réelle du SDK
 * (`sdk.d.ts`, 0.3.217) — hooks `PreToolUse`/`PostToolUse`/`PermissionDenied`
 * côté `Options.hooks`, et messages du flux `query()` (`system`/`permission_denied`,
 * `user`/`tool_result`). Isole le domaine (`collecteur.ts`) de la forme alpha
 * du SDK : si ces types bougent, seul ce fichier change.
 *
 * **Correctif mesuré en réel le 2026-07-22** (`acceptation/audit-permissions-reel.ts`,
 * `permissionMode: 'auto'`, refus par `disallowedTools`) : `SDKPermissionDeniedMessage`
 * n'a JAMAIS été émis sur ce chemin, ni le hook `PermissionDenied`. Le SEUL
 * signal réel était un bloc `tool_result` (`is_error: true`) d'un message
 * `user`, apparié par `tool_use_id`. ⇒ `ingererMessageAudit` traite ce bloc
 * comme source de premier rang, et le message `system` comme source
 * secondaire (toujours ingéré — il existe dans le type du SDK et peut
 * concerner d'autres chemins, `asyncAgent` notamment — mais jamais comme
 * source unique de refus).
 *
 * ☠ CASSE évité ici, par construction : les callbacks ne RENVOIENT jamais de
 * décision (`{}` systématique). Ce module observe, il n'arbitre pas — mélanger
 * audit et arbitrage dans le même hook est le genre de confusion que C.1.1
 * met en garde contre.
 */

import type {
  HookCallback,
  HookCallbackMatcher,
  HookEvent,
  SDKMessage,
  SyncHookJSONOutput,
} from '@anthropic-ai/claude-agent-sdk';
import { auditPermissionsLogger as journal } from './logger.ts';
import type { CollecteurAuditPermissions } from './collecteur.ts';

const OBSERVATION_VIDE: SyncHookJSONOutput = {};

/**
 * `HookCallback` prend `HookInput`, l'union des 29 formes de hook. On ne
 * narrove qu'après vérification de `hook_event_name` — jamais de `as` : un
 * hook mal câblé sur le mauvais événement doit produire un type manquant,
 * pas une assertion qui masquerait l'erreur.
 */
function surPreToolUse(collecteur: CollecteurAuditPermissions): HookCallback {
  return async (input, toolUseID): Promise<SyncHookJSONOutput> => {
    if (input.hook_event_name !== 'PreToolUse') return OBSERVATION_VIDE;
    const id = toolUseID ?? input.tool_use_id;
    collecteur.enregistrerTentative({
      toolUseId: id,
      outil: input.tool_name,
      entree: input.tool_input,
      sessionId: input.session_id ?? null,
      cwd: input.cwd ?? null,
      agentId: input.agent_id ?? null,
      permissionMode: input.permission_mode ?? null,
    });
    return OBSERVATION_VIDE;
  };
}

function surPostToolUse(collecteur: CollecteurAuditPermissions): HookCallback {
  return async (input, toolUseID): Promise<SyncHookJSONOutput> => {
    if (input.hook_event_name !== 'PostToolUse') return OBSERVATION_VIDE;
    const id = toolUseID ?? input.tool_use_id;
    collecteur.enregistrerExecution({ toolUseId: id, outil: input.tool_name });
    return OBSERVATION_VIDE;
  };
}

function surPermissionDenied(collecteur: CollecteurAuditPermissions): HookCallback {
  return async (input, toolUseID): Promise<SyncHookJSONOutput> => {
    if (input.hook_event_name !== 'PermissionDenied') return OBSERVATION_VIDE;
    const id = toolUseID ?? input.tool_use_id;
    collecteur.enregistrerRefusHook({ toolUseId: id, outil: input.tool_name, motif: input.reason });
    return OBSERVATION_VIDE;
  };
}

/**
 * Construit les entrées `Options.hooks` d'audit exhaustif. À fusionner par
 * l'appelant avec d'éventuels autres hooks (plancher de déni, etc.) — ce
 * module ne suppose pas être le seul consommateur de ces événements.
 */
export function creerHooksAuditPermissions(
  collecteur: CollecteurAuditPermissions,
): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
  return {
    PreToolUse: [{ hooks: [surPreToolUse(collecteur)] }],
    PostToolUse: [{ hooks: [surPostToolUse(collecteur)] }],
    PermissionDenied: [{ hooks: [surPermissionDenied(collecteur)] }],
  };
}

/**
 * Un refus par règle scopée / plancher de déni (mesuré : le cas le plus
 * fréquent en production) ne produit ni hook ni message structuré — seul un
 * texte de refus dans le `tool_result`. Heuristique nécessairement
 * textuelle : mêmes motifs que le banc d'essai réel qui l'a mesurée.
 * `⚠ HYP` — un vrai résultat d'erreur d'exécution (commande introuvable, par
 * exemple) qui contiendrait par hasard un de ces mots serait mal classé ;
 * accepté en l'absence d'un champ structuré côté SDK. Une correspondance sur
 * ce motif SEUL, sans `is_error: true`, ne suffit jamais (cf. `estBlocDeRefus`).
 */
const MOTIF_TEXTUEL_REFUS = /permission|denied|not allowed|disallow/i;

/** Forme minimale lue dans un bloc de contenu `user` — jamais castée, seulement sondée. */
interface BlocContenuSonde {
  readonly type?: string;
  readonly tool_use_id?: string;
  readonly is_error?: boolean;
  readonly content?: unknown;
}

function texteDuContenu(contenu: unknown): string {
  if (typeof contenu === 'string') return contenu;
  try {
    return JSON.stringify(contenu) ?? '';
  } catch {
    return '';
  }
}

function estBlocDeRefus(bloc: BlocContenuSonde): boolean {
  if (bloc.type !== 'tool_result' || bloc.is_error !== true || bloc.tool_use_id === undefined) return false;
  return MOTIF_TEXTUEL_REFUS.test(texteDuContenu(bloc.content));
}

/**
 * `message.message.content` est un type SDK profond (`MessageParam`, alpha).
 * Justification du typage large : même motif que la sonde de
 * `acceptation/plancher-moteur-reel.ts` — on lit une forme, on ne la caste
 * jamais vers un type précis dont la moindre dérive romprait silencieusement
 * l'audit. Élargir, jamais rétrécir par assertion.
 */
function blocsDuMessageUtilisateur(message: SDKMessage): readonly BlocContenuSonde[] {
  if (message.type !== 'user') return [];
  const enveloppe = message as { message?: { content?: unknown } };
  const contenu = enveloppe.message?.content;
  return Array.isArray(contenu) ? (contenu as BlocContenuSonde[]) : [];
}

function ingererRefusSysteme(collecteur: CollecteurAuditPermissions, message: SDKMessage): void {
  if (message.type !== 'system') return;
  if (!('subtype' in message) || message.subtype !== 'permission_denied') return;
  collecteur.enregistrerRefusMessage({
    toolUseId: message.tool_use_id,
    outil: message.tool_name,
    motif: message.decision_reason ?? message.message ?? null,
    discriminantAuteur: message.decision_reason_type,
    agentId: message.agent_id ?? null,
  });
}

function ingererRefusToolResult(collecteur: CollecteurAuditPermissions, message: SDKMessage): void {
  for (const bloc of blocsDuMessageUtilisateur(message)) {
    if (!estBlocDeRefus(bloc)) continue;
    // `tool_use_id` vérifié non-undefined par `estBlocDeRefus`.
    collecteur.enregistrerRefusToolResult({
      toolUseId: bloc.tool_use_id as string,
      texte: texteDuContenu(bloc.content).slice(0, 500),
    });
  }
}

/**
 * Point d'ingestion unique pour tout ce qui arrive sur le flux `query()`
 * (boucle `for await` du worker/orchestrateur) plutôt que par un hook :
 * refus structuré (`system`/`permission_denied`) ET refus textuel
 * (`user`/`tool_result`, source de premier rang mesurée en réel — cf.
 * en-tête de fichier). Ignore silencieusement tout autre message, sans
 * jamais lever.
 */
export function ingererMessageAudit(collecteur: CollecteurAuditPermissions, message: SDKMessage): void {
  try {
    ingererRefusSysteme(collecteur, message);
    ingererRefusToolResult(collecteur, message);
  } catch (erreur) {
    journal.error({ erreur }, 'ingestion_message_audit_echouee');
  }
}
