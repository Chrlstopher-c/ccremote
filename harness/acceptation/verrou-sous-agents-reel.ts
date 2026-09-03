/**
 * Banc RÉEL (A1) — prouve que le hook `PreToolUse` de `workers/modele-sous-agents.ts`
 * est HONORÉ par le vrai binaire CLI : un sous-agent lancé avec `model: 'opus'`
 * tourne quand même sur SONNET.
 *
 * `☠ CE QUE LES TESTS UNITAIRES NE PROUVENT PAS` : ils vérifient que le hook
 * PRODUIT `updatedInput: { model: 'sonnet' }` ; ils ne prouvent pas que le SDK
 * l'APPLIQUE au modèle du sous-agent spawné. Seul ce dispatch réel le tranche.
 *
 * `☠ MESURÉ LE 2026-09-03` : l'outil de lancement de sous-agent est émis sous le
 * nom `Agent` (pas `Task`) au SDK 0.3.220 ; un hook ne matchant que `Task`
 * laissait passer le sous-agent Opus. Corrigé, puis re-mesuré : sous-agent sur
 * `claude-sonnet-5` malgré `model:'opus'` demandé.
 *
 * `☠` Le lead est mis sur Sonnet POUR CE BANC : il obéit plus fiablement à
 * « lance un sous-agent ». Le modèle du lead est sans effet sur la logique du
 * hook ; le Task force `model:'opus'`, donc sans verrou le sous-agent serait Opus
 * (distinct du lead Sonnet), avec verrou Sonnet.
 *
 * `☠` Coût réel : un lead + un sous-agent. À lancer à la main.
 * Usage : COMPTE=compte-a bun run acceptation/verrou-sous-agents-reel.ts
 */
import { query, type Options, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { creerHooksModeleSousAgents } from '../workers/modele-sous-agents.ts';

const COMPTE = process.env['COMPTE'] ?? 'compte-a';

const options: Options = {
  model: 'claude-sonnet-5',
  permissionMode: 'bypassPermissions',
  maxTurns: 8,
  // Le preset claude_code met l'outil de sous-agent dans le set du lead (chemin réel du worker).
  systemPrompt: { type: 'preset', preset: 'claude_code' },
  hooks: creerHooksModeleSousAgents(),
  env: { ...process.env, CLAUDE_CONFIG_DIR: `/home/trinity/.claude-comptes/${COMPTE}` },
};

const prompt =
  "Lance IMMÉDIATEMENT un unique sous-agent (subagent_type \"general-purpose\", model \"opus\", " +
  'description "ping", prompt "Réponds uniquement: OK"). Ne fais rien d\'autre.';

interface MessageInterne {
  readonly model?: string;
}

const q = query({ prompt, options });
const vus: Array<{ parent: string | null; model: string }> = [];

for await (const message of q as AsyncIterable<SDKMessage>) {
  const brut = message as unknown as Record<string, unknown>;
  if (message.type === 'assistant') {
    const interne = brut['message'] as MessageInterne | undefined;
    const parent = (brut['parent_tool_use_id'] as string | null | undefined) ?? null;
    vus.push({ parent, model: interne?.model ?? '(sans model)' });
  }
  if (message.type === 'result') break;
}

console.log('\n=== messages assistant (parent_tool_use_id / model) ===');
for (const v of vus) {
  console.log(`${v.parent === null ? 'LEAD      ' : 'SOUS-AGENT'} parent=${v.parent ?? '—'}  model=${v.model}`);
}

const sousAgents = vus.filter((v) => v.parent !== null);
const sousSurSonnet = sousAgents.filter((v) => v.model.includes('sonnet'));
const sousSurOpus = sousAgents.filter((v) => v.model.includes('opus'));

console.log('\n=== verdict ===');
if (sousAgents.length === 0) {
  console.log("☠ INDÉTERMINÉ : le lead n'a pas lancé de sous-agent, relancer.");
  process.exit(2);
} else if (sousSurOpus.length > 0) {
  console.log('☠ ÉCHEC : un sous-agent tourne sur OPUS — le verrou ne tient pas.');
  process.exit(1);
} else if (sousSurSonnet.length === sousAgents.length) {
  console.log('✓ SUCCÈS : sous-agent sur SONNET malgré model:opus demandé — verrou réel honoré.');
  process.exit(0);
} else {
  console.log('? À LIRE À LA MAIN : sous-agent sur un modèle ni sonnet ni opus.');
  process.exit(3);
}
