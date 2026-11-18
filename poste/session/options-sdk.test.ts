import { describe, expect, test } from 'bun:test';
import { envSdk, optionsSdk, type ParametresSdk } from './options-sdk.ts';

const SERVEUR_RYTHME = {
  type: 'stdio' as const,
  command: '/usr/bin/bun',
  args: ['/poste/mcp-rythme.ts'],
  env: { CCREMOTE_SESSION: 'conv-1', CCREMOTE_SOCKET: '/run/poste.sock' },
};

const parametres = (surcharge: Partial<ParametresSdk> = {}): ParametresSdk => ({
  identifiant: 'conv-1',
  reprise: false,
  cwd: '/projets/app',
  consignes: 'Consignes ccremote',
  modele: 'claude-haiku-5-5',
  mode: 'bypassPermissions',
  effort: null,
  executable: '/usr/bin/claude',
  configDir: null,
  source: {},
  canUseTool: async () => null,
  rythme: SERVEUR_RYTHME,
  ...surcharge,
});

describe('envSdk', () => {
  test('retire les variables héritées de la session parente et la clé API', () => {
    const env = envSdk(
      {
        CLAUDE_CODE_SESSION_ID: 'x',
        CLAUDE_CODE_MESSAGING_TOKEN: 'jeton',
        CLAUDE_AGENT_SDK_VERSION: '0.3.325',
        ANTHROPIC_API_KEY: 'cle',
        HOME: '/home/trinity',
        ABSENTE: undefined,
      },
      null,
    );
    expect(env).toEqual({ HOME: '/home/trinity' });
  });

  test('pose CLAUDE_CONFIG_DIR seulement pour un compte choisi', () => {
    expect(envSdk({ HOME: '/h' }, '/comptes/2')['CLAUDE_CONFIG_DIR']).toBe('/comptes/2');
    expect(envSdk({ HOME: '/h' }, null)['CLAUDE_CONFIG_DIR']).toBeUndefined();
  });
});

describe('optionsSdk', () => {
  test('nouvelle conversation : sessionId fixé, pas de resume', () => {
    const o = optionsSdk(parametres());
    expect(o.sessionId).toBe('conv-1');
    expect(o.resume).toBeUndefined();
  });

  test('reprise : resume à partir de l’identifiant de conversation', () => {
    const o = optionsSdk(parametres({ reprise: true }));
    expect(o.resume).toBe('conv-1');
    expect(o.sessionId).toBeUndefined();
  });

  test('mode bypass par défaut : permissionMode transmis, bypass autorisé pour les changements en cours de session', () => {
    const o = optionsSdk(parametres());
    expect(o.permissionMode).toBe('bypassPermissions');
    expect(o.allowDangerouslySkipPermissions).toBe(true);
  });

  test('mode demandé et effort transmis ; sans effort, le défaut du modèle', () => {
    expect(optionsSdk(parametres({ mode: 'default', effort: 'high' }))).toMatchObject({
      permissionMode: 'default',
      effort: 'high',
    });
    expect(optionsSdk(parametres({ effort: null })).effort).toBeUndefined();
  });

  test('permissions par canUseTool, messages partiels, consignes ajoutées au prompt de Claude Code', () => {
    const o = optionsSdk(parametres({ mode: 'default' }));
    expect(o.permissionMode).toBe('default');
    expect(o.includePartialMessages).toBe(true);
    expect(o.systemPrompt).toEqual({ type: 'preset', preset: 'claude_code', append: 'Consignes ccremote' });
    expect(o.cwd).toBe('/projets/app');
    expect(o.model).toBe('claude-haiku-5-5');
    expect(o.pathToClaudeCodeExecutable).toBe('/usr/bin/claude');
  });

  test('le serveur de rythme de la session est branché en MCP ccremote', () => {
    expect(optionsSdk(parametres()).mcpServers).toEqual({ ccremote: SERVEUR_RYTHME });
  });

  test('sans modèle, sans binaire ni consignes : valeurs par défaut du SDK', () => {
    const o = optionsSdk(parametres({ modele: undefined, executable: null, consignes: '' }));
    expect(o.model).toBeUndefined();
    expect(o.pathToClaudeCodeExecutable).toBeUndefined();
    expect(o.systemPrompt).toEqual({ type: 'preset', preset: 'claude_code' });
  });
});
