/**
 * Responsabilité : brancher `SentinelleContexte` (M-42, déjà livré) sur la
 * surface réelle du SDK (A.1.4) — hooks `PreCompact`/`PostCompact` côté
 * `Options.hooks`, message `SDKCompactBoundaryMessage` côté flux `query()`.
 * Ne réimplémente aucune classification : ne fait que traduire les formes SDK
 * vers les méthodes déjà exposées par `SentinelleContexte`.
 *
 * Même motif que `control-plane/audit-permissions/hooks-sdk.ts` : narrowing sur
 * `hook_event_name`/`type`+`subtype`, jamais de `as`, callback qui ne renvoie
 * jamais de décision (`{}`) — ce module observe, il ne bloque rien (H-62 :
 * l'autocompaction n'est jamais empêchée).
 */

import type {
  HookCallback,
  HookCallbackMatcher,
  HookEvent,
  Query,
  SDKMessage,
  SyncHookJSONOutput,
} from '@anthropic-ai/claude-agent-sdk';
import type { SentinelleContexte } from '../../../discipline-contexte/index.ts';

/**
 * Comble l'ordre de construction imposé par le SDK : les hooks
 * `PreCompact`/`PostCompact` doivent être fournis dans `Options` AVANT le
 * spawn, mais `SentinelleContexte` a besoin d'une `SourceContexte`
 * (`getContextUsage()`) qui n'existe qu'APRÈS — c'est le `Query` retourné par
 * `query()`/`WarmQuery.query()`. Cette boîte est construite d'abord, passée à
 * `SentinelleContexte`, puis remplie (`.query = ...`) une fois le `Query` réel
 * obtenu. Tant qu'elle n'est pas remplie, `getContextUsage()` lève — mais
 * `EchantillonneurContexte.demarrer()` n'est appelé qu'après ce remplissage
 * (voir `demarrage.ts`), donc ce chemin n'est jamais emprunté en pratique.
 */
export class SourceContexteDifferee {
  query: Query | null = null;

  getContextUsage(): ReturnType<Query['getContextUsage']> {
    if (this.query === null) {
      throw new Error('SourceContexteDifferee.getContextUsage() appelé avant que le Query réel ne soit posé');
    }
    return this.query.getContextUsage();
  }
}

const OBSERVATION_VIDE: SyncHookJSONOutput = {};

function surPreCompact(sentinelle: SentinelleContexte): HookCallback {
  return async (input): Promise<SyncHookJSONOutput> => {
    if (input.hook_event_name !== 'PreCompact') return OBSERVATION_VIDE;
    sentinelle.observerCompactionHook(input.trigger);
    return OBSERVATION_VIDE;
  };
}

function surPostCompact(sentinelle: SentinelleContexte): HookCallback {
  return async (input): Promise<SyncHookJSONOutput> => {
    if (input.hook_event_name !== 'PostCompact') return OBSERVATION_VIDE;
    // `PostCompactHookInput` ne porte pas les compteurs de tokens (seulement
    // `compact_summary`) — la source de tokens fiable est le message de flux,
    // voir `ingererMessageContexte` ci-dessous. Ce hook confirme seulement
    // l'événement et son déclencheur.
    sentinelle.observerCompactionHook(input.trigger);
    return OBSERVATION_VIDE;
  };
}

/** Construit les entrées `Options.hooks` pour la discipline de contexte (A.1.4). */
export function creerHooksContexte(sentinelle: SentinelleContexte): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
  return {
    PreCompact: [{ hooks: [surPreCompact(sentinelle)] }],
    PostCompact: [{ hooks: [surPostCompact(sentinelle)] }],
  };
}

/**
 * Point d'ingestion unique côté flux `query()` — à appeler dans la boucle
 * `for await` de `demarrage.ts` pour chaque message reçu. Ignore silencieusement
 * tout ce qui n'est pas `SDKCompactBoundaryMessage`, ne lève jamais : une panne
 * ici ne doit jamais interrompre la boucle de messages de l'orchestrateur.
 */
export function ingererMessageContexte(sentinelle: SentinelleContexte, message: SDKMessage): void {
  if (message.type !== 'system' || !('subtype' in message) || message.subtype !== 'compact_boundary') return;
  const meta = (message as { compact_metadata?: { trigger: 'manual' | 'auto'; pre_tokens: number; post_tokens?: number } })
    .compact_metadata;
  if (meta === undefined) return;
  sentinelle.observerCompactionMessage(meta.trigger, { pre: meta.pre_tokens, post: meta.post_tokens });
}
