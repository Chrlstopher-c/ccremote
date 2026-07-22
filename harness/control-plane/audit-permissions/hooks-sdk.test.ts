// Tests de l'adaptateur SDK (M-22). Fixtures typées comme les formes réelles
// de `sdk.d.ts` (0.3.217) sans importer le binaire — mêmes garanties que
// `test-harness/doublures` : on fige la FORME, pas le comportement du SDK.
//
// (b) — le critère central : le hook exercé pour l'exhaustivité est
// `PreToolUse`, jamais `canUseTool`. Ce fichier ne construit aucun test autour
// de `canUseTool` : il n'existe tout simplement pas dans ce module.

import { describe, expect, test } from 'bun:test';
import type {
  PostToolUseHookInput,
  PreToolUseHookInput,
  SDKMessage,
  SDKPermissionDeniedMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { CollecteurAuditPermissions } from './collecteur.ts';
import { creerHooksAuditPermissions, ingererMessageAudit } from './hooks-sdk.ts';

const ENTREE_TENTATIVE_POUR_TEST = {
  toolUseId: 'defaut',
  outil: 'Bash',
  entree: { command: 'echo hi' },
  sessionId: 'sess-x',
  cwd: '/mnt/projects/x',
  agentId: null,
  permissionMode: 'auto',
};

const ENTREE_PRE_TOOL_USE: PreToolUseHookInput = {
  hook_event_name: 'PreToolUse',
  tool_name: 'Bash',
  tool_input: { command: 'echo hi' },
  tool_use_id: 'tu-hook-1',
  session_id: 'sess-x',
  cwd: '/mnt/projects/x',
  transcript_path: '/tmp/transcript.jsonl',
  permission_mode: 'auto',
};

describe('(b) PreToolUse alimente l\'audit, jamais canUseTool', () => {
  test('le hook PreToolUse enregistre la tentative sans jamais rendre de décision', async () => {
    const collecteur = new CollecteurAuditPermissions();
    const hooks = creerHooksAuditPermissions(collecteur);
    const callback = hooks.PreToolUse?.[0]?.hooks[0];
    expect(callback).toBeDefined();

    const sortie = await callback?.(ENTREE_PRE_TOOL_USE, 'tu-hook-1', { signal: new AbortController().signal });
    // Observation pure : jamais de champ qui influence l'arbitrage.
    expect(sortie).toEqual({});
    expect(collecteur.demandeParId('tu-hook-1')?.outil).toBe('Bash');
    expect(collecteur.demandeParId('tu-hook-1')?.permissionMode).toBe('auto');
  });

  test('un hook reçoit un événement qui n\'est pas le sien : ignoré, pas d\'exception', async () => {
    const collecteur = new CollecteurAuditPermissions();
    const hooks = creerHooksAuditPermissions(collecteur);
    const callbackPreToolUse = hooks.PreToolUse?.[0]?.hooks[0];
    // Un PostToolUseHookInput (forme valide de HookInput) ne doit jamais être
    // traité par le callback PreToolUse, même si le SDK le lui passait.
    const entreeEtrangere: PostToolUseHookInput = {
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'echo hi' },
      tool_response: 'hi',
      tool_use_id: 'tu-hook-1',
      session_id: 'sess-x',
      cwd: '/mnt/projects/x',
      transcript_path: '/tmp/transcript.jsonl',
    };
    await callbackPreToolUse?.(entreeEtrangere, 'tu-hook-1', { signal: new AbortController().signal });
    expect(collecteur.registre()).toHaveLength(0);
  });
});

describe('ingestion de SDKPermissionDeniedMessage (refus court-circuité)', () => {
  test('un message permission_denied avec discriminant "classifier" trace l\'auteur', () => {
    const collecteur = new CollecteurAuditPermissions();
    const message: SDKPermissionDeniedMessage = {
      type: 'system',
      subtype: 'permission_denied',
      tool_name: 'Bash',
      tool_use_id: 'tu-msg-1',
      decision_reason_type: 'classifier',
      decision_reason: 'commande destructrice',
      message: 'refusé par le classifieur',
      uuid: '00000000-0000-0000-0000-000000000001',
      session_id: 'sess-x',
    };
    ingererMessageAudit(collecteur, message as SDKMessage);
    const entree = collecteur.demandeParId('tu-msg-1');
    expect(entree?.verdict).toBe('refuse');
    expect(entree?.auteur).toBe('classifieur');
    expect(entree?.motif).toBe('commande destructrice');
  });

  test('un message d\'un autre type est ignoré silencieusement', () => {
    const collecteur = new CollecteurAuditPermissions();
    const messageEtranger = { type: 'system', subtype: 'init' } as unknown as SDKMessage;
    expect(() => ingererMessageAudit(collecteur, messageEtranger)).not.toThrow();
    expect(collecteur.registre()).toHaveLength(0);
  });
});

describe('correctif 2026-07-22 — refus par tool_result (aucun message system émis)', () => {
  // Forme mesurée en réel sur un refus par `disallowedTools` en mode `auto` :
  // un message `user` dont `message.content` porte un bloc `tool_result`
  // `is_error: true`. `MessageParam` est un type profond emprunté à
  // `@anthropic-ai/sdk` (alpha) — même cast large que la ligne 88 ci-dessus,
  // jamais vers une forme précise dont la dérive romprait l'ingestion en silence.
  function messageUtilisateurAvecToolResult(toolUseId: string, texte: string, isError = true): SDKMessage {
    return {
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: toolUseId, is_error: isError, content: texte }],
      },
      parent_tool_use_id: null,
    } as unknown as SDKMessage;
  }

  test('☠ un refus par plancher de déni SANS message system est quand même tracé comme refus', () => {
    const collecteur = new CollecteurAuditPermissions();
    collecteur.enregistrerTentative({ ...ENTREE_TENTATIVE_POUR_TEST, toolUseId: 'tu-tr-1' });
    // Aucun SDKPermissionDeniedMessage, aucun hook PermissionDenied : exactement
    // la scène mesurée. Si ce test échoue, c'est que l'audit a été rebranché
    // sur le message `system` comme source unique — la régression interdite.
    ingererMessageAudit(collecteur, messageUtilisateurAvecToolResult('tu-tr-1', 'Error: permission denied'));
    const entree = collecteur.demandeParId('tu-tr-1');
    expect(entree?.verdict).toBe('refuse');
    expect(entree?.auteur).toBe('inconnu');
  });

  test('un tool_result en erreur SANS texte de refus ne devient pas un refus', () => {
    const collecteur = new CollecteurAuditPermissions();
    collecteur.enregistrerTentative({ ...ENTREE_TENTATIVE_POUR_TEST, toolUseId: 'tu-tr-2' });
    // is_error vrai mais texte d'échec d'exécution ordinaire — pas un refus de permission.
    ingererMessageAudit(collecteur, messageUtilisateurAvecToolResult('tu-tr-2', 'Error: file not found'));
    expect(collecteur.demandeParId('tu-tr-2')?.verdict).toBe('indetermine');
  });

  test('un tool_result réussi (is_error absent) n\'est jamais lu comme un refus', () => {
    const collecteur = new CollecteurAuditPermissions();
    collecteur.enregistrerTentative({ ...ENTREE_TENTATIVE_POUR_TEST, toolUseId: 'tu-tr-3' });
    ingererMessageAudit(collecteur, messageUtilisateurAvecToolResult('tu-tr-3', 'permission denied', false));
    expect(collecteur.demandeParId('tu-tr-3')?.verdict).toBe('indetermine');
  });
});
