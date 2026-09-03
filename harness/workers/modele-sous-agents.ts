/**
 * Responsabilité : VERROU DUR du modèle des sous-agents d'un lead (A1, décision
 * Chris 2026-09-03) — tout sous-agent lancé via l'outil `Task` tourne sur
 * `sonnet`, quoi que le lead demande, sans héritage du modèle Opus du lead.
 *
 * `☠ POURQUOI UN HOOK, ET PAS UNE CONSIGNE NI L'OPTION `agents`.`
 * Le coût par équipe a un facteur ~10 (6,40 $ Opus contre 0,67 $ Sonnet, mesuré
 * le 01/08) : un lead Opus qui lance des Task sans préciser `model` lançait des
 * Opus, car `AgentInput.model` est OPTIONNEL et « if omitted, inherits from the
 * parent » (`sdk-tools.d.ts`). La parade textuelle (« ton défaut est sonnet »
 * dans le mandat) était une consigne oubliable. L'option `agents` ne verrouille
 * rien non plus : le `model` passé à `Task` « takes precedence over the agent
 * definition's model ». Le SEUL canal qui s'applique APRÈS l'émission de l'appel
 * et peut le RÉÉCRIRE est un hook `PreToolUse` rendant `updatedInput`
 * (`PreToolUseHookSpecificOutput.updatedInput`, `sdk.d.ts`). On réécrit donc le
 * champ `model` de l'entrée du Task en `sonnet` — l'override explicite `opus`,
 * l'omission (héritage), tout retombe sur Sonnet.
 *
 * `☠ LE CAS `fork`, ISOLÉ.` Le schéma du Task le dit : « Ignored for
 * subagent_type: "fork" — forks always inherit the parent model ». Réécrire
 * `model` sur un fork ne sert donc à RIEN : il resterait sur l'Opus du lead.
 * Un fork est, par construction, un sous-agent Opus. On le REFUSE (fail-closed),
 * avec un motif actionnable — l'appelant est un modèle, il se corrige si on lui
 * dit quoi faire (`code-standards.md`, « Model output is untrusted input »).
 *
 * `☠ CE QUE CE VERROU NE GARANTIT PAS` (à dire dans le rapport, jamais à taire) :
 *  1. l'EFFORT. L'entrée `Task` ne porte AUCUN champ d'effort (`AgentInput` n'a
 *     ni `effort` ni équivalent) : on ne peut pas l'imposer par ce canal.
 *     L'effort d'un sous-agent suit le défaut du SDK — l'héritage du lead, qui
 *     tourne en `high`. « Sonnet high » est donc obtenu par l'héritage de
 *     l'effort, pas par un verrou de ce hook.
 *  2. la MESURE RÉELLE. Comme `confinement-ecriture.ts`, aucun banc
 *     `acceptation/*-reel.ts` n'exerce ce chemin contre le vrai binaire CLI : la
 *     forme est correcte au regard des types du SDK, elle n'est pas mesurée en
 *     réel. Un dispatch réel (lead qui lance un Task `model: 'opus'`, vérifier
 *     que le sous-agent tourne bien sur Sonnet) reste à faire par le parent.
 */

import type { HookCallback, HookCallbackMatcher, HookEvent, SyncHookJSONOutput } from '@anthropic-ai/claude-agent-sdk';

const AUCUNE_DECISION: SyncHookJSONOutput = {};

/**
 * `☠ MESURÉ LE 2026-09-03` (banc `verrou-sous-agents-reel.ts`, SDK 0.3.220) :
 * l'outil qui lance un sous-agent est émis sous le nom `Agent`, PAS `Task`. Un
 * hook qui ne matchait que `Task` voyait passer le sous-agent Opus sans le
 * réécrire (le hook rendait `{}`, sous-agent resté sur Opus 5) — le verrou était
 * mort. On matche les DEUX noms : `Agent` (réel ici) et `Task` (filet, nom
 * historique). Les outils de gestion (`TaskStop`/`TaskOutput`…) ne sont pas dedans.
 */
const OUTILS_SOUS_AGENT: ReadonlySet<string> = new Set(['Agent', 'Task']);

/**
 * `☠` La valeur imposée est un ALIAS (`sonnet`), la forme que le champ `model` de
 * l'entrée `Task` accepte (`"sonnet" | "opus" | "haiku" | "fable"`). Écrire
 * `claude-sonnet-5` ici serait le défaut du 31/07 sous une autre forme.
 */
export const MODELE_SOUS_AGENT_IMPOSE = 'sonnet';

/** Le type de sous-agent qui ignore `model` et hérite TOUJOURS du parent (Opus). */
const SOUS_AGENT_FORK = 'fork';

/** Sonde minimale : `tool_input` est `unknown` côté SDK, jamais casté d'office. */
function champTexte(entree: unknown, cle: string): string | null {
  if (typeof entree !== 'object' || entree === null) return null;
  const valeur = (entree as Record<string, unknown>)[cle];
  return typeof valeur === 'string' ? valeur : null;
}

/**
 * Le hook lui-même. Ne touche QUE l'outil `Task` ; tout le reste passe sans
 * décision (les autres outils ne sont pas de son ressort).
 */
export function construireHookModeleSousAgents(): HookCallback {
  return async (input): Promise<SyncHookJSONOutput> => {
    if (input.hook_event_name !== 'PreToolUse') return AUCUNE_DECISION;
    if (!OUTILS_SOUS_AGENT.has(input.tool_name)) return AUCUNE_DECISION;

    const typeSousAgent = champTexte(input.tool_input, 'subagent_type');
    if (typeSousAgent === SOUS_AGENT_FORK) {
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason:
            'sous-agent « fork » refusé : un fork hérite TOUJOURS de ton modèle (Opus) et ignore ' +
            'le champ `model` — la politique de coût ccremote impose Sonnet aux exécuteurs (A1). ' +
            'Relance un sous-agent normal (sans `subagent_type: "fork"`) avec un brief explicite : ' +
            'son modèle sera Sonnet, imposé par le harness.',
        },
      };
    }

    // `☠` L'entrée est PRÉSERVÉE, seul `model` est réécrit : retirer les autres
    // champs (prompt, description, subagent_type…) casserait le Task. On force
    // Sonnet que le lead ait écrit `opus`, `haiku`, ou rien du tout (héritage).
    const entree = typeof input.tool_input === 'object' && input.tool_input !== null ? input.tool_input : {};
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        updatedInput: { ...(entree as Record<string, unknown>), model: MODELE_SOUS_AGENT_IMPOSE },
      },
    };
  };
}

/** Entrée `Options.hooks` prête à fusionner avec les autres (audit, confinement). */
export function creerHooksModeleSousAgents(): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
  return { PreToolUse: [{ hooks: [construireHookModeleSousAgents()] }] };
}
